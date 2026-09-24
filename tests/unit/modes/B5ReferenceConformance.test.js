'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const createModeCatalog=require('../../../src/bootstrap/createModeCatalog');

test('WP-303 generic crafting descriptor is SDK-controlled and has no movement capability',()=>{
 const catalog=createModeCatalog({baseDir:path.resolve(__dirname,'../../..')});
 const descriptor=catalog.require('crafting');
 assert.equal(descriptor.metadata.kind,'builtin');
 assert.equal(descriptor.label,'Chế tạo');
 assert.equal(descriptor.requiredCapabilities.includes('movement'),false);
 assert.deepEqual(descriptor.requestedResources,['primary-mode']);
 assert.ok(descriptor.requiredCapabilities.includes('crafting-automation'));
 assert.ok(descriptor.requiredCapabilities.includes('b1-materials'));
 assert.equal(catalog.list().some(entry => entry.id === 'b5-craft'), false, 'no parallel b5-craft mode may exist');
});

test('WP-303 pure B5 mode owns no raw command/click/pathfinder side effect',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../../src/modes/crafting/CraftingModeService.js'),'utf8');
 assert.doesNotMatch(source,/require\([^\n]*movement|require\([^\n]*pathfinder/i);
 assert.doesNotMatch(source,/\.clickWindow\s*\(/);
 assert.doesNotMatch(source,/\bbot\.chat\s*\(/);
 assert.doesNotMatch(source,/\bpathfinder\b/i);
});
