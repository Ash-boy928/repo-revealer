// ---------------- TELEGRAM CUSTOMER ONBOARDING BOT FLOW ----------------
async function handleCustomerOnboardingMessage(botToken: string, chatId: string, msg: any, adminUser: any) {
  const rawMsg = (msg.text || '').trim();
  const cleanCmd = (rawMsg.split(' ')[0] || '').toLowerCase().replace(/@.+/, '');

  // Find if sender is an already registered active user
  const existingUser = usersList.find((u: any) =>
    u.role !== 'admin' && (
      String(u.alert_chat_id || '').trim() === String(chatId).trim() ||
      String(u.telegram_id || '').trim() === String(chatId).trim() ||
      (u.telegram_username && (msg.from?.username || '').toLowerCase() === String(u.telegram_username).toLowerCase())
    )
  );

  // --- 1. /bill COMMAND FOR LIVE BILLING STATUS IN EASY ENGLISH ---
  if (cleanCmd === '/bill' || cleanCmd === '/mybill' || cleanCmd === '/balance' || cleanCmd === '/due' || cleanCmd === '/dues' || cleanCmd === '/ledger' || cleanCmd === '/khatabook') {
    await handleCustomerBillCommand(botToken, chatId, msg, adminUser, null, existingUser);
    return;
  }

  // --- 2. /mydm or /mystats COMMAND (User-wise DM Stats & Join Requests) ---
  if (cleanCmd === '/mydm' || cleanCmd === '/dm' || cleanCmd === '/mystats' || cleanCmd === '/today' || cleanCmd === '/stats') {
    if (existingUser) {
      const ov = getOwnerDmOverview(existingUser.username);
      let dmMsg = `📊 <b>My Direct Messaging Performance</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `👤 <b>Account:</b> <code>${existingUser.username}</code>\n` +
                `🤖 <b>Live Bots:</b> 🟢 <b>${ov.liveAccounts} Live</b> / ${ov.totalAccounts} Connected\n` +
                `🔥 <b>Today's Sent DMs:</b> <b>${ov.todayDms} DMs</b>\n` +
                `🎯 <b>Today's Channel Joins:</b> <b>${ov.todayJoins} Joins</b> <i>(${ov.convRate} ROI)</i>\n` +
                `📈 <b>Last 5-Days Total:</b> <b>${ov.sum5DaysDms} DMs</b> ➔ 🎯 <b>${ov.sum5DaysJoins} Joins</b>\n` +
                `⚡ <b>Daily Average:</b> <b>${ov.avgPerDayDms} DMs/day</b>\n` +
                `👑 <b>Lifetime Total Sent:</b> <b>${ov.lifetimeDms} DMs</b> ➔ 🎯 <b>${ov.lifetimeJoins} Joins</b>\n\n`;
      if (ov.stats5Days.length > 0) {
        dmMsg += `📅 <b>Last 5 Days Activity Breakdown:</b>\n`;
        ov.stats5Days.slice(0, 5).forEach((d: any, idx: number) => {
          const jCount = ov.joins5Days[idx]?.join_count || 0;
          dmMsg += `  • <code>${formatDisplayDate(d.date)}</code>: <b>${d.count} DMs</b> ➔ 🎯 <b>${jCount} Joins</b>\n`;
        });
      }
      await sendTelegramMessage(botToken, chatId, dmMsg);
      return;
    } else {
      await sendTelegramMessage(botToken, chatId, `⚠️ <b>Telegram Account Not Linked Yet!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\nYour Telegram (Chat ID: <code>${chatId}</code>) is not yet linked to your TeleBot username.\n\n👉 <b>Link your account right now by sending:</b>\n<code>/link your_username</code>\n\n<b>Example:</b>\n<code>/link ${msg.from?.username || 'test'}</code>\n\n<i>(Or ask Admin to set your Telegram Chat ID in dashboard)</i>`);
      return;
    }
  }

  // --- 3. /mybots or /bots COMMAND (User Connected Bots) ---
  if (cleanCmd === '/mybots' || cleanCmd === '/bots') {
    if (existingUser) {
      const uAccs = Array.from(accounts.values()).filter((a) => (a.owner || 'admin').toLowerCase() === existingUser.username.toLowerCase());
      let botsMsg = `📱 <b>My Connected Telegram Bots (${uAccs.length})</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      if (uAccs.length === 0) {
        botsMsg += `<i>No phone numbers linked yet. Add accounts from the web dashboard.</i>`;
      } else {
        uAccs.forEach((a: any, idx: number) => {
          const status = a.running ? '🟢 Running' : '🔴 Stopped';
          const dms = (a as any).daily_sent_count || 0;
          botsMsg += `<b>${idx + 1}.</b> <code>${a.phone}</code> | ${status} | Today: <b>${dms} DMs</b>\n`;
        });
      }
      await sendTelegramMessage(botToken, chatId, botsMsg);
      return;
    }
  }

  // --- 4. /payinfo or /pay COMMAND (User Payment Details) ---
  if (cleanCmd === '/payinfo' || cleanCmd === '/pay') {
    if (existingUser) {
      const uLedger = (billingStore.user_ledgers || {})[existingUser.username] || {};
      const bal = Number(uLedger.balance_due || 0);
      const curr = (billingStore.currency || 'INR') === 'INR' ? '₹' : '$';
      const dueStr = bal > 0 ? `${curr}${bal.toLocaleString()} Due` : `${curr}0 All Paid`;

      let payMsg = `📲 <b>Payment & Renewal Information</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `💳 <b>Current Outstanding:</b> <b>${dueStr}</b>\n` +
                `⏳ <b>Validity Expiry:</b> <code>${formatDisplayDate(existingUser.expiry_date)}</code>\n\n` +
                `To renew your plan or clear pending dues, please transfer via UPI to Administrator and send payment screenshot here.\n\n` +
                `Need help? Send <code>/menu</code> or tap options below.`;
      await sendTelegramMessage(botToken, chatId, payMsg);
      return;
    }
  }

  // --- 5. STRICT SECURITY RESTRICTION: Non-Admin Users cannot run Admin Commands ---
  const adminOnlyCommands = ['/user', '/users', '/remind', '/remindall', '/pause', '/unpause', '/vps', '/health', '/specs', '/requests', '/req', '/onboard', '/control', '/setdomain', '/domain', '/dmcount', '/dms'];
  if (adminOnlyCommands.includes(cleanCmd)) {
    await sendTelegramMessage(botToken, chatId, `⚠️ <b>Access Restricted:</b> This command is only available to administrators.\n\nUse <code>/menu</code> to open your personal TeleBot control dashboard.`);
    return;
  }

  // --- DEEP-LINK /start link_<username> OR /link <username> ---
  if (rawMsg.startsWith('/start link_') || rawMsg.startsWith('/link ')) {
    let targetUname = '';
    if (rawMsg.startsWith('/start link_')) {
      targetUname = rawMsg.replace('/start link_', '').trim();
    } else {
      targetUname = rawMsg.replace('/link ', '').trim();
    }
    targetUname = targetUname.replace('@', '').toLowerCase();

    const matchedTarget = usersList.find((u: any) => u.username.toLowerCase() === targetUname);
    if (matchedTarget) {
      matchedTarget.alert_chat_id = chatId;
      matchedTarget.telegram_id = chatId;
      matchedTarget.alert_enabled = true;
      if (msg.from?.username) {
        matchedTarget.telegram_username = msg.from.username;
      }
      if (msg.from?.first_name) {
        matchedTarget.telegram_name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
      }
      saveUsers();
      console.log(`[TELEGRAM LINK SUCCESS]: Linked ${matchedTarget.username} with Chat ID: ${chatId} (${msg.from?.username || ''})`);

      await sendTelegramMessage(botToken, chatId, `✅ <b>Account Linked Successfully!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n👤 <b>User:</b> <code>${matchedTarget.username}</code>\n🆔 <b>Your Telegram Chat ID:</b> <code>${chatId}</code>\n⏳ <b>Plan Expiry:</b> <code>${formatDisplayDate(matchedTarget.expiry_date)}</code>\n\nYour Telegram account is now connected! You will receive all direct billing notices, renewals, and bot status alerts right here.\n\nSend <code>/bill</code> anytime to check your live ledger and due amount.`);
      
      // Notify Admin as well
      const adminChatId = String(adminUser.alert_chat_id || '').trim();
      if (adminChatId && adminChatId !== chatId) {
        await sendTelegramMessage(botToken, adminChatId, `🔔 <b>User Linked Telegram ID:</b>\n• User: <b>${matchedTarget.username}</b>\n• Chat ID: <code>${chatId}</code> (@${msg.from?.username || 'NoUsername'})`);
      }
      return;
    } else {
      await sendTelegramMessage(botToken, chatId, `❌ User "<b>${targetUname}</b>" was not found in the system. Please check your username and try again.`);
      return;
    }
  }

  cleanupTelegramBotMenu(botToken).catch(() => null);
  let session = customerOnboardingSessions.get(chatId);
  const rawText = (msg.text || '').trim();
  const lowerText = rawText.toLowerCase();

  // 1. If existing user is in the middle of typing custom extension days
  if (existingUser && session && session.step === 'awaiting_ext_days') {
    const days = parseInt(rawText, 10);
    if (isNaN(days) || days < 1 || days > 3650) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Please type a valid number of days (e.g. <code>30</code>, <code>45</code>, <code>90</code>):`);
      return;
    }
    await submitCustomerExtensionRequest(botToken, chatId, existingUser, days, adminUser);
    return;
  }

  // 2. If existing user is in the middle of typing custom extra bot slots
  if (existingUser && session && session.step === 'awaiting_add_bots') {
    const extraCount = parseInt(rawText, 10);
    if (isNaN(extraCount) || extraCount < 1 || extraCount > 500) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Please type a valid number of bots (e.g. <code>2</code>, <code>5</code>, <code>10</code>):`);
      return;
    }
    await submitCustomerExtraBotsRequest(botToken, chatId, existingUser, extraCount, adminUser);
    return;
  }

  // 3. If existing user sends /start, /menu, /extend, /upgrade, /bots or any normal query
  if (existingUser && (!session || session.step === 'confirm' || session.step === 'awaiting_name') && !lowerText.includes('request_id') && lowerText !== '/new') {
    const userAccs = Array.from(accounts.values()).filter(a => (a.owner || 'admin').toLowerCase() === existingUser.username.toLowerCase());
    const liveCount = userAccs.filter(a => a.running).length;
    const webLoginUrl = getWebLoginUrl();
    const expStr = existingUser.expiry_date ? formatDisplayDate(existingUser.expiry_date) : 'Unlimited';

    const memberMsg = `👋 <b>Hello ${existingUser.display_name || existingUser.username}! Welcome to TeleBot!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `✨ <b>Your Account is Active:</b>\n\n` +
      `👤 <b>Username:</b> <code>${existingUser.username}</code>\n` +
      `🤖 <b>Bot Slots Quota:</b> <b>${existingUser.max_accounts} Bots</b>\n` +
      `⚡ <b>Connected Accounts:</b> ${userAccs.length} added (${liveCount} running)\n` +
      `⏳ <b>Validity Expiry:</b> <b>${expStr}</b>\n\n` +
      `👇 <i>What would you like to do? Choose an option below:</i>`;

    const memberKeyboard = [
      [{ text: '💳 View My Bill & Ledger (/bill)', callback_data: `cust_view_bill:${existingUser.username}` }],
      [{ text: '⏳ Extend Validity (+Days)', callback_data: `cust_ext_val:${existingUser.username}` }],
      [{ text: '➕ Add More Bots (+Slots)', callback_data: `cust_add_bots:${existingUser.username}` }],
      [{ text: '🌐 Open Web Login Dashboard', url: webLoginUrl }],
      [{ text: '🆕 Request Different User ID', callback_data: 'cust_new_id' }]
    ];

    await sendTelegramMessage(botToken, chatId, memberMsg, memberKeyboard);
    return;
  }

  // If user sends /start, /help, /reset, /new or session is brand new (NEW CUSTOMER ONBOARDING)
  if (!session || lowerText.startsWith('/start') || lowerText === '/reset' || lowerText === '/help' || lowerText === '/new') {
    const custName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ').trim() || (msg.from?.username ? `@${msg.from.username}` : 'Friend');
    const tgUsername = msg.from?.username || '';

    session = {
      chat_id: chatId,
      telegram_username: tgUsername,
      step: 'awaiting_name',
      full_name: custName,
      type: 'new_user',
      updated_at: Date.now()
    };
    customerOnboardingSessions.set(chatId, session);

    const welcomeMsg = `👋 <b>Welcome ${custName} to TeleBot Manager!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `✨ Request a new <b>User ID & Dashboard Access</b> or renew your existing subscription.\n\n` +
      `📝 <b>Step 1/3: Your Full Name</b>\n` +
      `Would you like to use <b>"${custName}"</b> or type a different name in chat?`;

    const keyboard = [
      [{ text: `✅ Use "${custName.slice(0, 24)}"`, callback_data: `cust_name_ok` }],
      [{ text: '✏️ Type Different Name', callback_data: `cust_name_type` }]
    ];

    await sendTelegramMessage(botToken, chatId, welcomeMsg, keyboard);
    return;
  }

  // Step: Awaiting Custom Full Name
  if (session.step === 'awaiting_name') {
    session.full_name = rawText;
    session.step = 'awaiting_phone';
    session.updated_at = Date.now();

    const askPhone = `📱 <b>Great, ${session.full_name}!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📝 <b>Step 2/3: WhatsApp / Contact Mobile Number</b>\n` +
      `Please type your 10-digit mobile number (e.g. <code>9876543210</code>) so the Administrator can deliver your login credentials:`;

    await sendTelegramMessage(botToken, chatId, askPhone);
    return;
  }

  // Step: Awaiting Mobile Number
  if (session.step === 'awaiting_phone') {
    const cleanDigits = rawText.replace(/[^0-9+]/g, '');
    if (cleanDigits.length < 8) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Please type a valid 10-digit mobile number (e.g. <code>9876543210</code>):`);
      return;
    }
    session.phone = cleanDigits;
    session.step = 'awaiting_bots';
    session.updated_at = Date.now();

    const askBots = `🤖 <b>How many Bot IDs do you need?</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📝 <b>Step 3/3: Select Accounts Quota</b>\n` +
      `How many Telegram accounts do you plan to run simultaneously?\n` +
      `👇 <i>Choose an option below or type a custom number:</i>`;

    const keyboard = [
      [{ text: '🤖 1 Bot Account', callback_data: 'cust_bots:1' }, { text: '🤖 2 Bot Accounts', callback_data: 'cust_bots:2' }],
      [{ text: '🤖 3 Bot Accounts', callback_data: 'cust_bots:3' }, { text: '🤖 5 Bot Accounts', callback_data: 'cust_bots:5' }],
      [{ text: '🤖 10 Bot Accounts', callback_data: 'cust_bots:10' }, { text: '🤖 20 Bot Accounts', callback_data: 'cust_bots:20' }],
      [{ text: '🔢 Custom Number', callback_data: 'cust_bots_custom' }]
    ];

    await sendTelegramMessage(botToken, chatId, askBots, keyboard);
    return;
  }

  // Step: Awaiting Bots Count
  if (session.step === 'awaiting_bots' || session.step === 'awaiting_custom_bots') {
    const num = parseInt(rawText, 10);
    if (isNaN(num) || num < 1 || num > 500) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Please type a valid number of bots (1 to 200) or use the buttons above:`);
      return;
    }
    session.bots_count = num;
    session.step = 'awaiting_validity';
    session.updated_at = Date.now();

    const askVal = `⏳ <b>Billing Cycle: 1 Week (7 Days Plan)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Selected: <b>${num} Bot Account(s)</b>\n\n` +
      `Standard plans run on a <b>1-Week (7 Days)</b> billing cycle.\n` +
      `The Administrator will set your rate per bot and plan type (Postpaid or Advance) upon approval.\n\n` +
      `👇 <i>Select your preferred plan duration:</i>`;

    const keyboard = [
      [{ text: '⚡ 1 Week (7 Days Plan)', callback_data: 'cust_val:7' }, { text: '⚡ 15 Days', callback_data: 'cust_val:15' }],
      [{ text: '⭐ 30 Days (1 Month)', callback_data: 'cust_val:30' }, { text: '⭐ 60 Days (2 Months)', callback_data: 'cust_val:60' }],
      [{ text: '👑 90 Days (3 Months)', callback_data: 'cust_val:90' }, { text: '🔢 Custom Days', callback_data: 'cust_val_custom' }]
    ];

    await sendTelegramMessage(botToken, chatId, askVal, keyboard);
    return;
  }

  // Step: Awaiting Validity
  if (session.step === 'awaiting_validity' || session.step === 'awaiting_custom_validity') {
    const days = parseInt(rawText, 10);
    if (isNaN(days) || days < 1 || days > 3650) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Please type a valid number of days (e.g. 7, 30) or use the buttons:`);
      return;
    }
    session.validity_days = days;
    session.step = 'confirm';
    session.updated_at = Date.now();

    const confirmMsg = `📋 <b>Access Request Summary:</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>Name:</b> ${session.full_name}\n` +
      `🆔 <b>Telegram:</b> ${session.telegram_username ? '@' + session.telegram_username : 'None'} (<code>${chatId}</code>)\n` +
      `📱 <b>Mobile:</b> <code>${session.phone}</code>\n` +
      `🤖 <b>Bot Accounts:</b> <b>${session.bots_count} Bots</b>\n` +
      `⏳ <b>Billing Cycle:</b> <b>${session.validity_days} Days</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Would you like to submit this request to the Administrator?</i>`;

    const keyboard = [
      [{ text: '🚀 Submit Request to Admin', callback_data: `cust_submit:${chatId}` }],
      [{ text: '🔄 Start Over', callback_data: `cust_restart:${chatId}` }]
    ];

    await sendTelegramMessage(botToken, chatId, confirmMsg, keyboard);
    return;
  }

  // Step: Confirm
  if (session.step === 'confirm') {
    const confirmMsg = `📋 <b>Request Confirmation Pending:</b>\n` +
      `• Name: ${session.full_name}\n` +
      `• Mobile: ${session.phone}\n` +
      `• Bots: ${session.bots_count}\n` +
      `• Validity: ${session.validity_days} Days\n\n` +
      `👇 <i>Tap below to submit your request to Administrator:</i>`;

    const keyboard = [
      [{ text: '🚀 Submit Request to Admin', callback_data: `cust_submit:${chatId}` }],
      [{ text: '🔄 Start Over', callback_data: `cust_restart:${chatId}` }]
    ];
    await sendTelegramMessage(botToken, chatId, confirmMsg, keyboard);
  }
}

// Helper: Submit Customer Validity Extension Request
async function submitCustomerExtensionRequest(botToken: string, chatId: string, u: any, days: number, adminUser: any, msgIdToEdit: any = null) {
  let curExpMs = Date.now() + 5.5 * 3600 * 1000;
  if (u?.expiry_date) {
    const parsed = new Date(u.expiry_date + 'T23:59:59Z').getTime();
    if (!isNaN(parsed) && parsed > curExpMs) curExpMs = parsed;
  }
  const newExpMs = curExpMs + (days * 86400 * 1000);
  const newExpDateStr = new Date(newExpMs).toISOString().split('T')[0];

  const reqId = `ext_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const newReq: AccessRequest = {
    id: reqId,
    chat_id: chatId,
    telegram_username: u?.telegram_username || '',
    full_name: u?.display_name || u?.username || 'Customer',
    phone: u?.security_answer ? 'Registered User' : 'N/A',
    bots_count: u?.max_accounts || 1,
    validity_days: days,
    type: 'extend_validity',
    target_username: u?.username,
    requested_at: Date.now(),
    status: 'pending'
  };
  accessRequests.unshift(newReq);
  saveAccessRequests();
  customerOnboardingSessions.delete(chatId);

  // Confirm to customer
  const custExtConfirm = `✅ <b>Validity Extension Request Submitted!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Username:</b> <code>${u?.username}</code>\n` +
    `⏳ <b>Requested Extension:</b> <b>+${days} Days</b>\n` +
    `📅 <b>New Expiry Date:</b> <b>${formatDisplayDate(newExpDateStr)}</b>\n\n` +
    `The Administrator will review your request shortly. You will receive an alert once approved.`;

  await sendTelegramMessage(botToken, chatId, custExtConfirm, null, msgIdToEdit);

  // Alert to Super Admin
  const adminChatId = String(adminUser?.alert_chat_id || '').trim();
  if (adminChatId) {
    const { text: adminAlert, keyboard: adminK } = formatAdminRequestAlert(newReq);
    await sendTelegramMessage(botToken, adminChatId, adminAlert, adminK);
  }
}

