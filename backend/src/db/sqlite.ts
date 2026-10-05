import { SQLITE_DB_FILE } from '../config/constants.ts';

// ---------------- SQLITE CORRUPTION-PROOF DATABASE ENGINE (WAL MODE) ----------------
export let sqliteDb: any = null;

try {
  const { DatabaseSync } = await import('node:sqlite');
  if (DatabaseSync) {
    sqliteDb = new DatabaseSync(SQLITE_DB_FILE);
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
    sqliteDb.exec('PRAGMA synchronous = NORMAL;');
    console.log('[DATABASE] SQLite WAL Engine activated successfully (telebot.db).');

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
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value_json TEXT,
        updated_at INTEGER
      );
    `);
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
  } catch (e) {
    console.warn(`[DATABASE] getDbKv error for key "${key}":`, e);
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
  } catch (e) {
    console.warn(`[DATABASE] setDbKv error for key "${key}":`, e);
    return false;
  }
}
