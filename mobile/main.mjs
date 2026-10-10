// Mobile entry point: node main.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, 'app');
const dataDir = process.env.LEO_DATA_DIR || path.join(here, 'data');
process.env.LEO_MOBILE = '1';

// Setup file logger so phone UI can display boot logs
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
  log('[INIT] preload.mjs loaded (Loopback secured)');
} catch (e) {
  log(`[WARN] preload error: ${e.message}`);
}

// Ensure database and dynamic storage dirs exist in dataDir
try {
  const dbDir = path.join(dataDir, 'db');
  fs.mkdirSync(dbDir, { recursive: true });
} catch {}

log(`Launching bot server from ${appDir}...`);
process.chdir(appDir);

process.on('uncaughtException', (err) => {
  log(`[UNCAUGHT EXCEPTION] ${err.stack || err.message}`);
});

process.on('unhandledRejection', (reason) => {
  log(`[UNHANDLED REJECTION] ${reason}`);
});

try {
  const serverPath = path.join(appDir, 'server.mjs');
  log(`Importing: ${serverPath}`);
  await import(pathToFileURL(serverPath).href);
  log('[SUCCESS] server.mjs active and listening on port 3000');
} catch (err) {
  log(`[FATAL ERROR launching server.mjs] ${err.stack || err.message}`);
  // Keep process alive so logcat and phone UI can read the crash
  setInterval(() => {}, 10000);
}
