'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const files = [
    'scripts/build-windows.js',
    'src/index.js',
    'src/bootstrap/shutdown.js',
    'src/core/TaskSupervisor.js',
    'src/modes/collector-b5/CollectorB5ModeService.js',
    'src/desktop/DesktopController.js',
    'src/desktop/update/GitHubUpdateService.js',
    'src/desktop/update/LocalZipUpdateService.js',
    'src/desktop/update/local-update-helper.js',
    'src/shared/logger/RuntimeLogOutput.js',
    'src/shared/cancellation/CancellationToken.js',
    'src/gui/knowledge/GuiKnowledgeRegistry.js',
    'src/movement/navigation/SprintJumpRouteExecutor.js',
    'src/gui/observation/GuiObservationStore.js',
    'src/items/inventory/observation/InventoryObservationStore.js',
    'src/diagnostics/runtime/RuntimeFailureRecorder.js',
    'src/discord/panels/DiscordPanelStore.js',
    'src/discord/errors/DiscordErrorReporter.js',
    'src/modes/composable/CustomModeStore.js',
    'src/ai/knowledge/ProjectWorkspace.js',
    'src/desktop/main.js',
    'scripts/create-local-update-package.js'
];

test('critical lifecycle/update/logging boundaries never silently swallow best-effort failures', () => {
    for (const relative of files) {
        const source = fs.readFileSync(path.join(root, relative), 'utf8');
        assert.equal(/catch\s*\{\s*\}/m.test(source), false, `${relative}: empty catch`);
        assert.equal(/\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/m.test(source), false, `${relative}: swallowed promise rejection`);
    }
});
