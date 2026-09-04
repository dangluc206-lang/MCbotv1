'use strict';

const { immutableClone } = require('../../shared/utils/object');
const WorkflowModulePresentationCatalog = require('./WorkflowModulePresentationCatalog');
const ModuleRegistry = require('./ModuleRegistry');
const { createBuiltinExecutors } = require('./WorkflowModuleExecutors');
const PRESENTATIONS = new WorkflowModulePresentationCatalog();
const EXECUTORS = createBuiltinExecutors();

const DESCRIPTORS = Object.freeze([
    ['command','Lệnh hệ thống đã đăng ký','commands','command-result',['server-command']],
    ['sky-command','Lệnh riêng theo Sky','sky-commands','command-result',['server-command']],
    ['slash-command','Lệnh / tùy chỉnh','slash-command','command-result',['server-command']],
    ['gui-click','Click GUI','gui','gui-result',['gui']],
    ['wait','Chờ',null,'wait-result',[]],
    ['move','Di chuyển','movement','movement-result',['movement']],
    ['home','Về đảo /is','island','teleport-result',['server-command']],
    ['sky-join','Vào Sky','skyblock','join-result',['server-command','gui']],
    ['close-gui','Đóng GUI','gui','gui-result',['gui']],
    ['read-storage','Đọc /kho','storage','storage-snapshot',['server-command','gui']],
    ['storage-protect','Bảo vệ kho','b1-materials','storage-protection-result',['server-command','gui','inventory']],
    ['b5-cycle','Một chu kỳ B5','b5-automation','b5-cycle-result',['server-command','gui','inventory']],
    ['wait-gui','Chờ GUI','gui','gui-session',['gui']],
    ['look','Nhìn hướng','rotation','rotation-result',[]],
    ['log','Ghi trạng thái',null,'log-result',[]],
    ['if','Điều kiện',null,'branch-result',[]],
    ['repeat','Lặp N lần',null,'repeat-result',[]]
].map(([type,label,capability,outputType,transientResources]) => Object.freeze({
    type,label,description:label,capability,outputType,cancellable:true,
    transientResources:Object.freeze(transientResources),
    serverProfiles:Object.freeze(
        ['wait','close-gui','look','log','if','repeat'].includes(type)
            ? ['generic','minecraft-generic','minerua']
            : ['minecraft-generic','minerua']
    ),
    errorCode:`WORKFLOW_MODULE_${type.toUpperCase().replaceAll('-', '_')}_FAILED`,
    i18nKey:`workflow.modules.${type}.failed`,
    executor:EXECUTORS[type],
    presentation:Object.freeze(PRESENTATIONS.require(type))
})));

class WorkflowModuleCatalog extends ModuleRegistry {
    constructor({ descriptors = [], ...options } = {}) {
        super({ ...options, descriptors: DESCRIPTORS });
        this.registerAll(descriptors);
    }
}

module.exports = WorkflowModuleCatalog;
module.exports.DESCRIPTORS = DESCRIPTORS.map(item => immutableClone(item));
