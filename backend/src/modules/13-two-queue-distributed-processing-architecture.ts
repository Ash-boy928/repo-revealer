// ---------------- TWO-QUEUE DISTRIBUTED PROCESSING ARCHITECTURE ----------------
// 1. Raw / Staging Queue (from stream scanner)
const ownerRawQueueCache = new Map<string, number[]>();
const ownerRawReservedUids = new Map<string, Map<number, string>>();

// 2. Verified / Genuine Queue (filtered & ready for DM dispatch)
const ownerVerifiedQueueCache = new Map<string, number[]>();
const ownerVerifiedReservedUids = new Map<string, Map<number, string>>();

// 3. Sent, Skipped & Peers Cache
interface SkippedUserRecord {
  uid: number;
  name?: string;
  username?: string;
  phone?: string;
  reason: string;
  category: 'privacy' | 'premium' | 'no_peer' | 'admin' | 'bot' | 'deleted' | 'spam_bio' | 'other';
  timestamp: string;
  dateFormatted: string;
  skippedByPhone?: string;
}

const ownerSkippedDetailsCache = new Map<string, Map<number, SkippedUserRecord>>();

interface PeerInfo {
  isAdmin?: boolean;
  about?: string;
  [key: string]: any;
  userId: string;
  accessHash?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  sourcePhone?: string;
  accessHashes?: Record<string, string>;
  isPremium?: boolean;
  isBot?: boolean;
  isDeleted?: boolean;
  isPrivacyRestricted?: boolean;
  isContactLocked?: boolean;
  contactSaved?: boolean;
}

function isTelegramPrivacyRestricted(u: any): boolean {
  if (!u) return false;
  if (u.contactRequirePremium === true || u.user?.contactRequirePremium === true) return true;
  if (typeof u.flags2 === 'number' && (u.flags2 & 4) !== 0) return true;
  if (u.user && typeof u.user.flags2 === 'number' && (u.user.flags2 & 4) !== 0) return true;
  return false;
}

function isTelegramPremiumUser(u: any): boolean {
  if (!u) return false;
  // 1. Direct boolean property check on User or entity
  if (u.premium === true || u.isPremium === true) return true;
  if (u.user && (u.user.premium === true || u.user.isPremium === true)) return true;
  if (u.fullUser && (u.fullUser.premium === true || u.fullUser.isPremium === true)) return true;

  // 2. MTProto flags bits (flags bit 12: 4096 / flags2 bit 0: 1)
  if (typeof u.flags === 'number' && (u.flags & 4096) !== 0) return true;
  if (typeof u.flags2 === 'number' && (u.flags2 & 1) !== 0) return true;
  if (u.user && typeof u.user.flags === 'number' && (u.user.flags & 4096) !== 0) return true;
  if (u.user && typeof u.user.flags2 === 'number' && (u.user.flags2 & 1) !== 0) return true;

  // 3. Status or emoji status / premium badges
  if (u.emojiStatus && u.emojiStatus.className && u.emojiStatus.className !== 'EmojiStatusEmpty') return true;
  if (u.user?.emojiStatus && u.user.emojiStatus.className && u.user.emojiStatus.className !== 'EmojiStatusEmpty') return true;

  return false;
}

function isTelegramBotUser(u: any): boolean {
  if (!u) return false;
  if (u.bot === true || u.isBot === true) return true;
  if (u.user && (u.user.bot === true || u.user.isBot === true)) return true;
  const uname = String(u.username || u.user?.username || '').toLowerCase();
  if (uname.endsWith('bot')) return true;
  return false;
}

function isTelegramDeletedUser(u: any): boolean {
  if (!u) return false;
  if (u.deleted === true || u.isDeleted === true || u.scam === true || u.fake === true) return true;
  if (u.user && (u.user.deleted === true || u.user.isDeleted === true || u.user.scam === true)) return true;
  const fname = String(u.firstName || u.first_name || u.user?.firstName || '');
  if (/deleted account/i.test(fname)) return true;
  return false;
}

function isTelegramAdminOrOwner(userObj: any, pInfo?: PeerInfo | null): boolean {
  if (!userObj && !pInfo) return false;
  if (pInfo?.isAdmin || (pInfo as any)?.isCreator || (pInfo as any)?.isOwner) return true;
  if (userObj) {
    if (userObj.adminRights || userObj.creator) return true;
    const cls = String(userObj.className || '');
    if (cls.includes('Admin') || cls.includes('Creator')) return true;
    if (userObj.participant) {
      const pCls = String(userObj.participant.className || '');
      if (pCls.includes('Admin') || pCls.includes('Creator')) return true;
      if (userObj.participant.adminRights) return true;
    }
  }
  const nameAll = [userObj?.firstName, userObj?.lastName, pInfo?.firstName, pInfo?.lastName].filter(Boolean).join(' ').toLowerCase();
  if (/\b(admin|owner|creator|founder|moderator|mod|official\s+admin)\b/i.test(nameAll)) return true;
  return false;
}

