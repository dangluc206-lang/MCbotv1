(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotTypedModuleEditor = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  function at(value, path) { return path.split('.').reduce((out, key) => out?.[key], value); }
  function assign(target, path, value) {
    const parts = path.split('.'); let owner = target;
    for (const key of parts.slice(0, -1)) owner = owner[key] ||= {};
    owner[parts.at(-1)] = value;
  }
  function control(field, value, esc) {
    const common = `class="typed-step-input" data-field-key="${esc(field.key)}"`;
    if (field.type === 'boolean') return `<label class="typed-check"><input ${common} type="checkbox" ${value !== false ? 'checked' : ''}> ${esc(field.label)}</label>`;
    if (field.type === 'enum') return `<label>${esc(field.label)}<select ${common}>${field.values.map(item => `<option value="${esc(item)}" ${item === value ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select></label>`;
    const numeric = field.type === 'integer' || field.type === 'number';
    return `<label>${esc(field.label)}<input ${common} type="${numeric ? 'number' : 'text'}" value="${esc(value ?? '')}" ${field.min != null ? `min="${esc(field.min)}"` : ''} ${field.max != null ? `max="${esc(field.max)}"` : ''} ${field.type === 'number' ? 'step="any"' : ''}></label>`;
  }
  function renderNestedRow(step, catalog, esc, depth) {
    const descriptor = catalog.find(item => item.type === step.type);
    return `<div class="typed-nested-row"><select class="nested-step-type" aria-label="Loại bước lồng">${catalog.map(item => `<option value="${esc(item.type)}" ${item.type === step.type ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select><div class="step-editor">${render(step, descriptor, catalog, esc, depth)}</div><button type="button" class="button danger small" data-nested-remove aria-label="Xóa bước lồng">×</button></div>`;
  }
  function render(step, descriptor, catalog, esc, depth = 0) {
    const fields = descriptor?.presentation?.fields || [];
    const typed = fields.length ? fields.map(field => control(field, at(step, field.key), esc)).join('') : '<span class="typed-fixed-contract">Không có tham số tùy chỉnh.</span>';
    const payload = { ...step }; delete payload.type;
    const nested = depth >= 6 ? '' : (descriptor?.presentation?.nestedSections || []).map(section => {
      const children = Array.isArray(step[section]) ? step[section] : [];
      return `<section class="typed-nested-section" data-nested-section="${esc(section)}"><div class="typed-nested-head"><strong>${esc(section)}</strong><button type="button" class="button ghost small" data-nested-add>+ Thêm bước</button></div><div class="typed-nested-list">${children.map(child => renderNestedRow(child, catalog, esc, depth + 1)).join('')}</div></section>`;
    }).join('');
    return `<div class="typed-step-fields">${typed}</div>${nested}<details class="advanced-builder"><summary>JSON bước nâng cao</summary><textarea class="step-json" spellcheck="false">${esc(JSON.stringify(payload, null, 2))}</textarea></details>`;
  }
  function read(row, type) {
    let payload = {};
    const editor = row.matches('.workflow-step,.typed-nested-row') ? row.querySelector(':scope > .step-editor') : row;
    const raw = editor?.querySelector(':scope > details > .step-json')?.value.trim();
    if (raw) payload = JSON.parse(raw);
    const fields = editor?.querySelector(':scope > .typed-step-fields');
    for (const input of fields?.querySelectorAll('.typed-step-input') || []) {
      let value = input.type === 'checkbox' ? input.checked : input.value;
      if (input.type === 'number') value = Number(value);
      assign(payload, input.dataset.fieldKey, value);
    }
    for (const section of editor?.querySelectorAll(':scope > .typed-nested-section') || []) {
      payload[section.dataset.nestedSection] = [...section.querySelector(':scope > .typed-nested-list').children].map(child => read(child, child.querySelector(':scope > .nested-step-type').value));
    }
    return { ...payload, type };
  }
  return Object.freeze({ render, renderNestedRow, read });
}));
