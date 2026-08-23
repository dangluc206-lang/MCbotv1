'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const KhoCapacityReader = require('../../../src/server-features/storage/KhoCapacityReader');
const KhoReader = require('../../../src/server-features/storage/KhoReader');

function resolver() {
    return {
        resolve(item) { return item.logicalId ? { id: item.logicalId } : null; },
        matches(item, logicalId) { return { matched: item.logicalId === logicalId }; }
    };
}

const config = {
    resourceAmountPatterns: ['(?:dang\\s*co)\\s*[:：]?\\s*(?<value>[\\d.,]+)'],
    allowStackCountFallback: false,
    capacityIndicator: {
        itemId: 'storage_capacity',
        scanAllSlots: true,
        usedPatterns: ['(?:da\\s*su\\s*dung)\\s*[:：]?\\s*(?<value>[\\d.,]+)'],
        freePatterns: ['(?:dang\\s*trong)\\s*[:：]?\\s*(?<value>[\\d.,]+)'],
        limitPatterns: ['(?:dung\\s*luong)\\s*[:：]?\\s*(?<value>[\\d.,]+)']
    }
};

test('KhoReader parses logical resource amounts from lore instead of icon stack count', () => {
    const itemResolver = resolver();
    const capacityReader = new KhoCapacityReader({ itemResolver, config });
    const reader = new KhoReader({ itemResolver, capacityReader, config });
    const window = {
        slots: [
            { logicalId: 'coal', name: 'coal', count: 1, displayName: 'Than', lore: ['Đang có: 123,456'] },
            { logicalId: 'diamond', name: 'diamond', count: 1, displayName: 'Kim cương', lore: ['Đang có: 65.536'] },
            {
                logicalId: 'storage_capacity',
                name: 'paper',
                count: 1,
                displayName: 'Sức chứa',
                lore: ['Đã sử dụng: 876,544', 'Đang trống: 123,456', 'Dung lượng: 1,000,000']
            }
        ]
    };

    const snapshot = reader.read(window);
    assert.equal(snapshot.count('coal'), 123456);
    assert.equal(snapshot.count('diamond'), 65536);
    assert.equal(snapshot.capacity.used, 876544);
    assert.equal(snapshot.capacity.free, 123456);
    assert.equal(snapshot.capacity.limit, 1000000);
    assert.equal(snapshot.capacity.usageRatio, 0.876544);
});

test('KhoReader reads split component amounts and authoritative slot 49 capacity', () => {
    const itemResolver = resolver();
    const slot49Config = {
        ...config,
        capacityIndicator: {
            ...config.capacityIndicator,
            slot: 49
        }
    };
    const capacityReader = new KhoCapacityReader({ itemResolver, config: slot49Config });
    const reader = new KhoReader({ itemResolver, capacityReader, config: slot49Config });
    const slots = Array(54).fill(null);
    slots[10] = {
        logicalId: 'coal',
        name: 'coal',
        count: 1,
        displayName: 'Than',
        customLore: ['Số lượng:', 'yellow', '47,782']
    };
    slots[49] = {
        logicalId: 'storage_capacity',
        name: 'paper',
        count: 1,
        displayName: 'Thông tin kho',
        components: [
            'Dung lượng:', 'yellow', '800,000',
            'Đã sử dụng:', 'yellow', '453,724 / 56.72%',
            'Còn trống:', 'yellow', '346,276 / 43.28%'
        ]
    };

    const snapshot = reader.read({ slots });
    assert.equal(snapshot.count('coal'), 47782);
    assert.equal(snapshot.capacity.total, 800000);
    assert.equal(snapshot.capacity.used, 453724);
    assert.equal(snapshot.capacity.free, 346276);
    assert.equal(snapshot.capacity.usedPercent, 56.72);
    assert.equal(snapshot.capacity.freePercent, 43.28);
});


