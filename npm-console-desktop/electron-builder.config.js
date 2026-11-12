// Build the installer with:  npm run dist:win
// The default update address is a local test server (npm run serve-updates).
// For a real address:  set UPDATE_URL=https://your-server/updates/  before building,
// or set it later inside the app with  /update url <address>
const url = process.env.UPDATE_URL || 'http://localhost:8099/';

module.exports = {
  appId: 'com.ahmedgraja.taskprogress',
  productName: 'Task Progress',
  directories: { output: 'dist' },
  files: ['main.js', 'preload.js', 'sync-relay.js', 'app/**/*', 'build/icon.png'],
  publish: [{ provider: 'generic', url }],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'build/icon.ico' },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false
  },
  linux: { target: ['AppImage'], icon: 'build/icon.png', category: 'Office' },
  mac: { target: ['dmg'], icon: 'build/icon.png', category: 'public.app-category.productivity' }
};
