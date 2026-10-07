// ---------------- LIVE STREAM PEER HEALING & REFRESH HELPER ----------------
async function healPeerFromActiveLiveStream(client: any, phone: string, owner: string, uid: number, pInfo?: any): Promise<any> {
  const uidCleanStr = String(uid).replace(/[^0-9-]/g, '');
  const act = activeGroupCalls.get(phone) || ownerActiveGroupCalls.get(owner);
  if (!act?.call) return null;

  try {
    const callRes: any = await client.invoke(
      new Api.phone.GetGroupCall({ call: act.call, limit: 100 })
    ).catch(() => null);

    if (callRes && Array.isArray(callRes.users)) {
      recordUserPeers(phone, callRes.users, client);
      const match = callRes.users.find((u: any) => String(u.id) === uidCleanStr);
      if (match && match.accessHash && String(match.accessHash) !== '0') {
        const inputPeer = new Api.InputPeerUser({
          userId: BigInt(uidCleanStr) as any,
          accessHash: BigInt(String(match.accessHash)) as any
        });
        if ((client as any)._entityCache?.cacheMap) {
          (client as any)._entityCache.cacheMap.set(uidCleanStr, inputPeer);
        }
        if ((client as any).session && typeof (client as any).session.processEntities === 'function') {
          (client as any).session.processEntities({ users: [match] });
        }
        return inputPeer;
      }
    }

    const partRes: any = await client.invoke(
      new Api.phone.GetGroupParticipants({
        call: act.call,
        ids: [],
        sources: [],
        offset: '',
        limit: 100
      })
    ).catch(() => null);

    if (partRes && Array.isArray(partRes.users)) {
      recordUserPeers(phone, partRes.users, client);
      const match = partRes.users.find((u: any) => String(u.id) === uidCleanStr);
      if (match && match.accessHash && String(match.accessHash) !== '0') {
        const inputPeer = new Api.InputPeerUser({
          userId: BigInt(uidCleanStr) as any,
          accessHash: BigInt(String(match.accessHash)) as any
        });
        if ((client as any)._entityCache?.cacheMap) {
          (client as any)._entityCache.cacheMap.set(uidCleanStr, inputPeer);
        }
        if ((client as any).session && typeof (client as any).session.processEntities === 'function') {
          (client as any).session.processEntities({ users: [match] });
        }
        return inputPeer;
      }
    }
  } catch {}

  return null;
}

/**
 * Interacts with @SpamBot 4-5 times with human-like delays to refresh and lift temporary limit
 * Returns true if SpamBot indicates no limits, false otherwise
 */
async function checkAndResolveSpamBot(client: any, phone: string, isAutoAfterLimit = false): Promise<boolean> {
  if (!client) return false;
  try {
    log(phone, 'INFO', `Contacting @SpamBot (5-cycle verification & appeal system)...`);
    const spamBotPeer = await client.getInputEntity('@SpamBot').catch(() => '@SpamBot');

    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      log(phone, 'INFO', `@SpamBot step (${attempt}/${maxAttempts}): Sending /start`);
      
      // Send /start command
      await client.sendMessage(spamBotPeer, { message: '/start' }).catch(() => null);

      // Wait 3.5 to 5 seconds for SpamBot response
      await new Promise((r) => setTimeout(r, 4000));

      // Get latest message from @SpamBot
      let msgs: any = await client.getMessages(spamBotPeer, { limit: 2 }).catch(() => []);
      let latest = msgs?.[0];
      let text = String(latest?.message || '').toLowerCase();

      // Check if limit is cleared
      if (
        text.includes('good news') ||
        text.includes('no limits') ||
        text.includes('free as a bird') ||
        text.includes('your account is free') ||
        text.includes('no limits are currently applied')
      ) {
        log(phone, 'OK', `🎉 @SpamBot SUCCESS: Account has NO limits! Restriction cleared on attempt ${attempt}/${maxAttempts}.`);
        return true;
      }

      // Check if button click / appeal can be submitted
      if (latest?.replyMarkup?.rows && Array.isArray(latest.replyMarkup.rows)) {
        for (const row of latest.replyMarkup.rows) {
          for (const btn of row.buttons || []) {
            const btnText = String(btn.text || '').toLowerCase();
            if (
              btnText.includes('mistake') ||
              btnText.includes('wrong') ||
              btnText.includes("didn't") ||
              btnText.includes('never') ||
              btnText.includes('yes') ||
              btnText.includes('complaint')
            ) {
              try {
                log(phone, 'INFO', `@SpamBot: Clicking '${btn.text}' button...`);
                await latest.click(btn);
                await new Promise((r) => setTimeout(r, 3500));

                msgs = await client.getMessages(spamBotPeer, { limit: 2 }).catch(() => []);
                latest = msgs?.[0];
                text = String(latest?.message || '').toLowerCase();

                if (
                  text.includes('good news') ||
                  text.includes('no limits') ||
                  text.includes('free as a bird') ||
                  text.includes('your account is free')
                ) {
                  log(phone, 'OK', `🎉 @SpamBot SUCCESS: Restriction lifted after appeal on attempt ${attempt}!`);
                  return true;
                }
              } catch {}
            }
          }
        }
      }

      if (attempt < maxAttempts) {
        log(phone, 'WAIT', `@SpamBot reported limit. Retrying /start cycle in 4-5s (attempt ${attempt + 1}/${maxAttempts})...`);
        await new Promise((r) => setTimeout(r, 4500));
      } else {
        const snippet = latest?.message ? latest.message.slice(0, 100).replace(/\n/g, ' ') : 'Account still restricted';
        log(phone, 'WARN', `@SpamBot: ${snippet}...`);
      }
    }
  } catch (err: any) {
    log(phone, 'WARN', `@SpamBot check exception: ${err?.message || err}`);
  }
  return false;
}

const DEVICE_PROFILES = [
  { deviceModel: 'realme realme P2 Pro 5G', systemVersion: 'Android 14 (SDK 34)', appVersion: 'Telegram Android 12.10.1' },
  { deviceModel: 'OnePlus 12', systemVersion: 'Android 14 (CPH2581_14.0.0.404)', appVersion: 'Telegram Android 12.10.1' },
  { deviceModel: 'Samsung Galaxy S24 Ultra', systemVersion: 'Android 14 (UP1A.231005.007)', appVersion: 'Telegram Android 12.10.1' },
  { deviceModel: 'Samsung Galaxy S23+', systemVersion: 'Android 14 (TP1A.220624.014)', appVersion: 'Telegram Android 12.10.1' },
  { deviceModel: 'Google Pixel 8 Pro', systemVersion: 'Android 14 (UD1A.230803.041)', appVersion: 'Telegram Android 12.10.1' },
  { deviceModel: 'Google Pixel 7a', systemVersion: 'Android 13 (TQ2A.230505.002)', appVersion: 'Telegram Android 12.10.1' },
  { deviceModel: 'Xiaomi 14 Pro', systemVersion: 'Android 14 (OS1.0.24.0.UNBCNXM)', appVersion: 'Telegram Android 12.10.1' },
  { deviceModel: 'Vivo X100 Pro', systemVersion: 'Android 14 (SDK 34)', appVersion: 'Telegram Android 12.10.1' }
];

function getDeviceProfileForPhone(phone: string) {
  let hash = 0;
  for (let i = 0; i < phone.length; i++) {
    hash = (hash * 31 + phone.charCodeAt(i)) & 0xffffffff;
  }
  const index = Math.abs(hash) % DEVICE_PROFILES.length;
  return DEVICE_PROFILES[index];
}

// 🤖 TELEGRAM BOT FAST FILTER & EARLY CHANNEL LOCK
// Cache of channel IDs for each user's filter bot: token -> { timestamp, channels: Map<string, string> }
const filterBotAdminChannelsCache = new Map<string, { timestamp: number; channels: Map<string, string> }>();
const knownJoinedMembersCache = new Set<string>();

async function getFilterBotAdminChannels(botToken: string, owner: string, providedLink?: string): Promise<Map<string, string>> {
  const cached = filterBotAdminChannelsCache.get(botToken);
  if (cached && Date.now() - cached.timestamp < 300000 && cached.channels.size > 0 && !providedLink) {
    return cached.channels;
  }

  const channels = (cached && cached.channels) ? new Map(cached.channels) : new Map<string, string>(); // chatId -> title

  try {
    const updRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/getUpdates?limit=100`);
    const updData: any = await updRes.json().catch(() => null);
    if (updData && updData.ok && Array.isArray(updData.result)) {
      for (const u of updData.result) {
        const chat = u.my_chat_member?.chat || u.chat_member?.chat || u.channel_post?.chat || u.message?.chat;
        if (chat && (chat.type === 'channel' || chat.type === 'supergroup')) {
          const cid = String(chat.id);
          channels.set(cid, chat.title || `Channel ${cid}`);
          if (chat.username) {
            channels.set('@' + chat.username.toLowerCase(), chat.title || `@${chat.username}`);
          }
        }
      }
    }
  } catch {}

  // Also resolve from providedLink or user's master_config.channel_link
  const uObj = getUser(owner);
  const chLink = (providedLink || uObj?.master_config?.channel_link || '').trim();
  if (chLink) {
    // 1. If numeric channel ID in link (e.g. -1002345678901 or /c/2345678901)
    const numMatch = chLink.match(/-100\d+|\/c\/(\d+)/);
    if (numMatch) {
      const nid = numMatch[1] ? `-100${numMatch[1]}` : numMatch[0];
      try {
        const gcRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/getChat?chat_id=${encodeURIComponent(nid)}`);
        const gcD: any = await gcRes.json().catch(() => null);
        if (gcD?.ok && gcD.result) {
          channels.set(nid, gcD.result.title || `Target Channel (${nid})`);
          if (gcD.result.username) channels.set('@' + gcD.result.username.toLowerCase(), gcD.result.title);
        } else {
          channels.set(nid, `Target Channel (${nid})`);
        }
      } catch {
        channels.set(nid, `Target Channel (${nid})`);
      }
    }

    // 2. If public username
    const pubMatch = chLink.match(/t\.me\/([a-zA-Z0-9_]{4,})(?:\/|\?|$)/);
    if (pubMatch && !pubMatch[1].startsWith('+') && !chLink.includes('/+')) {
      const pubUser = '@' + pubMatch[1].toLowerCase();
      try {
        const getChatRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/getChat?chat_id=${encodeURIComponent(pubUser)}`);
        const gcData: any = await getChatRes.json().catch(() => null);
        if (gcData?.ok && gcData.result?.id) {
          channels.set(String(gcData.result.id), gcData.result.title || pubUser);
          channels.set(pubUser, gcData.result.title || pubUser);
        }
      } catch {}
    }
  }

  // 3. Also check active accounts of this owner to match private invite link in dialogs
  if (channels.size === 0 && chLink) {
    for (const acc of accounts.values()) {
      if ((acc.owner || 'admin') === owner && acc.client && acc.running) {
        try {
          const dlgs = await acc.client.getDialogs({ limit: 40 }).catch(() => []);
          for (const d of dlgs) {
            if (d.isChannel || d.isGroup) {
              const did = String(d.id);
              const didFull = did.startsWith('-100') ? did : `-100${did.replace(/^-/, '')}`;
              try {
                const gcRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/getChat?chat_id=${encodeURIComponent(didFull)}`);
                const gcD: any = await gcRes.json().catch(() => null);
                if (gcD?.ok && gcD.result) {
                  channels.set(didFull, gcD.result.title || d.title || didFull);
                }
              } catch {}
            }
          }
        } catch {}
      }
    }
  }

  filterBotAdminChannelsCache.set(botToken, { timestamp: Date.now(), channels });
  return channels;
}

