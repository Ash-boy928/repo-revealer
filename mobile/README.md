# mobile/ — Phase 1: phone-ready bot bundle

Runs the **unchanged** bot (`backend/`) on an Android phone instead of the VPS.
Nothing in `backend/` is edited.

## Build
```bash
node mobile/build.mjs      # output: mobile/dist/
```
Steps: assemble + byte-verify the original server, convert each TypeScript
file to plain JS one by one (same as `tsx` on the VPS, no merging), install
production packages, copy UI/PWA files.

## Run (phone or PC test)
```bash
cd mobile/dist
LEO_DATA_DIR=/path/to/private/dir PORT=3000 node main.mjs
```
- First run copies the bot into `LEO_DATA_DIR`; the database, `session_*.txt`
  and JSON state live there. Updates replace code only, never user data.
- `preload.mjs` makes the server listen on `127.0.0.1` only, so other devices
  on the same WiFi cannot open the dashboard.

## Verified (sandbox, Node 22)
- Dashboard answers on `127.0.0.1:3000`; WiFi/LAN address refused.
- SQLite database, keys and state files created inside `LEO_DATA_DIR`.

## Notes for Phase 2 (Android app)
- The bot uses built-in `node:sqlite`, which needs Node 22.5+. The Android
  runtime must ship Node 22+, or the bot falls back to its own JSON storage.
- Phase 2: Android shell starts `node main.mjs` inside a foreground service
  and shows `http://127.0.0.1:3000` in a WebView.
