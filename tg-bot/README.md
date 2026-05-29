# tg-bot — KANet Telegram bot service (reach/notification layer)

> **Status**: scaffold + S5 guardrails only (Bettor r211 plan v1.1). Bot service code (S4) is
> token-gated (Owner @BotFather token) and not yet built. This dir exists so the **guardrails are
> baked-from-start** — any code added here is machine-checked against the 0-key/0-custody hard lines.

## What this service is (and is NOT)

The TG bot is the **communication / notification / discovery / onboarding** layer that meets builders
where they are. It is a **reach layer**, not a trust layer.

- **TG handles**: /start onboarding, opt-in notifications (matched/settle/dispute/payout), read-only
  discovery (open offers / prediction markets / oracle registry), and *bridging* to value actions.
- **On-chain handles** (NEVER the bot): escrow / settle / dispute / signatures — the value & trust steps.

**Hard line**: a user's funds and evidence must never live only in Telegram. Any value/trust step is
**deep-linked** to the Console UI / the user's own relay, which holds the key. The bot links to it,
it does not execute it ("lock KAS: open this link, your relay signs, we never touch your key").

## S5 guardrails (machine-enforced — Bettor r211/r212)

1. **0-key (compile-time, `scripts/lint-kanet.mjs` rule S5)**: any `.js`/`.mjs` under `tg-bot/` is
   rejected if it references a key/signing primitive (`getPrivateKey`, `createInputSignature`,
   `signMessage`, `ecdsa_sign`, `sign_input_for_settle`, `PrivateKey`, `mnemonic`, …) or executes a
   value/sign relay command (`type:'transfer'`, `prediction_settle_tx`, `sign_input_for_settle`, …).
   The bot is *physically incapable* of touching keys or moving funds.
2. **0-write (test, `test-framework/cases/tg-bot/`)**: the bot exposes 0 write endpoints except
   `user_notification_prefs` (subscribe/unsubscribe). Any escrow/settle/dispute/sign write = test fail.

Together: **0-custody, enforced at compile-time + test-time**, before the bot code is even written.

## Implementation map (Bettor r211 plan v1.1)

| Sub-task | What | Owner | Gate |
|----------|------|-------|------|
| S1 | read-only `GET /api/events/since/:ts?address=` (chain_events server-side filter) | J2 | — |
| S2 | `/link` 0-key flow (nonce + Console-side sign + verifyMessage bind) | J2 | — |
| S3 | `user_notification_prefs` table (migration after v153) | J2 | — |
| S4 | TG bot service (grammY: /start + notify-poller + discovery + bridge deep-link) | TBD | Owner BotFather token + host |
| S5 | guardrails (this dir's lint rule + 0-write test) | **J1** | — |
| S6 | Tier-4 real test (real TG → /link real sign → real settle → real notification) | TBD | S4 |

Notes for S4 (J1 r59 deltas): the notify-poller must use a **persistent cursor + dedup** (reuse the
dev-coord monitor's cursor-poll pattern); `/link` signing happens in **Console/relay** (deep-link),
never in TG (the user has no key in Telegram).
