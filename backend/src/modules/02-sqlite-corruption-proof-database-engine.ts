// ---------------- SQLITE CORRUPTION-PROOF DATABASE ENGINE (WAL MODE) ----------------
let sqliteDb: any = null;

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

function getGlobalTheme(): string {
  try {
    if (fs.existsSync(THEME_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(THEME_CONFIG_FILE, 'utf8'));
      if (data && data.theme) return data.theme;
    }
  } catch {}
  return 'cyberpunk';
}

function saveGlobalTheme(theme: string): void {
  try {
    fs.writeFileSync(THEME_CONFIG_FILE, JSON.stringify({ theme, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving theme_config.json:', err);
  }
}

interface MasterProxyConfig {
  enabled: boolean;
  protocol: 'socks5' | 'http';
  host: string;
  port: number;
  username: string;
  password: string;
  country: string;
  session_duration_mins: number;
  auto_sticky_per_phone: boolean;
}

let masterProxyConfig: MasterProxyConfig = {
  enabled: false,
  protocol: 'socks5',
  host: '',
  port: 0,
  username: '',
  password: '',
  country: '',
  session_duration_mins: 30,
  auto_sticky_per_phone: true
};

function loadMasterProxyConfig() {
  try {
    if (fs.existsSync(MASTER_PROXY_FILE)) {
      const data = JSON.parse(fs.readFileSync(MASTER_PROXY_FILE, 'utf8'));
      masterProxyConfig = { ...masterProxyConfig, ...data };
    }
  } catch (e) {
    console.error('Error loading proxy_config.json:', e);
  }
}

function saveMasterProxyConfig() {
  try {
    asyncSaveJson(MASTER_PROXY_FILE, masterProxyConfig, 300);
  } catch (e) {
    console.error('Error saving proxy_config.json:', e);
  }
}

loadMasterProxyConfig();

function getEffectiveProxyForAccount(phone: string, a: any): any {
  if (a && a.proxy && a.proxy.protocol && a.proxy.protocol !== 'none' && a.proxy.ip && Number(a.proxy.port) > 0) {
    if (a.proxy.protocol === 'socks5') {
      return {
        ip: a.proxy.ip,
        port: Number(a.proxy.port),
        socksType: 5,
        username: a.proxy.username || undefined,
        password: a.proxy.password || undefined
      };
    } else if (a.proxy.protocol === 'mtproxy') {
      return {
        ip: a.proxy.ip,
        port: Number(a.proxy.port),
        MTProxy: true,
        secret: a.proxy.secret
      };
    }
  }

  if (masterProxyConfig.enabled && masterProxyConfig.host && Number(masterProxyConfig.port) > 0) {
    const rawCleanPhone = (phone || '').replace(/[^0-9]/g, '');
    let finalUsername = masterProxyConfig.username || '';

    if (masterProxyConfig.auto_sticky_per_phone && finalUsername && rawCleanPhone) {
      if (!finalUsername.includes('session-') && !finalUsername.includes('sess-')) {
        let sessionTag = `_session-${rawCleanPhone}_lifetime-${masterProxyConfig.session_duration_mins || 30}m`;
        if (masterProxyConfig.country) {
          sessionTag = `_country-${masterProxyConfig.country.toLowerCase()}` + sessionTag;
        }
        finalUsername = `${finalUsername}${sessionTag}`;
      }
    }

    return {
      ip: masterProxyConfig.host,
      port: Number(masterProxyConfig.port),
      socksType: masterProxyConfig.protocol === 'socks5' ? 5 : undefined,
      username: finalUsername || undefined,
      password: masterProxyConfig.password || undefined
    };
  }

  return null;
}

