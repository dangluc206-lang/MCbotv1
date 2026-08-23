'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

for (const relative of [
    'src/modes/collector-b5/CollectorB5ModeService.js',
    'src/modes/fishing/FishingModeService.js'
]) {
    test(`${relative} keeps loop/restart ownership inside TaskSupervisor`, () => {
        const source = fs.readFileSync(path.join(root, relative), 'utf8');
        assert.match(source, /new TaskSupervisor\(/);
        assert.match(source, /taskSupervisor\.start\('loop'/);
        assert.match(source, /taskSupervisor\.start\('restart'/);
        assert.doesNotMatch(source, /CancellationSource/);
        assert.doesNotMatch(source, /\bsetTimeout\s*\(/);
        assert.doesNotMatch(source, /\bclearTimeout\s*\(/);
    });
}
