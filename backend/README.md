# 🚀 Telebot — Multi-Account Telegram Automation & Fleet Dashboard

High-performance, ban-resistant Telegram multi-account promoter, live stream reactions, and automated direct messaging dashboard with real-time analytics, Khatabook ledger, and multi-model AI routing.

---

## 🏗️ Architecture & Modular Structure

The codebase is organized as a **high-speed Modular Monolith** designed for 24/7 reliability, zero downtime, and minimal RAM/CPU consumption:

```text
├── server.ts                  # Central Express Server, WebSocket & Bot Orchestrator
├── backup_data.js             # 1-Click Automated VPS Backup Utility
├── clean_stale_accounts.js    # Stale/Unlinked Account Cleaner
├── reset-admin.js             # Emergency Admin Password Reset Script
│
├── src/
│   ├── config/
│   │   └── constants.ts       # Shared paths, environment constants & timeout wrappers
│   ├── db/
│   │   └── sqlite.ts          # Corruption-Proof SQLite WAL Engine & KV Store
│   ├── security/
│   │   └── securityGuard.ts   # Chmod 600 Permission Guard & IP Brute-Force Rate Limiter
│   ├── services/
│   │   ├── aiEngine.ts        # Universal Multi-Model AI Router (Gemini, Groq, DeepSeek)
│   │   └── proxyThemeService.ts# Master Sticky Proxy & UI Theme Config
│   └── utils/
│       └── fileWriter.ts      # Non-blocking debounced asynchronous file persistence
│
├── admin.html                 # Super Admin Control Center, Fleet Monitor & Khatabook
├── dashboard.html             # User Multi-Bot Dashboard & Campaign Manager
├── login.html                 # Secure Authentication Portal
├── landing.html               # Public Marketing Portal
└── telebot.db                 # Primary SQLite WAL Database (Single Source of Truth)
```

---

## 🛡️ Security Hardening Features

1. **Linux File Permission Guard (`chmod 0o600`):**
   - Automatically executed on server startup for `telebot.db*` and `secret.key`.
   - Prevents unauthorized access or inspection by other local Linux users or processes.

2. **IP Brute-Force Rate Limiter:**
   - Active on `/login` and `/api/login`.
   - Automatically locks out client IPs after 5 consecutive failed login attempts for 15 minutes.
   - Clears lockouts automatically upon successful authentication.

3. **100% Pure SQLite WAL Mode:**
   - Eliminates synchronous disk I/O bottlenecks.
   - Immediate atomic transactions with zero-blocking background snapshot backups.
   - 100% corruption-proof across unexpected server reboots or power outages.

---

## ⚡ VPS Quick Start & Updates

### 1. Update from GitHub:
```bash
cd ~/Ready-telebot-Google-ai-studio-v4
git pull origin main
npm install
pm2 restart all
pm2 status
```

### 2. Take a 1-Click Backup:
```bash
node backup_data.js
```
*Creates an encrypted timestamped archive in `backups/telebot_backup_YYYYMMDD_HHMMSS.tar.gz`.*

---

## 📜 Tech Stack
- **Runtime:** Node.js (ESM NodeNext) / Bun compatible
- **Database:** SQLite (Native `node:sqlite` WAL Mode)
- **Telegram MTProto:** Official GramJS (`telegram` npm)
- **AI Engine:** Google GenAI SDK (`@google/genai`), Groq, DeepSeek
- **Real-Time Updates:** Server-Sent Events (SSE) & WebSockets
