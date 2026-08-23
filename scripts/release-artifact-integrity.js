'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const CONTRACT = 'release-artifact-integrity';
const VERSION = 1;

async function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

async function buildIntegrityManifest(filePath, { metadata = null } = {}) {
    const absolute = path.resolve(filePath);
    const stat = await fsp.stat(absolute);
    if (!stat.isFile()) throw new TypeError('Integrity target must be a regular file.');
    const sha256 = await sha256File(absolute);
    return Object.freeze({
        contract: CONTRACT,
        version: VERSION,
        algorithm: 'sha256',
        artifact: path.basename(absolute),
        bytes: stat.size,
        sha256,
        metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? Object.freeze({ ...metadata }) : null
    });
}

async function writeIntegrityFiles(filePath, options = {}) {
    const absolute = path.resolve(filePath);
    const manifest = await buildIntegrityManifest(absolute, options);
    const shaPath = `${absolute}.sha256`;
    const manifestPath = `${absolute}.manifest.json`;
    await fsp.writeFile(shaPath, `${manifest.sha256}  ${manifest.artifact}\n`, 'utf8');
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return Object.freeze({ manifest, shaPath, manifestPath });
}

async function main(argv = process.argv.slice(2)) {
    const filePath = argv[0];
    if (!filePath) throw new Error('Usage: node scripts/release-artifact-integrity.js <artifact-file>');
    const result = await writeIntegrityFiles(filePath);
    console.log(JSON.stringify(result.manifest, null, 2));
    return result;
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = Object.freeze({ CONTRACT, VERSION, sha256File, buildIntegrityManifest, writeIntegrityFiles, main });
