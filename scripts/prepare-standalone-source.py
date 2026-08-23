from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def p(relative: str) -> Path:
    return ROOT.joinpath(*relative.split('/'))


def read(relative: str) -> str:
    return p(relative).read_text(encoding='utf-8')


def write(relative: str, text: str) -> None:
    target = p(relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8')


def remove(relative: str) -> None:
    target = p(relative)
    if target.is_dir():
        shutil.rmtree(target, ignore_errors=True)
    elif target.exists() or target.is_symlink():
        target.unlink(missing_ok=True)


def replace_once(relative: str, old: str, new: str, label: str | None = None) -> None:
    source = read(relative)
    if old not in source:
        raise RuntimeError(f'{relative}: required block not found: {label or old[:80]}')
    write(relative, source.replace(old, new, 1))


def regex_once(relative: str, pattern: str, replacement: str, label: str) -> None:
    source = read(relative)
    next_source, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{relative}: expected one match for {label}, got {count}')
    write(relative, next_source)


def run(*args: str) -> str:
    result = subprocess.run(args, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode != 0:
        print(result.stdout)
        raise RuntimeError(f'command failed ({result.returncode}): {" ".join(args)}')
    return result.stdout


def remove_repository_automation() -> None:
    for relative in [
        '.github',
        '.gitignore',
        'src/desktop/update/GitHubUpdateService.js',
        'tests/unit/desktop/GitHubUpdateService.test.js',
    ]:
        remove(relative)


def rewrite_preferences() -> None:
    write('src/desktop/DesktopPreferenceStore.js', r'''\
'use strict';

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

    snapshot() {
        return { ...this.values };
    }

    get(key) {
        return this.values[key];
    }

    async set(key, value) {
        if (!Object.prototype.hasOwnProperty.call(this.defaults, key)) {
            throw new Error('Unknown desktop preference: ' + key);
        }
        return this.#enqueueMutation({ [key]: value });
    }

    async update(patch = {}) {
        const unknown = Object.keys(patch).filter(key => !Object.prototype.hasOwnProperty.call(this.defaults, key));
        if (unknown.length) throw new Error('Unknown desktop preference(s): ' + unknown.join(', '));
        return this.#enqueueMutation(patch);
    }

    async drain() {
        await this.writeQueue;
        return this.snapshot();
    }

    diagnostics() {
        return { cleanupWarning: this.lastCleanupWarning ? { ...this.lastCleanupWarning } : null };
    }

    #normalize(input) {
        const interval = Number(input.snapshotIntervalMs);
        const rawBounds = input.windowBounds;
        const windowBounds = rawBounds && typeof rawBounds === 'object'
            && [rawBounds.x, rawBounds.y, rawBounds.width, rawBounds.height].every(Number.isFinite)
            ? {
                x: Math.round(rawBounds.x),
                y: Math.round(rawBounds.y),
                width: Math.max(1080, Math.round(rawBounds.width)),
                height: Math.max(700, Math.round(rawBounds.height))
            }
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
        const temporary = this.filePath + '.' + process.pid + '.' + this.idFactory() + '.tmp';
        this.lastCleanupWarning = null;
        try {
            await this.fs.writeFile(temporary, JSON.stringify(values, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
            await this.fs.rename(temporary, this.filePath);
        } finally {
            try {
                await this.fs.rm?.(temporary, { force: true });
            } catch (error) {
                this.lastCleanupWarning = Object.freeze({
                    code: error?.code || null,
                    message: error?.message || String(error),
                    tempFile: path.basename(temporary)
                });
            }
        }
    }
}

DesktopPreferenceStore.DEFAULTS = DEFAULTS;
module.exports = DesktopPreferenceStore;
''')

    tests = read('tests/unit/desktop/DesktopPreferenceStore.test.js')
    first = r"test\('DesktopPreferenceStore loads defaults,[\s\S]*?\n\}\);\n\n(?=test\('DesktopPreferenceStore clamps)"
    first_replacement = r'''test('DesktopPreferenceStore loads defaults, persists normalized preferences and rejects unknown keys', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-pref-'));
    const filePath = path.join(dir, 'preferences.json');
    const store = new DesktopPreferenceStore({ filePath });

    assert.deepEqual(await store.load(), {
        closeToTray: true,
        notifyErrors: true,
        snapshotIntervalMs: 900,
        startBackendOnLaunch: true,
        preventSystemSleepWhileActive: true,
        launchAtLogin: false,
        windowBounds: null,
        windowMaximized: false
    });

    assert.equal((await store.set('snapshotIntervalMs', 50)).snapshotIntervalMs, 400);
    assert.equal((await store.update({ closeToTray: false, notifyErrors: false })).closeToTray, false);
    assert.equal(store.get('missing'), undefined);
    await assert.rejects(() => store.set('unknown', true), /Unknown desktop preference/);

    const reloaded = new DesktopPreferenceStore({ filePath });
    assert.deepEqual(await reloaded.load(), {
        closeToTray: false,
        notifyErrors: false,
        snapshotIntervalMs: 400,
        startBackendOnLaunch: true,
        preventSystemSleepWhileActive: true,
        launchAtLogin: false,
        windowBounds: null,
        windowMaximized: false
    });

    fs.rmSync(dir, { recursive: true, force: true });
});

'''
    tests, count = re.subn(first, lambda _: first_replacement, tests, count=1)
    if count != 1:
        raise RuntimeError('DesktopPreferenceStore.test.js: first test rewrite failed')
    tests = tests.replace("    assert.equal(loaded.updateChannel, 'stable');\n    assert.equal(loaded.autoCheckUpdates, true);\n", '')
    tests, count = re.subn(r"\n\ntest\('DesktopPreferenceStore normalizes update channel/repository preferences'[\s\S]*?\n\}\);\n", '\n', tests, count=1)
    if count != 1:
        raise RuntimeError('DesktopPreferenceStore.test.js: remote updater preference test rewrite failed')
    write('tests/unit/desktop/DesktopPreferenceStore.test.js', tests)


def rewrite_desktop_main() -> None:
    source = read('src/desktop/main.js')
    source = source.replace("const GitHubUpdateService = require('./update/GitHubUpdateService');\n", '')
    source = source.replace('let updateService = null;\n', '')
    source = source.replace('let automaticUpdateTimer = null;\n', '')

    source, count = re.subn(
        r"\nfunction publishUpdateStatus\(\) \{[\s\S]*?\n\}\n\nasync function checkForUpdates[\s\S]*?\n\}\n\nasync function installDownloadedUpdate[\s\S]*?\n\}\n\n\n(?=async function selectLocalUpdateZip)",
        '\n', source, count=1
    )
    if count != 1:
        raise RuntimeError('src/desktop/main.js: remote updater function block not found')

    remote_ipc_patterns = [
        r"\n\s*safeHandle\('mcbot:update:status'[^\n]*\);",
        r"\n\s*safeHandle\('mcbot:update:check'[^\n]*\);",
        r"\n\s*safeHandle\('mcbot:update:download'[^\n]*\);",
        r"\n\s*safeHandle\('mcbot:update:install'[^\n]*\);",
        r"\n\s*safeHandle\('mcbot:update:clear-download'[^\n]*\);",
        r"\n\s*safeHandle\('mcbot:update:open-release',[\s\S]*?\n\s*\}\);",
    ]
    for pattern in remote_ipc_patterns:
        source = re.sub(pattern, '', source, count=1)

    source = re.sub(r"\n\s*updateService\?\.configure\?\.\([^\n]*\);", '', source, count=1)
    source = source.replace('\n        publishUpdateStatus();', '')
    source, count = re.subn(
        r"\n\s*updateService = new GitHubUpdateService\([\s\S]*?\n\s*updateService\.on\('status'[^\n]*\);",
        '', source, count=1
    )
    if count != 1:
        raise RuntimeError('src/desktop/main.js: GitHub updater initialization block not found')
    source, count = re.subn(
        r"\n\s*if \(app\.isPackaged && preferenceStore\.get\('autoCheckUpdates'\)\) \{[\s\S]*?\n\s*\}\n(?=\s*app\.on\('activate')",
        '\n', source, count=1
    )
    if count != 1:
        raise RuntimeError('src/desktop/main.js: automatic remote update timer block not found')
    source = re.sub(r"\n\s*if \(automaticUpdateTimer\) \{ clearTimeout\(automaticUpdateTimer\); automaticUpdateTimer = null; \}", '', source, count=1)

    if re.search(r'GitHub|updateService|automaticUpdateTimer|mcbot:update:(?:status|check|download|install|clear-download|open-release)', source):
        raise RuntimeError('src/desktop/main.js still contains remote updater integration')
    write('src/desktop/main.js', source)


def rewrite_preload() -> None:
    source = read('src/desktop/preload.js')
    for fragment in [
        "    updateStatus: () => invoke('mcbot:update:status'),\n",
        "    checkUpdates: () => invoke('mcbot:update:check'),\n",
        "    downloadUpdate: () => invoke('mcbot:update:download'),\n",
        "    installUpdate: () => invoke('mcbot:update:install'),\n",
        "    clearDownloadedUpdate: () => invoke('mcbot:update:clear-download'),\n",
        "    openUpdateRelease: () => invoke('mcbot:update:open-release'),\n",
    ]:
        source = source.replace(fragment, '')
    source = source.replace("    onUpdateStatus: listener => subscribe('mcbot:update:status', listener)\n", '')
    source = source.replace("    onSnapshot: listener => subscribe('mcbot:snapshot', listener),\n}));", "    onSnapshot: listener => subscribe('mcbot:snapshot', listener)\n}));")
    if 'mcbot:update:status' in source or 'openUpdateRelease' in source:
        raise RuntimeError('src/desktop/preload.js still contains remote updater surface')
    write('src/desktop/preload.js', source)


def rewrite_renderer() -> None:
    html = read('src/desktop/renderer/index.html')
    html = html.replace('DEVELOP · sửa + test/validator/git diff', 'DEVELOP · sửa + test/validator')
    html, count = re.subn(
        r"\n\s*<hr class=\"soft-separator\">\n\s*<h3>Cập nhật trực tuyến</h3>[\s\S]*?<pre id=\"updateReleaseNotes\" class=\"compact-output\">Chưa có ghi chú phát hành\.</pre>",
        '', html, count=1
    )
    if count != 1:
        raise RuntimeError('renderer/index.html: remote update panel not found')
    write('src/desktop/renderer/index.html', html)

    app = read('src/desktop/renderer/app.js')
    app = app.replace('  updateStatus: null,\n', '')
    for line in [
        "    $('#prefAutoCheckUpdates').checked = state.preferences.autoCheckUpdates !== false;\n",
        "    $('#prefAutoDownloadUpdates').checked = state.preferences.autoDownloadUpdates === true;\n",
        "    $('#prefAutoInstallUpdates').checked = state.preferences.autoInstallUpdatesWhenIdle === true;\n",
        "    $('#prefUpdateRepository').value = state.preferences.updateRepository || 'dangluc206-lang/MCbotv1';\n",
        "    $('#prefUpdateChannel').value = state.preferences.updateChannel || 'stable';\n",
    ]:
        app = app.replace(line, '')

    new_update_block = r'''function renderUpdateStatus() {
  const local = state.localUpdate || {};
  $('#updateCurrentVersion').textContent = local.currentVersion || state.appInfo?.version || '—';
  $('#localUpdateState').textContent = ({ IDLE:'Chưa chọn', INSPECTING:'Đang kiểm tra', READY:'Sẵn sàng', INSTALL_PENDING:'Đang chuẩn bị cài', ERROR:'Lỗi' })[String(local.phase || '').toUpperCase()] || String(local.phase || 'Chưa chọn');
  $('#localUpdateVersion').textContent = local.selected?.version || '—';
  $('#localUpdateFile').textContent = local.lastError?.message
    || (local.selected ? local.selected.fileName + ' · ' + (local.selected.type === 'patch' ? 'Patch' : 'Full') + ' · ' + local.selected.fileCount + ' file' : 'Chưa chọn gói cập nhật.');
  $('#localUpdateNotes').textContent = local.selected?.notes?.length ? local.selected.notes.map(note => '• ' + note).join('\n') : 'Chưa có ghi chú từ gói ZIP.';
  $('#installLocalUpdate').disabled = local.phase !== 'READY' || !local.selected;
  $('#clearLocalUpdate').disabled = !local.selected && local.phase !== 'ERROR';
  const migration = state.updateMigration;
  $('#updateMigrationText').textContent = migration?.lastBackup ? 'Backup migration gần nhất: ' + migration.lastBackup : (state.appInfo?.packaged ? 'Chưa có backup migration.' : 'Migration cấu hình chỉ chạy trên bản đã cài.');
  $('#rollbackConfigMigration').disabled = !migration?.lastBackup;
}

async function loadUpdateStatus() {
  try {
    [state.localUpdate, state.updateMigration] = await Promise.all([
      api(window.mcbot.localUpdateStatus()),
      api(window.mcbot.updateMigrationStatus())
    ]);
    renderUpdateStatus();
  } catch (error) { toast(error.message, 'error'); }
}
'''
    app, count = re.subn(
        r"function viUpdatePhase\(phase\) \{[\s\S]*?\n\}\n\nfunction renderUpdateStatus\(\) \{[\s\S]*?\n\}\n\nasync function loadUpdateStatus\(\) \{[\s\S]*?\n\}\n",
        lambda _: new_update_block,
        app,
        count=1,
    )
    if count != 1:
        raise RuntimeError('renderer/app.js: remote update rendering block not found')

    app, count = re.subn(
        r"\n\s*\$\('#checkUpdates'\)[\s\S]*?\n\s*\$\('#openUpdateRelease'\)[^\n]*;",
        '', app, count=1
    )
    if count != 1:
        raise RuntimeError('renderer/app.js: remote updater event block not found')

    app = re.sub(
        r", autoCheckUpdates: \$\('#prefAutoCheckUpdates'\)\.checked, autoDownloadUpdates: \$\('#prefAutoDownloadUpdates'\)\.checked, autoInstallUpdatesWhenIdle: \$\('#prefAutoInstallUpdates'\)\.checked, updateChannel: \$\('#prefUpdateChannel'\)\.value, updateRepository: \$\('#prefUpdateRepository'\)\.value\.trim\(\)",
        '', app, count=1
    )
    app = re.sub(r"\n\s*window\.mcbot\.onUpdateStatus\([^\n]*\);", '', app, count=1)

    leftovers = ['GitHub', 'git diff', 'prefUpdateRepository', 'prefUpdateChannel', 'prefAutoCheckUpdates', 'prefAutoDownloadUpdates', 'prefAutoInstallUpdates', 'checkUpdates', 'downloadUpdate', 'installUpdate', 'openUpdateRelease', 'state.updateStatus']
    remaining = [value for value in leftovers if value in app]
    if remaining:
        raise RuntimeError('renderer/app.js still contains remote updater integration: ' + ', '.join(remaining))
    write('src/desktop/renderer/app.js', app)


def rewrite_local_ai() -> None:
    registry = read('src/ai/tools/AiToolRegistry.js')
    registry = registry.replace(
        "enum: ['validate_structure', 'validate_architecture', 'npm_test', 'git_status', 'git_diff', 'node_check', 'test_file']",
        "enum: ['validate_structure', 'validate_architecture', 'npm_test', 'node_check', 'test_file']",
    )
    registry = registry.replace("            git_status: ['git', ['status', '--short']],\n            git_diff: ['git', ['diff', '--']],\n", '')
    if 'git_status' in registry or 'git_diff' in registry:
        raise RuntimeError('AiToolRegistry still exposes Git checks')
    write('src/ai/tools/AiToolRegistry.js', registry)

    workspace = read('src/ai/knowledge/ProjectWorkspace.js')
    workspace = workspace.replace(
        "const DEFAULT_IGNORED_DIRS = new Set(['.git', 'node_modules', 'data', 'out', 'dist', 'build', 'coverage', '.cache']);",
        "const DEFAULT_IGNORED_DIRS = new Set(['node_modules', 'data', 'out', 'dist', 'build', 'coverage', '.cache']);",
    )
    workspace = workspace.replace(
        "const ALWAYS_ALLOWED = new Set(['package-lock.json', 'package.json', '.gitignore']);",
        "const ALWAYS_ALLOWED = new Set(['package-lock.json', 'package.json']);",
    )
    workspace = workspace.replace(
        "                    if (DEFAULT_IGNORED_DIRS.has(entry.name) || currentDepth >= Math.max(0, Number(depth) || 0)) continue;",
        "                    if (entry.name.startsWith('.') || DEFAULT_IGNORED_DIRS.has(entry.name) || currentDepth >= Math.max(0, Number(depth) || 0)) continue;",
    )
    workspace = workspace.replace(
        "        if (segments.some(segment => DEFAULT_IGNORED_DIRS.has(segment))) throw this.#pathError(`Path is excluded from AI workspace: ${normalized}`);",
        "        if (segments.some(segment => segment.startsWith('.') || DEFAULT_IGNORED_DIRS.has(segment))) throw this.#pathError(`Path is excluded from AI workspace: ${normalized}`);",
    )
    write('src/ai/knowledge/ProjectWorkspace.js', workspace)


def rewrite_baseline() -> None:
    source = read('scripts/architecture-baseline.js')
    source = source.replace("const childProcess = require('node:child_process');\n", '')
    source = source.replace("const EXCLUDED_SEGMENTS = new Set(['.git', 'node_modules', 'data']);", "const EXCLUDED_SEGMENTS = new Set(['node_modules', 'data']);")
    source, count = re.subn(r"\nfunction tryGit\(root, args\) \{[\s\S]*?\n\}\n\n", '\n', source, count=1)
    if count != 1:
        raise RuntimeError('architecture-baseline.js: tryGit not found')
    source, count = re.subn(r"\nfunction gitEvidence\(root\) \{[\s\S]*?\n\}\n\n", '\n', source, count=1)
    if count != 1:
        raise RuntimeError('architecture-baseline.js: gitEvidence not found')
    source = source.replace(
        "            exclusions: ['.git/**', '.env*', 'data/**', 'node_modules/**', '**/*.log'],",
        "            exclusions: ['.env*', 'data/**', 'node_modules/**', '**/*.log'],",
    )
    source = source.replace(
        "                \"rg --files --hidden -g '!.git/**' -g '!.env*' -g '!data/**' -g '!node_modules/**' -g '!*.log' -g '!architecture/baseline/current.json' -g '!docs/architecture-roadmap/baseline/WP-001_GAP_REPORT.md'\",",
        "                \"rg --files --hidden -g '!.env*' -g '!data/**' -g '!node_modules/**' -g '!*.log' -g '!architecture/baseline/current.json' -g '!docs/architecture-roadmap/baseline/WP-001_GAP_REPORT.md'\",",
    )
    source = source.replace(
        "        revision: {\n            ...gitEvidence(root),\n            sourceFingerprintSha256: sourceFingerprint(root, files)\n        },",
        "        revision: {\n            available: false,\n            revision: null,\n            branch: null,\n            worktree: { state: 'STANDALONE', inScopeChangedPaths: 0 },\n            reason: 'Standalone source tree; version-control metadata is intentionally not required.',\n            sourceFingerprintSha256: sourceFingerprint(root, files)\n        },",
    )
    source = source.replace(
        "        `- Git: ${baseline.revision.available ? `${baseline.revision.branch}@${baseline.revision.revision}` : 'unavailable in packaged baseline'}; worktree: ${baseline.revision.worktree.state}.`,",
        "        `- Source tree: standalone; worktree metadata: ${baseline.revision.worktree.state}.`,",
    )
    source = source.replace(
        "        '- Excluded from inventory/content capture: `.git/**`, `.env*`, `data/**`, `node_modules/**`, `**/*.log`; bot profile payloads are not content-scanned.',",
        "        '- Excluded from inventory/content capture: `.env*`, `data/**`, `node_modules/**`, `**/*.log`; bot profile payloads are not content-scanned.',",
    )
    if 'execFileSync(\'git\'' in source or 'gitEvidence(' in source or 'tryGit(' in source:
        raise RuntimeError('architecture-baseline.js still executes Git')
    write('scripts/architecture-baseline.js', source)

    for relative in ['scripts/validate-structure.js', 'scripts/validate-architecture.js']:
        text = read(relative).replace("['node_modules', '.git', 'data']", "['node_modules', 'data']")
        write(relative, text)

    test = read('tests/unit/architecture/ArchitectureBaseline.test.js')
    test = test.replace('excludes secrets, runtime payloads, dependencies, git metadata, and logs', 'excludes secrets, runtime payloads, dependencies, and logs')
    test = test.replace("'node_modules/pkg/index.js', '.git/config', 'logs/runtime.log'", "'node_modules/pkg/index.js', 'logs/runtime.log'")
    write('tests/unit/architecture/ArchitectureBaseline.test.js', test)


def rewrite_packaging_policies() -> None:
    contract = read('scripts/release-zip-contract.js')
    contract = contract.replace(
        "const FORBIDDEN_SEGMENTS = new Set(['.git', 'node_modules', 'coverage', 'out', '.tmp']);",
        "const FORBIDDEN_SEGMENTS = new Set(['node_modules', 'coverage', 'out', '.tmp']);",
    )
    write('scripts/release-zip-contract.js', contract)

    local = read('src/desktop/update/LocalZipUpdateService.js')
    local = local.replace("    '.git',\n", '')
    write('src/desktop/update/LocalZipUpdateService.js', local)

    forge = read('scripts/build/ForgePackagingPolicy.js')
    forge = forge.replace("        if (lower === '.git' || lower.startsWith('.git/')) return true;\n", '')
    forge = forge.replace("            'architecture',\n            '.github'\n", "            'architecture'\n")
    forge = re.sub(r"\n\s*if \(lower === 'node_modules/minecraft-data/\.github'[^\n]*\) return true;", '', forge)
    forge = re.sub(r"\n\s*if \(lower === 'node_modules/minecraft-data/minecraft-data/\.github'[^\n]*\) return true;", '', forge)
    write('scripts/build/ForgePackagingPolicy.js', forge)


def rewrite_quality_and_ownership() -> None:
    gates = read('scripts/run-quality-gates.js')
    gates = gates.replace("            'tests/unit/desktop/GitHubUpdateService.test.js',\n", '')
    gates = gates.replace('Runtime configuration transaction/fault closure, updater ownership and staged-file integrity', 'Runtime configuration transaction/fault closure and local staged-file integrity')
    write('scripts/run-quality-gates.js', gates)

    ownership = json.loads(read('architecture/artifact-ownership.json'))
    ownership['owners'] = [entry for entry in ownership.get('owners', []) if entry.get('file') != 'src/desktop/update/GitHubUpdateService.js']
    write('architecture/artifact-ownership.json', json.dumps(ownership, ensure_ascii=False, indent=2) + '\n')

    visibility = read('tests/unit/architecture/BestEffortFailureVisibility.test.js')
    visibility = visibility.replace("    'src/desktop/update/GitHubUpdateService.js',\n", '')
    write('tests/unit/architecture/BestEffortFailureVisibility.test.js', visibility)


def remove_transformers() -> None:
    remove('scripts/prepare-standalone-source.js')
    # The currently-running Python script can be unlinked safely on the CI host.
    remove('scripts/prepare-standalone-source.py')


def refresh_baseline() -> None:
    baseline = run(sys.executable if False else 'node', 'scripts/inspect-architecture-baseline.js')
    write('architecture/baseline/current.json', baseline.rstrip() + '\n')
    report = run('node', 'scripts/inspect-architecture-baseline.js', '--report')
    write('docs/architecture-roadmap/baseline/WP-001_GAP_REPORT.md', report)


def scan_operational_references() -> None:
    roots = ['src', 'scripts', 'tests', 'architecture']
    pattern = re.compile(r'github\.com|api\.github\.com|\bgithub\b|\bgit\b|\.git(?:hub|ignore)?', re.I)
    findings: list[str] = []
    allowed_suffixes = {'.js', '.json', '.html', '.css', '.yml', '.yaml'}
    for root_name in roots:
        root = p(root_name)
        if not root.exists():
            continue
        for file in root.rglob('*'):
            if not file.is_file() or file.suffix.lower() not in allowed_suffixes:
                continue
            relative = file.relative_to(ROOT).as_posix()
            text = file.read_text(encoding='utf-8', errors='replace')
            for line_no, line in enumerate(text.splitlines(), 1):
                if pattern.search(line):
                    findings.append(f'{relative}:{line_no}: {line.strip()[:220]}')
    if findings:
        print('Operational version-control references remain:')
        for item in findings[:200]:
            print(' - ' + item)
        raise RuntimeError(f'found {len(findings)} operational version-control reference(s)')


def main() -> None:
    remove_repository_automation()
    rewrite_preferences()
    rewrite_desktop_main()
    rewrite_preload()
    rewrite_renderer()
    rewrite_local_ai()
    rewrite_baseline()
    rewrite_packaging_policies()
    rewrite_quality_and_ownership()
    # Remove conversion-only machinery BEFORE baseline capture so the baseline
    # describes exactly the standalone source tree that will be shipped.
    remove_transformers()
    refresh_baseline()
    scan_operational_references()
    print('Standalone source conversion complete.')


if __name__ == '__main__':
    main()
