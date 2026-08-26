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
        if (key === 'b5CraftMode') {
            for (const runtime of targets) {
                const mode = runtime.getService('b5CraftMode');
                mode?.reconfigure?.(value);
                if (value.enabled === false && mode?.status?.().enabled) await mode.disable('Chế B5 thuần đã bị tắt trong cấu hình.');
            }
            return true;
        }
        if (key === 'b5') {
            for (const runtime of targets) runtime.getService('b5CraftMode')?.queueRulesConfig?.(value);
            return true;
        }
        return false;
    }
}

module.exports = LiveConfigApplier;
