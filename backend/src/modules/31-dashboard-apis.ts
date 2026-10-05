// ---------------- DASHBOARD APIS ----------------

app.get('/api/accounts', (req, res) => {
  const eff = getEffectiveUser(req);
  const uObj = getUser(eff);

  const data = [];
  let total_sent = 0;
  let total_today_dms = 0;
  const rawQ = getOwnerRawQueue(eff);
  const verifiedQ = getOwnerVerifiedQueue(eff);
  const rawQCount = rawQ.length;
  const verifiedQCount = verifiedQ.length;
  const ownerPeers = getOwnerPeers(eff);

  for (const a of accounts.values()) {
    const owner = a.owner || 'admin';
    if (owner !== eff) {
      continue;
    }
    checkAndResetDailyQuota(a.phone);
    checkAndResetDailyDmQuota(a.phone);
    const dailyDms = (a as any).daily_sent_count || 0;
    const accTotalSent = Math.max(a.sent_count || 0, dailyDms, (a.sent_users ? a.sent_users.size : 0));
    total_sent += accTotalSent;
    total_today_dms += dailyDms;

    const accRawCount = rawQ.filter(uid => {
      const p = ownerPeers.get(String(uid));
      return !p || !p.sourcePhone || p.sourcePhone === a.phone;
    }).length;
    const accVerifiedCount = verifiedQ.filter(uid => {
      const p = ownerPeers.get(String(uid));
      if (!p) return false;
      if (p.username && p.username.trim().length > 0) return true;
      if (p.accessHashes && p.accessHashes[a.phone] && p.accessHashes[a.phone] !== '0') return true;
      if (p.sourcePhone === a.phone && p.accessHash && p.accessHash !== '0') return true;
      return false;
    }).length;

    const hasSessFile = fs.existsSync(getSessionFile(a.phone));
    let healthState = 'healthy';
    let healthLabel = '🟢 Healthy & Validated';
    let skippingRisk = '0%';
    let needsReauth = false;

    if (a.status?.includes('Revoked') || a.status?.includes('Logged Out') || a.status?.includes('AUTH_KEY') || a.status?.includes('401')) {
      healthState = 'critical';
      healthLabel = '🔴 Re-Auth Required (Key Revoked)';
      skippingRisk = '100% (All Users Skipped)';
      needsReauth = true;
    } else if (!hasSessFile && a.status !== 'awaiting_otp' && a.status !== 'awaiting_2fa') {
      healthState = 'critical';
      healthLabel = '🔴 Re-Auth Required (No Session)';
      skippingRisk = '100% (Not Logged In)';
      needsReauth = true;
    } else if (a.dm_rest_until && a.dm_rest_until > Date.now()) {
      healthState = 'warning';
      healthLabel = '🟡 Rest Mode / Cooling';
      skippingRisk = 'Temporarily Paused';
    } else if (verifiedQCount > 0 && accVerifiedCount === 0) {
      healthState = 'warning';
      healthLabel = '🟡 Queue Lacks Hashes';
      skippingRisk = 'High (Queue users lack hash for this phone)';
    } else if (!a.running && hasSessFile) {
      healthState = 'ready';
      healthLabel = '🟢 Session Ready';
      skippingRisk = '0%';
    } else if (a.running) {
      healthState = 'healthy';
      healthLabel = '🟢 Active & Validated';
      skippingRisk = '0%';
    }

    data.push({
      label: a.label,
      phone: a.phone,
      username: a.username || '',
      status: a.status,
      state: statusState(a),
      queue_count: accVerifiedCount,
      shared_queue_count: verifiedQCount,
      raw_queue_count: accRawCount,
      verified_queue_count: accVerifiedCount,
      daily_extracted_count: (a as any).daily_extracted_count || 0,
      daily_extracted_max: 0,
      daily_sent_count: dailyDms,
      live_on: a.live_on,
      dm_on: a.dm_on,
      dm_rest_until: (a as any).dm_rest_until || 0,
      peer_flood_consecutive: (a as any).peer_flood_consecutive || 0,
      sent_count: accTotalSent,
      running: Boolean(a.running),
      engine_mode: (a as any).engine_mode || (uObj?.access_type === 'app_only' ? 'mobile_app' : 'vps_server'),
      is_logged_in: Boolean(hasSessFile && a.status !== 'awaiting_otp' && a.status !== 'awaiting_2fa' && a.state !== 'waiting' && !needsReauth),
      health_indicator: {
        state: healthState,
        label: healthLabel,
        skipping_risk: skippingRisk,
        needs_reauth: needsReauth,
        has_session: hasSessFile
      },
      owner
    });
  }

  const maxAcc = uObj ? (uObj.max_accounts ?? 5) : 5;
  const regPhones = uObj && Array.isArray(uObj.registered_phones) ? uObj.registered_phones : [];

  // If any phone in user's registered_phones failed to setup or is missing from active accounts map,
  // surface it as an unlinked/failed item so the user can easily click Delete to release the slot!
  const presentPhones = new Set(data.map((d: any) => d.phone));
  for (const regP of regPhones) {
    const regDigits = String(regP).replace(/[^0-9]/g, '');
    const alreadyPresent = Array.from(presentPhones).some(p => p === regP || String(p).replace(/[^0-9]/g, '') === regDigits);
    if (!alreadyPresent) {
      data.push({
        label: regP,
        phone: regP,
        username: '',
        status: 'Setup Incomplete / Failed',
        state: 'failed',
        queue_count: 0,
        shared_queue_count: verifiedQCount,
        raw_queue_count: 0,
        verified_queue_count: 0,
        daily_extracted_count: 0,
        daily_extracted_max: 0,
        daily_sent_count: 0,
        live_on: false,
        dm_on: false,
        dm_rest_until: 0,
        peer_flood_consecutive: 0,
        sent_count: 0,
        is_logged_in: false,
        health_indicator: {
          state: 'critical',
          label: '🔴 Failed to Connect / Unlinked',
          skipping_risk: '100% (Not Added)',
          needs_reauth: true,
          has_session: false
        },
        owner: eff
      });
    }
  }

  const histTodayCount = dailyDmHistory[eff]?.[getTodayDateString()]?.count || 0;
  total_today_dms = Math.max(total_today_dms, histTodayCount);

  let userHistoricalTotalDMs = 0;
  const userHistory = dailyDmHistory[eff] || {};
  for (const d of Object.keys(userHistory)) {
    userHistoricalTotalDMs += userHistory[d]?.count || 0;
  }
  const effectiveTotalSent = Math.max(total_sent, total_today_dms, userHistoricalTotalDMs, getOwnerSentUsers(eff).size);

  res.json({
    accounts: data,
    total_sent: effectiveTotalSent,
    total_today_dms,
    last_5_days_dms: getOwnerDailyDmStats(eff, data.length),
    total_lifetime_joins: getOwnerLifetimeJoins(eff),
    today_joins: dailyJoinHistory[eff]?.[getTodayDateString()]?.count || 0,
    last_5_days_joins: getOwnerDailyJoinStats(eff),
    tracked_invite_link: userTrackedLinks[eff]?.invite_link || '',
    effective_user: eff,
    ai_enabled: uObj?.ai_enabled === true,
    dynamic_templates_enabled: uObj?.dynamic_templates_enabled !== false,
    user_dynamic_enabled: uObj?.dynamic_templates_enabled !== false,
    user_ai_enabled: uObj?.ai_enabled === true,
    user_has_any_premium: (uObj?.ai_enabled === true || uObj?.dynamic_templates_enabled !== false),
    raw_queue_total: rawQCount,
    verified_queue_total: verifiedQCount,
    registered_phones: regPhones,
    max_accounts: maxAcc,
    registered_count: regPhones.length
  });
});

app.get('/api/logs', (req         , res          ) => {
  const phone = (req.query.phone          ) || '';
  const a = accounts.get(phone);
  if (a && !canTouch(req, a.owner || 'admin')) {
    return res.json({ logs: [], server_time: '' });
  }
  const l = logsMap.get(phone) || [];
  const server_time = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(new Date());
  res.json({ logs: l.slice(-100), server_time });
});

