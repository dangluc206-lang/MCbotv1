'use strict';

const SENSITIVE_COMMAND = /^\/(?:login|register|reg|l|auth|password|changepassword|cp)\b/i;

class SkyCommandRegistry {
    constructor(config = {}) {
        this.replace(config);
    }

    replace(config = {}) {
        this.bySky = new Map();
        for (const [skyId, commands] of Object.entries(config || {})) {
            const normalizedSky = this.#skyId(skyId);
            const entries = new Map();
            for (const [commandId, definition] of Object.entries(commands || {})) {
                entries.set(this.#commandId(commandId), Object.freeze(this.#definition(commandId, definition)));
            }
            this.bySky.set(normalizedSky, entries);
        }
        return this.snapshot();
    }

    get(skyId, commandId) {
        const sky = this.bySky.get(String(skyId || '').trim());
        if (!sky) return null;
        return sky.get(String(commandId || '').trim()) || null;
    }

    require(skyId, commandId) {
        const definition = this.get(skyId, commandId);
        if (!definition) throw new Error(`Sky command not configured: ${skyId}.${commandId}`);
        return { ...definition };
    }

    list(skyId, { enabledOnly = false } = {}) {
        const sky = this.bySky.get(String(skyId || '').trim());
        if (!sky) return [];
        return [...sky.entries()]
            .map(([id, definition]) => ({ id, ...definition }))
            .filter(entry => !enabledOnly || entry.enabled !== false)
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    skyIds() {
        return [...this.bySky.keys()].sort();
    }

    snapshot() {
        const output = {};
        for (const skyId of this.skyIds()) {
            output[skyId] = {};
            for (const entry of this.list(skyId)) {
                output[skyId][entry.id] = {
                    command: entry.command,
                    label: entry.label,
                    description: entry.description,
                    enabled: entry.enabled
                };
            }
        }
        return output;
    }

    #definition(commandId, definition) {
        if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
            throw new TypeError(`Sky command ${commandId} must be an object.`);
        }
        const command = String(definition.command || '').trim();
        if (!command.startsWith('/')) throw new TypeError(`Sky command ${commandId} must start with /.`);
        if (/[\r\n\0]/.test(command)) throw new TypeError(`Sky command ${commandId} must be one line.`);
        if (SENSITIVE_COMMAND.test(command)) throw new TypeError(`Sky command ${commandId} cannot be an authentication/password command.`);
        return {
            command,
            label: String(definition.label || commandId).trim() || String(commandId),
            description: String(definition.description || '').trim(),
            enabled: definition.enabled !== false
        };
    }

    #skyId(value) {
        const id = String(value || '').trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new TypeError(`Invalid Sky id: ${value}`);
        return id;
    }

    #commandId(value) {
        const id = String(value || '').trim();
        if (!/^[a-z][a-zA-Z0-9_-]*$/.test(id)) throw new TypeError(`Invalid Sky command id: ${value}`);
        return id;
    }
}

module.exports = SkyCommandRegistry;
