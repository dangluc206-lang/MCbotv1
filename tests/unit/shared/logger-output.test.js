'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CompactLogFormatter = require('../../../src/shared/logger/CompactLogFormatter');
const RuntimeLogOutput = require('../../../src/shared/logger/RuntimeLogOutput');

test('CompactLogFormatter shortens BotRuntime scope and summarizes meta', () => {
    const formatter = new CompactLogFormatter({ metaMode: 'summary', maxMetaFields: 3 });
    const line = formatter.format({
        timestamp: '2026-08-08T03:00:00.000Z',
        level: 'info',
        scope: 'BotRuntime:bot-01',
        message: 'Connecting Minecraft bot.',
        meta: { botId: 'bot-01', host: 'mc.example.com', port: 25565, username: 'player', connectionGeneration: 1 }
    });
    assert.match(line, /\[bot-01\] Connecting Minecraft bot\./);
    assert.match(line, /host=mc\.example\.com/);
    assert.match(line, /port=25565/);
    assert.doesNotMatch(line, /connectionGeneration/);
    assert.doesNotMatch(line, /\{"botId"/);
});

test('RuntimeLogOutput filters console level and writes full JSONL file', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-log-'));
    const lines = [];
    const consoleRef = { log: value => lines.push(value), debug: value => lines.push(value), warn: value => lines.push(value), error: value => lines.push(value) };
    const output = new RuntimeLogOutput({
        baseDir: temp,
        env: {},
        consoleRef,
        app: {
            logLevel: 'info',
            logging: {
                console: { level: 'info', format: 'compact', meta: 'none' },
                file: { enabled: true, level: 'debug', directory: 'logs', prefix: 'test' }
            }
        }
    });

    output.write({ timestamp: '2026-08-08T03:00:00.000Z', level: 'debug', scope: 'Test', message: 'debug detail', meta: { x: 1 } });
    output.write({ timestamp: '2026-08-08T03:00:01.000Z', level: 'info', scope: 'Test', message: 'visible', meta: { token: '[REDACTED]' } });

    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[Test\] visible/);
    output.flush();
    const logFile = path.join(temp, 'logs', 'test-2026-08-08.jsonl');
    const records = fs.readFileSync(logFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 2);
    assert.equal(records[0].level, 'debug');
    assert.equal(records[1].meta.token, '[REDACTED]');
});
