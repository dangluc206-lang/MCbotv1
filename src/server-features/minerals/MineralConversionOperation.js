'use strict';

const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');

class MineralConversionOperation {
    constructor({ commandService, guiManager, itemResolver, guiKnowledge = null, config, conversionConfig, logger = null }) {
        this.commandService = commandService;
        this.guiManager = guiManager;
        this.itemResolver = itemResolver;
        this.guiKnowledge = guiKnowledge;
        this.logger = logger;
        this.config = this.#validateMenuConfig(config);
        this.conversionConfig = this.#validateConversionConfig(conversionConfig);
        this.unavailableConversions = new Set();
        this.conversionMenuUnavailable = false;
    }

    isAvailable(baseId, direction = 'toBlock') {
        if (this.conversionMenuUnavailable) return false;
        return !this.unavailableConversions.has(this.#capabilityKey(baseId, direction));
    }

    async execute(baseId, { direction = 'toBlock', cancellationToken = null } = {}) {
        let stage = 'validate';
        try {
        if (!['toBlock', 'toBase'].includes(direction)) throw new RangeError(`Unknown mineral conversion direction: ${direction}`);
        const resource = this.conversionConfig.resources[baseId];
        this.logger?.info?.('CONVERT START', {
            operation: 'MineralConversionOperation', step: 'validate', phase: 'START',
            action: direction, resource: baseId, direction, output: resource?.blockId || null
        });
        if (!resource) throw new Error(`Mineral conversion is not configured: ${baseId}`);
        if (!resource.blockId) return { baseId, direction, skipped: true, reason: 'no-block-form' };

        const capabilityKey = this.#capabilityKey(baseId, direction);
        if (this.conversionMenuUnavailable || this.unavailableConversions.has(capabilityKey)) {
            return { baseId, direction, skipped: true, reason: 'option-unavailable' };
        }

        cancellationToken?.throwIfCancelled?.();
        stage = 'open-minerals-root';
        this.logger?.info?.('CONVERT OPEN /ks', {
            operation: 'MineralConversionOperation', step: stage, phase: 'START',
            action: '/ks', resource: baseId, direction
        });
        const rootSource = { commandKey: this.config.commandKey, command: '/ks', clicks: [], actions: [], source: 'operation' };
        let session = null;
        let lastOpenError = null;
        for (let attempt = 1; attempt <= this.config.commandOpenAttempts; attempt += 1) {
            cancellationToken?.throwIfCancelled?.();
            if (this.guiManager.current()) {
                await this.guiManager.closeCurrentWindow();
                if (this.config.commandCloseSettleMs > 0) {
                    await Timeout.delay(this.config.commandCloseSettleMs, { cancellationToken });
                }
            }
            try {
                ({ session } = await this.guiManager.performAndWaitForOpen(
                    () => this.commandService.send(this.config.commandKey, { confirm: false }),
                    {
                        timeoutMs: this.config.guiTimeoutMs,
                        cancellationToken,
                        label: '/ks',
                        settleMs: this.conversionConfig.menuSettleMs,
                        source: rootSource
                    }
                ));
                break;
            } catch (error) {
                lastOpenError = error;
                if (attempt >= this.config.commandOpenAttempts) throw error;
                if (this.config.commandOpenRetryMs > 0) {
                    await Timeout.delay(this.config.commandOpenRetryMs, { cancellationToken });
                }
            }
        }
        if (!session) throw lastOpenError || new Error('/ks did not open a GUI.');

        this.logger?.info?.('CONVERT /ks READY', {
            operation: 'MineralConversionOperation', step: stage, phase: 'OK',
            action: '/ks', resource: baseId, direction, title: session?.window?.title || null
        });
        stage = 'resolve-conversion-entry';
        let entrySlot = this.guiKnowledge
            ? await this.guiKnowledge.resolveSlot(session, {
                source: rootSource,
                roleId: 'menu_convert_blocks',
                bootstrapSlot: this.config.conversionMenuSlot,
                logicalItemId: this.config.conversionMenuItemId,
                context: 'minerals-menu'
            })
            : this.#resolveMenuEntrySlot(session.window, this.config.conversionMenuSlot, this.config.conversionMenuItemId);
        this.logger?.info?.('CONVERT MENU RESOLVED', {
            operation: 'MineralConversionOperation', step: stage, phase: entrySlot >= 0 ? 'OK' : 'SKIP',
            action: 'resolve conversion menu', resource: baseId, direction, slot: entrySlot
        });
        if (entrySlot < 0) {
            this.conversionMenuUnavailable = true;
            return { baseId, direction, skipped: true, reason: 'conversion-menu-unavailable', menuItemId: this.config.conversionMenuItemId };
        }

        const conversionSource = {
            commandKey: this.config.commandKey,
            command: '/ks',
            clicks: [entrySlot],
            actions: ['menu_convert_blocks'],
            source: 'operation'
        };
        const menuItemId = direction === 'toBlock'
            ? (resource.toBlockMenuItemId || resource.blockId)
            : (resource.toBaseMenuItemId || resource.baseId);
        const roleId = `conversion:${baseId}:${direction}`;
        stage = 'enter-conversion-menu';
        let slot = -1;
        let lastTransitionError = null;
        for (let attempt = 1; attempt <= this.conversionConfig.menuTransitionAttempts; attempt += 1) {
            cancellationToken?.throwIfCancelled?.();
            this.logger?.info?.('CONVERT ENTER MENU', {
                operation: 'MineralConversionOperation', step: stage, phase: 'START',
                action: 'click conversion menu', resource: baseId, direction, slot: entrySlot,
                attempt, maxAttempts: this.conversionConfig.menuTransitionAttempts
            });

            try {
                // Some server GUI implementations replace the slots/title on the
                // same Mineflayer window instead of emitting a fresh windowOpen.
                // Accept either a new window or an in-place GUI update, then
                // verify the expected conversion option before continuing.
                session = await this.guiManager.clickAndWaitForTransition(entrySlot, {
                    timeoutMs: this.config.guiTimeoutMs,
                    cancellationToken,
                    label: 'mineral conversion menu click',
                    requireNewWindow: false,
                    settleMs: this.conversionConfig.menuSettleMs,
                    source: conversionSource
                });
                session = this.guiManager.syncCurrentWindow?.() || session;
                cancellationToken?.throwIfCancelled?.();

                slot = this.guiKnowledge
                    ? await this.guiKnowledge.resolveSlot(session, {
                        source: conversionSource,
                        roleId,
                        logicalItemId: menuItemId,
                        context: 'minerals-conversion'
                    })
                    : this.#findSlot(session.window, menuItemId, 'minerals-conversion');

                if (slot >= 0) {
                    lastTransitionError = null;
                    break;
                }

                if (this.#looksLikeConversionMenu(session?.window)) {
                    // The conversion GUI is genuinely open and this resource is
                    // not offered by the server. This is a capability miss, not
                    // a click race, so do not keep clicking unrelated slots.
                    break;
                }

                lastTransitionError = new Error('Mineral conversion menu transition completed without exposing conversion options.');
            } catch (error) {
                // A few server/menu implementations mutate currentWindow
                // without producing the transition event Mineflayer normally
                // emits. Before treating the click as failed, reconcile with
                // currentWindow and inspect the actual slots.
                const recovered = this.guiManager.syncCurrentWindow?.() || null;
                const recoveredSlot = recovered
                    ? this.#findSlot(recovered.window, menuItemId, 'minerals-conversion')
                    : -1;
                if (recoveredSlot >= 0) {
                    session = recovered;
                    session.setSource?.(conversionSource);
                    slot = recoveredSlot;
                    lastTransitionError = null;
                    break;
                }
                lastTransitionError = error;
            }

            if (attempt >= this.conversionConfig.menuTransitionAttempts) break;

            // Never retry slot 10 against an unknown/stale child GUI. Reopen the
            // /ks root so the next click is anchored to the known menu entry.
            if (this.guiManager.current()) {
                await this.guiManager.closeCurrentWindow();
                if (this.config.commandCloseSettleMs > 0) {
                    await Timeout.delay(this.config.commandCloseSettleMs, { cancellationToken });
                }
            }
            ({ session } = await this.guiManager.performAndWaitForOpen(
                () => this.commandService.send(this.config.commandKey, { confirm: false }),
                {
                    timeoutMs: this.config.guiTimeoutMs,
                    cancellationToken,
                    label: '/ks conversion retry',
                    settleMs: this.conversionConfig.menuSettleMs,
                    source: rootSource
                }
            ));
            entrySlot = this.guiKnowledge
                ? await this.guiKnowledge.resolveSlot(session, {
                    source: rootSource,
                    roleId: 'menu_convert_blocks',
                    bootstrapSlot: this.config.conversionMenuSlot,
                    logicalItemId: this.config.conversionMenuItemId,
                    context: 'minerals-menu'
                })
                : this.#resolveMenuEntrySlot(session.window, this.config.conversionMenuSlot, this.config.conversionMenuItemId);
            if (entrySlot < 0) {
                throw new Error('Mineral conversion menu entry disappeared while retrying /ks.');
            }
            if (this.conversionConfig.menuTransitionRetryMs > 0) {
                await Timeout.delay(this.conversionConfig.menuTransitionRetryMs, { cancellationToken });
            }
        }

        if (slot < 0 && lastTransitionError) throw lastTransitionError;

        this.logger?.info?.('CONVERT MENU READY', {
            operation: 'MineralConversionOperation', step: stage, phase: 'OK',
            action: 'conversion menu ready', resource: baseId, direction, title: session?.window?.title || null
        });
        stage = 'resolve-conversion-option';
        this.logger?.info?.('CONVERT OPTION RESOLVED', {
            operation: 'MineralConversionOperation', step: stage, phase: slot >= 0 ? 'OK' : 'SKIP',
            action: direction, resource: baseId, direction, slot, itemName: menuItemId
        });
        if (slot < 0) {
            this.unavailableConversions.add(capabilityKey);
            return { baseId, blockId: resource.blockId, direction, menuItemId, skipped: true, reason: 'option-unavailable' };
        }

        stage = 'click-conversion-option';
        this.logger?.info?.('CONVERT CLICK', {
            operation: 'MineralConversionOperation', step: stage, phase: 'START',
            action: direction, resource: baseId, direction, slot, itemName: menuItemId
        });
        await this.guiManager.click(slot);
        await Timeout.delay(this.conversionConfig.resultDelayMs, { cancellationToken });
        this.logger?.info?.('CONVERT ACTION OK', {
            operation: 'MineralConversionOperation', step: stage, phase: 'OK',
            action: direction, resource: baseId, direction, slot, output: resource.blockId
        });
        return { baseId, blockId: resource.blockId, direction, menuItemId, slot, skipped: false };
        } catch (error) {
            if (error instanceof FlowError) throw error;
            throw FlowError.wrap(error, {
                code: 'MINERAL_CONVERSION_STEP_FAILED', subsystem: 'minerals', operation: 'MineralConversionOperation',
                step: stage, action: direction, resource: baseId,
                details: { baseId, direction, gui: this.guiManager.describeCurrent?.() || null }
            });
        }
    }

    #resolveMenuEntrySlot(window, configuredSlot, logicalItemId) {
        const slots = window?.slots || [];
        if (Number.isInteger(configuredSlot) && configuredSlot >= 0 && slots[configuredSlot]) return configuredSlot;
        return this.#findSlot(window, logicalItemId, 'minerals-menu');
    }

