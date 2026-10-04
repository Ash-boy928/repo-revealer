// ---------------- OVERDUE FREEZE & MANUAL PAUSE CONTROL ----------------
app.post('/api/admin/billing/toggle-pause', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { username, paused, reason } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, msg: 'Username required!' });

  const u = getUser(username);
  if (!u) return res.status(404).json({ ok: false, msg: 'User not found!' });

  const shouldPause = paused !== undefined ? Boolean(paused) : !(u as any).payment_paused;
  (u as any).payment_paused = shouldPause;
  if (shouldPause) {
    // Stop running bots
    for (const a of accounts.values()) {
      if ((a.owner || 'admin') === username && a.running) {
        a.running = false;
        if (a.abortController) a.abortController.abort();
        a.status = 'Paused (Payment Overdue)';
        log(a.phone, 'FAIL', `Bot paused by admin due to payment overdue. Reason: ${reason || 'Payment pending'}`);
      }
    }
  }
  saveUsers();
  broadcastAccountUpdate(username);

  res.json({
    ok: true,
    msg: shouldPause ? `⏸️ User @${username} bots PAUSED due to overdue payment!` : `▶️ User @${username} bots UNPAUSED & ACTIVE!`,
    payment_paused: shouldPause
  });
});

let cachedAdminBotUsername = '';
async function getAdminBotUsername(): Promise<string> {
  if (cachedAdminBotUsername) return cachedAdminBotUsername;
  const adminUser = usersList.find((x: any) => x.role === 'admin' && (x.alert_bot_token || '').trim());
  if (!adminUser) return '';
  const token = adminUser.alert_bot_token.trim();
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (data?.ok && data.result?.username) {
      cachedAdminBotUsername = data.result.username;
      return cachedAdminBotUsername;
    }
  } catch (e) {}
  return '';
}

