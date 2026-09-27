'use strict';

const B5AutomationService = require('./B5AutomationService');

// Generic crafting automation authority (slice 4).
//
// Same engine, generic import path: the result contract is already generic
// ({ targetId, completedTarget, completedAmount } + blockers). B5AutomationService
// stays as the legacy alias (same class hierarchy, no impl split); the composition
// root instantiates this class once and exposes it under both
// "crafting-automation" and "b5-automation" capability names.
class CraftAutomationService extends B5AutomationService {}

module.exports = CraftAutomationService;
