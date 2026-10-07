// ---------------- RESIDENTIAL PROXY GATEWAY ADMIN ENDPOINTS ----------------
app.get('/api/admin/proxy', (req, res) => {
  const allAccList = Array.from(accounts.values());
  const accountsStatus = allAccList.map((a) => {
    const rawCleanPhone = (a.phone || '').replace(/[^0-9]/g, '');
    let assignedSession = 'None';
    let status = 'direct';
    let proxyHost = 'Direct (VPS IP)';

    if (a.proxy && a.proxy.protocol && a.proxy.protocol !== 'none' && a.proxy.ip) {
      status = 'custom_proxy';
      proxyHost = `${a.proxy.protocol.toUpperCase()}://${a.proxy.ip}:${a.proxy.port}`;
      assignedSession = a.proxy.username || 'Custom';
    } else if (masterProxyConfig.enabled && masterProxyConfig.host && masterProxyConfig.port > 0) {
      status = 'residential_sticky';
      proxyHost = `${masterProxyConfig.protocol.toUpperCase()}://${masterProxyConfig.host}:${masterProxyConfig.port}`;
      assignedSession = masterProxyConfig.auto_sticky_per_phone
        ? `sess_${rawCleanPhone || 'gen'}_${masterProxyConfig.country || 'auto'}`
        : (masterProxyConfig.username || 'Shared');
    }

    return {
      phone: a.phone,
      label: a.label || a.phone,
      owner: a.owner || 'admin',
      running: Boolean(a.running),
      status,
      proxyHost,
      assignedSession,
      daily_dms: (a as any).daily_sent_count || 0,
      total_sent: a.sent_count || 0
    };
  });

  res.json({
    config: masterProxyConfig,
    accounts: accountsStatus,
    summary: {
      total_accounts: allAccList.length,
      proxied_accounts: masterProxyConfig.enabled ? allAccList.length : allAccList.filter(a => a.proxy && a.proxy.protocol !== 'none').length,
      direct_accounts: !masterProxyConfig.enabled ? allAccList.filter(a => !a.proxy || a.proxy.protocol === 'none').length : 0
    }
  });
});

app.post('/api/admin/proxy/save', (req, res) => {
  const data = req.body || {};
  // FIX: imported bindings are read-only in ES modules; update the shared object in place.
  Object.assign(masterProxyConfig, {
    enabled: Boolean(data.enabled),
    protocol: data.protocol === 'http' ? 'http' : 'socks5',
    host: (data.host || '').trim(),
    port: parseInt(data.port, 10) || 0,
    username: (data.username || '').trim(),
    password: (data.password || '').trim(),
    country: (data.country || '').trim().toLowerCase(),
    session_duration_mins: parseInt(data.session_duration_mins, 10) || 30,
    auto_sticky_per_phone: data.auto_sticky_per_phone !== false
  };

  saveMasterProxyConfig();
  res.json({
    success: true,
    msg: masterProxyConfig.enabled 
      ? '✅ Residential Proxy Gateway Enabled & Saved! All accounts will route through Sticky Residential Sessions.' 
      : '⚪ Residential Proxy Gateway Disabled. Accounts will connect directly without proxy.'
    ,
    config: masterProxyConfig
  });
});

app.post('/api/admin/proxy/test', (req, res) => {
  const data = req.body || {};
  const host = (data.host || masterProxyConfig.host || '').trim();
  const port = parseInt(data.port || String(masterProxyConfig.port || ''), 10);
  const protocol = data.protocol || masterProxyConfig.protocol || 'socks5';

  if (!host || !port || isNaN(port)) {
    return res.status(400).json({ ok: false, msg: 'Proxy Host and Port are required for testing.' });
  }

  const startTime = Date.now();
  const socket = new net.Socket();
  socket.setTimeout(6000);

  let responded = false;
  socket.connect(port, host, () => {
    if (responded) return;
    responded = true;
    const latency = Date.now() - startTime;
    socket.destroy();
    return res.json({
      ok: true,
      latency,
      msg: `✅ Proxy Gateway Reachable! Connected to ${host}:${port} (${protocol.toUpperCase()}) in ${latency}ms.`
    });
  });

  socket.on('error', (err) => {
    if (responded) return;
    responded = true;
    socket.destroy();
    return res.json({
      ok: false,
      msg: `❌ Proxy Connection Failed: ${err.message || String(err)}`
    });
  });

  socket.on('timeout', () => {
    if (responded) return;
    responded = true;
    socket.destroy();
    return res.json({
      ok: false,
      msg: `❌ Proxy Connection Timed Out after 6 seconds.`
    });
  });
});

// --- VPS SYSTEM HEALTH & SPECS PROFILER (Auto-detects GCP free-tier specs) ---
let gcpMetadataCache: { checked: boolean; isGcp: boolean; machineType: string; zone: string } = { checked: false, isGcp: false, machineType: '', zone: '' };

async function checkGcpMetadata(): Promise<{ isGcp: boolean; machineType: string; zone: string }> {
  if (gcpMetadataCache.checked) return gcpMetadataCache;
  try {
    const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/machine-type', {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(1200)
    }).catch(() => null);
    if (res && res.ok) {
      const text = await res.text();
      const parts = text.trim().split('/');
      const mType = parts[parts.length - 1] || 'e2-micro';
      gcpMetadataCache = { checked: true, isGcp: true, machineType: mType, zone: 'Google Cloud' };
      return gcpMetadataCache;
    }
  } catch {}
  gcpMetadataCache = { checked: true, isGcp: false, machineType: '', zone: '' };
  return gcpMetadataCache;
}

function getVpsMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const memPct = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;

  const cpus = os.cpus() || [];
  const cpuCount = cpus.length || 1;
  const cpuModel = cpus[0]?.model || 'Standard Virtual CPU';
  const cpuSpeed = cpus[0]?.speed ? `${cpus[0].speed} MHz` : '';
  const load = os.loadavg() || [0, 0, 0];
  const cpuPct = Math.min(100, Math.max(0, Math.round((load[0] / Math.max(1, cpuCount)) * 100)));

  let diskTotalBytes = 0;
  let diskUsedBytes = 0;
  let diskFreeBytes = 0;
  let diskPct = 0;

  try {
    const dfOut = execSync('df -k /', { encoding: 'utf8', timeout: 2500 });
    const lines = dfOut.trim().split('\n');
    if (lines.length >= 2) {
      const cols = lines[1].replace(/\s+/g, ' ').split(' ');
      if (cols.length >= 5) {
        diskTotalBytes = (parseInt(cols[1], 10) || 0) * 1024;
        diskUsedBytes = (parseInt(cols[2], 10) || 0) * 1024;
        diskFreeBytes = (parseInt(cols[3], 10) || 0) * 1024;
        const pctStr = cols[4] || '0%';
        diskPct = parseInt(pctStr.replace('%', ''), 10) || (diskTotalBytes > 0 ? Math.round((diskUsedBytes / diskTotalBytes) * 100) : 0);
      }
    }
  } catch {}

  const uptimeSec = os.uptime();
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  let uptimeFormatted = '';
  if (days > 0) uptimeFormatted += `${days}d `;
  if (hours > 0 || days > 0) uptimeFormatted += `${hours}h `;
  uptimeFormatted += `${mins}m`;

  const totalMemMb = Math.round(totalMem / (1024 * 1024));
  const usedMemMb = Math.round(usedMem / (1024 * 1024));
  const freeMemMb = Math.round(freeMem / (1024 * 1024));

  const totalDiskGb = (diskTotalBytes / (1024 * 1024 * 1024)).toFixed(1);
  const usedDiskGb = (diskUsedBytes / (1024 * 1024 * 1024)).toFixed(1);
  const freeDiskGb = (diskFreeBytes / (1024 * 1024 * 1024)).toFixed(1);

  // Free Tier assessment: Google Cloud e2-micro free tier is 1 GB RAM & 30 GB SSD
  const isGcpFreeTierCandidate = totalMemMb <= 1500; // ~1GB RAM
  const platform = os.platform();
  const release = os.release();
  const arch = os.arch();
  const nodeVersion = process.version;

  return {
    memory: {
      total_bytes: totalMem,
      used_bytes: usedMem,
      free_bytes: freeMem,
      total_formatted: totalMemMb >= 1024 ? `${(totalMemMb / 1024).toFixed(1)} GB` : `${totalMemMb} MB`,
      used_formatted: usedMemMb >= 1024 ? `${(usedMemMb / 1024).toFixed(1)} GB` : `${usedMemMb} MB`,
      free_formatted: freeMemMb >= 1024 ? `${(freeMemMb / 1024).toFixed(1)} GB` : `${freeMemMb} MB`,
      percent: memPct
    },
    cpu: {
      cores: cpuCount,
      model: cpuModel,
      speed: cpuSpeed,
      load_1m: (load[0] || 0).toFixed(2),
      load_5m: (load[1] || 0).toFixed(2),
      load_15m: (load[2] || 0).toFixed(2),
      percent: cpuPct
    },
    disk: {
      total_bytes: diskTotalBytes,
      used_bytes: diskUsedBytes,
      free_bytes: diskFreeBytes,
      total_formatted: `${totalDiskGb} GB`,
      used_formatted: `${usedDiskGb} GB`,
      free_formatted: `${freeDiskGb} GB`,
      percent: diskPct
    },
    uptime: {
      seconds: uptimeSec,
      formatted: uptimeFormatted
    },
    system: {
      platform,
      release,
      arch,
      node_version: nodeVersion,
      is_free_tier_candidate: isGcpFreeTierCandidate,
      free_tier_provider: isGcpFreeTierCandidate ? 'Google Cloud Free Tier (e2-micro 1GB)' : 'Cloud VPS Host'
    }
  };
}

