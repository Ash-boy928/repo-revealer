// Builds the phone bundle from the UNCHANGED backend.
//   1. assembles backend/server.build.ts and verifies it equals the original
//   2. bundles it + all npm deps into one plain-JS file (no TypeScript at runtime)
//   3. copies UI/PWA files and starter JSON next to it
// Output: mobile/dist/  (main.mjs, preload.mjs, app/...)
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '../backend');
const dist = path.join(here, 'dist');
const app = path.join(dist, 'app');
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

run('node scripts/assemble.mjs --verify', backend);
if (!fs.existsSync(path.join(backend, 'node_modules'))) run('npm ci || npm install', backend);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });

run(
  `npx --yes esbuild@0.24.0 server.build.ts --bundle --platform=node --format=esm ` +
    `--target=node18 --outfile=${path.join(app, 'server.mjs')} ` +
    `--external:node:sqlite --minify-whitespace --legal-comments=none ` +
    `--banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);"`,
  backend,
);

const skip = new Set(['node_modules', 'scripts', 'src', 'server.build.ts', 'package.json', 'package-lock.json',
  'tsconfig.json', 'modules.manifest.json', 'README.md', 'SPLIT.md', 'PRD.md', 'prd.html']);
for (const name of fs.readdirSync(backend)) {
  if (skip.has(name) || name.endsWith('.ts') || name.endsWith('.db') || name.endsWith('.db-wal') || name.startsWith('session_')) continue;
  fs.cpSync(path.join(backend, name), path.join(app, name), { recursive: true });
}

fs.writeFileSync(path.join(app, 'VERSION'), String(Date.now()));
fs.copyFileSync(path.join(here, 'main.mjs'), path.join(dist, 'main.mjs'));
fs.copyFileSync(path.join(here, 'preload.mjs'), path.join(dist, 'preload.mjs'));
const kb = (fs.statSync(path.join(app, 'server.mjs')).size / 1024).toFixed(0);
console.log(`[mobile] bundle ready in mobile/dist (server.mjs ${kb} KB)`);
