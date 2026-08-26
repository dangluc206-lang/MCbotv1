'use strict';

const { performance } = require('node:perf_hooks');
const OperatorSnapshotProjector = require('../src/desktop/projection/OperatorSnapshotProjector');

const COUNTS = Object.freeze([1, 8, 16, 32, 64]);
const SAMPLES = 120;
const LIMITS = Object.freeze({ p99Ms:50, maxBytesAt64:128 * 1024 });

function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]; }
function round(value) { return Math.round(value * 1000) / 1000; }
function snapshot(count, tick) {
    return {
        lifecycle:'RUNNING', updatedAt:new Date(1_700_000_000_000 + tick).toISOString(),
        system:{ startedAt:'2026-01-01T00:00:00.000Z', uptimeMs:tick, memoryMb:256 },
        bots:Array.from({ length:count }, (_, index) => ({
            botId:`perf-bot-${index + 1}`, profile:{ displayName:`Bot ${index + 1}`, enabled:true }, connectionGeneration:1,
            state:{ connectionState:'CONNECTED', lastError:null }, intent:{ desiredConnection:'CONNECTED', desiredMode:'b5-craft', modeState:'RUNNING' },
            modeOwner:{ modeId:'b5-craft' }, modes:{ byId:{ 'b5-craft':{ phase:'CRAFTING', paused:false, details:{ waitingReason:null } } }, b5Craft:{ details:{ batchId:`batch-${tick}`, protectionEpisode:{ state:'COMPLETED' }, recovery:{ safeState:'SAFE' } } } },
            operation:{ operations:[{ operationId:`op-${tick}`, operationName:'B5Automation', status:'RUNNING', ageMs:tick % 1000, metadata:{ step:'craft' } }] }
        }))
    };
}

function measureCount(count) {
    const projector = new OperatorSnapshotProjector({ now:() => 1_700_000_000_000 });
    for (let warm = 0; warm < 10; warm += 1) projector.project(snapshot(count, warm));
    const samples = [];
    let bytes = 0;
    for (let index = 0; index < SAMPLES; index += 1) {
        const started = performance.now();
        const projected = projector.project(snapshot(count, index + 100));
        samples.push(performance.now() - started);
        bytes = Math.max(bytes, Buffer.byteLength(JSON.stringify(projected)));
    }
    samples.sort((a,b) => a-b);
    return Object.freeze({ botCount:count, samples:SAMPLES, latencyMs:{ p50:round(percentile(samples,.5)), p95:round(percentile(samples,.95)), p99:round(percentile(samples,.99)), max:round(samples.at(-1)) }, maxPayloadBytes:bytes });
}

function measure() {
    const measurements = COUNTS.map(measureCount);
    const failures = measurements.flatMap(item => [
        ...(item.latencyMs.p99 > LIMITS.p99Ms ? [{ code:'OPERATOR_PROJECTION_P99', botCount:item.botCount, observed:item.latencyMs.p99, limit:LIMITS.p99Ms }] : []),
        ...(item.botCount === 64 && item.maxPayloadBytes > LIMITS.maxBytesAt64 ? [{ code:'OPERATOR_PAYLOAD_SIZE', botCount:item.botCount, observed:item.maxPayloadBytes, limit:LIMITS.maxBytesAt64 }] : [])
    ]);
    return Object.freeze({ contract:'operator-performance-benchmark-v1', status:failures.length ? 'FAIL' : 'PASS', workload:{ counts:COUNTS, samplesPerCount:SAMPLES, synthetic:true, network:false }, limits:LIMITS, measurements, failures, r6Decision:failures.length ? 'REVIEW_XP500' : 'NO_GO_MONOLITH_SUFFICIENT' });
}

function main() {
    const report = measure();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (process.argv.includes('--check')) process.exitCode = report.status === 'PASS' ? 0 : 1;
    return report;
}

if (require.main === module) main();
module.exports = Object.freeze({ COUNTS, SAMPLES, LIMITS, percentile, snapshot, measureCount, measure, main });
