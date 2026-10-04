// ---------------- DAILY JOIN REQUEST HISTORY & TRACKED INVITE LINKS ----------------
interface TrackedInviteLinkRecord {
  owner: string;
  invite_link: string;
  invite_link_name: string;
  chat_id: string;
  channel_title?: string;
  created_at: number;
}

interface DailyJoinRecord {
  count: number;
  joiners?: { id: number; name: string; username?: string; time: string }[];
}

const USER_TRACKED_LINKS_FILE = path.join(__dirname, 'user_tracked_links.json');
const DAILY_JOIN_HISTORY_FILE = path.join(__dirname, 'daily_join_history.json');

let userTrackedLinks: Record<string, TrackedInviteLinkRecord> = {};
let dailyJoinHistory: Record<string, Record<string, DailyJoinRecord>> = {};
let saveDailyJoinTimeout: NodeJS.Timeout | null = null;

function loadUserTrackedLinks(): void {
  try {
    if (fs.existsSync(USER_TRACKED_LINKS_FILE)) {
      userTrackedLinks = JSON.parse(fs.readFileSync(USER_TRACKED_LINKS_FILE, 'utf8')) || {};
    }
  } catch (err) {
    userTrackedLinks = {};
  }
}

function saveUserTrackedLinks(): void {
  try {
    asyncSaveJson(USER_TRACKED_LINKS_FILE, userTrackedLinks, 1000);
  } catch {}
}

function loadDailyJoinHistory(): void {
  // 1. Try loading from SQLite first
  if (sqliteDb) {
    try {
      const rows = sqliteDb.prepare('SELECT * FROM daily_join_history').all();
      if (Array.isArray(rows) && rows.length > 0) {
        dailyJoinHistory = {};
        for (const r of rows) {
          const owner = r.owner;
          const date = r.date;
          if (!dailyJoinHistory[owner]) dailyJoinHistory[owner] = {};
          let joiners: any[] = [];
          try { joiners = JSON.parse(r.joiners_json); } catch {}
          dailyJoinHistory[owner][date] = {
            count: Number(r.count) || 0,
            joiners
          };
        }
        console.log(`[DATABASE] Loaded daily Join history from SQLite.`);
        return;
      }
    } catch (err) {
      console.warn('[DATABASE] SQLite loadDailyJoinHistory error, falling back to JSON:', err);
    }
  }

  // 2. Fallback to daily_join_history.json (and auto-migrate into SQLite)
  try {
    if (fs.existsSync(DAILY_JOIN_HISTORY_FILE)) {
      dailyJoinHistory = JSON.parse(fs.readFileSync(DAILY_JOIN_HISTORY_FILE, 'utf8')) || {};
      // Auto-migrate to SQLite
      if (sqliteDb) {
        try {
          const stmt = sqliteDb.prepare(`INSERT OR REPLACE INTO daily_join_history (owner, date, count, joiners_json) VALUES (?, ?, ?, ?)`);
          for (const [owner, days] of Object.entries(dailyJoinHistory)) {
            for (const [d, rec] of Object.entries(days || {})) {
              stmt.run(owner, d, rec.count || 0, JSON.stringify(rec.joiners || []));
            }
          }
          console.log('[MIGRATION] Auto-migrated daily Join history into SQLite.');
        } catch {}
      }
    }
  } catch (err) {
    dailyJoinHistory = {};
  }
}

function saveDailyJoinHistoryDebounced(): void {
  // 1. Sync to SQLite
  if (sqliteDb) {
    try {
      const stmt = sqliteDb.prepare(`INSERT OR REPLACE INTO daily_join_history (owner, date, count, joiners_json) VALUES (?, ?, ?, ?)`);
      for (const [owner, days] of Object.entries(dailyJoinHistory)) {
        for (const [d, rec] of Object.entries(days || {})) {
          stmt.run(owner, d, rec.count || 0, JSON.stringify(rec.joiners || []));
        }
      }
    } catch (err) {
      console.error('Error saving daily Join history to SQLite:', err);
    }
  }

  // 2. Sync to daily_join_history.json
  if (saveDailyJoinTimeout) return;
  saveDailyJoinTimeout = setTimeout(() => {
    saveDailyJoinTimeout = null;
    try {
      asyncSaveJson(DAILY_JOIN_HISTORY_FILE, dailyJoinHistory, 1000);
    } catch {}
  }, 2000);
}

loadUserTrackedLinks();
loadDailyJoinHistory();

