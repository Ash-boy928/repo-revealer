// ---------------- ADMIN CUSTOMER ACCESS / ONBOARDING REQUESTS ----------------
app.get('/api/admin/access-requests', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const formatted = accessRequests.map((r: any) => ({
    ...r,
    customer_name: r.full_name,
    telegram_chat_id: r.chat_id,
    bot_count: r.bots_count,
    created_at: r.requested_at
  }));
  res.json({ ok: true, success: true, requests: formatted, pending: formatted.filter((r: any) => r.status === 'pending') });
});

app.post('/api/admin/access-request/approve', async (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { id } = req.body || {};
  const item = accessRequests.find((r) => r.id === id);
  if (!item) return res.status(404).json({ ok: false, msg: 'Request not found!' });
  if (item.status !== 'pending') return res.json({ ok: false, msg: `Request is already ${item.status}!` });

  const adminUser = usersList.find((u: any) => u.role === 'admin');
  const botToken = adminUser?.alert_bot_token || '';
  const webLoginUrl = getWebLoginUrl();

  // A. VALIDITY EXTENSION APPROVAL
  if (item.type === 'extend_validity') {
    const u = getUser(item.target_username || '');
    if (!u) return res.status(404).json({ ok: false, msg: `Target user "${item.target_username}" not found!` });

    const days = Number(item.validity_days || 30);
    let curExpMs = Date.now() + 5.5 * 3600 * 1000;
    if (u.expiry_date) {
      const parsed = new Date(u.expiry_date + 'T23:59:59Z').getTime();
      if (!isNaN(parsed) && parsed > curExpMs) curExpMs = parsed;
    }
    const newExpMs = curExpMs + (days * 86400 * 1000);
    const newExpDateStr = new Date(newExpMs).toISOString().split('T')[0];

    u.expiry_date = newExpDateStr;
    u.active = true;
    saveUsers();
    // Auto-Billing Hook: Validity Extension
    try {
      const userRate = getUserEffectiveRate(u.username);
      const userBots = Number(u.max_accounts || 1);
      const extCost = days * userRate * userBots;
      addBillingInvoice({
        username: u.username,
        date: getTodayDateString(),
        type: 'extend_validity',
        description: `Validity Renewal (+${days} Days for ${userBots} IDs @ ₹${userRate}/day)`,
        bots_count: userBots,
        days_count: days,
        amount: extCost,
        status: 'due'
      });
    } catch (e) {
      console.error('[BILLING HOOK ERROR]', e);
    }

    item.status = 'approved';
    item.resolved_at = Date.now();
    item.resolved_by = 'Admin Web Panel';
    saveAccessRequests();

    if (botToken && item.chat_id) {
      const custMsg = `🎉 <b>Account Validity Extension Approved!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Your account validity has been successfully extended by Administrator.\n\n` +
        `👤 <b>Username:</b> <code>${u.username}</code>\n` +
        `⏳ <b>Added Validity:</b> <b>+${days} Days</b>\n` +
        `📅 <b>New Expiry Date:</b> <b>${formatDisplayDate(newExpDateStr)}</b>\n\n` +
        `🌐 <b>Dashboard:</b> ${webLoginUrl}`;
      sendTelegramMessage(botToken, item.chat_id, custMsg, [
        [{ text: '🌐 Open Dashboard', url: webLoginUrl }]
      ]).catch(() => {});
    }

    return res.json({
      ok: true,
      success: true,
      msg: `Validity extended by +${days} days for "${u.username}". New Expiry: ${formatDisplayDate(newExpDateStr)}.`,
      username: u.username,
      expiry_date: newExpDateStr
    });
  }

  // B. EXTRA BOTS QUOTA APPROVAL
  if (item.type === 'add_bots') {
    const u = getUser(item.target_username || '');
    if (!u) return res.status(404).json({ ok: false, msg: `Target user "${item.target_username}" not found!` });

    const added = Number(item.bots_count || 1);
    u.max_accounts = Number(u.max_accounts || 1) + added;
    saveUsers();
    // Auto-Billing Hook: Extra Bot Slots (Prorated for remaining days)
    try {
      const userRate = getUserEffectiveRate(u.username);
      let remDays = 30;
      if (u.expiry_date) {
        const expMs = new Date(u.expiry_date + 'T23:59:59Z').getTime();
        const nowMs = Date.now();
        if (expMs > nowMs) {
          remDays = Math.max(1, Math.ceil((expMs - nowMs) / (86400 * 1000)));
        }
      }
      const slotCost = added * userRate * remDays;
      addBillingInvoice({
        username: u.username,
        date: getTodayDateString(),
        type: 'add_bots',
        description: `Added +${added} Bot Slots (${remDays} days remaining in cycle @ ₹${userRate}/day)`,
        bots_count: added,
        days_count: remDays,
        amount: slotCost,
        status: 'due'
      });
    } catch (e) {
      console.error('[BILLING HOOK ERROR]', e);
    }

    item.status = 'approved';
    item.resolved_at = Date.now();
    item.resolved_by = 'Admin Web Panel';
    saveAccessRequests();

    if (botToken && item.chat_id) {
      const custMsg = `🎉 <b>Extra Bot Slots Approved!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Your bot slot quota has been successfully increased by Administrator.\n\n` +
        `👤 <b>Username:</b> <code>${u.username}</code>\n` +
        `➕ <b>Added Slots:</b> <b>+${added} Accounts</b>\n` +
        `🤖 <b>New Total Quota:</b> <b>${u.max_accounts} Bots</b>\n\n` +
        `You can now login to your dashboard and connect your new Telegram accounts!\n` +
        `🌐 <b>Dashboard:</b> ${webLoginUrl}`;
      sendTelegramMessage(botToken, item.chat_id, custMsg, [
        [{ text: '🌐 Open Dashboard', url: webLoginUrl }]
      ]).catch(() => {});
    }

    return res.json({
      ok: true,
      success: true,
      msg: `Approved +${added} extra bot slots for "${u.username}". Total Quota: ${u.max_accounts} Bots.`,
      username: u.username,
      max_accounts: u.max_accounts
    });
  }

  // C. NEW USER ACCOUNT CREATION
  // 1. Generate unique username
  let base = (item.telegram_username || item.full_name || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 12);
  if (!base || base.length < 3) base = 'user';
  let generatedUsername = base;
  let attempt = 0;
  while (usersList.some((u: any) => (u.username || '').toLowerCase() === generatedUsername.toLowerCase())) {
    attempt++;
    generatedUsername = `${base}${Math.floor(100 + Math.random() * 900)}`;
    if (attempt > 50) {
      generatedUsername = `user_${Date.now().toString().slice(-5)}`;
      break;
    }
  }

  // 2. Generate secure temporary password
  const generatedPassword = 'Tele@' + Math.floor(1000 + Math.random() * 9000);

  // 3. Compute Expiry Date (IST) - 7 Days (1-Week Billing)
  const initialBots = Math.max(1, Number(req.body?.bots_count) || Number(item.bots_count || 1));
  const ratePerBot = Number(req.body?.rate_per_bot) || Number(item.rate_per_bot) || 10;
  const planModel = req.body?.payment_model || item.payment_model || 'postpaid';
  const cycleDays = 7;
  const planCost = Math.round(initialBots * ratePerBot);

  const expDateMs = Date.now() + 5.5 * 3600 * 1000 + (cycleDays * 86400 * 1000);
  const expDateStr = new Date(expDateMs).toISOString().split('T')[0];

  // 4. Create User
  const newUser: any = {
    username: generatedUsername,
    password: hashVal(generatedPassword),
    role: 'user',
    active: true,
    max_accounts: initialBots,
    max_targets: 9999,
    expiry_date: expDateStr,
    rate_per_bot: ratePerBot,
    billing_model: planModel,
    billing_cycle_days: cycleDays,
    registered_phones: [],
    security_question: 'What is your registered mobile number?',
    security_answer: hashVal((item.phone || '').trim()),
    alert_enabled: true,
    alert_bot_token: botToken,
    alert_chat_id: item.chat_id,
    display_name: item.full_name
  };

  usersList.push(newUser);
  saveUsers();

  // Auto-Billing Hook: New Account 7-Day Plan
  try {
    if (!billingStore.user_configs) billingStore.user_configs = {};
    billingStore.user_configs[generatedUsername] = {
      rate_per_bot: ratePerBot,
      rate_per_day: ratePerBot,
      max_accounts: initialBots,
      billing_cycle_days: cycleDays,
      payment_model: planModel,
      notes: `${initialBots} Bots @ ₹${ratePerBot}/bot/day (${cycleDays} Days ${planModel})`
    };

    addBillingInvoice({
      username: generatedUsername,
      date: getTodayDateString(),
      type: 'weekly_plan',
      description: `${cycleDays}-Day ${planModel === 'postpaid' ? 'Postpaid' : 'Advance'} Plan (${initialBots} IDs x ₹${ratePerBot}/bot = ₹${planCost})`,
      bots_count: initialBots,
      days_count: cycleDays,
      amount: planCost,
      status: 'due'
    });
    saveBillingLocal();
  } catch (e) {
    console.error('[BILLING HOOK ERROR]', e);
  }
  broadcastAccountUpdate('admin');

  item.status = 'approved';
  item.resolved_at = Date.now();
  item.resolved_by = 'Admin Web Panel';
  item.created_username = generatedUsername;
  item.created_password = generatedPassword;
  item.rate_per_bot = ratePerBot;
  item.payment_model = planModel;
  saveAccessRequests();

  // 5. Dispatch Telegram alert to customer in easy English
  if (botToken && item.chat_id) {
    const customerMsg = `🎉 <b>Congratulations! Your TeleBot Account is Approved!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Your account login credentials and subscription details:\n\n` +
      `👤 <b>Username:</b> <code>${generatedUsername}</code>\n` +
      `🔑 <b>Password:</b> <code>${generatedPassword}</code>\n` +
      `🌐 <b>Login URL:</b> ${webLoginUrl}\n\n` +
      `📋 <b>Subscription Terms:</b>\n` +
      `• <b>Allowed Bots:</b> ${initialBots} Bot(s)\n` +
      `• <b>Rate Per Bot:</b> ₹${ratePerBot} / bot\n` +
      `• <b>Weekly Bill:</b> ₹${planCost}\n` +
      `• <b>Billing Plan:</b> ${planModel === 'postpaid' ? '7-Day Postpaid (Payment due on 8th day)' : '7-Day Advance Plan'}\n` +
      `• <b>Valid Till:</b> ${formatDisplayDate(expDateStr)} (7 Days)\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💳 <i>Send <code>/bill</code> anytime to view your live balance and invoices.</i>\n` +
      `🔒 <i>For your security, please login and change your password.</i>`;

    sendTelegramMessage(botToken, item.chat_id, customerMsg, [
      [{ text: '🌐 Open Website & Login', url: webLoginUrl }],
      [{ text: '📊 View My Bill / Ledger', callback_data: `cust_view_bill:${generatedUsername}` }]
    ]).catch(() => {});
  }

  res.json({
    ok: true,
    success: true,
    msg: `Approved! Created user: "${generatedUsername}" with password "${generatedPassword}". Credentials sent to customer Telegram.`,
    username: generatedUsername,
    password: generatedPassword,
    expiry_date: expDateStr
  });
});

