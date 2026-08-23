'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function full(relative) { return path.join(ROOT, ...relative.split('/')); }
function exists(relative) { return fs.existsSync(full(relative)); }
function read(relative) { return fs.readFileSync(full(relative), 'utf8'); }
function write(relative, content) {
    fs.mkdirSync(path.dirname(full(relative)), { recursive: true });
    fs.writeFileSync(full(relative), content, 'utf8');
}
function remove(relative) { fs.rmSync(full(relative), { recursive: true, force: true }); }

function replaceRequired(relative, oldText, newText, label = oldText.slice(0, 60)) {
    const source = read(relative);
    if (!source.includes(oldText)) throw new Error(`${relative}: required block not found: ${label}`);
    write(relative, source.replace(oldText, newText));
}

function replaceRegexRequired(relative, pattern, replacement, label = String(pattern)) {
    const source = read(relative);
    if (!pattern.test(source)) throw new Error(`${relative}: required pattern not found: ${label}`);
    pattern.lastIndex = 0;
    write(relative, source.replace(pattern, replacement));
}

function replaceIfPresent(relative, oldText, newText) {
    if (!exists(relative)) return;
    const source = read(relative);
    if (source.includes(oldText)) write(relative, source.split(oldText).join(newText));
}

function run(command, args, { allowFailure = false } = {}) {
    const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    if (!allowFailure && (result.error || result.status !== 0)) {
        process.stdout.write(output);
        throw result.error || new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
    }
    return { status: result.status, output };
}

function removeRepositoryAutomation() {
    remove('.github');
    remove('.gitignore');
    remove('src/desktop/update/GitHubUpdateService.js');
    remove('tests/unit/desktop/GitHubUpdateService.test.js');
}

