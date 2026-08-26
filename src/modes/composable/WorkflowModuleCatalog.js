'use strict';

const { immutableClone } = require('../../shared/utils/object');
const WorkflowModulePresentationCatalog = require('./WorkflowModulePresentationCatalog');
const PRESENTATIONS = new WorkflowModulePresentationCatalog();

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
    presentation:Object.freeze(PRESENTATIONS.require(type))
})));

const BY_TYPE = new Map(DESCRIPTORS.map(item => [item.type,item]));

class WorkflowModuleCatalog {
    has(type) { return BY_TYPE.has(String(type || '').trim()); }
    require(type) {
        const id=String(type || '').trim(); const value=BY_TYPE.get(id);
        if (!value) { const error=new Error(`Module không được hỗ trợ: ${id || '<trống>'}`); error.code='WORKFLOW_MODULE_UNKNOWN'; throw error; }
        return immutableClone(value);
    }
    list() { return DESCRIPTORS.map(item => immutableClone(item)); }
}

module.exports = WorkflowModuleCatalog;
