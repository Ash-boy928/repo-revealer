// ---------------- ACCOUNT HELPERS ----------------
function defaultConfig()                {
  return {
    use_master_config: true,
    ai_context: '',
    channel_link: '',
    targets: [],
    message_1: 'Join my channel!\n{CHANNEL_LINK}',
    message_2: 'Hello! Please check out my channel:\n{CHANNEL_LINK}',
    message_3: 'Awesome updates available here:\n{CHANNEL_LINK}',
    max_users: 200,
    check_interval: 60,
    delay_min: 60,
    delay_max: 120
  };
}

function getEffectiveConfig(a: any) {
  const base = a.config || defaultConfig();
  const owner = a.owner || 'admin';
  const u = getUser(owner);
  const master = u?.master_config;

  // 🛡️ Global Non-Target Group Links (Master Config) MUST ALWAYS be merged so bots never scan user's own channel!
  const masterTargets = Array.isArray(master?.targets) ? master.targets : [];
  const baseTargets = Array.isArray(base.targets) ? base.targets : [];
  const allTargets = Array.from(new Set([...masterTargets, ...baseTargets]));

  if (base.use_master_config !== false && master) {
    return {
      ...base,
      use_dynamic_templates: master.use_dynamic_templates !== undefined ? master.use_dynamic_templates : (u.ai_enabled === true),
      ai_context: master.ai_context || '',
      channel_link: master.channel_link || base.channel_link || '',
      targets: allTargets,
      message_1: master.message_1 || '',
      message_2: master.message_2 || '',
      message_3: master.message_3 || '',
      delay_min: master.delay_min !== undefined ? Number(master.delay_min) : (base.delay_min || 60),
      delay_max: master.delay_max !== undefined ? Number(master.delay_max) : (base.delay_max || 120),
      check_interval: master.check_interval !== undefined ? Number(master.check_interval) : (base.check_interval || 20),
      filter_bot_token: master.filter_bot_token || ''
    };
  }
  return {
    ...base,
    targets: allTargets,
    filter_bot_token: master?.filter_bot_token || ''
  };
}

