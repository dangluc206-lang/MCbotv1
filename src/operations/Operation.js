'use strict';

const Result = require('../shared/result/Result');
const Status = require('../shared/result/Status');
const FlowError = require('../shared/errors/FlowError');

const ERROR_STATUS = new Map([
    ['TIMEOUT', Status.TIMEOUT],
    ['OPERATION_QUEUE_WAIT_TIMEOUT', Status.TIMEOUT],
    ['ISLAND_TELEPORT_VERIFY_TIMEOUT', Status.TIMEOUT],
    ['DUNGEON_TELEPORT_VERIFY_TIMEOUT', Status.TIMEOUT],
    ['AFK_TELEPORT_VERIFY_TIMEOUT', Status.TIMEOUT],
    ['COMMAND_CONFIRM_TIMEOUT', Status.TIMEOUT],
    ['GUI_SEMANTIC_TIMEOUT', Status.TIMEOUT],
    ['KHO_SEMANTIC_VERIFY_TIMEOUT', Status.TIMEOUT],
    ['FISHING_WORLD_READY_TIMEOUT', Status.TIMEOUT],
    ['FISHING_MOVEMENT_TIMEOUT', Status.TIMEOUT],
    ['SPRINT_JUMP_NAVIGATION_TIMEOUT', Status.TIMEOUT],
    ['NAVIGATION_TIMEOUT', Status.TIMEOUT],
    ['PV_WITHDRAW_INVENTORY_SYNC_TIMEOUT', Status.TIMEOUT],

    ['CANCELLED', Status.CANCELLED],

    ['OPERATION_QUEUE_FULL', Status.BUSY],
    ['OPERATION_MANAGER_CLOSED', Status.BUSY],
    ['OPERATION_LOCK_BUSY', Status.BUSY],
    ['DUNGEON_LOCK_BUSY', Status.BUSY],
    ['FISHING_MOVEMENT_BUSY', Status.BUSY],

    ['OPERATION_VERIFICATION_FAILED', Status.VERIFICATION_FAILED],
    ['GUI_CLICK_VERIFY_FAILED', Status.VERIFICATION_FAILED],
    ['NAVIGATION_ARRIVAL_VERIFY_FAILED', Status.VERIFICATION_FAILED],
    ['B1_SMELTING_VERIFY_FAILED', Status.VERIFICATION_FAILED],
    ['B5_DEPOSIT_VERIFICATION_FAILED', Status.VERIFICATION_FAILED],
    ['B5_RECOVERY_VERIFICATION_FAILED', Status.VERIFICATION_FAILED],
    ['PV_TRANSFER_VERIFICATION_FAILED', Status.VERIFICATION_FAILED],
    ['PV_WITHDRAW_VERIFICATION_FAILED', Status.VERIFICATION_FAILED],
    ['KHO_SELL_NOT_VERIFIED', Status.VERIFICATION_FAILED],
    ['CRAFTING_OUTPUT_NOT_VERIFIED', Status.VERIFICATION_FAILED],
    ['CRAFTING_OUTCOME_UNCERTAIN', Status.VERIFICATION_FAILED],
    ['CRAFTING_GUI_IDENTITY_MISMATCH', Status.VERIFICATION_FAILED],
    ['FISHING_ROD_EQUIP_VERIFY_FAILED', Status.VERIFICATION_FAILED],

    ['BOT_NOT_READY', Status.NOT_READY],
    ['PATHFINDER_NOT_READY', Status.NOT_READY],
    ['PATHFINDER_NOT_READY_AFTER_SPAWN', Status.NOT_READY],
    ['FISHING_POSITION_NOT_READY', Status.NOT_READY],

    ['CRAFTING_ENTRY_NOT_FOUND', Status.NOT_FOUND],
    ['CRAFTING_RECIPE_NOT_FOUND', Status.NOT_FOUND],
    ['CRAFTING_QUANTITY_NOT_FOUND', Status.NOT_FOUND],

    ['CRAFTING_QUANTITY_INVALID', Status.INVALID_INPUT],

    ['DISCONNECTED', Status.DISCONNECTED],
    ['ISLAND_STALE_GENERATION', Status.DISCONNECTED],
    ['AFK_STALE_GENERATION', Status.DISCONNECTED],
    ['COMMAND_STALE_GENERATION', Status.DISCONNECTED],
    ['COMMAND_CONFIRM_DISCONNECTED', Status.DISCONNECTED],
    ['GUI_WAIT_DISCONNECTED', Status.DISCONNECTED],
    ['GUI_CLICK_DISCONNECTED', Status.DISCONNECTED],
    ['GUI_STALE_GENERATION', Status.DISCONNECTED],
    ['GUI_CLICK_STALE_GENERATION', Status.DISCONNECTED],
    ['FISHING_STALE_GENERATION', Status.DISCONNECTED],
    ['FISHING_MOVEMENT_DISCONNECTED', Status.DISCONNECTED],
    ['FISHING_WORLD_DISCONNECTED', Status.DISCONNECTED],
    ['INVENTORY_SYNC_STALE_GENERATION', Status.DISCONNECTED],
    ['OPERATION_CHILD_STALE_GENERATION', Status.DISCONNECTED],

    ['OPERATION_CONTEXT_INVALID', Status.INVALID_INPUT],
    ['OPERATION_CONTEXT_STALE', Status.INVALID_INPUT],
    ['DUNGEON_GENERATION_REQUIRED', Status.INVALID_INPUT],
    ['DUNGEON_VERIFY_TIMEOUT_INVALID', Status.INVALID_INPUT],
    ['SKYBLOCK_GENERATION_REQUIRED', Status.INVALID_INPUT]
]);

