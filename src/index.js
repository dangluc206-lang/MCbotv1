'use strict';

const createApplication = require('./bootstrap/createApplication');
const registerShutdown = require('./bootstrap/shutdown');
const loadRuntimeEnvironment = require('./bootstrap/RuntimeEnvironment');

async function main() {
    const baseDir = process.cwd();
    const { application, configuration, shared, profiles } = await createApplication({
        baseDir,
        environment: loadRuntimeEnvironment({ baseDir })
    });
    const logger = shared.loggerFactory.create('Main');
    const appConfig = configuration.registry.require('app');
    const shutdown = registerShutdown(application, {
        logger,
        timeoutMs: appConfig.shutdownTimeoutMs
    });

    try {
        const initializeResults = await application.initialize();
        const startResults = await application.start();
        const runtimes = application.listRuntimes();
        const states = runtimes.map(runtime => runtime.getState());
        const enabled = profiles.filter(profile => profile.enabled).length;
        const connected = states.filter(state => state.connectionState === 'CONNECTED').length;
        const reconnecting = states.filter(state => state.connectionState === 'RECONNECTING').length;
        const failedStarts = startResults.filter(result => result.status === 'rejected').length;
        const failedInitializations = initializeResults.filter(result => result.status === 'rejected').length;

        logger.info('MCbot application is running.', {
            runtimes: runtimes.length,
            enabled,
            connected,
            reconnecting,
            failedInitializations,
            failedStarts
        });

        if (enabled > connected) {
            logger.warn('Some enabled bots are not connected yet.', {
                enabled,
                connected,
                reconnecting,
                states: runtimes.map(runtime => ({
                    botId: runtime.botId,
                    ...runtime.getState()
                }))
            });
        }

        return { application, shutdown };
    } catch (error) {
        logger.error('MCbot bootstrap failed.', { error });
        await shutdown.shutdown('bootstrap-error');
        process.exitCode = 1;
        throw error;
    }
}

if (require.main === module) {
    main().catch(error => {
        // main() already records the structured bootstrap failure; stderr is the
        // last-resort channel if logger teardown also failed.
        process.stderr.write(`MCbot fatal bootstrap failure: ${error?.message || error}\n`);
    });
}

module.exports = { main };
