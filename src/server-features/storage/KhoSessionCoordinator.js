'use strict';
const FlowError = require('../../shared/errors/FlowError');

class KhoSessionCoordinator {
  constructor({ commandService, guiManager, reader, context = null, logger = null, config, source, verifySession, hasCapacity }) {
    Object.assign(this, { commandService, guiManager, reader, context, logger, config, source, verifySession, hasCapacity });
  }
  reconfigure(config, source) { this.config = config; this.source = source; return this; }
  async openOrRefresh({ refresh, cancellationToken, expectedGeneration = null, operationContext = null }) {
    const errors = [];
    for (let attempt = 1; attempt <= this.config.openAttempts; attempt += 1) {
      try {
        this.logger?.info?.('KHO OPEN ATTEMPT', { operation: 'KhoService', step: 'open-or-refresh', phase: 'START', action: '/kho', resource: 'storage', attempt, maxAttempts: this.config.openAttempts });
        return await this.#attempt({ refresh, cancellationToken, expectedGeneration, operationContext });
      } catch (error) {
        errors.push(error); if (attempt >= this.config.openAttempts) break;
        this.logger?.debug?.('A /kho command did not expose readable storage data; retrying.', { attempt, maxAttempts: this.config.openAttempts, error: error.message });
        if (this.guiManager.current()) await this.closeAndSettle(cancellationToken); else await this.#delay(this.config.retryDelayMs, cancellationToken);
      }
    }
    const first = errors[0]?.message || 'unknown', last = errors.at(-1)?.message || 'unknown';
    throw new FlowError(`/kho did not expose readable storage data after ${this.config.openAttempts} attempts. First: ${first}; Last: ${last}`, {
      code: 'KHO_GUI_NOT_READABLE', subsystem: 'storage', operation: 'KhoService', step: 'open-or-refresh', action: '/kho', resource: 'storage', attempt: this.config.openAttempts,
      details: { attempts: errors.map((error, index) => ({ attempt: index + 1, message: error.message })), gui: this.guiManager.describeCurrent?.() || null }, cause: errors.at(-1) || null
    });
  }
  async #attempt({ refresh, cancellationToken, expectedGeneration, operationContext }) {
    cancellationToken?.throwIfCancelled?.(); this.#assertGeneration(expectedGeneration);
    let beforeSession = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
    let beforeWindow = beforeSession?.window || null;
    let beforeSnapshot = beforeWindow ? this.reader.read(beforeWindow) : null;
    let beforeReadable = this.verifySession(beforeSession, beforeSnapshot, { commandContext: false });
    const sellGui = beforeSession?.source?.commandKey === this.config?.sell?.commandKey || beforeSession?.source?.command === '/kho sell';
    if (beforeSession?.active && (sellGui || !beforeReadable)) {
      this.logger?.debug?.(sellGui ? 'Closing /kho sell GUI before /kho command.' : 'Closing unrelated GUI before /kho command.', {
        operation: 'KhoService', step: 'prepare-open', action: 'close current GUI before /kho', gui: this.guiManager.describeCurrent?.() || null
      });
      await this.closeAndSettle(cancellationToken);
      beforeSession = this.guiManager.syncCurrentWindow?.() || this.guiManager.current(); beforeWindow = beforeSession?.window || null;
      beforeSnapshot = beforeWindow ? this.reader.read(beforeWindow) : null; beforeReadable = this.verifySession(beforeSession, beforeSnapshot, { commandContext: false });
    }
    await this.#postCloseGate(beforeSession, cancellationToken);
    await this.#sendCommand(refresh, cancellationToken, expectedGeneration, operationContext);
    const settleMs = refresh ? this.config.refreshSettleMs : this.config.openSettleMs;
    if (settleMs > 0) await this.#delay(settleMs, cancellationToken); this.#assertGeneration(expectedGeneration);
    return this.#waitForReadable({ refresh, cancellationToken, expectedGeneration, beforeSession, beforeWindow, beforeReadable });
  }
  async #postCloseGate(beforeSession, cancellationToken) {
    if (beforeSession?.active || typeof this.guiManager.waitForPostCloseSettle !== 'function') return;
    const waitedMs = await this.guiManager.waitForPostCloseSettle(this.config.openAfterCloseSettleMs, { cancellationToken });
    if (waitedMs > 0) this.logger?.debug?.('KHO POST-CLOSE COMMAND GATE', { operation: 'KhoService', step: 'prepare-open', action: 'wait after GUI close before /kho', resource: 'storage', waitedMs });
  }
  async #sendCommand(refresh, cancellationToken, expectedGeneration, operationContext) {
    this.logger?.info?.('KHO COMMAND SEND', { operation: 'KhoService', step: refresh ? 'refresh-command' : 'open-command', phase: 'START', action: '/kho', resource: 'storage' });
    const result = await this.commandService.send(this.config.commandKey, { confirm: false, cancellationToken, expectedGeneration,
      operationId: operationContext?.operationId || null, correlationId: operationContext?.correlationId || null });
    if (result?.success === false) throw result.error || new Error(result.message || '/kho command failed.');
    this.logger?.info?.('KHO COMMAND SENT', { operation: 'KhoService', step: refresh ? 'refresh-command' : 'open-command', phase: 'OK', action: '/kho', resource: 'storage' });
  }
  async #waitForReadable({ refresh, cancellationToken, expectedGeneration, beforeSession, beforeWindow, beforeReadable }) {
    const deadline = Date.now() + this.config.guiTimeoutMs;
    let lastState = { hasSession: false, itemCount: 0, hasCapacity: false, changedWindow: false, beforeWasReadableKho: beforeReadable };
    while (Date.now() <= deadline) {
      cancellationToken?.throwIfCancelled?.(); this.#assertGeneration(expectedGeneration);
      const session = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
      if (session?.active && session.window) {
        const snapshot = this.reader.read(session.window); const itemCount = Object.keys(snapshot?.items || {}).length;
        const hasCapacity = this.hasCapacity(snapshot?.capacity); const changedWindow = !beforeWindow || session.window !== beforeWindow || (beforeSession && session.id !== beforeSession.id);
        lastState = { hasSession: true, itemCount, hasCapacity, changedWindow, beforeWasReadableKho: beforeReadable };
        if (this.verifySession(session, snapshot, { commandContext: true }) && (changedWindow || beforeReadable || !beforeSession)) {
          session.setSource?.(this.source); this.logger?.info?.('KHO GUI VERIFIED', { operation: 'KhoService', step: refresh ? 'refresh-wait' : 'open-wait', phase: 'OK', action: '/kho', resource: 'storage', count: itemCount, hasCapacity, changedWindow });
          return session;
        }
      }
      await this.#delay(this.config.commandPollMs, cancellationToken);
    }
    throw new FlowError('/kho command was sent but current GUI did not contain readable storage data.', {
      code: 'KHO_SEMANTIC_VERIFY_TIMEOUT', subsystem: 'storage', operation: 'KhoService', step: refresh ? 'refresh-wait' : 'open-wait', action: '/kho', resource: 'storage',
      details: { ...lastState, timeoutMs: this.config.guiTimeoutMs, gui: this.guiManager.describeCurrent?.() || null }
    });
  }
  async closeAndSettle(cancellationToken = null) {
    if (this.guiManager.current()) await this.guiManager.closeCurrentWindow();
    const deadline = Date.now() + this.config.closeConfirmTimeoutMs;
    while (Date.now() <= deadline) {
      cancellationToken?.throwIfCancelled?.(); const current = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
      if (!current?.active) break; await this.#delay(this.config.commandPollMs, cancellationToken);
    }
    const remaining = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
    if (remaining?.active) throw new Error('Current GUI did not close before /kho command.');
    await this.#delay(this.config.openAfterCloseSettleMs, cancellationToken);
  }
  #assertGeneration(expectedGeneration) {
    if (expectedGeneration === null || !this.context) return;
    if (this.context.has?.() && Number(this.context.getGeneration?.()) === expectedGeneration) return;
    throw new FlowError('Storage operation belongs to a stale connection generation.', { code: 'DISCONNECTED', subsystem: 'storage', operation: 'KhoService', step: 'generation-guard', retryable: true,
      details: { expectedGeneration, currentGeneration: this.context.getGeneration?.() ?? null } });
  }
  #delay(ms, cancellationToken = null) {
    const timeout = Math.max(0, Number(ms) || 0); if (!cancellationToken) return new Promise(resolve => setTimeout(resolve, timeout));
    return new Promise((resolve, reject) => { let unsubscribe = () => {}; const timer = setTimeout(() => { unsubscribe(); resolve(); }, timeout);
      unsubscribe = cancellationToken.onCancelled(reason => { clearTimeout(timer); unsubscribe(); reject(new Error(String(reason || 'Cancelled'))); }); });
  }
}
module.exports = KhoSessionCoordinator;
