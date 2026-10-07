// ---------------- AUTO-DELETE PERSONAL CHATS OLDER THAN 1 DAY (24 HOURS) ----------------
async function cleanOldPersonalChatsForAccount(phone: string, daysThreshold: number = 1): Promise<{ cleaned: number; errors: number }> {
  const a = accounts.get(phone);
  if (!a || !a.client || !a.client.connected) {
    return { cleaned: 0, errors: 0 };
  }
  const client = a.client;
  const thresholdSeconds = Math.floor(Date.now() / 1000) - (daysThreshold * 24 * 3600);
  let cleaned = 0;
  let errors = 0;

  try {
    const myId = (client as any)._self?.id || (client.session as any)?.userId;
    const dialogs = await client.getDialogs({ limit: 250 });
    for (const d of dialogs) {
      // Strictly personal 1-on-1 human chats (NOT channels, NOT groups, NOT official bots, NOT self/saved messages)
      const peerId = d.entity?.id;
      if (d.isUser && !d.entity?.bot && peerId !== 777000 && peerId !== myId) {
        const lastMsgDate = d.date || (d.message && d.message.date) || 0;
        // If the entire chat had its last activity more than 24 hours ago (yesterday/older):
        if (lastMsgDate > 0 && lastMsgDate < thresholdSeconds) {
          try {
            await client.invoke(
              new Api.messages.DeleteHistory({
                peer: d.inputEntity || d.entity,
                maxId: 0,
                revoke: true
              })
            );
            cleaned++;
            await new Promise((r) => setTimeout(r, 350)); // anti-flood safe pause
          } catch (e: any) {
            errors++;
          }
        } else if (lastMsgDate >= thresholdSeconds) {
          // Chat is active recently, but delete older messages inside it (> 24 hours old)
          try {
            await client.invoke(
              new Api.messages.DeleteHistory({
                peer: d.inputEntity || d.entity,
                maxId: 0,
                maxDate: thresholdSeconds,
                revoke: true
              })
            );
          } catch {}
        }
      }
    }
    if (cleaned > 0) {
      log(phone, 'CLEAN', `🧹 [AUTO-CLEANUP] Deleted ${cleaned} personal chat(s) older than 24 hours (1 day).`);
    }
  } catch (err: any) {
    log(phone, 'ERROR', `Error during chat cleanup: ${err?.message || err}`);
  }

  return { cleaned, errors };
}

async function runAutoCleanOldChatsSweep(daysThreshold: number = 1): Promise<{ totalCleaned: number }> {
  let totalCleaned = 0;
  for (const [phone, acc] of accounts.entries()) {
    if (acc.client && acc.client.connected) {
      try {
        const res = await cleanOldPersonalChatsForAccount(phone, daysThreshold);
        totalCleaned += res.cleaned;
      } catch {}
    }
  }
  if (totalCleaned > 0) {
    console.log(`🧹 [AUTO-CLEAN CRON] Successfully cleaned ${totalCleaned} personal 1-on-1 chats (> 24h old) across active accounts.`);
  }
  return { totalCleaned };
}