function statusForError(error) {
    return ERROR_STATUS.get(error?.code) || Status.FAILED;
}

class Operation {
    constructor({ name, lockKeys = [], execute, verify = null, returnsResult = false }) {
        if (typeof execute !== 'function') throw new TypeError('execute is required');
        this.name = name || 'Operation';
        this.lockKeys = Object.freeze([...lockKeys]);
        this.executor = execute;
        this.verifier = verify;
        this.returnsResult = returnsResult === true;
        Object.freeze(this);
    }

    async run(context, { lockPolicy, timeoutPolicy }) {
        context.throwIfCancelled();
        if (!lockPolicy.acquire(this.lockKeys, context.lockOwner)) {
            const error = new FlowError('Required operation lock is busy.', { code: 'OPERATION_LOCK_BUSY', subsystem: 'operation', operation: this.name, step: 'acquire-lock', retryable: true, details: { operationId: context.operationId, locks: this.lockKeys } });
            return Result.fail(Status.BUSY, error.message, error, error.toDiagnostic());
        }
        try {
            const data = await timeoutPolicy.run(() => this.executor(context), context);
            context.throwIfCancelled();
            if (this.returnsResult && data && typeof data === 'object' && typeof data.success === 'boolean') {
                return data;
            }
            if (this.verifier && !await this.verifier(data, context)) {
                const error = new FlowError('Operation verification failed.', { code: 'OPERATION_VERIFICATION_FAILED', subsystem: 'operation', operation: this.name, step: 'verify', retryable: false, details: context.diagnostic(), trace: context.trace });
                return Result.fail(Status.VERIFICATION_FAILED, error.message, error, error.toDiagnostic());
            }
            return Result.ok(data, { operation: this.name, operationId: context.operationId, correlationId: context.correlationId, connectionGeneration: context.connectionGeneration });
        } catch (error) {
            const wrapped = FlowError.wrap(error, { subsystem: error?.subsystem || 'operation', operation: error?.operation || this.name, details: { operationId: context.operationId, ...(error?.details || {}) }, trace: error?.trace?.length ? error.trace : context.trace });
            const status = statusForError(error);
            return Result.fail(status, wrapped.message, wrapped, wrapped.toDiagnostic());
        } finally {
            lockPolicy.release(this.lockKeys, context.lockOwner);
        }
    }
}

Operation.statusForError = statusForError;
module.exports = Operation;
