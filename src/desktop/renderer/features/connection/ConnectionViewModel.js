'use strict';

(function expose(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotConnectionViewModel = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createConnectionViewModel() {
  function controlState(bot = {}) {
    const phase = String(bot.state?.connectionState || 'DISCONNECTED').toUpperCase();
    const online = bot.connectionOnline === true;
    const desired = String(bot.intent?.desiredConnection || '').toUpperCase();
    const connecting = phase === 'CONNECTING' || phase === 'RECONNECTING';
    const wantsConnected = desired === 'CONNECTED';
    return Object.freeze({
      phase,
      online,
      connecting,
      wantsConnected,
      canConnect: !online && !connecting && !wantsConnected,
      canDisconnect: online || connecting || wantsConnected
    });
  }

  return Object.freeze({ controlState });
});
