'use strict';

class GuiDetector {
    constructor({ registry, windowMatcher = null, identityEngine = null }) {
        this.registry = registry;
        this.windowMatcher = windowMatcher;
        this.identityEngine = identityEngine;
    }

    detect(window, context = {}) {
        if (this.identityEngine) return this.identityEngine.identify(window, context);
        for (const [id, definition] of this.registry.entries()) {
            if (this.windowMatcher?.match(window, definition)) {
                return { id, candidateId: id, definition, confidence: 1, margin: 1, accepted: true, ambiguous: false, evidence: [] };
            }
        }
        return { id: null, candidateId: null, definition: null, confidence: 0, margin: 0, accepted: false, ambiguous: false, evidence: [] };
    }
}

module.exports = GuiDetector;
