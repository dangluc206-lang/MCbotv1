'use strict';

const crypto = require('node:crypto');

class RuntimeConfigVersionReader {
    constructor({ fsOps, metadataPath } = {}) { Object.assign(this, { fs:fsOps, metadataPath }); }
    async capture() {
        try {
            const raw = await this.fs.readFile(this.metadataPath);
            const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            return { existed:true, bytes, digest:crypto.createHash('sha256').update(bytes).digest('hex'), parsed:JSON.parse(bytes.toString('utf8')) };
        } catch (error) { if (error?.code === 'ENOENT') return { existed:false, bytes:null, digest:null, parsed:null }; throw error; }
    }
    async read() { return (await this.capture()).parsed; }
    async digest() { return (await this.capture()).digest; }
}

module.exports = RuntimeConfigVersionReader;
