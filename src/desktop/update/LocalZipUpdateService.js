'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { compareVersions, normalizeVersion } = require('./Version');

const MANIFEST_NAME = 'mcbot-update.json';
const MAX_ZIP_BYTES = 650 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 900 * 1024 * 1024;
const MAX_ENTRY_BYTES = 350 * 1024 * 1024;
const MAX_FILES = 12000;

const DENIED_ROOTS = Object.freeze([
    'node_modules',
    'coverage',
    'out',
    '.tmp',
    'data/logs',
    'data/runtime',
    'data/snapshots',
    'data/backups',
    'data/support',
    'config/modes/custom'
]);

function safeRelative(value) {
    const raw = String(value || '').replace(/\\/g, '/');
    if (!raw || raw.includes('\0') || raw.startsWith('/') || /^[a-z]:/i.test(raw)) return null;
    const normalized = path.posix.normalize(raw);
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
    if (normalized.split('/').includes('..')) return null;
    return normalized.replace(/^\.\/+/, '');
}

function deniedEntry(relative) {
    if (path.posix.basename(relative).startsWith('.env')) return true;
    return DENIED_ROOTS.some(root => relative === root || relative.startsWith(`${root}/`));
}

function allowedGeneratedDelete(relative) {
    return relative === 'out';
}

function deniedDeleteEntry(relative) {
    return !allowedGeneratedDelete(relative);
}

function normalizedUniquePaths(values, { code, errorFactory, kind }) {
    const seen = new Set();
    const normalized = [];
    for (const value of values || []) {
        const safe = safeRelative(value);
        if (!safe) throw errorFactory(code, `${kind} chứa đường dẫn không an toàn: ${value}`);
        if (seen.has(safe)) throw errorFactory(code, `${kind} chứa đường dẫn trùng lặp: ${value}`);
        seen.add(safe);
        normalized.push(safe);
    }
    return normalized;
}


function stableObject(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(Object.keys(input).sort().map(key => [key, input[key]]));
}

function plainManifest(manifest) {
    return {
        schemaVersion: manifest.schemaVersion,
        product: manifest.product,
        version: manifest.version,
        type: manifest.type,
        fromVersion: manifest.fromVersion || null,
        minimumVersion: manifest.minimumVersion || null,
        dependenciesChanged: manifest.dependenciesChanged === true,
        notes: Array.isArray(manifest.notes) ? manifest.notes.slice(0, 30) : [],
        delete: Array.isArray(manifest.delete) ? manifest.delete.slice(0, 200) : []
    };
}

class LocalZipUpdateService {
    constructor({
        currentVersion,
        applicationRoot,
        userDataRoot,
        extractor = null,
        zipScanner = null,
        logger = null,
        removePath = fsp.rm
    } = {}) {
        const version = normalizeVersion(currentVersion);
        if (!version) throw new TypeError('LocalZipUpdateService currentVersion is invalid.');
        if (!applicationRoot || !userDataRoot) throw new TypeError('LocalZipUpdateService applicationRoot and userDataRoot are required.');
        this.currentVersion = version;
        this.applicationRoot = path.resolve(applicationRoot);
        this.userDataRoot = path.resolve(userDataRoot);
        this.extractor = extractor;
        this.zipScanner = zipScanner;
        this.logger = logger;
        if (typeof removePath !== 'function') throw new TypeError('LocalZipUpdateService removePath must be a function.');
        this.removePath = removePath;
        this.selected = null;
        this.inspectInFlight = false;
        this.installPrepareInFlight = false;
        this.preparedInstall = null;
        this.phase = 'IDLE';
        this.lastError = null;
    }

    status() {
        return {
            phase: this.phase,
            currentVersion: this.currentVersion,
            selected: this.selected ? {
                fileName: path.basename(this.selected.zipPath),
                version: this.selected.manifest.version,
                type: this.selected.manifest.type,
                fromVersion: this.selected.manifest.fromVersion || null,
                minimumVersion: this.selected.manifest.minimumVersion || null,
                notes: this.selected.manifest.notes || [],
                fileCount: this.selected.files.length,
                compressedBytes: this.selected.compressedBytes,
                uncompressedBytes: this.selected.uncompressedBytes,
                stagedAt: this.selected.stagedAt
            } : null,
            lastError: this.lastError
        };
    }

