// ---------------- STATE ----------------

const scanning_channels = new Map<string, string>(); // channel_id -> phone

function getISTDateString() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
}
let lastResetDateIST = getISTDateString();

setInterval(() => {
  const currentIST = getISTDateString();
  if (currentIST !== lastResetDateIST) {
    lastResetDateIST = currentIST;
    for (const [phone, a] of accounts.entries()) {
      a.daily_extracted_count = 0;
      (a as any).daily_extracted_date = currentIST;
      (a as any).daily_sent_count = 0;
      (a as any).daily_sent_date = currentIST;
      (a as any).peer_flood_consecutive = 0;
      (a as any).peer_flood_rest_cycles = 0;
      delete (a as any).dm_rest_until;
      delete (a as any).dm_peer_flood_exhausted;
      a.live_on = true;
      a.dm_on = true;
    }
    scanning_channels.clear();
    saveAccountsJson();
    console.log(`[SYSTEM] Daily quota reset at midnight IST for all accounts.`);
    try {
      const allOwners = new Set<string>(['admin', ...usersList.map((u: any) => u.username)]);
      for (const owner of allOwners) {
        broadcastAccountUpdate(owner);
      }
    } catch (e) {
      console.error('Error broadcasting midnight reset:', e);
    }
  }
}, 30000);

let usersList              = [];
const accounts                              = new Map();
const pendingAuthMap                           = new Map();
const logsMap                        = new Map();
const loginAttempts                                                = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 300;

