'use strict';

const { createForgeIgnore } = require('./scripts/build/ForgePackagingPolicy');

module.exports = {
  packagerConfig: {
    asar: true,
    prune: false,
    name: 'MCbot',
    executableName: 'MCbot',
    icon: 'assets/mcbot.ico',
    ignore: createForgeIgnore({ baseDir: __dirname })
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'mcbot_desktop',
        authors: 'MCbot',
        description: 'Desktop control application for the MCbot Mineflayer automation framework.',
        setupExe: 'MCbot Setup.exe',
        setupIcon: 'assets/mcbot.ico',
        noMsi: true
      }
    }
  ]
};
