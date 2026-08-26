'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { applyRuntimeConfigMigrations } = require('./RuntimeConfigMigrations');
const FlowError = require('../../shared/errors/FlowError');
const RuntimeTransactionJournal = require('./RuntimeTransactionJournal');
const RuntimeConfigVersionReader = require('./RuntimeConfigVersionReader');
const RuntimeConfigTreeVerifier = require('./RuntimeConfigTreeVerifier');
const RuntimeFilesystemApplier = require('./RuntimeFilesystemApplier');
const RuntimeRecoveryCoordinator = require('./RuntimeRecoveryCoordinator');

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function mergeDefaults(defaultValue, userValue) {
    if (!isPlainObject(defaultValue) || !isPlainObject(userValue)) {
        return userValue === undefined ? defaultValue : userValue;
    }
    const output = {};
    for (const [key, value] of Object.entries(defaultValue)) {
        output[key] = Object.prototype.hasOwnProperty.call(userValue, key)
            ? mergeDefaults(value, userValue[key])
            : value;
    }
    for (const [key, value] of Object.entries(userValue)) {
        if (!Object.prototype.hasOwnProperty.call(output, key)) output[key] = value;
    }
    return output;
}

class RuntimeConfigMigrator {
    constructor({ templateRoot, runtimeRoot, appVersion, migrationRunner = applyRuntimeConfigMigrations, fsOps = fsp } = {}) {
        if (!templateRoot || !runtimeRoot || !appVersion) throw new TypeError('RuntimeConfigMigrator requires templateRoot, runtimeRoot and appVersion.');
        this.templateRoot = path.resolve(templateRoot);
        this.runtimeRoot = path.resolve(runtimeRoot);
        this.appVersion = String(appVersion);
        this.migrationRunner = migrationRunner;
        this.fs = fsOps;
        this.metadataPath = path.join(this.runtimeRoot, '.mcbot-runtime.json');
        this.versionReader = new RuntimeConfigVersionReader({ fsOps:this.fs, metadataPath:this.metadataPath });
        this.treeVerifier = new RuntimeConfigTreeVerifier({ fsOps:this.fs, existsSync:fs.existsSync });
        this.filesystemApplier = new RuntimeFilesystemApplier({ fsOps:this.fs });
        this.recoveryCoordinator = new RuntimeRecoveryCoordinator();
    }

