'use strict';

class FishingModeCommand {
    constructor({ botRegistry, config, allowedUserIds, fleetControl = null, logger = null }) {
        this.botRegistry = botRegistry;
        this.config = config;
        this.allowedUserIds = new Set(allowedUserIds || []);
        this.fleetControl = fleetControl;
        this.logger = logger;
    }

    definition(stringOptionType) {
        return {
            name: this.config.fishingModeCommandName || 'fishmode',
            description: 'Bật/tắt mode câu cá tự động ở khu AFK.',
            options: [
                {
                    type: stringOptionType,
                    name: 'action',
                    description: 'Thao tác mode câu cá.',
                    required: true,
                    choices: [
                        { name: 'Bật', value: 'on' },
                        { name: 'Tắt', value: 'off' },
                        { name: 'Trạng thái', value: 'status' }
                    ]
                },
                {
                    type: stringOptionType,
                    name: 'bot',
                    description: 'Bot ID; bỏ trống dùng bot mặc định.',
                    required: false
                }
            ]
        };
    }

    async execute(interaction) {
        if (!interaction?.isChatInputCommand?.() || interaction.commandName !== (this.config.fishingModeCommandName || 'fishmode')) {
            return false;
        }
        if (!this.allowedUserIds.has(interaction.user?.id)) {
            await interaction.reply({ content: 'Bạn không có quyền dùng command này.', ephemeral: true });
            return true;
        }

        const action = interaction.options.getString('action', true);
        const botId = interaction.options.getString('bot', false) || this.config.defaultBotId;
        const runtime = this.botRegistry.require(botId);
        const mode = runtime.requireService('fishingMode');

        try {
            let result;
            if (action === 'on') {
                if (this.fleetControl) {
                    result = await this.fleetControl.requestMode(botId, 'fishing', {
                        state: 'ACTIVE',
                        source: 'discord-command'
                    });
                } else {
                    if (!runtime.context.has()) throw new Error(`Bot chưa kết nối: ${botId}`);
                    result = await mode.enable();
                }
            } else if (action === 'off') {
                const intent = this.fleetControl?.intent?.(botId);
                result = this.fleetControl && (intent?.desiredMode === 'fishing' || mode.status().enabled)
                    ? await this.fleetControl.requestMode(botId, null, { source: 'discord-command' })
                    : await mode.disable('Disabled from Discord /fishmode.');
            } else if (action === 'status') {
                result = { success: true, data: mode.status() };
            } else {
                throw new Error(`Fishing mode action không hợp lệ: ${action}`);
            }

            if (!result.success) throw result.error || new Error(result.message || 'Fishing mode operation failed.');
            await interaction.reply({
                content: this.#formatStatus(botId, mode.status()),
                ephemeral: this.config.ephemeral
            });
            this.logger?.info?.('Discord fishing mode command completed.', {
                userId: interaction.user.id,
                botId,
                action
            });
        } catch (error) {
            this.logger?.error?.('Discord fishing mode command failed.', {
                userId: interaction.user?.id,
                botId,
                action,
                error
            });
            await interaction.reply({ content: `Mode câu cá lỗi: ${error.message}`, ephemeral: true });
        }
        return true;
    }

    #formatStatus(botId, status) {
        const area = status.currentAreaId || 'chưa vào khu';
        const occupancy = Array.isArray(status.areas) && status.areas.length
            ? status.areas.map(entry => {
                const value = entry.known ? `${entry.current}/${entry.capacity}` : '?/?';
                return `${entry.id}: ${value}`;
            }).join(', ')
            : 'chưa đọc';
        return [
            `Bot: \`${botId}\``,
            `Mode câu cá: **${status.enabled ? 'ON' : 'OFF'}**`,
            `Phase: \`${status.phase}\``,
            `Khu hiện tại: \`${area}\``,
            `Số người: \`${occupancy}\``,
            `Lượt câu thành công: \`${status.catches || 0}\``,
            status.lastError ? `Lỗi gần nhất: \`${status.lastError}\`` : null
        ].filter(Boolean).join('\n');
    }
}

module.exports = FishingModeCommand;
