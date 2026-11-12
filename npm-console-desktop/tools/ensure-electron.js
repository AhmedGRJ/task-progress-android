// Downloads the Electron program if npm blocked its install script (newer npm versions do this by default).
// Runs automatically after "npm install". It never fails the install: if the download is not possible it explains what to do.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'node_modules', 'electron');
if (!fs.existsSync(dir)) process.exit(0);
if (fs.existsSync(path.join(dir, 'path.txt')) && fs.existsSync(path.join(dir, 'dist'))) { console.log('Electron is already installed.'); process.exit(0); }

console.log('Downloading Electron (npm blocked its own install script)...');
const r = spawnSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit' });
if (r.status !== 0) {
  console.log('\nThe Electron download did not work. If your network blocks github.com, try:');
  console.log('  PowerShell:  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"; node node_modules\\electron\\install.js');
}
process.exit(0);
