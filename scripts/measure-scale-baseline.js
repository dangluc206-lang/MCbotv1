'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const Application = require('../src/core/Application');
const BotRegistry = require('../src/bot/BotRegistry');
const BotRuntime = require('../src/bot/BotRuntime');
const BotState = require('../src/bot/BotState');
const LifecycleCoordinator = require('../src/core/LifecycleCoordinator');
const EventBus = require('../src/core/EventBus');

const SCHEMA_VERSION = 1;
const DEFAULT_COUNTS = Object.freeze([1, 8, 16, 32, 64]);
const DEFAULT_COMPONENTS_PER_RUNTIME = 24;
const DEFAULT_EVENTS_PER_BOT = 50;

function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parseCounts(value) {
    if (!value) return [...DEFAULT_COUNTS];
    const counts = String(value).split(',').map(part => positiveInteger(part.trim(), 0)).filter(Boolean);
    if (!counts.length) throw new TypeError('Scale counts must contain positive integers.');
    return [...new Set(counts)].sort((a, b) => a - b);
}

function round(value, digits = 3) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function memorySnapshot() {
    const value = process.memoryUsage();
    return {
        rssBytes: value.rss,
        heapUsedBytes: value.heapUsed,
        heapTotalBytes: value.heapTotal,
        externalBytes: value.external
    };
}

function memoryDelta(before, after) {
    return Object.fromEntries(Object.keys(before).map(key => [key, after[key] - before[key]]));
}

function noOpComponent(index, { failStart = false } = {}) {
    return {
        name: `synthetic-component-${index}`,
        async initialize() {},
        async start() {
            if (failStart) {
                const error = new Error('Synthetic runtime start fault.');
                error.code = 'SYNTHETIC_RUNTIME_START_FAULT';
                throw error;
            }
        },
        async stop() {},
        async destroy() {}
    };
}

function createRuntime(botId, { componentsPerRuntime, failStart = false } = {}) {
    const components = Array.from({ length: componentsPerRuntime }, (_, index) => noOpComponent(index, {
        failStart: failStart && index === Math.max(0, Math.floor(componentsPerRuntime / 2))
    }));
    return new BotRuntime({
        identity: Object.freeze({ botId }),
        context: Object.freeze({}),
        state: new BotState(),
        lifecycleCoordinator: new LifecycleCoordinator(components, { name: `${botId}:synthetic-lifecycle` }),
        services: Object.freeze({})
    });
}

function createApplication(count, options = {}) {
    const registry = new BotRegistry();
    const application = new Application({ botRegistry: registry, loggerFactory: null, logger: null });
    for (let index = 0; index < count; index += 1) {
        const botId = `scale-bot-${String(index + 1).padStart(3, '0')}`;
        application.registerRuntime(createRuntime(botId, {
            componentsPerRuntime: options.componentsPerRuntime,
            failStart: options.failBotIndex === index
        }));
    }
    return application;
}

async function timed(action) {
    const started = performance.now();
    const value = await action();
    return { value, elapsedMs: performance.now() - started };
}

async function measureEvents(count, eventsPerBot) {
    const eventBus = new EventBus({ maxListeners: Math.max(64, count + 8) });
    const eventName = 'scale:connection-tick';
    eventBus.registerEventScope(eventName, 'connection');
    let deliveredToTarget = 0;
    const unsubscribers = [];
    for (let index = 0; index < count; index += 1) {
        const botId = `scale-bot-${String(index + 1).padStart(3, '0')}`;
        unsubscribers.push(eventBus.on(eventName, event => {
            if (event.botId === botId) deliveredToTarget += 1;
        }));
    }
    const totalEvents = count * eventsPerBot;
    const started = performance.now();
    for (let botIndex = 0; botIndex < count; botIndex += 1) {
        const botId = `scale-bot-${String(botIndex + 1).padStart(3, '0')}`;
        for (let sequence = 0; sequence < eventsPerBot; sequence += 1) {
            eventBus.emit(eventName, { botId, connectionGeneration: 1, sequence });
        }
    }
    const elapsedMs = performance.now() - started;
    for (const unsubscribe of unsubscribers) unsubscribe();
    return {
        totalEvents,
        deliveredToTarget,
        elapsedMs: round(elapsedMs),
        eventsPerSecond: elapsedMs > 0 ? round((totalEvents / elapsedMs) * 1000) : null
    };
}