async function isUserAlreadyInChannel(
  owner: string,
  uid: number,
  phone?: string,
  client?: any
): Promise<{ inChannel: boolean; channelName?: string }> {
  if (!uid || isNaN(uid) || uid <= 0) return { inChannel: false };

  const cacheKey = `${owner}:${uid}`;
  if (knownJoinedMembersCache.has(cacheKey)) {
    return { inChannel: true, channelName: 'Target Channel (Joined Member)' };
  }

  const uObj = getUser(owner);
  const botToken = uObj?.master_config?.filter_bot_token?.trim();

  // 1. FAST BOT API CHECK (Zero Flood Wait, 100% Reliable for Public & Private Channels)
  if (botToken) {
    try {
      const adminChannels = await getFilterBotAdminChannels(botToken, owner);
      const targets = Array.from(adminChannels.keys());

      // If no admin channels were auto-discovered from getUpdates, also fallback to channel_link if available
      const rawChLink = (uObj?.master_config?.channel_link || '').trim();
      if (rawChLink) {
        const pubMatch = rawChLink.match(/t\.me\/([a-zA-Z0-9_]{4,})(?:\/|\?|$)/);
        if (pubMatch && !pubMatch[1].startsWith('+') && !rawChLink.includes('/+')) {
          const pubTarget = '@' + pubMatch[1].toLowerCase();
          if (!targets.includes(pubTarget)) targets.push(pubTarget);
        }
      }

      for (const targetChat of targets) {
        try {
          const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getChatMember?chat_id=${encodeURIComponent(targetChat)}&user_id=${uid}`;
          const res = await fetch(url);
          const data: any = await res.json().catch(() => null);
          if (data && data.ok && data.result) {
            const st = data.result.status;
            const isMember = data.result.is_member;
            if (st === 'member' || st === 'administrator' || st === 'creator' || (st === 'restricted' && isMember !== false)) {
              knownJoinedMembersCache.add(cacheKey);
              const title = adminChannels.get(targetChat) || targetChat;
              return { inChannel: true, channelName: title };
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // 2. MTPROTO CLIENT FALLBACK (If Bot API not configured or not resolved)
  if (client) {
    try {
      const rawChLink = (uObj?.master_config?.channel_link || '').trim();
      if (rawChLink) {
        let chEntity: any = null;
        try {
          chEntity = await client.getEntity(rawChLink).catch(() => null);
        } catch {}

        if (chEntity) {
          const participant = await Promise.race([
            client.invoke(new Api.channels.GetParticipant({
              channel: chEntity,
              participant: uid
            })),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
          ]).catch(() => null);

          if (participant) {
            knownJoinedMembersCache.add(cacheKey);
            return { inChannel: true, channelName: chEntity.title || 'Target Channel' };
          }
        }
      }
    } catch {}
  }

  return { inChannel: false };
}

async function runTelegramBot(phone: string, signal: AbortSignal) {
  const a = accounts.get(phone);
  if (!a) return;
  if (signal.aborted) return;
  a.running = true;

  a.sent_users = loadSentUsers(phone);
  log(phone, 'OK', `Starting up... ${a.sent_users.size} previously-DMed users loaded`);

  const savedSession = await loadSessionString(phone);
  const stringSession = new StringSession(savedSession);

  const deviceProf = getDeviceProfileForPhone(phone);

  let deviceModel = deviceProf.deviceModel;
  let systemVersion = deviceProf.systemVersion;
  let appVersion = 'Telegram Android 12.10.1';

  const isMobile = (a as any).engine_mode === 'mobile_app' || 
    (a as any).device_mode === 'mobile' || 
    (a as any).is_mobile ||
    getUser(a.owner || '')?.access_type === 'app_only' ||
    Boolean(a.phone && a.phone.length > 5); // Default all user phone bots to realistic Android mobile device

  if (isMobile) {
    // 📱 Force authentic Mobile Android Signature so Telegram -> Settings -> Devices shows Android Phone!
    deviceModel = (a as any).device_model || deviceProf.deviceModel || 'Samsung Galaxy S24 Ultra';
    systemVersion = (a as any).system_version || deviceProf.systemVersion || 'Android 14 (UP1A.231005.007)';
    appVersion = 'Telegram Android 12.10.1';
  } else if (a.api_id === 2040) {
    deviceModel = 'PC 64bit';
    systemVersion = 'Windows 11 (23H2)';
    appVersion = '5.1.0 x64';
  } else if (a.api_id === 2834) {
    deviceModel = 'iPhone 15 Pro';
    systemVersion = 'iOS 17.5.1';
    appVersion = '10.14.0';
  } else if (a.api_id === 17349) {
    deviceModel = 'MacBook Pro 16';
    systemVersion = 'macOS 14.5';
    appVersion = '10.9.1';
  } else if (a.api_id === 2496) {
    deviceModel = 'Chrome / Linux x86_64';
    systemVersion = 'Linux';
    appVersion = 'WebK 2.1.0';
  }

  log(phone, 'INFO', `Device Emulation: ${deviceModel} [${systemVersion}] (API ID: ${a.api_id})`);

  const clientParams: any = {
    connectionRetries: 5,
    useWSS: false,
    autoReconnect: true,
    catchUp: false,
    timeout: 15,
    deviceModel,
    systemVersion,
    appVersion,
    langCode: 'en',
    systemLangCode: 'en-US'
  };

  const effectiveProxy = getEffectiveProxyForAccount(phone, a);
  if (effectiveProxy) {
    clientParams.proxy = effectiveProxy;
    log(phone, 'OK', `🛡️ Connected via Proxy: ${effectiveProxy.ip}:${effectiveProxy.port}${effectiveProxy.username ? ' (Authenticated/Sticky)' : ''}`);
  }

  const client = new TelegramClient(stringSession, a.api_id, a.api_hash, clientParams);
  try {
    (client as any).setLogLevel('none');
    if ((client as any)._entityCache) {
      (client as any)._entityCache.maxEntities = 40;
    }
  } catch {}
  client.onError = async (err       ) => {
    const msg = err?.message || String(err);
    if (msg.includes('TIMEOUT')) return;
    if (msg.includes('AUTH_KEY_UNREGISTERED') || msg.includes('SESSION_REVOKED') || msg.includes('401')) {
      log(phone, 'FAIL', `Session terminated/expired remotely (401: AUTH_KEY_UNREGISTERED). Auto-clearing dead session.`);
      a.status = 'Logged Out (Session Revoked)';
      a.running = false;
      const sessFile = getSessionFile(phone);
      if (fs.existsSync(sessFile)) {
        try { fs.unlinkSync(sessFile); } catch {}
      }
      broadcastAccountUpdate(a.owner);
      await client.disconnect().catch(() => {});
      return;
    }
    log(phone, 'WARN', `Telegram client: ${msg.slice(0, 80)}`);
  };
  a.client = client;

  let connected = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await client.connect();
      connected = true;
      break;
    } catch (err: any) {
      log(phone, 'WARN', `Connect attempt ${attempt}/3 failed: ${String(err?.message || err).slice(0, 80)}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2500));
    }
  }
  if (!connected) {
    log(phone, 'FAIL', `Connect failed after 3 attempts. Auto-reconnecting...`);
    if (signal.aborted) {
      a.running = false;
      a.status = 'Failed - network error';
      return;
    }
    a.status = 'Reconnecting...';
    throw new Error('Telegram connection failed (will auto-retry)');
  }

  // Pre-seed GramJS entityCache and session with known saved peers from Master Owner Store & phone store
  try {
    const owner = a.owner || 'admin';
    const ownerPeers = getOwnerPeers(owner);
    const savedPeers = loadPeers(phone);
    const mockUsers: any[] = [];

    // Combine Master Owner Peers with local account peers
    const allPeers = new Map<string, PeerInfo>();
    for (const [uidStr, pInfo] of ownerPeers.entries()) {
      allPeers.set(uidStr, pInfo);
    }
    for (const [uidNum, pInfo] of savedPeers.entries()) {
      const uStr = String(uidNum);
      if (!allPeers.has(uStr)) {
        allPeers.set(uStr, pInfo);
      }
    }

    for (const [uidStr, pInfo] of allPeers.entries()) {
      const hash = pInfo.accessHash || (pInfo.accessHashes && pInfo.accessHashes[phone]);
      if (hash && String(hash) !== '0') {
        const inputPeer = new Api.InputPeerUser({
          userId: BigInt(uidStr) as any,
          accessHash: BigInt(hash) as any
        });
        if ((client as any)._entityCache) {
          (client as any)._entityCache.set?.(uidStr, inputPeer);
          if ((client as any)._entityCache.cacheMap) {
            (client as any)._entityCache.cacheMap.set(uidStr, inputPeer);
          }
        }
        mockUsers.push(new Api.User({
          id: BigInt(uidStr) as any,
          accessHash: BigInt(hash) as any,
          username: pInfo.username || undefined
        }));
      }
    }
    if (mockUsers.length > 0 && (client as any).session && typeof (client as any).session.processEntities === 'function') {
      (client as any).session.processEntities(mockUsers);
    }
  } catch {}

  let myId                = null;

  // Check login
  const isAuthorized = await client.isUserAuthorized().catch(() => false);
  if (isAuthorized) {
    try {
      const me      = await client.getMe();
      if (me?.id) myId = Number(me.id);
      log(phone, 'OK', `Session valid, auto-login: ${me?.firstName || me?.username || 'User'}`);
      a.status = 'online';
      if (me?.username) {
        a.username = me.username;
        saveAccountsJson();
      }
    } catch {
      // ignore
    }
  } else {
    // Start / Login flow using GramJS client.start
    log(phone, 'INFO', `Starting authentication for ${phone}...`);
    try {
      await client.start({
        phoneNumber: async () => phone,
        phoneCode: async (isCodeViaApp?: boolean) => {
          a.status = 'awaiting_otp';
          broadcastAccountUpdate(a.owner);
          const via = isCodeViaApp ? 'Telegram App' : 'Telegram/SMS';
          log(phone, 'OTP', `📱 OTP code sent via ${via} to ${phone} - ENTER IT IN DASHBOARD`);

          const pending: any = pendingAuthMap.get(phone) || {};
          pending.waiting = 'otp';
          pending.phone = phone;
          pendingAuthMap.set(phone, pending);

          return new Promise<string>((resolve, reject) => {
            pending.otpResolve = resolve;
            pending.otpReject = reject;
            setTimeout(() => {
              if (pending.waiting === 'otp') {
                reject(new Error('OTP timeout (10 min). Press START again.'));
              }
            }, 600000);
          });
        },
        password: async () => {
          a.status = 'awaiting_2fa';
          broadcastAccountUpdate(a.owner);
          log(phone, 'OTP', '🔒 2FA Cloud Password required - ENTER IT IN DASHBOARD');

          const pending: any = pendingAuthMap.get(phone) || {};
          pending.waiting = 'twofa';
          pending.phone = phone;
          pendingAuthMap.set(phone, pending);

          if (typeof pending.notifyResult === 'function') {
            pending.notifyResult({
              success: true,
              status: 'awaiting_2fa',
              msg: '🔒 2FA Cloud Password required. Please enter your password.'
            });
            pending.notifyResult = null;
          }

          return new Promise<string>((resolve, reject) => {
            pending.twoFaResolve = resolve;
            pending.twoFaReject = reject;
            setTimeout(() => {
              if (pending.waiting === 'twofa') {
                reject(new Error('2FA timeout. Press START again.'));
              }
            }, 600000);
          });
        },
        onError: async (err: any): Promise<boolean> => {
          const errMsg = String(err?.message || err?.errorMessage || err);
          if (errMsg.includes('SESSION_PASSWORD_NEEDED')) {
            // GramJS will transition to password() callback next - do not crash
            return false;
          }

          const pending = pendingAuthMap.get(phone);
          let userMsg = errMsg;
          if (errMsg.includes('PHONE_CODE_INVALID')) {
            userMsg = '❌ Incorrect OTP code entered. Please enter the latest code received on Telegram.';
          } else if (errMsg.includes('PHONE_CODE_EXPIRED')) {
            userMsg = '❌ OTP code expired. Click "START BOT" to request a new code.';
          } else if (errMsg.includes('PASSWORD_HASH_INVALID')) {
            userMsg = '❌ Incorrect 2FA Password.';
          } else if (errMsg.includes('API_ID_INVALID')) {
            userMsg = '❌ Invalid API ID/Hash. Please check my.telegram.org.';
          } else if (errMsg.includes('PHONE_NUMBER_BANNED')) {
            userMsg = '❌ Telegram phone number is banned.';
          }

          if (pending && typeof pending.notifyResult === 'function') {
            pending.notifyResult({ success: false, status: 'failed', msg: userMsg });
            pending.notifyResult = null;
          }

          log(phone, 'FAIL', userMsg);
          throw new Error(errMsg);
        }
      });
    } catch (err: any) {
      const errMsg = String(err?.message || err?.errorMessage || err);
      log(phone, 'FAIL', `Login stopped: ${errMsg}`);
      
      const pending = pendingAuthMap.get(phone);
      if (pending && typeof pending.notifyResult === 'function') {
        pending.notifyResult({ success: false, status: 'failed', msg: `Login failed: ${errMsg}` });
      }
      pendingAuthMap.delete(phone);

      if (errMsg.includes('PHONE_CODE_INVALID')) {
        a.status = 'Invalid OTP - Click START to retry';
      } else if (errMsg.includes('PHONE_CODE_EXPIRED')) {
        a.status = 'Expired OTP - Click START to retry';
      } else if (errMsg.includes('PASSWORD_HASH_INVALID')) {
        a.status = 'Invalid 2FA Password';
      } else if (errMsg.includes('API_ID_INVALID')) {
        a.status = 'Failed - Invalid API ID/Hash';
      } else {
        a.status = `Failed - ${errMsg.slice(0, 30)}`;
      }
      a.running = false;
      broadcastAccountUpdate(a.owner);
      await client.disconnect().catch(() => {});
      return;
    }

    // Save session string immediately upon successful authentication to disk and Local Storage
    const pending = pendingAuthMap.get(phone);
    const newSession = client.session.save() as unknown as string;
    if (newSession) {
      await saveSessionString(phone, newSession);
    }
    a.status = 'online';
    a.running = true;
    broadcastAccountUpdate(a.owner);
    await saveAccountsJson();
    log(phone, 'OK', `✅ Authentication successful for ${phone}! Session stored.`);

    // Instantly notify any awaiting HTTP verification request so the UI transitions with zero delay
    if (pending && typeof pending.notifyResult === 'function') {
      pending.notifyResult({
        success: true,
        status: 'online',
        msg: `✅ Logged in successfully! Telegram account is now online.`
      });
      pending.notifyResult = null;
    }
    pendingAuthMap.delete(phone);

    // Asynchronously resolve user profile details without blocking authentication return
    (async () => {
      try {
        const me = await client.getMe().catch(() => null);
        if (me?.id) myId = Number(me.id);
        let updated = false;
        if (me?.username && a.username !== me.username) {
          a.username = me.username;
          updated = true;
        }
        if (me?.firstName && (!a.label || a.label.startsWith('+') || /^Account\s*\d+$/i.test(a.label))) {
          const fullTgName = [me.firstName, me.lastName].filter(Boolean).join(' ').trim();
          a.label = fullTgName || me.firstName;
          updated = true;
        }
        if (updated) {
          await saveAccountsJson();
          broadcastAccountUpdate(a.owner);
        }
      } catch {}
    })();

    // Pre-seed entity cache with all known peers
    const knownPeers = loadPeers(phone);
    const seedUsers: any[] = [];
    for (const [uidStr, pInfo] of knownPeers.entries()) {
      if (pInfo.accessHash && String(pInfo.accessHash) !== '0') {
        try {
          seedUsers.push(
            new Api.User({
              id: BigInt(uidStr) as any,
              accessHash: BigInt(pInfo.accessHash) as any,
              username: pInfo.username
            })
          );
        } catch {}
      }
    }
    if (seedUsers.length > 0) {
      try {
        if ((client       ).session && typeof (client       ).session.processEntities === 'function') {
          (client       ).session.processEntities(seedUsers);
        }
        if ((client       )._entityCache) {
          (client       )._entityCache.add(seedUsers);
        }
      } catch {}
    }
  }

  a.status = 'Monitoring...';

  // 🧹 Auto-clean personal chats older than 24 hours (1 day) upon bot boot
  setTimeout(() => {
    cleanOldPersonalChatsForAccount(phone, 1).catch((err) => {
      log(phone, 'WARN', `Boot chat cleanup notice: ${err?.message || err}`);
    });
  }, 3500);

  // 1. Multi-Account Distributed Filter Worker (Raw Queue -> Verified Queue)
  const filterLoopPromise = (async () => {
    const BATCH_SIZE = 50; // High-throughput batch for instant Node.js processing
    let cachedChEntity: any = null;
    let cachedChLink = '';
    let lastChFetch = 0;

    while (a.running) {
      if (signal.aborted) break;

      try {
        const owner = a.owner || "admin";
        if (getOwnerVerifiedQueue(owner).length >= 100000) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        const batch = claimBatchFromRawQueue(owner, phone, BATCH_SIZE);

        if (batch.length === 0) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        log(
          phone,
          'DB',
          `🔍 Claimed batch of ${batch.length} candidate(s) from Raw Queue. Applying Node.js filters...`
        );

        let validCount = 0;
        let skippedCount = 0;
        const verifiedBatch: number[] = [];

        // Pre-resolve channel entity once if Early Channel Lock is enabled
        const effChLink = getEffectiveConfig(a).channel_link;
        if (globalAiConfig.channel_lock_early !== false && effChLink) {
          if (effChLink !== cachedChLink || Date.now() - lastChFetch > 60000 || !cachedChEntity) {
            try {
              cachedChEntity = await Promise.race([
                client.getEntity(effChLink),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
              ]).catch(() => null);
              cachedChLink = effChLink;
              lastChFetch = Date.now();
            } catch {}
          }
        }

        for (const uid of batch) {
          if (signal.aborted || !a.running) {
            releaseOwnerRawReservation(owner, uid);
            break;
          }

          try {
            const sent = getOwnerSentUsers(owner);
            const skipped = getOwnerSkippedUsers(owner);
            const verified = getOwnerVerifiedQueue(owner);
            const verifiedSet = new Set(verified);

            if (sent.has(uid) || skipped.has(uid) || verifiedSet.has(uid)) {
              removeFromOwnerRawQueue(owner, uid);
              continue;
            }

            const ownerPeers = getOwnerPeers(owner);
            const pInfo = ownerPeers.get(String(uid));
            let userObj: any = null;
            let targetPeer: any = null;

            // 1. Check Non-Indian Phone (if phone available, Indian numbers start with 91 or +91)
            const rawPhone = String(pInfo?.phone || '').trim();
            const cleanPhone = rawPhone.replace(/^\+/, '');
            if (cleanPhone && !cleanPhone.startsWith('91')) {
              skippedCount++;
              markOwnerSkippedUser(owner, uid, `Non-Indian Phone (${rawPhone})`, {
                name: pInfo?.firstName,
                username: pInfo?.username,
                phone: rawPhone,
                category: 'other',
                skippedByPhone: phone
              });
              removeFromOwnerRawQueue(owner, uid);
              log(phone, 'SKIP', `🌍 [NON-INDIAN FILTER] Skipped ${pInfo?.firstName || uid}: Non-Indian phone (+${cleanPhone}).`);
              continue;
            }

            // 2. Strict Check: Telegram Premium accounts
            if (pInfo?.isPremium || (globalAiConfig.reject_premium !== false && pInfo?.isPremium)) {
              skippedCount++;
              markOwnerSkippedUser(owner, uid, 'Telegram Premium Account', {
                name: pInfo?.firstName,
                username: pInfo?.username,
                phone: pInfo?.phone,
                category: 'premium',
                skippedByPhone: phone
              });
              removeFromOwnerRawQueue(owner, uid);
              log(phone, 'SKIP', `⭐ [PREMIUM FILTER] Skipped ${pInfo?.firstName || pInfo?.username || uid}: Telegram Premium account.`);
              continue;
            }

            // 3. Strict Check: Bots
            if (pInfo?.isBot || (globalAiConfig.reject_bots !== false && pInfo?.isBot)) {
              skippedCount++;
              markOwnerSkippedUser(owner, uid, 'Telegram Bot Account', {
                name: pInfo?.firstName,
                username: pInfo?.username,
                phone: pInfo?.phone,
                category: 'bot',
                skippedByPhone: phone
              });
              removeFromOwnerRawQueue(owner, uid);
              continue;
            }

            // 4. Strict Check: Deleted / Scam Accounts
            if (pInfo?.isDeleted || (globalAiConfig.reject_deleted !== false && pInfo?.isDeleted)) {
              skippedCount++;
              markOwnerSkippedUser(owner, uid, 'Deleted / Scam Account', {
                name: pInfo?.firstName,
                username: pInfo?.username,
                phone: pInfo?.phone,
                category: 'deleted',
                skippedByPhone: phone
              });
              removeFromOwnerRawQueue(owner, uid);
              continue;
            }

            // 4b. Strict Check: Privacy Restricted (Only My Contacts)
            if (pInfo?.isPrivacyRestricted) {
              skippedCount++;
              markOwnerSkippedUser(owner, uid, 'User privacy restricted (Only Contacts)', {
                name: pInfo?.firstName,
                username: pInfo?.username,
                phone: pInfo?.phone,
                category: 'privacy',
                skippedByPhone: phone
              });
              removeFromOwnerRawQueue(owner, uid);
              log(phone, 'SKIP', `🔒 [PRIVACY PRE-FILTER] Skipped ${pInfo?.firstName || uid}: User restricts messages to contacts only.`);
              continue;
            }

            const hasUsername = Boolean(pInfo?.username && String(pInfo.username).trim().length > 0);

            // 5. Strict Rule: @username are NOT ALLOWED (Users with @username are skipped)
            if (globalAiConfig.reject_usernames !== false && hasUsername) {
              skippedCount++;
              const uname = pInfo?.username || 'user';
              markOwnerSkippedUser(owner, uid, 'Has @username (Filtered by Node.js rule)', {
                name: pInfo?.firstName,
                username: uname,
                phone: pInfo?.phone,
                category: 'has_username',
                skippedByPhone: phone
              });
              removeFromOwnerRawQueue(owner, uid);
              log(phone, 'SKIP', `🚫 [USERNAME FILTER] Skipped @${uname.replace(/^@/, '')}: Account has @username.`);
              continue;
            }

            // 6. Strict Check: Exclude Admins & Channel/Group Owners
            if ((globalAiConfig.reject_admins !== false) && isTelegramAdminOrOwner(null, pInfo)) {
              skippedCount++;
              markOwnerSkippedUser(owner, uid, 'Admin or Channel/Group Owner', {
                name: pInfo?.firstName,
                username: pInfo?.username,
                phone: pInfo?.phone,
                category: 'admin',
                skippedByPhone: phone
              });
              removeFromOwnerRawQueue(owner, uid);
              log(phone, 'SKIP', `👑 [ADMIN FILTER] Skipped ${pInfo?.firstName || uid}: Group/Channel Admin or Owner.`);
              continue;
            }

            // 7. Strict Check: Node.js Fast Pattern & Scam/Gambling/Betting/Color Prediction Filter
            if (globalAiConfig.reject_scam_keywords !== false) {
              const spamCheck = isTelegramUserSpamOrPromo(null, pInfo);
              if (spamCheck.isSpam) {
                skippedCount++;
                markOwnerSkippedUser(owner, uid, spamCheck.reason, {
                  name: pInfo?.firstName,
                  username: pInfo?.username,
                  phone: pInfo?.phone,
                  category: 'spam_bio',
                  skippedByPhone: phone
                });
                removeFromOwnerRawQueue(owner, uid);
                log(phone, 'SKIP', `🚫 [NODE.JS SPAM FILTER] Skipped ${pInfo?.firstName || uid}: ${spamCheck.reason}`);
                continue;
              }
            }

            // 8. Optional AI Filter (Only if explicitly enabled by admin in AI tab)
            if (globalAiConfig.filter_enabled && globalAiConfig.filter_mode !== 'smart_keyword') {
              try {
                const batchResults = await analyzeTelegramUsersBatch([{
                  uid,
                  firstName: pInfo?.firstName,
                  lastName: pInfo?.lastName,
                  username: pInfo?.username,
                  phone: pInfo?.phone,
                  about: pInfo?.about
                }]);
                const aiVerdict = batchResults.get(uid);
                if (aiVerdict && aiVerdict.status === "REJECTED") {
                  skippedCount++;
                  markOwnerSkippedUser(owner, uid, aiVerdict.reason, {
                    name: pInfo?.firstName,
                    username: pInfo?.username,
                    phone: pInfo?.phone,
                    category: aiVerdict.category || "spam_bio",
                    skippedByPhone: phone
                  });
                  removeFromOwnerRawQueue(owner, uid);
                  log(phone, 'SKIP', `🚫 [AI FILTER] Skipped ${pInfo?.firstName || uid}: ${aiVerdict.reason}`);
                  continue;
                }
              } catch {}
            }

            // 9. Telegram Bot Fast Filter & Early Channel Lock (skip users already in the target channel)
            if (globalAiConfig.channel_lock_early !== false) {
              const chCheck = await isUserAlreadyInChannel(owner, uid, phone, client);
              if (chCheck.inChannel) {
                skippedCount++;
                markOwnerSkippedUser(owner, uid, `Already joined ${chCheck.channelName || 'target channel'} (Fast Bot Filter)`, {
                  name: pInfo?.firstName,
                  category: 'other',
                  skippedByPhone: phone
                });
                removeFromOwnerRawQueue(owner, uid);
                log(phone, 'SKIP', `🔒 [FAST BOT FILTER] Skipped ${pInfo?.firstName || uid}: ALREADY JOINED in ${chCheck.channelName || 'channel'}.`);
                continue;
              }
            }

            // 10. Peer Resolution & Pre-Flight Validation in Raw Queue
            const evalClient = (pInfo?.sourcePhone && accounts.get(pInfo.sourcePhone)?.client) || client;
            const evalPhone = pInfo?.sourcePhone || phone;
            try {
              if (!targetPeer) {
                targetPeer = await resolveTargetPeer(evalClient, uid, pInfo, evalPhone).catch(() => null);
              }
            } catch {}

            if (!targetPeer && !pInfo?.username) {
              skippedCount++;
              markOwnerSkippedUser(owner, uid, 'Cannot resolve Telegram Peer entity / access hash', {
                name: pInfo?.firstName,
                category: 'no_peer',
                skippedByPhone: evalPhone
              });
              removeFromOwnerRawQueue(owner, uid);
              log(phone, 'SKIP', `🔒 [RAW PEER FILTER] Skipped ${pInfo?.firstName || uid}: Peer unresolvable.`);
              continue;
            }

            // 11. Multi-Account Entity Cache Injection: Inject peer into ALL accounts of this owner
            broadcastPeerToOwnerClients(owner, String(uid), pInfo);

            // Cloud Contact Save during Live Stream (Instant permanent lock into Telegram Cloud Contacts)
            await lockContactPermanently(evalClient, evalPhone, uid, pInfo).catch(() => null);

            // Pre-check Privacy & Peer Settings at Raw Stage (Skip contact-only users right here!)
            try {
              if (targetPeer) {
                const settingsRes: any = await Promise.race([
                  evalClient.invoke(new Api.messages.GetPeerSettings({ peer: targetPeer })),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 2500))
                ]).catch(() => null);
                const st = settingsRes?.settings;
                if (st?.needContactsException || st?.blockContact) {
                  skippedCount++;
                  markOwnerSkippedUser(owner, uid, 'User privacy restricted (Only Contacts can message)', {
                    name: pInfo?.firstName,
                    username: pInfo?.username,
                    phone: pInfo?.phone,
                    category: 'privacy',
                    skippedByPhone: evalPhone
                  });
                  removeFromOwnerRawQueue(owner, uid);
                  log(phone, 'SKIP', `🔒 [RAW ONLY-CONTACT FILTER] Skipped ${pInfo?.firstName || uid}: Only Contacts can message (Filtered out at Raw stage).`);
                  continue;
                }
                await evalClient.invoke(new Api.messages.GetHistory({ peer: targetPeer, limit: 1 })).catch(() => null);
              }
            } catch {}

            // 12. PROMOTION TO GENUINE QUEUE (100% Verified Clean Lead Ready for DM)
            validCount++;
            markGlobalVerified(uid);
            verifiedBatch.push(uid);
            addToOwnerVerifiedQueue(owner, [uid]);
            removeFromOwnerRawQueue(owner, uid);
            log(phone, 'OK', `⚡ [GENUINE - NODE.JS] ${pInfo?.firstName || uid} promoted to Genuine Queue (100% DM Ready & Cloud Contact Saved).`);
          } catch (uErr: any) {
            log(phone, 'WARN', `Filter error on user ${uid}: ${uErr?.message || uErr}`);
            releaseOwnerRawReservation(owner, uid);
          }
        }

        if (validCount > 0 || skippedCount > 0) {
          log(
            phone,
            "OK",
            `✅ Batch of ${batch.length} completed: +${validCount} Genuine Users ready (Pruned ${skippedCount}). Verified Queue: ${getOwnerVerifiedQueue(owner).length} | Raw Left: ${getOwnerRawQueue(owner).length}`
          );
        }

        // Adaptive rest: If raw queue still has users, process next batch with minimal 200ms delay
        const rawRemaining = getOwnerRawQueue(owner).length;
        const restMs = (batch.length > 0 && rawRemaining > 0) ? 200 : 2000;
        await new Promise((r) => setTimeout(r, restMs));
      } catch (loopErr: any) {
        log(phone, 'WARN', `Filter worker loop error: ${loopErr?.message || loopErr}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })();

  // 2. DM Worker runner in background (Processes 100% Genuine Verified Queue in 10-User Batches)
  const dmLoopPromise = (async () => {
    while (a.running) {
      if (signal.aborted) break;

      const owner = a.owner || 'admin';

      if (!a.dm_on) {
        // Auto-check if account is in 10-Min Rest Mode due to PEER_FLOOD
        if ((a as any).dm_rest_until) {
          const now = Date.now();
          if (now >= (a as any).dm_rest_until) {
            delete (a as any).dm_rest_until;
            a.dm_on = true;
            (a as any).peer_flood_consecutive = 0;
            log(phone, 'OK', `🟢 10-Minute Rest Mode completed (Cycle ${(a as any).peer_flood_rest_cycles || 1}/2). DM automatically re-enabled!`);
            saveAccountsJson();
            broadcastAccountUpdate(owner);
          }
        }
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }

      // Check if live stream is running if live_on is true
      if (a.live_on) {
        const currentVerifiedQ = getAccountVerifiedQueue(phone);
        if (currentVerifiedQ.length > 0) {
          const nextUid = currentVerifiedQ[0];
          const nextPInfo = getOwnerPeers(owner).get(String(nextUid));
          // If the next target is already contact-locked, do NOT check or purge stream! Send the DM!
          if (!nextPInfo?.isContactLocked && !nextPInfo?.contactSaved) {
            const streamAlive = await checkIsStreamStillAlive(owner, client, phone);
            if (!streamAlive) {
              const stalePurged = purgeAccountVerifiedQueueOnStreamEnd(phone, 'No active live stream');
              if (stalePurged > 0) {
                await new Promise((r) => setTimeout(r, 2000));
                continue;
              }
            }
          }
        }
      }

      const uid = claimNextFromAccountVerifiedQueue(phone);

      if (uid === null) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      const verifiedQ = getAccountVerifiedQueue(phone);

      if (getOwnerSentUsers(owner).has(uid) || getOwnerSkippedUsers(owner).has(uid) || a.sent_users.has(uid)) {
        removeFromAccountVerifiedQueue(phone, uid);
        continue;
      }

      // 1. Check & Forcefully Resolve peer BEFORE taking any wait delay
      const ownerPeers = getOwnerPeers(owner);
      const pInfo = ownerPeers.get(String(uid));

      // Check reject_usernames setting: Skip accounts with @username ONLY if user explicitly enabled this option
      if (globalAiConfig.reject_usernames === true && pInfo?.username && String(pInfo.username).trim().length > 0) {
        log(phone, 'SKIP', `🚫 [STRICT RULE] Skipped @${String(pInfo.username).replace(/^@/, '')} (${uid}): Has @username (reject_usernames active).`);
        markOwnerSkippedUser(owner, uid, 'Has @username (Filtered by reject_usernames option)', {
          name: pInfo.firstName,
          username: pInfo.username,
          phone: pInfo.phone,
          category: 'has_username',
          skippedByPhone: phone
        });
        removeFromAccountVerifiedQueue(phone, uid);
        removeFromOwnerVerifiedQueue(owner, uid);
        releaseOwnerVerifiedReservation(owner, uid);
        broadcastAccountUpdate(owner);
        continue;
      }

      let targetPeer = await resolveTargetPeer(client, uid, pInfo, phone);
      if (!targetPeer) {
        // Attempt Expired Hash Auto-Recovery before giving up!
        targetPeer = await recoverOrHealPeer(client, phone, owner, uid, pInfo);
      }

      // If user entity cannot be resolved at all, advance queue cleanly with instant log
      if (!targetPeer) {
        log(phone, 'SKIP', `⚠️ [UNRESOLVABLE PEER] Skipped ${pInfo?.firstName || uid}: Cannot resolve user entity without active stream or valid access hash.`);
        markOwnerSkippedUser(owner, uid, 'Unresolvable peer (Access hash expired or stream ended)', {
          name: pInfo?.firstName,
          username: pInfo?.username,
          phone: pInfo?.phone,
          category: 'no_peer',
          skippedByPhone: phone
        });
        removeFromAccountVerifiedQueue(phone, uid);
        removeFromOwnerVerifiedQueue(owner, uid);
        releaseOwnerVerifiedReservation(owner, uid);
        broadcastAccountUpdate(owner);
        continue;
      }

      // PRE-DM SAFETY CHECK: Check cached profile in memory (0 network API calls to avoid spam score)
      if (globalAiConfig.reject_usernames === true && pInfo?.username && String(pInfo.username).trim().length > 0) {
        log(phone, 'SKIP', `🚫 [STRICT RULE] Skipped @${String(pInfo.username).replace(/^@/, '')} (${uid}): Has @username.`);
        markOwnerSkippedUser(owner, uid, 'Has @username (Filtered by reject_usernames option)', {
          name: pInfo.firstName,
          username: pInfo.username,
          phone: pInfo.phone,
          category: 'has_username',
          skippedByPhone: phone
        });
        removeFromAccountVerifiedQueue(phone, uid);
        removeFromOwnerVerifiedQueue(owner, uid);
        releaseOwnerVerifiedReservation(owner, uid);
        broadcastAccountUpdate(owner);
        continue;
      }

      if (pInfo?.isPremium) {
        log(phone, 'SKIP', `⭐ [PREMIUM GATE] Skipped ${pInfo?.firstName || uid}: Telegram Premium account.`);
        markOwnerSkippedUser(owner, uid, 'Telegram Premium Account', {
          name: pInfo?.firstName,
          username: pInfo?.username,
          phone: pInfo?.phone,
          category: 'premium',
          skippedByPhone: phone
        });
        removeFromAccountVerifiedQueue(phone, uid);
        continue;
      }

      if (pInfo?.isBot) {
        log(phone, 'SKIP', `🤖 [BOT GATE] Skipped ${pInfo?.firstName || uid}: Telegram Bot.`);
        markOwnerSkippedUser(owner, uid, 'Telegram Bot Account', {
          name: pInfo?.firstName,
          username: pInfo?.username,
          category: 'bot',
          skippedByPhone: phone
        });
        removeFromAccountVerifiedQueue(phone, uid);
        continue;
      }

      if (pInfo?.isDeleted) {
        log(phone, 'SKIP', `🗑️ [DELETED GATE] Skipped ${uid}: Deleted / Scam Account.`);
        markOwnerSkippedUser(owner, uid, 'Deleted / Scam Account', {
          name: pInfo?.firstName,
          category: 'deleted',
          skippedByPhone: phone
        });
        removeFromAccountVerifiedQueue(phone, uid);
        continue;
      }

      // PRE-DM BLACKLIST SAFETY CHECK: Final drop for Trader, Agent, or custom reject keywords before DM
      if (globalAiConfig.reject_scam_keywords !== false) {
        const spamCheck = isTelegramUserSpamOrPromo(null, pInfo);
        if (spamCheck.isSpam) {
          log(phone, 'SKIP', `🚫 [BLACKLIST FILTER] Skipped ${pInfo?.firstName || uid}: ${spamCheck.reason}`);
          markOwnerSkippedUser(owner, uid, spamCheck.reason, {
            name: pInfo?.firstName,
            username: pInfo?.username,
            phone: pInfo?.phone,
            category: 'spam_bio',
            skippedByPhone: phone
          });
          removeFromAccountVerifiedQueue(phone, uid);
          removeFromOwnerVerifiedQueue(owner, uid);
          releaseOwnerVerifiedReservation(owner, uid);
          broadcastAccountUpdate(owner);
          continue;
        }
      }

      // Physical DM Mobile Emulation: Permanent Telegram Cloud Contact Save FIRST
      let verifiedTargetPeer: any = targetPeer;
      try {
        const lockRes = await lockContactPermanently(client, phone, uid, pInfo).catch(() => null);
        if (lockRes?.inputPeer) {
          verifiedTargetPeer = lockRes.inputPeer;
        }
      } catch {}

      // PRE-DELAY INSTANT PEER VERIFICATION & PRIVACY CHECK (0-Second Abort)
      let profileRestrictedReason: string | null = null;
      let peerSettingsRes: any = null;

      try {
        const settingsPromise = client.invoke(new Api.messages.GetPeerSettings({ peer: verifiedTargetPeer || targetPeer }));
        peerSettingsRes = await Promise.race([
          settingsPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('SETTINGS_TIMEOUT')), 3500))
        ]);
      } catch (sErr: any) {
        const sMsg = String(sErr?.message || sErr);
        if (sMsg.includes('PEER_ID_INVALID') || sMsg.includes('USER_ID_INVALID')) {
          // Stale / unlinked access hash: Attempt auto-recovery
          const healed = await recoverOrHealPeer(client, phone, owner, uid, pInfo);
          if (healed) {
            verifiedTargetPeer = healed;
          } else {
            profileRestrictedReason = 'Telegram access hash invalid or expired';
          }
        } else if (sMsg.includes('SETTINGS_TIMEOUT')) {
          if (!pInfo?.isContactLocked) {
            profileRestrictedReason = 'Profile loading hang / spinning timeout (Telegram restricted)';
          }
        } else if (sMsg.includes('PRIVACY') || sMsg.includes('RESTRICTED')) {
          if (!pInfo?.isContactLocked) {
            profileRestrictedReason = 'Privacy settings block non-contact messaging';
          }
        }
      }

      if (!profileRestrictedReason && peerSettingsRes?.settings) {
        const st = peerSettingsRes.settings;
        if (st.blockContact) {
          profileRestrictedReason = 'User has blocked this contact';
        } else if (st.needContactsException && !pInfo?.isContactLocked) {
          profileRestrictedReason = 'Only Contact Privacy Blocked (User requires mutual contact exception for DMs)';
        }
      }

      // If restricted in ANY way, DROP IMMEDIATELY BEFORE TAKING DELAY (0s Wasted!)
      if (profileRestrictedReason) {
        log(phone, 'SKIP', `⚡ [PRE-DELAY RESTRICTION ABORT] Skipped ${pInfo?.firstName || uid}: ${profileRestrictedReason} (0s delay wasted).`);
        markOwnerSkippedUser(owner, uid, profileRestrictedReason, {
          name: pInfo?.firstName,
          category: 'privacy_restricted',
          skippedByPhone: phone
        });
        removeFromAccountVerifiedQueue(phone, uid);
        removeFromOwnerVerifiedQueue(owner, uid);
        releaseOwnerVerifiedReservation(owner, uid);
        wakeScanner(phone); // Instantly wake scanner to target next live stream listener
        broadcastAccountUpdate(owner);
        continue; // BREAK IMMEDIATELY! NO 60-90s DELAY WAITED!
      }

      // Physical DM Mobile Emulation: Permanent Telegram Cloud Contact Save
      await lockContactPermanently(client, phone, uid, pInfo).catch(() => null);

      // Pre-warm chat history (Simulate physical mobile app opening chat box)
      try {
        await client.invoke(new Api.messages.GetHistory({ peer: verifiedTargetPeer || targetPeer, limit: 1 })).catch(() => null);
      } catch {}

      // Smart Delay Calculation:
      // 1. Pehla target user milte hi turant 2 second me DM shoot hoga.
      // 2. Uske baad agar last DM se ab tak scanning me 1.5 - 2 min (ya configured delay) beet chuka hai,
      //    to target milte hi usko bhi turant 2 second me DM jayega.
      // 3. Agar next target jaldi mila hai to Telegram safe gap ke liye bacha hua interval wait hoga.
      const effCfg = getEffectiveConfig(a);
      const dmin = Math.max(1, effCfg.delay_min !== undefined ? effCfg.delay_min : 90);
      const dmax = Math.max(dmin, effCfg.delay_max !== undefined ? effCfg.delay_max : 120);
      const targetGapSec = Math.floor(Math.random() * (dmax - dmin + 1)) + dmin;

      const lastDmTime = accountLastDmTimestamp.get(phone) || 0;
      const now = Date.now();
      const elapsedSinceLastDmSec = lastDmTime > 0 ? Math.floor((now - lastDmTime) / 1000) : 999999;

      let delay = 2; // Default 2 second
      if (lastDmTime === 0 || elapsedSinceLastDmSec >= targetGapSec) {
        delay = 2;
        log(
          phone,
          'WAIT',
          `⚡ [TURANT 2s DM SHOOT] ${lastDmTime === 0 ? 'Pehla stream target user' : `Pichle DM se ab tak ${elapsedSinceLastDmSec}s ho chuke hain (Target gap: ${targetGapSec}s)`} -> ${pInfo?.firstName || uid} ko turant 2 second me DM shoot hoga!`
        );
      } else {
        const remaining = targetGapSec - elapsedSinceLastDmSec;
        delay = Math.max(2, remaining);
        log(
          phone,
          'WAIT',
          `⏳ [SAFE GAP DELAY] Last DM was ${elapsedSinceLastDmSec}s ago. Waiting remaining ${delay}s (target gap: ${targetGapSec}s) before sending DM to ${pInfo?.firstName || uid}...`
        );
      }

      // Interruptible wait without 3-second stream exit abort
      // (User Telegram Cloud Contact me permanently lock ho chuka hai, to DM 100% deliver hoga chahe user stream chhod kar nikal jaye)
      let interrupted = false;
      for (let i = 0; i < delay; i++) {
        if (signal.aborted || !a.running) {
          interrupted = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (interrupted) {
        if (signal.aborted || !a.running) {
          log(phone, 'WARN', 'Force stop! Bot stopping immediately.');
          releaseOwnerVerifiedReservation(owner, uid);
          break;
        }
        continue;
      }

      // Optional Channel Lock Check (Cached entity, only if channel_lock_early is enabled)
      const effChannelLink = getEffectiveConfig(a).channel_link;
      if (effChannelLink && globalAiConfig.channel_lock_early !== false) {
        let shouldSkip = false;
        try {
          // Check cached channel entity in client session
          const chEntity = await client.getInputEntity(effChannelLink).catch(() => null);
          if (chEntity) {
            let partInputPeer: any = null;
            try {
              partInputPeer = utils.getInputPeer(targetPeer);
            } catch {
              try {
                partInputPeer = await client.getInputEntity(targetPeer).catch(() => null);
              } catch {}
            }
            if (partInputPeer) {
              const participant = await client.invoke(
                new Api.channels.GetParticipant({
                  channel: chEntity,
                  participant: partInputPeer
                })
              ).catch(() => null);
              if (participant) shouldSkip = true;
            }
          }
        } catch {}

        if (shouldSkip) {
          log(phone, 'SKIP', `User ${uid} is already in the channel (Channel Lock).`);
          markOwnerSkippedUser(owner, uid, 'Already in target channel (Channel Lock)', {
            category: 'other',
            skippedByPhone: phone
          });
          removeFromOwnerVerifiedQueue(owner, uid);
          continue;
        }
      }

      // Message templates (current update preserved)
      const availableMessages: string[] = [
        getEffectiveConfig(a).message_1,
        getEffectiveConfig(a).message_2,
        getEffectiveConfig(a).message_3,
        getEffectiveConfig(a).message || ''
      ].filter((m): m is string => Boolean(m && m.trim().length > 0));

      const aiContext = getEffectiveConfig(a).ai_context;
      const uObj = getUser(owner);
      const aiEnabled = uObj?.ai_enabled === true;
      const useDynamic = aiEnabled || getEffectiveConfig(a).use_dynamic_templates === true || availableMessages.length === 0;

      let msgText = '';
      let wasAiDm = false;

      // Check whether AI DM is configured with a valid key for the selected provider
      const selectedDmProv = globalAiConfig.dm_provider || 'groq';
      const hasDmKey = Boolean(
        globalAiConfig.dm_api_key?.trim() ||
        globalAiConfig.filter_api_key?.trim() ||
        (selectedDmProv === 'groq' && process.env.GROQ_API_KEY) ||
        (selectedDmProv === 'deepseek' && (process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY)) ||
        (selectedDmProv === 'gemini' && (process.env.GEMINI_API_KEY || globalAiConfig.filter_api_key?.trim())) ||
        (selectedDmProv === 'openai' && process.env.OPENAI_API_KEY)
      );

      if (aiEnabled && aiContext && aiContext.trim().length > 0 && hasDmKey) {
        try {
          const userNameStr = pInfo?.firstName || "user";
          const sysInstruction = globalAiConfig.dm_system_prompt || "You are a casual human user reaching out on Telegram.";
          const prompt = `Context/Goal: ${aiContext.trim()}
My target channel link (if needed): ${getEffectiveConfig(a).channel_link || "N/A"}
Recipient's first name: ${userNameStr}

Task: Write a very short, natural-sounding direct message (DM) in Hinglish (or English if the context implies it). 
Do NOT sound like a bot. Sound like a real human. Keep it under 2-3 sentences.
Make sure to include the channel link if the context is about promoting a channel.
Output ONLY the message text, nothing else. No quotation marks.`;

          msgText = await callAiEngine({
            task: "dm",
            prompt,
            systemInstruction: sysInstruction,
            temperature: 0.65
          });
          if (msgText) wasAiDm = true;
        } catch (e: any) {
          log(phone, 'INFO', `ℹ️ [AI DM] LLM call skipped, using 37.5L Dynamic Hinglish Engine.`);
        }
      }

      // Resolve effective channel link (growth bot campaign link or tracked per-user join link or master link)
      let effectiveTargetLink = (getEffectiveConfig(a).channel_link || '').trim();
      try {
        const ownerCampaigns = getCampaignsByOwner(owner);
        const activeCamp = ownerCampaigns.find(c => c.billing_status !== 'suspended' && c.billing_status !== 'unpaid' && c.status === 'active');
        if (activeCamp) {
          const config = getGrowthBotConfig();
          const targetBotUser = activeCamp.bot_username || (config && config.bot_username && config.enabled ? config.bot_username : '');
          if (targetBotUser) {
            effectiveTargetLink = `https://t.me/${targetBotUser}?start=${activeCamp.campaign_slug}`;
          }
        }
      } catch (e) {}

      if (!effectiveTargetLink) {
        try {
          const trackedL = await getOrCreateUserTrackedInviteLink(owner, a);
          if (trackedL) effectiveTargetLink = trackedL;
        } catch {}
      }

      // Fast, zero-cost 37.5L Dynamic Hinglish Engine (Greetings + Intros + Services + CTAs)
      if (!msgText && (useDynamic || availableMessages.length === 0)) {
        const dynResult = buildDynamicHinglishMessage(pInfo?.firstName, effectiveTargetLink);
        if (dynResult && dynResult.text) {
          msgText = dynResult.text;
          wasAiDm = true;
          log(
            phone,
            'OK',
            `⚡ [DYNAMIC DM: ${dynResult.code}] Generated natural 4-line Hinglish message for ${pInfo?.firstName || uid}${availableMessages.length === 0 ? ' (Dynamic DM active: 3 DM boxes empty)' : ''}`
          );
        }
      }

      if (!msgText) {
        if (availableMessages.length > 0) {
          const randomMsgTemplate: string =
            availableMessages[Math.floor(Math.random() * availableMessages.length)] || 'Join my channel: {CHANNEL_LINK}';
          msgText = randomMsgTemplate.replace(/\{CHANNEL_LINK\}/g, effectiveTargetLink || "");
          const originalL = (getEffectiveConfig(a).channel_link || '').trim();
          if (originalL && originalL !== effectiveTargetLink) {
            msgText = msgText.split(originalL).join(effectiveTargetLink);
          }
        } else {
          const dynResult = buildDynamicHinglishMessage(pInfo?.firstName, effectiveTargetLink);
          msgText = dynResult?.text || `Hey ${pInfo?.firstName || 'bhai'}! Check out my channel: ${effectiveTargetLink || ''}`;
          wasAiDm = true;
        }
      }

      // Direct, safe DM dispatch with natural typing indicator
      try {
        if (signal.aborted || !a.running) {
          releaseOwnerVerifiedReservation(owner, uid);
          break;
        }

        // Clean human preparation pause before send (fast 200ms if delay <= 2s, else 1.5-2.5s)
        const prepDelay = delay <= 2 ? 200 : (Math.floor(Math.random() * 1000) + 1500);
        await new Promise((r) => setTimeout(r, prepDelay));

        if (signal.aborted || !a.running) {
          releaseOwnerVerifiedReservation(owner, uid);
          break;
        }

        // 🔒 FINAL FAST BOT FILTER CHECK: Guarantee user hasn't joined while waiting in queue
        const chFinalCheck = await isUserAlreadyInChannel(owner, uid, phone, client);
        if (chFinalCheck.inChannel) {
          log(phone, 'SKIP', `🔒 [FAST BOT FILTER] Skipped DM to ${uid}: Already joined ${chFinalCheck.channelName || 'target channel'}!`);
          markOwnerSkippedUser(owner, uid, `Already joined ${chFinalCheck.channelName || 'target channel'} (Fast Bot Filter)`, {
            name: pInfo?.firstName,
            category: 'other',
            skippedByPhone: phone
          });
          a.sent_users.add(uid);
          saveSentUser(phone, uid);
          releaseOwnerVerifiedReservation(owner, uid);
          continue;
        }

        const sendResult = await withTimeout(
          client.sendMessage(verifiedTargetPeer || targetPeer, { message: msgText }),
          20000,
          'MTPROTO_SEND_TIMEOUT'
        );
        recordApiCall(phone, "dm");
        if (sendResult) {
          accountLastDmTimestamp.set(phone, Date.now());
          (a as any).peer_flood_consecutive = 0;
          delete (a as any).dm_rest_until;
          a.sent_users.add(uid);
          saveSentUser(phone, uid);
          a.sent_count = (a.sent_count || 0) + 1;
          checkAndResetDailyDmQuota(phone);
          (a as any).daily_sent_count = ((a as any).daily_sent_count || 0) + 1;
          (a as any).peer_flood_consecutive = 0; // Reset consecutive flood counter on clean message
          saveAccountsLocal();
          markOwnerSentUser(owner, uid, phone);
          recordDailyDm(owner, phone);
          if (wasAiDm) recordAiDm(owner);
          const userTag = pInfo?.username ? ` @${pInfo.username}` : "";
          const namePart = pInfo?.firstName ? `${pInfo.firstName}${userTag} (${uid})` : (userTag ? `${userTag} (${uid})` : String(uid));
          
          removeFromAccountVerifiedQueue(phone, uid);
          broadcastAccountUpdate(owner);

          log(phone, "SENT", `🚀 [INSTANT DM DELIVERED] Live message delivered to ${namePart}! Daily: ${(a as any).daily_sent_count} | Total: ${a.sent_count}. Scanner ready to hook next live listener...`);

          // 🧹 Instant RAM Pruning: Drop bulky peer entity from memory cache after delivery
          try {
            const ent = (client as any)._entityCache;
            if (ent && ent.cacheMap instanceof Map) {
              ent.cacheMap.delete(uid);
              if (ent.cacheMap.size > 25) {
                const it = ent.cacheMap.keys();
                for (let i = 0; i < 15; i++) {
                  const k = it.next().value;
                  if (k !== undefined) ent.cacheMap.delete(k);
                  else break;
                }
              }
            }
          } catch {}

          // Gentle human buffer pause between live stream checks (4 to 8s)
          const bufferDelay = Math.floor(Math.random() * 4000) + 4000;
          await new Promise((r) => setTimeout(r, bufferDelay));
        }
      } catch (err: any) {
        const errMsg = String(err?.message || err);
        const isFloodWait = errMsg.includes("FLOOD_WAIT") || errMsg.includes("FloodWaitError") || err?.seconds;
        const isPeerFlood = errMsg.includes("PEER_FLOOD") || errMsg.includes("PeerFloodError");
        const isPeerIdInvalid = errMsg.includes("PEER_ID_INVALID");
        const isTimeout = errMsg.includes("MTPROTO_SEND_TIMEOUT") || errMsg.includes("Operation timed out") || errMsg.includes("TIMEOUT") || errMsg.includes("timed out") || errMsg.includes("ETIMEDOUT");
        const isPrivacyOrBlocked =
          errMsg.includes("PRIVACY") ||
          errMsg.includes("UserPrivacyRestrictedError") ||
          errMsg.includes("USER_IS_BLOCKED") ||
          errMsg.includes("UserIsBlockedError") ||
          errMsg.includes("YOU_BLOCKED_USER") ||
          errMsg.includes("USER_DEACTIVATED") ||
          errMsg.includes("InputUserDeactivatedError") ||
          errMsg.includes("INPUT_USER_DEACTIVATED");

        if (isTimeout) {
          const userTag = pInfo?.username ? ` @${pInfo.username}` : "";
          const namePart = pInfo?.firstName ? `${pInfo.firstName}${userTag} (${uid})` : (userTag ? `${userTag} (${uid})` : String(uid));
          log(phone, "WARN", `⏱️ [SOCKET TIMEOUT RECOVERY] Message delivery to ${namePart} timed out (>20s). Advancing queue to avoid bot freeze!`);
          releaseOwnerVerifiedReservation(owner, uid);
          removeFromAccountVerifiedQueue(phone, uid);
          try {
            if (client && !client.connected) {
              client.connect().catch(() => {});
            }
          } catch {}
          continue;
        }

        if (isFloodWait) {
          // Precise extraction of Telegram wait seconds (DO NOT match HTTP status 420!)
          const floodMatch = errMsg.match(/FLOOD_WAIT_(\d+)/i) || errMsg.match(/wait of (\d+)/i) || errMsg.match(/(\d+)\s*seconds/i);
          const seconds = err?.seconds ? Number(err.seconds) : (floodMatch ? parseInt(floodMatch[1], 10) : 30);
          const safeSeconds = Math.min(Math.max(seconds, 5), 3600);
          const cool = safeSeconds + 5;
          log(phone, "WARN", `⏳ Telegram rate limit (FLOOD_WAIT: ${safeSeconds}s). Pausing DM worker for ${cool}s... (User remains in queue)`);
          releaseOwnerVerifiedReservation(owner, uid);
          await new Promise((r) => setTimeout(r, cool * 1000));
          continue;
        } else if (isPeerFlood) {
          (a as any).peer_flood_consecutive = ((a as any).peer_flood_consecutive || 0) + 1;
          const attempt = (a as any).peer_flood_consecutive;
          releaseOwnerVerifiedReservation(owner, uid);

          if (attempt >= 5) {
            // 5 consecutive PEER_FLOOD attempts reached without resolving -> Check rest cycle count
            (a as any).peer_flood_rest_cycles = ((a as any).peer_flood_rest_cycles || 0) + 1;
            const cycle = (a as any).peer_flood_rest_cycles;
            (a as any).peer_flood_consecutive = 0;
            a.dm_on = false;

            if (cycle < 2) {
              // Cycle 1: 10 minutes Rest Mode
              const restSeconds = 600; // 10 minutes
              (a as any).dm_rest_until = Date.now() + restSeconds * 1000;
              saveAccountsJson();
              broadcastAccountUpdate(owner);

              log(
                phone,
                "WARN",
                `🛑 [10-MIN REST MODE ACTIVATED] 5 consecutive @SpamBot runs failed to clear PEER_FLOOD (Cycle ${cycle}/2). DM OFF & entering Rest Mode for 10 minutes (600s). Live Stream Monitoring remains ACTIVE.`
              );
              await new Promise((r) => setTimeout(r, 5000));
              continue;
            } else {
              // Cycle 2 failed: Limit exhausted until midnight/daily quota reset
              (a as any).dm_peer_flood_exhausted = true;
              delete (a as any).dm_rest_until;
              saveAccountsJson();
              broadcastAccountUpdate(owner);

              log(
                phone,
                "WARN",
                `⛔ [DM REST MODE - LIMIT EXHAUSTED] PEER_FLOOD persisted after 2 consecutive 10-minute rest cycles (10 @SpamBot runs). DM option placed in Rest Mode until daily limit reset at midnight. Live Stream Monitoring remains ACTIVE.`
              );
              await new Promise((r) => setTimeout(r, 5000));
              continue;
            }
          }

          log(
            phone,
            "WARN",
            `⚠️ [PEER_FLOOD ${attempt}/5] Telegram rate limit encountered. Running @SpamBot verification cycle (${attempt}/5)...`
          );

          let isCleared = false;
          try {
            isCleared = await checkAndResolveSpamBot(client, phone, true);
          } catch {}

          if (isCleared) {
            log(phone, "OK", `🎉 @SpamBot reported clean status on attempt ${attempt}/5! Retrying DM in 5s...`);
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          } else {
            log(phone, "WARN", `⚠️ @SpamBot restriction reported (attempt ${attempt}/5). Retrying next cycle in 6s...`);
            await new Promise((r) => setTimeout(r, 6000));
            continue;
          }
        } else if (isPeerIdInvalid) {
          const displayName = pInfo?.firstName ? `${pInfo.firstName} (${uid})` : (pInfo?.username ? `@${pInfo.username} (${uid})` : String(uid));
          let reResolvedPeer: any = null;

          // Auto-Recovery: If user has a username, re-resolve via username
          if (pInfo?.username) {
            const cleanUser = pInfo.username.trim().replace(/^@/, "");
            try {
              const freshEnt = await client.getInputEntity(`@${cleanUser}`).catch(() => null);
              if (freshEnt) {
                reResolvedPeer = utils.getInputPeer(freshEnt);
                if (reResolvedPeer && (reResolvedPeer as any).accessHash && pInfo) {
                  pInfo.accessHash = String((reResolvedPeer as any).accessHash);
                }
              }
            } catch {}
          }

          if (reResolvedPeer) {
            try {
              const retryResult = await client.sendMessage(reResolvedPeer, { message: msgText });
              if (retryResult) {
                (a as any).peer_flood_consecutive = 0;
                delete (a as any).dm_rest_until;
                a.sent_users.add(uid);
                saveSentUser(phone, uid);
                a.sent_count = (a.sent_count || 0) + 1;
                checkAndResetDailyDmQuota(phone);
                (a as any).daily_sent_count = ((a as any).daily_sent_count || 0) + 1;
                markOwnerSentUser(owner, uid, phone);
                recordDailyDm(owner, phone);
                if (wasAiDm) recordAiDm(owner);
                const userTag = pInfo?.username ? ` @${pInfo.username}` : "";
                const namePart = pInfo?.firstName ? `${pInfo.firstName}${userTag} (${uid})` : (userTag ? `${userTag} (${uid})` : String(uid));
                log(phone, "SENT", `🚀 [DM DELIVERED] Successfully sent DM to ${namePart} ➔ Daily: ${(a as any).daily_sent_count} | Total: ${a.sent_count}`);
                removeFromOwnerVerifiedQueue(owner, uid);
                broadcastAccountUpdate(owner);
                continue;
              }
            } catch {}
          }

          // Universal peer fallback across accounts of this owner & Contact Auto-Recovery
          let recoveredPeer: any = null;
          try {
            recoveredPeer = await recoverOrHealPeer(client, phone, owner, uid, pInfo).catch(() => null);
            if (!recoveredPeer) {
              recoveredPeer = await resolveTargetPeer(client, uid, pInfo, phone).catch(() => null);
            }
            if (recoveredPeer) {
              const resend = await client.sendMessage(recoveredPeer, { message: msgText }).catch(() => null);
              if (resend) {
                accountLastDmTimestamp.set(phone, Date.now());
                (a as any).peer_flood_consecutive = 0;
                delete (a as any).dm_rest_until;
                a.sent_users.add(uid);
                saveSentUser(phone, uid);
                a.sent_count = (a.sent_count || 0) + 1;
                checkAndResetDailyDmQuota(phone);
                (a as any).daily_sent_count = ((a as any).daily_sent_count || 0) + 1;
                markOwnerSentUser(owner, uid, phone);
                recordDailyDm(owner, phone);
                if (wasAiDm) recordAiDm(owner);
                const userTag = pInfo?.username ? ` @${pInfo.username}` : "";
                const namePart = pInfo?.firstName ? `${pInfo.firstName}${userTag} (${uid})` : (userTag ? `${userTag} (${uid})` : String(uid));
                log(phone, "SENT", `🚀 [DM DELIVERED VIA RECOVERY] Successfully sent DM to ${namePart} ➔ Daily: ${(a as any).daily_sent_count} | Total: ${a.sent_count}`);
                removeFromOwnerVerifiedQueue(owner, uid);
                broadcastAccountUpdate(owner);
                continue;
              }
            }
          } catch {}

          // User cannot be messaged (access hash expired or invalid for this account)
          log(phone, "SKIP", `🔒 Skipped ${displayName}: User privacy restricted (Only Contacts) or access hash expired.`);
          markOwnerSkippedUser(owner, uid, 'User privacy restricted (Only Contacts) or access hash expired', {
            category: 'privacy_restricted',
            skippedByPhone: phone
          });
          removeFromAccountVerifiedQueue(phone, uid);

          if (a.live_on) {
            const streamAlive = await checkIsStreamStillAlive(owner, client, phone);
            if (!streamAlive) {
              purgeAccountVerifiedQueueOnStreamEnd(phone, 'Telegram access hash expired due to concluded stream');
            }
          }
          broadcastAccountUpdate(owner);
        } else if (isPrivacyOrBlocked) {
          const displayName = pInfo?.firstName ? `${pInfo.firstName} (${uid})` : (pInfo?.username ? `@${pInfo.username} (${uid})` : String(uid));
          const shortErr = errMsg.split("\n")[0].replace(/Error: /g, "").slice(0, 35);
          log(phone, "SKIP", `🔒 Skipped ${displayName}: ${shortErr}.`);
          markOwnerSkippedUser(owner, uid, `Privacy/Blocked: ${shortErr}`, {
            category: 'privacy',
            skippedByPhone: phone
          });
          removeFromAccountVerifiedQueue(phone, uid);
          broadcastAccountUpdate(owner);
        } else {
          log(phone, "FAIL", `DM error: ${errMsg.slice(0, 60)}`);
          await new Promise((r) => setTimeout(r, 5000));
          markOwnerSkippedUser(owner, uid, `DM error: ${errMsg.slice(0, 40)}`, {
            category: 'other',
            skippedByPhone: phone
          });
          removeFromAccountVerifiedQueue(phone, uid);
          broadcastAccountUpdate(owner);
        }
      }
    }
  })();

  // Midnight reset
  let lastResetDate = new Date().getDate();

  // Channel & Live Monitor loop
  const checkIntervalSec = Math.max(5, a.config.check_interval || 12);
  log(phone, 'GO', `Live Audio Stream Detection active (fast scan interval: ${checkIntervalSec}s)`);

  while (a.running && !signal.aborted) {
    const now = new Date();
    const today = now.getDate();
    if (today !== lastResetDate) {
      a.daily_collected_count = 0;
      lastResetDate = today;
    }
    if (a.daily_collected_count === undefined) a.daily_collected_count = 0;

    const owner = a.owner || 'admin';

    if (a.live_on) {
      try {
        const currentVerifiedQ = getAccountVerifiedQueue(phone);
        if (currentVerifiedQ.length > 0) {
          // 🔒 SCANNER STREAM LOCK:
          // When users are in Genuine Queue, stay locked to this stream until current batch finishes.
          // Zero getDialogs() calls made during stream lock!
          const streamAlive = await checkIsStreamStillAlive(owner, client, phone);
          if (!streamAlive) {
            const purged = purgeAccountVerifiedQueueOnStreamEnd(phone, 'Live stream concluded by host');
            if (purged > 0) {
              log(phone, 'WARN', `🛑 Live stream ended by host! Purged ${purged} expired leads from Genuine Queue.`);
              broadcastAccountUpdate(owner);
            }
            const lockedAct = activeGroupCalls.get(phone);
            if (lockedAct?.entity?.id) releaseLiveStreamLeader(String(lockedAct.entity.id), phone);
            continue;
          }

          // Refresh leader heartbeat
          const lockedAct = activeGroupCalls.get(phone);
          if (lockedAct?.entity?.id) {
            registerLiveStreamLeader(String(lockedAct.entity.id), phone, owner, lockedAct.title);
          }

          // Continuous Cache Sync: Stream lock ke dauran scanner har 3.5 second me call participants list refresh karta rehta hai
          await syncStreamParticipantsCache(phone, owner, client);
          await sleepWithWakeup(phone, 3500);
          continue;
        }

        // 🧠 MEMORY-CACHED NON-TARGET RESOLUTION (0 Telegram API Calls on repeat scans)
        const effCfg = getEffectiveConfig(a);
        const ignoredData = await getOrResolveOwnerIgnoredChannels(owner, client, effCfg);
        const ignoredIds = ignoredData.ids;
        const ignoredUsernames = ignoredData.usernames;
        const ignoredTitles = ignoredData.titles;

        const candidates: Array<{ id: string; title: string; entity: any; inputEntity: any }> = [];
        const seenIds = new Set<string>();

        // Auto-detect joined channels & groups from dialogs (Lightweight scan: 35 active channels instead of 120)
        try {
          const dialogs = await client.getDialogs({ limit: 35 }).catch(() => []);
          for (const d of dialogs) {
            if (d.isChannel || d.isGroup) {
              const did = String(d.id || '');
              const didBare = did.replace(/^-100/, '').replace(/^-/, '');
              const dUsername = (d.entity as any)?.username ? String((d.entity as any).username).toLowerCase() : '';
              const dTitle = (d.title || '').trim().toLowerCase();

              // 🚫 RIGOROUS RAM NON-TARGET CHECK (Zero Telegram API Call):
              let isNonTarget = false;
              if (ignoredIds.has(did) || ignoredIds.has(didBare) || ignoredIds.has(`-100${didBare}`)) {
                isNonTarget = true;
              } else if (dUsername && ignoredUsernames.has(dUsername)) {
                isNonTarget = true;
              } else if (dTitle && (ignoredTitles.has(dTitle) || Array.from(ignoredTitles).some(t => t.length >= 3 && (dTitle === t || dTitle.includes(t) || t.includes(dTitle))))) {
                isNonTarget = true;
              }

              if (isNonTarget) {
                continue; // 🚫 STRICTLY SKIP THIS NON-TARGET CHANNEL - NEVER SCAN!
              }

              if (!seenIds.has(did)) {
                seenIds.add(did);
                candidates.push({
                  id: did,
                  title: d.title || `Chat ${did}`,
                  entity: d.entity,
                  inputEntity: d.inputEntity
                });
              }
            }
          }
        } catch (dialogErr: any) {
          log(phone, 'WARN', `Dialogs fetch: ${dialogErr?.message || dialogErr}`);
        }

        let liveFoundCount = 0;

        // Prioritize active locked stream in candidates
        const lockedAct = activeGroupCalls.get(phone) || ownerActiveGroupCalls.get(owner);
        if (lockedAct && lockedAct.title) {
          const lockedIdx = candidates.findIndex(
            (c) => c.title === lockedAct.title || String(c.id) === String((lockedAct.entity as any)?.id)
          );
          if (lockedIdx > 0) {
            const [lockedCand] = candidates.splice(lockedIdx, 1);
            candidates.unshift(lockedCand);
          }
        }

        // Check each candidate for active live audio stream
        for (const cand of candidates) {
          if (!a.running || signal.aborted || !a.live_on) break;

          const cid = String(cand.id || '');
          const cidBare = cid.replace(/^-100/, '').replace(/^-/, '');
          const cTitle = (cand.title || '').trim().toLowerCase();
          if (ignoredIds.has(cid) || ignoredIds.has(cidBare) || ignoredIds.has(`-100${cidBare}`) || ignoredTitles.has(cTitle)) {
            continue; // Skip non-target candidate
          }

          // 👑 MULTI-BOT STREAM LEADER CHECK:
          // If another bot belonging to this user is already the designated leader scanning this stream,
          // skip this channel so we don't duplicate calls, and let this bot scan other channels!
          const leaderCheck = isChannelScannedByOtherLeader(cid, phone);
          if (leaderCheck.isOtherLeader) {
            continue;
          }

          try {
            let fullChat: any = null;
            if (cand.entity?.className === 'Chat') {
              // Basic group
              fullChat = await client.invoke(
                new Api.messages.GetFullChat({ chatId: cand.entity.id })
              ).catch(() => null);
            } else {
              // Supergroup / Channel
              fullChat = await client.invoke(
                new Api.channels.GetFullChannel({ channel: cand.inputEntity || cand.entity })
              ).catch(() => null);
            }

            const groupCall = fullChat?.fullChat?.call;
            if (groupCall && groupCall.className !== 'GroupCallDiscarded') {
              // Construct properly typed InputGroupCall with safe string/BigInt conversion
              const callIdStr = (groupCall.id?.toString ? groupCall.id.toString() : String(groupCall.id || '')).replace(/[^0-9-]/g, '');
              const rawHash = groupCall.accessHash !== undefined ? groupCall.accessHash : groupCall.access_hash;
              const callHashStr = (rawHash?.toString ? rawHash.toString() : String(rawHash || '0')).replace(/[^0-9-]/g, '');

              const inputCall = new Api.InputGroupCall({
                id: BigInt(callIdStr || '0') as any,
                accessHash: BigInt(callHashStr || '0') as any
              });

              // Pre-validate that this call is TRULY live: not discarded, not scheduled for the future, and has real listeners (> 0)
              let callInfo: any = null;
              try {
                callInfo = await client.invoke(
                  new Api.phone.GetGroupCall({ call: inputCall, limit: 100 })
                );
              } catch (callErr: any) {
                const callErrMsg = String(callErr?.message || callErr);
                if (callErrMsg.includes('GROUPCALL_INVALID') || callErrMsg.includes('GROUPCALL_JOIN_MISSING')) {
                  activeGroupCalls.delete(phone);
                  releaseLiveStreamLeader(cid, phone);
                }
                continue; // Not an active call, ignore and check next channel
              }

              if (!callInfo || !callInfo.call || callInfo.call.className === 'GroupCallDiscarded') {
                continue;
              }

              // Reject if scheduled in the future (stream not started yet)
              if (callInfo.call.scheduleDate && callInfo.call.scheduleDate > Math.floor(Date.now() / 1000)) {
                continue;
              }

              // Reject if 0 listeners/participants (empty/abandoned room)
              const participantCount = callInfo.call.participantsCount || (callInfo.participants ? callInfo.participants.length : 0);
              if (!participantCount || participantCount <= 0) {
                continue;
              }

              // Genuinely ACTIVE live stream confirmed! Register leader lock!
              liveFoundCount++;
              registerLiveStreamLeader(cid, phone, owner, cand.title);
              log(phone, 'LIVE', `Live audio stream DETECTED in "${cand.title}" (${participantCount} participants)! Extracting listeners...`);
              a.status = `LIVE: ${cand.title}`;
              broadcastAccountUpdate(a.owner);

              activeGroupCalls.set(phone, { call: inputCall, rawCall: groupCall, entity: cand.inputEntity || cand.entity, title: cand.title });
              ownerActiveGroupCalls.set(owner, { phone, call: inputCall, rawCall: groupCall, entity: cand.inputEntity || cand.entity, title: cand.title, lastChecked: Date.now() });

              // 1. Fetch channel admins and creator/owner so we can strictly exclude them
              const channelAdmins = new Set<number>();
              try {
                if (cand.entity?.className !== 'Chat') {
                  const adminRes: any = await client.invoke(
                    new Api.channels.GetParticipants({
                      channel: cand.inputEntity || cand.entity,
                      filter: new Api.ChannelParticipantsAdmins(),
                      offset: 0,
                      limit: 100,
                      hash: BigInt(0) as any
                    })
                  ).catch(() => null);
                  recordApiCall(phone, 'get_participants');
                  if (adminRes && Array.isArray(adminRes.users)) {
                    recordUserPeers(phone, adminRes.users, client);
                    for (const au of adminRes.users) {
                      const auId = Number(au.id);
                      if (auId) channelAdmins.add(auId);
                    }
                  }
                }
              } catch {}

              // 2. Fetch call participants (muted, unmuted, listeners, speakers) and channel members
              const allUsersMap = new Map<number, any>();

              const safeNum = (val: any): number => {
                if (val === undefined || val === null) return 0;
                if (typeof val === 'number') return isNaN(val) ? 0 : val;
                if (typeof val === 'bigint') return Number(val);
                try {
                  const s = String(val.toString ? val.toString() : val).replace(/[^0-9-]/g, '');
                  const n = Number(s);
                  return isNaN(n) ? 0 : n;
                } catch {
                  return 0;
                }
              };

              let listenerSeqCounter = 0;
              const ingestGroupParticipants = (participantsList: any[]) => {
                if (!Array.isArray(participantsList)) return;
                for (const p of participantsList) {
                  let pUserId: number = 0;
                  if (p.peer) {
                    if (p.peer.userId !== undefined) pUserId = safeNum(p.peer.userId);
                    else if (p.peer.user_id !== undefined) pUserId = safeNum(p.peer.user_id);
                    else if (p.peer.id !== undefined && p.peer.className !== 'PeerChannel' && p.peer.className !== 'PeerChat') {
                      pUserId = safeNum(p.peer.id);
                    }
                  }
                  if (!pUserId) {
                    if (p.userId !== undefined) pUserId = safeNum(p.userId);
                    else if (p.user_id !== undefined) pUserId = safeNum(p.user_id);
                    else if (p.id !== undefined) pUserId = safeNum(p.id);
                  }

                  if (pUserId && pUserId !== 0) {
                    const existing = allUsersMap.get(pUserId);
                    const accHash = p.accessHash || p.access_hash || p.peer?.accessHash || p.peer?.access_hash || existing?.accessHash;
                    
                    // 🛡️ STREAM HOST & SPEAKER DETECTION:
                    // In Telegram Group Calls, ONLY host, co-hosts and speakers have canSelfUnmute: true!
                    // Regular listeners are audience and cannot unmute themselves.
                    const canSelfUnmute = Boolean(p.canSelfUnmute || p.can_self_unmute);
                    const isUnmutedSpeaker = (p.muted === false) && (p.volumeByAdmin === false || p.volume_by_admin === false);
                    const isSelf = Boolean(p.self || p.isSelf);
                    const isSpeakerOrHost = canSelfUnmute || isUnmutedSpeaker || isSelf || channelAdmins.has(pUserId);

                    allUsersMap.set(pUserId, {
                      ...(existing || {}),
                      id: pUserId,
                      accessHash: accHash,
                      muted: p.muted,
                      left: p.left,
                      volume: p.volume,
                      about: p.about,
                      isParticipant: true,
                      canSelfUnmute,
                      isSpeakerOrHost,
                      joinIndex: existing?.joinIndex || (++listenerSeqCounter)
                    });
                  }
                }
              };

              if (callInfo) {
                if (Array.isArray(callInfo.users)) {
                  recordUserPeers(phone, callInfo.users, client);
                  for (const u of callInfo.users) {
                    const uId = safeNum(u.id);
                    if (uId) {
                      const existing = allUsersMap.get(uId);
                      allUsersMap.set(uId, { ...(existing || {}), ...u, accessHash: u.accessHash || existing?.accessHash });
                    }
                  }
                }
                if (Array.isArray(callInfo.participants)) {
                  ingestGroupParticipants(callInfo.participants);
                }

                // Paginate to collect all call participants (mute, unmute, listeners)
                let nextOffset = callInfo.participantsNextOffset || '';
                let pageCount = 1;
                while (allUsersMap.size < 2000 && pageCount < 20) {
                  pageCount++;
                  try {
                    const more: any = await client.invoke(
                      new Api.phone.GetGroupParticipants({
                        call: inputCall,
                        ids: [],
                        sources: [],
                        offset: nextOffset,
                        limit: 100
                      })
                    ).catch(() => null);

                    if (!more) break;

                    if (Array.isArray(more.users)) {
                      recordUserPeers(phone, more.users, client);
                      for (const u of more.users) {
                        const uId = safeNum(u.id);
                        if (uId) {
                          const existing = allUsersMap.get(uId);
                          allUsersMap.set(uId, { ...(existing || {}), ...u, accessHash: u.accessHash || existing?.accessHash });
                        }
                      }
                    }

                    if (Array.isArray(more.participants)) {
                      ingestGroupParticipants(more.participants);
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
              }

              // Forcefully resolve any active call participants that lack accessHash or username
              if (inputCall) {
                const missingIds = Array.from(allUsersMap.keys()).filter((uid) => {
                  const uObj = allUsersMap.get(uid);
                  return !uObj?.accessHash && !uObj?.username;
                });
                if (missingIds.length > 0) {
                  for (let i = 0; i < missingIds.length && i < 60; i += 20) {
                    const batch = missingIds.slice(i, i + 20);
                    try {
                      const bRes: any = await client.invoke(
                        new Api.phone.GetGroupParticipants({
                          call: inputCall,
                          ids: batch.map((bid) => new Api.InputPeerUser({ userId: BigInt(bid) as any, accessHash: BigInt(0) as any })),
                          sources: [],
                          offset: '',
                          limit: 20
                        })
                      ).catch(() => null);
                      if (bRes?.users && Array.isArray(bRes.users)) {
                        recordUserPeers(phone, bRes.users, client);
                        for (const ru of bRes.users) {
                          const ruId = safeNum(ru.id);
                          if (ruId) {
                            const existing = allUsersMap.get(ruId);
                            allUsersMap.set(ruId, { ...(existing || {}), ...ru, accessHash: ru.accessHash || existing?.accessHash });
                          }
                        }
                      }
                    } catch {}
                  }
                }
              }

              // Record discovered peers in memory cache
              recordUserPeers(phone, Array.from(allUsersMap.values()), client);

              // 3. Filter out: admin, owner/creator, bot, deleted account, premium, @username, already sent
              const stats = { admin: 0, bot: 0, deleted: 0, already_sent: 0, uncontactable: 0 };
              const eligibleUids: number[] = [];

              for (const [rawUid, u] of allUsersMap.entries()) {
                const uid = safeNum(rawUid);
                if (!uid || uid === myId || u.self || u.isSelf) continue;

                // 1. Exclude Admins & Owner/Creator, Stream Host, and Invited Speakers
                if (channelAdmins.has(uid) || u.isSpeakerOrHost || u.canSelfUnmute) {
                  stats.admin++;
                  markOwnerSkippedUser(owner, uid, 'Stream Host / Speaker / Admin Shield', {
                    name: u.firstName,
                    username: u.username,
                    phone: u.phone,
                    category: 'admin',
                    skippedByPhone: phone
                  });
                  continue;
                }

                // 2. Exclude Bots
                if (isTelegramBotUser(u)) {
                  stats.bot++;
                  markOwnerSkippedUser(owner, uid, 'Telegram Bot Account', {
                    name: u.firstName,
                    username: u.username,
                    phone: u.phone,
                    category: 'bot',
                    skippedByPhone: phone
                  });
                  continue;
                }

                // 3. Exclude Deleted Accounts / scam
                if (isTelegramDeletedUser(u)) {
                  stats.deleted++;
                  markOwnerSkippedUser(owner, uid, 'Deleted / Scam Account', {
                    name: u.firstName,
                    username: u.username,
                    phone: u.phone,
                    category: 'deleted',
                    skippedByPhone: phone
                  });
                  continue;
                }

                // 3b. Exclude Privacy Restricted (Messages limited to Contacts)
                if (isTelegramPrivacyRestricted(u)) {
                  markOwnerSkippedUser(owner, uid, 'User privacy restricted (Only Contacts)', {
                    name: u.firstName,
                    username: u.username,
                    phone: u.phone,
                    category: 'privacy',
                    skippedByPhone: phone
                  });
                  continue;
                }

                // 4. Exclude Non-Indian (Indian phone numbers start with 91 or +91)
                if (u.phone) {
                  const cleanPhone = String(u.phone).replace(/^\+/, '').trim();
                  if (cleanPhone && !cleanPhone.startsWith('91')) {
                    markOwnerSkippedUser(owner, uid, `Non-Indian Phone (${u.phone})`, {
                      name: u.firstName,
                      username: u.username,
                      phone: u.phone,
                      category: 'other',
                      skippedByPhone: phone
                    });
                    continue;
                  }
                }

                // 5. Exclude Already Sent
                if (a.sent_users.has(uid) || getOwnerSentUsers(owner).has(uid)) {
                  stats.already_sent++;
                  continue;
                }

                // 6. Exclude Telegram Premium (comprehensive check)
                if (isTelegramPremiumUser(u)) {
                  markOwnerSkippedUser(owner, uid, 'Telegram Premium Account', {
                    name: u.firstName,
                    username: u.username,
                    phone: u.phone,
                    category: 'premium',
                    skippedByPhone: phone
                  });
                  continue;
                }

                // 7. Check reject_usernames setting: Skip accounts with @username ONLY if enabled by user
                if (globalAiConfig.reject_usernames !== false && u.username && String(u.username).trim().length > 0) {
                  markOwnerSkippedUser(owner, uid, 'Has @username (Filtered by reject_usernames option)', {
                    name: u.firstName,
                    username: u.username,
                    phone: u.phone,
                    category: 'has_username',
                    skippedByPhone: phone
                  });
                  continue;
                }

                // 8. PHYSICAL DM REQUIREMENT: Must have an authentic Telegram accessHash or public @username!
                const candidateHash = u.accessHash || (u.access_hash !== undefined ? u.access_hash : undefined);
                const hasUname = Boolean(u.username && String(u.username).trim().length > 0);
                if (!hasUname && (!candidateHash || String(candidateHash) === '0')) {
                  continue; // Skip participants without username that do not have an authentic accessHash
                }

                eligibleUids.push(uid);
              }

              const rawQ = getOwnerRawQueue(owner);
              const verifiedQ = getAccountVerifiedQueue(phone);
              const rawSet = new Set(rawQ);
              const verifiedSet = new Set(verifiedQ);
              const sentUsersSet = getOwnerSentUsers(owner);
              const skippedUsersSet = getOwnerSkippedUsers(owner);

              const nowTime = Date.now();
              const freshUids = eligibleUids.filter(
                (uid) =>
                  !rawSet.has(uid) &&
                  !verifiedSet.has(uid) &&
                  !sentUsersSet.has(uid) &&
                  !skippedUsersSet.has(uid) &&
                  (!tempLiveStreamCooldown.has(uid) || (tempLiveStreamCooldown.get(uid)! < nowTime))
              );

              // UNLIMITED Genuine Queue capacity (Safety ceiling 5000 per live stream)
              const MAX_STREAM_TARGETS = 5000;
              const currentVQueue = getAccountVerifiedQueue(phone);
              if (currentVQueue.length >= MAX_STREAM_TARGETS) {
                break;
              }
              const neededSlots = MAX_STREAM_TARGETS - currentVQueue.length;

              try {
                // INSTANT TARGET HOOK: High-Speed Micro-Parallel Candidate Verification
                // Priority: 1. Without @username FIRST, 2. Bottom-to-Top (Recent listeners FIRST), 3. Online status
                const prioritizedUids = [...freshUids].sort((a, b) => {
                  const userA = allUsersMap.get(a);
                  const userB = allUsersMap.get(b);
                  const hasUnameA = Boolean(userA?.username && String(userA.username).trim().length > 0) ? 1 : 0;
                  const hasUnameB = Boolean(userB?.username && String(userB.username).trim().length > 0) ? 1 : 0;
                  
                  // 1. NON-@USERNAME FIRST: Crucial because their session hash expires when stream ends!
                  if (hasUnameA !== hasUnameB) {
                    return hasUnameA - hasUnameB; // 0 (without @username) comes FIRST!
                  }

                  // 2. BOTTOM-TO-TOP PRIORITY: Listeners who joined towards the bottom/recent of the room come first!
                  const joinA = userA?.joinIndex || 0;
                  const joinB = userB?.joinIndex || 0;
                  if (joinA !== joinB) {
                    return joinB - joinA; // Higher joinIndex (bottom/newer listeners) comes FIRST!
                  }

                  // 3. Online status tie-breaker
                  const isOnlineA = userA?.status?.className === 'UserStatusOnline' ? 2 : (userA?.status?.className === 'UserStatusRecently' ? 1 : 0);
                  const isOnlineB = userB?.status?.className === 'UserStatusOnline' ? 2 : (userB?.status?.className === 'UserStatusRecently' ? 1 : 0);
                  return isOnlineB - isOnlineA;
                });

                const candidateBatch = prioritizedUids.slice(0, Math.min(prioritizedUids.length, neededSlots * 3));
                const newlyQueued: any[] = [];

                for (const candUid of candidateBatch) {
                  if (newlyQueued.length >= neededSlots) break;

                  const u = allUsersMap.get(candUid);
                  if (!u) continue;
                  const uId = safeNum(u.id);
                  if (!uId) continue;

                  const spamCheck = isTelegramUserSpamOrPromo(null, u);
                  if (spamCheck.isSpam) {
                    markOwnerSkippedUser(owner, uId, spamCheck.reason, {
                      name: u.firstName,
                      username: u.username,
                      phone: u.phone,
                      category: 'spam_keyword',
                      skippedByPhone: phone
                    });
                    continue;
                  }

                  const candidateHash = u.accessHash || u.access_hash;
                  const hasCandUname = Boolean(u.username && String(u.username).trim().length > 0);
                  if (!hasCandUname && (!candidateHash || String(candidateHash) === '0')) continue;

                  try {
                    // Lock into Telegram Cloud Contacts immediately while live stream is active!
                    // This captures their permanent contact access hash so they NEVER expire even if they leave stream!
                    await lockContactPermanently(client, phone, uId, u).catch(() => null);

                    recordUserPeers(phone, [u], client);
                    markGlobalVerified(uId);
                    addToAccountVerifiedQueue(phone, [uId]);
                    a.daily_collected_count = (a.daily_collected_count || 0) + 1;
                    newlyQueued.push(u);

                    log(phone, 'TARGET', `🎯 [GENUINE STREAM TARGET LOCKED] ${u.firstName || uId} permanently secured in Telegram Cloud Contacts & queued for DM delivery!`);
                  } catch (lockErr: any) {
                    tempLiveStreamCooldown.set(uId, Date.now() + 60000);
                  }
                }

                if (newlyQueued.length > 0) {
                  streamParticipantsCache.set(phone, {
                    uids: new Set(allUsersMap.keys()),
                    lastSync: Date.now(),
                    channelTitle: cand.title,
                    call: inputCall
                  });
                  log(phone, 'OK', `⚡ [BATCH LOCKED] Queued +${newlyQueued.length} genuine listeners into Verified Queue (Total in Queue: ${getAccountVerifiedQueue(phone).length}).`);
                  break; // Channel successfully harvested, proceed to dispatch
                } else {
                  log(
                    phone,
                    'LIVE',
                    `Scanned "${cand.title}" - no new eligible listeners (All listeners either contacted, in queue, or filtered).`
                  );
                }
              } catch (batchErr: any) {
                // Batch error handled
              }
            }
          } catch (candErr: any) {
            // Ignored single candidate error
          }
        }

        if (liveFoundCount === 0) {
          const hadActiveCall = activeGroupCalls.has(phone) || getAccountVerifiedQueue(phone).length > 0;
          activeGroupCalls.delete(phone);
          ownerActiveGroupCalls.delete(owner);
          if (hadActiveCall) {
            purgeAccountVerifiedQueueOnStreamEnd(phone, 'Live stream concluded by host');
          }
          log(
            phone,
            'INFO',
            `Scanned ${candidates.length} channels - no live audio stream active currently. Next scan in ${checkIntervalSec}s.`
          );
          if (a.status.startsWith('LIVE:')) {
            a.status = 'Monitoring...';
            broadcastAccountUpdate(a.owner);
          }
        }
      } catch (e: any) {
        log(phone, 'WARN', `Monitor scan error: ${String(e?.message || e).slice(0, 60)}`);
      }
      await new Promise((r) => setTimeout(r, checkIntervalSec * 1000));
    } else {
      // Live monitoring is OFF (queue full or paused) - wait 4s before rechecking
      await new Promise((r) => setTimeout(r, 4000));
    }
  }

  // Await DM task if queue has items and we are stopping gracefully
  const qLeft = loadDmQueue(phone).length;
  if (qLeft > 0) {
    a.status = `Finishing queue: ${qLeft} left`;
    log(phone, 'DB', `Draining queue of ${qLeft} users before disconnecting...`);
    await Promise.race([
      dmLoopPromise,
      new Promise((r) => setTimeout(r, 10000)) // graceful timeout 10s max
    ]);
  }

  await client.disconnect().catch(() => {});
  if (signal.aborted) {
    a.running = false;
    a.status = 'Stopped';
    log(phone, 'BYE', 'Client disconnected cleanly on user stop.');
  } else {
    log(phone, 'WARN', 'Client connection ended. Preserving running state for auto-recovery...');
    a.status = 'Reconnecting...';
  }
}

// 🛡️ UNINTERRUPTED AUTO-RECOVERY BOT SUPERVISOR (Module-Level)
// User requirement: Bots must NEVER shut down unless explicitly stopped by user!
function launchBotWorker(phone: string, abortController: AbortController) {
  const a = accounts.get(phone);
  if (a) {
    if (a.abortController && a.abortController !== abortController) {
      try { a.abortController.abort(); } catch {}
    }
    a.abortController = abortController;
    a.running = true;
    (a as any).persisted_running = true;
    saveAccountsLocal();
  }

  const runWithAutoRecovery = async () => {
    while (!abortController.signal.aborted) {
      const cur = accounts.get(phone);
      if (!cur) break;
      if (cur.abortController && cur.abortController !== abortController) {
        // Newer worker supervisor took over this account
        return;
      }
      cur.running = true;
      (cur as any).persisted_running = true;
      try {
        await runTelegramBot(phone, abortController.signal);
      } catch (err: any) {
        if (abortController.signal.aborted) break;
        log(phone, 'WARN', `⚠️ [AUTO-RECOVERY] Bot loop interrupted (${err?.message || err}). Auto-recovering in 4s...`);
      }

      if (abortController.signal.aborted) break;

      // 🛡️ Ensure bot remains RUNNING in UI and memory unless explicitly aborted by user stop
      const curAfter = accounts.get(phone);
      if (curAfter && curAfter.abortController === abortController && !abortController.signal.aborted) {
        curAfter.running = true;
        (curAfter as any).persisted_running = true;
        curAfter.status = 'Reconnecting...';
        broadcastAccountUpdate(curAfter.owner);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Only set stopped when abortController.signal.aborted is TRUE (user clicked stop)
    const curEnd = accounts.get(phone);
    if (curEnd && curEnd.abortController === abortController && abortController.signal.aborted) {
      curEnd.running = false;
      (curEnd as any).persisted_running = false;
      curEnd.status = 'Stopped';
      saveAccountsLocal();
      broadcastAccountUpdate(curEnd.owner);
    }
  };

  runWithAutoRecovery().catch((err) => {
    log(phone, 'FAIL', `Bot supervisor unexpected loop exit: ${err?.message || err}`);
    const cur = accounts.get(phone);
    if (cur && cur.abortController === abortController && abortController.signal.aborted) {
      cur.running = false;
      (cur as any).persisted_running = false;
      cur.status = 'Stopped';
      saveAccountsLocal();
      broadcastAccountUpdate(cur.owner);
    }
  });
}

