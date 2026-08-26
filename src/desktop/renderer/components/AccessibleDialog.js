(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotAccessibleDialog = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  function open(dialog, { beforeOpen = null, focus = null } = {}) {
    const restoreFocus = dialog.ownerDocument.activeElement;
    beforeOpen?.();
    return new Promise(resolve => {
      const close = () => {
        dialog.removeEventListener('close', close);
        queueMicrotask(() => restoreFocus?.focus?.());
        resolve(dialog.returnValue);
      };
      dialog.addEventListener('close', close);
      dialog.showModal();
      queueMicrotask(() => focus?.());
    });
  }
  return Object.freeze({ open });
}));
