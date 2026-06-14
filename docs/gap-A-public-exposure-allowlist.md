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

### 3.1 Faucet hardening (the one exposed write — hard requirements)
The faucet (`POST /api/faucet/request`, chat.js:583) dispenses real test KAS → **drainable without
controls.** Before exposure it MUST have: (a) per-IP rate limit at the proxy (e.g. 1 req / 10 min);
(b) per-address cap (already `FAUCET_AMOUNT_KAS=5` per request — confirm a daily/address cap exists,
add if not); (c) request-body size limit; (d) faucet relay balance alarm. **Action item — verify/add
before go-live (not in this draft).**

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
    handle @safe_reads { reverse_proxy 127.0.0.1:3200 }
    handle @faucet {
        rate_limit { zone faucet { key {remote_host} events 1 window 10m } }   # caddy-ratelimit plugin
        request_body { max_size 4KB }
        reverse_proxy 127.0.0.1:3200
    }
    handle { respond 403 }   # DEFAULT-DENY everything else
}
```
(nginx equivalent: `location`-allowlist + `limit_req` + `return 403` default — provided in v2.)

## 6. Exposure test (J1 red-team, builder≠verifier)

After deploy, J1 curls from an external position:
- **Expect 200/expected:** each §3 allowlist route.
- **Expect 403:** `POST /api/system/run`, `POST /api/relay/<id>/transfer`, `POST /api/oracle-pool/enroll`,
  `POST /adapters/...`, `POST /api/chat/ingest`, `/api/settings`, a sample of random internal GETs.
- **Faucet abuse:** rapid repeat → rate-limited after 1.
- Red/green report → no high-risk route reachable = perimeter holds.

## 7. Open decisions (for Bettor + Owner)
1. Public node = :3200 itself (confirmed by Bettor r1035) or a separate box later?
2. Proxy: Caddy (simplest allowlist + built-in TLS) vs nginx (limit_req mature)? — recommend **Caddy**.
3. Faucet daily/address cap value + whether to expose `/faucet` UI at all.
4. Public port / TLS cert (Let's Encrypt via Caddy auto, if a domain exists).
