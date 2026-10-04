// ---------------- MIDNIGHT 12:00 AM & EXPIRY AUTOMATIONS ----------------
const LAST_SWEEP_FILE = path.join(__dirname, 'last_midnight_sweep.json');
let lastMidnightTransferDate = '';
try {
  if (fs.existsSync(LAST_SWEEP_FILE)) {
    const raw = fs.readFileSync(LAST_SWEEP_FILE, 'utf8');
    lastMidnightTransferDate = JSON.parse(raw).lastDate || getTodayDateString();
  } else {
    // CRITICAL: On first startup during the day, lock to today's date so it NEVER wipes daytime data prematurely!
    lastMidnightTransferDate = getTodayDateString();
    fs.writeFileSync(LAST_SWEEP_FILE, JSON.stringify({ lastDate: lastMidnightTransferDate, lastRun: new Date().toISOString() }), 'utf8');
  }
} catch {
  lastMidnightTransferDate = getTodayDateString();
}

const lastUserReminderSentDate: Record<string, string> = {};

async function checkAndSendAuto2DayReminders(): Promise<void> {
  const todayStr = getTodayDateString();

  for (const u of usersList) {
    if (u.role === 'admin' || !u.expiry_date || !u.active) continue;
    if (lastUserReminderSentDate[u.username] === todayStr) continue; // Already reminded today

    const uLedger = (billingStore.user_ledgers || {})[u.username] || {};
    const balanceDue = Number(uLedger.balance_due || 0);
    if (balanceDue <= 0) continue; // Only remind if user has balance due

    const expTime = new Date(u.expiry_date + 'T23:59:59Z').getTime();
    const now = Date.now();
    const diffDays = Math.ceil((expTime - now) / (86400 * 1000));

    // If 2 days remaining, 1 day remaining, expiring today, or overdue with balance due
    if (diffDays <= 2) {
      lastUserReminderSentDate[u.username] = todayStr;
      console.log(`[AUTO REMINDER] Sending reminder to ${u.username} (${diffDays} days left, Due: ₹${balanceDue}, Expiry: ${formatDisplayDate(u.expiry_date)})`);
      sendUserBillingReminder(u.username).catch(() => null);
    }
  }
}

