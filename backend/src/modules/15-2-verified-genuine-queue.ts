// ---------------- 2. VERIFIED / GENUINE QUEUE (Per-Account / Phone Architecture) ----------------
function getAccountVerifiedQueue(phone: string): number[] {
  let q = queueCache.get(phone);
  if (!q) {
    q = [];
    try {
      const pId = phone.replace(/[^0-9+]/g, '');
      const localPath = path.join(__dirname, `queue_${pId}.json`);
      if (fs.existsSync(localPath)) {
        const fileQ = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        if (Array.isArray(fileQ)) q = fileQ;
      }
    } catch {}
    queueCache.set(phone, q);
  }

  // Real-time automatic sanitization: Filter out any users already sent or skipped
  const a = accounts.get(phone);
  const owner = a?.owner || 'admin';
  const sent = getOwnerSentUsers(owner);
  const skipped = getOwnerSkippedUsers(owner);
  const localSent = a?.sent_users;

  const cleanQ = q.filter(uid => !sent.has(uid) && !skipped.has(uid) && !localSent?.has(uid));
  if (cleanQ.length !== q.length) {
    q = cleanQ;
    queueCache.set(phone, q);
    try {
      const pId = phone.replace(/[^0-9+]/g, '');
      const localPath = path.join(__dirname, `queue_${pId}.json`);
      asyncSaveJson(localPath, q, 800);
    } catch {}
    if (a) {
      a.queue_count = q.length;
      (a as any).verified_queue_count = q.length;
    }
  }

  return q;
}

function saveAccountVerifiedQueue(phone: string, q: number[]): void {
  queueCache.set(phone, q);
  try {
    const pId = phone.replace(/[^0-9+]/g, '');
    const localPath = path.join(__dirname, `queue_${pId}.json`);
    asyncSaveJson(localPath, q, 800);
  } catch {}

  const a = accounts.get(phone);
  if (a) {
    a.queue_count = q.length;
    (a as any).verified_queue_count = q.length;
  }
  if (typeof broadcastAccountUpdate === 'function') {
    try {
      broadcastAccountUpdate(a?.owner || 'admin');
    } catch {}
  }
}

function addToAccountVerifiedQueue(phone: string, uids: number[]): void {
  const verifiedQ = getAccountVerifiedQueue(phone);
  const verifiedSet = new Set(verifiedQ);
  const a = accounts.get(phone);
  const sentSet = a?.sent_users || new Set();
  const owner = a?.owner || 'admin';
  const ownerSentSet = getOwnerSentUsers(owner);
  const ownerSkippedSet = getOwnerSkippedUsers(owner);
  const peers = getOwnerPeers(owner);
  let added = 0;

  // Separate incoming batch into users WITHOUT @username (priority 1) and WITH @username (priority 2)
  const incomingWithoutUname: number[] = [];
  const incomingWithUname: number[] = [];

  for (const id of uids) {
    // Unlimited Genuine Queue capacity (Safety ceiling 100,000)
    if (verifiedQ.length >= 100000) break;
    if (!verifiedSet.has(id) && !sentSet.has(id) && !ownerSentSet.has(id) && !ownerSkippedSet.has(id)) {
      const pInfo = peers.get(String(id)) || findPeerInfoAnywhere(String(id), owner);
      const hasUname = Boolean(pInfo?.username && String(pInfo.username).trim().length > 0);
      if (hasUname) {
        incomingWithUname.push(id);
      } else {
        incomingWithoutUname.push(id);
      }
      verifiedSet.add(id);
      added++;
    }
  }

  // Prepend/insert without-username users first so they are processed before with-username users
  verifiedQ.push(...incomingWithoutUname, ...incomingWithUname);

  if (added > 0) {
    saveAccountVerifiedQueue(phone, verifiedQ);
  }
}

function removeFromAccountVerifiedQueue(phone: string, uid: number): void {
  const currentQ = getAccountVerifiedQueue(phone);
  const nextQ = currentQ.filter((id) => id !== uid);
  saveAccountVerifiedQueue(phone, nextQ);
}