app.get('/api/user/telegram-link', async (req, res) => {
  const username = getEffectiveUser(req);
  if (!username) {
    return res.status(401).json({ ok: false, msg: 'Unauthorized' });
  }
  const u = getUser(username);
  
  // Prefer user's own configured filter_bot_token or alert_bot_token, fallback to system admin bot
  let userBotToken = (u?.master_config?.filter_bot_token || (u as any)?.filter_bot_token || u?.alert_bot_token || '').trim();
  let botUsername = '';
  if (userBotToken) {
    try {
      const bRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(userBotToken)}/getMe`);
      const bData: any = await bRes.json().catch(() => null);
      if (bData?.ok && bData.result?.username) {
        botUsername = bData.result.username;
      }
    } catch {}
  }
  if (!botUsername) {
    botUsername = await getAdminBotUsername();
  }

  const isLinked = Boolean(u && (u.alert_chat_id || u.telegram_id));
  const linkUrl = botUsername ? ('https://t.me/' + botUsername + '?start=link_' + username) : '';
  return res.json({
    ok: true,
    username: username,
    bot_username: botUsername,
    link_url: linkUrl,
    is_linked: isLinked,
    telegram_id: u?.alert_chat_id || u?.telegram_id || '',
    telegram_username: u?.telegram_username || ''
  });
});

app.post('/api/admin/user/set-telegram-id', (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser || sessionUser.role !== 'admin') {
    return res.status(403).json({ ok: false, msg: 'Admin privileges required' });
  }
  const { username, telegram_id } = req.body || {};
  if (!username) {
    return res.status(400).json({ ok: false, msg: 'Username is required' });
  }
  const u = usersList.find((x: any) => x.username === username);
  if (!u) {
    return res.status(404).json({ ok: false, msg: 'User not found' });
  }
  const cleanId = (telegram_id || '').toString().trim();
  u.alert_chat_id = cleanId;
  u.telegram_id = cleanId;
  saveUsers();
  return res.json({ ok: true, msg: `Telegram ID for ${username} updated to ${cleanId || 'None'}` });
});

app.post('/api/admin/billing/send-reminder', async (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser || sessionUser.role !== 'admin') {
    return res.status(403).json({ ok: false, msg: 'Admin privileges required' });
  }
  const { username } = req.body || {};
  if (!username) {
    return res.status(400).json({ ok: false, msg: 'Username is required' });
  }
  const result = await sendUserBillingReminder(username);
  return res.json(result);
});

app.post('/api/admin/billing/record-payment', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { username, amount, mode, reference, note, extend_validity, auto_extend_expiry, extend_days } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, msg: 'Username is required!' });
  const payAmt = Number(amount);
  if (isNaN(payAmt) || payAmt <= 0) return res.status(400).json({ ok: false, msg: 'Valid positive amount required!' });

  const result = applyPaymentAndCheckAutoExtend(username, payAmt, mode || 'UPI', note || '', reference || '');

  // User ka due agar raha to auto extend par tick rehne se bhi day extend NAHI hoga!
  // Expiry ONLY extends when all dues are cleared (balance_due <= 0)
  if (result.summary && Number(result.summary.balance_due || 0) > 0) {
    result.extended = false;
  } else if (!result.extended && (extend_validity || auto_extend_expiry)) {
    // Only if balance due is 0 or advance, manual days can be added
    const extDays = Math.max(1, Number(extend_days) || 7);
    const u = getUser(username);
    if (u) {
      let curExpMs = Date.now() + 5.5 * 3600 * 1000;
      if (u.expiry_date) {
        const parsed = new Date(u.expiry_date + 'T23:59:59Z').getTime();
        if (!isNaN(parsed) && parsed > curExpMs) curExpMs = parsed;
      }
      const newExpMs = curExpMs + (extDays * 86400 * 1000);
      u.expiry_date = new Date(newExpMs).toISOString().split('T')[0];
      u.active = true;
      (u as any).payment_paused = false;
      saveUsers();
      result.msg += ` ⚡ Validity extended by +${extDays} Days to ${formatDisplayDate(u.expiry_date)}!`;
      result.newExpiry = u.expiry_date;
      result.extended = true;
    }
  }

  res.json({
    ok: true,
    msg: result.msg,
    payment: result.payment,
    summary: result.summary,
    extended: result.extended,
    new_expiry: result.newExpiry
  });
});

// Apply Offer, Promotional Discount, or Bonus Free Days
app.post('/api/admin/billing/apply-offer', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { username, offer_name, discount_amount, bonus_days, note } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, msg: 'Username is required!' });
  const u = getUser(username);
  if (!u) return res.status(404).json({ ok: false, msg: 'User not found!' });

  let actionsDone = [];
  const discAmt = Number(discount_amount) || 0;
  const bDays = Number(bonus_days) || 0;

  if (discAmt <= 0 && bDays <= 0) {
    return res.status(400).json({ ok: false, msg: 'Please provide either discount amount (₹) or bonus days!' });
  }

  if (!Array.isArray(billingStore.offers)) {
    billingStore.offers = [];
  }

  const newOffer: BillingOffer = {
    id: 'off_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900),
    username: u.username,
    offer_name: (offer_name || '').trim() || (discAmt > 0 && bDays > 0 ? 'Discount + Validity Offer' : (discAmt > 0 ? 'Discount Offer' : 'Bonus Validity Offer')),
    discount_amount: discAmt,
    bonus_days: bDays,
    note: note || '',
    date: getTodayDateString(),
    created_at: Date.now()
  };
  billingStore.offers.unshift(newOffer);

  if (discAmt > 0) {
    actionsDone.push(`₹${discAmt} Discount Deducted from Due`);
  }

  if (bDays > 0) {
    let curExpMs = Date.now() + 5.5 * 3600 * 1000;
    if (u.expiry_date) {
      const parsed = new Date(u.expiry_date + 'T23:59:59Z').getTime();
      if (!isNaN(parsed) && parsed > curExpMs) curExpMs = parsed;
    }
    const newExpMs = curExpMs + (bDays * 86400 * 1000);
    u.expiry_date = new Date(newExpMs).toISOString().split('T')[0];
    u.active = true;
    saveUsers();
    actionsDone.push(`+${bDays} Bonus Days (New Expiry: ${u.expiry_date})`);
  }

  saveBillingLocal();
  const summary = getUserLedgerSummary(username);
  res.json({
    ok: true,
    msg: `🎁 Offer "${newOffer.offer_name}" applied to ${username}! [${actionsDone.join(' | ')}]. Remaining Balance Due: ₹${summary.balance_due}`,
    summary,
    offer: newOffer
  });
});

app.post('/api/admin/billing/create-invoice', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { username, amount, description, type, date } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, msg: 'Username is required!' });
  const invAmt = Number(amount);
  if (isNaN(invAmt) || invAmt === 0) return res.status(400).json({ ok: false, msg: 'Valid amount required!' });

  const invDate = date || getTodayDateString();
  const invoice = addBillingInvoice({
    username,
    date: invDate,
    amount: invAmt,
    type: type || 'custom_charge',
    description: description || 'Manual Charge / Adjustment',
    status: 'due'
  });

  const summary = getUserLedgerSummary(username);
  res.json({
    ok: true,
    msg: `Invoice of ₹${invAmt} created for ${username}. Total balance due: ₹${summary.balance_due}`,
    invoice,
    summary
  });
});

// 1-Week Quick Invoice Generator
app.post('/api/admin/billing/create-weekly-invoice', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { username, rate_per_bot, rate_per_day, bots_count, note, start_date } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, msg: 'Username is required!' });

  const u = getUser(username);
  const userAccs = Array.from(accounts.values()).filter(a => (a.owner || 'admin') === username);
  const activeBots = Number(bots_count) || (userAccs.length > 0 ? userAccs.length : (u?.max_accounts || 1));

  let weeklyTotal = 0;
  let rateDesc = '';

  const rpb = Number(rate_per_bot) || Number(rate_per_day) || Number((u as any)?.rate_per_bot) || getUserEffectiveRate(username) || 10;
  weeklyTotal = Math.round(rpb * 7 * activeBots);
  rateDesc = `₹${rpb}/bot/day (₹${rpb * 7}/bot/week)`;

  const startDateStr = start_date || getTodayDateString();
  const startMs = new Date(startDateStr + 'T00:00:00Z').getTime();
  const endMs = startMs + (6 * 86400 * 1000);
  const endDateStr = new Date(endMs).toISOString().split('T')[0];

  const desc = `1-Week Plan (${activeBots} ID${activeBots > 1 ? 's' : ''} x ${rateDesc} = ₹${weeklyTotal}) [${startDateStr} to ${endDateStr}]${note ? ' - ' + note : ''}`;

  const invoice = addBillingInvoice({
    username,
    date: startDateStr,
    amount: weeklyTotal,
    type: 'weekly_plan',
    description: desc,
    bots_count: activeBots,
    days_count: 7,
    status: 'due'
  });

  const summary = getUserLedgerSummary(username);
  res.json({
    ok: true,
    msg: `1-Week invoice of ₹${weeklyTotal} generated for ${username} (${startDateStr} to ${endDateStr}). Balance due: ₹${summary.balance_due}`,
    invoice,
    summary
  });
});

// 🌟 7-Day Cycle & Start Date Setup Engine for Existing Users (100% Interconnected & Auto-Recalculating)
app.post('/api/admin/billing/setup-user-cycle', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { username, start_date, payment_model, rate_per_bot, allowed_bots, mark_paid, recalculate_history } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, msg: 'Username is required!' });

  const u = getUser(username);
  if (!u) return res.status(404).json({ ok: false, msg: 'User not found!' });

  const rate = Math.max(1, Number(rate_per_bot) || Number((u as any).rate_per_bot) || 10);
  const model = (payment_model || (u as any).billing_model || 'postpaid').toLowerCase();
  const startDateStr = (start_date || getTodayDateString()).trim();

  // 1-Week (7 days) cycle calculation
  const startParts = startDateStr.split('-');
  const startYear = parseInt(startParts[0], 10);
  const startMonth = parseInt(startParts[1], 10) - 1;
  const startDay = parseInt(startParts[2], 10);

  const startObj = new Date(Date.UTC(startYear, startMonth, startDay, 0, 0, 0));
  const day7Obj = new Date(startObj.getTime() + (6 * 86400 * 1000));
  const day7Str = day7Obj.toISOString().split('T')[0];

  // 2-Day grace period (e.g. 8 Oct -> 9 Oct)
  const graceObj = new Date(startObj.getTime() + (8 * 86400 * 1000));
  const graceUntilStr = graceObj.toISOString().split('T')[0];

  if (allowed_bots) {
    u.max_accounts = Math.max(1, parseInt(allowed_bots, 10) || 1);
  }
  (u as any).rate_per_bot = rate;
  u.expiry_date = day7Str;
  (u as any).billing_start_date = startDateStr;
  (u as any).billing_model = model;
  (u as any).billing_cycle_days = 7;
  (u as any).grace_period_until = graceUntilStr;
  (u as any).payment_paused = false;
  saveUsers();

  if (!billingStore.user_configs) billingStore.user_configs = {};
  billingStore.user_configs[username] = {
    rate_per_bot: rate,
    rate_per_day: rate,
    billing_start_date: startDateStr,
    billing_cycle_days: 7,
    payment_model: model,
    max_accounts: u.max_accounts || 1,
    notes: `Cycle: ${startDateStr} to ${day7Str} (Grace till ${graceUntilStr}) @ ₹${rate}/bot/day`
  };

  const liveBots = getUserLiveBotsCount(username) || u.max_accounts || 1;
  const todayStr = getTodayDateString();

  // If recalculate_history is enabled (default true when editing), remove old daily usage invoices in current active span
  const shouldRecalc = recalculate_history !== false;
  if (shouldRecalc) {
    billingStore.invoices = billingStore.invoices.filter(inv => {
      if ((inv.username || '').toLowerCase() !== username.toLowerCase()) return true;
      if (inv.type === 'daily_usage' || inv.type === 'weekly_plan_daily') {
        return false; // Remove outdated daily records so we cleanly backfill at new rate
      }
      return true;
    });
  }

  let elapsedDaysCount = 0;
  if (model === 'postpaid') {
    // Backfill daily usage day by day from startDateStr up to todayStr (capped at day 7)
    let curTime = startObj.getTime();
    const todayParts = todayStr.split('-');
    const todayObj = new Date(Date.UTC(parseInt(todayParts[0], 10), parseInt(todayParts[1], 10) - 1, parseInt(todayParts[2], 10), 0, 0, 0));
    const endTime = Math.min(todayObj.getTime(), day7Obj.getTime());

    while (curTime <= endTime && elapsedDaysCount < 7) {
      const dStr = new Date(curTime).toISOString().split('T')[0];
      elapsedDaysCount++;
      const alreadyBilled = billingStore.invoices.some(
        inv => (inv.username || '').toLowerCase() === username.toLowerCase() &&
               inv.date === dStr &&
               (inv.type === 'daily_usage' || inv.type === 'weekly_plan_daily')
      );
      if (!alreadyBilled) {
        const dailyAmt = liveBots * rate;
        addBillingInvoice({
          username: u.username,
          date: dStr,
          amount: dailyAmt,
          type: 'daily_usage',
          description: `Daily Usage (Day ${elapsedDaysCount} of 7): ${liveBots} Live Bot(s) @ ₹${rate}/bot/day = ₹${dailyAmt}`,
          bots_count: liveBots,
          days_count: 1,
          status: 'due'
        });
      }
      curTime += 86400 * 1000;
    }
  } else {
    // Advance (Prepaid): 7-Day Plan upfront
    const planTotal = liveBots * rate * 7;
    const isPaid = Boolean(mark_paid);
    addBillingInvoice({
      username: u.username,
      date: startDateStr,
      amount: planTotal,
      type: 'weekly_plan',
      description: `1-Week Advance Plan (${liveBots} Bot(s) @ ₹${rate}/bot/day x 7 Days = ₹${planTotal}) [${startDateStr} to ${day7Str}]`,
      bots_count: liveBots,
      days_count: 7,
      status: isPaid ? 'paid' : 'due'
    });
    if (isPaid) {
      addBillingPayment({
        username: u.username,
        date: startDateStr,
        amount: planTotal,
        mode: 'UPI',
        reference: 'Advance Signup',
        note: `1-Week Advance Paid (${liveBots} Bots @ ₹${rate}/bot/day)`
      });
    }
  }

  saveBillingLocal();
  const summary = getUserLedgerSummary(username);

  res.json({
    ok: true,
    msg: `✅ Customer ${username} cycle updated! Cycle: ${startDateStr} to ${day7Str} (Grace till ${graceUntilStr}). Rate: ₹${rate}/bot/day (${elapsedDaysCount || 1}/7 Days elapsed). Balance due: ₹${summary.balance_due}`,
    start_date: startDateStr,
    expiry_date: day7Str,
    grace_period_until: graceUntilStr,
    live_bots: liveBots,
    rate_per_bot: rate,
    model,
    elapsed_days: elapsedDaysCount || 1,
    summary
  });
});

// 💼 Extra Service Fee / Add-on Service Endpoint (Completely isolated from Regular Bot Due)
app.post('/api/admin/billing/extra-service/add', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { username, service_title, amount, date, note, mark_paid, payment_mode } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, msg: 'Username is required!' });
  
  const numAmt = Number(amount);
  if (isNaN(numAmt) || numAmt <= 0) {
    return res.status(400).json({ ok: false, msg: 'Valid positive amount required for extra service!' });
  }

  const sTitle = (service_title || 'Custom Service / Add-on').trim();
  const sDate = (date || getTodayDateString()).trim();
  const isPaid = Boolean(mark_paid);

  const invoice = addBillingInvoice({
    username,
    date: sDate,
    amount: numAmt,
    type: 'extra_service',
    description: `💼 Extra Service: ${sTitle}${note ? ' — ' + note : ''}`,
    status: isPaid ? 'paid' : 'due'
  });

  if (isPaid) {
    addBillingPayment({
      username,
      date: sDate,
      amount: numAmt,
      mode: payment_mode || 'UPI',
      reference: `Extra Service: ${sTitle}`,
      note: `💼 Extra Service Payment: "${sTitle}" (Non-deductible from Bot Usage)`,
      is_extra_service: true
    });
  }

  saveBillingLocal();
  const summary = getUserLedgerSummary(username);

  res.json({
    ok: true,
    msg: `💼 Extra Service "${sTitle}" (₹${numAmt}) ${isPaid ? 'recorded & marked PAID' : 'added to user extra due'}!`,
    invoice,
    summary
  });
});

// Edit existing billing entry (Invoice, Payment, or Offer)
app.post('/api/admin/billing/entry/edit', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { entry_type, id, username, amount, date, description, note, mode, reference, offer_name, bonus_days } = req.body || {};

  if (!id || !entry_type) {
    return res.status(400).json({ ok: false, msg: 'Entry ID and entry_type (invoice|payment|offer) required!' });
  }

  const numAmt = Number(amount);

  if (entry_type === 'invoice') {
    if (isNaN(numAmt) || numAmt === 0) return res.status(400).json({ ok: false, msg: 'Valid non-zero amount required!' });
    const inv = billingStore.invoices.find(i => i.id === id);
    if (!inv) return res.status(404).json({ ok: false, msg: 'Invoice record not found!' });
    if (username) inv.username = username.trim();
    inv.amount = numAmt;
    if (date) inv.date = date;
    if (description !== undefined) inv.description = description;
    saveBillingLocal();
    const summary = getUserLedgerSummary(inv.username);
    return res.json({
      ok: true,
      msg: `Invoice updated successfully! User "${inv.username}" balance due: ₹${summary.balance_due}`,
      updated: inv,
      summary
    });
  } else if (entry_type === 'payment') {
    if (isNaN(numAmt) || numAmt <= 0) return res.status(400).json({ ok: false, msg: 'Valid positive amount required!' });
    const pay = billingStore.payments.find(p => p.id === id);
    if (!pay) return res.status(404).json({ ok: false, msg: 'Payment record not found!' });
    if (username) pay.username = username.trim();
    pay.amount = Math.abs(numAmt);
    if (date) pay.date = date;
    if (mode) pay.mode = mode;
    if (reference !== undefined) pay.reference = reference;
    if (note !== undefined) pay.note = note;
    saveBillingLocal();
    const summary = getUserLedgerSummary(pay.username);
    return res.json({
      ok: true,
      msg: `Payment updated successfully! User "${pay.username}" balance due: ₹${summary.balance_due}`,
      updated: pay,
      summary
    });
  } else if (entry_type === 'offer') {
    if (!Array.isArray(billingStore.offers)) billingStore.offers = [];
    const off = billingStore.offers.find(o => o.id === id);
    if (!off) return res.status(404).json({ ok: false, msg: 'Offer record not found!' });
    if (username) off.username = username.trim();
    if (amount !== undefined) off.discount_amount = Math.max(0, Number(amount) || 0);
    if (bonus_days !== undefined) off.bonus_days = Math.max(0, Number(bonus_days) || 0);
    if (offer_name !== undefined) off.offer_name = (offer_name || '').trim() || 'Special Offer';
    if (date) off.date = date;
    if (note !== undefined) off.note = note;
    saveBillingLocal();
    const summary = getUserLedgerSummary(off.username);
    return res.json({
      ok: true,
      msg: `Offer updated successfully! User "${off.username}" balance due: ₹${summary.balance_due}`,
      updated: off,
      summary
    });
  } else {
    return res.status(400).json({ ok: false, msg: 'Invalid entry_type. Must be "invoice", "payment", or "offer"' });
  }
});

// Delete existing billing entry (Invoice, Payment, or Offer)
app.post('/api/admin/billing/entry/delete', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { entry_type, id } = req.body || {};

  if (!id || !entry_type) {
    return res.status(400).json({ ok: false, msg: 'Entry ID and entry_type (invoice|payment|offer) required!' });
  }

  if (entry_type === 'invoice') {
    const idx = billingStore.invoices.findIndex(i => i.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, msg: 'Invoice not found!' });
    const target = billingStore.invoices[idx];
    billingStore.invoices.splice(idx, 1);
    saveBillingLocal();
    const summary = getUserLedgerSummary(target.username);
    return res.json({
      ok: true,
      msg: `Deleted invoice of ₹${target.amount} for ${target.username}. New balance due: ₹${summary.balance_due}`,
      summary
    });
  } else if (entry_type === 'payment') {
    const idx = billingStore.payments.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, msg: 'Payment not found!' });
    const target = billingStore.payments[idx];
    billingStore.payments.splice(idx, 1);
    saveBillingLocal();
    const summary = getUserLedgerSummary(target.username);
    return res.json({
      ok: true,
      msg: `Deleted payment of ₹${target.amount} for ${target.username}. New balance due: ₹${summary.balance_due}`,
      summary
    });
  } else if (entry_type === 'offer') {
    if (!Array.isArray(billingStore.offers)) billingStore.offers = [];
    const idx = billingStore.offers.findIndex(o => o.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, msg: 'Offer not found!' });
    const target = billingStore.offers[idx];
    billingStore.offers.splice(idx, 1);
    saveBillingLocal();
    const summary = getUserLedgerSummary(target.username);
    return res.json({
      ok: true,
      msg: `Deleted offer "${target.offer_name}" for ${target.username}. New balance due: ₹${summary.balance_due}`,
      summary
    });
  } else {
    return res.status(400).json({ ok: false, msg: 'Invalid entry_type' });
  }
});

app.post('/api/admin/billing/compensate', async (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { scope, target_username, target_phone, action_type, days_count, rupee_amount, reason } = req.body || {};
  const todayStr = getTodayDateString();

  if (action_type === 'add_days') {
    const days = Number(days_count) || 1;
    if (days <= 0) return res.status(400).json({ ok: false, msg: 'Invalid number of days!' });

    if (scope === 'global') {
      let count = 0;
      for (const u of usersList) {
        if (u.role === 'admin' || !u.expiry_date) continue;
        let curExpMs = new Date(u.expiry_date + 'T23:59:59Z').getTime();
        if (isNaN(curExpMs) || curExpMs < Date.now()) curExpMs = Date.now();
        const newExpMs = curExpMs + (days * 86400 * 1000);
        u.expiry_date = new Date(newExpMs).toISOString().split('T')[0];
        count++;
      }
      saveUsers();
      billingStore.downtimes.unshift({
        id: 'down_' + Date.now(),
        date: todayStr,
        created_at: Date.now(),
        affected_scope: 'global',
        action_type: 'add_days',
        amount: days,
        reason: reason || 'Global server downtime compensation'
      });
      saveBillingLocal();
      return res.json({ ok: true, msg: `Compensated all ${count} panel users with +${days} extra days validity!` });
    } else {
      const u = getUser(target_username || '');
      if (!u) return res.status(404).json({ ok: false, msg: 'User not found!' });
      let curExpMs = u.expiry_date ? new Date(u.expiry_date + 'T23:59:59Z').getTime() : Date.now();
      if (isNaN(curExpMs) || curExpMs < Date.now()) curExpMs = Date.now();
      const newExpMs = curExpMs + (days * 86400 * 1000);
      u.expiry_date = new Date(newExpMs).toISOString().split('T')[0];
      saveUsers();
      billingStore.downtimes.unshift({
        id: 'down_' + Date.now(),
        date: todayStr,
        created_at: Date.now(),
        affected_scope: target_phone ? 'single_account' : 'single_user',
        target_username,
        target_phone,
        action_type: 'add_days',
        amount: days,
        reason: reason || 'Service issue compensation'
      });
      saveBillingLocal();
      return res.json({ ok: true, msg: `Extended ${target_username}'s plan by +${days} extra days. New Expiry: ${u.expiry_date}` });
    }
  } else if (action_type === 'rupee_credit') {
    const credit = Number(rupee_amount) || 0;
    if (credit <= 0) return res.status(400).json({ ok: false, msg: 'Invalid credit amount!' });

    if (scope === 'global') {
      const panelUsers = usersList.filter(u => u.role !== 'admin');
      for (const u of panelUsers) {
        addBillingInvoice({
          username: u.username,
          date: todayStr,
          amount: -credit,
          type: 'compensation_discount',
          description: `Server Maintenance Credit: ${reason || 'Global Downtime'}`,
          status: 'paid'
        });
      }
      billingStore.downtimes.unshift({
        id: 'down_' + Date.now(),
        date: todayStr,
        created_at: Date.now(),
        affected_scope: 'global',
        action_type: 'rupee_credit',
        amount: credit,
        reason: reason || 'Global server downtime rupee discount'
      });
      saveBillingLocal();
      return res.json({ ok: true, msg: `Deducted ₹${credit} credit from all ${panelUsers.length} user balances!` });
    } else {
      const u = getUser(target_username || '');
      if (!u) return res.status(404).json({ ok: false, msg: 'User not found!' });
      addBillingInvoice({
        username: u.username,
        date: todayStr,
        amount: -credit,
        type: 'compensation_discount',
        description: `Compensation Credit (${target_phone || 'Issue'}): ${reason || 'Admin fault adjustment'}`,
        status: 'paid'
      });
      billingStore.downtimes.unshift({
        id: 'down_' + Date.now(),
        date: todayStr,
        created_at: Date.now(),
        affected_scope: target_phone ? 'single_account' : 'single_user',
        target_username,
        target_phone,
        action_type: 'rupee_credit',
        amount: credit,
        reason: reason || 'Account issue credit'
      });
      saveBillingLocal();
      const sum = getUserLedgerSummary(u.username);
      return res.json({ ok: true, msg: `Deducted ₹${credit} compensation from ${u.username}'s bill. Current due: ₹${sum.balance_due}` });
    }
  }
  return res.status(400).json({ ok: false, msg: 'Invalid compensation parameters!' });
});

