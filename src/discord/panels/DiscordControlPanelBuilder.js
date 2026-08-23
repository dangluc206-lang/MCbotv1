'use strict';

class DiscordControlPanelBuilder {
    constructor({ discord, formatter, botRegistry, defaultBotId }) {
        if (!discord) throw new TypeError('DiscordControlPanelBuilder discord is required.');
        if (!formatter) throw new TypeError('DiscordControlPanelBuilder formatter is required.');
        if (!botRegistry) throw new TypeError('DiscordControlPanelBuilder botRegistry is required.');
        this.discord = discord;
        this.formatter = formatter;
        this.botRegistry = botRegistry;
        this.defaultBotId = defaultBotId;
    }

    build({ selectedBotId, selectedModeId = 'b5-craft', selectedPage = 0 } = {}) {
        const botIds = this.#botIds();
        if (!botIds.length) throw new Error('Không có bot runtime nào được đăng ký.');
        let botId = botIds.includes(selectedBotId) ? selectedBotId : (botIds.includes(this.defaultBotId) ? this.defaultBotId : botIds[0]);
        const runtime = this.botRegistry.require(botId);
        const bot = runtime.context.get?.() || null;
        const online = Boolean(bot);
        const registry = runtime.getService?.('modeRegistry');
        const modes = registry?.status?.().modes || [];
        if (!modes.some(entry => entry.definition.id === selectedModeId)) selectedModeId = modes.find(entry => entry.definition.metadata?.recommended)?.definition.id || modes[0]?.definition.id || selectedModeId;
        const active = registry?.active?.()?.[0] || null;
        const activeModeId = active?.definition?.id || null;
        const activeStatus = active?.status || null;
        const sky = runtime.getService?.('skyblockAutoJoin')?.status?.() || { location: online ? 'UNKNOWN' : 'OFFLINE', ready: false, activeTarget: null, readyTarget: null, manualHubHold: false };
        const activeSkyTarget = sky.ready === true ? sky.readyTarget : sky.activeTarget;
        const customCommands = runtime.getService?.('skyCommandService')?.list?.(activeSkyTarget, { enabledOnly: true }) || [];
        const simpleCommands = customCommands.filter(entry => !/\{[^}]+\}/.test(entry.command)).slice(0, 25);
        const position = bot?.entity?.position || activeStatus?.position || null;
        const mainHand = bot?.heldItem || null;
        const offHand = bot?.inventory?.slots?.[45] || null;
        const hp = online && Number.isFinite(bot.health) ? `${this.formatter.number(bot.health)}/20` : '-';
        const food = online && Number.isFinite(bot.food) ? `${this.formatter.number(bot.food)}/20` : '-';
        const selectedDefinition = modes.find(entry => entry.definition.id === selectedModeId)?.definition || null;
        const modeText = active ? `${active.definition.label} — ${activeStatus?.paused ? 'PAUSED' : (activeStatus?.phase || 'ACTIVE')}` : 'Không';
        const skyText = !online ? 'OFFLINE' : `${sky.location || 'UNKNOWN'}${activeSkyTarget ? ` · ${activeSkyTarget}` : ''}${sky.manualHubHold ? ' · HOLD' : ''}${sky.ready ? ' · READY' : ''}`;

        const embed = new this.discord.EmbedBuilder()
            .setTitle(`MCbot Remote - ${runtime.identity?.displayName || botId} [${botId}]`.slice(0, 256))
            .addFields(
                { name: 'Minecraft', value: `\`${runtime.identity?.username || '-'}\``, inline: true },
                { name: 'Kết nối', value: online ? '`ONLINE`' : '`OFFLINE`', inline: true },
                { name: 'HUB / SKY', value: `\`${skyText}\``, inline: true },
                { name: 'Máu / Đói', value: `\`${hp} / ${food}\``, inline: true },
                { name: 'Tay trái / phải', value: `${this.formatter.itemText(offHand)} / ${this.formatter.itemText(mainHand)}`, inline: true },
                { name: 'Vị trí', value: `\`${this.formatter.positionText(position)}\``, inline: true },
                { name: 'Mode hiện tại', value: `\`${modeText}\`` },
                { name: 'Mode sẽ chạy', value: selectedDefinition ? `\`${selectedDefinition.label} (${selectedDefinition.id})\`` : '`Không có`', inline: true },
                { name: 'Tác vụ', value: this.formatter.operationStatusText(runtime.getService?.('operationManager')?.snapshot?.()), inline: true }
            )
            .setFooter({ text: this.formatter.marker('control') });

