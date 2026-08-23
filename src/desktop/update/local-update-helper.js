'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function safeRelative(value) {
    const raw = String(value || '').replace(/\\/g, '/');
    if (!raw || raw.includes('\0') || raw.startsWith('/') || /^[a-z]:/i.test(raw)) return null;
    const normalized = path.posix.normalize(raw);
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.split('/').includes('..')) return null;
    return normalized.replace(/^\.\/+/, '');
}

function resolveInside(root, relative) {
    const safe = safeRelative(relative);
    if (!safe) throw new Error(`Unsafe update path: ${relative}`);
    const base = path.resolve(root);
    const target = path.resolve(base, ...safe.split('/'));
    if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error(`Update path escaped target root: ${relative}`);
    return { safe, target };
}

function errorWithCode(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function validateDeletePath(relative) {
    const safe = safeRelative(relative);
    if (safe !== 'out') {
        throw errorWithCode('LOCAL_UPDATE_DELETE_PATH', `Local update helper only permits deletion of exact generated root out: ${relative}`);
    }
    return safe;
}

function integrityEntries(plan) {
    if (plan?.schemaVersion !== 2) return null;
    if (!Array.isArray(plan.fileIntegrity)) {
        throw errorWithCode('LOCAL_UPDATE_STAGED_INTEGRITY_MISSING', 'Update plan is missing staged file integrity evidence.');
    }
    const map = new Map();
    for (const raw of plan.fileIntegrity) {
        const safe = safeRelative(raw?.relative);
        const size = Number(raw?.size);
        const digest = String(raw?.digest || '').trim().toLowerCase();
        if (!safe || !Number.isSafeInteger(size) || size < 0 || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
            throw errorWithCode('LOCAL_UPDATE_STAGED_INTEGRITY_INVALID', `Invalid staged integrity evidence for: ${raw?.relative}`);
        }
        if (map.has(safe)) throw errorWithCode('LOCAL_UPDATE_STAGED_INTEGRITY_DUPLICATE', `Duplicate staged integrity evidence: ${safe}`);
        map.set(safe, { relative: safe, size, digest });
    }
    return map;
}

async function computeFileIntegrity(filePath) {
    const stat = await fsp.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw errorWithCode('LOCAL_UPDATE_STAGED_FILE_INVALID', `Staged update source is not a regular file: ${filePath}`);
    }
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    for await (const chunk of stream) hash.update(chunk);
    return { size: stat.size, digest: `sha256:${hash.digest('hex')}` };
}

async function verifyStagedFile(plan, relative) {
    const safe = safeRelative(relative);
    if (!safe) throw errorWithCode('LOCAL_UPDATE_UNSAFE_PATH', `Unsafe staged update path: ${relative}`);
    const map = integrityEntries(plan);
    if (!map) return true;
    const expected = map.get(safe);
    if (!expected) throw errorWithCode('LOCAL_UPDATE_STAGED_INTEGRITY_MISSING', `Missing staged integrity evidence: ${safe}`);
    const source = resolveInside(plan.stageRoot, safe).target;
    let observed;
    try {
        observed = await computeFileIntegrity(source);
    } catch (error) {
        if (error?.code === 'ENOENT') throw errorWithCode('LOCAL_UPDATE_STAGED_INTEGRITY_MISMATCH', `Staged update source disappeared: ${safe}`);
        throw error;
    }
    if (observed.size !== expected.size || observed.digest !== expected.digest) {
        throw errorWithCode('LOCAL_UPDATE_STAGED_INTEGRITY_MISMATCH', `Staged update source changed after inspection: ${safe}`);
    }
    return true;
}

async function verifyStagedFiles(plan) {
    const map = integrityEntries(plan);
    if (!map) return true;
    const files = (plan.files || []).map(safeRelative);
    if (files.some(value => !value)) throw errorWithCode('LOCAL_UPDATE_UNSAFE_PATH', 'Update plan contains an unsafe staged path.');
    if (map.size !== files.length || files.some(file => !map.has(file))) {
        throw errorWithCode('LOCAL_UPDATE_STAGED_INTEGRITY_MISSING', 'Staged integrity evidence does not exactly cover the update file set.');
    }
    for (const relative of files) await verifyStagedFile(plan, relative);
    return true;
}

