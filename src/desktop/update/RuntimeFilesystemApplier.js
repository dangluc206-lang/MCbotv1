'use strict';

class RuntimeFilesystemApplier {
    constructor({ fsOps } = {}) { if (!fsOps) throw new TypeError('RuntimeFilesystemApplier fsOps is required.'); this.fs = fsOps; }
    copyFile(source, destination) { return this.fs.copyFile(source, destination); }
    rename(source, destination) { return this.fs.rename(source, destination); }
    remove(target, options) { return this.fs.rm(target, options); }
}

module.exports = RuntimeFilesystemApplier;
