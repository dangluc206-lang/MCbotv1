'use strict';

const DiscordPanelStore = require('./DiscordPanelStore');
const CollectorB5ConfigEditor = require('../config/CollectorB5ConfigEditor');
const FishingBotConfigEditor = require('../config/FishingBotConfigEditor');
const DiscordErrorReporter = require('../errors/DiscordErrorReporter');
const { createFailureEvent } = require('../../diagnostics/runtime/RuntimeFailureEvent');

class DiscordPanelManager {
    constructor({
        config,
        botRegistry,
        allowedUserIds = [],
        configuration,
        environment = process.env,
        baseDir = process.cwd(),
        logger = null,
        botProfileAdmin = null
    }) {
        this.config = config;
        this.panelConfig = config.panels || {};
        this.botRegistry = botRegistry;
        this.allowedUserIds = new Set(allowedUserIds);
        this.configuration = configuration;
        this.environment = environment;
        this.baseDir = baseDir;
        this.logger = logger;
        this.botProfileAdmin = botProfileAdmin;
        this.botId = this.panelConfig.botId || config.defaultBotId;
        // The Discord panel message is shared, but control actions can target any
        // registered bot. Keep the selected control bot separate from the panel
        // owner/default bot so bot-02, bot-03, ... are first-class controls.
        this.selectedControlBotId = this.botId;
        this.selectedAdminBotId = this.botId;
        this.selectedControlBotPage = 0;
        this.selectedAdminBotPage = 0;
        this.client = null;
        this.discord = null;
        this.guild = null;
        this.channels = {};
        this.messages = {};
        this.lastDigests = {};
        this.refreshTimer = null;
        this.refreshRunning = false;
        this.store = new DiscordPanelStore({
            baseDir,
            relativePath: this.panelConfig.storePath || 'data/runtime/discord/panels.json',
            logger
        });
        this.configEditor = new CollectorB5ConfigEditor({
            baseDir,
            configuration,
            botRegistry,
            botId: this.botId,
            logger
        });
        this.fishingConfigEditor = new FishingBotConfigEditor({
            baseDir,
            configuration,
            botRegistry,
            logger
        });
        const fishingAreas = configuration.registry?.require?.('fishingMode')?.areas || [];
        this.runtimeFailuresConfig = configuration.registry.require('app').diagnostics.runtimeFailures;
        this.selectedFishingBotId = this.botId;
        this.selectedFishingAreaId = fishingAreas[0]?.id || 'afk-11';
        this.errorReporter = new DiscordErrorReporter({
            botRegistry,
            logger,
            enabled: this.runtimeFailuresConfig.enabled,
            duplicateWindowMs: this.runtimeFailuresConfig.repeatWindowMs
        });
    }

    get enabled() {
        return this.panelConfig.enabled !== false;
    }

    async start({ client, discord, guildId = null }) {
        if (!this.enabled) return;
        this.client = client;
        this.discord = discord;
        this.guild = await this.#resolveGuild(guildId);
        if (!this.guild) {
            this.logger?.warn?.('Discord panels are enabled but no guild is available.');
            return;
        }

        this.channels.control = await this.#resolveChannel('control');
        this.channels.config = await this.#resolveChannel('config');
        this.channels.errors = this.runtimeFailuresConfig.enabled ? await this.#resolveChannel('errors') : null;
        if (this.botProfileAdmin) this.channels.admin = await this.#resolveChannel('admin');

        if (this.channels.errors) {
            this.errorReporter.start({ channel: this.channels.errors, discord });
        }

        await this.refreshAll(true);
        const intervalMs = this.#positive(this.panelConfig.refreshIntervalMs, 3000);
        this.refreshTimer = setInterval(() => {
            this.refreshAll(false).catch(error => {
                this.logger?.debug?.('Discord panel refresh failed.', { error });
            });
        }, intervalMs);
        this.refreshTimer.unref?.();

        this.logger?.info?.('Discord panels are ready.', {
            botId: this.botId,
            controlChannel: this.channels.control?.id || null,
            configChannel: this.channels.config?.id || null,
            errorChannel: this.channels.errors?.id || null,
            adminChannel: this.channels.admin?.id || null
        });
    }

