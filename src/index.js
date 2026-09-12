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
        const connected = states.filter(state => state.connectionState === 'CONNECTED').length;
        const failedStarts = startResults.filter(result => result.status === 'rejected').length;
        const failedInitializations = initializeResults.filter(result => result.status === 'rejected').length;

        // Bots start DISCONNECTED by design; the operator connects them
        // explicitly from the GUI/Discord, so connected count is informational.
        logger.info('MCbot application is running.', {
            runtimes: runtimes.length,
            connected,
            failedInitializations,
            failedStarts
        });

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
