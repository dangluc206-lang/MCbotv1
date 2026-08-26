(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotIncidentViewModel = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  const ACTIVE = new Set(['OPEN','RECOVERING','NEEDS_ACTION']);
  function active(items) { return (items || []).filter(item => ACTIVE.has(item.state)); }
  function groupCount(items) { return active(items).reduce((out, item) => { out[item.severity] = (out[item.severity] || 0) + 1; return out; }, {}); }
  return Object.freeze({ ACTIVE, active, groupCount });
}));
