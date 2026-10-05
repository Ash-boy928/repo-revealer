// Joins src/modules/* in manifest order into server.build.ts (byte-for-byte, no code changes).
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(fs.readFileSync(path.join(root, 'modules.manifest.json'), 'utf8'));
const out = m.modules.map(x => fs.readFileSync(path.join(root, 'src/modules', x.file), 'utf8')).join('');
fs.writeFileSync(path.join(root, 'server.build.ts'), out);
const sha = crypto.createHash('sha256').update(out).digest('hex');
const strict = process.argv.includes('--verify');
if (sha === m.originalSha256) console.log(`[assemble] OK: identical to original server.ts (${m.modules.length} modules)`);
else if (strict) { console.error('[assemble] FAIL: output differs from original server.ts'); process.exit(1); }
else console.log(`[assemble] built from edited modules (sha ${sha.slice(0, 12)})`);