app.get('/api/admin/vps-health', async (req, res) => {
  const vps = getVpsMetrics();
  const gcp = await checkGcpMetadata();
  if (gcp.isGcp && gcp.machineType) {
    vps.system.free_tier_provider = `Google Cloud (${gcp.machineType})`;
    vps.system.is_free_tier_candidate = gcp.machineType === 'e2-micro';
  }
  res.json({
    success: true,
    vps,
    timestamp: Date.now()
  });
});

// 🚀 REAL-TIME RAM & CLIENT CACHE PURGE TRIGGER
app.post('/api/admin/system/optimize-ram', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required' });
  const result = optimizeProcessMemory();
  res.json({
    ok: true,
    msg: `✅ RAM Optimization Completed! Freed memory: ${result.rssBeforeMb}MB ➔ ${result.rssAfterMb}MB (${result.freedAccounts} active bots cleaned).`,
    ...result
  });
});

app.post('/api/admin/user/create', (req         , res          ) => {
  const data = req.body || {};
  const rawUname = (data.username || '').toString().trim();
  const uname = rawUname.replace(/\s+/g, '').toLowerCase();
  const pwd = (data.password || '').toString().trim();
  const sq = (data.security_question || '').toString().trim();
  const sa = (data.security_answer || '').toString().trim().toLowerCase();
  const exp = (data.expiry_date || '').toString().trim();

  if (!uname || !pwd) return res.json({ msg: 'Username and password are both required!' });
  if (!sq || !sa) return res.json({ msg: 'Security Question and Answer are required (for forgot password)!' });

  const maxAcc = Math.max(0, parseInt(data.max_accounts, 10) || 5);
  const maxTar = Math.max(0, parseInt(data.max_targets, 10) || 9999);
  const rawAccessType = (data.access_type || 'both').toString().toLowerCase();
  const validAccessType = (rawAccessType === 'app_only' || rawAccessType === 'web_only' || rawAccessType === 'both') ? rawAccessType : 'both';

  if (getUser(uname)) return res.json({ msg: 'This username already exists!' });

  // Compute calculated expiry based on billing model if expiry_date not explicitly forced
  let effectiveExpiry = exp;
  const billingModel = (data.billing_model || 'none').toString().toLowerCase();
  const bonusDays = Math.max(0, parseInt(data.bonus_days, 10) || 0);
  const ratePerBot = Math.max(1, Number(data.rate_per_bot) || 15);
  const calculatedTotal = ratePerBot * maxAcc;
  const planRate = Math.max(0, Number(data.plan_amount) || calculatedTotal);

  if (billingModel === 'advance' || billingModel === 'postpaid') {
    const totalDays = 7 + bonusDays;
    const expMs = Date.now() + (totalDays * 86400 * 1000) + (5.5 * 3600 * 1000);
    effectiveExpiry = new Date(expMs).toISOString().split('T')[0];
  } else if (billingModel === 'offer') {
    const baseDays = Math.max(1, parseInt(data.validity_days, 10) || 7);
    const totalDays = baseDays + bonusDays;
    const expMs = Date.now() + (totalDays * 86400 * 1000) + (5.5 * 3600 * 1000);
    effectiveExpiry = new Date(expMs).toISOString().split('T')[0];
  }

  usersList.push({
    username: uname,
    password: hashVal(pwd),
    role: 'user',
    active: true,
    access_type: validAccessType,
    last_platform: 'Never',
    max_accounts: maxAcc,
    max_targets: maxTar,
    expiry_date: effectiveExpiry,
    rate_per_bot: ratePerBot,
    billing_model: billingModel,
    security_question: sq,
    security_answer: hashVal(sa),
    alert_enabled: false,
    alert_bot_token: '',
    alert_chat_id: '',
    ai_enabled: Boolean(data.ai_enabled),
    dynamic_templates_enabled: Boolean(data.dynamic_templates_enabled !== false)
  });
  saveUsers();

  // Save user config in billing store
  if (!billingStore.user_configs) billingStore.user_configs = {};
  const cycleDays = Math.max(1, Number(data.billing_cycle_days) || 7);
  billingStore.user_configs[uname] = {
    rate_per_bot: ratePerBot,
    rate_per_day: ratePerBot,
    max_accounts: maxAcc,
    billing_cycle_days: cycleDays,
    payment_model: billingModel,
    notes: `${maxAcc} Bots @ ₹${ratePerBot}/bot/day (${cycleDays} Days ${billingModel})`
  };
  saveBillingLocal();

  // Auto-Khatabook integration for new user
  let billingNote = '';
  try {
    const todayStr = getTodayDateString();
    if (billingModel === 'advance') {
      const chargeAmt = planRate > 0 ? planRate : (ratePerBot * maxAcc);
      const isAdvancePaid = Boolean(data.advance_paid);
      addBillingInvoice({
        username: uname,
        date: todayStr,
        amount: chargeAmt,
        type: 'weekly_plan',
        description: `${cycleDays}-Day Advance Plan (${maxAcc} IDs x ₹${ratePerBot}/bot = ₹${chargeAmt})${bonusDays > 0 ? ` + ${bonusDays} Bonus Days Free` : ''}`,
        bots_count: maxAcc,
        days_count: cycleDays + bonusDays,
        status: isAdvancePaid ? 'paid' : 'due'
      });
      if (isAdvancePaid) {
        addBillingPayment({
          username: uname,
          date: todayStr,
          amount: chargeAmt,
          mode: data.advance_mode || 'UPI',
          reference: data.advance_ref || 'Advance Signup',
          note: `${cycleDays}-Day Advance Paid at account creation (${maxAcc} Bots @ ₹${ratePerBot}/bot)`
        });
        billingNote = ` | ${cycleDays}-Day Advance (₹${chargeAmt} for ${maxAcc} IDs @ ₹${ratePerBot}/bot) Received. Balance: ₹0`;
      } else {
        billingNote = ` | ${cycleDays}-Day Plan Invoice generated: ₹${chargeAmt} (${maxAcc} IDs @ ₹${ratePerBot}/bot) Due`;
      }
    } else if (billingModel === 'postpaid') {
      // 7-Day Postpaid Plan: Dues accrue day-by-day based strictly on LIVE connected bots (not idle slots)
      accrueDailyUsageForUser(uname, todayStr);
      const liveBots = getUserLiveBotsCount(uname);
      const dailyRate = getUserDailyRatePerBot(uname);
      const dailyAmt = liveBots * dailyRate;
      billingNote = ` | 7-Day Postpaid Plan Active: Accrues daily for live bots (${liveBots} Live Bot(s) @ ₹${dailyRate}/bot/day = ₹${dailyAmt}/day)`;
    } else if (billingModel === 'offer') {
      const discount = Math.max(0, Number(data.offer_discount) || 0);
      const baseAmt = planRate > 0 ? planRate : (ratePerBot * maxAcc);
      const finalAmt = Math.max(0, baseAmt - discount);
      const offerName = (data.offer_name || 'Special Promotional Plan').trim();
      addBillingInvoice({
        username: uname,
        date: todayStr,
        amount: finalAmt,
        type: 'weekly_plan',
        description: `Offer: ${offerName} (${maxAcc} IDs x ₹${ratePerBot}/bot${discount > 0 ? ` - ₹${discount} OFF` : ''}${bonusDays > 0 ? ` +${bonusDays} Bonus Days Free` : ''})`,
        bots_count: maxAcc,
        days_count: 7 + bonusDays,
        status: data.advance_paid ? 'paid' : 'due'
      });
      if (data.advance_paid && finalAmt > 0) {
        addBillingPayment({
          username: uname,
          date: todayStr,
          amount: finalAmt,
          mode: data.advance_mode || 'UPI',
          reference: data.advance_ref || 'Offer Signup Payment',
          note: `Offer Payment received at signup (${maxAcc} Bots @ ₹${ratePerBot}/bot)`
        });
        billingNote = ` | Offer Plan (₹${finalAmt}) Paid. Balance: ₹0`;
      } else {
        billingNote = ` | Offer Plan Invoice generated: ₹${finalAmt} Due`;
      }
    }
  } catch (bErr) {
    console.error('Khatabook auto-init error:', bErr);
  }

  broadcastAccountUpdate('admin');

  // Instant notification to Admin Bot when a new user account is created
  try {
    const adminUser = usersList.find((u) => u.role === 'admin');
    if (adminUser?.alert_bot_token && adminUser?.alert_chat_id) {
      const newAccAlert = `👤 <b>NEW USER ACCOUNT CREATED!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Username:</b> <code>${uname}</code>\n` +
        `🔑 <b>Password:</b> <code>${pwd}</code>\n` +
        `🤖 <b>Bot Slots:</b> <b>${maxAcc} Bots</b>\n` +
        `📅 <b>Plan Validity:</b> <b>${cycleDays} Days</b> (Expires: <code>${formatDisplayDate(effectiveExpiry)}</code>)\n` +
        `💳 <b>Billing Model:</b> <b>${billingModel.toUpperCase()}</b> (@ ₹${ratePerBot}/bot)\n` +
        `🌐 <b>Access Mode:</b> <b>${validAccessType.toUpperCase()}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🕒 <i>Created on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</i>`;
      sendTelegramMessage(adminUser.alert_bot_token, adminUser.alert_chat_id, newAccAlert).catch(() => null);
    }
  } catch {}

  res.json({ msg: `User "${uname}" created successfully! [Access: ${validAccessType.toUpperCase()}] [Valid till: ${effectiveExpiry || 'Unlimited'}]${billingNote} Login: ${uname} / ${pwd}` });
});

