'use strict';

const Timeout = require('../../shared/time/Timeout');

class B5GenerationPreparer {
    constructor({ modeId, modeContext, island, skyblockReadiness = null, skyTarget = null, sharedStorageLease = null }) {
        Object.assign(this, { modeId, modeContext, island, skyblockReadiness, skyTarget, sharedStorageLease });
    }

    async prepare(generation, cancellationToken, { teleportHome = true, preparedGeneration = null, setPhase, onPrepared }) {
        if (this.sharedStorageLease?.status() && Number(preparedGeneration) !== Number(generation)) {
            this.sharedStorageLease.release('connection-generation-changed');
        }
        setPhase('WAITING_SKYBLOCK', 'skyblock');
        this.skyblockReadiness?.requireTarget?.(this.skyTarget, { owner: this.modeId, trigger: 'b5-prepare-generation' });
        if (this.skyblockReadiness?.isGenerationReady) {
            while (!this.skyblockReadiness.isGenerationReady(generation, this.skyTarget)) {
                cancellationToken.throwIfCancelled();
                if (!this.modeContext.connected() || this.modeContext.generation() !== generation) return false;
                await Timeout.delay(250, { cancellationToken });
            }
        }
        if (teleportHome) {
            setPhase('GOING_HOME', null);
            const home = await this.island.goHome({ cancellationToken, expectedGeneration: generation });
            if (home?.success === false) {
                const error = home.error || new Error(home.message || 'Không thể /is trước khi chế B5.');
                error.code ||= 'B5_CRAFT_HOME_FAILED';
                throw error;
            }
        }
        onPrepared(generation);
        return true;
    }
}

module.exports = B5GenerationPreparer;