async function checkExpiredUsersAndTerminate(): Promise<void> {
  const todayStr = getTodayDateString();
  let changed = false;

  for (const u of usersList) {
    if (u.role === 'admin' || !u.expiry_date) continue;

    const isDemoUser = Boolean((u as any).is_demo || (billingStore.user_configs[u.username]?.is_demo));

    // Demo user termination logic
    if (isDemoUser) {
      if (todayStr > u.expiry_date && u.active) {
        u.active = false;
        changed = true;
        console.log(`[USER EXPIRED & TERMINATED]: DEMO USER "${u.username}" expired on ${u.expiry_date}. Disabling account and stopping bots.`);
        for (const a of accounts.values()) {
          if ((a.owner || 'admin') === u.username && a.running) {
            a.running = false;
            if (a.abortController) a.abortController.abort();
            a.status = 'Stopped (Demo Expired)';
            log(a.phone, 'FAIL', `Demo period expired on ${u.expiry_date}. Bot stopped.`);
          }
        }
        if (u.alert_enabled) {
          sendTelegramAlert(u.username, `⚠️ <b>Demo Period Expired</b>:\nYour free demo period ended on <b>${u.expiry_date}</b>. Please upgrade to a paid plan.`);
        }
      }
      continue;
    }

    // Regular / Weekly Paid Users:
    if (todayStr > u.expiry_date) {
      const summary = getUserLedgerSummary(u.username);

      // Case 1: All dues cleared (balance_due <= 0) -> AUTOMATIC 7-DAY EXTENSION!
      if (summary.balance_due <= 0) {
        const parsed = new Date(u.expiry_date + 'T23:59:59Z').getTime();
        const curMs = Date.now() + 5.5 * 3600 * 1000;
        const baseMs = (!isNaN(parsed) && parsed > curMs) ? parsed : curMs;
        const newExpMs = baseMs + (7 * 86400 * 1000);
        u.expiry_date = new Date(newExpMs).toISOString().split('T')[0];
        u.active = true;
        (u as any).payment_paused = false;
        (u as any).grace_period_until = null;
        changed = true;

        console.log(`[CYCLE AUTO-EXTEND]: User ${u.username} has ₹0 due. Auto-extended by 7 days until ${u.expiry_date}`);
        sendTelegramAlert(u.username, `🎉 <b>Plan Auto-Extended!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\nYour previous 7-day cycle has completed with 0 pending dues.\nYour validity has been <b>automatically extended for 7 Days</b> until <b>${u.expiry_date}</b>!\nYour bots are active and running.`).catch(() => null);
        continue;
      }

      // Case 2: Dues are pending (balance_due > 0, e.g. ₹180) -> 2-Day Grace Period Reminder!
      let graceUntil = (u as any).grace_period_until;
      if (!graceUntil) {
        const expDateObj = new Date(u.expiry_date + 'T23:59:59Z');
        const graceMs = expDateObj.getTime() + (2 * 86400 * 1000);
        graceUntil = new Date(graceMs).toISOString().split('T')[0];
        (u as any).grace_period_until = graceUntil;
        changed = true;

        console.log(`[GRACE PERIOD START]: User ${u.username}: 7-day cycle ended on ${u.expiry_date} with ₹${summary.balance_due} due. 2-Day grace period until ${graceUntil}`);
        sendTelegramAlert(u.username, `⚠️ <b>Payment Due & 2-Day Grace Reminder</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\nYour 7-day plan cycle ended on <b>${u.expiry_date}</b>.\n💳 <b>Pending Balance Due:</b> <b>₹${summary.balance_due}</b>\n⏳ <b>Grace Period:</b> You have <b>2 days until ${graceUntil}</b> to clear this payment.\n\nℹ️ Your bots will continue running during this 2-day grace period. If payment is not cleared by ${graceUntil}, bots will be automatically paused.`).catch(() => null);
      }

      // Case 3: 2-day grace period expired and payment is STILL NOT CLEARED -> PAUSE BOTS!
      if (graceUntil && todayStr > graceUntil) {
        if (!(u as any).payment_paused) {
          (u as any).payment_paused = true;
          changed = true;
          console.log(`[GRACE PERIOD EXPIRED]: User ${u.username} did not clear ₹${summary.balance_due} due. Pausing all bots.`);

          for (const a of accounts.values()) {
            if ((a.owner || 'admin') === u.username && a.running) {
              a.running = false;
              if (a.abortController) a.abortController.abort();
              a.status = 'Paused (Payment Due)';
              log(a.phone, 'FAIL', `2-day grace period expired with ₹${summary.balance_due} pending. Bot paused.`);
            }
          }

          sendTelegramAlert(u.username, `🚨 <b>Bots Paused (Payment Overdue)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\nYour 2-day grace period ended on <b>${graceUntil}</b>.\n💳 <b>Outstanding Due:</b> <b>₹${summary.balance_due}</b>\n\n⏸️ All your bots have been paused. Once you clear the payment, your bots will automatically resume and your plan will extend by 7 days!`).catch(() => null);
        }
      }
    }
  }

  if (changed) {
    await saveUsers();
    if (typeof broadcastAccountUpdate === 'function') {
      broadcastAccountUpdate('admin');
    }
  }
}

