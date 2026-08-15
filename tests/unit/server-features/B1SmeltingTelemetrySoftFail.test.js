'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B1StorageMaterialService = require('../../../src/server-features/storage/B1StorageMaterialService');
const Result = require('../../../src/shared/result/Result');

test('stale /kho telemetry after a successful smelting click does not deadlock B5 preprocessing', async () => {
    const reads = [];
    const storage = {
        async read(options = {}) {
            reads.push(options);
            return Result.ok({ items: { raw_iron: 1, iron_ingot: 40341 } });
        }
    };
    const service = new B1StorageMaterialService({
        storage,
        minerals: {},
        smelting: { async smelt() { return Result.ok({ skipped: false, allForInput: true }); } },
        conversionConfig: {
            resources: { iron_ingot: { baseId: 'iron_ingot', blockId: 'iron_block', ratio: 9 } },
            smeltingRecipeIds: ['raw_iron_to_iron']
        },
        smeltingConfig: {
            verificationAttempts: 2,
            verificationRetryMs: 0,
            recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } }
        }
    });

    const result = await service.preprocessForCraft();
    assert.equal(result.success, true);
    assert.equal(result.data.actions[0].verified, false);
    assert.equal(result.data.actions[0].telemetryStale, true);
    assert.equal(reads.some(options => options.forceReopen === true), true);
});
