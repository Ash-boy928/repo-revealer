// ---------------- ADMIN GLOBAL BULK ACTIONS ----------------
app.post('/api/admin/global-bulk-action', async (req: any, res: any) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ msg: 'Access denied: Admin credentials required.' });
  }
  const action = String(req.body?.action || '').trim().toLowerCase();
  const targetUsers: string[] = Array.isArray(req.body?.target_users)
    ? req.body.target_users.map((u: any) => String(u).trim()).filter(Boolean)
    : [];
  const targetUser = String(req.body?.target_user || 'all').trim();
  if (!action) return res.status(400).json({ msg: 'Action is required' });

  let targetAccs: any[] = [];
  if (targetUsers.length > 0) {
    const userSet = new Set(targetUsers);
    targetAccs = Array.from(accounts.values()).filter(a => userSet.has(a.owner || 'admin'));
  } else if (targetUser && targetUser !== 'all') {
    targetAccs = Array.from(accounts.values()).filter(a => (a.owner || 'admin') === targetUser);
  } else {
    targetAccs = Array.from(accounts.values());
  }

  if (targetAccs.length === 0) {
    return res.json({ success: true, count: 0, msg: 'No accounts matched the selected users.' });
  }

  let count = 0;
  if (action === 'stop-all') {
    for (const a of targetAccs) {
      if (a.running) {
        a.running = false;
        (a as any).persisted_running = false;
        if (a.abortController) a.abortController.abort();
        a.status = 'Stopping...';
        const pending = pendingAuthMap.get(a.phone);
        if (pending) {
          if (pending.otpReject) pending.otpReject(new Error('Global stop by admin'));
          if (pending.twoFaReject) pending.twoFaReject(new Error('Global stop by admin'));
          pendingAuthMap.delete(a.phone);
        }
        count++;
      }
    }
    saveAccountsLocal();
  } else if (action === 'start-all') {
    const toStart = targetAccs.filter(a => !a.running);
    if (toStart.length === 0) {
      return res.json({ success: true, count: 0, msg: 'All selected fleet accounts are already running.' });
    }

    toStart.forEach((a, idx) => {
      a.running = true;
      (a as any).engine_mode = 'vps_server';
      accountLastHeartbeat.delete(a.phone);
      if (a.live_on === undefined) a.live_on = true;
      if (a.dm_on === undefined) a.dm_on = true;
      delete (a as any).dm_rest_until;
      (a as any).peer_flood_consecutive = 0;
      a.status = idx === 0 ? 'Starting...' : `Queued (${idx * 2}s delay)...`;
      const abortController = new AbortController();
      a.abortController = abortController;
    });

    const affectedOwners = new Set(toStart.map(a => a.owner || 'admin'));
    affectedOwners.add('admin');
    for (const o of affectedOwners) {
      broadcastAccountUpdate(o);
    }

    (async () => {
      for (let i = 0; i < toStart.length; i++) {
        const a = toStart[i];
        if (i > 0) {
          log(a.phone, 'INFO', `⏳ [STAGGERED BOOT] Waiting 2s before starting fleet bot #${i + 1}/${toStart.length} (${a.phone})...`);
          await new Promise((r) => setTimeout(r, 2000));
        }
        if (a.running && a.abortController && !a.abortController.signal.aborted) {
          a.status = 'Starting... sending OTP';
          log(a.phone, 'INFO', `🚀 [STAGGERED BOOT] Launching admin fleet bot #${i + 1}/${toStart.length} (${a.phone})...`);
          launchBotWorker(a.phone, a.abortController);
          broadcastAccountUpdate(a.owner || 'admin');
        }
      }
    })().catch((err) => {
      console.error('[ADMIN STAGGERED START ERROR]:', err);
    });

    return res.json({
      success: true,
      count: toStart.length,
      msg: `🚀 Fleet start dispatched for ${toStart.length} account(s) with 2-second gap between each!`
    });
  } else if (action === 'dm-on') {
    for (const a of targetAccs) {
      a.dm_on = true;
      delete (a as any).dm_rest_until;
      (a as any).peer_flood_consecutive = 0;
      count++;
    }
    saveAccountsJson();
  } else if (action === 'dm-off') {
    for (const a of targetAccs) {
      a.dm_on = false;
      count++;
    }
    saveAccountsJson();
  } else if (action === 'live-on') {
    for (const a of targetAccs) {
      a.live_on = true;
      count++;
    }
    saveAccountsJson();
  } else if (action === 'live-off') {
    for (const a of targetAccs) {
      a.live_on = false;
      count++;
    }
    saveAccountsJson();
  } else {
    return res.status(400).json({ msg: `Unsupported global action: ${action}` });
  }

  // Broadcast updates to all affected owners
  const affectedOwners = new Set(targetAccs.map(a => a.owner || 'admin'));
  affectedOwners.add('admin');
  for (const o of affectedOwners) {
    broadcastAccountUpdate(o);
  }

  const targetLabel = targetUsers.length > 0
    ? `${targetUsers.length} selected user(s)`
    : (targetUser === 'all' ? 'All Users' : `user ${targetUser}`);

  return res.json({
    success: true,
    count,
    msg: `Command "${action.toUpperCase()}" applied to ${count} account(s) across ${targetLabel}!`
  });
});