async function runMidnightQueueTransferSweep(force: boolean = false): Promise<number> {
  const todayStr = getTodayDateString();
  if (!force && lastMidnightTransferDate === todayStr) return 0;
  lastMidnightTransferDate = todayStr;
  try {
    fs.writeFileSync(LAST_SWEEP_FILE, JSON.stringify({ lastDate: todayStr, lastRun: new Date().toISOString() }), 'utf8');
  } catch {}

  console.log(`[MIDNIGHT QUEUE SWEEP] Running 12:00 AM Sent DM transfer sweep for date: ${todayStr} (force=${force})...`);
  let totalMovedSent = 0;
  const adminPeers = getOwnerPeers('admin');
  const adminSent = getOwnerSentUsers('admin');

  for (const u of usersList) {
    if (u.role === 'admin' || u.username === 'admin') continue;

    // 1. Gather ALL sent UIDs from both user owner cache AND all accounts owned by this user
    const sentSet = new Set<number>(getOwnerSentUsers(u.username));
    for (const acc of accounts.values()) {
      if ((acc.owner || 'admin') === u.username && acc.sent_users && acc.sent_users.size > 0) {
        for (const uid of acc.sent_users) {
          sentSet.add(Number(uid));
        }
      }
    }

    if (sentSet.size > 0) {
      const sentCount = sentSet.size;
      totalMovedSent += sentCount;

      const userPeers = getOwnerPeers(u.username);
      for (const uid of sentSet) {
        adminSent.add(uid);
        const uidStr = String(uid);
        let p = userPeers.get(uidStr) || findPeerInfoAnywhere(uidStr, u.username);
        // Fallback check in account-level peers
        if (!p) {
          for (const acc of accounts.values()) {
            if ((acc.owner || 'admin') === u.username) {
              const accPeers = loadPeers(acc.phone);
              if (accPeers && accPeers.has(Number(uid))) {
                p = accPeers.get(Number(uid));
                break;
              }
            }
          }
        }
        if (p) {
          adminPeers.set(uidStr, {
            userId: uidStr,
            accessHash: p.accessHash,
            username: p.username,
            firstName: p.firstName,
            lastName: p.lastName,
            phone: p.phone,
            sourcePhone: p.sourcePhone || u.username
          });
        }
      }

      // Reset user sent cache for new day so they can fresh operate, while admin holds master record
      ownerSentCache.set(u.username, new Set());
      try {
        const localOwnerSPath = path.join(__dirname, `sent_owner_${u.username}.json`);
        fs.writeFileSync(localOwnerSPath, JSON.stringify([]), 'utf8');
      } catch {}

      // Clear account-level sent caches for all accounts belonging to this user
      for (const acc of accounts.values()) {
        if ((acc.owner || 'admin') === u.username) {
          acc.sent_users?.clear();
          sentUsersCache.set(acc.phone, new Set());
          const pId = acc.phone.replace(/[^0-9+]/g, '');
          try {
            const accSentFile = path.join(__dirname, `sent_${pId}.json`);
            if (fs.existsSync(accSentFile)) {
              fs.writeFileSync(accSentFile, JSON.stringify([]), 'utf8');
            }
          } catch {}
        }
      }

      console.log(`[MIDNIGHT SWEEP]: Successfully archived and transferred ${sentCount} sent DM contacts from "${u.username}" to Admin master database with complete peer credentials.`);
    }

    broadcastAccountUpdate(u.username);

    if (u.alert_enabled && sentSet.size > 0) {
      sendTelegramAlert(u.username, `🌙 <b>Midnight Sweep (${todayStr})</b>:\n✅ Sent DM records (${sentSet.size}) transferred to Admin master pool for fresh new day.\nℹ️ Your Genuine Queue was preserved.`);
    }
  }

  if (totalMovedSent > 0) {
    saveOwnerPeers('admin', adminPeers);
    ownerSentCache.set('admin', adminSent);
    try {
      const localOwnerSPath = path.join(__dirname, `sent_owner_admin.json`);
      fs.writeFileSync(localOwnerSPath, JSON.stringify(Array.from(adminSent)), 'utf8');
    } catch {}

    broadcastAccountUpdate('admin');
    console.log(`[MIDNIGHT SWEEP COMPLETED]: Transferred & archived ${totalMovedSent} sent DM records into Admin master pool.`);

    // Send summary alert to Admin bot
    const adminUser = usersList.find(x => x.username === 'admin' || x.role === 'admin');
    if (adminUser && adminUser.alert_enabled) {
      sendTelegramAlert('admin', `🌙 <b>Midnight Sweep Report (${todayStr})</b>:\n✅ Transferred & archived <b>${totalMovedSent}</b> sent DM records into Admin master pool with all peer details.\nℹ️ User leftover queues were left untouched.`);
    }
  }

  return totalMovedSent;
}

// 🛡️ CONTINUOUS ULTRA RAM & CACHE OPTIMIZATION WATCHDOG (Caps RAM under 1.5GB)
function runMemoryAndCacheOptimizationSweep(): void {
  try {
    const mem = process.memoryUsage();
    const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);
    const rssMb = Math.round(mem.rss / 1024 / 1024);

    // 1. Prune logsMap to max 80 lines per phone
    for (const [phone, list] of logsMap.entries()) {
      if (Array.isArray(list) && list.length > 80) {
        list.splice(0, list.length - 80);
      }
    }

    // 2. Prune ownerSkippedDetailsCache to max 250 records per owner
    for (const [owner, detailsMap] of ownerSkippedDetailsCache.entries()) {
      if (detailsMap && detailsMap.size > 250) {
        const toDeleteCount = detailsMap.size - 100;
        const it = detailsMap.keys();
        for (let i = 0; i < toDeleteCount; i++) {
          const k = it.next().value;
          if (k !== undefined) detailsMap.delete(k);
          else break;
        }
      }
    }

    // 3. Prune streamParticipantsCache older than 8 minutes
    const now = Date.now();
    for (const [phone, entry] of streamParticipantsCache.entries()) {
      if (entry && now - entry.lastSync > 8 * 60 * 1000) {
        streamParticipantsCache.delete(phone);
      }
    }

    // 4. Prune tempLiveStreamCooldown
    for (const [uid, exp] of tempLiveStreamCooldown.entries()) {
      if (now > exp) {
        tempLiveStreamCooldown.delete(uid);
      }
    }

    // 5. Aggressively prune GramJS internal entity caches across connected clients (cap at max 50 items)
    for (const a of accounts.values()) {
      if (a.client) {
        // Prune entity cache
        const entCache = (a.client as any)._entityCache;
        if (entCache && entCache.cacheMap instanceof Map) {
          if (entCache.cacheMap.size > 50) {
            const deleteCount = entCache.cacheMap.size - 25;
            const it = entCache.cacheMap.keys();
            for (let i = 0; i < deleteCount; i++) {
              const k = it.next().value;
              if (k !== undefined) entCache.cacheMap.delete(k);
              else break;
            }
          }
        }
        // Prune unneeded message/channel buffers if attached
        if ((a.client as any)._messageCache instanceof Map) {
          (a.client as any)._messageCache.clear();
        }
      }
    }

    // 6. Trigger V8 Garbage Collector if exposed
    if (typeof (global as any).gc === 'function') {
      try {
        (global as any).gc();
      } catch {}
    }

    if (heapUsedMb > 900) {
      console.log(`[RAM WATCHDOG] Optimized Memory: Heap ${heapUsedMb}MB / ${heapTotalMb}MB (RSS: ${rssMb}MB) | Cleaned client entity caches`);
    }
  } catch (err) {
    console.error('[RAM WATCHDOG ERROR]:', err);
  }
}

