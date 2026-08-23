'use strict';

const { signature: failureSignature } = require('../../diagnostics/runtime/RuntimeFailureEvent');
const Redactor = require('../../shared/security/Redactor');

class DiscordErrorReporter {
    constructor({ botRegistry, logger = null, enabled, duplicateWindowMs, clock = () => Date.now() } = {}) {
        if (typeof enabled !== 'boolean') throw new TypeError('DiscordErrorReporter enabled must be boolean.');
        if (!Number.isFinite(Number(duplicateWindowMs)) || Number(duplicateWindowMs) < 0) {
            throw new TypeError('DiscordErrorReporter duplicateWindowMs must be a non-negative number.');
        }
        this.botRegistry = botRegistry;
        this.logger = logger;
        this.enabled = enabled;
        this.duplicateWindowMs = Number(duplicateWindowMs);
        this.clock = clock;
        this.channel = null;
        this.discord = null;
        this.registryOff = null;
        this.runtimeSubscriptions = new Map();
        this.seenFailureIds = new Map();
        this.buckets = new Map();
        this.timer = null;
        this.sendChain = Promise.resolve();
    }

    start({ channel, discord }) {
        if (!this.enabled) return;
        this.registryOff?.();
        this.registryOff = null;
        for (const [botId, subscription] of [...this.runtimeSubscriptions.entries()]) {
            this.#detachRuntime(botId, subscription.runtime);
        }
        clearTimeout(this.timer);
        this.timer = null;
        this.channel = channel;
        this.discord = discord;
        for (const runtime of this.botRegistry.list()) this.#attachRuntime(runtime);
        this.registryOff = this.botRegistry.onChange?.(change => {
            if (change.type === 'registered') this.#attachRuntime(change.runtime);
            else if (change.type === 'removed') this.#detachRuntime(change.botId, change.runtime);
        }) || null;
    }

    async stop() {
        this.registryOff?.();
        this.registryOff = null;
        for (const [botId, subscription] of [...this.runtimeSubscriptions.entries()]) {
            this.#detachRuntime(botId, subscription.runtime);
        }
        clearTimeout(this.timer);
        this.timer = null;
        if (this.enabled) await this.#flushExpired(true);
        await this.sendChain;
        this.seenFailureIds.clear();
        this.buckets.clear();
        this.channel = null;
        this.discord = null;
    }

    async destroy() { await this.stop(); }

    async report(event = {}) {
        if (!this.enabled || !this.channel?.send || !event || typeof event !== 'object') return null;
        const sanitized = Redactor.sanitize(event) || {};
        const now = this.clock();
        this.#pruneSeen(now);
        const failureIdKey = sanitized.failureId ? `${sanitized.botId || 'unknown'}|${sanitized.failureId}` : null;
        if (failureIdKey && this.seenFailureIds.has(failureIdKey)) return null;
        if (failureIdKey) this.seenFailureIds.set(failureIdKey, now);

        if (this.duplicateWindowMs === 0) return this.#sendInitial(sanitized);

        const key = failureSignature(sanitized);
        const existing = this.buckets.get(key);
        if (existing && now - existing.lastAt <= this.duplicateWindowMs) {
            if (existing.pendingRepeatCount > 0
                && now - existing.summaryWindowStartedAt > this.duplicateWindowMs) {
                await this.#flushBucket(key, existing, { remove: false });
            }
            existing.pendingRepeatCount += 1;
            existing.lastAt = now;
            existing.lastEvent = sanitized;
            this.#schedule();
            return null;
        }
        if (existing) await this.#flushBucket(key, existing, { remove: true });

        this.buckets.set(key, {
            firstAt: now,
            lastAt: now,
            summaryWindowStartedAt: now,
            pendingRepeatCount: 0,
            firstEvent: sanitized,
            lastEvent: sanitized
        });
        this.#schedule();
        return this.#sendInitial(sanitized);
    }

