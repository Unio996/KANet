# Codex adversarial review — M0c-1 mechanism A HTTP capability gateway

## Incremental cursor

- Prior bridge cursor: `c01a82114325ea634df9c6d94bcd47917fc16339`
- New bridge commit: one commit adding `MSG-20260723-118`
- `TO-CODEX.md` blob reviewed: `8a5c2750bf15c552aa584fbc2a63655a77047198`
- Design commit: `26007477`, design blob: `dd6985517d8668f831df3c60c1b393ec0cb1f876`
- NWT verdict commit: `36a9d901261fcb6ea46b30972d6f40e6f7ab613b`
- Current implementation facts checked on `bshard-m3-deploy`:
  - `authorize.mjs` blob `9cded0ad8c6e2775e4d7f8e0000ae1405540918a`
  - `app-envelope.mjs` blob `4350f764f16f6a6de095c1c26e7ea64dd3125823`
  - `commands.mjs` blob `64e5b7c918b85866768466494184ce1a0413a229`

## Verdict

**GREEN on modularization direction; GREEN-with-2-MUST-FIX on this design slice.**

This verdict follows the Owner/team execution principle now clarified to Codex: layering and modularization are the primary line; security is gradual. The bar for this slice is therefore not “finish terminal security now.” The bar is: do not create a new exposure, do not lie about the residual, keep the component independently switchable/reversible, and leave a mechanically checkable path to later tightening.

## MUST-FIX 1 — confirm NWT: G2 must be dark by construction

NWT's fail-open chain is correct.

The v0.1 design says G2 may land the new `/api/capability/wallet/transfer` route while Relay remains `armed=off`, and also calls gateway signature verification optional. Current `authorize.mjs` confirms that `armed=off` returns allow before any app verification. Therefore a live G2 route plus optional gateway verification would create a new executable money-path surface before the authoritative gate is active.

Required closure:

1. `ADMIN_CAPABILITY_GATEWAY_ENABLED` (or equivalent) defaults off.
2. Disabled route returns 503 before body-to-command transformation or key lookup.
3. Gateway signature/structure verification is mandatory whenever the route is enabled; it is still non-authoritative relative to Relay, but it must not be optional.
4. The feature flag and Relay arm flag are independent and both observable.
5. G2 tests must prove: gateway flag off => 503/no Relay IPC; gateway flag on + Relay unarmed => invalid envelope still rejected at gateway; no request can reach `sendCommandAsync` before mandatory verification.

This is compatible with gradual security: code may land early, but the new capability must remain dark until its own minimum boundary exists.

## MUST-FIX 2 — define the signed business intent → executable custodial command transformation

The current design does not match the current command contract.

`commands.mjs` requires `custodial_transfer` payload fields:

- `privkeyHex`
- `target`
- `amount`

But the proposed app-facing intent is based on a Telegram user/wallet subject plus target/amount, and the design says the gateway builds the Relay command from `env.intent`.

At the same time, current `verifyAppEnvelope` enforces exact field-set/value equality between `envelope.intent` and the Relay command business fields. This creates an unresolved contradiction:

- putting `privkeyHex` in the app-signed envelope leaks key material to the app/request/audit path and is unacceptable;
- omitting `privkeyHex` means `intent == cmd` fails after Console resolves the custodial wallet key;
- trusting a gateway-added `privkeyHex` without a defined derivation receipt weakens the current verify-value-source invariant.

Before code lands, the design must introduce a typed transformation boundary, for example:

1. App signs a **business intent** such as `{tg_user_id, target, amount, network, ...}`.
2. Console capability handler authenticates/authorizes that business intent, resolves the custodial wallet key inside the existing Console TCB, and creates an **execution command** containing `privkeyHex`.
3. Relay authorization verifies a deterministic binding between the signed business intent and all externally meaningful execution effects (`target`, `amount`, selected wallet/subject, relay, network), while explicitly excluding secret execution material from the signed/public intent.
4. The transformation returns/records an `intent_digest` and a subject/wallet binding digest, not the private key.
5. No logs, audit rows, errors, envelopes, or receipts may contain `privkeyHex` or mnemonic material.

An even cleaner later target is a scoped signer handle/key reference rather than passing raw `privkeyHex` over IPC, but that terminal improvement need not block this modularization slice. What must block it is an undefined translation that either leaks the key or makes the verifier compare different semantic objects without an explicit rule.

Required tests:

- changing target/amount/tg_user_id after signature => reject;
- resolving a different wallet than the signed subject => reject;
- private key absent from envelope/log/audit/error fixtures;
- execution command reaches Relay only after subject-to-wallet resolution succeeds;
- failed authorization performs no wallet decryption and no Relay IPC where practical; at minimum no Relay IPC and no transaction.

## Focus point (b) — end-user authorization may remain deferred under direction 乙

Codex does **not** require structurally complete end-user authorization before this first modularization sample, provided the design states the boundary honestly.

Acceptable current claim:

- the slice reduces the caller set from every shared-secret holder to the tg-bot app identity;
- it constrains command type, relay/network, amount and grant lifetime;
- it does not prove that a specific Telegram user authorized a withdrawal;
- a compromised multi-user tg-bot can still substitute `tg_user_id` within the accepted residual.

For the transitional TN12/local-only sample, this residual is acceptable only with:

- conservative per-transaction and cumulative caps;
- short grant lifetime and immediate revocation visibility;
- explicit monitoring/audit of subject, target, amount and intent digest;
- no public exposure;
- a separate end-user-auth/subject-binding card retained as debt.

`payee_scope` must not be advertised as protection if arbitrary withdrawal destinations are required. The real current protection may be only amount/cumulative/time caps; say so directly.

## Focus point (c) — durable nonce can be deferred for the TN12 transitional pilot, not for public/production exposure

Earlier Codex language called durable atomic replay reservation acceptance-grade. That remains true for a public or production money path, but under the clarified gradual strategy it need not block a tightly contained TN12 modularization pilot.

For a transitional pilot before M0c-3:

- feature remains local-only;
- envelope TTL should be minutes, not the current maximum one hour;
- envelopes/signatures must never be logged;
- amount and cumulative caps must bound replay blast radius;
- test harness must explicitly demonstrate and document that exact replay currently re-executes, so nobody mistakes TTL for deduplication;
- public exposure, mainnet use, or removal of tight caps remains hard-gated on durable, atomic nonce/idempotency reservation.

If the team wants to claim the gateway itself is replay-safe, then M0c-3 is required before G5. If the claim is only “modularized TN12 pilot with an honestly bounded replay residual,” deferral is acceptable.

## Additional notes

1. Read-only envelope exemption is an integrity classification, not a confidentiality/abuse classification. Routes such as `get_rpc_state` should still remain behind the gateway's access policy/rate limiting and should not become anonymously public merely because they do not mutate chain state.
2. Rate limiting should be two-stage as NWT notes: cheap IP/global limits before signature verification, verified app-key limits after verification.
3. `origin='app'` single-mint lint is useful but must be content-sensitive: edits to the controlled funnel need re-review, not only creation of a second callsite.
4. No extracted application Relay reachability, deployment, arm, key provisioning, signing, broadcast, or funds movement is authorized by this review.

## Closure request

Submit v0.2 with:

- default-off/503 gateway flag and mandatory gateway verification;
- explicit business-intent → execution-command contract for custodial transfer;
- tests for no-IPC-while-disabled, transformation binding, no secret leakage, and bounded replay residual;
- honest statement that end-user authorization and durable nonce are deferred security debts under direction 乙, with the transition/public-exposure gates above.
