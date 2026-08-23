'use strict';

const DecisionReplayEnvelope = require('../../shared/contracts/DecisionReplayEnvelope');

class B5PlannerReplay {
    constructor({ planner }) {
        if (!planner || typeof planner.compile !== 'function') throw new TypeError('B5 execution planner is required.');
        this.planner = planner;
    }

    replay(fixture) {
        if (fixture?.contract === DecisionReplayEnvelope.CONTRACT) fixture = DecisionReplayEnvelope.toLegacyB5Fixture(fixture);
        if (!fixture || fixture.version !== 1 || !fixture.inspection) throw new TypeError('B5 replay fixture v1 is required.');
        const plan = this.planner.compile(fixture.inspection);
        const expected = fixture.expected || {};
        const mismatches = [];
        if (expected.decisionKind !== undefined && expected.decisionKind !== plan.decision?.kind) {
            mismatches.push(`decisionKind expected ${expected.decisionKind}, got ${plan.decision?.kind || null}`);
        }
        if (expected.decisionResource !== undefined && expected.decisionResource !== plan.decision?.resource) {
            mismatches.push(`decisionResource expected ${expected.decisionResource}, got ${plan.decision?.resource || null}`);
        }
        if (Array.isArray(expected.blockers)) {
            const actual = plan.blockers.map(entry => `${entry.reason}:${entry.resource || ''}`).sort();
            const wanted = expected.blockers.map(entry => typeof entry === 'string' ? entry : `${entry.reason}:${entry.resource || ''}`).sort();
            if (JSON.stringify(actual) !== JSON.stringify(wanted)) mismatches.push(`blockers expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
        }
        return Object.freeze({ success: mismatches.length === 0, mismatches: Object.freeze(mismatches), plan });
    }
}

module.exports = B5PlannerReplay;
