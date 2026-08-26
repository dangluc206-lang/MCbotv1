'use strict';

const path = require('node:path');
const crypto = require('node:crypto');

class RuntimeConfigTreeVerifier {
    constructor({ fsOps, existsSync } = {}) { Object.assign(this, { fs:fsOps, existsSync }); }
    async digest(root) {
        if (!root || !this.existsSync(root)) throw new Error('Runtime config tree is missing.');
        const rows = [];
        const walk = async (directory, relative = '') => {
            const entries = await this.fs.readdir(directory, { withFileTypes:true });
            entries.sort((a,b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                const absolute = path.join(directory, entry.name);
                const rel = path.posix.join(relative.replace(/\\/g, '/'), entry.name);
                if (entry.isSymbolicLink?.()) throw Object.assign(new Error('Runtime config verification rejects symlinks.'), { code:'RUNTIME_CONFIG_SYMLINK' });
                if (entry.isDirectory()) { rows.push(`D:${rel}`); await walk(absolute, rel); }
                else if (entry.isFile()) { const content = await this.fs.readFile(absolute); rows.push(`F:${rel}:${content.length}:${crypto.createHash('sha256').update(content).digest('hex')}`); }
            }
        };
        await walk(root);
        return crypto.createHash('sha256').update(rows.join('\n')).digest('hex');
    }
    async verify(root, expectedDigest) {
        if (!root || !expectedDigest || !this.existsSync(root)) throw new Error('Runtime config transaction backup is missing or has no expected digest.');
        const actual = await this.digest(root);
        if (actual !== expectedDigest) throw new Error('Runtime config transaction backup verification failed.');
        return actual;
    }
}

module.exports = RuntimeConfigTreeVerifier;
