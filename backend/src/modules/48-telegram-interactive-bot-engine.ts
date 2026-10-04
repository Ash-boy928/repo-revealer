// ---------------- TELEGRAM INTERACTIVE BOT ENGINE (USER & ADMIN) ----------------
const botPollOffsets = new Map<string, number>(); // token -> offset

function formatUserMenu(u: any, accs: any[]) {
  const uname = u.username;
  const running = accs.filter((a) => a.running).length;
  const ownerQ = getOwnerQueueLength(uname);
  
  let txt = `🤖 <b>Telebot Multi-Account Manager</b>\n` +
    `👤 <b>User:</b> <code>${uname}</code>\n` +
    `📊 <b>Accounts:</b> ${accs.length} total (${running} Running, ${accs.length - running} Stopped)\n` +
    `👥 <b>Shared Common Queue:</b> ${ownerQ} leads in pool\n\n` +
    `👇 <i>Tap on any account below to inspect full real-time details:</i>`;

  const keyboard: any[][] = [];
  accs.forEach((a, idx) => {
    const isLive = a.running;
    const statusIcon = isLive ? '🟢' : '🔴';
    const dailyCount = (a as any).daily_extracted_count || 0;
    const label = `${statusIcon} #${idx + 1} ${a.phone} (${dailyCount} Extracted)`;
    keyboard.push([{ text: label, callback_data: `uacc:${uname}:${a.phone}` }]);
  });

  keyboard.push([
    { text: '📋 All IDs Compact Report', callback_data: `uall:${uname}` },
    { text: '🔄 Refresh', callback_data: `umenu:${uname}` }
  ]);

  return { text: txt, keyboard };
}

function formatAccountDetail(u: any, acc: any, backCallback: string) {
  const uname = u.username;
  const isLive = acc.running;
  const statusStr = isLive ? '🟢 Running (Active)' : '🔴 Stopped';
  const dailyCount = (acc as any).daily_extracted_count || 0;
  const accQ = (queueCache.get(acc.phone) || []).length;
  const ownerQ = getOwnerQueueLength(uname);
  const cfg = getEffectiveConfig(acc);
  const tg = (cfg.targets && cfg.targets.length > 0) ? cfg.targets.join(', ') : 'None configured';
  const lastAct = acc.last_active ? new Date(acc.last_active).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A';

  let txt = `📱 <b>Account Details:</b> <code>${acc.phone}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Owner:</b> <code>${uname}</code>\n` +
    `⚡ <b>Status:</b> ${statusStr}\n` +
    `🎯 <b>Daily Extracted:</b> <b>${dailyCount} (Unlimited)</b>\n` +
    `📬 <b>Target Channel/Group:</b> ${tg}\n` +
    `👥 <b>Account Queue / Shared Pool:</b> <b>${accQ} / ${ownerQ}</b>\n` +
    `🕒 <b>Last Active:</b> ${lastAct} IST\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 <i>This account shares the common audience queue with all other IDs under @${uname}.</i>`;

  const keyboard = [
    [
      { text: '🔄 Refresh Status', callback_data: `uacc:${uname}:${acc.phone}` },
      { text: '🔙 Back', callback_data: backCallback }
    ]
  ];

  return { text: txt, keyboard };
}