app.post('/api/admin/user/update', async (req         , res          ) => {
  const data = req.body || {};
  const uname = data.username;
  const u = getUser(uname);
  if (!u) return res.json({ msg: 'User not found!' });

  if ('active' in data) {
    if (uname === 'admin') return res.json({ msg: 'Admin cannot be disabled!' });
    u.active = Boolean(data.active);
  }

  if ('access_type' in data) {
    const rawAt = (data.access_type || 'both').toString().toLowerCase();
    if (rawAt === 'app_only' || rawAt === 'web_only' || rawAt === 'both') {
      u.access_type = rawAt;
    }
  }

  const newPwd = (data.password || '').trim();
  if (newPwd) {
    u.password = hashVal(newPwd);
  }

  const oldRate = Number(u.rate_per_bot) || 15;
  const oldMaxAcc = Number(u.max_accounts) || 5;

  if ('max_accounts' in data) {
    u.max_accounts = Math.max(0, parseInt(data.max_accounts, 10) || 0);
  }
  if ('max_targets' in data) {
    u.max_targets = Math.max(0, parseInt(data.max_targets, 10) || 0);
  }
  if ('expiry_date' in data) {
    u.expiry_date = data.expiry_date; // YYYY-MM-DD
  }

  if ('alert_enabled' in data) {
    u.alert_enabled = Boolean(data.alert_enabled);
  }
  if ('alert_bot_token' in data) {
    u.alert_bot_token = (data.alert_bot_token || '').trim();
    if (u.alert_bot_token && (u.role === 'admin' || u.username === 'admin')) {
      try {
        const getMeResp = await fetch(`https://api.telegram.org/bot${u.alert_bot_token}/getMe`, { signal: AbortSignal.timeout(4000) });
        const d: any = await getMeResp.json();
        if (d?.ok && d.result?.username) {
          u.alert_bot_username = d.result.username;
          cachedAdminBotUsername = d.result.username;
          console.log(`[ADMIN BOT CACHED]: @${d.result.username}`);
        }
      } catch (err) {}
    }
  }
  if ('alert_chat_id' in data) {
    u.alert_chat_id = (data.alert_chat_id || '').trim();
  }

  let rateChanged = false;
  if ('rate_per_bot' in data) {
    const newR = Math.max(1, Number(data.rate_per_bot) || 15);
    if (newR !== oldRate) {
      rateChanged = true;
      u.rate_per_bot = newR;
    }
  }
  const botsChanged = (u.max_accounts !== oldMaxAcc);

  if (rateChanged || botsChanged) {
    if (!billingStore.user_configs) billingStore.user_configs = {};
    if (!billingStore.user_configs[uname]) billingStore.user_configs[uname] = {} as any;
    billingStore.user_configs[uname].rate_per_bot = u.rate_per_bot;
    billingStore.user_configs[uname].rate_per_day = u.rate_per_bot;
    billingStore.user_configs[uname].max_accounts = u.max_accounts ?? 5;

    const newRate = u.rate_per_bot;
    const newBots = u.max_accounts ?? 5;
    const newTotal = Math.round(newRate * newBots);

    // DYNAMIC BILLING SYNC: Update active cycle invoice so due balance adjusts instantly!
    if (Array.isArray(billingStore.invoices)) {
      const activeInv = billingStore.invoices
        .slice()
        .reverse()
        .find(i => i.username === uname && (i.type === 'weekly_plan' || i.type === 'subscription'));

      if (activeInv) {
        const oldAmt = activeInv.amount;
        activeInv.amount = newTotal;
        activeInv.bots_count = newBots;
        activeInv.description = `${activeInv.days_count || 7}-Day Plan (${newBots} IDs x ₹${newRate}/bot = ₹${newTotal})`;
        console.log(`[KHATABOOK RATE ADJUST]: User ${uname} rate/bots changed! Updated active invoice from ₹${oldAmt} to ₹${newTotal}`);
      } else {
        addBillingInvoice({
          username: uname,
          date: getTodayDateString(),
          amount: newTotal,
          type: 'weekly_plan',
          description: `Plan Updated: ${newBots} IDs x ₹${newRate}/bot = ₹${newTotal}`,
          bots_count: newBots,
          days_count: 7,
          status: 'due'
        });
      }
    }
    saveBillingLocal();
  }
  if ('billing_model' in data) {
    u.billing_model = (data.billing_model || 'advance').toString().toLowerCase();
  }

  const newQ = (data.security_question || '').trim();
  if (newQ) u.security_question = newQ;

  const newA = (data.security_answer || '').trim().toLowerCase();
  if (newA) u.security_answer = hashVal(newA);

  saveUsers();
  broadcastAccountUpdate(uname);
  broadcastAccountUpdate('admin');
  res.json({
    ok: true,
    msg: `${uname} updated successfully!`,
    bot_username: u.alert_bot_username || cachedAdminBotUsername || '',
    telegram_url: (u.alert_bot_username || cachedAdminBotUsername) ? `https://t.me/${u.alert_bot_username || cachedAdminBotUsername}?start=register` : ''
  });
});

