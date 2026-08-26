'use strict';

const { randomUUID } = require('node:crypto');
const Timeout = require('../../shared/time/Timeout');
const { immutableClone } = require('../../shared/utils/object');

const LIMIT = 32;
const TTL_MS = 5 * 60 * 1000;

class FleetEmergencyTransactionManager {
    constructor({ store, profileIds, requireRuntime, reconcileBot, resetRuntime }) {
        Object.assign(this, { store, profileIds, requireRuntime, reconcileBot, resetRuntime });
        this.transactions = new Map();
    }

    stop(botIds = null, { source = 'operator-emergency', idempotencyKey = randomUUID(), timeoutMs = 15000 } = {}) {
        const ids = [...new Set((botIds || this.profileIds()).map(value => String(value || '').trim()).filter(Boolean))].sort();
        if (ids.length === 0) return Promise.resolve(immutableClone({ contract: 'fleet-emergency-stop-v1', transactionId: idempotencyKey, outcome: 'SUCCESS', botCount: 0, terminalCount: 0, results: [] }));
        const key = String(idempotencyKey || '').trim();
        if (!/^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(key)) throw new TypeError('Emergency stop idempotencyKey is invalid.');
        const fingerprint = JSON.stringify(ids);
        this.#trim();
        const existing = this.transactions.get(key);
        if (existing) {
            if (existing.fingerprint !== fingerprint) throw Object.assign(new Error('Emergency stop idempotencyKey was reused for a different bot set.'), { code: 'FLEET_EMERGENCY_IDEMPOTENCY_CONFLICT' });
            return existing.promise;
        }
        if (this.transactions.size >= LIMIT) {
            const settledKey = [...this.transactions].find(([, entry]) => entry?.settledAt !== null)?.[0];
            if (settledKey) this.transactions.delete(settledKey);
            else throw Object.assign(new Error('Too many emergency-stop transactions are still in flight.'), { code: 'FLEET_EMERGENCY_TRANSACTION_LIMIT' });
        }
        const safeTimeoutMs = Math.max(250, Math.min(60000, Number(timeoutMs) || 15000));
        const entry = { fingerprint, createdAt: Date.now(), settledAt: null, promise: null };
        entry.promise = this.#run(ids, { source, idempotencyKey: key, timeoutMs: safeTimeoutMs }).finally(() => {
            entry.settledAt = Date.now();
            this.#trim();
        });
        this.transactions.set(key, entry);
        this.#trim();
        return entry.promise;
    }

    clear() {
        this.transactions.clear();
    }

    async #run(botIds, { source, idempotencyKey, timeoutMs }) {
        const snapshots = botIds.map(botId => {
            try {
                const runtime = this.requireRuntime(botId);
                return { botId, connectionGeneration: runtime.context?.getGeneration?.() ?? null, runtime, snapshotError: null };
            } catch (error) {
                return { botId, connectionGeneration: null, runtime: null, snapshotError: error };
            }
        });
        const revocations = await Promise.allSettled(snapshots.map(async snapshot => {
            if (snapshot.snapshotError) throw snapshot.snapshotError;
            const reconnectManager = snapshot.runtime.getService?.('reconnectManager');
            if (typeof reconnectManager?.suspend === 'function') reconnectManager.suspend(`Fleet emergency stop requested by ${source}.`);
            else reconnectManager?.cancelPending?.(`Fleet emergency stop requested by ${source}.`);
            return this.store.setIntent(snapshot.botId, { desiredConnection: 'DISCONNECTED', desiredMode: null, modeState: null, source });
        }));
        const settled = await Promise.allSettled(snapshots.map((snapshot, index) => Timeout.withTimeout(
            this.#stopBot(snapshot, revocations[index], source), timeoutMs,
            { message: `Emergency stop timed out for ${snapshot.botId}.` }
        )));
        const results = snapshots.map((snapshot, index) => {
            const entry = settled[index];
            if (entry.status === 'fulfilled') return entry.value;
            return {
                botId: snapshot.botId,
                connectionGeneration: snapshot.connectionGeneration,
                status: entry.reason?.code === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED',
                terminal: false,
                intentRevoked: revocations[index].status === 'fulfilled',
                code: entry.reason?.code || 'FLEET_EMERGENCY_STOP_FAILED',
                message: entry.reason?.message || 'Emergency stop failed.'
            };
        });
        for (const result of results) {
            if (result.terminal) continue;
            snapshots.find(snapshot => snapshot.botId === result.botId)?.runtime?.getService?.('runtimeFailurePublisher')?.publish?.({
                source: 'fleet', subsystem: 'fleet', severity: 'critical', code: result.code || 'FLEET_EMERGENCY_STOP_PARTIAL',
                operation: 'FleetEmergencyStop', step: 'verify-terminal', message: result.message,
                retryable: true, connectionGeneration: result.connectionGeneration,
                details: { transactionId: idempotencyKey, status: result.status }
            });
        }
        const terminalCount = results.filter(result => result.terminal).length;
        const outcome = terminalCount === results.length ? 'SUCCESS'
            : terminalCount === 0 && results.every(result => result.status === 'TIMEOUT') ? 'TIMEOUT'
                : terminalCount === 0 ? 'FAILED' : 'PARTIAL';
        return immutableClone({ contract: 'fleet-emergency-stop-v1', transactionId: idempotencyKey, source, outcome, botCount: results.length, terminalCount, results });
    }

    async #stopBot(snapshot, revocation, source) {
        if (snapshot.snapshotError) throw snapshot.snapshotError;
        const { runtime, botId, connectionGeneration } = snapshot;
        const intentRevoked = revocation.status === 'fulfilled';
        let reconcile = null;
        let cleanupError = null;
        if (intentRevoked) {
            reconcile = await this.reconcileBot(botId, { reason: `fleet-emergency:${source}`, priority: 'high', expectedRevision: revocation.value.revision });
        } else {
            try {
                await this.resetRuntime(runtime, 'Fleet emergency stop direct fallback.');
                await runtime.requireService('connectionManager').stop();
            } catch (error) { cleanupError = error; }
        }
        if (runtime.context?.has?.()) {
            try { await runtime.requireService('connectionManager').stop(); }
            catch (error) { cleanupError ||= error; }
        }
        const terminal = !runtime.context?.has?.();
        const success = terminal && !cleanupError && (reconcile?.success !== false || !intentRevoked);
        return {
            botId, connectionGeneration,
            status: success ? 'SUCCESS' : terminal ? 'PARTIAL' : 'FAILED',
            terminal, intentRevoked,
            code: cleanupError?.code || reconcile?.error?.code || (success ? null : 'FLEET_EMERGENCY_STOP_NOT_TERMINAL'),
            message: cleanupError?.message || reconcile?.message || (success ? 'Bot is disconnected and reconnect is suspended.' : 'Bot did not reach a verified terminal state.')
        };
    }

    #trim() {
        const now = Date.now();
        for (const [key, entry] of this.transactions) {
            if (entry?.settledAt !== null && now - entry.settledAt >= TTL_MS) this.transactions.delete(key);
        }
        while (this.transactions.size > LIMIT) {
            const settledKey = [...this.transactions].find(([, entry]) => entry?.settledAt !== null)?.[0];
            if (!settledKey) break;
            this.transactions.delete(settledKey);
        }
    }
}

module.exports = FleetEmergencyTransactionManager;
