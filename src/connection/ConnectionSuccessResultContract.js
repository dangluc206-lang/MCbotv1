'use strict';

const CONTRACT = 'connection-success-result-v1';

function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function create({
    client,
    connectionGeneration = null,
    attemptId = null,
    attemptEpoch = null,
    startedByInvocation = false,
    joinedExisting = false,
    joinedInFlight = false
}) {
    if (!client || (typeof client !== 'object' && typeof client !== 'function')) {
        throw new TypeError('Connection success result requires a client object');
    }
    const generation = positiveInteger(connectionGeneration);
    const epoch = positiveInteger(attemptEpoch);
    const id = typeof attemptId === 'string' && attemptId.trim() ? attemptId : null;
    const started = Boolean(startedByInvocation);
    const existing = Boolean(joinedExisting);
    const inFlight = Boolean(joinedInFlight);
    if (connectionGeneration != null && generation === null) {
        throw new TypeError('Connection success result generation must be a positive integer');
    }
    if (attemptEpoch != null && epoch === null) {
        throw new TypeError('Connection success result attemptEpoch must be a positive integer');
    }
    if (attemptId != null && id === null) {
        throw new TypeError('Connection success result attemptId must be a non-empty string');
    }
    if (started && (existing || inFlight)) {
        throw new TypeError('Invocation-started connection success cannot also be a joined result');
    }
    if ((started || inFlight) && (generation === null || epoch === null || id === null)) {
        throw new TypeError('Owned or joined in-flight connection success requires generation, attemptId and attemptEpoch');
    }
    return Object.freeze({
        contract: CONTRACT,
        client,
        connectionGeneration: generation,
        attemptId: id,
        attemptEpoch: epoch,
        startedByInvocation: started,
        joinedExisting: existing,
        joinedInFlight: inFlight
    });
}

function is(value) {
    if (!value || typeof value !== 'object' || value.contract !== CONTRACT) return false;
    if (!value.client || (typeof value.client !== 'object' && typeof value.client !== 'function')) return false;
    if (typeof value.startedByInvocation !== 'boolean'
        || typeof value.joinedExisting !== 'boolean'
        || typeof value.joinedInFlight !== 'boolean') return false;

    const generation = positiveInteger(value.connectionGeneration);
    const epoch = positiveInteger(value.attemptEpoch);
    const id = typeof value.attemptId === 'string' && value.attemptId.trim() ? value.attemptId : null;
    if (value.connectionGeneration != null && generation === null) return false;
    if (value.attemptEpoch != null && epoch === null) return false;
    if (value.attemptId != null && id === null) return false;
    if (value.startedByInvocation && (value.joinedExisting || value.joinedInFlight)) return false;
    if ((value.startedByInvocation || value.joinedInFlight)
        && (generation === null || epoch === null || id === null)) return false;
    return true;
}

module.exports = Object.freeze({ contract: CONTRACT, create, is });