app.post('/api/admin/user/edit-ai', (req, res) => {
  const data = req.body || {};
  const uname = data.username;
  const u = getUser(uname);
  if (!u) return res.json({ msg: 'User not found!' });
  
  if ('ai_enabled' in data) {
    u.ai_enabled = Boolean(data.ai_enabled);
  }
  if ('dynamic_templates_enabled' in data) {
    u.dynamic_templates_enabled = Boolean(data.dynamic_templates_enabled);
  }
  
  saveUsers();
  broadcastAccountUpdate(uname);
  broadcastAccountUpdate('admin');
  res.json({ 
    ok: true,
    msg: `Settings updated for ${uname}!`,
    ai_enabled: u.ai_enabled === true,
    dynamic_templates_enabled: u.dynamic_templates_enabled !== false
  });
});

app.post('/api/admin/user/test-alert', async (req, res) => {
  const data = req.body || {};
  const uname = (data.username || '').trim();
  const botToken = (data.bot_token || '').trim();
  const chatId = (data.chat_id || '').trim();

  if (!botToken || !chatId) {
    return res.status(400).json({ msg: 'Bot Token and Chat ID are both required!' });
  }

  try {
    const testMsg = `🔔 <b>Telebot Alert System Test</b>\n\n` +
      `✅ Hello! Telegram alert notifications have been configured by Admin for user: <b>${uname || 'Unknown'}</b>.\n\n` +
      `⚡ You will receive real-time updates for:\n` +
      `• Daily DM & Extraction milestones\n` +
      `• Telegram FloodWait pauses\n` +
      `• Session login/logout events\n\n` +
      `🕒 <i>Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)</i>`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: testMsg,
        parse_mode: 'HTML'
      })
    });

    const json = await response.json();
    if (json.ok) {
      return res.json({ msg: '✅ Test notification sent successfully to Telegram!' });
    } else {
      return res.status(400).json({ msg: `❌ Telegram API error: ${json.description || 'Invalid token or chat ID'}` });
    }
  } catch (err) {
    return res.status(500).json({ msg: `❌ Failed to send test alert: ${err?.message || err}` });
  }
});

