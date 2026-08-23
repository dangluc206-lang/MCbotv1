'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');
const Operation = require('../../operations/Operation');
const SkyCommandRegistry = require('./SkyCommandRegistry');

class SkyCommandService {
    constructor({ botId, context, slashCommandService, skyblockReadiness, config = {}, logger = null }) {
        if (!botId) throw new TypeError('SkyCommandService requires botId.');
        if (!context) throw new TypeError('SkyCommandService requires bot context.');
        if (!slashCommandService || typeof slashCommandService.send !== 'function') throw new TypeError('SkyCommandService requires SlashCommandService.');
        if (!skyblockReadiness || typeof skyblockReadiness.status !== 'function') throw new TypeError('SkyCommandService requires Skyblock readiness service.');
        this.botId = botId;
        this.context = context;
        this.slashCommandService = slashCommandService;
        this.skyblockReadiness = skyblockReadiness;
        this.registry = new SkyCommandRegistry(config);
        this.logger = logger;
    }

    reconfigure(config = {}) {
        this.registry.replace(config);
        return this.status();
    }

    status() {
        const sky = this.skyblockReadiness.status();
        return {
            botId: this.botId,
            location: sky.location,
            selection: sky.selection,
            ready: Boolean(sky.ready),
            commands: this.registry.list(sky.selection || '', { enabledOnly: true })
        };
    }

    list(skyId = null, options = {}) {
        const active = skyId || this.skyblockReadiness.status().selection;
        return this.registry.list(active, options);
    }

    async send(commandId, {
        skyId = null,
        args = {},
        cancellationToken = null,
        expectedGeneration = null
    } = {}) {
        let definition = null;
        let effectiveSky = null;
        try {
            const state = this.skyblockReadiness.status();
            effectiveSky = String(skyId || state.selection || '').trim();
            if (!state.ready || state.location !== 'SKY') {
                throw new FlowError('Bot is not ready inside Sky; scoped Sky command was blocked.', {
                    code: 'SKY_COMMAND_NOT_IN_SKY',
                    subsystem: 'command',
                    operation: 'SkyCommandService',
                    step: 'validate-location',
                    action: 'send scoped Sky command',
                    resource: commandId,
                    retryable: true,
                    details: { botId: this.botId, requestedSky: effectiveSky, location: state.location, ready: state.ready, activeSelection: state.selection }
                });
            }
            if (effectiveSky !== state.selection) {
                throw new FlowError(`Sky command ${commandId} belongs to ${effectiveSky}, but bot is configured for ${state.selection}.`, {
                    code: 'SKY_COMMAND_WRONG_SKY',
                    subsystem: 'command',
                    operation: 'SkyCommandService',
                    step: 'validate-sky',
                    action: 'send scoped Sky command',
                    resource: commandId,
                    retryable: false,
                    details: { botId: this.botId, requestedSky: effectiveSky, activeSelection: state.selection }
                });
            }
            definition = this.registry.require(effectiveSky, commandId);
            if (definition.enabled === false) {
                throw new FlowError(`Sky command is disabled: ${effectiveSky}.${commandId}`, {
                    code: 'SKY_COMMAND_DISABLED',
                    subsystem: 'command',
                    operation: 'SkyCommandService',
                    step: 'validate-enabled',
                    action: 'send scoped Sky command',
                    resource: commandId,
                    retryable: false
                });
            }
            const command = this.#resolve(definition.command, args);
            const sent = await this.slashCommandService.send(command, { cancellationToken, expectedGeneration });
            this.logger?.info?.('Scoped Sky command sent.', {
                botId: this.botId,
                skyId: effectiveSky,
                commandId,
                command
            });
            return Result.ok({ sent, skyId: effectiveSky, commandId, command }, { skyId: effectiveSky, commandId });
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: error?.code || 'SKY_COMMAND_SEND_FAILED',
                subsystem: 'command',
                operation: 'SkyCommandService',
                step: 'send',
                action: definition?.command || String(commandId || ''),
                resource: commandId,
                details: { botId: this.botId, skyId: effectiveSky }
            });
            const status = wrapped.code === 'SKY_COMMAND_NOT_IN_SKY'
                ? Status.NOT_READY
                : Operation.statusForError(wrapped);
            return Result.fail(status, wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    #resolve(template, args) {
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Sky command args must be an object.');
        let command = String(template);
        for (const [name, value] of Object.entries(args)) command = command.replaceAll(`{${name}}`, String(value));
        if (/\{[^}]+\}/.test(command)) throw new Error('Missing Sky command argument(s).');
        return command;
    }
}

module.exports = SkyCommandService;
