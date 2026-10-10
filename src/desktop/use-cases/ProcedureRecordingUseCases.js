'use strict';

const Redactor = require('../../shared/security/Redactor');

/**
 * Desktop control path for operator procedure recording (G21.1).
 * Thin use-case over the EXISTING operator GUI surface (inspect-only GUI
 * capture + the G20 builder), NOT a new live replay contract:
 * - record: replays the operator-verified command+slots through the PURE
 *   recorder bound to the bot's LIVE capabilities. Zero Minecraft side
 *   effects: only record(), backed by the live snapshot the inspector
 *   just captured.
 * - preview: toProcedure() returns the recorded steps plus the
 *   unresolved[]/identityComplete report, so the operator sees identity
 *   gaps BEFORE validate/save.
 * - validate: the SAME ProcedureBuilderUseCases authority the builder
 *   surface shares; invalid drafts never reach persistence.
 */
class ProcedureRecordingUseCases {
    constructor({ bundleProvider, requireRunning, validateDraft }) {
        if (typeof bundleProvider !== 'function' || typeof requireRunning !== 'function') {
            throw new TypeError('ProcedureRecordingUseCases requires bundleProvider and requireRunning.');
        }
        if (typeof validateDraft !== 'function') throw new TypeError('ProcedureRecordingUseCases requires validateDraft.');
        Object.assign(this, { bundleProvider, requireRunning, validateDraft });
    }

    recordFromInspection(botId, { procedureId, commandKey, slots = [], label = '', description = '' } = {}) {
        this.requireRunning();
        const id = String(procedureId || '').trim();
        if (!id) throw Object.assign(new Error('procedure id là bắt buộc.'), { code: 'PROCEDURE_INVALID' });
        const runtime = this.bundleProvider().application.getRuntime(botId);
        const inspection = runtime.requireService('guiInspectionService');
        const last = typeof inspection?.lastSnapshot === 'function' ? inspection.lastSnapshot() : null;
        const recorder = runtime.getService?.('crafting')?.procedureRecording || null;
        if (!recorder?.record || !last?.window) {
            throw Object.assign(new Error('Chưa có bản chụp GUI nào cho bot này: hãy Chụp GUI trước khi ghi procedure.'), { code: 'PROCEDURE_RECORDING_NO_SNAPSHOT' });
        }
        if (String(last.commandKey || '') !== String(commandKey || '')) {
            throw Object.assign(new Error('Bản chụp GUI không khớp lệnh đã chọn: hãy Chụp GUI lại với đúng lệnh.'), { code: 'PROCEDURE_RECORDING_STALE_SNAPSHOT' });
        }
        const normalizedSlots = Array.isArray(slots) ? slots.map(Number).filter(Number.isInteger) : [];
        if (!normalizedSlots.length) throw Object.assign(new Error('procedure cần ít nhất một ô đã nhấp để ghi.'), { code: 'PROCEDURE_INVALID' });
        recorder.reset();
        // Accept either the recording-runtime surface (recordCommand/recordOpenGui/
        // recordClick) or the bare recorder surface (record({kind...})).
        const recordCommand = value => (typeof recorder.recordCommand === 'function'
            ? recorder.recordCommand(value)
            : recorder.record({ kind: 'command', commandKey: value }));
        const recordOpenGui = value => (typeof recorder.recordOpenGui === 'function'
            ? recorder.recordOpenGui(value)
            : recorder.record({ kind: 'open-gui', guiId: value }));
        const recordClick = value => (typeof recorder.recordClick === 'function'
            ? recorder.recordClick(value)
            : recorder.record({ kind: 'click', slot: value.slot, windowId: value.windowId ?? null }));
        recordCommand(String(commandKey));
        recordOpenGui(String(last.guiId || commandKey));
        for (const slot of normalizedSlots) recordClick({ slot, windowId: last.guiId || null });
        const recorded = recorder.toProcedure({ id, label: label || id, description: String(description || '') });
        const validation = this.validateDraft({
            id: recorded.id, steps: recorded.steps,
            label: recorded.label, description: recorded.description,
            quantityStrategy: recorded.quantityStrategy, maxBatch: recorded.maxBatch
        });
        return Redactor.sanitize({
            contract: 'procedure-recording-preview-v1',
            id: recorded.id, label: recorded.label, description: recorded.description,
            steps: recorded.steps, stepCount: recorded.stepCount,
            unresolved: recorded.unresolved, identityComplete: recorded.unresolved.length === 0,
            valid: validation.valid, errors: validation.errors
        });
    }
}

module.exports = ProcedureRecordingUseCases;