function recordJoinRequest(owner: string, userDetails?: { id: number; name: string; username?: string }): void {
  const normOwner = (owner || 'admin').toLowerCase();
  const todayStr = getTodayDateString();
  const historyKey = Object.keys(dailyJoinHistory).find(k => k.toLowerCase() === normOwner) || normOwner;
  if (!dailyJoinHistory[historyKey]) {
    dailyJoinHistory[historyKey] = {};
  }
  if (!dailyJoinHistory[historyKey][todayStr]) {
    dailyJoinHistory[historyKey][todayStr] = { count: 0, joiners: [] };
  }
  const rec = dailyJoinHistory[historyKey][todayStr];
  rec.count = (rec.count || 0) + 1;
  if (userDetails) {
    if (!rec.joiners) rec.joiners = [];
    rec.joiners.unshift({
      id: userDetails.id,
      name: userDetails.name || 'Telegram User',
      username: userDetails.username || '',
      time: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
    });
    if (rec.joiners.length > 50) rec.joiners = rec.joiners.slice(0, 50);
  }
  saveDailyJoinHistoryDebounced();
}

function getOwnerLifetimeJoins(owner: string): number {
  const normOwner = (owner || 'admin').toLowerCase();
  const historyKey = Object.keys(dailyJoinHistory).find(k => k.toLowerCase() === normOwner) || normOwner;
  const userJoins = dailyJoinHistory[historyKey] || {};
  let total = 0;
  for (const d of Object.keys(userJoins)) {
    total += userJoins[d]?.count || 0;
  }
  return total;
}

function getOwnerDailyJoinStats(owner: string) {
  const normOwner = (owner || 'admin').toLowerCase();
  const todayStr = getTodayDateString();
  const historyKey = Object.keys(dailyJoinHistory).find(k => k.toLowerCase() === normOwner) || normOwner;
  if (!dailyJoinHistory[historyKey]) {
    dailyJoinHistory[historyKey] = {};
  }

  const [currY, currM, currD] = todayStr.split('-').map(Number);
  const result = [];

  for (let i = 0; i < 5; i++) {
    const istDayDate = new Date(Date.UTC(currY, currM - 1, currD - i, 0, 0, 0));
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(istDayDate);

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short'
    }).formatToParts(istDayDate);
    const dayVal = parts.find(p => p.type === 'day')?.value || '';
    const monthVal = parts.find(p => p.type === 'month')?.value || '';
    const shortDate = `${dayVal} ${monthVal}`;

    let label = '';
    if (i === 0) label = `Today (${shortDate})`;
    else if (i === 1) label = `Yesterday (${shortDate})`;
    else label = shortDate;

    const count = dailyJoinHistory[historyKey]?.[dateStr]?.count || 0;
    result.push({
      date: dateStr,
      label,
      short_date: shortDate,
      join_count: count
    });
  }

  return result;
}

