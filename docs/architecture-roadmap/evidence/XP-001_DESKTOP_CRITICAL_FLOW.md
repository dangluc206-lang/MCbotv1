# XP-001 — Desktop critical-flow harness

Status: `DONE`

`tests/e2e/desktop/desktop-critical-flow.test.js` starts the real Electron renderer and preload in a sandboxed, hidden `BrowserWindow`. It copies only ConfigSpecs-owned static configuration into a temporary fixture; it never loads bot profiles, `.env`, runtime `data/**`, secrets or a public Minecraft server.

The flow verifies stopped launch, fake backend start, accessible-name navigation through every page, snapshot update, persistent backend failure banner, deterministic stale-state banner and clean shutdown. Console errors, renderer-reported errors and renderer process termination fail the test. A stable-shell screenshot is generated; successful runs clean the temporary artifact, failed runs retain the artifact path.

Run: `node --test tests/e2e/desktop/desktop-critical-flow.test.js`.
