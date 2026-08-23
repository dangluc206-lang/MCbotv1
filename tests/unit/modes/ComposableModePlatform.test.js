'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const WorkflowDefinitionValidator = require('../../../src/modes/composable/WorkflowDefinitionValidator');
const WorkflowStepExecutor = require('../../../src/modes/composable/WorkflowStepExecutor');
const CustomModeStore = require('../../../src/modes/composable/CustomModeStore');

function definition(id = 'demo-mode') {
    return {
        id, label: 'Demo', enabled: true,
        workflow: {
            start: [{ type: 'home' }],
            loop: { intervalMs: 1000, steps: [
                { type: 'command', commandKey: 'storage', args: {}, timeoutMs: 1000 },
                { type: 'sky-command', commandId: 'autofarm', skyId: 'sky1', args: { mode: 'on' } },
                { type: 'slash-command', command: '/kho' },
                { type: 'gui-click', slot: 11 },
                { type: 'move', x: 1, y: 2, z: 3 },
                { type: 'look', yaw: 1.2, pitch: -0.3 },
                { type: 'wait-gui', guiId: 'storage', timeoutMs: 1000 },
                { type: 'storage-protect' },
                { type: 'b5-cycle' }
            ] }
        }
    };
}

test('workflow validator derives capabilities and rejects unsafe/raw module types', () => {
    const validator = new WorkflowDefinitionValidator();
    const normalized = validator.normalize(definition());
    for (const capability of ['island','commands','sky-commands','slash-command','gui','movement','rotation','b1-materials','b5-automation']) {
        assert.ok(normalized.requiredCapabilities.includes(capability), capability);
    }
    assert.equal(validator.validate({ id: 'evil', workflow: { loop: { steps: [{ type: 'javascript', code: 'process.exit()' }] } } }).valid, false);
    assert.equal(validator.validate({ id: 'raw-chat', workflow: { loop: { steps: [{ type: 'command', commandKey: '' }] } } }).valid, false);
    assert.equal(validator.validate({ id: 'plain-chat', workflow: { loop: { steps: [{ type: 'slash-command', command: 'xin chao' }] } } }).valid, false);
    assert.equal(validator.validate({ id: 'secret-command', workflow: { loop: { steps: [{ type: 'slash-command', command: '/login hunter2' }] } } }).valid, false);
});

test('workflow executor routes modules only through registered capabilities and uses canonical B5 storage protection', async () => {
    const calls = [];
    const capabilities = {
        commands: { async send(key) { calls.push(['command', key]); return { success: true, data: { sent: true } }; } },
        'sky-commands': { async send(id, options) { calls.push(['sky-command', id, options.skyId, options.args]); return { success: true, data: { sent: true } }; } },
        'slash-command': { async send(command) { calls.push(['slash-command', command]); return { sent: true }; } },
        gui: {
            async click(slot) { calls.push(['click', slot]); return { clicked: slot }; },
            async waitFor(id) { calls.push(['wait-gui', id]); return { definitionId: id, id: 's1' }; }
        },
        movement: { async goTo(pos) { calls.push(['move', pos]); return { arrived: true }; } },
        rotation: { async look(yaw, pitch) { calls.push(['look', yaw, pitch]); } },
        island: { async goHome() { calls.push(['home']); return { success: true }; } },
        'b1-materials': { async protectForB5Batch(options) { calls.push(['protect', options.expectedGeneration]); return { success: true, data: {} }; } },
        'b5-automation': { async runNext() { calls.push(['b5']); return { success: true, data: {} }; } }
    };
    const modeContext = { generation: () => 4, connected: () => true, capability: id => capabilities[id] };
    const executor = new WorkflowStepExecutor({ botId: 'bot-01', modeId: 'demo', modeContext });
    const normalized = new WorkflowDefinitionValidator().normalize(definition());
    await executor.executeSteps([...normalized.workflow.start, ...normalized.workflow.loop.steps], { cancellationToken: { throwIfCancelled() {}, isCancelled: false } });
    assert.ok(calls.some(call => call[0] === 'command'));
    assert.deepEqual(calls.find(call => call[0] === 'sky-command'), ['sky-command', 'autofarm', 'sky1', { mode: 'on' }]);
    assert.deepEqual(calls.find(call => call[0] === 'slash-command'), ['slash-command', '/kho']);
    assert.ok(calls.some(call => call[0] === 'click'));
    assert.ok(calls.some(call => call[0] === 'move'));
    assert.ok(calls.some(call => call[0] === 'look'));
    assert.ok(calls.some(call => call[0] === 'wait-gui'));
    assert.deepEqual(calls.find(call => call[0] === 'protect'), ['protect', 4]);
    assert.ok(calls.some(call => call[0] === 'b5'));
});

