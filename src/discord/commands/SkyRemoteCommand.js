'use strict';

class SkyRemoteCommand {
    constructor({ botRegistry, config, allowedUserIds, logger = null }) {
        this.botRegistry = botRegistry;
        this.config = config;
        this.allowedUserIds = new Set(allowedUserIds || []);
        this.logger = logger;
    }

    definition(stringOptionType) {
        return {
            name: this.config.skyCommandName || 'skycmd',
            description: 'Gửi lệnh đã đăng ký cho Sky hiện tại.',
            options: [
                { type: stringOptionType, name: 'command', description: 'ID lệnh đã đăng ký, ví dụ d/autofarm/warp.', required: true },
                { type: stringOptionType, name: 'args', description: 'JSON tham số, ví dụ {"name":"mine"}.', required: false },
                { type: stringOptionType, name: 'bot', description: 'Bot ID; bỏ trống dùng bot mặc định.', required: false }
            ]
        };
    }

    async execute(interaction) {
        if (!interaction?.isChatInputCommand?.() || interaction.commandName !== (this.config.skyCommandName || 'skycmd')) return false;
        if (!this.allowedUserIds.has(interaction.user?.id)) {
            await interaction.reply({ content: 'Bạn không có quyền dùng command này.', ephemeral: true });
            return true;
        }
        const botId = interaction.options.getString('bot', false) || this.config.defaultBotId;
        const commandId = interaction.options.getString('command', true);
        const rawArgs = interaction.options.getString('args', false);
        try {
            const args = rawArgs ? JSON.parse(rawArgs) : {};
            if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('args phải là JSON object.');
            const service = this.botRegistry.require(botId).requireService('skyCommandService');
            const result = await service.send(commandId, { args });
            if (result?.success === false) throw result.error || new Error(result.message || 'Không gửi được lệnh Sky.');
            await interaction.reply({ content: `Bot \`${botId}\`: đã gửi \`${result.data?.command || commandId}\`.`, ephemeral: this.config.ephemeral });
            this.logger?.info?.('Discord scoped Sky command completed.', { userId: interaction.user.id, botId, commandId });
        } catch (error) {
            await interaction.reply({ content: `Lệnh Sky lỗi: ${error.message}`, ephemeral: true });
        }
        return true;
    }
}

module.exports = SkyRemoteCommand;
