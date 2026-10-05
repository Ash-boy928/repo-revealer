// ---------------- USER ACCESS & ONBOARDING REQUESTS ----------------

// ==========================================
// TELEBOT SMART KHATABOOK & BILLING ENGINE
// ==========================================
interface UserBillingConfig {
  is_demo?: boolean;
  rate_per_day?: number;
  rate_per_bot?: number;
  rate_per_month?: number;
  max_accounts?: number;
  billing_cycle_days?: number;
  payment_model?: string;
  demo_expiry?: string;
  currency?: string;
  notes?: string;
  [key: string]: any;
}

interface BillingInvoice {
  id: string;
  username: string;
  date: string;
  created_at: number;
  type: string;
  description: string;
  bots_count?: number;
  days_count?: number;
  amount: number;
  status: 'due' | 'paid' | 'waived';
  settled_at?: number;
  [key: string]: any;
}

interface BillingPayment {
  id: string;
  username: string;
  date: string;
  created_at: number;
  amount: number;
  mode: 'UPI' | 'Cash' | 'Bank Transfer' | 'USDT' | 'Other';
  reference?: string;
  note?: string;
}

interface DowntimeCompensationLog {
  id: string;
  date: string;
  created_at: number;
  affected_scope: 'global' | 'single_user' | 'single_account';
  target_username?: string;
  target_phone?: string;
  action_type: 'add_days' | 'rupee_credit';
  amount: number;
  reason: string;
}

interface BillingOffer {
  id: string;
  username: string;
  offer_name: string;
  discount_amount: number;
  bonus_days: number;
  note?: string;
  date: string;
  created_at: number;
}

interface BillingDataStore {
  settings: {
    default_rate_per_day: number;
    default_currency: string;
  };
  currency?: string;
  user_configs: Record<string, UserBillingConfig>;
  user_ledgers?: Record<string, any>;
  invoices: BillingInvoice[];
  payments: BillingPayment[];
  offers?: BillingOffer[];
  downtimes: DowntimeCompensationLog[];
  [key: string]: any;
}

let billingStore: BillingDataStore = {
  settings: {
    default_rate_per_day: 15,
    default_currency: 'INR'
  },
  user_configs: {},
  invoices: [],
  payments: [],
  offers: [],
  downtimes: []
};

function loadBillingLocal() {
  // 1. Try loading from SQLite first
  if (sqliteDb) {
    try {
      const kvRow = sqliteDb.prepare("SELECT value_json FROM kv_store WHERE key = 'billing_store'").get();
      if (kvRow && kvRow.value_json) {
        billingStore = JSON.parse(kvRow.value_json);
        console.log('[DATABASE] Billing store loaded safely from SQLite (telebot.db).');
        return true;
      }
    } catch (err) {
      console.warn('[DATABASE] SQLite loadBilling error, falling back to JSON:', err);
    }
  }

  // 2. Fallback to billing.json (and auto-migrate into SQLite if empty)
  try {
    if (fs.existsSync(BILLING_FILE)) {
      const raw = fs.readFileSync(BILLING_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        billingStore = {
          settings: { default_rate_per_day: 10, default_currency: 'INR', ...(data.settings || {}) },
          user_configs: data.user_configs || {},
          invoices: Array.isArray(data.invoices) ? data.invoices : [],
          payments: Array.isArray(data.payments) ? data.payments : [],
          offers: Array.isArray(data.offers) ? data.offers : [],
          downtimes: Array.isArray(data.downtimes) ? data.downtimes : [],
          user_ledgers: data.user_ledgers || {}
        };
        // Auto-heal any corrupted configs or invoices where rate was divided by 7 (e.g. 1.43 instead of 10)
        let modified = false;
        if (billingStore.user_configs) {
          for (const uname of Object.keys(billingStore.user_configs)) {
            const cfg = billingStore.user_configs[uname];
            if (cfg) {
              const u = getUser(uname);
              const targetRate = Number(cfg.rate_per_bot) >= 5 ? Number(cfg.rate_per_bot) : (Number((u as any)?.rate_per_bot) >= 5 ? Number((u as any)?.rate_per_bot) : 10);
              if (cfg.rate_per_day !== undefined && (cfg.rate_per_day < 5 || cfg.rate_per_day === 1.43)) {
                cfg.rate_per_day = targetRate;
                modified = true;
              }
              if (!cfg.rate_per_bot || cfg.rate_per_bot < 5) {
                cfg.rate_per_bot = targetRate;
                modified = true;
              }
            }
          }
        }
        if (Array.isArray(billingStore.invoices)) {
          for (const inv of billingStore.invoices) {
            if (inv.type === 'daily_usage' || inv.type === 'weekly_plan_daily') {
              if (inv.description && (inv.description.includes('1.43') || inv.amount === 5.72 || (inv.bots_count && inv.amount < (inv.bots_count * 5)))) {
                const bots = inv.bots_count || 4;
                const rpb = getUserDailyRatePerBot(inv.username) || 10;
                inv.amount = bots * rpb;
                inv.description = `Daily Usage: ${bots} Live Bot(s) @ ₹${rpb}/bot/day = ₹${inv.amount}`;
                modified = true;
              }
            }
          }
        }
        if (modified) {
          saveBillingLocal();
        }

        // Auto-migrate to SQLite
        if (sqliteDb) {
          try {
            const kvStmt = sqliteDb.prepare(`INSERT OR REPLACE INTO kv_store (key, value_json, updated_at) VALUES (?, ?, ?)`);
            kvStmt.run('billing_store', JSON.stringify(billingStore), Date.now());
            console.log('[MIGRATION] Successfully auto-migrated billing store into SQLite.');
          } catch {}
        }
        return true;
      }
    }
  } catch (e) {
    console.error('Failed to load billing.json:', e);
  }
  return false;
}

