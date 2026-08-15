'use strict';

module.exports = value => {
    const errors = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { valid: false, errors: ['discord config must be an object'] };
    }
    if (typeof value.enabled !== 'boolean') errors.push('enabled must be boolean');
    if (typeof value.commandName !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(value.commandName)) {
        errors.push('commandName must be a lowercase Discord command name');
    }

    if (value.modeCommandName !== undefined
        && (typeof value.modeCommandName !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(value.modeCommandName))) {
        errors.push('modeCommandName must be a lowercase Discord command name');
    }
    for (const key of ['tokenEnv', 'applicationIdEnv', 'allowedUserIdsEnv', 'defaultBotId']) {
        if (typeof value[key] !== 'string' || !value[key].trim()) errors.push(`${key} is required`);
    }
    if (value.guildIdEnv !== null && value.guildIdEnv !== undefined
        && (typeof value.guildIdEnv !== 'string' || !value.guildIdEnv.trim())) {
        errors.push('guildIdEnv must be null or a non-empty string');
    }
    for (const key of ['guiTimeoutMs', 'readyTimeoutMs', 'maxAttachmentBytes']) {
        if (!Number.isFinite(value[key]) || value[key] <= 0) errors.push(`${key} must be positive`);
    }
    if (typeof value.ephemeral !== 'boolean') errors.push('ephemeral must be boolean');
    if (!value.targets || typeof value.targets !== 'object' || Array.isArray(value.targets)
        || Object.keys(value.targets).length === 0) {
        errors.push('targets must be a non-empty object');
    } else {
        for (const [id, target] of Object.entries(value.targets)) {
            if (!/^[a-z0-9_-]{1,32}$/.test(id)) errors.push(`targets.${id} id is invalid`);
            if (!target || typeof target !== 'object') {
                errors.push(`targets.${id} must be an object`);
                continue;
            }
            if (typeof target.display !== 'string' || !target.display.startsWith('/')) {
                errors.push(`targets.${id}.display must be a server command label`);
            }
            if (typeof target.commandKey !== 'string' || !target.commandKey.trim()) {
                errors.push(`targets.${id}.commandKey is required`);
            }
        }
    }

    if (value.panels !== undefined) {
        const panels = value.panels;
        if (!panels || typeof panels !== 'object' || Array.isArray(panels)) {
            errors.push('panels must be an object');
        } else {
            if (typeof panels.enabled !== 'boolean') errors.push('panels.enabled must be boolean');
            if (typeof panels.botId !== 'string' || !panels.botId.trim()) errors.push('panels.botId is required');
            if (!Number.isFinite(panels.refreshIntervalMs) || panels.refreshIntervalMs < 1000) {
                errors.push('panels.refreshIntervalMs must be at least 1000');
            }
            if (typeof panels.storePath !== 'string' || !panels.storePath.trim()) errors.push('panels.storePath is required');
            if (typeof panels.autoCreateChannels !== 'boolean') errors.push('panels.autoCreateChannels must be boolean');
            if (!panels.channels || typeof panels.channels !== 'object' || Array.isArray(panels.channels)) {
                errors.push('panels.channels must be an object');
            } else {
                for (const kind of ['control', 'config', 'errors']) {
                    const channel = panels.channels[kind];
                    if (!channel || typeof channel !== 'object') {
                        errors.push(`panels.channels.${kind} is required`);
                        continue;
                    }
                    if (typeof channel.name !== 'string' || !channel.name.trim()) {
                        errors.push(`panels.channels.${kind}.name is required`);
                    }
                    if (channel.idEnv !== null && channel.idEnv !== undefined
                        && (typeof channel.idEnv !== 'string' || !channel.idEnv.trim())) {
                        errors.push(`panels.channels.${kind}.idEnv must be null or a non-empty string`);
                    }
                }
            }
        }
    }
    return { valid: errors.length === 0, errors };
};
