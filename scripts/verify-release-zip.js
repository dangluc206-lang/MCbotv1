'use strict';

const path = require('node:path');
const yauzl = require('yauzl');
const contract = require('./release-zip-contract');

function listZipEntries(filePath) {
    return new Promise((resolve, reject) => {
        yauzl.open(path.resolve(filePath), { lazyEntries: true, autoClose: true }, (openError, zip) => {
            if (openError) return reject(openError);
            const names = [];
            zip.on('error', reject);
            zip.on('entry', entry => {
                names.push(entry.fileName);
                zip.readEntry();
            });
            zip.on('end', () => resolve(names));
            zip.readEntry();
        });
    });
}

async function verifyReleaseZip(filePath, options = {}) {
    const entries = await listZipEntries(filePath);
    const report = contract.validateEntryNames(entries, options);
    return Object.freeze({ ...report, artifact: path.basename(filePath) });
}

async function main(argv = process.argv.slice(2)) {
    const filePath = argv[0];
    if (!filePath) throw new Error('Usage: node scripts/verify-release-zip.js <zip-file>');
    const report = await verifyReleaseZip(filePath);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.valid ? 0 : 1;
    return report;
}

if (require.main === module) {
    main().catch(error => {
        console.error(error?.stack || error);
        process.exitCode = 1;
    });
}

module.exports = Object.freeze({ ...contract, listZipEntries, verifyReleaseZip, main });
