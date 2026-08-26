'use strict';

const Redactor = require('../../shared/security/Redactor');

const CONTRACT = 'b5-operator-presentation-v1';
const STAGES = Object.freeze([
    Object.freeze({ id: 'FRESH_STORAGE', label: 'Đọc mới /kho' }),
    Object.freeze({ id: 'SMELT_RAW_IRON_GOLD', label: 'Nung sắt/vàng raw' }),
    Object.freeze({ id: 'COMPACT_B1', label: 'Nén mọi B1 có dạng khối' }),
    Object.freeze({ id: 'LOCK_SELL_BASELINE', label: 'Chốt baseline bán bất biến' }),
    Object.freeze({ id: 'SELL_64_ONLY', label: 'Bán surplus theo 64' }),
    Object.freeze({ id: 'VERIFY_RESERVE', label: 'Xác minh còn tối thiểu 1,5 B5' }),
    Object.freeze({ id: 'CRAFT_B5', label: 'Chế B5' })
]);

function classify(mode) {
    const details = mode?.details || {};
    const episode = details.protectionEpisode;
    if (details.recovery?.allowedActions?.includes('retry-storage-protection') && episode?.state === 'WAITING_BLOCKED') return 'NEEDS_ACTION';
    if (episode?.state === 'WAITING_BLOCKED') return 'WAITING_CONDITION';
    if (mode?.phase === 'WAITING_RETRY' || Number(episode?.nextEligibleAt) > Date.now()) return 'AUTO_RETRYING';
    if (mode?.enabled || ['RUNNING', 'PREPARING'].includes(mode?.phase)) return 'RUNNING';
    return 'IDLE';
}

function currentStage(mode) {
    const phase = String(mode?.phase || '').toUpperCase();
    const episode = mode?.details?.protectionEpisode || {};
    const blocker = episode.blocker || {};
    const step = String(blocker.step || episode.lastProgress?.step || '').toUpperCase();
    const signal = `${step} ${String(blocker.code || '')} ${String(blocker.reason || '')}`.toUpperCase();
    if (/CRAFT|B5_COMPLETED/.test(phase)) return 'CRAFT_B5';
    if (/RESERVE|VERIFY/.test(signal)) return 'VERIFY_RESERVE';
    if (/BASELINE[-_ ]?(PREFLIGHT|PLAN)/.test(signal)) return 'LOCK_SELL_BASELINE';
    if (/SELL/.test(signal)) return 'SELL_64_ONLY';
    if (/BASELINE/.test(signal)) return 'LOCK_SELL_BASELINE';
    if (/COMPACT|CONVERT/.test(step)) return 'COMPACT_B1';
    if (/SMELT|NUNG/.test(step)) return 'SMELT_RAW_IRON_GOLD';
    return 'FRESH_STORAGE';
}

function projectBot(bot = {}, { now = Date.now() } = {}) {
    const mode = bot.modes?.b5Craft || null;
    const details = mode?.details || {};
    const episode = details.protectionEpisode || null;
    const progress = episode?.lastProgress || {};
    const stageId = currentStage(mode);
    const stageIndex = STAGES.findIndex(stage => stage.id === stageId);
    const status = classify(mode);
    const remainingStacks = Number(progress.remainingSellStacks ?? episode?.remainingSellStacks);
    const retained = Number(progress.retainedRemainderItems ?? episode?.retainedRemainderItems);
    const baseline = progress.sellBaselineDigest || episode?.baselineDigest || null;
    const lastVerified = details.pendingB5CompletionProvenance?.verifiedAt
        ? { kind: 'B5_COMPLETION', at: details.pendingB5CompletionProvenance.verifiedAt }
        : details.batchProtectionCompleted
            ? { kind: 'STORAGE_PROTECTION', at: episode?.completedAt || null }
            : null;
    const allowedActions = (details.recovery?.allowedActions || []).filter(action => action !== 'retry-storage-protection' || status === 'NEEDS_ACTION');
    return Object.freeze(Redactor.sanitize({
        contract: CONTRACT,
        botId: bot.botId || null,
        connectionGeneration: bot.connectionGeneration ?? null,
        campaignId: details.campaignId || null,
        batchId: details.batchId || null,
        status,
        safeState: details.recovery?.safeState || (details.batchProtectionCompleted ? 'PROTECTED' : 'CRAFT_NOT_STARTED'),
        currentStage: stageId,
        stages: STAGES.map((stage, index) => ({ ...stage, state: index < stageIndex ? 'VERIFIED' : index === stageIndex ? 'ACTIVE' : 'PENDING' })),
        reserve: {
            requiredCoverage: 1.5,
            verifiedCoverage: progress.verifiedCoverage ?? null,
            pendingFamilies: Array.isArray(progress.reserveShortages)
                ? progress.reserveShortages.map(entry => ({
                    baseId: entry?.baseId || null,
                    coverage: Number.isFinite(Number(entry?.coverage)) ? Number(entry.coverage) : null,
                    missingBaseUnits: Number.isFinite(Number(entry?.missingBaseUnits)) ? Number(entry.missingBaseUnits) : null
                }))
                : [],
            unit: 'B5'
        },
        sell: {
            immutableBaselineDigest: baseline,
            quantityPerAction: 64,
            remainingStacks: Number.isFinite(remainingStacks) ? Math.max(0, Math.floor(remainingStacks)) : null,
            retainedRemainderItems: Number.isFinite(retained) ? Math.max(0, Math.floor(retained)) : null
        },
        lastVerifiedPostcondition: lastVerified,
        recovery: {
            allowedActions,
            episodeId: episode?.episodeId || null,
            incidentId: episode?.correlationId || null,
            attempts: episode?.attemptsStarted ?? null,
            backoffMs: episode?.blocker?.backoffMs ?? null,
            nextEligibleAt: episode?.blocker?.nextEligibleAt || episode?.nextEligibleAt || null
        },
        links: {
            incident: episode?.correlationId ? `incidents:${episode.correlationId}` : null,
            replay: details.b5Automation?.trace?.replay?.digest ? `replay:${details.b5Automation.trace.replay.digest}` : null
        },
        eta: null,
        etaLabel: 'Chưa đủ dữ liệu',
        projectedAt: new Date(now).toISOString()
    }));
}

module.exports = Object.freeze({ CONTRACT, STAGES, classify, currentStage, projectBot });
