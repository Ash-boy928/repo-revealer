import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target phone numbers to completely wipe and delete
const TARGET_PHONES = [
  '+919749238568',
  '+919064847087',
  '+917602192062'
];

// Also allow passing phone numbers via CLI: node clean_stale_accounts.js +91xxxxxxxxx
const cliArgs = process.argv.slice(2).filter(a => a && !a.startsWith('-'));
for (const arg of cliArgs) {
  if (!TARGET_PHONES.includes(arg)) {
    TARGET_PHONES.push(arg);
  }
}

console.log('========================================================');
console.log('🧹 TELEBOT DEEP PURGE: STALE / UNLINKED ACCOUNTS CLEANER');
console.log('========================================================');
console.log('Targets to wipe:', TARGET_PHONES.join(', '));
console.log('Directory:', __dirname);
console.log('--------------------------------------------------------');

// Normalize phone numbers to multiple lookup keys
const targetKeys = new Set();
const targetDigits = new Set();

for (const p of TARGET_PHONES) {
  const clean = p.trim();
  const digits = clean.replace(/[^0-9]/g, '');
  if (digits) {
    targetDigits.add(digits);
    targetKeys.add(clean);
    targetKeys.add(`+${digits}`);
    targetKeys.add(digits);
    if (digits.startsWith('91') && digits.length === 12) {
      targetKeys.add(digits.substring(2)); // local 10-digit
      targetDigits.add(digits.substring(2));
    }
  }
}

let removedFromAccounts = 0;
let removedFromUsers = 0;
let deletedFilesCount = 0;

// 1. Clean accounts.json
const accountsPath = path.join(__dirname, 'accounts.json');
if (fs.existsSync(accountsPath)) {
  try {
    const raw = fs.readFileSync(accountsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const initialCount = parsed.length;
      const filtered = parsed.filter((acc) => {
        const accPhone = String(acc?.phone || '').trim();
        const accDigits = accPhone.replace(/[^0-9]/g, '');
        const match = targetKeys.has(accPhone) || targetDigits.has(accDigits);
        if (match) {
          console.log(`[ACCOUNTS.JSON] Purging record: ${acc.label || 'Unknown'} (${acc.phone})`);
        }
        return !match;
      });
      fs.writeFileSync(accountsPath, JSON.stringify(filtered, null, 2), 'utf8');
      removedFromAccounts = initialCount - filtered.length;
      console.log(`✅ accounts.json cleaned! Removed ${removedFromAccounts} account(s). (Remaining: ${filtered.length})`);
    }
  } catch (err) {
    console.error('Error cleaning accounts.json:', err.message);
  }
} else {
  console.log('ℹ️ accounts.json not found in current folder.');
}

// 2. Clean users.json
const usersPath = path.join(__dirname, 'users.json');
if (fs.existsSync(usersPath)) {
  try {
    const raw = fs.readFileSync(usersPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      let modified = false;
      for (const u of parsed) {
        if (Array.isArray(u.registered_phones)) {
          const initLen = u.registered_phones.length;
          u.registered_phones = u.registered_phones.filter((p) => {
            const pDigits = String(p || '').replace(/[^0-9]/g, '');
            const match = targetKeys.has(p) || targetDigits.has(pDigits);
            if (match) {
              console.log(`[USERS.JSON] Unlinking slot for user "${u.username}": ${p}`);
            }
            return !match;
          });
          if (u.registered_phones.length !== initLen) {
            removedFromUsers += (initLen - u.registered_phones.length);
            modified = true;
          }
        }
      }
      if (modified) {
        fs.writeFileSync(usersPath, JSON.stringify(parsed, null, 2), 'utf8');
        console.log(`✅ users.json cleaned! Freed ${removedFromUsers} slot(s).`);
      }
    }
  } catch (err) {
    console.error('Error cleaning users.json:', err.message);
  }
}

// 3. Scan directory and delete all session, cache, and queue files matching target numbers
try {
  const allFiles = fs.readdirSync(__dirname);
  for (const file of allFiles) {
    const filePath = path.join(__dirname, file);
    // Skip directories
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) continue;
    } catch {
      continue;
    }

    // Check if filename contains any target phone digits
    for (const d of targetDigits) {
      if (d.length >= 10 && file.includes(d)) {
        try {
          fs.unlinkSync(filePath);
          deletedFilesCount++;
          console.log(`🗑️ Deleted file: ${file}`);
        } catch (err) {
          console.error(`Failed to delete ${file}:`, err.message);
        }
        break;
      }
    }
  }
} catch (err) {
  console.error('Error scanning directory for stale files:', err.message);
}

console.log('--------------------------------------------------------');
console.log('🎉 PURGE COMPLETED SUCCESSFULLY!');
console.log(`- Accounts removed from accounts.json: ${removedFromAccounts}`);
console.log(`- Slots freed in users.json: ${removedFromUsers}`);
console.log(`- Session/cache files wiped: ${deletedFilesCount}`);
console.log('========================================================');
console.log('👉 Next step: Restart PM2 on VPS using: pm2 restart telebot');
