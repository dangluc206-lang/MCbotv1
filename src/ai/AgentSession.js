'use strict';

class AgentSession {
    constructor({ provider, tools, maxToolRounds = 24, maxToolCalls = 48 } = {}) {
        if (!provider || typeof provider.complete !== 'function') throw new TypeError('AgentSession provider is required.');
        if (!tools || typeof tools.execute !== 'function') throw new TypeError('AgentSession tools are required.');
        this.provider = provider;
        this.tools = tools;
        this.maxToolRounds = Math.max(1, Math.min(40, Number(maxToolRounds) || 24));
        this.maxToolCalls = Math.max(this.maxToolRounds, Math.min(120, Number(maxToolCalls) || 48));
    }

    async run({ baseUrl, model, messages, systemPrompt, temperature = 0.1 } = {}) {
        const conversation = [
            { role: 'system', content: String(systemPrompt || '') },
            ...this.#normalizeMessages(messages)
        ];
        const trace = [];
        const seenCalls = new Map();
        let usage = null;
        let toolCallCount = 0;

        for (let round = 0; round < this.maxToolRounds; round += 1) {
            if (round === Math.max(4, Math.floor(this.maxToolRounds * 0.6))) {
                conversation.push({
                    role: 'system',
                    content: 'Tool budget is more than half used. Stop broad exploration. Use only tools required for missing evidence; if you can answer or finish verification now, do so.'
                });
            }

            const response = await this.provider.complete({
                baseUrl, model, messages: conversation,
                tools: this.tools.definitions(), temperature
            });
            usage = response.usage || usage;
            const assistant = response.message || {};
            const toolCalls = this.#normalizeToolCalls(assistant.tool_calls, round);
            conversation.push({
                role: 'assistant',
                content: typeof assistant.content === 'string' ? assistant.content : '',
                ...(toolCalls.length ? { tool_calls: toolCalls } : {})
            });

            if (!toolCalls.length) {
                return {
                    content: String(assistant.content || ''),
                    trace,
                    usage,
                    toolRounds: round,
                    toolCalls: toolCallCount,
                    finalizedByBudget: false,
                    model: response.model || model
                };
            }

            for (const call of toolCalls) {
                const name = String(call?.function?.name || '');
                const args = this.#parseArguments(call?.function?.arguments);
                const signature = this.#callSignature(name, args);
                const priorCount = seenCalls.get(signature) || 0;
                seenCalls.set(signature, priorCount + 1);
                toolCallCount += 1;

                if (priorCount > 0) {
                    const result = {
                        error: {
                            code: 'AI_TOOL_REPEAT_BLOCKED',
                            message: 'This exact tool call was already executed in this turn. Reuse the previous evidence, choose a materially different tool call, or finish the answer.'
                        }
                    };
                    trace.push({ name, args: this.#redactArgs(name, args), success: false, repeated: true, elapsedMs: 0, summary: this.#summary(result) });
                    conversation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
                    continue;
                }

                if (toolCallCount > this.maxToolCalls) {
                    conversation.push({
                        role: 'tool',
                        tool_call_id: call.id,
                        content: JSON.stringify({
                            error: {
                                code: 'AI_TOOL_CALL_BUDGET_REACHED',
                                message: `Tool-call budget ${this.maxToolCalls} reached. Stop using tools and provide the best final answer from gathered evidence.`
                            }
                        })
                    });
                    return this.#finalize({
                        baseUrl, model, conversation, trace, usage, temperature,
                        toolRounds: round + 1, toolCalls: toolCallCount,
                        reason: 'tool-call-budget'
                    });
                }

                const startedAt = Date.now();
                let result;
                let success = true;
                try {
                    result = await this.tools.execute(name, args);
                } catch (error) {
                    success = false;
                    result = { error: { code: error?.code || 'AI_TOOL_FAILED', message: error?.message || String(error) } };
                }
                trace.push({ name, args: this.#redactArgs(name, args), success, elapsedMs: Date.now() - startedAt, summary: this.#summary(result) });
                conversation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
            }
        }

        return this.#finalize({
            baseUrl, model, conversation, trace, usage, temperature,
            toolRounds: this.maxToolRounds, toolCalls: toolCallCount,
            reason: 'tool-round-budget'
        });
    }

    async #finalize({ baseUrl, model, conversation, trace, usage, temperature, toolRounds, toolCalls, reason }) {
        const finalConversation = [
            ...conversation,
            {
                role: 'system',
                content: [
                    'The tool phase is over.',
                    'Do not request or call any more tools.',
                    'Provide the best final answer now using only evidence already present in this conversation.',
                    'If the task is not fully complete, state exactly what remains instead of continuing exploration.',
                    'If code was changed, summarize changed files and verification evidence already obtained.'
                ].join(' ')
            }
        ];
        const response = await this.provider.complete({
            baseUrl,
            model,
            messages: finalConversation,
            tools: [],
            temperature
        });
        const content = String(response?.message?.content || '').trim();
        return {
            content: content || 'Đã hết ngân sách tool. Tôi đã dừng gọi tool; hãy thu hẹp yêu cầu hoặc tiếp tục từ kết quả hiện có.',
            trace,
            usage: response?.usage || usage,
            toolRounds,
            toolCalls,
            finalizedByBudget: true,
            finalizeReason: reason,
            model: response?.model || model
        };
    }

    #normalizeToolCalls(rawToolCalls, round) {
        return (Array.isArray(rawToolCalls) ? rawToolCalls : []).map((call, index) => ({
            id: String(call?.id || `mcbot-tool-${round}-${index}`),
            type: 'function',
            function: {
                name: String(call?.function?.name || ''),
                arguments: typeof call?.function?.arguments === 'string'
                    ? call.function.arguments
                    : JSON.stringify(call?.function?.arguments || {})
            }
        }));
    }

    #normalizeMessages(messages) {
        const allowed = [];
        for (const message of Array.isArray(messages) ? messages.slice(-30) : []) {
            const role = ['user', 'assistant'].includes(message?.role) ? message.role : null;
            if (!role) continue;
            const content = String(message?.content || '').slice(0, 30000);
            if (content) allowed.push({ role, content });
        }
        return allowed;
    }

    #parseArguments(value) {
        if (value && typeof value === 'object') return value;
        try { return JSON.parse(String(value || '{}')); } catch { return {}; }
    }

    #callSignature(name, args) {
        return `${String(name || '')}:${this.#stableStringify(args)}`;
    }

    #stableStringify(value) {
        if (Array.isArray(value)) return `[${value.map(item => this.#stableStringify(item)).join(',')}]`;
        if (value && typeof value === 'object') {
            return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${this.#stableStringify(value[key])}`).join(',')}}`;
        }
        return JSON.stringify(value);
    }

    #redactArgs(name, args) {
        if (name === 'write_file') return { ...args, content: `[${String(args?.content || '').length} chars]` };
        if (name === 'apply_patch') return { ...args, oldText: `[${String(args?.oldText || '').length} chars]`, newText: `[${String(args?.newText || '').length} chars]` };
        return args;
    }

    #summary(value) {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        return text.length > 600 ? `${text.slice(0, 600)}...` : text;
    }
}

module.exports = AgentSession;
