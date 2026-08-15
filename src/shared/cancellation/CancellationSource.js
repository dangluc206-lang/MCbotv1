'use strict';
const CancellationToken = require('./CancellationToken');
class CancellationSource {
    constructor() { this.token = new CancellationToken(); this.disposed = false; }
    cancel(reason = 'Cancelled') { return this.disposed ? false : this.token._cancel(reason); }
    dispose() { if (this.disposed) return; this.disposed = true; this.token._dispose(); }
}
module.exports = CancellationSource;
