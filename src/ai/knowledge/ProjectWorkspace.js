'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_IGNORED_DIRS = new Set(['.git', 'node_modules', 'data', 'out', 'dist', 'build', 'coverage', '.cache']);
const ALLOWED_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.json', '.md', '.txt', '.html', '.css', '.yml', '.yaml', '.toml', '.cmd', '.ps1', '.sh']);
const ALWAYS_ALLOWED = new Set(['package-lock.json', 'package.json', '.gitignore']);

function unix(value) { return String(value || '').replace(/\\/g, '/'); }

class ProjectWorkspace {
    constructor({ root, maxFileBytes = 1024 * 1024, maxFiles = 8000, removePath = fsp.rm } = {}) {
        if (!root) throw new TypeError('ProjectWorkspace root is required.');
        this.root = path.resolve(root);
        this.rootReal = fs.existsSync(this.root) ? fs.realpathSync.native(this.root) : this.root;
        this.maxFileBytes = Math.max(4096, Number(maxFileBytes) || 1024 * 1024);
        this.maxFiles = Math.max(100, Number(maxFiles) || 8000);
        if (typeof removePath !== 'function') throw new TypeError('ProjectWorkspace removePath must be a function.');
        this.removePath = removePath;
        this.lastCleanupWarning = null;
    }

    async inspect() {
        const stat = await fsp.stat(this.root).catch(() => null);
        if (!stat?.isDirectory()) throw new Error(`AI workspace does not exist: ${this.root}`);
        const packageFile = path.join(this.root, 'package.json');
        const packageJson = JSON.parse(await fsp.readFile(packageFile, 'utf8').catch(() => '{}'));
        const files = await this.listFiles();
        return {
            root: this.root,
            name: packageJson.name || path.basename(this.root),
            version: packageJson.version || null,
            fileCount: files.length,
            hasAgents: files.includes('AGENTS.md'),
            hasArchitecture: files.includes('ARCHITECTURE.md'),
            files
        };
    }

    resolve(relativePath, { allowMissing = false } = {}) {
        const input = String(relativePath || '').trim().replace(/^\.[\\/]/, '');
        if (!input) return this.root;
        if (path.isAbsolute(input)) throw this.#pathError('Absolute paths are not allowed.');
        const absolute = path.resolve(this.root, input);
        const rel = path.relative(this.root, absolute);
        if (!rel || rel === '.') return this.root;
        if (rel.startsWith('..') || path.isAbsolute(rel)) throw this.#pathError('Path escapes AI workspace.');
        this.#assertSafeRelative(rel);
        this.#assertRealPathInside(absolute, { allowMissing });
        if (!allowMissing && !fs.existsSync(absolute)) {
            const error = new Error(`Workspace path does not exist: ${unix(rel)}`);
            error.code = 'AI_WORKSPACE_PATH_MISSING';
            throw error;
        }
        return absolute;
    }

    async listFiles({ subdir = '.', depth = 20 } = {}) {
        const start = this.resolve(subdir, { allowMissing: false });
        const output = [];
        const baseDepth = unix(path.relative(this.root, start)).split('/').filter(Boolean).length;
        const walk = async directory => {
            if (output.length >= this.maxFiles) return;
            const entries = await fsp.readdir(directory, { withFileTypes: true });
            entries.sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                if (output.length >= this.maxFiles) break;
                const absolute = path.join(directory, entry.name);
                const rel = unix(path.relative(this.root, absolute));
                const currentDepth = rel.split('/').filter(Boolean).length - baseDepth;
                if (entry.isDirectory()) {
                    if (DEFAULT_IGNORED_DIRS.has(entry.name) || currentDepth >= Math.max(0, Number(depth) || 0)) continue;
                    await walk(absolute);
                    continue;
                }
                if (!entry.isFile() || !this.#isReadableFile(rel)) continue;
                output.push(rel);
            }
        };
        const stat = await fsp.stat(start);
        if (stat.isFile()) return [unix(path.relative(this.root, start))];
        await walk(start);
        return output;
    }

