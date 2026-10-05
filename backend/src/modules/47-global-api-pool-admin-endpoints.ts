// ---------------- GLOBAL API POOL (UNLIMITED KEYS) ADMIN ENDPOINTS ----------------
app.get('/api/admin/api-pool', (req: any, res: any) => {
  const me = getUser(req.session?.username || '');
  if (!me || me.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Super Admin required.' });
  }

  const slotsWithStats = apiPool.map(slot => {
    let linkedCount = 0;
    if (slot.api_id > 0) {
      for (const acc of accounts.values()) {
        if (acc.api_id === slot.api_id) linkedCount++;
      }
    }
    return {
      ...slot,
      linkedCount
    };
  });

  const totalAccounts = accounts.size;
  const activeSlotsCount = apiPool.filter(s => s.enabled && s.api_id > 0 && s.api_hash).length;

  res.json({
    success: true,
    slots: slotsWithStats,
    totalAccounts,
    activeSlotsCount,
    totalSlots: apiPool.length
  });
});

app.post('/api/admin/api-pool/update', (req: any, res: any) => {
  const me = getUser(req.session?.username || '');
  if (!me || me.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Super Admin required.' });
  }

  const { slots } = req.body || {};
  if (!Array.isArray(slots)) {
    return res.status(400).json({ error: 'Invalid slots data provided.' });
  }

  // Update entire pool dynamically allowing unlimited slots
  const newPool: ApiPoolSlot[] = [];
  slots.forEach((s: any, idx: number) => {
    const slotIdNum = Number(s.id) || (idx + 1);
    newPool.push({
      id: slotIdNum,
      slot_id: s.slot_id || `api_${slotIdNum}`,
      api_id: Number(s.api_id) || 0,
      api_hash: String(s.api_hash || '').trim(),
      label: String(s.label || `Pool Slot #${slotIdNum}`).trim(),
      enabled: s.enabled !== false
    });
  });

  apiPool = newPool;
  saveApiPool();
  res.json({
    success: true,
    msg: `Global API Key Pool updated successfully! (${apiPool.length} slots active)`,
    totalSlots: apiPool.length
  });
});

app.post('/api/admin/api-pool/add-slot', (req: any, res: any) => {
  const me = getUser(req.session?.username || '');
  if (!me || me.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Super Admin required.' });
  }

  const maxId = apiPool.reduce((m, s) => Math.max(m, s.id || 0), 0);
  const nextId = maxId + 1;
  const newSlot: ApiPoolSlot = {
    id: nextId,
    slot_id: `api_${nextId}`,
    api_id: Number(req.body?.api_id) || 0,
    api_hash: String(req.body?.api_hash || '').trim(),
    label: String(req.body?.label || `Custom Pool Slot ${nextId}`).trim(),
    enabled: true
  };

  apiPool.push(newSlot);
  saveApiPool();
  res.json({ success: true, slot: newSlot, msg: `API Slot #${nextId} created successfully!`, totalSlots: apiPool.length });
});

app.post('/api/admin/api-pool/delete-slot', (req: any, res: any) => {
  const me = getUser(req.session?.username || '');
  if (!me || me.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Super Admin required.' });
  }

  const targetId = Number(req.body?.id);
  if (!targetId) {
    return res.status(400).json({ error: 'Slot ID is required to delete.' });
  }

  const initialCount = apiPool.length;
  apiPool = apiPool.filter(s => s.id !== targetId);

  if (apiPool.length === initialCount) {
    return res.status(404).json({ error: `Slot #${targetId} not found.` });
  }

  saveApiPool();
  res.json({ success: true, msg: `Slot #${targetId} deleted successfully.`, totalSlots: apiPool.length });
});

app.post('/api/admin/api-pool/reset-defaults', (req: any, res: any) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ error: 'Access denied. Super Admin required.' });
  }

  apiPool = defaultApiPool();
  saveApiPool();
  res.json({ success: true, msg: 'Global API Pool reset to standard high-speed default keys!' });
});