function rewritePreferences() {
    write('src/desktop/DesktopPreferenceStore.js', `'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULTS = Object.freeze({
    closeToTray: true,
    notifyErrors: true,
    snapshotIntervalMs: 900,
    startBackendOnLaunch: true,
    preventSystemSleepWhileActive: true,
    launchAtLogin: false,
    windowBounds: null,
    windowMaximized: false
});

class DesktopPreferenceStore {
    constructor({ filePath, defaults = DEFAULTS, fsImpl = fs, idFactory = randomUUID } = {}) {
        if (!filePath) throw new TypeError('DesktopPreferenceStore filePath is required');
        if (!fsImpl || typeof fsImpl.writeFile !== 'function' || typeof fsImpl.rename !== 'function') throw new TypeError('DesktopPreferenceStore fsImpl is invalid');
        if (typeof idFactory !== 'function') throw new TypeError('DesktopPreferenceStore idFactory must be a function');
        this.filePath = path.resolve(filePath);
        this.defaults = { ...DEFAULTS, ...(defaults || {}) };
        this.values = { ...this.defaults };
        this.fs = fsImpl;
        this.idFactory = idFactory;
        this.writeQueue = Promise.resolve();
        this.lastCleanupWarning = null;
    }

    async load() {
        try {
            const parsed = JSON.parse(await this.fs.readFile(this.filePath, 'utf8'));
            this.values = this.#normalize({ ...this.defaults, ...(parsed || {}) });
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
            this.values = this.#normalize(this.defaults);
        }
        return this.snapshot();
    }

    snapshot() { return { ...this.values }; }
    get(key) { return this.values[key]; }

    async set(key, value) {
        if (!Object.prototype.hasOwnProperty.call(this.defaults, key)) throw new Error(\`Unknown desktop preference: \${key}\`);
        return this.#enqueueMutation({ [key]: value });
    }

    async update(patch = {}) {
        const unknown = Object.keys(patch).filter(key => !Object.prototype.hasOwnProperty.call(this.defaults, key));
        if (unknown.length) throw new Error(\`Unknown desktop preference(s): \${unknown.join(', ')}\`);
        return this.#enqueueMutation(patch);
    }

    async drain() { await this.writeQueue; return this.snapshot(); }
    diagnostics() { return { cleanupWarning: this.lastCleanupWarning ? { ...this.lastCleanupWarning } : null }; }

    #normalize(input) {
        const interval = Number(input.snapshotIntervalMs);
        const rawBounds = input.windowBounds;
        const windowBounds = rawBounds && typeof rawBounds === 'object'
            && [rawBounds.x, rawBounds.y, rawBounds.width, rawBounds.height].every(Number.isFinite)
            ? { x: Math.round(rawBounds.x), y: Math.round(rawBounds.y), width: Math.max(1080, Math.round(rawBounds.width)), height: Math.max(700, Math.round(rawBounds.height)) }
            : null;
        return {
            closeToTray: input.closeToTray !== false,
            notifyErrors: input.notifyErrors !== false,
            snapshotIntervalMs: Number.isFinite(interval) ? Math.max(400, Math.min(5000, Math.round(interval))) : DEFAULTS.snapshotIntervalMs,
            startBackendOnLaunch: input.startBackendOnLaunch !== false,
            preventSystemSleepWhileActive: input.preventSystemSleepWhileActive !== false,
            launchAtLogin: input.launchAtLogin === true,
            windowBounds,
            windowMaximized: input.windowMaximized === true
        };
    }

    #enqueueMutation(patch) {
        const work = async () => {
            const next = this.#normalize({ ...this.values, ...(patch || {}) });
            await this.#persist(next);
            this.values = next;
            return this.snapshot();
        };
        const task = this.writeQueue.then(work, work);
        this.writeQueue = task.then(() => undefined, () => undefined);
        return task;
    }

    async #persist(values) {
        await this.fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const temporary = \`${this.filePath}.\${process.pid}.\${this.idFactory()}.tmp\`;
        this.lastCleanupWarning = null;
        try {
            await this.fs.writeFile(temporary, \`${JSON.stringify(values, null, 2)}\\n\`, { encoding: 'utf8', mode: 0o600 });
            await this.fs.rename(temporary, this.filePath);
        } finally {
            try { await this.fs.rm?.(temporary, { force: true }); }
            catch (error) {
                this.lastCleanupWarning = Object.freeze({ code: error?.code || null, message: error?.message || String(error), tempFile: path.basename(temporary) });
            }
        }
    }
}

DesktopPreferenceStore.DEFAULTS = DEFAULTS;
module.exports = DesktopPreferenceStore;
`);

    replaceRegexRequired(
        'tests/unit/desktop/DesktopPreferenceStore.test.js',
        /test\('DesktopPreferenceStore loads defaults,[\s\S]*?\n\}\);\n\n(?=test\('DesktopPreferenceStore clamps)/,
        `test('DesktopPreferenceStore loads defaults, persists normalized preferences and rejects unknown keys', async () => {\n    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-pref-'));\n    const filePath = path.join(dir, 'preferences.json');\n    const store = new DesktopPreferenceStore({ filePath });\n    assert.deepEqual(await store.load(), { closeToTray: true, notifyErrors: true, snapshotIntervalMs: 900, startBackendOnLaunch: true, preventSystemSleepWhileActive: true, launchAtLogin: false, windowBounds: null, windowMaximized: false });\n    assert.equal((await store.set('snapshotIntervalMs', 50)).snapshotIntervalMs, 400);\n    assert.equal((await store.update({ closeToTray: false, notifyErrors: false })).closeToTray, false);\n    assert.equal(store.get('missing'), undefined);\n    await assert.rejects(() => store.set('unknown', true), /Unknown desktop preference/);\n    const reloaded = new DesktopPreferenceStore({ filePath });\n    assert.deepEqual(await reloaded.load(), { closeToTray: false, notifyErrors: false, snapshotIntervalMs: 400, startBackendOnLaunch: true, preventSystemSleepWhileActive: true, launchAtLogin: false, windowBounds: null, windowMaximized: false });\n    fs.rmSync(dir, { recursive: true, force: true });\n});\n\n`,
        'first preference test'
    );
    let prefTest = read('tests/unit/desktop/DesktopPreferenceStore.test.js');
    prefTest = prefTest.replace(/\n\s*assert\.equal\(loaded\.updateChannel, 'stable'\);\n\s*assert\.equal\(loaded\.autoCheckUpdates, true\);/, '');
    prefTest = prefTest.replace(/\n\ntest\('DesktopPreferenceStore normalizes update channel\/repository preferences'[\s\S]*?\n\}\);\n/, '\n');
    write('tests/unit/desktop/DesktopPreferenceStore.test.js', prefTest);
}

