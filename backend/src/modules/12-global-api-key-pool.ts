// ---------------- GLOBAL API KEY POOL (UNLIMITED SLOTS) ----------------
interface ApiPoolSlot {
  id: number;
  slot_id: string;
  api_id: number;
  api_hash: string;
  label: string;
  enabled: boolean;
}

const API_POOL_FILE = path.join(__dirname, 'api_pool.json');

function defaultApiPool(): ApiPoolSlot[] {
  return [
    { id: 1, slot_id: 'api_1', api_id: 2040, api_hash: 'b18441a1ff607e10a989891a5462e627', label: 'Telegram Desktop Core', enabled: true },
    { id: 2, slot_id: 'api_2', api_id: 6, api_hash: 'eb06d4abfb49dc3eeb1aeb98ae0f581e', label: 'Telegram Android Official', enabled: true },
    { id: 3, slot_id: 'api_3', api_id: 2496, api_hash: '8da85b0d5b165239a5f4354c0e352885', label: 'Telegram Web Client', enabled: true },
    { id: 4, slot_id: 'api_4', api_id: 17349, api_hash: '344583e45741c457fe1862106095a5eb', label: 'Telegram macOS Client', enabled: true },
    { id: 5, slot_id: 'api_5', api_id: 2834, api_hash: '68875052ad42a40a766ee73f7c8730e6', label: 'Telegram iOS Client', enabled: true },
    { id: 6, slot_id: 'api_6', api_id: 21724, api_hash: '3e0cb5ab27680009c9dd7b439c063f25', label: 'Telegram X Android', enabled: true },
    { id: 7, slot_id: 'api_7', api_id: 0, api_hash: '', label: 'Custom Pool Slot 7', enabled: false },
    { id: 8, slot_id: 'api_8', api_id: 0, api_hash: '', label: 'Custom Pool Slot 8', enabled: false },
    { id: 9, slot_id: 'api_9', api_id: 0, api_hash: '', label: 'Custom Pool Slot 9', enabled: false },
    { id: 10, slot_id: 'api_10', api_id: 0, api_hash: '', label: 'Custom Pool Slot 10', enabled: false },
  ];
}

let apiPool: ApiPoolSlot[] = defaultApiPool();

function saveApiPoolLocal() {
  try {
    fs.writeFileSync(API_POOL_FILE, JSON.stringify(apiPool, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving api_pool.json locally:', e);
  }
}

function loadApiPoolLocal(): boolean {
  try {
    if (fs.existsSync(API_POOL_FILE)) {
      const raw = fs.readFileSync(API_POOL_FILE, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        apiPool = arr.map((x: any, idx: number) => ({
          id: Number(x.id) || (idx + 1),
          slot_id: String(x.slot_id || `api_${x.id || (idx + 1)}`).trim(),
          api_id: Number(x.api_id || 0),
          api_hash: String(x.api_hash || '').trim(),
          label: String(x.label || `Pool Slot #${x.id || (idx + 1)}`).trim(),
          enabled: x.enabled !== false
        }));
        console.log(`[PRIMARY CACHE] Global API pool (${apiPool.length} unlimited slots) loaded from api_pool.json`);
        return true;
      }
    }
  } catch (e) {
    console.error('Error loading api_pool.json:', e);
  }
  apiPool = defaultApiPool();
  saveApiPoolLocal();
  return false;
}

async function loadApiPool() {
  loadApiPoolLocal();
}

function saveApiPool() {
  saveApiPoolLocal();
}

function getBestApiCredentials(preferredApiId?: number, preferredApiHash?: string, preferredSlotId?: string | number): { api_id: number; api_hash: string; slot_id?: string; label?: string } {
  // 1. If explicit valid custom credentials passed, use them
  if (preferredApiId && preferredApiId > 0 && preferredApiHash && preferredApiHash.trim().length >= 8) {
    return { api_id: preferredApiId, api_hash: preferredApiHash.trim() };
  }

  // 2. If a specific pool slot ID or slot_id was requested by user
  if (preferredSlotId !== undefined && preferredSlotId !== null && String(preferredSlotId) !== 'auto') {
    const matchedSlot = apiPool.find(s => s.slot_id === String(preferredSlotId) || s.id === Number(preferredSlotId) || s.api_id === Number(preferredSlotId));
    if (matchedSlot && matchedSlot.enabled && matchedSlot.api_id > 0 && matchedSlot.api_hash && matchedSlot.api_hash.trim().length >= 8) {
      return { api_id: matchedSlot.api_id, api_hash: matchedSlot.api_hash.trim(), slot_id: matchedSlot.slot_id, label: matchedSlot.label };
    }
  }

  // 3. Otherwise balance across active enabled slots
  const activeSlots = apiPool.filter(s => s.enabled && s.api_id > 0 && s.api_hash && s.api_hash.trim().length >= 8);
  if (activeSlots.length === 0) {
    return { api_id: 2040, api_hash: 'b18441a1ff607e10a989891a5462e627', slot_id: 'api_1', label: 'Telegram Desktop Core' };
  }

  const slotCountMap = new Map<number, number>();
  for (const s of activeSlots) {
    slotCountMap.set(s.id, 0);
  }

  for (const acc of accounts.values()) {
    if (acc.api_id) {
      const match = activeSlots.find(s => s.api_id === acc.api_id);
      if (match) {
        slotCountMap.set(match.id, (slotCountMap.get(match.id) || 0) + 1);
      }
    }
  }

  let chosenSlot = activeSlots[0];
  let minCount = Infinity;
  for (const s of activeSlots) {
    const count = slotCountMap.get(s.id) || 0;
    if (count < minCount) {
      minCount = count;
      chosenSlot = s;
    }
  }

  return { api_id: chosenSlot.api_id, api_hash: chosenSlot.api_hash.trim(), slot_id: chosenSlot.slot_id, label: chosenSlot.label };
}

