'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '../../../src/discord/admin/BotProfileAdminService.js');

function source() { return fs.readFileSync(sourcePath, 'utf8'); }

test('bot profile admin serializes every profile/runtime mutation through one transaction queue', () => {
    const text = source();
    assert.match(text, /this\.mutationQueue\s*=\s*Promise\.resolve\(\)/);
    assert.match(text, /this\.mutationCoordinator\.run\('bot-profile-set', work\)/);
    assert.match(text, /createProfile\(args\)\s*\{\s*return this\.#queueMutation\(\(\) => this\.#createProfile\(args\)\)/);
    assert.match(text, /updateProfile\(botId, fields = \{\}\)\s*\{\s*return this\.#queueMutation\(\(\) => this\.#updateProfile\(botId, fields\)\)/);
    assert.match(text, /reloadRuntime\(botId\)\s*\{\s*return this\.#queueMutation\(\(\) => this\.#reloadRuntime\(botId\)\)/);
    assert.match(text, /deleteProfile\(botId\)\s*\{\s*return this\.#queueMutation\(\(\) => this\.#deleteProfile\(botId\)\)/);
    assert.match(text, /cloneProfile\(sourceBotId, newId\)\s*\{\s*return this\.#queueMutation\(\(\) => this\.#cloneProfile\(sourceBotId, newId\)\)/);
});

test('bot profile admin drain waits the mutation transaction before filesystem queue drain', () => {
    const text = source();
    const drain = text.match(/async drain\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
    const mutationIndex = drain.indexOf('await this.mutationQueue');
    const writeIndex = drain.indexOf('await this.writeQueue');
    assert.ok(mutationIndex >= 0, 'drain must await mutationQueue');
    assert.ok(writeIndex > mutationIndex, 'writeQueue must drain after mutationQueue');
});
