// Creates the "updates" folder for a signed release build.
// Usage: node tools/make-latest-json.js <address where the folder will be served> ["release notes"]
//   e.g. node tools/make-latest-json.js http://192.168.1.20:8099/ "Planner fixes"
const fs = require('fs');
const path = require('path');

const base = String(process.argv[2] || '').replace(/\/?$/, '/');
if (!/^https?:\/\//.test(base)) { console.error('Give the address the folder will be served from, e.g. http://192.168.1.20:8099/'); process.exit(1); }
const conf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'));
const dir = path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const exe = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.endsWith('-setup.exe') && f.includes(conf.version)) : null;
if (!exe || !fs.existsSync(path.join(dir, exe + '.sig'))) { console.error('No signed installer for version ' + conf.version + ' found. Build with: npm run build:release (and set TAURI_SIGNING_PRIVATE_KEY).'); process.exit(1); }

const out = path.join(__dirname, '..', 'updates');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(dir, exe), path.join(out, exe));
fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify({
  version: conf.version,
  notes: process.argv[3] || '',
  pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { signature: fs.readFileSync(path.join(dir, exe + '.sig'), 'utf8').trim(), url: base + encodeURIComponent(exe) } }
}, null, 2));
console.log('Wrote updates/latest.json and copied ' + exe + '. Serve it with: npm run serve-updates');
