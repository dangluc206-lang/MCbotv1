'use strict';

const ConfigSpecs = require('../../../src/configuration/ConfigSpecs');
const DesktopApiContract = require('../../../src/desktop/contracts/DesktopApiContract');
const WorkflowDefinitionValidator = require('../../../src/modes/composable/WorkflowDefinitionValidator');

class ContractFixtureFactory {
    static desktopChannels() { return Object.keys(DesktopApiContract.CATALOG).sort(); }
    static configManifest() { return ConfigSpecs.map(spec => ({ key:spec.key, file:spec.file, schema:spec.schema })); }
    static moduleCatalog() { return new WorkflowDefinitionValidator().moduleCatalog(); }
    static profile(overrides = {}) {
        return Object.freeze({ id:'fixture-bot', displayName:'Fixture Bot', username:'pseudonymous-fixture', auth:'offline', version:'1.21.4', serverProfile:'test', skyblockSelection:'sky1', enabled:true, ...overrides });
    }
    static operatorSnapshot(botCount = 1) {
        return Object.freeze({ lifecycle:'RUNNING', bots:Array.from({ length:botCount }, (_, index) => ({ botId:`fixture-bot-${index + 1}`, profile:this.profile({ id:`fixture-bot-${index + 1}` }), state:{ connectionState:'CONNECTED' }, intent:{ desiredConnection:'CONNECTED' }, modes:{ byId:{} }, operation:{ operations:[] } })), system:{ startedAt:'2026-01-01T00:00:00.000Z', uptimeMs:1000, memoryMb:64 } });
    }
}

module.exports = ContractFixtureFactory;
