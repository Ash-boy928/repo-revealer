# LeoTeleBot Backend - Modular Split

The original `server.ts` (~800 KB, 19,980 lines) is split into 51 ordered section files in `src/modules/`.
**No logic was changed.** Rebuilding the sections gives a file byte-for-byte identical to the original (SHA-256 `b903f5d2378efe3ff38afcb86d8aefb5dee8431464683cae648bd010a302eaab`).

## Deploy on the VPS
1. Copy `src/`, `scripts/`, `manifest.json`, and `package.json` into the live bot folder, next to `admin.html` and `dashboard.html`.
2. Run `npm run verify` to confirm the rebuild matches the original exactly.
3. Run `npm start`. This assembles `server.build.ts` in the same folder and runs it with the same flags as before.
4. Rollback: run the old `npx tsx ... server.ts` command. The original file is never touched.

## Editing
Edit the section file you need, then run `npm start`. The modules stay in the order listed in `manifest.json`.

| File | Section | Original lines |
|---|---|---|
| `01-bootstrap-imports.ts` | bootstrap-imports | 1-53 |
| `02-sqlite-corruption-proof-database-engine.ts` | SQLITE CORRUPTION-PROOF DATABASE ENGINE (WAL MODE) | 54-254 |
| `03-non-blocking-debounced-async-file-writer.ts` | NON-BLOCKING DEBOUNCED ASYNC FILE WRITER | 255-298 |
| `04-universal-ai-engine-switching-architecture.ts` | UNIVERSAL AI ENGINE & SWITCHING ARCHITECTURE | 299-842 |
| `05-state.ts` | STATE | 843-889 |
| `06-telegram-api-rate-health-monitor-telemetry.ts` | TELEGRAM API RATE & HEALTH MONITOR TELEMETRY | 890-1030 |
| `07-security.ts` | SECURITY (HASHING) | 1031-1042 |
| `08-user-system.ts` | USER SYSTEM | 1043-1105 |
| `09-user-access-onboarding-requests.ts` | USER ACCESS & ONBOARDING REQUESTS | 1106-1499 |
| `10-live-bot-daily-accrual-billing-engine.ts` | LIVE BOT & DAILY ACCRUAL BILLING ENGINE | 1500-2097 |
| `11-global-api-key-pool.ts` | GLOBAL API KEY POOL (UNLIMITED SLOTS) | 2098-2215 |
| `12-account-helpers.ts` | ACCOUNT HELPERS | 2216-2927 |
| `13-two-queue-distributed-processing-architecture.ts` | TWO-QUEUE DISTRIBUTED PROCESSING ARCHITECTURE | 2928-3265 |
| `14-1-raw-staging-queue.ts` | 1. RAW / STAGING QUEUE (From Scanners) | 3266-3440 |
| `15-2-verified-genuine-queue.ts` | 2. VERIFIED / GENUINE QUEUE (Per-Account / Phone Architecture) | 3441-3995 |
| `16-daily-dm-history-tracking.ts` | DAILY DM HISTORY TRACKING (LAST 5 DAYS PER USER) | 3996-4090 |
| `17-daily-join-request-history-tracked-invite-links.ts` | DAILY JOIN REQUEST HISTORY & TRACKED INVITE LINKS | 4091-4663 |
| `18-midnight-12-00-am-expiry-automations.ts` | MIDNIGHT 12:00 AM & EXPIRY AUTOMATIONS | 4664-5073 |
| `19-auto-delete-personal-chats-older-than-1-day.ts` | AUTO-DELETE PERSONAL CHATS OLDER THAN 1 DAY (24 HOURS) | 5074-5470 |
| `20-server-sent-events-engine.ts` | SERVER-SENT EVENTS (SSE) ENGINE | 5471-5573 |
| `21-contact-lock-helper.ts` | CONTACT LOCK HELPER | 5574-5690 |
| `22-expired-hash-auto-recovery-helper.ts` | EXPIRED HASH AUTO-RECOVERY HELPER | 5691-5780 |
| `23-peer-resolution-forcing-helper.ts` | PEER RESOLUTION & FORCING HELPER | 5781-5983 |
| `24-live-stream-peer-healing-refresh-helper.ts` | LIVE STREAM PEER HEALING & REFRESH HELPER | 5984-8479 |
| `25-app-setup.ts` | APP SETUP | 8480-8635 |
| `26-token-session-utils.ts` | TOKEN & SESSION UTILS | 8636-8828 |
| `27-routes.ts` | ROUTES | 8829-9038 |
| `28-telegram-mini-app-hmac-sha256-verification.ts` | TELEGRAM MINI APP (TMA) HMAC-SHA256 VERIFICATION | 9039-9090 |
| `29-telegram-mini-app-auto-authentication.ts` | TELEGRAM MINI APP (TMA) AUTO-AUTHENTICATION | 9091-9245 |
| `30-dashboard-apis.ts` | DASHBOARD APIS | 9246-10974 |
| `31-user-bulk-actions.ts` | USER BULK ACTIONS (All Start, All Stop, All DM, All Live) | 10975-11100 |
| `32-admin-global-bulk-actions.ts` | ADMIN GLOBAL BULK ACTIONS | 11101-11240 |
| `33-forgot-password.ts` | FORGOT PASSWORD | 11241-11274 |
| `34-bulk-bot-generator-vault-engine.ts` | BULK BOT GENERATOR & VAULT ENGINE | 11275-11697 |
| `35-admin-panel-apis.ts` | ADMIN PANEL APIS | 11698-11931 |
| `36-channel-bot-reactions-engine.ts` | CHANNEL BOT REACTIONS ENGINE | 11932-13053 |
| `37-join-request-tracker-admin-controls.ts` | JOIN REQUEST TRACKER ADMIN CONTROLS | 13054-13078 |
| `38-residential-proxy-gateway-admin-endpoints.ts` | RESIDENTIAL PROXY GATEWAY ADMIN ENDPOINTS | 13079-13990 |
| `39-admin-account-slot-approval-management.ts` | ADMIN ACCOUNT SLOT & APPROVAL MANAGEMENT | 13991-14086 |
| `40-admin-customer-access-onboarding-requests.ts` | ADMIN CUSTOMER ACCESS / ONBOARDING REQUESTS | 14087-14407 |
| `41-admin-queue-management-apis.ts` | ADMIN QUEUE MANAGEMENT APIS | 14408-14951 |
| `42-smart-khatabook-billing-rest-api.ts` | SMART KHATABOOK & BILLING REST API | 14952-14953 |
| `43-demo-user-management-api.ts` | DEMO USER MANAGEMENT API | 14954-15313 |
| `44-overdue-freeze-manual-pause-control.ts` | OVERDUE FREEZE & MANUAL PAUSE CONTROL | 15314-16019 |
| `45-admin-telegram-api-rate-health-monitor.ts` | ADMIN TELEGRAM API RATE & HEALTH MONITOR | 16020-16136 |
| `46-global-api-pool-admin-endpoints.ts` | GLOBAL API POOL (UNLIMITED KEYS) ADMIN ENDPOINTS | 16137-16257 |
| `47-universal-ai-settings-provider-switching-endpoints.ts` | UNIVERSAL AI SETTINGS & PROVIDER SWITCHING ENDPOINTS | 16258-16909 |
| `48-telegram-interactive-bot-engine.ts` | TELEGRAM INTERACTIVE BOT ENGINE (USER & ADMIN) | 16910-17434 |
| `49-telegram-customer-bill-billing-statement.ts` | TELEGRAM CUSTOMER /bill & BILLING STATEMENT | 17435-17530 |
| `50-telegram-customer-onboarding-bot-flow.ts` | TELEGRAM CUSTOMER ONBOARDING BOT FLOW | 17531-19936 |
| `51-start-server.ts` | START SERVER | 19937-19981 |
