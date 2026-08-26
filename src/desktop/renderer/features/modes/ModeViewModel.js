(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotModeViewModel = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  function definition(bot, id) { return (bot?.modes?.available || []).find(entry => entry.definition?.id === id)?.definition || null; }
  function status(bot, id) { return bot?.modes?.byId?.[id] || (bot?.modes?.available || []).find(entry => entry.definition?.id === id)?.status || null; }
  function resolve(bot) {
    const owner = bot?.modeOwner;
    const id = owner ? String(owner.modeId || owner.mode || owner.owner || owner) : bot?.intent?.desiredMode || null;
    if (!id) return Object.freeze({ id:null, definition:null, status:null, desiredOnly:false });
    return Object.freeze({ id, definition:definition(bot,id), status:status(bot,id), desiredOnly:!owner });
  }
  return Object.freeze({ definition, status, resolve });
}));
