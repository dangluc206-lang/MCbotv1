'use strict';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function normalizeBaseUrl(value = 'http://127.0.0.1:11434/v1') {
    const raw = String(value || '').trim() || 'http://127.0.0.1:11434/v1';
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Local AI URL must use http or https.');
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
        const error = new Error('Local AI provider must use localhost/127.0.0.1/::1.');
        error.code = 'AI_PROVIDER_NOT_LOCAL';
        throw error;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = '/v1';
    return parsed.toString().replace(/\/$/, '');
}

class OllamaProvider {
    constructor({ fetchImpl = globalThis.fetch, timeoutMs = 120000 } = {}) {
        if (typeof fetchImpl !== 'function') throw new TypeError('OllamaProvider requires fetch support.');
        this.fetch = fetchImpl;
        this.timeoutMs = Math.max(1000, Number(timeoutMs) || 120000);
    }

    async listModels({ baseUrl } = {}) {
        const root = normalizeBaseUrl(baseUrl);
        const payload = await this.#request(`${root}/models`, { method: 'GET' });
        return (payload?.data || []).map(model => ({
            id: String(model?.id || ''),
            created: model?.created ?? null,
            ownedBy: model?.owned_by || null
        })).filter(model => model.id);
    }

    async complete({ baseUrl, model, messages, tools = [], temperature = 0.1, maxTokens = 4096 } = {}) {
        const normalizedModel = String(model || '').trim();
        if (!normalizedModel) throw new Error('Chưa chọn model local AI.');
        const root = normalizeBaseUrl(baseUrl);
        const payload = await this.#request(`${root}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                model: normalizedModel,
                messages,
                tools: Array.isArray(tools) && tools.length ? tools : undefined,
                tool_choice: Array.isArray(tools) && tools.length ? 'auto' : undefined,
                temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.1,
                max_tokens: Math.max(256, Math.min(16384, Number(maxTokens) || 4096)),
                stream: false
            })
        });
        const message = payload?.choices?.[0]?.message;
        if (!message) {
            const error = new Error('Local AI returned no chat message.');
            error.code = 'AI_INVALID_RESPONSE';
            throw error;
        }
        return {
            message,
            usage: payload?.usage || null,
            model: payload?.model || normalizedModel
        };
    }

    async #request(url, init) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        timer.unref?.();
        try {
            const response = await this.fetch(url, { ...init, signal: controller.signal });
            const text = await response.text();
            let payload = null;
            try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
            if (!response.ok) {
                const detail = payload?.error?.message || payload?.error || payload?.message || text || `${response.status}`;
                const error = new Error(`Local AI request failed (${response.status}): ${String(detail).slice(0, 500)}`);
                error.code = 'AI_PROVIDER_REQUEST_FAILED';
                error.status = response.status;
                throw error;
            }
            return payload;
        } catch (error) {
            if (error?.name === 'AbortError') {
                const timeout = new Error(`Local AI request timed out after ${this.timeoutMs} ms.`);
                timeout.code = 'AI_PROVIDER_TIMEOUT';
                throw timeout;
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }
}

OllamaProvider.normalizeBaseUrl = normalizeBaseUrl;
module.exports = OllamaProvider;
