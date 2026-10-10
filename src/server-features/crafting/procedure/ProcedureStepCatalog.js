'use strict';

const ProcedureRegistry = require('./ProcedureRegistry');

/**
 * Procedure step catalog (G20).
 * Single source of truth for the operator-facing builder: derived directly from
 * ProcedureRegistry.STEP_TYPES so the builder can represent every step the
 * runtime schema accepts (constructor fails closed on drift in either
 * direction). Presentation fields follow the workflow-module presentation
 * shape ({ key, label, type, ... }) so the existing TypedModuleEditor renders
 * procedure parameters without a second editor schema.
 *
 * owner:
 * - 'runtime'   CraftingProcedureRuntime executes the step directly.
 * - 'operation' the operation owns the step; the runtime fails closed
 *               (CRAFTING_PROCEDURE_STEP_NOT_OWNED) if executed standalone.
 */
const FIELD = (key, label, type, options = {}) => Object.freeze({ key, label, type, ...options });
const NO_FIELDS = Object.freeze([]);

const CATALOG = Object.freeze({
  command: { label: 'Lệnh', description: 'Gửi lệnh đã đăng ký (qua CommandService).', owner: 'runtime', fields: Object.freeze([FIELD('commandKey', 'Mã lệnh', 'text', { required: true }), FIELD('timeoutMs', 'Timeout (ms)', 'integer', { min: 100, max: 30000 })]) },
  'slash-command': { label: 'Slash command', description: 'Gửi lệnh / đã qua guard.', owner: 'runtime', fields: Object.freeze([FIELD('command', 'Slash command', 'text', { required: true, pattern: '^/' })]) },
  'open-gui': { label: 'Mở GUI', description: 'Mở GUI theo guiId và chờ session.', owner: 'runtime', fields: Object.freeze([FIELD('guiId', 'GUI ID', 'text', { required: true })]) },
  'resolve-gui': { label: 'Xác định GUI', description: 'Xác định lại GUI hiện tại.', owner: 'runtime', fields: Object.freeze([FIELD('guiId', 'GUI ID', 'text')]) },
  'wait-for-gui': { label: 'Chờ GUI', description: 'Chờ GUI identity có giới hạn.', owner: 'runtime', fields: Object.freeze([FIELD('guiId', 'GUI ID', 'text'), FIELD('timeoutMs', 'Timeout (ms)', 'integer', { min: 100, max: 30000 })]) },
  'find-logical-item': { label: 'Tìm item logic', description: 'Tìm ô theo identity (hỗ trợ $recipe.* template).', owner: 'runtime', fields: Object.freeze([FIELD('itemId', 'ItemId / template', 'text', { required: true })]) },
  'find-slot': { label: 'Tìm slot', description: 'Ghi nhớ slot thô làm fallback.', owner: 'runtime', fields: Object.freeze([FIELD('slot', 'Slot', 'integer', { min: 0, max: 1000, required: true })]) },
  click: { label: 'Nhấp', description: 'Nhấp slot đã resolve (entry/recipe/quantity).', owner: 'runtime', fields: NO_FIELDS },
  wait: { label: 'Chờ', description: 'Chờ có giới hạn và hỗ trợ hủy.', owner: 'runtime', fields: Object.freeze([FIELD('ms', 'Thời gian (ms)', 'integer', { min: 0, max: 3600000 })]) },
  'wait-for-transition': { label: 'Chờ chuyển đổi', description: 'Chờ window transition sau nhấp.', owner: 'runtime', fields: Object.freeze([FIELD('ms', 'Thời gian (ms)', 'integer', { min: 0, max: 3600000 })]) },
  'wait-for-message': { label: 'Chờ message', description: 'Chờ chat match pattern (operation-owned).', owner: 'operation', fields: Object.freeze([FIELD('params.pattern', 'Pattern', 'text', { required: true }), FIELD('timeoutMs', 'Timeout (ms)', 'integer', { min: 100, max: 30000 })]) },
  'wait-for-output': { label: 'Chờ output', description: 'Chờ output tăng (operation-owned).', owner: 'operation', fields: Object.freeze([FIELD('timeoutMs', 'Timeout (ms)', 'integer', { min: 100, max: 30000 })]) },
  'close-gui': { label: 'Đóng GUI', description: 'Đóng GUI hiện tại.', owner: 'runtime', fields: NO_FIELDS },
  'verify-item': { label: 'Xác minh item', description: 'Xác minh item đã xuất hiện (operation-owned).', owner: 'operation', fields: Object.freeze([FIELD('itemId', 'ItemId', 'text'), FIELD('amount', 'Số lượng', 'integer', { min: 1 })]) },
  'verify-quantity': { label: 'Xác minh số lượng', description: 'Xác minh output đạt amount (operation-owned; hỗ trợ template).', owner: 'operation', fields: Object.freeze([FIELD('amount', 'Amount / template', 'text', { required: true })]) }
});

// Fail closed at load time, in both directions: every runtime-supported step
// must be representable by the builder, and the builder must not invent step
// types the runtime schema rejects. This runs on require (not on construction)
// so the guard cannot be skipped by calling the static helpers directly.
const DECLARED = Object.freeze(Object.keys(CATALOG).sort());
const SUPPORTED = Object.freeze([...ProcedureRegistry.STEP_TYPES].sort());
if (JSON.stringify(DECLARED) !== JSON.stringify(SUPPORTED)) {
  throw new Error(`Procedure step catalog drift: declared=[${DECLARED}] runtime=[${SUPPORTED}]`);
}

class ProcedureStepCatalog {
  static list() {
    return ProcedureRegistry.STEP_TYPES.map(type => {
      const entry = CATALOG[type];
      return Object.freeze({
        type,
        label: entry.label,
        description: entry.description,
        owner: entry.owner,
        presentation: Object.freeze({ contract: 'procedure-step-presentation-v1', fields: entry.fields })
      });
    });
  }

  static require(type) {
    const value = CATALOG[String(type || '').trim()];
    if (!value) {
      const error = new Error(`Không có step catalog cho procedure step: ${type}`);
      error.code = 'PROCEDURE_STEP_CATALOG_MISSING';
      throw error;
    }
    return value;
  }
}

module.exports = ProcedureStepCatalog;