(function universal(root, factory) {
  const value = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = value;
  else {
    root.MCbotB5CraftRequestPanel = value;
    root.MCbotCraftingRequestPanel = root.MCbotCraftingRequestPanel || value;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function create(root) {
  'use strict';

  const crafting = (typeof module === 'object' && module.exports)
    ? require('../crafting/CraftingRequestPanel')
    : root.MCbotCraftingRequestPanel;

  function statusText(request, phase) {
    return crafting.statusText(request, phase, request?.waitingReason || null);
  }

  // Compat wrapper: keeps the B5 data-attribute selectors and b5-request-*
  // action names working while app.js migrates to the generic panel.
  function render({ botId, items = [], request = null, phase = '', draft = {}, esc }) {
    const html = crafting.render({ botId, items, request, phase, waitingReason: request?.waitingReason || '', draft, esc });
    return html
      .replaceAll('craft-request-panel', 'actions b5-request-panel')
      .replaceAll('data-craft-request-bot', 'data-b5-request-bot')
      .replaceAll('data-craft-request-item', 'data-b5-request-item')
      .replaceAll('data-craft-request-quantity', 'data-b5-request-quantity')
      .replaceAll('data-craft-request-all', 'data-b5-request-all')
      .replaceAll('craft-request-status', 'b5-request-status')
      .replaceAll('craft-request-all', 'b5-request-all')
      .replaceAll('data-action="craft-request-start"', 'data-action="b5-request-start"')
      .replaceAll('data-action="craft-request-clear"', 'data-action="b5-request-clear"');
  }

  return Object.freeze({ ...crafting, statusText, render });
}));


