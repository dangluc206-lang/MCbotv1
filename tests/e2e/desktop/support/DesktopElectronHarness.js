'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const ConfigSpecs = require('../../../../src/configuration/ConfigSpecs');
const packageJson = require('../../../../package.json');
const FakeDesktopRuntime = require('./FakeDesktopRuntime');

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const fixtureRoot = path.resolve(process.env.MCBOT_E2E_FIXTURE_ROOT || '');
const artifactRoot = path.resolve(process.env.MCBOT_E2E_ARTIFACT_ROOT || '');
const resultPrefix = 'MCBOT_E2E_RESULT:';
const CHANNELS = Object.freeze([
    'mcbot:backend:start', 'mcbot:backend:stop', 'mcbot:backend:restart', 'mcbot:snapshot', 'mcbot:health', 'mcbot:readiness', 'mcbot:b5:journey', 'mcbot:incidents:list',
    'mcbot:profiles:list', 'mcbot:commands', 'mcbot:sky-commands:get', 'mcbot:config:groups',
    'mcbot:config:group:get', 'mcbot:config:workspace:open', 'mcbot:config:workspace:preview', 'mcbot:config:backups', 'mcbot:custom-mode:modules', 'mcbot:custom-mode:templates', 'mcbot:custom-mode:list',
    'mcbot:config:b5-craft:get', 'mcbot:config:b5-rules:get', 'mcbot:config:storage-protection:get',
    'mcbot:config:sky-auto-join:get', 'mcbot:config:collector:get', 'mcbot:config:fishing:get',
    'mcbot:logs', 'mcbot:diagnostics:list', 'mcbot:app:info', 'mcbot:update:local-status',
    'mcbot:update:migration-status', 'mcbot:preferences:get', 'mcbot:secrets:status', 'mcbot:ai:status',
    'mcbot:renderer:error', 'mcbot:support:preview'
]);

function waitFor(webContents, expression, timeoutMs = 5000) {
    const message = JSON.stringify(`Timed out waiting for: ${expression}`);
    return webContents.executeJavaScript(`(async()=>{const end=Date.now()+${timeoutMs};while(Date.now()<end){if(${expression})return true;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error(${message});})()`, true);
}

async function clickButtonByName(webContents, name) {
    const encoded = JSON.stringify(name);
    return webContents.executeJavaScript(`(()=>{const expected=${encoded};const button=[...document.querySelectorAll('button')].find(node=>(node.getAttribute('aria-label')||node.textContent||'').trim().includes(expected));if(!button)throw new Error('Button not found: '+expected);button.click();return true;})()`, true);
}

