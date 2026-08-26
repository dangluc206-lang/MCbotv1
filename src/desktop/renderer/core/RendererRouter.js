(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotRendererRouter = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  const ALIASES = Object.freeze({ overview:'dashboard', profiles:'bots', mode:'modes', errors:'incidents', maintenance:'settings', config:'settings' });
  function normalize(page, catalog) {
    const value = ALIASES[page] || page;
    return catalog[value] ? value : 'dashboard';
  }
  function allowed(page, experienceLevel, catalog) {
    const normalized = normalize(page, catalog);
    return catalog[normalized]?.group !== 'ADVANCED' || experienceLevel === 'advanced' ? normalized : 'dashboard';
  }
  function apply(page, { document, catalog, experienceLevel = 'standard' } = {}) {
    const next = allowed(page, experienceLevel, catalog);
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === next));
    document.querySelectorAll('.page').forEach(section => section.classList.toggle('active', section.id === `page-${next}`));
    const title = catalog[next];
    document.querySelector('#pageTitle').textContent = title.title;
    document.querySelector('#pageSubtitle').textContent = title.subtitle;
    return next;
  }
  return Object.freeze({ ALIASES, normalize, allowed, apply });
}));
