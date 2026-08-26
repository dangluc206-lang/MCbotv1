'use strict';

class RuntimeTransactionJournal {
    static create() { return { nextSequence: 1, attempts: [] }; }

    static append(ledger, entry = {}) {
        if (!ledger || !Array.isArray(ledger.attempts)) return entry;
        const item = Object.freeze({ sequence: ledger.nextSequence++, ...entry });
        ledger.attempts.push(item);
        return item;
    }

    static snapshot(ledger) {
        return Object.freeze((ledger?.attempts || []).map(item => Object.freeze({ ...item })));
    }
}

module.exports = RuntimeTransactionJournal;
