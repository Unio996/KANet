# Gate D — External-Onboarding Reverse-Proxy Allowlist (DRAFT)

**Status**: DRAFT for Owner deploy-topology decision. By KANet-UI-tn 2026-06-15 (DoD gate D, Bettor r636).
**Why**: gate D (external agent self-onboard) is **code-complete + working**:
- ✅ Faucet 领币 works: `POST /api/faucet/request {wallet_address}` → 5 testnet KAS on-chain (verified txid `426220a6…` landed).
- ✅ Onboard wizard built: `onboard.eta` (5-step kaspa-wasm quickstart + faucet widget + live external-offer board).
- ✅ Console proxy-ready: `index.js:102 trustProxy:'127.0.0.1'` so `request.ip` resolves to the real client behind a proxy (faucet per-IP/per-address limiting works).

The **only remaining gate-D blocker is OPS, not code**: the Console is `localhost`-bound by design (`CONSOLE_URL=http://localhost:PORT`). External agents cannot reach the faucet/onboard until it is exposed — and it must NOT be exposed raw.

## ⚠ HARD RED LINE (gap-A, from `project-external-agent-onboarding-recon`)

**NEVER bind `HOST=0.0.0.0` on the Console directly.** ~550 routes are registered; the majority are no-auth and several are catastrophic if reached by the public:
- `POST /api/system/run` (broker.js:309) — **arbitrary command execution (RCE)**.
- `POST /api/test/*` (conversations.js: `reset_peer`, `force_state_expire`, `inject-send-kas-mock`, `inject-llm-mock`, `trigger-refund-sweep`, …) — state-tamper / mock-injection.
- `POST /api/pool/market/create`, `/api/pool/market/create-v07` — externals could spam-create / lock funds.
- `POST /api/relay/:id/send-command` — relay custody control (transfer, sign, …).
- `POST /api/chat/send`, `/api/tg-bot/*`, all admin/UI mutation routes.

→ Public exposure MUST go through a reverse proxy with a **default-DENY allowlist** that passes ONLY the routes a brand-new external agent legitimately needs.

## Allowlist (the ONLY routes the proxy forwards)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/onboard` | onboard wizard page | the entry page |
| GET | `/faucet` | faucet page | |
| POST | `/api/faucet/request` | claim 5 testnet KAS | **rate-limit at proxy** (per-IP, e.g. 3/hour) in addition to the app's once-per-address — a public faucet is a drain target |
| GET | `/api/exchange/offers` | live offer board (read-only) | query-string allowed; no mutation |
| GET | `/assets/*`, `/public/*`, css/js | static | read-only static only |

**Everything else → 403 (default deny).** No `/api/system/*`, no `/api/test/*`, no `/api/relay/*`, no `/api/pool/*` mutation, no `/api/chat/*`, no `/api/tg-bot/*`.

## Sample config (nginx sketch — Owner picks the real proxy/host)

```nginx
# default-deny: only the allowlisted locations proxy_pass; all else 403.
server {
  listen 443 ssl;            # TLS terminates here; Console stays 127.0.0.1
  server_name onboard.kanet.example;

  # faucet — tight per-IP rate limit on top of app's once-per-address
  limit_req_zone $binary_remote_addr zone=faucet:10m rate=3r/m;

  location = /onboard            { proxy_pass http://127.0.0.1:3200; }
  location = /faucet             { proxy_pass http://127.0.0.1:3200; }
  location = /api/faucet/request { limit_req zone=faucet burst=2 nodelay; proxy_pass http://127.0.0.1:3200; }
  location = /api/exchange/offers{ proxy_pass http://127.0.0.1:3200; }   # GET only — see below
  location ^~ /assets/           { proxy_pass http://127.0.0.1:3200; }

  # method guard: offers is read-only
  if ($request_method !~ ^(GET|HEAD)$) { return 403; }   # apply within the offers location

  location / { return 403; }     # DEFAULT DENY — everything not listed above
}
```

(Caddy/Traefik equivalent fine; the invariant is **default-deny + explicit allowlist + faucet rate-limit + TLS + Console stays 127.0.0.1**.)

## Open items for Owner
1. **Host/topology**: which box runs the proxy, what public DNS/TLS cert.
2. **Offer board endpoint**: confirm `GET /api/exchange/offers` is the canonical read the onboard board uses (it is, per onboard.eta:197/236) and that it leaks nothing private.
3. **Faucet drain budget**: per-IP rate + total daily cap; FaucetRelay-tn-2 balance monitoring.
4. Whether to expose a read-only prediction-markets list (`GET /api/pool/markets`) too, or keep onboarding scoped to exchange offers for v1.

Code side is done; this is the ops gate. — KANet-UI-tn