function purgeAccountVerifiedQueueOnStreamEnd(phone: string, reason: string): number {
  activeGroupCalls.delete(phone);
  streamParticipantsCache.delete(phone);
  wakeScanner(phone);
  const a = accounts.get(phone);
  const owner = a?.owner || 'admin';
  ownerActiveGroupCalls.delete(owner);
  ownerExtractingLock.delete(owner);

  const verifiedQ = getAccountVerifiedQueue(phone);
  if (verifiedQ.length === 0) {
    saveAccountVerifiedQueue(phone, []);
    return 0;
  }

  const ownerPeers = getOwnerPeers(owner);
  let purgedCount = 0;
  const retainedQ: number[] = [];

  for (const uid of verifiedQ) {
    const pInfo = ownerPeers.get(String(uid)) || findPeerInfoAnywhere(String(uid), owner);
    const hasUname = Boolean(pInfo?.username && String(pInfo.username).trim().length > 0);
    const isContactLocked = Boolean(pInfo?.isContactLocked || pInfo?.contactSaved);

    // Retain users that CAN actually be messaged after live stream ends:
    // 1. Permanently locked/saved in Telegram Cloud Contacts
    // 2. Users with @username (can be resolved and messaged anytime globally)
    if (isContactLocked) {
      retainedQ.push(uid);
      log(phone, 'OK', `📇 [CONTACT RETAINED] ${pInfo?.firstName || uid} is permanently secured in Telegram Cloud Contacts. Retained in queue despite stream end.`);
      continue;
    }
    if (hasUname) {
      retainedQ.push(uid);
      log(phone, 'OK', `👤 [USERNAME RETAINED] @${String(pInfo?.username).replace(/^@/, '')} retained in queue (can be reached anytime via @username).`);
      continue;
    }

    // Unsaved listeners without username: accessHash expires the moment stream closes
    markOwnerSkippedUser(owner, uid, `Live stream closed by host (${reason}) - Access hash expired`, {
      name: pInfo?.firstName,
      username: pInfo?.username,
      phone: pInfo?.phone,
      category: 'no_peer',
      skippedByPhone: phone
    });
    purgedCount++;
  }

  saveAccountVerifiedQueue(phone, retainedQ);

  if (a) {
    (a as any).in_stream_batch = 0;
    (a as any).batch_sent_in_cycle = 0;
  }

  if (purgedCount > 0) {
    log(
      phone,
      'WARN',
      `⚠️ [STREAM CONCLUDED - AUTO PURGE] Live stream ended by host. Discarded ${purgedCount} stale queue items with expired hashes. Ready for next live stream!`
    );
    if (typeof broadcastAccountUpdate === 'function') {
      try {
        broadcastAccountUpdate(owner);
      } catch {}
    }
  }

  return purgedCount;
}

function claimNextFromAccountVerifiedQueue(phone: string): number | null {
  const q = getAccountVerifiedQueue(phone);
  const a = accounts.get(phone);
  const owner = a?.owner || 'admin';
  const sent = getOwnerSentUsers(owner);
  const skipped = getOwnerSkippedUsers(owner);
  const peers = getOwnerPeers(owner);

  // Prune any already sent or skipped UIDs immediately so queue count reflects reality
  const validUids = q.filter((uid) => !sent.has(uid) && !skipped.has(uid) && !(a?.sent_users?.has(uid)));
  if (validUids.length !== q.length) {
    saveAccountVerifiedQueue(phone, validUids);
  }
  if (validUids.length === 0) return null;

  // Separate into:
  // 1. First priority: Users WITHOUT @username (temporary stream listener hash, DM first)
  // 2. Second priority: Users WITH @username (DM after without-username users, or skip if reject_usernames is true)
  const withoutUsername: number[] = [];
  const withUsername: number[] = [];

  for (const uid of validUids) {
    const pInfo = peers.get(String(uid)) || findPeerInfoAnywhere(String(uid), owner);
    const hasUname = Boolean(pInfo?.username && String(pInfo.username).trim().length > 0);
    if (hasUname) {
      withUsername.push(uid);
    } else {
      withoutUsername.push(uid);
    }
  }

  // FIRST PRIORITY: Always DM users without @username first!
  if (withoutUsername.length > 0) {
    return withoutUsername[0];
  }

  // SECOND PRIORITY: Users with @username (worker handles DMing them or skipping according to config)
  if (withUsername.length > 0) {
    return withUsername[0];
  }

  return null;
}

