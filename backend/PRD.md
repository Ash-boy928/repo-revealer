# 📋 Product Requirement Document (PRD)
# 🦁 Leo TeleGm Bot — Multi-Account Telegram Live Monitor & DM Automation Suite (SaaS)

---

## 1. Executive Summary & Product Overview
**Leo TeleGm Bot** is an enterprise-grade, multi-tenant SaaS application built with **Node.js, TypeScript, Express, and GramJS (Telegram MTProto API)**. 

The platform automates lead discovery, live participant scraping, anti-ban direct messaging (DM), and proxy rotation across multiple Telegram accounts simultaneously. It allows digital marketers, community builders, and SaaS administrators to capture active group call/stream audiences in real-time, filter verified genuine leads, and conduct targeted outbound promotional campaigns with automated `@SpamBot` health monitoring and multi-tenant administrative control.

---

## 2. Target Audience & Roles
1. **Super Admin (Platform Owner)**:
   - Full control over SaaS clients, licensing, account limits, and plan expiration dates.
   - Manual lead queue transfer between client accounts.
   - Automated midnight lead reclamation (sweeping all uncontacted leads across users into the Admin Master Queue at 00:00 IST).
   - Real-time Master Telegram Bot integration for mobile supervision.
2. **Subscribed Panel User (Marketer / Promoter)**:
   - Connects and manages multiple Telegram accounts using official MTProto credentials.
   - Customizes promotional messages, channel links, and dispatch intervals.
   - Toggles Live Stream Monitoring and automated DM dispatch independently.
   - Views live logs and performance statistics.

---

