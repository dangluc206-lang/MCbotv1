'use strict';

const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');

/**
 * MinerUA smelting is per-material, but each click processes ALL stock of that
 * material directly in /kho. There is no quantity-selection GUI.
 *
 * Direct flow:   /nung -> smelting GUI -> click RAW_IRON / RAW_GOLD / ...
 * Minerals flow: /ks   -> smelting entry -> smelting GUI -> click material
 */
class SmeltingOperation {
    constructor({ commandService, guiManager, itemResolver, guiKnowledge = null, config, logger = null }) {
        this.commandService = commandService;
        this.guiManager = guiManager;
        this.itemResolver = itemResolver;
        this.guiKnowledge = guiKnowledge;
        this.logger = logger;
        this.config = this.#validateConfig(config);
        this.unavailableRecipes = new Set();
    }

    isAvailable(recipeId) { return !this.unavailableRecipes.has(recipeId); }

    async execute(recipeId, { entry = 'direct', cancellationToken = null } = {}) {
        let stage = 'validate';
        try {
        if (!['direct', 'minerals'].includes(entry)) throw new RangeError(`Unknown smelting entry: ${entry}`);
        const recipe = this.config.recipes[recipeId];
        this.logger?.info?.('SMELT START', {
            operation: 'SmeltingOperation', step: 'validate', phase: 'START',
            action: 'smelt all stored input', resource: recipe?.input || recipeId,
            recipeId, entry, input: recipe?.input || null, output: recipe?.output || null
        });
        if (!recipe) throw new Error(`Smelting recipe not found: ${recipeId}`);
        if (this.unavailableRecipes.has(recipeId)) {
            return { recipeId, entry, skipped: true, reason: 'smelting-material-unavailable' };
        }

        cancellationToken?.throwIfCancelled?.();
        stage = 'open-smelting-gui';
        this.logger?.info?.('SMELT OPEN GUI', {
            operation: 'SmeltingOperation', step: stage, phase: 'START',
            action: entry === 'direct' ? '/nung' : '/ks', resource: recipe.input, recipeId
        });
        const commandKey = entry === 'minerals' ? this.config.mineralsCommandKey : this.config.commandKey;
        const command = entry === 'minerals' ? '/ks' : '/nung';
        const rootSource = { commandKey, command, clicks: [], actions: [], source: 'operation' };
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
                    () => this.commandService.send(commandKey, { confirm: false }),
                    {
                        timeoutMs: this.config.guiTimeoutMs,
                        cancellationToken,
                        label: command,
                        settleMs: this.config.openSettleMs,
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
        if (!session) throw lastOpenError || new Error(`${command} did not open a GUI.`);

        this.logger?.info?.('SMELT GUI READY', {
            operation: 'SmeltingOperation', step: stage, phase: 'OK',
            action: command, resource: recipe.input, recipeId, title: session?.window?.title || null
        });
        let smeltingSource = rootSource;
        if (entry === 'minerals') {
            stage = 'enter-smelting-menu';
            const menuSlot = this.guiKnowledge
                ? await this.guiKnowledge.resolveSlot(session, {
                    source: rootSource,
                    roleId: 'menu_smelting',
                    bootstrapSlot: this.config.mineralsMenuSlot,
                    logicalItemId: this.config.mineralsMenuItemId,
                    context: 'minerals-menu'
                })
                : this.#fallbackMenuSlot(session.window);
            if (menuSlot < 0) {
                return { recipeId, entry, skipped: true, reason: 'smelting-menu-unavailable' };
            }
            smeltingSource = {
                commandKey,
                command,
                clicks: [menuSlot],
                actions: ['menu_smelting'],
                source: 'operation'
            };
            session = await this.guiManager.clickAndWaitForTransition(menuSlot, {
                timeoutMs: this.config.guiTimeoutMs,
                cancellationToken,
                label: 'smelting menu click',
                requireNewWindow: true,
                settleMs: this.config.openSettleMs,
                source: smeltingSource
            });
        }

        // The GUI contains one clickable item per raw material. Clicking that
        // item processes ALL of that material currently stored in /kho.
        // Prefer the actual input identity (raw_iron/raw_gold/...) because the
        // GUI knowledge layer can follow it if the server moves the slot.
        stage = 'resolve-material';
        this.logger?.info?.('SMELT FIND MATERIAL', {
            operation: 'SmeltingOperation', step: stage, phase: 'START',
            action: 'resolve smelting material', resource: recipe.input, recipeId
        });
        const roleId = `smelting:${recipeId}`;
        const bootstrapSlot = this.#normalizeRecipeSlot(recipe.menuSlot);
        let materialSlot = this.guiKnowledge
            ? await this.guiKnowledge.resolveSlot(session, {
                source: smeltingSource,
                roleId,
                bootstrapSlot,
                logicalItemId: recipe.input,
                context: 'smelting-menu'
            })
            : this.#findSlot(session.window, recipe.input, 'smelting-menu');

        // Compatibility fallback for old config/data where the GUI entry was
        // learned as smelt_iron/smelt_gold by its display name rather than the
        // raw material identity. If found, relearn the slot as recipe.input so
        // future runs no longer depend on that display name.
        if (materialSlot < 0 && recipe.menuItemId) {
            materialSlot = this.#findSlot(session.window, recipe.menuItemId, 'smelting-menu');
            if (materialSlot >= 0 && this.guiKnowledge?.learnSlot) {
                await this.guiKnowledge.learnSlot(session, {
                    source: smeltingSource,
                    roleId,
                    slot: materialSlot,
                    logicalItemId: recipe.input,
                    context: 'smelting-menu',
                    bootstrapSlot
                });
            }
        }

        this.logger?.info?.('SMELT MATERIAL RESOLVED', {
            operation: 'SmeltingOperation', step: stage, phase: materialSlot >= 0 ? 'OK' : 'SKIP',
            action: 'resolve smelting material', resource: recipe.input, recipeId, slot: materialSlot
        });
        if (materialSlot < 0) {
            this.unavailableRecipes.add(recipeId);
            return {
                recipeId,
                entry,
                skipped: true,
                reason: 'smelting-material-unavailable',
                input: recipe.input
            };
        }

        stage = 'click-material';
        this.logger?.info?.('SMELT CLICK MATERIAL', {
            operation: 'SmeltingOperation', step: stage, phase: 'START',
            action: 'click material', resource: recipe.input, recipeId, slot: materialSlot
        });
        await this.guiManager.click(materialSlot);
        await Timeout.delay(this.config.resultDelayMs, { cancellationToken });

        // No quantity GUI exists. The single click above tells the server to
        // smelt ALL stock of this one material in /kho. B1StorageMaterialService
        // verifies the input decreased/output increased using a fresh /kho.
        this.logger?.info?.('SMELT ACTION OK', {
            operation: 'SmeltingOperation', step: stage, phase: 'OK',
            action: 'server smelt all stored input', resource: recipe.input,
            recipeId, slot: materialSlot, input: recipe.input, output: recipe.output
        });
        return {
            recipeId,
            slot: materialSlot,
            entry,
            skipped: false,
            allForInput: true,
            input: recipe.input,
            output: recipe.output
        };
        } catch (error) {
            if (error instanceof FlowError) throw error;
            const recipe = this.config.recipes?.[recipeId];
            throw FlowError.wrap(error, {
                code: 'SMELTING_STEP_FAILED', subsystem: 'smelting', operation: 'SmeltingOperation',
                step: stage, action: stage === 'open-smelting-gui' ? (entry === 'direct' ? '/nung' : '/ks') : stage,
                resource: recipe?.input || recipeId,
                details: { recipeId, entry, input: recipe?.input || null, output: recipe?.output || null, gui: this.guiManager.describeCurrent?.() || null }
            });
        }
    }

    #fallbackMenuSlot(window) {
        const slots = window?.slots || [];
        if (Number.isInteger(this.config.mineralsMenuSlot) && this.config.mineralsMenuSlot >= 0 && slots[this.config.mineralsMenuSlot]) {
            return this.config.mineralsMenuSlot;
        }
        return this.#findSlot(window, this.config.mineralsMenuItemId, 'minerals-menu');
    }