// 🚀 REAL-TIME RAM & TELEGRAM CLIENT MEMORY OPTIMIZER
function optimizeProcessMemory(): { freedAccounts: number; rssBeforeMb: number; rssAfterMb: number } {
  const memBefore = process.memoryUsage();
  const rssBeforeMb = Math.round(memBefore.rss / 1024 / 1024);
  let freedAccounts = 0;

  try {
    // 1. Trim GramJS Entity Cache & Update queues for all running clients
    for (const [phone, acc] of accounts.entries()) {
      if (acc.client) {
        freedAccounts++;
        try {
          const clientAny = acc.client as any;
          if (clientAny._entityCache) {
            // Keep at most 150 essential recent entity items to prevent runaway memory
            if (clientAny._entityCache.cacheMap && clientAny._entityCache.cacheMap instanceof Map) {
              if (clientAny._entityCache.cacheMap.size > 200) {
                const entries = Array.from(clientAny._entityCache.cacheMap.entries()).slice(-150);
                clientAny._entityCache.cacheMap.clear();
                for (const [k, v] of entries) {
                  clientAny._entityCache.cacheMap.set(k, v);
                }
              }
            }
          }
          // Clear discarded pending update buffers
          if (Array.isArray(clientAny._pendingUpdates)) {
            clientAny._pendingUpdates.length = 0;
          }
        } catch {}
      }

      // 2. Trim in-memory logsMap per account to max 120 lines
      const logs = logsMap.get(phone);
      if (logs && logs.length > 120) {
        logs.splice(0, logs.length - 120);
      }
    }

    // 3. Compact owner peer stores in RAM (keep essential peers)
    for (const [owner, peerMap] of ownerPeersCache.entries()) {
      if (peerMap && peerMap.size > 5000) {
        const recentEntries = Array.from(peerMap.entries()).slice(-3000);
        peerMap.clear();
        for (const [k, v] of recentEntries) {
          peerMap.set(k, v);
        }
      }
    }

    // 4. Trigger garbage collector if available
    if (typeof (global as any).gc === 'function') {
      try {
        (global as any).gc();
      } catch {}
    }
  } catch (err) {
    console.error('Error during RAM optimization:', err);
  }

  const memAfter = process.memoryUsage();
  const rssAfterMb = Math.round(memAfter.rss / 1024 / 1024);
  return { freedAccounts, rssBeforeMb, rssAfterMb };
}

// 🕒 3-MINUTE AUTO RAM COMPACTION & GARBAGE SWEEPER
setInterval(() => {
  try {
    const res = optimizeProcessMemory();
    if (res.rssBeforeMb - res.rssAfterMb > 15 || res.rssBeforeMb > 600) {
      console.log(`🧹 [RAM OPTIMIZER] Compaction: ${res.rssBeforeMb}MB -> ${res.rssAfterMb}MB (${res.freedAccounts} active bots optimized).`);
    }
  } catch {}
}, 3 * 60 * 1000);

// 🛡️ PROACTIVE OOM WATCHDOG (Checks memory every 30s to prevent Linux kernel OOM Killer from terminating process)
setInterval(() => {
  try {
    const freeMb = Math.round(os.freemem() / 1024 / 1024);
    const procMem = process.memoryUsage();
    const rssMb = Math.round(procMem.rss / 1024 / 1024);

    // If host system free RAM is critical (< 140MB) or Node process uses > 500MB on low-memory VPS
    if (freeMb < 140 || rssMb > 500) {
      console.warn(`⚠️ [OOM GUARD] Critical memory threshold: Host Free: ${freeMb}MB, Node RSS: ${rssMb}MB. Executing emergency compaction...`);
      const res = optimizeProcessMemory();
      console.log(`🛡️ [OOM GUARD] Emergency compaction freed memory: RSS ${res.rssBeforeMb}MB -> ${res.rssAfterMb}MB.`);
    }
  } catch {}
}, 30 * 1000);

// 🧹 30-MINUTE BACKGROUND CRON: Periodically auto-cleans personal chats older than 24 hours (1 day)
setInterval(async () => {
  try {
    await runAutoCleanOldChatsSweep(1);
  } catch (e) {
    console.error('[CRON AUTO-CLEAN ERROR]:', e);
  }
}, 30 * 60 * 1000);