function getPastDateStrings(days: number): string[] {
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${d.getFullYear()}-${mm}-${dd}`);
  }
  return dates;
}

function formatGeminiReport(days: number) {
  const targetDates = getPastDateStrings(days);
  let txt = `✨ <b>Gemini AI DM Report (Last ${days} Days)</b>\n\n`;
  let grandTotal = 0;

  for (const u of usersList) {
    const uname = u.username;
    let userTotal = 0;
    
    if (aiDmHistory[uname]) {
      for (const d of targetDates) {
        userTotal += (aiDmHistory[uname][d] || 0);
      }
    }
    
    if (userTotal > 0) {
      txt += `👤 <b>${uname}</b>: ${userTotal} DMs\n`;
      grandTotal += userTotal;
    }
  }

  if (grandTotal === 0) {
    txt += `<i>No AI DMs sent in the last ${days} days.</i>\n`;
  } else {
    txt += `\n📈 <b>Total AI DMs: ${grandTotal}</b>`;
  }

  const keyboard = [
    [
      { text: '📅 Today', callback_data: 'gemini_rep:1' },
      { text: '📅 Last 5 Days', callback_data: 'gemini_rep:5' }
    ],
    [
      { text: '🗓️ Last 30 Days (Month)', callback_data: 'gemini_rep:30' }
    ],
    [
      { text: '🔙 Back to Menu', callback_data: 'adm_main' }
    ]
  ];
  return { text: txt, keyboard };
}

function formatAdminMenu() {
  const totalUsers = usersList.length;
  const activeUsers = usersList.filter((u) => u.active).length;
  const allAccs = Array.from(accounts.values());
  const liveCount = allAccs.filter((a) => a.running).length;
  let totalQueue = 0;
  for (const acc of allAccs) {
    totalQueue += getAccountVerifiedQueue(acc.phone).length;
  }

  let txt = `👑 <b>Super Admin Master Console</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 <b>Total Users:</b> ${totalUsers} (${activeUsers} Active)\n` +
    `📱 <b>Connected Accounts:</b> ${allAccs.length} IDs\n` +
    `🟢 <b>Live Running Bots:</b> ${liveCount} IDs\n` +
    `👥 <b>Global Pending Queue:</b> ${totalQueue} users\n\n` +
    `👇 <i>Select a user to inspect their connected Telegram IDs:</i>`;

  const keyboard: any[][] = [];
  usersList.forEach((u) => {
    const uAccs = allAccs.filter((a) => (a.owner || 'admin') === u.username);
    const uLive = uAccs.filter((a) => a.running).length;
    const label = `👤 ${u.username} (${uAccs.length} IDs | 🟢 ${uLive})`;
    keyboard.push([{ text: label, callback_data: `adm_u:${u.username}` }]);
  });

  keyboard.push([
    { text: '📊 Live VPS Specs & Load', callback_data: `adm_vps_health` },
    { text: '📅 Users Expiry Dates', callback_data: `adm_exp:all` }
  ]);
  keyboard.push([
    { text: '🔄 Refresh Admin Console', callback_data: `adm_main` }
  ]);

  return { text: txt, keyboard };
}

async function formatVpsStatusMessage(): Promise<{ text: string; keyboard: any[][] }> {
  const vps = getVpsMetrics();
  const gcp = await checkGcpMetadata();
  let providerLabel = vps.system.free_tier_provider;
  if (gcp.isGcp && gcp.machineType) {
    providerLabel = `Google Cloud Compute Engine (${gcp.machineType})`;
  }

  const memBarLen = 10;
  const memFilled = Math.min(memBarLen, Math.max(0, Math.round((vps.memory.percent / 100) * memBarLen)));
  const memBar = '█'.repeat(memFilled) + '░'.repeat(memBarLen - memFilled);

  const cpuBarLen = 10;
  const cpuFilled = Math.min(cpuBarLen, Math.max(0, Math.round((vps.cpu.percent / 100) * cpuBarLen)));
  const cpuBar = '█'.repeat(cpuFilled) + '░'.repeat(cpuBarLen - cpuFilled);

  const diskBarLen = 10;
  const diskFilled = Math.min(diskBarLen, Math.max(0, Math.round((vps.disk.percent / 100) * diskBarLen)));
  const diskBar = '█'.repeat(diskFilled) + '░'.repeat(diskBarLen - diskFilled);

  const isFreeTierGcp = gcp.isGcp || vps.system.is_free_tier_candidate;

  let txt = `🖥️ <b>VPS System Health & Specifications</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `☁️ <b>Host Platform:</b> ${providerLabel}\n` +
    (isFreeTierGcp ? `🎁 <b>Tier Status:</b> Google Cloud Free Tier Eligible (e2-micro)\n` : '') +
    `⏱️ <b>Uptime:</b> ${vps.uptime.formatted}\n` +
    `⚙️ <b>OS & Arch:</b> Linux ${vps.system.arch} (Node ${vps.system.node_version})\n\n` +
    
    `🧠 <b>RAM Memory:</b> [${memBar}] <b>${vps.memory.percent}%</b>\n` +
    `• Used: <b>${vps.memory.used_formatted}</b> / Total: <b>${vps.memory.total_formatted}</b>\n` +
    `• Free RAM: <b>${vps.memory.free_formatted}</b>\n\n` +

    `⚡ <b>CPU Load:</b> [${cpuBar}] <b>${vps.cpu.percent}%</b>\n` +
    `• Cores: <b>${vps.cpu.cores} Core(s)</b> (${vps.cpu.model.slice(0, 24)})\n` +
    `• Load Average: 1m: <b>${vps.cpu.load_1m}</b> | 5m: <b>${vps.cpu.load_5m}</b>\n\n` +

    `💾 <b>SSD Disk Space:</b> [${diskBar}] <b>${vps.disk.percent}%</b>\n` +
    `• Used: <b>${vps.disk.used_formatted}</b> / Total: <b>${vps.disk.total_formatted}</b>\n` +
    `• Free Space: <b>${vps.disk.free_formatted}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>Auto-monitored directly from VPS kernel via Node.js</i>`;

  const keyboard = [
    [
      { text: '🔄 Refresh Live Specs', callback_data: `adm_vps_health` },
      { text: '🔙 Back to Admin Console', callback_data: `adm_main` }
    ]
  ];

  return { text: txt, keyboard };
}