// Helper to auto-create and cache unique Tracked Join Request invite link per user
async function getOrCreateUserTrackedInviteLink(owner: string, a?: any): Promise<string> {
  const normOwner = owner || 'admin';
  const u = getUser(normOwner);
  const rawTargetLink = (
    u?.master_config?.channel_link || 
    (a ? getEffectiveConfig(a).channel_link : '') || 
    getUser('admin')?.master_config?.channel_link || 
    ''
  ).trim();

  if (!rawTargetLink) return '';

  // 1. Check if already generated for this user
  if (userTrackedLinks[normOwner]?.invite_link) {
    return userTrackedLinks[normOwner].invite_link;
  }

  // 2. Locate filter bot token (prefer user's filter bot, fallback to admin filter/alert bot)
  const botToken = (
    u?.master_config?.filter_bot_token || 
    u?.alert_bot_token || 
    getUser('admin')?.master_config?.filter_bot_token || 
    getUser('admin')?.alert_bot_token || 
    ''
  ).trim();

  if (!botToken) {
    return rawTargetLink;
  }

  // 3. Resolve channel chat_id
  let targetChatId = '';
  try {
    const adminChannels = await getFilterBotAdminChannels(botToken, normOwner);
    for (const [cid] of adminChannels.entries()) {
      targetChatId = cid;
      break;
    }
  } catch {}

  if (!targetChatId) {
    const numMatch = rawTargetLink.match(/-100\d+|\/c\/(\d+)/);
    if (numMatch) {
      targetChatId = numMatch[1] ? `-100${numMatch[1]}` : numMatch[0];
    } else {
      const pubMatch = rawTargetLink.match(/t\.me\/([a-zA-Z0-9_]{4,})(?:\/|\?|$)/);
      if (pubMatch && !pubMatch[1].startsWith('+') && !rawTargetLink.includes('/+')) {
        targetChatId = '@' + pubMatch[1];
      }
    }
  }

  if (!targetChatId) {
    return rawTargetLink;
  }

  // 4. Create chat invite link via Telegram Bot API with creates_join_request: true
  try {
    const linkName = `Track_${normOwner}`;
    const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/createChatInviteLink`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        name: linkName,
        creates_join_request: true
      })
    });
    const data: any = await res.json().catch(() => null);
    if (data?.ok && data.result?.invite_link) {
      const inviteLink = data.result.invite_link;
      userTrackedLinks[normOwner] = {
        owner: normOwner,
        invite_link: inviteLink,
        invite_link_name: linkName,
        chat_id: String(targetChatId),
        created_at: Date.now()
      };
      saveUserTrackedLinks();
      log(a?.phone || normOwner, 'OK', `🎯 Generated Tracked Join Request Link for ${normOwner}: ${inviteLink}`);
      return inviteLink;
    } else {
      console.warn(`[TRACKED LINK] Could not create link for ${normOwner}:`, data?.description || data);
    }
  } catch (err: any) {
    console.error(`[TRACKED LINK ERROR] ${normOwner}:`, err?.message || err);
  }

  return rawTargetLink;
}

// --- AI DM HISTORY TRACKING ---
const aiDmHistory: Record<string, Record<string, number>> = {};
const aiDmFile = path.join(__dirname, 'ai_dm_history.json');

function loadAiDmHistory() {
  if (fs.existsSync(aiDmFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(aiDmFile, 'utf8'));
      for (const k in parsed) { aiDmHistory[k] = parsed[k]; }
    } catch {}
  }
}
loadAiDmHistory();

function saveAiDmHistory() {
  try { fs.writeFileSync(aiDmFile, JSON.stringify(aiDmHistory, null, 2)); } catch {}
}

function recordAiDm(owner: string) {
  const normOwner = owner || 'admin';
  const todayStr = getTodayDateString();
  if (!aiDmHistory[normOwner]) aiDmHistory[normOwner] = {};
  aiDmHistory[normOwner][todayStr] = (aiDmHistory[normOwner][todayStr] || 0) + 1;
  saveAiDmHistory();
}
// -----------------------------

// --- DYNAMIC HINGLISH COMBINATORIAL ENGINE (ULTRA-ATTRACTIVE 2-3 LINE FORMAT) ---
interface HinglishTemplateBank {
  greetings: { id: string; text: string }[];
  offers?: { id: string; text: string }[];
  intros?: { id: string; text: string }[];
  services?: { id: string; text: string }[];
  ctas?: { id: string; text: string }[];
}

let hinglishTemplates: HinglishTemplateBank = {
  greetings: [],
  offers: []
};

function loadHinglishTemplates() {
  try {
    const p = path.join(__dirname, 'templates_hinglish.json');
    if (fs.existsSync(p)) {
      hinglishTemplates = JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading templates_hinglish.json:', e);
  }
}
loadHinglishTemplates();

function buildDynamicHinglishMessage(rawName?: string, channelLink?: string): { text: string; code: string; components: any } {
  if (!hinglishTemplates.greetings || !hinglishTemplates.greetings.length) {
    loadHinglishTemplates();
  }
  const cleanLink = (channelLink || '').trim() || 'https://t.me/telegram';
  
  // Sanitize first name: clean symbols/emojis
  let safeName = (rawName || '').trim();
  safeName = safeName.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  if (!safeName || safeName.length < 2 || safeName.length > 25) {
    safeName = 'bhai';
  } else {
    safeName = safeName.charAt(0).toUpperCase() + safeName.slice(1);
  }

  const gList = hinglishTemplates.greetings || [];
  const oList = hinglishTemplates.offers || [];

  const g = gList[Math.floor(Math.random() * (gList.length || 1))] || { id: 'G01', text: 'Hey {NAME} bhai! Loss recover karna hai? 🔥' };
  const o = oList[Math.floor(Math.random() * (oList.length || 1))] || { id: 'O01', text: 'Mere VIP group me daily prediction aur hacks milte hain jisse aap apna loss khud recover kar sakte ho, join karke mujhe DM karo personally support dunga 👇' };

  const greetingFormatted = g.text.replace(/\{NAME\}/g, safeName);
  const offerFormatted = o.text.replace(/\{CHANNEL_LINK\}/g, cleanLink);

  // Ultra-crisp, high-conversion 2-3 line format (Instant attraction)
  const text = `${greetingFormatted}\n${offerFormatted}\n${cleanLink}`;
  const code = `${g.id}+${o.id}`;

  return { 
    text, 
    code,
    components: {
      greeting: { id: g.id, text: greetingFormatted },
      offer: { id: o.id, text: offerFormatted }
    }
  };
}
// ---------------------------------------------------------------------------------

function recordDailyDm(owner: string, phone: string): void {
  const normOwner = (owner || 'admin').toLowerCase();
  const todayStr = getTodayDateString();
  const historyKey = Object.keys(dailyDmHistory).find(k => k.toLowerCase() === normOwner) || normOwner;
  if (!dailyDmHistory[historyKey]) {
    dailyDmHistory[historyKey] = {};
  }
  if (!dailyDmHistory[historyKey][todayStr]) {
    dailyDmHistory[historyKey][todayStr] = { count: 0, phones: [] };
  }
  const rec = dailyDmHistory[historyKey][todayStr];
  rec.count = (rec.count || 0) + 1;
  if (phone && !rec.phones.includes(phone)) {
    rec.phones.push(phone);
  }
  const userAccs = Array.from(accounts.values()).filter(a => (a.owner || 'admin').toLowerCase() === normOwner);
  rec.total_ids = userAccs.length;

  saveDailyDmHistoryDebounced();
}

function getOwnerDailyDmStats(owner: string, totalAccountsCount: number) {
  const normOwner = (owner || 'admin').toLowerCase();
  const todayStr = getTodayDateString();

  // Sync today's count from live account states (case-insensitive owner match)
  let liveTodayDMs = 0;
  let sumAccSent = 0;
  const activePhonesToday: string[] = [];
  for (const a of accounts.values()) {
    if ((a.owner || 'admin').toLowerCase() === normOwner) {
      checkAndResetDailyDmQuota(a.phone);
      const cnt = Math.max((a as any).daily_sent_count || 0, (a as any).daily_extracted_count || 0);
      if (cnt > 0) {
        liveTodayDMs += cnt;
        activePhonesToday.push(a.phone);
      }
      sumAccSent += (a.sent_count || 0);
    }
  }

  // Find matching dailyDmHistory key (case-insensitive & trimmed)
  const historyKey = Object.keys(dailyDmHistory).find(k => k.trim().toLowerCase() === normOwner) || normOwner;
  if (!dailyDmHistory[historyKey]) {
    dailyDmHistory[historyKey] = {};
  }

  const todayHistCount = dailyDmHistory[historyKey]?.[todayStr]?.count || 0;
  const todayCount = Math.max(liveTodayDMs, todayHistCount);

  if (!dailyDmHistory[historyKey][todayStr]) {
    dailyDmHistory[historyKey][todayStr] = {
      count: todayCount,
      phones: activePhonesToday,
      total_ids: totalAccountsCount
    };
  } else {
    if (todayCount > (dailyDmHistory[historyKey][todayStr].count || 0)) {
      dailyDmHistory[historyKey][todayStr].count = todayCount;
    }
    for (const p of activePhonesToday) {
      if (!dailyDmHistory[historyKey][todayStr].phones.includes(p)) {
        dailyDmHistory[historyKey][todayStr].phones.push(p);
      }
    }
    dailyDmHistory[historyKey][todayStr].total_ids = totalAccountsCount;
  }

  // Calculate lifetime total across accounts, sent set, and history
  const alreadySentSet = getOwnerSentUsers(normOwner);
  let totalHistoryDMs = 0;
  if (dailyDmHistory[historyKey]) {
    for (const d of Object.keys(dailyDmHistory[historyKey])) {
      totalHistoryDMs += (dailyDmHistory[historyKey][d]?.count || 0);
    }
  }
  const lifetimeTotalDMs = Math.max(alreadySentSet.size, sumAccSent, totalHistoryDMs, todayCount);

  // Remaining unaccounted DMs that belong to past days
  let unaccountedPastDMs = Math.max(0, lifetimeTotalDMs - todayCount);

  const [currY, currM, currD] = todayStr.split('-').map(Number);
  const result = [];

  for (let i = 0; i < 5; i++) {
    // Generate dates using exact IST day subtraction
    const istDayDate = new Date(Date.UTC(currY, currM - 1, currD - i, 0, 0, 0));
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(istDayDate);

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short'
    }).formatToParts(istDayDate);

    const day = parts.find(p => p.type === 'day')?.value || '';
    const month = parts.find(p => p.type === 'month')?.value || '';
    const shortDate = `${day} ${month}`;

    let label = shortDate;
    if (i === 0) label = `Today (${shortDate})`;
    else if (i === 1) label = `Yesterday (${shortDate})`;

    const histEntry = dailyDmHistory[historyKey]?.[dateStr];
    let dmCount = i === 0 ? todayCount : (histEntry ? (histEntry.count || 0) : 0);

    // If past day has 0 recorded in history but the user has verifiable past DMs sent:
    if (i > 0 && dmCount === 0 && unaccountedPastDMs > 0) {
      const allocated = (i === 1)
        ? Math.min(unaccountedPastDMs, Math.ceil(unaccountedPastDMs / (5 - i)))
        : Math.min(unaccountedPastDMs, Math.floor(unaccountedPastDMs / (5 - i + 1)));
      if (allocated > 0) {
        dmCount = allocated;
        unaccountedPastDMs -= allocated;
        if (!dailyDmHistory[historyKey][dateStr]) {
          dailyDmHistory[historyKey][dateStr] = { count: allocated, phones: [] };
        } else {
          dailyDmHistory[historyKey][dateStr].count = allocated;
        }
      }
    }

    const idsCount = (histEntry && histEntry.total_ids !== undefined) ? histEntry.total_ids : totalAccountsCount;
    const activeIdsCount = i === 0 ? Math.max(activePhonesToday.length, histEntry?.phones?.length || 0) : (histEntry?.phones?.length || 0);

    result.push({
      date: dateStr,
      label,
      short_date: shortDate,
      count: dmCount,
      dm_count: dmCount,
      total_ids: idsCount,
      active_ids: activeIdsCount
    });
  }

  saveDailyDmHistoryDebounced();
  return result;
}

// Universal Comprehensive DM & Join Overview Helper for Admin & User Bots
function getOwnerDmOverview(username: string) {
  const normUser = (username || 'admin').toLowerCase();
  const uAccs = Array.from(accounts.values()).filter((a: any) => (a.owner || 'admin').toLowerCase() === normUser);
  const liveAccounts = uAccs.filter((a: any) => a.running).length;
  const stats5Days = getOwnerDailyDmStats(username, uAccs.length);
  const joins5Days = getOwnerDailyJoinStats(username);

  const todayDms = stats5Days.length > 0 ? (stats5Days[0].count || 0) : 0;
  const todayJoins = joins5Days.length > 0 ? (joins5Days[0].join_count || 0) : 0;
  const sum5DaysDms = stats5Days.reduce((acc: number, item: any) => acc + (item.count || 0), 0);
  const sum5DaysJoins = joins5Days.reduce((acc: number, item: any) => acc + (item.join_count || 0), 0);
  const avgPerDayDms = Math.round(sum5DaysDms / Math.max(1, stats5Days.length));

  const alreadySentSet = getOwnerSentUsers(normUser);
  let sumAccSent = 0;
  for (const a of uAccs) sumAccSent += (a.sent_count || 0);

  const historyKey = Object.keys(dailyDmHistory).find(k => k.trim().toLowerCase() === normUser) || normUser;
  let totalHistoryDMs = 0;
  if (dailyDmHistory[historyKey]) {
    for (const d of Object.keys(dailyDmHistory[historyKey])) {
      totalHistoryDMs += (dailyDmHistory[historyKey][d]?.count || 0);
    }
  }
  const lifetimeDms = Math.max(alreadySentSet.size, sumAccSent, totalHistoryDMs, sum5DaysDms, todayDms);
  const lifetimeJoins = getOwnerLifetimeJoins(username);
  const convRate = todayDms > 0 ? ((todayJoins / todayDms) * 100).toFixed(1) + '%' : (todayJoins > 0 ? '100%' : '0.0%');

  return {
    username,
    uAccs,
    liveAccounts,
    totalAccounts: uAccs.length,
    todayDms,
    todayJoins,
    sum5DaysDms,
    sum5DaysJoins,
    avgPerDayDms,
    lifetimeDms,
    lifetimeJoins,
    convRate,
    stats5Days,
    joins5Days
  };
}

