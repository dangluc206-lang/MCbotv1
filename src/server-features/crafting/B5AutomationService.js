'use strict';

// ponytail: compat alias — CraftAutomationService owns the implementation.
// B5AutomationService stays requireable for legacy consumers (collector-B5, replay/tests) only.
module.exports = require('./CraftAutomationService');