app.post('/api/admin/access-request/reject', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { id } = req.body || {};
  const item = accessRequests.find((r) => r.id === id);
  if (!item) return res.status(404).json({ ok: false, msg: 'Request not found!' });
  if (item.status !== 'pending') return res.json({ ok: false, msg: `Request is already ${item.status}!` });

  item.status = 'rejected';
  item.resolved_at = Date.now();
  item.resolved_by = 'Admin Web Panel';
  saveAccessRequests();

  const adminUser = usersList.find((u: any) => u.role === 'admin');
  const botToken = adminUser?.alert_bot_token || '';
  if (botToken && item.chat_id) {
    const custRejectMsg = item.type === 'extend_validity'
      ? `⚠️ <b>Validity Extension Request Update</b>\n\nYour request for validity extension was not approved at this time.\nFor questions or further assistance, please contact the Administrator directly.`
      : item.type === 'add_bots'
      ? `⚠️ <b>Extra Bot Slots Request Update</b>\n\nYour request for additional bot slots was not approved at this time.\nFor custom quotas or plan details, please contact the Administrator directly.`
      : `⚠️ <b>Account Access Request Update</b>\n\nYour new user access request was not approved by the Administrator.\nIf you have any questions or wish to discuss subscription plans, please reach out to the Administrator.`;

    sendTelegramMessage(botToken, item.chat_id, custRejectMsg).catch(() => {});
  }

  res.json({ ok: true, msg: `Rejected request for ${item.full_name}.` });
});

app.post('/api/admin/view-as', (req         , res          ) => {
  const uname = (req.body?.username || '').trim();
  if (!uname) {
    if (req.session) req.session.view_as = null;
    return res.json({ msg: 'Back to admin view' });
  }

  const u = getUser(uname);
  if (!u) return res.json({ msg: 'User not found!' });
  if (uname !== req.session?.username && !u.active) {
    return res.json({ msg: 'User is disabled, activate them first!' });
  }

  if (req.session) {
    req.session.view_as = uname;
  }
  res.json({ msg: `Now opening "${uname}" dashboard...` });
});