    async inspect(zipPath) {
        if (this.inspectInFlight) throw this.#error('LOCAL_UPDATE_INSPECT_BUSY', 'Đang kiểm tra một gói cập nhật ZIP khác.');
        if (this.installPrepareInFlight || this.phase === 'INSTALL_PENDING') throw this.#error('LOCAL_UPDATE_INSTALL_BUSY', 'Transaction cập nhật ZIP đang được chuẩn bị hoặc đã handoff.');
        this.inspectInFlight = true;
        try {
            this.phase = 'INSPECTING';
            this.lastError = null;
            await this.#clearSelected();
            const absolute = path.resolve(String(zipPath || ''));
            if (path.extname(absolute).toLowerCase() !== '.zip') throw this.#error('LOCAL_UPDATE_NOT_ZIP', 'Chỉ chấp nhận file cập nhật .zip.');
            const stat = await fsp.stat(absolute);
            if (!stat.isFile()) throw this.#error('LOCAL_UPDATE_NOT_FILE', 'File cập nhật không hợp lệ.');
            if (stat.size <= 0 || stat.size > MAX_ZIP_BYTES) throw this.#error('LOCAL_UPDATE_ZIP_SIZE', 'File ZIP cập nhật vượt giới hạn an toàn.');

            const scan = await this.#scanZip(absolute);
            const stageRoot = path.join(
                this.userDataRoot,
                'updates',
                'local',
                'staging',
                `${Date.now()}-${crypto.randomUUID()}`
            );
            await fsp.mkdir(stageRoot, { recursive: true });
            try {
                await this.#extract(absolute, stageRoot);
                const manifest = await this.#readManifest(stageRoot);
                await this.#validateManifest(manifest, stageRoot);
                const files = scan.entries
                    .filter(entry => !entry.directory && entry.relative !== MANIFEST_NAME)
                    .map(entry => entry.relative);
                const fileIntegrity = [];
                for (const relative of files) fileIntegrity.push(await this.#stageFileIntegrity(stageRoot, relative));
                this.selected = {
                    zipPath: absolute,
                    stageRoot,
                    manifest: plainManifest(manifest),
                    files,
                    fileIntegrity,
                    compressedBytes: stat.size,
                    uncompressedBytes: scan.uncompressedBytes,
                    stagedAt: new Date().toISOString()
                };
                this.phase = 'READY';
                return this.status();
            } catch (error) {
                await this.#cleanupPath(stageRoot, { recursive: true, force: true }, 'inspect-failure');
                throw error;
            }
        } catch (error) {
            this.phase = 'ERROR';
            this.lastError = { code: error?.code || null, message: error?.message || String(error) };
            throw error;
        } finally {
            this.inspectInFlight = false;
        }
    }

    async cancelPreparedInstall(planPath = null) {
        const prepared = this.preparedInstall;
        if (!prepared || this.phase !== 'INSTALL_PENDING') {
            throw this.#error('LOCAL_UPDATE_INSTALL_NOT_PENDING', 'Không có transaction cập nhật ZIP đang chờ helper launch.');
        }
        if (planPath && path.resolve(planPath) !== path.resolve(prepared.planPath)) {
            throw this.#error('LOCAL_UPDATE_INSTALL_PLAN_MISMATCH', 'Prepared install plan không thuộc transaction hiện tại.');
        }
        this.preparedInstall = null;
        this.phase = this.selected ? 'READY' : 'IDLE';
        await this.#cleanupPath(prepared.planPath, { force: true }, 'cancel-prepared-plan');
        await this.#cleanupPath(prepared.backupRoot, { recursive: true, force: true }, 'cancel-prepared-backup');
        return this.status();
    }

    async #clearSelected() {
        const previous = this.selected;
        this.selected = null;
        if (previous?.stageRoot) await this.#cleanupPath(previous.stageRoot, { recursive: true, force: true }, 'clear-staging');
    }

    async clear() {
        if (this.inspectInFlight) throw this.#error('LOCAL_UPDATE_INSPECT_BUSY', 'Đang kiểm tra một gói cập nhật ZIP khác.');
        if (this.installPrepareInFlight || this.phase === 'INSTALL_PENDING') throw this.#error('LOCAL_UPDATE_INSTALL_BUSY', 'Transaction cập nhật ZIP đang được chuẩn bị hoặc đã handoff.');
        await this.#clearSelected();
        this.phase = 'IDLE';
        return this.status();
    }

