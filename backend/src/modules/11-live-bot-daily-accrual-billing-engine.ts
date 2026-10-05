// ---------------- LIVE BOT & DAILY ACCRUAL BILLING ENGINE ----------------
function getUserLiveBotsCount(username: string): number {
  if (!username) return 0;
  const uname = username.toLowerCase();
  let liveCount = 0;
  for (const a of accounts.values()) {
    if ((a.owner || 'admin').toLowerCase() === uname) {
      liveCount++;
    }
  }
  return liveCount;
}

function getUserDailyRatePerBot(username: string): number {
  const cfg = billingStore.user_configs?.[username];
  const u = getUser(username);
  if (cfg) {
    if (cfg.rate_per_bot && Number(cfg.rate_per_bot) >= 5) {
      return Number(cfg.rate_per_bot);
    }
    if (cfg.rate_per_day && Number(cfg.rate_per_day) >= 5) {
      return Number(cfg.rate_per_day);
    }
  }
  if (u && (u as any).rate_per_bot && Number((u as any).rate_per_bot) >= 5) {
    return Number((u as any).rate_per_bot);
  }
  return Number(billingStore.settings.default_rate_per_day) || 10;
}

function accrueDailyUsageForUser(username: string, dateStr: string = getTodayDateString()): boolean {
  if (!username || username.toLowerCase() === 'admin') return false;
  const u = getUser(username);
  if (!u || u.role === 'admin') return false;

  // Don't accrue if user is payment_paused or completely inactive
  if (!u.active || (u as any).payment_paused) return false;

  // Check if today's daily usage is already logged
  const alreadyBilled = billingStore.invoices.some(
    inv => (inv.username || '').toLowerCase() === username.toLowerCase() &&
           inv.date === dateStr &&
           (inv.type === 'daily_usage' || inv.type === 'weekly_plan_daily')
  );
  if (alreadyBilled) return false;

  const liveBots = getUserLiveBotsCount(username);
  if (liveBots <= 0) return false; // Only charge if user actually has live connected bots!

  const dailyRate = getUserDailyRatePerBot(username);
  const dailyAmount = liveBots * dailyRate;

  addBillingInvoice({
    username: u.username,
    date: dateStr,
    amount: dailyAmount,
    type: 'daily_usage',
    description: `Daily Usage: ${liveBots} Live Bot(s) @ ₹${dailyRate}/bot/day = ₹${dailyAmount}`,
    bots_count: liveBots,
    days_count: 1,
    status: 'due'
  });

  console.log(`[DAILY BILL ACCRUAL] User ${u.username}: +₹${dailyAmount} accrued for ${liveBots} live bots on ${dateStr}`);
  return true;
}

function accrueDailyUsageForAllUsers(dateStr: string = getTodayDateString()): number {
  let count = 0;
  for (const u of usersList) {
    if (u.role === 'admin' || !u.username) continue;
    if (accrueDailyUsageForUser(u.username, dateStr)) {
      count++;
    }
  }
  return count;
}

