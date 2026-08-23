'use strict';

const SENSITIVE_COMMAND = /^\/(?:login|register|reg|l|auth|password|changepassword|cp)\b/i;

class SlashCommandService {
    constructor({ executor, maxLength = 256 } = {}) {
        if (!executor || typeof executor.execute !== 'function') throw new TypeError('SlashCommandService requires CommandExecutor.');
        this.executor = executor;
        this.maxLength = Math.max(16, Number(maxLength) || 256);
    }

    normalize(command) {
        const value = String(command || '').trim();
        if (!value.startsWith('/')) throw new TypeError('Lệnh tùy chỉnh phải bắt đầu bằng /.');
        if (value.length > this.maxLength) throw new TypeError(`Lệnh / không được dài quá ${this.maxLength} ký tự.`);
        if (/[\r\n\0]/.test(value)) throw new TypeError('Lệnh / chỉ được chứa một dòng.');
        if (SENSITIVE_COMMAND.test(value)) throw new TypeError('Lệnh đăng nhập/mật khẩu không được phép dùng trong Mode Builder.');
        return value;
    }

    async send(command, { cancellationToken = null, expectedGeneration = null } = {}) {
        return this.executor.execute(this.normalize(command), { cancellationToken, expectedGeneration, sensitive: false });
    }
}

module.exports = SlashCommandService;