    #attachRuntime(runtime) {
        if (!this.enabled || !runtime?.botId) return;
        const current = this.runtimeSubscriptions.get(runtime.botId);
        if (current?.runtime === runtime) return;
        if (current) this.#detachRuntime(runtime.botId, current.runtime);
        const eventBus = runtime.getService?.('eventBus');
        if (!eventBus?.on) return;
        const off = eventBus.on('runtime:failure', event => {
            this.report(event).catch(error => this.logger?.debug?.('Discord error report skipped.', { error: Redactor.sanitize(error) }));
        });
        this.runtimeSubscriptions.set(runtime.botId, { runtime, off });
    }

    #detachRuntime(botId, runtime = null) {
        const current = this.runtimeSubscriptions.get(botId);
        if (!current || runtime && current.runtime !== runtime) return;
        current.off?.();
        this.runtimeSubscriptions.delete(botId);
    }

    #schedule() {
        clearTimeout(this.timer);
        this.timer = null;
        if (!this.enabled || this.buckets.size === 0 || this.duplicateWindowMs === 0) return;
        const now = this.clock();
        let earliest = Infinity;
        for (const bucket of this.buckets.values()) {
            const inactiveDue = bucket.lastAt + this.duplicateWindowMs;
            const periodicDue = bucket.pendingRepeatCount > 0
                ? bucket.summaryWindowStartedAt + this.duplicateWindowMs
                : Infinity;
            earliest = Math.min(earliest, inactiveDue, periodicDue);
        }
        if (!Number.isFinite(earliest)) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.#flushExpired(false).catch(error => this.logger?.debug?.('Discord repeat summary skipped.', { error: Redactor.sanitize(error) }));
        }, Math.max(0, earliest - now));
        this.timer.unref?.();
    }

    async #flushExpired(all) {
        if (!this.enabled || this.duplicateWindowMs === 0) return;
        const now = this.clock();
        for (const [key, bucket] of [...this.buckets.entries()]) {
            if (all) {
                await this.#flushBucket(key, bucket, { remove: true });
                continue;
            }
            const periodicDue = bucket.pendingRepeatCount > 0
                && now - bucket.summaryWindowStartedAt >= this.duplicateWindowMs;
            const inactive = now - bucket.lastAt >= this.duplicateWindowMs;
            if (periodicDue) await this.#flushBucket(key, bucket, { remove: false });
            if (inactive) {
                if (bucket.pendingRepeatCount > 0) await this.#flushBucket(key, bucket, { remove: false });
                this.buckets.delete(key);
            }
        }
        this.#schedule();
    }

    async #flushBucket(key, bucket, { remove } = {}) {
        if (remove) this.buckets.delete(key);
        const repeatCount = Math.max(0, Number(bucket.pendingRepeatCount || 0));
        if (repeatCount <= 0) return null;
        const summary = {
            repeatCount,
            firstAt: bucket.summaryWindowStartedAt,
            lastAt: bucket.lastAt,
            durationMs: Math.max(0, bucket.lastAt - bucket.summaryWindowStartedAt)
        };
        bucket.pendingRepeatCount = 0;
        bucket.summaryWindowStartedAt = this.clock();
        return this.#sendSummary(bucket.lastEvent, summary);
    }

    #sendInitial(event) { return this.#enqueueSend(() => this.#sendEmbed('Runtime failure', event)); }
    #sendSummary(event, summary) { return this.#enqueueSend(() => this.#sendEmbed('Runtime failure repeats', event, summary)); }

    #enqueueSend(task) {
        const next = this.sendChain.then(task);
        this.sendChain = next.catch(error => {
            this.logger?.debug?.('Discord error send queue recovered after an unexpected rejection.', { error: Redactor.sanitize(error) });
        });
        return next;
    }

    async #sendEmbed(title, rawEvent, summary = null) {
        if (!this.enabled || !this.channel?.send || !this.discord?.EmbedBuilder) return null;
        const event = Redactor.sanitize(rawEvent) || {};
        const now = this.clock();
        const fields = [
            { name: 'Bot', value: `\`${this.#limit(event.botId || 'unknown', 100)}\``, inline: true },
            { name: 'Thời gian', value: `<t:${Math.floor(now / 1000)}:T>`, inline: true }
        ];
        if (event.code) fields.push({ name: 'Mã lỗi', value: `\`${this.#limit(event.code, 100)}\``, inline: true });
        if (event.operation) fields.push({ name: 'Luồng', value: `\`${this.#limit(event.operation, 100)}\``, inline: true });
        if (event.step) fields.push({ name: 'Bước', value: `\`${this.#limit(event.step, 100)}\``, inline: true });
        if (event.action) fields.push({ name: 'Hành động', value: `\`${this.#limit(event.action, 100)}\``, inline: true });
        if (event.resource) fields.push({ name: 'Đối tượng', value: `\`${this.#limit(event.resource, 100)}\``, inline: true });
        if (event.failureId) fields.push({ name: 'Failure ID', value: `\`${this.#limit(event.failureId, 100)}\``, inline: true });
        fields.push({ name: 'Chi tiết', value: this.#limit(event.message || 'Không có chi tiết.', 1000) });
        if (summary) fields.push({ name: 'Lặp lại', value: `${summary.repeatCount} lần trong ${summary.durationMs} ms`, inline: false });
        const details = event.details || event.diagnostic?.details;
        if (details) fields.push({ name: 'Diagnostic', value: this.#limit(`\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\``, 1000) });

        try {
            const embed = new this.discord.EmbedBuilder().setTitle(title).addFields(...fields.slice(0, 25)).setFooter({ text: 'mcbot-error' });
            await this.channel.send({ embeds: [embed] });
            return true;
        } catch (error) {
            this.logger?.error?.('Failed to send Discord error report.', { error: Redactor.sanitize(error) });
            return false;
        }
    }

    #pruneSeen(now) {
        const keepMs = Math.max(this.duplicateWindowMs * 3, 60_000);
        for (const [id, at] of this.seenFailureIds) if (now - at > keepMs) this.seenFailureIds.delete(id);
    }

    #limit(text, max) {
        const value = String(text || '');
        return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
    }
}

module.exports = DiscordErrorReporter;