    async #createTransactionContext(operation) {
        const root = await this.fs.mkdtemp(path.join(this.runtimeRoot, '.mcbot-runtime-config-tx-'));
        const tx = {
            id: `${operation}-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            operation,
            phase: 'CAPTURE_PRESTATE',
            workRoot: root,
            tempCounter: 0,
            closureRepairCount: 0,
            ledger: RuntimeTransactionJournal.create(),
            artifacts: [],
            verifiedSources: [],
            unownedCollisions: [],
            cleanupWarnings: [],
            expected: { pre: { config: null, metadata: null }, desired: { config: null, metadata: null } },
            state: {
                metadataCandidateInstalled: false,
                metadataActiveOwnership: null,
                desiredJointVerified: false,
                prestateJointVerified: false,
                committed: false
            }
        };
        this.#registerArtifact(tx, {
            path: root, kind: 'transaction-root', parentOwnedRoot: null, namespaceOwned: true, exists: true,
            createdByOperation: true, ownedByThisOperation: true, howOwnershipWasProven: 'mkdtemp-returned',
            expectedDigest: null, observedDigest: null, verified: true, cleanupPolicy: 'success', retentionStatus: 'active'
        });
        this.#recordTx(tx, {
            phase: 'RESERVE_OWNED_ROOT', stage: 'reserve-transaction-root', operation: 'mkdtemp',
            callOutcome: 'resolved', destinationPath: root, destinationExists: true, destinationOwned: true,
            destinationNamespaceOwned: true, success: true, postcondition: 'owned-root-created'
        });
        return tx;
    }

    #recordTx(tx, entry = {}) {
        return RuntimeTransactionJournal.append(tx?.ledger, entry);
    }

    #registerArtifact(tx, artifact = {}) {
        if (!tx || !artifact.path) return artifact;
        const absolute = path.resolve(artifact.path);
        const existing = tx.artifacts.find(item => path.resolve(item.path) === absolute);
        const normalized = {
            path: absolute, kind: artifact.kind || 'artifact', parentOwnedRoot: artifact.parentOwnedRoot || null,
            namespaceOwned: artifact.namespaceOwned === true, exists: artifact.exists === true,
            createdByOperation: artifact.createdByOperation === true, ownedByThisOperation: artifact.ownedByThisOperation === true,
            movable: artifact.movable === true,
            howOwnershipWasProven: artifact.howOwnershipWasProven || null, expectedDigest: artifact.expectedDigest ?? null,
            observedDigest: artifact.observedDigest ?? null, verified: artifact.verified === true,
            cleanupPolicy: artifact.cleanupPolicy || 'success', retentionStatus: artifact.retentionStatus || 'active'
        };
        if (existing) { Object.assign(existing, normalized); return existing; }
        tx.artifacts.push(normalized);
        return normalized;
    }

    #registerVerifiedSource(tx, source = {}) {
        if (!tx || !source.path) return null;
        const absolute = path.resolve(source.path);
        const existing = tx.verifiedSources.find(item => path.resolve(item.path) === absolute && item.kind === (source.kind || 'config'));
        const value = {
            path: absolute, kind: source.kind || 'config', digest: source.digest || null, verified: source.verified === true,
            owned: source.owned === true, movable: source.movable === true,
            howOwnershipWasProven: source.howOwnershipWasProven || null,
            retentionStatus: source.retentionStatus || 'active'
        };
        if (existing) { Object.assign(existing, value); return existing; }
        tx.verifiedSources.push(value);
        return value;
    }

    #recordUnownedCollision(tx, collision = {}) {
        if (!tx || !collision.path) return null;
        const value = {
            path: path.resolve(collision.path), kind: collision.kind || 'unknown', digest: collision.digest || null,
            cleanupAttempted: false, reason: collision.reason || 'ownership-not-proven'
        };
        tx.unownedCollisions.push(value);
        return value;
    }

    async #reserveOwnedRoot(tx, kind, prefix) {
        let root = null;
        let error = null;
        try { root = await this.fs.mkdtemp(path.join(this.runtimeRoot, prefix)); } catch (caught) { error = caught; }
        this.#recordTx(tx, {
            phase: tx?.phase || null, stage: `reserve-${kind}`, operation: 'mkdtemp',
            callOutcome: error ? 'rejected' : 'resolved', destinationPath: root, success: !error,
            causeCode: error?.code || null, message: error?.message || null, postcondition: error ? 'owned-root-not-created' : 'owned-root-created'
        });
        if (error) throw error;
        this.#registerArtifact(tx, {
            path: root, kind, namespaceOwned: true, exists: true, createdByOperation: true, ownedByThisOperation: true,
            howOwnershipWasProven: 'mkdtemp-returned', verified: true, cleanupPolicy: 'success', retentionStatus: 'active'
        });
        return root;
    }

    async #ownedChildPath(tx, directory, prefix, extension = '.tmp') {
        if (!tx?.workRoot) throw new Error('Transaction work root is unavailable.');
        const parent = path.join(tx.workRoot, directory);
        await this.fs.mkdir(parent, { recursive: true });
        tx.tempCounter += 1;
        return path.join(parent, `${prefix}-${tx.tempCounter}${extension}`);
    }

    async #stageVerifiedTree(tx, { source, expectedDigest, ownedRoot, destinationName = 'config', phase = 'stage-verified-tree', kind = 'config-stage' }) {
        await this.#verifyTreeDigest(source, expectedDigest);
        const sourceArtifact = tx?.artifacts?.find(item => path.resolve(item.path) === path.resolve(source));
        const sourceOwned = sourceArtifact?.ownedByThisOperation === true;
        this.#registerVerifiedSource(tx, {
            path: source, kind: 'config-source', digest: expectedDigest, verified: true, owned: sourceOwned,
            howOwnershipWasProven: sourceArtifact?.howOwnershipWasProven || 'digest-verified-source', retentionStatus: 'active'
        });
        const staged = path.join(ownedRoot, destinationName);
        let copyError = null;
        try { await this.fs.cp(source, staged, { recursive: true, errorOnExist: true }); } catch (error) { copyError = error; }
        this.#recordTx(tx, {
            phase, stage: `${phase}-cp-call`, operation: 'cp-call', sourcePath: source, destinationPath: staged,
            sourceOwned, destinationNamespaceOwned: true, callOutcome: copyError ? 'rejected' : 'resolved',
            success: !copyError, causeCode: copyError?.code || null, message: copyError?.message || null,
            postcondition: 'call-completed-await-postcondition'
        });

        let digest = null;
        let readError = null;
        let destinationExists = false;
        for (let read = 1; read <= 2; read += 1) {
            destinationExists = fs.existsSync(staged);
            if (!destinationExists) break;
            try {
                digest = await this.#treeDigest(staged);
                readError = null;
                this.#recordTx(tx, {
                    phase, stage: `${phase}-verify`, operation: 'tree-digest', read, sourcePath: staged,
                    expectedDigest, observedDigest: digest, callOutcome: 'resolved', success: digest === expectedDigest,
                    postcondition: digest === expectedDigest ? 'verified-digest' : 'stage-digest-mismatch'
                });
                break;
            } catch (error) {
                readError = error;
                this.#recordTx(tx, {
                    phase, stage: `${phase}-verify`, operation: 'tree-digest', read, sourcePath: staged,
                    expectedDigest, observedDigest: null, callOutcome: 'rejected', success: false,
                    causeCode: error?.code || null, message: error?.message || null, postcondition: 'stage-digest-unreadable'
                });
            }
        }
        destinationExists = fs.existsSync(staged);
        const matched = destinationExists && digest === expectedDigest;
        const artifact = this.#registerArtifact(tx, {
            path: staged, kind, parentOwnedRoot: ownedRoot, namespaceOwned: true, exists: destinationExists,
            createdByOperation: destinationExists, ownedByThisOperation: destinationExists,
            howOwnershipWasProven: destinationExists ? 'child-of-mkdtemp-owned-root' : null, expectedDigest, observedDigest: digest,
            verified: matched, cleanupPolicy: 'parent', retentionStatus: destinationExists ? 'active' : 'not-created'
        });
        this.#recordTx(tx, {
            phase, stage: phase, operation: 'cp', sourcePath: source, destinationPath: staged,
            sourceExists: fs.existsSync(source), destinationExists, sourceOwned, destinationOwned: destinationExists,
            destinationNamespaceOwned: true, expectedDigest, observedDigest: digest, callOutcome: copyError ? 'rejected' : 'resolved',
            sideEffectObserved: destinationExists, success: matched, causeCode: copyError?.code || readError?.code || null,
            message: copyError?.message || readError?.message || null,
            postcondition: matched ? (copyError ? 'copy-threw-postcondition-matched' : 'verified-digest')
                : (destinationExists ? 'stage-not-verified' : 'stage-not-created')
        });
        if (!matched) {
            const error = copyError || readError || new Error('Config recovery staging copy did not match expected digest.');
            error.stagedArtifact = artifact;
            throw error;
        }
        return { path: staged, digest, artifact, callError: copyError };
    }

    async #stageVerifiedBytes(tx, { bytes, expectedDigest, directory = 'metadata', prefix = 'bytes', phase = 'stage-verified-bytes', kind = 'metadata-temp', onPath = null }) {
        const staged = await this.#ownedChildPath(tx, directory, prefix, '.bin');
        if (typeof onPath === 'function') onPath(staged);
        let writeError = null;
        try { await this.fs.writeFile(staged, bytes); } catch (error) { writeError = error; }
        this.#recordTx(tx, {
            phase, stage: `${phase}-write-call`, operation: 'writeFile-call', destinationPath: staged,
            destinationNamespaceOwned: true, callOutcome: writeError ? 'rejected' : 'resolved', success: !writeError,
            causeCode: writeError?.code || null, message: writeError?.message || null, postcondition: 'call-completed-await-postcondition'
        });
        let digest = null;
        let readError = null;
        let exists = false;
        for (let read = 1; read <= 2; read += 1) {
            exists = fs.existsSync(staged);
            if (!exists) break;
            try {
                digest = await this.#fileDigest(staged);
                readError = null;
                this.#recordTx(tx, {
                    phase, stage: `${phase}-verify`, operation: 'file-digest', sourcePath: staged, read,
                    expectedDigest, observedDigest: digest, callOutcome: 'resolved', success: digest === expectedDigest,
                    postcondition: digest === expectedDigest ? 'verified-digest' : 'source-digest-mismatch'
                });
                break;
            } catch (error) {
                readError = error;
                this.#recordTx(tx, {
                    phase, stage: `${phase}-verify`, operation: 'file-digest', sourcePath: staged, read,
                    expectedDigest, observedDigest: null, callOutcome: 'rejected', success: false, causeCode: error?.code || null,
                    message: error?.message || null, postcondition: 'source-digest-unreadable'
                });
            }
        }
        exists = fs.existsSync(staged);
        const matched = exists && digest === expectedDigest;
        const artifact = this.#registerArtifact(tx, {
            path: staged, kind, parentOwnedRoot: tx.workRoot, namespaceOwned: true, exists, createdByOperation: exists,
            ownedByThisOperation: exists, howOwnershipWasProven: exists ? 'child-of-mkdtemp-owned-root' : null,
            expectedDigest, observedDigest: digest, verified: matched, cleanupPolicy: 'parent', retentionStatus: exists ? 'active' : 'not-created'
        });
        this.#recordTx(tx, {
            phase, stage: `${phase}-postcondition`, operation: 'writeFile', destinationPath: staged, destinationExists: exists,
            destinationOwned: exists, destinationNamespaceOwned: true, expectedDigest, observedDigest: digest,
            callOutcome: writeError ? 'rejected' : 'resolved', sideEffectObserved: exists, success: matched,
            causeCode: writeError?.code || readError?.code || null, message: writeError?.message || readError?.message || null,
            postcondition: matched ? (writeError ? 'write-threw-postcondition-matched' : 'verified-digest')
                : (exists ? 'source-not-verified' : 'source-not-created')
        });
        if (!matched) {
            const error = writeError || readError || new Error('Metadata staging bytes could not be verified.');
            error.stagedArtifact = artifact;
            throw error;
        }
        this.#registerVerifiedSource(tx, {
            path: staged, kind, digest: expectedDigest, verified: true, owned: true,
            howOwnershipWasProven: 'child-of-mkdtemp-owned-root', retentionStatus: 'active'
        });
        return { path: staged, digest, artifact, callError: writeError };
    }

    async #observeMetadataExpected(expected) {
        const exists = fs.existsSync(this.metadataPath);
        if (!exists) return { exists: false, digest: null, matched: expected.existed === false, state: 'absent', readError: null };
        try {
            const digest = await this.#fileDigest(this.metadataPath);
            return {
                exists: true, digest, matched: expected.existed === true && digest === expected.digest,
                state: expected.existed === true && digest === expected.digest ? 'expected' : 'mismatched', readError: null
            };
        } catch (error) {
            return { exists: true, digest: null, matched: false, state: 'unreadable', readError: { code: error?.code || null, message: error?.message || String(error) } };
        }
    }

    async #verifyJointState(tx, { runtimeConfig, expectedConfig, expectedMetadata, phase }) {
        let last = null;
        for (let read = 1; read <= 2; read += 1) {
            this.#recordTx(tx, { phase: `${phase}-call`, stage: 'joint-gate-read-call', operation: 'read-only-joint-gate-call', read, success: true, callOutcome: 'resolved', postcondition: 'observation-pending' });
            const config = await this.#observeConfigTree(runtimeConfig, expectedConfig);
            const metadata = await this.#observeMetadataExpected(expectedMetadata);
            const success = config.matched && metadata.matched;
            const attempt = this.#recordTx(tx, {
                phase, stage: 'joint-state-verify', operation: 'read-only-joint-gate', read, success,
                callOutcome: (config.readError || metadata.readError) ? 'rejected' : 'resolved',
                postcondition: success ? 'joint-state-matched' : 'joint-state-not-matched', config, metadata
            });
            last = { success, config, metadata, read, attempts: tx.ledger.attempts, attemptSequence: attempt.sequence };
            if (success) return last;
            if (!config.readError && !metadata.readError) break;
        }
        return last || { success: false, config: null, metadata: null, read: 0, attempts: tx.ledger.attempts };
    }

    #metadataOwnershipEvidence(tx, writeEvidence = null) {
        return writeEvidence?.activeOwnership || tx?.state?.metadataActiveOwnership || null;
    }

    async #cleanupTransaction(tx, phase = 'cleanup') {
        if (!tx) return [];
        const candidates = tx.artifacts
            .filter(item => item?.path && item.ownedByThisOperation === true && item.cleanupPolicy === 'success')
            .sort((a, b) => b.path.length - a.path.length);
        const cleanedRoots = new Set();
        for (const artifact of candidates) {
            if ([...cleanedRoots].some(root => artifact.path.startsWith(`${root}${path.sep}`))) continue;
            let error = null;
            try { await this.fs.rm(artifact.path, { recursive: true, force: true }); } catch (caught) { error = caught; }
            this.#recordTx(tx, {
                phase, stage: 'cleanup-owned-artifact-call', operation: 'rm-call', sourcePath: artifact.path, sourceOwned: true,
                callOutcome: error ? 'rejected' : 'resolved', success: !error, causeCode: error?.code || null, message: error?.message || null,
                kind: artifact.kind, postcondition: 'cleanup-observation-pending'
            });
            const remains = fs.existsSync(artifact.path);
            artifact.retentionStatus = remains ? 'cleanup-failed' : 'cleaned';
            this.#recordTx(tx, {
                phase, stage: 'cleanup-owned-artifact-postcondition', operation: 'rm', sourcePath: artifact.path, sourceOwned: true,
                sourceExists: remains, callOutcome: error ? 'rejected' : 'resolved', success: !remains, causeCode: error?.code || null,
                message: error?.message || null, kind: artifact.kind, postcondition: remains ? 'owned-artifact-retained' : 'owned-artifact-absent'
            });
            if (remains) {
                tx.cleanupWarnings.push({ path: artifact.path, kind: artifact.kind, owned: true, causeCode: error?.code || null, message: error?.message || null });
            } else {
                cleanedRoots.add(artifact.path);
                for (const child of tx.artifacts) {
                    if (child.path === artifact.path || child.path.startsWith(`${artifact.path}${path.sep}`)) child.retentionStatus = 'cleaned';
                }
                for (const source of tx.verifiedSources) {
                    if (source.path === artifact.path || source.path.startsWith(`${artifact.path}${path.sep}`)) source.retentionStatus = 'cleaned';
                }
            }
        }
        return tx.cleanupWarnings;
    }

    #retainTransactionEvidence(tx) {
        if (!tx) return;
        for (const artifact of tx.artifacts) {
            if (artifact.exists !== false && artifact.retentionStatus === 'active') artifact.retentionStatus = fs.existsSync(artifact.path) ? 'retained' : 'not-created';
        }
        for (const source of tx.verifiedSources) {
            if (source.retentionStatus === 'active') source.retentionStatus = fs.existsSync(source.path) ? 'retained' : 'missing';
        }
    }

    #transactionDiagnostic(tx, finalJointGate = null) {
        return {
            transactionId: tx?.id || null, operation: tx?.operation || null, closureRepairCount: tx?.closureRepairCount || 0,
            verifiedSources: tx?.verifiedSources || [], unownedCollisions: tx?.unownedCollisions || [],
            cleanupWarnings: tx?.cleanupWarnings || [], finalJointGate, attempts: tx?.ledger?.attempts || [],
            artifacts: tx?.artifacts || []
        };
    }

    async prepare() {
        await this.fs.mkdir(this.runtimeRoot, { recursive: true });
        const runtimeConfig = path.join(this.runtimeRoot, 'config');
        const templateConfig = path.join(this.templateRoot, 'config');
        const metadataSnapshot = await this.#captureMetadataSnapshot();
        const metadata = metadataSnapshot.parsed;
        const configExists = fs.existsSync(runtimeConfig);
        const fromVersion = metadata?.appVersion || (configExists ? 'legacy' : null);
        let backup = null;
        let transactionBackup = null;
        let transientTransactionBackup = false;
        let verifiedRollbackSource = null;
        let originalConfigDigest = null;
        let desiredConfigDigest = null;
        let metadataAdvanced = false;
        let metadataIntendedDigest = null;
        let metadataWriteTemp = null;
        let metadataWriteEvidence = null;
        let desiredJointGate = null;
        let mutationStarted = false;
        let tx = null;

        const report = {
            fromVersion, toVersion: this.appVersion, backup: null,
            filesAdded: 0, filesMerged: 0, filesUnchanged: 0,
            versionMigrations: [], migratedFiles: [], migrationReports: [], warnings: []
        };

        try {
            tx = await this.#createTransactionContext('prepare');
            tx.expected.pre.config = { existed: configExists, digest: null };
            tx.expected.pre.metadata = { existed: metadataSnapshot.existed, digest: metadataSnapshot.digest };

            if (configExists) {
                originalConfigDigest = await this.#treeDigest(runtimeConfig);
                tx.expected.pre.config.digest = originalConfigDigest;
                if (fromVersion !== this.appVersion) {
                    backup = await this.#backupConfig(runtimeConfig, fromVersion);
                    transactionBackup = backup;
                } else {
                    transactionBackup = await this.#snapshotConfigForTransaction(runtimeConfig, tx);
                    transientTransactionBackup = true;
                }
                await this.#verifyTreeDigest(transactionBackup, originalConfigDigest);
                verifiedRollbackSource = transactionBackup;
                this.#registerVerifiedSource(tx, {
                    path: transactionBackup, kind: 'config-prestate', digest: originalConfigDigest, verified: true,
                    owned: transientTransactionBackup, howOwnershipWasProven: transientTransactionBackup
                        ? 'child-of-mkdtemp-owned-root' : 'durable-backup-digest-verified', retentionStatus: 'active'
                });
                report.backup = backup;
            }

            tx.phase = 'MUTATE_CONFIG';
            mutationStarted = true;
            await this.#mergeTree(templateConfig, runtimeConfig, report, tx);
            const migration = await this.migrationRunner({
                templateRoot: this.templateRoot,
                runtimeRoot: this.runtimeRoot,
                fromVersion,
                toVersion: this.appVersion
            });
            report.versionMigrations = migration.applied;
            report.migratedFiles = migration.files;
            report.migrationReports = migration.reports || [];

            for (const file of ['.env.example', 'SERVER_BEHAVIOR.md']) {
                const source = path.join(this.templateRoot, file);
                const destination = path.join(this.runtimeRoot, file);
                if (fs.existsSync(source) && !fs.existsSync(destination)) await this.fs.copyFile(source, destination);
            }

            desiredConfigDigest = await this.#treeDigest(runtimeConfig);
            const nextMetadata = {
                appVersion: this.appVersion,
                preparedAt: new Date().toISOString(),
                previousVersion: fromVersion,
                lastBackup: backup,
                lastBackupDigest: backup ? originalConfigDigest : null,
                lastMigration: report
            };
            const serializedMetadata = this.#serializeMetadata(nextMetadata);
            metadataIntendedDigest = this.#bufferDigest(serializedMetadata);
            tx.expected.desired.config = { existed: true, digest: desiredConfigDigest };
            tx.expected.desired.metadata = { existed: true, digest: metadataIntendedDigest };

            tx.phase = 'INSTALL_METADATA_CANDIDATE';
            try {
                metadataWriteEvidence = await this.#writeMetadata(nextMetadata, {
                    tempTag: `prepare-${process.pid}-${Date.now()}`,
                    serializedBytes: serializedMetadata,
                    expectedDigest: metadataIntendedDigest,
                    onTemp: temp => { metadataWriteTemp = temp; },
                    tx
                });
            } catch (writeError) {
                metadataWriteEvidence = writeError?.metadataWrite || null;
                if (metadataWriteEvidence?.activeOwnership) tx.state.metadataActiveOwnership = metadataWriteEvidence.activeOwnership;
                throw writeError;
            }
            tx.state.metadataCandidateInstalled = true;
            tx.state.metadataActiveOwnership = metadataWriteEvidence?.activeOwnership || null;

            tx.phase = 'DESIRED_JOINT_GATE';
            desiredJointGate = await this.#verifyJointState(tx, {
                runtimeConfig,
                expectedConfig: tx.expected.desired.config,
                expectedMetadata: tx.expected.desired.metadata,
                phase: 'prepare-desired-joint-gate'
            });
            if (desiredJointGate?.success !== true) {
                throw new FlowError('Runtime config desired config/metadata joint commit could not be proven.', {
                    code: 'RUNTIME_CONFIG_JOINT_COMMIT_FAILED', subsystem: 'desktop-update', operation: 'RuntimeConfigMigrator',
                    step: 'prepare-desired-joint-gate', action: 'verify desired config and metadata joint state', retryable: true,
                    details: { desiredJointGate }
                });
            }

            tx.state.desiredJointVerified = true;
            tx.state.committed = true;
            metadataAdvanced = true;
            tx.phase = 'COMMIT';
            await this.#cleanupTransaction(tx, 'prepare-success-cleanup');
            for (const warning of tx.cleanupWarnings) {
                report.warnings.push({
                    code: 'RUNTIME_CONFIG_TRANSACTION_CLEANUP_FAILED', message: warning.message || 'Owned transaction artifact cleanup failed.',
                    path: warning.path,
                    preservedSnapshot: warning.path,
                    kind: warning.kind,
                    owned: warning.owned === true,
                    causeCode: warning.causeCode || null
                });
            }
            return report;
        } catch (error) {
            let configRollback = null;
            let metadataRollback = null;
            let rollback = null;

            if (!tx) {
                rollback = { success: true, skipped: true, targetUntouched: true, code: null, recoveryAttempts: [] };
                const failureDetails = {
                    fromVersion, toVersion: this.appVersion, backup, rollback, metadataAdvanced,
                    metadataSnapshot: { existed: metadataSnapshot.existed, digest: metadataSnapshot.digest },
                    desiredConfigDigest, desiredJointGate, metadataIntendedDigest,
                    metadataWriteTemp: null, transactionBackup: transactionBackup || null,
                    verifiedRollbackSource, originalConfigDigest, report, transaction: null
                };
                throw FlowError.wrap(error, {
                    code: 'RUNTIME_CONFIG_MIGRATION_FAILED', subsystem: 'desktop-update', operation: 'RuntimeConfigMigrator', step: 'prepare',
                    action: 'reserve runtime config transaction context', retryable: true, details: failureDetails
                });
            }

            if (!metadataAdvanced) {
                if (!mutationStarted) {
                    configRollback = { success: true, skipped: true, targetUntouched: true };
                    metadataRollback = { success: true, skipped: true, targetUntouched: true };
                } else {
                    tx.phase = 'PRIMARY_CONFIG_RECOVERY';
                    try {
                        configRollback = await this.#restoreFailedPrepare(runtimeConfig, {
                            rollbackSource: verifiedRollbackSource,
                            expectedDigest: originalConfigDigest,
                            configExisted: configExists,
                            tx
                        });
                    } catch (rollbackError) {
                        configRollback = this.#recoveryFailureDiagnostic(rollbackError, {
                            code: 'RUNTIME_CONFIG_RECOVERY_FAILED', rollbackSource: verifiedRollbackSource || transactionBackup || null,
                            expectedDigest: originalConfigDigest, activeTargetPresent: fs.existsSync(runtimeConfig),
                            activeTargetDigest: fs.existsSync(runtimeConfig) ? await this.#treeDigest(runtimeConfig).catch(() => null) : null
                        });
                    }

                    tx.phase = 'PRIMARY_METADATA_RECOVERY';
                    try {
                        metadataRollback = await this.#restoreMetadataSnapshot(metadataSnapshot, `prepare-${process.pid}-${Date.now()}`, {
                            tx,
                            activeOwnership: this.#metadataOwnershipEvidence(tx, metadataWriteEvidence)
                        });
                    } catch (metadataError) {
                        metadataRollback = this.#metadataRecoveryFailureDiagnostic(metadataError, metadataSnapshot, {
                            code: 'RUNTIME_CONFIG_RECOVERY_FAILED'
                        });
                    }
                }

                tx.phase = 'PRESTATE_JOINT_GATE_1';
                let jointGate = mutationStarted
                    ? await this.#verifyJointState(tx, {
                        runtimeConfig,
                        expectedConfig: { existed: configExists, digest: originalConfigDigest },
                        expectedMetadata: { existed: metadataSnapshot.existed, digest: metadataSnapshot.digest },
                        phase: 'prepare-joint-verify-1'
                    })
                    : { success: true, skipped: true, attempts: tx?.ledger?.attempts || [] };

                let closureConfig = null;
                let closureMetadata = null;
                const usableConfigEvidence = !configExists || Boolean(verifiedRollbackSource && originalConfigDigest && fs.existsSync(verifiedRollbackSource));
                const usableMetadataEvidence = metadataSnapshot.existed ? Boolean(metadataSnapshot.bytes && metadataSnapshot.digest) : true;
                if (mutationStarted && jointGate?.success !== true && usableConfigEvidence && usableMetadataEvidence) {
                    tx.closureRepairCount = 1;
                    tx.phase = 'CLOSURE_REPAIR_ONCE';
                    try {
                        closureConfig = await this.#restoreConfigPrestate({
                            target: runtimeConfig, existed: configExists, digest: originalConfigDigest,
                            sources: [verifiedRollbackSource, transactionBackup, configRollback?.restoredFrom].filter(Boolean),
                            prefix: 'prepare-joint-closure', attempts: tx.ledger.attempts, tx
                        });
                    } catch (closureError) {
                        closureConfig = this.#recoveryFailureDiagnostic(closureError, {
                            code: 'RUNTIME_CONFIG_RECOVERY_FAILED', rollbackSource: verifiedRollbackSource || transactionBackup || null,
                            expectedDigest: originalConfigDigest
                        });
                    }
                    try {
                        closureMetadata = await this.#restoreMetadataSnapshot(metadataSnapshot, `prepare-closure-${process.pid}-${Date.now()}`, {
                            tx,
                            activeOwnership: this.#metadataOwnershipEvidence(tx, metadataWriteEvidence)
                        });
                    } catch (closureMetadataError) {
                        closureMetadata = this.#metadataRecoveryFailureDiagnostic(closureMetadataError, metadataSnapshot, {
                            code: 'RUNTIME_CONFIG_RECOVERY_FAILED'
                        });
                    }
                    tx.phase = 'PRESTATE_JOINT_GATE_2';
                    jointGate = await this.#verifyJointState(tx, {
                        runtimeConfig,
                        expectedConfig: { existed: configExists, digest: originalConfigDigest },
                        expectedMetadata: { existed: metadataSnapshot.existed, digest: metadataSnapshot.digest },
                        phase: 'prepare-joint-verify-2'
                    });
                }

                const finalSuccess = jointGate?.success === true;
                tx.state.prestateJointVerified = finalSuccess;
                rollback = {
                    success: finalSuccess,
                    config: configRollback,
                    metadata: metadataRollback,
                    code: finalSuccess ? null : 'RUNTIME_CONFIG_RECOVERY_FAILED',
                    preservedRollbackSource: finalSuccess ? null : (verifiedRollbackSource || transactionBackup || null),
                    jointGate,
                    closureRepairCount: tx.closureRepairCount,
                    closure: { config: closureConfig, metadata: closureMetadata },
                    recoveryAttempts: tx.ledger.attempts,
                    ...this.#transactionDiagnostic(tx, jointGate)
                };

                if (configRollback?.targetUntouched) rollback.targetUntouched = true;
                if (configRollback?.rollbackSource) rollback.rollbackSource = configRollback.rollbackSource;
                if (configRollback?.restoredFrom) rollback.restoredFrom = configRollback.restoredFrom;
                if (configRollback?.expectedDigest) rollback.expectedDigest = configRollback.expectedDigest;
                if (configRollback?.activeTargetPresent !== undefined) rollback.activeTargetPresent = configRollback.activeTargetPresent;
                if (configRollback?.activeTargetDigest !== undefined) rollback.activeTargetDigest = configRollback.activeTargetDigest;
                if (configRollback?.stageRoots) rollback.stageRoots = configRollback.stageRoots;
                if (configRollback?.causeCode) rollback.causeCode = configRollback.causeCode;
                if (configRollback?.message) rollback.message = configRollback.message;

                if (finalSuccess) {
                    tx.phase = 'CLEANUP_OWNED';
                    await this.#cleanupTransaction(tx, 'prepare-recovery-cleanup');
                    rollback.cleanupWarnings = tx.cleanupWarnings;
                } else {
                    tx.phase = 'RETAIN_EVIDENCE';
                    this.#retainTransactionEvidence(tx);
                }
            } else {
                rollback = { success: false, skipped: true, reason: 'metadata-already-committed' };
            }

            const failureDetails = {
                fromVersion, toVersion: this.appVersion, backup, rollback, metadataAdvanced,
                metadataSnapshot: { existed: metadataSnapshot.existed, digest: metadataSnapshot.digest },
                desiredConfigDigest, desiredJointGate, metadataIntendedDigest,
                metadataWriteTemp: metadataWriteTemp && fs.existsSync(metadataWriteTemp) ? metadataWriteTemp : null,
                transactionBackup: transactionBackup || null, verifiedRollbackSource, originalConfigDigest, report,
                metadataActiveReadError: rollback?.metadata?.metadataActiveReadError
                    || rollback?.closure?.metadata?.metadataActiveReadError
                    || rollback?.jointGate?.metadata?.readError
                    || null,
                transaction: this.#transactionDiagnostic(tx, rollback?.jointGate || desiredJointGate)
            };

            if (rollback?.success === false) {
                throw new FlowError('Runtime config migration failed and exact recovery could not be proven.', {
                    code: 'RUNTIME_CONFIG_RECOVERY_FAILED', subsystem: 'desktop-update', operation: 'RuntimeConfigMigrator',
                    step: 'prepare-recovery', action: 'restore exact pre-migration config and metadata state', retryable: true,
                    details: failureDetails, cause: error
                });
            }

            const wrapped = FlowError.wrap(error, {
                code: 'RUNTIME_CONFIG_MIGRATION_FAILED', subsystem: 'desktop-update', operation: 'RuntimeConfigMigrator', step: 'prepare',
                action: 'merge and migrate runtime config transaction', retryable: true, details: failureDetails
            });
            throw wrapped;
        }
    }

    async #restoreFailedPrepare(runtimeConfig, { rollbackSource, expectedDigest, configExisted, tx = null }) {
        let localTx = false;
        if (!tx) {
            tx = await this.#createTransactionContext('failed-prepare-recovery');
            localTx = true;
        }
        const attempts = tx.ledger.attempts;
        const record = (stage, success, error = null, extra = {}) => this.#recordTx(tx, {
            phase: tx.phase || 'PRIMARY_CONFIG_RECOVERY', stage, success: success === true,
            causeCode: error?.code || null, message: error ? (error?.message || String(error)) : null, ...extra
        });

        if (!configExisted) {
            const result = await this.#restoreConfigPrestate({
                target: runtimeConfig,
                existed: false,
                digest: null,
                recoveryAttempts: attempts,
                tx
            });
            const output = {
                success: result?.success === true,
                restoredToAbsent: result?.success === true,
                activeTargetPresent: fs.existsSync(runtimeConfig),
                activeTargetDigest: null,
                recoveryAttempts: attempts,
                ownedArtifacts: tx.artifacts
            };
            if (localTx && output.success) await this.#cleanupTransaction(tx, 'failed-prepare-absent-success-cleanup');
            return output;
        }

        if (!rollbackSource || !expectedDigest || !fs.existsSync(rollbackSource)) {
            const error = this.#newRecoveryError('Runtime config migration failed but no verified rollback source is available.', {
                code: 'RUNTIME_CONFIG_RECOVERY_FAILED',
                details: {
                    rollbackSource: rollbackSource || null,
                    expectedDigest: expectedDigest || null,
                    activeTargetPresent: fs.existsSync(runtimeConfig),
                    recoveryAttempts: attempts,
                    verifiedSources: tx.verifiedSources,
                    artifacts: tx.artifacts
                }
            });
            if (localTx) this.#retainTransactionEvidence(tx);
            throw error;
        }

        try {
            await this.#verifyTreeDigest(rollbackSource, expectedDigest);
            this.#registerVerifiedSource(tx, {
                path: rollbackSource,
                kind: 'failed-prepare-prestate-source',
                digest: expectedDigest,
                verified: true,
                owned: false,
                howOwnershipWasProven: 'digest-verified-source',
                retentionStatus: 'active'
            });
        } catch (error) {
            const wrapped = this.#newRecoveryError('Failed prepare rollback source did not match the captured pre-migration config.', {
                code: 'RUNTIME_CONFIG_RECOVERY_FAILED', cause: error,
                details: {
                    causeCode: error?.code || null,
                    rollbackSource,
                    expectedDigest,
                    recoveryAttempts: attempts,
                    verifiedSources: tx.verifiedSources,
                    artifacts: tx.artifacts
                }
            });
            if (localTx) this.#retainTransactionEvidence(tx);
            throw wrapped;
        }

        const stageRoots = [];
        let stagedConfig = null;
        let firstStageError = null;
        const createStage = async (prefix, phase, summaryStage) => {
            let root = null;
            try {
                root = await this.#reserveOwnedRoot(tx, 'prepare-recovery-root', prefix);
                stageRoots.push(root);
                const staged = await this.#stageVerifiedTree(tx, {
                    source: rollbackSource,
                    expectedDigest,
                    ownedRoot: root,
                    destinationName: 'config',
                    phase,
                    kind: 'prepare-recovery-stage'
                });
                record(summaryStage, true, staged.callError || null, {
                    operation: 'cp',
                    stageRoot: root,
                    sourcePath: rollbackSource,
                    destinationPath: staged.path,
                    sourceExists: fs.existsSync(rollbackSource),
                    destinationExists: fs.existsSync(staged.path),
                    sourceOwned: false,
                    destinationOwned: fs.existsSync(staged.path),
                    destinationNamespaceOwned: true,
                    expectedDigest,
                    observedDigest: staged.digest,
                    callOutcome: staged.callError ? 'rejected' : 'resolved',
                    sideEffectObserved: fs.existsSync(staged.path),
                    postcondition: staged.callError ? 'copy-threw-postcondition-matched' : 'verified-digest'
                });
                return staged.path;
            } catch (error) {
                record(summaryStage, false, error, {
                    operation: root ? 'cp' : 'mkdtemp',
                    stageRoot: root,
                    sourcePath: rollbackSource,
                    destinationPath: root ? path.join(root, 'config') : null,
                    sourceExists: fs.existsSync(rollbackSource),
                    destinationExists: root ? fs.existsSync(path.join(root, 'config')) : false,
                    sourceOwned: false,
                    destinationOwned: root ? fs.existsSync(path.join(root, 'config')) : false,
                    destinationNamespaceOwned: Boolean(root),
                    expectedDigest,
                    observedDigest: null,
                    callOutcome: 'rejected',
                    sideEffectObserved: root ? fs.existsSync(path.join(root, 'config')) : false,
                    postcondition: root ? 'stage-not-verified' : 'stage-root-not-created'
                });
                throw error;
            }
        };

        try {
            stagedConfig = await createStage('.mcbot-config-restore-', 'initial-verified-stage', 'initial-verified-stage');
        } catch (error) {
            firstStageError = error;
            try {
                stagedConfig = await createStage('.mcbot-config-restore-alt-', 'alternate-verified-stage', 'alternate-verified-stage');
            } catch (alternateError) {
                const wrapped = this.#newRecoveryError('Unable to create a verified staging copy for failed prepare recovery.', {
                    code: 'RUNTIME_CONFIG_RECOVERY_FAILED', cause: alternateError,
                    details: {
                        causeCode: alternateError?.code || firstStageError?.code || null,
                        rollbackSource,
                        expectedDigest,
                        activeTargetPresent: fs.existsSync(runtimeConfig),
                        activeTargetDigest: fs.existsSync(runtimeConfig) ? await this.#treeDigest(runtimeConfig).catch(() => null) : null,
                        stageRoots: stageRoots.filter(root => fs.existsSync(root)),
                        recoveryAttempts: attempts,
                        verifiedSources: tx.verifiedSources,
                        artifacts: tx.artifacts
                    }
                });
                if (localTx) this.#retainTransactionEvidence(tx);
                throw wrapped;
            }
        }

        let displacementRoot = null;
        let displaced = null;
        try {
            displacementRoot = await this.#reserveOwnedRoot(tx, 'failed-prepare-displacement-root', '.mcbot-failed-prepare-displaced-');
            displaced = path.join(displacementRoot, 'config.failed-active');
        } catch (error) {
            record('reserve-failed-prepare-displacement', false, error, {
                operation: 'mkdtemp', destinationPath: null, postcondition: 'displacement-root-not-created'
            });
        }

        let active = await this.#observeConfigTree(runtimeConfig, { existed: true, digest: expectedDigest });
        record('pre-restore-observe', active.matched, active.readError, {
            operation: 'config-observe', destinationPath: runtimeConfig, destinationExists: active.exists,
            expectedDigest, observedDigest: active.digest, callOutcome: active.readError ? 'rejected' : 'resolved',
            postcondition: active.matched ? 'active-digest-matched' : active.state
        });
        if (active.matched) {
            const result = {
                success: true, restoredFrom: rollbackSource, expectedDigest,
                activeTargetPresent: true, activeTargetDigest: expectedDigest,
                stageRoots: stageRoots.filter(root => fs.existsSync(root)),
                ownedArtifacts: tx.artifacts, displaced: null, recoveryAttempts: attempts,
                state: { restoreInstalled: false, restoreVerified: true, activeTargetPresent: true, activeTargetDigest: expectedDigest, recoveryAttempts: attempts }
            };
            if (localTx) await this.#cleanupTransaction(tx, 'failed-prepare-already-matched-cleanup');
            return result;
        }

        if (active.exists && displacementRoot) {
            let renameError = null;
            try { await this.fs.rename(runtimeConfig, displaced); } catch (error) { renameError = error; }
            record('displace-active-call', !renameError, renameError, {
                operation: 'rename-call', sourcePath: runtimeConfig, destinationPath: displaced,
                sourceOwned: false, destinationNamespaceOwned: true,
                callOutcome: renameError ? 'rejected' : 'resolved', postcondition: 'displacement-observation-pending'
            });
            const after = await this.#observeConfigTree(runtimeConfig, { existed: true, digest: expectedDigest });
            const displacedExists = fs.existsSync(displaced);
            const displacedDigest = displacedExists ? await this.#treeDigest(displaced).catch(() => null) : null;
            if (displacedExists) this.#registerArtifact(tx, {
                path: displaced, kind: 'failed-prepare-displaced-active', parentOwnedRoot: displacementRoot,
                namespaceOwned: true, exists: true, createdByOperation: true, ownedByThisOperation: true,
                howOwnershipWasProven: 'child-of-mkdtemp-owned-root-after-rename-observed',
                observedDigest: displacedDigest, verified: true, cleanupPolicy: 'parent', retentionStatus: 'active'
            });
            const sideEffectObserved = !after.exists && displacedExists;
            record('displace-active', sideEffectObserved || after.matched, renameError || after.readError, {
                operation: 'rename', sourcePath: runtimeConfig, destinationPath: displaced,
                sourceOwned: false, destinationOwned: displacedExists, destinationNamespaceOwned: true,
                sourceExists: after.exists, destinationExists: displacedExists,
                expectedDigest, observedDigest: after.digest, displacedDigest,
                callOutcome: renameError ? 'rejected' : 'resolved', sideEffectObserved,
                postcondition: after.matched ? 'active-digest-matched'
                    : (sideEffectObserved ? 'active-absent-displaced-present' : (after.readError ? 'active-digest-unreadable' : 'active-still-present'))
            });
            active = after;
        }

        if (!active.exists) {
            let installError = null;
            try { await this.fs.rename(stagedConfig, runtimeConfig); } catch (error) { installError = error; }
            record('install-verified-restore-call', !installError, installError, {
                operation: 'rename-call', sourcePath: stagedConfig, destinationPath: runtimeConfig,
                sourceOwned: true, callOutcome: installError ? 'rejected' : 'resolved',
                postcondition: 'install-observation-pending'
            });
            active = await this.#observeConfigTree(runtimeConfig, { existed: true, digest: expectedDigest });
            record('install-verified-restore', active.matched, installError || active.readError, {
                operation: 'rename', sourcePath: stagedConfig, destinationPath: runtimeConfig,
                sourceOwned: true, expectedDigest, observedDigest: active.digest,
                callOutcome: installError ? 'rejected' : 'resolved', sideEffectObserved: active.matched,
                postcondition: active.matched
                    ? (installError ? 'rename-threw-postcondition-matched' : 'verified-digest')
                    : (active.readError ? 'active-digest-unreadable' : 'active-not-verified')
            });
        }

        if (!active.matched) {
            const sources = [stagedConfig, rollbackSource, displaced].filter(Boolean);
            try {
                const recovery = await this.#recoverActiveConfigToDigest({
                    target: runtimeConfig,
                    expectedDigest,
                    sources,
                    prefix: 'prepare-fallback-recovery',
                    recoveryAttempts: attempts,
                    tx
                });
                active = await this.#observeConfigTree(runtimeConfig, { existed: true, digest: expectedDigest });
                record('prepare-fallback-recovery', recovery?.success === true && active.matched, active.readError, {
                    operation: 'recovery-postcondition', sourcePath: recovery?.verifiedRecoverySource || rollbackSource,
                    destinationPath: runtimeConfig, expectedDigest, observedDigest: active.digest,
                    callOutcome: active.readError ? 'rejected' : 'resolved',
                    postcondition: active.matched ? 'verified-digest' : active.state
                });
            } catch (fallbackError) {
                active = await this.#observeConfigTree(runtimeConfig, { existed: true, digest: expectedDigest });
                record('prepare-fallback-recovery', active.matched, fallbackError || active.readError, {
                    operation: 'recovery-postcondition', sourcePath: fallbackError?.verifiedRecoverySource || rollbackSource,
                    destinationPath: runtimeConfig, expectedDigest, observedDigest: active.digest,
                    stageRoot: fallbackError?.recoveryRoot || null,
                    callOutcome: 'rejected', postcondition: active.matched ? 'verified-digest' : 'fallback-recovery-not-verified'
                });
            }
        }

        active = await this.#observeConfigTree(runtimeConfig, { existed: true, digest: expectedDigest });
        if (!active.matched) {
            const error = this.#newRecoveryError('Failed prepare recovery could not restore the verified pre-migration config.', {
                code: 'RUNTIME_CONFIG_RECOVERY_FAILED',
                details: {
                    rollbackSource, expectedDigest, displaced: displaced && fs.existsSync(displaced) ? displaced : null,
                    activeTargetPresent: active.exists, activeTargetDigest: active.digest,
                    activeReadError: active.readError || null,
                    stageRoots: stageRoots.filter(root => fs.existsSync(root)),
                    recoveryAttempts: attempts,
                    verifiedSources: tx.verifiedSources,
                    artifacts: tx.artifacts
                }
            });
            if (localTx) this.#retainTransactionEvidence(tx);
            throw error;
        }

        const result = {
            success: true,
            restoredFrom: rollbackSource,
            expectedDigest,
            activeTargetPresent: true,
            activeTargetDigest: active.digest,
            stageRoots: stageRoots.filter(root => fs.existsSync(root)),
            ownedArtifacts: tx.artifacts,
            displaced: displaced && fs.existsSync(displaced) ? displaced : null,
            recoveryAttempts: attempts,
            state: {
                restoreInstalled: true,
                restoreVerified: true,
                activeTargetPresent: true,
                activeTargetDigest: active.digest,
                recoveryAttempts: attempts
            }
        };
        if (localTx) await this.#cleanupTransaction(tx, 'failed-prepare-success-cleanup');
        return result;
    }

    async rollbackLastConfig() {
        const metadataSnapshot = await this.#captureMetadataSnapshot();
        const metadata = metadataSnapshot.parsed;
        const backup = metadata?.lastBackup;
        if (!backup || !fs.existsSync(backup)) throw new Error('Không có bản sao cấu hình migration để khôi phục.');

        const runtimeConfig = path.join(this.runtimeRoot, 'config');
        const backupDigest = metadata?.lastBackupDigest || await this.#treeDigest(backup);
        await this.#verifyTreeDigest(backup, backupDigest);

        const stamp = `${process.pid}-${Date.now()}`;
        const currentExisted = fs.existsSync(runtimeConfig);
        const currentDigest = currentExisted ? await this.#treeDigest(runtimeConfig) : null;
        const tx = await this.#createTransactionContext('explicit-rollback');
        tx.expected.pre.config = { existed: currentExisted, digest: currentDigest };
        tx.expected.pre.metadata = { existed: metadataSnapshot.existed, digest: metadataSnapshot.digest };
        this.#registerVerifiedSource(tx, {
            path: backup, kind: 'rollback-target-backup', digest: backupDigest, verified: true, owned: false,
            howOwnershipWasProven: 'durable-backup-digest-verified', retentionStatus: 'active'
        });

        const stageRoot = await this.#reserveOwnedRoot(tx, 'explicit-rollback-stage-root', '.mcbot-explicit-rollback-');
        let stagedRestore = path.join(stageRoot, 'config');
        const rollbackBackup = `${runtimeConfig}.before-rollback-${stamp}`;
        let displacementRoot = null;
        let displacedCurrent = null;
        const state = {
            activeDisplaced: false,
            restoreInstalled: false,
            restoreVerified: false,
            metadataCommitted: false,
            metadataRestored: null,
            activeTargetPresent: currentExisted,
            activeTargetDigest: currentDigest,
            recoveryAttempts: tx.ledger.attempts
        };
        let metadataWriteEvidence = null;
        let desiredJointGate = null;

        const record = (stage, success, error = null, extra = {}) => this.#recordTx(tx, {
            phase: tx.phase || null, stage, success: success === true, causeCode: error?.code || null,
            message: error ? (error?.message || String(error)) : null, ...extra
        });

        try {
            tx.phase = 'MUTATE_CONFIG';
            const staged = await this.#stageVerifiedTree(tx, {
                source: backup,
                expectedDigest: backupDigest,
                ownedRoot: stageRoot,
                destinationName: 'config',
                phase: 'explicit-rollback-initial-stage',
                kind: 'explicit-rollback-config-stage'
            });
            stagedRestore = staged.path;

            if (currentExisted) {
                const safetyExistedBefore = fs.existsSync(rollbackBackup);
                record('observe-rollback-safety-copy-precondition', !safetyExistedBefore, null, {
                    operation: 'config-observe', destinationPath: rollbackBackup,
                    destinationExists: safetyExistedBefore, destinationOwned: false,
                    callOutcome: 'resolved', postcondition: safetyExistedBefore ? 'destination-preexisting' : 'destination-absent'
                });
                let copyError = null;
                if (!safetyExistedBefore) {
                    try {
                        await this.fs.cp(runtimeConfig, rollbackBackup, { recursive: true, force: false, errorOnExist: true });
                    } catch (error) { copyError = error; }
                } else {
                    copyError = Object.assign(new Error('Rollback safety-copy destination already exists.'), { code: 'EEXIST' });
                }
                record('create-rollback-safety-copy-call', !copyError, copyError, {
                    operation: 'cp-call', sourcePath: runtimeConfig, destinationPath: rollbackBackup,
                    destinationExistedBefore: safetyExistedBefore,
                    callOutcome: copyError ? 'rejected' : 'resolved',
                    postcondition: safetyExistedBefore ? 'copy-not-called-preexisting-destination' : 'safety-copy-observation-pending'
                });
                const safetyExists = fs.existsSync(rollbackBackup);
                const safetyDigest = safetyExists ? await this.#treeDigest(rollbackBackup).catch(() => null) : null;
                const safetyMatched = safetyExists && safetyDigest === currentDigest;
                const safetyOwnershipProven = !safetyExistedBefore && !copyError && safetyMatched;
                record('create-rollback-safety-copy', safetyMatched, copyError, {
                    operation: 'cp', sourcePath: runtimeConfig, destinationPath: rollbackBackup,
                    destinationExistedBefore: safetyExistedBefore,
                    destinationExists: safetyExists, destinationOwned: safetyOwnershipProven, destinationMovable: false,
                    expectedDigest: currentDigest, observedDigest: safetyDigest,
                    callOutcome: copyError ? 'rejected' : 'resolved',
                    sideEffectObserved: !safetyExistedBefore && safetyExists,
                    postcondition: safetyMatched ? (copyError ? 'copy-threw-postcondition-matched' : 'verified-digest')
                        : (safetyExists ? 'safety-copy-digest-mismatch' : 'safety-copy-not-created')
                });
                if (!safetyMatched) throw copyError || new Error('Rollback safety copy could not be verified.');
                if (!safetyOwnershipProven) {
                    this.#recordUnownedCollision(tx, {
                        path: rollbackBackup,
                        kind: 'rollback-safety-copy',
                        digest: safetyDigest,
                        reason: safetyExistedBefore
                            ? 'safety-copy-destination-preexisting'
                            : 'safety-copy-exact-after-rejected-copy-ownership-not-proven'
                    });
                }
                this.#registerArtifact(tx, {
                    path: rollbackBackup, kind: 'rollback-safety-copy', namespaceOwned: false, exists: true,
                    createdByOperation: safetyOwnershipProven, ownedByThisOperation: safetyOwnershipProven, movable: false,
                    howOwnershipWasProven: safetyOwnershipProven ? 'no-clobber-copy-resolved-from-observed-absent-destination' : null,
                    expectedDigest: currentDigest, observedDigest: safetyDigest, verified: true, cleanupPolicy: 'retain', retentionStatus: 'active'
                });
                this.#registerVerifiedSource(tx, {
                    path: rollbackBackup, kind: 'config-prestate', digest: currentDigest, verified: true,
                    owned: safetyOwnershipProven, movable: false,
                    howOwnershipWasProven: safetyOwnershipProven ? 'no-clobber-copy-resolved-from-observed-absent-destination' : null,
                    retentionStatus: 'active'
                });

                displacementRoot = await this.#reserveOwnedRoot(tx, 'explicit-rollback-displacement-root', '.mcbot-rollback-current-');
                displacedCurrent = path.join(displacementRoot, 'config.rollback-current-active');
                let displaceError = null;
                try { await this.fs.rename(runtimeConfig, displacedCurrent); } catch (error) { displaceError = error; }
                record('displace-current-call', !displaceError, displaceError, {
                    operation: 'rename-call', sourcePath: runtimeConfig, destinationPath: displacedCurrent,
                    sourceOwned: false, destinationNamespaceOwned: true,
                    callOutcome: displaceError ? 'rejected' : 'resolved', postcondition: 'displacement-observation-pending'
                });
                const activeAfterDisplace = await this.#observeConfigTree(runtimeConfig, { existed: false, digest: null });
                const displacedExists = fs.existsSync(displacedCurrent);
                const displacedDigest = displacedExists ? await this.#treeDigest(displacedCurrent).catch(() => null) : null;
                const sideEffectMatched = activeAfterDisplace.matched && displacedExists && displacedDigest === currentDigest;
                state.activeDisplaced = sideEffectMatched;
                state.activeTargetPresent = !activeAfterDisplace.matched;
                state.activeTargetDigest = activeAfterDisplace.digest;
                if (displacedExists) {
                    this.#registerArtifact(tx, {
                        path: displacedCurrent, kind: 'displaced-current-config', parentOwnedRoot: displacementRoot,
                        namespaceOwned: true, exists: true, createdByOperation: true, ownedByThisOperation: true,
                        movable: true,
                        howOwnershipWasProven: 'child-of-mkdtemp-owned-root', expectedDigest: currentDigest,
                        observedDigest: displacedDigest, verified: displacedDigest === currentDigest, cleanupPolicy: 'parent', retentionStatus: 'active'
                    });
                    if (displacedDigest === currentDigest) this.#registerVerifiedSource(tx, {
                        path: displacedCurrent, kind: 'config-prestate', digest: currentDigest, verified: true, owned: true,
                        movable: true,
                        howOwnershipWasProven: 'owned-displacement-postcondition-verified', retentionStatus: 'active'
                    });
                }
                record('displace-current', sideEffectMatched, displaceError, {
                    operation: 'rename', sourcePath: runtimeConfig, destinationPath: displacedCurrent,
                    sourceOwned: false, destinationOwned: displacedExists, destinationNamespaceOwned: true,
                    sourceExists: fs.existsSync(runtimeConfig), destinationExists: displacedExists,
                    expectedDigest: currentDigest, observedDigest: displacedDigest, sideEffectObserved: sideEffectMatched,
                    callOutcome: displaceError ? 'rejected' : 'resolved',
                    postcondition: sideEffectMatched
                        ? (displaceError ? 'rename-threw-postcondition-matched' : 'active-absent-displaced-current-digest')
                        : 'rename-postcondition-not-matched'
                });
                if (!sideEffectMatched) throw displaceError || new Error('Explicit rollback current config displacement could not be verified.');
                if (displaceError) throw displaceError;
            }

            let installError = null;
            try { await this.fs.rename(stagedRestore, runtimeConfig); } catch (error) { installError = error; }
            record('install-rollback-backup-call', !installError, installError, {
                operation: 'rename-call', sourcePath: stagedRestore, destinationPath: runtimeConfig,
                sourceOwned: true, callOutcome: installError ? 'rejected' : 'resolved', postcondition: 'install-observation-pending'
            });
            const activeInstalled = await this.#observeConfigTree(runtimeConfig, { existed: true, digest: backupDigest });
            state.restoreInstalled = activeInstalled.matched;
            state.restoreVerified = activeInstalled.matched;
            state.activeTargetPresent = activeInstalled.exists;
            state.activeTargetDigest = activeInstalled.digest;
            record('install-rollback-backup', activeInstalled.matched, installError || activeInstalled.readError, {
                operation: 'rename', sourcePath: stagedRestore, destinationPath: runtimeConfig,
                expectedDigest: backupDigest, observedDigest: activeInstalled.digest,
                callOutcome: installError ? 'rejected' : 'resolved', sideEffectObserved: activeInstalled.matched,
                postcondition: activeInstalled.matched
                    ? (installError ? 'rename-threw-postcondition-matched' : 'verified-backup-digest')
                    : (activeInstalled.readError ? 'active-digest-unreadable' : 'rollback-backup-not-installed')
            });
            if (!activeInstalled.matched) throw installError || new Error('Explicit rollback target install could not be verified.');
            if (installError) throw installError;

            const nextMetadata = {
                ...metadata,
                rolledBackAt: new Date().toISOString(),
                rollbackSafetyCopy: currentExisted ? rollbackBackup : null
            };
            const serializedMetadata = this.#serializeMetadata(nextMetadata);
            const desiredMetadataDigest = this.#bufferDigest(serializedMetadata);
            tx.expected.desired.config = { existed: true, digest: backupDigest };
            tx.expected.desired.metadata = { existed: true, digest: desiredMetadataDigest };

            tx.phase = 'INSTALL_METADATA_CANDIDATE';
            try {
                metadataWriteEvidence = await this.#writeMetadata(nextMetadata, {
                    tempTag: `rollback-${stamp}`,
                    serializedBytes: serializedMetadata,
                    expectedDigest: desiredMetadataDigest,
                    tx
                });
            } catch (writeError) {
                metadataWriteEvidence = writeError?.metadataWrite || null;
                if (metadataWriteEvidence?.activeOwnership) tx.state.metadataActiveOwnership = metadataWriteEvidence.activeOwnership;
                throw writeError;
            }
            tx.state.metadataCandidateInstalled = true;
            tx.state.metadataActiveOwnership = metadataWriteEvidence?.activeOwnership || null;

            tx.phase = 'DESIRED_JOINT_GATE';
            desiredJointGate = await this.#verifyJointState(tx, {
                runtimeConfig,
                expectedConfig: tx.expected.desired.config,
                expectedMetadata: tx.expected.desired.metadata,
                phase: 'rollback-desired-joint-gate'
            });
            if (desiredJointGate?.success !== true) {
                throw new FlowError('Runtime config rollback desired config/metadata joint commit could not be proven.', {
                    code: 'RUNTIME_CONFIG_JOINT_COMMIT_FAILED', subsystem: 'desktop-update', operation: 'RuntimeConfigMigrator',
                    step: 'rollback-desired-joint-gate', action: 'verify desired rollback config and metadata joint state', retryable: true,
                    details: { desiredJointGate }
                });
            }

            state.metadataCommitted = true;
            tx.state.desiredJointVerified = true;
            tx.state.committed = true;
            tx.phase = 'COMMIT';
            await this.#cleanupTransaction(tx, 'rollback-success-cleanup');
            return {
                restoredFrom: backup,
                safetyCopy: currentExisted ? rollbackBackup : null,
                cleanupWarnings: tx.cleanupWarnings,
                desiredJointGate
            };
        } catch (operationError) {
            const recoveryErrors = [];
            let configRecoveryResult = null;
            let metadataRecoveryResult = null;

            if (!state.metadataCommitted) {
                tx.phase = 'PRIMARY_CONFIG_RECOVERY';
                try {
                    if (currentExisted) {
                        configRecoveryResult = await this.#recoverActiveConfigToDigest({
                            target: runtimeConfig,
                            expectedDigest: currentDigest,
                            sources: [displacedCurrent, rollbackBackup].filter(Boolean),
                            prefix: 'explicit-rollback-recovery',
                            recoveryAttempts: tx.ledger.attempts,
                            tx
                        });
                        state.activeTargetPresent = fs.existsSync(runtimeConfig);
                        state.activeTargetDigest = state.activeTargetPresent ? await this.#treeDigest(runtimeConfig).catch(() => null) : null;
                    } else {
                        configRecoveryResult = await this.#restoreConfigPrestate({
                            target: runtimeConfig, existed: false, digest: null, sources: [],
                            prefix: 'explicit-rollback-primary', attempts: tx.ledger.attempts, tx
                        });
                        state.activeTargetPresent = fs.existsSync(runtimeConfig);
                        state.activeTargetDigest = state.activeTargetPresent ? await this.#treeDigest(runtimeConfig).catch(() => null) : null;
                    }
                } catch (configRecoveryError) {
                    recoveryErrors.push(this.#errorDiagnosticObject(configRecoveryError, { stage: 'config-recovery' }));
                    state.activeTargetPresent = fs.existsSync(runtimeConfig);
                    state.activeTargetDigest = state.activeTargetPresent ? await this.#treeDigest(runtimeConfig).catch(() => null) : null;
                }

                tx.phase = 'PRIMARY_METADATA_RECOVERY';
                try {
                    metadataRecoveryResult = await this.#restoreMetadataSnapshot(metadataSnapshot, `rollback-${stamp}`, {
                        tx,
                        activeOwnership: this.#metadataOwnershipEvidence(tx, metadataWriteEvidence)
                    });
                    state.metadataRestored = metadataRecoveryResult.success === true;
                } catch (metadataRestoreError) {
                    state.metadataRestored = false;
                    recoveryErrors.push(this.#metadataRecoveryFailureDiagnostic(metadataRestoreError, metadataSnapshot, {
                        code: 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED'
                    }));
                }
            }

            tx.phase = 'PRESTATE_JOINT_GATE_1';
            let jointGate = !state.metadataCommitted
                ? await this.#verifyJointState(tx, {
                    runtimeConfig,
                    expectedConfig: { existed: currentExisted, digest: currentDigest },
                    expectedMetadata: { existed: metadataSnapshot.existed, digest: metadataSnapshot.digest },
                    phase: 'rollback-joint-verify-1'
                })
                : { success: false, skipped: true, attempts: tx.ledger.attempts };

            let closureConfig = null;
            let closureMetadata = null;
            const usableConfigEvidence = !currentExisted || [displacedCurrent, rollbackBackup]
                .some(source => source && fs.existsSync(source));
            const usableMetadataEvidence = metadataSnapshot.existed ? Boolean(metadataSnapshot.bytes && metadataSnapshot.digest) : true;
            if (!state.metadataCommitted && jointGate?.success !== true && usableConfigEvidence && usableMetadataEvidence) {
                tx.closureRepairCount = 1;
                tx.phase = 'CLOSURE_REPAIR_ONCE';
                try {
                    closureConfig = await this.#restoreConfigPrestate({
                        target: runtimeConfig, existed: currentExisted, digest: currentDigest,
                        sources: [displacedCurrent, rollbackBackup].filter(Boolean),
                        prefix: 'explicit-rollback-joint-closure', attempts: tx.ledger.attempts, tx
                    });
                } catch (closureError) {
                    recoveryErrors.push(this.#errorDiagnosticObject(closureError, { stage: 'joint-closure-config' }));
                }
                try {
                    closureMetadata = await this.#restoreMetadataSnapshot(metadataSnapshot, `rollback-closure-${stamp}`, {
                        tx,
                        activeOwnership: this.#metadataOwnershipEvidence(tx, metadataWriteEvidence)
                    });
                } catch (closureMetadataError) {
                    recoveryErrors.push(this.#metadataRecoveryFailureDiagnostic(closureMetadataError, metadataSnapshot, {
                        code: 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED'
                    }));
                }
                tx.phase = 'PRESTATE_JOINT_GATE_2';
                jointGate = await this.#verifyJointState(tx, {
                    runtimeConfig,
                    expectedConfig: { existed: currentExisted, digest: currentDigest },
                    expectedMetadata: { existed: metadataSnapshot.existed, digest: metadataSnapshot.digest },
                    phase: 'rollback-joint-verify-2'
                });
            }

            const finalSuccess = !state.metadataCommitted && jointGate?.success === true;
            state.metadataRestored = jointGate?.metadata?.matched === true;
            tx.state.prestateJointVerified = finalSuccess;
            if (finalSuccess) {
                tx.phase = 'CLEANUP_OWNED';
                await this.#cleanupTransaction(tx, 'rollback-recovery-cleanup');
                operationError.recovery = {
                    success: true,
                    config: configRecoveryResult || closureConfig || {
                        success: true, activeDigest: jointGate.config?.digest ?? null, recoveryAttempts: tx.ledger.attempts
                    },
                    metadata: metadataRecoveryResult || closureMetadata || {
                        success: true, recoveryAttempts: tx.ledger.attempts
                    },
                    jointGate,
                    closureRepairCount: tx.closureRepairCount,
                    ...this.#transactionDiagnostic(tx, jointGate)
                };
                throw operationError;
            }

            tx.phase = 'RETAIN_EVIDENCE';
            this.#retainTransactionEvidence(tx);
            const metadataFailure = recoveryErrors.find(item => item?.metadataExpectedDigest !== undefined) || null;
            throw this.#newRecoveryError('Runtime config rollback failed and exact pre-operation recovery could not be proven.', {
                code: 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED',
                cause: operationError,
                details: {
                    causeCode: metadataFailure?.causeCode || operationError?.code || null,
                    jointGate,
                    desiredJointGate,
                    closureRepairCount: tx.closureRepairCount,
                    state,
                    currentDigest,
                    backupDigest,
                    configCurrentDigest: fs.existsSync(runtimeConfig) ? await this.#treeDigest(runtimeConfig).catch(() => null) : null,
                    metadataExisted: metadataSnapshot.existed,
                    metadataExpectedDigest: metadataSnapshot.digest,
                    metadataCurrentDigest: await this.#metadataCurrentDigest().catch(() => null),
                    metadataRecoveryTemp: metadataFailure?.metadataRecoveryTemp || null,
                    metadataRecoverySourcePath: metadataFailure?.metadataRecoverySourcePath || null,
                    metadataRecoverySourceVerified: metadataFailure?.metadataRecoverySourceVerified === true,
                    metadataRecoverySourceDigest: metadataFailure?.metadataRecoverySourceDigest || null,
                    metadataActiveExists: metadataFailure?.metadataActiveExists ?? null,
                    metadataActiveReadError: metadataFailure?.metadataActiveReadError || jointGate?.metadata?.readError || null,
                    metadataRecoveryAttempts: tx.ledger.attempts,
                    rollbackBackup: fs.existsSync(rollbackBackup) ? rollbackBackup : null,
                    displacedCurrent: displacedCurrent && fs.existsSync(displacedCurrent) ? displacedCurrent : null,
                    stageRoot: fs.existsSync(stageRoot) ? stageRoot : null,
                    recoveryAttempts: tx.ledger.attempts,
                    recoveryErrors: recoveryErrors.map(item => item?.message || item?.details?.message || String(item)),
                    recoveryDiagnostics: recoveryErrors,
                    ...this.#transactionDiagnostic(tx, jointGate)
                }
            });
        }
    }

    async #recoverActiveConfigToDigest({ target, expectedDigest, sources, prefix, recoveryAttempts, tx = null }) {
        let localTx = false;
        if (!tx) {
            tx = await this.#createTransactionContext('config-prestate-recovery');
            localTx = true;
        }
        const attempts = tx.ledger.attempts;
        const record = (stage, success, error = null, extra = {}) => this.#recordTx(tx, {
            phase: tx.phase || prefix, stage, success: success === true,
            causeCode: error?.code || null, message: error ? (error?.message || String(error)) : null, ...extra
        });
        const observeTarget = async () => this.#observeConfigTree(target, { existed: true, digest: expectedDigest });

        let active = await observeTarget();
        record('prestate-postcondition', active.matched, active.readError, {
            operation: 'config-observe', destinationPath: target, destinationExists: active.exists,
            observedDigest: active.digest, expectedDigest, callOutcome: active.readError ? 'rejected' : 'resolved',
            postcondition: active.matched ? 'active-digest-matched' : active.state
        });
        if (active.matched) {
            const result = { success: true, activeDigest: active.digest, recoveryAttempts: attempts, ownedArtifacts: [] };
            if (localTx) await this.#cleanupTransaction(tx, `${prefix}-already-matched-cleanup`);
            return result;
        }

        let verifiedSource = null;
        const verifiedSources = [];
        for (const source of this.recoveryCoordinator.candidates(sources)) {
            if (!source || !fs.existsSync(source)) continue;
            try {
                await this.#verifyTreeDigest(source, expectedDigest);
                verifiedSources.push(source);
                if (!verifiedSource) verifiedSource = source;
                record('verify-recovery-source', true, null, {
                    operation: 'tree-digest', sourcePath: source, expectedDigest, observedDigest: expectedDigest,
                    callOutcome: 'resolved', postcondition: 'source-digest-matched'
                });
                const artifact = tx.artifacts.find(item => path.resolve(item.path) === path.resolve(source));
                this.#registerVerifiedSource(tx, {
                    path: source, kind: 'config-prestate', digest: expectedDigest, verified: true,
                    owned: artifact?.ownedByThisOperation === true,
                    movable: artifact?.movable === true,
                    howOwnershipWasProven: artifact?.howOwnershipWasProven || 'digest-verified-source', retentionStatus: 'active'
                });
            } catch (error) {
                record('verify-recovery-source', false, error, {
                    operation: 'tree-digest', sourcePath: source, expectedDigest, callOutcome: 'rejected',
                    postcondition: 'source-digest-mismatch'
                });
            }
        }
        if (!verifiedSource) {
            const error = this.#newRecoveryError('No verified config source is available for pre-state recovery.', {
                code: 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED',
                details: { expectedDigest, activeTargetPresent: active.exists, activeTargetDigest: active.digest, recoveryAttempts: attempts }
            });
            if (localTx) this.#retainTransactionEvidence(tx);
            throw error;
        }

        if (!active.exists) {
            const displacedSource = verifiedSources.find(source => {
                const artifact = tx.artifacts.find(item => path.resolve(item.path) === path.resolve(source));
                return artifact?.kind === 'displaced-current-config'
                    && artifact.ownedByThisOperation === true
                    && artifact.movable === true
                    && artifact.verified === true
                    && artifact.retentionStatus === 'active';
            });
            if (displacedSource) {
                const displacedArtifact = tx.artifacts.find(item => path.resolve(item.path) === path.resolve(displacedSource));
                let directError = null;
                try { await this.fs.rename(displacedSource, target); } catch (error) { directError = error; }
                record('direct-displaced-prestate-call', !directError, directError, {
                    operation: 'rename-call', sourcePath: displacedSource, destinationPath: target,
                    sourceOwned: true, sourceMovable: true, sourceKind: displacedArtifact?.kind || null,
                    ownershipEvidence: displacedArtifact?.howOwnershipWasProven || null,
                    callOutcome: directError ? 'rejected' : 'resolved', postcondition: 'direct-restore-observation-pending'
                });
                const after = await observeTarget();
                const sourceExists = fs.existsSync(displacedSource);
                record('direct-displaced-prestate', after.matched, directError || after.readError, {
                    operation: 'rename', sourcePath: displacedSource, destinationPath: target,
                    sourceOwned: true, sourceMovable: true, sourceKind: displacedArtifact?.kind || null,
                    sourceExists,
                    expectedDigest, observedDigest: after.digest, callOutcome: directError ? 'rejected' : 'resolved',
                    sideEffectObserved: after.matched, postcondition: after.matched
                        ? (directError ? 'rename-threw-postcondition-matched' : 'verified-digest')
                        : (after.readError ? 'active-digest-unreadable' : 'direct-restore-not-verified')
                });
                if (after.matched) {
                    if (displacedArtifact && !sourceExists) displacedArtifact.retentionStatus = 'consumed';
                    for (const source of tx.verifiedSources) {
                        if (path.resolve(source.path) === path.resolve(displacedSource) && !sourceExists) source.retentionStatus = 'consumed';
                    }
                    const result = { success: true, activeDigest: after.digest, recoveryAttempts: attempts, ownedArtifacts: [] };
                    if (localTx) await this.#cleanupTransaction(tx, `${prefix}-direct-success-cleanup`);
                    return result;
                }
                verifiedSource = verifiedSources.find(source => source !== displacedSource && fs.existsSync(source)) || displacedSource;
                active = after;
            }
        }

        let root = null;
        try {
            root = await this.#reserveOwnedRoot(tx, 'config-recovery-root', `.mcbot-${prefix}-`);
        } catch (error) {
            throw this.#newRecoveryError('Unable to create config recovery staging root.', {
                code: 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED', cause: error,
                details: {
                    causeCode: error?.code || null, expectedDigest, rollbackSource: verifiedSource,
                    activeTargetPresent: active.exists, activeTargetDigest: active.digest,
                    recoveryAttempts: attempts,
                    verifiedSources: tx.verifiedSources,
                    artifacts: tx.artifacts
                }
            });
        }

        let staged = null;
        const quarantinePaths = [];
        try {
            const stageResult = await this.#stageVerifiedTree(tx, {
                source: verifiedSource,
                expectedDigest,
                ownedRoot: root,
                destinationName: 'config',
                phase: 'stage-prestate-recovery',
                kind: 'config-recovery-stage'
            });
            staged = stageResult.path;

            active = await observeTarget();
            if (active.matched) {
                const result = {
                    success: true, activeDigest: active.digest, recoveryAttempts: attempts,
                    ownedArtifacts: tx.artifacts.filter(item => item.path === root || item.path.startsWith(`${root}${path.sep}`))
                };
                if (localTx) await this.#cleanupTransaction(tx, `${prefix}-matched-success-cleanup`);
                return result;
            }

            if (active.exists && !active.matched) {
                let displaced = false;
                for (let index = 0; index < 2 && !displaced; index += 1) {
                    const quarantine = path.join(root, `.recovery-displaced-${index + 1}`);
                    quarantinePaths.push(quarantine);
                    let renameError = null;
                    try { await this.fs.rename(target, quarantine); } catch (error) { renameError = error; }
                    record(index === 0 ? 'displace-nonprestate-active-call' : 'displace-nonprestate-active-alternate-call', !renameError, renameError, {
                        operation: 'rename-call', sourcePath: target, destinationPath: quarantine,
                        destinationNamespaceOwned: true, callOutcome: renameError ? 'rejected' : 'resolved',
                        postcondition: 'displacement-observation-pending'
                    });
                    const after = await observeTarget();
                    const quarantineExists = fs.existsSync(quarantine);
                    const quarantineDigest = quarantineExists ? await this.#treeDigest(quarantine).catch(() => null) : null;
                    if (quarantineExists) this.#registerArtifact(tx, {
                        path: quarantine, kind: 'config-recovery-quarantine', parentOwnedRoot: root, namespaceOwned: true,
                        exists: true, createdByOperation: true, ownedByThisOperation: true,
                        howOwnershipWasProven: 'child-of-mkdtemp-owned-root', observedDigest: quarantineDigest,
                        verified: true, cleanupPolicy: 'parent', retentionStatus: 'active'
                    });
                    const sideEffectObserved = !after.exists && quarantineExists;
                    const alreadyRecovered = after.matched;
                    record(index === 0 ? 'displace-nonprestate-active' : 'displace-nonprestate-active-alternate',
                        sideEffectObserved || alreadyRecovered, renameError || after.readError, {
                            operation: 'rename', sourcePath: target, destinationPath: quarantine,
                            sourceOwned: false, destinationOwned: quarantineExists, destinationNamespaceOwned: true,
                            sourceExists: after.exists, destinationExists: quarantineExists,
                            expectedDigest, observedDigest: after.digest, quarantinedDigest: quarantineDigest,
                            callOutcome: renameError ? 'rejected' : 'resolved', sideEffectObserved,
                            postcondition: alreadyRecovered ? 'active-digest-matched'
                                : (sideEffectObserved ? 'active-absent-quarantine-present' : (after.readError ? 'active-digest-unreadable' : 'active-still-mismatched'))
                        });
                    if (alreadyRecovered) {
                        const result = {
                            success: true, activeDigest: after.digest, recoveryAttempts: attempts,
                            ownedArtifacts: tx.artifacts.filter(item => item.path === root || item.path.startsWith(`${root}${path.sep}`))
                        };
                        if (localTx) await this.#cleanupTransaction(tx, `${prefix}-already-recovered-cleanup`);
                        return result;
                    }
                    if (sideEffectObserved) { displaced = true; active = after; break; }
                    active = after;
                }
                active = await observeTarget();
                if (active.exists && !active.matched) {
                    const cause = new Error('Active config could not be safely displaced for verified recovery.');
                    cause.code = 'RUNTIME_CONFIG_ACTIVE_DISPLACEMENT_FAILED';
                    throw this.#newRecoveryError('Verified pre-state source is available but the mutated active config could not be safely quarantined.', {
                        code: 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED', cause,
                        details: {
                            causeCode: cause.code, expectedDigest, rollbackSource: verifiedSource,
                            activeTargetPresent: true, activeTargetDigest: active.digest,
                            quarantinePaths: quarantinePaths.filter(item => fs.existsSync(item)), recoveryAttempts: attempts
                        }
                    });
                }
            }

            active = await observeTarget();
            if (active.matched) {
                const result = {
                    success: true, activeDigest: active.digest, recoveryAttempts: attempts,
                    ownedArtifacts: tx.artifacts.filter(item => item.path === root || item.path.startsWith(`${root}${path.sep}`))
                };
                if (localTx) await this.#cleanupTransaction(tx, `${prefix}-post-displace-success-cleanup`);
                return result;
            }
            if (active.exists) {
                throw this.#newRecoveryError('Config recovery cannot install while an unverified active target remains.', {
                    code: 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED',
                    details: {
                        expectedDigest, rollbackSource: verifiedSource, activeTargetPresent: true, activeTargetDigest: active.digest,
                        quarantinePaths: quarantinePaths.filter(item => fs.existsSync(item)), recoveryAttempts: attempts
                    }
                });
            }

            let installError = null;
            try { await this.fs.rename(staged, target); } catch (error) { installError = error; }
            record('install-prestate-recovery-call', !installError, installError, {
                operation: 'rename-call', sourcePath: staged, destinationPath: target, sourceOwned: true,
                callOutcome: installError ? 'rejected' : 'resolved', postcondition: 'install-observation-pending'
            });
            active = await observeTarget();
            record('install-prestate-recovery', active.matched, installError || active.readError, {
                operation: 'rename', sourcePath: staged, destinationPath: target,
                expectedDigest, observedDigest: active.digest, callOutcome: installError ? 'rejected' : 'resolved',
                sideEffectObserved: active.matched, postcondition: active.matched
                    ? (installError ? 'rename-threw-postcondition-matched' : 'active-digest-matched')
                    : (active.readError ? 'active-digest-unreadable' : 'active-digest-not-matched')
            });
            if (!active.matched) throw installError || new Error('Config recovery install resolved without the expected active digest.');

            const result = {
                success: true,
                activeDigest: active.digest,
                recoveryAttempts: attempts,
                quarantined: quarantinePaths.filter(item => fs.existsSync(item)),
                ownedArtifacts: tx.artifacts.filter(item => item.path === root || item.path.startsWith(`${root}${path.sep}`))
            };
            if (localTx) await this.#cleanupTransaction(tx, `${prefix}-success-cleanup`);
            return result;
        } catch (error) {
            error.recoveryRoot = error.recoveryRoot || root;
            error.verifiedRecoverySource = verifiedSource;
            error.ownedArtifacts = tx.artifacts.filter(item => item.path === root || item.path.startsWith(`${root}${path.sep}`));
            if (localTx) this.#retainTransactionEvidence(tx);
            throw error;
        }
    }


        async #observeConfigTree(target, { existed, digest }) {
        const exists = fs.existsSync(target);
        if (!exists) {
            return {
                exists: false,
                digest: null,
                matched: existed === false,
                state: 'absent',
                readError: null
            };
        }
        try {
            const observedDigest = await this.#treeDigest(target);
            return {
                exists: true,
                digest: observedDigest,
                matched: existed === true && observedDigest === digest,
                state: existed === true && observedDigest === digest ? 'expected' : 'mismatched',
                readError: null
            };
        } catch (error) {
            return {
                exists: true,
                digest: null,
                matched: false,
                state: 'unreadable',
                readError: { code: error?.code || null, message: error?.message || String(error) }
            };
        }
    }

    async #restoreConfigPrestate({ target, existed, digest, sources, prefix, attempts, tx = null }) {
        let localTx = false;
        if (!tx) {
            tx = await this.#createTransactionContext('restore-config-prestate');
            localTx = true;
        }
        if (existed) {
            return this.#recoverActiveConfigToDigest({
                target,
                expectedDigest: digest,
                sources,
                prefix,
                recoveryAttempts: tx.ledger.attempts,
                tx
            });
        }

        let removeError = null;
        if (fs.existsSync(target)) {
            try { await this.fs.rm(target, { recursive: true, force: true }); } catch (error) { removeError = error; }
        }
        this.#recordTx(tx, {
            phase: tx.phase || prefix, stage: 'restore-original-absent-config-call', operation: 'rm-call',
            sourcePath: target, sourceOwned: false, callOutcome: removeError ? 'rejected' : 'resolved',
            success: !removeError, causeCode: removeError?.code || null, message: removeError?.message || null,
            postcondition: 'absence-observation-pending'
        });
        const observed = await this.#observeConfigTree(target, { existed: false, digest: null });
        this.#recordTx(tx, {
            phase: tx.phase || prefix, stage: 'restore-original-absent-config', operation: 'rm',
            sourcePath: target, destinationPath: null, sourceExists: observed.exists,
            success: observed.matched, callOutcome: removeError ? 'rejected' : 'resolved',
            causeCode: removeError?.code || observed.readError?.code || null,
            message: removeError?.message || observed.readError?.message || null,
            sideEffectObserved: observed.matched,
            postcondition: observed.matched
                ? (removeError ? 'remove-threw-postcondition-matched' : 'active-absent')
                : observed.state,
            observedDigest: observed.digest,
            readError: observed.readError
        });
        if (observed.matched) {
            const result = { success: true, restoredToAbsent: true, recoveryAttempts: tx.ledger.attempts, ownedArtifacts: [] };
            if (localTx) await this.#cleanupTransaction(tx, `${prefix}-success-cleanup`);
            return result;
        }
        const error = this.#newRecoveryError('Config recovery could not restore the originally absent state.', {
            code: prefix.includes('explicit') ? 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED' : 'RUNTIME_CONFIG_RECOVERY_FAILED',
            cause: removeError,
            details: {
                expectedDigest: null,
                activeTargetPresent: observed.exists,
                activeTargetDigest: observed.digest,
                activeReadError: observed.readError,
                recoveryAttempts: tx.ledger.attempts
            }
        });
        if (localTx) this.#retainTransactionEvidence(tx);
        throw error;
    }

    #newRecoveryError(message, { code = 'RUNTIME_CONFIG_RECOVERY_FAILED', cause = null, details = null } = {}) {
        return new FlowError(message, {
            code,
            subsystem: 'desktop-update',
            operation: 'RuntimeConfigMigrator',
            step: 'runtime-config-recovery',
            action: 'restore verified runtime config transaction state',
            retryable: true,
            details: details || {},
            cause
        });
    }

    #errorDiagnosticObject(error, extra = {}) {
        return {
            ...extra,
            code: error?.code || null,
            causeCode: error?.cause?.code || error?.code || null,
            message: error?.message || String(error),
            details: error?.details || null,
            recoveryRoot: error?.recoveryRoot || null,
            verifiedRecoverySource: error?.verifiedRecoverySource || null
        };
    }

    #recoveryFailureDiagnostic(error, fallback = {}) {
        const details = error?.details || {};
        const state = details.state || {};
        return {
            success: false,
            code: 'RUNTIME_CONFIG_RECOVERY_FAILED',
            causeCode: details.causeCode || error?.cause?.code || error?.code || fallback.causeCode || null,
            message: `RUNTIME_CONFIG_RECOVERY_FAILED: ${error?.message || String(error)}`,
            expectedDigest: details.expectedDigest ?? fallback.expectedDigest ?? null,
            rollbackSource: details.rollbackSource ?? fallback.rollbackSource ?? null,
            activeTargetPresent: details.activeTargetPresent ?? fallback.activeTargetPresent ?? null,
            activeTargetDigest: details.activeTargetDigest ?? fallback.activeTargetDigest ?? null,
            activeReadError: details.activeReadError ?? fallback.activeReadError ?? null,
            stageRoots: Array.isArray(details.stageRoots) ? details.stageRoots : [],
            recoveryAttempts: Array.isArray(details.recoveryAttempts)
                ? details.recoveryAttempts
                : (Array.isArray(state.recoveryAttempts) ? state.recoveryAttempts : []),
            verifiedSources: Array.isArray(details.verifiedSources) ? details.verifiedSources : [],
            artifacts: Array.isArray(details.artifacts) ? details.artifacts : (Array.isArray(error?.ownedArtifacts) ? error.ownedArtifacts : []),
            preservedRollbackSource: details.rollbackSource ?? fallback.rollbackSource ?? null
        };
    }

    #metadataRecoveryFailureDiagnostic(error, snapshot, fallback = {}) {
        const recovery = error?.metadataRecovery || error?.details?.metadataRecovery || {};
        return {
            success: false,
            code: fallback.code || 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED',
            causeCode: recovery.causeCode || error?.cause?.code || error?.code || null,
            message: error?.message || String(error),
            metadataExisted: snapshot?.existed === true,
            metadataExpectedDigest: snapshot?.digest || null,
            metadataCurrentDigest: recovery.currentDigest ?? null,
            metadataActiveExists: recovery.activeExists ?? null,
            metadataActiveReadError: recovery.activeReadError || null,
            activeReadError: recovery.activeReadError || null,
            metadataRecoveryTemp: recovery.recoveryTemp || null,
            metadataRecoverySourcePath: recovery.sourcePath || null,
            metadataRecoverySourceVerified: recovery.sourceVerified === true,
            metadataRecoverySourceDigest: recovery.sourceDigest || null,
            metadataRecoveryAttempts: Array.isArray(recovery.recoveryAttempts) ? recovery.recoveryAttempts : [],
            verifiedSources: Array.isArray(recovery.verifiedSources) ? recovery.verifiedSources : [],
            unownedCollisions: Array.isArray(recovery.unownedCollisions) ? recovery.unownedCollisions : []
        };
    }

    #serializeMetadata(value) {
        return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    }

    #bufferDigest(buffer) {
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    async status() {
        return (await this.#readMetadata()) || { appVersion: this.appVersion, lastBackup: null, lastMigration: null };
    }

    async #mergeTree(sourceDir, destinationDir, report, tx = null) {
        if (!fs.existsSync(sourceDir)) return;
        await this.fs.mkdir(destinationDir, { recursive: true });
        const entries = await this.fs.readdir(sourceDir, { withFileTypes: true });
        for (const entry of entries) {
            const source = path.join(sourceDir, entry.name);
            const destination = path.join(destinationDir, entry.name);
            if (entry.isDirectory()) {
                await this.#mergeTree(source, destination, report, tx);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!fs.existsSync(destination)) {
                await this.filesystemApplier.copyFile(source, destination);
                report.filesAdded += 1;
                continue;
            }
            if (!entry.name.endsWith('.json')) {
                report.filesUnchanged += 1;
                continue;
            }
            try {
                const defaults = JSON.parse(await this.fs.readFile(source, 'utf8'));
                const currentText = await this.fs.readFile(destination, 'utf8');
                const current = JSON.parse(currentText);
                const merged = mergeDefaults(defaults, current);
                const nextText = `${JSON.stringify(merged, null, 2)}\n`;
                if (nextText === currentText || JSON.stringify(merged) === JSON.stringify(current)) {
                    report.filesUnchanged += 1;
                } else {
                    const bytes = Buffer.from(nextText, 'utf8');
                    const digest = this.#bufferDigest(bytes);
                    let temporary = null;
                    if (tx) {
                        const staged = await this.#stageVerifiedBytes(tx, {
                            bytes, expectedDigest: digest, directory: 'merge', prefix: 'config-json',
                            phase: 'merge-config-stage', kind: 'merge-json-temp'
                        });
                        temporary = staged.path;
                    } else {
                        throw new Error('Runtime config JSON merge requires an owned transaction context.');
                    }
                    let renameError = null;
                    try { await this.filesystemApplier.rename(temporary, destination); } catch (error) { renameError = error; }
                    if (tx) {
                        this.#recordTx(tx, {
                            phase: 'MUTATE_CONFIG', stage: 'merge-config-install-call', operation: 'rename-call',
                            sourcePath: temporary, destinationPath: destination, callOutcome: renameError ? 'rejected' : 'resolved',
                            success: !renameError, causeCode: renameError?.code || null, message: renameError?.message || null,
                            postcondition: 'install-observation-pending'
                        });
                    }
                    let activeDigest = null;
                    try { activeDigest = this.#bufferDigest(await this.fs.readFile(destination)); } catch (_) {}
                    const installed = activeDigest === digest;
                    if (tx) {
                        this.#recordTx(tx, {
                            phase: 'MUTATE_CONFIG', stage: 'merge-config-install-postcondition', operation: 'rename',
                            sourcePath: temporary, destinationPath: destination, expectedDigest: digest, observedDigest: activeDigest,
                            callOutcome: renameError ? 'rejected' : 'resolved', sideEffectObserved: installed, success: installed,
                            causeCode: renameError?.code || null, message: renameError?.message || null,
                            postcondition: installed ? (renameError ? 'rename-threw-postcondition-matched' : 'verified-digest') : 'destination-not-verified'
                        });
                    }
                    if (!installed) throw renameError || new Error('Merged runtime config file install could not be verified.');
                    report.filesMerged += 1;
                }
            } catch (error) {
                throw FlowError.wrap(error, {
                    code: 'RUNTIME_CONFIG_REQUIRED_FILE_INVALID',
                    subsystem: 'desktop-update', operation: 'RuntimeConfigMigrator', step: 'merge-config',
                    action: 'parse/merge/write required runtime JSON config',
                    resource: path.relative(this.runtimeRoot, destination),
                    retryable: false
                });
            }
        }
    }

    async #snapshotConfigForTransaction(runtimeConfig, tx = null) {
        let localTx = false;
        if (!tx) {
            tx = await this.#createTransactionContext('config-transaction-snapshot');
            localTx = true;
        }
        const root = await this.#reserveOwnedRoot(tx, 'config-transaction-snapshot-root', '.mcbot-config-transaction-');
        try {
            const sourceDigest = await this.#treeDigest(runtimeConfig);
            const staged = await this.#stageVerifiedTree(tx, {
                source: runtimeConfig,
                expectedDigest: sourceDigest,
                ownedRoot: root,
                destinationName: 'config',
                phase: 'config-transaction-snapshot',
                kind: 'config-transaction-snapshot'
            });
            this.#registerVerifiedSource(tx, {
                path: staged.path, kind: 'config-transaction-snapshot', digest: sourceDigest, verified: true,
                owned: true, howOwnershipWasProven: 'child-of-mkdtemp-owned-root', retentionStatus: 'active'
            });
            return staged.path;
        } catch (error) {
            if (localTx) this.#retainTransactionEvidence(tx);
            throw error;
        }
    }

    async #treeDigest(root) {
        return this.treeVerifier.digest(root);
    }

    async #verifyTreeDigest(root, expectedDigest) {
        return this.treeVerifier.verify(root, expectedDigest);
    }

    async #backupConfig(runtimeConfig, fromVersion) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeFrom = String(fromVersion || 'unknown').replace(/[^a-z0-9_.-]/gi, '_');
        const destination = path.join(this.runtimeRoot, 'data', 'backups', 'migrations', `${safeFrom}-to-${this.appVersion}-${stamp}`, 'config');
        await this.fs.mkdir(path.dirname(destination), { recursive: true });
        await this.fs.cp(runtimeConfig, destination, { recursive: true, errorOnExist: true });
        return destination;
    }

    async #captureMetadataSnapshot() {
        return this.versionReader.capture();
    }

    async #metadataCurrentDigest() {
        if (!fs.existsSync(this.metadataPath)) return null;
        const raw = await this.fs.readFile(this.metadataPath);
        const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        return crypto.createHash('sha256').update(bytes).digest('hex');
    }

    async #restoreMetadataSnapshot(snapshot, tempTag, { tx = null, activeOwnership = null, ownedActiveDigest = null } = {}) {
        let localTx = false;
        if (!tx) {
            tx = await this.#createTransactionContext('metadata-restore');
            localTx = true;
        }
        const safeTag = String(tempTag || 'restore').replace(/[^a-z0-9_.-]/gi, '_');
        const attempts = tx.ledger.attempts;
        const ownership = activeOwnership || tx.state.metadataActiveOwnership || (ownedActiveDigest ? {
            ownedByThisOperation: false,
            expectedDigest: ownedActiveDigest,
            howOwnershipWasProven: 'legacy-digest-only-not-accepted'
        } : null);

        const fail = async (cause, extra = {}) => {
            const observed = await this.#observeMetadataExpected({ existed: snapshot.existed, digest: snapshot.digest });
            let source = tx.verifiedSources
                .filter(item => item.kind === 'metadata-recovery-source' || item.kind === 'metadata-restore-temp')
                .filter(item => item.verified === true && fs.existsSync(item.path))
                .at(-1) || null;

            if (snapshot.existed && !source) {
                try {
                    const recreated = await this.#stageVerifiedBytes(tx, {
                        bytes: snapshot.bytes,
                        expectedDigest: snapshot.digest,
                        directory: 'metadata',
                        prefix: `.mcbot-runtime.json.restore-source-${safeTag}`,
                        phase: 'metadata-restore-source-recreate',
                        kind: 'metadata-recovery-source'
                    });
                    source = this.#registerVerifiedSource(tx, {
                        path: recreated.path, kind: 'metadata-recovery-source', digest: snapshot.digest, verified: true,
                        owned: true, howOwnershipWasProven: 'child-of-mkdtemp-owned-root', retentionStatus: 'active'
                    });
                } catch (sourceError) {
                    this.#recordTx(tx, {
                        phase: 'PRIMARY_METADATA_RECOVERY', stage: 'metadata-restore-source-recreate-failed', operation: 'stage-bytes',
                        callOutcome: 'rejected', success: false, causeCode: sourceError?.code || null,
                        message: sourceError?.message || null, postcondition: 'verified-source-unavailable'
                    });
                }
            }

            const error = cause instanceof Error ? cause : new Error(String(cause || 'Runtime metadata recovery failed.'));
            error.metadataRecovery = {
                expectedDigest: snapshot.digest,
                currentDigest: observed.digest,
                activeExists: observed.exists,
                activeReadError: observed.readError || null,
                recoveryTemp: tx.artifacts.find(item => item.kind === 'metadata-restore-temp' && fs.existsSync(item.path))?.path || null,
                sourcePath: source?.path || null,
                sourceVerified: source?.verified === true,
                sourceDigest: source?.digest || null,
                causeCode: error?.code || observed.readError?.code || null,
                recoveryAttempts: attempts,
                verifiedSources: tx.verifiedSources,
                unownedCollisions: tx.unownedCollisions,
                ...extra
            };
            if (localTx) this.#retainTransactionEvidence(tx);
            throw error;
        };

        const initial = await this.#observeMetadataExpected({ existed: snapshot.existed, digest: snapshot.digest });
        this.#recordTx(tx, {
            phase: tx.phase || 'PRIMARY_METADATA_RECOVERY', stage: 'metadata-restore-initial-observe', operation: 'metadata-observe',
            destinationPath: this.metadataPath, destinationExists: initial.exists, observedDigest: initial.digest,
            callOutcome: initial.readError ? 'rejected' : 'resolved', success: initial.matched,
            causeCode: initial.readError?.code || null, message: initial.readError?.message || null,
            postcondition: initial.matched ? 'initial-postcondition-matched' : initial.state
        });
        if (initial.matched) {
            const result = {
                success: true, restored: true, existed: snapshot.existed, digest: initial.digest,
                recoveryAttempts: attempts, sourceVerified: false, sourcePath: null, activeReadError: null
            };
            if (localTx) await this.#cleanupTransaction(tx, 'metadata-restore-success-cleanup');
            return result;
        }
        if (initial.readError) return await fail(Object.assign(new Error('Runtime metadata active state is unreadable during recovery.'), { code: initial.readError.code }));

        const activeOwned = ownership?.ownedByThisOperation === true
            && ownership?.sourceConsumed === true
            && Boolean(ownership?.expectedDigest)
            && ownership.observedDigest === ownership.expectedDigest
            && initial.digest === ownership.expectedDigest;

        if (!snapshot.existed) {
            if (!activeOwned) {
                this.#recordUnownedCollision(tx, {
                    path: this.metadataPath, kind: 'metadata-active', digest: initial.digest,
                    reason: 'original-metadata-absent-and-active-ownership-not-proven'
                });
                this.#recordTx(tx, {
                    phase: tx.phase || 'PRIMARY_METADATA_RECOVERY', stage: 'restore-original-absence-refused', operation: 'rm',
                    sourcePath: this.metadataPath, sourceOwned: false, success: false, callOutcome: 'not-called',
                    observedDigest: initial.digest, postcondition: 'unowned-active-collision'
                });
                return await fail(new Error('Runtime metadata restore refused to remove an unowned active metadata file.'), {
                    unownedActiveCollision: true
                });
            }

            let removeError = null;
            try { await this.fs.rm(this.metadataPath, { force: true }); } catch (error) { removeError = error; }
            this.#recordTx(tx, {
                phase: tx.phase || 'PRIMARY_METADATA_RECOVERY', stage: 'restore-original-absence-call', operation: 'rm-call',
                sourcePath: this.metadataPath, sourceOwned: true, callOutcome: removeError ? 'rejected' : 'resolved',
                success: !removeError, causeCode: removeError?.code || null, message: removeError?.message || null,
                postcondition: 'absence-observation-pending'
            });
            const after = await this.#observeMetadataExpected({ existed: false, digest: null });
            this.#recordTx(tx, {
                phase: tx.phase || 'PRIMARY_METADATA_RECOVERY', stage: 'restore-original-absence', operation: 'rm',
                sourcePath: this.metadataPath, sourceOwned: true, sourceExists: after.exists,
                callOutcome: removeError ? 'rejected' : 'resolved', success: after.matched,
                causeCode: removeError?.code || after.readError?.code || null, message: removeError?.message || after.readError?.message || null,
                sideEffectObserved: after.matched, postcondition: after.matched
                    ? (removeError ? 'remove-threw-postcondition-matched' : 'metadata-absent') : after.state
            });
            if (after.matched) {
                const result = { success: true, restored: true, existed: false, recoveryAttempts: attempts, activeReadError: null };
                if (localTx) await this.#cleanupTransaction(tx, 'metadata-restore-success-cleanup');
                return result;
            }
            return await fail(removeError || new Error('Runtime metadata restore failed to return metadata path to absent state.'));
        }

        if (initial.exists && !activeOwned) {
            this.#recordUnownedCollision(tx, {
                path: this.metadataPath, kind: 'metadata-active', digest: initial.digest,
                reason: 'active-metadata-mismatch-and-operation-ownership-not-proven'
            });
            return await fail(new Error('Runtime metadata restore refused to overwrite an unowned active metadata file.'), {
                unownedActiveCollision: true
            });
        }

        let staged = null;
        try {
            const stageResult = await this.#stageVerifiedBytes(tx, {
                bytes: snapshot.bytes,
                expectedDigest: snapshot.digest,
                directory: 'metadata',
                prefix: `.mcbot-runtime.json.restore-${safeTag}`,
                phase: 'metadata-restore-stage',
                kind: 'metadata-restore-temp'
            });
            staged = stageResult.path;
            this.#registerVerifiedSource(tx, {
                path: staged, kind: 'metadata-restore-temp', digest: snapshot.digest, verified: true,
                owned: true, howOwnershipWasProven: 'child-of-mkdtemp-owned-root', retentionStatus: 'active'
            });
        } catch (stageError) {
            return await fail(stageError);
        }

        let renameError = null;
        try { await this.fs.rename(staged, this.metadataPath); } catch (error) { renameError = error; }
        this.#recordTx(tx, {
            phase: tx.phase || 'PRIMARY_METADATA_RECOVERY', stage: 'metadata-restore-rename-call', operation: 'rename-call',
            sourcePath: staged, destinationPath: this.metadataPath, sourceOwned: true,
            callOutcome: renameError ? 'rejected' : 'resolved', success: !renameError,
            causeCode: renameError?.code || null, message: renameError?.message || null,
            postcondition: 'restore-observation-pending'
        });
        let after = null;
        for (let read = 1; read <= 2; read += 1) {
            after = await this.#observeMetadataExpected({ existed: true, digest: snapshot.digest });
            this.#recordTx(tx, {
                phase: tx.phase || 'PRIMARY_METADATA_RECOVERY', stage: 'metadata-restore-post-install-observe', operation: 'metadata-observe',
                read, destinationPath: this.metadataPath, destinationExists: after.exists,
                expectedDigest: snapshot.digest, observedDigest: after.digest,
                callOutcome: after.readError ? 'rejected' : 'resolved', success: after.matched,
                causeCode: after.readError?.code || null, message: after.readError?.message || null,
                postcondition: after.matched ? 'active-digest-matched'
                    : (after.readError ? 'post-install-read-failed' : 'active-digest-not-matched')
            });
            if (after.matched || !after.readError) break;
        }
        const sourceExists = fs.existsSync(staged);
        this.#recordTx(tx, {
            phase: tx.phase || 'PRIMARY_METADATA_RECOVERY', stage: 'metadata-restore-rename', operation: 'rename',
            sourcePath: staged, destinationPath: this.metadataPath, sourceExists, destinationExists: after.exists,
            sourceOwned: true, destinationOwned: after.matched && !sourceExists,
            expectedDigest: snapshot.digest, observedDigest: after.digest,
            callOutcome: renameError ? 'rejected' : 'resolved', success: after.matched,
            causeCode: renameError?.code || after.readError?.code || null, message: renameError?.message || after.readError?.message || null,
            sideEffectObserved: !sourceExists && after.exists,
            postcondition: after.matched ? (renameError ? 'rename-threw-postcondition-matched' : 'active-digest-matched')
                : (after.readError ? 'post-install-read-failed' : 'active-digest-not-matched')
        });
        if (after.matched) {
            const result = {
                success: true, restored: true, existed: true, digest: after.digest,
                recoveryAttempts: attempts, sourceVerified: sourceExists, sourcePath: sourceExists ? staged : null,
                activeReadError: null
            };
            if (localTx) await this.#cleanupTransaction(tx, 'metadata-restore-success-cleanup');
            return result;
        }

        return await fail(renameError || Object.assign(new Error('Runtime metadata byte-exact restore verification failed.'), {
            code: after.readError?.code || 'RUNTIME_CONFIG_METADATA_RESTORE_NOT_PROVEN'
        }));
    }


        async #fileDigest(file) {
        const raw = await this.fs.readFile(file);
        const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        return this.#bufferDigest(bytes);
    }

    async #readMetadata() {
        return this.versionReader.read();
    }

    async #writeMetadata(value, { tempTag = null, serializedBytes = null, expectedDigest = null, onTemp = null, tx = null } = {}) {
        let localTx = false;
        if (!tx) {
            tx = await this.#createTransactionContext('metadata-write');
            localTx = true;
        }
        const safeTag = tempTag ? String(tempTag).replace(/[^a-z0-9_.-]/gi, '_') : `write-${process.pid}-${Date.now()}`;
        const bytes = serializedBytes
            ? (Buffer.isBuffer(serializedBytes) ? serializedBytes : Buffer.from(serializedBytes))
            : this.#serializeMetadata(value);
        const intendedDigest = expectedDigest || this.#bufferDigest(bytes);
        let staged = null;
        let renameError = null;
        let active = null;
        let activeOwnership = null;
        try {
            const stagedResult = await this.#stageVerifiedBytes(tx, {
                bytes,
                expectedDigest: intendedDigest,
                directory: 'metadata',
                prefix: `.mcbot-runtime.json.tmp-${safeTag}`,
                phase: 'metadata-commit-stage',
                kind: 'metadata-commit-temp',
                onPath: candidate => {
                    staged = candidate;
                    if (typeof onTemp === 'function') onTemp(candidate);
                }
            });
            staged = stagedResult.path;

            try { await this.fs.rename(staged, this.metadataPath); } catch (error) { renameError = error; }
            this.#recordTx(tx, {
                phase: tx.phase || 'INSTALL_METADATA_CANDIDATE', stage: 'metadata-commit-rename-call', operation: 'rename-call',
                sourcePath: staged, destinationPath: this.metadataPath, sourceOwned: true,
                callOutcome: renameError ? 'rejected' : 'resolved', success: !renameError,
                causeCode: renameError?.code || null, message: renameError?.message || null,
                postcondition: 'install-observation-pending'
            });

            for (let read = 1; read <= 2; read += 1) {
                active = await this.#observeMetadataExpected({ existed: true, digest: intendedDigest });
                this.#recordTx(tx, {
                    phase: tx.phase || 'INSTALL_METADATA_CANDIDATE',
                    stage: 'metadata-commit-active-observe',
                    operation: 'metadata-observe',
                    read,
                    destinationPath: this.metadataPath,
                    destinationExists: active.exists,
                    expectedDigest: intendedDigest,
                    observedDigest: active.digest,
                    callOutcome: active.readError ? 'rejected' : 'resolved',
                    success: active.matched,
                    causeCode: active.readError?.code || null,
                    message: active.readError?.message || null,
                    postcondition: active.matched
                        ? 'active-digest-matched'
                        : (active.readError ? 'active-digest-unreadable' : 'active-digest-not-matched')
                });
                if (active.matched || !active.readError) break;
            }
            const sourceExists = fs.existsSync(staged);
            const sourceConsumed = !sourceExists;
            const ownershipProven = sourceConsumed
                && stagedResult.artifact?.ownedByThisOperation === true
                && active.readError == null
                && active.matched === true
                && active.digest === intendedDigest;
            if (ownershipProven) {
                activeOwnership = {
                    ownedByThisOperation: true,
                    howOwnershipWasProven: 'owned-source-consumed-into-active-target',
                    sourcePath: staged,
                    sourceConsumed: true,
                    expectedDigest: intendedDigest,
                    observedDigest: active.digest
                };
                tx.state.metadataActiveOwnership = activeOwnership;
            } else if (active.exists && active.matched && sourceExists) {
                this.#recordUnownedCollision(tx, {
                    path: this.metadataPath,
                    kind: 'metadata-active',
                    digest: active.digest,
                    reason: 'active-digest-matched-but-owned-source-still-exists'
                });
            } else if (active.exists && sourceConsumed && !active.matched) {
                this.#recordUnownedCollision(tx, {
                    path: this.metadataPath,
                    kind: 'metadata-active',
                    digest: active.digest,
                    reason: active.readError
                        ? 'owned-source-consumed-but-current-active-unreadable'
                        : 'owned-source-consumed-but-current-active-mismatched'
                });
            }
            this.#recordTx(tx, {
                phase: tx.phase || 'INSTALL_METADATA_CANDIDATE', stage: 'metadata-commit-rename-postcondition', operation: 'rename',
                sourcePath: staged, destinationPath: this.metadataPath, sourceExists, destinationExists: active.exists,
                sourceOwned: true, destinationOwned: ownershipProven, destinationNamespaceOwned: false,
                expectedDigest: intendedDigest, observedDigest: active.digest,
                callOutcome: renameError ? 'rejected' : 'resolved', sideEffectObserved: sourceConsumed && active.exists,
                success: active.matched && ownershipProven, causeCode: renameError?.code || active.readError?.code || null,
                message: renameError?.message || active.readError?.message || null,
                postcondition: active.matched && ownershipProven
                    ? (renameError ? 'rename-threw-postcondition-matched-owned' : 'active-digest-matched-owned')
                    : (active.readError ? 'active-digest-unreadable' : (active.matched ? 'active-matched-ownership-unproven' : 'active-digest-not-matched'))
            });

            if (!(active.matched && ownershipProven)) {
                const error = renameError || new Error(active.matched
                    ? 'Runtime metadata commit matched content but active ownership could not be proven.'
                    : 'Runtime metadata commit postcondition verification failed.');
                error.code = error.code || 'RUNTIME_CONFIG_METADATA_COMMIT_NOT_PROVEN';
                throw error;
            }
            // A rejected mutation is still an operation failure even when its side effect
            // is proven. Recovery uses the postcondition evidence; normal commit must not
            // silently convert the rejected call into success.
            if (renameError) throw renameError;

            tx.state.metadataCandidateInstalled = true;
            const result = { success: true, digest: active.digest, temp: staged, activeOwnership };
            if (localTx) await this.#cleanupTransaction(tx, 'metadata-write-success-cleanup');
            return result;
        } catch (error) {
            const current = active || await this.#observeMetadataExpected({ existed: true, digest: intendedDigest }).catch(() => ({ exists: fs.existsSync(this.metadataPath), digest: null, readError: null, matched: false }));
            const tempDigest = staged && fs.existsSync(staged) ? await this.#fileDigest(staged).catch(() => null) : null;
            error.metadataWrite = {
                expectedDigest: intendedDigest,
                currentDigest: current?.digest ?? null,
                activeExists: current?.exists ?? fs.existsSync(this.metadataPath),
                activeReadError: current?.readError || null,
                temp: staged && fs.existsSync(staged) ? staged : null,
                tempDigest,
                causeCode: error?.code || renameError?.code || null,
                activeOwnership,
                verifiedSources: tx.verifiedSources,
                unownedCollisions: tx.unownedCollisions,
                attempts: tx.ledger.attempts
            };
            if (localTx) this.#retainTransactionEvidence(tx);
            throw error;
        }
    }

}

RuntimeConfigMigrator.mergeDefaults = mergeDefaults;
module.exports = RuntimeConfigMigrator;
