'use strict';

// ponytail: single stage-contract owner is verification/StageExecutionContract
// (subsystem crafting, CRAFT_STAGE_*). This module is a compat alias so legacy
// B5 harnesses keep `require(.../b5/support/B5StageContract)` working without
// a parallel implementation.
module.exports = require('../../verification/StageExecutionContract');