function loadAccountsLocal(): boolean {
  const todayStr = getTodayDateString();

  // 1. Try loading accounts from SQLite first
  if (sqliteDb) {
    try {
      const rows = sqliteDb.prepare('SELECT * FROM accounts').all();
      if (Array.isArray(rows) && rows.length > 0) {
        for (const r of rows) {
          try {
            const item = JSON.parse(r.data_json);
            const phone = item.phone || r.phone;
            if (!phone) continue;
            loadPhoneData(phone);
            const cfg = { ...defaultConfig(), ...(item.config || {}) };
            const sentUsers = loadSentUsers(phone);
            const isSameDay = item.daily_sent_date === todayStr;
            const dailySentCount = isSameDay ? (item.daily_sent_count || 0) : 0;
            const sentCount = Math.max(item.sent_count || r.sent_count || 0, dailySentCount);
            const isSameDayExtracted = item.daily_extracted_date === todayStr;
            accounts.set(phone, {
              label: item.label || r.label || phone,
              phone,
              api_id: Number(item.api_id),
              api_hash: item.api_hash,
              username: item.username || '',
              owner: item.owner || r.owner || 'admin',
              config: cfg,
              running: false,
              persisted_running: Boolean(item.persisted_running),
              live_on: true,
              dm_on: true,
              sent_users: sentUsers,
              sent_count: sentCount,
              daily_sent_count: dailySentCount,
              daily_sent_date: todayStr,
              daily_collected_count: isSameDayExtracted ? (item.daily_collected_count || item.daily_extracted_count || 0) : 0,
              daily_extracted_count: isSameDayExtracted ? (item.daily_extracted_count || 0) : 0,
              daily_extracted_date: todayStr,
              status: item.persisted_running ? 'Auto-Resuming on Boot...' : 'Ready'
            });
          } catch {}
        }
        console.log(`[DATABASE] ${accounts.size} telegram account(s) loaded safely from SQLite (telebot.db).`);
        return true;
      }
    } catch (e) {
      console.warn('[DATABASE] SQLite loadAccounts error, falling back to JSON:', e);
    }
  }

  // 2. Fallback to accounts.json (and auto-migrate into SQLite if empty)
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        for (const item of arr) {
          const phone = item.phone;
          if (!phone) continue;
          loadPhoneData(phone);
          const cfg = { ...defaultConfig(), ...(item.config || {}) };
          const sentUsers = loadSentUsers(phone);
          const isSameDay = item.daily_sent_date === todayStr;
          const dailySentCount = isSameDay ? (item.daily_sent_count || 0) : 0;
          const sentCount = Math.max(item.sent_count || 0, dailySentCount);
          const isSameDayExtracted = item.daily_extracted_date === todayStr;
          accounts.set(phone, {
            label: item.label,
            phone,
            api_id: Number(item.api_id),
            api_hash: item.api_hash,
            username: item.username || '',
            owner: item.owner || 'admin',
            config: cfg,
            running: false,
            persisted_running: Boolean(item.persisted_running),
            live_on: true,
            dm_on: true,
            sent_users: sentUsers,
            sent_count: sentCount,
            daily_sent_count: dailySentCount,
            daily_sent_date: todayStr,
            daily_collected_count: isSameDayExtracted ? (item.daily_collected_count || item.daily_extracted_count || 0) : 0,
            daily_extracted_count: isSameDayExtracted ? (item.daily_extracted_count || 0) : 0,
            daily_extracted_date: todayStr,
            status: item.persisted_running ? 'Auto-Resuming on Boot...' : 'Ready'
          });
        }
        console.log(`[PRIMARY CACHE] ${accounts.size} telegram account(s) loaded from local accounts.json`);
        // Auto-migrate to SQLite
        if (sqliteDb) {
          try {
            const accStmt = sqliteDb.prepare(`INSERT OR REPLACE INTO accounts (phone, owner, label, running, sent_count, daily_sent_count, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const item of arr) {
              if (item.phone) {
                accStmt.run(item.phone, item.owner || 'admin', item.label || item.phone, item.persisted_running ? 1 : 0, item.sent_count || 0, item.daily_sent_count || 0, JSON.stringify(item), Date.now());
              }
            }
            console.log(`[MIGRATION] Successfully auto-migrated ${arr.length} accounts into SQLite.`);
          } catch {}
        }
        return true;
      }
    }
  } catch (e) {}
  return false;
}

async function loadAccounts() {
  loadAccountsLocal();
  for (const phone of accounts.keys()) {
    await loadPhoneData(phone);
  }
}

function saveAccountsLocal(): void {
  const list: any[] = [];
  const todayStr = getTodayDateString();
  for (const a of accounts.values()) {
    if (!a || !a.phone) continue;
    list.push({
      label: a.label || a.phone,
      phone: a.phone,
      api_id: Number(a.api_id),
      api_hash: a.api_hash || '',
      username: a.username || '',
      owner: a.owner || 'admin',
      config: a.config || defaultConfig(),
      persisted_running: Boolean((a as any).persisted_running ?? a.running),
      sent_count: typeof a.sent_count === 'number' ? a.sent_count : 0,
      daily_sent_count: typeof a.daily_sent_count === 'number' ? a.daily_sent_count : 0,
      daily_sent_date: a.daily_sent_date || todayStr,
      daily_collected_count: a.daily_collected_count ?? a.daily_extracted_count ?? 0,
      daily_extracted_count: a.daily_extracted_count ?? 0,
      daily_extracted_date: a.daily_extracted_date || todayStr
    });
  }

  // 1. Sync to SQLite (Primary Storage)
  if (sqliteDb) {
    try {
      const accStmt = sqliteDb.prepare(`INSERT OR REPLACE INTO accounts (phone, owner, label, running, sent_count, daily_sent_count, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const item of list) {
        accStmt.run(item.phone, item.owner || 'admin', item.label || item.phone, item.persisted_running ? 1 : 0, item.sent_count || 0, item.daily_sent_count || 0, JSON.stringify(item), Date.now());
      }
    } catch (e) {
      console.error('Error saving accounts to SQLite:', e);
    }
  }

  // 2. Pure SQLite primary: Non-blocking debounced backup snapshot for accounts.json
  try {
    asyncSaveJson(ACCOUNTS_FILE, list, 2000);
  } catch (e) {
    console.error('Error scheduling accounts.json backup:', e);
  }
}

async function saveAccountsJson() {
  saveAccountsLocal();
}

// 🛡️ UNINTERRUPTED AUTO-RESUME ON SERVER RESTART
// When PM2 or VPS restarts, any bot that was running before restart automatically resumes!
async function autoResumeRunningBotsOnStartup(): Promise<void> {
  const toResume = Array.from(accounts.values()).filter(a => (a as any).persisted_running && !a.running);
  if (toResume.length === 0) return;
  console.log(`[AUTO-RESUME ON BOOT] Resuming ${toResume.length} bots that were active before server restart...`);

  for (let i = 0; i < toResume.length; i++) {
    const a = toResume[i];
    if (i > 0) {
      await new Promise(r => setTimeout(r, 2000));
    }
    if ((a as any).persisted_running && !a.running) {
      const sessFile = getSessionFile(a.phone);
      if (!fs.existsSync(sessFile)) continue;
      a.running = true;
      const abortController = new AbortController();
      a.abortController = abortController;
      a.status = 'Starting... (Auto-Resumed)';
      launchBotWorker(a.phone, abortController);
      broadcastAccountUpdate(a.owner);
      console.log(`[AUTO-RESUME #${i + 1}/${toResume.length}] Launched worker for ${a.phone} (${a.owner || 'admin'})`);
    }
  }
}

const queueCache = new Map();
const sentUsersCache = new Map();
const peersCache = new Map();
const activeGroupCalls = new Map();
const ownerActiveGroupCalls = new Map<string, { phone: string; call: any; rawCall: any; entity: any; title: string; lastChecked?: number }>();
const ownerExtractingLock = new Set<string>();
const accountLastDmTimestamp = new Map<string, number>();
const accountLastHeartbeat = new Map<string, number>();

// 🛡️ 24/7 VPS CONTINUOUS EXECUTION: All bots run 24/7 uninterrupted on the VPS server.
// Phone locks, app minimize, or mobile data toggles will NEVER shut down running bots.

// 45-Second Real-Time Exit Watcher & Continuous Cache Sync
interface StreamParticipantCacheEntry {
  uids: Set<number>;
  lastSync: number;
  channelTitle?: string;
  call?: any;
}

const streamParticipantsCache = new Map<string, StreamParticipantCacheEntry>();
const scannerWakeupCallbacks = new Map<string, () => void>();

// 🧠 IN-MEMORY RAM CACHE FOR NON-TARGET CHANNELS (Zero Telegram Calls on Scans)
interface CachedIgnoredChannelData {
  ids: Set<string>;
  usernames: Set<string>;
  hashes: Set<string>;
  titles: Set<string>;
  key: string;
  timestamp: number;
}
const ownerIgnoredChannelsCache = new Map<string, CachedIgnoredChannelData>();

async function getOrResolveOwnerIgnoredChannels(owner: string, client: any, effCfg: any): Promise<CachedIgnoredChannelData> {
  const normOwner = owner || 'admin';
  const allRawNonTargets = [
    effCfg.channel_link,
    ...(Array.isArray(effCfg.targets) ? effCfg.targets : [])
  ].filter(Boolean).map((x: any) => String(x).trim());

  const cacheKey = allRawNonTargets.join('||');
  const existing = ownerIgnoredChannelsCache.get(normOwner);

  // If cache is fresh (< 20 mins) and key matches, return immediately with 0 API calls!
  if (existing && existing.key === cacheKey && (Date.now() - existing.timestamp < 20 * 60 * 1000)) {
    return existing;
  }

  const ids = new Set<string>();
  const usernames = new Set<string>();
  const hashes = new Set<string>();
  const titles = new Set<string>();

  const addIgnoredChat = (c: any) => {
    if (!c) return;
    if (c.id) {
      const sid = String(c.id);
      const bare = sid.replace(/^-100/, '').replace(/^-/, '');
      ids.add(sid);
      ids.add(bare);
      ids.add(`-100${bare}`);
      ids.add(`-${bare}`);
    }
    if (c.title) titles.add(String(c.title).trim().toLowerCase());
    if (c.username) usernames.add(String(c.username).trim().toLowerCase());
  };

  for (const rawItem of allRawNonTargets) {
    const item = (rawItem || '').trim();
    if (!item) continue;

    // 1. Numeric ID
    const numOnly = item.match(/^-?100(\d+)$/) || item.match(/^(\d{8,14})$/);
    if (numOnly) {
      const bare = numOnly[1];
      ids.add(bare);
      ids.add(`-100${bare}`);
      ids.add(`-${bare}`);
      continue;
    }

    // 2. Private message link (t.me/c/12345/...)
    const cLinkMatch = item.match(/t\.me\/c\/(\d+)/);
    if (cLinkMatch && cLinkMatch[1]) {
      const bare = cLinkMatch[1];
      ids.add(bare);
      ids.add(`-100${bare}`);
      continue;
    }

    // 3. Private Invite link (+hash or joinchat/hash)
    const inviteMatch = item.match(/(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)/) ||
                        item.match(/^\+([a-zA-Z0-9_-]+)$/);
    if (inviteMatch && inviteMatch[1]) {
      const hash = inviteMatch[1].split('?')[0].replace(/[^a-zA-Z0-9_-]/g, '');
      if (hash) {
        hashes.add(hash.toLowerCase());
        try {
          if (client) {
            const inv: any = await client.invoke(new Api.messages.CheckChatInvite({ hash })).catch(() => null);
            if (inv?.chat) addIgnoredChat(inv.chat);
            if (inv?.title) titles.add(String(inv.title).trim().toLowerCase());
          }
        } catch {}
      }
      continue;
    }

    // 4. Public username (@username or t.me/username)
    if (item.includes('t.me/') || item.includes('telegram.me/') || item.startsWith('@')) {
      const clean = item.split('?')[0].split('#')[0].replace(/\/+$/, '');
      const u = clean.split('/').pop()?.replace('@', '').trim().toLowerCase();
      if (u && u.length >= 3 && !u.startsWith('+') && u !== 'joinchat' && u !== 'c') {
        usernames.add(u);
        try {
          if (client) {
            const ent: any = await client.getEntity(u).catch(() => null);
            if (ent) addIgnoredChat(ent);
          }
        } catch {}
      }
      continue;
    }

    // 5. Plain text title
    if (item.length >= 2) {
      titles.add(item.toLowerCase());
    }
  }

  const result: CachedIgnoredChannelData = {
    ids,
    usernames,
    hashes,
    titles,
    key: cacheKey,
    timestamp: Date.now()
  };
  ownerIgnoredChannelsCache.set(normOwner, result);
  return result;
}

// 👑 MULTI-BOT LIVE STREAM LEADER ENGINE (Leader-Worker Model)
// Only ONE bot scans a given live stream; other bots skip it and scan other channels or send DMs!
interface LiveStreamLeaderInfo {
  phone: string;
  owner: string;
  channelId: string;
  channelTitle: string;
  lockedAt: number;
  lastHeartbeat: number;
}
const globalLiveStreamLeaders = new Map<string, LiveStreamLeaderInfo>();

function isChannelScannedByOtherLeader(channelId: string, currentPhone: string): { isOtherLeader: boolean; leaderPhone?: string } {
  const bareId = String(channelId).replace(/^-100/, '').replace(/^-/, '');
  const existing = globalLiveStreamLeaders.get(bareId) || globalLiveStreamLeaders.get(channelId) || globalLiveStreamLeaders.get(`-100${bareId}`);
  if (existing) {
    // If heartbeat expired (> 25 seconds), treat as stale
    if (Date.now() - existing.lastHeartbeat > 25000) {
      globalLiveStreamLeaders.delete(bareId);
      return { isOtherLeader: false };
    }
    if (existing.phone !== currentPhone) {
      return { isOtherLeader: true, leaderPhone: existing.phone };
    }
  }
  return { isOtherLeader: false };
}

function registerLiveStreamLeader(channelId: string, currentPhone: string, owner: string, title: string) {
  const bareId = String(channelId).replace(/^-100/, '').replace(/^-/, '');
  globalLiveStreamLeaders.set(bareId, {
    phone: currentPhone,
    owner: owner || 'admin',
    channelId,
    channelTitle: title || '',
    lockedAt: Date.now(),
    lastHeartbeat: Date.now()
  });
}

function releaseLiveStreamLeader(channelId: string, currentPhone: string) {
  const bareId = String(channelId).replace(/^-100/, '').replace(/^-/, '');
  const existing = globalLiveStreamLeaders.get(bareId);
  if (existing && existing.phone === currentPhone) {
    globalLiveStreamLeaders.delete(bareId);
  }
}

function wakeScanner(phone: string) {
  const cb = scannerWakeupCallbacks.get(phone);
  if (cb) {
    try {
      cb();
    } catch {}
  }
}

function sleepWithWakeup(phone: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      scannerWakeupCallbacks.delete(phone);
      resolve();
    };
    timer = setTimeout(cleanup, ms);
    scannerWakeupCallbacks.set(phone, cleanup);
  });
}