async function measureCrashIsolation(count, componentsPerRuntime) {
    if (count < 2) return { tested: false, reason: 'requires-at-least-two-runtimes' };
    const failBotIndex = Math.floor(count / 2);
    const application = createApplication(count, { componentsPerRuntime, failBotIndex });
    const initialized = await application.initialize();
    const started = await application.start();
    const rejected = started.filter(result => result.status === 'rejected').length;
    const fulfilled = started.filter(result => result.status === 'fulfilled').length;
    await application.destroy();
    return {
        tested: true,
        runtimeCount: count,
        initializedRejected: initialized.filter(result => result.status === 'rejected').length,
        startedRejected: rejected,
        startedFulfilled: fulfilled,
        blastRadiusRuntimes: rejected,
        isolationObserved: rejected === 1 && fulfilled === count - 1
    };
}

async function measureCount(count, { componentsPerRuntime, eventsPerBot }) {
    if (global.gc) global.gc();
    const before = memorySnapshot();
    const eventLoop = monitorEventLoopDelay({ resolution: 10 });
    eventLoop.enable();
    await new Promise(resolve => setImmediate(resolve));

    const application = createApplication(count, { componentsPerRuntime });
    const initialize = await timed(() => application.initialize());
    const start = await timed(() => application.start());
    const events = await measureEvents(count, eventsPerBot);
    const stop = await timed(() => application.stop());
    const destroy = await timed(() => application.destroy());

    await new Promise(resolve => setTimeout(resolve, 20));
    eventLoop.disable();
    const after = memorySnapshot();
    return {
        botCount: count,
        componentsPerRuntime,
        lifecycle: {
            initializeMs: round(initialize.elapsedMs),
            startMs: round(start.elapsedMs),
            stopMs: round(stop.elapsedMs),
            destroyMs: round(destroy.elapsedMs),
            startRejected: start.value.filter(result => result.status === 'rejected').length
        },
        events,
        memory: {
            before,
            after,
            delta: memoryDelta(before, after),
            rssPerBotDeltaBytes: round((after.rssBytes - before.rssBytes) / count, 0),
            heapUsedPerBotDeltaBytes: round((after.heapUsedBytes - before.heapUsedBytes) / count, 0)
        },
        eventLoopDelayMs: {
            min: Number.isFinite(eventLoop.min) ? round(eventLoop.min / 1e6) : null,
            mean: Number.isFinite(eventLoop.mean) ? round(eventLoop.mean / 1e6) : null,
            max: Number.isFinite(eventLoop.max) ? round(eventLoop.max / 1e6) : null,
            p99: Number.isFinite(eventLoop.percentile(99)) ? round(eventLoop.percentile(99) / 1e6) : null
        }
    };
}

async function measure(options = {}) {
    const counts = parseCounts(options.counts || process.env.MCBOT_SCALE_COUNTS);
    const componentsPerRuntime = positiveInteger(options.componentsPerRuntime || process.env.MCBOT_SCALE_COMPONENTS, DEFAULT_COMPONENTS_PER_RUNTIME);
    const eventsPerBot = positiveInteger(options.eventsPerBot || process.env.MCBOT_SCALE_EVENTS_PER_BOT, DEFAULT_EVENTS_PER_BOT);
    const measurements = [];
    for (const count of counts) measurements.push(await measureCount(count, { componentsPerRuntime, eventsPerBot }));
    const maxCount = counts[counts.length - 1];
    const crashIsolation = await measureCrashIsolation(maxCount, componentsPerRuntime);
    return {
        schema: 'mcbot-scale-baseline/v1',
        schemaVersion: SCHEMA_VERSION,
        capturedAt: new Date().toISOString(),
        environment: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            cpuCount: os.cpus().length,
            totalMemoryBytes: os.totalmem(),
            gcExposed: Boolean(global.gc)
        },
        workload: {
            counts,
            componentsPerRuntime,
            eventsPerBot,
            model: 'synthetic-current-core-primitives',
            caveat: 'No Mineflayer socket, server GUI, pathfinding, Discord network, or live Minecraft workload is included.'
        },
        measurements,
        crashIsolation,
        decisionInput: {
            measurableDriverPresent: false,
            targetBotCountDefined: false,
            latencySloDefined: false,
            memorySloDefined: false,
            failureToleranceDefined: false,
            recommendedWp500State: 'DEFERRED_NO_DRIVER',
            reason: 'Measurement evidence exists, but the repository still has no product bot-count/SLO/failure-tolerance driver. Do not infer a worker requirement from synthetic timing alone.'
        }
    };
}

