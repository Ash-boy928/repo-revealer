// ---------------- USER SYSTEM ----------------

function saveUsersLocal() {
  if (sqliteDb) {
    try {
      const stmt = sqliteDb.prepare(`INSERT OR REPLACE INTO users (username, password, role, active, expiry_date, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const u of usersList) {
        stmt.run(u.username, u.password || '', u.role || 'user', u.active ? 1 : 0, u.expiry_date || '', JSON.stringify(u), Date.now());
      }
    } catch (e) {
      console.error('Error saving users to SQLite:', e);
    }
  }
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersList, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving users.json locally:', e);
  }
}

const SLOT_REQUESTS_FILE = path.join(__dirname, 'slot_requests.json');

interface SlotRequest {
  id: string;
  username: string;
  phone: string;
  label: string;
  requested_at: number;
  status: 'pending' | 'approved' | 'rejected';
  resolved_at?: number;
  resolved_by?: string;
}

let slotRequests: SlotRequest[] = [];

function loadSlotRequestsLocal(): boolean {
  try {
    if (fs.existsSync(SLOT_REQUESTS_FILE)) {
      const raw = fs.readFileSync(SLOT_REQUESTS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        slotRequests = data;
        return true;
      }
    }
  } catch (e) {}
  return false;
}

function saveSlotRequestsLocal() {
  try {
    fs.writeFileSync(SLOT_REQUESTS_FILE, JSON.stringify(slotRequests, null, 2), 'utf8');
  } catch (e) {}
}

async function loadSlotRequests() {
  loadSlotRequestsLocal();
}

function saveSlotRequests() {
  saveSlotRequestsLocal();
}