        const pageMax = Math.max(0, Math.ceil(botIds.length / 25) - 1);
        const page = Math.max(0, Math.min(pageMax, Number(selectedPage) || 0));
        const pageIds = botIds.slice(page * 25, page * 25 + 25);
        const rows = [];
        rows.push(new this.discord.ActionRowBuilder().addComponents(
            new this.discord.StringSelectMenuBuilder()
                .setCustomId('mcbot:control:bot')
                .setPlaceholder(`Chọn bot • ${page + 1}/${pageMax + 1}`)
                .addOptions(...pageIds.map(id => {
                    const candidate = this.botRegistry.get?.(id);
                    return { label: String(candidate?.identity?.displayName || id).slice(0, 100), description: `${id} | ${candidate?.identity?.username || '-'}`.slice(0, 100), value: id, default: id === botId };
                }))
        ));
        if (modes.length) rows.push(new this.discord.ActionRowBuilder().addComponents(
            new this.discord.StringSelectMenuBuilder()
                .setCustomId('mcbot:control:mode')
                .setPlaceholder('Chọn mode để chạy')
                .addOptions(...modes.slice(0, 25).map(entry => ({
                    label: String(entry.definition.label || entry.definition.id).slice(0, 100),
                    description: String(entry.definition.description || entry.definition.id).slice(0, 100),
                    value: entry.definition.id,
                    default: entry.definition.id === selectedModeId
                })))
        ));
        const cid = action => `mcbot:control:${botId}|${action}`;
        rows.push(new this.discord.ActionRowBuilder().addComponents(
            new this.discord.ButtonBuilder().setCustomId(cid('join')).setLabel('Kết nối').setStyle(this.discord.ButtonStyle.Success).setDisabled(online),
            new this.discord.ButtonBuilder().setCustomId(cid('disconnect')).setLabel('Ngắt bot').setStyle(this.discord.ButtonStyle.Danger).setDisabled(!online),
            new this.discord.ButtonBuilder().setCustomId(cid('sky')).setLabel('Vào Sky').setStyle(this.discord.ButtonStyle.Primary).setDisabled(!online || (sky.location === 'SKY' && sky.ready)),
            new this.discord.ButtonBuilder().setCustomId(cid('hub')).setLabel('Về HUB').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(!online || sky.location === 'HUB'),
            new this.discord.ButtonBuilder().setCustomId(cid('home')).setLabel('/is').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(!online || !sky.ready)
        ));
        rows.push(new this.discord.ActionRowBuilder().addComponents(
            new this.discord.ButtonBuilder().setCustomId(cid('start-selected-mode')).setLabel('Chạy mode').setStyle(this.discord.ButtonStyle.Success).setDisabled(!selectedDefinition),
            new this.discord.ButtonBuilder().setCustomId(cid('pause')).setLabel('Tạm dừng').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(!activeModeId || activeStatus?.paused),
            new this.discord.ButtonBuilder().setCustomId(cid('resume')).setLabel('Chạy tiếp').setStyle(this.discord.ButtonStyle.Success).setDisabled(!activeModeId || !activeStatus?.paused),
            new this.discord.ButtonBuilder().setCustomId(cid('restart-mode')).setLabel('Restart mode').setStyle(this.discord.ButtonStyle.Primary).setDisabled(!activeModeId),
            new this.discord.ButtonBuilder().setCustomId(cid('stop-mode')).setLabel('Dừng mode').setStyle(this.discord.ButtonStyle.Danger).setDisabled(!activeModeId)
        ));
        if (pageMax > 0) {
            rows.push(new this.discord.ActionRowBuilder().addComponents(
                new this.discord.ButtonBuilder().setCustomId('mcbot:control-page:prev').setLabel('◀ Bot trước').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(page <= 0),
                new this.discord.ButtonBuilder().setCustomId('mcbot:control-page:next').setLabel('Bot sau ▶').setStyle(this.discord.ButtonStyle.Secondary).setDisabled(page >= pageMax)
            ));
        } else if (simpleCommands.length) {
            rows.push(new this.discord.ActionRowBuilder().addComponents(
                new this.discord.StringSelectMenuBuilder().setCustomId('mcbot:control:sky-command').setPlaceholder(`Lệnh ${activeSkyTarget || 'Sky'}`).addOptions(...simpleCommands.map(entry => ({ label: String(entry.label || entry.id).slice(0,100), description: String(entry.command).slice(0,100), value: entry.id })))
            ));
        }
        return { payload: { embeds: [embed], components: rows.slice(0, 5) }, selectedBotId: botId, selectedModeId, selectedPage: page };
    }

    #botIds() {
        if (typeof this.botRegistry.ids === 'function') return this.botRegistry.ids();
        if (typeof this.botRegistry.list === 'function') return this.botRegistry.list().map(runtime => runtime.botId).filter(Boolean);
        return [];
    }
}

module.exports = DiscordControlPanelBuilder;