// Backward-compatible wrappers for owner queue
function getOwnerVerifiedQueue(owner: string): number[] {
  const normOwner = owner || 'admin';
  const combined: number[] = [];
  for (const acc of accounts.values()) {
    if ((acc.owner || 'admin') === normOwner) {
      combined.push(...getAccountVerifiedQueue(acc.phone));
    }
  }
  return Array.from(new Set(combined));
}

function saveOwnerVerifiedQueue(owner: string, q: number[]): void {
  const normOwner = owner || 'admin';
  for (const acc of accounts.values()) {
    if ((acc.owner || 'admin') === normOwner) {
      saveAccountVerifiedQueue(acc.phone, q);
      break;
    }
  }
}

function addToOwnerVerifiedQueue(owner: string, uids: number[]): void {
  const normOwner = owner || 'admin';
  for (const acc of accounts.values()) {
    if ((acc.owner || 'admin') === normOwner && acc.running) {
      addToAccountVerifiedQueue(acc.phone, uids);
      return;
    }
  }
}

function removeFromOwnerVerifiedQueue(owner: string, uid: number): void {
  const normOwner = owner || 'admin';
  for (const acc of accounts.values()) {
    if ((acc.owner || 'admin') === normOwner) {
      removeFromAccountVerifiedQueue(acc.phone, uid);
    }
  }
}

function purgeStaleVerifiedQueueOnStreamEnd(owner: string, phone: string, reason: string): number {
  return purgeAccountVerifiedQueueOnStreamEnd(phone, reason);
}

function broadcastPeerToOwnerClients(owner: string, uidStr: string, p?: PeerInfo): void {
  if (!p) return;
  const hash = p.accessHash ? String(p.accessHash).replace(/[^0-9-]/g, '') : '';
  for (const acc of accounts.values()) {
    if ((acc.owner || 'admin') === owner && acc.client) {
      try {
        if (hash && hash !== '0') {
          const inputPeer = new Api.InputPeerUser({
            userId: BigInt(uidStr) as any,
            accessHash: BigInt(hash) as any
          });
          if ((acc.client as any)._entityCache?.cacheMap) {
            (acc.client as any)._entityCache.cacheMap.set(uidStr, inputPeer);
          }
          const dummyUser = new Api.User({
            id: BigInt(uidStr) as any,
            accessHash: BigInt(hash) as any,
            firstName: p.firstName || 'User',
            username: p.username
          });
          if ((acc.client as any).session && typeof (acc.client as any).session.processEntities === 'function') {
            (acc.client as any).session.processEntities({ users: [dummyUser] });
          }
          if ((acc.client as any)._entityCache && typeof (acc.client as any)._entityCache.add === 'function') {
            (acc.client as any)._entityCache.add([dummyUser]);
          }
        }
      } catch {}
    }
  }
}

function claimNextFromVerifiedQueue(owner: string, phone: string, client?: any): number | null {
  const normOwner = owner || 'admin';
  const q = getOwnerVerifiedQueue(normOwner);
  const sent = getOwnerSentUsers(normOwner);
  const skipped = getOwnerSkippedUsers(normOwner);
  const peers = getOwnerPeers(normOwner);

  if (!ownerVerifiedReservedUids.has(normOwner)) {
    ownerVerifiedReservedUids.set(normOwner, new Map());
  }
  const reserved = ownerVerifiedReservedUids.get(normOwner)!;

  // Release previous reservation of this phone if any
  for (const [rUid, rPhone] of reserved.entries()) {
    if (rPhone === phone) {
      reserved.delete(rUid);
    }
  }

  // Helper: Determine if THIS specific phone can message this user in Telegram
  // MTProto access_hash is cryptographically bound to the account session that discovered the user.
  // 1. Users with @username can be resolved and messaged universally by ANY active account.
  // 2. Users without @username are routed to the specific account that extracted them (or holds their accessHash).
  const canPhoneMessage = (p: PeerInfo | undefined, uid: number): boolean => {
    if (!p) return false;
    // 1. If user has a username, ANY account can resolve and message them universally
    if (p.username && p.username.trim().length > 0) return true;
    // 2. If this specific phone has an account-specific accessHash recorded
    if (p.accessHashes && p.accessHashes[phone] && p.accessHashes[phone] !== '0') return true;
    // 3. If this phone is the source phone that discovered the peer with a valid accessHash
    if (p.sourcePhone === phone && p.accessHash && p.accessHash !== '0') return true;
    // 4. If this client's active GramJS session or entity cache already contains the peer
    if (client) {
      try {
        if ((client as any).session?.getInputEntity?.(uid)) return true;
      } catch {}
    }
    // 5. Fallback if no source phone is specified
    if (!p.sourcePhone) return true;
    return false;
  };

  // Select the next candidate that THIS account has permission / session-access to message
  for (const uid of q) {
    if (!sent.has(uid) && !skipped.has(uid) && !reserved.has(uid)) {
      const p = peers.get(String(uid)) || findPeerInfoAnywhere(String(uid), normOwner);
      if (canPhoneMessage(p, uid)) {
        reserved.set(uid, phone);
        return uid;
      }
    }
  }

  return null;
}