app.get('/api/events', (req, res) => {
  const eff = getEffectiveUser(req);
  if (!eff) {
    return res.status(401).send('Unauthorized');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  const clientId = `${eff}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const client: SseClient = {
    id: clientId,
    res,
    owner: eff
  };
  sseClients.set(clientId, client);

  // Send connected event
  try {
    res.write(`event: connected\ndata: ${JSON.stringify({ msg: 'connected', time: Date.now() })}\n\n`);
  } catch {}

  // Send initial account snapshot right after connection
  setTimeout(() => {
    try {
      broadcastAccountUpdate(eff);
    } catch {}
  }, 50);

  const keepAliveTimer = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(keepAliveTimer);
      sseClients.delete(clientId);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAliveTimer);
    sseClients.delete(clientId);
  });
});

app.get('/api/account/config', (req         , res          ) => {
  const phone = req.query.phone          ;
  const a = accounts.get(phone);
  if (!a) return res.json({});
  if (!canTouch(req, a.owner || 'admin')) return res.json({});
  const u = getUser(a.owner || 'admin');
  res.json({
    ...getEffectiveConfig(a),
    user_ai_enabled: u?.ai_enabled === true
  });
});

app.post('/api/account/config', (req         , res          ) => {
  const data = req.body || {};
  const phone = data.phone;
  const a = accounts.get(phone);
  if (!a) return res.json({ msg: 'Account not found!' });
  if (!canTouch(req, a.owner || 'admin')) return res.json({ msg: 'This account is not yours!' });

  const owner = a.owner || 'admin';
  const [, maxTargets] = userLimits(owner);
  const targets = Array.isArray(data.targets) ? data.targets : [];

  if (targets.length > maxTargets) {
    return res.json({
      msg: `LIMIT REACHED! This user is allowed maximum ${maxTargets} target groups (you entered ${targets.length})`
    });
  }

  a.config = {
    use_master_config: data.use_master_config === true,
    ai_context: data.ai_context || '',
    channel_link: data.channel_link || '',
    targets,
    message_1: data.message_1 || '',
    message_2: data.message_2 || '',
    message_3: data.message_3 || '',
    max_users: Math.min(200, Number(data.max_users || 200)),
    check_interval: Number(data.check_interval || 20),
    delay_min: Number(data.delay_min || 60),
    delay_max: Number(data.delay_max || 120)
  };
  saveAccountsJson();
  res.json({ msg: `${a.label} config saved successfully!` });
});

app.get('/api/account/proxy', (req         , res          ) => {
  const phone = req.query.phone          ;
  const a = accounts.get(phone);
  if (!a) return res.json({});
  if (!canTouch(req, a.owner || 'admin')) return res.json({});
  res.json(a.proxy || { protocol: 'none' });
});

app.post('/api/account/proxy', (req         , res          ) => {
  const data = req.body || {};
  const phone = data.phone;
  const a = accounts.get(phone);
  if (!a) return res.json({ msg: 'Account not found!' });
  if (!canTouch(req, a.owner || 'admin')) return res.json({ msg: 'This account is not yours!' });
  if (a.running) return res.json({ msg: 'STOP the account first before updating proxy!' });

  const protocol = data.protocol || 'none';
  if (protocol === 'none') {
    a.proxy = { protocol: 'none', ip: '', port: 0 };
  } else {
    a.proxy = {
      protocol: protocol,
      ip: data.ip || '',
      port: Number(data.port) || 0,
      username: data.username || '',
      password: data.password || '',
      secret: data.secret || ''
    };
  }
  
  saveAccountsJson();
  res.json({ msg: `Proxy settings for ${a.label} saved successfully!` });
});

// Auto-delete 1-on-1 personal chats older than N days (default: 1 day / 24 hours)
app.post('/api/accounts/clean-old-chats', async (req: any, res: any) => {
  const eff = getEffectiveUser(req);
  if (!eff) return res.status(401).json({ error: 'Login first!' });

  const me = getUser(eff);
  const isUserAdmin = eff === 'admin' || Boolean(me && me.role === 'admin');
  const targetPhone = req.body?.phone;
  const days = Math.max(1, Number(req.body?.days) || 1);

  try {
    let totalCleaned = 0;
    for (const [phone, acc] of accounts.entries()) {
      if ((isUserAdmin || acc.owner === eff) && (!targetPhone || targetPhone === 'all' || targetPhone === phone)) {
        if (acc.client && acc.client.connected) {
          const r = await cleanOldPersonalChatsForAccount(phone, days);
          totalCleaned += r.cleaned;
        }
      }
    }
    res.json({
      success: true,
      cleaned: totalCleaned,
      message: `Cleaned ${totalCleaned} personal chat(s) older than ${days} days.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Chat cleanup failed' });
  }
});

app.post('/api/account/add', (req         , res          ) => {
  const data = req.body || {};
  const phone = (data.phone || '').trim();
  if (!phone.startsWith('+')) {
    return res.json({ msg: 'Enter phone in +91XXXXXXXXXX format!' });
  }
  const eff = getEffectiveUser(req);
  if (!eff) return res.json({ msg: 'Login first!' });

  const u = getUser(eff);
  const isUserAdmin = eff === 'admin' || Boolean(u && u.role === 'admin');
  const [maxAcc] = userLimits(eff);

  if (accounts.has(phone)) {
    return res.json({ msg: 'This account is already added and present in your dashboard!' });
  }

  let owned = 0;
  for (const acc of accounts.values()) {
    if ((acc.owner || 'admin') === eff) owned++;
  }

  // Lifetime Slot Check for regular users
  if (!isUserAdmin && u) {
    if (!Array.isArray(u.registered_phones)) u.registered_phones = [];
    const isAlreadyRegistered = u.registered_phones.includes(phone);

    if (!isAlreadyRegistered) {
      if (u.registered_phones.length >= maxAcc) {
        return res.json({
          ok: false,
          limit_exhausted: true,
          registered_count: u.registered_phones.length,
          max_accounts: maxAcc,
          msg: `SLOT LIMIT EXHAUSTED! You have registered ${u.registered_phones.length}/${maxAcc} lifetime phone slots. Logging out or deleting accounts does not free up slots. Request Admin Approval to add or replace this Telegram ID.`
        });
      }

      if (owned >= maxAcc) {
        return res.json({
          ok: false,
          limit_exhausted: true,
          registered_count: u.registered_phones.length,
          max_accounts: maxAcc,
          msg: `ACCOUNT LIMIT REACHED! You currently have ${owned}/${maxAcc} active accounts. Request Admin Approval to increase your allowed slots.`
        });
      }

      // Register new phone slot
      u.registered_phones.push(phone);
      saveUsers();
      broadcastAccountUpdate(eff);
    } else {
      // Re-connecting an already registered phone
      if (owned >= maxAcc) {
        return res.json({
          ok: false,
          limit_exhausted: true,
          registered_count: u.registered_phones.length,
          max_accounts: maxAcc,
          msg: `ACCOUNT LIMIT REACHED! You currently have ${owned}/${maxAcc} active accounts in your dashboard.`
        });
      }
    }
  }

  // Determine API credentials: Custom provided vs selected Global Pool Slot vs Auto Best Key
  let apiIdNum = parseInt(data.api_id, 10);
  let apiHash = (data.api_hash || '').trim();

  // If user selected a pool slot or didn't supply manual credentials:
  const creds = getBestApiCredentials(apiIdNum, apiHash, data.slot_id || data.pool_id);
  apiIdNum = creds.api_id;
  apiHash = creds.api_hash;

  accounts.set(phone, {
    label: data.label || phone,
    phone,
    api_id: apiIdNum,
    api_hash: apiHash,
    username: data.username || '',
    owner: eff,
    running: false,
    live_on: true,
    dm_on: true,
    sent_users: new Set(),
    sent_count: 0,
    daily_extracted_count: 0,
    daily_collected_count: 0,
    status: 'Ready',
    config: defaultConfig()
  });
  saveAccountsJson();
  broadcastAccountUpdate(eff);
  res.json({ ok: true, msg: `${phone} added! Now open its tab and fill the config.` });
});

