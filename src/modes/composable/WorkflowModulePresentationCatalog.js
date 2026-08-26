'use strict';

const FIELD = (key, label, type, options = {}) => Object.freeze({ key, label, type, ...options });
const EMPTY = Object.freeze([]);
const P = (category, risk, summary, fields = EMPTY, extra = {}) => Object.freeze({
    contract:'workflow-module-presentation-v1', category, risk, summary,
    fields:Object.freeze(fields), ...extra
});

const PRESENTATION = Object.freeze({
    command:P('COMMAND','HIGH','Gửi một lệnh đã đăng ký qua hàng đợi lệnh.',[FIELD('commandKey','Lệnh','command-key',{required:true}),FIELD('confirm','Chờ xác nhận','boolean'),FIELD('timeoutMs','Timeout (ms)','integer',{min:100,max:30000})]),
    'sky-command':P('COMMAND','HIGH','Gửi lệnh thuộc đúng Sky profile.',[FIELD('commandId','Mã lệnh Sky','text',{required:true}),FIELD('skyId','Sky','text')]),
    'slash-command':P('COMMAND','HIGH','Gửi slash command đã qua guard; cấm lệnh credential.',[FIELD('command','Slash command','text',{required:true,pattern:'^/'})]),
    'gui-click':P('GUI','HIGH','Click một slot GUI với postcondition tùy chọn.',[FIELD('slot','Slot','integer',{min:0,max:1000}),FIELD('button','Nút chuột','integer',{min:0,max:2}),FIELD('mode','Click mode','integer',{min:0,max:6}),FIELD('verifyGui','Xác minh GUI','boolean'),FIELD('timeoutMs','Timeout (ms)','integer',{min:100,max:30000})]),
    wait:P('CONTROL','LOW','Chờ có giới hạn và hỗ trợ hủy.',[FIELD('ms','Thời gian (ms)','integer',{min:0,max:3600000})]),
    move:P('MOVEMENT','HIGH','Di chuyển qua capability movement.',[FIELD('x','X','number'),FIELD('y','Y','number'),FIELD('z','Z','number'),FIELD('radius','Bán kính','number',{min:0.1,max:100}),FIELD('timeoutMs','Timeout (ms)','integer',{min:100,max:3600000})]),
    home:P('NAVIGATION','MEDIUM','Về đảo bằng capability /is.',EMPTY),
    'sky-join':P('NAVIGATION','HIGH','Vào Sky theo server profile.',[FIELD('selection','Lựa chọn Sky','text')]),
    'close-gui':P('GUI','MEDIUM','Đóng GUI hiện tại.',EMPTY),
    'read-storage':P('STORAGE','MEDIUM','Đọc fresh /kho và trả snapshot.',EMPTY),
    'storage-protect':P('B5','HIGH','Boundary bắt buộc: fresh kho, nung sắt/vàng, nén, baseline, bán 64, giữ dư, verify 1,5 B5.',EMPTY,{fixedContract:'b5-storage-protection-v1'}),
    'b5-cycle':P('B5','HIGH','Chạy đúng một chu kỳ B5 đã được bảo vệ.',EMPTY,{fixedContract:'b5-cycle-v1'}),
    'wait-gui':P('GUI','MEDIUM','Chờ GUI identity có giới hạn.',[FIELD('guiId','GUI ID','text'),FIELD('timeoutMs','Timeout (ms)','integer',{min:100,max:30000})]),
    look:P('MOVEMENT','LOW','Đổi góc nhìn qua rotation capability.',[FIELD('yaw','Yaw','number'),FIELD('pitch','Pitch','number'),FIELD('force','Buộc cập nhật','boolean')]),
    log:P('OBSERVABILITY','LOW','Ghi một thông điệp trạng thái đã giới hạn.',[FIELD('level','Mức','enum',{values:['debug','info','warn','error']}),FIELD('message','Thông điệp','text',{maxLength:1000})]),
    if:P('CONTROL','MEDIUM','Rẽ nhánh bằng predicate có kiểu, không chạy mã tùy ý.',[FIELD('condition.type','Điều kiện','enum',{values:['connected','gui-open','not-gui-open']}),FIELD('condition.guiId','GUI ID','text')],{nestedSections:['then','else']}),
    repeat:P('CONTROL','MEDIUM','Lặp hữu hạn; giới hạn cứng 1..1000.',[FIELD('count','Số lần','integer',{min:1,max:1000})],{nestedSections:['steps']})
});

class WorkflowModulePresentationCatalog {
    require(type) {
        const value = PRESENTATION[String(type || '').trim()];
        if (!value) { const error = new Error(`Không có presentation schema cho module: ${type}`); error.code = 'WORKFLOW_MODULE_PRESENTATION_MISSING'; throw error; }
        return JSON.parse(JSON.stringify(value));
    }
    list() { return Object.entries(PRESENTATION).map(([type, presentation]) => ({ type, presentation:this.require(type) })); }
}

module.exports = WorkflowModulePresentationCatalog;