test('custom mode store keeps backend boot-safe when one user workflow file is invalid', async () => {
    const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-custom-mode-'));
    const store = new CustomModeStore({ baseDir });
    await store.save(definition('valid-mode'));
    const directory = path.join(baseDir, 'config', 'modes', 'custom');
    fs.writeFileSync(path.join(directory, 'broken.json'), '{ nope', 'utf8');
    const runtime = store.loadSync();
    assert.equal(runtime.length, 1);
    assert.equal(runtime[0].definition.id, 'valid-mode');
    const listed = await store.list();
    assert.equal(listed.length, 2);
    assert.ok(listed.some(entry => entry.valid === false));
    await fsp.rm(baseDir, { recursive: true, force: true });
});

test('WP-204 module catalog is static/typed and validator rejects invalid capability/resource contracts', () => {
    const validator = new WorkflowDefinitionValidator();
    const modules = validator.moduleCatalog();
    assert.ok(modules.length >= 10);
    for (const module of modules) {
        assert.match(module.type, /^[a-z][a-z0-9-]*$/);
        assert.equal(typeof module.outputType, 'string');
        assert.equal(module.cancellable, true);
        assert.ok(Array.isArray(module.transientResources));
    }
    assert.equal(validator.validate({ id: 'bad-cap', requiredCapabilities: ['bad capability'], workflow: {} }).valid, false);
    assert.equal(validator.validate({ id: 'bad-resource', requestedResources: ['../../escape'], workflow: {} }).valid, false);
    assert.equal(validator.validate({ id: 'too-many', workflow: { loop: { steps: [{ type: 'repeat', count: 1001, steps: [{ type: 'wait', ms: 1 }] }] } } }).valid, false);
});

test('WP-204 executeSteps returns typed module output envelopes', async () => {
    const modeContext = { generation: () => 1, connected: () => true, capability() { throw new Error('not needed'); } };
    const executor = new WorkflowStepExecutor({ botId: 'bot-01', modeId: 'typed-demo', modeContext });
    const [result] = await executor.executeSteps([{ type: 'wait', ms: 0 }], { cancellationToken: null });
    assert.deepEqual(result, { contractVersion: 1, moduleType: 'wait', outputType: 'wait-result', outcome: 'SUCCESS', data: { waitedMs: 0 } });
    assert.equal(Object.isFrozen(result), true);
});

test('WP-204 repairing an existing custom mode creates a backup only after backend validation', async () => {
    const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-custom-repair-'));
    const store = new CustomModeStore({ baseDir });
    const first = await store.save(definition('repair-mode'));
    assert.equal(first.backupFile, null);
    const file = path.join(baseDir, first.file);
    fs.writeFileSync(file, '{ broken-json', 'utf8');
    await assert.rejects(store.save({ id: 'repair-mode', workflow: { loop: { steps: [{ type: 'javascript' }] } } }));
    assert.equal(fs.existsSync(`${file}.bak`), false, 'invalid definition must not mutate/backup the target');
    const repaired = await store.save(definition('repair-mode'));
    assert.ok(repaired.backupFile?.endsWith('repair-mode.json.bak'));
    assert.equal(fs.readFileSync(path.join(baseDir, repaired.backupFile), 'utf8'), '{ broken-json');
    assert.equal((await store.list()).find(entry => entry.file === 'repair-mode.json').valid, true);
    await fsp.rm(baseDir, { recursive: true, force: true });
});