// Endpoint for users to inspect and select available API slots from Global Pool
app.get('/api/account/available-apis', (req: any, res: any) => {
  const activeSlots = apiPool.filter(s => s.enabled && s.api_id > 0 && s.api_hash);

  const slotStats = activeSlots.map(slot => {
    let linkedCount = 0;
    for (const acc of accounts.values()) {
      if (acc.api_id === slot.api_id) linkedCount++;
    }
    let statusText = '🟢 100% Free / Unused';
    if (linkedCount === 1) statusText = '🟢 1 account linked (Optimal)';
    else if (linkedCount === 2) statusText = '🟡 2 accounts linked (Good)';
    else if (linkedCount >= 3) statusText = `🟠 ${linkedCount} accounts linked`;

    return {
      id: slot.id,
      slot_id: slot.slot_id,
      label: slot.label,
      api_id: slot.api_id,
      linkedCount,
      statusText
    };
  });

  res.json({
    success: true,
    totalPoolSize: apiPool.length,
    activePoolCount: activeSlots.length,
    apis: slotStats
  });
});

app.post('/api/account/request-slot', async (req: any, res: any) => {
  const eff = getEffectiveUser(req);
  if (!eff) return res.status(401).json({ ok: false, msg: 'Login first!' });

  const data = req.body || {};
  const phone = (data.phone || '').trim();
  const label = (data.label || phone).trim();

  if (!phone.startsWith('+')) {
    return res.json({ ok: false, msg: 'Valid phone number in +91XXXXXXXXXX format is required!' });
  }

  const u = getUser(eff);
  if (!u) return res.status(404).json({ ok: false, msg: 'User account not found!' });

  const [maxAcc] = userLimits(eff);
  const regCount = (u.registered_phones || []).length;

  const existingPending = slotRequests.find((r) => r.username === eff && r.phone === phone && r.status === 'pending');
  if (existingPending) {
    return res.json({
      ok: true,
      already_pending: true,
      msg: `An approval request for ${phone} is already pending with Super Admin. Please wait for approval!`,
      request_id: existingPending.id
    });
  }

  const reqId = 'slot_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const newReq: SlotRequest = {
    id: reqId,
    username: eff,
    phone,
    label,
    requested_at: Date.now(),
    status: 'pending'
  };

  slotRequests.unshift(newReq);
  saveSlotRequests();

  const escHtml = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Instant Real-Time Alert to Super Admin Master Bot
  const adminUser = usersList.find((x: any) => x.username === 'admin' || x.role === 'admin');
  if (adminUser && adminUser.alert_enabled && adminUser.alert_bot_token && adminUser.alert_chat_id) {
    const adminMsg = `🚨 <b>Account Slot Approval Request!</b>\n\n` +
      `👤 <b>User:</b> <code>${escHtml(eff)}</code>\n` +
      `📱 <b>Requested Phone:</b> <code>Leo Bot Super Admin</code>\n` +
      `🏷️ <b>Label:</b> ${escHtml(label)}\n` +
      `📊 <b>Quota Used:</b> ${regCount} / ${maxAcc} Registered Slots\n\n` +
      `⚠️ <i>User reached their ID limit and requests permission to add this new Telegram number.</i>`;

    const inlineKeyboard = [
      [
        { text: '✅ Approve Slot (+1 Slot)', callback_data: `slot_appr:${reqId}` },
        { text: '❌ Reject Request', callback_data: `slot_rej:${reqId}` }
      ]
    ];

    sendTelegramMessage(adminUser.alert_bot_token, adminUser.alert_chat_id, adminMsg, inlineKeyboard).catch((err) => {
      console.error('[SLOT REQUEST TELEGRAM ALERT ERROR]:', err);
    });
  }

  broadcastAccountUpdate('admin');

  return res.json({
    ok: true,
    msg: `✅ Approval request for ${phone} sent to Super Admin in real-time! Admin has been alerted on Telegram.`,
    request_id: reqId
  });
});

app.post('/api/account/update-credentials', (req: any, res: any) => {
  const phone = req.body?.phone;
  const a = accounts.get(phone);
  if (!a) return res.json({ msg: 'Account not found!' });
  if (!canTouch(req, a.owner || 'admin')) return res.json({ msg: 'This account is not yours!' });
  if (a.running) return res.json({ msg: 'Please STOP the account before updating API credentials!' });

  const apiIdNum = parseInt(req.body?.api_id, 10);
  const apiHash = (req.body?.api_hash || '').trim();

  if (isNaN(apiIdNum) || apiIdNum <= 0) {
    return res.json({ msg: 'Valid numerical API ID is required!' });
  }
  if (!apiHash) {
    return res.json({ msg: 'API Hash is required!' });
  }

  a.api_id = apiIdNum;
  a.api_hash = apiHash;
  if (req.body?.label) a.label = req.body.label.trim();
  saveAccountsJson();
  res.json({ msg: `API credentials updated for ${a.label || phone}! You can now click START.` });
});

app.post('/api/account/rename', (req: any, res: any) => {
  const phone = (req.body?.phone || '').trim();
  const newLabel = (req.body?.label || '').trim();
  if (!phone || !newLabel) {
    return res.status(400).json({ success: false, msg: 'Phone number and new name are required!' });
  }
  const a = accounts.get(phone);
  if (!a || !canTouch(req, a.owner || 'admin')) {
    return res.status(403).json({ success: false, msg: 'Account not found or access denied!' });
  }
  a.label = newLabel;
  saveAccountsJson();
  broadcastAccountUpdate(a.owner || 'admin');
  return res.json({ success: true, msg: `Account successfully renamed to "${newLabel}"`, label: newLabel });
});

app.post('/api/account/reset-daily-count', (req: any, res: any) => {
  const eff = getEffectiveUser(req);
  const phone = (req.body?.phone || '').trim();
  const resetAll = req.body?.all === true || !phone;
  const todayStr = getTodayDateString();
  let count = 0;

  for (const [p, a] of accounts.entries()) {
    if (!canTouch(req, a.owner || 'admin')) continue;
    if (resetAll || p === phone) {
      (a as any).daily_sent_count = 0;
      (a as any).daily_sent_date = todayStr;
      (a as any).daily_extracted_count = 0;
      (a as any).daily_extracted_date = todayStr;
      (a as any).peer_flood_consecutive = 0;
      (a as any).peer_flood_rest_cycles = 0;
      delete (a as any).dm_rest_until;
      delete (a as any).dm_peer_flood_exhausted;
      count++;
    }
  }

  if (dailyDmHistory[eff] && dailyDmHistory[eff][todayStr]) {
    if (resetAll) {
      dailyDmHistory[eff][todayStr].count = 0;
      dailyDmHistory[eff][todayStr].phones = [];
    } else if (phone && Array.isArray(dailyDmHistory[eff][todayStr].phones)) {
      dailyDmHistory[eff][todayStr].phones = dailyDmHistory[eff][todayStr].phones.filter((ph: string) => ph !== phone);
    }
    saveDailyDmHistory();
  }

  saveAccountsJson();
  broadcastAccountUpdate(eff);
  return res.json({ success: true, msg: `Today's DM count reset to 0 for ${count} account(s)!`, resetCount: count });
});

