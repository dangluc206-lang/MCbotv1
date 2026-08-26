'use strict';

class LifecycleInstaller {
    static collect(required = [], optional = [], customModes = {}) {
        return [
            ...required.filter(Boolean),
            ...optional.filter(Boolean),
            ...Object.values(customModes).filter(Boolean)
        ];
    }
}

module.exports = LifecycleInstaller;
