// ---------------- ADMIN PANEL APIS ----------------

// Bulk Bot Generator & Vault Endpoints
app.get('/api/admin/bot-generator/accounts', (req, res) => {
  const result: any[] = [];
  for (const a of accounts.values()) {
    const p = a.phone;
    const cnt = getAccountBotsCount(p);
    result.push({
      phone: p,
      label: a.label || p,
      displayName: `${a.label || 'Account'} (${p})`,
      owner: a.owner || 'admin',
      running: a.running,
      status: a.status,
      bots_count: cnt,
      vault_bots_count: cnt,
      max_bots: 20,
      remaining_quota: Math.max(0, 20 - cnt)
    });
  }
  res.json({ success: true, accounts: result, total_vault_bots: botsVault.length });
});

app.get('/api/admin/bot-generator/status', (req, res) => {
  const workers = Array.from(generatorWorkerStates.values()).map(w => ({
    ...w,
    created_count: w.botsCreated,
    target_count: w.botsTarget,
    current_step: w.currentStep
  }));
  const isGenerating = workers.some(w => w.status === 'running' || w.status === 'connecting' || w.status === 'creating' || w.status === 'floodwait');
  const totalTarget = workers.reduce((sum, w) => sum + (w.target_count || 0), 0);
  const totalCreated = workers.reduce((sum, w) => sum + (w.created_count || 0), 0);
  const overallPct = totalTarget > 0 ? Math.min(100, Math.round((totalCreated / totalTarget) * 100)) : 0;

  const recentBots = botsVault.slice(0, 20).map(b => {
    const rawUsername = (b.bot_username || b.username || '').replace(/^@/, '');
    const rawName = b.bot_name || b.name || (rawUsername ? `@${rawUsername}` : (b.bot_id ? `Bot #${b.bot_id}` : 'Bot'));
    return {
      ...b,
      name: rawName,
      bot_name: rawName,
      username: rawUsername,
      bot_username: rawUsername
    };
  });

  res.json({
    success: true,
    isGenerating,
    workers,
    total_target: totalTarget,
    total_created: totalCreated,
    overall_pct: overallPct,
    total_vault_bots: botsVault.length,
    recent_bots: recentBots
  });
});

app.post('/api/admin/bot-generator/start', async (req, res) => {
  const b = req.body || {};
  const phones = b.phones;
  if (!Array.isArray(phones) || phones.length === 0) {
    return res.status(400).json({ msg: 'Please select at least 1 Telegram account!' });
  }

  const namePrefix = (b.name_prefix || b.namePrefix || 'LeoBot').trim();
  const usernamePrefix = (b.username_prefix || b.usernamePrefix || 'leobot').trim();
  const targetCount = parseInt(b.bots_per_account || b.botsPerAccount, 10) || 1;
  const delaySec = parseInt(b.delay_between_bots_sec || b.delaySeconds, 10) || 6;
  const started: string[] = [];

  for (const phone of phones) {
    const a = accounts.get(phone);
    if (!a) continue;

    const existing = generatorWorkerStates.get(phone);
    if (existing && (existing.status === 'running' || existing.status === 'creating' || existing.status === 'connecting')) {
      continue;
    }

    const abortController = new AbortController();
    generatorAbortControllers.set(phone, abortController);

    runBotGeneratorWorker(
      phone,
      targetCount,
      (namePrefix || 'LeoBot').trim(),
      (usernamePrefix || 'leobot').trim(),
      delaySec,
      abortController.signal
    );

    started.push(`${a.label || phone} (${phone})`);
  }

  res.json({
    success: true,
    msg: `Started parallel bot generation for ${started.length} account(s)!`,
    accounts: started
  });
});

app.post('/api/admin/bot-generator/stop', (req, res) => {
  const { phone } = req.body || {};
  if (phone) {
    const ctrl = generatorAbortControllers.get(phone);
    if (ctrl) ctrl.abort();
    const w = generatorWorkerStates.get(phone);
    if (w) {
      w.status = 'stopped';
      w.currentStep = 'Stopped by administrator';
    }
    return res.json({ success: true, msg: `Worker for ${phone} stopped.` });
  } else {
    for (const [p, ctrl] of generatorAbortControllers.entries()) {
      ctrl.abort();
      const w = generatorWorkerStates.get(p);
      if (w) {
        w.status = 'stopped';
        w.currentStep = 'Stopped by administrator';
      }
    }
    generatorAbortControllers.clear();
    return res.json({ success: true, msg: 'All generator workers stopped.' });
  }
});

