'use strict';

const crypto = require('node:crypto');
const ServerProfile = require('./ServerProfile');
const ServerProfileRegistry = require('./ServerProfileRegistry');

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
function revisionFor(value) {
    return `r-${crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex').slice(0, 12)}`;
}

function createServerProfileRegistry(serverConfig, profileKnowledge = {}) {
    if (!serverConfig || typeof serverConfig !== 'object') throw new TypeError('server configuration is required');
    const registry = new ServerProfileRegistry();
    const knowledge = profileKnowledge && typeof profileKnowledge === 'object' ? profileKnowledge : {};
    const catalogs = {
        commands: knowledge.commands || 'commands',
        commandResponses: knowledge.commandResponses || 'commandResponses',
        skyCommands: knowledge.skyCommands || 'skyCommands',
        gui: knowledge.guiIdentity || 'guiIdentity',
        guiWindows: knowledge.guiWindows || 'guiWindows',
        guiIdentity: knowledge.guiIdentity || 'guiIdentity',
        guiSlots: knowledge.guiSlots || 'guiSlots',
        items: knowledge.items || 'items',
        recipes: knowledge.recipes || 'recipes',
        craftingTiers: knowledge.craftingTiers || 'craftingTiers',
        storage: knowledge.storage || 'storage',
        personalVault: knowledge.personalVault || 'personalVault',
        minerals: knowledge.minerals || 'minerals',
        mineralConversions: knowledge.mineralConversions || 'mineralConversions',
        smelting: knowledge.smelting || 'smelting',
        serverTimings: knowledge.serverTimings || null
    };
    const bindings = {
        authentication: knowledge.authentication || 'serverLogin',
        join: knowledge.join || 'skyblock'
    };
    if (!serverConfig.profiles) {
        registry.register(new ServerProfile({
            id: 'default', revision: revisionFor({ serverConfig, catalogs, bindings }), implementation: 'minerua-compat', endpoint: serverConfig,
            catalogs,
            bindings,
            capabilities: { commands: true, gui: true, items: true, recipes: true, crafting: true, storage: true, personalVault: true, smelting: true, conversion: true, authentication: true, join: true }
        }));
        return registry.seal();
    }
    const defaults = serverConfig.defaults || {};
    for (const [profileId, endpointConfig] of Object.entries(serverConfig.profiles || {})) {
        const endpoint = Object.freeze({ ...defaults, ...endpointConfig });
        registry.register(new ServerProfile({
            id: profileId,
            revision: revisionFor({ profileId, endpoint, catalogs, bindings }),
            implementation: 'minerua-compat',
            endpoint,
            catalogs,
            bindings,
            capabilities: { commands: true, gui: true, items: true, recipes: true, crafting: true, storage: true, personalVault: true, smelting: true, conversion: true, authentication: true, join: true }
        }));
    }
    return registry.seal();
}

module.exports = createServerProfileRegistry;
module.exports.revisionFor = revisionFor;