    async prepareInstall({
        parentPid = process.pid,
        restartExe = process.execPath,
        restartArgs = [],
        configBackup = null
    } = {}) {
        if (this.installPrepareInFlight) throw this.#error('LOCAL_UPDATE_INSTALL_BUSY', 'Đang chuẩn bị một transaction cập nhật ZIP khác.');
        if (!this.selected || this.phase !== 'READY') throw this.#error('LOCAL_UPDATE_NOT_READY', 'Chưa chọn gói ZIP cập nhật hợp lệ.');
        this.installPrepareInFlight = true;
        const manifest = this.selected.manifest;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        try {
            const backupRoot = path.join(
            this.userDataRoot,
            'update-backups',
            `${stamp}-${this.currentVersion}-to-${manifest.version}`
        );
        const plansDir = path.join(this.userDataRoot, 'updates', 'local', 'plans');
        const resultFile = path.join(this.userDataRoot, 'updates', 'local', 'last-result.json');
        await fsp.mkdir(plansDir, { recursive: true });
        await fsp.mkdir(backupRoot, { recursive: true });

        const plan = {
            schemaVersion: 2,
            mode: 'apply',
            product: 'mcbot-desktop',
            fromVersion: this.currentVersion,
            toVersion: manifest.version,
            createdAt: new Date().toISOString(),
            parentPid: Number(parentPid) || 0,
            stageRoot: this.selected.stageRoot,
            targetRoot: this.applicationRoot,
            backupRoot,
            resultFile,
            files: [...this.selected.files],
            fileIntegrity: this.selected.fileIntegrity.map(entry => ({ ...entry })),
            delete: [...(manifest.delete || [])],
            restartExe: restartExe ? path.resolve(restartExe) : null,
            restartArgs: Array.isArray(restartArgs) ? restartArgs.map(value => String(value)) : [],
            configBackup: configBackup || null
        };
        plan.files = normalizedUniquePaths(plan.files, {
            code: 'LOCAL_UPDATE_UNSAFE_PLAN',
            errorFactory: (code, message) => this.#error(code, message),
            kind: 'Gói cập nhật'
        });
        plan.delete = normalizedUniquePaths(plan.delete, {
            code: 'LOCAL_UPDATE_DELETE_PATH',
            errorFactory: (code, message) => this.#error(code, message),
            kind: 'Manifest delete'
        });
        for (const relative of plan.files) {
            if (deniedEntry(relative)) throw this.#error('LOCAL_UPDATE_UNSAFE_PLAN', `Gói cập nhật chứa đường dẫn bị cấm: ${relative}`);
        }
        for (const relative of plan.delete) {
            if (deniedDeleteEntry(relative)) throw this.#error('LOCAL_UPDATE_DELETE_PATH', `Gói cập nhật yêu cầu xóa đường dẫn không nằm trong allowlist: ${relative}`);
        }
        const deleteSet = new Set(plan.delete);
        for (const relative of plan.files) {
            if (deleteSet.has(relative) || plan.delete.some(deleted => relative.startsWith(`${deleted}/`))) {
                throw this.#error('LOCAL_UPDATE_PLAN_OVERLAP', `Gói cập nhật vừa ghi vừa yêu cầu xóa cùng vùng: ${relative}`);
            }
        }
        const planPath = path.join(plansDir, `apply-${Date.now()}-${crypto.randomUUID()}.json`);
        await fsp.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
            this.preparedInstall = Object.freeze({ planPath, backupRoot, resultFile, version: manifest.version });
            this.phase = 'INSTALL_PENDING';
            return { ...this.preparedInstall };
        } finally {
            this.installPrepareInFlight = false;
        }
    }

