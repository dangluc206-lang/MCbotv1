'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { immutableClone } = require('../shared/utils/object');

async function loadBotProfiles({ loader, validator, directory = 'config/bots', environment = process.env }) {
    const absolute = path.isAbsolute(directory)
        ? path.resolve(directory)
        : path.resolve(loader.baseDir, directory);
    let names = [];
    try {
        names = (await fs.readdir(absolute)).filter(name => name.endsWith('.json')).sort();
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }

    const profiles = await Promise.all(names.map(async name => {
        const profile = await loader.load(path.join(absolute, name));
        validator.assertValid('bot', profile);
        const fileId = path.basename(name, '.json');
        if (fileId !== profile.id) {
            throw new Error(`Bot profile filename/id mismatch: ${name} contains ${profile.id}`);
        }
        const envKey = `MCBOT_${profile.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PASSWORD`;
        return immutableClone({ ...profile, password: environment[envKey] || undefined });
    }));

    const ids = new Set();
    for (const profile of profiles) {
        if (ids.has(profile.id)) throw new Error(`Duplicate bot profile id: ${profile.id}`);
        ids.add(profile.id);
    }
    return Object.freeze(profiles);
}

module.exports = loadBotProfiles;