function validatePlan(plan) {
    if (!plan || typeof plan !== 'object') throw errorWithCode('LOCAL_UPDATE_INVALID_PLAN', 'Invalid local update plan.');
    const fileSet = new Set();
    for (const relative of plan.files || []) {
        const safe = safeRelative(relative);
        if (!safe) throw errorWithCode('LOCAL_UPDATE_UNSAFE_PATH', `Unsafe staged update path: ${relative}`);
        if (fileSet.has(safe)) throw errorWithCode('LOCAL_UPDATE_PLAN_DUPLICATE', `Duplicate staged update path: ${relative}`);
        fileSet.add(safe);
    }
    const deleteSet = new Set();
    for (const relative of plan.delete || []) {
        const safe = validateDeletePath(relative);
        if (deleteSet.has(safe)) throw errorWithCode('LOCAL_UPDATE_PLAN_DUPLICATE', `Duplicate delete path: ${relative}`);
        deleteSet.add(safe);
    }
    for (const file of fileSet) {
        for (const deleted of deleteSet) {
            if (file === deleted || file.startsWith(`${deleted}/`)) {
                throw errorWithCode('LOCAL_UPDATE_PLAN_OVERLAP', `Update plan overlaps write and delete paths: ${file}`);
            }
        }
    }
    const integrity = integrityEntries(plan);
    if (integrity && (integrity.size !== fileSet.size || [...fileSet].some(file => !integrity.has(file)))) {
        throw errorWithCode('LOCAL_UPDATE_STAGED_INTEGRITY_MISSING', 'Staged integrity evidence does not exactly cover the update file set.');
    }
    return true;
}

async function waitForExit(pid, timeoutMs = 60000) {
    if (!Number.isInteger(pid) || pid <= 0) return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            process.kill(pid, 0);
            await new Promise(resolve => setTimeout(resolve, 250));
        } catch (error) {
            if (error?.code === 'ESRCH') return;
            if (process.platform === 'win32' && error?.code === 'EPERM') {
                await new Promise(resolve => setTimeout(resolve, 250));
                continue;
            }
            return;
        }
    }
    throw new Error(`Timed out waiting for MCbot process ${pid} to exit.`);
}

async function exists(file) {
    try { await fsp.access(file); return true; } catch { return false; }
}

