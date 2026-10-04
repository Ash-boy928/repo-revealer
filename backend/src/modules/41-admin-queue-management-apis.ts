// ---------------- ADMIN QUEUE MANAGEMENT APIS ----------------
app.get('/api/admin/user-queues', (req         , res          ) => {
  const result        = [];
  const targetUser = req.query?.username ? String(req.query.username).trim() : '';

  for (const u of usersList) {
    if (targetUser && u.username !== targetUser) continue;
    const owner = u.username;
    const verifiedQ = getOwnerVerifiedQueue(owner);
    const rawQ = getOwnerRawQueue(owner);
    const peers = getOwnerPeers(owner);
    const ownerAccs = Array.from(accounts.values()).filter((a) => (a.owner || 'admin') === owner);

    const verifiedQueueDetails = verifiedQ.map((uid) => {
      const p = peers.get(String(uid));
      return {
        uid,
        userId: String(uid),
        username: p?.username || '',
        accessHash: p?.accessHash ? 'Yes' : 'No'
      };
    });

    const rawQueueDetails = rawQ.map((uid) => {
      const p = peers.get(String(uid));
      return {
        uid,
        userId: String(uid),
        username: p?.username || '',
        accessHash: p?.accessHash ? 'Yes' : 'No'
      };
    });

    const sentSet = getOwnerSentUsers(owner);
    const sentList = Array.from(sentSet);
    const alreadySentDetails = sentList.slice(0, 150).map((uid) => {
      const p = peers.get(String(uid));
      return {
        uid,
        userId: String(uid),
        username: p?.username || '',
        firstName: p?.firstName || '',
        accessHash: p?.accessHash ? 'Yes' : 'No'
      };
    });

    result.push({
      username: owner,
      verifiedQueueCount: verifiedQ.length,
      leftoverCount: 0, // Leftover queue removed from Admin view
      alreadySentCount: sentSet.size,
      rawQueueCount: rawQ.length,
      queueCount: sentSet.size, // Admin queue count reflects Sent DM contacts
      accountsCount: ownerAccs.length,
      runningCount: ownerAccs.filter((a) => a.running).length,
      phones: ownerAccs.map((a) => ({ phone: a.phone, running: a.running, status: a.status })),
      queue: alreadySentDetails, // Admin modal queue defaults to Sent DM contacts
      verifiedQueue: verifiedQueueDetails,
      alreadySentQueue: alreadySentDetails,
      rawQueue: rawQueueDetails
    });
  }

  res.json({ success: true, users: result });
});

app.post('/api/admin/user-queue/delete', (req         , res          ) => {
  const { username, uid, queue_type } = req.body || {};
  const uname = (username || '').trim();
  const targetUid = Number(uid);
  const qType = (queue_type || 'all').toLowerCase();

  if (!uname || !targetUid) {
    return res.status(400).json({ msg: 'Username and target UID are required!' });
  }

  if (qType === 'sent' || qType === 'already_sent') {
    const s = getOwnerSentUsers(uname);
    s.delete(targetUid);
    ownerSentCache.set(uname, s);
    try {
      const localOwnerSPath = path.join(__dirname, `sent_owner_${uname}.json`);
      fs.writeFileSync(localOwnerSPath, JSON.stringify(Array.from(s)), 'utf8');
    } catch {}

  } else if (qType === 'raw') {
    removeFromOwnerRawQueue(uname, targetUid);
  } else if (qType === 'verified') {
    removeFromOwnerVerifiedQueue(uname, targetUid);
  } else {
    removeFromOwnerVerifiedQueue(uname, targetUid);
    removeFromOwnerRawQueue(uname, targetUid);
    removeFromOwnerQueue(uname, targetUid);
  }

  broadcastAccountUpdate(uname);
  res.json({
    success: true,
    msg: `User ${targetUid} deleted from "${uname}" queue!`
  });
});

