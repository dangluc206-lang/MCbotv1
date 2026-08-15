'use strict';

class GuiInspectionCommand {
    constructor({ botRegistry, config, allowedUserIds, logger = null }) {
        this.botRegistry = botRegistry;
        this.config = config;
        this.allowedUserIds = new Set(allowedUserIds || []);
        this.logger = logger;
    }

    definition(stringOptionType) {
        return {
            name: this.config.commandName,
            description: 'Mở command Minecraft, click slot tùy chọn và xuất GUI cuối.',
            options: [
                {
                    type: stringOptionType,
                    name: 'command',
                    description: 'Command Minecraft cần kiểm tra.',
                    required: true,
                    choices: Object.entries(this.config.targets).map(([id, target]) => ({
                        name: target.display,
                        value: id
                    }))
                },
                {
                    type: stringOptionType,
                    name: 'slots',
                    description: 'Các slot click theo thứ tự, ví dụ: 22,13,31.',
                    required: false
                },
                {
                    type: stringOptionType,
                    name: 'bot',
                    description: 'Bot ID; bỏ trống để dùng bot mặc định.',
                    required: false
                }
            ]
        };
    }

    async execute(interaction) {
        if (!interaction?.isChatInputCommand?.() || interaction.commandName !== this.config.commandName) {
            return false;
        }

        if (!this.allowedUserIds.has(interaction.user?.id)) {
            await interaction.reply({
                content: 'Bạn không có quyền dùng command này.',
                ephemeral: true
            });
            return true;
        }

        await interaction.deferReply({ ephemeral: this.config.ephemeral });

        try {
            const targetId = interaction.options.getString('command', true);
            const target = this.config.targets[targetId];
            if (!target) throw new Error(`GUI target is not configured: ${targetId}`);

            const slotsText = interaction.options.getString('slots', false);
            const slots = this.#parseSlots(slotsText);
            const botId = interaction.options.getString('bot', false) || this.config.defaultBotId;
            const runtime = this.botRegistry.require(botId);
            if (!runtime.context.has()) throw new Error(`Bot chưa kết nối: ${botId}`);

            const snapshot = await runtime.requireService('guiInspectionService').capture({
                commandKey: target.commandKey,
                commandDisplay: target.display,
                slots,
                timeoutMs: this.config.guiTimeoutMs
            });

            const json = `${JSON.stringify(snapshot, null, 2)}\n`;
            const bytes = Buffer.byteLength(json);
            if (bytes > this.config.maxAttachmentBytes) {
                throw new Error(`GUI snapshot quá lớn (${bytes} bytes).`);
            }

            const safeTarget = targetId.replace(/[^a-z0-9_-]/gi, '_');
            const safeBot = botId.replace(/[^a-z0-9_-]/gi, '_');
            const fileName = `gui-${safeTarget}-${safeBot}-${Date.now()}.json`;
            const clickSummary = slots.length > 0 ? slots.join(' → ') : 'không';

            await interaction.editReply({
                content: [
                    `Bot: \`${botId}\``,
                    `Command: \`${target.display}\``,
                    `Clicks: \`${clickSummary}\``,
                    `GUI cuối: \`${String(snapshot.gui.title || '<không có title>')}\``,
                    `Slots: \`${snapshot.gui.slotCount}\` | Items: \`${snapshot.items.length}\``
                ].join('\n'),
                files: [{ attachment: Buffer.from(json, 'utf8'), name: fileName }]
            });

            this.logger?.info?.('Discord GUI inspection completed.', {
                userId: interaction.user.id,
                botId,
                targetId,
                slots,
                title: snapshot.gui.title,
                itemCount: snapshot.items.length
            });
        } catch (error) {
            this.logger?.error?.('Discord GUI inspection failed.', {
                userId: interaction.user?.id,
                error
            });
            await interaction.editReply({ content: `Không lấy được GUI: ${error.message}` });
        }

        return true;
    }

    #parseSlots(value) {
        if (value === null || value === undefined || String(value).trim() === '') return [];

        const parts = String(value)
            .split(',')
            .map(entry => entry.trim());

        if (parts.some(entry => !/^\d+$/.test(entry))) {
            throw new Error('slots phải là danh sách số nguyên cách nhau bằng dấu phẩy, ví dụ: 22,13,31.');
        }

        const slots = parts.map(Number);
        if (slots.length > 20) {
            throw new Error('Một lệnh /gui chỉ cho phép tối đa 20 lần click.');
        }
        if (slots.some(slot => !Number.isSafeInteger(slot) || slot < 0)) {
            throw new Error('Slot phải là số nguyên không âm.');
        }

        return slots;
    }
}

module.exports = GuiInspectionCommand;