function formatAdminExpiryList() {
  let txt = `📅 <b>Users Expiry Dates & Validity (DD/MM/YYYY)</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  usersList.forEach((u, i) => {
    const exp = u.expiry_date ? formatDisplayDate(u.expiry_date) : '♾️ Lifetime (No Expiry)';
    const status = u.active ? '🟢 Active' : '🔴 Disabled';
    txt += `<b>${i + 1}. ${u.username}</b> (${u.role || 'user'})\n`;
    txt += `• Status: ${status}\n`;
    txt += `• Expiry Date: <b>${exp}</b>\n\n`;
  });

  const keyboard = [
    [{ text: '🔙 Back to Admin Console', callback_data: `adm_main` }]
  ];
  return { text: txt, keyboard };
}

function formatAdminUserView(u: any) {
  const uname = u.username;
  const accs = Array.from(accounts.values()).filter((a) => (a.owner || 'admin') === uname);
  const running = accs.filter((a) => a.running).length;
  const ownerQ = getOwnerQueueLength(uname);
  const exp = u.expiry_date ? formatDisplayDate(u.expiry_date) : '♾️ Lifetime (No Expiry)';

  let txt = `👤 <b>Admin Inspection: @${uname}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>Accounts:</b> ${accs.length} total (${running} Live)\n` +
    `👥 <b>Shared Common Queue:</b> ${ownerQ} leads\n` +
    `📅 <b>User Expiry Date:</b> <b>${exp}</b>\n` +
    `🔒 <b>Status:</b> ${u.active ? '🟢 Active' : '🔴 Disabled'}\n\n` +
    `👇 <i>Tap on any of @${uname}'s accounts to view live stats:</i>`;

  const keyboard: any[][] = [];
  accs.forEach((a, idx) => {
    const isLive = a.running;
    const statusIcon = isLive ? '🟢' : '🔴';
    const dailyCount = (a as any).daily_extracted_count || 0;
    const label = `${statusIcon} #${idx + 1} ${a.phone} (${dailyCount} Extracted)`;
    keyboard.push([{ text: label, callback_data: `adm_acc:${uname}:${a.phone}` }]);
  });

  keyboard.push([
    { text: '🔙 Back to Users List', callback_data: `adm_main` },
    { text: '🔄 Refresh', callback_data: `adm_u:${uname}` }
  ]);

  return { text: txt, keyboard };
}