function applyPaymentAndCheckAutoExtend(
  username: string,
  amount: number,
  mode: string = 'UPI',
  note: string = '',
  reference: string = ''
): { payment: BillingPayment; summary: any; extended: boolean; newExpiry?: string; msg: string } {
  const pay = addBillingPayment({
    username,
    date: getTodayDateString(),
    amount: Math.round(Number(amount)),
    mode: (mode as any) || 'UPI',
    reference: reference || '',
    note: note || ''
  });

  const u = getUser(username);
  const summary = getUserLedgerSummary(username);
  let extended = false;
  let newExpiry = u?.expiry_date;
  let msg = `Payment of ₹${amount} recorded successfully for ${username}.`;

  if (u && u.role !== 'admin') {
    const cfg = billingStore.user_configs?.[username] || {};
    const cycleDays = Number(cfg.billing_cycle_days || u.billing_cycle_days || 7) || 7;

    // Strict Business Logic: Plan Expiry ONLY extends when ALL DUES are fully cleared (balance_due <= 0)
    // If user has any outstanding balance due remaining, plan validity MUST NOT be extended!
    if (summary.balance_due <= 0) {
      let curExpMs = Date.now() + 5.5 * 3600 * 1000;
      if (u.expiry_date) {
        const parsed = new Date(u.expiry_date + 'T23:59:59Z').getTime();
        if (!isNaN(parsed) && parsed > curExpMs) {
          curExpMs = parsed;
        }
      }
      const newExpMs = curExpMs + (cycleDays * 86400 * 1000);
      u.expiry_date = new Date(newExpMs).toISOString().split('T')[0];
      newExpiry = u.expiry_date;
      u.active = true;
      (u as any).payment_paused = false;
      (u as any).grace_period_until = null;
      extended = true;
      saveUsers();

      // If user had stopped/paused bots due to payment, unpause them!
      for (const a of accounts.values()) {
        if ((a.owner || 'admin').toLowerCase() === username.toLowerCase() && a.status === 'Paused (Payment Due)') {
          a.status = 'Ready (Payment Cleared)';
        }
      }

      msg += ` 🎉 All dues cleared! Validity automatically extended by +${cycleDays} Days to ${formatDisplayDate(u.expiry_date)}!`;
      const dateRange = getUserCycleDateRange(u);
      sendTelegramAlert(username, `🎉 <b>Payment Cleared & Plan Extended!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n💵 <b>Amount Paid:</b> ₹${amount.toLocaleString()}\n💳 <b>Current Balance:</b> ₹0 (All Paid)\n📅 <b>Plan Validity:</b> <code>${dateRange.formattedRange}</code>\n⏳ <b>New Expiry Date:</b> <code>${formatDisplayDate(u.expiry_date)}</code> (+${cycleDays} Days Auto-Extended)\n\n⚡ Your bots are active, running, and ready!`).catch(() => null);
    } else {
      // Partial payment: balance_due > 0
      msg += ` Partial payment received. Remaining balance due: ₹${summary.balance_due}. (Plan expiry not extended because outstanding balance is pending).`;
      const dateRange = getUserCycleDateRange(u);
      sendTelegramAlert(username, `💵 <b>Partial Payment Received</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n💵 <b>Amount Paid:</b> <b>₹${amount.toLocaleString()}</b>\n💳 <b>Remaining Due:</b> <b>₹${summary.balance_due.toLocaleString()}</b>\n📅 <b>Current Validity:</b> <code>${dateRange.formattedRange}</code>\n⏳ <b>Expiry Date:</b> <code>${formatDisplayDate(u.expiry_date)}</code>\n\n⚠️ <i>Please clear the remaining balance of ₹${summary.balance_due.toLocaleString()} to automatically extend your plan for the next 1-week cycle.</i>`).catch(() => null);
    }
  }

  saveBillingLocal();
  return { payment: pay, summary, extended, newExpiry, msg };
}

loadBillingLocal();

function autoSyncAllUsersIntoBilling(): number {
  const defRate = billingStore?.settings?.default_rate_per_day || 15;
  let added = 0;
  if (!billingStore.user_configs) billingStore.user_configs = {};

  // 1. Scan usersList
  if (Array.isArray(usersList)) {
    for (const u of usersList) {
      if (!u || !u.username) continue;
      const uname = (u.username || '').toString().trim();
      if (!uname || uname.toLowerCase() === 'admin' || u.role === 'admin') continue;
      if (!billingStore.user_configs[uname]) {
        billingStore.user_configs[uname] = { rate_per_day: defRate, notes: 'Auto-detected user' };
        added++;
      }
    }
  }

  // 2. Scan accounts owners
  try {
    for (const acc of Array.from(accounts.values())) {
      const owner = (acc.owner || '').toString().trim();
      if (owner && owner.toLowerCase() !== 'admin' && !billingStore.user_configs[owner]) {
        billingStore.user_configs[owner] = { rate_per_day: defRate, notes: 'Auto-detected bot owner' };
        added++;
      }
    }
  } catch(e) {}

  if (added > 0) {
    saveBillingLocal();
  }
  return added;
}

