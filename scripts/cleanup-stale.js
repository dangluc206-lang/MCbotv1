'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const STALE_PATHS = Object.freeze([
    'config/commands/aliases.json',
    'config/gui/click-profiles.json',
    'config/gui/items.json',
    'config/gui/layouts.json',
    'config/gui/transitions.json',
    'config/items/aliases.json',
    'config/items/categories.json',
    'config/items/match-rules.json',
    'config/movement/safety.json',
    'config/server-data/server-items.json',
    'config/storage/capacity.json',
    'src/configuration/schemas/commands.schema.js',
    'src/configuration/schemas/gui.schema.js',
    'src/configuration/schemas/items.schema.js',
    'src/configuration/schemas/movement.schema.js',
    'src/core/Container.js',
    'src/operations/OperationStatus.js',
    'src/items/ItemSnapshot.js',
    'src/connection/listeners/SpawnListener.js',
    'src/connection/listeners/ErrorListener.js',
    'src/connection/listeners/KickedListener.js',
    'src/connection/listeners/LoginListener.js',
    'src/connection/listeners/EndListener.js',
    'src/movement/listeners/DeathListener.js',
    'src/movement/listeners/TeleportListener.js',
    'src/movement/listeners/PositionListener.js',
    'src/movement/safety/RecoveryPositionStore.js',
    'src/movement/safety/FallDetector.js',
    'src/movement/safety/StuckDetector.js',
    'src/gui/slots/SlotSnapshot.js',
    'src/gui/listeners/SlotUpdateListener.js',
    'src/gui/listeners/WindowOpenListener.js',
    'src/gui/listeners/WindowUpdateListener.js',
    'src/gui/listeners/WindowCloseListener.js',
    'src/commands/responses/ResponseParser.js',
    'src/commands/responses/CommandFailureDetector.js',
    'src/commands/listeners/SystemMessageListener.js',
    'src/commands/listeners/ChatListener.js',
    'src/commands/listeners/MessageListener.js',
    'src/server-features/mining/AdaptiveMiningService.js',
    'src/server-features/ServerCharacteristicsStore.js',
    'data/runtime/server-characteristics.json'
]);

async function exists(file) {
    try {
        await fs.access(file);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

async function run({ apply = false } = {}) {
    const present = [];
    for (const relative of STALE_PATHS) {
        const file = path.resolve(root, relative);
        if (await exists(file)) present.push(relative);
    }

    if (!apply) {
        console.log(`Stale audit: ${present.length}/${STALE_PATHS.length} file(s) are present.`);
        for (const relative of present) console.log(`[dry-run] ${relative}`);
        console.log('Run `npm run cleanup:stale` to remove only this audited list.');
        return;
    }

    for (const relative of present) {
        await fs.rm(path.resolve(root, relative), { force: true });
        console.log(`[removed] ${relative}`);
    }

    const candidateDirs = [
        'src/connection/listeners',
        'src/movement/listeners',
        'src/gui/listeners',
        'src/commands/listeners'
    ];
    for (const relative of candidateDirs) {
        const dir = path.resolve(root, relative);
        try {
            const entries = await fs.readdir(dir);
            if (entries.length === 0) await fs.rmdir(dir);
        } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
        }
    }

    console.log(`Cleanup complete: ${present.length} stale file(s) removed.`);
    return { present, removed: present.length };
}

if (require.main === module) {
    run({ apply: process.argv.includes('--apply') }).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = Object.freeze({ STALE_PATHS, run });
