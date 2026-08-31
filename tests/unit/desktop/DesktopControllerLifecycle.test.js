'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const DesktopController = require('../../../src/desktop/DesktopController');

function createController(application, baseDir) {
    const controller = new DesktopController({ baseDir });
    controller.lifecycle = 'RUNNING';
    controller.bundle = {
        application: {
            ...application,
            listRuntimes: application.listRuntimes || (() => []),
            getState: application.getState || (() => 'RUNNING')
        },
        fleetControl: {
            profileSnapshot: () => ({}),
            status: () => null
        }
    };
    return controller;
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-lifecycle-'));
}

test('P0-1: concurrent stop calls share one underlying stop/destroy transaction', async () => {
    const dir = tempDir();
    const gate = deferred();
    let stopCalls = 0;
    let destroyCalls = 0;
    const controller = createController({
        async stop() { stopCalls += 1; await gate.promise; },
        async destroy() { destroyCalls += 1; },
    }, dir);

    const first = controller.stop('first');
    const second = controller.stop('second');
    gate.resolve();
    const results = await Promise.all([first, second]);

    assert.deepEqual(results, [{ success: true }, { success: true }]);
    assert.equal(stopCalls, 1);
    assert.equal(destroyCalls, 1);
    assert.equal(controller.lifecycle, 'STOPPED');
    assert.equal(controller.bundle, null);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('P0-1: stop during STARTING waits for start transaction instead of forcing STOPPED', async () => {
    const dir = tempDir();
    const createGate = deferred();
    const stopCalls = [];
    const createdBundle = {
        application: {
            async initialize() {},
            async start() { await createGate.promise; },
            async stop() { stopCalls.push('stop'); },
            async destroy() { stopCalls.push('destroy'); },
            listRuntimes: () => [],
            getState: () => 'RUNNING'
        },
        fleetControl: { profileSnapshot: () => ({}), status: () => null }
    };
    const controller = new DesktopController({
        baseDir: dir,
        applicationFactory: async () => createdBundle
    });

    const startPromise = controller.start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(controller.lifecycle, 'STARTING');

    const stopPromise = controller.stop('startup-stop');
    assert.equal(controller.lifecycle, 'STARTING');

    createGate.resolve();
    await startPromise;
    await stopPromise;

    assert.deepEqual(stopCalls, ['stop', 'destroy']);
    assert.equal(controller.lifecycle, 'STOPPED');
    assert.equal(controller.bundle, null);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('P0-1: start waits for an in-flight stop transaction', async () => {
    const dir = tempDir();
    const stopGate = deferred();
    let starts = 0;
    let stops = 0;
    const oldBundle = {
        application: {
            async stop() { stops += 1; await stopGate.promise; },
            async destroy() { stops += 1; },
            listRuntimes: () => [],
            getState: () => 'RUNNING'
        },
        fleetControl: { profileSnapshot: () => ({}), status: () => null }
    };
    const newBundle = {
        application: {
            async initialize() {},
            async start() { starts += 1; },
            async stop() {},
            async destroy() {},
            listRuntimes: () => [],
            getState: () => 'RUNNING'
        },
        fleetControl: { profileSnapshot: () => ({}), status: () => null }
    };
    let factoryCalls = 0;
    const controller = new DesktopController({
        baseDir: dir,
        applicationFactory: async () => (++factoryCalls === 1 ? oldBundle : newBundle)
    });
    controller.lifecycle = 'RUNNING';
    controller.bundle = oldBundle;

    const stopping = controller.stop('restart');
    const starting = controller.start();
    assert.equal(starts, 0);
    stopGate.resolve();
    await stopping;
    await starting;

    assert.equal(stops, 2);
    assert.equal(starts, 1);
    assert.equal(controller.lifecycle, 'RUNNING');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('P0-1: destroy failure after successful stop is retried without calling application.stop twice', async () => {
    const dir = tempDir();
    let stopCalls = 0;
    let destroyCalls = 0;
    const controller = createController({
        async stop() { stopCalls += 1; },
        async destroy() {
            destroyCalls += 1;
            if (destroyCalls === 1) throw Object.assign(new Error('destroy failed'), { code: 'DESTROY_FAILED' });
        }
    }, dir);

    await assert.rejects(() => controller.stop('first'), /destroy failed/);
    assert.equal(controller.lifecycle, 'STOPPING');
    assert.notEqual(controller.bundle, null);

    const retry = await controller.stop('retry');
    assert.deepEqual(retry, { success: true });
    assert.equal(stopCalls, 1);
    assert.equal(destroyCalls, 2);
    assert.equal(controller.lifecycle, 'STOPPED');
    assert.equal(controller.bundle, null);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('P0-1: stop failure is retained as FAILED and can be retried safely', async () => {
    const dir = tempDir();
    let stopCalls = 0;
    let destroyCalls = 0;
    const controller = createController({
        async stop() {
            stopCalls += 1;
            if (stopCalls === 1) throw Object.assign(new Error('stop failed'), { code: 'STOP_FAILED' });
        },
        async destroy() { destroyCalls += 1; }
    }, dir);

    await assert.rejects(() => controller.stop('first'), /stop failed/);
    assert.equal(controller.lifecycle, 'FAILED');
    assert.notEqual(controller.bundle, null);

    await controller.stop('retry');
    assert.equal(stopCalls, 2);
    assert.equal(destroyCalls, 1);
    assert.equal(controller.lifecycle, 'STOPPED');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('P0-1: start is rejected while a failed stop transaction still owns the bundle', async () => {
    const dir = tempDir();
    const controller = createController({
        async stop() { throw new Error('stop failed'); },
        async destroy() {}
    }, dir);
    await assert.rejects(() => controller.stop('fail'), /stop failed/);
    await assert.rejects(() => controller.start(), error => error?.code === 'DESKTOP_LIFECYCLE_STOP_REQUIRED');
    fs.rmSync(dir, { recursive: true, force: true });
});