// Helper: Submit Customer Extra Bot Slots Request
async function submitCustomerExtraBotsRequest(botToken: string, chatId: string, u: any, extraBots: number, adminUser: any, msgIdToEdit: any = null) {
  const curQuota = Number(u?.max_accounts || 1);
  const newTotal = curQuota + extraBots;

  const reqId = `slots_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const newReq: AccessRequest = {
    id: reqId,
    chat_id: chatId,
    telegram_username: u?.telegram_username || '',
    full_name: u?.display_name || u?.username || 'Customer',
    phone: u?.security_answer ? 'Registered User' : 'N/A',
    bots_count: extraBots,
    validity_days: 0,
    type: 'add_bots',
    target_username: u?.username,
    requested_at: Date.now(),
    status: 'pending'
  };
  accessRequests.unshift(newReq);
  saveAccessRequests();
  customerOnboardingSessions.delete(chatId);

  // Confirm to customer
  const custBotsConfirm = `✅ <b>Extra Bot Slots Request Submitted!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Username:</b> <code>${u?.username}</code>\n` +
    `🤖 <b>Current Bot Quota:</b> <b>${curQuota} Bots</b>\n` +
    `➕ <b>Requested Extra:</b> <b>+${extraBots} Bots</b>\n` +
    `🎯 <b>New Total Quota:</b> <b>${newTotal} Bots</b>\n\n` +
    `The Administrator will review your request. Once approved, you can connect your new accounts immediately.`;

  await sendTelegramMessage(botToken, chatId, custBotsConfirm, null, msgIdToEdit);

  // Alert to Super Admin
  const adminChatId = String(adminUser?.alert_chat_id || '').trim();
  if (adminChatId) {
    const { text: adminAlert, keyboard: adminK } = formatAdminRequestAlert(newReq);
    await sendTelegramMessage(botToken, adminChatId, adminAlert, adminK);
  }
}

async function handleCustomerOnboardingCallback(botToken: string, chatId: string, cb: any, adminUser: any) {
  const data = String(cb.data || '');
  const msgId = cb.message?.message_id;
  let session = customerOnboardingSessions.get(chatId);

  // Find if user is already registered
  const existingUser = usersList.find((u: any) =>
    u.role !== 'admin' && (
      String(u.alert_chat_id || '').trim() === String(chatId).trim() ||
      (u.telegram_username && (cb.from?.username || '').toLowerCase() === String(u.telegram_username).toLowerCase())
    )
  );

  // --- EXISTING CUSTOMER ACTIONS ---
  if (data.startsWith('cust_ext_val:')) {
    const targetUser = data.replace('cust_ext_val:', '') || existingUser?.username;
    const u = getUser(targetUser) || existingUser;
    session = {
      chat_id: chatId,
      telegram_username: cb.from?.username || '',
      step: 'awaiting_ext_days',
      type: 'extend_validity',
      target_username: targetUser,
      full_name: u?.display_name || u?.username || 'Customer',
      updated_at: Date.now()
    };
    customerOnboardingSessions.set(chatId, session);

    const curExp = u?.expiry_date ? formatDisplayDate(u.expiry_date) : 'Active';
    const extMsg = `⏳ <b>ACCOUNT VALIDITY EXTENSION (Renewal)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>Account:</b> <code>${targetUser}</code>\n` +
      `📅 <b>Current Expiry:</b> <b>${curExp}</b>\n\n` +
      `👇 <i>Select how many days you would like to extend your plan:</i>`;

    const extKeyboard = [
      [{ text: '⚡ +7 Days', callback_data: `cust_do_ext:7` }, { text: '⚡ +15 Days', callback_data: `cust_do_ext:15` }],
      [{ text: '⭐ +30 Days (1 Month)', callback_data: `cust_do_ext:30` }, { text: '⭐ +60 Days (2 Months)', callback_data: `cust_do_ext:60` }],
      [{ text: '👑 +90 Days (3 Months)', callback_data: `cust_do_ext:90` }, { text: '💎 +365 Days (1 Year)', callback_data: `cust_do_ext:365` }],
      [{ text: '🔢 Custom Days (Type in chat)', callback_data: `cust_ext_days_custom` }],
      [{ text: '🔙 Back to Menu', callback_data: `cust_back_menu` }]
    ];

    await sendTelegramMessage(botToken, chatId, extMsg, extKeyboard, msgId);
    return;
  }

  if (data === 'cust_ext_days_custom') {
    if (session) session.step = 'awaiting_ext_days';
    await sendTelegramMessage(botToken, chatId, `⏳ <b>Custom Validity Days:</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\nHow many days would you like to extend your plan? Please type the number in chat (e.g. <code>45</code>, <code>90</code>, <code>180</code>):`, null, msgId);
    return;
  }

  if (data.startsWith('cust_do_ext:')) {
    const days = parseInt(data.replace('cust_do_ext:', ''), 10) || 30;
    const targetU = getUser(session?.target_username || '') || existingUser;
    if (!targetU) {
      await sendTelegramMessage(botToken, chatId, '⚠️ User account not found. Please type /start to request access.', null, msgId);
      return;
    }
    await submitCustomerExtensionRequest(botToken, chatId, targetU, days, adminUser, msgId);
    return;
  }

  if (data.startsWith('cust_add_bots:')) {
    const targetUser = data.replace('cust_add_bots:', '') || existingUser?.username;
    const u = getUser(targetUser) || existingUser;
    session = {
      chat_id: chatId,
      telegram_username: cb.from?.username || '',
      step: 'awaiting_add_bots',
      type: 'add_bots',
      target_username: targetUser,
      full_name: u?.display_name || u?.username || 'Customer',
      updated_at: Date.now()
    };
    customerOnboardingSessions.set(chatId, session);

    const botsMsg = `🤖 <b>EXTRA BOT SLOTS REQUEST</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>Account:</b> <code>${targetUser}</code>\n` +
      `🤖 <b>Current Allowed Bots:</b> <b>${u?.max_accounts || 1} Accounts</b>\n\n` +
      `👇 <i>Select how many additional account slots you need:</i>`;

    const botsKeyboard = [
      [{ text: '🤖 +1 Bot Slot', callback_data: `cust_do_bots:1` }, { text: '🤖 +2 Bot Slots', callback_data: `cust_do_bots:2` }],
      [{ text: '🤖 +3 Bot Slots', callback_data: `cust_do_bots:3` }, { text: '🤖 +5 Bot Slots', callback_data: `cust_do_bots:5` }],
      [{ text: '🤖 +10 Bot Slots', callback_data: `cust_do_bots:10` }, { text: '🤖 +20 Bot Slots', callback_data: `cust_do_bots:20` }],
      [{ text: '🔢 Custom Bots (Type in chat)', callback_data: `cust_add_bots_custom` }],
      [{ text: '🔙 Back to Menu', callback_data: `cust_back_menu` }]
    ];

    await sendTelegramMessage(botToken, chatId, botsMsg, botsKeyboard, msgId);
    return;
  }

  if (data === 'cust_add_bots_custom') {
    if (session) session.step = 'awaiting_add_bots';
    await sendTelegramMessage(botToken, chatId, `🔢 <b>Custom Extra Bot Slots:</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\nHow many extra bot accounts do you need? Please type the number in chat (e.g. <code>2</code>, <code>5</code>, <code>10</code>):`, null, msgId);
    return;
  }

  if (data.startsWith('cust_do_bots:')) {
    const extraBots = parseInt(data.replace('cust_do_bots:', ''), 10) || 1;
    const targetU = getUser(session?.target_username || '') || existingUser;
    if (!targetU) {
      await sendTelegramMessage(botToken, chatId, '⚠️ User account not found. Please type /start to begin.', null, msgId);
      return;
    }
    await submitCustomerExtraBotsRequest(botToken, chatId, targetU, extraBots, adminUser, msgId);
    return;
  }

  if (data === 'cust_back_menu') {
    customerOnboardingSessions.delete(chatId);
    await handleCustomerOnboardingMessage(botToken, chatId, { text: '/start', from: cb.from }, adminUser);
    return;
  }

  if (data === 'cust_new_id') {
    customerOnboardingSessions.delete(chatId);
    const custName = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(' ').trim() || (cb.from?.username ? `@${cb.from.username}` : 'Friend');
    session = {
      chat_id: chatId,
      telegram_username: cb.from?.username || '',
      step: 'awaiting_name',
      full_name: custName,
      type: 'new_user',
      updated_at: Date.now()
    };
    customerOnboardingSessions.set(chatId, session);

    const welcomeMsg = `👋 <b>Welcome ${custName} to TeleBot Manager!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `✨ Please provide your details to request <b>User ID & Dashboard Access</b>:\n\n` +
      `📝 <b>Step 1/3: Your Full Name</b>\n` +
      `Would you like to use <b>"${custName}"</b> or type a different name in chat?`;

    const keyboard = [
      [{ text: `✅ Use "${custName.slice(0, 24)}"`, callback_data: `cust_name_ok` }],
      [{ text: '✏️ Type Other Name', callback_data: `cust_name_type` }]
    ];

    await sendTelegramMessage(botToken, chatId, welcomeMsg, keyboard, msgId);
    return;
  }

  // --- NEW CUSTOMER ONBOARDING ACTIONS ---
  if (data.startsWith('cust_view_bill:')) {
    await handleCustomerBillCommand(botToken, chatId, { from: cb.from }, adminUser, msgId);
    return;
  }

  if (data === 'cust_name_ok') {
    if (!session) {
      session = {
        chat_id: chatId,
        telegram_username: cb.from?.username || '',
        step: 'awaiting_name',
        full_name: [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(' ').trim() || 'User',
        updated_at: Date.now()
      };
      customerOnboardingSessions.set(chatId, session);
    }
    session.step = 'awaiting_phone';
    session.updated_at = Date.now();

    const askPhone = `📱 <b>Great, ${session.full_name}!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📝 <b>Step 2/3: WhatsApp / Contact Mobile Number</b>\n` +
      `Please type your 10-digit mobile number (e.g. <code>9876543210</code>) so the Administrator can deliver your login credentials:`;

    await sendTelegramMessage(botToken, chatId, askPhone, null, msgId);
    return;
  }

  if (data === 'cust_name_type') {
    if (session) session.step = 'awaiting_name';
    await sendTelegramMessage(botToken, chatId, `✏️ Please type your <b>Full Name</b> in chat:`, null, msgId);
    return;
  }

  if (data === 'cust_bots_custom') {
    if (!session) {
      session = { chat_id: chatId, telegram_username: cb.from?.username || '', step: 'awaiting_bots', full_name: 'Customer', phone: 'Not Specified', updated_at: Date.now() };
      customerOnboardingSessions.set(chatId, session);
    }
    session.step = 'awaiting_bots';
    session.updated_at = Date.now();
    await sendTelegramMessage(botToken, chatId, `🔢 <b>Custom Bot Accounts Quota:</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\nHow many Telegram accounts do you plan to run?\n\n👉 <i>Type a number in chat (e.g. <code>4</code>, <code>15</code>, <code>25</code>, <code>50</code>):</i>`, null, msgId);
    return;
  }

  if (data.startsWith('cust_bots:')) {
    const num = parseInt(data.replace('cust_bots:', ''), 10) || 1;
    if (!session) {
      session = { chat_id: chatId, telegram_username: cb.from?.username || '', step: 'awaiting_bots', full_name: 'Customer', phone: 'Not Specified', updated_at: Date.now() };
      customerOnboardingSessions.set(chatId, session);
    }
    session.bots_count = num;
    session.step = 'awaiting_validity';
    session.updated_at = Date.now();

    const askVal = `⏳ <b>Billing Cycle: 1 Week (7 Days Plan)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Selected: <b>${num} Bot Account(s)</b>\n\n` +
      `Standard plans run on a <b>1-Week (7 Days)</b> billing cycle.\n` +
      `The Administrator will set your rate per bot and plan type (Postpaid or Advance) upon approval.\n\n` +
      `👇 <i>Select your preferred plan duration:</i>`;

    const keyboard = [
      [{ text: '⚡ 1 Week (7 Days Plan)', callback_data: 'cust_val:7' }, { text: '⚡ 15 Days', callback_data: 'cust_val:15' }],
      [{ text: '⭐ 30 Days (1 Month)', callback_data: 'cust_val:30' }, { text: '⭐ 60 Days (2 Months)', callback_data: 'cust_val:60' }],
      [{ text: '👑 90 Days (3 Months)', callback_data: 'cust_val:90' }, { text: '🔢 Custom Days', callback_data: 'cust_val_custom' }]
    ];

    await sendTelegramMessage(botToken, chatId, askVal, keyboard, msgId);
    return;
  }

  if (data === 'cust_val_custom') {
    if (!session) {
      session = { chat_id: chatId, telegram_username: cb.from?.username || '', step: 'awaiting_validity', full_name: 'Customer', phone: 'Not Specified', bots_count: 1, updated_at: Date.now() };
      customerOnboardingSessions.set(chatId, session);
    }
    session.step = 'awaiting_validity';
    session.updated_at = Date.now();
    await sendTelegramMessage(botToken, chatId, `⏳ <b>Custom Validity Duration:</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\nHow many days of dashboard access do you need?\n\n👉 <i>Type number of days in chat (e.g. <code>45</code>, <code>90</code>, <code>180</code>):</i>`, null, msgId);
    return;
  }

  if (data.startsWith('cust_val:')) {
    const days = parseInt(data.replace('cust_val:', ''), 10) || 7;
    if (!session) {
      session = { chat_id: chatId, telegram_username: cb.from?.username || '', step: 'confirm', full_name: 'Customer', phone: 'Not Specified', bots_count: 1, updated_at: Date.now() };
      customerOnboardingSessions.set(chatId, session);
    }
    session.validity_days = days;
    session.step = 'confirm';
    session.updated_at = Date.now();

    const confirmMsg = `📋 <b>Access Request Summary:</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>Name:</b> ${session.full_name}\n` +
      `🆔 <b>Telegram:</b> ${session.telegram_username ? '@' + session.telegram_username : 'None'} (<code>${chatId}</code>)\n` +
      `📱 <b>Mobile:</b> <code>${session.phone || 'Pending'}</code>\n` +
      `🤖 <b>Bot Accounts:</b> <b>${session.bots_count || 1} Bots</b>\n` +
      `⏳ <b>Billing Cycle:</b> <b>${session.validity_days} Days (1 Week)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Would you like to submit this request to the Administrator?</i>`;

    const keyboard = [
      [{ text: '🚀 Submit Request to Admin', callback_data: `cust_submit:${chatId}` }],
      [{ text: '🔄 Start Over', callback_data: `cust_restart:${chatId}` }]
    ];

    await sendTelegramMessage(botToken, chatId, confirmMsg, keyboard, msgId);
    return;
  }

  if (data.startsWith('cust_restart:')) {
    customerOnboardingSessions.delete(chatId);
    await handleCustomerOnboardingMessage(botToken, chatId, { text: '/start', from: cb.from }, adminUser);
    return;
  }

  if (data.startsWith('cust_submit:') || data === 'cust_confirm' || data.startsWith('cust_confirm:')) {
    if (!session) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Session expired. Please type /start to begin again.');
      return;
    }

    const reqId = `req_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const newReq: AccessRequest = {
      id: reqId,
      chat_id: chatId,
      telegram_username: session.telegram_username || cb.from?.username || '',
      full_name: session.full_name || 'Customer',
      phone: session.phone || 'Not Specified',
      bots_count: session.bots_count || 1,
      validity_days: session.validity_days || 7,
      note: session.note || '',
      type: 'new_user',
      requested_at: Date.now(),
      status: 'pending'
    };

    accessRequests.unshift(newReq);
    saveAccessRequests();
    customerOnboardingSessions.delete(chatId);

    // Customer confirmation in Easy English
    const custSuccessMsg = `✅ <b>Your Request Has Been Submitted Successfully!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 <b>Request ID:</b> <code>${reqId}</code>\n` +
      `👤 <b>Name:</b> ${newReq.full_name}\n` +
      `📱 <b>Mobile:</b> <code>${newReq.phone}</code>\n` +
      `🤖 <b>Requested Accounts:</b> ${newReq.bots_count} Bot(s)\n` +
      `⏳ <b>Billing Cycle:</b> ${newReq.validity_days} Days (1 Week)\n\n` +
      `⏳ <i>The Administrator will review your request shortly. Once approved, your login credentials, weekly rate details, and dashboard link will be delivered here automatically!</i>`;

    await sendTelegramMessage(botToken, chatId, custSuccessMsg, null, msgId);

    // Admin alert message
    const adminChatId = String(adminUser?.alert_chat_id || '').trim();
    if (adminChatId) {
      const { text: adminAlertMsg, keyboard: adminKeyboard } = formatAdminRequestAlert(newReq);
      await sendTelegramMessage(botToken, adminChatId, adminAlertMsg, adminKeyboard);
    }
  }
}

async function handleAdminUserRequestApproval(
  botToken: string,
  adminChatId: string,
  reqId: string,
  msgId: any,
  adminUser: any,
  overridePlanModel?: string,
  overrideRate?: number
) {
  const reqItem = accessRequests.find((r) => r.id === reqId);
  if (!reqItem) {
    await sendTelegramMessage(botToken, adminChatId, '⚠️ Request not found or already deleted.', null, msgId);
    return;
  }
  if (reqItem.status !== 'pending') {
    await sendTelegramMessage(botToken, adminChatId, `ℹ️ Request is already <b>${reqItem.status.toUpperCase()}</b>!`, null, msgId);
    return;
  }

  // 1. Generate unique username
  let base = (reqItem.telegram_username || reqItem.full_name || 'user')
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

  // 3. Compute 1-Week Billing (7 Days Cycle)
  const initialBots = Math.max(1, Number(reqItem.bots_count) || 1);
  const finalRate = Math.max(1, Number(overrideRate) || Number(reqItem.rate_per_bot) || 10);
  const finalModel = (overridePlanModel || reqItem.payment_model || 'postpaid').toLowerCase();
  const cycleDays = 7; // 1-Week billing standard
  const planCost = Math.round(initialBots * finalRate);

  const expDateMs = Date.now() + 5.5 * 3600 * 1000 + (cycleDays * 86400 * 1000);
  const expDateStr = new Date(expDateMs).toISOString().split('T')[0];

  // 4. Create User in system
  const newUser: any = {
    username: generatedUsername,
    password: hashVal(generatedPassword),
    role: 'user',
    active: true,
    max_accounts: initialBots,
    max_targets: 9999,
    expiry_date: expDateStr,
    rate_per_bot: finalRate,
    billing_model: finalModel,
    billing_cycle_days: cycleDays,
    registered_phones: [],
    security_question: 'What is your registered mobile number?',
    security_answer: hashVal((reqItem.phone || '').trim()),
    alert_enabled: true,
    alert_bot_token: botToken,
    alert_chat_id: reqItem.chat_id,
    display_name: reqItem.full_name
  };

  usersList.push(newUser);
  saveUsers();
  broadcastAccountUpdate('admin');

  // 5. Update Khatabook config & generate 1-Week initial invoice
  try {
    if (!billingStore.user_configs) billingStore.user_configs = {};
    billingStore.user_configs[generatedUsername] = {
      rate_per_bot: finalRate,
      rate_per_day: finalRate,
      max_accounts: initialBots,
      billing_cycle_days: cycleDays,
      payment_model: finalModel,
      notes: `${initialBots} Bots @ ₹${finalRate}/bot/day (1-Week ${finalModel === 'postpaid' ? 'Postpaid' : 'Advance'})`
    };

    if (finalModel === 'advance') {
      const advancePlanCost = initialBots * finalRate * cycleDays;
      addBillingInvoice({
        username: generatedUsername,
        date: getTodayDateString(),
        type: 'weekly_plan',
        description: `1-Week Advance Plan (${initialBots} Bot(s) @ ₹${finalRate}/bot/day x ${cycleDays} Days = ₹${advancePlanCost})`,
        bots_count: initialBots,
        days_count: cycleDays,
        amount: advancePlanCost,
        status: 'due'
      });
    } else {
      // 7-Day Postpaid Plan: Dues accrue day-by-day based strictly on LIVE connected bots (not idle slots)
      accrueDailyUsageForUser(generatedUsername, getTodayDateString());
    }
    saveBillingLocal();
  } catch (e) {
    console.error('[BILLING HOOK ERROR]', e);
  }

  reqItem.status = 'approved';
  reqItem.resolved_at = Date.now();
  reqItem.resolved_by = 'Master Telegram Bot';
  reqItem.created_username = generatedUsername;
  reqItem.created_password = generatedPassword;
  reqItem.rate_per_bot = finalRate;
  reqItem.payment_model = finalModel;
  saveAccessRequests();

  // 6. Update Admin Message in Telegram
  const adminConfirmMsg = `✅ <b>USER ACCESS APPROVED & CREATED!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Created User ID:</b> <code>${generatedUsername}</code>\n` +
    `🔑 <b>Temporary Password:</b> <code>${generatedPassword}</code>\n` +
    `📱 <b>Customer:</b> ${reqItem.full_name} (<code>${reqItem.phone}</code>)\n` +
    `🤖 <b>Allowed Bots:</b> <b>${initialBots} Accounts</b>\n` +
    `💵 <b>Approved Rate:</b> <b>₹${finalRate} / bot</b>\n` +
    `💰 <b>Weekly Plan Bill:</b> <b>₹${planCost}</b> (${initialBots} IDs x ₹${finalRate})\n` +
    `📅 <b>Billing Type:</b> <b>${finalModel === 'postpaid' ? '7-Day Postpaid' : '7-Day Advance'} (1 Week)</b>\n` +
    `⏳ <b>Valid Till:</b> <b>${formatDisplayDate(expDateStr)}</b> (7 Days / 1 Week)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🚀 <i>Credentials and 1-week subscription details have been dispatched to customer's Telegram!</i>`;

  await sendTelegramMessage(botToken, adminChatId, adminConfirmMsg, null, msgId);

  // 7. Dispatch Credentials to Customer in Easy English
  const webLoginUrl = getWebLoginUrl();
  const customerMsg = `🎉 <b>Congratulations! Your TeleBot Account is Approved!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Your TeleBot Dashboard access has been activated by Administrator.\n\n` +
    `🔑 <b>Your Login Credentials:</b>\n` +
    `• <b>Username:</b> <code>${generatedUsername}</code>\n` +
    `• <b>Password:</b> <code>${generatedPassword}</code>\n` +
    `• <b>Allowed Bots:</b> <b>${initialBots} Bot(s)</b>\n\n` +
    `📋 <b>Subscription Terms (1-Week Cycle):</b>\n` +
    `• <b>Rate per Bot:</b> ₹${finalRate} / bot\n` +
    `• <b>Weekly Bill:</b> ₹${planCost} (${initialBots} Bots x ₹${finalRate})\n` +
    `• <b>Billing Plan:</b> ${finalModel === 'postpaid' ? '7-Day Postpaid (Payment due at end of weekly cycle)' : '7-Day Advance (Prepaid)'}\n` +
    `• <b>Valid Until:</b> <b>${formatDisplayDate(expDateStr)}</b> (7 Days / 1 Week)\n\n` +
    `🌐 <b>Login Website:</b>\n${webLoginUrl}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💳 <i>Send <code>/bill</code> anytime to view your live balance, invoices, and payment status.</i>\n` +
    `🔒 <i>For security, please login and change your password in account settings.</i>`;

  const customerKeyboard = [
    [{ text: '🌐 Open Website & Login', url: webLoginUrl }],
    [{ text: '💳 View My Bill (/bill)', callback_data: `cust_view_bill:${generatedUsername}` }]
  ];

  await sendTelegramMessage(botToken, reqItem.chat_id, customerMsg, customerKeyboard);
}