function extractParticipantUserId(p: any): number {
  if (!p) return 0;
  let pUserId = 0;
  if (p.peer) {
    if (p.peer.userId !== undefined) pUserId = Number(p.peer.userId);
    else if (p.peer.user_id !== undefined) pUserId = Number(p.peer.user_id);
    else if (p.peer.id !== undefined && p.peer.className !== 'PeerChannel' && p.peer.className !== 'PeerChat') {
      pUserId = Number(p.peer.id);
    }
  }
  if (!pUserId) {
    if (p.userId !== undefined) pUserId = Number(p.userId);
    else if (p.user_id !== undefined) pUserId = Number(p.user_id);
    else if (p.id !== undefined) pUserId = Number(p.id);
  }
  return isNaN(pUserId) ? 0 : pUserId;
}

// Temporary in-memory cooldown for live stream candidates (prevents permanent DB blacklisting of real humans)
const tempLiveStreamCooldown = new Map<number, number>();

async function syncStreamParticipantsCache(phone: string, owner: string, client: any): Promise<void> {
  const normOwner = owner || 'admin';
  const act = activeGroupCalls.get(phone) || ownerActiveGroupCalls.get(normOwner);
  if (!act || !act.call || !client) return;

  // 🤝 MULTI-BOT CACHE SHARING: If cache was updated by another bot for the same call < 8 seconds ago, reuse it!
  const callKey = String(act.call.id || phone);
  const existingCache = streamParticipantsCache.get(phone) || streamParticipantsCache.get(callKey);
  if (existingCache && (Date.now() - existingCache.lastSync < 8000)) {
    return;
  }

  try {
    let callInfo: any = null;
    try {
      callInfo = await client.invoke(
        new Api.phone.GetGroupCall({ call: act.call, limit: 100 })
      );
    } catch (callErr: any) {
      const callErrMsg = String(callErr?.message || callErr);
      if (callErrMsg.includes('GROUPCALL_INVALID') || callErrMsg.includes('GROUPCALL_JOIN_MISSING')) {
        purgeAccountVerifiedQueueOnStreamEnd(phone, 'Live stream concluded or call invalid');
        return;
      }
    }

    if (callInfo) {
      const activeUids = new Set<number>();
      if (Array.isArray(callInfo.users)) {
        recordUserPeers(phone, callInfo.users, client);
      }
      if (Array.isArray(callInfo.participants)) {
        for (const p of callInfo.participants) {
          // Exclude stream host & speakers from active listener pool
          const isSpeaker = p.canSelfUnmute === true || p.can_self_unmute === true || p.self === true;
          if (!p.left && !isSpeaker) {
            const pUid = extractParticipantUserId(p);
            if (pUid) activeUids.add(pUid);
          }
        }
      }

      let nextOffset = callInfo.participantsNextOffset || '';
      let pages = 0;
      while (nextOffset && pages < 8) {
        pages++;
        try {
          const more: any = await client.invoke(
            new Api.phone.GetGroupParticipants({
              call: act.call,
              ids: [],
              sources: [],
              offset: nextOffset,
              limit: 100
            })
          ).catch(() => null);

          if (!more) break;
          if (Array.isArray(more.users)) {
            recordUserPeers(phone, more.users, client);
          }
          if (Array.isArray(more.participants)) {
            for (const p of more.participants) {
              const isSpeaker = p.canSelfUnmute === true || p.can_self_unmute === true || p.self === true;
              if (!p.left && !isSpeaker) {
                const pUid = extractParticipantUserId(p);
                if (pUid) activeUids.add(pUid);
              }
            }
          }
          if (more.nextOffset && more.nextOffset !== nextOffset) {
            nextOffset = more.nextOffset;
          } else {
            break;
          }
        } catch {
          break;
        }
      }

      const cacheEntry: StreamParticipantCacheEntry = {
        uids: activeUids,
        lastSync: Date.now(),
        channelTitle: act.title || '',
        call: act.call
      };
      streamParticipantsCache.set(phone, cacheEntry);
      streamParticipantsCache.set(callKey, cacheEntry);
    }
  } catch {}
}