app.get('/api/admin/bots-vault', (req, res) => {
  const normalizedBots = botsVault.map(b => {
    const rawUsername = (b.bot_username || b.username || '').replace(/^@/, '');
    const rawName = b.bot_name || b.name || (rawUsername ? `@${rawUsername}` : (b.bot_id ? `Bot #${b.bot_id}` : 'Bot'));
    return {
      ...b,
      name: rawName,
      bot_name: rawName,
      username: rawUsername,
      bot_username: rawUsername
    };
  });
  res.json({
    success: true,
    total: normalizedBots.length,
    bots: normalizedBots
  });
});

app.post('/api/admin/bots-vault/delete', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ msg: 'Bot ID is required!' });

  const prevLen = botsVault.length;
  botsVault = botsVault.filter(b => b.id !== id);
  if (botsVault.length !== prevLen) {
    saveBotsVault();
    return res.json({ success: true, msg: 'Bot deleted from vault.' });
  }
  res.status(404).json({ msg: 'Bot not found.' });
});

app.post('/api/admin/bots-vault/clear', (req, res) => {
  const count = botsVault.length;
  botsVault = [];
  saveBotsVault();
  res.json({ success: true, msg: `Cleared ${count} bot(s) from vault.` });
});

app.post('/api/admin/bots-vault/test-token', async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, description: 'Token is required' });

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(6000) });
    const data: any = await tgRes.json().catch(() => null);
    if (data?.ok) {
      const found = botsVault.find(b => b.token === token);
      if (found) {
        found.status = 'active';
        saveBotsVaultLocal();
      }
      return res.json({
        ok: true,
        valid: true,
        username: data.result?.username,
        first_name: data.result?.first_name,
        result: data.result
      });
    } else {
      return res.json({ ok: false, valid: false, msg: data?.description || 'Invalid token' });
    }
  } catch (err: any) {
    return res.json({ ok: false, valid: false, msg: err?.message || 'Connection error or timeout' });
  }
});

app.get('/api/admin/bots-vault/export', (req, res) => {
  const format = (req.query.format || 'txt').toString().toLowerCase();

  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename=bots_vault.json');
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(botsVault, null, 2));
  } else if (format === 'csv') {
    res.setHeader('Content-Disposition', 'attachment; filename=bots_vault.csv');
    res.setHeader('Content-Type', 'text/csv');
    let csv = 'Name,Username,Token,Creator Name,Creator Phone,Owner,Created At,Status\n';
    for (const b of botsVault) {
      csv += `"${b.name}","@${b.username}","${b.token}","${b.creator_label}","${b.creator_phone}","${b.creator_owner}","${b.created_at_formatted}","${b.status}"\n`;
    }
    return res.send(csv);
  } else if (format === 'tokens') {
    res.setHeader('Content-Disposition', 'attachment; filename=bot_tokens_only.txt');
    res.setHeader('Content-Type', 'text/plain');
    const tokens = botsVault.map(b => b.token).join('\n');
    return res.send(tokens);
  } else {
    res.setHeader('Content-Disposition', 'attachment; filename=bots_vault.txt');
    res.setHeader('Content-Type', 'text/plain');
    let txt = `==========================================================\n`;
    txt += `       LEO TELEGM BOT - BOTS VAULT EXPORT (${formatISTDateTime()})\n`;
    txt += `       TOTAL BOTS: ${botsVault.length}\n`;
    txt += `==========================================================\n\n`;
    botsVault.forEach((b, idx) => {
      txt += `[#${idx + 1}] ${b.name} (@${b.username})\n`;
      txt += `Token:   ${b.token}\n`;
      txt += `Creator: ${b.creator_label} (${b.creator_phone}) [Owner: ${b.creator_owner}]\n`;
      txt += `Created: ${b.created_at_formatted}\n`;
      txt += `----------------------------------------------------------\n`;
    });
    return res.send(txt);
  }
});

