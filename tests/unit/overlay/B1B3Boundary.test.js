    const fs = require('node:fs');
    const path = require('node:path');
    const test = require('node:test');
    const assert = require('node:assert/strict');

    const root = path.resolve(__dirname, '../../..');
    const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

    test('B1-B3 module is the orchestration boundary', () => {
        const source = read('src/server-features/crafting/b1-b3/B1B3CraftingModule.js');
        for (const method of ['plan', 'inspect', 'prepare', 'execute', 'finish']) {
            assert.match(source, new RegExp(`\\b${method}\\s*\\(`));
        }
        assert.doesNotMatch(source, /personalVaultStorage|\bstore\s*\(/);
        assert.doesNotMatch(source, /\bB4\b|\bB5\b/);
    });

    test('B1-B3 reserve coordinator does not contain higher-stage dependencies', () => {
        const source = read('src/server-features/crafting/b1-b3/B1B3ReserveCoordinator.js');
        assert.doesNotMatch(source, /\bB4\b|\bB5\b/);
        assert.match(source, /CRAFT_B1_B3_RESERVE_LOOP_GUARD/);
        assert.match(source, /CraftingService|crafting\.craft/);
        assert.match(source, /craftingVerificationService|this\.verification/);
    });
