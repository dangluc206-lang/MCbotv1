'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const BotContext=require('../../../src/bot/BotContext');const SessionManager=require('../../../src/connection/SessionManager');const ConnectionManager=require('../../../src/connection/ConnectionManager');const ReconnectManager=require('../../../src/connection/ReconnectManager');const EventBus=require('../../../src/core/EventBus');
function fakeClient(){const bot=new EventEmitter();bot.endReason=null;bot.end=reason=>{bot.endReason=reason;bot.emit('end',reason);};return bot;}
test('durable startup policy can suppress auto-connect without disabling manual connect',async()=>{const context=new BotContext('a');const eventBus=new EventBus();let creates=0;let disabled=0;eventBus.on('connection:disabled',()=>{disabled+=1;});const client=fakeClient();const manager=new ConnectionManager({botId:'a',context,sessionManager:new SessionManager({botId:'a'}),connectionFactory:{create:()=>{creates+=1;return client;}},profile:{enabled:true},autoConnect:false,server:{},eventBus,readyTimeoutMs:50});assert.equal(await manager.start(),null);assert.equal(creates,0);assert.equal(disabled,1);const pending=manager.connect();queueMicrotask(()=>client.emit('spawn'));assert.equal(await pending,client);assert.equal(creates,1);await manager.stop();});
test('connection attaches on spawn and detaches only current client',async()=>{const context=new BotContext('a');const session=new SessionManager({botId:'a'});const eventBus=new EventBus();const first=fakeClient();const manager=new ConnectionManager({botId:'a',context,sessionManager:session,connectionFactory:{create:()=>first},profile:{enabled:true},server:{},eventBus,readyTimeoutMs:50});const pending=manager.connect();queueMicrotask(()=>first.emit('spawn'));assert.equal(await pending,first);assert.equal(context.require(),first);await manager.stop();assert.equal(context.has(),false);});
test('connection timeout cleans attached client',async()=>{const context=new BotContext('a');const client=fakeClient();const manager=new ConnectionManager({botId:'a',context,sessionManager:new SessionManager({botId:'a'}),connectionFactory:{create:()=>client},profile:{enabled:true},server:{},eventBus:new EventBus(),readyTimeoutMs:5});await assert.rejects(()=>manager.connect(),error=>error.code==='TIMEOUT');assert.equal(context.has(),false);assert.equal(client.listenerCount('spawn'),0);assert.equal(client.listenerCount('error'),0);assert.equal(client.listenerCount('end'),0);});

test('connection emits login and spawn diagnostics before becoming ready', async () => {
    const context = new BotContext('a');
    const client = fakeClient();
    const eventBus = new EventBus();
    const events = [];
    const records = [];
    eventBus.on('connection:login', event => events.push(['login', event]));
    eventBus.on('connection:spawned', event => events.push(['spawned', event]));

    const manager = new ConnectionManager({
        botId: 'a',
        context,
        sessionManager: new SessionManager({ botId: 'a' }),
        connectionFactory: { create: () => client },
        profile: { enabled: true, username: 'BotA', auth: 'offline', version: false },
        server: { host: '127.0.0.1', port: 25565 },
        eventBus,
        logger: {
            info: (message, meta) => records.push({ level: 'info', message, meta }),
            warn: (message, meta) => records.push({ level: 'warn', message, meta }),
            error: (message, meta) => records.push({ level: 'error', message, meta }),
            debug: () => {}
        },
        readyTimeoutMs: 50
    });

    const pending = manager.connect();
    queueMicrotask(() => {
        client.emit('login');
        client.emit('spawn');
    });

    await pending;
    assert.deepEqual(events.map(([name]) => name), ['login', 'spawned']);
    assert.equal(records.some(record => record.message === 'Connecting Minecraft bot.'), true);
    assert.equal(records.some(record => record.message === 'Minecraft login completed.'), true);
    assert.equal(records.some(record => record.message === 'Minecraft bot spawned.'), true);
    await manager.destroy();
});