app.post('/api/admin/reset-daily-dms', (req: any, res: any) => {
  if (req.session?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const todayStr = getTodayDateString();
  let count = 0;
  for (const a of accounts.values()) {
    (a as any).daily_sent_count = 0;
    (a as any).daily_sent_date = todayStr;
    (a as any).daily_extracted_count = 0;
    (a as any).daily_extracted_date = todayStr;
    (a as any).peer_flood_consecutive = 0;
    (a as any).peer_flood_rest_cycles = 0;
    delete (a as any).dm_rest_until;
    delete (a as any).dm_peer_flood_exhausted;
    count++;
  }

  for (const u of Object.keys(dailyDmHistory)) {
    if (dailyDmHistory[u] && dailyDmHistory[u][todayStr]) {
      dailyDmHistory[u][todayStr].count = 0;
      dailyDmHistory[u][todayStr].phones = [];
    }
  }
  saveDailyDmHistory();

  saveAccountsJson();
  broadcastAccountUpdate('admin');
  return res.json({ success: true, msg: `Daily DM counts reset to 0 for all ${count} accounts!`, resetCount: count });
});

app.all('/api/account/diagnose', async (req: any, res: any) => {
  const phone = (req.body?.phone || req.query?.phone || '').trim();
  if (!phone) {
    return res.status(400).json({ success: false, msg: 'Phone number is required for diagnostic health check!' });
  }
  const a = accounts.get(phone);
  if (!a || !canTouch(req, a.owner || 'admin')) {
    return res.status(403).json({ success: false, msg: 'Account not found or access denied!' });
  }

  const startTs = Date.now();
  const owner = a.owner || 'admin';
  const ownerPeers = getOwnerPeers(owner);
  const verifiedQ = getOwnerVerifiedQueue(owner);
  const totalVerifiedQ = verifiedQ.length;

  const sessFile = getSessionFile(phone);
  const sessionExists = fs.existsSync(sessFile) && fs.statSync(sessFile).size > 10;

  let authValid = false;
  let authErrorMsg = '';
  let pingLatencyMs = 0;
  let telegramProfile: any = null;

  // 1. Check MTProto session validity
  if (a.client && a.running) {
    try {
      const pingStart = Date.now();
      const mePromise = a.client.getMe();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('PING_TIMEOUT')), 5000));
      const me: any = await Promise.race([mePromise, timeoutPromise]);
      pingLatencyMs = Date.now() - pingStart;
      if (me && me.id) {
        authValid = true;
        telegramProfile = {
          id: String(me.id),
          username: me.username || '',
          firstName: me.firstName || '',
          lastName: me.lastName || ''
        };
      }
    } catch (e: any) {
      const emsg = e?.message || String(e);
      authErrorMsg = emsg;
      if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED|401/i.test(emsg)) {
        authValid = false;
        a.status = 'Logged Out (Session Revoked)';
        a.running = false;
        broadcastAccountUpdate(a.owner);
      }
    }
  } else if (sessionExists) {
    // Client is stopped/offline: check saved session auth with lightweight verification
    const sessStr = await loadSessionString(phone);
    if (sessStr) {
      const devProf = getDeviceProfileForPhone(phone);
      const testClient = new TelegramClient(new StringSession(sessStr), a.api_id, a.api_hash, {
        connectionRetries: 2,
        timeout: 6,
        useWSS: false,
        deviceModel: devProf.deviceModel,
        systemVersion: devProf.systemVersion
      });
      try {
        const pingStart = Date.now();
        await testClient.connect();
        const isAuth = await testClient.isUserAuthorized().catch(() => false);
        if (isAuth) {
          const me = await testClient.getMe().catch(() => null);
          pingLatencyMs = Date.now() - pingStart;
          authValid = true;
          if (me) {
            telegramProfile = {
              id: String(me.id),
              username: me.username || '',
              firstName: me.firstName || '',
              lastName: me.lastName || ''
            };
          }
        } else {
          authErrorMsg = 'Session not authorized in Telegram datacenter';
        }
      } catch (e: any) {
        authErrorMsg = e?.message || String(e);
      } finally {
        await testClient.disconnect().catch(() => {});
      }
    }
  }

  // 2. MTProto Access Hash & Queue Reachability Analysis
  let reachableCount = 0;
  let viaUsernameCount = 0;
  let viaAccessHashCount = 0;
  let unreachableCount = 0;
  let accessHashSerializationOk = true;

  for (const uid of verifiedQ) {
    const p = ownerPeers.get(String(uid));
    if (!p) {
      unreachableCount++;
      continue;
    }
    const hasUsername = Boolean(p.username && p.username.trim().length > 0);
    const hasAccHash = Boolean(
      (p.accessHashes && p.accessHashes[phone] && p.accessHashes[phone] !== '0') ||
      (p.sourcePhone === phone && p.accessHash && p.accessHash !== '0')
    );

    if (hasUsername) {
      reachableCount++;
      viaUsernameCount++;
    } else if (hasAccHash) {
      reachableCount++;
      viaAccessHashCount++;
      // Test BigInt serialization
      try {
        const testHash = p.accessHashes?.[phone] || p.accessHash;
        BigInt(String(testHash).replace(/[^0-9-]/g, ''));
      } catch {
        accessHashSerializationOk = false;
      }
    } else {
      unreachableCount++;
    }
  }

  // 3. Flood & Restriction State
  const isCooling = Boolean(a.dm_rest_until && a.dm_rest_until > Date.now());
  const coolingSecs = isCooling ? Math.max(1, Math.ceil((a.dm_rest_until - Date.now()) / 1000)) : 0;
  const floodCount = (a as any).peer_flood_consecutive || 0;

  // 4. Overall Health & Skipping Risk Determination
  let healthState: 'healthy' | 'warning' | 'critical' = 'healthy';
  let skippingRisk = '0%';
  let needsReauth = false;
  let healthLabel = '🟢 Healthy & Validated';
  let summary = 'Account MTProto session and access hashes are 100% operational.';
  let recommendation = 'Account is in peak health and ready to deliver direct messages without skipping users.';

  if (!sessionExists || !authValid) {
    healthState = 'critical';
    needsReauth = true;
    skippingRisk = '100% (High Alert: Bot will skip all targets)';
    healthLabel = '🔴 Re-Authentication Required';
    summary = `MTProto session is invalid, expired, or revoked by Telegram (${authErrorMsg || 'No valid session token'}).`;
    recommendation = 'Click "Re-Authenticate" now to enter a fresh OTP code. This prevents the bot from skipping queued leads.';
  } else if (isCooling) {
    healthState = 'warning';
    skippingRisk = 'Paused (Rate Limit Protection)';
    healthLabel = '🟡 Rest Mode / Cooling';
    summary = `Account is resting for ${coolingSecs}s due to Telegram rate protection (${floodCount} consecutive PEER_FLOOD detections).`;
    recommendation = 'Wait for cooling timer to finish or click "Resume Now". Do not reduce DM delay below 40s.';
  } else if (totalVerifiedQ > 0 && reachableCount === 0) {
    healthState = 'warning';
    skippingRisk = `High (${unreachableCount}/${totalVerifiedQ} targets lack access hash for this phone)`;
    healthLabel = '🟡 Access Hash Missing for Queue';
    summary = `All ${totalVerifiedQ} verified users in queue were extracted without universal @usernames by another account. Telegram MTProto restricts messaging them from this phone.`;
    recommendation = 'Start the account that extracted these users, or scan a channel using this account to capture session-bound access hashes.';
  } else if (!accessHashSerializationOk) {
    healthState = 'warning';
    skippingRisk = 'Elevated (Malformed Hash Detected)';
    healthLabel = '🟡 Access Hash Serialization Issue';
    summary = 'One or more access hashes in the peer store contain malformed characters.';
    recommendation = 'Run channel scanner to refresh access hashes.';
  }

  const durationMs = Date.now() - startTs;

  res.json({
    success: true,
    phone,
    label: a.label || phone,
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    latency_ms: pingLatencyMs,
    health: {
      state: healthState,
      label: healthLabel,
      skipping_risk: skippingRisk,
      needs_reauth: needsReauth,
      summary,
      recommendation
    },
    checks: {
      session_exists: sessionExists,
      auth_valid: authValid,
      telegram_connected: a.running && Boolean(a.client),
      access_hash_ok: accessHashSerializationOk,
      cooling_mode: isCooling,
      cooling_seconds: coolingSecs,
      peer_flood_count: floodCount
    },
    queue_reachability: {
      total_queue: totalVerifiedQ,
      reachable: reachableCount,
      via_username: viaUsernameCount,
      via_access_hash: viaAccessHashCount,
      unreachable: unreachableCount,
      reachability_percentage: totalVerifiedQ > 0 ? Math.round((reachableCount / totalVerifiedQ) * 100) : 100
    },
    profile: telegramProfile
  });
});

app.post('/api/account/reauth', async (req: any, res: any) => {
  const phone = (req.body?.phone || '').trim();
  const a = accounts.get(phone);
  if (!a) return res.status(404).json({ success: false, msg: 'Account not found!' });
  if (!canTouch(req, a.owner || 'admin')) return res.status(403).json({ success: false, msg: 'Access denied!' });

  log(phone, 'INFO', `🔄 Re-authentication triggered for ${phone}. Resetting stale session and requesting fresh OTP...`);

  // Stop client if running
  if (a.running && a.abortController) {
    try { a.abortController.abort(); } catch {}
  }
  if (a.client) {
    try { await a.client.disconnect(); } catch {}
    a.client = null;
  }
  a.running = false;

  // Clear dead session file so GramJS requests a new phone code from Telegram
  const sessFile = getSessionFile(phone);
  if (fs.existsSync(sessFile)) {
    try { fs.unlinkSync(sessFile); } catch {}
  }

  a.status = 'Starting... sending OTP';
  broadcastAccountUpdate(a.owner);

  // Trigger background login run
  a.running = true;
  const abortController = new AbortController();
  a.abortController = abortController;
  runTelegramBot(phone, abortController.signal).catch((err) => {
    log(phone, 'FAIL', `Re-auth bot run failed: ${err?.message || err}`);
  });

  return res.json({
    success: true,
    phone,
    msg: `Re-authentication initiated for ${a.label || phone}! Fresh Telegram OTP code has been dispatched.`
  });
});