async function run() {
    const runtime = new FakeDesktopRuntime({ fixtureRoot, specs: ConfigSpecs, appVersion: packageJson.version });
    const consoleErrors = [];
    let rendererGone = null;
    for (const channel of CHANNELS) {
        ipcMain.handle(channel, async (_event, ...args) => ({ success: true, data: await runtime.handle(channel, ...args) }));
    }

    const window = new BrowserWindow({
        show: false,
        width: 1440,
        height: 1000,
        webPreferences: {
            preload: path.join(projectRoot, 'src', 'desktop', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    window.webContents.on('console-message', (_event, level, message) => {
        if (level >= 3) {
            consoleErrors.push(String(message));
            process.stderr.write(`[renderer-console] ${String(message)}\n`);
        }
    });
    window.webContents.on('render-process-gone', (_event, details) => { rendererGone = details; });
    await window.loadFile(path.join(projectRoot, 'src', 'desktop', 'renderer', 'index.html'));
    try {
        await waitFor(window.webContents, "document.querySelector('#backendState')?.textContent.trim()==='Tắt'");
    } catch (error) {
        const state = await window.webContents.executeJavaScript("({text:document.querySelector('#backendState')?.textContent, ready:document.readyState, hasMcbot:Boolean(window.mcbot)})", true).catch(() => null);
        throw new Error(`${error.message}; rendererState=${JSON.stringify(state)}; rendererErrors=${JSON.stringify(runtime.rendererErrors)}; consoleErrors=${JSON.stringify(consoleErrors)}`);
    }

    const initialBanner = await window.webContents.executeJavaScript("!document.querySelector('#setupBanner').classList.contains('hidden')", true);
    await clickButtonByName(window.webContents, 'Khởi động');
    await waitFor(window.webContents, "document.querySelector('#backendState')?.textContent.includes('Đang chạy')");

    const pages = ['Bot', 'Chế độ', 'Tạo chế độ', 'Sự cố', 'Công cụ', 'Nhật ký', 'Chẩn đoán', 'AI Local', 'Cài đặt', 'Tổng quan'];
    for (const page of pages) {
        await clickButtonByName(window.webContents, page);
        await waitFor(window.webContents, `document.querySelector('#pageTitle')?.textContent===${JSON.stringify(page)}`);
    }

    const accessibility = await window.webContents.executeJavaScript(`(()=>{
      const failures=[];
      const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);
      const duplicateIds=[...new Set(ids.filter((id,index)=>ids.indexOf(id)!==index))];
      if(duplicateIds.length)failures.push({code:'DUPLICATE_ID',ids:duplicateIds});
      const unnamed=[...document.querySelectorAll('button,input,select,textarea')].filter(node=>{
        if(node.type==='hidden')return false;
        const externalLabel=node.id&&document.querySelector('label[for="'+CSS.escape(node.id)+'"]')?.textContent?.trim();
        return !(node.getAttribute('aria-label')||node.getAttribute('title')||node.textContent?.trim()||node.closest('label')?.textContent?.trim()||externalLabel);
      }).map(node=>node.id||node.tagName);
      if(unnamed.length)failures.push({code:'UNNAMED_CONTROL',controls:unnamed});
      const bodyFont=parseFloat(getComputedStyle(document.body).fontSize);
      if(bodyFont<14)failures.push({code:'BODY_FONT_TOO_SMALL',bodyFont});
      return {contract:'desktop-a11y-smoke-v1',failures,bodyFont,interactiveCount:document.querySelectorAll('button,input,select,textarea').length};
    })()`, true);
    const visualLayout = await window.webContents.executeJavaScript(`(()=>({contract:'desktop-visual-layout-v1',viewport:{width:innerWidth,height:innerHeight},navGroups:document.querySelectorAll('.nav-group-label').length,pages:document.querySelectorAll('.page').length,panels:document.querySelectorAll('.panel').length,horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}))()`, true);

    runtime.fail();
    window.webContents.send('mcbot:snapshot', runtime.snapshot());
    await waitFor(window.webContents, "document.querySelector('#setupBanner')?.textContent.includes('khởi động thất bại')");
    const failureBanner = await window.webContents.executeJavaScript("document.querySelector('#setupBanner').textContent", true);
    const staleVisible = await window.webContents.executeJavaScript(`(()=>{const original=Date.now;Date.now=()=>original()+20000;try{renderFreshness();return document.querySelector('#liveState').classList.contains('stale')&&document.querySelector('#liveState').textContent.includes('Mất cập nhật');}finally{Date.now=original;}})()`, true);

    runtime.stop();
    window.webContents.send('mcbot:snapshot', runtime.snapshot());
    await waitFor(window.webContents, "document.querySelector('#backendState')?.textContent.trim()==='Tắt'");
    const screenshotPath = path.join(artifactRoot, 'desktop-critical-shell.png');
    fs.writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
    const result = {
        ok: initialBanner && staleVisible && failureBanner.includes('khởi động thất bại') && consoleErrors.length === 0 && runtime.rendererErrors.length === 0 && !rendererGone,
        initialBanner,
        staleVisible,
        failureBanner,
        rendererErrors: runtime.rendererErrors,
        consoleErrors,
        rendererGone,
        accessibility,
        visualLayout,
        screenshotPath,
        fixtureVersion: packageJson.version,
        lifecycle: runtime.lifecycle
    };
    process.stdout.write(`${resultPrefix}${JSON.stringify(result)}\n`);
    window.destroy();
    app.quit();
}

if (!fixtureRoot || !artifactRoot) throw new Error('MCBOT_E2E_FIXTURE_ROOT and MCBOT_E2E_ARTIFACT_ROOT are required.');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', path.join(artifactRoot, 'electron-user-data'));
app.whenReady().then(run).catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.stdout.write(`${resultPrefix}${JSON.stringify({ ok: false, error: error.message, stack: error.stack || null, fixtureVersion: packageJson.version })}\n`);
    app.exit(1);
});