    async stop() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.refreshTimer = null;
        await this.errorReporter.stop();
        this.messages = {};
        this.channels = {};
        this.lastDigests = {};
        this.client = null;
        this.guild = null;
    }

    async handleInteraction(interaction) {
        const customId = interaction?.customId;
        if (typeof customId !== 'string' || !customId.startsWith('mcbot:')) return false;

        if (!this.allowedUserIds.has(interaction.user?.id)) {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp?.({ content: 'Bạn không có quyền điều khiển MCbot.', ephemeral: true });
            } else {
                await interaction.reply?.({ content: 'Bạn không có quyền điều khiển MCbot.', ephemeral: true });
            }
            return true;
        }

        try {
            if (interaction.isButton?.()) return await this.#handleButton(interaction);
            if (interaction.isStringSelectMenu?.()) return await this.#handleSelect(interaction);
            if (interaction.isModalSubmit?.()) return await this.#handleModal(interaction);
        } catch (error) {
            this.logger?.error?.('Discord panel interaction failed.', {
                customId,
                userId: interaction.user?.id,
                error
            });
            const botId = customId.startsWith('mcbot:control:') ? this.selectedControlBotId : this.botId;
            await this.errorReporter.report(createFailureEvent({
                botId,
                source: 'discord-panel',
                subsystem: 'discord',
                severity: 'error',
                code: error?.code || 'DISCORD_PANEL_INTERACTION_FAILED',
                operation: 'DiscordPanelManager',
                step: 'handle-interaction',
                action: customId,
                message: `${customId}: ${error.message}`,
                retryable: false,
                error
            }, { botId }));
            await this.#respondError(interaction, error);
            return true;
        }
        return false;
    }

    async refreshAll(force = false) {
        if (this.refreshRunning) return;
        this.refreshRunning = true;
        try {
            await Promise.all([
                this.refreshControl(force),
                this.refreshConfig(force),
                this.refreshAdmin(force)
            ]);
        } finally {
            this.refreshRunning = false;
        }
    }

    async refreshControl(force = false) {
        const channel = this.channels.control;
        if (!channel) return;
        const payload = this.#controlPayload();
        await this.#upsertPanel('control', channel, payload, this.#marker('control'), force);
    }

    async refreshConfig(force = false) {
        const channel = this.channels.config;
        if (!channel) return;
        const payload = await this.#configPayload();
        await this.#upsertPanel('config', channel, payload, this.#marker('config'), force);
    }

    async refreshAdmin(force = false) {
        const channel = this.channels.admin;
        if (!channel || !this.botProfileAdmin) return;
        const payload = await this.#adminPayload();
        await this.#upsertPanel('admin', channel, payload, this.#marker('admin'), force);
    }

    async #handleButton(interaction) {
        const id = interaction.customId;
        if (id === 'mcbot:control-page:prev' || id === 'mcbot:control-page:next') {
            const botIds = this.#botIds();
            if (!botIds.length) throw new Error('Không có bot runtime nào được đăng ký.');
            const maxPage = Math.max(0, Math.ceil(botIds.length / 25) - 1);
            const delta = id.endsWith(':next') ? 1 : -1;
            this.selectedControlBotPage = Math.max(0, Math.min(maxPage, this.selectedControlBotPage + delta));
            this.selectedControlBotId = botIds[this.selectedControlBotPage * 25] || botIds[0];
            await interaction.deferUpdate?.();
            await this.refreshControl(true);
            return true;
        }
        if (id === 'mcbot:admin-page:prev' || id === 'mcbot:admin-page:next') {
            if (!this.botProfileAdmin) throw new Error('Bot admin service không khả dụng.');
            const profiles = await this.botProfileAdmin.listProfiles();
            if (!profiles.length) throw new Error('Không có bot profile nào.');
            const maxPage = Math.max(0, Math.ceil(profiles.length / 25) - 1);
            const delta = id.endsWith(':next') ? 1 : -1;
            this.selectedAdminBotPage = Math.max(0, Math.min(maxPage, this.selectedAdminBotPage + delta));
            this.selectedAdminBotId = profiles[this.selectedAdminBotPage * 25]?.id || profiles[0].id;
            await interaction.deferUpdate?.();
            await this.refreshAdmin(true);
            return true;
        }
        if (id.startsWith('mcbot:control:')) {
            await interaction.deferUpdate?.();
            const encoded = id.slice('mcbot:control:'.length);
            const splitAt = encoded.indexOf('|');
            const controlBotId = splitAt > 0
                ? encoded.slice(0, splitAt)
                : this.selectedControlBotId;
            const action = splitAt > 0
                ? encoded.slice(splitAt + 1)
                : encoded;
            if (!this.#botIds().includes(controlBotId)) {
                throw new Error(`Bot runtime không tồn tại: ${controlBotId}`);
            }
            this.selectedControlBotId = controlBotId;
            await this.#runControlAction(action, controlBotId);
            await this.refreshAll(true);
            return true;
        }

        if (id.startsWith('mcbot:admin:')) {
            if (!this.botProfileAdmin) throw new Error('Bot admin service không khả dụng.');
            const action = id.slice('mcbot:admin:'.length);
            if (action === 'add') {
                await interaction.showModal(await this.#adminAddModal());
                return true;
            }
            if (['connect-all', 'disconnect-all', 'stop-all-modes'].includes(action)) {
                await interaction.deferReply?.({ ephemeral: true });
                let summary;
                if (action === 'connect-all') summary = await this.botProfileAdmin.connectEnabledAll();
                else if (action === 'disconnect-all') summary = await this.botProfileAdmin.disconnectAll();
                else summary = await this.botProfileAdmin.stopAllModes();
                await interaction.editReply?.({ content: `${action}: total=${summary.total}, ok=${summary.fulfilled}, fail=${summary.rejected}.` });
                await this.refreshAll(true);
                return true;
            }
            const botId = this.selectedAdminBotId;
            if (!botId) throw new Error('Chưa chọn bot quản trị.');
            if (action === 'edit') {
                await interaction.showModal(await this.#adminEditModal(botId));
                return true;
            }
            if (action === 'clone') {
                await interaction.showModal(await this.#adminCloneModal(botId));
                return true;
            }
            await interaction.deferReply?.({ ephemeral: true });
            if (action === 'toggle-enabled') {
                const { profile } = await this.botProfileAdmin.getProfile(botId);
                const next = await this.botProfileAdmin.setEnabled(botId, !profile.enabled);
                await interaction.editReply?.({ content: `${botId}: profile ${next.enabled ? 'ENABLED' : 'DISABLED'}.` });
            } else if (action === 'apply') {
                await this.botProfileAdmin.reloadRuntime(botId);
                await interaction.editReply?.({ content: `${botId}: đã nạp lại runtime từ config.` });
            } else if (action === 'connect') {
                await this.botProfileAdmin.connect(botId);
                await interaction.editReply?.({ content: `${botId}: đã yêu cầu kết nối.` });
            } else if (action === 'disconnect') {
                await this.botProfileAdmin.disconnect(botId);
                await interaction.editReply?.({ content: `${botId}: đã ngắt Minecraft nhưng runtime/app vẫn chạy.` });
            } else if (action === 'control') {
                this.selectedControlBotId = botId;
                const controlIds = this.#botIds();
                this.selectedControlBotPage = Math.max(0, Math.floor(Math.max(0, controlIds.indexOf(botId)) / 25));
                await interaction.editReply?.({ content: `Panel điều khiển chuyển sang ${botId}.` });
            } else {
                throw new Error(`Bot admin action không hỗ trợ: ${action}`);
            }
            await this.refreshAll(true);
            return true;
        }

        if (id.startsWith('mcbot:fishing-config:')) {
            const action = id.slice('mcbot:fishing-config:'.length);
            if (action === 'edit') {
                const modal = await this.#fishingConfigModal(this.selectedFishingBotId, this.selectedFishingAreaId);
                await interaction.showModal(modal);
                return true;
            }
            if (action === 'current') {
                await interaction.deferReply?.({ ephemeral: true });
                const current = await this.fishingConfigEditor.read(this.selectedFishingBotId);
                const runtime = this.botRegistry.get(this.selectedFishingBotId);
                const position = runtime?.context?.get?.()?.entity?.position;
                if (!position) throw new Error(`Bot chưa online hoặc chưa có vị trí: ${this.selectedFishingBotId}`);
                const pitch = Number(current.resolved?.movement?.shoreFishingPitchDegrees ?? 10);
                await this.fishingConfigEditor.setAreaPosition({
                    botId: this.selectedFishingBotId,
                    areaId: this.selectedFishingAreaId,
                    x: position.x,
                    y: position.y,
                    z: position.z,
                    pitchDegrees: pitch
                });
                await this.refreshAll(true);
                await interaction.editReply?.({ content: `Đã lưu vị trí hiện tại cho ${this.selectedFishingBotId} / ${this.selectedFishingAreaId}.` });
                return true;
            }
            if (action === 'reload') {
                await interaction.deferUpdate?.();
                await this.fishingConfigEditor.reloadBot(this.selectedFishingBotId);
                await this.refreshAll(true);
                return true;
            }
            throw new Error(`Fishing config action không hỗ trợ: ${action}`);
        }

        if (id.startsWith('mcbot:config:')) {
            const action = id.slice('mcbot:config:'.length);
            if (action === 'reload') {
                await interaction.deferUpdate?.();
                await this.configEditor.reload();
                await this.refreshAll(true);
                return true;
            }
            const modal = await this.#configModal(action);
            await interaction.showModal(modal);
            return true;
        }
        return false;
    }

    async #handleSelect(interaction) {
        const id = interaction.customId;
        if (id === 'mcbot:control:bot') {
            const next = interaction.values?.[0];
            if (!next || !this.#botIds().includes(next)) {
                throw new Error(`Bot runtime không tồn tại: ${next || '(trống)'}`);
            }
            this.selectedControlBotId = next;
            await interaction.deferUpdate?.();
            await this.refreshControl(true);
            return true;
        }
        if (id === 'mcbot:admin:bot') {
            if (!this.botProfileAdmin) throw new Error('Bot admin service không khả dụng.');
            const next = interaction.values?.[0];
            const profiles = await this.botProfileAdmin.listProfiles();
            if (!profiles.some(profile => profile.id === next)) throw new Error(`Bot profile không tồn tại: ${next}`);
            this.selectedAdminBotId = next;
            await interaction.deferUpdate?.();
            await this.refreshAdmin(true);
            return true;
        }
        if (id === 'mcbot:fishing-config:bot') {
            const next = interaction.values?.[0];
            const botIds = await this.fishingConfigEditor.listBotIds();
            if (!botIds.includes(next)) throw new Error(`Bot config không tồn tại: ${next}`);
            this.selectedFishingBotId = next;
            const current = await this.fishingConfigEditor.read(next);
            if (!current.resolved.areas.some(area => area.id === this.selectedFishingAreaId)) {
                this.selectedFishingAreaId = current.resolved.areas[0]?.id || this.selectedFishingAreaId;
            }
            await interaction.deferUpdate?.();
            await this.refreshConfig(true);
            return true;
        }
        if (id === 'mcbot:fishing-config:area') {
            const next = interaction.values?.[0];
            const current = await this.fishingConfigEditor.read(this.selectedFishingBotId);
            if (!current.resolved.areas.some(area => area.id === next)) throw new Error(`Khu AFK không tồn tại: ${next}`);
            this.selectedFishingAreaId = next;
            await interaction.deferUpdate?.();
            await this.refreshConfig(true);
            return true;
        }
        return false;
    }

    async #handleModal(interaction) {
        const id = interaction.customId;
        if (id === 'mcbot:admin-modal:add') {
            if (!this.botProfileAdmin) throw new Error('Bot admin service không khả dụng.');
            await interaction.deferReply?.({ ephemeral: true });
            const profile = await this.botProfileAdmin.createProfile({
                id: interaction.fields.getTextInputValue('id'),
                displayName: interaction.fields.getTextInputValue('displayName'),
                username: interaction.fields.getTextInputValue('username'),
                auth: interaction.fields.getTextInputValue('auth'),
                version: interaction.fields.getTextInputValue('version')
            });
            this.selectedAdminBotId = profile.id;
            this.selectedControlBotId = profile.id;
            const profiles = await this.botProfileAdmin.listProfiles();
            const adminIndex = Math.max(0, profiles.findIndex(entry => entry.id === profile.id));
            this.selectedAdminBotPage = Math.floor(adminIndex / 25);
            const controlIds = this.#botIds();
            this.selectedControlBotPage = Math.floor(Math.max(0, controlIds.indexOf(profile.id)) / 25);
            await this.refreshAll(true);
            await interaction.editReply?.({ content: `Đã thêm ${profile.id} (${profile.username}). Profile tạo ở trạng thái DISABLED; bật khi sẵn sàng.` });
            return true;
        }
        if (id.startsWith('mcbot:admin-modal:edit:')) {
            if (!this.botProfileAdmin) throw new Error('Bot admin service không khả dụng.');
            const botId = id.slice('mcbot:admin-modal:edit:'.length);
            await interaction.deferReply?.({ ephemeral: true });
            const profile = await this.botProfileAdmin.updateProfile(botId, {
                displayName: interaction.fields.getTextInputValue('displayName'),
                username: interaction.fields.getTextInputValue('username'),
                auth: interaction.fields.getTextInputValue('auth'),
                version: interaction.fields.getTextInputValue('version'),
                serverProfile: interaction.fields.getTextInputValue('serverProfile')
            });
            this.selectedAdminBotId = profile.id;
            this.selectedControlBotId = profile.id;
            await this.refreshAll(true);
            await interaction.editReply?.({ content: `Đã cập nhật ${profile.id}; runtime đã được nạp lại theo config mới.` });
            return true;
        }
        if (id.startsWith('mcbot:admin-modal:clone:')) {
            if (!this.botProfileAdmin) throw new Error('Bot admin service không khả dụng.');
            const sourceId = id.slice('mcbot:admin-modal:clone:'.length);
            await interaction.deferReply?.({ ephemeral: true });
            const profile = await this.botProfileAdmin.cloneProfile(sourceId, interaction.fields.getTextInputValue('newId'));
            this.selectedAdminBotId = profile.id;
            await this.refreshAll(true);
            await interaction.editReply?.({ content: `Đã clone ${sourceId} → ${profile.id}. Profile mới đang DISABLED; sửa username trước khi bật.` });
            return true;
        }
        if (id.startsWith('mcbot:fishing-config-modal:')) {
            const encoded = id.slice('mcbot:fishing-config-modal:'.length);
            const splitAt = encoded.indexOf('|');
            if (splitAt <= 0) throw new Error('Fishing config modal id không hợp lệ.');
            const botId = encoded.slice(0, splitAt);
            const areaId = encoded.slice(splitAt + 1);
            await interaction.deferReply?.({ ephemeral: true });
            await this.fishingConfigEditor.setAreaPosition({
                botId,
                areaId,
                x: interaction.fields.getTextInputValue('x'),
                y: interaction.fields.getTextInputValue('y'),
                z: interaction.fields.getTextInputValue('z'),
                pitchDegrees: interaction.fields.getTextInputValue('pitch')
            });
            this.selectedFishingBotId = botId;
            this.selectedFishingAreaId = areaId;
            await this.refreshAll(true);
            await interaction.editReply?.({ content: `Đã cập nhật điểm câu ${botId} / ${areaId}.` });
            return true;
        }
        if (!id.startsWith('mcbot:config-modal:')) return false;
        const action = id.slice('mcbot:config-modal:'.length);
        await interaction.deferReply?.({ ephemeral: true });

        if (action === 'pickup') {
            await this.configEditor.setPickupLocation({
                x: interaction.fields.getTextInputValue('x'),
                y: interaction.fields.getTextInputValue('y'),
                z: interaction.fields.getTextInputValue('z')
            });
        } else if (action === 'craft-delay') {
            await this.configEditor.setCraftLoopDelayMs(interaction.fields.getTextInputValue('milliseconds'));
        } else if (action === 'poll') {
            await this.configEditor.setPollSeconds(interaction.fields.getTextInputValue('seconds'));
        } else if (action === 'reanchor') {
            await this.configEditor.setReanchorRadius(interaction.fields.getTextInputValue('radius'));
        } else {
            throw new Error(`Config action không hỗ trợ: ${action}`);
        }

        await this.refreshAll(true);
        await interaction.editReply?.({ content: 'Đã cập nhật config.' });
        return true;
    }

    async #runControlAction(action, botId = this.selectedControlBotId) {
        const runtime = this.botRegistry.require(botId);
        const collectorMode = runtime.requireService('collectorB5Mode');
        const fishingMode = runtime.requireService('fishingMode');
        const collectorStatus = collectorMode.status();
        const fishingStatus = fishingMode.status();
        const activeMode = fishingStatus.enabled ? fishingMode : collectorStatus.enabled ? collectorMode : null;
        const activeModeName = fishingStatus.enabled ? 'fishing' : collectorStatus.enabled ? 'collector' : null;
        let result = null;

        if (action === 'join') {
            await runtime.requireService('connectionManager').connect();
            return;
        }
        if (action === 'sky') {
            this.#requireConnected(runtime);
            result = await runtime.requireService('serverFeatureFacade').skyblock().join();
        } else if (action === 'mode') {
            this.#requireConnected(runtime);
            if (fishingStatus.enabled) throw new Error('Mode câu cá đang bật. Dừng hẳn mode đó trước.');
            result = await collectorMode.enable();
        } else if (action === 'fishing') {
            this.#requireConnected(runtime);
            if (collectorStatus.enabled) throw new Error('Mode Nhặt+B5 đang bật. Dừng hẳn mode đó trước.');
            result = await fishingMode.enable();
        } else if (action === 'pause') {
            if (!activeMode) throw new Error('Không có mode nào đang chạy.');
            result = await activeMode.pause('Paused from Discord control panel.');
        } else if (action === 'resume') {
            this.#requireConnected(runtime);
            if (!activeMode) throw new Error('Không có mode nào để chạy tiếp.');
            result = await activeMode.resume();
        } else if (action === 'stop-mode') {
            result = await this.#hardStopModes(runtime, 'Hard stop from Discord control panel.');
        } else if (action === 'restart-mode') {
            this.#requireConnected(runtime);
            if (!activeModeName) throw new Error('Không có mode nào để khởi động lại.');
            await this.#hardStopModes(runtime, 'Restarting mode from Discord control panel.');
            result = activeModeName === 'fishing'
                ? await fishingMode.enable()
                : await collectorMode.enable();
        } else if (action === 'reset') {
            result = await this.#resetInteractions(runtime, { pauseMode: true });
        } else if (action === 'auto-fix') {
            result = await this.#autoFix(runtime, { collectorMode, fishingMode });
        } else if (action === 'home') {
            this.#requireConnected(runtime);
            if (activeMode && !activeMode.status().paused) {
                const paused = await activeMode.pause('Paused before manual /is from Discord panel.');
                if (!paused.success) throw paused.error || new Error(paused.message || 'Không pause được mode trước /is.');
            }
            result = await runtime.requireService('serverFeatureFacade').island().goHome();
        } else {
            throw new Error(`Control action không hỗ trợ: ${action}`);
        }

        if (result && result.success === false) {
            throw result.error || new Error(result.message || `Action ${action} thất bại.`);
        }
    }

    async #autoFix(runtime, { collectorMode, fishingMode }) {
        const gui = runtime.getService?.('guiManager')?.describeCurrent?.() || null;
        const fishingStatus = fishingMode?.status?.() || { enabled: false, paused: false, phase: 'DISABLED' };
        const collectorStatus = collectorMode?.status?.() || { enabled: false, paused: false, phase: 'OFF' };
        const activeName = fishingStatus.enabled ? 'fishing' : collectorStatus.enabled ? 'collector' : null;
        const active = activeName === 'fishing' ? fishingMode : activeName === 'collector' ? collectorMode : null;
        const activeStatus = activeName === 'fishing' ? fishingStatus : activeName === 'collector' ? collectorStatus : null;

        if (activeStatus?.lastError || ['ERROR', 'WAITING_RETRY'].includes(activeStatus?.phase)) {
            await this.#hardStopModes(runtime, 'Automatic Discord mode recovery.');
            return activeName === 'fishing' ? fishingMode.enable() : collectorMode.enable();
        }
        if (activeStatus?.paused) return active.resume();
        if (gui?.windowId !== null && gui?.windowId !== undefined) return this.#resetInteractions(runtime, { pauseMode: Boolean(active) });
        if (active) {
            // State looks healthy; restart only the mode, never the Minecraft connection.
            await this.#hardStopModes(runtime, 'Automatic Discord clean mode restart.');
            return activeName === 'fishing' ? fishingMode.enable() : collectorMode.enable();
        }
        return this.#resetInteractions(runtime, { pauseMode: false });
    }

    async #hardStopModes(runtime, reason) {
        const collectorMode = runtime.requireService('collectorB5Mode');
        const fishingMode = runtime.requireService('fishingMode');
        const results = [];
        if (fishingMode.status().enabled) results.push(await fishingMode.disable(reason));
        if (collectorMode.status().enabled) results.push(await collectorMode.disable(reason));
        await this.#resetInteractions(runtime, { pauseMode: false });
        const failed = results.find(entry => entry?.success === false);
        return failed || { success: true, data: { stopped: results.length } };
    }

    async #resetInteractions(runtime, { pauseMode = true } = {}) {
        const collectorMode = runtime.requireService('collectorB5Mode');
        const fishingMode = runtime.requireService('fishingMode');
        const activeMode = fishingMode.status().enabled ? fishingMode : collectorMode.status().enabled ? collectorMode : null;

        if (pauseMode && activeMode && !activeMode.status().paused) {
            const paused = await activeMode.pause('Interaction reset from Discord control panel.');
            if (paused?.success === false) throw paused.error || new Error(paused.message || 'Không pause được mode để reset.');
        }

        const cancelledOperations = runtime.getService?.('operationManager')?.cancelAll?.('Discord interaction reset.') || 0;
        await runtime.getService?.('movementManager')?.stop?.();
        await runtime.getService?.('guiManager')?.closeCurrentWindow?.();
        return { success: true, data: { paused: Boolean(activeMode?.status?.().paused), cancelledOperations } };
    }

    #controlPayload() {
        const botIds = this.#botIds();
        if (!botIds.length) throw new Error('Không có bot runtime nào được đăng ký.');
        if (!botIds.includes(this.selectedControlBotId)) {
            this.selectedControlBotId = botIds.includes(this.botId) ? this.botId : botIds[0];
        }

        const controlBotId = this.selectedControlBotId;
        const runtime = this.botRegistry.require(controlBotId);
        const displayName = runtime.identity?.displayName || controlBotId;
        const username = runtime.identity?.username || '-';
        const bot = runtime.context.get();
        const online = Boolean(bot);
        const collectorMode = runtime.requireService('collectorB5Mode').status();
        const fishingService = runtime.getService?.('fishingMode') || null;
        const fishingMode = fishingService?.status?.() || { enabled: false, paused: false, phase: 'DISABLED', catches: 0, areas: [] };
        const gui = runtime.getService?.('guiManager')?.describeCurrent?.() || null;
        const activeMode = fishingMode.enabled ? fishingMode : collectorMode.enabled ? collectorMode : null;
        const position = bot?.entity?.position || activeMode?.position || null;
        const mainHand = bot?.heldItem || null;
        const offHand = bot?.inventory?.slots?.[45] || null;
        const hp = online && Number.isFinite(bot.health) ? `${this.#number(bot.health)}/20` : '-';
        const food = online && Number.isFinite(bot.food) ? `${this.#number(bot.food)}/20` : '-';
        const modeText = fishingMode.enabled
            ? `Câu cá — ${fishingMode.paused ? 'PAUSED' : fishingMode.phase}`
            : collectorMode.enabled
                ? `Nhặt + B5 — ${collectorMode.paused ? 'PAUSED' : collectorMode.phase}`
                : 'Không';

        const fields = [
            { name: 'Bot điều khiển', value: `**${displayName}** \`${controlBotId}\``, inline: true },
            { name: 'Minecraft', value: `\`${username}\``, inline: true },
            { name: 'Trạng thái', value: online ? '`ONLINE`' : '`OFFLINE`', inline: true },
            { name: 'Máu', value: `\`${hp}\``, inline: true },
            { name: 'Độ no', value: `\`${food}\``, inline: true },
            { name: 'Tay trái', value: this.#itemText(offHand), inline: true },
            { name: 'Tay phải', value: this.#itemText(mainHand), inline: true },
            { name: 'Vị trí', value: `\`${this.#positionText(position)}\``, inline: true },
            { name: 'Mode hiện tại', value: `\`${modeText}\`` },
            { name: 'Tác vụ', value: this.#operationStatusText(runtime.getService?.('operationManager')?.snapshot?.()), inline: true },
            { name: 'Khôi phục đề xuất', value: this.#recoveryAdvice({ online, collectorMode, fishingMode, gui }) }
        ];
        if (collectorMode.enabled) {
            if (collectorMode.lastError) {
                const retryText = Number(collectorMode.unhandledRetryCount || 0) > 0
                    ? ` | auto-retry #${Number(collectorMode.unhandledRetryCount || 0)}`
                    : '';
                fields.push({
                    name: 'Lỗi Collector+B5 gần nhất',
                    value: `\`phase=${collectorMode.lastUnhandledPhase || collectorMode.phase || 'UNKNOWN'}${retryText}\`\n${String(collectorMode.lastError).slice(0, 900)}`
                });
            }
            fields.push({
                name: 'Đang làm',
                value: `**${collectorMode.activity || 'Đang chạy'}**`,
                inline: true
            });
            fields.push({
                name: 'Tiến độ B5',
                value: this.#simpleB5ProgressText(collectorMode),
                inline: true
            });
        }
        if (fishingMode.enabled) {
            fields.push(
                { name: 'Khu AFK câu cá', value: `\`${fishingMode.currentAreaId || 'đang chọn khu'}\``, inline: true },
                { name: 'Câu thành công', value: `\`${Number(fishingMode.catches || 0)}\``, inline: true },
                { name: 'Số người khu AFK', value: this.#fishingAreasText(fishingMode.areas) }
            );
        }

        const embed = new this.discord.EmbedBuilder()
            .setTitle(`MCbot - ${displayName} [${controlBotId}]`.slice(0, 256))
            .addFields(...fields)
            .setFooter({ text: this.#marker('control') });

        const controlMaxPage = Math.max(0, Math.ceil(botIds.length / 25) - 1);
        this.selectedControlBotPage = Math.max(0, Math.min(controlMaxPage, this.selectedControlBotPage));
        const controlPageStart = this.selectedControlBotPage * 25;
        const controlPageIds = botIds.slice(controlPageStart, controlPageStart + 25);
        const botOptions = controlPageIds.map(botId => {
            const candidate = this.botRegistry.get?.(botId);
            return {
                label: String(candidate?.identity?.displayName || botId).slice(0, 100),
                description: `${botId} | ${candidate?.identity?.username || '-'}`.slice(0, 100),
                value: botId,
                default: botId === controlBotId
            };
        });
        const botRow = new this.discord.ActionRowBuilder().addComponents(
            new this.discord.StringSelectMenuBuilder()
                .setCustomId('mcbot:control:bot')
                .setPlaceholder(`Chọn bot để điều khiển • trang ${this.selectedControlBotPage + 1}/${controlMaxPage + 1}`)
                .addOptions(...botOptions)
        );
        const controlPageRow = controlMaxPage > 0
            ? new this.discord.ActionRowBuilder().addComponents(
                new this.discord.ButtonBuilder().setCustomId('mcbot:control-page:prev').setLabel('◀ Bot trước').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(this.selectedControlBotPage <= 0),
                new this.discord.ButtonBuilder().setCustomId('mcbot:control-page:next').setLabel('Bot sau ▶').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(this.selectedControlBotPage >= controlMaxPage)
            )
            : null;

        const anyModeEnabled = collectorMode.enabled || fishingMode.enabled;
        const activePaused = Boolean(activeMode?.paused);
        const cid = action => `mcbot:control:${controlBotId}|${action}`;

        // Keep the lightweight six-button layout for minimal/legacy runtimes.
        // Full production runtimes expose recovery/fishing controls below.
        const hasAdvancedRecovery = Boolean(
            fishingService
            || runtime.getService?.('operationManager')
        );
        if (!hasAdvancedRecovery && botIds.length === 1) {
            const legacyRow1 = new this.discord.ActionRowBuilder().addComponents(
                new this.discord.ButtonBuilder().setCustomId(cid('join')).setLabel('Join Server').setStyle(this.discord.ButtonStyle.Primary).setDisabled(online),
                new this.discord.ButtonBuilder().setCustomId(cid('sky')).setLabel('Sky thủ công').setStyle(this.discord.ButtonStyle.Primary).setDisabled(!online),
                new this.discord.ButtonBuilder().setCustomId(cid('mode')).setLabel('Mode').setStyle(this.discord.ButtonStyle.Success).setDisabled(!online || anyModeEnabled)
            );
            const legacyRow2 = new this.discord.ActionRowBuilder().addComponents(
                new this.discord.ButtonBuilder().setCustomId(cid('pause')).setLabel('Dừng').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(!anyModeEnabled || activePaused),
                new this.discord.ButtonBuilder().setCustomId(cid('resume')).setLabel('Chạy tiếp').setStyle(this.discord.ButtonStyle.Success).setDisabled(!online || !anyModeEnabled || !activePaused),
                new this.discord.ButtonBuilder().setCustomId(cid('home')).setLabel('Về đảo').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(!online)
            );
            return { embeds: [embed], components: [legacyRow1, legacyRow2] };
        }

        const row1 = new this.discord.ActionRowBuilder().addComponents(
            new this.discord.ButtonBuilder().setCustomId(cid('join')).setLabel('Join Server').setStyle(this.discord.ButtonStyle.Primary).setDisabled(online),
            new this.discord.ButtonBuilder().setCustomId(cid('sky')).setLabel('Sky thủ công').setStyle(this.discord.ButtonStyle.Primary).setDisabled(!online),
            new this.discord.ButtonBuilder().setCustomId(cid('mode')).setLabel('Bật Nhặt + B5').setStyle(this.discord.ButtonStyle.Success).setDisabled(!online || anyModeEnabled),
            new this.discord.ButtonBuilder().setCustomId(cid('fishing')).setLabel('Bật Câu cá').setStyle(this.discord.ButtonStyle.Success).setDisabled(!online || anyModeEnabled)
        );
        const row2 = new this.discord.ActionRowBuilder().addComponents(
            new this.discord.ButtonBuilder().setCustomId(cid('pause')).setLabel('Tạm dừng').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(!anyModeEnabled || activePaused),
            new this.discord.ButtonBuilder().setCustomId(cid('resume')).setLabel('Chạy tiếp').setStyle(this.discord.ButtonStyle.Success).setDisabled(!online || !anyModeEnabled || !activePaused),
            new this.discord.ButtonBuilder().setCustomId(cid('home')).setLabel('Về đảo').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(!online)
        );
        const row3 = new this.discord.ActionRowBuilder().addComponents(
            new this.discord.ButtonBuilder().setCustomId(cid('stop-mode')).setLabel('Dừng hẳn mode').setStyle(this.discord.ButtonStyle.Danger).setDisabled(!anyModeEnabled),
            new this.discord.ButtonBuilder().setCustomId(cid('restart-mode')).setLabel('Restart mode').setStyle(this.discord.ButtonStyle.Primary).setDisabled(!online || !anyModeEnabled),
            new this.discord.ButtonBuilder().setCustomId(cid('reset')).setLabel('Reset thao tác').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(!online),
            new this.discord.ButtonBuilder().setCustomId(cid('auto-fix')).setLabel('Tự sửa lỗi').setStyle(this.discord.ButtonStyle.Primary).setDisabled(!online)
        );
        return { embeds: [embed], components: [botRow, row1, row2, row3, controlPageRow].filter(Boolean) };
    }

    #botIds() {
        if (typeof this.botRegistry.ids === 'function') return this.botRegistry.ids();
        if (typeof this.botRegistry.list === 'function') return this.botRegistry.list().map(runtime => runtime.botId).filter(Boolean);
        return [];
    }

    #recoveryAdvice({ online, collectorMode, fishingMode, gui }) {
        if (!online) return '`Bot offline → Join Server.`';
        const active = fishingMode.enabled ? fishingMode : collectorMode.enabled ? collectorMode : null;
        if (active?.lastError || active?.phase === 'ERROR' || active?.phase === 'WAITING_RETRY') {
            if (gui?.windowId !== null && gui?.windowId !== undefined) {
                return '`Reset thao tác → Restart mode. Không cần thoát bot.`';
            }
            return '`Restart mode để hủy state cũ và bật lại từ đầu. Không reconnect.`';
        }
        if (active?.paused) return '`Chạy tiếp; nếu state vẫn sai thì Restart mode.`';
        if (gui?.windowId !== null && gui?.windowId !== undefined && !active) return '`Có GUI đang mở; Reset thao tác để đóng sạch.`';
        if (active) return '`Mode đang chạy. Tạm dừng để can thiệp; Restart mode nếu hành vi sai.`';
        return '`Không có mode đang chạy; chọn mode cần bật.`';
    }

    #operationStatusText(snapshot) {
        if (!snapshot) return '`active=0 | pending=0`';
        return `\`active=${Number(snapshot.active || 0)} | pending=${Number(snapshot.pending || 0)}\``;
    }

    async #adminPayload() {
        const profiles = await this.botProfileAdmin.listProfiles();
        if (!profiles.length) {
            const embed = new this.discord.EmbedBuilder()
                .setTitle('MCbot - Quản trị bot')
                .setDescription('Chưa có bot profile. Bấm **Thêm bot** để tạo profile đầu tiên.')
                .setFooter({ text: this.#marker('admin') });
            const row = new this.discord.ActionRowBuilder().addComponents(
                new this.discord.ButtonBuilder().setCustomId('mcbot:admin:add').setLabel('Thêm bot').setStyle(this.discord.ButtonStyle.Success)
            );
            return { embeds: [embed], components: [row] };
        }
        if (!profiles.some(profile => profile.id === this.selectedAdminBotId)) {
            this.selectedAdminBotId = profiles.some(profile => profile.id === this.selectedControlBotId)
                ? this.selectedControlBotId
                : profiles[0].id;
        }
        const selected = profiles.find(profile => profile.id === this.selectedAdminBotId);
        const runtime = this.botRegistry.get?.(selected.id) || null;
        const online = Boolean(runtime?.context?.has?.());
        const state = runtime?.getState?.() || {};
        const collector = runtime?.getService?.('collectorB5Mode')?.status?.() || null;
        const fishing = runtime?.getService?.('fishingMode')?.status?.() || null;
        const activeMode = fishing?.enabled ? `Câu cá/${fishing.phase}` : collector?.enabled ? `Nhặt+B5/${collector.phase}` : 'Không';
        const enabledCount = profiles.filter(profile => profile.enabled).length;
        const onlineCount = profiles.filter(profile => this.botRegistry.get?.(profile.id)?.context?.has?.()).length;
        const adminMaxPage = Math.max(0, Math.ceil(profiles.length / 25) - 1);
        this.selectedAdminBotPage = Math.max(0, Math.min(adminMaxPage, this.selectedAdminBotPage));
        const adminPageStart = this.selectedAdminBotPage * 25;
        const adminPageProfiles = profiles.slice(adminPageStart, adminPageStart + 25);
        const summary = adminPageProfiles.slice(0, 20).map(profile => {
            const rt = this.botRegistry.get?.(profile.id);
            const mark = rt?.context?.has?.() ? '🟢' : profile.enabled ? '🟡' : '⚫';
            return `${mark} \`${profile.id}\` — ${profile.displayName || profile.id} — \`${profile.username || '-'}\``;
        }).join('\n');
        const embed = new this.discord.EmbedBuilder()
            .setTitle('MCbot - Quản trị nhiều bot')
            .addFields(
                { name: 'Tổng quan', value: `\`profiles=${profiles.length} | enabled=${enabledCount} | online=${onlineCount} | trang=${this.selectedAdminBotPage + 1}/${adminMaxPage + 1}\`` },
                { name: 'Bot đang chọn', value: `\`${selected.id}\` — **${selected.displayName || selected.id}**`, inline: true },
                { name: 'Minecraft username', value: `\`${selected.username || '-'}\``, inline: true },
                { name: 'Profile', value: `\`${selected.enabled ? 'ENABLED' : 'DISABLED'}\``, inline: true },
                { name: 'Kết nối', value: `\`${online ? 'ONLINE' : (state.connectionState || 'OFFLINE')}\``, inline: true },
                { name: 'Mode', value: `\`${activeMode}\``, inline: true },
                { name: 'Version/Auth', value: `\`${selected.version === false ? 'auto' : selected.version || 'auto'} / ${selected.auth || 'offline'}\``, inline: true },
                { name: 'Danh sách', value: summary || '`trống`' },
                { name: 'Ghi chú', value: '`Bot mới tạo DISABLED. Password/token không nhập qua Discord; secret vẫn lấy từ environment.`' }
            )
            .setFooter({ text: this.#marker('admin') });

        const select = new this.discord.ActionRowBuilder().addComponents(
            new this.discord.StringSelectMenuBuilder()
                .setCustomId('mcbot:admin:bot')
                .setPlaceholder(`Chọn bot để quản trị • trang ${this.selectedAdminBotPage + 1}/${adminMaxPage + 1}`)
                .addOptions(...adminPageProfiles.map(profile => ({
                    label: String(profile.displayName || profile.id).slice(0, 100),
                    description: `${profile.id} | ${profile.username || '-'} | ${profile.enabled ? 'enabled' : 'disabled'}`.slice(0, 100),
                    value: profile.id,
                    default: profile.id === selected.id
                })))
        );
        const row1 = new this.discord.ActionRowBuilder().addComponents(
            new this.discord.ButtonBuilder().setCustomId('mcbot:admin:add').setLabel('Thêm bot').setStyle(this.discord.ButtonStyle.Success),
            new this.discord.ButtonBuilder().setCustomId('mcbot:admin:edit').setLabel('Sửa bot').setStyle(this.discord.ButtonStyle.Primary),
            new this.discord.ButtonBuilder().setCustomId('mcbot:admin:clone').setLabel('Clone bot').setStyle(this.discord.ButtonStyle.Secondary),
            new this.discord.ButtonBuilder().setCustomId('mcbot:admin:toggle-enabled').setLabel(selected.enabled ? 'Disable profile' : 'Enable profile').setStyle(selected.enabled ? this.discord.ButtonStyle.Danger : this.discord.ButtonStyle.Success),
            new this.discord.ButtonBuilder().setCustomId('mcbot:admin:apply').setLabel('Nạp lại runtime').setStyle(this.discord.ButtonStyle.Secondary)
        );
        const row2 = new this.discord.ActionRowBuilder().addComponents(
            new this.discord.ButtonBuilder().setCustomId('mcbot:admin:connect').setLabel('Connect').setStyle(this.discord.ButtonStyle.Success).setDisabled(online || !selected.enabled),
            new this.discord.ButtonBuilder().setCustomId('mcbot:admin:disconnect').setLabel('Disconnect').setStyle(this.discord.ButtonStyle.Danger).setDisabled(!online),
            new this.discord.ButtonBuilder().setCustomId('mcbot:admin:control').setLabel('Điều khiển bot này').setStyle(this.discord.ButtonStyle.Primary)
        );
        const row3 = new this.discord.ActionRowBuilder().addComponents(
            new this.discord.ButtonBuilder().setCustomId('mcbot:admin:connect-all').setLabel('Connect tất cả enabled').setStyle(this.discord.ButtonStyle.Success),
            new this.discord.ButtonBuilder().setCustomId('mcbot:admin:disconnect-all').setLabel('Disconnect tất cả').setStyle(this.discord.ButtonStyle.Danger),
            new this.discord.ButtonBuilder().setCustomId('mcbot:admin:stop-all-modes').setLabel('Dừng tất cả mode').setStyle(this.discord.ButtonStyle.Secondary)
        );
        const adminPageRow = adminMaxPage > 0
            ? new this.discord.ActionRowBuilder().addComponents(
                new this.discord.ButtonBuilder().setCustomId('mcbot:admin-page:prev').setLabel('◀ Bot trước').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(this.selectedAdminBotPage <= 0),
                new this.discord.ButtonBuilder().setCustomId('mcbot:admin-page:next').setLabel('Bot sau ▶').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(this.selectedAdminBotPage >= adminMaxPage)
            )
            : null;
        return { embeds: [embed], components: [select, row1, row2, row3, adminPageRow].filter(Boolean) };
    }

    async #adminAddModal() {
        return new this.discord.ModalBuilder()
            .setCustomId('mcbot:admin-modal:add')
            .setTitle('Thêm bot mới')
            .addComponents(
                this.#inputRow('id', 'Bot ID (vd bot-03)', ''),
                this.#inputRow('displayName', 'Tên hiển thị', ''),
                this.#inputRow('username', 'Minecraft username', ''),
                this.#inputRow('auth', 'Auth (offline/microsoft)', 'offline'),
                this.#inputRow('version', 'Version (auto hoặc 1.21.1)', '1.21.1')
            );
    }

    async #adminEditModal(botId) {
        const { profile } = await this.botProfileAdmin.getProfile(botId);
        return new this.discord.ModalBuilder()
            .setCustomId(`mcbot:admin-modal:edit:${botId}`)
            .setTitle(`Sửa ${botId}`.slice(0, 45))
            .addComponents(
                this.#inputRow('displayName', 'Tên hiển thị', profile.displayName || profile.id),
                this.#inputRow('username', 'Minecraft username', profile.username || ''),
                this.#inputRow('auth', 'Auth', profile.auth || 'offline'),
                this.#inputRow('version', 'Version (auto hoặc số)', profile.version === false ? 'auto' : profile.version || 'auto'),
                this.#inputRow('serverProfile', 'Server profile', profile.serverProfile || 'default')
            );
    }

    async #adminCloneModal(botId) {
        return new this.discord.ModalBuilder()
            .setCustomId(`mcbot:admin-modal:clone:${botId}`)
            .setTitle(`Clone ${botId}`.slice(0, 45))
            .addComponents(this.#inputRow('newId', 'Bot ID mới', ''));
    }

    async #configPayload() {
        let current;
        try {
            current = await this.configEditor.read();
        } catch {
            current = this.botRegistry.require(this.botId).requireService('collectorB5Mode').publicConfig();
        }
        const p = current.pickupLocation || {};
        const pickup = [p.x, p.y, p.z].every(Number.isFinite)
            ? `${p.x}, ${p.y}, ${p.z}`
            : 'chưa cấu hình';
        const craftDelayMs = this.#number(Number(current.craftLoopDelayMs || 250));
        const pollSeconds = this.#number(Number(current.pollIntervalMs || 0) / 1000);
        const reanchor = this.#number(Number(current.reanchorRadius || 0));

        const collectorRow = new this.discord.ActionRowBuilder().addComponents(
            new this.discord.ButtonBuilder().setCustomId('mcbot:config:pickup').setLabel('Điểm nhặt').setStyle(this.discord.ButtonStyle.Primary),
            new this.discord.ButtonBuilder().setCustomId('mcbot:config:craft-delay').setLabel('Độ trễ chế').setStyle(this.discord.ButtonStyle.Secondary),
            new this.discord.ButtonBuilder().setCustomId('mcbot:config:poll').setLabel('Chu kỳ kiểm tra').setStyle(this.discord.ButtonStyle.Secondary),
            new this.discord.ButtonBuilder().setCustomId('mcbot:config:reanchor').setLabel('Reanchor').setStyle(this.discord.ButtonStyle.Secondary),
            new this.discord.ButtonBuilder().setCustomId('mcbot:config:reload').setLabel('Nạp lại').setStyle(this.discord.ButtonStyle.Success)
        );

        let configuredBotIds = [];
        try {
            configuredBotIds = await this.fishingConfigEditor.listBotIds();
        } catch {}
        const botIds = configuredBotIds.length > 0 ? configuredBotIds : this.#botIds();
        if (!botIds.includes(this.selectedFishingBotId)) this.selectedFishingBotId = botIds[0] || this.botId;

        let fishing = null;
        try {
            fishing = await this.fishingConfigEditor.read(this.selectedFishingBotId);
        } catch {
            const requireConfig = this.configuration?.registry?.require;
            if (typeof requireConfig === 'function') {
                try {
                    const resolved = requireConfig.call(this.configuration.registry, 'fishingMode');
                    fishing = { resolved, overrides: {} };
                } catch {}
            }
        }

        // Fishing is an optional panel capability. A partial/legacy installation must
        // still get the Collector+B5 config panel instead of failing panel startup.
        if (!fishing?.resolved || !Array.isArray(fishing.resolved.areas) || fishing.resolved.areas.length === 0) {
            const embed = new this.discord.EmbedBuilder()
                .setTitle(`MCbot Config - ${this.botId}`)
                .addFields(
                    { name: 'Điểm nhặt', value: `\`${pickup}\`` },
                    { name: 'Chế B1→B5', value: '`liên tục, không cooldown`', inline: true },
                    { name: 'Độ trễ sau lượt chế', value: `\`${craftDelayMs} ms\``, inline: true },
                    { name: 'Chu kỳ kiểm tra', value: `\`${pollSeconds} giây\``, inline: true },
                    { name: 'Reanchor radius', value: `\`${reanchor}\``, inline: true }
                )
                .setFooter({ text: this.#marker('config') });
            return { embeds: [embed], components: [collectorRow] };
        }

        if (!fishing.resolved.areas.some(area => area.id === this.selectedFishingAreaId)) {
            this.selectedFishingAreaId = fishing.resolved.areas[0]?.id || this.selectedFishingAreaId;
        }
        const selectedArea = fishing.resolved.areas.find(area => area.id === this.selectedFishingAreaId) || null;
        const fp = selectedArea?.destination || {};
        const fishingPosition = [fp.x, fp.y, fp.z].every(Number.isFinite)
            ? `${this.#number(fp.x)}, ${this.#number(fp.y)}, ${this.#number(fp.z)}`
            : 'chưa cấu hình';
        const pitch = this.#number(fishing.resolved?.movement?.shoreFishingPitchDegrees ?? 10);
        const explicitArea = Boolean(fishing.overrides?.areas?.[this.selectedFishingAreaId]);
        const explicitPitch = Number.isFinite(Number(fishing.overrides?.shoreFishingPitchDegrees));

        const embed = new this.discord.EmbedBuilder()
            .setTitle(`MCbot Config - ${this.botId}`)
            .addFields(
                { name: 'Điểm nhặt', value: `\`${pickup}\`` },
                { name: 'Chế B1→B5', value: '`liên tục, không cooldown`', inline: true },
                { name: 'Độ trễ sau lượt chế', value: `\`${craftDelayMs} ms\``, inline: true },
                { name: 'Chu kỳ kiểm tra', value: `\`${pollSeconds} giây\``, inline: true },
                { name: 'Reanchor radius', value: `\`${reanchor}\``, inline: true },
                { name: 'Bot cấu hình câu', value: `\`${this.selectedFishingBotId}\``, inline: true },
                { name: 'Khu AFK', value: `\`${this.selectedFishingAreaId}\``, inline: true },
                { name: 'Điểm đứng câu', value: `\`${fishingPosition}\` (${explicitArea ? 'riêng bot' : 'mặc định chung'})` },
                { name: 'Góc cúi khi câu', value: `\`${pitch}°\` (${explicitPitch ? 'riêng bot' : 'mặc định chung'})`, inline: true }
            )
            .setFooter({ text: this.#marker('config') });

        const botOptions = botIds.slice(0, 25).map(botId => ({
            label: botId,
            value: botId,
            default: botId === this.selectedFishingBotId
        }));
        const botRow = new this.discord.ActionRowBuilder().addComponents(
            new this.discord.StringSelectMenuBuilder()
                .setCustomId('mcbot:fishing-config:bot')
                .setPlaceholder('Chọn bot để cấu hình câu')
                .addOptions(...botOptions)
        );

        const areaOptions = fishing.resolved.areas.slice(0, 25).map(area => ({
            label: `${area.id} (slot ${area.menuSlot})`,
            value: area.id,
            default: area.id === this.selectedFishingAreaId
        }));
        const areaRow = new this.discord.ActionRowBuilder().addComponents(
            new this.discord.StringSelectMenuBuilder()
                .setCustomId('mcbot:fishing-config:area')
                .setPlaceholder('Chọn khu AFK')
                .addOptions(...areaOptions)
        );

        const fishingRow = new this.discord.ActionRowBuilder().addComponents(
            new this.discord.ButtonBuilder().setCustomId('mcbot:fishing-config:edit').setLabel('Sửa điểm câu').setStyle(this.discord.ButtonStyle.Primary),
            new this.discord.ButtonBuilder().setCustomId('mcbot:fishing-config:current').setLabel('Lấy vị trí hiện tại').setStyle(this.discord.ButtonStyle.Secondary),
            new this.discord.ButtonBuilder().setCustomId('mcbot:fishing-config:reload').setLabel('Nạp config bot').setStyle(this.discord.ButtonStyle.Success)
        );
        return { embeds: [embed], components: [collectorRow, botRow, areaRow, fishingRow] };
    }

    async #configModal(action) {
        const current = await this.configEditor.read();
        if (action === 'pickup') {
            const p = current.pickupLocation || {};
            return new this.discord.ModalBuilder()
                .setCustomId('mcbot:config-modal:pickup')
                .setTitle('Điểm đứng nhặt')
                .addComponents(
                    this.#inputRow('x', 'X', p.x),
                    this.#inputRow('y', 'Y', p.y),
                    this.#inputRow('z', 'Z', p.z)
                );
        }
        if (action === 'craft-delay') {
            return new this.discord.ModalBuilder()
                .setCustomId('mcbot:config-modal:craft-delay')
                .setTitle('Độ trễ sau lượt chế')
                .addComponents(this.#inputRow('milliseconds', 'Mili giây', Number(current.craftLoopDelayMs || 250)));
        }
        if (action === 'poll') {
            return new this.discord.ModalBuilder()
                .setCustomId('mcbot:config-modal:poll')
                .setTitle('Chu kỳ kiểm tra')
                .addComponents(this.#inputRow('seconds', 'Giây', Number(current.pollIntervalMs || 0) / 1000));
        }
        if (action === 'reanchor') {
            return new this.discord.ModalBuilder()
                .setCustomId('mcbot:config-modal:reanchor')
                .setTitle('Reanchor radius')
                .addComponents(this.#inputRow('radius', 'Khoảng cách', current.reanchorRadius));
        }
        throw new Error(`Config action không hỗ trợ: ${action}`);
    }

    async #fishingConfigModal(botId, areaId) {
        const current = await this.fishingConfigEditor.read(botId);
        const area = current.resolved.areas.find(entry => entry.id === areaId);
        if (!area) throw new Error(`Khu AFK không tồn tại: ${areaId}`);
        const p = area.destination || {};
        const pitch = current.resolved?.movement?.shoreFishingPitchDegrees ?? 10;
        return new this.discord.ModalBuilder()
            .setCustomId(`mcbot:fishing-config-modal:${botId}|${areaId}`)
            .setTitle(`Điểm câu ${botId} - ${areaId}`.slice(0, 45))
            .addComponents(
                this.#inputRow('x', 'X', p.x),
                this.#inputRow('y', 'Y', p.y),
                this.#inputRow('z', 'Z', p.z),
                this.#inputRow('pitch', 'Góc cúi 0-89°', pitch)
            );
    }

    #inputRow(customId, label, value) {
        const input = new this.discord.TextInputBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(this.discord.TextInputStyle.Short)
            .setRequired(true);
        if (value !== null && value !== undefined && String(value).trim()) input.setValue(String(value));
        return new this.discord.ActionRowBuilder().addComponents(input);
    }

    async #upsertPanel(kind, channel, payload, marker, force) {
        const digest = JSON.stringify({
            embeds: payload.embeds?.map(embed => embed.toJSON?.() || embed),
            components: payload.components?.map(row => row.toJSON?.() || row)
        });
        if (!force && this.lastDigests[kind] === digest && this.messages[kind]) return;

        let message = this.messages[kind];
        if (!message) message = await this.#findPanelMessage(kind, channel, marker);
        if (message?.edit) {
            try {
                await message.edit(payload);
            } catch (error) {
                this.logger?.debug?.('Stored Discord panel message could not be edited; creating a new one.', {
                    kind,
                    error
                });
                message = null;
            }
        }
        if (!message) message = await channel.send(payload);

        this.messages[kind] = message;
        this.lastDigests[kind] = digest;
        await this.store.set(`${this.botId}:${kind}`, {
            guildId: this.guild.id,
            channelId: channel.id,
            messageId: message.id
        });
    }

    async #findPanelMessage(kind, channel, marker) {
        const stored = await this.store.get(`${this.botId}:${kind}`);
        if (stored?.channelId === channel.id && stored.messageId) {
            try {
                return await channel.messages.fetch(stored.messageId);
            } catch {}
        }

        try {
            const recent = await channel.messages.fetch({ limit: 50 });
            const values = typeof recent.values === 'function' ? [...recent.values()] : [];
            return values.find(message => (
                message.author?.id === this.client.user?.id
                && message.embeds?.some(embed => embed.footer?.text === marker)
            )) || null;
        } catch {
            return null;
        }
    }

    async #resolveGuild(guildId) {
        if (guildId && this.client.guilds?.fetch) return this.client.guilds.fetch(guildId);
        const cache = this.client.guilds?.cache;
        if (cache?.first) return cache.first() || null;
        if (cache?.values) return [...cache.values()][0] || null;
        return null;
    }

    async #resolveChannel(kind) {
        const defaults = kind === 'admin' ? { idEnv: 'DISCORD_ADMIN_CHANNEL_ID', name: 'bot-admin' } : {};
        const definition = { ...defaults, ...(this.panelConfig.channels?.[kind] || {}) };
        const envId = definition.idEnv ? String(this.environment[definition.idEnv] || '').trim() : '';
        if (envId && this.client.channels?.fetch) {
            const channel = await this.client.channels.fetch(envId);
            if (this.#isWritableTextChannel(channel)) return channel;
            throw new Error(`Discord ${kind} channel is not writable: ${envId}`);
        }

        const collection = await this.guild.channels.fetch();
        const values = typeof collection.values === 'function' ? [...collection.values()] : [];
        const name = definition.name || `bot-${kind}`;
        const existing = values.find(channel => channel?.name === name && this.#isWritableTextChannel(channel));
        if (existing) return existing;

        if (this.panelConfig.autoCreateChannels === false) {
            this.logger?.warn?.(`Discord channel not found: ${name}`);
            return null;
        }
        try {
            const created = await this.guild.channels.create({
                name,
                type: this.discord.ChannelType.GuildText,
                reason: 'MCbot automatic control/config/error channels'
            });
            return this.#isWritableTextChannel(created) ? created : null;
        } catch (error) {
            if (this.#isMissingPermissions(error)) {
                this.logger?.warn?.('Discord panel channel could not be auto-created because the bot lacks Manage Channels permission.', {
                    kind,
                    channelName: name,
                    code: error?.code || null
                });
                return null;
            }
            throw error;
        }
    }

    #isMissingPermissions(error) {
        return Number(error?.code) === 50013 || String(error?.message || '').toLowerCase().includes('missing permissions');
    }

    #isWritableTextChannel(channel) {
        return Boolean(channel && typeof channel.send === 'function' && (channel.isTextBased?.() ?? true));
    }

    #requireConnected(runtime) {
        if (!runtime.context.has()) throw new Error(`Bot chưa kết nối: ${runtime.botId || this.botId}`);
    }

    async #respondError(interaction, error) {
        const payload = { content: `Lỗi: ${error.message}`, ephemeral: true };
        try {
            if (interaction.deferred || interaction.replied) await interaction.followUp?.(payload);
            else await interaction.reply?.(payload);
        } catch {}
    }

    #itemText(item) {
        if (!item) return '`Trống`';
        const raw = item.displayName || item.name || 'item';
        const name = String(raw).replace(/§[0-9A-FK-OR]/gi, '').trim() || item.name || 'item';
        const count = Number(item.count || 1);
        return `\`${name}${count > 1 ? ` x${count}` : ''}\``;
    }

    #simpleB5ProgressText(status) {
        if (!status?.enabled) return '`Chưa chạy`';
        if (status.paused) return '`Tạm dừng`';
        if (status.lastError) return '`Đang thử lại sau lỗi`';
        const remaining = Number(status.remainingSteps);
        if (Number.isFinite(remaining)) return `Còn **${Math.max(0, Math.floor(remaining))} bước**`;
        return '`Đang tính...`';
    }

    #fishingAreasText(areas) {
        if (!Array.isArray(areas) || areas.length === 0) return '`Đang đọc /afk...`';
        return areas.map(area => {
            const occupancy = area?.known ? `${area.current}/${area.capacity}` : '?/?';
            const state = area?.full === true ? 'đầy' : area?.full === false ? 'còn chỗ' : 'chưa rõ';
            return `Slot ${area.menuSlot}: **${occupancy}** (${state})`;
        }).join('\n');
    }

    #positionText(position) {
        if (!position) return '-';
        return `${this.#number(position.x)}, ${this.#number(position.y)}, ${this.#number(position.z)}`;
    }

    #number(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '-';
        return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10);
    }

    #marker(kind) {
        return `mcbot-${kind}-panel:${this.botId}`;
    }

    #positive(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }
}

module.exports = DiscordPanelManager;
