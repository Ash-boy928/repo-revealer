// ---------------- USER BULK ACTIONS (All Start, All Stop, All DM, All Live) ----------------
app.post('/api/user/bulk-action', async (req: any, res: any) => {
  const eff = getEffectiveUser(req);
  const action = String(req.body?.action || '').trim().toLowerCase();
  if (!action) return res.status(400).json({ msg: 'Action is required' });

  const userAccs = Array.from(accounts.values()).filter(a => (a.owner || 'admin') === eff);
  if (userAccs.length === 0) {
    return res.json({ success: true, count: 0, msg: 'No accounts registered under your profile.' });
  }

  let count = 0;
  if (action === 'start-all') {
    const toStart = userAccs.filter(a => !a.running);
    if (toStart.length === 0) {
      return res.json({ success: true, count: 0, msg: 'All accounts are already running.' });
    }

    // Instantly mark all as queued in memory and notify UI
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
    broadcastAccountUpdate(eff);

    // Staggered background runner: 2-second gap between each bot launch!
    (async () => {
      for (let i = 0; i < toStart.length; i++) {
        const a = toStart[i];
        if (i > 0) {
          log(a.phone, 'INFO', `⏳ [STAGGERED BOOT] Waiting 2s before starting bot #${i + 1}/${toStart.length} (${a.phone})...`);
          await new Promise((r) => setTimeout(r, 2000));
        }
        if (a.running && a.abortController && !a.abortController.signal.aborted) {
          const effCfg = getEffectiveConfig(a);
          const hasCustomDm = Boolean(
            effCfg.message_1?.trim() || effCfg.message_2?.trim() || effCfg.message_3?.trim() || effCfg.message?.trim()
          );
          if (!hasCustomDm) {
            log(a.phone, 'INFO', 'ℹ️ [DYNAMIC DM MODE] 3 DM boxes empty: Auto-Dynamic DM active.');
          }
          a.status = 'Starting... sending OTP';
          log(a.phone, 'INFO', `🚀 [STAGGERED BOOT] Launching bot worker #${i + 1}/${toStart.length} (${a.phone})...`);
          launchBotWorker(a.phone, a.abortController);
          broadcastAccountUpdate(eff);
        }
      }
    })().catch((err) => {
      console.error('[USER STAGGERED START ERROR]:', err);
    });

    return res.json({
      success: true,
      count: toStart.length,
      msg: `🚀 Staggered start dispatched for ${toStart.length} account(s) with 2-second gap between each!`
    });
  } else if (action === 'stop-all') {
    for (const a of userAccs) {
      if (a.running) {
        a.running = false;
        (a as any).persisted_running = false;
        if (a.abortController) a.abortController.abort();
        a.status = 'Stopping...';
        const pending = pendingAuthMap.get(a.phone);
        if (pending) {
          if (pending.otpReject) pending.otpReject(new Error('Stopped by user bulk action'));
          if (pending.twoFaReject) pending.twoFaReject(new Error('Stopped by user bulk action'));
          pendingAuthMap.delete(a.phone);
        }
        count++;
      }
    }
    saveAccountsLocal();
    broadcastAccountUpdate(eff);
    return res.json({ success: true, count, msg: `⏹️ Stop signal dispatched to ${count} running account(s)!` });
  } else if (action === 'dm-on') {
    for (const a of userAccs) {
      a.dm_on = true;
      delete (a as any).dm_rest_until;
      (a as any).peer_flood_consecutive = 0;
      log(a.phone, 'INFO', 'DM turned ON via Bulk Controls');
      count++;
    }
    saveAccountsJson();
    broadcastAccountUpdate(eff);
    return res.json({ success: true, count, msg: `✉️ Direct Messaging enabled for all ${count} account(s)!` });
  } else if (action === 'dm-off') {
    for (const a of userAccs) {
      a.dm_on = false;
      log(a.phone, 'INFO', 'DM turned OFF via Bulk Controls');
      count++;
    }
    saveAccountsJson();
    broadcastAccountUpdate(eff);
    return res.json({ success: true, count, msg: `✉️ Direct Messaging paused for all ${count} account(s)!` });
  } else if (action === 'live-on') {
    for (const a of userAccs) {
      a.live_on = true;
      log(a.phone, 'INFO', 'Live Stream Monitoring turned ON via Bulk Controls');
      count++;
    }
    saveAccountsJson();
    broadcastAccountUpdate(eff);
    return res.json({ success: true, count, msg: `🎙️ Live Stream Monitoring enabled for all ${count} account(s)!` });
  } else if (action === 'live-off') {
    for (const a of userAccs) {
      a.live_on = false;
      log(a.phone, 'INFO', 'Live Stream Monitoring turned OFF via Bulk Controls');
      count++;
    }
    saveAccountsJson();
    broadcastAccountUpdate(eff);
    return res.json({ success: true, count, msg: `🎙️ Live Stream Monitoring paused for all ${count} account(s)!` });
  }

  return res.status(400).json({ msg: `Unsupported action: ${action}` });
});

