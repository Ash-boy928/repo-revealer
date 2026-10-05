// ---------------- ADMIN ACCOUNT SLOT & APPROVAL MANAGEMENT ----------------
app.get('/api/admin/slot-requests', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  res.json({ ok: true, requests: slotRequests });
});

app.post('/api/admin/slot-request/approve', async (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { id } = req.body || {};
  const item = slotRequests.find((r) => r.id === id);
  if (!item) return res.status(404).json({ ok: false, msg: 'Request not found!' });
  if (item.status !== 'pending') return res.json({ ok: false, msg: `Request is already ${item.status}!` });

  item.status = 'approved';
  item.resolved_at = Date.now();
  item.resolved_by = 'Admin Web Panel';
  saveSlotRequests();

  const u = getUser(item.username);
  if (u) {
    u.max_accounts = Math.max((u.max_accounts || 5) + 1, (u.registered_phones?.length || 0) + 1);
    if (!Array.isArray(u.registered_phones)) u.registered_phones = [];
    if (!u.registered_phones.includes(item.phone)) {
      u.registered_phones.push(item.phone);
    }
    saveUsers();
    broadcastAccountUpdate(u.username);

    if (u.alert_enabled) {
      sendTelegramAlert(u.username, `🎉 <b>Admin Approved Your Account Slot Request!</b>\nSuper Admin has approved your request for <code>${item.phone}</code>.\nYou can now connect this Telegram account in your dashboard!`);
    }
  }

  broadcastAccountUpdate('admin');
  res.json({ ok: true, msg: `Approved slot for ${item.phone} (User: ${item.username})! Allowed limit updated to ${u?.max_accounts || 5} slots.` });
});

app.post('/api/admin/slot-request/reject', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { id } = req.body || {};
  const item = slotRequests.find((r) => r.id === id);
  if (!item) return res.status(404).json({ ok: false, msg: 'Request not found!' });
  if (item.status !== 'pending') return res.json({ ok: false, msg: `Request is already ${item.status}!` });

  item.status = 'rejected';
  item.resolved_at = Date.now();
  item.resolved_by = 'Admin Web Panel';
  saveSlotRequests();

  const u = getUser(item.username);
  if (u && u.alert_enabled) {
    sendTelegramAlert(u.username, `❌ <b>Slot Request Rejected</b>\nAdmin has rejected your request to add <code>${item.phone}</code>.`);
  }

  broadcastAccountUpdate('admin');
  res.json({ ok: true, msg: `Rejected slot request for ${item.phone}.` });
});

app.post('/api/admin/user/release-slot', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { username, phone } = req.body || {};
  const u = getUser(username);
  if (!u) return res.status(404).json({ ok: false, msg: 'User not found!' });

  if (Array.isArray(u.registered_phones)) {
    const prevLen = u.registered_phones.length;
    u.registered_phones = u.registered_phones.filter((p: string) => p !== phone);
    if (u.registered_phones.length !== prevLen) {
      saveUsers();
      broadcastAccountUpdate(u.username);
      broadcastAccountUpdate('admin');
      return res.json({ ok: true, msg: `Slot for ${phone} released! ${u.username} can now add 1 fresh account.` });
    }
  }
  res.json({ ok: false, msg: `Phone ${phone} was not found in registered slots for ${username}.` });
});

app.post('/api/admin/user/reset-slots', (req: any, res: any) => {
  if (!isAdminSession(req)) return res.status(403).json({ ok: false, msg: 'Admin access required!' });
  const { username } = req.body || {};
  const u = getUser(username);
  if (!u) return res.status(404).json({ ok: false, msg: 'User not found!' });

  const activeUserPhones: string[] = [];
  for (const a of accounts.values()) {
    if ((a.owner || 'admin') === u.username && a.phone) {
      activeUserPhones.push(a.phone);
    }
  }
  u.registered_phones = activeUserPhones;
  saveUsers();
  broadcastAccountUpdate(u.username);
  broadcastAccountUpdate('admin');
  res.json({ ok: true, msg: `Registered slots for ${u.username} reset to currently active IDs only (${activeUserPhones.length} slots).` });
});

