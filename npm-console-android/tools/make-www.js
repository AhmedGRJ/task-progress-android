/* Copies the dashboard (../npm-progress-pwa) into www/ for the Android build.
   The service worker is left out: the app files are already inside the APK, and a cached copy
   would keep showing the old version after an update. */
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', '..', 'npm-progress-pwa'), dst = path.join(__dirname, '..', 'www');
const skip = new Set(['start.bat', 'start.sh', 'server.py', 'sw.js', 'README.md', 'sync-relay.js', '__pycache__', 'manifest.webmanifest']);
fs.rmSync(dst, { recursive: true, force: true });
(function copy(a, b) {
  fs.mkdirSync(b, { recursive: true });
  for (const f of fs.readdirSync(a)) {
    if (skip.has(f)) continue;
    const s = path.join(a, f), d = path.join(b, f);
    fs.statSync(s).isDirectory() ? copy(s, d) : fs.copyFileSync(s, d);
  }
})(src, dst);
const idx = path.join(dst, 'index.html');
let html = fs.readFileSync(idx, 'utf8');
html = html.replace(/<link[^>]*rel="manifest"[^>]*>\s*/i, '');
html = html.replace("if('serviceWorker' in navigator &&", "if(false && 'serviceWorker' in navigator &&");
const at = html.lastIndexOf('</body>'); // the last one: an earlier </body> sits inside a JS template string
html = html.slice(0, at) + '<script src="android.js"></script>\n' + html.slice(at);
fs.copyFileSync(path.join(__dirname, 'android.js'), path.join(dst, 'android.js'));
fs.writeFileSync(idx, html);
console.log('www/ ready (' + fs.readdirSync(dst).length + ' entries)');
