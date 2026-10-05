// ---------------- DEMO USER MANAGEMENT API ----------------
app.post('/api/admin/billing/grant-demo', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { username, days, max_accounts, notes } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, msg: 'Username is required!' });

  const u = getUser(username);
  if (!u) return res.status(404).json({ ok: false, msg: 'User not found in system!' });

  const demoDays = Math.max(1, parseInt(days, 10) || 1);
  const nowMs = Date.now();
  const expDateStr = new Date(nowMs + demoDays * 86400 * 1000).toISOString().split('T')[0];

  // Set user properties
  u.active = true;
  u.expiry_date = expDateStr;
  (u as any).is_demo = true;
  if (max_accounts) u.max_accounts = Math.max(1, parseInt(max_accounts, 10) || 1);

  // Set billing properties: demo rate is 0 by default so no unwanted debt accumulates during trial
  if (!billingStore.user_configs) billingStore.user_configs = {};
  billingStore.user_configs[username] = {
    rate_per_day: 0,
    is_demo: true,
    demo_expiry: expDateStr,
    demo_days: demoDays,
    notes: notes || `Free Demo (${demoDays} Day Trial)`
  };

  saveUsers();
  saveBillingLocal();

  if (u.alert_enabled) {
    sendTelegramAlert(u.username, `🎁 <b>Free Demo Activated!</b>\nYour trial is active for <b>${demoDays} day(s)</b> until <b>${expDateStr}</b>. You can run up to ${u.max_accounts} bot(s).`);
  }

  res.json({
    ok: true,
    msg: `✅ Demo activated for @${username}! Validity: ${demoDays} day(s) (until ${expDateStr}). Rate set to ₹0/day.`,
    user: {
      username: u.username,
      expiry_date: u.expiry_date,
      is_demo: true,
      max_accounts: u.max_accounts
    }
  });
});

app.post('/api/admin/billing/convert-demo-to-paid', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { username, rate_per_day, add_days, invoice_amount, notes } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, msg: 'Username is required!' });

  const u = getUser(username);
  if (!u) return res.status(404).json({ ok: false, msg: 'User not found!' });

  const rate = Math.max(0, Number(rate_per_day) || billingStore.settings.default_rate_per_day || 15);
  const extensionDays = parseInt(add_days, 10) || 30;

  let curExpMs = Date.now();
  if (u.expiry_date) {
    const parsed = new Date(u.expiry_date + 'T23:59:59Z').getTime();
    if (!isNaN(parsed) && parsed > curExpMs) curExpMs = parsed;
  }
  const newExpDateStr = new Date(curExpMs + extensionDays * 86400 * 1000).toISOString().split('T')[0];

  u.active = true;
  u.expiry_date = newExpDateStr;
  (u as any).is_demo = false;

  if (!billingStore.user_configs) billingStore.user_configs = {};
  billingStore.user_configs[username] = {
    rate_per_day: rate,
    is_demo: false,
    notes: notes || 'Converted from Demo to Paid Customer'
  };

  // If initial invoice specified, create charge now
  const invAmt = Number(invoice_amount) || 0;
  if (invAmt > 0) {
    addBillingInvoice({
      username,
      date: getTodayDateString(),
      amount: invAmt,
      type: 'plan_charge',
      description: `Plan Subscription (${extensionDays} Days) - Activated from Demo`
    });
  }

  saveUsers();
  saveBillingLocal();

  if (u.alert_enabled) {
    sendTelegramAlert(u.username, `🎉 <b>Account Activated & Shifted to Paid Plan!</b>\nValidity extended by <b>+${extensionDays} days</b> until <b>${newExpDateStr}</b> at ₹${rate}/day.`);
  }

  res.json({
    ok: true,
    msg: `🎉 User @${username} converted to Paid! Extended by ${extensionDays} days (Expiry: ${newExpDateStr}) at ₹${rate}/day.`,
    user: {
      username: u.username,
      expiry_date: u.expiry_date,
      is_demo: false
    }
  });
});

app.post('/api/admin/billing/sync-users', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  
  // Reload users and accounts from disk if available
  loadUsersLocal();
  loadAccountsLocal();
  loadBillingLocal();

  const defRate = billingStore.settings.default_rate_per_day || 15;
  let addedCount = 0;

  // Scan all users
  for (const u of usersList) {
    if (!u || !u.username) continue;
    const uname = (u.username || '').toString().trim();
    if (uname.toLowerCase() === 'admin' || (u.role && u.role === 'admin')) continue;
    if (!billingStore.user_configs[uname]) {
      billingStore.user_configs[uname] = { rate_per_day: defRate, notes: 'Auto-synced from panel users' };
      addedCount++;
    }
  }

  // Scan accounts owners
  for (const acc of Array.from(accounts.values())) {
    const owner = (acc.owner || '').toString().trim();
    if (owner && owner.toLowerCase() !== 'admin' && !billingStore.user_configs[owner]) {
      billingStore.user_configs[owner] = { rate_per_day: defRate, notes: 'Auto-synced from account owner' };
      addedCount++;
    }
  }

  saveBillingLocal();
  const total = Object.keys(billingStore.user_configs).length;
  res.json({ ok: true, synced: addedCount, total_users: total, msg: `Synced successfully! Found ${total} panel user(s).` });
});