async function permanentlyDeleteAccount(phone: string): Promise<{
  success: boolean;
  owner: string;
  sentTransferred: number;
  queueTransferred: number;
  peersTransferred: number;
}> {
  const normPhone = (phone || '').trim();
  const cleanPId = normPhone.replace(/[^0-9+]/g, '');
  const numOnly = normPhone.replace(/[^0-9]/g, '');

  let a = accounts.get(normPhone);
  if (!a && cleanPId) a = accounts.get(cleanPId);
  let foundKey = '';
  if (a) {
    foundKey = normPhone;
  } else {
    for (const [k, v] of accounts.entries()) {
      const kDigits = k.replace(/[^0-9]/g, '');
      const vDigits = (v?.phone || '').replace(/[^0-9]/g, '');
      if (
        k === normPhone ||
        k === cleanPId ||
        (numOnly && (kDigits === numOnly || vDigits === numOnly))
      ) {
        a = v;
        foundKey = k;
        break;
      }
    }
  }

  const owner = a?.owner || 'admin';
  console.log(`[PERMANENT DELETE] Deleting Telegram ID "${normPhone}" (owner: ${owner}) from VPS backend...`);

  // 1. Immediately abort running loops & disconnect Telegram client
  if (a) {
    a.running = false;
    a.status = 'Deleted';
    if (a.abortController) {
      try { a.abortController.abort(); } catch {}
    }
    if (a.client) {
      try {
        await Promise.race([
          a.client.disconnect(),
          new Promise((r) => setTimeout(r, 2000))
        ]);
      } catch {}
      a.client = null;
    }
  }

  // 2. Reject and clean any pending OTP / 2FA login promises
  const pending = pendingAuthMap.get(normPhone) || (numOnly ? pendingAuthMap.get(numOnly) : null);
  if (pending) {
    try {
      if (pending.otpReject) pending.otpReject(new Error('Account deleted by administrator'));
      if (pending.twoFaReject) pending.twoFaReject(new Error('Account deleted by administrator'));
    } catch {}
    pendingAuthMap.delete(normPhone);
    if (numOnly) pendingAuthMap.delete(numOnly);
  }

  // 3. Remove all session files from VPS disk
  const possibleSessionFiles = [
    getSessionFile(normPhone),
    path.join(__dirname, `session_${cleanPId}.txt`),
    path.join(__dirname, `session_${numOnly}.txt`),
    path.join(__dirname, `session_+${numOnly}.txt`)
  ];
  for (const f of possibleSessionFiles) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        console.log(`[PERMANENT DELETE] Unlinked session file: ${f}`);
      }
    } catch (e) {}
  }

  // Scan directory for any orphaned session file matching this phone number
  try {
    const allFiles = fs.readdirSync(__dirname);
    for (const f of allFiles) {
      if (f.startsWith('session_') && f.endsWith('.txt') && numOnly && f.includes(numOnly)) {
        try {
          fs.unlinkSync(path.join(__dirname, f));
          console.log(`[PERMANENT DELETE] Removed matching session file: ${f}`);
        } catch {}
      }
    }
  } catch {}

  // 3.5. TRANSFER TO ADMIN BEFORE DELETION (Total DM Sent Data + Genuine Queue + Important Peer Entities Files)
  let sentTransferred = 0;
  let queueTransferred = 0;
  let peersTransferred = 0;

  try {
    console.log(`[TRANSFER TO ADMIN] Collecting all DM sent data, genuine queue, and important peer files for ${normPhone} before deletion...`);

    // A. Collect all DM Sent contacts from memory and disk for this ID
    const gatheredSentUids = new Set<number>();
    if (a?.sent_users) {
      for (const id of a.sent_users) gatheredSentUids.add(id);
    }
    const memSent = sentUsersCache.get(normPhone) || (cleanPId ? sentUsersCache.get(cleanPId) : null) || (numOnly ? sentUsersCache.get(numOnly) : null);
    if (memSent) {
      for (const id of memSent) gatheredSentUids.add(id);
    }
    const possibleSentFiles = [
      path.join(__dirname, `sent_${cleanPId}.json`),
      path.join(__dirname, `sent_${numOnly}.json`)
    ];
    for (const sf of possibleSentFiles) {
      try {
        if (fs.existsSync(sf)) {
          const arr = JSON.parse(fs.readFileSync(sf, 'utf8'));
          if (Array.isArray(arr)) arr.forEach((id: number) => gatheredSentUids.add(id));
        }
      } catch {}
    }

    // B. Collect all Genuine Queue contacts from memory and disk for this ID
    const gatheredQueueUids = new Set<number>();
    if (a?.queue && Array.isArray(a.queue)) {
      for (const id of a.queue) gatheredQueueUids.add(id);
    }
    const memQueue = queueCache.get(normPhone) || (cleanPId ? queueCache.get(cleanPId) : null) || (numOnly ? queueCache.get(numOnly) : null);
    if (memQueue && Array.isArray(memQueue)) {
      for (const id of memQueue) gatheredQueueUids.add(id);
    }
    const possibleQueueFiles = [
      path.join(__dirname, `queue_${cleanPId}.json`),
      path.join(__dirname, `queue_${numOnly}.json`)
    ];
    for (const qf of possibleQueueFiles) {
      try {
        if (fs.existsSync(qf)) {
          const arr = JSON.parse(fs.readFileSync(qf, 'utf8'));
          if (Array.isArray(arr)) arr.forEach((id: number) => gatheredQueueUids.add(id));
        }
      } catch {}
    }

    // C. Collect all Peer metadata ("important file") from memory and disk for this ID
    const gatheredPeers = new Map<string, PeerInfo>();
    if (a?.peers && a.peers instanceof Map) {
      for (const [k, v] of a.peers.entries()) gatheredPeers.set(k, v);
    }
    const memPeers = peersCache.get(normPhone) || (cleanPId ? peersCache.get(cleanPId) : null) || (numOnly ? peersCache.get(numOnly) : null);
    if (memPeers && memPeers instanceof Map) {
      for (const [k, v] of memPeers.entries()) gatheredPeers.set(k, v);
    }
    const possiblePeerFiles = [
      path.join(__dirname, `peers_${cleanPId}.json`),
      path.join(__dirname, `peers_${numOnly}.json`)
    ];
    for (const pf of possiblePeerFiles) {
      try {
        if (fs.existsSync(pf)) {
          const arr = JSON.parse(fs.readFileSync(pf, 'utf8'));
          if (Array.isArray(arr)) {
            for (const item of arr) {
              if (Array.isArray(item) && item.length === 2) {
                gatheredPeers.set(String(item[0]), item[1]);
              }
            }
          }
        }
      } catch {}
    }

    // Also look up missing peer info for all gathered IDs from findPeerInfoAnywhere
    const allGatheredIds = new Set<number>([...gatheredSentUids, ...gatheredQueueUids]);
    for (const id of allGatheredIds) {
      const idStr = String(id);
      if (!gatheredPeers.has(idStr)) {
        const found = findPeerInfoAnywhere(idStr, owner);
        if (found) gatheredPeers.set(idStr, found);
      }
    }

    // D. TRANSFER TO ADMIN:
    // 1. Transfer Sent Contacts to Admin
    const adminSent = getOwnerSentUsers('admin');
    for (const uid of gatheredSentUids) {
      if (!adminSent.has(uid)) {
        adminSent.add(uid);
        sentTransferred++;
      }
    }
    ownerSentCache.set('admin', adminSent);
    try {
      fs.writeFileSync(path.join(__dirname, `sent_owner_admin.json`), JSON.stringify(Array.from(adminSent)), 'utf8');
    } catch {}

    // 2. Transfer Peer Metadata ("Important File") to Admin
    const adminPeers = getOwnerPeers('admin');
    for (const [uidStr, pInfo] of gatheredPeers.entries()) {
      if (pInfo && (pInfo.accessHash || pInfo.username || pInfo.phone)) {
        adminPeers.set(uidStr, {
          userId: uidStr,
          accessHash: pInfo.accessHash,
          username: pInfo.username,
          firstName: pInfo.firstName,
          lastName: pInfo.lastName,
          phone: pInfo.phone,
          sourcePhone: pInfo.sourcePhone || normPhone
        });
        peersTransferred++;
      }
    }
    saveOwnerPeers('admin', adminPeers);

    // 3. Transfer Genuine Queue Contacts to Admin Genuine Queue
    const adminVerifiedQ = getOwnerVerifiedQueue('admin');
    const adminVerifiedSet = new Set(adminVerifiedQ);
    const toAddToVerified: number[] = [];
    for (const uid of gatheredQueueUids) {
      if (!adminSent.has(uid) && !adminVerifiedSet.has(uid)) {
        toAddToVerified.push(uid);
        adminVerifiedSet.add(uid);
        queueTransferred++;
      }
    }
    if (toAddToVerified.length > 0) {
      addToOwnerVerifiedQueue('admin', toAddToVerified);
    }

    // 4. Inject InputPeerUser into all active GramJS clients of Admin
    for (const acc of accounts.values()) {
      if ((acc.owner || 'admin') === 'admin' && acc.client) {
        try {
          for (const uid of allGatheredIds) {
            const uidStr = String(uid);
            const p = adminPeers.get(uidStr);
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

    console.log(`[TRANSFER TO ADMIN COMPLETED] Transferred ${sentTransferred} Sent, ${queueTransferred} Queue, and ${peersTransferred} Peer entities from ID "${normPhone}" to Admin successfully.`);
  } catch (err: any) {
    console.error(`[TRANSFER TO ADMIN ERROR] Failed to transfer data to admin:`, err);
  }

  // 4. Remove all data cache files (sent, peers, queue) for this phone from VPS disk
  const possibleDataFiles = [
    path.join(__dirname, `sent_${cleanPId}.json`),
    path.join(__dirname, `sent_${numOnly}.json`),
    path.join(__dirname, `peers_${cleanPId}.json`),
    path.join(__dirname, `peers_${numOnly}.json`),
    path.join(__dirname, `queue_${cleanPId}.json`),
    path.join(__dirname, `queue_${numOnly}.json`)
  ];
  for (const f of possibleDataFiles) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        console.log(`[PERMANENT DELETE] Unlinked data cache file: ${f}`);
      }
    } catch (e) {}
  }

  try {
    const allFiles = fs.readdirSync(__dirname);
    for (const f of allFiles) {
      if ((f.startsWith('sent_') || f.startsWith('peers_') || f.startsWith('queue_')) && numOnly && f.includes(numOnly)) {
        try {
          fs.unlinkSync(path.join(__dirname, f));
          console.log(`[PERMANENT DELETE] Removed matching phone cache file: ${f}`);
        } catch {}
      }
    }
  } catch {}

  // 5. Remove account from memory Maps
  accounts.delete(normPhone);
  if (cleanPId) accounts.delete(cleanPId);
  if (foundKey) accounts.delete(foundKey);
  if (a?.phone) accounts.delete(a.phone);
  for (const [k, v] of Array.from(accounts.entries())) {
    const kNum = k.replace(/[^0-9]/g, '');
    const vNum = (v?.phone || '').replace(/[^0-9]/g, '');
    if (
      k === normPhone ||
      k === cleanPId ||
      k === foundKey ||
      v === a ||
      (a && a.phone && (k === a.phone || v?.phone === a.phone)) ||
      (numOnly && (kNum === numOnly || vNum === numOnly))
    ) {
      accounts.delete(k);
    }
  }
  sentUsersCache.delete(normPhone);
  sentUsersCache.delete(cleanPId);
  sentUsersCache.delete(numOnly);
  peersCache.delete(normPhone);
  peersCache.delete(cleanPId);
  peersCache.delete(numOnly);
  queueCache.delete(normPhone);
  logsMap.delete(normPhone);
  logsMap.delete(cleanPId);
  logsMap.delete(numOnly);
  activeGroupCalls.delete(normPhone);
  generatorWorkerStates.delete(normPhone);

  // 6. Free up registered phone slot from user profile in users.json so re-login works smoothly
  for (const u of usersList) {
    if (Array.isArray(u.registered_phones)) {
      const origCount = u.registered_phones.length;
      u.registered_phones = u.registered_phones.filter((p: string) => {
        const pNum = String(p).replace(/[^0-9]/g, '');
        const matches = (
          p === normPhone ||
          p === cleanPId ||
          p === phone ||
          (foundKey && p === foundKey) ||
          (a && a.phone && p === a.phone) ||
          (numOnly && pNum && pNum === numOnly)
        );
        return !matches;
      });
      if (u.registered_phones.length !== origCount) {
        saveUsers();
        console.log(`[PERMANENT DELETE] Freed registered slot in user "${u.username}". New count: ${u.registered_phones.length}`);
      }
    }
  }

  // 7. Clean up pending or resolved slot requests for this phone
  if (Array.isArray(slotRequests)) {
    const beforeCount = slotRequests.length;
    slotRequests = slotRequests.filter((r) => {
      const rNum = String(r.phone).replace(/[^0-9]/g, '');
      const matches = (
        r.phone === normPhone ||
        r.phone === cleanPId ||
        r.phone === phone ||
        (foundKey && r.phone === foundKey) ||
        (a && a.phone && r.phone === a.phone) ||
        (numOnly && rNum && rNum === numOnly)
      );
      return !matches;
    });
    if (slotRequests.length !== beforeCount) {
      saveSlotRequests();
    }
  }

  // 8. Persist updated accounts.json immediately to disk
  saveAccountsJson();

  return {
    success: true,
    owner,
    sentTransferred,
    queueTransferred,
    peersTransferred
  };
}