async function verifyUserStreamPresence(
  phone: string,
  owner: string,
  client: any,
  uid: number,
  pInfo: any
): Promise<boolean> {
  const normOwner = owner || 'admin';
  const act = activeGroupCalls.get(phone) || ownerActiveGroupCalls.get(normOwner);
  if (!act || !act.call) {
    return false;
  }

  // 1. Check live participants cache (updated every 3.5s by Continuous Cache Sync)
  const cache = streamParticipantsCache.get(phone);
  if (cache && cache.uids && cache.uids.size > 0) {
    if (cache.uids.has(Number(uid))) {
      return true;
    }
    // If cache was synced recently (< 6 seconds) and user is missing:
    if (Date.now() - cache.lastSync < 6000) {
      if (client) {
        try {
          const accessHash = pInfo?.accessHash || 0;
          const targetInputPeer = new Api.InputPeerUser({
            userId: BigInt(uid) as any,
            accessHash: BigInt(accessHash) as any
          });
          const res: any = await client.invoke(
            new Api.phone.GetGroupParticipants({
              call: act.call,
              ids: [targetInputPeer],
              sources: [],
              offset: '',
              limit: 5
            })
          ).catch(() => null);

          if (res && Array.isArray(res.participants) && res.participants.length > 0) {
            const p = res.participants.find((item: any) => extractParticipantUserId(item) === Number(uid));
            if (p) {
              if (p.left) return false;
              cache.uids.add(Number(uid));
              return true;
            }
          }
          return false;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  // Direct check if cache is not yet warmed up
  if (client) {
    try {
      const accessHash = pInfo?.accessHash || 0;
      const targetInputPeer = new Api.InputPeerUser({
        userId: BigInt(uid) as any,
        accessHash: BigInt(accessHash) as any
      });
      const res: any = await client.invoke(
        new Api.phone.GetGroupParticipants({
          call: act.call,
          ids: [targetInputPeer],
          sources: [],
          offset: '',
          limit: 5
        })
      ).catch(() => null);

      if (res && Array.isArray(res.participants) && res.participants.length > 0) {
        const p = res.participants.find((item: any) => extractParticipantUserId(item) === Number(uid));
        if (p) {
          if (p.left) return false;
          if (cache) cache.uids.add(Number(uid));
          return true;
        }
        return false;
      }
      return false;
    } catch {
      return false;
    }
  }

  return false;
}

async function checkIsStreamStillAlive(owner: string, client: any, phone: string): Promise<boolean> {
  const normOwner = owner || 'admin';
  const act = activeGroupCalls.get(phone) || ownerActiveGroupCalls.get(normOwner);
  if (!act || !client) {
    return true; // If no active stream reference or client, never purge prematurely
  }
  try {
    if (act.call) {
      const callInfo = await client.invoke(
        new Api.phone.GetGroupCall({ call: act.call, limit: 1 })
      ).catch(() => null);
      if (!callInfo || !callInfo.call || callInfo.call.className === 'GroupCallDiscarded') {
        activeGroupCalls.delete(phone);
        ownerActiveGroupCalls.delete(normOwner);
        return false;
      }
      const pCount = callInfo.call.participantsCount || (callInfo.participants ? callInfo.participants.length : 0);
      if (pCount === 0) {
        activeGroupCalls.delete(phone);
        ownerActiveGroupCalls.delete(normOwner);
        return false;
      }
      return true;
    }
    if (act.entity) {
      let fullChat: any = null;
      if (act.entity?.className === 'Chat') {
        fullChat = await client.invoke(
          new Api.messages.GetFullChat({ chatId: act.entity.id })
        ).catch(() => null);
      } else {
        fullChat = await client.invoke(
          new Api.channels.GetFullChannel({ channel: act.entity })
        ).catch(() => null);
      }
      if (fullChat && fullChat.fullChat) {
        const call = fullChat.fullChat.call;
        if (!call || call.className === 'GroupCallDiscarded') {
          activeGroupCalls.delete(phone);
          ownerActiveGroupCalls.delete(normOwner);
          return false;
        }
        return true;
      }
    }
    return true;
  } catch (err: any) {
    // Transient error or timeout: DO NOT mark stream as ended!
    return true;
  }
}