function getWebLoginUrl() {
  const adminUser = usersList.find((u: any) => u.role === 'admin' || u.username === 'admin');
  const adminConfiguredUrl = (systemConfiguredDomain || adminUser?.custom_web_url || (adminUser as any)?.live_url || '').trim();
  if (adminConfiguredUrl) {
    const formatted = adminConfiguredUrl.startsWith('http') ? adminConfiguredUrl : `https://${adminConfiguredUrl}`;
    return `${formatted.replace(/\/$/, '')}/login`;
  }
  const custom = (process.env.APP_URL || process.env.BASE_URL || process.env.PUBLIC_URL || process.env.DOMAIN || '').trim();
  if (custom) {
    const formatted = custom.startsWith('http') ? custom : `https://${custom}`;
    return `${formatted.replace(/\/$/, '')}/login`;
  }
  if (billingStore?.settings?.domain) {
    const bDom = billingStore.settings.domain.trim();
    if (bDom) {
      const formatted = bDom.startsWith('http') ? bDom : `https://${bDom}`;
      return `${formatted.replace(/\/$/, '')}/login`;
    }
  }
  if (globalDetectedWebUrl && !/^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(globalDetectedWebUrl)) {
    return `${globalDetectedWebUrl.replace(/\/$/, '')}/login`;
  }
  if (globalDetectedWebUrl) {
    return `${globalDetectedWebUrl.replace(/\/$/, '')}/login`;
  }
  return `https://ais-pre-4cxaapukn5iezmue6n67fq-366353011222.asia-southeast1.run.app/login`;
}

// Automatically resets Telegram bot commands menu button for customers
async function cleanupTelegramBotMenu(botToken: string) {
  if (!botToken) return;
  try {
    // Reset chat menu button to standard default menu
    await fetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menu_button: { type: 'default' } })
    }).catch(() => null);
  } catch (e) {}
}

const adminCustomPrompt = new Map<string, { reqId: string; field: 'bots' | 'days' | 'rate' }>();