app.get('/api/admin/billing/overview', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  try {
    autoSyncAllUsersIntoBilling();
    accrueDailyUsageForAllUsers();
  } catch(e) {}
  const startDate = String(req.query.start_date || '');
  const endDate = String(req.query.end_date || '');
  const filterUser = String(req.query.username || '').trim().toLowerCase();

  let filteredInvoices = billingStore.invoices;
  let filteredPayments = billingStore.payments;

  if (filterUser) {
    filteredInvoices = filteredInvoices.filter(i => (i.username || '').toLowerCase() === filterUser);
    filteredPayments = filteredPayments.filter(p => (p.username || '').toLowerCase() === filterUser);
  }

  if (startDate) {
    filteredInvoices = filteredInvoices.filter(i => (i.date || '') >= startDate);
    filteredPayments = filteredPayments.filter(p => (p.date || '') >= startDate);
  }

  if (endDate) {
    filteredInvoices = filteredInvoices.filter(i => (i.date || '') <= endDate);
    filteredPayments = filteredPayments.filter(p => (p.date || '') <= endDate);
  }

  const userLedgers: any[] = [];
  // Gather all unique users from usersList, accounts, and existing billing records
  const seenUsernames = new Set<string>();
  const allUsersMap = new Map<string, any>();

  // 1. From active usersList
  for (const u of usersList) {
    if (!u || !u.username) continue;
    const uname = (u.username || '').toString().trim();
    if (uname.toLowerCase() === 'admin' || (u.role && u.role === 'admin')) continue;
    seenUsernames.add(uname);
    allUsersMap.set(uname, {
      username: uname,
      display_name: u.display_name || uname,
      max_accounts: u.max_accounts || 1,
      expiry_date: u.expiry_date || ''
    });
  }

  // 2. From all accounts (owners)
  for (const acc of Array.from(accounts.values())) {
    const owner = (acc.owner || '').toString().trim();
    if (owner && owner.toLowerCase() !== 'admin' && !seenUsernames.has(owner)) {
      seenUsernames.add(owner);
      allUsersMap.set(owner, {
        username: owner,
        display_name: owner,
        max_accounts: 1,
        expiry_date: ''
      });
    }
  }

  // 3. From billing user configs & invoices
  for (const uname of Object.keys(billingStore.user_configs || {})) {
    if (uname && uname.toLowerCase() !== 'admin' && !seenUsernames.has(uname)) {
      seenUsernames.add(uname);
      allUsersMap.set(uname, {
        username: uname,
        display_name: uname,
        max_accounts: 1,
        expiry_date: ''
      });
    }
  }
  for (const inv of (billingStore.invoices || [])) {
    const uname = (inv.username || '').toString().trim();
    if (uname && uname.toLowerCase() !== 'admin' && !seenUsernames.has(uname)) {
      seenUsernames.add(uname);
      allUsersMap.set(uname, {
        username: uname,
        display_name: uname,
        max_accounts: 1,
        expiry_date: ''
      });
    }
  }

  const panelUsers = Array.from(allUsersMap.values());
  
  for (const u of panelUsers) {
    const uname = u.username;
    const summary = getUserLedgerSummary(uname);
    const cfg = billingStore.user_configs[uname] || { rate_per_day: billingStore.settings.default_rate_per_day || 15 };
    const accs = Array.from(accounts.values()).filter(a => (a.owner || 'admin') === uname);
    
    const isDemo = Boolean(cfg.is_demo || (u && (u as any).is_demo));
    const isExpired = Boolean(u.expiry_date && getTodayDateString() > u.expiry_date);
    let derivedStatus = 'settled';
    if (isDemo) {
      derivedStatus = isExpired ? 'demo_expired' : 'demo_active';
    } else if (summary.balance_due > 0) {
      derivedStatus = isExpired ? 'overdue' : 'due';
    } else if (summary.balance_due < 0) {
      derivedStatus = 'advance';
    }

    userLedgers.push({
      username: uname,
      display_name: u.display_name || uname,
      telegram_id: u.alert_chat_id || u.telegram_id || '',
      telegram_username: u.telegram_username || '',
      active_accounts: accs.length,
      max_accounts: u.max_accounts || 1,
      expiry_date: u.expiry_date || '',
      rate_per_day: cfg.rate_per_day || 15,
      rate_per_bot: cfg.rate_per_bot || 15,
      billing_cycle_days: cfg.billing_cycle_days || 7,
      payment_model: cfg.payment_model || 'postpaid',
      total_billed: summary.total_billed,
      total_paid: summary.total_paid,
      balance_due: summary.balance_due,
      is_demo: isDemo,
      is_active: Boolean(u.active !== false),
      payment_paused: Boolean((u as any).payment_paused),
      status: derivedStatus
    });
  }

  const totalBilledEver = billingStore.invoices.reduce((a, b) => a + Number(b.amount || 0), 0);
  const realPaymentsEver = billingStore.payments.filter(p => p.mode !== 'OFFER_DISCOUNT' && !(p as any).is_offer);
  const totalPaidEver = realPaymentsEver.reduce((a, b) => a + Number(b.amount || 0), 0);
  const totalMarketDue = userLedgers.reduce((a, b) => a + Number(b.balance_due || 0), 0);

  const rangeBilled = filteredInvoices.reduce((a, b) => a + Number(b.amount || 0), 0);
  const rangeReceived = filteredPayments.filter(p => p.mode !== 'OFFER_DISCOUNT' && !(p as any).is_offer).reduce((a, b) => a + Number(b.amount || 0), 0);

  const isDateFiltered = Boolean(startDate || endDate);
  const displayCollected = isDateFiltered ? rangeReceived : totalPaidEver;
  const displayBilled = isDateFiltered ? rangeBilled : totalBilledEver;

  const allOffers = billingStore.offers || [];
  let filteredOffers = allOffers;
  if (filterUser) filteredOffers = filteredOffers.filter(o => (o.username || '').toLowerCase() === filterUser);
  if (startDate) filteredOffers = filteredOffers.filter(o => (o.date || '') >= startDate);
  if (endDate) filteredOffers = filteredOffers.filter(o => (o.date || '') <= endDate);

  const totalOffersAmount = filteredOffers.reduce((a, b) => a + Number(b.discount_amount || 0), 0);
  const totalOffersDays = filteredOffers.reduce((a, b) => a + Number(b.bonus_days || 0), 0);
  const offersCount = filteredOffers.length;
  const uniqueOfferUsers = new Set(filteredOffers.map(o => (o.username || '').toLowerCase())).size;

  res.json({
    ok: true,
    currency: billingStore.settings.default_currency || 'INR',
    default_rate_per_day: billingStore.settings.default_rate_per_day || 15,
    metrics: {
      is_date_filtered: isDateFiltered,
      total_market_due: Math.round(totalMarketDue),
      total_collected_ever: Math.round(displayCollected),
      lifetime_collected: Math.round(totalPaidEver),
      total_billed_ever: Math.round(displayBilled),
      lifetime_billed: Math.round(totalBilledEver),
      total_offers_amount: Math.round(totalOffersAmount),
      total_offers_days: Math.round(totalOffersDays),
      offers_count: offersCount,
      offers_users_count: uniqueOfferUsers,
      range_billed: Math.round(rangeBilled),
      range_received: Math.round(rangeReceived),
      active_billed_users: panelUsers.length
    },
    user_ledgers: userLedgers,
    invoices: filteredInvoices.slice(0, 150),
    payments: filteredPayments.slice(0, 150),
    offers: filteredOffers.slice(0, 100),
    downtimes: billingStore.downtimes.slice(0, 50)
  });
});

