'use strict';

const Timeout = require('../shared/time/Timeout');

function registerShutdown(application, { logger = null, timeoutMs = 10000 } = {}) {
    let promise = null;

    const shutdown = reason => {
        if (promise) return promise;

        promise = (async () => {
            logger?.info?.('Application shutdown requested.', { reason });
            try {
                await Timeout.withTimeout(
                    application.destroy(),
                    timeoutMs,
                    { message: `Application shutdown exceeded ${timeoutMs} ms.` }
                );
                logger?.info?.('Application shutdown completed.', { reason });
            } catch (error) {
                logger?.error?.('Application shutdown failed.', { reason, error });
                process.exitCode = 1;
                throw error;
            }
        })();

        return promise;
    };

    const onSignal = signal => {
        shutdown(signal).catch(error => logger?.debug?.('Shutdown rejection already recorded.', { reason: signal, error }));
    };
    const onFatal = (type, error) => {
        logger?.error?.(`Unhandled process failure: ${type}.`, { error });
        process.exitCode = 1;
        shutdown(type).catch(shutdownError => logger?.debug?.('Fatal shutdown rejection already recorded.', { reason: type, error: shutdownError }));
    };

    const sigint = () => onSignal('SIGINT');
    const sigterm = () => onSignal('SIGTERM');
    const uncaughtException = error => onFatal('uncaughtException', error);
    const unhandledRejection = reason => onFatal(
        'unhandledRejection',
        reason instanceof Error ? reason : new Error(String(reason))
    );

    process.once('SIGINT', sigint);
    process.once('SIGTERM', sigterm);
    process.once('uncaughtException', uncaughtException);
    process.once('unhandledRejection', unhandledRejection);

    return {
        shutdown,
        dispose() {
            process.off('SIGINT', sigint);
            process.off('SIGTERM', sigterm);
            process.off('uncaughtException', uncaughtException);
            process.off('unhandledRejection', unhandledRejection);
        }
    };
}

module.exports = registerShutdown;