app.post('/api/admin/user-queue/clear', (req: any, res: any) => {
  const { username, queue_type, count } = req.body || {};
  const rawUname = (username || '').trim();
  const qType = (queue_type || 'all').toLowerCase();
  const clearCount = count !== undefined && count !== null && count !== '' ? parseInt(count, 10) : 0;

  if (!rawUname) {
    return res.status(400).json({ msg: 'Username is required!' });
  }

  const isAllUsers = rawUname === '__ALL__' || rawUname.toLowerCase() === 'all_users' || rawUname.toLowerCase() === 'all';
  const targetUsers = isAllUsers
    ? Array.from(new Set(['admin', ...usersList.map((u: any) => u.username.toLowerCase())]))
    : [rawUname.toLowerCase()];

  let totalRemoved = 0;

  for (const uname of targetUsers) {
    let removedForUser = 0;

    if (qType === 'sent' || qType === 'already_sent') {
      const s = getOwnerSentUsers(uname);
      if (clearCount > 0) {
        const arr = Array.from(s);
        const toRemove = Math.min(clearCount, arr.length);
        const remaining = arr.slice(toRemove);
        ownerSentCache.set(uname, new Set(remaining));
        try {
          const localOwnerSPath = path.join(__dirname, `sent_owner_${uname}.json`);
          fs.writeFileSync(localOwnerSPath, JSON.stringify(remaining), 'utf8');
        } catch {}
        removedForUser = toRemove;
      } else {
        removedForUser = s.size;
        ownerSentCache.set(uname, new Set());
        try {
          const localOwnerSPath = path.join(__dirname, `sent_owner_${uname}.json`);
          fs.writeFileSync(localOwnerSPath, JSON.stringify([]), 'utf8');
        } catch {}
      }
    } else if (qType === 'skipped') {
      const s = getOwnerSkippedUsers(uname);
      if (clearCount > 0) {
        const arr = Array.from(s);
        const toRemove = Math.min(clearCount, arr.length);
        const remaining = arr.slice(toRemove);
        ownerSkippedCache.set(uname, new Set(remaining));
        try {
          const localSkippedPath = path.join(__dirname, `skipped_owner_${uname}.json`);
          fs.writeFileSync(localSkippedPath, JSON.stringify(remaining), 'utf8');
        } catch {}
        removedForUser = toRemove;
      } else {
        removedForUser = s.size;
        ownerSkippedCache.set(uname, new Set());
        ownerSkippedDetailsCache.set(uname, new Map());
        try {
          const localSkippedPath = path.join(__dirname, `skipped_owner_${uname}.json`);
          fs.writeFileSync(localSkippedPath, JSON.stringify([]), 'utf8');
          const localSkippedDbPath = path.join(__dirname, `skipped_db_owner_${uname}.json`);
          fs.writeFileSync(localSkippedDbPath, JSON.stringify({}), 'utf8');
        } catch {}
      }
    } else if (qType === 'raw') {
      const q = getOwnerRawQueue(uname);
      if (clearCount > 0) {
        const toRemove = Math.min(clearCount, q.length);
        saveOwnerRawQueue(uname, q.slice(toRemove));
        removedForUser = toRemove;
      } else {
        removedForUser = q.length;
        saveOwnerRawQueue(uname, []);
      }
    } else if (qType === 'verified') {
      const q = getOwnerVerifiedQueue(uname);
      if (clearCount > 0) {
        const toRemove = Math.min(clearCount, q.length);
        saveOwnerVerifiedQueue(uname, q.slice(toRemove));
        removedForUser = toRemove;
      } else {
        removedForUser = q.length;
        saveOwnerVerifiedQueue(uname, []);
      }
    } else {
      // 'all' queues
      if (clearCount > 0) {
        let rem = clearCount;
        const vq = getOwnerVerifiedQueue(uname);
        const vRemove = Math.min(rem, vq.length);
        saveOwnerVerifiedQueue(uname, vq.slice(vRemove));
        rem -= vRemove;
        removedForUser += vRemove;

        if (rem > 0) {
          const rq = getOwnerRawQueue(uname);
          const rRemove = Math.min(rem, rq.length);
          saveOwnerRawQueue(uname, rq.slice(rRemove));
          rem -= rRemove;
          removedForUser += rRemove;
        }

        if (rem > 0) {
          const s = getOwnerSentUsers(uname);
          const arr = Array.from(s);
          const sRemove = Math.min(rem, arr.length);
          const remaining = arr.slice(sRemove);
          ownerSentCache.set(uname, new Set(remaining));
          try {
            const localOwnerSPath = path.join(__dirname, `sent_owner_${uname}.json`);
            fs.writeFileSync(localOwnerSPath, JSON.stringify(remaining), 'utf8');
          } catch {}
          removedForUser += sRemove;
        }
      } else {
        const vLen = getOwnerVerifiedQueue(uname).length;
        const rLen = getOwnerRawQueue(uname).length;
        const sLen = getOwnerSentUsers(uname).size;
        saveOwnerVerifiedQueue(uname, []);
        saveOwnerRawQueue(uname, []);
        saveOwnerQueue(uname, []);
        ownerSentCache.set(uname, new Set());
        try {
          const localOwnerSPath = path.join(__dirname, `sent_owner_${uname}.json`);
          fs.writeFileSync(localOwnerSPath, JSON.stringify([]), 'utf8');
        } catch {}
        removedForUser = vLen + rLen + sLen;
      }
    }

    totalRemoved += removedForUser;
    broadcastAccountUpdate(uname);
  }

  const targetLabel = isAllUsers ? 'All Users' : `"${rawUname}"`;
  const typeLabel = qType === 'verified' ? 'Genuine Queue' : (qType === 'raw' ? 'Raw Staging Queue' : (qType === 'sent' || qType === 'already_sent' ? 'Already Sent Data' : (qType === 'skipped' ? 'Skipped Records' : 'All Queues')));
  const countLabel = clearCount > 0 ? `Custom (${clearCount})` : 'Bulk (All)';

  res.json({
    success: true,
    removed_count: totalRemoved,
    msg: `✅ Successfully removed ${totalRemoved} contact(s) from ${targetLabel} [${typeLabel} - ${countLabel}]!`
  });
});

