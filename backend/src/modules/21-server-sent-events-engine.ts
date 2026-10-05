// ---------------- SERVER-SENT EVENTS (SSE) ENGINE ----------------
interface SseClient {
  id: string;
  res: any;
  owner: string;
}

const sseClients = new Map<string, SseClient>();

function broadcastSse(owner: string, eventName: string, data: any): void {
  const normOwner = owner || 'admin';
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, client] of sseClients.entries()) {
    if (client.owner === normOwner || client.owner === 'admin') {
      try {
        client.res.write(payload);
      } catch {
        sseClients.delete(id);
      }
    }
  }
}

broadcastLogToSse = (phone: string, line: string, server_time: string): void => {
  const a = accounts.get(phone);
  const owner = a?.owner || 'admin';
  broadcastSse(owner, 'log', { phone, line, server_time });
};

function broadcastAccountUpdate(owner?: string): void {
  const targetOwners = owner ? [owner || 'admin'] : Array.from(new Set(Array.from(accounts.values()).map(a => a.owner || 'admin')));
  if (targetOwners.length === 0) targetOwners.push('admin');

  for (const eff of targetOwners) {
    const data: any[] = [];
    let total_sent = 0;
    let total_today_dms = 0;
    const rawQ = getOwnerRawQueue(eff);
    const verifiedQ = getOwnerVerifiedQueue(eff);
    const rawQCount = rawQ.length;
    const verifiedQCount = verifiedQ.length;
    const ownerPeers = getOwnerPeers(eff);

    for (const a of accounts.values()) {
      const aOwner = a.owner || 'admin';
      if (aOwner !== eff) continue;
      checkAndResetDailyQuota(a.phone);
      checkAndResetDailyDmQuota(a.phone);
      const accDailyDms = (a as any).daily_sent_count || 0;
      const accTotalSent = Math.max(a.sent_count || 0, accDailyDms, (a.sent_users ? a.sent_users.size : 0));
      total_sent += accTotalSent;
      total_today_dms += accDailyDms;

      const accRawCount = rawQ.filter(uid => {
        const p = ownerPeers.get(String(uid));
        return !p || !p.sourcePhone || p.sourcePhone === a.phone;
      }).length;
      const accVerifiedCount = getAccountVerifiedQueue(a.phone).length;

      data.push({
        label: a.label,
        phone: a.phone,
        username: a.username || '',
        status: a.status,
        state: statusState(a),
        queue_count: accVerifiedCount,
        shared_queue_count: accVerifiedCount,
        raw_queue_count: accRawCount,
        verified_queue_count: accVerifiedCount,
        daily_extracted_count: (a as any).daily_extracted_count || 0,
        daily_extracted_max: 0,
        daily_sent_count: accDailyDms,
        live_on: a.live_on,
        dm_on: a.dm_on,
        dm_rest_until: (a as any).dm_rest_until || 0,
        peer_flood_consecutive: (a as any).peer_flood_consecutive || 0,
        sent_count: accTotalSent,
        owner: aOwner
      });
    }

    const histTodayCount = dailyDmHistory[eff]?.[getTodayDateString()]?.count || 0;
    total_today_dms = Math.max(total_today_dms, histTodayCount);

    const uObj = getUser(eff);
    const maxAcc = uObj ? (uObj.max_accounts ?? 5) : 5;
    const regPhones = uObj && Array.isArray(uObj.registered_phones) ? uObj.registered_phones : [];

    broadcastSse(eff, 'accounts', {
      accounts: data,
      total_sent,
      total_today_dms,
      effective_user: eff,
      ai_enabled: uObj?.ai_enabled === true,
      raw_queue_total: rawQCount,
      verified_queue_total: verifiedQCount,
      registered_phones: regPhones,
      max_accounts: maxAcc,
      registered_count: regPhones.length
    });
  }
}