test('initial start failure is reported without tearing down runtime lifecycle', async () => {
    const context = new BotContext('a');
    const client = fakeClient();
    const eventBus = new EventBus();
    const failures = [];
    eventBus.on('connection:failed', event => failures.push(event));

    const manager = new ConnectionManager({
        botId: 'a',
        context,
        sessionManager: new SessionManager({ botId: 'a' }),
        connectionFactory: { create: () => client },
        profile: { enabled: true, username: 'BotA' },
        server: { host: '127.0.0.1', port: 25565 },
        eventBus,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        readyTimeoutMs: 50
    });

    const pending = manager.start();
    queueMicrotask(() => client.emit('error', new Error('refused')));
    assert.equal(await pending, null);
    assert.equal(failures.length, 1);
    assert.equal(context.has(), false);
});


test('reconnect manager retries after initial connection failure', async () => {
    const eventBus = new EventBus();
    let attempts = 0;
    const connectionManager = {
        async connect() {
            attempts += 1;
            if (attempts === 1) throw new Error('first retry failed');
            return { connected: true };
        }
    };
    const reconnect = new ReconnectManager({
        botId: 'a',
        connectionManager,
        eventBus,
        policy: { enabled: true, maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
        logger: { info() {}, warn() {}, error() {} }
    });

    await reconnect.initialize();
    await reconnect.start();
    eventBus.emit('connection:failed', { botId: 'a', connectionGeneration: 1, error: new Error('initial') });

    const startedAt = Date.now();
    while (attempts < 2 && Date.now() - startedAt < 100) {
        await new Promise(resolve => setTimeout(resolve, 2));
    }

    assert.equal(attempts, 2);
    assert.equal(reconnect.attempts, 0);
    await reconnect.destroy();
    assert.equal(reconnect.timer, null);
});

test('connection classifies login-too-fast kick and releases global handshake gate with that class', async () => {
    const context = new BotContext('a');
    const client = fakeClient();
    const eventBus = new EventBus();
    const failures = [];
    const releases = [];
    eventBus.on('connection:failed', event => failures.push(event));
    const manager = new ConnectionManager({
        botId: 'a',
        context,
        sessionManager: new SessionManager({ botId: 'a' }),
        connectionFactory: { create: () => client },
        profile: { enabled: true, username: 'BotA' },
        server: { host: 'server', port: 25565 },
        eventBus,
        attemptCoordinator: {
            async acquireTurn() {
                return { release: payload => releases.push(payload) };
            }
        },
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        readyTimeoutMs: 50
    });

    const pending = manager.connect();
    queueMicrotask(() => {
        client.emit('kicked', '{"text":"Bạn đăng nhập quá nhanh, hãy thử lại sau."}');
        client.emit('end', 'socketClosed');
    });
    await assert.rejects(() => pending);
    assert.equal(failures[0].error.details.failureClass, 'login-too-fast');
    assert.equal(releases[0].outcome, 'failure');
    assert.equal(releases[0].failureClass, 'login-too-fast');
});

test('connection classifies ECONNRESET before spawn', async () => {
    const context = new BotContext('a');
    const client = fakeClient();
    const eventBus = new EventBus();
    const failures = [];
    eventBus.on('connection:failed', event => failures.push(event));
    const manager = new ConnectionManager({
        botId: 'a', context,
        sessionManager: new SessionManager({ botId: 'a' }),
        connectionFactory: { create: () => client },
        profile: { enabled: true }, server: {}, eventBus,
        logger: { info() {}, warn() {}, error() {}, debug() {} }, readyTimeoutMs: 50
    });
    const pending = manager.connect();
    queueMicrotask(() => {
        const error = new Error('read ECONNRESET');
        error.code = 'ECONNRESET';
        client.emit('error', error);
    });
    await assert.rejects(() => pending);
    assert.equal(failures[0].error.details.failureClass, 'connection-reset');
});

test('reconnect schedule is extended when a richer login-too-fast failure arrives after end', async () => {
    const eventBus = new EventBus();
    let attempts = 0;
    const reconnect = new ReconnectManager({
        botId: 'a',
        connectionManager: { async connect() { attempts += 1; return {}; } },
        eventBus,
        policy: { enabled: true, maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5 },
        attemptCoordinator: { cooldownForFailure: kind => kind === 'login-too-fast' ? 30 : 5 },
        logger: { info() {}, warn() {}, error() {} }
    });
    await reconnect.initialize();
    await reconnect.start();

    eventBus.emit('connection:ended', { botId: 'a', connectionGeneration: 1, intentional: false, reason: 'socketClosed' });
    eventBus.emit('connection:failed', {
        botId: 'a',
        connectionGeneration: 1,
        error: { message: 'ended', details: { failureClass: 'login-too-fast' } }
    });

    await new Promise(resolve => setTimeout(resolve, 12));
    assert.equal(attempts, 0, 'the original short reconnect timer must be extended');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(attempts, 1);
    await reconnect.destroy();
});

test('ReconnectManager ignores stale failure/end/spawn from an older generation and keeps current state untouched', async () => {
    const context = new BotContext('a');
    const current = fakeClient();
    context.attach(fakeClient());
    context.detach(context.get());
    const currentGeneration = context.attach(current);
    assert.equal(currentGeneration, 2);
    const eventBus = new EventBus();
    let attempts = 0;
    const reconnect = new ReconnectManager({
        botId: 'a', context,
        connectionManager: { async connect() { attempts += 1; return {}; } },
        eventBus,
        policy: { enabled: true, maxAttempts: 2, baseDelayMs: 5, maxDelayMs: 5 },
        logger: { info() {}, warn() {}, error() {} }
    });
    await reconnect.initialize();
    await reconnect.start();

    eventBus.emit('connection:ended', { botId: 'a', connectionGeneration: 1, intentional: false, reason: 'stale-end' });
    eventBus.emit('connection:failed', { botId: 'a', connectionGeneration: 1, error: new Error('stale-failure') });
    eventBus.emit('connection:spawned', { botId: 'a', connectionGeneration: 1 });
    await new Promise(resolve => setTimeout(resolve, 12));

    assert.equal(reconnect.timer, null);
    assert.equal(reconnect.attempts, 0);
    assert.equal(attempts, 0);
    assert.equal(context.get(), current);
    assert.equal(context.getGeneration(), 2);
    await reconnect.destroy();
});

test('ReconnectManager still schedules a matching current-generation failure', async () => {
    const context = new BotContext('a');
    const current = fakeClient();
    const generation = context.attach(current);
    const eventBus = new EventBus();
    const reconnect = new ReconnectManager({
        botId: 'a', context,
        connectionManager: { async connect() { return {}; } },
        eventBus,
        policy: { enabled: true, maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 100 },
        logger: { info() {}, warn() {}, error() {} }
    });
    await reconnect.initialize();
    await reconnect.start();
    eventBus.emit('connection:failed', { botId: 'a', connectionGeneration: generation, error: new Error('current-failure') });
    assert.notEqual(reconnect.timer, null);
    assert.equal(reconnect.pendingGeneration, generation);
    await reconnect.destroy();
});

test('requestReconnect closes only the current connection through ConnectionManager capability', async () => {
    const context = new BotContext('a');
    const client = fakeClient();
    context.attach(client);
    const logs = [];
    const manager = new ConnectionManager({
        botId: 'a', context,
        sessionManager: new SessionManager({ botId: 'a' }),
        connectionFactory: { create: () => client },
        profile: { enabled: true }, server: {}, eventBus: new EventBus(),
        logger: { info() {}, debug() {}, error() {}, warn: (message, meta) => logs.push({ message, meta }) },
        readyTimeoutMs: 50
    });
    assert.equal(await manager.requestReconnect('fishing probe requested reconnect'), true);
    assert.equal(client.endReason, 'fishing probe requested reconnect');
    assert.equal(logs.some(entry => entry.message.includes('reconnect requested')), true);
});

test('requestReconnect honors a matching expected generation and ends exactly the current client once', async () => {
    const context = new BotContext('a');
    const client = fakeClient();
    let ends = 0;
    client.end = reason => { ends += 1; client.endReason = reason; };
    const generation = context.attach(client);
    const manager = new ConnectionManager({
        botId: 'a', context,
        sessionManager: new SessionManager({ botId: 'a' }),
        connectionFactory: { create: () => client },
        profile: { enabled: true }, server: {}, eventBus: new EventBus(),
        logger: { info() {}, debug() {}, error() {}, warn() {} },
        readyTimeoutMs: 50
    });
    assert.equal(await manager.requestReconnect('matching generation', { expectedGeneration: generation }), true);
    assert.equal(ends, 1);
    assert.equal(client.endReason, 'matching generation');
});

test('requestReconnect ignores a stale expected generation and cannot end the replacement client', async () => {
    const context = new BotContext('a');
    const oldClient = fakeClient();
    const oldGeneration = context.attach(oldClient);
    assert.equal(context.detach(oldClient), true);
    const replacement = fakeClient();
    let replacementEnds = 0;
    replacement.end = () => { replacementEnds += 1; };
    const currentGeneration = context.attach(replacement);
    assert.notEqual(currentGeneration, oldGeneration);
    const ended = [];
    const eventBus = new EventBus();
    eventBus.on('connection:ended', event => ended.push(event));
    const manager = new ConnectionManager({
        botId: 'a', context,
        sessionManager: new SessionManager({ botId: 'a' }),
        connectionFactory: { create: () => replacement },
        profile: { enabled: true }, server: {}, eventBus,
        logger: { info() {}, debug() {}, error() {}, warn() {} },
        readyTimeoutMs: 50
    });
    assert.equal(await manager.requestReconnect('stale recovery', { expectedGeneration: oldGeneration }), false);
    assert.equal(replacementEnds, 0);
    assert.equal(ended.length, 0);
    assert.equal(context.get(), replacement);
});

test('requestReconnect returns false when the current client has no end capability', async () => {
    const context = new BotContext('a');
    const client = {};
    const generation = context.attach(client);
    const manager = new ConnectionManager({
        botId: 'a', context,
        sessionManager: new SessionManager({ botId: 'a' }),
        connectionFactory: { create: () => client },
        profile: { enabled: true }, server: {}, eventBus: new EventBus(),
        logger: { info() {}, debug() {}, error() {}, warn() {} },
        readyTimeoutMs: 50
    });
    assert.equal(await manager.requestReconnect('missing end', { expectedGeneration: generation }), false);
    assert.equal(context.get(), client);
});

test('requestReconnect returns false and logs when client.end throws', async () => {
    const context = new BotContext('a');
    const client = { end() { throw new Error('end exploded'); } };
    const generation = context.attach(client);
    const warnings = [];
    const manager = new ConnectionManager({
        botId: 'a', context,
        sessionManager: new SessionManager({ botId: 'a' }),
        connectionFactory: { create: () => client },
        profile: { enabled: true }, server: {}, eventBus: new EventBus(),
        logger: { info() {}, debug() {}, error() {}, warn: (message, meta) => warnings.push({ message, meta }) },
        readyTimeoutMs: 50
    });
    assert.equal(await manager.requestReconnect('throwing end', { expectedGeneration: generation }), false);
    assert.equal(warnings.some(entry => entry.message.includes('could not close')), true);
});

test('requestReconnect is a safe no-op without a current client', async () => {
    const eventBus = new EventBus();
    const ended = [];
    eventBus.on('connection:ended', event => ended.push(event));
    const manager = new ConnectionManager({
        botId: 'a', context: new BotContext('a'),
        sessionManager: new SessionManager({ botId: 'a' }), connectionFactory: { create: () => fakeClient() },
        profile: { enabled: true }, server: {}, eventBus, readyTimeoutMs: 50
    });
    assert.equal(await manager.requestReconnect('no client'), false);
    assert.equal(ended.length, 1);
    assert.equal(ended[0].intentional, false);
    assert.equal(ended[0].connectionGeneration, null);
});

test('operator stop cleans a client that attaches late from an in-flight connect attempt', async () => {
    const context = new BotContext('a');
    const client = fakeClient();
    let releaseTurn;
    const turn = new Promise(resolve => { releaseTurn = resolve; });
    const manager = new ConnectionManager({
        botId: 'a',
        context,
        sessionManager: new SessionManager({ botId: 'a' }),
        connectionFactory: { create: () => { queueMicrotask(() => client.emit('spawn')); return client; } },
        profile: { enabled: true, username: 'BotA' },
        server: { host: 'server', port: 25565 },
        eventBus: new EventBus(),
        attemptCoordinator: { async acquireTurn() { await turn; return { release() {} }; } },
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        readyTimeoutMs: 50
    });
    const connecting = manager.connect();
    await new Promise(resolve => setImmediate(resolve));
    const stopping = manager.stop();
    releaseTurn();
    await Promise.allSettled([connecting, stopping]);
    assert.equal(context.has(), false);
    assert.equal(client.endReason, 'runtime stopping');
});
