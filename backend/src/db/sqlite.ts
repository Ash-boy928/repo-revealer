import fs from 'fs';
import { SQLITE_DB_FILE } from '../config/constants.ts';

// ---------------- SQLITE CORRUPTION-PROOF DATABASE ENGINE (WAL MODE) ----------------
export let sqliteDb: any = null;

let DatabaseSync: any = null;
try {
  // Dynamic import inside safe catch so Node 18 doesn't crash
  const mod = await import('node:sqlite').catch(() => null);
  DatabaseSync = mod?.DatabaseSync || null;
} catch (e) {
  DatabaseSync = null;
}

if (DatabaseSync) {
  
      sqliteDb = new DatabaseSync(SQLITE_DB_FILE);
      sqliteDb.exec('PRAGMA journal_mode = WAL;');
      sqliteDb.exec('PRAGMA synchronous = NORMAL;');
    };

    try {
      initDb();
      console.log('[DATABASE] SQLite WAL Engine activated successfully (telebot.db).');
    } catch (openErr: any) {
      console.warn('[DATABASE] SQLite initial open failed (stale WAL/SHM detected), self-healing...', openErr?.message);
      try {
        if (sqliteDb && typeof sqliteDb.close === 'function') sqliteDb.close();
      } catch {}
      sqliteDb = null;
      try { if (fs.existsSync(SQLITE_DB_FILE + '-wal')) fs.unlinkSync(SQLITE_DB_FILE + '-wal'); } catch {}
      try { if (fs.existsSync(SQLITE_DB_FILE + '-shm')) fs.unlinkSync(SQLITE_DB_FILE + '-shm'); } catch {}
      initDb();
      console.log('[DATABASE] SQLite self-healing successful! WAL Engine activated (telebot.db).');
    }

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT,
        role TEXT,
        active INTEGER,
        expiry_date TEXT,
        data_json TEXT,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS accounts (
        phone TEXT PRIMARY KEY,
        owner TEXT,
        label TEXT,
        running INTEGER,
        sent_count INTEGER,
        daily_sent_count INTEGER,
        data_json TEXT,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS billing_ledgers (
        username TEXT PRIMARY KEY,
        balance_due REAL,
        total_billed REAL,
        total_paid REAL,
        data_json TEXT,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS billing_invoices (
        id TEXT PRIMARY KEY,
        username TEXT,
        date TEXT,
        amount REAL,
        type TEXT,
        status TEXT,
        data_json TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS billing_payments (
        id TEXT PRIMARY KEY,
        username TEXT,
        date TEXT,
        amount REAL,
        mode TEXT,
        reference TEXT,
        data_json TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS daily_dm_history (
        owner TEXT,
        date TEXT,
        count INTEGER,
        phones_json TEXT,
        total_ids INTEGER,
        PRIMARY KEY (owner, date)
      );
      CREATE TABLE IF NOT EXISTS daily_join_history (
        owner TEXT,
        date TEXT,
        count INTEGER,
        joiners_json TEXT,
        PRIMARY KEY (owner, date)
      );
      CREATE TABLE IF NOT EXISTS sent_recipients (
        owner TEXT,
        uid INTEGER,
        phone TEXT,
        sent_at INTEGER,
        PRIMARY KEY (owner, uid)
      );
      CREATE TABLE IF NOT EXISTS growth_campaigns (
        id TEXT PRIMARY KEY,
        owner TEXT,
        campaign_slug TEXT UNIQUE,
        title TEXT,
        channel_username TEXT,
        channel_id TEXT,
        lock_message TEXT,
        unlock_content TEXT,
        banner_url TEXT,
        video_url TEXT,
        video_caption TEXT,
        audio_url TEXT,
        apk_url TEXT,
        apk_caption TEXT,
        contact_username TEXT,
        contact_button_text TEXT,
        contact_prefill_text TEXT,
        extra_buttons_json TEXT,
        button_text TEXT,
        status TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS growth_subscribers (
        id TEXT PRIMARY KEY,
        owner TEXT,
        campaign_id TEXT,
        telegram_id INTEGER,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        is_joined INTEGER,
        joined_at INTEGER,
        last_active_at INTEGER,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS growth_broadcasts (
        id TEXT PRIMARY KEY,
        owner TEXT,
        campaign_name TEXT,
        message_text TEXT,
        media_type TEXT,
        media_url TEXT,
        buttons_json TEXT,
        target_filter TEXT,
        total_targets INTEGER,
        sent_count INTEGER,
        failed_count INTEGER,
        status TEXT,
        created_at INTEGER,
        completed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value_json TEXT,
        updated_at INTEGER
      );
    `);

    // Migration: add new columns if they do not exist
    const newGrowthCols = [
      ['video_url', 'TEXT'],
      ['video_caption', 'TEXT'],
      ['audio_url', 'TEXT'],
      ['apk_url', 'TEXT'],
      ['apk_caption', 'TEXT'],
      ['contact_username', 'TEXT'],
      ['contact_button_text', 'TEXT'],
      ['contact_prefill_text', 'TEXT'],
      ['extra_buttons_json', 'TEXT'],
      ['billing_status', "TEXT DEFAULT 'active'"],
      ['customer_tg_id', 'TEXT'],
      ['admin_notes', 'TEXT'],
      ['bot_token', 'TEXT'],
      ['bot_username', 'TEXT']
    ];
    for (const [col, colType] of newGrowthCols) {
      try {
        sqliteDb.exec(`ALTER TABLE growth_campaigns ADD COLUMN ${col} ${colType};`);
      } catch (e) {
        // column already exists
      }
    }
  }
} catch (err: any) {
  console.log('[DATABASE] Native SQLite not available on this Node runtime, using Atomic Lock Storage.');
}

/**
 * Safe KV Store Get helper
 */
export function getDbKv<T = any>(key: string, defaultValue: T | null = null): T | null {
  if (!sqliteDb) return defaultValue;
  try {
    const row = sqliteDb.prepare("SELECT value_json FROM kv_store WHERE key = ?").get(key);
    if (row && row.value_json) {
      return JSON.parse(row.value_json);
    }
  } catch (e: any) {
    if (e?.code === 'ERR_SQLITE_ERROR' && /disk I\/O error/i.test(String(e?.message || ''))) {
      try {
        sqliteDb.exec('PRAGMA journal_mode = WAL;');
        const retryRow = sqliteDb.prepare("SELECT value_json FROM kv_store WHERE key = ?").get(key);
        if (retryRow && retryRow.value_json) return JSON.parse(retryRow.value_json);
      } catch {}
    }
    console.warn(`[DATABASE] getDbKv error for key "${key}":`, e?.message || e);
  }
  return defaultValue;
}

/**
 * Safe KV Store Set helper
 */
export function setDbKv(key: string, value: any): boolean {
  if (!sqliteDb) return false;
  try {
    const jsonStr = typeof value === 'string' ? value : JSON.stringify(value);
    sqliteDb.prepare("INSERT OR REPLACE INTO kv_store (key, value_json, updated_at) VALUES (?, ?, ?)").run(key, jsonStr, Date.now());
    return true;
  } catch (e: any) {
    if (e?.code === 'ERR_SQLITE_ERROR' && /disk I\/O error/i.test(String(e?.message || ''))) {
      try {
        sqliteDb.exec('PRAGMA journal_mode = WAL;');
        const jsonStr = typeof value === 'string' ? value : JSON.stringify(value);
        sqliteDb.prepare("INSERT OR REPLACE INTO kv_store (key, value_json, updated_at) VALUES (?, ?, ?)").run(key, jsonStr, Date.now());
        return true;
      } catch {}
    }
    console.warn(`[DATABASE] setDbKv error for key "${key}":`, e?.message || e);
    return false;
  }
}
