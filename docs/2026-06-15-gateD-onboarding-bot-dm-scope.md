# Gate D — External Onboarding via Telegram-Bot DM (SCOPE DRAFT)

**Status**: SCOPE DRAFT for Bettor review (Bettor: "出 gate D scope 草案…我审, 别直接码"). By KANet-UI-tn 2026-06-15.
**Direction (Bettor-set, supersedes my reverse-proxy draft `ae15bcf8`)**: backend **永远 localhost, never exposed**; users onboard via **Telegram DM**. The faucet is a **bot DM command**, the wizard/first-tour is **in-bot**. No "expose the backend" gate. The reverse-proxy draft is **fallback-only** — used ONLY if a truly-public read endpoint is ever needed (then default-deny allowlist; never raw 0.0.0.0).

## Why bot-DM is strictly better (gap-A dissolved)

The reverse-proxy approach existed to safely expose the web faucet/onboard. But the tg-bot **polls** Telegram (outbound long-poll) and calls the Console on `127.0.0.1` — there is **zero inbound listener**. So the whole gap-A attack surface (~550 routes, `/api/system/run` RCE, etc.) is **never reachable from the public internet at all**. This is the existing-infra-aligned, safest design.

## Existing building blocks (reuse, don't rebuild)

| Block | Where | Role |
|---|---|---|
| grammy bot + command framework | `tg-bot/bot.mjs` (`bot.command('start'|'link'|'bet'|...)`) | add `/faucet` + tour here |
| `/link <kaspatest:addr>` | `tg-bot/bot.mjs:50` | user binds their address (faucet target) |
| console-api client | `tg-bot/console-api.mjs` | bot → Console localhost calls |
| faucet (WORKS) | `POST /api/faucet/request {wallet_address}` → FaucetRelay-tn-2 sends 5 KAS (verified txid `426220a6…` landed) | the delivery mechanism — just needs a bot command in front |
| message templates | `tg-bot/messages.mjs` (already references "/faucet 领" at L20) | copy lives here |
| Console-managed bot lifecycle | `tg-bot-manager.js` (single-owner, start/stop, crash-respawn) | no new process |

## Scope

### 1. Faucet delivery = `/faucet` DM command
- `bot.command('faucet', …)`: resolve the user's linked address (from `/link`; if not linked → reply "先 /link <你的 kaspatest 地址>"). Call `console-api` → internal `POST /api/faucet/request {wallet_address}` → reply with the txid + explorer link. (Reuses the working faucet + its once-per-address guard; per-Telegram-user rate-limit optional in-bot.)
- No web endpoint exposed. Console-side faucet stays an internal localhost route the bot calls.

### 2. Wizard / first-tour = in-bot, on `/start`
- Enhance `/start` (or a `/tour`) to a short guided sequence: (a) make/link a key → (b) `/faucet` for testnet KAS → (c) `/bet` to place a real prediction bet → (d) `/mybets` to see it settle. Each step a DM reply with the next command. (Matches the existing menu-driven, no-LLM bot style; Owner待拍 on copy.)
- "No account. No permission." framing preserved — but delivered in-DM, not on a web page.

### 3. Public endpoint analysis → **none required**
- Market discovery / offers: already surfaced in-DM via `/bet` (broker-scoped market menu) + `/discover`. No public web board needed for onboarding.
- ∴ the reverse-proxy / any 0.0.0.0 exposure is **NOT** part of gate D. Keep `ae15bcf8` only as a documented fallback if a future requirement truly needs a public read API.

## Open for Bettor / Owner
1. Confirm bot-DM is the gate-D onboarding path (kill the reverse-proxy as default). 
2. Faucet per-Telegram-user policy (the Console faucet is once-per-*address*; a user could rotate addresses — add a per-TG-user cooldown in the bot?).
3. Tour copy + whether `/tour` is separate from `/start`.
4. Which broker the onboarding bot is scoped to (broker-scoped `/bet` menu).

Code only after Bettor signs off on this scope. — KANet-UI-tn
