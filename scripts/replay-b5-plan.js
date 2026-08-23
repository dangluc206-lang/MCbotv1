'use strict';

const fs = require('node:fs');
const path = require('node:path');
const B5ExecutionPlanner = require('../src/planning/crafting/B5ExecutionPlanner');
const B5PlannerReplay = require('../src/simulation/b5/B5PlannerReplay');

const input = process.argv[2];
if (!input) {
    console.error('Usage: node scripts/replay-b5-plan.js <fixture.json>');
    process.exit(2);
}
const file = path.resolve(process.cwd(), input);
const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
const result = new B5PlannerReplay({ planner: new B5ExecutionPlanner() }).replay(fixture);
console.log(JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
