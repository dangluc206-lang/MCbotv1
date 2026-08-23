'use strict';

class RemoteModeCommand {
    constructor({ botRegistry, modeCatalog, config, allowedUserIds, fleetControl = null, logger = null }) {
        if (!modeCatalog?.list) throw new TypeError('RemoteModeCommand requires ModeCatalog.');
        this.botRegistry = botRegistry;
        this.modeCatalog = modeCatalog;
        this.config = config;
        this.allowedUserIds = new Set(allowedUserIds || []);
        this.fleetControl = fleetControl;
        this.logger = logger;
    }

    definition(stringOptionType) {
        const choices = this.modeCatalog.list().slice(0, 25).map(mode => ({ name: String(mode.label || mode.id).slice(0, 100), value: mode.id }));
        return {
            name: this.config.modeCommandName || 'mode',
            description: 'Điều khiển mode của MCbot từ xa.',
            options: [
                { type: stringOptionType, name: 'action', description: 'Thao tác mode.', required: true, choices: [
                    { name: 'Chạy', value: 'start' }, { name: 'Tạm dừng', value: 'pause' }, { name: 'Chạy tiếp', value: 'resume' },
                    { name: 'Restart', value: 'restart' }, { name: 'Dừng', value: 'stop' }, { name: 'Trạng thái', value: 'status' }
                ] },
                { type: stringOptionType, name: 'mode', description: 'Mode cần điều khiển.', required: false, choices },
                { type: stringOptionType, name: 'bot', description: 'Bot ID; bỏ trống dùng bot mặc định.', required: false }
            ]
        };
    }

    async execute(interaction) {
        if (!interaction?.isChatInputCommand?.() || interaction.commandName !== (this.config.modeCommandName || 'mode')) return false;
        if (!this.allowedUserIds.has(interaction.user?.id)) {
            await interaction.reply({ content: 'Bạn không có quyền dùng command này.', ephemeral: true });
            return true;
        }
        const action = interaction.options.getString('action', true);
        const botId = interaction.options.getString('bot', false) || this.config.defaultBotId;
        const runtime = this.botRegistry.require(botId);
        const registry = runtime.requireService('modeRegistry');
        const requested = interaction.options.getString('mode', false);
        const active = registry.active?.()?.[0] || null;
        const modeId = requested || active?.definition?.id || null;
        try {
            let result = null;
            if (action === 'status') {
                const snapshot = modeId ? registry.status(modeId) : registry.status();
                await interaction.reply({ content: this.#statusText(botId, snapshot, active), ephemeral: this.config.ephemeral });
                return true;
            }
            if (action === 'stop' && !modeId) {
                result = this.fleetControl ? await this.fleetControl.requestMode(botId, null, { source: 'discord-remote-command' }) : await runtime.requireService('modeControl').stopAll('Stopped from Discord remote command.');
            } else {
                if (!modeId || !registry.has(modeId)) throw new Error(`Mode không tồn tại: ${modeId || '(trống)'}`);
                if (action === 'start') result = this.fleetControl ? await this.fleetControl.requestMode(botId, modeId, { state: 'ACTIVE', source: 'discord-remote-command' }) : await runtime.requireService('modeControl').start(modeId);
                else if (action === 'pause') result = this.fleetControl ? await this.fleetControl.requestMode(botId, modeId, { state: 'PAUSED', source: 'discord-remote-command' }) : await runtime.requireService('modeControl').pause(modeId, 'Paused from Discord remote command.');
                else if (action === 'resume') result = this.fleetControl ? await this.fleetControl.requestMode(botId, modeId, { state: 'ACTIVE', source: 'discord-remote-command' }) : await runtime.requireService('modeControl').resume(modeId);
                else if (action === 'restart') result = this.fleetControl ? await this.fleetControl.restartMode(botId, modeId, { source: 'discord-remote-command' }) : await runtime.requireService('modeControl').restart(modeId);
                else if (action === 'stop') result = this.fleetControl ? await this.fleetControl.requestMode(botId, null, { source: 'discord-remote-command' }) : await runtime.requireService('modeControl').stop(modeId, 'Stopped from Discord remote command.');
                else throw new Error(`Action không hỗ trợ: ${action}`);
            }
            if (result?.success === false) throw result.error || new Error(result.message || 'Mode operation failed.');
            const now = registry.active?.()?.[0] || null;
            await interaction.reply({ content: `Bot \`${botId}\`: ${action} ${modeId ? `\`${modeId}\`` : ''} OK.\nHiện tại: ${now ? `\`${now.definition.id} / ${now.status?.paused ? 'PAUSED' : (now.status?.phase || 'ACTIVE')}\`` : '`IDLE`'}`, ephemeral: this.config.ephemeral });
            this.logger?.info?.('Discord remote mode command completed.', { userId: interaction.user.id, botId, action, modeId });
        } catch (error) {
            this.logger?.error?.('Discord remote mode command failed.', { userId: interaction.user?.id, botId, action, modeId, error });
            await interaction.reply({ content: `Mode lỗi: ${error.message}`, ephemeral: true });
        }
        return true;
    }

    #statusText(botId, snapshot, active) {
        if (snapshot?.definition) {
            const status = snapshot.status || {};
            return `Bot \`${botId}\` • \`${snapshot.definition.id}\` • enabled=${Boolean(status.enabled)} • paused=${Boolean(status.paused)} • phase=\`${status.phase || '-'}\``;
        }
        const modes = snapshot?.modes || [];
        return [`Bot \`${botId}\``, `Active: ${active ? `\`${active.definition.id}\`` : '`IDLE`'}`, ...modes.map(entry => `• \`${entry.definition.id}\`: ${entry.status?.enabled ? (entry.status?.paused ? 'PAUSED' : 'ACTIVE') : 'OFF'}`)].join('\n').slice(0, 1900);
    }
}

module.exports = RemoteModeCommand;
