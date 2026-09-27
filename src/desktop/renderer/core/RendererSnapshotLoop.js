(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotRendererSnapshotLoop = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  // Owns the live snapshot cycle: accept snapshot -> schedule one animation-frame
  // render -> paint backend status, selectors, active page and freshness.
  // The composition root injects the mutable store, the DOM helper and the page
  // renderers, so this module keeps no globals of its own.

  function create({ state, $, api, toast, viPhase, formatDuration, syncSelectors, loadStaticData, renderDashboard, renderModes, renderDevOverview }) {
    function renderBackend() {
      const lifecycle = state.snapshot?.lifecycle || 'STOPPED';
      $('#backendState').textContent = viPhase(lifecycle);
      $('#backendDot').className = `dot ${String(lifecycle).toLowerCase()}`;
      $('#sidebarFleet').textContent = `${state.snapshot?.bots?.length || 0} bot`;
      $('#sidebarMemory').textContent = `${state.snapshot?.system?.memoryMb ?? '—'} MB`;
      $('#settingsBackendState').textContent = viPhase(lifecycle);
      $('#settingsUptime').textContent = formatDuration(state.snapshot?.system?.uptimeMs || 0);
      $('#settingsMemory').textContent = `${state.snapshot?.system?.memoryMb ?? '—'} MB`;
      $('#startBackend').disabled = lifecycle === 'RUNNING' || lifecycle === 'STARTING';
      $('#stopBackend').disabled = lifecycle !== 'RUNNING';
      $('#restartBackend').disabled = lifecycle === 'STARTING' || lifecycle === 'STOPPING';
    }

    function renderFreshness() {
      const age = state.lastSnapshotReceivedAt ? Date.now() - state.lastSnapshotReceivedAt : Infinity;
      const threshold = Math.max(5000, Number(state.preferences?.snapshotIntervalMs || 900) * 4);
      const stale = age > threshold;
      const el = $('#liveState');
      el.classList.toggle('stale', stale);
      el.querySelector('strong').textContent = stale ? 'Mất cập nhật trực tiếp' : 'Trực tiếp';
      $('#updatedAt').textContent = state.snapshot?.updatedAt ? `${stale ? 'Lần cuối' : 'Cập nhật'} ${new Date(state.snapshot.updatedAt).toLocaleTimeString('vi-VN', { hour12: false })}` : 'Chưa có bản chụp trạng thái';
    }

    function scheduleDynamicRender() {
      if (state.renderScheduled) return;
      state.renderScheduled = true;
      requestAnimationFrame(() => {
        state.renderScheduled = false;
        renderBackend();
        syncSelectors();
        if (state.page === 'dashboard') renderDashboard();
        if (state.page === 'modes') renderModes();
        if (state.devPage === 'dev-overview') renderDevOverview();
        renderFreshness();
      });
    }

    function acceptSnapshot(snapshot) {
      if (!snapshot) return;
      const previousLifecycle = state.snapshot?.lifecycle;
      state.snapshot = snapshot;
      state.lastSnapshotReceivedAt = Date.now();
      if (previousLifecycle !== 'RUNNING' && snapshot.lifecycle === 'RUNNING') loadStaticData().catch(error => toast(error.message, 'error'));
      scheduleDynamicRender();
    }

    async function refreshSnapshot({ quiet = false } = {}) {
      try { acceptSnapshot(await api(window.mcbot.snapshot())); }
      catch (error) { if (!quiet) toast(error.message, 'error'); }
    }

    return Object.freeze({ renderBackend, renderFreshness, scheduleDynamicRender, acceptSnapshot, refreshSnapshot });
  }

  return Object.freeze({ create });
}));