app.post('/api/admin/billing/set-rate', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { username, rate_per_bot, rate_per_day, notes } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, msg: 'Username is required!' });

  const u = getUser(username);
  const newRate = Number(rate_per_bot) || Number(rate_per_day) || 10;

  if (u) {
    u.rate_per_bot = newRate;
    saveUsers();
  }

  if (!billingStore.user_configs) billingStore.user_configs = {};
  if (!billingStore.user_configs[username]) billingStore.user_configs[username] = {} as any;
  billingStore.user_configs[username].rate_per_bot = newRate;
  billingStore.user_configs[username].rate_per_day = newRate;
  if (notes) billingStore.user_configs[username].notes = notes;

  const bots = u?.max_accounts || billingStore.user_configs[username].max_accounts || 1;
  const newTotal = Math.round(newRate * bots);

  if (Array.isArray(billingStore.invoices)) {
    const activeInv = billingStore.invoices
      .slice()
      .reverse()
      .find(i => i.username === username && (i.type === 'weekly_plan' || i.type === 'subscription'));

    if (activeInv) {
      activeInv.amount = newTotal;
      activeInv.bots_count = bots;
      activeInv.description = `${activeInv.days_count || 7}-Day Plan (${bots} IDs x ₹${newRate}/bot = ₹${newTotal})`;
    }
  }

  saveBillingLocal();
  res.json({ ok: true, msg: `Rate updated for user ${username}: ₹${newRate}/bot.` });
});


