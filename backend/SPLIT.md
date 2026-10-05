# Server split

The original `server.ts` (781890 bytes) is split into 52 ordered files in `src/modules/`. No logic was changed. `npm run verify` rebuilds `server.build.ts` and checks it is byte-identical to the original (SHA-256 `48946b432509486bd5b4e8a2fe1e6d63a353734f73167192ffad2a3cf23b6083`).

## Run on the VPS
1. Copy the whole `backend/` folder into the live bot folder (keep your runtime data files: users.json, accounts.json, secret.key, sessions, telebot.db).
2. `npm install`, then `npm run verify`.
3. `npm start` (assembles and runs with the same flags as before).
4. Rollback: run your old `server.ts` start command.

## Editing
Edit a section file, then `npm start`. Order is defined in `modules.manifest.json`.

| File | Section | Original lines |
|---|---|---|
| `01-bootstrap-imports.ts` | bootstrap-imports | 1-36 |
| `02-sqlite-corruption-proof-database-engine.ts` | SQLITE CORRUPTION-PROOF DATABASE ENGINE (WAL MODE) | 37-39 |
| `03-security-hardening-suite.ts` | SECURITY HARDENING SUITE | 40-51 |
| `04-theme-master-proxy-services.ts` | THEME & MASTER PROXY SERVICES | 52-62 |
| `05-non-blocking-debounced-async-file-writer.ts` | NON-BLOCKING DEBOUNCED ASYNC FILE WRITER | 63-280 |
| `06-state.ts` | STATE | 281-327 |
| `07-telegram-api-rate-health-monitor-telemetry.ts` | TELEGRAM API RATE & HEALTH MONITOR TELEMETRY | 328-468 |
| `08-security.ts` | SECURITY (HASHING) | 469-480 |
| `09-user-system.ts` | USER SYSTEM | 481-544 |
| `10-user-access-onboarding-requests.ts` | USER ACCESS & ONBOARDING REQUESTS | 545-937 |
| `11-live-bot-daily-accrual-billing-engine.ts` | LIVE BOT & DAILY ACCRUAL BILLING ENGINE | 938-1535 |
| `12-global-api-key-pool.ts` | GLOBAL API KEY POOL (UNLIMITED SLOTS) | 1536-1653 |
| `13-account-helpers.ts` | ACCOUNT HELPERS | 1654-2365 |
| `14-two-queue-distributed-processing-architecture.ts` | TWO-QUEUE DISTRIBUTED PROCESSING ARCHITECTURE | 2366-2703 |
| `15-1-raw-staging-queue.ts` | 1. RAW / STAGING QUEUE (From Scanners) | 2704-2878 |
| `16-2-verified-genuine-queue.ts` | 2. VERIFIED / GENUINE QUEUE (Per-Account / Phone Architecture) | 2879-3433 |
| `17-daily-dm-history-tracking.ts` | DAILY DM HISTORY TRACKING (LAST 5 DAYS PER USER) | 3434-3528 |
| `18-daily-join-request-history-tracked-invite-links.ts` | DAILY JOIN REQUEST HISTORY & TRACKED INVITE LINKS | 3529-4101 |
| `19-midnight-12-00-am-expiry-automations.ts` | MIDNIGHT 12:00 AM & EXPIRY AUTOMATIONS | 4102-4511 |
| `20-auto-delete-personal-chats-older-than-1-day.ts` | AUTO-DELETE PERSONAL CHATS OLDER THAN 1 DAY (24 HOURS) | 4512-4908 |
| `21-server-sent-events-engine.ts` | SERVER-SENT EVENTS (SSE) ENGINE | 4909-5011 |
| `22-contact-lock-helper.ts` | CONTACT LOCK HELPER | 5012-5128 |
| `23-expired-hash-auto-recovery-helper.ts` | EXPIRED HASH AUTO-RECOVERY HELPER | 5129-5218 |
| `24-peer-resolution-forcing-helper.ts` | PEER RESOLUTION & FORCING HELPER | 5219-5421 |
| `25-live-stream-peer-healing-refresh-helper.ts` | LIVE STREAM PEER HEALING & REFRESH HELPER | 5422-7917 |
| `26-app-setup.ts` | APP SETUP | 7918-8073 |
| `27-token-session-utils.ts` | TOKEN & SESSION UTILS | 8074-8266 |
| `28-routes.ts` | ROUTES | 8267-8482 |
| `29-telegram-mini-app-hmac-sha256-verification.ts` | TELEGRAM MINI APP (TMA) HMAC-SHA256 VERIFICATION | 8483-8534 |
| `30-telegram-mini-app-auto-authentication.ts` | TELEGRAM MINI APP (TMA) AUTO-AUTHENTICATION | 8535-8689 |
| `31-dashboard-apis.ts` | DASHBOARD APIS | 8690-10418 |
| `32-user-bulk-actions.ts` | USER BULK ACTIONS (All Start, All Stop, All DM, All Live) | 10419-10544 |
| `33-admin-global-bulk-actions.ts` | ADMIN GLOBAL BULK ACTIONS | 10545-10684 |
| `34-forgot-password.ts` | FORGOT PASSWORD | 10685-10718 |
| `35-bulk-bot-generator-vault-engine.ts` | BULK BOT GENERATOR & VAULT ENGINE | 10719-11141 |
| `36-admin-panel-apis.ts` | ADMIN PANEL APIS | 11142-11375 |
| `37-channel-bot-reactions-engine.ts` | CHANNEL BOT REACTIONS ENGINE | 11376-12497 |
| `38-join-request-tracker-admin-controls.ts` | JOIN REQUEST TRACKER ADMIN CONTROLS | 12498-12522 |
| `39-residential-proxy-gateway-admin-endpoints.ts` | RESIDENTIAL PROXY GATEWAY ADMIN ENDPOINTS | 12523-13434 |
| `40-admin-account-slot-approval-management.ts` | ADMIN ACCOUNT SLOT & APPROVAL MANAGEMENT | 13435-13530 |
| `41-admin-customer-access-onboarding-requests.ts` | ADMIN CUSTOMER ACCESS / ONBOARDING REQUESTS | 13531-13851 |
| `42-admin-queue-management-apis.ts` | ADMIN QUEUE MANAGEMENT APIS | 13852-14395 |
| `43-smart-khatabook-billing-rest-api.ts` | SMART KHATABOOK & BILLING REST API | 14396-14397 |
| `44-demo-user-management-api.ts` | DEMO USER MANAGEMENT API | 14398-14757 |
| `45-overdue-freeze-manual-pause-control.ts` | OVERDUE FREEZE & MANUAL PAUSE CONTROL | 14758-15469 |
| `46-admin-telegram-api-rate-health-monitor.ts` | ADMIN TELEGRAM API RATE & HEALTH MONITOR | 15470-15586 |
| `47-global-api-pool-admin-endpoints.ts` | GLOBAL API POOL (UNLIMITED KEYS) ADMIN ENDPOINTS | 15587-15707 |
| `48-universal-ai-settings-provider-switching-endpoints.ts` | UNIVERSAL AI SETTINGS & PROVIDER SWITCHING ENDPOINTS | 15708-16359 |
| `49-telegram-interactive-bot-engine.ts` | TELEGRAM INTERACTIVE BOT ENGINE (USER & ADMIN) | 16360-16884 |
| `50-telegram-customer-bill-billing-statement.ts` | TELEGRAM CUSTOMER /bill & BILLING STATEMENT | 16885-16980 |
| `51-telegram-customer-onboarding-bot-flow.ts` | TELEGRAM CUSTOMER ONBOARDING BOT FLOW | 16981-19386 |
| `52-start-server.ts` | START SERVER | 19387-19431 |
