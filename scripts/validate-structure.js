'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const required=['AGENTS.md','RULES.md','JS_RESPONSIBILITIES.md','package.json','src/index.js','src/bootstrap/createApplication.js','src/core/Application.js','src/bot/BotRegistry.js','src/server-features/ServerFeatureFacade.js','src/server-features/authentication/ServerLoginService.js','src/server-features/skyblock/SkyblockJoinOperation.js','src/server-features/skyblock/SkyblockService.js','src/diagnostics/GuiInspectionService.js','src/diagnostics/GuiSnapshotSerializer.js','src/discord/DiscordService.js','src/discord/commands/GuiInspectionCommand.js','src/bootstrap/registerDiscordServices.js','config/app.json','config/server.json','config/commands/commands.json','config/authentication/login.json','config/skyblock/join.json','config/discord/discord.json','config/server-data/recipes.json'];
let failures=0;
for(const item of required){const full=path.join(root,item);if(!fs.existsSync(full)||fs.statSync(full).size===0){console.error(`[FAIL] ${item}`);failures+=1;}else console.log(`[PASS] ${item}`);}
const markdown=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git'].includes(entry.name))continue;const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(entry.name.endsWith('.md'))markdown.push(path.relative(root,full).split(path.sep).join('/'));}}walk(root);
const allowed=new Set(['AGENTS.md','RULES.md','JS_RESPONSIBILITIES.md']);for(const file of markdown)if(!allowed.has(file)){console.error(`[FAIL] Unauthorized Markdown file: ${file}`);failures+=1;}
console.log(`Validation completed with ${failures} failure(s).`);process.exitCode=failures?1:0;
