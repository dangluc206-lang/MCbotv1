'use strict';

const PERMISSIONS = Object.freeze(['READ', 'PATCH', 'DEVELOP', 'ADMIN']);
const OWNERS = Object.freeze(['backend', 'fleet', 'incidents', 'command', 'configuration', 'update', 'ai', 'desktop']);

function policyError(code, message) {
    return Object.assign(new Error(message), { code });
}

function assertChannelDefinition(channel, definition) {
    if (!definition || typeof definition !== 'object') throw policyError('DESKTOP_IPC_CATALOG_DEFINITION', `IPC channel definition is missing: ${channel}`);
    if (definition.channel !== channel) throw policyError('DESKTOP_IPC_CATALOG_CHANNEL', `IPC catalog channel key does not match its definition: ${channel}`);
    if (!OWNERS.includes(definition.owner)) throw policyError('DESKTOP_IPC_CATALOG_OWNER', `IPC catalog owner is invalid: ${channel}`);
    if (!PERMISSIONS.includes(definition.permission)) throw policyError('DESKTOP_IPC_CATALOG_PERMISSION', `IPC catalog permission is invalid: ${channel}`);
    if (definition.sender !== 'EXACT_RENDERER_URL') throw policyError('DESKTOP_IPC_CATALOG_SENDER', `IPC catalog sender policy is invalid: ${channel}`);
    if (definition.request !== 'structured-clone-bounded') throw policyError('DESKTOP_IPC_CATALOG_REQUEST', `IPC catalog request policy is invalid: ${channel}`);
    if (definition.response !== 'desktop-api-v1') throw policyError('DESKTOP_IPC_CATALOG_RESPONSE', `IPC catalog response contract is invalid: ${channel}`);
    return definition;
}

function assertCatalogIntegrity(catalog) {
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw policyError('DESKTOP_IPC_CATALOG', 'Desktop IPC catalog must be a non-array object.');
    const channels = Object.keys(catalog);
    const seen = new Set();
    for (const [channel, definition] of Object.entries(catalog)) {
        if (seen.has(channel)) throw policyError('DESKTOP_IPC_CATALOG_DUPLICATE', `IPC channel is duplicated: ${channel}`);
        seen.add(channel);
        assertChannelDefinition(channel, definition);
    }
    return Object.freeze({ channelCount: channels.length });
}

module.exports = Object.freeze({ PERMISSIONS, OWNERS, assertChannelDefinition, assertCatalogIntegrity });
