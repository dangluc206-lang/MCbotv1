'use strict';

const { performance } = require('node:perf_hooks');

const CONTRACT = 'mcbot-runtime-workload-metrics/v1';

class RuntimeWorkloadMetrics {
    constructor({ maxSamplesPerOperation = 2048, clock = () => performance.now() } = {}) {
        this.maxSamplesPerOperation = Math.max(32, Number(maxSamplesPerOperation) || 2048);
        this.clock = clock;
        this.operations = new Map();
    }

    start(operation, { source = 'live' } = {}) {
        const name = String(operation || '').trim();
        if (!name) throw new TypeError('Runtime workload operation is required.');
        const startedAt = this.clock();
        const counters = {};
        let finished = false;
        return Object.freeze({
            increment(key, amount = 1) {
                if (finished) return;
                const metric = String(key || '').trim();
                if (!/^[a-z][a-z0-9]*$/i.test(metric)) throw new TypeError('Metric counter name is invalid.');
                counters[metric] = Number(counters[metric] || 0) + Math.max(0, Number(amount) || 0);
            },
            finish: outcome => {
                if (finished) return null;
                finished = true;
                return this.record(name, this.clock() - startedAt, counters, { source, outcome });
            }
        });
    }

    async measure(operation, action, options = {}) {
        const tracker = this.start(operation, options);
        try {
            const value = await action(tracker);
            tracker.finish(value?.success === false ? 'FAILED' : 'SUCCESS');
            return value;
        } catch (error) {
            tracker.finish(error?.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED');
            throw error;
        }
    }

    record(operation, durationMs, counters = {}, { source = 'live', outcome = 'SUCCESS' } = {}) {
        const name = String(operation || '').trim();
        const duration = Math.max(0, Number(durationMs) || 0);
        const state = this.operations.get(name) || { samples: [], counters: {}, outcomes: {}, sourceCounts: {} };
        state.samples.push(duration);
        if (state.samples.length > this.maxSamplesPerOperation) state.samples.splice(0, state.samples.length - this.maxSamplesPerOperation);
        for (const [key, value] of Object.entries(counters || {})) state.counters[key] = Number(state.counters[key] || 0) + Math.max(0, Number(value) || 0);
        state.outcomes[outcome] = Number(state.outcomes[outcome] || 0) + 1;
        state.sourceCounts[source] = Number(state.sourceCounts[source] || 0) + 1;
        this.operations.set(name, state);
        return this.#operationSummary(name, state);
    }

    snapshot() {
        return Object.freeze({
            contract: CONTRACT,
            generatedAt: new Date().toISOString(),
            operations: Object.freeze(Object.fromEntries([...this.operations.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, state]) => [name, this.#operationSummary(name, state)])))
        });
    }

    #operationSummary(name, state) {
        const samples = [...state.samples].sort((left, right) => left - right);
        return Object.freeze({
            operation: name,
            sampleCount: samples.length,
            durationMs: Object.freeze({
                min: samples[0] ?? null,
                p50: percentile(samples, 0.50),
                p95: percentile(samples, 0.95),
                p99: percentile(samples, 0.99),
                max: samples.at(-1) ?? null
            }),
            counters: Object.freeze({ ...state.counters }),
            outcomes: Object.freeze({ ...state.outcomes }),
            sources: Object.freeze({ ...state.sourceCounts })
        });
    }
}

function percentile(sorted, ratio) {
    if (sorted.length === 0) return null;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
}

module.exports = Object.freeze({ CONTRACT, RuntimeWorkloadMetrics, percentile });
