'use strict';

class LiveConfigApplier {
    static async apply({ key, value, runtimes }) {
        const targets = [...(runtimes || [])];
        if (key === 'skyblock') {
            for (const runtime of targets) {
                const gateway = runtime.getService('skyblockAutoJoin');
                gateway?.reconfigure?.({ ...(value.modeJoin || {}), selection: gateway?.status?.().defaultTarget || value.defaultSelection });
            }
            return true;
        }
        if (key === 'skyCommands') {
            for (const runtime of targets) runtime.getService('skyCommandService')?.reconfigure?.(value);
            return true;
        }
        if (key === 'craftingMode') {
            for (const runtime of targets) {
                const mode = runtime.getService('craftingMode');
                mode?.reconfigure?.(value);
                if (value.enabled === false && mode?.status?.().enabled) await mode.disable('Chế tạo đã bị tắt trong cấu hình.');
            }
            return true;
        }
        if (key === 'b5') {
            for (const runtime of targets) runtime.getService('craftingMode')?.queueRulesConfig?.(value);
            return true;
        }
        return false;
    }
}

module.exports = LiveConfigApplier;