async function permanentlyDeleteUser(uname: string): Promise<void> {
  const normUname = uname.trim();
  console.log(`[PERMANENT DELETE USER] Deleting user "${normUname}" and all associated data from VPS...`);

  // 1. Find all accounts belonging to this user and permanently delete them
  const userAccounts = Array.from(accounts.values()).filter(
    (a) => (a.owner || 'admin').toLowerCase() === normUname.toLowerCase()
  );
  for (const acc of userAccounts) {
    await permanentlyDeleteAccount(acc.phone);
  }

  // 2. Remove user from usersList and persist users.json
  const userIdx = usersList.findIndex((u) => u.username.toLowerCase() === normUname.toLowerCase());
  if (userIdx !== -1) {
    usersList.splice(userIdx, 1);
    saveUsers();
  }

  // 2.5. Preserve and transfer any remaining user-level queue, sent data, and peer files to Admin before deletion
  if (normUname.toLowerCase() !== 'admin') {
    try {
      const uSent = getOwnerSentUsers(normUname);
      const adminSent = getOwnerSentUsers('admin');
      for (const uid of uSent) adminSent.add(uid);
      ownerSentCache.set('admin', adminSent);
      fs.writeFileSync(path.join(__dirname, `sent_owner_admin.json`), JSON.stringify(Array.from(adminSent)), 'utf8');

      const uPeers = getOwnerPeers(normUname);
      const adminPeers = getOwnerPeers('admin');
      for (const [k, v] of uPeers.entries()) adminPeers.set(k, v);
      saveOwnerPeers('admin', adminPeers);

      const uVerifiedQ = getOwnerVerifiedQueue(normUname);
      if (uVerifiedQ.length > 0) {
        addToOwnerVerifiedQueue('admin', uVerifiedQ);
      }
      console.log(`[PERMANENT DELETE USER] Transferred ${uSent.size} Sent, ${uVerifiedQ.length} Genuine Queue, and ${uPeers.size} Peers from user "${normUname}" to Admin.`);
    } catch (e) {
      console.error(`[PERMANENT DELETE USER] Error preserving data to admin:`, e);
    }
  }

  // 3. Delete user-level queue and sent files from disk
  const userFiles = [
    path.join(__dirname, `sent_owner_${normUname}.json`),
    path.join(__dirname, `skipped_owner_${normUname}.json`),
    path.join(__dirname, `skipped_db_owner_${normUname}.json`),
    path.join(__dirname, `raw_queue_owner_${normUname}.json`),
    path.join(__dirname, `verified_queue_owner_${normUname}.json`),
    path.join(__dirname, `queue_owner_${normUname}.json`),
    path.join(__dirname, `peers_owner_${normUname}.json`)
  ];
  for (const f of userFiles) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        console.log(`[PERMANENT DELETE USER] Deleted file: ${f}`);
      }
    } catch {}
  }

  // 4. Clean user caches from memory
  ownerSentCache.delete(normUname);
  ownerSkippedCache.delete(normUname);
  ownerSkippedDetailsCache.delete(normUname);
  ownerPeersCache.delete(normUname);
  ownerRawQueueCache.delete(normUname);
  ownerRawReservedUids.delete(normUname);
  ownerVerifiedQueueCache.delete(normUname);
  ownerVerifiedReservedUids.delete(normUname);
  delete (dailyDmHistory as any)[normUname];
  delete (aiDmHistory as any)[normUname];

  // 5. Clean any slot requests from this user
  if (Array.isArray(slotRequests)) {
    slotRequests = slotRequests.filter((r) => r.username.toLowerCase() !== normUname.toLowerCase());
    saveSlotRequests();
  }

  // 6. Clean from billing user configs
  if (billingStore.user_configs && billingStore.user_configs[normUname]) {
    delete billingStore.user_configs[normUname];
    saveBillingLocal();
  }

  saveAccountsJson();
}