interface AccessRequest {
  id: string;
  chat_id: string;
  telegram_username?: string;
  full_name: string;
  phone: string;
  bots_count: number;
  validity_days: number;
  note?: string;
  type?: 'new_user' | 'extend_validity' | 'add_bots';
  target_username?: string;
  requested_at: number;
  status: 'pending' | 'approved' | 'rejected';
  resolved_at?: number;
  resolved_by?: string;
  created_username?: string;
  created_password?: string;
  rate_per_bot?: number;
  payment_model?: string;
  [key: string]: any;
}

let accessRequests: AccessRequest[] = [];

interface CustomerOnboardingSession {
  chat_id: string;
  telegram_username?: string;
  step: 'awaiting_name' | 'awaiting_phone' | 'awaiting_bots' | 'awaiting_validity' | 'confirm' | 'awaiting_custom_bots' | 'awaiting_custom_validity' | 'awaiting_ext_days' | 'awaiting_add_bots';
  type?: 'new_user' | 'extend_validity' | 'add_bots';
  target_username?: string;
  full_name?: string;
  phone?: string;
  bots_count?: number;
  validity_days?: number;
  note?: string;
  updated_at: number;
}
const customerOnboardingSessions = new Map<string, CustomerOnboardingSession>();

function loadAccessRequestsLocal(): boolean {
  try {
    if (fs.existsSync(ACCESS_REQUESTS_FILE)) {
      const raw = fs.readFileSync(ACCESS_REQUESTS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        accessRequests = data;
        return true;
      }
    }
  } catch (e) {}
  return false;
}

function saveAccessRequestsLocal() {
  try {
    fs.writeFileSync(ACCESS_REQUESTS_FILE, JSON.stringify(accessRequests, null, 2), 'utf8');
  } catch (e) {}
}

async function loadAccessRequests() {
  loadAccessRequestsLocal();
}

function saveAccessRequests() {
  saveAccessRequestsLocal();
}

function syncUserRegisteredPhones() {
  for (const a of accounts.values()) {
    const owner = (a.owner || 'admin').trim();
    if (!owner || owner === 'admin') continue;
    const u = getUser(owner);
    if (u && a.phone) {
      if (!Array.isArray(u.registered_phones)) u.registered_phones = [];
      if (!u.registered_phones.includes(a.phone)) {
        u.registered_phones.push(a.phone);
      }
    }
  }
}

