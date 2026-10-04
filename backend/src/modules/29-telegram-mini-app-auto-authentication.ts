// ---------------- TELEGRAM MINI APP (TMA) AUTO-AUTHENTICATION ----------------
app.post('/api/tma/auth', (req: any, res: any) => {
  try {
    const { initData } = req.body || {};

    if (!initData || typeof initData !== 'string' || !initData.trim()) {
      return res.status(400).json({ ok: false, msg: 'Missing Telegram Mini App initData signature.' });
    }

    // Collect all valid bot tokens configured in system to verify HMAC signature
    const adminUser = usersList.find((u: any) => u.role === 'admin');
    const candidateTokens: string[] = [];
    if (adminUser?.alert_bot_token) candidateTokens.push(adminUser.alert_bot_token.trim());
    for (const u of usersList) {
      if (u.alert_bot_token && !candidateTokens.includes(u.alert_bot_token.trim())) {
        candidateTokens.push(u.alert_bot_token.trim());
      }
    }
    if (process.env.BOT_TOKEN && !candidateTokens.includes(process.env.BOT_TOKEN.trim())) {
      candidateTokens.push(process.env.BOT_TOKEN.trim());
    }
    if (process.env.TELEGRAM_BOT_TOKEN && !candidateTokens.includes(process.env.TELEGRAM_BOT_TOKEN.trim())) {
      candidateTokens.push(process.env.TELEGRAM_BOT_TOKEN.trim());
    }

    let verifiedPayload: { isValid: boolean; user?: any; authDate?: number } = { isValid: false };

    for (const token of candidateTokens) {
      const v = verifyTelegramWebAppData(initData, token);
      if (v.isValid) {
        verifiedPayload = v;
        break;
      }
    }

    // If bot tokens are configured in system, enforce strict cryptographic HMAC verification
    if (candidateTokens.length > 0 && !verifiedPayload.isValid) {
      console.warn('[SECURITY] TMA HMAC verification failed: Untrusted or forged initData signature rejected.');
      return res.status(401).json({
        ok: false,
        msg: 'Security verification failed: Invalid or forged Telegram HMAC signature. Access denied.'
      });
    }

    // Extract user profile from verified cryptographic payload (or parse if no token configured yet)
    let tgUser: any = verifiedPayload.user;
    if (!tgUser) {
      try {
        const parsed = new URLSearchParams(initData);
        const userStr = parsed.get('user');
        if (userStr) tgUser = JSON.parse(userStr);
      } catch (e) {
        const match = initData.match(/user=({[^&]+})/);
        if (match) {
          try {
            tgUser = JSON.parse(decodeURIComponent(match[1]));
          } catch {}
        }
      }
    }

    if (!tgUser || !tgUser.id) {
      return res.status(400).json({ ok: false, msg: 'No Telegram user profile detected in TMA initData' });
    }

    const tgId = String(tgUser.id);
    const tgUsername = (tgUser.username || '').toLowerCase().trim();
    const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUsername || `User_${tgId}`;

    // 1. Check if user already exists with matching telegram_id or matching username
    let matchedUser = usersList.find((u: any) => 
      (u.telegram_id && String(u.telegram_id) === tgId) ||
      (tgUsername && u.username && u.username.toLowerCase() === tgUsername)
    );

    if (matchedUser) {
      if (!matchedUser.telegram_id) {
        matchedUser.telegram_id = tgId;
        saveUsers();
      }
    } else {
      // Auto-provision a starter account for new Telegram user
      const baseUsername = tgUsername || `tg_${tgId}`;
      let finalUsername = baseUsername;
      let counter = 1;
      while (usersList.some((u: any) => u.username === finalUsername)) {
        finalUsername = `${baseUsername}_${counter++}`;
      }

      matchedUser = {
        username: finalUsername,
        password: hashVal(crypto.randomBytes(16).toString('hex')),
        role: 'user',
        active: true,
        telegram_id: tgId,
        telegram_name: tgName,
        max_accounts: 3,
        max_targets: 10,
        registered_phones: [],
        master_config: {
          delay_min: 45,
          delay_max: 90,
          check_interval: 20
        },
        ai_enabled: false,
        dynamic_templates_enabled: true
      };
      usersList.push(matchedUser);
      saveUsers();
      console.log(`[TMA AUTH] Created new user "${finalUsername}" for Telegram ID: ${tgId} (${tgName})`);

      try {
        const adminUser = usersList.find((u: any) => u.role === 'admin');
        if (adminUser?.alert_bot_token && adminUser?.alert_chat_id) {
          const newTmaAlert = `👤 <b>NEW USER ACCOUNT REGISTERED VIA TMA!</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 <b>Username:</b> <code>${finalUsername}</code>\n` +
            `📱 <b>Telegram ID:</b> <code>${tgId}</code> (${tgName || tgUsername || 'Telegram User'})\n` +
            `🤖 <b>Bot Slots:</b> <b>3 Bots</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🕒 <i>Registered at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</i>`;
          sendTelegramMessage(adminUser.alert_bot_token, adminUser.alert_chat_id, newTmaAlert).catch(() => null);
        }
      } catch {}
    }

    if (!matchedUser.active) {
      return res.status(401).json({ ok: false, msg: 'Account disabled. Contact administrator.' });
    }

    const token = createToken(matchedUser.username, matchedUser.role);
    if (req.session) {
      req.session.username = matchedUser.username;
      req.session.role = matchedUser.role;
    }

    return res.json({
      ok: true,
      role: matchedUser.role,
      username: matchedUser.username,
      token,
      redirect: matchedUser.role === 'admin' ? '/admin' : '/dashboard',
      user: {
        username: matchedUser.username,
        role: matchedUser.role,
        telegram_id: tgId,
        telegram_name: tgName
      }
    });
  } catch (err: any) {
    console.error('[TMA AUTH ERROR]:', err);
    return res.status(500).json({ ok: false, msg: 'Internal error processing TMA authentication' });
  }
});