app.post('/api/admin/user/delete', async (req: any, res: any) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  }
  const rawUname = req.body?.username;
  if (!rawUname) return res.status(400).json({ ok: false, msg: 'Username is required!' });
  const uname = String(rawUname).trim();
  if (uname.toLowerCase() === 'admin') return res.status(400).json({ ok: false, msg: 'Admin cannot be deleted!' });

  // Auto-stop any running accounts for this user before deletion
  const userAccounts = Array.from(accounts.values()).filter((a) => (a.owner || 'admin').toLowerCase() === uname.toLowerCase());
  for (const a of userAccounts) {
    a.running = false;
    a.status = 'Stopped';
    if (a.abortController) {
      try { a.abortController.abort(); } catch {}
    }
  }

  await permanentlyDeleteUser(uname);
  broadcastAccountUpdate('admin');
  res.json({ ok: true, success: true, msg: `User "${uname}" and all associated data permanently deleted from Server & Backend Storage!` });
});

app.post('/api/admin/user/renew-subscription', async (req: any, res: any) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  }
  const { username, days, rate_per_bot, max_accounts, mark_paid, payment_mode, notes } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, msg: 'Username is required!' });
  const u = getUser(username);
  if (!u) return res.status(404).json({ ok: false, msg: 'User not found!' });

  const renewDays = Math.max(1, parseInt(days, 10) || 7);
  const botsCount = max_accounts !== undefined ? Math.max(1, parseInt(max_accounts, 10) || 5) : (u.max_accounts ?? 5);
  const rate = rate_per_bot !== undefined ? Math.max(1, Number(rate_per_bot) || 15) : (u.rate_per_bot || 15);
  const totalAmount = Math.round(rate * botsCount * (renewDays / 7));

  const todayStr = getTodayDateString();
  let baseMs = Date.now();
  if (u.expiry_date && u.expiry_date > todayStr) {
    try {
      const parts = u.expiry_date.split('-');
      if (parts.length === 3) {
        baseMs = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)).getTime();
      }
    } catch {}
  }
  const nextExpMs = baseMs + (renewDays * 86400 * 1000) + (5.5 * 3600 * 1000);
  const newExpDate = new Date(nextExpMs).toISOString().split('T')[0];

  u.expiry_date = newExpDate;
  u.active = true;
  u.rate_per_bot = rate;
  u.max_accounts = botsCount;
  saveUsers();

  if (!billingStore.user_configs) billingStore.user_configs = {};
  billingStore.user_configs[u.username] = {
    rate_per_bot: rate,
    rate_per_day: rate,
    max_accounts: botsCount,
    billing_model: u.billing_model || 'advance',
    notes: `${botsCount} Bots @ ₹${rate}/bot/day`
  };
  saveBillingLocal();

  const isPaid = mark_paid !== false;
  const desc = `${renewDays}-Day Plan (${botsCount} Bots x ₹${rate}/bot = ₹${totalAmount})`;
  addBillingInvoice({
    username: u.username,
    date: todayStr,
    amount: totalAmount,
    type: 'weekly_plan',
    description: desc + (notes ? ` - ${notes}` : ''),
    bots_count: botsCount,
    days_count: renewDays,
    status: isPaid ? 'paid' : 'due'
  });

  if (isPaid) {
    addBillingPayment({
      username: u.username,
      date: todayStr,
      amount: totalAmount,
      mode: payment_mode || 'UPI',
      reference: 'Renewal-' + todayStr,
      note: `${desc} Payment Received`
    });
  }

  broadcastAccountUpdate(u.username);
  broadcastAccountUpdate('admin');
  res.json({
    ok: true,
    success: true,
    msg: `Successfully renewed ${u.username} for ${renewDays} days! New expiry: ${newExpDate}. Invoice of ₹${totalAmount} recorded.`,
    expiry_date: newExpDate,
    rate_per_bot: rate,
    max_accounts: botsCount,
    amount: totalAmount
  });
});