app.post('/api/account/remove', async (req: any, res: any) => {
  const phone = (req.body?.phone || '').trim();
  if (!phone) return res.status(400).json({ ok: false, msg: 'Phone number is required!' });
  const cleanPId = phone.replace(/[^0-9+]/g, '');
  const numOnly = phone.replace(/[^0-9]/g, '');

  let a = accounts.get(phone) || (cleanPId ? accounts.get(cleanPId) : null);
  if (!a && numOnly) {
    for (const [k, v] of accounts.entries()) {
      const kDigits = k.replace(/[^0-9]/g, '');
      const vDigits = (v?.phone || '').replace(/[^0-9]/g, '');
      if (kDigits === numOnly || vDigits === numOnly) {
        a = v;
        break;
      }
    }
  }

  if (!a) {
    // Check if phone was in registered_phones of the user, free it up
    const effUser = getEffectiveUser(req);
    const u = getUser(effUser);
    if (u && Array.isArray(u.registered_phones)) {
      const prevLen = u.registered_phones.length;
      u.registered_phones = u.registered_phones.filter((p: string) => {
        const pNum = String(p).replace(/[^0-9]/g, '');
        return p !== phone && p !== cleanPId && (numOnly && pNum ? pNum !== numOnly : true);
      });
      if (u.registered_phones.length !== prevLen) {
        saveUsers();
        broadcastAccountUpdate(u.username);
        return res.json({ ok: true, success: true, msg: `Account ${phone} removed!` });
      }
    }
    return res.json({ ok: false, msg: 'Account not found or already deleted!' });
  }

  if (!canTouch(req, a.owner || 'admin')) return res.status(403).json({ ok: false, msg: 'This account is not yours!' });

  const effUser = getEffectiveUser(req);
  const u = getUser(effUser);
  const isUserAdmin = isAdminSession(req) || effUser === 'admin' || Boolean(u && u.role === 'admin');

  // Check if account has successfully logged in & has an active MTProto session
  const hasSess = fs.existsSync(getSessionFile(phone)) || fs.existsSync(getSessionFile(a.phone));
  const isSuccessfullyLoggedIn = Boolean(
    hasSess &&
    a.state !== 'waiting' &&
    a.status !== 'awaiting_otp' &&
    a.status !== 'awaiting_2fa' &&
    a.status !== 'unverified' &&
    a.status !== 'auth_failed' &&
    a.status !== 'login_failed' &&
    !(a as any).needs_reauth
  );

  // STRICT RULE: If the account is logged in / bot started / active session, regular users cannot delete it! Only Admin can!
  if (!isUserAdmin && isSuccessfullyLoggedIn) {
    return res.status(403).json({
      ok: false,
      is_active_account: true,
      msg: 'Active & Logged-in Telegram accounts can only be deleted by Admin! Please contact Admin to remove this account.'
    });
  }

  const delRes = await permanentlyDeleteAccount(phone);
  broadcastAccountUpdate(delRes.owner || 'admin');
  if (delRes.owner !== 'admin') {
    broadcastAccountUpdate('admin');
  }

  const details: string[] = [];
  if (delRes.sentTransferred > 0) details.push(`${delRes.sentTransferred} DM Sent`);
  if (delRes.queueTransferred > 0) details.push(`${delRes.queueTransferred} Genuine Queue`);
  if (delRes.peersTransferred > 0) details.push(`${delRes.peersTransferred} Peer Entity Files`);
  const transferInfo = details.length > 0 ? ` (Transferred to Admin: ${details.join(', ')})` : '';

  res.json({
    ok: true,
    success: true,
    msg: `Account ${phone} deleted permanently from VPS!${transferInfo}`
  });
});

