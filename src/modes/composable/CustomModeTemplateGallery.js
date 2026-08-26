'use strict';

const WorkflowDefinitionValidator = require('./WorkflowDefinitionValidator');

const TEMPLATES = Object.freeze([
    { id:'safe-command-loop', label:'Lệnh có nhịp', risk:'MEDIUM', definition:{ id:'safe-command-loop', label:'Lệnh có nhịp', workflow:{ loop:{ intervalMs:1000, steps:[{ type:'slash-command', command:'/is' },{ type:'wait', ms:1000 }] } } } },
    { id:'b5-safe-cycle', label:'B5 thuần an toàn', risk:'HIGH', definition:{ id:'b5-safe-cycle', label:'B5 thuần an toàn', description:'Không di chuyển; protection contract cố định.', workflow:{ start:[{ type:'home' }], loop:{ intervalMs:1000, steps:[{ type:'read-storage' },{ type:'storage-protect' },{ type:'b5-cycle' },{ type:'wait', ms:1000 }] } } } },
    { id:'gui-observation', label:'Chờ và đóng GUI', risk:'MEDIUM', definition:{ id:'gui-observation', label:'Chờ và đóng GUI', workflow:{ loop:{ intervalMs:1000, steps:[{ type:'wait-gui', guiId:null, timeoutMs:5000 },{ type:'log', level:'info', message:'GUI đã sẵn sàng' },{ type:'close-gui' }] } } } },
    { id:'bounded-movement', label:'Di chuyển hữu hạn', risk:'HIGH', definition:{ id:'bounded-movement', label:'Di chuyển hữu hạn', workflow:{ loop:{ intervalMs:2000, steps:[{ type:'move', x:0, y:64, z:0, radius:1.2, timeoutMs:30000 },{ type:'wait', ms:500 }] } } } }
].map(value => Object.freeze(value)));

class CustomModeTemplateGallery {
    constructor({ validator = new WorkflowDefinitionValidator() } = {}) { this.validator = validator; }
    list() { return TEMPLATES.map(item => this.#presentation(item)); }
    require(id) {
        const value = TEMPLATES.find(item => item.id === id);
        if (!value) throw new Error(`Custom mode template không tồn tại: ${id}`);
        return this.#presentation(value);
    }
    #presentation(value) {
        const copy = JSON.parse(JSON.stringify(value));
        const normalized = this.validator.normalize(copy.definition);
        return {
            ...copy,
            contract:'mcbot-custom-mode-template-v1',
            schemaVersion:1,
            supportStatus:'BETA',
            serverProfileCompatibility:['minerua'],
            requiredCapabilities:[...normalized.requiredCapabilities],
            requestedResources:[...normalized.requestedResources],
            limitations:['Static dry-run does not prove success on a live server.'],
            definition:JSON.parse(JSON.stringify(normalized))
        };
    }
}

module.exports = CustomModeTemplateGallery;