// Handler: Admin approves Validity Extension via Telegram Button
async function handleAdminValidityExtensionApproval(botToken: string, adminChatId: string, reqId: string, msgId: any, adminUser: any) {
  const reqItem = accessRequests.find((r) => r.id === reqId);
  if (!reqItem) {
    await sendTelegramMessage(botToken, adminChatId, '⚠️ Request not found or already deleted.', null, msgId);
    return;
  }
  if (reqItem.status !== 'pending') {
    await sendTelegramMessage(botToken, adminChatId, `ℹ️ Request is already <b>${reqItem.status.toUpperCase()}</b>!`, null, msgId);
    return;
  }
  const u = getUser(reqItem.target_username || '');
  if (!u) {
    await sendTelegramMessage(botToken, adminChatId, `❌ User "${reqItem.target_username}" not found in system!`, null, msgId);
    return;
  }

  const days = Number(reqItem.validity_days || 30);
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

  // Auto-Billing Hook: Telegram Bot Validity Extension Approval
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

  reqItem.status = 'approved';
  reqItem.resolved_at = Date.now();
  reqItem.resolved_by = 'Master Telegram Bot';
  saveAccessRequests();

  const adminMsg = `✅ <b>VALIDITY EXTENSION APPROVED!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>User:</b> <code>${u.username}</code> (${u.display_name || ''})\n` +
    `⏳ <b>Extended By:</b> <b>+${days} Days</b>\n` +
    `📅 <b>New Expiry Date:</b> <b>${formatDisplayDate(newExpDateStr)}</b>\n\n` +
    `🚀 <i>Customer has been notified in Telegram with the updated expiry date!</i>`;

  await sendTelegramMessage(botToken, adminChatId, adminMsg, null, msgId);

  // Notify customer
  if (reqItem.chat_id) {
    const webLoginUrl = getWebLoginUrl();
    const custMsg = `🎉 <b>Your Validity Extension Has Been Approved!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Your account validity has been extended by Administrator.\n\n` +
      `👤 <b>Username:</b> <code>${u.username}</code>\n` +
      `⏳ <b>Added Validity:</b> <b>+${days} Days</b>\n` +
      `📅 <b>New Expiry Date:</b> <b>${formatDisplayDate(newExpDateStr)}</b>\n\n` +
      `🌐 <b>Dashboard:</b> ${webLoginUrl}`;

    await sendTelegramMessage(botToken, reqItem.chat_id, custMsg, [
      [{ text: '🌐 Open Dashboard', url: webLoginUrl }],
      [{ text: '💳 View My Bill (/bill)', callback_data: `cust_view_bill:${u.username}` }]
    ]);
  }
}

