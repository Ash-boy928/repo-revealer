// ---------------- 1. RAW / STAGING QUEUE (From Scanners) ----------------
function getOwnerRawQueue(owner: string): number[] {
  const normOwner = owner || 'admin';
  let q = ownerRawQueueCache.get(normOwner);
  if (!q) {
    q = [];
    try {
      const localOwnerRawPath = path.join(__dirname, `raw_queue_owner_${normOwner}.json`);
      if (fs.existsSync(localOwnerRawPath)) {
        const fileQ = JSON.parse(fs.readFileSync(localOwnerRawPath, 'utf8'));
        if (Array.isArray(fileQ)) q = fileQ;
      } else {
        // Migration fallback: check legacy queue if exists
        const legacyPath = path.join(__dirname, `queue_owner_${normOwner}.json`);
        if (fs.existsSync(legacyPath)) {
          const fileQ = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
          if (Array.isArray(fileQ)) q = fileQ;
        }
      }
    } catch {}
    ownerRawQueueCache.set(normOwner, q);
  }
  return q;
}

function saveOwnerRawQueue(owner: string, q: number[]): void {
  const normOwner = owner || 'admin';
  ownerRawQueueCache.set(normOwner, q);
  try {
    const localPath = path.join(__dirname, `raw_queue_owner_${normOwner}.json`);
    asyncSaveJson(localPath, q, 800);
  } catch {}
  // , { uids: q }); // DISABLED TO PREVENT FIRESTORE LIMIT EXHAUSTION

  if (typeof broadcastAccountUpdate === 'function') {
    try {
      broadcastAccountUpdate(normOwner);
    } catch {}
  }
}

function addToOwnerRawQueue(owner: string, phone: string, uids: number[]): void {
  const normOwner = owner || 'admin';
  const a = accounts.get(phone);
  if (!a) return;

  const rawQ = getOwnerRawQueue(normOwner);
  const rawSet = new Set(rawQ);
  const verifiedQ = getOwnerVerifiedQueue(normOwner);
  const verifiedSet = new Set(verifiedQ);
  const sentSet = getOwnerSentUsers(normOwner);
  const skippedSet = getOwnerSkippedUsers(normOwner);
  let addedCount = 0;
  const instantVerified: number[] = [];
  const rawPeers = getOwnerPeers(normOwner);

  for (const id of uids) {
    if (!rawSet.has(id) && !verifiedSet.has(id) && !sentSet.has(id) && !skippedSet.has(id)) {
      // Global Verified Cache hit -> Direct promotion to Genuine Queue!
      if (isGlobalVerified(id)) {
        instantVerified.push(id);
        verifiedSet.add(id);
      } else {
        rawQ.push(id);
        rawSet.add(id);
      }
      addedCount++;
    }
  }

  if (instantVerified.length > 0) {
    addToOwnerVerifiedQueue(normOwner, instantVerified);
  }

  if (addedCount > 0) {
    (a as any).daily_extracted_count = ((a as any).daily_extracted_count || 0) + addedCount;
    saveOwnerRawQueue(normOwner, rawQ);
    log(
      phone,
      'DB',
      `📥 Added ${addedCount} listeners (${instantVerified.length > 0 ? instantVerified.length + ' instant-cached -> Genuine | ' : ''}Raw: ${rawQ.length} | Genuine: ${getOwnerVerifiedQueue(normOwner).length})`
    );
  }
}

function claimBatchFromRawQueue(owner: string, phone: string, batchSize: number): number[] {
  const normOwner = owner || 'admin';
  const a = accounts.get(phone);
  // When Live Stream monitoring is active, do NOT feed from raw historical queue!
  // Live stream accounts must exclusively DM fresh participants from the active stream.
  if (a?.live_on) {
    return [];
  }
  const rawQ = getOwnerRawQueue(normOwner);
  const sent = getOwnerSentUsers(normOwner);
  const skipped = getOwnerSkippedUsers(normOwner);
  const verifiedSet = new Set(getOwnerVerifiedQueue(normOwner));
  const peers = getOwnerPeers(normOwner);

  if (!ownerRawReservedUids.has(normOwner)) {
    ownerRawReservedUids.set(normOwner, new Map());
  }
  const reserved = ownerRawReservedUids.get(normOwner)!;

  // Release old reservations for this phone
  for (const [rUid, rPhone] of reserved.entries()) {
    if (rPhone === phone) {
      reserved.delete(rUid);
    }
  }

  const instantPromoted: number[] = [];
  for (const uid of rawQ) {
    if (!sent.has(uid) && !skipped.has(uid) && !verifiedSet.has(uid) && isGlobalVerified(uid)) {
      instantPromoted.push(uid);
      if (instantPromoted.length >= batchSize) break;
    }
  }
  if (instantPromoted.length > 0) {
    addToOwnerVerifiedQueue(normOwner, instantPromoted);
    for (const uid of instantPromoted) {
      removeFromOwnerRawQueue(normOwner, uid);
    }
    // Update verifiedSet with newly promoted users
    for (const uid of instantPromoted) verifiedSet.add(uid);
  }

  // Two-tiered candidate selection:
  // When reject_usernames is enabled, accounts WITHOUT username are prioritized first!
  const withUsername: number[] = [];
  const withoutUsername: number[] = [];

  for (const uid of rawQ) {
    if (!sent.has(uid) && !skipped.has(uid) && !verifiedSet.has(uid) && !reserved.has(uid)) {
      const pInfo = peers.get(String(uid)) || findPeerInfoAnywhere(String(uid), normOwner);
      // Strict individual filtering: Each account only filters its own extracted candidates
      if (pInfo?.sourcePhone && pInfo.sourcePhone !== phone) {
        continue;
      }
      const hasUsername = Boolean(pInfo && pInfo.username && String(pInfo.username).trim().length > 0);
      if (hasUsername) {
        withUsername.push(uid);
      } else {
        withoutUsername.push(uid);
      }
    }
  }

  const prioritizedCandidates = (globalAiConfig.reject_usernames !== false)
    ? [...withoutUsername, ...withUsername]
    : [...withUsername, ...withoutUsername];

  const batch: number[] = [];
  for (const uid of prioritizedCandidates) {
    if (batch.length >= batchSize) break;
    reserved.set(uid, phone);
    batch.push(uid);
  }
  return batch;
}

function releaseOwnerRawReservation(owner: string, uid: number): void {
  const normOwner = owner || 'admin';
  const reserved = ownerRawReservedUids.get(normOwner);
  if (reserved) reserved.delete(uid);
}

function removeFromOwnerRawQueue(owner: string, uid: number): void {
  const normOwner = owner || 'admin';
  const rawQ = getOwnerRawQueue(normOwner);
  const nextQ = rawQ.filter((id) => id !== uid);
  saveOwnerRawQueue(normOwner, nextQ);
  releaseOwnerRawReservation(normOwner, uid);
}

