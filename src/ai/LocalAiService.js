'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const OllamaProvider = require('./providers/OllamaProvider');
const ProjectWorkspace = require('./knowledge/ProjectWorkspace');
const AiToolRegistry = require('./tools/AiToolRegistry');
const AgentSession = require('./AgentSession');

const OFFICIAL_DOCS = ['AGENTS.md', 'RULES.md', 'ARCHITECTURE.md', 'SERVER_BEHAVIOR.md', 'JS_RESPONSIBILITIES.md', 'README.md'];

class LocalAiService {
    constructor({ provider = new OllamaProvider(), controllerProvider = () => null } = {}) {
        this.provider = provider;
        this.controllerProvider = controllerProvider;
    }

    async status({ baseUrl } = {}) {
        const models = await this.provider.listModels({ baseUrl });
        return { connected: true, baseUrl: OllamaProvider.normalizeBaseUrl(baseUrl), models };
    }

    async inspectWorkspace(workspaceRoot) {
        return new ProjectWorkspace({ root: workspaceRoot }).inspect();
    }

    async runAgent({ workspaceRoot, baseUrl, model, permission = 'READ', messages = [], prompt = '' } = {}) {
        const workspace = new ProjectWorkspace({ root: workspaceRoot });
        const info = await workspace.inspect();
        const normalizedPermission = AiToolRegistry.normalizePermission(permission);
        const tools = new AiToolRegistry({
            workspaceRoot: info.root,
            permission: normalizedPermission,
            controller: this.controllerProvider?.() || null
        });
        const systemPrompt = await this.#systemPrompt(workspace, info, normalizedPermission);
        const history = Array.isArray(messages) ? [...messages] : [];
        if (String(prompt || '').trim()) history.push({ role: 'user', content: String(prompt).trim() });
        if (!history.some(message => message?.role === 'user')) throw new Error('Local AI chat requires a user message.');
        const session = new AgentSession({ provider: this.provider, tools });
        const result = await session.run({ baseUrl, model, messages: history, systemPrompt });
        return { ...result, workspace: { root: info.root, version: info.version, fileCount: info.fileCount }, permission: normalizedPermission };
    }

    async #systemPrompt(workspace, info, permission) {
        const docs = [];
        for (const file of OFFICIAL_DOCS) {
            const absolute = path.join(workspace.root, file);
            const text = await fs.readFile(absolute, 'utf8').catch(() => null);
            if (!text) continue;
            docs.push(`\n--- ${file} ---\n${text.slice(0, 10000)}`);
        }
        return [
            'You are MCbot Local AI Agent embedded in MCbot Desktop.',
            `Workspace: ${info.root}`,
            `Project version: ${info.version || 'unknown'}`,
            `Permission: ${permission}`,
            'The entire readable project workspace is your source of truth. Do not assume code you have not inspected.',
            'Use search_project/read_file before making claims about implementation. Prefer stable symbols and current code over memory.',
            'Do not scan the whole repository unless the user explicitly asks for a whole-repo audit. For normal tasks, search once, read only relevant files/symbols, then act or answer.',
            'Never repeat an identical tool call in the same turn. After each tool result, decide whether the evidence is already sufficient.',
            'For code changes, prefer the shortest loop: search -> targeted read -> patch -> targeted verification -> final answer. Do not re-audit unchanged areas after a successful targeted check.',
            'Respect AGENTS.md, RULES.md, ARCHITECTURE.md, SERVER_BEHAVIOR.md and JS_RESPONSIBILITIES.md when present.',
            'Never request or read .env, credentials, secrets, node_modules, runtime data/log files outside the provided log tool, or build output.',
            'For edits, use apply_patch for existing files and write_file mainly for new files. Never claim an edit/test succeeded without tool evidence.',
            'For development verification, use run_check. Arbitrary shell execution is intentionally unavailable.',
            'For runtime actions, only use control_bot when ADMIN permission exposes it. Never invent raw Minecraft commands.',
            'Respond in Vietnamese unless the user explicitly asks for another language.',
            'Be concise about intermediate details, but include changed files/tests when you modify code.',
            docs.join('\n').slice(0, 50000)
        ].join('\n');
    }
}

module.exports = LocalAiService;
