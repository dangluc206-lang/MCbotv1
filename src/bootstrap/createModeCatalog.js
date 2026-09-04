'use strict';

const ModeCatalog = require('../modes/ModeCatalog');
const CustomModeStore = require('../modes/composable/CustomModeStore');

function createModeCatalog({ baseDir = process.cwd() } = {}) {
    const customStore = new CustomModeStore({ baseDir });
    const custom = customStore.loadSync().map(entry => ({
        id: entry.definition.id,
        serviceName: `customMode:${entry.definition.id}`,
        label: entry.definition.label,
        description: entry.definition.description,
        primary: entry.definition.primary,
        durable: entry.definition.durable,
        requiredCapabilities: entry.definition.requiredCapabilities,
        requestedResources: entry.definition.requestedResources,
        metadata: {
            kind: 'composable',
            sourceFile: entry.relativeFile,
            workflow: entry.definition.workflow,
            serverProfiles: entry.definition.serverProfiles,
            resourceBudget: entry.definition.resourceBudget
        }
    }));

    return new ModeCatalog([
        {
            id: 'b5-craft',
            serviceName: 'b5CraftMode',
            label: 'Chế B5 thuần',
            description: 'Chỉ /is, đọc kho, nung raw khi cần bảo vệ, nén phôi thành khối, bảo vệ kho và chế B5; không di chuyển.',
            requiredCapabilities: ['island', 'storage', 'b1-materials', 'smelting', 'b5-planning', 'b5-automation', 'crafting', 'personal-vault'],
            requestedResources: ['primary-mode'],
            metadata: { kind: 'builtin', recommended: true }
        },
        {
            id: 'collector-b5',
            serviceName: 'collectorB5Mode',
            label: 'Collector + B5 (cũ)',
            description: 'Luồng Collector + B5 cũ có di chuyển; giữ lại để tương thích.',
            requiredCapabilities: ['island', 'movement', 'storage', 'crafting', 'personal-vault'],
            requestedResources: ['primary-mode'],
            metadata: { kind: 'builtin', legacy: true }
        },
        {
            id: 'fishing',
            serviceName: 'fishingMode',
            label: 'Câu cá',
            description: 'Chọn khu AFK, di chuyển, câu cá và phục hồi.',
            requiredCapabilities: ['afk', 'fishing', 'island', 'movement'],
            requestedResources: ['primary-mode'],
            metadata: { kind: 'builtin' }
        },
        ...custom
    ]).seal();
}

module.exports = createModeCatalog;
