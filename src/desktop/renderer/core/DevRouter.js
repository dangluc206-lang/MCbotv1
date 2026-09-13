(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotDevRouter = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  // Dev navigation is a fixed 9-page set. Pages outside this set (builder,
  // tools, ai) remain in the DEV group but are not part of the Dev nav.
  const DEV_NAV = Object.freeze([
    'dev-overview', 'inspector', 'events', 'logs',
    'incident-debug', 'runtime-state', 'b5-debug', 'diagnostics', 'config-debug'
  ]);

  function isDevNavPage(page) {
    return DEV_NAV.includes(page);
  }

  function apply(page, { document, catalog, experienceLevel = 'standard' } = {}) {
    if (experienceLevel !== 'advanced') return null;
    const next = isDevNavPage(page) ? page : DEV_NAV[0];
    document.querySelectorAll('.dev-nav-item').forEach(item => item.classList.toggle('active', item.dataset.devPage === next));
    document.querySelectorAll('.dev-page').forEach(section => section.classList.toggle('active', section.id === `dev-page-${next}`));
    const title = catalog[next];
    if (title) {
      document.querySelector('#devPageTitle').textContent = title.title;
      document.querySelector('#devPageSubtitle').textContent = title.subtitle;
    }
    return next;
  }

  return Object.freeze({ DEV_NAV, isDevNavPage, apply });
}));