function releaseOwnerVerifiedReservation(owner: string, uid: number): void {
  const normOwner = owner || 'admin';
  const reserved = ownerVerifiedReservedUids.get(normOwner);
  if (reserved) reserved.delete(uid);
}

// Backward-compatible unified wrappers
function getOwnerQueue(owner: string): number[] {
  return getOwnerVerifiedQueue(owner);
}
function saveOwnerQueue(owner: string, q: number[]): void {
  saveOwnerVerifiedQueue(owner, q);
}
function addToOwnerQueue(owner: string, phone: string, uids: number[]): void {
  addToOwnerRawQueue(owner, phone, uids);
}
function claimNextFromOwnerQueue(owner: string, phone: string): number | null {
  return claimNextFromVerifiedQueue(owner, phone);
}
function releaseOwnerReservation(owner: string, uid: number): void {
  releaseOwnerVerifiedReservation(owner, uid);
}
function removeFromOwnerQueue(owner: string, uid: number): void {
  removeFromOwnerVerifiedQueue(owner, uid);
}

function bulkFilterOwnerQueue(owner: string, phone?: string): number {
  const normOwner = owner || 'admin';
  const rawQ = getOwnerRawQueue(normOwner);
  const verifiedQ = getOwnerVerifiedQueue(normOwner);
  const sentSet = getOwnerSentUsers(normOwner);
  const skippedSet = getOwnerSkippedUsers(normOwner);

  const filteredRaw = rawQ.filter((id) => !sentSet.has(id) && !skippedSet.has(id));
  const filteredVerified = verifiedQ.filter((id) => !sentSet.has(id) && !skippedSet.has(id));

  const removedRaw = rawQ.length - filteredRaw.length;
  const removedVerified = verifiedQ.length - filteredVerified.length;

  if (removedRaw > 0) saveOwnerRawQueue(normOwner, filteredRaw);
  if (removedVerified > 0) saveOwnerVerifiedQueue(normOwner, filteredVerified);

  const totalRemoved = removedRaw + removedVerified;
  if (totalRemoved > 0 && phone) {
    log(phone, 'INFO', `⚡ Bulk pruned ${totalRemoved} invalid users (Raw: ${filteredRaw.length} | Genuine: ${filteredVerified.length})`);
  }
  return totalRemoved;
}

function getOwnerSentUsers(owner: string): Set<number> {
  const normOwner = (owner || 'admin').toLowerCase();
  let s = ownerSentCache.get(normOwner);
  if (!s) {
    s = new Set();
    try {
      const localOwnerSPath = path.join(__dirname, `sent_owner_${normOwner}.json`);
      if (fs.existsSync(localOwnerSPath)) {
        const arr = JSON.parse(fs.readFileSync(localOwnerSPath, 'utf8'));
        if (Array.isArray(arr)) arr.forEach((id: number) => s!.add(id));
      } else if (owner && owner !== normOwner) {
        const altPath = path.join(__dirname, `sent_owner_${owner}.json`);
        if (fs.existsSync(altPath)) {
          const arr = JSON.parse(fs.readFileSync(altPath, 'utf8'));
          if (Array.isArray(arr)) arr.forEach((id: number) => s!.add(id));
        }
      }
    } catch {}
    ownerSentCache.set(normOwner, s);
  }
  return s;
}

