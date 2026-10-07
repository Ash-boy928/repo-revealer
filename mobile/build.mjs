// Builds the phone bundle from the UNCHANGED backend.
//   1. assembles backend/server.build.ts and verifies it equals the original
//   2. converts each TypeScript file to plain JS one by one (same as `tsx` does
//      on the VPS) — files are NOT merged, so behaviour stays identical
//   3. copies production npm packages, UI/PWA files and starter JSON
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

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });

// 1) per-file TS -> JS (no bundling)
const tsFiles = ['server.build.ts'];
const walk = (d) => {
  for (const n of fs.readdirSync(path.join(backend, d))) {
    const rel = path.join(d, n);
    if (rel.startsWith(path.join('src', 'modules'))) continue; // already inside server.build.ts
    if (fs.statSync(path.join(backend, rel)).isDirectory()) walk(rel);
    else if (n.endsWith('.ts')) tsFiles.push(rel);
  }
};
walk('src');
run(
  `npx --yes esbuild@0.24.0 ${tsFiles.join(' ')} --format=esm --platform=node --target=node18 ` +
    `--outdir=${app} --outbase=. --out-extension:.js=.mjs`,
  backend,
);
// rewrite local "./x.ts" import paths to "./x.mjs"
const fix = (d) => {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) fix(p);
    else if (n.endsWith('.mjs')) {
      const s = fs.readFileSync(p, 'utf8').replace(/(from\s*|import\(\s*)(['"])(\.{1,2}\/[^'"]+)\.ts\2/g, '$1$2$3.mjs$2');
      fs.writeFileSync(p, s);
    }
  }
};
fix(app);
fs.renameSync(path.join(app, 'server.build.mjs'), path.join(app, 'server.mjs'));

// 2) production npm packages
fs.copyFileSync(path.join(backend, 'package.json'), path.join(app, 'package.json'));
if (fs.existsSync(path.join(backend, 'package-lock.json')))
  fs.copyFileSync(path.join(backend, 'package-lock.json'), path.join(app, 'package-lock.json'));
run('npm ci --omit=dev --no-audit --no-fund --ignore-scripts || npm install --omit=dev --no-audit --no-fund --ignore-scripts', app);

// 3) UI / PWA / starter config
const skip = new Set(['node_modules', 'scripts', 'src', 'server.build.ts', 'package.json', 'package-lock.json',
  'tsconfig.json', 'modules.manifest.json', 'README.md', 'SPLIT.md', 'PRD.md', 'prd.html']);
for (const name of fs.readdirSync(backend)) {
  if (skip.has(name) || name.endsWith('.ts') || name.endsWith('.db') || name.endsWith('.db-wal') || name.startsWith('session_')) continue;
  fs.cpSync(path.join(backend, name), path.join(app, name), { recursive: true });
}

fs.writeFileSync(path.join(app, 'VERSION'), String(Date.now()));
fs.copyFileSync(path.join(here, 'main.mjs'), path.join(dist, 'main.mjs'));
fs.copyFileSync(path.join(here, 'preload.mjs'), path.join(dist, 'preload.mjs'));
console.log('[mobile] bundle ready in mobile/dist');
