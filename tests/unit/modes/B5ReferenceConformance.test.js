'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const createModeCatalog=require('../../../src/bootstrap/createModeCatalog');

test('WP-303 b5-craft descriptor is SDK-controlled and has no movement capability',()=>{
 const catalog=createModeCatalog({baseDir:path.resolve(__dirname,'../../..')});
 const descriptor=catalog.require('b5-craft');
 assert.equal(descriptor.metadata.kind,'builtin');
 assert.equal(descriptor.requiredCapabilities.includes('movement'),false);
 assert.deepEqual(descriptor.requestedResources,['primary-mode']);
 assert.ok(descriptor.requiredCapabilities.includes('b5-automation'));
 assert.ok(descriptor.requiredCapabilities.includes('b1-materials'));
});

test('WP-303 pure B5 mode owns no raw command/click/pathfinder side effect',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../../src/modes/b5-craft/B5CraftModeService.js'),'utf8');
 assert.doesNotMatch(source,/require\([^\n]*movement|require\([^\n]*pathfinder/i);
 assert.doesNotMatch(source,/\.clickWindow\s*\(/);
 assert.doesNotMatch(source,/\bbot\.chat\s*\(/);
 assert.doesNotMatch(source,/\bpathfinder\b/i);
});