// Handler: Admin approves Extra Bot Slots via Telegram Button
async function handleAdminExtraBotsApproval(botToken: string, adminChatId: string, reqId: string, msgId: any, adminUser: any) {
  const reqItem = accessRequests.find((r) => r.id === reqId);
  if (!reqItem) {
    await sendTelegramMessage(botToken, adminChatId, '⚠️ Request not found or already deleted.', null, msgId);
    return;
  }
  if (reqItem.status !== 'pending') {
    await sendTelegramMessage(botToken, adminChatId, `ℹ️ Request is already <b>${reqItem.status.toUpperCase()}</b>!`, null, msgId);
    return;
  }
  const u = getUser(reqItem.target_username || '');
  if (!u) {
    await sendTelegramMessage(botToken, adminChatId, `❌ User "${reqItem.target_username}" not found in system!`, null, msgId);
    return;
  }

  const added = Number(reqItem.bots_count || 1);
  u.max_accounts = Number(u.max_accounts || 1) + added;
  saveUsers();

  // Auto-Billing Hook: Telegram Bot Extra Slots Approval
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

  reqItem.status = 'approved';
  reqItem.resolved_at = Date.now();
  reqItem.resolved_by = 'Master Telegram Bot';
  saveAccessRequests();

  const adminMsg = `✅ <b>EXTRA BOTS QUOTA APPROVED!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>User:</b> <code>${u.username}</code> (${u.display_name || ''})\n` +
    `➕ <b>Added Slots:</b> <b>+${added} Bots</b>\n` +
    `🤖 <b>New Total Quota:</b> <b>${u.max_accounts} Bots</b>\n\n` +
    `🚀 <i>Customer has been notified in Telegram that they can now add more accounts!</i>`;

  await sendTelegramMessage(botToken, adminChatId, adminMsg, null, msgId);

  // Notify customer
  if (reqItem.chat_id) {
    const webLoginUrl = getWebLoginUrl();
    const custMsg = `🎉 <b>Your Extra Bot Slots Have Been Approved!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Your bot slot quota has been successfully increased by Administrator.\n\n` +
      `👤 <b>Username:</b> <code>${u.username}</code>\n` +
      `➕ <b>Added Bots:</b> <b>+${added} Accounts</b>\n` +
      `🤖 <b>New Total Quota:</b> <b>${u.max_accounts} Bots</b>\n\n` +
      `You can now log in to your dashboard and connect your new accounts!\n` +
      `🌐 <b>Dashboard:</b> ${webLoginUrl}`;

    await sendTelegramMessage(botToken, reqItem.chat_id, custMsg, [
      [{ text: '🌐 Open Dashboard', url: webLoginUrl }],
      [{ text: '💳 View My Bill (/bill)', callback_data: `cust_view_bill:${u.username}` }]
    ]);
  }
}

async function handleAdminUserRequestRejection(botToken: string, adminChatId: string, reqId: string, msgId: any) {
  const reqItem = accessRequests.find((r) => r.id === reqId);
  if (!reqItem) {
    await sendTelegramMessage(botToken, adminChatId, '⚠️ Request not found or already processed.', null, msgId);
    return;
  }
  if (reqItem.status !== 'pending') {
    await sendTelegramMessage(botToken, adminChatId, `ℹ️ Request is already <b>${reqItem.status.toUpperCase()}</b>!`, null, msgId);
    return;
  }

  reqItem.status = 'rejected';
  reqItem.resolved_at = Date.now();
  reqItem.resolved_by = 'Master Telegram Bot';
  saveAccessRequests();

  const rejectAdminMsg = `❌ <b>Request Rejected</b>\n` +
    `Access request for <b>${reqItem.full_name}</b> was rejected.`;

  await sendTelegramMessage(botToken, adminChatId, rejectAdminMsg, null, msgId);

  const custRejectMsg = reqItem.type === 'extend_validity'
    ? `⚠️ <b>Validity Extension Request Update</b>\nYour request to extend validity was not approved at this time.\nPlease contact the Administrator for details.`
    : reqItem.type === 'add_bots'
    ? `⚠️ <b>Extra Bots Request Update</b>\nYour request for additional bot slots was not approved at this time.\nPlease contact the Administrator for details.`
    : `⚠️ <b>Access Request Update: Declined</b>\nYour request for new TeleBot access was not approved at this time.\nPlease contact the Administrator directly for plan discussion or assistance.`;

  await sendTelegramMessage(botToken, reqItem.chat_id, custRejectMsg);
}

