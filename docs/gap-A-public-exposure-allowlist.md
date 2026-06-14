# gap-A — Public-Testnet Exposure Perimeter (default-deny allowlist)

**Owner:** KANet-UI · **Red-team external verify:** J1 · **Security co-review:** NWT
**Status:** DRAFT v1 (route audit + allowlist spec) — awaiting Bettor + Owner review
**Date:** 2026-06-14

## 1. Why this is the public-test critical path

The Console binds `127.0.0.1` (`kasia-console/src/index.js`: `host: process.env.HOST || '127.0.0.1'`).
Opening the testnet to outside users requires exposing *something* — but the Console serves
**573 routes, the vast majority unauthenticated**, including remote-code-execution and key/fund
operations. **Bare `HOST=0.0.0.0` is forbidden** — it would publish all 573 routes to the internet.

The fix is **not** to auth-gate 573 routes (infeasible, error-prone). It is a **reverse proxy in
front of :3200 with a default-deny allowlist**: only a tiny set of safe read-only routes + the
faucet are reachable; everything else returns 403 at the proxy, never touching the Console.

## 2. Route audit (ground-truth, 2026-06-14)

`573` total routes — `310` GET, `224` POST, `20` DELETE, `18` PUT, `1` PATCH.
**263 are writes.** Default posture for ALL 573 = **DENY**. Representative high-risk (must never be exposed):

- **RCE / operator:** `POST /api/system/run` (broker.js — arbitrary command), `POST /api/relay/:id/restart`, `POST /adapters/:id/start|stop|restart|delete`, `POST /api/agent/create-adapter`
- **Funds / keys:** `POST /api/relay/:id/transfer`, `POST /api/oracle-pool/enroll`, `POST /api/prediction/taker-stake/:offer_id`, `POST /api/relay/:id/broker-fee`, all relay sign/privkey/command IPC
- **Data / config:** `POST /api/chat/ingest`, `POST /adapter/config`, `/api/settings*`, all DELETE routes, DB-mutating POSTs
- **Internal reads** (310 GET) are also denied by default — only the ~7 below are opened.

## 3. Allowlist spec (the ONLY routes the proxy forwards)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/pool/markets` | list prediction markets | read-only, parameterized |
| GET | `/api/pool/market/:id` | single market | read-only |
| GET | `/api/exchange/offers` | list OTC offers | read-only |
| GET | `/api/exchange/offers/:id` | single offer | read-only |
| GET | `/api/exchange/peer-reputation` | reputation (public by design) | read-only |
| GET | `/api/predictions/markets` | predictions list | read-only |
| POST | `/api/faucet/request` | dispense dev-channel test KAS | **the only exposed write — see §3.1** |

Everything not in this table → **403 at proxy**. (`GET /faucet` UI page optional — serve a static
read-only landing instead of the Console route, to avoid pulling in Console assets/JS.)

### 3.1 Faucet hardening (the one exposed write)
The faucet (`POST /api/faucet/request`, chat.js:583) dispenses real test KAS → drainable.
**Existing app-level controls (good):** permanent per-wallet 1-grant (`faucet_grants.wallet_address`
→ 429) + per-IP 24h×3 (`ip_address` count) + `FAUCET_AMOUNT_KAS=5`/grant + wallet-format validation.

**🔴 CRITICAL proxy-interaction bug (found 2026-06-14, must fix before exposure):**
chat.js:585 `const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown'`. `request.ip`
is the **socket IP** = `127.0.0.1` (the proxy) for ALL external requests once behind the proxy — and
it's truthy, so the `||` never reaches X-Forwarded-For. **The per-IP limit collapses**: every external
user shares the `127.0.0.1` bucket → 3 grants total for the whole internet (or, read another way, no
real per-user limit). The permanent per-wallet limit still holds, but wallets are free to generate.
- **FIX:** enable fastify `trustProxy` scoped to the proxy IP (`{ trustProxy: '127.0.0.1' }`) so
  `request.ip` resolves to the real client from X-Forwarded-For **only when the hop is the trusted
  proxy** (prevents spoofing). Then the per-IP 24h×3 works against real client IPs.
- The proxy MUST set `X-Forwarded-For` (Caddy/nginx default) and the Console must NOT trust it from
  any non-proxy source (scoped trustProxy handles this; never `trustProxy: true` unscoped).

**Remaining hard requirements before go-live:** (a) proxy-level rate limit as defense-in-depth
(§5, 1 req/10min/IP); (b) request-body size limit (4KB, §5); (c) faucet relay balance alarm
(reuse oracle-voter-health events pattern). **Action items — fix the trustProxy bug + add (a)-(c).**

## 4. Architecture

