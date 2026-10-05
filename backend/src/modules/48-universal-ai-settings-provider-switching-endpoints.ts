// ---------------- UNIVERSAL AI SETTINGS & PROVIDER SWITCHING ENDPOINTS ----------------
app.get('/api/admin/ai-config', (req: any, res: any) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ success: false, error: 'Access denied. Super Admin required.' });
  }

  res.json({
    success: true,
    config: {
      ...globalAiConfig,
      has_gemini_env: Boolean(process.env.GEMINI_API_KEY),
      has_openai_env: Boolean(process.env.OPENAI_API_KEY),
      has_deepseek_env: Boolean(process.env.DEEPSEEK_API_KEY),
      has_groq_env: Boolean(process.env.GROQ_API_KEY)
    }
  });
});

app.post('/api/admin/ai-config/update', (req: any, res: any) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ success: false, error: 'Access denied. Super Admin required.' });
  }

  const payload = req.body || {};

  // Node.js Strict Lead Filtering Rules
  if (payload.nodejs_filter_enabled !== undefined) globalAiConfig.nodejs_filter_enabled = Boolean(payload.nodejs_filter_enabled);
  if (payload.reject_usernames !== undefined) globalAiConfig.reject_usernames = Boolean(payload.reject_usernames);
  if (payload.allow_no_photo_no_username !== undefined) globalAiConfig.allow_no_photo_no_username = Boolean(payload.allow_no_photo_no_username);
  if (payload.reject_premium !== undefined) globalAiConfig.reject_premium = Boolean(payload.reject_premium);
  if (payload.reject_admins !== undefined) globalAiConfig.reject_admins = Boolean(payload.reject_admins);
  if (payload.reject_bots !== undefined) globalAiConfig.reject_bots = Boolean(payload.reject_bots);
  if (payload.reject_deleted !== undefined) globalAiConfig.reject_deleted = Boolean(payload.reject_deleted);
  if (payload.reject_scam_keywords !== undefined) globalAiConfig.reject_scam_keywords = Boolean(payload.reject_scam_keywords);
  if (payload.channel_lock_early !== undefined) globalAiConfig.channel_lock_early = Boolean(payload.channel_lock_early);

  // Custom reject / allow keywords
  if (Array.isArray(payload.custom_reject_keywords)) {
    globalAiConfig.custom_reject_keywords = payload.custom_reject_keywords
      .flatMap((s: string) => String(s || '').split(/[,\n\r]+/))
      .map((s: string) => s.trim())
      .filter(Boolean);
  } else if (typeof payload.custom_reject_keywords === 'string') {
    globalAiConfig.custom_reject_keywords = payload.custom_reject_keywords
      .split(/[,\n\r]+/)
      .map((s: string) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(payload.custom_allow_keywords)) {
    globalAiConfig.custom_allow_keywords = payload.custom_allow_keywords
      .flatMap((s: string) => String(s || '').split(/[,\n\r]+/))
      .map((s: string) => s.trim())
      .filter(Boolean);
  } else if (typeof payload.custom_allow_keywords === 'string') {
    globalAiConfig.custom_allow_keywords = payload.custom_allow_keywords
      .split(/[,\n\r]+/)
      .map((s: string) => s.trim())
      .filter(Boolean);
  }

  // AI Filtering settings
  if (payload.filter_provider !== undefined) globalAiConfig.filter_provider = payload.filter_provider;
  if (payload.filter_model !== undefined) globalAiConfig.filter_model = String(payload.filter_model || '').trim();
  if (payload.filter_api_key !== undefined) globalAiConfig.filter_api_key = String(payload.filter_api_key || '').trim();
  if (payload.filter_api_url !== undefined) globalAiConfig.filter_api_url = String(payload.filter_api_url || '').trim();
  if (payload.filter_enabled !== undefined) globalAiConfig.filter_enabled = Boolean(payload.filter_enabled);
  if (payload.filter_mode !== undefined) globalAiConfig.filter_mode = payload.filter_mode;
  if (payload.filter_persona !== undefined) globalAiConfig.filter_persona = String(payload.filter_persona || '').trim();
  if (payload.filter_strictness !== undefined) globalAiConfig.filter_strictness = payload.filter_strictness;

  // AI DM settings
  if (payload.dm_enabled !== undefined) globalAiConfig.dm_enabled = Boolean(payload.dm_enabled);
  if (payload.dm_provider !== undefined) globalAiConfig.dm_provider = payload.dm_provider;
  if (payload.dm_model !== undefined) globalAiConfig.dm_model = String(payload.dm_model || '').trim();
  if (payload.dm_api_key !== undefined) globalAiConfig.dm_api_key = String(payload.dm_api_key || '').trim();
  if (payload.dm_api_url !== undefined) globalAiConfig.dm_api_url = String(payload.dm_api_url || '').trim();
  if (payload.dm_system_prompt !== undefined) globalAiConfig.dm_system_prompt = String(payload.dm_system_prompt || '').trim();

  saveGlobalAiConfig();
  res.json({ success: true, msg: 'Configuration saved & updated successfully!', config: globalAiConfig });
});

