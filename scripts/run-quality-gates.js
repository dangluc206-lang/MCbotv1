'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT = 'quality-gate-report';
const VERSION = 1;
const STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED' });

function relative(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function walkJs(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walkJs(full));
        else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

function classifyExit(exitCode, { blockedExitCodes = [] } = {}) {
    if (exitCode === 0) return STATUS.PASS;
    if (blockedExitCodes.includes(exitCode)) return STATUS.BLOCKED;
    return STATUS.FAIL;
}

function overallStatus(gates) {
    if (gates.some(gate => gate.status === STATUS.FAIL)) return STATUS.FAIL;
    if (gates.some(gate => gate.status === STATUS.BLOCKED)) return STATUS.BLOCKED;
    return STATUS.PASS;
}

function resultBase({ id, wp, description, status, exitCode = null, reason = null, details = null, command = null, durationMs = 0 }) {
    return Object.freeze({ id, wp, description, status, exitCode, reason, details, command, durationMs });
}

function runProcessGate({ id, wp = 'WP-402', description, command, args = [], blockedExitCodes = [] }) {
    const started = Date.now();
    const result = spawnSync(command, args, {
        cwd: ROOT,
        encoding: 'utf8',
        env: process.env,
        maxBuffer: 64 * 1024 * 1024
    });
    const durationMs = Date.now() - started;
    if (result.error) {
        return resultBase({
            id, wp, description, status: STATUS.BLOCKED, reason: `process-start-failed: ${result.error.message}`,
            details: null, command: [command, ...args], durationMs
        });
    }
    const exitCode = result.status ?? 1;
    const status = classifyExit(exitCode, { blockedExitCodes });
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    return resultBase({
        id, wp, description, status, exitCode,
        reason: status === STATUS.BLOCKED ? (output.split('\n').filter(Boolean).at(-1) || `blocked exit ${exitCode}`) : null,
        details: status === STATUS.PASS ? null : output.slice(-12000),
        command: [command, ...args], durationMs
    });
}

function runNodeTests(id, wp, description, files) {
    return runProcessGate({ id, wp, description, command: process.execPath, args: ['--test', ...files] });
}

function runSyntaxGate() {
    const started = Date.now();
    const roots = [path.join(ROOT, 'src'), path.join(ROOT, 'scripts')];
    const files = roots.flatMap(walkJs);
    for (const rootFile of fs.readdirSync(ROOT, { withFileTypes: true })) {
        if (rootFile.isFile() && rootFile.name.endsWith('.js')) files.push(path.join(ROOT, rootFile.name));
    }
    const unique = [...new Set(files)].sort();
    for (const file of unique) {
        const checked = spawnSync(process.execPath, ['--check', file], { cwd: ROOT, encoding: 'utf8' });
        if (checked.status !== 0 || checked.error) {
            return resultBase({
                id: 'syntax', wp: 'WP-402', description: 'JavaScript syntax for runtime/scripts/root entrypoints', status: STATUS.FAIL,
                exitCode: checked.status ?? 1, reason: null,
                details: `${relative(file)}\n${checked.stderr || checked.stdout || checked.error?.message || 'syntax check failed'}`,
                command: [process.execPath, '--check', relative(file)], durationMs: Date.now() - started
            });
        }
    }
    return resultBase({
        id: 'syntax', wp: 'WP-402', description: 'JavaScript syntax for runtime/scripts/root entrypoints', status: STATUS.PASS,
        exitCode: 0, details: { checkedFiles: unique.length }, command: [process.execPath, '--check', '<runtime/scripts/root *.js>'], durationMs: Date.now() - started
    });
}

function fastGateDefinitions() {
    return [
        () => runSyntaxGate(),
        () => runNodeTests('targeted-contracts', 'WP-002/WP-200/WP-201/WP-202', 'Shared result/capability/mode/task contract tests', [
            'tests/unit/shared/contracts/OperationResultContract.test.js',
            'tests/unit/core/CapabilityRegistryContract.test.js',
            'tests/unit/modes/ManagedModeLifecycleContract.test.js',
            'tests/unit/modes/ModePlatform.test.js',
            'tests/unit/modes/ModeLeaseSession.test.js',
            'tests/unit/modes/LegacyModeAdapter.test.js',
            'tests/unit/modes/LegacyModeTaskSupervision.test.js',
            'tests/unit/modes/CollectorB5ModeService.test.js',
            'tests/unit/modes/ComposableModePlatform.test.js',
            'tests/unit/core/TaskSupervisor.test.js',
            'tests/unit/modes/TaskResourceClaimContract.test.js',
            'tests/unit/gui/GuiActionFlow.test.js',
            'tests/unit/gui/GuiContractCoverage.test.js',
            'tests/unit/server-features/DirectServiceStatusConvergence.test.js'
        ]),
        () => runProcessGate({ id: 'architecture-structure', wp: 'WP-000/WP-001/WP-004', description: 'Documentation, structure and architecture validation', command: process.execPath, args: ['scripts/validate-structure.js'] }),
        () => runProcessGate({ id: 'architecture-boundaries', wp: 'WP-001/WP-004/WP-005', description: 'Architecture reachability/ownership/generation catalog validation', command: process.execPath, args: ['scripts/validate-architecture.js'] }),
        () => runProcessGate({ id: 'baseline', wp: 'WP-001', description: 'Committed architecture baseline freshness', command: process.execPath, args: ['scripts/inspect-architecture-baseline.js', '--check'] }),
        () => runProcessGate({ id: 'scale-baseline', wp: 'PRE-WP-500', description: 'Committed scale evidence schema, event-loss and crash-isolation contract', command: process.execPath, args: ['scripts/measure-scale-baseline.js', '--validate-file', 'architecture/scale/current.json'] }),
        () => runProcessGate({ id: 'side-effect-ownership', wp: 'WP-004', description: 'Raw side-effect and destructive artifact ownership audit', command: process.execPath, args: ['scripts/audit-side-effect-ownership.js'] }),
        () => runProcessGate({ id: 'config-cross-reference', wp: 'WP-100/WP-102/WP-103/WP-104', description: 'Configuration schema and cross-reference validation', command: process.execPath, args: ['scripts/validate-config.js'] }),
        () => runProcessGate({ id: 'server-profile', wp: 'WP-101/WP-105', description: 'MinerUA profile inventory freshness', command: process.execPath, args: ['scripts/inspect-minerua-knowledge.js', '--check'] }),
        () => runNodeTests('planner-replay', 'WP-300/WP-302/WP-303', 'Planner purity, decision replay and B5 reference conformance', [
            'tests/unit/shared/DecisionReplayEnvelope.test.js',
            'tests/unit/planning/B1StorageProtectionPlanner.test.js',
            'tests/unit/simulation/B5PlannerReplay.test.js',
            'tests/unit/modes/B5ReferenceConformance.test.js',
            'tests/unit/server-features/B5PlanningService.test.js'
        ]),
        () => runNodeTests('event-generation', 'WP-005', 'Event scope/generation/stale callback contracts', [
            'tests/unit/core/EventBusScopeContract.test.js',
            'tests/unit/core/EventProducerScopeAudit.test.js',
            'tests/unit/bootstrap/ConnectionEventBinding.test.js',
            'tests/unit/commands/CommandGenerationContract.test.js',
            'tests/unit/commands/SkyCommandService.test.js'
        ]),
        () => runNodeTests('desktop-persistence-ordering', 'POST-P5', 'Desktop preference serialization, atomic temp ownership and queue recovery', [
            'tests/unit/desktop/DesktopPreferenceStore.test.js',
            'tests/unit/desktop/DesktopShutdownSequence.test.js'
        ]),
        () => runNodeTests('observation-persistence-drain', 'POST-P5', 'GUI/inventory observation queues drain before lifecycle stop completes', [
            'tests/unit/architecture/ObservationPersistenceDrain.test.js'
        ]),
        () => runNodeTests('discord-shutdown-drain', 'POST-P5', 'Discord accepted interactions, panel refresh and persistence drain before client destroy', [
            'tests/unit/discord/DiscordShutdownDrain.test.js'
        ]),
        () => runNodeTests('bot-profile-transaction', 'POST-P5', 'Cross-surface config mutation serialization and bot-profile transaction boundary', [
            'tests/unit/core/KeyedMutationCoordinator.test.js',
            'tests/unit/architecture/ConfigMutationCoordinatorIntegration.test.js',
            'tests/unit/architecture/BotProfileAdminTransactionBoundary.test.js'
        ]),
        () => runNodeTests('fleet-control-status', 'POST-P5', 'Fleet reconciliation preserves timeout/disconnect result semantics', [
            'tests/unit/recovery/FleetControlService.test.js'
        ]),
        () => runNodeTests('update-safety', 'WP-003', 'Runtime configuration transaction/fault closure and local staged-file integrity', [
            'tests/unit/desktop/RuntimeConfigMigrator.test.js',
            'tests/unit/desktop/LocalZipUpdateService.test.js',
            'tests/unit/desktop/LocalUpdateHelper.test.js'
        ]),
        () => runNodeTests('fault-matrix', 'WP-401', 'Deterministic virtual-time replay and selected fault matrix', [
            'tests/unit/simulation/FaultMatrixContract.test.js',
            'tests/unit/simulation/ReplayHarness.test.js'
        ]),
        () => runNodeTests('release-zip-contract', 'WP-402', 'Source/update ZIP completeness and secret/runtime exclusion contract', [
            'tests/unit/release/ReleaseZipContract.test.js'
        ])
    ];
}

function executeLane(lane = 'fast') {
    if (!['fast', 'release'].includes(lane)) throw new Error(`Unsupported quality lane: ${lane}`);
    const gates = fastGateDefinitions().map(run => run());
    if (lane === 'release') {
        gates.push(runProcessGate({
            id: 'broader-regression', wp: 'WP-402', description: 'Source-only broader regression gate',
            command: process.execPath, args: ['scripts/run-tests.js']
        }));
        const installedGate = runProcessGate({
            id: 'installed-regression', wp: 'WP-402', description: 'Complete installed dependency test graph',
            command: process.execPath, args: ['scripts/run-tests.js', '--installed'], blockedExitCodes: [2]
        });
        gates.push(installedGate);
        if (installedGate.status === STATUS.PASS) {
            gates.push(runProcessGate({
                id: 'coverage', wp: 'WP-402', description: 'Installed full-suite coverage thresholds',
                command: process.execPath, args: [
                    '--test',
                    '--experimental-test-coverage',
                    '--test-coverage-include=src/**/*.js',
                    '--test-coverage-lines=80',
                    '--test-coverage-branches=65',
                    '--test-coverage-functions=80',
                    'tests/**/*.test.js'
                ]
            }));
        } else {
            gates.push(resultBase({
                id: 'coverage', wp: 'WP-402', description: 'Installed full-suite coverage thresholds', status: STATUS.BLOCKED,
                exitCode: null, reason: `prerequisite installed-regression=${installedGate.status}`, details: null,
                command: [
                    process.execPath,
                    '--test',
                    '--experimental-test-coverage',
                    '--test-coverage-include=src/**/*.js',
                    '--test-coverage-lines=80',
                    '--test-coverage-branches=65',
                    '--test-coverage-functions=80',
                    'tests/**/*.test.js'
                ], durationMs: 0
            }));
        }
    }
    const status = overallStatus(gates);
    return Object.freeze({
        contract: CONTRACT,
        version: VERSION,
        lane,
        status,
        counts: Object.freeze({
            total: gates.length,
            pass: gates.filter(gate => gate.status === STATUS.PASS).length,
            fail: gates.filter(gate => gate.status === STATUS.FAIL).length,
            blocked: gates.filter(gate => gate.status === STATUS.BLOCKED).length
        }),
        gates: Object.freeze(gates)
    });
}

function printHuman(report) {
    console.log(`Quality lane ${report.lane}: ${report.status} (${report.counts.pass} PASS / ${report.counts.fail} FAIL / ${report.counts.blocked} BLOCKED)`);
    for (const gate of report.gates) {
        const suffix = gate.reason ? ` — ${gate.reason}` : '';
        console.log(`[${gate.status}] ${gate.id} (${gate.wp}) ${gate.durationMs}ms${suffix}`);
        if (gate.status !== STATUS.PASS && gate.details) console.log(String(gate.details));
    }
}

function main(argv = process.argv.slice(2)) {
    const laneIndex = argv.indexOf('--lane');
    const lane = laneIndex >= 0 ? argv[laneIndex + 1] : (argv.includes('--release') ? 'release' : 'fast');
    const json = argv.includes('--json');
    const report = executeLane(lane);
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printHuman(report);
    process.exitCode = report.status === STATUS.PASS ? 0 : report.status === STATUS.BLOCKED ? 2 : 1;
    return report;
}

if (require.main === module) main();

module.exports = Object.freeze({ CONTRACT, VERSION, STATUS, classifyExit, overallStatus, executeLane, main });