function isTelegramUserSpamOrPromo(userObj: any, pInfo?: PeerInfo | null): { isSpam: boolean; reason: string } {
  const texts: string[] = [];
  
  if (userObj) {
    if (userObj.firstName) texts.push(String(userObj.firstName));
    if (userObj.lastName) texts.push(String(userObj.lastName));
    if (userObj.username) texts.push(String(userObj.username));
    if (userObj.about) texts.push(String(userObj.about));
    if (userObj.fullUser?.about) texts.push(String(userObj.fullUser.about));
  }
  
  if (pInfo) {
    if (pInfo.firstName) texts.push(String(pInfo.firstName));
    if (pInfo.lastName) texts.push(String(pInfo.lastName));
    if (pInfo.username) texts.push(String(pInfo.username));
  }
  
  const combined = texts.join(' ').toLowerCase();
  if (!combined.trim()) return { isSpam: false, reason: '' };

  // 0. Check custom reject keywords from Global AI Config / Admin Dashboard
  if (globalAiConfig.custom_reject_keywords && globalAiConfig.custom_reject_keywords.length > 0) {
    for (const rawKw of globalAiConfig.custom_reject_keywords) {
      const kw = String(rawKw || '').toLowerCase().trim();
      if (kw && combined.includes(kw)) {
        return { isSpam: true, reason: `Matched Custom Blacklist: "${kw}"` };
      }
    }
  }

  // 1. Trading / Forex / Crypto / Signal Scams & Promos
  const tradingKeywords = [
    'trader', 'trading', 'trade', 'agent', 'sub-agent', 'subagent', 'broker', 'pro trader',
    'copy trade', 'copy trading', 'forex trader', 'crypto trader', 'binance trader',
    'forex', 'crypto', 'binance', 'future trading', 'binary option',
    'trading signal', 'trade signal', 'sure shot', 'sureshot', 'profit share',
    'recover loss', 'loss recover', 'daily profit', 'vip signal', 'crypto signal',
    'banknifty', 'nifty', 'option trading', 'stock market', 'investment plan',
    'earn daily', 'pnl', '100% accurate', 'free call', 'call put', 'share market',
    'cryptocurrency', 'bitcoin', 'usdt trading', 'vip trade', 'quotex'
  ];
  for (const kw of tradingKeywords) {
    if (combined.includes(kw)) {
      return { isSpam: true, reason: `Trading/Crypto Promo detected: "${kw}"` };
    }
  }

  // 2. Channel Join & Promotional Links
  const promoKeywords = [
    'join my channel', 'join channel', 'join group', 'join my group', 'join now',
    'official channel', 'telegram channel', 't.me/', 'subscribe my channel',
    'click link in bio', 'link in bio', 'dm for join', 'paid group', 'free joining',
    'tap to join', 'join telegram', 'channel link', 'wa.me/', 'whatsapp'
  ];
  for (const kw of promoKeywords) {
    if (combined.includes(kw)) {
      return { isSpam: true, reason: `Channel promo detected: "${kw}"` };
    }
  }

  // 3. Gaming / Betting / Casino / Color Prediction / Color Trading
  const gamingKeywords = [
    'color prediction', 'colour prediction', 'color trading', 'colour trading',
    'big small', 'bigsmall', 'big & small', 'big and small', 'prediction bot', 'game prediction',
    'aviator', 'aviator hack', 'aviator signal', 'mines hack', 'daman', 'daman games',
    'bdg win', 'bdg game', 'tiranga', '91 club', '91club', '82 lottery', 'lottery app', 'betting',
    'casino', 'roulette', 'teen patti', 'rummy trick', 'mod apk hack',
    'satta', 'matka', 'kalyan', 'loss cover', 'recover loss', 'sure shot', 'sureshot',
    'earning app', 'deposit', 'withdrawal', 'register link', 'refer code', 'daily income',
    'gaming channel', 'free diamond', 'free uc', 'pubg hack', 'free fire hack'
  ];
  for (const kw of gamingKeywords) {
    if (combined.includes(kw)) {
      return { isSpam: true, reason: `Gaming/Betting promo detected: "${kw}"` };
    }
  }

  return { isSpam: false, reason: '' };
}

const ownerSentCache = new Map<string, Set<number>>();
const ownerSkippedCache = new Map<string, Set<number>>();
const ownerPeersCache = new Map<string, Map<string, PeerInfo>>();

// 4. Global In-Memory Verified Cache (Shared across accounts & owners, 24-hour TTL)
// Maps target Telegram uid -> expiration timestamp (ms). 
// Re-discovered users in this cache instantly promote to Genuine Queue without re-probing Telegram APIs.
const globalVerifiedCache = new Map<number, number>();
const GLOBAL_VERIFIED_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours

function isGlobalVerified(uid: number): boolean {
  const expiry = globalVerifiedCache.get(uid);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    globalVerifiedCache.delete(uid);
    return false;
  }
  return true;
}

