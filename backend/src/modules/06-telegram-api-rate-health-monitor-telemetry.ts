// ---------------- TELEGRAM API RATE & HEALTH MONITOR TELEMETRY ----------------
interface ApiCallTimestamp {
  ts: number;
  type: string;
}

const apiCallHistoryMap = new Map<string, ApiCallTimestamp[]>(); // phone -> timestamps
const accountThrottleOverride = new Map<string, { throttled: boolean; reason: string; until: number }>(); // phone -> override

function recordApiCall(phone: string, type: string = 'generic') {
  const now = Date.now();
  let list = apiCallHistoryMap.get(phone);
  if (!list) {
    list = [];
    apiCallHistoryMap.set(phone, list);
  }
  list.push({ ts: now, type });
  // Retain only last 5 minutes of call history
  const fiveMinAgo = now - 5 * 60 * 1000;
  while (list.length > 0 && list[0].ts < fiveMinAgo) {
    list.shift();
  }
}

function getAccountRateStats(phone: string) {
  const now = Date.now();
  const list = apiCallHistoryMap.get(phone) || [];
  const oneMinAgo = now - 60 * 1000;
  const fiveMinAgo = now - 5 * 60 * 1000;
  
  const callsLast1Min = list.filter(c => c.ts >= oneMinAgo).length;
  const callsLast5Min = list.filter(c => c.ts >= fiveMinAgo).length;
  const rpm = callsLast1Min; // Requests Per Minute

  const override = accountThrottleOverride.get(phone);
  const isCustomThrottled = override && override.throttled && override.until > now;

  let healthStatus = 'optimal'; // optimal, warning, cooling, paused
  let healthLabel = '🟢 Optimal (Safe)';
  let safeColor = '#10b981';

  if (isCustomThrottled) {
    healthStatus = 'throttled';
    healthLabel = `🛡️ Throttled by Admin (${Math.ceil((override.until - now)/1000)}s)`;
    safeColor = '#f59e0b';
  } else if (rpm >= 25) {
    healthStatus = 'danger';
    healthLabel = '🔴 High Rate Warning';
    safeColor = '#ef4444';
  } else if (rpm >= 14) {
    healthStatus = 'elevated';
    healthLabel = '🟡 Elevated Activity';
    safeColor = '#f59e0b';
  }

  const dmsLast1Min = list.filter(c => c.ts >= oneMinAgo && c.type === 'dm').length;

  return {
    phone,
    rpm,
    callsLast5Min,
    dmsLast1Min,
    healthStatus,
    healthLabel,
    safeColor,
    isCustomThrottled: Boolean(isCustomThrottled),
    throttleSecondsRemaining: isCustomThrottled ? Math.ceil((override.until - now)/1000) : 0,
    lastCallTs: list.length > 0 ? list[list.length - 1].ts : 0
  };
}

function getSecretKey(): string {
  // 1. Try SQLite kv_store first (bulletproof permanent persistence)
  if (sqliteDb) {
    try {
      const row = sqliteDb.prepare("SELECT value_json FROM kv_store WHERE key = 'master_jwt_secret'").get();
      if (row && row.value_json) {
        const val = JSON.parse(row.value_json);
        if (val && typeof val === 'string' && val.length >= 32) {
          return val;
        }
      }
    } catch {}
  }
  // 2. Try secret.key file
  if (fs.existsSync(SECRET_KEY_FILE)) {
    const k = fs.readFileSync(SECRET_KEY_FILE, 'utf-8').trim();
    if (k.length >= 32) {
      if (sqliteDb) {
        try {
          sqliteDb.prepare("INSERT OR REPLACE INTO kv_store (key, value_json, updated_at) VALUES ('master_jwt_secret', ?, ?)").run(JSON.stringify(k), Date.now());
        } catch {}
      }
      return k;
    }
  }
  // 3. Fallback: generate and save to SQLite and file
  const key = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(SECRET_KEY_FILE, key, 'utf-8');
  } catch {}
  if (sqliteDb) {
    try {
      sqliteDb.prepare("INSERT OR REPLACE INTO kv_store (key, value_json, updated_at) VALUES ('master_jwt_secret', ?, ?)").run(JSON.stringify(key), Date.now());
    } catch {}
  }
  return key;
}

let broadcastLogToSse: ((phone: string, line: string, ts: string) => void) | null = null;

function log(phone        , tag        , msg        ) {
  const ts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(new Date());
  const line = `[${ts}] [${tag}] ${msg}`;
  let list = logsMap.get(phone);
  if (!list) {
    list = [];
    logsMap.set(phone, list);
  }
  list.push(line);
  if (list.length > 200) {
    list.splice(0, 100);
  }
  // Only write meaningful non-spammy events to stdout (PM2 log) to save SSD
  const isSpammyIdleLog = tag === 'INFO' && (msg.includes('no live audio stream') || msg.includes('Next scan in') || msg.includes('Scanned'));
  if (!isSpammyIdleLog) {
    console.log(`[${phone}] ${line}`);
  }
  if (broadcastLogToSse) {
    try {
      broadcastLogToSse(phone, line, ts);
    } catch {}
  }
}