    async #scanZip(zipPath) {
        if (this.zipScanner) return this.zipScanner(zipPath, { safeRelative, deniedEntry });
        let yauzl;
        try { yauzl = require('yauzl'); }
        catch (error) {
            error.code = 'LOCAL_UPDATE_ZIP_SCANNER_MISSING';
            throw error;
        }
        return new Promise((resolve, reject) => {
            yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openError, zip) => {
                if (openError) return reject(openError);
                const entries = [];
                let uncompressedBytes = 0;
                let files = 0;
                const fail = error => {
                    try {
                        zip.close();
                    } catch (closeError) {
                        this.logger?.debug?.('Local update ZIP close failed while rejecting scan.', {
                            error: closeError,
                            primaryError: error?.message || String(error)
                        });
                    }
                    reject(error);
                };
                zip.on('error', fail);
                zip.on('entry', entry => {
                    const relative = safeRelative(entry.fileName);
                    if (!relative) return fail(this.#error('LOCAL_UPDATE_UNSAFE_PATH', `ZIP chứa đường dẫn không an toàn: ${entry.fileName}`));
                    const directory = /\/$/.test(entry.fileName);
                    if (deniedEntry(relative)) return fail(this.#error('LOCAL_UPDATE_DENIED_PATH', `ZIP cố ghi vào dữ liệu được bảo vệ: ${relative}`));
                    const mode = (Number(entry.externalFileAttributes || 0) >>> 16) & 0xffff;
                    if ((mode & 0o170000) === 0o120000) return fail(this.#error('LOCAL_UPDATE_SYMLINK', `ZIP không được chứa symbolic link: ${relative}`));
                    const size = Number(entry.uncompressedSize || 0);
                    if (size > MAX_ENTRY_BYTES) return fail(this.#error('LOCAL_UPDATE_ENTRY_SIZE', `File trong ZIP quá lớn: ${relative}`));
                    uncompressedBytes += size;
                    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) return fail(this.#error('LOCAL_UPDATE_EXPANDED_SIZE', 'Dung lượng giải nén của ZIP vượt giới hạn an toàn.'));
                    if (!directory) files += 1;
                    if (files > MAX_FILES) return fail(this.#error('LOCAL_UPDATE_FILE_COUNT', 'ZIP chứa quá nhiều file.'));
                    entries.push({ relative, directory, size });
                    zip.readEntry();
                });
                zip.on('end', () => {
                    if (!entries.some(entry => entry.relative === MANIFEST_NAME && !entry.directory)) {
                        return reject(this.#error('LOCAL_UPDATE_MANIFEST_MISSING', `Thiếu ${MANIFEST_NAME}.`));
                    }
                    resolve({ entries, uncompressedBytes });
                });
                zip.readEntry();
            });
        });
    }

    async #stageFileIntegrity(stageRoot, relative) {
        const safe = safeRelative(relative);
        if (!safe) throw this.#error('LOCAL_UPDATE_UNSAFE_PLAN', `Gói cập nhật chứa đường dẫn không an toàn: ${relative}`);
        const base = path.resolve(stageRoot);
        const target = path.resolve(base, ...safe.split('/'));
        if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
            throw this.#error('LOCAL_UPDATE_UNSAFE_PLAN', `Gói cập nhật thoát khỏi staging root: ${relative}`);
        }
        const stat = await fsp.lstat(target);
        if (!stat.isFile() || stat.isSymbolicLink()) {
            throw this.#error('LOCAL_UPDATE_STAGED_FILE_INVALID', `Staged update source is not a regular file: ${safe}`);
        }
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(target);
        for await (const chunk of stream) hash.update(chunk);
        return Object.freeze({ relative: safe, size: stat.size, digest: `sha256:${hash.digest('hex')}` });
    }

    async #extract(zipPath, stageRoot) {
        if (this.extractor) return this.extractor(zipPath, { dir: stageRoot });
        let extract;
        try { extract = require('extract-zip'); }
        catch (error) {
            error.code = 'LOCAL_UPDATE_EXTRACTOR_MISSING';
            throw error;
        }
        return extract(zipPath, { dir: stageRoot });
    }