function loadUsersLocal(): boolean {
  // 1. Try loading from SQLite first
  if (sqliteDb) {
    try {
      const rows = sqliteDb.prepare('SELECT * FROM users').all();
      if (Array.isArray(rows) && rows.length > 0) {
        usersList = rows.map((r: any) => {
          try {
            const u = JSON.parse(r.data_json);
            if (!Array.isArray(u.registered_phones)) u.registered_phones = [];
            return u;
          } catch {
            return {
              username: r.username,
              password: r.password,
              role: r.role,
              active: Boolean(r.active),
              expiry_date: r.expiry_date,
              registered_phones: []
            };
          }
        });
        console.log(`[DATABASE] ${usersList.length} panel user(s) loaded safely from SQLite (telebot.db).`);
        return true;
      }
    } catch (e) {
      console.warn('[DATABASE] SQLite loadUsers error, falling back to JSON:', e);
    }
  }

  // 2. Fallback to users.json (and auto-migrate into SQLite if empty)
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        usersList = data;
        for (const u of usersList) {
          if (!Array.isArray(u.registered_phones)) u.registered_phones = [];
        }
        console.log(`[PRIMARY CACHE] ${usersList.length} panel user(s) loaded from local users.json`);
        // Auto-migrate to SQLite
        if (sqliteDb) {
          try {
            const stmt = sqliteDb.prepare(`INSERT OR REPLACE INTO users (username, password, role, active, expiry_date, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            for (const u of usersList) {
              stmt.run(u.username, u.password || '', u.role || 'user', u.active ? 1 : 0, u.expiry_date || '', JSON.stringify(u), Date.now());
            }
            console.log(`[MIGRATION] Successfully auto-migrated ${usersList.length} users into SQLite.`);
          } catch {}
        }
        return true;
      }
    }
  } catch (e) {}
  return false;
}

async function loadUsers() {
  const loadedFromDisk = loadUsersLocal();

  if (!loadedFromDisk && usersList.length === 0) {
    usersList = [
      {
        username: 'admin',
        password: hashVal(ADMIN_PASSWORD),
        role: 'admin',
        active: true,
        max_accounts: 9999,
        max_targets: 9999,
        registered_phones: [],
        ai_enabled: true,
        security_question: "What was your first school's name?",
        security_answer: hashVal('admin')
      }
    ];
    saveUsersLocal();
    console.log(`Default admin created: admin / ${ADMIN_PASSWORD} (Change it from Admin Panel!)`);
  }
}

function saveUsers() {
  saveUsersLocal();
}

function ensureAdminUser() {
  let admin = usersList.find((u) => (u.username || '').toLowerCase() === 'admin');
  if (!admin) {
    admin = {
      username: 'admin',
      password: hashVal(ADMIN_PASSWORD || 'admin'),
      role: 'admin',
      active: true,
      max_accounts: 9999,
      max_targets: 9999,
      security_question: "What was your first school's name?",
      security_answer: hashVal('admin')
    };
    usersList.unshift(admin);
    saveUsersLocal();
  }
  return admin;
}

function getUser(username        )                        {
  if (!username) return undefined;
  const clean = username.toString().trim().replace(/\s+/g, '').toLowerCase();
  if (clean === 'admin') {
    return ensureAdminUser();
  }
  return usersList.find((u) => (u.username || '').toString().trim().replace(/\s+/g, '').toLowerCase() === clean);
}

// Helper to register slash commands in the Telegram message box [☰ Menu]
const botCommandsRegisteredAt = new Map<string, number>();

async function registerTelegramBotCommands(botToken: string, force: boolean = false) {
  try {
    botToken = (botToken || '').trim();
    if (!botToken) return;

    const lastReg = botCommandsRegisteredAt.get(botToken) || 0;
    // Cache for 30 minutes unless forced
    if (!force && Date.now() - lastReg < 30 * 60 * 1000) {
      return;
    }

    const adminCommands = [
      { command: 'dm', description: '📊 User-wise DM Count (Today & 5-Days)' },
      { command: 'user', description: '👥 Total Users & Validity List' },
      { command: 'khatabook', description: '💳 Pending Dues & Balances' },
      { command: 'pay', description: '💰 Record Payment (e.g. /pay user 105)' },
      { command: 'remind', description: '📢 Send Payment Reminder to User' },
      { command: 'remindall', description: '🚨 Send Reminders to All Due Users' },
      { command: 'pause', description: '⏸️ Pause Bots for User (e.g. /pause user)' },
      { command: 'unpause', description: '▶️ Unpause Bots for User' },
      { command: 'menu', description: '👑 Open Master Admin Console' },
      { command: 'vps', description: '🖥️ Live VPS Health & Specs' },
      { command: 'requests', description: '📋 Pending Signup Requests' }
    ];

    const userCommands = [
      { command: 'mydm', description: '📊 My DM Stats (Today & 5-Days)' },
      { command: 'mybots', description: '📱 My Connected Bots & Status' },
      { command: 'bill', description: '💳 My Khatabook Ledger & Balance' },
      { command: 'payinfo', description: '📲 UPI Payment & Renewal Details' },
      { command: 'menu', description: '🎛️ Open My Bot Control Menu' }
    ];

    // 1. DEFAULT SCOPE (What ALL regular users and customers see globally in [☰ Menu]):
    // Strictly USER COMMANDS ONLY. Admin commands NEVER appear here!
    await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: userCommands,
        scope: { type: 'default' }
      })
    }).catch(() => null);

    // 2. Also set all_private_chats scope to userCommands to ensure no residual admin commands show up
    await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: userCommands,
        scope: { type: 'all_private_chats' }
      })
    }).catch(() => null);

    // 3. ADMIN PERSONAL CHAT SCOPE: ONLY the Admin's registered alert_chat_id gets admin commands!
    const adminUser = usersList.find((u) => u.role === 'admin' && (u.alert_bot_token || '').trim() === botToken);
    const adminChatId = String(adminUser?.alert_chat_id || '').trim();
    if (adminChatId) {
      await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: adminCommands,
          scope: { type: 'chat', chat_id: adminChatId }
        })
      }).catch(() => null);
    }

    botCommandsRegisteredAt.set(botToken, Date.now());
  } catch (e) {}
}

// Global Billing Reminder Helper function:
async function sendUserBillingReminder(username: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const u = usersList.find((x: any) => (x.username || '').toLowerCase() === (username || '').toLowerCase());
    if (!u) return { ok: false, msg: `User "${username}" not found.` };
    
    // Find admin user for bot token
    const adminUser = usersList.find((x: any) => x.role === 'admin' && (x.alert_bot_token || '').trim());
    const adminToken = adminUser ? (adminUser.alert_bot_token || '').trim() : '';

    // Target chat ID or Channel ID
    const targetChatId = (u.alert_chat_id || u.telegram_id || '').toString().trim();
    const targetBotToken = (u.alert_bot_token || '').trim() || adminToken;

    // Refresh daily usage & ledger
    accrueDailyUsageForUser(u.username);
    const uLedger = getUserLedgerSummary(u.username);
    const balanceDue = Number(uLedger.balance_due || 0);
    const curr = (billingStore.currency || 'INR') === 'INR' ? '₹' : '$';
    const dueStr = balanceDue > 0 ? `🔴 ${curr}${balanceDue.toLocaleString()} Due (Pending)` : `🟢 ${curr}0 (Fully Settled)`;

    const uAccs = Array.from(accounts.values()).filter((a: any) => (a.owner || 'admin').toLowerCase() === u.username.toLowerCase());
    const activeBots = uAccs.length;
    const liveBots = uAccs.filter((a: any) => a.running).length;
    const cfg = (billingStore.user_configs || {})[u.username] || {};
    const cycleDays = Number(cfg.billing_cycle_days || u.billing_cycle_days || 7) || 7;
    const paymentModel = cfg.payment_model || u.billing_model || (balanceDue > 0 ? 'postpaid' : 'advance');
    const modelText = paymentModel === 'postpaid' ? `7-Day Postpaid` : `Prepaid (Advance)`;

    const dateRange = getUserCycleDateRange(u);

    // Admin UPI for easy payment
    const adminUpi = (adminUser as any)?.upi_id || (adminUser as any)?.gpay_number || '';
    const webLoginUrl = getWebLoginUrl();

    // Pure Easy English Polite Notification
    const reminderMsg = `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🧾 <b>TELEBOT SUBSCRIPTION & BILLING NOTICE</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Hello <b>${u.display_name || u.username}</b>,\n\n` +
      `Here is the latest billing summary for your TeleBot service:\n\n` +
      `👤 <b>Customer Account:</b> <code>${u.username}</code>\n` +
      `🤖 <b>Connected Bots:</b> <b>${activeBots} / ${u.max_accounts || 1} Allowed</b> (🟢 ${liveBots} Live)\n` +
      `📅 <b>Plan Period:</b> <code>${dateRange.formattedRange}</code>\n` +
      `⏳ <b>Validity Expiry:</b> <b>${formatDisplayDate(u.expiry_date)}</b>\n` +
      `💳 <b>Billing Plan:</b> ${modelText} (${cycleDays} Days Cycle)\n\n` +
      `📊 <b>Financial Status:</b>\n` +
      `• 💵 <b>Total Invoiced:</b> ${curr}${(uLedger.total_billed || 0).toLocaleString()}\n` +
      `• 💰 <b>Total Received:</b> ${curr}${(uLedger.total_paid || 0).toLocaleString()}\n` +
      `• ⚠️ <b>Outstanding Balance Due:</b> <b>${dueStr}</b>\n\n` +
      (balanceDue > 0 
        ? `🔔 <i>Please clear your pending payment of <b>${curr}${balanceDue.toLocaleString()}</b> to ensure uninterrupted direct messaging service.</i>\n\n` +
          (adminUpi ? `💳 <b>Payment UPI ID:</b> <code>${adminUpi}</code>\n` : '') +
          `<i>After completing the payment, please share the transaction screenshot with Administrator for instant verification. Thank you!</i>\n\n`
        : `✅ <i>Your account is active and all dues are cleared. Thank you for your continued business!</i>\n\n`) +
      `🌐 <b>Dashboard:</b> ${webLoginUrl}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    if (targetBotToken && targetChatId) {
      const res = await sendTelegramMessage(targetBotToken, targetChatId, reminderMsg);
      if (res && res.ok) {
        return { ok: true, msg: `✅ Payment reminder sent in English to ${u.username} (Chat ID: ${targetChatId})!` };
      }
    }
    return { ok: false, msg: `⚠️ User ${u.username} does not have a linked Telegram Chat ID or Bot token configured.` };
  } catch (err: any) {
    return { ok: false, msg: err?.message || "Failed to dispatch reminder" };
  }
}

async function sendTelegramMessage(botToken, chatId, text, inlineKeyboard = null, messageIdToEdit = null) {
  botToken = (botToken || '').trim();
  chatId = (chatId || '').trim();
  try {
    if (!botToken || !chatId || !text) return null;
    const isEdit = Boolean(messageIdToEdit);
    const endpoint = isEdit ? 'editMessageText' : 'sendMessage';
    const url = `https://api.telegram.org/bot${botToken}/${endpoint}`;
    
    const payload: any = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    };
    if (isEdit) {
      payload.message_id = messageIdToEdit;
    }
    if (inlineKeyboard && inlineKeyboard.length > 0) {
      payload.reply_markup = { inline_keyboard: inlineKeyboard };
    }
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      console.error(`[TELEGRAM API ERROR]:`, json?.description || 'Unknown error');
    }
    return json;
  } catch (err) {
    console.error(`[TELEGRAM API EXCEPTION]:`, err?.message || err);
    return null;
  }
}

async function answerTelegramCallback(botToken, callbackQueryId, text = '') {
  try {
    if (!botToken || !callbackQueryId) return;
    const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text
      })
    });
  } catch (e) {}
}

async function sendTelegramAlert(username: string, text: string) {
  try {
    if (!username) return;
    const u = getUser(username);
    if (!u) return;
    const adminUser = usersList.find((x: any) => x.role === 'admin' && (x.alert_bot_token || '').trim());
    const adminToken = adminUser ? (adminUser.alert_bot_token || '').trim() : '';
    const botToken = (u.alert_bot_token || '').trim() || adminToken;
    const chatId = (u.alert_chat_id || u.telegram_id || '').toString().trim();
    if (!botToken || !chatId) return;

    await sendTelegramMessage(botToken, chatId, text);
  } catch (err: any) {
    console.error(`[TELEGRAM ALERT ERROR for ${username}]:`, err?.message || err);
  }
}

function userLimits(username        )                   {
  const u = getUser(username);
  if (!u || u.role === 'admin') {
    return [9999, 9999];
  }
  return [Number(u.max_accounts || 5), Number(u.max_targets || 9999)];
}