function saveBillingLocal() {
  if (sqliteDb) {
    try {
      // 1. Save full store metadata into kv_store
      const kvStmt = sqliteDb.prepare(`INSERT OR REPLACE INTO kv_store (key, value_json, updated_at) VALUES (?, ?, ?)`);
      kvStmt.run('billing_store', JSON.stringify(billingStore), Date.now());

      // 2. Save individual ledgers
      const ledStmt = sqliteDb.prepare(`INSERT OR REPLACE INTO billing_ledgers (username, balance_due, total_billed, total_paid, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
      const ledgers = billingStore.user_ledgers || {};
      for (const [uname, l] of Object.entries(ledgers)) {
        const ledger = l as any;
        ledStmt.run(uname, ledger.balance_due || 0, ledger.total_billed || 0, ledger.total_paid || 0, JSON.stringify(ledger), Date.now());
      }

      // 3. Save recent invoices (last 500)
      const invStmt = sqliteDb.prepare(`INSERT OR REPLACE INTO billing_invoices (id, username, date, amount, type, status, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const inv of (billingStore.invoices || []).slice(-500)) {
        invStmt.run(inv.id || `${inv.username}_${inv.date}_${inv.amount}`, inv.username, inv.date, inv.amount, inv.type || 'weekly_plan', inv.status || 'due', JSON.stringify(inv), Date.now());
      }

      // 4. Save recent payments (last 500)
      const payStmt = sqliteDb.prepare(`INSERT OR REPLACE INTO billing_payments (id, username, date, amount, mode, reference, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const p of (billingStore.payments || []).slice(-500)) {
        payStmt.run(p.id || `${p.username}_${p.date}_${p.amount}`, p.username, p.date, p.amount, p.mode || 'UPI', p.reference || '', JSON.stringify(p), Date.now());
      }
    } catch (err) {
      console.error('Error saving billing to SQLite:', err);
    }
  }

  // Pure SQLite primary: Non-blocking debounced backup snapshot for billing.json
  try {
    asyncSaveJson(BILLING_FILE, billingStore, 2000);
  } catch (e) {
    console.error('Error scheduling billing.json backup:', e);
  }
}

function getUserEffectiveRate(username: string): number {
  if (billingStore.user_configs && billingStore.user_configs[username]) {
    const cfg = billingStore.user_configs[username];
    if (cfg.rate_per_bot && Number(cfg.rate_per_bot) >= 5) {
      return Number(cfg.rate_per_bot);
    }
    if (cfg.rate_per_day && Number(cfg.rate_per_day) >= 5) {
      return Number(cfg.rate_per_day);
    }
  }
  const u = getUser(username);
  if (u && (u as any).rate_per_bot && Number((u as any).rate_per_bot) >= 5) {
    return Number((u as any).rate_per_bot);
  }
  return Number(billingStore.settings.default_rate_per_day) || 10;
}

function addBillingInvoice(inv: any): BillingInvoice {
  const newInv: BillingInvoice = {
    ...inv,
    id: 'inv_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900),
    created_at: Date.now()
  };
  billingStore.invoices.unshift(newInv);
  saveBillingLocal();
  return newInv;
}

function addBillingPayment(pay: any): BillingPayment {
  const newPay: BillingPayment = {
    ...pay,
    id: 'pay_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900),
    created_at: Date.now()
  };
  billingStore.payments.unshift(newPay);
  saveBillingLocal();
  return newPay;
}

function getUserLedgerSummary(username: string) {
  if (!username) {
    return {
      username: '',
      total_billed: 0,
      total_paid: 0,
      total_discount: 0,
      total_bonus_days: 0,
      offers_count: 0,
      balance_due: 0,
      bot_billed: 0,
      bot_paid: 0,
      bot_due: 0,
      extra_billed: 0,
      extra_paid: 0,
      extra_due: 0,
      invoices_count: 0,
      payments_count: 0
    };
  }
  const uname = username.toLowerCase();
  const userInvs = billingStore.invoices.filter(i => (i.username || '').toLowerCase() === uname);
  const userPays = billingStore.payments.filter(p => (p.username || '').toLowerCase() === uname);
  const userOffers = (billingStore.offers || []).filter(o => (o.username || '').toLowerCase() === uname);
  
  const extraInvs = userInvs.filter(i => i.type === 'extra_service');
  const botInvs = userInvs.filter(i => i.type !== 'extra_service');

  // Real cash payments received ONLY (excluding offer discounts)
  const realPays = userPays.filter(p => p.mode !== 'OFFER_DISCOUNT' && !(p as any).is_offer);
  const extraPays = realPays.filter(p => (p as any).is_extra_service === true || p.mode === 'EXTRA_SERVICE' || ((p.reference || '').toLowerCase().includes('extra service')));
  const botPays = realPays.filter(p => !(p as any).is_extra_service && p.mode !== 'EXTRA_SERVICE' && !((p.reference || '').toLowerCase().includes('extra service')));

  const botBilled = botInvs.reduce((acc, i) => acc + Number(i.amount || 0), 0);
  const botPaid = botPays.reduce((acc, p) => acc + Number(p.amount || 0), 0);
  
  // Total discounts given to this user
  const userDiscountAmt = userOffers.reduce((acc, o) => acc + Number(o.discount_amount || 0), 0) +
    userPays.filter(p => p.mode === 'OFFER_DISCOUNT' || (p as any).is_offer).reduce((acc, p) => acc + Number(p.amount || 0), 0);
  const userBonusDays = userOffers.reduce((acc, o) => acc + Number(o.bonus_days || 0), 0);

  // Discount reduces bot due directly
  const botDue = Math.max(0, botBilled - botPaid - userDiscountAmt);

  const extraBilled = extraInvs.reduce((acc, i) => acc + Number(i.amount || 0), 0);
  const extraPaid = extraPays.reduce((acc, p) => acc + Number(p.amount || 0), 0);
  const extraDue = Math.max(0, extraBilled - extraPaid);

  const totalBilled = botBilled + extraBilled;
  const totalPaid = botPaid + extraPaid; // Real cash collected ONLY
  const balanceDue = botDue + extraDue;

  const summary = {
    username,
    total_billed: Math.round(totalBilled),
    total_paid: Math.round(totalPaid),
    total_discount: Math.round(userDiscountAmt),
    total_bonus_days: Math.round(userBonusDays),
    offers_count: userOffers.length,
    balance_due: Math.round(balanceDue),
    bot_billed: Math.round(botBilled),
    bot_paid: Math.round(botPaid),
    bot_due: Math.round(botDue),
    extra_billed: Math.round(extraBilled),
    extra_paid: Math.round(extraPaid),
    extra_due: Math.round(extraDue),
    invoices_count: userInvs.length,
    payments_count: realPays.length
  };
  if (!billingStore.user_ledgers) billingStore.user_ledgers = {};
  billingStore.user_ledgers[username] = summary;
  return summary;
}

// Universal DD/MM/YYYY Date Formatter for Telegram & UI
function formatDisplayDate(dateStr: string | number | Date | null | undefined): string {
  if (!dateStr) return 'Active';
  if (typeof dateStr === 'string') {
    const clean = dateStr.trim();
    if (clean.includes('T')) {
      const p = clean.split('T')[0].split('-');
      if (p.length === 3 && p[0].length === 4) return `${p[2]}/${p[1]}/${p[0]}`;
    }
    const parts = clean.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return clean;
  }
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Active';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(d);
  } catch {
    return String(dateStr);
  }
}

function getUserCycleDateRange(u: any): { startDate: string; expiryDate: string; formattedRange: string; daysRemaining: number } {
  if (!u) return { startDate: '', expiryDate: '', formattedRange: 'Active', daysRemaining: 999 };
  const expStr = (u.expiry_date || '').toString().trim();
  if (!expStr) return { startDate: '', expiryDate: '', formattedRange: 'Lifetime (No Expiry)', daysRemaining: 999 };

  const expFormatted = formatDisplayDate(expStr);
  const cfg = billingStore?.user_configs?.[u.username] || {};
  const cycleDays = Number(cfg.billing_cycle_days || u.billing_cycle_days || 7) || 7;

  let startStr = u.billing_start_date || (u as any).start_date || '';
  if (!startStr) {
    try {
      const expDate = new Date(expStr + 'T23:59:59Z');
      if (!isNaN(expDate.getTime())) {
        const startDateMs = expDate.getTime() - (cycleDays * 86400 * 1000);
        startStr = new Date(startDateMs).toISOString().split('T')[0];
      }
    } catch {
      startStr = getTodayDateString();
    }
  }
  const startFormatted = formatDisplayDate(startStr);

  let daysRemaining = 0;
  try {
    const expDate = new Date(expStr + 'T23:59:59Z');
    const now = Date.now();
    daysRemaining = Math.ceil((expDate.getTime() - now) / (86400 * 1000));
  } catch {}

  const formattedRange = `${startFormatted} ➔ ${expFormatted} (${cycleDays} Days)`;
  return { startDate: startStr, expiryDate: expStr, formattedRange, daysRemaining };
}

