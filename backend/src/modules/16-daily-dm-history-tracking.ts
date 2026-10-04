// ---------------- DAILY DM HISTORY TRACKING (LAST 5 DAYS PER USER) ----------------
interface DailyDmHistoryRecord {
  count: number;
  phones: string[];
  total_ids?: number;
}
const DAILY_DM_HISTORY_FILE = path.join(__dirname, 'daily_dm_history.json');
let dailyDmHistory: Record<string, Record<string, DailyDmHistoryRecord>> = {};
let saveDailyDmTimeout: NodeJS.Timeout | null = null;

function loadDailyDmHistory(): void {
  // 1. Try loading from SQLite first
  if (sqliteDb) {
    try {
      const rows = sqliteDb.prepare('SELECT * FROM daily_dm_history').all();
      if (Array.isArray(rows) && rows.length > 0) {
        dailyDmHistory = {};
        for (const r of rows) {
          const owner = r.owner;
          const date = r.date;
          if (!dailyDmHistory[owner]) dailyDmHistory[owner] = {};
          let phones: string[] = [];
          try { phones = JSON.parse(r.phones_json); } catch {}
          dailyDmHistory[owner][date] = {
            count: Number(r.count) || 0,
            phones,
            total_ids: r.total_ids ? Number(r.total_ids) : undefined
          };
        }
        console.log(`[DATABASE] Loaded daily DM history from SQLite.`);
        return;
      }
    } catch (err) {
      console.warn('[DATABASE] SQLite loadDailyDmHistory error, falling back to JSON:', err);
    }
  }

  // 2. Fallback to daily_dm_history.json (and auto-migrate into SQLite)
  try {
    if (fs.existsSync(DAILY_DM_HISTORY_FILE)) {
      dailyDmHistory = JSON.parse(fs.readFileSync(DAILY_DM_HISTORY_FILE, 'utf8')) || {};
      // Auto-migrate to SQLite
      if (sqliteDb) {
        try {
          const stmt = sqliteDb.prepare(`INSERT OR REPLACE INTO daily_dm_history (owner, date, count, phones_json, total_ids) VALUES (?, ?, ?, ?, ?)`);
          for (const [owner, days] of Object.entries(dailyDmHistory)) {
            for (const [d, rec] of Object.entries(days || {})) {
              stmt.run(owner, d, rec.count || 0, JSON.stringify(rec.phones || []), rec.total_ids || null);
            }
          }
          console.log('[MIGRATION] Auto-migrated daily DM history into SQLite.');
        } catch {}
      }
    }
  } catch (err) {
    console.error('Error loading daily_dm_history.json:', err);
    dailyDmHistory = {};
  }
}

function saveDailyDmHistory(): void {
  // 1. Sync to SQLite
  if (sqliteDb) {
    try {
      const stmt = sqliteDb.prepare(`INSERT OR REPLACE INTO daily_dm_history (owner, date, count, phones_json, total_ids) VALUES (?, ?, ?, ?, ?)`);
      for (const [owner, days] of Object.entries(dailyDmHistory)) {
        for (const [d, rec] of Object.entries(days || {})) {
          stmt.run(owner, d, rec.count || 0, JSON.stringify(rec.phones || []), rec.total_ids || null);
        }
      }
    } catch (err) {
      console.error('Error saving daily DM history to SQLite:', err);
    }
  }

  // 2. Sync to daily_dm_history.json
  try {
    fs.writeFileSync(DAILY_DM_HISTORY_FILE, JSON.stringify(dailyDmHistory, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving daily_dm_history.json:', err);
  }
}

function saveDailyDmHistoryDebounced(): void {
  if (saveDailyDmTimeout) return;
  saveDailyDmTimeout = setTimeout(() => {
    saveDailyDmTimeout = null;
    saveDailyDmHistory();
  }, 2000);
}

// Call on startup
loadDailyDmHistory();