function rewriteDesktopMain() {
    let source = read('src/desktop/main.js');
    source = source.replace("const GitHubUpdateService = require('./update/GitHubUpdateService');\n", '');
    source = source.replace('let updateService = null;\n', '');
    source = source.replace('let automaticUpdateTimer = null;\n', '');
    source = source.replace(/\nfunction publishUpdateStatus\(\) \{[\s\S]*?\n\}\n\nasync function checkForUpdates[\s\S]*?\n\}\n\n\n(?=async function selectLocalUpdateZip)/, '\n');
    source = source.replace(/\n\s*safeHandle\('mcbot:update:status'[\s\S]*?safeHandle\('mcbot:update:clear-download'[^\n]*\);/, '');
    source = source.replace(/\n\s*safeHandle\('mcbot:update:open-release',[\s\S]*?\n\s*\}\);/, '');
    source = source.replace(/\n\s*updateService\?\.configure\?\.\([^\n]*\);/, '');
    source = source.replace(/\n\s*publishUpdateStatus\(\);/, '');
    source = source.replace(/\n\s*updateService = new GitHubUpdateService\([\s\S]*?\n\s*updateService\.on\('status'[^\n]*\);/, '');
    source = source.replace(/\n\s*if \(app\.isPackaged && preferenceStore\.get\('autoCheckUpdates'\)\) \{[\s\S]*?\n\s*\}\n\s*app\.on\('activate'/, "\n        app.on('activate'");
    source = source.replace(/\n\s*if \(automaticUpdateTimer\) \{ clearTimeout\(automaticUpdateTimer\); automaticUpdateTimer = null; \}/, '');
    if (/GitHub|updateService|automaticUpdateTimer|mcbot:update:(?:status|check|download|install|clear-download|open-release)/.test(source)) {
        throw new Error('src/desktop/main.js still contains remote updater integration after rewrite');
    }
    write('src/desktop/main.js', source);
}

function rewritePreload() {
    let source = read('src/desktop/preload.js');
    for (const line of [
        "    updateStatus: () => invoke('mcbot:update:status'),\n",
        "    checkUpdates: () => invoke('mcbot:update:check'),\n",
        "    downloadUpdate: () => invoke('mcbot:update:download'),\n",
        "    installUpdate: () => invoke('mcbot:update:install'),\n",
        "    clearDownloadedUpdate: () => invoke('mcbot:update:clear-download'),\n",
        "    openUpdateRelease: () => invoke('mcbot:update:open-release'),\n",
        "    onUpdateStatus: listener => subscribe('mcbot:update:status', listener)\n"
    ]) source = source.replace(line, '');
    source = source.replace("    onSnapshot: listener => subscribe('mcbot:snapshot', listener),\n}));", "    onSnapshot: listener => subscribe('mcbot:snapshot', listener)\n}));");
    write('src/desktop/preload.js', source);
}

function rewriteRenderer() {
    let html = read('src/desktop/renderer/index.html');
    html = html.replace('DEVELOP · sửa + test/validator/git diff', 'DEVELOP · sửa + test/validator');
    html = html.replace(/\n\s*<hr class="soft-separator">\n\s*<h3>Cập nhật trực tuyến<\/h3>[\s\S]*?<pre id="updateReleaseNotes" class="compact-output">Chưa có ghi chú phát hành\.<\/pre>/, '');
    write('src/desktop/renderer/index.html', html);

    let app = read('src/desktop/renderer/app.js');
    app = app.replace('  updateStatus: null,\n', '');
    for (const line of [
        "    $('#prefAutoCheckUpdates').checked = state.preferences.autoCheckUpdates !== false;\n",
        "    $('#prefAutoDownloadUpdates').checked = state.preferences.autoDownloadUpdates === true;\n",
        "    $('#prefAutoInstallUpdates').checked = state.preferences.autoInstallUpdatesWhenIdle === true;\n",
        "    $('#prefUpdateRepository').value = state.preferences.updateRepository || 'dangluc206-lang/MCbotv1';\n",
        "    $('#prefUpdateChannel').value = state.preferences.updateChannel || 'stable';\n"
    ]) app = app.replace(line, '');
    app = app.replace(/\nfunction viUpdatePhase\(phase\) \{[\s\S]*?\n\}\n\n(?=function renderUpdateStatus)/, '\n');
    app = app.replace(/function renderUpdateStatus\(\) \{[\s\S]*?\n\}\n\nasync function loadUpdateStatus\(\) \{[\s\S]*?\n\}\n/, `function renderUpdateStatus() {\n  const local = state.localUpdate || {};\n  $('#updateCurrentVersion').textContent = local.currentVersion || state.appInfo?.version || '—';\n  $('#localUpdateState').textContent = ({ IDLE:'Chưa chọn', INSPECTING:'Đang kiểm tra', READY:'Sẵn sàng', INSTALL_PENDING:'Đang chuẩn bị cài', ERROR:'Lỗi' })[String(local.phase || '').toUpperCase()] || String(local.phase || 'Chưa chọn');\n  $('#localUpdateVersion').textContent = local.selected?.version || '—';\n  $('#localUpdateFile').textContent = local.lastError?.message || (local.selected ? \`${local.selected.fileName} · \${local.selected.type === 'patch' ? 'Patch' : 'Full'} · \${local.selected.fileCount} file\` : 'Chưa chọn gói cập nhật.');\n  $('#localUpdateNotes').textContent = local.selected?.notes?.length ? local.selected.notes.map(note => \`• \${note}\`).join('\\n') : 'Chưa có ghi chú từ gói ZIP.';\n  $('#installLocalUpdate').disabled = local.phase !== 'READY' || !local.selected;\n  $('#clearLocalUpdate').disabled = !local.selected && local.phase !== 'ERROR';\n  const migration = state.updateMigration;\n  $('#updateMigrationText').textContent = migration?.lastBackup ? \`Backup migration gần nhất: \${migration.lastBackup}\` : (state.appInfo?.packaged ? 'Chưa có backup migration.' : 'Migration cấu hình chỉ chạy trên bản đã cài.');\n  $('#rollbackConfigMigration').disabled = !migration?.lastBackup;\n}\n\nasync function loadUpdateStatus() {\n  try {\n    [state.localUpdate, state.updateMigration] = await Promise.all([\n      api(window.mcbot.localUpdateStatus()),\n      api(window.mcbot.updateMigrationStatus())\n    ]);\n    renderUpdateStatus();\n  } catch (error) { toast(error.message, 'error'); }\n}\n`);
    app = app.replace(/\n\s*\$\('#checkUpdates'\)[\s\S]*?\n\s*\$\('#openUpdateRelease'\)[^\n]*;/, '');
    app = app.replace(/, autoCheckUpdates: \$\('#prefAutoCheckUpdates'\)\.checked, autoDownloadUpdates: \$\('#prefAutoDownloadUpdates'\)\.checked, autoInstallUpdatesWhenIdle: \$\('#prefAutoInstallUpdates'\)\.checked, updateChannel: \$\('#prefUpdateChannel'\)\.value, updateRepository: \$\('#prefUpdateRepository'\)\.value\.trim\(\)/, '');
    app = app.replace(/\n\s*window\.mcbot\.onUpdateStatus\([^\n]*\);/, '');
    if (/GitHub|git diff|prefUpdate|AutoCheckUpdates|AutoDownloadUpdates|AutoInstallUpdates|checkUpdates|downloadUpdate|installUpdate|openUpdateRelease|updateStatus/.test(app)) {
        throw new Error('renderer app still contains remote updater integration after rewrite');
    }
    write('src/desktop/renderer/app.js', app);
}

function rewriteLocalAi() {
    let registry = read('src/ai/tools/AiToolRegistry.js');
    registry = registry.replace("enum: ['validate_structure', 'validate_architecture', 'npm_test', 'git_status', 'git_diff', 'node_check', 'test_file']", "enum: ['validate_structure', 'validate_architecture', 'npm_test', 'node_check', 'test_file']");
    registry = registry.replace("            git_status: ['git', ['status', '--short']],\n            git_diff: ['git', ['diff', '--']],\n", '');
    write('src/ai/tools/AiToolRegistry.js', registry);

    let workspace = read('src/ai/knowledge/ProjectWorkspace.js');
    workspace = workspace.replace("const DEFAULT_IGNORED_DIRS = new Set(['.git', 'node_modules', 'data', 'out', 'dist', 'build', 'coverage', '.cache']);", "const DEFAULT_IGNORED_DIRS = new Set(['node_modules', 'data', 'out', 'dist', 'build', 'coverage', '.cache']);");
    workspace = workspace.replace("const ALWAYS_ALLOWED = new Set(['package-lock.json', 'package.json', '.gitignore']);", "const ALWAYS_ALLOWED = new Set(['package-lock.json', 'package.json']);");
    workspace = workspace.replace("                    if (DEFAULT_IGNORED_DIRS.has(entry.name) || currentDepth >= Math.max(0, Number(depth) || 0)) continue;", "                    if (entry.name.startsWith('.') || DEFAULT_IGNORED_DIRS.has(entry.name) || currentDepth >= Math.max(0, Number(depth) || 0)) continue;");
    workspace = workspace.replace("        if (segments.some(segment => DEFAULT_IGNORED_DIRS.has(segment))) throw this.#pathError(`Path is excluded from AI workspace: ${normalized}`);", "        if (segments.some(segment => segment.startsWith('.') || DEFAULT_IGNORED_DIRS.has(segment))) throw this.#pathError(`Path is excluded from AI workspace: ${normalized}`);");
    write('src/ai/knowledge/ProjectWorkspace.js', workspace);
}

function rewriteBaseline() {
    let source = read('scripts/architecture-baseline.js');
    source = source.replace("const childProcess = require('node:child_process');\n", '');
    source = source.replace("const EXCLUDED_SEGMENTS = new Set(['.git', 'node_modules', 'data']);", "const EXCLUDED_SEGMENTS = new Set(['node_modules', 'data']);");
    source = source.replace(/\nfunction tryGit\(root, args\) \{[\s\S]*?\n\}\n\n(?=function sourceFingerprint)/, '\n');
    source = source.replace(/\nfunction gitEvidence\(root\) \{[\s\S]*?\n\}\n\n(?=function requireRequests)/, '\n');
    source = source.replace("            exclusions: ['.git/**', '.env*', 'data/**', 'node_modules/**', '**/*.log'],", "            exclusions: ['.env*', 'data/**', 'node_modules/**', '**/*.log'],");
    source = source.replace("                \"rg --files --hidden -g '!.git/**' -g '!.env*' -g '!data/**' -g '!node_modules/**' -g '!*.log' -g '!architecture/baseline/current.json' -g '!docs/architecture-roadmap/baseline/WP-001_GAP_REPORT.md'\",", "                \"rg --files --hidden -g '!.env*' -g '!data/**' -g '!node_modules/**' -g '!*.log' -g '!architecture/baseline/current.json' -g '!docs/architecture-roadmap/baseline/WP-001_GAP_REPORT.md'\",");
    source = source.replace("        revision: {\n            ...gitEvidence(root),\n            sourceFingerprintSha256: sourceFingerprint(root, files)\n        },", "        revision: {\n            available: false,\n            revision: null,\n            branch: null,\n            worktree: { state: 'STANDALONE', inScopeChangedPaths: 0 },\n            reason: 'Standalone source tree; version-control metadata is intentionally not required.',\n            sourceFingerprintSha256: sourceFingerprint(root, files)\n        },");
    source = source.replace("        `- Git: ${baseline.revision.available ? `${baseline.revision.branch}@${baseline.revision.revision}` : 'unavailable in packaged baseline'}; worktree: ${baseline.revision.worktree.state}.`,", "        `- Source tree: standalone; worktree metadata: ${baseline.revision.worktree.state}.`,");
    source = source.replace("        '- Excluded from inventory/content capture: `.git/**`, `.env*`, `data/**`, `node_modules/**`, `**/*.log`; bot profile payloads are not content-scanned.',", "        '- Excluded from inventory/content capture: `.env*`, `data/**`, `node_modules/**`, `**/*.log`; bot profile payloads are not content-scanned.',");
    write('scripts/architecture-baseline.js', source);

    for (const file of ['scripts/validate-structure.js', 'scripts/validate-architecture.js']) {
        replaceIfPresent(file, "['node_modules', '.git', 'data']", "['node_modules', 'data']");
    }

    let baselineTest = read('tests/unit/architecture/ArchitectureBaseline.test.js');
    baselineTest = baselineTest.replace('excludes secrets, runtime payloads, dependencies, git metadata, and logs', 'excludes secrets, runtime payloads, dependencies, and logs');
    baselineTest = baselineTest.replace("'node_modules/pkg/index.js', '.git/config', 'logs/runtime.log'", "'node_modules/pkg/index.js', 'logs/runtime.log'");
    write('tests/unit/architecture/ArchitectureBaseline.test.js', baselineTest);
}

function rewritePackagingPolicies() {
    let contract = read('scripts/release-zip-contract.js');
    contract = contract.replace("const FORBIDDEN_SEGMENTS = new Set(['.git', 'node_modules', 'coverage', 'out', '.tmp']);", "const FORBIDDEN_SEGMENTS = new Set(['node_modules', 'coverage', 'out', '.tmp']);");
    write('scripts/release-zip-contract.js', contract);

    let local = read('src/desktop/update/LocalZipUpdateService.js');
    local = local.replace("    '.git',\n", '');
    local = local.replace("function deniedEntry(relative) {\n    if (path.posix.basename(relative).startsWith('.env')) return true;", "function deniedEntry(relative) {\n    if (relative.split('/').some(segment => segment.startsWith('.') && segment !== '.tmp')) return true;\n    if (path.posix.basename(relative).startsWith('.env')) return true;");
    write('src/desktop/update/LocalZipUpdateService.js', local);

    let forge = read('scripts/build/ForgePackagingPolicy.js');
    forge = forge.replace("        if (lower === '.git' || lower.startsWith('.git/')) return true;\n", "        if (relative.split('/').some(segment => segment.startsWith('.') && segment !== '.bin')) return true;\n");
    forge = forge.replace("            'architecture',\n            '.github'\n", "            'architecture'\n");
    forge = forge.replace(/\n\s*if \(lower === 'node_modules\/minecraft-data\/\.github'[\s\S]*?return true;/g, '');
    forge = forge.replace(/\n\s*if \(lower === 'node_modules\/minecraft-data\/minecraft-data\/\.github'[\s\S]*?return true;/g, '');
    write('scripts/build/ForgePackagingPolicy.js', forge);
}

function rewriteQualityAndOwnership() {
    let gates = read('scripts/run-quality-gates.js');
    gates = gates.replace("            'tests/unit/desktop/GitHubUpdateService.test.js',\n", '');
    gates = gates.replace('Runtime configuration transaction/fault closure, updater ownership and staged-file integrity', 'Runtime configuration transaction/fault closure and local staged-file integrity');
    write('scripts/run-quality-gates.js', gates);

    const ownership = JSON.parse(read('architecture/artifact-ownership.json'));
    ownership.owners = ownership.owners.filter(entry => entry.file !== 'src/desktop/update/GitHubUpdateService.js');
    write('architecture/artifact-ownership.json', `${JSON.stringify(ownership, null, 2)}\n`);

    let visibility = read('tests/unit/architecture/BestEffortFailureVisibility.test.js');
    visibility = visibility.replace("    'src/desktop/update/GitHubUpdateService.js',\n", '');
    write('tests/unit/architecture/BestEffortFailureVisibility.test.js', visibility);
}

function removeStandaloneToolFromOutput() {
    // This transformer is build-only. The final standalone project should not
    // carry repository conversion machinery.
    remove('scripts/prepare-standalone-source.js');
}

function refreshBaseline() {
    const inspect = run(process.execPath, ['scripts/inspect-architecture-baseline.js']);
    write('architecture/baseline/current.json', inspect.output.trimEnd() + '\n');
    const report = run(process.execPath, ['scripts/inspect-architecture-baseline.js', '--report']);
    write('docs/architecture-roadmap/baseline/WP-001_GAP_REPORT.md', report.output);
}

function scanOperationalReferences() {
    const roots = ['src', 'scripts', 'tests', 'architecture'];
    const findings = [];
    const pattern = /\bgithub\b|github\.com|api\.github\.com|\bgit\b|\.git(?:hub|ignore)?/i;
    function walk(directory) {
        if (!fs.existsSync(directory)) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(absolute);
            else if (entry.isFile() && /\.(?:js|json|html|css|yml|yaml|md|txt)$/i.test(entry.name)) {
                const relative = path.relative(ROOT, absolute).replace(/\\/g, '/');
                const text = fs.readFileSync(absolute, 'utf8');
                const lines = text.split(/\r?\n/);
                lines.forEach((line, index) => { if (pattern.test(line)) findings.push(`${relative}:${index + 1}: ${line.trim().slice(0, 240)}`); });
            }
        }
    }
    roots.forEach(root => walk(full(root)));
    if (findings.length) {
        console.error('Operational version-control references remain:');
        findings.slice(0, 200).forEach(item => console.error(` - ${item}`));
        throw new Error(`Found ${findings.length} operational version-control reference(s).`);
    }
}

function main() {
    removeRepositoryAutomation();
    rewritePreferences();
    rewriteDesktopMain();
    rewritePreload();
    rewriteRenderer();
    rewriteLocalAi();
    rewriteBaseline();
    rewritePackagingPolicies();
    rewriteQualityAndOwnership();
    refreshBaseline();
    scanOperationalReferences();
    removeStandaloneToolFromOutput();
    console.log('Standalone source conversion complete.');
}

main();