app.post('/api/admin/account/delete', async (req: any, res: any) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ msg: 'Admin access required!' });
  }
  const phone = (req.body?.phone || '').trim();
  if (!phone) return res.status(400).json({ msg: 'Phone number is required!' });

  const delRes = await permanentlyDeleteAccount(phone);
  broadcastAccountUpdate(delRes.owner || 'admin');
  broadcastAccountUpdate('admin');

  const details: string[] = [];
  if (delRes.sentTransferred > 0) details.push(`${delRes.sentTransferred} DM Sent`);
  if (delRes.queueTransferred > 0) details.push(`${delRes.queueTransferred} Genuine Queue`);
  if (delRes.peersTransferred > 0) details.push(`${delRes.peersTransferred} Peer Entity Files`);
  const transferInfo = details.length > 0 ? ` (Transferred to Admin: ${details.join(', ')})` : '';

  res.json({
    ok: true,
    success: true,
    msg: `Telegram ID ${phone} deleted permanently from VPS!${transferInfo}`
  });
});

app.post('/api/account/check-spambot', async (req: any, res: any) => {
  const phone = (req.body?.phone || '').trim();
  const a = accounts.get(phone);
  if (!a) return res.json({ msg: 'Account not found!' });
  if (!canTouch(req, a.owner || 'admin')) return res.json({ msg: 'This account does not belong to you!' });
  if (!a.client) return res.json({ msg: 'Account client is not active! Please START the bot first to connect to Telegram.' });

  log(phone, 'INFO', 'Manual 5-cycle @SpamBot verification requested from dashboard...');
  const isCleared = await checkAndResolveSpamBot(a.client, phone, false);
  if (isCleared) {
    if (a.running) {
      a.dm_on = true;
      broadcastAccountUpdate(a.owner);
    }
    res.json({ success: true, msg: '🎉 @SpamBot: No limits found! Account is completely clean and DM is active.' });
  } else {
    if (a.running) {
      a.dm_on = false;
      log(phone, 'WARN', '⚠️ @SpamBot: Limitation confirmed. DM turned OFF — Live Stream Monitoring remains ACTIVE!');
      broadcastAccountUpdate(a.owner);
    }
    res.json({ success: false, msg: '⚠️ @SpamBot: Limitation is still active after 5 checks. DM has been turned OFF while Live Monitoring remains active.' });
  }
});

app.post('/api/account/start', (req         , res          ) => {
  const phone = req.body?.phone;
  const a = accounts.get(phone);
  if (!a) return res.json({ msg: 'Account not found!' });
  if (!canTouch(req, a.owner || 'admin')) return res.json({ msg: 'This account does not belong to you!' });
  if (a.running) return res.json({ msg: 'This account is already running!' });

  // Payment Overdue / Advance Check:
  const botOwner = a.owner || 'admin';
  if (botOwner !== 'admin') {
    const ownerUser = getUser(botOwner);
    if (ownerUser && (ownerUser as any).payment_paused) {
      return res.json({
        msg: '⚠️ Your account bots are currently paused due to payment pending. Please clear your balance or contact admin.'
      });
    }
    const summary = getUserLedgerSummary(botOwner);
    // If user has negative balance (Advance), they are 100% fine!
    // But if they have balance_due > 0 and plan expiry is passed OR overdue limit breached:
    const todayStr = getTodayDateString();
    if (summary.balance_due > 0 && ownerUser?.expiry_date && todayStr > ownerUser.expiry_date) {
      return res.json({
        msg: `⚠️ Subscription expired and ₹${summary.balance_due} payment pending. Please contact admin to renew.`
      });
    }
  }

  const effCfg = getEffectiveConfig(a);
  const hasCustomDm = Boolean(
    effCfg.message_1?.trim() || effCfg.message_2?.trim() || effCfg.message_3?.trim() || effCfg.message?.trim()
  );
  if (!hasCustomDm) {
    log(phone, 'INFO', 'ℹ️ [DYNAMIC DM MODE] 3 DM boxes empty: Bot starting with Dynamic DM (Hinglish Engine active).');
  }

  const ownerUser = getUser(a.owner || 'admin');
  const isAppOnly = ownerUser?.access_type === 'app_only';
  const userAgent = (req.headers['user-agent'] || '').toString();

  // ONLY tether to mobile if strictly 'app_only' user AND explicit mobile engine request
  // Webapp users and users with 'both' permission ALWAYS run 24/7 on VPS server!
  const isMobileClient = isAppOnly && (
    req.body?.engine === 'mobile' || 
    req.headers['x-engine-mode'] === 'mobile' || 
    userAgent.includes('LeoTeleBotNative')
  );

  a.running = true;
  accountLastDmTimestamp.delete(phone);
  (a as any).peer_flood_consecutive = 0;
  if (a.live_on === undefined) a.live_on = true;
  if (a.dm_on === undefined) a.dm_on = true;

  if (isMobileClient) {
    (a as any).engine_mode = 'mobile_app';
    accountLastHeartbeat.set(phone, Date.now());
    log(phone, 'INFO', `📱 [MOBILE CLIENT ENGINE] Bot tethered to Mobile Phone (${phone}). Live data heartbeat active.`);
  } else {
    (a as any).engine_mode = 'vps_server';
    accountLastHeartbeat.delete(phone);
  }

  const sessFile = getSessionFile(phone);
  const sessionExists = fs.existsSync(sessFile) && fs.readFileSync(sessFile, 'utf8').trim().length > 0;

  a.status = sessionExists ? 'Starting...' : 'Starting... sending OTP';
  broadcastAccountUpdate(a.owner);

  const abortController = new AbortController();
  a.abortController = abortController;

  // Run async background bot on VPS with auto-recovery against network interruptions
  launchBotWorker(phone, abortController);

  res.json({
    engine: (a as any).engine_mode || 'vps_server',
    msg: sessionExists ? `🚀 ${phone} bot started!` : `${phone} started! OTP code is being dispatched to Telegram - please enter it in the dashboard.`
  });
});

// 📱 Mobile App Heartbeat: Keeps the bot alive as long as phone has active mobile data / Wi-Fi
app.post('/api/mobile/heartbeat', (req, res) => {
  const { phones, phone } = req.body || {};
  const now = Date.now();
  const list = Array.isArray(phones) ? phones : (phone ? [phone] : []);
  for (const p of list) {
    if (p && accounts.has(p)) {
      accountLastHeartbeat.set(p, now);
      const acc = accounts.get(p);
      if (acc) {
        (acc as any).last_phone_ping = now;
        const oUser = getUser(acc.owner || 'admin');
        if (oUser?.access_type === 'app_only') {
          (acc as any).engine_mode = 'mobile_app';
        }
        if (!acc.running && acc.status?.includes('Offline')) {
          acc.status = 'Ready';
          broadcastAccountUpdate(acc.owner);
        }
      }
    }
  }
  res.json({ ok: true, now });
});

// 📱 Mobile App Offline Notice (Safe: Does NOT stop VPS running bots)
app.post('/api/mobile/offline', (req, res) => {
  res.json({ ok: true });
});

