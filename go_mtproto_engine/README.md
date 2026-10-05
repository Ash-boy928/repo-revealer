# Go MTProto Engine — Phase 1 POC

Isolated prototype. Does **not** touch `backend/` or the live VPS bot.

What it does (single account):
1. Loads an existing **GramJS StringSession** (no OTP re-login).
2. Connects through optional **SOCKS5 proxy**.
3. Health check (`Self`).
4. Optional **one test DM** with jitter + FLOOD_WAIT handling.
5. Prints **RAM usage** (start / connected / after-dm / idle).

## Run
```bash
cd go_mtproto_engine
go mod tidy
go run ./cmd/poc -api-id 12345 -api-hash abc... \
  -session "1BVts..." \
  -proxy "socks5://user:pass@host:port" \
  -to your_test_username -text "test"
```
Use only your own test account and recipient. Stop the same account on the Node bot
while testing, so the same session is not used from 2 places at once.

## Not yet (later phases)
Multi-account pool, raw/verified queues, Dynamic DM templates port, local API,
mobile binding (gomobile) and new mobile app.