async function loadPhoneData(phone: string) {
  const pId = phone.replace(/[^0-9+]/g, '');
  const a = accounts.get(phone);
  const owner = a?.owner || 'admin';
  try {
    const s = new Set<number>();
    const localSentPath = path.join(__dirname, `sent_${pId}.json`);
    if (fs.existsSync(localSentPath)) {
      try {
        const fileContent = fs.readFileSync(localSentPath, 'utf8');
        const parsed = JSON.parse(fileContent);
        if (Array.isArray(parsed)) {
          parsed.forEach((id: any) => s.add(Number(id)));
        }
      } catch {}
    }
    sentUsersCache.set(phone, s);
    const ownerS = getOwnerSentUsers(owner);
    s.forEach((id: any) => ownerS.add(Number(id)));
    
    // Load Two-Queue state: Raw & Verified from local files
    getOwnerVerifiedQueue(owner);
    getOwnerRawQueue(owner);
    
    // Load peers from local file
    const peersMap = new Map<number, PeerInfo>();
    const localPeersPath = path.join(__dirname, `peers_${pId}.json`);
    if (fs.existsSync(localPeersPath)) {
      try {
        const fileContent = fs.readFileSync(localPeersPath, 'utf8');
        if (fileContent && fileContent.trim().length > 0) {
          const parsed = JSON.parse(fileContent);
          if (Array.isArray(parsed)) {
            for (const [k, v] of parsed) {
              peersMap.set(Number(k), v as PeerInfo);
            }
          } else if (typeof parsed === 'object' && parsed !== null) {
            for (const [k, v] of Object.entries(parsed)) {
              peersMap.set(Number(k), v as PeerInfo);
            }
          }
        }
      } catch (err: any) {
        console.warn(`[RECOVERY] Local peers file corrupted for ${phone} (${err?.message || err}). Safe fallback initialized.`);
        try {
          fs.renameSync(localPeersPath, `${localPeersPath}.corrupt.${Date.now()}`);
        } catch {}
      }
    }
    peersCache.set(phone, peersMap);

    // Merge peers into owner peer map
    const ownerPeers = getOwnerPeers(owner);
    for (const [k, v] of peersMap.entries()) {
      if (!ownerPeers.has(k) || (!ownerPeers.get(k)?.accessHash && v.accessHash)) {
        ownerPeers.set(k, v);
      }
    }
    saveOwnerPeers(owner, ownerPeers);
  } catch (err) {
    console.error(`Error loading local data for ${phone}:`, err);
    if (!sentUsersCache.has(phone)) sentUsersCache.set(phone, new Set());
    if (!queueCache.has(phone)) queueCache.set(phone, []);
    if (!peersCache.has(phone)) peersCache.set(phone, new Map());
  }
}

function loadSentUsers(phone        )              {
  const a = accounts.get(phone);
  const owner = a?.owner || 'admin';
  return getOwnerSentUsers(owner);
}

function saveSentUser(phone        , uid        )       {
  const s = sentUsersCache.get(phone) || new Set        ();
  s.add(uid);
  sentUsersCache.set(phone, s);
  const pId = phone.replace(/[^0-9+]/g, '');

}

function getOwnerQueueLength(owner: string): number {
  return getOwnerQueue(owner).length;
}

function loadDmQueue(phone        )           {
  const a = accounts.get(phone);
  const owner = a?.owner || 'admin';
  return getOwnerQueue(owner);
}

function addToQueue(phone: string, uids: number[]): void {
  const a = accounts.get(phone);
  if (!a) return;
  const owner = a.owner || 'admin';
  addToOwnerQueue(owner, phone, uids);
}

function removeFromQueue(phone: string, uid: number): void {
  const a = accounts.get(phone);
  const owner = a?.owner || 'admin';
  removeFromOwnerQueue(owner, uid);
}

function loadPeers(phone        )                        {
  const a = accounts.get(phone);
  const owner = a?.owner || 'admin';
  return getOwnerPeers(owner);
}

function savePeers(phone: string, map: Map<number, PeerInfo>): void {
  peersCache.set(phone, map);
  const pId = phone.replace(/[^0-9+]/g, '');

  try {
    const filePath = path.join(__dirname, `peers_${pId}.json`);
    asyncSaveJson(filePath, () => Array.from(map.entries()), 15000);
  } catch (err) {
    console.error('Local peers save error:', err);
  }
}

