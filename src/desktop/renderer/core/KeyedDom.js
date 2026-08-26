(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotKeyedDom = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  function updateHtml(container, items, keyOf, htmlOf, emptyHtml = '') {
    if (!container) return;
    const existing = new Map([...container.children].filter(node => node.dataset?.renderKey).map(node => [node.dataset.renderKey, node]));
    const fragment = container.ownerDocument.createDocumentFragment();
    for (const item of items) {
      const key = String(keyOf(item));
      const html = String(htmlOf(item));
      let node = existing.get(key);
      if (!node || node.dataset.renderDigest !== html) {
        const template = container.ownerDocument.createElement('template');
        template.innerHTML = html.trim();
        const replacement = template.content.firstElementChild;
        if (!replacement) continue;
        replacement.dataset.renderKey = key;
        replacement.dataset.renderDigest = html;
        node = replacement;
      }
      fragment.appendChild(node);
      existing.delete(key);
    }
    if (!items.length && emptyHtml) {
      const template = container.ownerDocument.createElement('template');
      template.innerHTML = emptyHtml.trim();
      fragment.appendChild(template.content);
    }
    container.replaceChildren(fragment);
  }
  return Object.freeze({ updateHtml });
}));