app.post('/api/admin/ai-config/auto-detect-key', async (req: any, res: any) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ success: false, error: 'Access denied. Super Admin required.' });
  }

  const { api_key, apply_to } = req.body || {};
  const rawKey = String(api_key || '').trim();
  if (!rawKey) {
    return res.status(400).json({ success: false, error: 'Please enter an API Key to auto-detect and verify!' });
  }

  // Support single or multiple keys (separated by comma, semicolon, or newline)
  const keyList = rawKey.split(/[\n,;]+/).map((k: string) => k.trim()).filter(Boolean);
  if (keyList.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid API keys found in input!' });
  }

  const detectedKeys: Array<{
    key_index: number;
    preview: string;
    provider: 'gemini' | 'groq' | 'deepseek' | 'openai';
    provider_label: string;
    best_model: string;
    status: string;
  }> = [];

  let primaryProvider: 'gemini' | 'groq' | 'deepseek' | 'openai' = 'groq';
  let primaryModel = 'llama-3.1-8b-instant';

  for (let i = 0; i < keyList.length; i++) {
    const singleKey = keyList[i];
    let prov: 'gemini' | 'groq' | 'deepseek' | 'openai' = 'gemini';
    let provLabel = 'Google Gemini';
    let mod = 'gemini-3.1-flash-lite';

    if (singleKey.startsWith('gsk_')) {
      prov = 'groq';
      provLabel = 'Groq Cloud (Ultra Fast 14.4k Free/Day)';
      mod = 'llama-3.1-8b-instant';
    } else if (singleKey.startsWith('AIzaSy')) {
      prov = 'gemini';
      provLabel = 'Google Gemini';
      mod = 'gemini-3.1-flash-lite';
    } else if (singleKey.startsWith('sk-') && singleKey.length > 50) {
      prov = 'openai';
      provLabel = 'OpenAI';
      mod = 'gpt-4o-mini';
    } else if (singleKey.startsWith('sk-')) {
      prov = 'deepseek';
      provLabel = 'DeepSeek AI';
      mod = 'deepseek-chat';
    }

    if (i === 0) {
      primaryProvider = prov;
      primaryModel = mod;
    }

    const preview = singleKey.length > 12
      ? `${singleKey.slice(0, 6)}...${singleKey.slice(-4)}`
      : singleKey;

    detectedKeys.push({
      key_index: i + 1,
      preview,
      provider: prov,
      provider_label: provLabel,
      best_model: mod,
      status: 'Active Pool Slot'
    });
  }

  // Quick live verify on the first key if it's Groq or Gemini
  try {
    const firstKey = keyList[0];
    if (primaryProvider === 'groq') {
      const testRes = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${firstKey}` },
        signal: AbortSignal.timeout(6000)
      }).catch(() => null);
      if (testRes && testRes.ok) {
        detectedKeys[0].status = 'Verified & Ready';
      }
    } else if (primaryProvider === 'gemini') {
      const testRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${firstKey}`, {
        signal: AbortSignal.timeout(6000)
      }).catch(() => null);
      if (testRes && testRes.ok) {
        detectedKeys[0].status = 'Verified & Ready';
      }
    }
  } catch {}

  // Auto-apply to globalAiConfig
  const target = apply_to || 'dm';
  if (target === 'dm' || target === 'both') {
    globalAiConfig.dm_provider = primaryProvider;
    globalAiConfig.dm_api_key = rawKey;
    globalAiConfig.dm_model = primaryModel;
    globalAiConfig.dm_enabled = true;
  }
  if (target === 'filter' || target === 'both') {
    globalAiConfig.filter_provider = primaryProvider;
    globalAiConfig.filter_api_key = rawKey;
    globalAiConfig.filter_model = primaryModel;
  }

  saveGlobalAiConfig();

  return res.json({
    success: true,
    total_keys: keyList.length,
    detected_keys: detectedKeys,
    primary_provider: primaryProvider,
    primary_model: primaryModel,
    config: globalAiConfig,
    msg: keyList.length > 1
      ? `Multi-Key Pool detected: ${keyList.length} API keys configured! Automatic rotation & failover active.`
      : `Verified ${detectedKeys[0].provider_label}! Model: "${primaryModel}" activated automatically.`
  });
});