test('WP-204 composable execution has no arbitrary JavaScript/import path and renderer can save only through IPC backend', () => {
    const root = path.resolve(__dirname, '../../..');
    const composable = fs.readdirSync(path.join(root, 'src/modes/composable')).filter(name => name.endsWith('.js'))
        .map(name => fs.readFileSync(path.join(root, 'src/modes/composable', name), 'utf8')).join('\n');
    assert.doesNotMatch(composable, /\beval\s*\(/);
    assert.doesNotMatch(composable, /new\s+Function\s*\(/);
    assert.doesNotMatch(composable, /=\s*require\s*\(\s*[A-Za-z_$]/);
    const renderer = fs.readFileSync(path.join(root, 'src/desktop/renderer/app.js'), 'utf8');
    assert.match(renderer, /window\.mcbot\.saveCustomMode\(definition\)/);
    assert.doesNotMatch(renderer, /(?:node:fs|require\(['\"]fs|writeFileSync|writeFile\s*\()/);
});

test('WP-204 cancellation interrupts a bounded wait module', async () => {
    const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');
    const source = new CancellationSource();
    const modeContext = { generation: () => 1, connected: () => true, capability() { throw new Error('not needed'); } };
    const executor = new WorkflowStepExecutor({ botId: 'bot-01', modeId: 'cancel-demo', modeContext });
    const pending = executor.executeSteps([{ type: 'wait', ms: 5000 }], { cancellationToken: source.token });
    source.cancel('test cancel');
    await assert.rejects(pending, error => error.code === 'CANCELLED' && error.cause?.code === 'CANCELLED');
});

test('CustomModeStore surfaces temp cleanup warning without converting a committed save into failure', async () => {
    const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-custom-cleanup-'));
    const removePath = async () => {
        const error = new Error('simulated cleanup denial');
        error.code = 'EACCES';
        throw error;
    };
    const store = new CustomModeStore({ baseDir, removePath });
    const result = await store.save(definition('cleanup-warning-mode'));
    assert.equal(result.definition.id, 'cleanup-warning-mode');
    assert.equal(result.cleanupWarning.operation, 'custom-mode-temp-cleanup');
    assert.equal(result.cleanupWarning.code, 'EACCES');
    assert.match(result.cleanupWarning.target, /^cleanup-warning-mode\.json\.\d+\.[0-9a-f-]{36}\.tmp$/);
    assert.equal(Object.isFrozen(result.cleanupWarning), true);
    assert.equal(store.lastCleanupWarning, result.cleanupWarning);
    assert.equal(fs.existsSync(path.join(baseDir, result.file)), true);
    await fsp.rm(baseDir, { recursive: true, force: true });
});

test('CustomModeStore cleanup failure never replaces the primary save failure', async () => {
    const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-custom-primary-'));
    const directory = path.join(baseDir, 'config', 'modes', 'custom');
    await fsp.mkdir(path.join(directory, 'primary-error.json'), { recursive: true });
    const removePath = async () => {
        const error = new Error('simulated cleanup denial');
        error.code = 'EACCES';
        throw error;
    };
    const store = new CustomModeStore({ baseDir, removePath });
    await assert.rejects(() => store.save(definition('primary-error')), error => error?.code !== 'EACCES');
    assert.equal(store.lastCleanupWarning?.code, 'EACCES');
    await fsp.rm(baseDir, { recursive: true, force: true });
});


test('CustomModeStore shared config transaction orders concurrent save/delete operations', async () => {
    const KeyedMutationCoordinator = require('../../../src/core/KeyedMutationCoordinator');
    const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-custom-order-'));
    const coordinator = new KeyedMutationCoordinator();
    const first = new CustomModeStore({ baseDir, mutationCoordinator: coordinator });
    const second = new CustomModeStore({ baseDir, mutationCoordinator: coordinator });
    const saved = definition('ordered-mode');
    saved.label = 'First';
    await Promise.all([
        first.save(saved),
        second.save({ ...definition('ordered-mode'), label: 'Second' })
    ]);
    const final = JSON.parse(await fsp.readFile(path.join(baseDir, 'config/modes/custom/ordered-mode.json'), 'utf8'));
    assert.equal(final.label, 'Second');
    await Promise.all([
        first.save({ ...definition('ordered-mode'), label: 'Third' }),
        second.remove('ordered-mode')
    ]);
    await assert.rejects(() => fsp.readFile(path.join(baseDir, 'config/modes/custom/ordered-mode.json'), 'utf8'), error => error?.code === 'ENOENT');
    assert.deepEqual(coordinator.activeKeys(), []);
    await fsp.rm(baseDir, { recursive: true, force: true });
});

test('CustomModeStore temp ownership remains unique when wall-clock timestamps collide', async t => {
    const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-custom-temp-unique-'));
    const originalWriteFile = fsp.writeFile;
    let tempArrivals = 0;
    let releaseTempWrites;
    const gate = new Promise(resolve => { releaseTempWrites = resolve; });
    t.mock.method(fsp, 'writeFile', async (file, ...args) => {
        if (String(file).endsWith('.tmp')) {
            tempArrivals += 1;
            if (tempArrivals === 2) releaseTempWrites();
            await gate;
        }
        return originalWriteFile(file, ...args);
    });
    const oldNow = Date.now;
    Date.now = () => 1700000000000;
    try {
        const results = await Promise.allSettled([
            new CustomModeStore({ baseDir }).save({ ...definition('unique-temp'), label: 'A' }),
            new CustomModeStore({ baseDir }).save({ ...definition('unique-temp'), label: 'B' })
        ]);
        assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled']);
    } finally {
        Date.now = oldNow;
        await fsp.rm(baseDir, { recursive: true, force: true });
    }
});
