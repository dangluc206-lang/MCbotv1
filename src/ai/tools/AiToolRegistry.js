'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const ProjectWorkspace = require('../knowledge/ProjectWorkspace');

const PERMISSIONS = Object.freeze({ READ: 1, PATCH: 2, DEVELOP: 3, ADMIN: 4 });

function normalizePermission(value) {
    const key = String(value || 'READ').trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(PERMISSIONS, key) ? key : 'READ';
}

function tool(name, description, properties = {}, required = []) {
    return {
        type: 'function',
        function: {
            name,
            description,
            parameters: { type: 'object', properties, required, additionalProperties: false }
        }
    };
}

class AiToolRegistry {
    constructor({ workspaceRoot, permission = 'READ', controller = null, timeoutMs = 120000 } = {}) {
        this.workspace = new ProjectWorkspace({ root: workspaceRoot });
        this.permission = normalizePermission(permission);
        this.controller = controller;
        this.timeoutMs = Math.max(1000, Number(timeoutMs) || 120000);
    }

    definitions() {
        const definitions = [
            tool('list_files', 'List source/document files in the MCbot workspace. Excludes secrets, node_modules, logs and build output.', {
                subdir: { type: 'string', description: 'Relative directory, default .' },
                depth: { type: 'integer', minimum: 0, maximum: 30 }
            }),
            tool('search_project', 'Search text across readable MCbot project files. Use this before guessing file locations.', {
                query: { type: 'string' },
                subdir: { type: 'string' },
                maxMatches: { type: 'integer', minimum: 1, maximum: 80 }
            }, ['query']),
            tool('read_file', 'Read a line-numbered range from a source/document file in the workspace.', {
                path: { type: 'string' }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }
            }, ['path']),
            tool('workspace_info', 'Inspect the current MCbot project workspace and version.', {}),
            tool('get_runtime_snapshot', 'Read current MCbot Desktop backend/bot runtime state. This is read-only.', {}),
            tool('get_recent_logs', 'Read recent in-memory MCbot logs for diagnosis.', {
                limit: { type: 'integer', minimum: 1, maximum: 500 }
            })
        ];
        if (this.#allowed('PATCH')) {
            definitions.push(
                tool('apply_patch', 'Replace one exact source block with another. Fails if oldText is missing or ambiguous. Use for controlled code edits.', {
                    path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' }, replaceAll: { type: 'boolean' }
                }, ['path', 'oldText', 'newText']),
                tool('write_file', 'Create or fully rewrite a project source/document file. Prefer apply_patch for existing files.', {
                    path: { type: 'string' }, content: { type: 'string' }, createOnly: { type: 'boolean' }
                }, ['path', 'content'])
            );
        }
        if (this.#allowed('DEVELOP')) {
            definitions.push(tool('run_check', 'Run one allowlisted verification command. Arbitrary shell commands are not supported.', {
                check: { type: 'string', enum: ['validate_structure', 'validate_architecture', 'npm_test', 'git_status', 'git_diff', 'node_check', 'test_file'] },
                path: { type: 'string', description: 'Required only for node_check or test_file.' }
            }, ['check']));
        }
        if (this.#allowed('ADMIN')) {
            definitions.push(tool('control_bot', 'Control MCbot runtime through existing DesktopController safe boundaries. Never sends raw chat.', {
                action: { type: 'string', enum: ['connect', 'disconnect', 'start_mode', 'pause_mode', 'resume_mode', 'stop_mode', 'restart_mode', 'home'] },
                botId: { type: 'string' },
                mode: { type: 'string' }
            }, ['action', 'botId']));
        }
        return definitions;
    }

    async execute(name, args = {}) {
        switch (name) {
            case 'workspace_info': return this.workspace.inspect();
            case 'list_files': return this.workspace.listFiles({ subdir: args.subdir || '.', depth: args.depth ?? 20 });
            case 'search_project': return this.workspace.search(args.query, { subdir: args.subdir || '.', maxMatches: Math.min(80, Number(args.maxMatches) || 30) });
            case 'read_file': return this.workspace.readFile(args.path, { startLine: args.startLine || 1, endLine: args.endLine ?? null });
            case 'apply_patch': this.#require('PATCH', name); return this.workspace.replaceText(args.path, args);
            case 'write_file': this.#require('PATCH', name); return this.workspace.writeFile(args.path, args.content, { createOnly: args.createOnly === true });
            case 'run_check': this.#require('DEVELOP', name); return this.#runCheck(args);
            case 'get_runtime_snapshot': return this.controller?.snapshot?.() || { lifecycle: 'UNAVAILABLE', bots: [] };
            case 'get_recent_logs': return this.controller?.logSnapshot?.({ limit: Math.min(500, Number(args.limit) || 120) }) || [];
            case 'control_bot': this.#require('ADMIN', name); return this.#controlBot(args);
            default: {
                const error = new Error(`Unknown Local AI tool: ${name}`);
                error.code = 'AI_TOOL_UNKNOWN';
                throw error;
            }
        }
    }

    async #runCheck(args) {
        const check = String(args.check || '');
        const commands = {
            validate_structure: [process.execPath, ['scripts/validate-structure.js']],
            validate_architecture: [process.execPath, ['scripts/validate-architecture.js']],
            npm_test: [process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test']],
            git_status: ['git', ['status', '--short']],
            git_diff: ['git', ['diff', '--']],
        };
        if (check === 'node_check' || check === 'test_file') {
            if (!args.path) throw new Error(`${check} requires path.`);
            const absolute = this.workspace.resolve(args.path);
            if (check === 'node_check') commands.node_check = [process.execPath, ['--check', absolute]];
            else commands.test_file = [process.execPath, ['--test', absolute]];
        }
        const command = commands[check];
        if (!command) throw new Error(`Unsupported verification check: ${check}`);
        return this.#spawn(command[0], command[1]);
    }

    #spawn(command, args) {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, { cwd: this.workspace.root, windowsHide: true, shell: false, env: process.env });
            let stdout = '';
            let stderr = '';
            const cap = 120000;
            const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-cap);
            child.stdout?.on('data', chunk => { stdout = append(stdout, chunk); });
            child.stderr?.on('data', chunk => { stderr = append(stderr, chunk); });
            const timer = setTimeout(() => {
                child.kill();
                const error = new Error(`Verification command timed out after ${this.timeoutMs} ms.`);
                error.code = 'AI_TOOL_TIMEOUT';
                reject(error);
            }, this.timeoutMs);
            timer.unref?.();
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => {
                clearTimeout(timer);
                resolve({ command: [command, ...args].join(' '), exitCode: code, signal, stdout, stderr, success: code === 0 });
            });
        });
    }

    async #controlBot({ action, botId, mode }) {
        if (!this.controller) throw new Error('MCbot Desktop controller is unavailable.');
        const actions = {
            connect: () => this.controller.connect(botId),
            disconnect: () => this.controller.disconnect(botId),
            start_mode: () => this.controller.startMode(botId, mode),
            pause_mode: () => this.controller.pauseMode(botId),
            resume_mode: () => this.controller.resumeMode(botId),
            stop_mode: () => this.controller.stopMode(botId),
            restart_mode: () => this.controller.restartMode(botId),
            home: () => this.controller.goHome(botId)
        };
        if (!actions[action]) throw new Error(`Unsupported bot action: ${action}`);
        if (action === 'start_mode' && !String(mode || '').trim()) throw new Error('start_mode requires mode.');
        return actions[action]();
    }

    #allowed(required) { return PERMISSIONS[this.permission] >= PERMISSIONS[required]; }
    #require(required, toolName) {
        if (!this.#allowed(required)) {
            const error = new Error(`${toolName} requires Local AI permission ${required} or higher.`);
            error.code = 'AI_TOOL_PERMISSION_DENIED';
            throw error;
        }
    }
}

AiToolRegistry.PERMISSIONS = PERMISSIONS;
AiToolRegistry.normalizePermission = normalizePermission;
module.exports = AiToolRegistry;