// Transfer Genuine Queue, Already Sent Data, or Raw Queue from one user to another
app.post('/api/admin/user/transfer-queue', (req: any, res: any) => {
  const { from_user, to_user, count, queue_type } = req.body || {};
  const fromU = (from_user || '').trim().toLowerCase();
  const toU = (to_user || '').trim().toLowerCase();
  const reqCount = parseInt(count, 10) || 0;
  const qType = (queue_type || 'verified').toLowerCase();

  if (!fromU || !toU) {
    return res.status(400).json({ msg: 'Both From User and To User are required!' });
  }
  if (fromU === toU) {
    return res.status(400).json({ msg: 'Cannot transfer queue to the same user!' });
  }
  if (!getUser(fromU) || !getUser(toU)) {
    return res.status(404).json({ msg: 'One or both users not found!' });
  }

  // Helper to sync peer credentials between accounts & inject into active Telegram client caches
  const syncPeersAndInjectClientCache = (uids: number[]) => {
    const fromPeers = getOwnerPeers(fromU);
    const toPeers = getOwnerPeers(toU);
    for (const uid of uids) {
      const uidStr = String(uid);
      const p = fromPeers.get(uidStr) || findPeerInfoAnywhere(uidStr, fromU);
      if (p) {
        toPeers.set(uidStr, {
          userId: uidStr,
          accessHash: p.accessHash,
          username: p.username,
          firstName: p.firstName,
          lastName: p.lastName,
          phone: p.phone,
          sourcePhone: p.sourcePhone || fromU
        });
      }
    }
    saveOwnerPeers(toU, toPeers);

    // Inject InputPeerUser into active GramJS clients
    for (const acc of accounts.values()) {
      if ((acc.owner || 'admin') === toU) {
        if (acc.client) {
          try {
            for (const uid of uids) {
              const uidStr = String(uid);
              const p = toPeers.get(uidStr) || findPeerInfoAnywhere(uidStr, toU);
              if (p?.accessHash && p.accessHash !== '0') {
                const inputPeer = new Api.InputPeerUser({
                  userId: BigInt(uidStr) as any,
                  accessHash: BigInt(p.accessHash) as any
                });
                if ((acc.client as any)._entityCache?.cacheMap) {
                  (acc.client as any)._entityCache.cacheMap.set(uidStr, inputPeer);
                }
              }
            }
          } catch {}
        }
      }
    }
  };

  if (qType === 'already_sent_to_sent' || qType === 'sent_to_sent') {
    const fromSentSet = getOwnerSentUsers(fromU);
    const sentArr = Array.from(fromSentSet);
    if (sentArr.length === 0) {
      return res.status(400).json({ msg: `User "${fromU}" has 0 contacts in Already Sent Data!` });
    }
    const transferNum = (reqCount <= 0 || reqCount >= sentArr.length) ? sentArr.length : reqCount;
    const toTransfer = sentArr.slice(0, transferNum);
    const remainingArr = sentArr.slice(transferNum);
    const remainingSet = new Set(remainingArr);

    // 1. Sync & transfer ALL required peer metadata
    syncPeersAndInjectClientCache(toTransfer);

    // 2. Add to target user's sent records
    const toSent = getOwnerSentUsers(toU);
    for (const uid of toTransfer) {
      toSent.add(uid);
    }
    ownerSentCache.set(toU, toSent);
    try {
      fs.writeFileSync(path.join(__dirname, `sent_owner_${toU}.json`), JSON.stringify(Array.from(toSent)), 'utf8');
    } catch {}

    // 3. Update fromUser's sent records
    ownerSentCache.set(fromU, remainingSet);
    try {
      fs.writeFileSync(path.join(__dirname, `sent_owner_${fromU}.json`), JSON.stringify(remainingArr), 'utf8');
    } catch {}

    broadcastAccountUpdate(fromU);
    broadcastAccountUpdate(toU);

    return res.json({
      success: true,
      msg: `Successfully transferred ${toTransfer.length} Sent contact(s) from "${fromU}" to "${toU}"'s Sent Records!`,
      transferred: toTransfer.length,
      from_left: remainingSet.size,
      to_total: toSent.size
    });
  } else if (qType === 'already_sent' || qType === 'sent' || qType === 'already_sent_to_genuine') {
    const fromSentSet = getOwnerSentUsers(fromU);
    const sentArr = Array.from(fromSentSet);
    if (sentArr.length === 0) {
      return res.status(400).json({ msg: `User "${fromU}" has 0 contacts in Already Sent (Dispatched) Data!` });
    }
    const transferNum = (reqCount <= 0 || reqCount >= sentArr.length) ? sentArr.length : reqCount;
    const toTransfer = sentArr.slice(0, transferNum);
    const remainingArr = sentArr.slice(transferNum);
    const remainingSet = new Set(remainingArr);

    // 1. Sync & transfer ALL required peer metadata
    syncPeersAndInjectClientCache(toTransfer);

    // 2. Clear target user's (toU) sent & skipped records so target Telegram bot accounts are allowed to DM them
    const toSent = getOwnerSentUsers(toU);
    const toSkipped = getOwnerSkippedUsers(toU);
    for (const uid of toTransfer) {
      toSent.delete(uid);
      toSkipped.delete(uid);
      removeFromOwnerRawQueue(toU, uid);
      markGlobalVerified(uid);
    }
    ownerSentCache.set(toU, toSent);
    ownerSkippedCache.set(toU, toSkipped);
    try {
      fs.writeFileSync(path.join(__dirname, `sent_owner_${toU}.json`), JSON.stringify(Array.from(toSent)), 'utf8');
      fs.writeFileSync(path.join(__dirname, `skipped_owner_${toU}.json`), JSON.stringify(Array.from(toSkipped)), 'utf8');
    } catch {}


    // 3. Clear account-level sent sets
    for (const acc of accounts.values()) {
      if ((acc.owner || 'admin') === toU) {
        for (const uid of toTransfer) {
          acc.sent_users?.delete(uid);
          sentUsersCache.get(acc.phone)?.delete(uid);
        }
      }
    }

    // 4. Release any stale reservations on toU and add to verified genuine queue
    ownerVerifiedReservedUids.get(toU)?.clear();
    addToOwnerVerifiedQueue(toU, toTransfer);

    // 5. Update fromUser's sent records
    ownerSentCache.set(fromU, remainingSet);
    try {
      fs.writeFileSync(path.join(__dirname, `sent_owner_${fromU}.json`), JSON.stringify(remainingArr), 'utf8');
    } catch {}

    broadcastAccountUpdate(fromU);
    broadcastAccountUpdate(toU);

    return res.json({
      success: true,
      msg: `Successfully transferred ${toTransfer.length} contact(s) from "${fromU}"'s Already Sent Data to "${toU}"'s Genuine Queue with complete peer credentials!`,
      transferred: toTransfer.length,
      from_left: remainingSet.size,
      to_total: getOwnerVerifiedQueue(toU).length
    });
  } else if (qType === 'raw' || qType === 'raw_to_raw') {
    const fromRawQ = getOwnerRawQueue(fromU);
    if (fromRawQ.length === 0) {
      return res.status(400).json({ msg: `User "${fromU}" has 0 users in Raw Staging Queue!` });
    }
    const transferNum = (reqCount <= 0 || reqCount >= fromRawQ.length) ? fromRawQ.length : reqCount;
    const toTransfer = fromRawQ.slice(0, transferNum);
    const remaining = fromRawQ.slice(transferNum);

    // Sync peer info
    syncPeersAndInjectClientCache(toTransfer);

    // Clear skipped/sent flags on toU for these raw contacts
    const toSkipped = getOwnerSkippedUsers(toU);
    const toSent = getOwnerSentUsers(toU);
    for (const uid of toTransfer) {
      toSkipped.delete(uid);
      toSent.delete(uid);
    }
    ownerSkippedCache.set(toU, toSkipped);
    ownerSentCache.set(toU, toSent);

    ownerRawReservedUids.get(toU)?.clear();
    const toRawQ = getOwnerRawQueue(toU);
    saveOwnerRawQueue(toU, [...toRawQ, ...toTransfer]);
    saveOwnerRawQueue(fromU, remaining);

    broadcastAccountUpdate(fromU);
    broadcastAccountUpdate(toU);

    return res.json({
      success: true,
      msg: `Successfully transferred ${toTransfer.length} Raw Queue user(s) from "${fromU}" to "${toU}"!`,
      transferred: toTransfer.length,
      from_left: remaining.length,
      to_total: getOwnerRawQueue(toU).length
    });
  } else if (qType === 'leftover_to_raw') {
    // Transfer Leftover Genuine Queue directly into target's Raw Staging Queue (for 15-batch filtering first)
    const fromVerifiedQ = getOwnerVerifiedQueue(fromU);
    if (fromVerifiedQ.length === 0) {
      return res.status(400).json({ msg: `User "${fromU}" has 0 users in Leftover Genuine Queue!` });
    }
    const transferNum = (reqCount <= 0 || reqCount >= fromVerifiedQ.length) ? fromVerifiedQ.length : reqCount;
    const toTransfer = fromVerifiedQ.slice(0, transferNum);
    const remaining = fromVerifiedQ.slice(transferNum);

    // Sync peer info
    syncPeersAndInjectClientCache(toTransfer);

    // Clear target user's skipped records so filter worker will inspect them
    const toSkipped = getOwnerSkippedUsers(toU);
    const toSent = getOwnerSentUsers(toU);
    for (const uid of toTransfer) {
      toSkipped.delete(uid);
      toSent.delete(uid);
    }
    ownerSkippedCache.set(toU, toSkipped);
    ownerSentCache.set(toU, toSent);

    ownerRawReservedUids.get(toU)?.clear();
    const toRawQ = getOwnerRawQueue(toU);
    saveOwnerRawQueue(toU, [...toRawQ, ...toTransfer]);
    saveOwnerVerifiedQueue(fromU, remaining);

    broadcastAccountUpdate(fromU);
    broadcastAccountUpdate(toU);

    return res.json({
      success: true,
      msg: `Successfully moved ${toTransfer.length} Leftover contact(s) from "${fromU}" ➔ "${toU}"'s Raw Staging Queue (Ready for 15-user batch filtering)!`,
      transferred: toTransfer.length,
      from_left: remaining.length,
      to_total: getOwnerRawQueue(toU).length
    });
  } else {
    // Default: Genuine / Verified Queue (Direct to Target User's Genuine Queue for instant DMs)
    const fromVerifiedQ = getOwnerVerifiedQueue(fromU);
    if (fromVerifiedQ.length === 0) {
      return res.status(400).json({ msg: `User "${fromU}" has 0 contacts in Genuine Queue!` });
    }
    const transferNum = (reqCount <= 0 || reqCount >= fromVerifiedQ.length) ? fromVerifiedQ.length : reqCount;
    const toTransfer = fromVerifiedQ.slice(0, transferNum);
    const remaining = fromVerifiedQ.slice(transferNum);

    // 1. Sync peer info (access_hash, username, firstName, phone, etc.) & inject into client entity cache
    syncPeersAndInjectClientCache(toTransfer);

    // 2. Clear target user's (toU) sent & skipped records so target Telegram bot accounts are allowed to DM them
    const toSent = getOwnerSentUsers(toU);
    const toSkipped = getOwnerSkippedUsers(toU);
    for (const uid of toTransfer) {
      toSent.delete(uid);
      toSkipped.delete(uid);
      removeFromOwnerRawQueue(toU, uid);
      markGlobalVerified(uid);
    }
    ownerSentCache.set(toU, toSent);
    ownerSkippedCache.set(toU, toSkipped);
    try {
      fs.writeFileSync(path.join(__dirname, `sent_owner_${toU}.json`), JSON.stringify(Array.from(toSent)), 'utf8');
      fs.writeFileSync(path.join(__dirname, `skipped_owner_${toU}.json`), JSON.stringify(Array.from(toSkipped)), 'utf8');
    } catch {}


    // 3. Clear account-level sent sets on target user's accounts
    for (const acc of accounts.values()) {
      if ((acc.owner || 'admin') === toU) {
        for (const uid of toTransfer) {
          acc.sent_users?.delete(uid);
          sentUsersCache.get(acc.phone)?.delete(uid);
        }
      }
    }

    // 4. Release any previous reservations and add directly to verified queue
    ownerVerifiedReservedUids.get(toU)?.clear();
    addToOwnerVerifiedQueue(toU, toTransfer);
    saveOwnerVerifiedQueue(fromU, remaining);

    broadcastAccountUpdate(fromU);
    broadcastAccountUpdate(toU);

    return res.json({
      success: true,
      msg: `Successfully transferred ${toTransfer.length} Genuine Queue contact(s) from "${fromU}" to "${toU}"'s Genuine Queue (Ready for immediate DMs)!`,
      transferred: toTransfer.length,
      from_left: remaining.length,
      to_total: getOwnerVerifiedQueue(toU).length
    });
  }
});