function recordUserPeers(phone: string, users: any[], client?: any): void {
  if (!Array.isArray(users) || users.length === 0) return;
  const a = accounts.get(phone);
  const owner = a?.owner || 'admin';
  const peers = getOwnerPeers(owner);
  let updated = false;

  for (const u of users) {
    if (!u) continue;
    const uid = u.id || u.userId || u.user_id;
    if (!uid) continue;
    const uidStr = String(uid.toString ? uid.toString() : uid).replace(/[^0-9-]/g, '');
    if (!uidStr || uidStr === '0') continue;

    const rawHash = u.accessHash !== undefined ? u.accessHash : (u.access_hash !== undefined ? u.access_hash : u.peer?.accessHash);
    let accessHashStr: string | undefined = undefined;
    if (rawHash !== undefined && rawHash !== null) {
      const s = String(rawHash.toString ? rawHash.toString() : rawHash).replace(/[^0-9-]/g, '');
      if (s && s !== '0') accessHashStr = s;
    }
    const username = u.username ? String(u.username) : undefined;
    const firstName = (u.firstName || u.first_name) ? String(u.firstName || u.first_name) : undefined;
    const lastName = (u.lastName || u.last_name) ? String(u.lastName || u.last_name) : undefined;
    const phoneNum = u.phone ? String(u.phone) : undefined;

    const existing = peers.get(uidStr);
    const pInfo: PeerInfo = existing ? { ...existing } : { userId: uidStr };
    if (!pInfo.accessHashes) {
      pInfo.accessHashes = {};
      if (existing?.accessHash && existing?.sourcePhone) {
        pInfo.accessHashes[existing.sourcePhone] = existing.accessHash;
      }
    }

    if (accessHashStr && accessHashStr !== '0') {
      pInfo.accessHashes[phone] = accessHashStr;
      pInfo.accessHash = accessHashStr;
      pInfo.sourcePhone = phone;
    } else if (!pInfo.sourcePhone) {
      pInfo.sourcePhone = phone;
    }

    if (username) pInfo.username = username;
    if (firstName) pInfo.firstName = firstName;
    if (lastName) pInfo.lastName = lastName;
    if (phoneNum) pInfo.phone = phoneNum;
    if (isTelegramPremiumUser(u)) pInfo.isPremium = true;
    if (isTelegramBotUser(u)) pInfo.isBot = true;
    if (isTelegramDeletedUser(u)) pInfo.isDeleted = true;
    if (isTelegramPrivacyRestricted(u)) pInfo.isPrivacyRestricted = true;

    peers.set(uidStr, pInfo);
    updated = true;

    // Broadcast newly recorded peer and accessHash to all active client entity caches of this owner
    broadcastPeerToOwnerClients(owner, uidStr, pInfo);

    if (client) {
      try {
        if (accessHashStr && accessHashStr !== '0') {
          const inputPeer = new Api.InputPeerUser({
            userId: BigInt(uidStr) as any,
            accessHash: BigInt(accessHashStr) as any
          });
          if ((client as any)._entityCache?.cacheMap) {
            (client as any)._entityCache.cacheMap.set(uidStr, inputPeer);
          }
        }
        if ((client as any).session && typeof (client as any).session.processEntities === 'function') {
          (client as any).session.processEntities({ users: [u] });
        }
        if ((client as any)._entityCache && typeof (client as any)._entityCache.add === 'function') {
          (client as any)._entityCache.add([u]);
        }
      } catch {}
    }
  }

  if (updated) {
    saveOwnerPeers(owner, peers);
  }
}

function getSessionFile(phone: string): string {
  return path.join(__dirname, `session_${phone.replace(/[^0-9+]/g, '')}.txt`);
}

async function loadSessionString(phone: string): Promise<string> {
  const localPath = getSessionFile(phone);
  try {
    if (fs.existsSync(localPath)) {
      const localSess = fs.readFileSync(localPath, 'utf8').trim();
      if (localSess) return localSess;
    }
  } catch {}
  return '';
}

async function saveSessionString(phone: string, sess: string): Promise<void> {
  const localPath = getSessionFile(phone);
  try {
    fs.writeFileSync(localPath, sess, 'utf8');
  } catch (err) {
    console.error('Error saving session string locally:', err);
  }
}

function statusState(a: any): string {
  const s = a.status;
  if (s === 'awaiting_otp' || s === 'awaiting_2fa') return 'waiting';
  if (s === 'Stopping...' || s.startsWith('Finishing')) return 'stopping';
  if (s.startsWith('Failed') || s.startsWith('Error')) return 'failed';
  if (a.running) return 'running';
  return 'idle';
}

