// Mobile entry point. The Android app runs:  node main.mjs
// Env set by the app:
//   LEO_MOBILE=1          enable loopback-only listening
//   LEO_DATA_DIR=<path>   private app storage (/data/user/0/<pkg>/files/leo)
//   PORT=3000
// The bot stores telebot.db, session_*.txt and *.json next to its own file.
// So we copy the bundle into LEO_DATA_DIR once (and on version change) and
// run it from there. The bot code itself stays exactly the same.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, 'app');
const dataDir = process.env.LEO_DATA_DIR || path.join(here, 'data');
process.env.LEO_MOBILE = process.env.LEO_MOBILE || '1';

await import('./preload.mjs');

const version = fs.readFileSync(path.join(appDir, 'VERSION'), 'utf8').trim();
const stamp = path.join(dataDir, '.bundle_version');
const current = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';

if (current !== version) {
  fs.mkdirSync(dataDir, { recursive: true });
  // Copy code + UI files. Never overwrite user data (db, sessions, json state)
  // that already exists in dataDir.
  for (const name of fs.readdirSync(appDir)) {
    const src = path.join(appDir, name);
    const dst = path.join(dataDir, name);
    const isCode = name === 'server.mjs' || name === 'src' || name === 'node_modules' || name === 'package.json' ||
      name.endsWith('.html') || name.endsWith('.mjs') || name === 'sw.js' || name === 'icons' || name === 'manifest.json';
    if (!isCode && fs.existsSync(dst)) continue;
    fs.cpSync(src, dst, { recursive: true, force: true });
  }
  fs.writeFileSync(stamp, version);
  console.log(`[MOBILE] bundle ${version} installed to ${dataDir}`);
}

process.chdir(dataDir);
await import(pathToFileURL(path.join(dataDir, 'server.mjs')).href);
