(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotRendererHtml = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }
  return Object.freeze({ escape });
}));