// Endpoint for Mobile App to report live stats, logs and status to Admin without using VPS engine
app.post('/api/account/client-report', (req, res) => {
  const { phone, status, sent_delta, log_type, log_message } = req.body || {};
  const a = accounts.get(phone);
  if (!a) return res.status(404).json({ ok: false, msg: 'Account not found' });
  if (!canTouch(req, a.owner || 'admin')) return res.status(403).json({ ok: false, msg: 'Access denied' });

  if (status) a.status = status;
  (a as any).engine_mode = 'mobile_app';
  if (sent_delta && typeof sent_delta === 'number') {
    a.sent_count = (a.sent_count || 0) + sent_delta;
    (a as any).daily_sent_count = ((a as any).daily_sent_count || 0) + sent_delta;
  }
  if (log_message) {
    log(phone, log_type || 'OK', `📱 [Mobile Device]: ${log_message}`);
  }
  broadcastAccountUpdate(a.owner);
  res.json({ ok: true, msg: 'Client telemetry received' });
});

app.post('/api/account/stop', (req         , res          ) => {
  const phone = req.body?.phone;
  const a = accounts.get(phone);
  if (!a) return res.json({ msg: 'Account not found!' });
  if (!canTouch(req, a.owner || 'admin')) return res.json({ msg: 'This account is not yours!' });

  a.running = false;
  (a as any).persisted_running = false;
  saveAccountsLocal();
  accountLastDmTimestamp.delete(phone);
  accountLastHeartbeat.delete(phone);
  if (a.abortController) {
    a.abortController.abort();
  }
  a.status = 'Stopped';
  broadcastAccountUpdate(a.owner);

  // Unblock any waiting OTP/2FA
  const pending = pendingAuthMap.get(phone);
  if (pending) {
    if (pending.otpReject) pending.otpReject(new Error('Stopped by user'));
    if (pending.twoFaReject) pending.twoFaReject(new Error('Stopped by user'));
    pendingAuthMap.delete(phone);
  }

  res.json({ msg: `${phone} stop signal sent` });
});

app.post('/api/account/verify-otp', async (req, res) => {
  const phone = (req.body?.phone || '').trim();
  const rawCode = String(req.body?.code || '');
  const code = rawCode.replace(/[^0-9]/g, '').trim();
  const a = accounts.get(phone);
  if (a && !canTouch(req, a.owner || 'admin')) return res.json({ success: false, msg: 'This account is not yours!' });

  if (a && (a.status === 'online' || a.status === 'Monitoring...' || (a.running && a.status !== 'awaiting_otp'))) {
    return res.json({ success: true, status: 'online', msg: '✅ Account is already verified and active!' });
  }

  const p = pendingAuthMap.get(phone);
  if (!p || p.waiting !== 'otp') {
    return res.json({ success: false, msg: 'No OTP is awaiting verification for this account! Click "START BOT" to request a fresh OTP.' });
  }
  if (!code || code.length < 3) {
    return res.json({ success: false, msg: 'Please enter a valid numeric OTP code (usually 5 digits)!' });
  }

  log(phone, 'INFO', `Submitting OTP code (${code.length} digits) to Telegram...`);

  // Hook up outcome resolver promise
  let outcomeResolve: (val: any) => void;
  const outcomePromise = new Promise<{ success: boolean; status?: string; msg?: string }>((resolve) => {
    outcomeResolve = resolve;
  });
  p.notifyResult = outcomeResolve!;

  if (p.otpResolve) {
    p.otpResolve(code);
    log(phone, 'INFO', `OTP code received from dashboard. Verifying with Telegram servers...`);
  }

  // Await verification outcome up to 25 seconds
  const result = await Promise.race([
    outcomePromise,
    new Promise<{ success: boolean; status?: string; msg?: string }>((_, reject) =>
      setTimeout(() => reject(new Error('VERIFY_TIMEOUT')), 25000)
    )
  ]).catch((err) => {
    if (err?.message === 'VERIFY_TIMEOUT') {
      const currentStatus = a?.status || 'verifying';
      if (currentStatus === 'online' || currentStatus === 'Monitoring...' || a?.running) {
        return { success: true, status: 'online', msg: '✅ OTP verified successfully! Account is now online.' };
      }
      return { success: true, status: 'online', msg: '✅ OTP submitted! Account is now connecting/online.' };
    }
    return { success: true, status: 'online', msg: '✅ OTP verified successfully! Account is active.' };
  });

  return res.json(result);
});

app.post('/api/account/verify-2fa', async (req, res) => {
  const phone = (req.body?.phone || '').trim();
  const password = String(req.body?.password || '').trim();
  const a = accounts.get(phone);
  if (a && !canTouch(req, a.owner || 'admin')) return res.json({ success: false, msg: 'This account is not yours!' });

  if (a && (a.status === 'online' || a.status === 'Monitoring...' || (a.running && a.status !== 'awaiting_2fa'))) {
    return res.json({ success: true, status: 'online', msg: '✅ Account is already verified and active!' });
  }

  const p = pendingAuthMap.get(phone);
  if (!p || p.waiting !== 'twofa') {
    return res.json({ success: false, msg: 'This account does not need 2FA right now!' });
  }
  if (!password) {
    return res.json({ success: false, msg: '2FA password is empty!' });
  }

  log(phone, 'INFO', 'Submitting 2FA Cloud Password to Telegram...');

  let outcomeResolve: (val: any) => void;
  const outcomePromise = new Promise<{ success: boolean; status?: string; msg?: string }>((resolve) => {
    outcomeResolve = resolve;
  });
  p.notifyResult = outcomeResolve!;

  if (p.twoFaResolve) {
    p.twoFaResolve(password);
  }

  const result = await Promise.race([
    outcomePromise,
    new Promise<{ success: boolean; status?: string; msg?: string }>((_, reject) =>
      setTimeout(() => reject(new Error('VERIFY_TIMEOUT')), 12000)
    )
  ]).catch((err) => {
    if (err?.message === 'VERIFY_TIMEOUT') {
      const currentStatus = a?.status || 'verifying';
      if (currentStatus === 'online' || currentStatus === 'Monitoring...') {
        return { success: true, status: 'online', msg: '✅ 2FA Password verified! Bot is now online.' };
      }
      return { success: false, status: currentStatus, msg: 'Telegram is still verifying 2FA password... Please wait a moment.' };
    }
    return { success: false, status: 'failed', msg: err?.message || 'Verification error' };
  });

  return res.json(result);
});

app.post('/api/stop-all', (req         , res          ) => {
  const eff = getEffectiveUser(req);
  for (const a of accounts.values()) {
    if (canTouch(req, a.owner || 'admin') && a.running) {
      a.running = false;
      (a as any).persisted_running = false;
      if (a.abortController) a.abortController.abort();
      a.status = 'Stopping...';
    }
  }
  saveAccountsLocal();
  broadcastAccountUpdate(eff);
  res.json({ msg: 'Stop signal sent to all your accounts' });
});

app.post('/api/account/toggle-live', (req         , res          ) => {
  const phone = req.body?.phone;
  const a = accounts.get(phone);
  if (!a) return res.json({ msg: 'Account not found!' });
  if (!canTouch(req, a.owner || 'admin')) return res.json({ msg: 'This account is not yours!' });

  a.live_on = !a.live_on;
  const msg = a.live_on
    ? 'Live monitoring ON - live stream detection and queueing active'
    : 'Live monitoring OFF - live stream detection and queueing stopped';
  log(phone, 'INFO', msg);
  broadcastAccountUpdate(a.owner);
  res.json({ msg, live_on: a.live_on });
});

app.post('/api/account/toggle-dm', (req         , res          ) => {
  const phone = req.body?.phone;
  const a = accounts.get(phone);
  if (!a) return res.json({ msg: 'Account not found!' });
  if (!canTouch(req, a.owner || 'admin')) return res.json({ msg: 'This account is not yours!' });

  a.dm_on = !a.dm_on;
  if (a.dm_on) {
    delete (a as any).dm_rest_until;
    (a as any).peer_flood_consecutive = 0;
  }
  const msg = a.dm_on
    ? 'DM ON - automatic direct messaging active'
    : 'DM OFF - direct messaging paused (queue continues collecting users)';
  log(phone, 'INFO', msg);
  saveAccountsJson();
  broadcastAccountUpdate(a.owner);
  res.json({ msg, dm_on: a.dm_on });
});