app.post('/api/admin/change-password', (req, res) => {
  const data = req.body || {};
  const currentUsername = req.session?.username || 'admin';
  const me = getUser(currentUsername) || getUser('admin');
  if (!me) return res.status(401).json({ msg: 'Session error, please login again!' });

  if (!verifyVal(me.password, data.old_password || '')) {
    return res.status(401).json({ msg: 'Old password is wrong!' });
  }

  const nextPwd = (data.new_password || '').trim();
  if (nextPwd.length < 6) {
    return res.json({ msg: 'New password must be at least 6 characters!' });
  }

  me.password = hashVal(nextPwd);
  saveUsers();
  res.json({ ok: true, success: true, msg: 'Password changed successfully! Remember your new password.' });
});

app.get('/api/admin/profile', (req, res) => {
  const adminUser = usersList.find((u: any) => u.role === 'admin' || u.username === 'admin');
  const adminName = adminUser?.admin_name || adminUser?.display_name || 'Admin';
  res.json({ admin_name: adminName });
});

app.get('/api/public/admin-contact', async (req, res) => {
  const adminUser = usersList.find((u: any) => u.role === 'admin' || u.username === 'admin');
  let botUsername = (adminUser as any)?.alert_bot_username || cachedAdminBotUsername || '';
  const token = (adminUser?.alert_bot_token || '').trim();
  if (!botUsername && token) {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(3500) });
      const data: any = await resp.json();
      if (data?.ok && data?.result?.username) {
        botUsername = data.result.username;
        (adminUser as any).alert_bot_username = botUsername;
        cachedAdminBotUsername = botUsername;
        saveUsers();
      }
    } catch (e) {}
  }
  const telegramUrl = botUsername ? `https://t.me/${botUsername}?start=register` : (adminUser?.telegram_username ? `https://t.me/${adminUser.telegram_username}` : '');
  res.json({ ok: true, bot_username: botUsername, telegram_url: telegramUrl });
});

app.post('/api/telegram-webhook', async (req, res) => {
  const adminUser = usersList.find((u: any) => u.role === 'admin');
  const token = (req.query.token as string) || (adminUser?.alert_bot_token || '').trim();
  if (!token) return res.status(400).json({ ok: false, msg: 'No bot token configured!' });
  try {
    await handleTelegramUpdate(token, req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message });
  }
});

app.post('/api/admin/profile', (req, res) => {
  const adminUser = usersList.find((u: any) => u.role === 'admin' || u.username === 'admin');
  if (!adminUser) return res.status(404).json({ msg: 'Admin user not found!' });
  if (req.body?.admin_name !== undefined) {
    const newName = (req.body.admin_name || '').trim();
    if (newName) {
      adminUser.admin_name = newName;
      adminUser.display_name = newName;
    }
  }
  if (req.body?.custom_web_url !== undefined) {
    let rawUrl = (req.body.custom_web_url || '').trim();
    if (rawUrl && !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
      rawUrl = 'https://' + rawUrl;
    }
    adminUser.custom_web_url = rawUrl.replace(/\/$/, '');
  }
  saveUsers();
  res.json({
    ok: true,
    msg: 'Profile & Live Website URL updated successfully!',
    admin_name: adminUser.admin_name,
    custom_web_url: adminUser.custom_web_url || '',
    active_login_url: getWebLoginUrl()
  });
});

app.get('/api/admin/system-domain', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const adminUser = usersList.find((u: any) => u.role === 'admin' || u.username === 'admin');
  res.json({
    ok: true,
    custom_web_url: adminUser?.custom_web_url || '',
    active_login_url: getWebLoginUrl(),
    detected_host: globalDetectedWebUrl || ''
  });
});