// 🛡️ AUTO 4-HOUR COMPREHENSIVE GARBAGE & LOG PURGE WATCHDOG
let lastFourHourPurge = Date.now();
function runFourHourGarbageSweep(): void {
  const now = Date.now();
  if (now - lastFourHourPurge < 4 * 3600 * 1000) return;
  lastFourHourPurge = now;
  console.log('[AUTO-PURGE 4H] Running scheduled 4-hour garbage, queue, and memory sweep...');

  // 1. Clear in-memory logs to max 50 lines per phone
  for (const [phone, list] of logsMap.entries()) {
    if (Array.isArray(list) && list.length > 50) {
      list.splice(0, list.length - 50);
    }
  }

  // 2. Clear stale stream listener participants cache
  streamParticipantsCache.clear();
  tempLiveStreamCooldown.clear();

  // 3. Clear GramJS entity caches across all accounts
  for (const a of accounts.values()) {
    if (a.client) {
      try {
        const entCache = (a.client as any)._entityCache;
        if (entCache && entCache.cacheMap instanceof Map) {
          entCache.cacheMap.clear();
        }
      } catch {}
    }
  }

  // 4. Force V8 Garbage Collection if exposed
  if (typeof (global as any).gc === 'function') {
    try { (global as any).gc(); } catch {}
  }

  // 5. Auto-truncate PM2 log files if over 30MB
  try {
    const homeDir = process.env.HOME || '/home/leotelebot_000';
    const pm2LogPath = path.join(homeDir, '.pm2', 'logs', 'telebot-out.log');
    if (fs.existsSync(pm2LogPath)) {
      const stats = fs.statSync(pm2LogPath);
      if (stats.size > 30 * 1024 * 1024) {
        fs.writeFileSync(pm2LogPath, `[AUTO-TRUNCATED 4H AT ${new Date().toISOString()}]\n`, 'utf8');
        console.log(`[AUTO-PURGE 4H] Successfully truncated PM2 log file (${Math.round(stats.size / 1024 / 1024)}MB -> 0MB).`);
      }
    }
  } catch {}
}

// Background scheduler loop (checks every 25 seconds)
let midnightSchedulerActive = false;
let memSweepCounter = 0;
async function startMidnightAndExpirySchedulerLoop() {
  if (midnightSchedulerActive) return;
  midnightSchedulerActive = true;

  while (true) {
    try {
      memSweepCounter++;
      if (memSweepCounter % 2 === 0) {
        // Runs every ~50 seconds for real-time memory cleanup
        runMemoryAndCacheOptimizationSweep();
      }
      runFourHourGarbageSweep();
      await checkExpiredUsersAndTerminate();
      await checkAndSendAuto2DayReminders();
      accrueDailyUsageForAllUsers();
      const moved = await runMidnightQueueTransferSweep();
      if (moved > 0) {
        console.log(`[MIDNIGHT PURGE] Daily quota reset completed. Running 1-day personal chat sweep for all accounts...`);
        runAutoCleanOldChatsSweep(1).catch(() => {});
      }
    } catch (e) {
      console.error('[MIDNIGHT/EXPIRY SCHEDULER ERROR]:', e);
    }
    await new Promise((r) => setTimeout(r, 25000));
  }
}