    async #readManifest(stageRoot) {
        const file = path.join(stageRoot, MANIFEST_NAME);
        const stat = await fsp.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw this.#error('LOCAL_UPDATE_MANIFEST_INVALID', `${MANIFEST_NAME} không phải file thường.`);
        if (stat.size > 128 * 1024) throw this.#error('LOCAL_UPDATE_MANIFEST_TOO_LARGE', `${MANIFEST_NAME} quá lớn.`);
        return JSON.parse(await fsp.readFile(file, 'utf8'));
    }

    async #validateManifest(manifest, stageRoot) {
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw this.#error('LOCAL_UPDATE_MANIFEST_INVALID', 'Manifest cập nhật không hợp lệ.');
        const allowed = new Set(['schemaVersion', 'product', 'version', 'type', 'fromVersion', 'minimumVersion', 'dependenciesChanged', 'notes', 'delete']);
        for (const key of Object.keys(manifest)) if (!allowed.has(key)) throw this.#error('LOCAL_UPDATE_MANIFEST_KEY', `Manifest có khóa không hỗ trợ: ${key}`);
        if (manifest.schemaVersion !== 1) throw this.#error('LOCAL_UPDATE_SCHEMA', 'Phiên bản cấu trúc gói cập nhật không được hỗ trợ.');
        if (manifest.product !== 'mcbot-desktop') throw this.#error('LOCAL_UPDATE_PRODUCT', 'ZIP không phải gói cập nhật MCbot Desktop.');
        const version = normalizeVersion(manifest.version);
        if (!version) throw this.#error('LOCAL_UPDATE_VERSION', 'Phiên bản trong manifest không hợp lệ.');
        if (compareVersions(version, this.currentVersion) <= 0) throw this.#error('LOCAL_UPDATE_NOT_NEWER', `Gói ${version} không mới hơn MCbot ${this.currentVersion}.`);
        if (!['patch', 'full'].includes(manifest.type)) throw this.#error('LOCAL_UPDATE_TYPE', 'Loại gói cập nhật phải là patch hoặc full.');
        if (manifest.minimumVersion && compareVersions(this.currentVersion, manifest.minimumVersion) < 0) {
            throw this.#error('LOCAL_UPDATE_TOO_OLD', `Gói cập nhật yêu cầu tối thiểu MCbot ${manifest.minimumVersion}.`);
        }
        if (manifest.type === 'patch' && manifest.fromVersion && compareVersions(this.currentVersion, manifest.fromVersion) !== 0) {
            throw this.#error('LOCAL_UPDATE_WRONG_BASE', `Patch này dành cho MCbot ${manifest.fromVersion}, hiện tại là ${this.currentVersion}.`);
        }
        if (manifest.dependenciesChanged === true) {
            throw this.#error('LOCAL_UPDATE_DEPENDENCIES_CHANGED', 'Patch ZIP có thay đổi dependency; cần dùng bản cài/full installer thay vì cập nhật nóng.');
        }
        if (manifest.notes !== undefined && (!Array.isArray(manifest.notes) || manifest.notes.some(note => typeof note !== 'string'))) {
            throw this.#error('LOCAL_UPDATE_NOTES', 'notes trong manifest phải là mảng chuỗi.');
        }
        if (manifest.delete !== undefined && !Array.isArray(manifest.delete)) throw this.#error('LOCAL_UPDATE_DELETE', 'delete trong manifest phải là mảng.');
        const normalizedDelete = normalizedUniquePaths(manifest.delete || [], {
            code: 'LOCAL_UPDATE_DELETE_PATH',
            errorFactory: (code, message) => this.#error(code, message),
            kind: 'Manifest delete'
        });
        for (const safe of normalizedDelete) {
            if (deniedDeleteEntry(safe)) throw this.#error('LOCAL_UPDATE_DELETE_PATH', `Manifest chỉ được phép xóa generated root "out": ${safe}`);
        }
        manifest.delete = normalizedDelete;

        const packageFile = path.join(stageRoot, 'package.json');
        const packageText = await fsp.readFile(packageFile, 'utf8').catch(() => null);
        if (!packageText) throw this.#error('LOCAL_UPDATE_PACKAGE_MISSING', 'Gói cập nhật phải chứa package.json.');
        const packageJson = JSON.parse(packageText);
        if (normalizeVersion(packageJson.version) !== version) throw this.#error('LOCAL_UPDATE_PACKAGE_VERSION', 'package.json và manifest không cùng phiên bản.');

        const targetPackageFile = path.join(this.applicationRoot, 'package.json');
        const currentText = await fsp.readFile(targetPackageFile, 'utf8').catch(() => null);
        if (currentText) {
            const currentPackage = JSON.parse(currentText);
            const nextDeps = JSON.stringify(stableObject(packageJson.dependencies));
            const currentDeps = JSON.stringify(stableObject(currentPackage.dependencies));
            if (nextDeps !== currentDeps) {
                throw this.#error('LOCAL_UPDATE_DEPENDENCIES_CHANGED', 'Dependency runtime thay đổi; không thể áp dụng bằng ZIP patch an toàn.');
            }
        }
        manifest.version = version;
    }

    async #cleanupPath(target, options, reason) {
        try {
            await this.removePath(target, options);
            return true;
        } catch (error) {
            this.logger?.warn?.('Local update cleanup failed.', { reason, target: path.basename(target), error });
            return false;
        }
    }

    #error(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }
}

LocalZipUpdateService.safeRelative = safeRelative;
LocalZipUpdateService.deniedEntry = deniedEntry;
LocalZipUpdateService.deniedDeleteEntry = deniedDeleteEntry;
LocalZipUpdateService.allowedGeneratedDelete = allowedGeneratedDelete;
module.exports = LocalZipUpdateService;
