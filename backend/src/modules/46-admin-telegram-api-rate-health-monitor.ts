// ---------------- ADMIN TELEGRAM API RATE & HEALTH MONITOR ----------------
app.get('/api/admin/rate-monitor', (req: any, res: any) => {
  const me = getUser(req.session?.username || '');
  if (!me || me.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Super Admin required.' });
  }

  const allAccounts = Array.from(accounts.values());
  const monitorData = allAccounts.map(acc => {
    const owner = acc.owner || 'admin';
    const stats = getAccountRateStats(acc.phone);
    return {
      phone: acc.phone,
      label: acc.label || acc.config?.display_name || acc.phone,
      owner,
      username: acc.username || (acc.config?.display_name || ''),
      running: Boolean(acc.running),
      status: acc.status || 'Stopped',
      daily_extracted: (acc as any).daily_extracted_count || 0,
      daily_sent: (acc as any).daily_sent_count || 0,
      total_sent: acc.sent_count || 0,
      rpm: stats.rpm,
      callsLast5Min: stats.callsLast5Min,
      dmsLast1Min: stats.dmsLast1Min,
      healthStatus: stats.healthStatus,
      healthLabel: stats.healthLabel,
      safeColor: stats.safeColor,
      isCustomThrottled: stats.isCustomThrottled,
      throttleSecondsRemaining: stats.throttleSecondsRemaining,
      lastActive: acc.last_active || 0,
      lastCallTs: stats.lastCallTs
    };
  });

  // Calculate system-wide summary metrics
  const totalRpm = monitorData.reduce((sum, item) => sum + item.rpm, 0);
  const totalDmsMin = monitorData.reduce((sum, item) => sum + item.dmsLast1Min, 0);
  const activeBotsCount = monitorData.filter(i => i.running).length;
  const highRiskCount = monitorData.filter(i => i.rpm >= 20 || i.isCustomThrottled).length;

  res.json({
    success: true,
    totalRpm,
    totalDmsMin,
    activeBotsCount,
    totalAccountsCount: monitorData.length,
    highRiskCount,
    accounts: monitorData
  });
});

// 🎨 Global User Dashboard Theme Endpoints
app.get('/api/system/theme', (req, res) => {
  res.json({ ok: true, theme: getGlobalTheme() });
});

app.post('/api/admin/system/theme', (req: any, res: any) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ ok: false, msg: 'Access denied: Admin credentials required.' });
  }
  const theme = String(req.body?.theme || '').trim().toLowerCase();
  const validThemes = ['cyberpunk', 'oled', 'gold', 'crimson', 'emerald', 'light'];
  if (!validThemes.includes(theme)) {
    return res.status(400).json({ ok: false, msg: `Invalid theme. Choose from: ${validThemes.join(', ')}` });
  }
  saveGlobalTheme(theme);
  broadcastAccountUpdate('admin');
  broadcastAccountUpdate('all');
  console.log(`[THEME SWITCH] Super Admin changed global user dashboard theme to "${theme}"`);
  res.json({ ok: true, theme, msg: `🎨 Dashboard theme updated to '${theme.toUpperCase()}'! Applied to all user dashboards.` });
});

// Admin action to manually trigger midnight sent DM transfer sweep
app.post('/api/admin/system/trigger-midnight-sweep', async (req: any, res: any) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ error: 'Access denied: Admin credentials required.' });
  }

  try {
    const moved = await runMidnightQueueTransferSweep(true);
    res.json({
      success: true,
      message: `Midnight sweep executed successfully. Transferred and archived ${moved} sent DM contacts from users to Admin master pool with all peer credentials.`,
      totalMoved: moved
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// Admin action to throttle/pause/resume a specific user's Telegram ID
app.post('/api/admin/rate-monitor/throttle', (req: any, res: any) => {
  const me = getUser(req.session?.username || '');
  if (!me || me.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const { phone, action, seconds } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'Phone number is required.' });

  if (action === 'resume') {
    accountThrottleOverride.delete(phone);
    return res.json({ success: true, msg: `Safe normal mode restored for ${phone}.` });
  } else {
    const duration = parseInt(seconds, 10) || 300; // default 5 mins
    accountThrottleOverride.set(phone, {
      throttled: true,
      reason: 'Admin Emergency Cooldown',
      until: Date.now() + duration * 1000
    });
    return res.json({
      success: true,
      msg: `Account ${phone} paused/slowed down for ${duration} seconds.`
    });
  }
});

