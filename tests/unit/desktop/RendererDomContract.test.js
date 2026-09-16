'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER_ROOT = path.join(__dirname, '..', '..', '..', 'src', 'desktop', 'renderer');

function listRendererFiles(root) {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(root);
  return files;
}

function collectHtmlIds() {
  const html = fs.readFileSync(path.join(RENDERER_ROOT, 'index.html'), 'utf8');
  const ids = new Set();
  for (const match of html.matchAll(/id="([^"]+)"/g)) ids.add(match[1]);
  return ids;
}

// Regression for: "DesktopRenderer Cannot set properties of null (setting 'textContent')".
// Root cause: updateLogUnread() dereferenced $('#logUnreadBadge') but the element was
// missing from index.html, crashing initialize() -> renderLogs() and every onLog push
// while the logs page was not active. This contract keeps renderer JS ids in sync with
// the static DOM so a missing element fails this test instead of crashing the renderer.
test('renderer DOM contract: every id referenced by renderer JS exists in index.html', () => {
  const htmlIds = collectHtmlIds();
  const missing = [];
  for (const file of listRendererFiles(RENDERER_ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    const references = [
      ...src.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g),
      ...src.matchAll(/querySelector\('#([A-Za-z0-9_-]+)'\)/g)
    ];
    for (const match of references) {
      if (!htmlIds.has(match[1])) missing.push(`${path.relative(RENDERER_ROOT, file)} -> #${match[1]}`);
    }
  }
  assert.deepEqual(missing, [], 'renderer JS must only reference ids present in index.html');
});

test('log unread badge pair exists so updateLogUnread cannot crash on a null element', () => {
  const htmlIds = collectHtmlIds();
  for (const id of ['logUnreadBadge', 'logPausedHint', 'logPause']) {
    assert.ok(htmlIds.has(id), `index.html must contain #${id}`);
  }
});

test('renderFreshness live-state strong element exists for direct textContent write', () => {
  const html = fs.readFileSync(path.join(RENDERER_ROOT, 'index.html'), 'utf8');
  assert.match(html, /id="liveState"[\s\S]*?<strong>/, '#liveState must contain a <strong> child');
});