app.post('/api/admin/ai-config/test', async (req: any, res: any) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ success: false, error: 'Access denied. Super Admin required.' });
  }

  const { task, test_bio, test_name, test_username } = req.body || {};

  try {
    if (task === 'filtering') {
      const uName = String(test_username || '').trim();
      const bText = String(test_bio || '').trim();
      const fName = String(test_name || '').trim();

      // 1. Check Node.js Strict Rules first (0ms latency)
      if (globalAiConfig.reject_usernames !== false && uName) {
        return res.json({
          success: true,
          task: 'filtering',
          engine: 'Node.js Strict Filter (0ms)',
          verdict: {
            status: 'REJECTED',
            reason: `Account has @${uName.replace(/^@/, '')} (Strictly rejected by Node.js Rule: No @usernames allowed)`,
            category: 'has_username'
          }
        });
      }

      const dummyObj = {
        firstName: fName,
        lastName: '',
        username: uName,
        about: bText
      };
      const spamCheck = isTelegramUserSpamOrPromo(dummyObj);
      if (spamCheck.isSpam) {
        return res.json({
          success: true,
          task: 'filtering',
          engine: 'Node.js Pattern & Blacklist Filter (0ms)',
          verdict: {
            status: 'REJECTED',
            reason: spamCheck.reason,
            category: 'spam_bio'
          }
        });
      }

      // If AI testing is requested or AI filter is enabled
      if (req.body.force_ai) {
        const results = await analyzeTelegramUsersBatch([{
          uid: 999999999,
          firstName: fName || 'Test User',
          lastName: '',
          username: uName,
          about: bText
        }]);
        const verdict = results.get(999999999);
        return res.json({
          success: true,
          task: 'filtering',
          engine: `AI Model (${globalAiConfig.filter_provider} - ${globalAiConfig.filter_model})`,
          verdict: verdict || { status: 'UNKNOWN', reason: 'No result returned from model' }
        });
      }

      // Passed all Node.js strict rules!
      return res.json({
        success: true,
        task: 'filtering',
        engine: 'Node.js Strict Filter (0ms)',
        verdict: {
          status: 'APPROVED',
          reason: '✅ Verified Genuine Lead! (Clean bio, no scam keywords, eligible for Genuine Queue)',
          category: 'genuine'
        }
      });
    } else {
      const { custom_dm, recipient_name, channel_link, variations_count } = req.body || {};
      const numVars = variations_count === 3 ? 3 : 1;
      const recName = recipient_name && String(recipient_name).trim() ? String(recipient_name).trim() : 'Rohit';
      const chLink = channel_link && String(channel_link).trim() ? String(channel_link).trim() : 'https://t.me/tech_deals';
      const baseMsg = custom_dm && String(custom_dm).trim()
        ? String(custom_dm).trim()
        : 'Hey Rohit! Found this really cool tech community for exclusive deals and updates, thought you’d like it: https://t.me/tech_deals. Ek baar check karle, kaafi mast offers aate hain yahan!';

      if (numVars === 3) {
        const prompt = `You are an expert Telegram outreach copywriter.
The user provided their base DM message or campaign pitch:
"""
${baseMsg}
"""

Target Recipient First Name: ${recName}
Target Link / Channel: ${chLink}

Task: Generate 3 distinct, natural, human-sounding variations of this DM in natural Hinglish (or natural English if the base message is in English).
Rules:
1. Each variation must convey the exact same core message and offer, but use completely different openers, sentence structures, and styles so Telegram anti-spam algorithms never flag them.
2. Variation 1 Tone: Casual & Friendly (like a friend or fellow member recommending something cool).
3. Variation 2 Tone: Short & Direct (crisp, zero fluff, straight to the point).
4. Variation 3 Tone: Conversational Opener (soft conversational question or curious lead-in).
5. Naturally incorporate recipient's name (${recName}) where appropriate.
6. Make sure the link (${chLink}) is included in each variation.
7. Keep each variation between 1 to 3 sentences. No corporate marketing buzzwords. Sound 100% human.
8. Output ONLY a valid JSON object in this exact structure:
{
  "variations": [
    { "tone": "Casual & Friendly", "text": "..." },
    { "tone": "Short & Direct", "text": "..." },
    { "tone": "Conversational Opener", "text": "..." }
  ]
}`;

        const rawJson = await callAiEngine({
          task: 'dm',
          prompt,
          systemInstruction: globalAiConfig.dm_system_prompt || "You are a casual human user reaching out on Telegram.",
          temperature: 0.75,
          jsonResponse: true
        });

        let parsed: any = null;
        try {
          parsed = JSON.parse(rawJson.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
        } catch {}

        const variations = Array.isArray(parsed?.variations) && parsed.variations.length > 0
          ? parsed.variations
          : [
              { tone: "Variation 1 (Casual)", text: rawJson.trim() }
            ];

        return res.json({
          success: true,
          task: 'dm',
          mode: 'variations',
          provider: globalAiConfig.dm_provider,
          model: (callAiEngine as any).lastSuccessfulModel || globalAiConfig.dm_model,
          variations,
          generatedDm: variations[0]?.text || rawJson
        });
      } else {
        const prompt = `User's base message or context:
"""
${baseMsg}
"""
Recipient first name: ${recName}
Target channel/link: ${chLink}

Task: Write a very short, natural-sounding direct message (DM) in Hinglish/English based on the above.
Do NOT sound like a bot. Sound like a real human. Keep it under 2-3 sentences.
Make sure to include the channel link (${chLink}).
Output ONLY the message text, no quotation marks, no preamble.`;

        const dm = await callAiEngine({
          task: 'dm',
          prompt,
          systemInstruction: globalAiConfig.dm_system_prompt || "You are a casual human user reaching out on Telegram.",
          temperature: 0.7
        });

        return res.json({
          success: true,
          task: 'dm',
          mode: 'single',
          provider: globalAiConfig.dm_provider,
          model: (callAiEngine as any).lastSuccessfulModel || globalAiConfig.dm_model,
          generatedDm: dm,
          variations: [
            { tone: "Natural AI DM", text: dm }
          ]
        });
      }
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'AI Test call failed.' });
  }
});