function validateBaseline(baseline) {
    const failures = [];
    const fail = (code, message) => failures.push({ code, message });
    if (!baseline || typeof baseline !== 'object') return [{ code: 'SCALE_BASELINE_INVALID', message: 'Baseline must be an object.' }];
    if (baseline.schema !== 'mcbot-scale-baseline/v1' || baseline.schemaVersion !== SCHEMA_VERSION) fail('SCALE_BASELINE_SCHEMA', 'Unsupported scale baseline schema.');
    if (!Array.isArray(baseline.measurements) || baseline.measurements.length === 0) fail('SCALE_BASELINE_MEASUREMENTS', 'Measurements are required.');
    else {
        let previous = 0;
        for (const measurement of baseline.measurements) {
            if (!Number.isInteger(measurement.botCount) || measurement.botCount <= previous) fail('SCALE_BASELINE_COUNTS', 'botCount values must be positive and strictly increasing.');
            previous = measurement.botCount;
            if (measurement.lifecycle?.startRejected !== 0) fail('SCALE_BASELINE_CLEAN_START', `Clean workload rejected runtime start at botCount=${measurement.botCount}.`);
            if (measurement.events?.deliveredToTarget !== measurement.events?.totalEvents) fail('SCALE_BASELINE_EVENT_LOSS', `Event delivery mismatch at botCount=${measurement.botCount}.`);
        }
    }
    if (baseline.crashIsolation?.tested && baseline.crashIsolation?.isolationObserved !== true) fail('SCALE_BASELINE_CRASH_ISOLATION', 'Synthetic runtime crash was not isolated to one runtime.');
    const decision = baseline.decisionInput || {};
    if (decision.measurableDriverPresent !== false || decision.recommendedWp500State !== 'DEFERRED_NO_DRIVER') {
        fail('SCALE_BASELINE_DECISION_OVERREACH', 'Scale baseline must not activate WP-500 without an externally defined measurable driver.');
    }
    return failures;
}

async function main() {
    const argv = process.argv.slice(2);
    const args = new Set(argv);
    const validateFileIndex = argv.indexOf('--validate-file');
    if (validateFileIndex >= 0) {
        const requested = argv[validateFileIndex + 1];
        if (!requested) throw new TypeError('--validate-file requires a path.');
        const file = path.resolve(process.cwd(), requested);
        const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
        const failures = validateBaseline(baseline);
        const output = { status: failures.length ? 'FAIL' : 'PASS', failures, file: path.relative(process.cwd(), file).replace(/\\/g, '/'), summary: {
            maxBotCount: baseline.measurements?.at(-1)?.botCount || 0,
            crashIsolationObserved: baseline.crashIsolation?.isolationObserved || false,
            recommendedWp500State: baseline.decisionInput?.recommendedWp500State || null
        } };
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        process.exitCode = failures.length ? 1 : 0;
        return;
    }
    const baseline = await measure();
    const failures = validateBaseline(baseline);
    if (args.has('--check')) {
        const output = { status: failures.length ? 'FAIL' : 'PASS', failures, summary: {
            maxBotCount: baseline.measurements.at(-1)?.botCount || 0,
            crashIsolationObserved: baseline.crashIsolation?.isolationObserved || false,
            recommendedWp500State: baseline.decisionInput.recommendedWp500State
        } };
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        process.exitCode = failures.length ? 1 : 0;
        return;
    }
    process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
    if (failures.length) process.exitCode = 1;
}

if (require.main === module) main().catch(error => {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exitCode = 1;
});

module.exports = { measure, validateBaseline, parseCounts, SCHEMA_VERSION };
