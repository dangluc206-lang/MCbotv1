'use strict';

class GuiDiagnostics {
    constructor({ guiManager }) { this.guiManager = guiManager; }
    snapshot() {
        const session = this.guiManager.current();
        if (!session) return { active: false };
        return {
            active: session.active,
            id: session.id,
            definitionId: session.definitionId,
            identity: session.identity ? {
                id: session.identity.id || null,
                candidateId: session.identity.candidateId || null,
                confidence: session.identity.confidence ?? 0,
                margin: session.identity.margin ?? 0,
                ambiguous: session.identity.ambiguous === true,
                reason: session.identity.reason || null,
                evidence: session.identity.evidence || []
            } : null,
            title: session.window?.title,
            slotCount: session.window?.slots?.length || 0
        };
    }
}

module.exports = GuiDiagnostics;