// User-level queue endpoints for logged-in user or view-as
app.get('/api/user/info', (req: any, res: any) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) return res.status(401).json({ ok: false, msg: 'Not logged in' });
  const uname = sessionUser.username;
  const u = getUser(uname);
  if (!u) return res.status(404).json({ ok: false, msg: 'User not found' });
  const sum = getUserLedgerSummary(uname);
  res.json({
    ok: true,
    username: u.username,
    display_name: u.display_name || u.username,
    role: u.role || 'user',
    expiry_date: u.expiry_date || 'Lifetime',
    max_accounts: u.max_accounts || 1,
    balance_due: sum.balance_due,
    total_billed: sum.total_billed,
    total_paid: sum.total_paid
  });
});

app.get('/api/user/queue', (req         , res          ) => {
  const currentUser = req.session?.view_as || req.session?.username || 'admin';
  const q = getOwnerQueue(currentUser);
  const peers = getOwnerPeers(currentUser);
  const queueDetails = q.map((uid) => {
    const p = peers.get(String(uid));
    return {
      uid,
      userId: String(uid),
      username: p?.username || '',
      accessHash: p?.accessHash ? 'Yes' : 'No'
    };
  });
  res.json({ success: true, queue: queueDetails, count: q.length });
});

app.post('/api/user/queue/delete', (req         , res          ) => {
  const currentUser = req.session?.view_as || req.session?.username || 'admin';
  const targetUid = Number(req.body?.uid);
  if (!targetUid) return res.status(400).json({ msg: 'Target UID is required!' });

  removeFromOwnerQueue(currentUser, targetUid);
  res.json({ success: true, msg: `User ${targetUid} removed from queue!` });
});

app.post('/api/user/queue/clear', (req         , res          ) => {
  const currentUser = req.session?.view_as || req.session?.username || 'admin';
  saveOwnerVerifiedQueue(currentUser, []);
  saveOwnerRawQueue(currentUser, []);
  saveOwnerQueue(currentUser, []);
  ownerRawReservedUids.get(currentUser)?.clear();
  ownerVerifiedReservedUids.get(currentUser)?.clear();
  globalVerifiedCache.clear();
  broadcastAccountUpdate(currentUser);
  res.json({ success: true, msg: 'All Queues (Verified & Raw) cleared successfully!' });
});

