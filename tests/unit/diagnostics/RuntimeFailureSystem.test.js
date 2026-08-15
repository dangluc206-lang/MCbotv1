'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const EventBus = require('../../../src/core/EventBus');
const BotRegistry = require('../../../src/bot/BotRegistry');
const FlowError = require('../../../src/shared/errors/FlowError');
const Logger = require('../../../src/shared/logger/Logger');
const RuntimeFailureRecorder = require('../../../src/diagnostics/runtime/RuntimeFailureRecorder');
const RuntimeFailurePublisher = require('../../../src/diagnostics/runtime/RuntimeFailurePublisher');
const FailureCircuitBreaker = require('../../../src/shared/resilience/FailureCircuitBreaker');
const DiscordErrorReporter = require('../../../src/discord/errors/DiscordErrorReporter');

const recorderConfig = overrides => ({
    enabled: true,
    repeatWindowMs: 60,
    maxFileMb: 1,
    maxTotalMb: 4,
    retentionDays: 14,
    cleanupIntervalMs: 0,
    ...overrides
});

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-runtime-failure-')); }
async function lines(baseDir, botId = 'bot-01') {
    const file = path.join(baseDir, botId, 'errors.jsonl');
    try {
        const text = await fs.readFile(file, 'utf8');
        return text.trim().split('\n').filter(Boolean).map(JSON.parse);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}
function failure(overrides = {}) {
    return {
        failureId: overrides.failureId,
        botId: 'bot-01',
        source: 'test',
        subsystem: 'test',
        severity: 'error',
        code: 'TEST_FAILURE',
        operation: 'TestOperation',
        step: 'run',
        action: 'test',
        resource: 'resource-a',
        message: 'same failure',
        retryable: true,
        occurredAt: new Date().toISOString(),
        ...overrides
    };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('same failureId across event names persists one full record and concurrent duplicates cannot race through', async () => {
    const baseDir = await tempRoot();
    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', baseDir, config: recorderConfig() });
    await Promise.all([
        recorder.record('runtime:failure', failure({ failureId: 'same-id' })),
        recorder.record('mode:collector-b5:error', failure({ failureId: 'same-id' })),
        ...Array.from({ length: 6 }, () => recorder.record('runtime:failure', failure({ failureId: 'same-id' })))
    ]);
    await recorder.stop();
    assert.equal((await lines(baseDir)).filter(record => record.event !== 'runtime:failure-repeat-summary').length, 1);
});

test('legacy events without failureId use full fallback signature and different operations are not merged', async () => {
    const baseDir = await tempRoot();
    let now = 1000;
    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', baseDir, config: recorderConfig(), clock: () => now });
    await recorder.record('legacy:a', failure({ failureId: undefined, operation: 'OperationA' }));
    now += 5;
    await recorder.record('legacy:b', failure({ failureId: undefined, operation: 'OperationA' }));
    now += 5;
    await recorder.record('legacy:c', failure({ failureId: undefined, operation: 'OperationB' }));
    await recorder.stop();
    const records = await lines(baseDir);
    assert.equal(records.filter(record => record.event !== 'runtime:failure-repeat-summary').length, 2);
    assert.equal(records.find(record => record.event === 'runtime:failure-repeat-summary').repeatCount, 1);
});

test('repeat summary has count/duration, stop flushes it, and long storms emit periodic summaries', async () => {
    const baseDir = await tempRoot();
    let now = 1000;
    const flushRecorder = new RuntimeFailureRecorder({
        botId: 'bot-01', baseDir, config: recorderConfig({ repeatWindowMs: 500 }), clock: () => now
    });
    await flushRecorder.record('runtime:failure', failure({ failureId: 'r1' }));
    now = 1200; await flushRecorder.record('runtime:failure', failure({ failureId: 'r2' }));
    now = 1500; await flushRecorder.record('runtime:failure', failure({ failureId: 'r3' }));
    await flushRecorder.stop();
    const flushed = (await lines(baseDir)).find(record => record.event === 'runtime:failure-repeat-summary');
    assert.equal(flushed.repeatCount, 2);
    assert.equal(flushed.durationMs, 500);

    const stormRoot = await tempRoot();
    let stormNow = 10_000;
    const stormRecorder = new RuntimeFailureRecorder({
        botId: 'bot-01', baseDir: stormRoot, config: recorderConfig({ repeatWindowMs: 100 }), clock: () => stormNow
    });
    await stormRecorder.record('runtime:failure', failure({ failureId: 'storm-0' }));
    for (let i = 1; i <= 8; i += 1) {
        stormNow += 30;
        await stormRecorder.record('runtime:failure', failure({ failureId: `storm-${i}` }));
    }
    const duringStorm = await lines(stormRoot);
    assert.equal(duringStorm.some(record => record.event === 'runtime:failure-repeat-summary'), true);
    await stormRecorder.stop();
    assert.equal((await lines(stormRoot)).filter(record => record.event === 'runtime:failure-repeat-summary').length >= 2, true);
});

test('repeatWindowMs=0 disables signature aggregation while stable failureId dedupe remains active', async () => {
    const baseDir = await tempRoot();
    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', baseDir, config: recorderConfig({ repeatWindowMs: 0 }) });
    await recorder.record('runtime:failure', failure({ failureId: 'zero-a' }));
    await recorder.record('runtime:failure', failure({ failureId: 'zero-b' }));
    await recorder.record('legacy', failure({ failureId: 'zero-b' }));
    assert.equal(recorder.repeatBuckets.size, 0);
    assert.equal(recorder.repeatTimer, null);
    await recorder.stop();
    const records = await lines(baseDir);
    assert.equal(records.filter(record => record.event !== 'runtime:failure-repeat-summary').length, 2);
    assert.equal(records.some(record => record.event === 'runtime:failure-repeat-summary'), false);
});

test('cleanupIntervalMs=0 disables the periodic cleanup timer without disabling persistence', async () => {
    const baseDir = await tempRoot();
    const eventBus = new EventBus();
    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', eventBus, baseDir, config: recorderConfig({ cleanupIntervalMs: 0 }) });
    await recorder.initialize();
    await recorder.start();
    assert.equal(recorder.cleanupTimer, null);
    assert.equal(eventBus.listenerCount('runtime:failure'), 1);
    eventBus.emit('runtime:failure', failure({ failureId: 'cleanup-zero' }));
    await delay(5);
    await recorder.stop();
    assert.equal((await lines(baseDir)).length >= 1, true);
});

test('disabled runtimeFailures creates no directory and Discord reporter sends nothing', async () => {
    const baseDir = await tempRoot();
    const eventBus = new EventBus();
    const recorder = new RuntimeFailureRecorder({
        botId: 'bot-01', eventBus, baseDir, config: recorderConfig({ enabled: false })
    });
    await recorder.initialize();
    await recorder.start();
    assert.equal(eventBus.listenerCount('runtime:failure'), 0);
    assert.equal(recorder.repeatTimer, null);
    assert.equal(recorder.cleanupTimer, null);
    eventBus.emit('runtime:failure', failure({ failureId: 'disabled' }));
    await recorder.stop();
    await assert.rejects(fs.stat(path.join(baseDir, 'bot-01')), error => error.code === 'ENOENT');

    const registry = new BotRegistry();
    registry.register({ botId: 'bot-01', getService: name => name === 'eventBus' ? eventBus : null });
    const sent = [];
    const reporter = new DiscordErrorReporter({ botRegistry: registry, enabled: false, duplicateWindowMs: 10 });
    reporter.start({ channel: { send: async payload => sent.push(payload) }, discord: { EmbedBuilder: FakeEmbedBuilder } });
    assert.equal(registry.changeListeners.size, 0);
    assert.equal(eventBus.listenerCount('runtime:failure'), 0);
    eventBus.emit('runtime:failure', failure({ failureId: 'disabled-discord' }));
    await delay(5);
    await reporter.stop();
    assert.equal(sent.length, 0);
    assert.equal(eventBus.listenerCount('runtime:failure'), 0);
});

test('rotation, retention and total quota apply only inside the temp runtime directory', async () => {
    const baseDir = await tempRoot();
    const dir = path.join(baseDir, 'bot-01');
    const config = recorderConfig({ maxFileMb: 0.0015, maxTotalMb: 0.003, retentionDays: 1 });
    await fs.mkdir(dir, { recursive: true });
    const oldRotated = path.join(dir, 'errors-2020-01-01T00-00-00-000Z-0001.jsonl');
    const last = path.join(dir, 'last-error.json');
    await fs.writeFile(oldRotated, 'old');
    await fs.writeFile(last, '{}');
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await fs.utimes(oldRotated, old, old);

    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', baseDir, config });
    await recorder.initialize();
    for (let i = 0; i < 10; i += 1) {
        await recorder.record('runtime:failure', failure({
            failureId: `quota-${i}`,
            operation: `Operation-${i}`,
            message: `${i}-${'x'.repeat(650)}`
        }));
    }
    await recorder.stop();
    await assert.rejects(fs.stat(oldRotated), error => error.code === 'ENOENT');
    assert.equal((await fs.stat(last)).isFile(), true);
    const names = await fs.readdir(dir);
    assert.equal(names.some(name => /^errors-.+\.jsonl$/.test(name)), true);
    let total = 0;
    for (const name of names.filter(name => /^errors(?:-.+)?\.jsonl$/.test(name))) total += (await fs.stat(path.join(dir, name))).size;
    assert.equal(total <= config.maxTotalMb * 1024 * 1024, true);
    assert.equal(path.resolve(dir).startsWith(path.resolve(os.tmpdir())), true);
});

test('end-to-end persistence, logger and Discord redact nested JSON, Bearer and URL credentials', async () => {
    const baseDir = await tempRoot();
    const eventBus = new EventBus();
    const registry = new BotRegistry();
    registry.register({ botId: 'bot-01', getService: name => name === 'eventBus' ? eventBus : null });
    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', eventBus, baseDir, config: recorderConfig() });
    const sent = [];
    const reporter = new DiscordErrorReporter({ botRegistry: registry, enabled: true, duplicateWindowMs: 0 });
    reporter.start({ channel: { send: async payload => sent.push(payload) }, discord: { EmbedBuilder: FakeEmbedBuilder } });
    await recorder.initialize();

    const secrets = ['json-secret', 'escaped-secret', 'bearer-secret', 'query-secret', 'basic-secret', 'nested-secret'];
    const message = 'body={"token":"json-secret"} escaped={\\"password\\":\\"escaped-secret\\"} Authorization: Bearer bearer-secret url=https://user:basic-secret@example.test/api?api_key=query-secret&safe=1';
    eventBus.emit('runtime:failure', failure({
        failureId: 'secret-e2e',
        message,
        details: { nested: { clientSecret: 'nested-secret' }, safe: 'ok' }
    }));
    await delay(10);
    await recorder.stop();
    await reporter.stop();

    const diskText = await fs.readFile(path.join(baseDir, 'bot-01', 'last-error.json'), 'utf8');
    const discordText = JSON.stringify(sent);
    const logRecords = [];
    const logger = new Logger({ scope: 'redaction-test', output: record => logRecords.push(record) });
    logger.error(message, { authorization: 'Bearer nested-secret', url: 'https://u:basic-secret@host/?token=query-secret' });
    const loggerText = JSON.stringify(logRecords);
    for (const secret of secrets) {
        assert.equal(diskText.includes(secret), false, `disk leaked ${secret}`);
        assert.equal(discordText.includes(secret), false, `Discord leaked ${secret}`);
        assert.equal(loggerText.includes(secret), false, `logger leaked ${secret}`);
    }
    assert.match(diskText, /\[REDACTED\]/);
    assert.match(discordText, /\[REDACTED\]/);
});

test('circuit breaker transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED; cancellation does not increment and verified success resets', () => {
    let now = 0;
    const breaker = new FailureCircuitBreaker({
        policy: { baseBackoffMs: 10, maxBackoffMs: 100, multiplier: 2, jitterRatio: 0, maxConsecutiveFailures: 2, openDurationMs: 50 },
        clock: () => now,
        random: () => 0.5
    });
    breaker.recordFailure({ cancelled: true });
    assert.equal(breaker.snapshot().consecutiveFailures, 0);
    breaker.recordFailure({ retryable: true });
    assert.equal(breaker.snapshot().state, 'CLOSED');
    breaker.recordFailure({ retryable: true });
    assert.equal(breaker.snapshot().state, 'OPEN');
    now = 50;
    assert.equal(breaker.beforeAttempt().state, 'HALF_OPEN');
    breaker.recordSuccess({ verified: true });
    assert.equal(breaker.snapshot().state, 'CLOSED');
    assert.equal(breaker.snapshot().consecutiveFailures, 0);
});

test('connection aggregation emits one canonical failure and keeps the richest diagnostic, not first event wins', async () => {
    const eventBus = new EventBus();
    const publisher = new RuntimeFailurePublisher({ botId: 'bot-01', eventBus, connectionAggregationMs: 15 });
    const failures = [];
    eventBus.on('runtime:failure', event => failures.push(event));
    await publisher.initialize();
    eventBus.emit('connection:failed', { botId: 'bot-01', connectionGeneration: 7, message: 'generic fail' });
    eventBus.emit('connection:error', {
        botId: 'bot-01', connectionGeneration: 7,
        error: new FlowError('socket reset with context', {
            code: 'CONNECTION_SOCKET_RESET', subsystem: 'connection', operation: 'ConnectionManager',
            step: 'socket-read', action: 'read packet', resource: 'mc.example.test:25565', retryable: true,
            details: { errno: -4077, syscall: 'read', note: 'rich diagnostic' }, trace: [{ step: 'handshake', status: 'OK' }]
        })
    });
    await delay(30);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].code, 'CONNECTION_SOCKET_RESET');
    assert.equal(failures[0].step, 'socket-read');
    assert.equal(failures[0].details.connectionSignals.length, 2);
    await publisher.stop();
});

