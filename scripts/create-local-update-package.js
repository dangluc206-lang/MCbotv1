'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeIntegrityFiles } = require('./release-artifact-integrity');
const { verifyReleaseZip } = require('./verify-release-zip');
const { forbiddenReason } = require('./release-zip-contract');

const baseDir = path.resolve(__dirname, '..');
const pkg = require(path.join(baseDir, 'package.json'));
const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const fromVersion = getArg('--from');
const output = path.resolve(getArg('--out', path.join(baseDir, 'out', `MCbot_${pkg.version}_update.zip`)));
const type = getArg('--type', fromVersion ? 'patch' : 'full');
if (!['patch', 'full'].includes(type)) throw new Error('--type phải là patch hoặc full.');
if (type === 'patch' && !fromVersion) throw new Error('Patch cần --from <version>.');
if (process.platform !== 'win32') throw new Error('Script tạo ZIP hiện dùng .NET ZipFile qua PowerShell và chỉ chạy trên Windows.');

function included(relative) {
    const rp = relative.replace(/\\/g, '/');
    // Packaging and post-build verification must share one fail-closed policy.
    // In particular `.env.example` is required release documentation while
    // real `.env` / `.env.*` files remain forbidden by the contract.
    return forbiddenReason(rp) === null;
}

async function copyTree(stage) {
    const files = [];
    async function walk(dir) {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const absolute = path.join(dir, entry.name);
            const relative = path.relative(baseDir, absolute).replace(/\\/g, '/');
            if (!included(relative)) continue;
            if (entry.isDirectory()) await walk(absolute);
            else if (entry.isFile()) {
                const dest = path.join(stage, ...relative.split('/'));
                await fsp.mkdir(path.dirname(dest), { recursive: true });
                await fsp.copyFile(absolute, dest);
                files.push(relative);
            }
        }
    }
    await walk(baseDir);
    return files;
}

(async () => {
    const stage = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-update-package-'));
    try {
        const files = await copyTree(stage);
        const manifest = {
            schemaVersion: 1,
            product: 'mcbot-desktop',
            version: pkg.version,
            type,
            ...(fromVersion ? { fromVersion } : {}),
            dependenciesChanged: false,
            notes: [
                `MCbot Desktop ${pkg.version}`,
                'Cập nhật code/default bằng ZIP; giữ nguyên cấu hình và dữ liệu người dùng.'
            ],
            delete: ['out']
        };
        await fsp.writeFile(path.join(stage, 'mcbot-update.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        await fsp.mkdir(path.dirname(output), { recursive: true });
        await fsp.rm(output, { force: true });
        const escapedStage = stage.replace(/'/g, "''");
        const escapedOutput = output.replace(/'/g, "''");
        // Use the .NET ZIP API directly instead of the optional
        // Microsoft.PowerShell.Archive module. Some Windows installations can
        // launch PowerShell but cannot autoload Compress-Archive.
        const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${escapedStage}', '${escapedOutput}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`;
        const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'inherit' });
        if (result.status !== 0 || !fs.existsSync(output)) throw new Error('Không tạo được ZIP cập nhật.');
        const verification = await verifyReleaseZip(output);
        if (!verification.valid) {
            const summary = verification.failures.map(item => `${item.code}:${item.entry}`).join(', ');
            throw new Error(`ZIP cập nhật không đạt release contract: ${summary}`);
        }
        const integrity = await writeIntegrityFiles(output, {
            metadata: { product: 'mcbot-desktop', version: pkg.version, type, fromVersion: fromVersion || null }
        });
        console.log(`[UPDATE ZIP] ${output}`);
        console.log(`[UPDATE ZIP] ${files.length} file + mcbot-update.json`);
        console.log(`[UPDATE VERIFY] PASS (${verification.fileCount} file)`);
        console.log(`[UPDATE SHA256] ${integrity.manifest.sha256}`);
        console.log(`[UPDATE MANIFEST] ${integrity.manifestPath}`);
    } finally {
        try {
            await fsp.rm(stage, { recursive: true, force: true });
        } catch (error) {
            console.warn('[UPDATE ZIP CLEANUP WARNING]', error?.stack || error);
        }
    }
})().catch(error => {
    console.error('[UPDATE ZIP ERROR]', error?.stack || error);
    process.exitCode = 1;
});