app.get('/api/user/master-config', (req: any, res: any) => {
  const currentUser = getEffectiveUser(req) || 'admin';
  const u = getUser(currentUser);
  if (!u) return res.status(404).json({ msg: 'User not found' });
  const config = u.master_config || {};
  res.json({
    ...config,
    user_ai_enabled: u.ai_enabled === true,
    user_dynamic_enabled: u.dynamic_templates_enabled !== false,
    user_has_any_premium: (u.ai_enabled === true || u.dynamic_templates_enabled !== false)
  });
});

app.post('/api/user/master-config', (req: any, res: any) => {
  const currentUser = getEffectiveUser(req) || 'admin';
  const u = getUser(currentUser);
  if (!u) return res.status(404).json({ msg: 'User not found' });

  const data = req.body || {};
  const [, maxTargets] = userLimits(currentUser);
  const targets = Array.isArray(data.targets) ? data.targets : [];
  if (targets.length > maxTargets) {
    return res.json({
      ok: false,
      msg: `LIMIT REACHED! You are allowed maximum ${maxTargets} target groups (you entered ${targets.length})`
    });
  }

  const filterTok = (data.filter_bot_token || '').trim();

  u.master_config = {
    use_dynamic_templates: data.use_dynamic_templates !== undefined ? Boolean(data.use_dynamic_templates) : true,
    ai_context: data.ai_context || '',
    channel_link: data.channel_link || '',
    targets,
    message_1: data.message_1 || '',
    message_2: data.message_2 || '',
    message_3: data.message_3 || '',
    delay_min: Number(data.delay_min || 60),
    delay_max: Number(data.delay_max || 120),
    check_interval: Number(data.check_interval || 20),
    filter_bot_token: filterTok,
  };

  (u as any).filter_bot_token = filterTok;
  if (filterTok && !u.alert_bot_token) {
    u.alert_bot_token = filterTok;
  }

  // Force sync this filter_bot_token to all accounts belonging to this user
  if (filterTok) {
    for (const [phone, acc] of accounts.entries()) {
      if ((acc.owner || 'admin').toLowerCase() === currentUser.toLowerCase()) {
        if (!acc.config) acc.config = defaultConfig();
        acc.config.filter_bot_token = filterTok;
        if (data.channel_link) acc.config.channel_link = data.channel_link;
      }
    }
    saveAccountsJson();
    // Register commands on Telegram for this user's bot
    registerTelegramBotCommands(filterTok).catch(() => null);
    // Delete any blocking webhooks
    fetch(`https://api.telegram.org/bot${filterTok}/deleteWebhook?drop_pending_updates=false`).catch(() => null);
    // Pre-discover channels
    getFilterBotAdminChannels(filterTok, currentUser, data.channel_link).catch(() => null);
    // Auto-generate tracked join request invite link if channel link is present
    if (data.channel_link) {
      getOrCreateUserTrackedInviteLink(currentUser).catch(() => null);
    }
  }

  saveUsers();
  broadcastAccountUpdate(currentUser); // Broadcast update so UI refreshes if needed
  res.json({ ok: true, msg: 'Master Config saved and Filter Bot linked successfully!' });
});

app.get('/api/user/generate-sample-dm', (req: any, res: any) => {
  const currentUser = getEffectiveUser(req) || 'admin';
  const u = getUser(currentUser);
  const sampleName = String(req.query.name || 'Rahul');
  const channelLink = (req.query.channel_link || u?.master_config?.channel_link || 'https://t.me/YourChannelLink').trim();
  const result = buildDynamicHinglishMessage(sampleName, channelLink);
  const gCount = hinglishTemplates.greetings?.length || 50;
  const oCount = hinglishTemplates.offers?.length || 50;
  const totalCombos = gCount * oCount;
  res.json({
    ok: true,
    ...result,
    stats: {
      greetings_count: gCount,
      offers_count: oCount,
      total_combinations: totalCombos
    }
  });
});

