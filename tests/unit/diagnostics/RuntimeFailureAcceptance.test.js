'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const EventBus = require('../../../src/core/EventBus');
const BotRegistry = require('../../../src/bot/BotRegistry');
const Logger = require('../../../src/shared/logger/Logger');
const Redactor = require('../../../src/shared/security/Redactor');
const RuntimeFailureRecorder = require('../../../src/diagnostics/runtime/RuntimeFailureRecorder');
const RuntimeFailurePublisher = require('../../../src/diagnostics/runtime/RuntimeFailurePublisher');
const DiscordErrorReporter = require('../../../src/discord/errors/DiscordErrorReporter');
const { createFailureEvent } = require('../../../src/diagnostics/runtime/RuntimeFailureEvent');
const validateApp = require('../../../src/configuration/schemas/app.schema');
const validateBot = require('../../../src/configuration/schemas/bot.schema');

const MB = 1024 * 1024;
const baseConfig = overrides => ({
    enabled: true,
    repeatWindowMs: 100,
    connectionAggregationMs: 0,
    maxFileMb: 1,
    maxTotalMb: 4,
    retentionDays: 14,
    cleanupIntervalMs: 0,
    ...overrides
});

async function tempRoot(prefix = 'mcbot-runtime-accept-') {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readJsonLines(baseDir, botId = 'bot-01') {
    const text = await fs.readFile(path.join(baseDir, botId, 'errors.jsonl'), 'utf8');
    return text.trim().split('\n').filter(Boolean).map(JSON.parse);
}

function canonical(overrides = {}) {
    return {
        failureId: 'failure-a',
        botId: 'bot-01',
        connectionGeneration: 3,
        source: 'test',
        subsystem: 'test',
        severity: 'error',
        code: 'TEST_FAILURE',
        operation: 'AcceptanceOperation',
        step: 'run',
        action: 'test',
        resource: 'resource-a',
        message: 'failure',
        retryable: true,
        occurredAt: '2026-08-15T00:00:00.000Z',
        ...overrides
    };
}

class FakeEmbedBuilder {
    constructor() { this.data = { fields: [] }; }
    setTitle(value) { this.data.title = value; return this; }
    addFields(...fields) { this.data.fields.push(...fields); return this; }
    setFooter(value) { this.data.footer = value; return this; }
}

test('redaction is idempotent and end-to-end output never leaks escaped, numeric, Bearer, URL or nested secrets', async () => {
    const baseDir = await tempRoot();
    const eventBus = new EventBus();
    const registry = new BotRegistry();
    registry.register({ botId: 'bot-01', getService: name => name === 'eventBus' ? eventBus : null });
    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', eventBus, baseDir, config: baseConfig() });
    const sent = [];
    const reporter = new DiscordErrorReporter({ botRegistry: registry, enabled: true, duplicateWindowMs: 0 });
    reporter.start({ channel: { send: async payload => sent.push(payload) }, discord: { EmbedBuilder: FakeEmbedBuilder } });
    await recorder.initialize();

    const markers = [
        'ESCAPED-SUFFIX-991', '42424242', '77773333', 'BEARER-991', 'QUERY-991',
        'BASIC-991', 'NESTED-991', 'CAUSE-991', 'ACCESS-991', 'CLIENT-991',
        'BACKSLASH-991', 'SINGLE-991', 'HEADER-991'
    ];
    const rawText = [
        '{"token":"prefix\\"ESCAPED-SUFFIX-991"}',
        '{"clientSecret":"prefix\\\\BACKSLASH-991"}',
        '{"password":42424242}',
        '"apiKey": 77773333',
        "{'pwd':'SINGLE-991','refresh_token':null,'secret':true}",
        'Authorization: Bearer BEARER-991',
        'https://user:BASIC-991@example.test/api?api_key=QUERY-991&safe=1',
        'accessToken=ACCESS-991 client-secret=CLIENT-991 password=HEADER-991'
    ].join(' ');
    const onceRedacted = Redactor.redactText(rawText);
    assert.equal(Redactor.redactText(onceRedacted), onceRedacted);
    assert.equal(onceRedacted.includes("'secret':true"), false);
    assert.equal(onceRedacted.includes("'refresh_token':null"), false);

    const cause = new Error('cause token=CAUSE-991');
    cause.stack = `Error: cause token=CAUSE-991\n at test`;
    const mutableDetails = { nested: { password: 'NESTED-991' }, cause, url: 'https://u:BASIC-991@host/?token=QUERY-991' };
    const runtimeFailure = createFailureEvent({
        ...canonical({ failureId: 'redaction-e2e', message: rawText }),
        details: mutableDetails,
        diagnostic: { details: mutableDetails, stack: `Authorization: Bearer BEARER-991` }
    });
    mutableDetails.nested.password = 'MUTATED-AFTER-EVENT';
    eventBus.emit('runtime:failure', runtimeFailure);

    const loggerRecords = [];
    const logger = new Logger({ scope: 'acceptance-redaction', output: record => loggerRecords.push(record) });
    logger.error(rawText, { details: mutableDetails, cause });

    await recorder.stop();
    await reporter.stop();
    const outputs = [
        await fs.readFile(path.join(baseDir, 'bot-01', 'errors.jsonl'), 'utf8'),
        await fs.readFile(path.join(baseDir, 'bot-01', 'last-error.json'), 'utf8'),
        JSON.stringify(sent),
        JSON.stringify(loggerRecords),
        JSON.stringify(runtimeFailure)
    ].join('\n');
    for (const marker of markers) assert.equal(outputs.includes(marker), false, `leaked ${marker}`);
    assert.equal(outputs.includes('MUTATED-AFTER-EVENT'), false, 'canonical event kept a mutable caller reference');
    assert.match(outputs, /\[REDACTED\]/);
});

test('recorder dedupes by event arrival time even while the first inventory capture blocks the write queue', async () => {
    const baseDir = await tempRoot();
    let now = 1000;
    let releaseCapture;
    let captureEntered;
    const entered = new Promise(resolve => { captureEntered = resolve; });
    const gate = new Promise(resolve => { releaseCapture = resolve; });
    let captures = 0;
    const recorder = new RuntimeFailureRecorder({
        botId: 'bot-01',
        baseDir,
        config: baseConfig({ repeatWindowMs: 25 }),
        clock: () => now,
        inventoryObservationService: {
            async capture() {
                captures += 1;
                if (captures === 1) {
                    captureEntered();
                    await gate;
                }
                return null;
            }
        }
    });

    const first = recorder.record('runtime:failure', canonical({ failureId: 'arrival-1', message: 'arrival duplicate' }));
    await entered;
    now = 1005;
    const second = recorder.record('runtime:failure', canonical({ failureId: 'arrival-2', message: 'arrival duplicate' }));
    now = 1070;
    releaseCapture();
    await Promise.all([first, second]);
    await recorder.stop();
    const records = await readJsonLines(baseDir);
    assert.equal(records.filter(record => record.event === 'runtime:failure').length, 1);
    const summary = records.find(record => record.event === 'runtime:failure-repeat-summary');
    assert.equal(summary.repeatCount, 1);
});

test('continuous repeat storm emits fixed-window summaries without a sliding debounce', async () => {
    const baseDir = await tempRoot();
    let now = 10_000;
    const recorder = new RuntimeFailureRecorder({
        botId: 'bot-01', baseDir, config: baseConfig({ repeatWindowMs: 100 }), clock: () => now
    });
    await recorder.record('runtime:failure', canonical({ failureId: 'storm-0', message: 'storm' }));
    for (let i = 1; i <= 8; i += 1) {
        now += 30;
        await recorder.record('runtime:failure', canonical({ failureId: `storm-${i}`, message: 'storm' }));
    }
    const beforeStop = await readJsonLines(baseDir);
    assert.equal(beforeStop.some(record => record.event === 'runtime:failure-repeat-summary'), true);
    await recorder.stop();
    const summaries = (await readJsonLines(baseDir)).filter(record => record.event === 'runtime:failure-repeat-summary');
    assert.equal(summaries.length >= 2, true);
    assert.equal(summaries.every(summary => summary.repeatCount > 0 && summary.durationMs >= 0), true);
});

test('recorder rejects traversal bot IDs and cleanup cannot remove sibling or unrelated files', async () => {
    const root = await tempRoot();
    const intendedBase = path.join(root, 'intended-base');
    const victim = path.join(root, 'victim');
    await fs.mkdir(victim, { recursive: true });
    const victimFile = path.join(victim, 'errors-outside.jsonl');
    await fs.writeFile(victimFile, 'keep');
    for (const botId of ['../victim', '..\\victim', '/absolute', 'C:\\victim']) {
        assert.throws(() => new RuntimeFailureRecorder({ botId, baseDir: intendedBase, config: baseConfig() }));
    }
    assert.equal(await fs.readFile(victimFile, 'utf8'), 'keep');

    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', baseDir: intendedBase, config: baseConfig({ retentionDays: 1 }) });
    await recorder.initialize();
    const botDir = path.join(intendedBase, 'bot-01');
    const unrelated = path.join(botDir, 'errors-not-a-runtime-rotation.jsonl');
    await fs.writeFile(unrelated, 'keep-me');
    const oldRotated = path.join(botDir, 'errors-2020-01-01T00-00-00-000Z-0001.jsonl');
    await fs.writeFile(oldRotated, 'old');
    const oldDate = new Date('2020-01-01T00:00:00.000Z');
    await fs.utimes(oldRotated, oldDate, oldDate);
    await recorder.stop();
    assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep-me');
    await assert.rejects(fs.stat(oldRotated), error => error.code === 'ENOENT');
    assert.equal(await fs.readFile(victimFile, 'utf8'), 'keep');
});

test('oversized first record is safely truncated and cannot exceed maxFile or maxTotal quota', async () => {
    const baseDir = await tempRoot();
    const config = baseConfig({ repeatWindowMs: 0, maxFileMb: 0.001, maxTotalMb: 0.001, retentionDays: 0 });
    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', baseDir, config });
    await recorder.record('runtime:failure', canonical({
        failureId: 'oversized',
        message: 'M'.repeat(7500),
        details: { stack: 'S'.repeat(7500), nested: { payload: 'P'.repeat(7500) } }
    }));
    await recorder.stop();
    const active = path.join(baseDir, 'bot-01', 'errors.jsonl');
    const stat = await fs.stat(active);
    assert.equal(stat.size <= config.maxFileMb * MB, true);
    assert.equal(stat.size <= config.maxTotalMb * MB, true);
    const [record] = await readJsonLines(baseDir);
    assert.equal(record.truncated, true);
    assert.equal(record.originalBytes > stat.size, true);
    assert.equal((await fs.stat(path.join(baseDir, 'bot-01', 'last-error.json'))).isFile(), true);
    assert.throws(() => new RuntimeFailureRecorder({
        botId: 'bot-01', baseDir, config: baseConfig({ maxFileMb: 0.0005, maxTotalMb: 1 })
    }), /too small/i);
});

test('retentionDays=0 disables age deletion and same-millisecond rotations remain unique while quota stays bounded', async () => {
    const baseDir = await tempRoot();
    const botDir = path.join(baseDir, 'bot-01');
    await fs.mkdir(botDir, { recursive: true });
    const oldRotated = path.join(botDir, 'errors-2020-01-01T00-00-00-000Z-0001.jsonl');
    await fs.writeFile(oldRotated, 'old-but-retained\n');
    const oldDate = new Date('2020-01-01T00:00:00.000Z');
    await fs.utimes(oldRotated, oldDate, oldDate);

    const fixedNow = Date.parse('2026-08-15T00:00:00.000Z');
    const config = baseConfig({ repeatWindowMs: 0, maxFileMb: 0.0012, maxTotalMb: 0.0048, retentionDays: 0 });
    const recorder = new RuntimeFailureRecorder({ botId: 'bot-01', baseDir, config, clock: () => fixedNow });
    await recorder.initialize();
    assert.equal((await fs.stat(oldRotated)).isFile(), true, 'retentionDays=0 must not age-delete an old valid rotation');
    for (let index = 0; index < 8; index += 1) {
        await recorder.record('runtime:failure', canonical({
            failureId: `rotation-${index}`,
            operation: `Rotation-${index}`,
            message: `${index}-${'x'.repeat(620)}`
        }));
    }
    await recorder.stop();
    const names = (await fs.readdir(botDir)).filter(name => /^errors-.*\.jsonl$/.test(name));
    assert.equal(new Set(names.map(name => name.toLowerCase())).size, names.length, 'rotation names must never collide');
    let total = 0;
    for (const name of names) total += (await fs.stat(path.join(botDir, name))).size;
    assert.equal(total <= config.maxTotalMb * MB, true);
});

async function aggregateConnection(firstEvent, secondEvent) {
    const eventBus = new EventBus();
    const publisher = new RuntimeFailurePublisher({ botId: 'bot-01', eventBus, connectionAggregationMs: 0 });
    const failures = [];
    eventBus.on('runtime:failure', event => failures.push(event));
    await publisher.initialize();
    eventBus.emit(firstEvent.name, firstEvent.payload);
    eventBus.emit(secondEvent.name, secondEvent.payload);
    await new Promise(resolve => setImmediate(resolve));
    await publisher.stop();
    return failures;
}

test('connection aggregation keeps the richest diagnostic in both event orders', async () => {
    const generic = {
        name: 'connection:failed',
        payload: { botId: 'bot-01', connectionGeneration: 9, message: 'generic connection failed' }
    };
    const rich = {
        name: 'connection:error',
        payload: {
            botId: 'bot-01', connectionGeneration: 9,
            diagnostic: {
                code: 'ECONNRESET', subsystem: 'connection', operation: 'ConnectionManager', step: 'socket-read',
                action: 'read socket', resource: 'mc.example:25565', retryable: true,
                message: 'read ECONNRESET', details: { failureClass: 'connection-reset', errno: -4077 }, stack: 'rich-stack'
            }
        }
    };
    for (const pair of [[generic, rich], [rich, generic]]) {
        const failures = await aggregateConnection(...pair);
        assert.equal(failures.length, 1);
        assert.equal(failures[0].code, 'ECONNRESET');
        assert.equal(failures[0].step, 'socket-read');
        assert.equal(failures[0].diagnostic.details.failureClass, 'connection-reset');
        assert.equal(failures[0].details.connectionSignals.length, 2);
    }
});

test('connection publisher stop flushes a pending incident and removes all legacy listeners and timers', async () => {
    const eventBus = new EventBus();
    const publisher = new RuntimeFailurePublisher({ botId: 'bot-01', eventBus, connectionAggregationMs: 60_000 });
    const failures = [];
    eventBus.on('runtime:failure', event => failures.push(event));
    await publisher.initialize();
    eventBus.emit('connection:failed', { botId: 'bot-01', connectionGeneration: 4, message: 'pending failure' });
    assert.equal(publisher.connectionIncidents.size, 1);
    await publisher.stop();
    assert.equal(failures.length, 1);
    assert.equal(publisher.connectionIncidents.size, 0);
    for (const name of ['connection:error', 'connection:kicked', 'connection:failed', 'connection:ended']) {
        assert.equal(eventBus.listenerCount(name), 0, name);
    }
});

test('Discord failureId dedupe is bot-scoped and repeated start does not duplicate registry/runtime listeners', async () => {
    const registry = new BotRegistry();
    const bus1 = new EventBus();
    const bus2 = new EventBus();
    registry.register({ botId: 'bot-01', getService: name => name === 'eventBus' ? bus1 : null });
    registry.register({ botId: 'bot-02', getService: name => name === 'eventBus' ? bus2 : null });
    const sent = [];
    const reporter = new DiscordErrorReporter({ botRegistry: registry, enabled: true, duplicateWindowMs: 0 });
    const startArgs = { channel: { send: async payload => sent.push(payload) }, discord: { EmbedBuilder: FakeEmbedBuilder } };
    reporter.start(startArgs);
    reporter.start(startArgs);
    assert.equal(bus1.listenerCount('runtime:failure'), 1);
    assert.equal(bus2.listenerCount('runtime:failure'), 1);
    assert.equal(registry.changeListeners.size, 1);
    bus1.emit('runtime:failure', canonical({ botId: 'bot-01', failureId: 'shared-id' }));
    bus2.emit('runtime:failure', canonical({ botId: 'bot-02', failureId: 'shared-id' }));
    await reporter.sendChain;
    assert.equal(sent.length, 2);
    await reporter.stop();
    assert.equal(registry.changeListeners.size, 0);
    assert.equal(bus1.listenerCount('runtime:failure'), 0);
    assert.equal(bus2.listenerCount('runtime:failure'), 0);
});

test('Discord continuous storm emits repeat summaries periodically before stop and flushes the final bucket on stop', async () => {
    let now = 1_000;
    const registry = new BotRegistry();
    const eventBus = new EventBus();
    registry.register({ botId: 'bot-01', getService: name => name === 'eventBus' ? eventBus : null });
    const sent = [];
    const reporter = new DiscordErrorReporter({ botRegistry: registry, enabled: true, duplicateWindowMs: 100, clock: () => now });
    reporter.start({ channel: { send: async payload => sent.push(payload) }, discord: { EmbedBuilder: FakeEmbedBuilder } });
    eventBus.emit('runtime:failure', canonical({ failureId: 'discord-storm-0', message: 'discord storm' }));
    for (let index = 1; index <= 8; index += 1) {
        now += 30;
        eventBus.emit('runtime:failure', canonical({ failureId: `discord-storm-${index}`, message: 'discord storm' }));
        await reporter.sendChain;
    }
    assert.equal(sent.length >= 2, true, 'initial message plus a periodic summary must be sent before stop');
    const beforeStop = sent.length;
    await reporter.stop();
    assert.equal(sent.length >= beforeStop, true);
    assert.equal(reporter.timer, null);
    assert.equal(eventBus.listenerCount('runtime:failure'), 0);
    assert.equal(registry.changeListeners.size, 0);
});

test('BotRegistry listener exceptions cannot roll back or half-apply registry mutation', () => {
    const registry = new BotRegistry();
    registry.onChange(() => { throw new Error('listener failed'); });
    const runtime = { botId: 'bot-01' };
    assert.doesNotThrow(() => registry.register(runtime));
    assert.equal(registry.get('bot-01'), runtime);
    assert.doesNotThrow(() => registry.remove('bot-01', runtime));
    assert.equal(registry.has('bot-01'), false);
});

test('botId and diagnostics directory/file quota schema enforce the runtime failure path contract', () => {
    assert.equal(validateBot({ id: 'bot-01', enabled: false }).valid, true);
    for (const id of ['a', '../victim', '..\\victim', 'BOT-01', 'a/b']) {
        assert.equal(validateBot({ id, enabled: false }).valid, false, id);
    }

    const app = {
        diagnostics: {
            runtimeFailures: baseConfig({ directory: 'data/runtime/errors' }),
            circuitBreaker: {
                baseBackoffMs: 0, maxBackoffMs: 100, multiplier: 1, jitterRatio: 0,
                maxConsecutiveFailures: 1, openDurationMs: 0
            }
        }
    };
    assert.equal(validateApp(app).valid, true);
    assert.equal(validateApp({
        ...app,
        diagnostics: { ...app.diagnostics, runtimeFailures: { ...app.diagnostics.runtimeFailures, directory: '../outside' } }
    }).valid, false);
    assert.equal(validateApp({
        ...app,
        diagnostics: { ...app.diagnostics, runtimeFailures: { ...app.diagnostics.runtimeFailures, maxFileMb: 0.0005 } }
    }).valid, false);
});