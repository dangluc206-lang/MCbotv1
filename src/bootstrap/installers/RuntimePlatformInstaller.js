'use strict';

class RuntimePlatformInstaller {
    constructor({ healthRegistry, context, modeRegistry, operationManager } = {}) {
        Object.assign(this, { healthRegistry, context, modeRegistry, operationManager });
        if (!healthRegistry?.register) throw new TypeError('RuntimePlatformInstaller healthRegistry is required.');
    }

    install() {
        this.healthRegistry.register('connection', () => this.context.has()
            ? { state:'HEALTHY' } : { state:'UNKNOWN', message:'Bot is disconnected.' });
        this.healthRegistry.register('mode-readiness', () => {
            const modes = this.modeRegistry.status().modes;
            const blocked = modes.filter(mode => !mode.readiness.ready);
            return blocked.length ? {
                state:'UNHEALTHY', message:'One or more registered modes are not ready.',
                details:{ blocked:blocked.map(mode => ({ modeId:mode.definition.id, missingCapabilities:mode.readiness.missingCapabilities, serviceBound:mode.readiness.serviceBound })) }
            } : { state:'HEALTHY' };
        }, { critical:true });
        this.healthRegistry.register('operations', () => {
            const snapshot = this.operationManager.snapshot();
            return snapshot.closed
                ? { state:'UNKNOWN', message:'Operation queue is closed.', details:snapshot }
                : { state:'HEALTHY', details:{ active:snapshot.active, pending:snapshot.pending, running:snapshot.running } };
        });
        return this.healthRegistry;
    }
}

module.exports = RuntimePlatformInstaller;
