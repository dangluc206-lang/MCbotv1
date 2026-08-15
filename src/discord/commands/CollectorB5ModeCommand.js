'use strict';

class CollectorB5ModeCommand {
    constructor({ botRegistry, config, allowedUserIds, logger = null }) {
        this.botRegistry = botRegistry;
        this.config = config;
        this.allowedUserIds = new Set(allowedUserIds || []);
        this.logger = logger;
    }

    definition(stringOptionType) {
        return {
            name: this.config.modeCommandName || 'mode',
            description: 'Bật/tắt mode nhặt tại điểm cố định và tự chế B5.',
            options: [
                {
                    type: stringOptionType,
                    name: 'action',
                    description: 'Thao tác mode.',
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
        if (!interaction?.isChatInputCommand?.() || interaction.commandName !== (this.config.modeCommandName || 'mode')) {
            return false;
        }
        if (!this.allowedUserIds.has(interaction.user?.id)) {
            await interaction.reply({ content: 'Bạn không có quyền dùng command này.', ephemeral: true });
            return true;
        }

        const action = interaction.options.getString('action', true);
        const botId = interaction.options.getString('bot', false) || this.config.defaultBotId;
        const runtime = this.botRegistry.require(botId);
        const mode = runtime.requireService('collectorB5Mode');

        try {
            let result;
            if (action === 'on') {
                if (!runtime.context.has()) throw new Error(`Bot chưa kết nối: ${botId}`);
                const fishingMode = runtime.getService?.('fishingMode');
                if (fishingMode?.status?.().enabled) throw new Error('Tắt mode câu cá trước khi bật Nhặt+B5.');
                result = await mode.enable();
            } else if (action === 'off') {
                result = await mode.disable('Disabled from Discord /mode.');
            } else if (action === 'status') {
                result = { success: true, data: mode.status() };
            } else {
                throw new Error(`Mode action không hợp lệ: ${action}`);
            }

            if (!result.success) throw result.error || new Error(result.message || 'Mode operation failed.');
            await interaction.reply({
                content: this.#formatStatus(botId, result.data),
                ephemeral: this.config.ephemeral
            });
            this.logger?.info?.('Discord collector+B5 mode command completed.', {
                userId: interaction.user.id,
                botId,
                action
            });
        } catch (error) {
            this.logger?.error?.('Discord collector+B5 mode command failed.', {
                userId: interaction.user?.id,
                botId,
                action,
                error
            });
            await interaction.reply({ content: `Mode lỗi: ${error.message}`, ephemeral: true });
        }
        return true;
    }

    #formatStatus(botId, status) {
        const pickup = status.pickupLocation
            ? `${status.pickupLocation.x}, ${status.pickupLocation.y}, ${status.pickupLocation.z}`
            : 'chưa cấu hình';
        return [
            `Bot: \`${botId}\``,
            `Mode nhặt+B5: **${status.enabled ? 'ON' : 'OFF'}**`,
            `Phase: \`${status.phase}\``,
            `Điểm nhặt: \`${pickup}\``,
            `B5 đã hoàn thành trong phiên: \`${status.craftedB5Cycles || 0}\``,
            'Chế tạo: `liên tục, không cooldown`',
            status.lastError ? `Lỗi gần nhất: \`${status.lastError}\`` : null
        ].filter(Boolean).join('\n');
    }
}

module.exports = CollectorB5ModeCommand;
