// ---------------- TELEGRAM CUSTOMER /bill & BILLING STATEMENT ----------------
async function handleCustomerBillCommand(botToken: string, chatId: string, msg: any, adminUser: any, msgIdToEdit: any = null, explicitUser: any = null) {
  const fromUsername = (msg?.from?.username || '').toLowerCase();
  // Find matched non-admin user
  const matchedCust = explicitUser || usersList.find((u: any) =>
    u.role !== 'admin' && (
      String(u.alert_chat_id || '').trim() === String(chatId).trim() ||
      String(u.telegram_id || '').trim() === String(chatId).trim() ||
      (u.telegram_username && fromUsername && u.telegram_username.toLowerCase() === fromUsername)
    )
  );

  const webLoginUrl = getWebLoginUrl();
  const curr = (billingStore.currency || 'INR') === 'INR' ? '₹' : '$';

  if (!matchedCust) {
    const notFoundMsg = `⚠️ <b>No Active TeleBot Account Linked</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Your Telegram account is not yet connected to a registered user profile.\n\n` +
      `• <b>Need a New ID?</b> Send /start to submit an account request.\n` +
      `• <b>Already Have an ID?</b> Send <code>/link &lt;username&gt;</code> to connect your Telegram.\n` +
      `  <i>(Example: <code>/link rahul</code>)</i>\n\n` +
      `For questions or plan upgrades, please contact Administrator.`;

    const keyboard = [
      [{ text: '🆕 Request New Account (/start)', callback_data: 'cust_new_id' }]
    ];
    await sendTelegramMessage(botToken, chatId, notFoundMsg, keyboard, msgIdToEdit);
    return;
  }

  // User is found! Ensure today's daily live bots usage is accrued, then generate bill
  accrueDailyUsageForUser(matchedCust.username);
  const uLedger = getUserLedgerSummary(matchedCust.username);
  const bal = Number(uLedger.balance_due ?? 0);
  const totalBilled = Number(uLedger.total_billed ?? 0);
  const totalPaid = Number(uLedger.total_paid ?? 0);

  const userAccs = Array.from(accounts.values()).filter((a: any) => (a.owner || 'admin').toLowerCase() === matchedCust.username.toLowerCase());
  const liveCount = userAccs.filter((a: any) => a.running).length;
  const maxBots = matchedCust.max_accounts || 1;
  const ratePerBot = matchedCust.rate_per_bot || 10;
  const cycleDays = matchedCust.billing_cycle_days || 7;
  const weeklyTotal = Math.round(ratePerBot * maxBots * (cycleDays === 7 ? 7 : cycleDays));
  const planModel = matchedCust.billing_model === 'advance' ? 'Advance (Prepaid)' : '7-Day Postpaid';
  const dateRange = getUserCycleDateRange(matchedCust);

  let dueBadge = '';
  if (bal > 0) {
    dueBadge = `🔴 <b>${curr}${bal.toLocaleString()} Due (Pending Payment)</b>`;
  } else if (bal < 0) {
    dueBadge = `⭐ <b>-${curr}${Math.abs(bal).toLocaleString()} (Advance Balance)</b>`;
  } else {
    dueBadge = `🟢 <b>${curr}0 (Fully Settled - All Paid)</b>`;
  }

  // Get recent 3 invoices for this user
  const userInvoices = (billingStore.invoices || [])
    .filter((inv: any) => (inv.username || '').toLowerCase() === matchedCust.username.toLowerCase())
    .slice(-3)
    .reverse();

  let recentHistoryText = '';
  if (userInvoices.length > 0) {
    recentHistoryText = `\n📄 <b>Recent Billing Invoices:</b>\n` +
      userInvoices.map((i: any) => `• <i>${formatDisplayDate(i.date)}:</i> ${i.description || 'Weekly Plan'} &mdash; <b>${curr}${i.amount}</b> (${i.status === 'paid' ? '🟢 Paid' : '🔴 Due'})`).join('\n') + `\n`;
  }

  const billMsg = `🧾 <b>YOUR SUBSCRIPTION & BILLING STATEMENT</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Customer:</b> <code>${matchedCust.username}</code> (${matchedCust.display_name || 'Client'})\n` +
    `🤖 <b>Allowed Bots:</b> <b>${maxBots} Bot(s)</b> (🟢 ${liveCount} currently running)\n` +
    `💵 <b>Rate per Bot:</b> <b>${curr}${ratePerBot} / bot / day</b>\n` +
    `💰 <b>Weekly Cycle Bill:</b> <b>${curr}${weeklyTotal}</b> (${maxBots} Bots x ${curr}${ratePerBot}/day x ${cycleDays} Days)\n` +
    `📅 <b>Plan Validity:</b> <code>${dateRange.formattedRange}</code>\n` +
    `⏳ <b>Expiry Date:</b> <b>${formatDisplayDate(matchedCust.expiry_date)}</b>\n` +
    `💳 <b>Billing Model:</b> <b>${planModel} (1 Week)</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>Account Financial Overview:</b>\n` +
    `• 💵 <b>Total Invoiced:</b> ${curr}${totalBilled.toLocaleString()}\n` +
    `• 💰 <b>Total Received:</b> ${curr}${totalPaid.toLocaleString()}\n` +
    `• 💳 <b>Current Outstanding Due:</b> ${dueBadge}\n` +
    recentHistoryText +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    (bal > 0 ? `⚠️ <i>Payment is pending. Please clear your balance of ${curr}${bal.toLocaleString()} to ensure uninterrupted direct messaging service.</i>\n\n` : `✅ <i>Your account is active and all dues are cleared! Thank you!</i>\n\n`) +
    `🌐 <b>Dashboard:</b> ${webLoginUrl}`;

  const billKeyboard = [
    [{ text: '🔄 Refresh My Bill', callback_data: `cust_view_bill:${matchedCust.username}` }],
    [{ text: '🌐 Open Web Dashboard', url: webLoginUrl }],
    [{ text: '⏳ Request Extension (+Days)', callback_data: `cust_ext_val:${matchedCust.username}` }]
  ];

  await sendTelegramMessage(botToken, chatId, billMsg, billKeyboard, msgIdToEdit);
}

