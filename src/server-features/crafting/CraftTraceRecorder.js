'use strict';

const B5TraceRecorder = require('./b5/trace/B5TraceRecorder');

// Generic crafting trace authority (slice 6).
//
// Same recorder, generic import path: records { traceId, productive, complete,
// plan, blockers, replayFixture/Envelopes, steps } for any target. B5TraceRecorder
// stays as the legacy alias (same instance, dual exposure) until the last
// renderer/IPC consumer migrates from `b5TraceRecorder` / `mcbot:b5:*`.
class CraftTraceRecorder extends B5TraceRecorder {
    recordResult(result, { mode = 'production', amount = 1, targetId = null } = {}) {
        return super.recordResult(result, { mode, amount, targetId });
    }
}

module.exports = CraftTraceRecorder;
