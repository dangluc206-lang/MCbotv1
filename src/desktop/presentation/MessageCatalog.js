'use strict';

const MESSAGES = Object.freeze({
    'nav.operate': 'Vận hành',
    'nav.build': 'Xây dựng',
    'nav.maintain': 'Bảo trì',
    'nav.advanced': 'Nâng cao',
    'status.running': 'Đang chạy',
    'status.retrying': 'Đang tự thử lại',
    'status.waiting': 'Đang chờ điều kiện',
    'status.needsAction': 'Cần xử lý',
    'term.mode': 'Chế độ',
    'term.batch': 'Đợt',
    'term.blocker': 'Điều kiện chặn',
    'term.retry': 'Thử lại có kiểm soát',
    'term.reserve': 'Mức dự trữ',
    'term.incident': 'Sự cố',
    'empty.incidents': 'Không có sự cố cần xử lý.',
    'error.messageMissing': 'Nội dung giao diện chưa được dịch.'
});

function message(key, values = {}) {
    const template = MESSAGES[key] || `[${key}] ${MESSAGES['error.messageMissing']}`;
    return template.replace(/\{([a-z0-9_]+)\}/gi, (_match, name) => String(values[name] ?? `{${name}}`));
}

module.exports = Object.freeze({ MESSAGES, message });