class FakeEmbedBuilder {
    constructor() { this.data = { fields: [] }; }
    setTitle(value) { this.data.title = value; return this; }
    addFields(...value) { this.data.fields.push(...value); return this; }
    setFooter(value) { this.data.footer = value; return this; }
}

test('Discord reporter tracks runtime add, remove and replacement while running', async () => {
    const registry = new BotRegistry();
    const sent = [];
    const reporter = new DiscordErrorReporter({ botRegistry: registry, enabled: true, duplicateWindowMs: 0 });
    reporter.start({ channel: { send: async payload => sent.push(payload) }, discord: { EmbedBuilder: FakeEmbedBuilder } });

    const bus1 = new EventBus();
    const runtime1 = { botId: 'bot-01', getService: name => name === 'eventBus' ? bus1 : null };
    registry.register(runtime1);
    bus1.emit('runtime:failure', failure({ failureId: 'dynamic-1' }));
    await reporter.sendChain;
    assert.equal(sent.length, 1);

    assert.equal(registry.remove('bot-01', runtime1), true);
    bus1.emit('runtime:failure', failure({ failureId: 'removed-1' }));
    await reporter.sendChain;
    assert.equal(sent.length, 1);

    const bus2 = new EventBus();
    const runtime2 = { botId: 'bot-01', getService: name => name === 'eventBus' ? bus2 : null };
    registry.register(runtime2);
    bus2.emit('runtime:failure', failure({ failureId: 'dynamic-2', operation: 'ReplacementRuntime' }));
    await reporter.sendChain;
    assert.equal(sent.length, 2);
    assert.equal(bus1.listenerCount('runtime:failure'), 0);
    assert.equal(bus2.listenerCount('runtime:failure'), 1);

    registry.remove('bot-01', runtime2);
    assert.equal(bus2.listenerCount('runtime:failure'), 0);
    await reporter.stop();
});

