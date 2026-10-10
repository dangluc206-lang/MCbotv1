(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotProcedureBuilderBindings = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';

  // G20 renderer boundary: owns the procedure builder DOM wiring only.
  // Every step type, parameter and quantity strategy comes from the runtime
  // ProcedureRegistry schema surfaced by mcbot:procedure:catalog, so the builder
  // cannot express a procedure the runtime would reject.

  function bind(deps) {
    const { $, state, toast, runAction, api, defaultProcedureStep, newProcedureDraft,
      procedureDraftFromBuilder, fillProcedureBuilder, renderProcedurePalette,
      changeProcedureStep, loadProcedureBuilder } = deps;

    $('#procedureStepPalette').addEventListener('click', event => {
      const button = event.target.closest('[data-procedure-add]'); if (!button) return;
      let draft;
      try { draft = procedureDraftFromBuilder(); }
      catch (error) { toast(`JSON bước không hợp lệ: ${error.message}`, 'error'); return; }
      draft.steps.push(defaultProcedureStep(button.dataset.procedureAdd));
      fillProcedureBuilder(draft);
    });

    $('#procedureSteps').addEventListener('click', event => {
      const button = event.target.closest('[data-procedure-action]');
      if (button) changeProcedureStep(button);
    });

    $('#procedureSteps').addEventListener('change', event => {
      const select = event.target.closest('.step-type'); if (!select) return;
      const row = select.closest('.workflow-step');
      let draft;
      try { draft = procedureDraftFromBuilder(); }
      catch { draft = state.procedureDraft || newProcedureDraft(); }
      draft.steps[Number(row.dataset.procedureIndex)] = defaultProcedureStep(select.value);
      fillProcedureBuilder(draft);
    });

    $('#procedureStepSearch').oninput = event => renderProcedurePalette(event.target.value);
    $('#procedureNew').onclick = () => { $('#procedureSelect').value = ''; fillProcedureBuilder(); };
    $('#procedureSelect').onchange = () => {
      const id = $('#procedureSelect').value;
      fillProcedureBuilder(id && state.procedures?.[id] ? { ...state.procedures[id], id } : null);
    };
    $('#procedureClearSteps').onclick = () => {
      const draft = procedureDraftFromBuilder();
      draft.steps = [];
      fillProcedureBuilder(draft);
    };
    $('#procedureApplyJson').onclick = () => {
      try { fillProcedureBuilder(JSON.parse($('#procedureJson').value)); toast('Đã áp dụng JSON vào trình dựng.'); }
      catch (error) { toast(`JSON không hợp lệ: ${error.message}`, 'error'); }
    };

    $('#procedureValidate').onclick = event => runAction({
      key: 'procedure-validate',
      button: event.currentTarget,
      success: 'Procedure hợp lệ với runtime schema.',
      refresh: false,
      fn: () => api(window.mcbot.procedureValidate(procedureDraftFromBuilder()))
    }).catch(() => {});

    $('#procedureDryRun').onclick = event => runAction({
      key: 'procedure-dry-run',
      button: event.currentTarget,
      success: 'Mô phỏng hoàn tất; không gọi capability.',
      refresh: false,
      fn: async () => {
        const report = await api(window.mcbot.procedureDryRun(procedureDraftFromBuilder(), { requested: 100 }));
        $('#procedureSimulation').textContent = JSON.stringify(report, null, 2);
        return report;
      }
    }).catch(() => {});

    $('#procedureSave').onclick = event => runAction({
      key: 'procedure-save',
      button: event.currentTarget,
      success: 'Đã lưu procedure. Khởi động lại hệ thống nền để nạp registry.',
      refresh: false,
      fn: async () => {
        const draft = procedureDraftFromBuilder();
        const result = await api(window.mcbot.procedureSave(draft));
        await loadProcedureBuilder();
        $('#procedureSelect').value = draft.id;
        fillProcedureBuilder(draft);
        return result;
      }
    }).catch(() => {});

    return Object.freeze({ bound: true });
  }

  return Object.freeze({ create: deps => Object.freeze({ bind: () => bind(deps) }) });
}));
