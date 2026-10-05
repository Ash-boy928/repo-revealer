import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target files to protect and backup
const CRITICAL_FILES = [
  'telebot.db',
  'telebot.db-wal',
  'telebot.db-shm',
  'secret.key',
  'users.json',
  'accounts.json',
  'billing.json',
  'access_requests.json',
  'api_pool.json',
  'global_ai_config.json',
  'proxy_config.json',
  'theme_config.json',
  'server.ts'
];

function runBackup() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  
  const backupDir = path.join(__dirname, 'backups', `backup_${timestamp}`);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log('========================================================');
  console.log(`🛡️  TELEBOT DATA & CONFIGURATION SAFE BACKUP UTILITY`);
  console.log('========================================================');
  console.log(`Timestamp : ${timestamp}`);
  console.log(`Backup Dir: ${backupDir}`);
  console.log('--------------------------------------------------------');

  let copiedCount = 0;
  for (const file of CRITICAL_FILES) {
    const srcPath = path.join(__dirname, file);
    if (fs.existsSync(srcPath)) {
      const destPath = path.join(backupDir, file);
      try {
        fs.copyFileSync(srcPath, destPath);
        const stats = fs.statSync(srcPath);
        console.log(`  ✅ Backed up: ${file.padEnd(24)} (${Math.round(stats.size / 1024)} KB)`);
        copiedCount++;
      } catch (err) {
        console.warn(`  ⚠️ Failed to copy ${file}:`, err?.message || err);
      }
    } else {
      console.log(`  ℹ️ Skipped (not present): ${file}`);
    }
  }

  // Create compressed .tar.gz archive
  const archiveName = `telebot_backup_${timestamp}.tar.gz`;
  const archivePath = path.join(__dirname, 'backups', archiveName);
  try {
    execSync(`tar -czf "${archivePath}" -C "${path.join(__dirname, 'backups')}" "backup_${timestamp}"`, { stdio: 'pipe' });
    console.log('--------------------------------------------------------');
    console.log(`📦 Compressed Archive Created: backups/${archiveName}`);
  } catch (e) {
    // If tar is unavailable, the directory copy is still intact
    console.log('--------------------------------------------------------');
    console.log(`📁 Uncompressed Directory Preserved at: backups/backup_${timestamp}`);
  }

  console.log('========================================================');
  console.log(`🎉 BACKUP COMPLETE: ${copiedCount} critical files secured safely!`);
  console.log('========================================================\n');
}

runBackup();