## 3. System Architecture & Tech Stack

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND PRESENTATION                           │
│  • dashboard.html (User Console - 2-Column Responsive Layout)          │
│  • admin.html (Super Admin Control Center)                            │
│  • login.html (Session Auth & Password Recovery via Security Question) │
│  • prd.html (Downloadable PRD Document Viewer)                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / REST APIs / SSE Stream
┌───────────────────────────────────▼────────────────────────────────────┐
│                        NODE.JS / EXPRESS BACKEND                       │
│  • Session Authentication & Role-Based Access Control (RBAC)           │
│  • GramJS Telegram MTProto Protocol Engine                            │
│  • Two-Tier Lead Qualification Pipeline (Raw -> Genuine Queue)         │
│  • SpamBot 5-Tier Auto-Cooldown & Health Monitor                       │
│  • Midnight Lead Reclamation Scheduler (00:00 Auto-Transfer)          │
│  • Anti-Ban DM Dispatcher (Delays, Spintax, Message Rotation)          │
│  • Proxy Handler (Direct, SOCKS5, MTProxy)                             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ File Storage & State Cache
┌───────────────────────────────────▼────────────────────────────────────┐
│                       PERSISTENCE & SECURITY                           │
│  • StringSessions / .session Files (Persistent Telegram Auth)          │
│  • accounts.json, users.json, configs.json, queues.json                │
│  • Telegram Bot API Outbound Webhooks (Urgent Admin/User Alerts)       │
└────────────────────────────────────────────────────────────────────────┘
```

- **Backend Runtime**: Node.js (TypeScript / Native ESM).
- **Telegram MTProto Engine**: `telegram` (GramJS MTProto API library).
- **Web Server**: Express.js with `express-session` and Server-Sent Events (SSE) for log streaming.
- **Frontend Architecture**: Modern responsive HTML5, CSS Grid (Desktop 2-Column + Mobile Fluid), Vanilla JavaScript.
- **Standard Timezone**: Indian Standard Time (IST — UTC+5:30).

---

## 4. Detailed Feature Specifications

### 4.1. Multi-Account Telegram Lifecycle Management
- **Official MTProto Login**:
  - Connects accounts using `Account Name / Label`, `Phone Number (+91...)`, `API ID`, and `API Hash`.
  - Supports Telegram official OTP and 2FA Cloud Password.
- **Account Controls**:
  - `START BOT`: Boots GramJS MTProto client, starts live stream listener, and activates DM loop.
  - `STOP BOT`: Gracefully disconnects socket and cleans up listeners.
  - `DELETE ACCOUNT`: Removes session credentials and storage cleanly.
  - `CHECK SPAMBOT`: Instant one-click diagnostic test with Telegram's `@SpamBot`.
- **Identity Display**:
  - Every account is prominently displayed by its custom Name/Label across all Admin and User tables.

### 4.2. Live Stream Voice Chat Lead Capture Engine
- **Target Channels & Groups**: Monitors live group voice chats and video calls.
- **Ignore / Non-Target Blacklist**: Specific channel links can be blacklisted so the bot completely ignores them.
- **Two-Tier Qualification Queue**:
  1. **Raw Staging Queue (`raw_queue`)**: Newly captured participant IDs.
  2. **Genuine Verified Queue (`verified_queue`)**: Filtered genuine active users (excluding bots, deleted accounts, and duplicate contacts).

### 4.3. Anti-Ban DM Automation & Dispatcher
- **Independent Automation Modes**:
  - 🔴 **Live Monitor Toggle (`live_on`)**: Controls live stream voice chat listener.
  - ✉️ **DM Sender Toggle (`dm_on`)**: Controls outbound promotional DM dispatch.
- **Message Rotation & Spintax**:
  - 3 customizable message templates (`Message 1`, `Message 2`, `Message 3`).
  - `{CHANNEL_LINK}` tag is automatically substituted with the user's target channel link.
  - Random template selection per recipient to prevent spam hash detection.
- **Configurable Intervals & Daily Limits**:
  - Configurable delays between DMs (e.g. 60s to 120s).
  - Daily sent quota tracking with midnight reset.

### 4.4. SpamBot Auto-Health Check & 5-Attempt Cooldown Loop
- Periodically checks account health with official `@SpamBot`.
- If restricted, initiates an auto-cooldown routine with up to 5 retries.
- If restriction persists:
  - Automatically disables DM Sender (`dm_on = false`) to protect account safety.
  - Keeps Live Monitor (`live_on = true`) active for continuous lead collection.
  - Dispatches alert webhook to Telegram.

### 4.5. Proxy Chaining & IP Security
- Supports **Direct Connection**, **SOCKS5**, and **MTProxy**.
- Configurable per individual account: `IP / Host`, `Port`, `Username`, `Password`, `MTProxy Secret`.

### 4.6. Super Admin Control Center & Multi-Tenant SaaS
- **User Licensing & Validity**:
  - Super Admin sets `expiry_date` or lifetime access.
  - Expired accounts are automatically disabled and blocked from login.
- **Manual Lead Transfer**:
  - Super Admin can transfer genuine leads from User A to User B.
- **Midnight Lead Reclamation Cron**:
  - Daily at 00:00 (12:00 AM IST), all uncontacted leads in client queues are automatically transferred to the Super Admin master queue.
- **View-As User Dashboard**:
  - 1-click admin view into any client user's live dashboard.

### 4.7. Security, Auth & Telegram Webhook Alerts
- Password recovery via Security Questions and Answers.
- Instant Telegram alerts for account restrictions, OTP requests, and subscription expiry.

---

## 5. API Endpoints Reference

| Endpoint | Method | Role | Description |
|---|---|---|---|
| `/api/login` | POST | Public | Authenticates user/admin session |
| `/api/accounts` | GET | User/Admin | Lists user's Telegram accounts & daily stats |
| `/api/account/add` | POST | User/Admin | Connects new account & requests OTP |
| `/api/account/verify-otp` | POST | User/Admin | Submits numeric OTP code |
| `/api/account/verify-2fa` | POST | User/Admin | Submits 2FA Cloud Password |
| `/api/account/start` | POST | User/Admin | Starts bot live listener & DM loop |
| `/api/account/stop` | POST | User/Admin | Stops bot instance |
| `/api/account/spambot-check` | POST | User/Admin | Runs `@SpamBot` diagnosis |
| `/api/account/config` | GET/POST | User/Admin | Gets/sets promotion messages & intervals |
| `/api/account/proxy` | GET/POST | User/Admin | Gets/sets proxy configuration |
| `/api/logs/stream` | GET (SSE) | User/Admin | Real-time live log stream |
| `/api/admin/users` | GET | Admin | Lists all platform users, accounts & metrics |
| `/api/admin/user/create` | POST | Admin | Creates SaaS user with quota & expiry |
| `/api/admin/user/update` | POST | Admin | Updates password, expiry, status, limits |
| `/api/admin/queue/transfer` | POST | Admin | Transfers genuine leads between users |
| `/api/admin/view-as` | POST | Admin | Switches session to view user dashboard |

---

## 6. Document Metadata
- **Product Name**: Leo TeleGm Bot
- **Version**: 2.5.0 Enterprise SaaS
- **Author / Designer**: Ash_King
- **Release Date**: September 2026