    async readFile(relativePath, { startLine = 1, endLine = null, maxChars = 40000 } = {}) {
        const absolute = this.resolve(relativePath);
        const relative = unix(path.relative(this.root, absolute));
        if (!this.#isReadableFile(relative)) throw this.#pathError(`File type is not available to Local AI: ${relative}`);
        const stat = await fsp.stat(absolute);
        if (!stat.isFile()) throw new Error('Requested workspace path is not a file.');
        if (stat.size > this.maxFileBytes) throw new Error(`File exceeds AI read limit (${this.maxFileBytes} bytes).`);
        const text = await fsp.readFile(absolute, 'utf8');
        const lines = text.split(/\r?\n/);
        const from = Math.max(1, Math.floor(Number(startLine) || 1));
        const to = endLine == null ? lines.length : Math.max(from, Math.floor(Number(endLine) || from));
        let body = lines.slice(from - 1, to).map((line, index) => `${from + index}: ${line}`).join('\n');
        const limit = Math.max(1000, Math.min(200000, Number(maxChars) || 40000));
        if (body.length > limit) body = `${body.slice(0, limit)}\n...[truncated]`;
        return { path: unix(path.relative(this.root, absolute)), startLine: from, endLine: Math.min(to, lines.length), totalLines: lines.length, content: body };
    }

    async search(query, { subdir = '.', maxMatches = 30 } = {}) {
        const needle = String(query || '').trim();
        if (!needle) throw new Error('Search query is required.');
        const lowered = needle.toLowerCase();
        const files = await this.listFiles({ subdir });
        const matches = [];
        for (const file of files) {
            if (matches.length >= maxMatches) break;
            const absolute = this.resolve(file);
            const stat = await fsp.stat(absolute).catch(() => null);
            if (!stat?.isFile() || stat.size > this.maxFileBytes) continue;
            const content = await fsp.readFile(absolute, 'utf8').catch(() => '');
            const lines = content.split(/\r?\n/);
            for (let index = 0; index < lines.length && matches.length < maxMatches; index += 1) {
                if (!lines[index].toLowerCase().includes(lowered)) continue;
                matches.push({ path: file, line: index + 1, text: lines[index].trim().slice(0, 500) });
            }
        }
        return matches;
    }

    async replaceText(relativePath, { oldText, newText, replaceAll = false } = {}) {
        const absolute = this.resolve(relativePath);
        const relative = unix(path.relative(this.root, absolute));
        if (!this.#isReadableFile(relative)) throw this.#pathError(`File type is not editable by Local AI: ${relative}`);
        const current = await fsp.readFile(absolute, 'utf8');
        const target = String(oldText ?? '');
        if (!target) throw new Error('oldText is required for apply_patch.');
        const occurrences = current.split(target).length - 1;
        if (!occurrences) throw new Error('apply_patch oldText was not found.');
        if (!replaceAll && occurrences !== 1) throw new Error(`apply_patch oldText matched ${occurrences} times; provide a unique block or set replaceAll=true.`);
        const next = replaceAll ? current.split(target).join(String(newText ?? '')) : current.replace(target, String(newText ?? ''));
        const cleanupWarning = await this.#atomicWrite(absolute, next);
        return { path: unix(path.relative(this.root, absolute)), replacements: replaceAll ? occurrences : 1, bytesBefore: Buffer.byteLength(current), bytesAfter: Buffer.byteLength(next), cleanupWarning };
    }

    async writeFile(relativePath, content, { createOnly = false } = {}) {
        const absolute = this.resolve(relativePath, { allowMissing: true });
        const relative = unix(path.relative(this.root, absolute));
        if (!this.#isReadableFile(relative)) throw this.#pathError(`File type is not editable by Local AI: ${relative}`);
        const existed = fs.existsSync(absolute);
        if (createOnly && existed) throw new Error('write_file createOnly target already exists.');
        await fsp.mkdir(path.dirname(absolute), { recursive: true });
        const cleanupWarning = await this.#atomicWrite(absolute, String(content ?? ''));
        return { path: unix(path.relative(this.root, absolute)), created: !existed, bytes: Buffer.byteLength(String(content ?? '')), cleanupWarning };
    }

    #assertRealPathInside(absolute, { allowMissing = false } = {}) {
        let probe = absolute;
        if (!fs.existsSync(probe)) {
            if (!allowMissing) return;
            while (!fs.existsSync(probe)) {
                const parent = path.dirname(probe);
                if (parent === probe) break;
                probe = parent;
            }
        }
        if (!fs.existsSync(probe)) return;
        const real = fs.realpathSync.native(probe);
        const rel = path.relative(this.rootReal, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) throw this.#pathError('Symlink/path resolves outside AI workspace.');
    }

    #assertSafeRelative(relativePath) {
        const normalized = unix(relativePath);
        const segments = normalized.split('/').filter(Boolean);
        if (segments.some(segment => DEFAULT_IGNORED_DIRS.has(segment))) throw this.#pathError(`Path is excluded from AI workspace: ${normalized}`);
        const lower = normalized.toLowerCase();
        const basename = path.posix.basename(lower);
        const blockedFiles = new Set(['tk.env', 'secrets.json', 'credentials.json', 'credential.json', 'tokens.json', 'token.json']);
        if (basename.startsWith('.env') || blockedFiles.has(basename)) {
            throw this.#pathError('Secret/environment files are not available to Local AI.');
        }
    }

    #isReadableFile(relativePath) {
        try { this.#assertSafeRelative(relativePath); } catch { return false; }
        const basename = path.basename(relativePath);
        if (ALWAYS_ALLOWED.has(basename)) return true;
        return ALLOWED_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
    }

    async #atomicWrite(absolute, content) {
        this.lastCleanupWarning = null;
        const directory = path.dirname(absolute);
        await fsp.mkdir(directory, { recursive: true });
        const temporary = path.join(directory, `.mcbot-ai-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
        try {
            await fsp.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
            await fsp.rename(temporary, absolute);
        } finally {
            try {
                await this.removePath(temporary, { force: true });
            } catch (error) {
                this.lastCleanupWarning = Object.freeze({
                    operation: 'ai-workspace-temp-cleanup',
                    code: String(error?.code || error?.name || 'ERROR'),
                    target: path.basename(temporary)
                });
            }
        }
        return this.lastCleanupWarning;
    }

    #pathError(message) {
        const error = new Error(message);
        error.code = 'AI_WORKSPACE_PATH_DENIED';
        return error;
    }
}

ProjectWorkspace.DEFAULT_IGNORED_DIRS = DEFAULT_IGNORED_DIRS;
module.exports = ProjectWorkspace;