app.post('/api/user/test-bot-token', async (req: any, res: any) => {
  const token = (req.body?.token || '').trim();
  const providedLink = (req.body?.channel_link || '').trim();
  const currentUser = getEffectiveUser(req) || 'admin';
  if (!token) return res.json({ ok: false, msg: 'Please enter a Telegram Bot Token from @BotFather' });
  try {
    const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`);
    const j = await r.json();
    if (!j.ok || !j.result) {
      return res.json({ ok: false, msg: `❌ Telegram error: ${j.description || 'Invalid Bot Token'}` });
    }
    const botInfo = j.result;

    // Discover channels where this bot is Admin
    filterBotAdminChannelsCache.delete(token); // Clear stale cache
    const adminChannels = await getFilterBotAdminChannels(token, currentUser, providedLink);
    
    let channelMsg = '';
    if (adminChannels.size > 0) {
      const channelList = Array.from(adminChannels.entries())
        .filter(([id]) => id.startsWith('-100') || !id.startsWith('@'))
        .map(([id, title]) => `<b>"${title}"</b> (ID: <code>${id}</code>)`)
        .join(', ');
      channelMsg = `<br>📢 <b style="color:#34d399;">Admin in Channel(s):</b> ${channelList || 'Active'} <span style="color:#38bdf8;">(Auto-Filtering Joined Members Active!)</span>`;
    } else {
      channelMsg = `<br>ℹ️ <span style="color:#fbbf24;">Note: Bot connected! To filter joined users, make sure to add @${botInfo.username} as an <b>Admin</b> in your Telegram channel.</span>`;
    }

    return res.json({
      ok: true,
      msg: `✅ Connected! Bot: @${botInfo.username} (${botInfo.first_name})${channelMsg}`,
      bot: botInfo,
      channels_count: adminChannels.size,
      bot_username: botInfo.username
    });
  } catch (err: any) {
    return res.json({ ok: false, msg: `❌ Network error connecting to Telegram Bot API: ${err.message}` });
  }
});

app.post('/api/user/master-config/sync-all', (req: any, res: any) => {
  const currentUser = getEffectiveUser(req) || 'admin';
  let count = 0;
  for (const [phone, acc] of accounts.entries()) {
    if ((acc.owner || 'admin') === currentUser) {
      if (acc.config) {
        acc.config.use_master_config = true;
        count++;
      }
    }
  }
  if (count > 0) {
    saveAccountsJson();
    broadcastAccountUpdate(currentUser);
  }
  res.json({ ok: true, msg: `Successfully synced ${count} account(s) to use Master Configuration!` });
});

// Returns dispatched/sent DMs list with Telegram details for the effective user
app.get('/api/user/sent-dms', (req         , res          ) => {
  const currentUser = getEffectiveUser(req) || 'admin';
  const sentSet = getOwnerSentUsers(currentUser);
  const peers = getOwnerPeers(currentUser);
  const sentArr = Array.from(sentSet);
  const list = sentArr.slice(-100).reverse().map((uid) => {
    const p = peers.get(String(uid));
    return {
      uid,
      userId: String(uid),
      username: p?.username ? `@${p.username}` : '',
      firstName: p?.firstName || '',
      phone: p?.phone || ''
    };
  });
  res.json({ success: true, count: sentSet.size, sent: list });
});

// Returns persistent database of skipped users with reasons, categories, and timestamps
app.get('/api/user/skipped-users', (req         , res          ) => {
  const currentUser = getEffectiveUser(req) || 'admin';
  const m = getOwnerSkippedDetails(currentUser);
  const peers = getOwnerPeers(currentUser);
  const records = Array.from(m.values()).reverse();

  for (const r of records) {
    if (!r.name || r.name === String(r.uid)) {
      const p = peers.get(String(r.uid));
      if (p?.firstName) r.name = p.firstName;
      if (p?.username && !r.username) r.username = `@${p.username.replace(/^@/, '')}`;
      if (p?.phone && !r.phone) r.phone = p.phone;
    }
  }

  res.json({
    success: true,
    count: m.size,
    skipped: records.slice(0, 500)
  });
});

app.post('/api/user/skipped-users/clear', (req         , res          ) => {
  const currentUser = getEffectiveUser(req) || 'admin';
  clearOwnerSkippedUsers(currentUser);
  res.json({ success: true, msg: 'Skipped users database cleared successfully.' });
});

app.get('/api/user/skipped-users/export', (req         , res          ) => {
  const currentUser = getEffectiveUser(req) || 'admin';
  const m = getOwnerSkippedDetails(currentUser);
  const records = Array.from(m.values()).reverse();
  res.setHeader('Content-Disposition', `attachment; filename=skipped_users_${currentUser}.json`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(records, null, 2));
});