function markGlobalVerified(uid: number): void {
  globalVerifiedCache.set(uid, Date.now() + GLOBAL_VERIFIED_TTL_MS);
}

function categorizeSkipReason(r: string): SkippedUserRecord['category'] {
  const low = (r || '').toLowerCase();
  if (low.includes('spam') || low.includes('promo') || low.includes('trading') || low.includes('channel') || low.includes('gaming') || low.includes('crypto')) return 'spam_bio';
  if (low.includes('premium')) return 'premium';
  if (low.includes('admin') || low.includes('creator') || low.includes('owner')) return 'admin';
  if (low.includes('bot')) return 'bot';
  if (low.includes('deleted') || low.includes('scam') || low.includes('fake')) return 'deleted';
  if (low.includes('privacy') || low.includes('restricted') || low.includes('block') || low.includes('contacts')) return 'privacy';
  if (low.includes('peer') || low.includes('no peer') || low.includes('no username')) return 'no_peer';
  return 'other';
}

function getOwnerSkippedDetails(owner: string): Map<number, SkippedUserRecord> {
  const normOwner = owner || 'admin';
  let m = ownerSkippedDetailsCache.get(normOwner);
  if (!m) {
    m = new Map();
    try {
      const localDbPath = path.join(__dirname, `skipped_db_owner_${normOwner}.json`);
      if (fs.existsSync(localDbPath)) {
        const arr: SkippedUserRecord[] = JSON.parse(fs.readFileSync(localDbPath, 'utf8'));
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (item && item.uid) m.set(item.uid, item);
          }
        }
      }
    } catch {}
    ownerSkippedDetailsCache.set(normOwner, m);
  }
  return m;
}

function getOwnerSkippedUsers(owner: string): Set<number> {
  const normOwner = owner || 'admin';
  let s = ownerSkippedCache.get(normOwner);
  if (!s) {
    s = new Set();
    try {
      const localOwnerSPath = path.join(__dirname, `skipped_owner_${normOwner}.json`);
      if (fs.existsSync(localOwnerSPath)) {
        const arr = JSON.parse(fs.readFileSync(localOwnerSPath, 'utf8'));
        if (Array.isArray(arr)) arr.forEach((id: number) => s!.add(id));
      }
    } catch {}
    const details = getOwnerSkippedDetails(normOwner);
    for (const id of details.keys()) {
      s.add(id);
    }
    ownerSkippedCache.set(normOwner, s);
  }
  return s;
}

function markOwnerSkippedUser(
  owner: string,
  uid: number,
  reason = 'Skipped',
  details?: Partial<SkippedUserRecord>
): void {
  const normOwner = owner || 'admin';
  globalVerifiedCache.delete(uid);
  const s = getOwnerSkippedUsers(normOwner);
  s.add(uid);
  ownerSkippedCache.set(normOwner, s);

  const m = getOwnerSkippedDetails(normOwner);
  const peers = getOwnerPeers(normOwner);
  const p = peers.get(String(uid));

  const now = new Date();
  const rawReason = reason || details?.reason || 'Skipped';
  const record: SkippedUserRecord = {
    uid,
    name: details?.name || p?.firstName || String(uid),
    username: details?.username || (p?.username ? `@${p.username.replace(/^@/, '')}` : undefined),
    phone: details?.phone || p?.phone,
    reason: rawReason,
    category: details?.category || categorizeSkipReason(rawReason),
    timestamp: now.toISOString(),
    dateFormatted: now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    skippedByPhone: details?.skippedByPhone
  };

  m.set(uid, record);
  ownerSkippedDetailsCache.set(normOwner, m);

  try {
    const localOwnerSPath = path.join(__dirname, `skipped_owner_${normOwner}.json`);
    asyncSaveJson(localOwnerSPath, Array.from(s), 800);
  } catch {}

  try {
    const localDbPath = path.join(__dirname, `skipped_db_owner_${normOwner}.json`);
    asyncSaveJson(localDbPath, Array.from(m.values()), 1500);
  } catch {}

  // , { uids: Array.from(s) }); // DISABLED TO PREVENT FIRESTORE LIMIT EXHAUSTION
  // try {
  //   const recentRecords = Array.from(m.values()).slice(-500);
  //   , {
  //     records: recentRecords,
  //     totalCount: m.size,
  //     updatedAt: now.toISOString()
  //   });
  // } catch {}

  if (typeof broadcastAccountUpdate === 'function') {
    try {
      broadcastAccountUpdate(normOwner);
    } catch {}
  }
}

function clearOwnerSkippedUsers(owner: string): void {
  const normOwner = owner || 'admin';
  ownerSkippedCache.set(normOwner, new Set());
  ownerSkippedDetailsCache.set(normOwner, new Map());
  try {
    fs.writeFileSync(path.join(__dirname, `skipped_owner_${normOwner}.json`), '[]', 'utf8');
    fs.writeFileSync(path.join(__dirname, `skipped_db_owner_${normOwner}.json`), '[]', 'utf8');
  } catch {}


}