async function backupTarget(targetRoot, backupRoot, relative, journal) {
    const { safe, target } = resolveInside(targetRoot, relative);
    const backup = resolveInside(backupRoot, safe).target;
    const present = await exists(target);
    if (present) {
        const stat = await fsp.lstat(target);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Refusing to replace non-regular file: ${safe}`);
        await fsp.mkdir(path.dirname(backup), { recursive: true });
        await fsp.copyFile(target, backup);
    }
    journal.push({ relative: safe, existed: present });
    return { safe, target };
}

async function applyFile(plan, relative, journal) {
    await verifyStagedFile(plan, relative);
    const source = resolveInside(plan.stageRoot, relative).target;
    const stat = await fsp.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Staged update source is not a regular file: ${relative}`);
    const { safe, target } = await backupTarget(plan.targetRoot, plan.backupRoot, relative, journal);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.mcbot-update-${process.pid}.tmp`;
    await fsp.copyFile(source, temp);
    await fsp.rm(target, { force: true });
    await fsp.rename(temp, target);
    return safe;
}

async function applyDelete(plan, relative, journal) {
    const safe = validateDeletePath(relative);
    const { target } = resolveInside(plan.targetRoot, safe);
    const backup = resolveInside(plan.backupRoot, safe).target;
    const present = await exists(target);
    if (!present) {
        journal.push({ relative: safe, existed: false, kind: 'directory' });
        return safe;
    }

    const stat = await fsp.lstat(target);
    if (stat.isSymbolicLink()) throw new Error(`Refusing to delete symbolic link: ${safe}`);
    if (!stat.isDirectory()) throw new Error('Refusing to delete generated out path because it is not a directory.');
    await fsp.mkdir(path.dirname(backup), { recursive: true });
    await fsp.cp(target, backup, { recursive: true, errorOnExist: true, force: false });
    journal.push({ relative: safe, existed: true, kind: 'directory' });
    await fsp.rm(target, { recursive: true, force: true });
    return safe;
}

async function rollback(plan, journal) {
    const errors = [];
    for (const item of [...journal].reverse()) {
        try {
            const target = resolveInside(plan.targetRoot, item.relative).target;
            const backup = resolveInside(plan.backupRoot, item.relative).target;
            if (item.existed && await exists(backup)) {
                await fsp.rm(target, { recursive: item.kind === 'directory', force: true });
                await fsp.mkdir(path.dirname(target), { recursive: true });
                if (item.kind === 'directory') {
                    await fsp.cp(backup, target, { recursive: true, errorOnExist: true, force: false });
                } else {
                    await fsp.copyFile(backup, target);
                }
            } else {
                await fsp.rm(target, { recursive: item.kind === 'directory', force: true });
            }
        } catch (error) {
            errors.push({ relative: item.relative, message: error?.message || String(error) });
        }
    }
    return errors;
}

async function writeResult(plan, payload) {
    if (!plan.resultFile) return;
    await fsp.mkdir(path.dirname(plan.resultFile), { recursive: true });
    await fsp.writeFile(plan.resultFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function restart(plan) {
    if (!plan.restartExe) return;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(plan.restartExe, Array.isArray(plan.restartArgs) ? plan.restartArgs : [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        env
    });
    child.unref();
}

async function main() {
    const planPath = process.argv[2];
    if (!planPath) throw new Error('Missing local update plan path.');
    const plan = JSON.parse(await fsp.readFile(path.resolve(planPath), 'utf8'));
    if (plan.schemaVersion !== 2 || plan.mode !== 'apply' || plan.product !== 'mcbot-desktop') throw new Error('Invalid local update plan.');
    validatePlan(plan);
    await waitForExit(Number(plan.parentPid || 0));
    await verifyStagedFiles(plan);

    const journal = [];
    let success = false;
    let failure = null;
    let rollbackErrors = [];
    try {
        await fsp.mkdir(plan.backupRoot, { recursive: true });
        for (const relative of plan.files || []) await applyFile(plan, relative, journal);
        for (const relative of plan.delete || []) await applyDelete(plan, relative, journal);
        success = true;
    } catch (error) {
        failure = { name: error?.name || 'Error', code: error?.code || null, message: error?.message || String(error) };
        rollbackErrors = await rollback(plan, journal);
    }

    const result = {
        success,
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        appliedAt: new Date().toISOString(),
        changedFiles: journal.length,
        backupRoot: plan.backupRoot,
        configBackup: plan.configBackup || null,
        failure,
        rollbackErrors
    };
    await writeResult(plan, result).catch(error => {
        process.stderr.write(`MCbot local updater could not write result: ${error?.message || error}\n`);
    });
    restart(plan);
    if (!success) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(async error => {
        try {
            const planPath = process.argv[2];
            const plan = planPath ? JSON.parse(fs.readFileSync(path.resolve(planPath), 'utf8')) : null;
            if (plan) await writeResult(plan, {
                success: false,
                fromVersion: plan.fromVersion || null,
                toVersion: plan.toVersion || null,
                appliedAt: new Date().toISOString(),
                failure: { name: error?.name || 'Error', code: error?.code || null, message: error?.message || String(error) },
                rollbackErrors: []
            });
            if (plan) restart(plan);
        } catch (secondaryError) {
            process.stderr.write(`MCbot local updater recovery failed: ${secondaryError?.message || secondaryError}\n`);
        }
        process.exitCode = 1;
    });
}

module.exports = {
    safeRelative,
    resolveInside,
    validateDeletePath,
    validatePlan,
    computeFileIntegrity,
    verifyStagedFile,
    verifyStagedFiles,
    waitForExit,
    backupTarget,
    applyFile,
    applyDelete,
    rollback,
    writeResult,
    restart,
    main
};
