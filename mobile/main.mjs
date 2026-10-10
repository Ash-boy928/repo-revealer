// Mobile entry point: node main.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, 'app');
const dataDir = process.env.LEO_DATA_DIR || path.join(here, 'data');
process.env.LEO_MOBILE = process.env.LEO_MOBILE || '1';

// Setup file logger so phone UI can display boot logs and errors
fs.mkdirSync(dataDir, { recursive: true });
const logFile = path.join(dataDir, 'boot.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch {}
  console.log(msg);
}

log('--- LeoTeleBot Mobile Booting ---');
log(`appDir: ${appDir}`);
log(`dataDir: ${dataDir}`);

try {
  await import('./preload.mjs');
  log('preload.mjs loaded');
} catch (e) {
  log(`preload error: ${e.message}`);
}

const version = fs.readFileSync(path.join(appDir, 'VERSION'), 'utf8').trim();
const stamp = path.join(dataDir, '.bundle_version');
const current = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';

if (current !== version) {
  log(`Installing bundle version ${version}...`);
  for (const name of fs.readdirSync(appDir)) {
    const src = path.join(appDir, name);
    const dst = path.join(dataDir, name);
    // Node modules are large: symlink instead of copying to start in 1 second
    if (name === 'node_modules') {
      try {
        if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
        fs.symlinkSync(src, dst, 'junction');
      } catch {
        // Fallback if symlink unsupported
        if (!fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true });
      }
      continue;
    }
    const isCode = name === 'server.mjs' || name === 'src' || name === 'package.json' ||
      name.endsWith('.html') || name.endsWith('.mjs') || name === 'sw.js' || name === 'icons' || name === 'manifest.json';
    if (!isCode && fs.existsSync(dst)) continue;
    fs.cpSync(src, dst, { recursive: true, force: true });
  }
  fs.writeFileSync(stamp, version);
  log(`Bundle installed to ${dataDir}`);
}

log(`Starting LeoTeleBot server from ${dataDir}...`);
process.chdir(dataDir);

process.on('uncaughtException', (err) => {
  log(`[UNCAUGHT EXCEPTION] ${err.stack || err.message}`);
});

process.on('unhandledRejection', (reason) => {
  log(`[UNHANDLED REJECTION] ${reason}`);
});

try {
  await import(pathToFileURL(path.join(dataDir, 'server.mjs')).href);
  log('[SUCCESS] server.mjs loaded and running on port 3000');
} catch (err) {
  log(`[FATAL ERROR launching server.mjs] ${err.stack || err.message}`);
  setInterval(() => {}, 10000);
}