```
internet ──▶ reverse proxy (public iface :443/:8080)
                 │  default-deny; only §3 allowlist forwarded
                 ▼
            Console 127.0.0.1:3200  (UNCHANGED — stays localhost-bound)
```

Console keeps `HOST=127.0.0.1` (never changed). The proxy is the only thing on the public interface.
Reverse proxy runs **on :3200's host** (faucet/exchange/Console all live there = KANet-UI operator domain).

## 5. Reverse-proxy config (Caddy — default-deny)

```caddy
:8080 {
    @safe_reads {
        method GET
        path /api/pool/markets /api/pool/market/* /api/exchange/offers /api/exchange/offers/* /api/exchange/peer-reputation /api/predictions/markets
    }
    @faucet {
        method POST
        path /api/faucet/request
    }
    handle @safe_reads {
        rate_limit { zone reads { key {remote_host} events 100 window 1m } }   # J1 #381 hole-1: :3200 is single-instance → cap read flood
        reverse_proxy 127.0.0.1:3200
    }
    handle @faucet {
        rate_limit { zone faucet { key {remote_host} events 1 window 10m } }   # caddy-ratelimit plugin (mholt/caddy-ratelimit)
        request_body { max_size 4KB }
        reverse_proxy 127.0.0.1:3200
    }
    handle { respond 403 }   # DEFAULT-DENY everything else
}
```
(nginx equivalent: `location`-allowlist + two `limit_req` zones + `return 403` default — v3 if nginx chosen.)
caddy-ratelimit = third-party plugin (`mholt/caddy-ratelimit`) — build Caddy with `xcaddy build --with github.com/mholt/caddy-ratelimit`. **Confirm availability for the deploy (checklist #7).**

## 6. Exposure test (J1 red-team, builder≠verifier)

After deploy, J1 curls from an external position:
- **Expect 200/expected:** each §3 allowlist route.
- **Expect 403:** `POST /api/system/run`, `POST /api/relay/<id>/transfer`, `POST /api/oracle-pool/enroll`,
  `POST /adapters/...`, `POST /api/chat/ingest`, `/api/settings`, a sample of random internal GETs.
- **Faucet abuse:** rapid repeat → rate-limited after 1.
- Red/green report → no high-risk route reachable = perimeter holds.

## 8. Go-live hardening checklist (consolidated 3-layer review: Bettor + NWT + J1 red-team)

**All must be closed before the proxy is deployed.**

| # | Item | Status | Owner |
|---|---|---|---|
| 1 | faucet per-address cap | ✅ already exists (permanent per-wallet 1-grant, stronger than per-day) | — |
| 2 | faucet per-IP collapses behind proxy → `trustProxy:'127.0.0.1'` | ✅ **fixed** (index.js:97) | KANet-UI |
| 3 | safe_reads (6 GET) no rate-limit → DoS single :3200 | ✅ **fixed in config** (§5, 100/min/IP) | KANet-UI |
| 4a | GET /api/exchange/offers had `expireStale()` WRITE side-effect (DoS write-amp) | ✅ **fixed** (removed; cron index.js:212 handles expiry) | KANet-UI |
| 4a' | offers `limit` uncapped → DoS/large-dump | ✅ **fixed** (cap 1-200, exchange.js) | KANet-UI |
| 4b | offers/market `SELECT *` (63/33 cols) leaks internal UUIDs/metadata (no secrets — J1 confirmed) | 🟡 **design note** — handler is SHARED with internal UI (naive strip breaks UI); recommend a curated public projection on the proxy path, or accept non-secret internals. Decide. | KANet-UI + Bettor |
| 5 | path-traversal + bypass variants (URL-encode / method-mismatch / trailing-slash — note fastify `ignoreTrailingSlash`+`ignoreDuplicateSlashes` on) | ⏳ J1 red-team external test post-deploy (default-deny is robust; verify) | J1 |
| 6 | kaspad (ws :17210) is a separate service the proxy doesn't cover → external broadcast needs a reachable TN12 kaspad | ⏳ onboarding `KASPAD_HOST` = a public TN12 node (NOT operator's) | J1 (onboarding) |
| 7 | caddy-ratelimit third-party plugin availability | ⏳ confirm `xcaddy --with mholt/caddy-ratelimit` at deploy | KANet-UI |

Code fixes #2/#3/#4a/#4a' are landed in the working tree (deploy on the gap-A restart). #4b/#5/#6/#7 open.

## 7. Open decisions (for Bettor + Owner)
1. Public node = :3200 itself (confirmed by Bettor r1035) or a separate box later?
2. Proxy: Caddy (simplest allowlist + built-in TLS) vs nginx (limit_req mature)? — recommend **Caddy**.
3. Faucet daily/address cap value + whether to expose `/faucet` UI at all.
4. Public port / TLS cert (Let's Encrypt via Caddy auto, if a domain exists).
