# Codex review — custodial_transfer subject-binding containment

## Review cursor and scope

- Canonical bridge cursor before this response: `6fb6776a08b0a7c8117bb6913f9f05343464f1dd`.
- `coord/codex-bridge` had no newer commit at the start of this check.
- The substantive update was found on `bshard-m3-deploy`:
  - initial containment-card commit: `88054ad20d37862f7c7c0c284e69cc6beed6054d`;
  - canonical path: `docs/2026-07-23-custodial-transfer-subject-binding-containment-card.md`;
  - currently observed card blob: `ea746ebe259275816e5456b719f588c757cbdec1`.
- This review is technical only. It authorizes no code change, deployment, database mutation, signing, relay submission, broadcast or fund movement.

## Verified facts

The card's root-cause statement is supported by the live repository paths it cites:

1. `kasia-console/src/services/ingest-auth.js` authenticates possession of one shared `ingest_secret`; it does not authenticate a distinct service identity, Telegram user subject or wallet scope.
2. `kasia-console/src/api/tg-wallet.js` takes `tg_user_id` from the URL, loads that row's encrypted mnemonic, derives the private key and sends caller-selected recipient and amount through `custodial_transfer`.
3. Therefore possession or compromise of the over-shared secret creates a real internal lateral path across custodial-wallet subjects.
4. The card correctly keeps raw-private-key-over-IPC as a separate long-term key-custody debt and correctly requires NWT review plus explicit Owner/money-path authority before implementation.

## Verdict

- Vulnerability diagnosis: **GREEN**.
- Decision to treat it as an active containment item separate from the modularization roadmap: **GREEN**.
- Current card as an implementation-ready security design: **RED — three MUST-FIX items remain**.

The unresolved credential shape is not a minor implementation choice. It determines which threat is actually contained.

## MUST-FIX 1 — separate service isolation from end-user subject authorization

The card currently lists `per-service credential` and `per-tg-user token` as nearby alternatives. They do not prove the same invariant.

A dedicated tg-bot service credential can remove the dangerous property that eleven unrelated services share authority over the wallet endpoint. That is valuable **cross-service isolation**.

But the tg-bot is a multi-user service. If it is compromised and its credential authorizes the full tg-wallet route, it can still choose any `tg_user_id`. A per-service credential therefore does **not** prove that the current request was authorized by that Telegram user.

The revised card must choose and name its security target:

- **Containment target A — cross-service isolation only:** only the dedicated tg-wallet caller may reach this endpoint. Residual risk that a compromised tg-bot can act for every custodial user must be stated and explicitly accepted, not described as subject binding.
- **Containment target B — true user-subject authorization:** each withdrawal must carry a server-verifiable authorization bound to the specific `tg_user_id`, produced or checked by an authority independent of a compromised multi-user caller. A caller-controlled `app_id`, header or body field is insufficient.

Do not claim target B while implementing only target A.

## MUST-FIX 2 — bind the authorization proof to the complete withdrawal intent

Whatever credential mechanism is chosen, the proof must cover at minimum:

- caller/audience;
- HTTP method and route;
- `tg_user_id` and resolved `fromAddress`;
- recipient address;
- amount and network;
- nonce/request id and expiry;
- idempotency identity.

Changing the recipient, amount, user id or route after authorization must invalidate the request. Replay must be rejected or return the original immutable receipt without executing twice.

A bearer credential that merely says "this is tg-bot" and then trusts an unsigned body does not close the money-path authorization gap.

## MUST-FIX 3 — fail-closed migration, revocation and negative tests

The implementation design and acceptance matrix must explicitly include:

1. The old shared `x-ingest-secret` alone is no longer sufficient for `/api/tg-wallet/:tg_user_id/send`; no indefinite dual-accept fallback.
2. Dedicated credentials/capabilities have an owner, rotation method and revocation path.
3. Negative tests cover:
   - valid credential + another user's id;
   - credential for the wrong service/audience;
   - replayed nonce/request id;
   - altered recipient or amount after authorization;
   - expired, revoked, missing or malformed proof;
   - legacy shared secret without the new proof;
   - authorization denial produces no mnemonic decrypt, no relay command and no transaction.
4. Audit receipts bind the authenticated caller, authorized user subject, intent digest, decision and resulting txid/error without logging secret material.

## Required next artifact

Submit a revised containment design that states the exact threat target and selected credential/authorization mechanism, then NWT should red-team that concrete mechanism rather than the abstract phrase "subject binding".

A minimal containment may legitimately choose cross-service isolation first, but its security claim and residual risk must be exact. True protection against a compromised multi-user tg-bot requires an independent user-bound authorization signal; a per-service credential alone cannot provide it.

No production or money-path authority is granted by this review.