test('KhoCapacityReader scans past a stale configured slot when capacity moved', () => {
    const itemResolver = resolver();
    const movedConfig = {
        ...config,
        capacityIndicator: { ...config.capacityIndicator, slot: 49, scanAllSlots: true }
    };
    const capacityReader = new KhoCapacityReader({ itemResolver, config: movedConfig });
    const slots = Array(54).fill(null);
    slots[49] = { logicalId: 'decorative_head', name: 'player_head', displayName: 'Player Head', components: ['owner', 'someone'] };
    slots[50] = {
        logicalId: 'storage_capacity', name: 'book', displayName: 'Thông tin kho',
        components: ['Dung lượng:', '800,000', 'Đã sử dụng:', '720,000', 'Còn trống:', '80,000']
    };

    const capacity = capacityReader.read({ slots });
    assert.equal(capacity.used, 720000);
    assert.equal(capacity.limit, 800000);
    assert.equal(capacity.usageRatio, 0.9);
});

test('KhoReader derives capacity from parsed item totals when indicator telemetry is unavailable', () => {
    const itemResolver = resolver();
    const fallbackConfig = {
        ...config,
        capacityIndicator: { ...config.capacityIndicator, slot: 49, scanAllSlots: true, fallbackLimit: 800000 }
    };
    const capacityReader = new KhoCapacityReader({ itemResolver, config: fallbackConfig });
    const reader = new KhoReader({ itemResolver, capacityReader, config: fallbackConfig });
    const slots = Array(54).fill(null);
    slots[10] = { logicalId: 'coal', name: 'coal', count: 1, lore: ['Đang có: 500,000'] };
    slots[11] = { logicalId: 'diamond', name: 'diamond', count: 1, lore: ['Đang có: 220,000'] };
    slots[49] = { logicalId: 'decorative_head', name: 'player_head', count: 1, components: ['no capacity here'] };

    const snapshot = reader.read({ slots });
    assert.equal(snapshot.capacity.derivedFromItems, true);
    assert.equal(snapshot.capacity.used, 720000);
    assert.equal(snapshot.capacity.limit, 800000);
    assert.equal(snapshot.capacity.usageRatio, 0.9);
});

test('KhoReader rejects percent-only capacity telemetry instead of parsing 100.0% as 1000', () => {
    const itemResolver = resolver();
    const percentConfig = {
        ...config,
        capacityIndicator: { ...config.capacityIndicator, slot: 49, scanAllSlots: true, fallbackLimit: 800000 }
    };
    const capacityReader = new KhoCapacityReader({ itemResolver, config: percentConfig });
    const reader = new KhoReader({ itemResolver, capacityReader, config: percentConfig });
    const slots = Array(54).fill(null);
    slots[10] = { logicalId: 'coal', name: 'coal', count: 1, lore: ['Đang có: 14,943'] };
    slots[49] = {
        logicalId: 'storage_capacity', name: 'paper', count: 1, displayName: 'Thông tin kho',
        components: ['Đã sử dụng:', '100.0%', 'Đang trống:', '0.0%']
    };

    const snapshot = reader.read({ slots });
    assert.equal(snapshot.capacity.derivedFromItems, true);
    assert.equal(snapshot.capacity.used, 14943);
    assert.equal(snapshot.capacity.free, 785057);
    assert.equal(snapshot.capacity.limit, 800000);
});

test('KhoReader rejects absolute capacity telemetry that cannot contain visible item totals', () => {
    const itemResolver = resolver();
    const inconsistentConfig = {
        ...config,
        capacityIndicator: { ...config.capacityIndicator, slot: 49, scanAllSlots: true, fallbackLimit: 800000 }
    };
    const capacityReader = new KhoCapacityReader({ itemResolver, config: inconsistentConfig });
    const reader = new KhoReader({ itemResolver, capacityReader, config: inconsistentConfig });
    const slots = Array(54).fill(null);
    slots[10] = { logicalId: 'coal', name: 'coal', count: 1, lore: ['Đang có: 14,943'] };
    slots[49] = {
        logicalId: 'storage_capacity', name: 'paper', count: 1, displayName: 'Thông tin kho',
        components: ['Dung lượng: 1,000', 'Đã sử dụng: 1,000', 'Còn trống: 0']
    };

    const snapshot = reader.read({ slots });
    assert.equal(snapshot.capacity.derivedFromItems, true);
    assert.equal(snapshot.capacity.rejectedTelemetry, true);
    assert.equal(snapshot.capacity.used, 14943);
    assert.equal(snapshot.capacity.limit, 800000);
});