function markOwnerSentUser(owner: string, uid: number, phone?: string): void {
  const normOwner = (owner || 'admin').toLowerCase();
  const s = getOwnerSentUsers(normOwner);
  s.add(uid);
  ownerSentCache.set(normOwner, s);
  try {
    const localOwnerSPath = path.join(__dirname, `sent_owner_${normOwner}.json`);
    asyncSaveJson(localOwnerSPath, Array.from(s), 1000);
  } catch {}
  // , { uids: Array.from(s) }); // DISABLED TO PREVENT FIRESTORE LIMIT EXHAUSTION

  if (phone) {
    saveSentUser(phone, uid);
  }

  if (typeof broadcastAccountUpdate === 'function') {
    try {
      broadcastAccountUpdate(normOwner);
    } catch {}
  }
}

function getOwnerPeers(owner: string): Map<string, PeerInfo> {
  const normOwner = owner || 'admin';
  let p = ownerPeersCache.get(normOwner);
  if (!p) {
    p = new Map();
    try {
      const localPPath = path.join(__dirname, `peers_owner_${normOwner}.json`);
      if (fs.existsSync(localPPath)) {
        const arr = JSON.parse(fs.readFileSync(localPPath, 'utf8'));
        if (Array.isArray(arr)) {
          for (const [k, v] of arr) {
            p.set(k, v);
          }
        }
      }
    } catch {}
    ownerPeersCache.set(normOwner, p);
  }
  return p;
}

function saveOwnerPeers(owner: string, p: Map<string, PeerInfo>): void {
  const normOwner = owner || 'admin';
  ownerPeersCache.set(normOwner, p);

  // Sync in-memory cache to all accounts of owner instantly (0ms CPU, zero disk thrashing)
  for (const acc of accounts.values()) {
    if ((acc.owner || 'admin') === normOwner) {
      peersCache.set(acc.phone, p);
    }
  }

  // Persist master owner file asynchronously with 10s debounce
  try {
    const localPPath = path.join(__dirname, `peers_owner_${normOwner}.json`);
    asyncSaveJson(localPPath, () => Array.from(p.entries()), 10000);
  } catch {}
}

function findPeerInfoAnywhere(uidStr: string, preferredOwner?: string): PeerInfo | undefined {
  const cleanUid = String(uidStr).replace(/[^0-9-]/g, '');
  if (!cleanUid || cleanUid === '0') return undefined;

  // 1. Check preferred owner
  if (preferredOwner) {
    const p = getOwnerPeers(preferredOwner).get(cleanUid);
    if (p && (p.accessHash || p.username || p.phone)) return p;
  }

  // 2. Check admin
  const adminP = getOwnerPeers('admin').get(cleanUid);
  if (adminP && (adminP.accessHash || adminP.username || adminP.phone)) return adminP;

  // 3. Check all cached owners
  for (const [owner, pMap] of ownerPeersCache.entries()) {
    const p = pMap.get(cleanUid);
    if (p && (p.accessHash || p.username || p.phone)) return p;
  }

  // 4. Check all account peer caches
  for (const [phone, pMap] of peersCache.entries()) {
    const p = pMap.get(cleanUid);
    if (p && (p.accessHash || p.username || p.phone)) return p;
  }

  return undefined;
}

function getTodayDateString(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function checkAndResetDailyQuota(phone: string): void {
  const a = accounts.get(phone);
  if (!a) return;
  const todayStr = getTodayDateString();
  if ((a as any).daily_extracted_date !== todayStr) {
    (a as any).daily_extracted_date = todayStr;
    (a as any).daily_extracted_count = 0;
    (a as any).daily_alert_sent = false;
    if (a.running && !a.live_on) {
      a.live_on = true;
      log(phone, 'OK', `New day (${todayStr}) started: Daily counters refreshed. Live monitoring activated!`);
    }
  }
}

function checkAndResetDailyDmQuota(phone: string): void {
  const a = accounts.get(phone);
  if (!a) return;
  const todayStr = getTodayDateString();
  if ((a as any).daily_sent_date !== todayStr) {
    (a as any).daily_sent_date = todayStr;
    (a as any).daily_sent_count = 0;
    // a.sent_count is NEVER reset to 0; it is the total lifetime DM count for this ID
    if (a.running && !a.dm_on) {
      a.dm_on = true;
    }
  }
}