    #findSlot(window, logicalItemId, context) {
        if (!logicalItemId) return -1;
        return (window?.slots || []).findIndex(item => item && this.itemResolver.matches(item, logicalItemId, context).matched);
    }

    #normalizeRecipeSlot(value) {
        if (value === null || value === undefined || value === '') return null;
        const slot = Number(value);
        return Number.isInteger(slot) && slot >= 0 ? slot : null;
    }

    #validateConfig(config) {
        if (!config || typeof config !== 'object') throw new TypeError('smelting config is required');
        for (const key of ['commandKey', 'mineralsCommandKey', 'mineralsMenuItemId']) {
            if (typeof config[key] !== 'string' || !config[key]) throw new Error(`smelting.${key} is required`);
        }
        if (!Number.isFinite(config.guiTimeoutMs) || config.guiTimeoutMs <= 0) throw new Error('smelting.guiTimeoutMs must be positive');
        if (!Number.isFinite(config.resultDelayMs) || config.resultDelayMs < 0) throw new Error('smelting.resultDelayMs must be non-negative');
        if (!config.recipes || typeof config.recipes !== 'object') throw new Error('smelting.recipes is required');
        const mineralsMenuSlot = config.mineralsMenuSlot === undefined ? null : Number(config.mineralsMenuSlot);
        if (mineralsMenuSlot !== null && (!Number.isInteger(mineralsMenuSlot) || mineralsMenuSlot < 0)) throw new Error('smelting.mineralsMenuSlot must be a non-negative integer when configured');
        return {
            ...config,
            mineralsMenuSlot,
            openSettleMs: Number.isFinite(config.openSettleMs) && config.openSettleMs >= 0 ? config.openSettleMs : 150,
            commandOpenAttempts: Number.isInteger(config.commandOpenAttempts) && config.commandOpenAttempts > 0 ? config.commandOpenAttempts : 3,
            commandOpenRetryMs: Number.isFinite(config.commandOpenRetryMs) && config.commandOpenRetryMs >= 0 ? config.commandOpenRetryMs : 600,
            commandCloseSettleMs: Number.isFinite(config.commandCloseSettleMs) && config.commandCloseSettleMs >= 0 ? config.commandCloseSettleMs : 350
        };
    }
}

module.exports = SmeltingOperation;