test('Discord dedupes one physical failure and sends one repeat summary instead of one embed per retry', async () => {
    const registry = new BotRegistry();
    const eventBus = new EventBus();
    registry.register({ botId: 'bot-01', getService: name => name === 'eventBus' ? eventBus : null });
    const sent = [];
    const reporter = new DiscordErrorReporter({ botRegistry: registry, enabled: true, duplicateWindowMs: 30 });
    reporter.start({ channel: { send: async payload => sent.push(payload) }, discord: { EmbedBuilder: FakeEmbedBuilder } });
    const first = failure({ failureId: 'discord-same' });
    eventBus.emit('runtime:failure', first);
    eventBus.emit('runtime:failure', first);
    for (let i = 0; i < 4; i += 1) eventBus.emit('runtime:failure', failure({ failureId: `discord-repeat-${i}` }));
    await reporter.sendChain;
    assert.equal(sent.length, 1);
    await reporter.stop();
    assert.equal(sent.length, 2);
    assert.equal(eventBus.listenerCount('runtime:failure'), 0);
});

test('recorder stop removes listener, flushes write queue and clears timers', async () => {
    const baseDir = await tempRoot();
    const eventBus = new EventBus();
    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', eventBus, baseDir, config: recorderConfig({ cleanupIntervalMs: 20 }) });
    await recorder.initialize();
    await recorder.start();
    assert.equal(eventBus.listenerCount('runtime:failure'), 1);
    eventBus.emit('runtime:failure', failure({ failureId: 'stop-1' }));
    await recorder.stop();
    assert.equal(eventBus.listenerCount('runtime:failure'), 0);
    assert.equal(recorder.repeatTimer, null);
    assert.equal(recorder.cleanupTimer, null);
    assert.equal((await lines(baseDir)).length >= 1, true);
});