// Formats rich interactive request alert for Admin with inline customization controls
function formatAdminRequestAlert(r: AccessRequest, subView: string | null = null) {
  const reqType = r.type || 'new_user';
  const timeStr = new Date(r.requested_at || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  // 1. EXTEND VALIDITY REQUEST
  if (reqType === 'extend_validity') {
    if (subView === 'edit_days') {
      const text = `⏳ <b>CUSTOMIZE EXTENSION DAYS</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>User:</b> <code>${r.target_username}</code> (${r.full_name})\n` +
        `Current Extension: <b>+${r.validity_days || 30} Days</b>\n\n` +
        `👇 Quick select days or type custom number in chat:`;
      const keyboard = [
        [
          { text: '+7 Days', callback_data: `adm_set_ext:${r.id}:7` },
          { text: '+15 Days', callback_data: `adm_set_ext:${r.id}:15` },
          { text: '+30 Days', callback_data: `adm_set_ext:${r.id}:30` }
        ],
        [
          { text: '+60 Days', callback_data: `adm_set_ext:${r.id}:60` },
          { text: '+90 Days', callback_data: `adm_set_ext:${r.id}:90` },
          { text: '+365 Days', callback_data: `adm_set_ext:${r.id}:365` }
        ],
        [
          { text: '✏️ Type Custom Days in Chat', callback_data: `adm_type_ext:${r.id}` },
          { text: '🔙 Done / Back', callback_data: `adm_view_req:${r.id}` }
        ]
      ];
      return { text, keyboard };
    }

    const isCustomized = Boolean((r as any).customized_by_admin);
    const customTag = isCustomized ? ' ✏️ [Customized by Admin]' : '';

    const text = `⏳ <b>ACCOUNT VALIDITY EXTENSION REQUEST!</b>${customTag}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>User:</b> <code>${r.target_username}</code> (${r.full_name})\n` +
      `🆔 <b>Telegram:</b> <code>${r.chat_id}</code>\n` +
      `⏳ <b>Validity to Add:</b> <b>+${r.validity_days || 30} Days</b>\n` +
      `📅 <b>Requested:</b> ${timeStr}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Select an action to approve or customize:</i>`;

    const keyboard = [
      [
        { text: `✏️ Change Added Days (+${r.validity_days || 30}d)`, callback_data: `adm_sub_ext:${r.id}` }
      ],
      [
        { text: `✅ APPROVE (+${r.validity_days || 30} Days)`, callback_data: `usr_appr_ext:${r.id}` },
        { text: '❌ REJECT', callback_data: `usr_rej:${r.id}` }
      ]
    ];
    return { text, keyboard };
  }

  // 2. EXTRA BOT SLOTS REQUEST
  if (reqType === 'add_bots') {
    if (subView === 'edit_bots') {
      const text = `🤖 <b>CUSTOMIZE EXTRA BOTS QUOTA</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>User:</b> <code>${r.target_username}</code> (${r.full_name})\n` +
        `Current Added Slots: <b>+${r.bots_count || 1} Bots</b>\n\n` +
        `👇 Quick select quota or type custom number in chat:`;
      const keyboard = [
        [
          { text: '+1 Bot', callback_data: `adm_set_slots:${r.id}:1` },
          { text: '+2 Bots', callback_data: `adm_set_slots:${r.id}:2` },
          { text: '+3 Bots', callback_data: `adm_set_slots:${r.id}:3` }
        ],
        [
          { text: '+5 Bots', callback_data: `adm_set_slots:${r.id}:5` },
          { text: '+10 Bots', callback_data: `adm_set_slots:${r.id}:10` },
          { text: '+20 Bots', callback_data: `adm_set_slots:${r.id}:20` }
        ],
        [
          { text: '✏️ Type Custom Count in Chat', callback_data: `adm_type_slots:${r.id}` },
          { text: '🔙 Done / Back', callback_data: `adm_view_req:${r.id}` }
        ]
      ];
      return { text, keyboard };
    }

    const isCustomized = Boolean((r as any).customized_by_admin);
    const customTag = isCustomized ? ' ✏️ [Customized by Admin]' : '';

    const text = `🤖 <b>EXTRA BOT SLOTS QUOTA REQUEST!</b>${customTag}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>User:</b> <code>${r.target_username}</code> (${r.full_name})\n` +
      `🆔 <b>Telegram:</b> <code>${r.chat_id}</code>\n` +
      `➕ <b>Extra Bots:</b> <b>+${r.bots_count || 1} Bots</b>\n` +
      `📅 <b>Requested:</b> ${timeStr}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Select an action to approve or customize:</i>`;

    const keyboard = [
      [
        { text: `✏️ Change Added Bots (+${r.bots_count || 1})`, callback_data: `adm_sub_slots:${r.id}` }
      ],
      [
        { text: `✅ APPROVE (+${r.bots_count || 1} Bots)`, callback_data: `usr_appr_bots:${r.id}` },
        { text: '❌ REJECT', callback_data: `usr_rej:${r.id}` }
      ]
    ];
    return { text, keyboard };
  }

  // 3. NEW USER ACCESS REQUEST
  if (subView === 'edit_bots') {
    const text = `🤖 <b>CUSTOMIZE BOTS QUOTA for ${r.full_name}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Current Setting: <b>${r.bots_count || 1} Bots</b>\n\n` +
      `👇 Quick select quota or type custom number in chat:`;
    const keyboard = [
      [
        { text: '1 Bot', callback_data: `adm_set_nbots:${r.id}:1` },
        { text: '2 Bots', callback_data: `adm_set_nbots:${r.id}:2` },
        { text: '3 Bots', callback_data: `adm_set_nbots:${r.id}:3` },
        { text: '5 Bots', callback_data: `adm_set_nbots:${r.id}:5` }
      ],
      [
        { text: '10 Bots', callback_data: `adm_set_nbots:${r.id}:10` },
        { text: '20 Bots', callback_data: `adm_set_nbots:${r.id}:20` },
        { text: '50 Bots', callback_data: `adm_set_nbots:${r.id}:50` }
      ],
      [
        { text: '✏️ Type Number in Chat', callback_data: `adm_type_nbots:${r.id}` },
        { text: '🔙 Done / Back', callback_data: `adm_view_req:${r.id}` }
      ]
    ];
    return { text, keyboard };
  }

  if (subView === 'edit_days') {
    const text = `⏳ <b>CUSTOMIZE VALIDITY DURATION for ${r.full_name}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Current Setting: <b>${r.validity_days || 30} Days</b>\n\n` +
      `👇 Quick select days or type custom days in chat:`;
    const keyboard = [
      [
        { text: '7 Days', callback_data: `adm_set_ndays:${r.id}:7` },
        { text: '15 Days', callback_data: `adm_set_ndays:${r.id}:15` },
        { text: '30 Days', callback_data: `adm_set_ndays:${r.id}:30` }
      ],
      [
        { text: '60 Days', callback_data: `adm_set_ndays:${r.id}:60` },
        { text: '90 Days', callback_data: `adm_set_ndays:${r.id}:90` },
        { text: '365 Days', callback_data: `adm_set_ndays:${r.id}:365` }
      ],
      [
        { text: '✏️ Type Days in Chat', callback_data: `adm_type_ndays:${r.id}` },
        { text: '🔙 Done / Back', callback_data: `adm_view_req:${r.id}` }
      ]
    ];
    return { text, keyboard };
  }

  if (subView === 'edit_rate') {
    const ratePerBot = Number(r.rate_per_bot) || 10;
    const bots = r.bots_count || 1;
    const dailyTotal = ratePerBot * bots;
    const weeklyTotal = dailyTotal * 7;
    const text = `💵 <b>SET RATE PER BOT for ${r.full_name}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Current Setting: <b>₹${ratePerBot}/bot/day</b>\n` +
      `📊 Daily: <b>₹${dailyTotal}/day</b> | 7-Day Week: <b>₹${weeklyTotal}</b> for ${bots} Bots\n\n` +
      `👇 Quick select rate or type custom amount in chat:`;
    const keyboard = [
      [
        { text: '⭐ ₹10 / bot', callback_data: `adm_set_nrate:${r.id}:10` },
        { text: '₹15 / bot', callback_data: `adm_set_nrate:${r.id}:15` },
        { text: '₹20 / bot', callback_data: `adm_set_nrate:${r.id}:20` }
      ],
      [
        { text: '₹25 / bot', callback_data: `adm_set_nrate:${r.id}:25` },
        { text: '₹30 / bot', callback_data: `adm_set_nrate:${r.id}:30` },
        { text: '₹50 / bot', callback_data: `adm_set_nrate:${r.id}:50` }
      ],
      [
        { text: '✏️ Type Custom Rate in Chat', callback_data: `adm_type_nrate:${r.id}` },
        { text: '🔙 Done / Back', callback_data: `adm_view_req:${r.id}` }
      ]
    ];
    return { text, keyboard };
  }

  const isCustomized = Boolean((r as any).customized_by_admin);
  const customTag = isCustomized ? ' ✏️ [Customized by Admin]' : '';
  const currentRate = Number(r.rate_per_bot) || 10;
  const currentBots = Number(r.bots_count) || 1;
  const currentDays = Number(r.validity_days) || 7;
  const dailyTotal = Math.round(currentRate * currentBots);
  const weeklyTotal = Math.round(dailyTotal * currentDays);

  const text = `🔔 <b>NEW USER ACCESS REQUEST!</b>${customTag}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Customer Name:</b> ${r.full_name}\n` +
    `🆔 <b>Telegram:</b> ${r.telegram_username ? '@' + r.telegram_username : 'None'} (<code>${r.chat_id}</code>)\n` +
    `📱 <b>Contact Mobile:</b> <code>${r.phone}</code>\n` +
    `🤖 <b>Bot Accounts Quota:</b> <b>${currentBots} Bots</b>\n` +
    `⏳ <b>Billing Cycle:</b> <b>${currentDays} Days (1 Week)</b>\n` +
    `💵 <b>Rate Per Bot:</b> <b>₹${currentRate} / bot / day</b>\n` +
    `📊 <b>Daily Usage Due:</b> <b>₹${dailyTotal} / day</b> (${currentBots} IDs x ₹${currentRate}/day)\n` +
    `💰 <b>7-Day Cycle Bill:</b> <b>₹${weeklyTotal}</b> (₹${dailyTotal}/day x ${currentDays} Days)\n` +
    `📅 <b>Requested:</b> ${timeStr}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👇 <i>Choose billing plan or adjust rate/bots:</i>`;

  const keyboard = [
    [
      { text: `✅ Approve Postpaid (₹${currentRate}/bot/day)`, callback_data: `usr_appr_plan:${r.id}:postpaid:${currentRate}` },
      { text: `✅ Approve Advance (₹${currentRate}/bot/day)`, callback_data: `usr_appr_plan:${r.id}:advance:${currentRate}` }
    ],
    [
      { text: `✏️ Edit Rate (₹${currentRate}/bot)`, callback_data: `adm_sub_nrate:${r.id}` },
      { text: `✏️ Edit Bots (${currentBots})`, callback_data: `adm_sub_nbots:${r.id}` }
    ],
    [
      { text: '❌ REJECT REQUEST', callback_data: `usr_rej:${r.id}` }
    ]
  ];
  return { text, keyboard };
}

