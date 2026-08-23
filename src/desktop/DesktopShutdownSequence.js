'use strict';

async function callStep(label, operation, reportFailure) {
    if (typeof operation !== 'function') return null;
    try {
        return await operation();
    } catch (error) {
        try { reportFailure?.(error, label); } catch (reportError) {
            console.error(`[MCbot desktop:${label}:report-failed]`, reportError?.stack || reportError);
        }
        return null;
    }
}

async function runDesktopShutdownSequence({
    cleanupSchedulers = null,
    persistWindowState = null,
    drainPreferences = null,
    stopController = null,
    reportFailure = null
} = {}) {
    const completed = [];
    await callStep('shutdown-scheduler-cleanup', cleanupSchedulers, reportFailure);
    completed.push('cleanup-schedulers');
    await callStep('shutdown-window-state-persist', persistWindowState, reportFailure);
    completed.push('persist-window-state');
    await callStep('shutdown-preference-drain', drainPreferences, reportFailure);
    completed.push('drain-preferences');
    await callStep('application-quit-stop', stopController, reportFailure);
    completed.push('stop-controller');
    return Object.freeze({ success: true, completed: Object.freeze(completed) });
}

module.exports = Object.freeze({ runDesktopShutdownSequence });