async function handleTelegramUpdate(botToken: string, update: any) {
  try {
    const globalAdminUser = usersList.find((u) => u.role === 'admin');
    const adminUser = usersList.find((u) => (u.alert_bot_token || '').trim() === botToken && u.role === 'admin');
    const matchedUser = usersList.find((u) => 
      u.role !== 'admin' && (
        (u.alert_bot_token || '').trim() === botToken ||
        (u.master_config?.filter_bot_token || '').trim() === botToken ||
        ((u as any).filter_bot_token || '').trim() === botToken
      )
    );

    // ---------------- BOT PROMOTED AS ADMIN IN CHANNEL ----------------
    if (update.my_chat_member) {
      const mcm = update.my_chat_member;
      const chat = mcm.chat;
      const newStatus = mcm.new_chat_member?.status;
      if (chat && (chat.type === 'channel' || chat.type === 'supergroup')) {
        const cid = String(chat.id);
        const title = chat.title || `Channel ${cid}`;
        let cached = filterBotAdminChannelsCache.get(botToken);
        if (!cached) {
          cached = { timestamp: Date.now(), channels: new Map() };
          filterBotAdminChannelsCache.set(botToken, cached);
        }
        if (newStatus === 'administrator' || newStatus === 'creator') {
          cached.channels.set(cid, title);
          if (chat.username) cached.channels.set('@' + chat.username.toLowerCase(), title);
          console.log(`[FILTER BOT ADMIN LINKED]: Bot is now Admin in "${title}" (${cid})`);
          const targetOwner = matchedUser ? matchedUser.username : (adminUser ? 'admin' : '');
          if (targetOwner) {
            getOrCreateUserTrackedInviteLink(targetOwner).catch(() => null);
          }
        } else if (newStatus === 'left' || newStatus === 'kicked') {
          cached.channels.delete(cid);
          if (chat.username) cached.channels.delete('@' + chat.username.toLowerCase());
        }
      }
      return;
    }

    if (update.channel_post) {
      const chat = update.channel_post.chat;
      if (chat && (chat.type === 'channel' || chat.type === 'supergroup')) {
        const cid = String(chat.id);
        const title = chat.title || `Channel ${cid}`;
        let cached = filterBotAdminChannelsCache.get(botToken);
        if (!cached) {
          cached = { timestamp: Date.now(), channels: new Map() };
          filterBotAdminChannelsCache.set(botToken, cached);
        }
        cached.channels.set(cid, title);
        if (chat.username) cached.channels.set('@' + chat.username.toLowerCase(), title);
      }
    }

    // ---------------- JOIN REQUEST EVENT HANDLING ----------------
    if (update.chat_join_request) {
      const cjr = update.chat_join_request;
      const invLink = cjr.invite_link;
      const invLinkUrl = (invLink?.invite_link || '').trim();
      const invLinkName = (invLink?.name || '').trim();
      const fromUser = cjr.from || {};
      const chatTitle = cjr.chat?.title || 'Target Channel';
      const channelChatId = String(cjr.chat?.id || '').trim();
      const channelUsername = (cjr.chat?.username || '').toLowerCase().trim();

      // 1. Match to owner by link name (Track_<owner>) or tracked links URL
      let matchedOwner = '';
      if (invLinkName && invLinkName.toLowerCase().startsWith('track_')) {
        matchedOwner = invLinkName.slice(6).trim();
      } else if (invLinkUrl) {
        for (const [uname, rec] of Object.entries(userTrackedLinks)) {
          if (rec.invite_link && rec.invite_link.trim() === invLinkUrl) {
            matchedOwner = uname;
            break;
          }
        }
      }

      // 2. Match by botToken owner (User's filter bot in master_config, alert bot, user root property, or account config)
      if (!matchedOwner) {
        const cleanTok = botToken.trim();
        const matchingUser = usersList.find(u => 
          (u.master_config?.filter_bot_token && u.master_config.filter_bot_token.trim() === cleanTok) ||
          ((u as any).filter_bot_token && (u as any).filter_bot_token.trim() === cleanTok) ||
          (u.alert_bot_token && u.alert_bot_token.trim() === cleanTok)
        );
        if (matchingUser) {
          matchedOwner = matchingUser.username;
        } else {
          // Check accounts configs
          for (const a of accounts.values()) {
            if (a.config?.filter_bot_token?.trim() === cleanTok || a.config?.alert_bot_token?.trim() === cleanTok) {
              matchedOwner = a.owner || 'admin';
              break;
            }
          }
          if (!matchedOwner) {
            const vaultBot = botsVault.find(b => b.token && b.token.trim() === cleanTok);
            if (vaultBot && vaultBot.owner) {
              matchedOwner = vaultBot.owner;
            }
          }
        }
      }

      // 3. Match by channel link in user master_config or account configs
      if (!matchedOwner && (channelChatId || channelUsername || invLinkUrl)) {
        for (const u of usersList) {
          const chLink = (u.master_config?.channel_link || (u as any).channel_link || '').toLowerCase().trim();
          const tgList = Array.isArray(u.master_config?.targets) ? u.master_config.targets.map((t: string) => t.toLowerCase().trim()) : [];
          if (chLink && (
            (channelUsername && chLink.includes(channelUsername)) ||
            (channelChatId && chLink.includes(channelChatId)) ||
            (invLinkUrl && chLink.includes(invLinkUrl.toLowerCase()))
          )) {
            matchedOwner = u.username;
            break;
          }
          if (channelUsername && tgList.some((t: string) => t.includes(channelUsername))) {
            matchedOwner = u.username;
            break;
          }
        }
      }

      // 4. Fallback: match to active user sending DMs if only one non-admin is active
      if (!matchedOwner || matchedOwner.toLowerCase() === 'admin') {
        const activeUsers = usersList.filter(u => {
          if (u.role === 'admin') return false;
          const uAccs = Array.from(accounts.values()).filter(a => (a.owner || '').toLowerCase() === u.username.toLowerCase());
          return uAccs.some(a => a.running || ((a as any).daily_sent_count || 0) > 0);
        });
        if (activeUsers.length === 1) {
          matchedOwner = activeUsers[0].username;
        }
      }

      if (!matchedOwner) {
        const nonAdmin = usersList.filter(u => u.role !== 'admin');
        if (nonAdmin.length === 1) {
          matchedOwner = nonAdmin[0].username;
        } else {
          matchedOwner = 'admin';
        }
      }

      recordJoinRequest(matchedOwner, {
        id: fromUser.id,
        name: [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || fromUser.username || 'User',
        username: fromUser.username
      });
      console.log(`[JOIN REQUEST LOGGED] +1 Join request for ${matchedOwner} from ${fromUser.first_name || fromUser.username} (${fromUser.id}) via ${invLinkUrl || chatTitle}`);
      broadcastAccountUpdate(matchedOwner);
      broadcastAccountUpdate('admin');

      // User channels join requests must NOT notify admin bot (only the target customer gets alerted)
      const todayDms = getOwnerDailyDmStats(matchedOwner, 1)[0]?.count || 0;
      const historyKey = Object.keys(dailyJoinHistory).find(k => k.toLowerCase() === matchedOwner.toLowerCase()) || matchedOwner;
      const todayJoins = dailyJoinHistory[historyKey]?.[getTodayDateString()]?.count || 1;
      const convRoi = todayDms > 0 ? ((todayJoins / todayDms) * 100).toFixed(1) + '%' : '100%';

      // If customer has linked alert bot, also notify customer
      const targetCust = getUser(matchedOwner);
      if (targetCust && targetCust.role !== 'admin' && (targetCust.alert_chat_id || targetCust.telegram_id)) {
        const custChatId = (targetCust.alert_chat_id || targetCust.telegram_id || '').toString().trim();
        const custBotToken = targetCust.alert_bot_token || adminUser?.alert_bot_token || globalAdminUser?.alert_bot_token;
        if (custBotToken && custChatId) {
          const custJoinMsg = `🎉 <b>New Channel Join Request Received!</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📢 <b>Channel:</b> <b>${chatTitle}</b>\n` +
            `👥 <b>Member:</b> ${fromUser.first_name || ''} ${fromUser.last_name || ''} (${fromUser.username ? '@' + fromUser.username : 'User'})\n\n` +
            `📊 <b>Today's Performance:</b>\n` +
            `• 🚀 Sent DMs: <b>${todayDms} DMs</b>\n` +
            `• 🎯 Channel Joins: <b>${todayJoins} Joins</b> <i>(${convRoi} Conversion)</i>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━`;
          sendTelegramMessage(custBotToken, custChatId, custJoinMsg).catch(() => null);
        }
      }
      return;
    }

    // 1. Handle incoming messages/commands
    if (update.message) {
      const msg = update.message;
      const chatId = String(msg.chat.id);
      let rawText = (msg.text || '').trim();
      // Remove @botusername from command (e.g. /control@MyBot -> /control)
      const commandParts = rawText.split(' ');
      const cleanCommand = commandParts[0].split('@')[0].toLowerCase();
      const argsText = commandParts.slice(1).join(' ').trim();
      const fullText = (cleanCommand + (argsText ? ' ' + argsText : '')).trim();

      // If this token belongs to Admin
      if (adminUser) {
        const adminChatId = String(adminUser.alert_chat_id || '').trim();
        const isAdminChat = (adminChatId && chatId === adminChatId);

        // If the message is NOT from the Admin's registered personal Chat ID, it's a Customer!
        if (!isAdminChat) {
          await handleCustomerOnboardingMessage(botToken, chatId, msg, adminUser);
          return;
        }

        // Check if admin is currently replying to a prompt (typing custom bots quota or days)
        if (adminCustomPrompt.has(chatId) && !rawText.startsWith('/')) {
          const promptData = adminCustomPrompt.get(chatId)!;
          const targetReq = accessRequests.find(r => r.id === promptData.reqId);
          if (!targetReq || targetReq.status !== 'pending') {
            adminCustomPrompt.delete(chatId);
            await sendTelegramMessage(botToken, chatId, '⚠️ Request is no longer pending or was not found.');
            return;
          }

          if (promptData.field === 'rate') {
            const val = parseInt(rawText, 10);
            if (isNaN(val) || val < 1 || val > 10000) {
              await sendTelegramMessage(botToken, chatId, '⚠️ Please type a valid rate in ₹ per bot (e.g. <code>10</code>, <code>15</code>, <code>20</code>):');
              return;
            }
            targetReq.rate_per_bot = val;
            (targetReq as any).customized_by_admin = true;
            saveAccessRequests();
            adminCustomPrompt.delete(chatId);
            const { text: updatedText, keyboard: updatedKeyboard } = formatAdminRequestAlert(targetReq);
            await sendTelegramMessage(botToken, chatId, `✅ <b>Rate per Bot Updated to ₹${val}/bot!</b>\n\n` + updatedText, updatedKeyboard);
            return;
          }

          if (promptData.field === 'bots') {
            const val = parseInt(rawText, 10);
            if (isNaN(val) || val < 1 || val > 1000) {
              await sendTelegramMessage(botToken, chatId, '⚠️ Please type a valid number of bots (e.g. <code>2</code>, <code>5</code>, <code>10</code>):');
              return;
            }
            targetReq.bots_count = val;
            (targetReq as any).customized_by_admin = true;
            saveAccessRequests();
            adminCustomPrompt.delete(chatId);
            const { text: updatedText, keyboard: updatedKeyboard } = formatAdminRequestAlert(targetReq);
            await sendTelegramMessage(botToken, chatId, `✅ <b>Bots Quota Updated to ${val} Bot(s)!</b>\n\n` + updatedText, updatedKeyboard);
            return;
          }

          if (promptData.field === 'days') {
            const val = parseInt(rawText, 10);
            if (isNaN(val) || val < 1 || val > 3650) {
              await sendTelegramMessage(botToken, chatId, '⚠️ Please type a valid number of days (e.g. <code>7</code>, <code>15</code>, <code>30</code>):');
              return;
            }
            targetReq.validity_days = val;
            (targetReq as any).customized_by_admin = true;
            saveAccessRequests();
            adminCustomPrompt.delete(chatId);
            const { text: updatedText, keyboard: updatedKeyboard } = formatAdminRequestAlert(targetReq);
            await sendTelegramMessage(botToken, chatId, `✅ <b>Validity Duration Updated to ${val} Day(s)!</b>\n\n` + updatedText, updatedKeyboard);
            return;
          }
        }

        if (cleanCommand === '/setdomain' || cleanCommand === '/domain') {
          if (argsText) {
            let newDomain = argsText.trim();
            if (!newDomain.startsWith('http://') && !newDomain.startsWith('https://')) {
              newDomain = 'https://' + newDomain;
            }
            newDomain = newDomain.replace(/\/$/, '');
            adminUser.custom_web_url = newDomain;
            setSystemConfiguredDomain(newDomain);
            if (billingStore.settings) {
              billingStore.settings.domain = newDomain;
              saveBillingLocal();
            }
            saveUsers();
            const finalUrl = getWebLoginUrl();
            await sendTelegramMessage(botToken, chatId, `✅ <b>Live Website URL Updated!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n🌐 <b>Active Login URL:</b>\n<code>${finalUrl}</code>\n\nLive login links will be automatically dispatched to new customers upon approval and in billing reminders.`);
            return;
          } else {
            const cur = getWebLoginUrl();
            await sendTelegramMessage(botToken, chatId, `🌐 <b>Current Live Website Login URL:</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n<code>${cur}</code>\n\nTo configure a custom VPS domain or link, send:\n<code>/setdomain https://your-vps-domain.com</code>`);
            return;
          }
        }

        // --- 1. /dm COMMAND (Strictly User-Wise Today, 5-Day & Per-Day DM Statistics & Joins) ---
        if (cleanCommand === '/dm' || cleanCommand === '/dmcount' || cleanCommand === '/dms') {
          const nonAdminUsers = usersList.filter((u: any) => u.role !== 'admin');
          if (nonAdminUsers.length === 0) {
            await sendTelegramMessage(botToken, chatId, '⚠️ <b>No regular users found in the system.</b>');
            return;
          }

          // Case A: Admin requested a specific user's breakdown (e.g. /dm rabiul or /dm @rabiul)
          if (argsText) {
            const cleanTarget = argsText.replace('@', '').trim().toLowerCase();
            const targetUser = nonAdminUsers.find((u: any) =>
              u.username.toLowerCase() === cleanTarget ||
              (u.display_name && u.display_name.toLowerCase().includes(cleanTarget))
            );

            if (!targetUser) {
              const available = nonAdminUsers.map(u => `• <code>${u.username}</code>`).join('\n');
              await sendTelegramMessage(botToken, chatId,
                `❌ <b>User "${argsText}" not found.</b>\n\n` +
                `<b>Available Users:</b>\n${available}\n\n` +
                `<i>Example:</i> <code>/dm ${nonAdminUsers[0]?.username || 'username'}</code>`
              );
              return;
            }

            const ov = getOwnerDmOverview(targetUser.username);
            let uReport = `📊 <b>Direct Messaging Performance: @${targetUser.username}</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `👤 <b>Account:</b> <code>${targetUser.username}</code> ${targetUser.display_name ? `(🏷️ ${targetUser.display_name})` : ''}\n` +
              `🤖 <b>Live Bots:</b> 🟢 <b>${ov.liveAccounts} Live</b> / ${ov.totalAccounts} Connected\n` +
              `🚀 <b>Today's Sent DMs:</b> <b>${ov.todayDms} DMs</b>\n` +
              `🎯 <b>Today's Channel Joins:</b> <b>${ov.todayJoins} Joins</b> <i>(${ov.convRate} ROI)</i>\n` +
              `📈 <b>Last 5-Days Total:</b> <b>${ov.sum5DaysDms} DMs</b> ➔ 🎯 <b>${ov.sum5DaysJoins} Joins</b>\n` +
              `⚡ <b>Daily Average:</b> <b>${ov.avgPerDayDms} DMs/day</b>\n` +
              `👑 <b>Lifetime Total Sent:</b> <b>${ov.lifetimeDms} DMs</b> ➔ 🎯 <b>${ov.lifetimeJoins} Joins</b>\n\n` +
              `📅 <b>Last 5 Days Per-Day Activity Breakdown:</b>\n`;

            ov.stats5Days.forEach((d: any, idx: number) => {
              const j = ov.joins5Days[idx]?.join_count || 0;
              const dayRoi = d.count > 0 ? ((j / d.count) * 100).toFixed(1) + '%' : (j > 0 ? '100%' : '0%');
              uReport += `  • <code>${formatDisplayDate(d.date)}</code>: <b>${d.count} DMs</b> ➔ 🎯 <b>${j} Joins</b> <i>(${dayRoi})</i>\n`;
            });

            if (ov.uAccs.length > 0) {
              uReport += `\n📱 <b>Bot Accounts:</b>\n`;
              ov.uAccs.forEach((a: any, idx: number) => {
                const st = a.running ? '🟢' : '🔴';
                const dms = Math.max((a as any).daily_sent_count || 0, (a as any).daily_extracted_count || 0);
                uReport += `  ${st} <b>#${idx + 1}</b> <code>${a.phone}</code>: <b>${dms} DMs today</b> (Total: ${a.sent_count || 0})\n`;
              });
            }

            await sendTelegramMessage(botToken, chatId, uReport);
            return;
          }

          // Case B: Full overview report for ALL active users
          let report = `📊 <b>User-wise DM & Join Performance</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          let totalTodayAll = 0;
          let totalTodayJoinsAll = 0;
          let total5DaysAll = 0;
          let total5DaysJoinsAll = 0;
          let totalLifetimeAll = 0;
          let totalLifetimeJoinsAll = 0;

          nonAdminUsers.forEach((u: any) => {
            const ov = getOwnerDmOverview(u.username);
            totalTodayAll += ov.todayDms;
            totalTodayJoinsAll += ov.todayJoins;
            total5DaysAll += ov.sum5DaysDms;
            total5DaysJoinsAll += ov.sum5DaysJoins;
            totalLifetimeAll += ov.lifetimeDms;
            totalLifetimeJoinsAll += ov.lifetimeJoins;

            report += `👤 <b>${u.username}</b> (🟢 ${ov.liveAccounts}/${ov.totalAccounts} IDs Live)\n`;
            report += `  • 🚀 <b>Today:</b> <code>${ov.todayDms} DMs</code> ➔ 🎯 <b>${ov.todayJoins} Joins</b> <i>(${ov.convRate})</i>\n`;
            report += `  • 📈 <b>5-Days:</b> <code>${ov.sum5DaysDms} DMs</code> (⚡ <code>${ov.avgPerDayDms} DMs/day</code>) ➔ 🎯 <b>${ov.sum5DaysJoins} Joins</b>\n`;
            report += `  • 👑 <b>Lifetime:</b> <code>${ov.lifetimeDms} DMs</code> ➔ 🎯 <code>${ov.lifetimeJoins} Joins</code>\n`;

            const breakdown = ov.stats5Days.map((d: any, idx: number) => {
              const j = ov.joins5Days[idx]?.join_count || 0;
              return `${formatDisplayDate(d.date).slice(0, 5)}: ${d.count} [🎯${j}]`;
            }).join(' | ');
            report += `  • <i>Per Day: ${breakdown}</i>\n`;
            report += `────────────────────────\n`;
          });

          report += `\n🔥 <b>Total Today:</b> <code>${totalTodayAll} DMs</code> ➔ 🎯 <code>${totalTodayJoinsAll} Joins</code>\n`;
          report += `📈 <b>Total 5-Days:</b> <code>${total5DaysAll} DMs</code> ➔ 🎯 <code>${total5DaysJoinsAll} Joins</code>\n`;
          report += `👑 <b>Total Lifetime:</b> <code>${totalLifetimeAll} DMs</code> ➔ 🎯 <code>${totalLifetimeJoinsAll} Joins</code>\n\n`;
          report += `👉 <i>Tip: Send <code>/dm username</code> to view an in-depth breakdown for that user.</i>`;

          await sendTelegramMessage(botToken, chatId, report);
          return;
        }

        // --- 2. /user or /users COMMAND (Strictly Total Users & Validity List) ---
        if (cleanCommand === '/user' || cleanCommand === '/users' || cleanCommand === '/userlist') {
          const nonAdminUsers = usersList.filter((u: any) => u.role !== 'admin');
          let report = `👥 <b>Total Registered Users (${nonAdminUsers.length})</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          
          nonAdminUsers.forEach((u: any, idx: number) => {
            const uAccs = Array.from(accounts.values()).filter((a: any) => (a.owner || 'admin').toLowerCase() === u.username.toLowerCase());
            const liveAccs = uAccs.filter((a: any) => a.running).length;
            const range = getUserCycleDateRange(u);
            const expDate = u.expiry_date ? formatDisplayDate(u.expiry_date) : 'Lifetime';
            const statusIcon = u.active ? (u.payment_paused ? '⏸️ (Paused)' : '🟢 (Active)') : '🔴 (Disabled)';

            report += `<b>${idx + 1}.</b> <b>${u.username}</b> ${statusIcon}\n`;
            report += `   • 📱 <b>Accounts:</b> ${uAccs.length} IDs (Live: ${liveAccs})\n`;
            report += `   • 📅 <b>Plan Validity:</b> <code>${range.formattedRange}</code>\n`;
            report += `   • ⏳ <b>Plan Expiry:</b> <code>${expDate}</code>\n`;
            if (u.display_name) report += `   • 🏷️ Name: ${u.display_name}\n`;
            report += `────────────────────────\n`;
          });

          await sendTelegramMessage(botToken, chatId, report);
          return;
        }

        // --- 3. /khatabook or /due (Pending Dues & Balances) ---
        if (cleanCommand === '/khatabook' || cleanCommand === '/due' || cleanCommand === '/dues' || cleanCommand === '/billings') {
          const nonAdminUsers = usersList.filter((u: any) => u.role !== 'admin');
          const curr = (billingStore.currency || 'INR') === 'INR' ? '₹' : '$';
          let totalDueSum = 0;
          let report = `💳 <b>Khatabook - Outstanding Dues & Balances</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;

          let dueCount = 0;
          nonAdminUsers.forEach((u: any) => {
            const uLedger = (billingStore.user_ledgers || {})[u.username] || {};
            const bal = Number(uLedger.balance_due || 0);
            const isAdvance = bal < 0;
            const isDue = bal > 0;
            if (isDue) {
              totalDueSum += bal;
              dueCount++;
            }

            const balStr = isDue 
              ? `🔴 <b>${curr}${bal.toLocaleString()} Due</b>` 
              : (isAdvance ? `⭐ <b>-${curr}${Math.abs(bal).toLocaleString()} (Adv)</b>` : `🟢 <b>${curr}0 (All Paid)</b>`);

            report += `• <b>${u.username}</b>: ${balStr} | ⏳ <code>${formatDisplayDate(u.expiry_date)}</code>\n`;
          });

          report += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          report += `💰 <b>Total Outstanding Due to Collect:</b> <code>${curr}${totalDueSum.toLocaleString()}</code> (${dueCount} Users)\n\n`;
          report += `👉 <i>Tip: To record payment:</i>\n<code>/pay username 105</code>\n`;
          report += `👉 <i>To send billing reminder:</i>\n<code>/remind username</code>`;

          await sendTelegramMessage(botToken, chatId, report);
          return;
        }

        // --- 4. /pay <username> <amount> (Record Payment & Auto Extend Validity) ---
        if (cleanCommand === '/pay' || cleanCommand === '/jama') {
          const parts = argsText.split(' ').filter(Boolean);
          if (parts.length < 2) {
            await sendTelegramMessage(botToken, chatId, `⚠️ <b>Command Usage:</b>\n<code>/pay username amount [note]</code>\n\n<b>Example:</b>\n<code>/pay rabiul 105</code>`);
            return;
          }
          const targetUser = parts[0].replace('@', '').trim();
          const amt = parseFloat(parts[1]);
          const note = parts.slice(2).join(' ') || 'Payment recorded via Telegram Admin Bot';

          if (isNaN(amt) || amt <= 0) {
            await sendTelegramMessage(botToken, chatId, `❌ Invalid amount: "${parts[1]}". Enter positive number.`);
            return;
          }

          const u = usersList.find((x: any) => x.username.toLowerCase() === targetUser.toLowerCase());
          if (!u) {
            await sendTelegramMessage(botToken, chatId, `❌ User "${targetUser}" not found in system.`);
            return;
          }

          // Record payment and auto-extend 7 days ONLY if all dues are cleared!
          const payResult = applyPaymentAndCheckAutoExtend(u.username, amt, 'UPI', note, 'Telegram Admin Bot');
          const curr = (billingStore.currency || 'INR') === 'INR' ? '₹' : '$';
          const newBal = payResult.summary?.balance_due || 0;
          const dueMsg = newBal > 0 ? `${curr}${newBal.toLocaleString()} Due` : (newBal < 0 ? `-${curr}${Math.abs(newBal).toLocaleString()} (Adv)` : '₹0 (All Paid)');
          const range = getUserCycleDateRange(u);
          const extMsg = payResult.extended 
            ? `\n🎉 <b>All Dues Cleared!</b> Validity automatically extended by +7 Days until <code>${formatDisplayDate(payResult.newExpiry)}</code>!` 
            : (newBal > 0 ? `\nℹ️ <i>Remaining Due: ₹${newBal.toLocaleString()}. Plan expiry NOT extended until full settlement.</i>` : '');

          await sendTelegramMessage(botToken, chatId, `✅ <b>Payment Recorded Successfully!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n👤 <b>User:</b> <code>${u.username}</code>\n💵 <b>Amount Received:</b> <b>${curr}${amt.toLocaleString()}</b>\n💳 <b>Current Balance:</b> <b>${dueMsg}</b>\n📅 <b>Plan Validity:</b> <code>${range.formattedRange}</code>\n⏳ <b>Plan Valid Until:</b> <code>${formatDisplayDate(u.expiry_date)}</code>${extMsg}\n\n⚡ User ledger updated and bots active!`);
          return;
        }

        // --- 5. /remind <username> (Send Direct Billing Reminder) ---
        if (cleanCommand === '/remind') {
          const targetUser = argsText.replace('@', '').trim();
          if (!targetUser) {
            await sendTelegramMessage(botToken, chatId, `⚠️ <b>Command Usage:</b>\n<code>/remind username</code>\n\n<b>Example:</b>\n<code>/remind rabiul</code>`);
            return;
          }
          const u = usersList.find((x: any) => x.username.toLowerCase() === targetUser.toLowerCase());
          if (!u) {
            await sendTelegramMessage(botToken, chatId, `❌ User "${targetUser}" not found in system.`);
            return;
          }
          const res = await sendUserBillingReminder(u.username);
          await sendTelegramMessage(botToken, chatId, res.msg);
          return;
        }

        // --- 6. /remindall (Send Reminder to All Due Users) ---
        if (cleanCommand === '/remindall') {
          const nonAdminUsers = usersList.filter((u: any) => u.role !== 'admin');
          let sentCount = 0;
          let failedCount = 0;

          for (const u of nonAdminUsers) {
            const uLedger = (billingStore.user_ledgers || {})[u.username] || {};
            const bal = Number(uLedger.balance_due || 0);
            if (bal > 0) {
              const res = await sendUserBillingReminder(u.username);
              if (res.ok) sentCount++;
              else failedCount++;
            }
          }

          await sendTelegramMessage(botToken, chatId, `📢 <b>Mass Payment Reminders Sent!</b>\n\n✅ <b>Delivered:</b> ${sentCount} users\n⚠️ <b>No Telegram Linked:</b> ${failedCount} users`);
          return;
        }

        // --- 7. /pause <username> and /unpause <username> ---
        if (cleanCommand === '/pause') {
          const targetUser = argsText.replace('@', '').trim();
          const u = usersList.find((x: any) => x.username.toLowerCase() === targetUser.toLowerCase());
          if (!u) {
            await sendTelegramMessage(botToken, chatId, `❌ User "${targetUser}" not found.`);
            return;
          }
          u.payment_paused = true;
          for (const a of accounts.values()) {
            if ((a.owner || 'admin') === u.username && a.running) {
              a.running = false;
              if (a.abortController) a.abortController.abort();
              a.status = 'Paused (Payment Overdue)';
            }
          }
          saveUsers();
          await sendTelegramMessage(botToken, chatId, `⏸️ <b>Bots Paused for ${u.username}</b>\nAll running bots stopped due to payment overdue.`);
          return;
        }

        if (cleanCommand === '/unpause') {
          const targetUser = argsText.replace('@', '').trim();
          const u = usersList.find((x: any) => x.username.toLowerCase() === targetUser.toLowerCase());
          if (!u) {
            await sendTelegramMessage(botToken, chatId, `❌ User "${targetUser}" not found.`);
            return;
          }
          u.payment_paused = false;
          saveUsers();
          await sendTelegramMessage(botToken, chatId, `▶️ <b>Bots Unpaused for ${u.username}</b>\nUser can now resume and run bots smoothly.`);
          return;
        }

        if (cleanCommand === '/start' || cleanCommand === '/admin' || cleanCommand === '/status' || cleanCommand === '/menu') {
          if (argsText) {
            // Check if user ran "/start AccountName"
            const name = argsText;
            const acc = Array.from(accounts.values()).find(a => (a.name || '').toLowerCase() === name.toLowerCase());
            if (acc) { 
              (acc as any).running = true; 
              await sendTelegramMessage(botToken, chatId, `✅ Account <b>${acc.name}</b> started!`); 
            } else {
              await sendTelegramMessage(botToken, chatId, `❌ Account with name '${name}' not found!`); 
            }
            return;
          }
          const { text: t, keyboard: k } = formatAdminMenu();
          await sendTelegramMessage(botToken, chatId, t, k);
          return;
        } else if (cleanCommand === '/requests' || cleanCommand === '/req' || cleanCommand === '/onboard') {
          const pending = accessRequests.filter(r => r.status === 'pending');
          if (pending.length === 0) {
            await sendTelegramMessage(botToken, chatId, '✅ <b>No pending user access requests at the moment!</b>');
            return;
          }
          for (const r of pending.slice(0, 5)) {
            const { text: alertMsg, keyboard: k } = formatAdminRequestAlert(r);
            await sendTelegramMessage(botToken, chatId, alertMsg, k);
          }
          return;
        } else if (cleanCommand === '/control') {
          const keyboard = usersList.filter((u: any) => u.role !== 'admin').map((u: any) => [{ text: `👤 ${u.username}`, callback_data: `adm_ctrl_u:${u.username}` }]);
          keyboard.push([{ text: '🔄 Refresh', callback_data: 'adm_ctrl_refresh' }]);
          await sendTelegramMessage(botToken, chatId, '🎛️ <b>Admin Bot Remote Control Panel</b>\n\n👇 Select a user to manage their Telegram accounts:', keyboard);
          return;
        } else if (cleanCommand === '/stop') {
          const name = argsText;
          const acc = Array.from(accounts.values()).find(a => (a.name || '').toLowerCase() === name.toLowerCase());
          if (acc) { 
            (acc as any).running = false; 
            await sendTelegramMessage(botToken, chatId, `🛑 Account <b>${acc.name}</b> stopped!`); 
          } else {
            await sendTelegramMessage(botToken, chatId, `❌ Account with name '${name}' not found!`); 
          }
          return;
        } else if (cleanCommand === '/dmstatus') {
          const keyboard = usersList.filter((u: any) => u.role !== 'admin').map((u: any) => [{ text: u.username, callback_data: `admin_dm_user:${u.username}` }]);
          await sendTelegramMessage(botToken, chatId, 'Select a user to check DM status:', keyboard);
          return;
        } else if (cleanCommand === '/gemini' || cleanCommand === '/ai' || cleanCommand === '/report') {
          const { text: t, keyboard: k } = formatGeminiReport(5);
          await sendTelegramMessage(botToken, chatId, t, k);
          return;
        } else if (cleanCommand === '/expiry' || cleanCommand === '/exp') {
          const { text: t, keyboard: k } = formatAdminExpiryList();
          await sendTelegramMessage(botToken, chatId, t, k);
          return;
        } else if (cleanCommand === '/vps' || cleanCommand === '/health' || cleanCommand === '/server' || cleanCommand === '/specs') {
          const { text: t, keyboard: k } = await formatVpsStatusMessage();
          await sendTelegramMessage(botToken, chatId, t, k);
          return;
        } else {
          // If unrecognized command sent to admin, do NOT execute menu repeatedly
          return;
        }
      }

      // If this token belongs to a User (NOT admin)
      if (matchedUser) {
        const uAccs = Array.from(accounts.values()).filter((a) => (a.owner || 'admin').toLowerCase() === matchedUser.username.toLowerCase());
        // --- USER SPECIFIC COMMANDS ---
        if (cleanCommand === '/mydm' || cleanCommand === '/dm' || cleanCommand === '/mystats') {
          const ov = getOwnerDmOverview(matchedUser.username);
          let msg = `📊 <b>My Direct Messaging Performance</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `👤 <b>Account:</b> <code>${matchedUser.username}</code>\n` +
                    `🤖 <b>Live Bots:</b> 🟢 <b>${ov.liveAccounts} Live</b> / ${ov.totalAccounts} Connected\n` +
                    `🔥 <b>Today's Sent DMs:</b> <b>${ov.todayDms} DMs</b>\n` +
                    `🎯 <b>Today's Channel Joins:</b> <b>${ov.todayJoins} Joins</b> <i>(${ov.convRate} ROI)</i>\n` +
                    `👑 <b>Lifetime Joins:</b> <b>${ov.lifetimeJoins} Joins</b>\n` +
                    `📈 <b>Last 5-Days Total:</b> <b>${ov.sum5DaysDms} DMs</b> ➔ 🎯 <b>${ov.sum5DaysJoins} Joins</b>\n` +
                    `⚡ <b>Daily Average:</b> <b>${ov.avgPerDayDms} DMs/day</b>\n` +
                    `👑 <b>Lifetime Total Sent:</b> <b>${ov.lifetimeDms} DMs</b>\n\n`;
          if (ov.stats5Days.length > 0) {
            msg += `📅 <b>Last 5 Days Activity Breakdown:</b>\n`;
            ov.stats5Days.slice(0, 5).forEach((d: any, idx: number) => {
              const jCount = ov.joins5Days[idx]?.join_count || 0;
              msg += `  • <code>${formatDisplayDate(d.date)}</code>: <b>${d.count} DMs</b> ➔ 🎯 <b>${jCount} Joins</b>\n`;
            });
          }
          await sendTelegramMessage(botToken, chatId, msg);
          return;
        }

        if (cleanCommand === '/mybots' || cleanCommand === '/bots') {
          let msg = `📱 <b>My Connected Telegram Bots (${uAccs.length})</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          if (uAccs.length === 0) {
            msg += `<i>No phone numbers linked yet. Add accounts from dashboard.</i>`;
          } else {
            uAccs.forEach((a: any, idx: number) => {
              const status = a.running ? '🟢 Running' : '🔴 Stopped';
              const dms = (a as any).daily_sent_count || 0;
              msg += `<b>${idx + 1}.</b> <code>${a.phone}</code> | ${status} | Today: <b>${dms} DMs</b>\n`;
            });
          }
          await sendTelegramMessage(botToken, chatId, msg);
          return;
        }

        if (cleanCommand === '/bill' || cleanCommand === '/mybill' || cleanCommand === '/khatabook' || cleanCommand === '/dues' || cleanCommand === '/due') {
          await handleCustomerBillCommand(botToken, chatId, msg, adminUser, null, matchedUser);
          return;
        }

        if (cleanCommand === '/payinfo' || cleanCommand === '/pay') {
          const uLedger = (billingStore.user_ledgers || {})[matchedUser.username] || {};
          const bal = Number(uLedger.balance_due || 0);
          const curr = (billingStore.currency || 'INR') === 'INR' ? '₹' : '$';
          const dueStr = bal > 0 ? `🔴 ${curr}${bal.toLocaleString()} Due (Pending)` : `🟢 ${curr}0 (All Paid)`;
          const range = getUserCycleDateRange(matchedUser);

          let msg = `💳 <b>Payment & Renewal Information</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `👤 <b>Account:</b> <code>${matchedUser.username}</code>\n` +
                    `💳 <b>Current Balance Due:</b> <b>${dueStr}</b>\n` +
                    `📅 <b>Plan Validity:</b> <code>${range.formattedRange}</code>\n` +
                    `⏳ <b>Validity Expiry:</b> <code>${formatDisplayDate(matchedUser.expiry_date)}</code>\n\n` +
                    `To renew your plan or clear pending balance, please transfer via UPI to Administrator and send payment screenshot here.\n\n` +
                    `⚡ Need help? Send <code>/bill</code> to view your full statement or contact Administrator!`;
          await sendTelegramMessage(botToken, chatId, msg);
          return;
        }

        // --- /start, /link, or deep-link /start link_<username> ---
        if (cleanCommand === '/start' || cleanCommand === '/link' || rawText.startsWith('/start link_') || rawText.startsWith('/link ')) {
          let targetUser = matchedUser;
          let targetUname = '';
          if (rawText.startsWith('/start link_')) {
            targetUname = rawText.replace('/start link_', '').trim().replace('@', '').toLowerCase();
          } else if (rawText.startsWith('/link ')) {
            targetUname = rawText.replace('/link ', '').trim().replace('@', '').toLowerCase();
          }
          if (targetUname) {
            const found = usersList.find((u: any) => u.username.toLowerCase() === targetUname);
            if (found) targetUser = found;
          }

          // Link Chat ID to the user account
          targetUser.alert_chat_id = chatId;
          targetUser.telegram_id = chatId;
          targetUser.alert_enabled = true;
          if (msg.from?.username) targetUser.telegram_username = msg.from.username;
          if (msg.from?.first_name) targetUser.telegram_name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
          saveUsers();
          broadcastAccountUpdate(targetUser.username);
          console.log(`[USER BOT LINK SUCCESS]: Linked ${targetUser.username} with Telegram Chat ID: ${chatId} (${msg.from?.username || ''})`);

          let linkSuccessNotice = `✅ <b>Telegram Bot Connected Successfully!</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 <b>User Account:</b> <code>${targetUser.username}</code>\n` +
            `🆔 <b>Linked Chat ID:</b> <code>${chatId}</code>\n` +
            `⏳ <b>Plan Expiry:</b> <code>${formatDisplayDate(targetUser.expiry_date)}</code>\n\n` +
            `⚡ <i>Your Telegram Bot is now connected to your dashboard! Live alerts, DM reports, and validity notices are active.</i>\n\n`;

          const { text: t, keyboard: k } = formatUserMenu(targetUser, uAccs);
          await sendTelegramMessage(botToken, chatId, linkSuccessNotice + t, k);
          return;
        }

        if (cleanCommand === '/status' || cleanCommand === '/menu') {
          const { text: t, keyboard: k } = formatUserMenu(matchedUser, uAccs);
          await sendTelegramMessage(botToken, chatId, t, k);
          return;
        } else if (cleanCommand === '/all' || cleanCommand === '/stats') {
          let report = `📊 <b>Accounts Summary for ${matchedUser.username}</b>\n\n`;
          uAccs.forEach((a, idx) => {
            const isLive = a.running ? '🟢 Live' : '🔴 Stopped';
            const count = (a as any).daily_extracted_count || 0;
            report += `<b>${idx + 1}.</b> <code>${a.phone}</code> | ${isLive} | <b>${count} Extracted</b>\n`;
          });
          const ownerQ = getOwnerQueueLength(matchedUser.username);
          report += `\n👥 <b>Shared Common Queue:</b> ${ownerQ} leads`;
          await sendTelegramMessage(botToken, chatId, report, [
            [{ text: '📱 Interactive Accounts Menu', callback_data: `umenu:${matchedUser.username}` }]
          ]);
          return;
        }
        return;
      }
    }

    if (update.callback_query) {
      const cb = update.callback_query;
      const callbackId = cb.id;
      const chatId = String(cb.message?.chat?.id || '');
      const msgId = cb.message?.message_id;
      const data = String(cb.data || '');

      await answerTelegramCallback(botToken, callbackId);

      // --- CUSTOMER ONBOARDING ACTIONS ---
      if (data.startsWith('cust_')) {
        await handleCustomerOnboardingCallback(botToken, chatId, cb, adminUser);
        return;
      }

      // --- ADMIN APPROVE/REJECT CUSTOMER ACCESS REQUESTS ---
      if (data.startsWith('usr_appr_plan:') || data.startsWith('usr_appr:')) {
        let reqId = '';
        let planModel = 'postpaid';
        let approvedRate = 10;
        if (data.startsWith('usr_appr_plan:')) {
          const parts = data.split(':');
          reqId = parts[1];
          planModel = parts[2] || 'postpaid';
          approvedRate = Number(parts[3]) || 10;
        } else {
          reqId = data.replace('usr_appr:', '');
        }
        await handleAdminUserRequestApproval(botToken, chatId, reqId, msgId, adminUser, planModel, approvedRate);
        return;
      }

      if (data.startsWith('adm_sub_nrate:')) {
        const reqId = data.split(':')[1];
        const r = accessRequests.find((x) => x.id === reqId);
        if (!r || r.status !== 'pending') {
          await sendTelegramMessage(botToken, chatId, '⚠️ Request is no longer pending or was not found.', null, msgId);
          return;
        }
        const { text, keyboard } = formatAdminRequestAlert(r, 'edit_rate');
        await sendTelegramMessage(botToken, chatId, text, keyboard, msgId);
        return;
      }

      if (data.startsWith('adm_set_nrate:')) {
        const parts = data.split(':');
        const reqId = parts[1];
        const rate = parseInt(parts[2], 10) || 10;
        const r = accessRequests.find((x) => x.id === reqId);
        if (!r || r.status !== 'pending') {
          await sendTelegramMessage(botToken, chatId, '⚠️ Request is no longer pending.', null, msgId);
          return;
        }
        r.rate_per_bot = rate;
        (r as any).customized_by_admin = true;
        saveAccessRequests();
        const { text, keyboard } = formatAdminRequestAlert(r);
        await sendTelegramMessage(botToken, chatId, text, keyboard, msgId);
        return;
      }

      if (data.startsWith('adm_type_nrate:')) {
        const reqId = data.split(':')[1];
        adminCustomPrompt.set(chatId, { reqId, field: 'rate' });
        await sendTelegramMessage(botToken, chatId, `💬 <b>Type Custom Rate per Bot:</b>\n\nEnter the rate in ₹ per bot per week (e.g. <code>10</code>, <code>15</code>, <code>20</code>):`);
        return;
      }

      if (data.startsWith('usr_appr_ext:')) {
        const reqId = data.replace('usr_appr_ext:', '');
        await handleAdminValidityExtensionApproval(botToken, chatId, reqId, msgId, adminUser);
        return;
      }

      if (data.startsWith('usr_appr_bots:')) {
        const reqId = data.replace('usr_appr_bots:', '');
        await handleAdminExtraBotsApproval(botToken, chatId, reqId, msgId, adminUser);
        return;
      }

      if (data.startsWith('usr_rej:')) {
        const reqId = data.replace('usr_rej:', '');
        await handleAdminUserRequestRejection(botToken, chatId, reqId, msgId);
        return;
      }

      // --- ADMIN REQUEST CUSTOMIZATION CALLBACKS ---
      if (data.startsWith('adm_sub_nbots:') || data.startsWith('adm_sub_slots:')) {
        const reqId = data.split(':')[1];
        const r = accessRequests.find((x) => x.id === reqId);
        if (!r || r.status !== 'pending') {
          await sendTelegramMessage(botToken, chatId, '⚠️ Request is no longer pending or was not found.', null, msgId);
          return;
        }
        const { text, keyboard } = formatAdminRequestAlert(r, 'edit_bots');
        await sendTelegramMessage(botToken, chatId, text, keyboard, msgId);
        return;
      }

      if (data.startsWith('adm_sub_ndays:') || data.startsWith('adm_sub_ext:')) {
        const reqId = data.split(':')[1];
        const r = accessRequests.find((x) => x.id === reqId);
        if (!r || r.status !== 'pending') {
          await sendTelegramMessage(botToken, chatId, '⚠️ Request is no longer pending or was not found.', null, msgId);
          return;
        }
        const { text, keyboard } = formatAdminRequestAlert(r, 'edit_days');
        await sendTelegramMessage(botToken, chatId, text, keyboard, msgId);
        return;
      }

      if (data.startsWith('adm_set_nbots:') || data.startsWith('adm_set_slots:')) {
        const parts = data.split(':');
        const reqId = parts[1];
        const count = parseInt(parts[2], 10) || 1;
        const r = accessRequests.find((x) => x.id === reqId);
        if (!r || r.status !== 'pending') {
          await sendTelegramMessage(botToken, chatId, '⚠️ Request is no longer pending.', null, msgId);
          return;
        }
        r.bots_count = count;
        (r as any).customized_by_admin = true;
        saveAccessRequests();
        const { text, keyboard } = formatAdminRequestAlert(r);
        await sendTelegramMessage(botToken, chatId, text, keyboard, msgId);
        return;
      }

      if (data.startsWith('adm_set_ndays:') || data.startsWith('adm_set_ext:')) {
        const parts = data.split(':');
        const reqId = parts[1];
        const days = parseInt(parts[2], 10) || 30;
        const r = accessRequests.find((x) => x.id === reqId);
        if (!r || r.status !== 'pending') {
          await sendTelegramMessage(botToken, chatId, '⚠️ Request is no longer pending.', null, msgId);
          return;
        }
        r.validity_days = days;
        (r as any).customized_by_admin = true;
        saveAccessRequests();
        const { text, keyboard } = formatAdminRequestAlert(r);
        await sendTelegramMessage(botToken, chatId, text, keyboard, msgId);
        return;
      }

      if (data.startsWith('adm_type_nbots:') || data.startsWith('adm_type_slots:')) {
        const reqId = data.split(':')[1];
        adminCustomPrompt.set(chatId, { reqId, field: 'bots' });
        await sendTelegramMessage(botToken, chatId, `💬 <b>Type Custom Bots Quota:</b>\n\nPlease type the number of bots in chat (e.g. <code>2</code>, <code>5</code>, <code>10</code>, <code>25</code>):`);
        return;
      }

      if (data.startsWith('adm_type_ndays:') || data.startsWith('adm_type_ext:')) {
        const reqId = data.split(':')[1];
        adminCustomPrompt.set(chatId, { reqId, field: 'days' });
        await sendTelegramMessage(botToken, chatId, `💬 <b>Type Custom Validity Days:</b>\n\nPlease type the number of days in chat (e.g. <code>15</code>, <code>45</code>, <code>90</code>, <code>180</code>):`);
        return;
      }

      if (data.startsWith('adm_view_req:')) {
        const reqId = data.split(':')[1];
        adminCustomPrompt.delete(chatId);
        const r = accessRequests.find((x) => x.id === reqId);
        if (!r) {
          await sendTelegramMessage(botToken, chatId, '⚠️ Request not found.', null, msgId);
          return;
        }
        const { text, keyboard } = formatAdminRequestAlert(r);
        await sendTelegramMessage(botToken, chatId, text, keyboard, msgId);
        return;
      }

      // --- ADMIN ACTIONS ---
      if (data === 'adm_ctrl_refresh') {
        const keyboard = usersList.filter((u: any) => u.role !== 'admin').map((u: any) => [{ text: `👤 ${u.username}`, callback_data: `adm_ctrl_u:${u.username}` }]);
        keyboard.push([{ text: '🔄 Refresh', callback_data: 'adm_ctrl_refresh' }]);
        await sendTelegramMessage(botToken, chatId, '🎛️ <b>Admin Bot Remote Control Panel</b>\n\n👇 Select a user to manage their Telegram accounts:', keyboard, msgId);
        return;
      }

      if (data.startsWith('adm_ctrl_u:')) {
        const uname = data.split(':')[1];
        const uAccs = Array.from(accounts.values()).filter((a) => (a.owner || 'admin') === uname);
        if (uAccs.length === 0) {
          const keyboard = [[{ text: '🔙 Back to Users', callback_data: 'adm_ctrl_refresh' }]];
          await sendTelegramMessage(botToken, chatId, `⚠️ User <b>@${uname}</b> has no connected accounts.`, keyboard, msgId);
          return;
        }
        const keyboard = uAccs.map((a: any) => {
          const isLive = a.running ? '🟢' : '🔴';
          const title = `${isLive} ${a.name || a.phone}`;
          return [{ text: title, callback_data: `adm_ctrl_id:${uname}:${a.phone}` }];
        });
        keyboard.push([{ text: '🔙 Back to Users', callback_data: 'adm_ctrl_refresh' }]);
        await sendTelegramMessage(botToken, chatId, `🎛️ <b>User: @${uname}</b>\n\n👇 Select an ID to manage its Bot, DM & Live Monitoring:`, keyboard, msgId);
        return;
      }

      if (data.startsWith('adm_ctrl_id:')) {
        const parts = data.split(':');
        const uname = parts[1];
        const phone = parts[2];
        const acc = accounts.get(phone);
        if (!acc) {
          await sendTelegramMessage(botToken, chatId, `❌ Account ${phone} not found!`, [[{ text: '🔙 Back', callback_data: `adm_ctrl_u:${uname}` }]], msgId);
          return;
        }

        const isBotOn = Boolean(acc.running);
        const isDmOn = acc.dm_on !== false;
        const isLiveOn = acc.live_on !== false;

        const info = `🎛️ <b>Account Control: ${acc.name || acc.phone}</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 <b>Owner:</b> @${uname}\n` +
          `📱 <b>Phone:</b> <code>${acc.phone}</code>\n` +
          `🤖 <b>Bot Status:</b> ${isBotOn ? '🟢 Running' : '🔴 Stopped'}\n` +
          `💬 <b>DM Sending:</b> ${isDmOn ? '🟢 ACTIVE' : '🔴 OFF'}\n` +
          `📡 <b>Live Monitoring:</b> ${isLiveOn ? '🟢 ACTIVE' : '🔴 OFF'}\n` +
          `🎯 <b>Sent Today:</b> <b>${(acc as any).daily_extracted_count || 0} (Unlimited)</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<i>Toggle or start/stop any module below:</i>`;

        const keyboard = [
          [
            { text: isBotOn ? '⏹️ STOP Entire Bot' : '▶️ START Entire Bot', callback_data: `adm_ctrl_act:${uname}:${phone}:toggle_bot` }
          ],
          [
            { text: isDmOn ? '⏸️ Stop DM' : '▶️ Start DM', callback_data: `adm_ctrl_act:${uname}:${phone}:toggle_dm` },
            { text: isLiveOn ? '⏸️ Stop Live' : '▶️ Start Live', callback_data: `adm_ctrl_act:${uname}:${phone}:toggle_live` }
          ],
          [
            { text: '🔄 Refresh', callback_data: `adm_ctrl_id:${uname}:${phone}` },
            { text: '🔙 Back to IDs', callback_data: `adm_ctrl_u:${uname}` }
          ]
        ];

        await sendTelegramMessage(botToken, chatId, info, keyboard, msgId);
        return;
      }

      if (data.startsWith('adm_ctrl_act:')) {
        const parts = data.split(':');
        const uname = parts[1];
        const phone = parts[2];
        const action = parts[3];
        const acc = accounts.get(phone);

        if (!acc) {
          await sendTelegramMessage(botToken, chatId, `❌ Account ${phone} not found!`, null, msgId);
          return;
        }

        if (action === 'toggle_bot') {
          if (acc.running) {
            // STOP BOT
            acc.running = false;
            if (acc.abortController) {
              acc.abortController.abort();
            }
            acc.status = 'Stopped by Admin Bot';
            broadcastAccountUpdate(acc.owner || uname);
          } else {
            // START BOT
            acc.running = true;
            if (acc.live_on === undefined) acc.live_on = true;
            if (acc.dm_on === undefined) acc.dm_on = true;
            acc.status = 'Starting via Admin Bot...';
            broadcastAccountUpdate(acc.owner || uname);

            const abortController = new AbortController();
            acc.abortController = abortController;
            launchBotWorker(phone, abortController);
          }
        } else if (action === 'toggle_dm') {
          acc.dm_on = !(acc.dm_on !== false);
          broadcastAccountUpdate(acc.owner || uname);
        } else if (action === 'toggle_live') {
          acc.live_on = !(acc.live_on !== false);
          broadcastAccountUpdate(acc.owner || uname);
        }

        // Re-render the account control screen
        const isBotOn = Boolean(acc.running);
        const isDmOn = acc.dm_on !== false;
        const isLiveOn = acc.live_on !== false;

        const info = `🎛️ <b>Account Control: ${acc.name || acc.phone}</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 <b>Owner:</b> @${uname}\n` +
          `📱 <b>Phone:</b> <code>${acc.phone}</code>\n` +
          `🤖 <b>Bot Status:</b> ${isBotOn ? '🟢 Running' : '🔴 Stopped'}\n` +
          `💬 <b>DM Sending:</b> ${isDmOn ? '🟢 ACTIVE' : '🔴 OFF'}\n` +
          `📡 <b>Live Monitoring:</b> ${isLiveOn ? '🟢 ACTIVE' : '🔴 OFF'}\n` +
          `🎯 <b>Sent Today:</b> <b>${(acc as any).daily_extracted_count || 0} (Unlimited)</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `✅ <i>Action updated successfully!</i>`;

        const keyboard = [
          [
            { text: isBotOn ? '⏹️ STOP Entire Bot' : '▶️ START Entire Bot', callback_data: `adm_ctrl_act:${uname}:${phone}:toggle_bot` }
          ],
          [
            { text: isDmOn ? '⏸️ Stop DM' : '▶️ Start DM', callback_data: `adm_ctrl_act:${uname}:${phone}:toggle_dm` },
            { text: isLiveOn ? '⏸️ Stop Live' : '▶️ Start Live', callback_data: `adm_ctrl_act:${uname}:${phone}:toggle_live` }
          ],
          [
            { text: '🔄 Refresh', callback_data: `adm_ctrl_id:${uname}:${phone}` },
            { text: '🔙 Back to IDs', callback_data: `adm_ctrl_u:${uname}` }
          ]
        ];

        await sendTelegramMessage(botToken, chatId, info, keyboard, msgId);
        return;
      }

      if (data.startsWith('admin_dm_user:')) {
        const uname = data.split(':')[1];
        const uAccs = Array.from(accounts.values()).filter((a) => (a.owner || 'admin') === uname);
        const keyboard = uAccs.map((a: any) => [{ text: a.name || a.phone, callback_data: `admin_dm_id:${a.name}` }]);
        await sendTelegramMessage(botToken, chatId, `Select an ID for ${uname}:`, keyboard, msgId);
        return;
      }
      if (data.startsWith('admin_dm_id:')) {
        const name = data.split(':')[1];
        const acc = Array.from(accounts.values()).find(a => (a.name || '') === name);
        if (acc) {
          const sent = (acc as any).daily_extracted_count || 0;
          await sendTelegramMessage(botToken, chatId, `📊 ID Name: <b>${name}</b>\n✅ Total DM Sent: <b>${sent}</b>`, [], msgId);
        } else {
          await sendTelegramMessage(botToken, chatId, `❌ Account ${name} not found!`, [], msgId);
        }
        return;
      }

      // --- USER ACTIONS ---
      if (data.startsWith('umenu:')) {
        const uname = data.split(':')[1];
        const u = getUser(uname);
        if (u) {
          const uAccs = Array.from(accounts.values()).filter((a) => (a.owner || 'admin') === u.username);
          const { text: t, keyboard: k } = formatUserMenu(u, uAccs);
          await sendTelegramMessage(botToken, chatId, t, k, msgId);
        }
        return;
      }

      if (data.startsWith('uacc:')) {
        const parts = data.split(':');
        const uname = parts[1];
        const phone = parts[2];
        const u = getUser(uname);
        const acc = accounts.get(phone);
        if (u && acc) {
          const { text: t, keyboard: k } = formatAccountDetail(u, acc, `umenu:${uname}`);
          await sendTelegramMessage(botToken, chatId, t, k, msgId);
        }
        return;
      }

      if (data.startsWith('uall:')) {
        const uname = data.split(':')[1];
        const u = getUser(uname);
        if (u) {
          const uAccs = Array.from(accounts.values()).filter((a) => (a.owner || 'admin') === u.username);
          let report = `📊 <b>Accounts Summary for ${u.username}</b>\n\n`;
          uAccs.forEach((a, idx) => {
            const isLive = a.running ? '🟢 Live' : '🔴 Stopped';
            const count = (a as any).daily_extracted_count || 0;
            report += `<b>${idx + 1}.</b> <code>${a.phone}</code> | ${isLive} | <b>${count} Extracted</b>\n`;
          });
          const ownerQ = getOwnerQueueLength(u.username);
          report += `\n👥 <b>Shared Common Queue:</b> ${ownerQ} leads`;
          await sendTelegramMessage(botToken, chatId, report, [
            [{ text: '🔙 Back to Accounts List', callback_data: `umenu:${u.username}` }]
          ], msgId);
        }
        return;
      }

      // --- ADMIN ACTIONS ---
      
      if (data.startsWith('gemini_rep:')) {
        const days = parseInt(data.split(':')[1], 10);
        const { text: t, keyboard: k } = formatGeminiReport(days);
        await sendTelegramMessage(botToken, chatId, t, k, msgId);
        return;
      }

      if (data === 'adm_main') {
        const { text: t, keyboard: k } = formatAdminMenu();
        await sendTelegramMessage(botToken, chatId, t, k, msgId);
        return;
      }

      if (data === 'adm_exp:all') {
        const { text: t, keyboard: k } = formatAdminExpiryList();
        await sendTelegramMessage(botToken, chatId, t, k, msgId);
        return;
      }

      if (data === 'adm_vps_health') {
        const { text: t, keyboard: k } = await formatVpsStatusMessage();
        await sendTelegramMessage(botToken, chatId, t, k, msgId);
        return;
      }

      if (data.startsWith('adm_u:')) {
        const uname = data.split(':')[1];
        const u = getUser(uname);
        if (u) {
          const { text: t, keyboard: k } = formatAdminUserView(u);
          await sendTelegramMessage(botToken, chatId, t, k, msgId);
        }
        return;
      }

      if (data.startsWith('adm_acc:')) {
        const parts = data.split(':');
        const uname = parts[1];
        const phone = parts[2];
        const u = getUser(uname);
        const acc = accounts.get(phone);
        if (u && acc) {
          const { text: t, keyboard: k } = formatAccountDetail(u, acc, `adm_u:${uname}`);
          await sendTelegramMessage(botToken, chatId, t, k, msgId);
        }
        return;
      }

      if (data.startsWith('slot_appr:')) {
        const reqId = data.replace('slot_appr:', '');
        const reqItem = slotRequests.find((r) => r.id === reqId);
        if (!reqItem) {
          await sendTelegramMessage(botToken, chatId, '⚠️ Request not found or already processed.', null, msgId);
          return;
        }
        if (reqItem.status !== 'pending') {
          await sendTelegramMessage(botToken, chatId, `ℹ️ Request for <code>${reqItem.phone}</code> is already <b>${reqItem.status.toUpperCase()}</b>.`, null, msgId);
          return;
        }
        reqItem.status = 'approved';
        reqItem.resolved_at = Date.now();
        reqItem.resolved_by = 'Master Telegram Bot';
        saveSlotRequests();

        const u = getUser(reqItem.username);
        if (u) {
          u.max_accounts = Math.max((u.max_accounts || 5) + 1, (u.registered_phones?.length || 0) + 1);
          if (!Array.isArray(u.registered_phones)) u.registered_phones = [];
          if (!u.registered_phones.includes(reqItem.phone)) {
            u.registered_phones.push(reqItem.phone);
          }
          saveUsers();
          broadcastAccountUpdate(u.username);
          if (u.alert_enabled) {
            sendTelegramAlert(u.username, `🎉 <b>Admin Approved Your Account Slot Request!</b>\nSuper Admin approved your request for <code>${reqItem.phone}</code>.\nYou can now connect this Telegram ID in your dashboard!`);
          }
        }

        const approvedMsg = `✅ <b>Account Slot APPROVED!</b>\n\n` +
          `👤 <b>User:</b> <code>${reqItem.username}</code>\n` +
          `📱 <b>Phone:</b> <code>${reqItem.phone}</code>\n` +
          `📊 <b>Updated Limit:</b> ${u?.max_accounts || 0} Slots\n` +
          `🕒 <i>Approved via Telegram Master Bot at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)</i>`;

        await sendTelegramMessage(botToken, chatId, approvedMsg, null, msgId);
        broadcastAccountUpdate('admin');
        return;
      }

      if (data.startsWith('slot_rej:')) {
        const reqId = data.replace('slot_rej:', '');
        const reqItem = slotRequests.find((r) => r.id === reqId);
        if (!reqItem) {
          await sendTelegramMessage(botToken, chatId, '⚠️ Request not found or already processed.', null, msgId);
          return;
        }
        if (reqItem.status !== 'pending') {
          await sendTelegramMessage(botToken, chatId, `ℹ️ Request for <code>${reqItem.phone}</code> is already <b>${reqItem.status.toUpperCase()}</b>.`, null, msgId);
          return;
        }
        reqItem.status = 'rejected';
        reqItem.resolved_at = Date.now();
        reqItem.resolved_by = 'Master Telegram Bot';
        saveSlotRequests();

        const u = getUser(reqItem.username);
        if (u && u.alert_enabled) {
          sendTelegramAlert(u.username, `❌ <b>Slot Request Rejected</b>\nAdmin has rejected your request to add <code>${reqItem.phone}</code>.`);
        }

        const rejectedMsg = `❌ <b>Account Slot REJECTED</b>\n\n` +
          `👤 <b>User:</b> <code>${reqItem.username}</code>\n` +
          `📱 <b>Phone:</b> <code>${reqItem.phone}</code>\n` +
          `🕒 <i>Rejected at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)</i>`;

        await sendTelegramMessage(botToken, chatId, rejectedMsg, null, msgId);
        broadcastAccountUpdate('admin');
        return;
      }
    }
  } catch (err) {
    console.error('[TELEGRAM UPDATE HANDLER ERROR]:', err);
  }
}

// Global Poller that polls all configured Telegram Bot Tokens seamlessly in the background
let telegramPollerActive = false;
const verifiedPollerBotWebhooks = new Set<string>();

async function startTelegramPollerLoop() {
  if (telegramPollerActive) return;
  telegramPollerActive = true;

  while (true) {
    try {
      // Gather all unique active bot tokens from usersList (alerts & filter bots), master config, accounts, and bots vault
      const tokens = new Set<string>();
      for (const u of usersList) {
        const tok = (u.alert_bot_token || '').trim();
        if (tok) tokens.add(tok);
        const filterTok = (u.master_config?.filter_bot_token || (u as any).filter_bot_token || '').trim();
        if (filterTok) tokens.add(filterTok);
        const masterAlert = (u.master_config?.alert_bot_token || '').trim();
        if (masterAlert) tokens.add(masterAlert);
      }

      // Check all accounts configs
      for (const a of accounts.values()) {
        const aFilter = (a.config?.filter_bot_token || '').trim();
        if (aFilter) tokens.add(aFilter);
        const aAlert = (a.config?.alert_bot_token || '').trim();
        if (aAlert) tokens.add(aAlert);
      }

      // Check admin master config filter bot token
      const adminMasterFilter = (getUser('admin')?.master_config?.filter_bot_token || '').trim();
      if (adminMasterFilter) tokens.add(adminMasterFilter);

      // Check bots vault tokens
      for (const b of botsVault) {
        if (b.token && b.token.trim()) {
          tokens.add(b.token.trim());
        }
      }

      for (const token of tokens) {
        // Clear conflicting webhooks once with await so getUpdates never encounters 409 Conflict
        if (!verifiedPollerBotWebhooks.has(token)) {
          try {
            await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`, {
              signal: AbortSignal.timeout(3000)
            }).catch(() => null);
            verifiedPollerBotWebhooks.add(token);
          } catch (e) {}
        }

        registerTelegramBotCommands(token).catch(() => null);
        try {
          const currentOffset = botPollOffsets.get(token) || 0;
          const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${currentOffset}&timeout=2&limit=25&allowed_updates=${encodeURIComponent('["message","callback_query","chat_join_request","chat_member","my_chat_member"]')}`;
          const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3500) }).catch(() => null);
          if (!res) continue;
          const json = await res.json().catch(() => null);

          if (json?.error_code === 409) {
            // Webhook conflict detected dynamically! Delete webhook and retry next cycle
            await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`, {
              signal: AbortSignal.timeout(3000)
            }).catch(() => null);
          }

          if (json?.ok && Array.isArray(json.result)) {
            for (const upd of json.result) {
              const updId = upd.update_id;
              botPollOffsets.set(token, updId + 1);
              await handleTelegramUpdate(token, upd);
            }
          }
        } catch (e) {
          // Ignore individual network blips
        }
      }
    } catch (err) {
      console.error('[GLOBAL TELEGRAM POLLER ERROR]:', err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