    #findSlot(window, logicalItemId, context) {
        return (window?.slots || []).findIndex(item => item && this.itemResolver.matches(item, logicalItemId, context).matched);
    }

    #looksLikeConversionMenu(window) {
        if (!window) return false;
        for (const resource of Object.values(this.conversionConfig.resources)) {
            const ids = [
                resource.toBlockMenuItemId || resource.blockId,
                resource.toBaseMenuItemId || resource.baseId
            ].filter(Boolean);
            for (const logicalItemId of ids) {
                if (this.#findSlot(window, logicalItemId, 'minerals-conversion') >= 0) return true;
            }
        }
        return false;
    }

    #capabilityKey(baseId, direction) { return `${baseId}:${direction}`; }

    #validateMenuConfig(config) {
        if (!config || typeof config !== 'object') throw new TypeError('minerals config is required');
        for (const key of ['commandKey', 'conversionMenuItemId']) {
            if (typeof config[key] !== 'string' || !config[key]) throw new Error(`minerals.${key} is required`);
        }
        if (!Number.isFinite(config.guiTimeoutMs) || config.guiTimeoutMs <= 0) throw new Error('minerals.guiTimeoutMs must be positive');
        const conversionMenuSlot = config.conversionMenuSlot === undefined ? null : Number(config.conversionMenuSlot);
        if (conversionMenuSlot !== null && (!Number.isInteger(conversionMenuSlot) || conversionMenuSlot < 0)) {
            throw new Error('minerals.conversionMenuSlot must be a non-negative integer when configured');
        }
        return {
            ...config,
            conversionMenuSlot,
            commandOpenAttempts: Number.isInteger(config.commandOpenAttempts) && config.commandOpenAttempts > 0 ? config.commandOpenAttempts : 3,
            commandOpenRetryMs: Number.isFinite(config.commandOpenRetryMs) && config.commandOpenRetryMs >= 0 ? config.commandOpenRetryMs : 600,
            commandCloseSettleMs: Number.isFinite(config.commandCloseSettleMs) && config.commandCloseSettleMs >= 0 ? config.commandCloseSettleMs : 350
        };
    }

    #validateConversionConfig(config) {
        if (!config || typeof config !== 'object') throw new TypeError('mineralConversions config is required');
        if (!config.resources || typeof config.resources !== 'object') throw new Error('mineralConversions.resources is required');
        for (const [baseId, resource] of Object.entries(config.resources)) {
            if (!resource || typeof resource !== 'object') throw new Error(`Invalid mineral conversion: ${baseId}`);
            if (resource.baseId !== baseId) throw new Error(`mineralConversions.${baseId}.baseId must equal ${baseId}`);
            if (!Number.isSafeInteger(Number(resource.ratio)) || Number(resource.ratio) < 1) throw new Error(`mineralConversions.${baseId}.ratio must be a positive integer`);
        }
        const positive = (key, fallback) => {
            const value = config[key] === undefined ? fallback : Number(config[key]);
            if (!Number.isFinite(value) || value < 0) throw new Error(`mineralConversions.${key} must be non-negative`);
            return value;
        };
        const attempts = config.menuTransitionAttempts === undefined ? 3 : Number(config.menuTransitionAttempts);
        if (!Number.isInteger(attempts) || attempts <= 0) throw new Error('mineralConversions.menuTransitionAttempts must be a positive integer');
        return Object.freeze({
            ...config,
            menuSettleMs: positive('menuSettleMs', 200),
            resultDelayMs: positive('resultDelayMs', 300),
            menuTransitionAttempts: attempts,
            menuTransitionRetryMs: positive('menuTransitionRetryMs', 350)
        });
    }
}

module.exports = MineralConversionOperation;
