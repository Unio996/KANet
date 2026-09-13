# Codex review — NO-TX v0.3 landed gate + KTT A″

## Git evidence baseline

- canonical bridge base/head checked: `8968452d4057bf6451d8e97af95d5b6b5f1b05e0` → `coord/codex-bridge` = identical, 0 commits, files=[]
- canonical five blobs re-read from exact HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- active branch checkpoint compare: `c456f0d42d9f46bee74e5f2df5745fa28e413add` → `8a44568aad615cbaabe6e36e5f1311a9f8e0c5b5` = ahead 16, behind 0, 16 commits.
- active-branch interval contains docs/provenance only for the items reviewed here; no landed NO-TX runtime implementation is present in this compare.

## 1. NO-TX v0.3 — F1 correction is now structurally correct

The design no longer treats `verifyCrossChainTx(...).confirmations` as real Kaspa depth. It uses that path only for recipient/amount validation and separately gates completion on relay `check_utxo_landed(..., minDepth = REORG_SAFE_MIN_DEPTH)`.

Verdict: **SUPPORTED as design**. This closes the previously identified hard-coded `confirmations:1/required:1` false-depth assumption. Runtime acceptance remains OPEN until code and tests land.

## 2. F2/F2-R — durable intent + same-byte replay is the right shape, but one premise remains unproved

The new design materially improves the duplicate-payment boundary:

- intent row exists before any IPC;
- deterministic `prepared_txid` is persisted;
- `prepared_tx_json` is persisted;
- process/restart recovery is allowed to replay only the same serialized transaction;
- relay must reject replay when deserialized txid differs from `prepared_txid`;
- rebuild with a new UTXO set is exceptional and only allowed after proving an input of the prepared transaction has been spent by another transaction, with the old intent retained as `abandoned`.

That is materially safer than rebuilding a fresh transfer after an ambiguous timeout.

However, the design itself correctly records an unresolved premise: kaspa-wasm `serializeToSafeJSON()` → `deserializeFromSafeJSON()` must preserve all transaction material needed for an identical `Transaction.id`, including covenant transaction inputs/UTXO context. Type declarations alone do not prove this.

Verdict:

- **F2/F2-R architecture: SUPPORTED-CONDITIONAL**.
- **same-byte replay runtime premise: OPEN** until an actual covenant transaction round-trip proves `id_before === id_after` and the replayed bytes are accepted/rejected idempotently as expected.
- if that round-trip fails, do not fall back to reconstructing a fresh payment automatically; fail closed/manual recovery is safer.

## 3. Newly expanded escrow sites — same idempotency mechanism MUST cover all three

The active-branch evidence identifies the same blind retry structure at `api/bettor.js` around the maker escrow / maker stake / taker stake paths in addition to prediction-settler payout. This is the same failure class: IPC may have broadcast successfully while the caller sees timeout/error and retries.

Verdict: **scope expansion is REQUIRED and SUPPORTED**. Fixing payout only would leave the same duplicate-transfer mechanism on inbound escrow paths.

## 4. Important correction to F2-E: `escrow_landed_at` must be a hard consumption gate, not merely reconciliation/UI metadata

v0.3 proposes not blocking the HTTP request for 20 blocks: create/update the offer after submit, leave `escrow_landed_at = NULL`, and let the reconciler fill it later. That can be safe only if the pre-landed object is explicitly non-consumable.

Required invariant:

`escrow_landed_at IS NULL` ⇒ no taker acceptance, no matching, no settlement eligibility, no counterparty value movement, no reputation/final-success state, and no other action whose correctness assumes the escrow exists on-chain.

The offer may exist as a **pending/non-consumable** record for UX/asynchronous processing, but downstream business code must hard-gate on landed+depth evidence. A UI-only marker or timeout cleanup is insufficient: otherwise `submit accepted` still causes externally actionable state before the funding transaction is proven landed.

Verdict:

- asynchronous HTTP return: **SUPPORTED**;
- advancing to a consumable offer before landed proof: **HOLD**;
- T4/mainnet value-path acceptance must include a negative test where submit returns txid but the tx never lands; no downstream value action may become reachable.

## 5. KTT / KCC20 A′ → A″ correction is security-significant and directionally correct

The new KTT design records that template registration covenant R (A′) is independently genesis-creatable with attacker-chosen state. A registry script that only constrains future spends cannot validate its own genesis state, so an attacker can mint an R′ with honest newly-derived covenant id but malicious binding data. That reopens the wrapper/template admission attack.

The red-team distinction is correct and important: genesis covenant-id derivation may be consensus-validated while script/state semantics are not thereby authenticated. Therefore provenance must not be inferred from `template_hash` plus attacker-initializable registry state.

A″ removes the independent registry credential and folds the required binding into the already business-gated market/claim objects. This reduces the unauthenticated-genesis credential surface.

Verdict: **A″ preferred / A′ rejected as primary design**.

But A″ is still not implementation-accepted. Its remaining mandatory probes include at least:

- the runtime-state form of the expected template hash used by `validateOutputStateWithInputTemplate` (or equivalent primitive) must be demonstrated, not assumed from another primitive;
- wrong market covenant-id/state binding must fail in a runtime vector;
- every per-instance value must remain state data, not become a structural compile-time parameter that mutates the template hash.

The P9/P10/P11 provenance is useful feasibility evidence, not authorization for a production token/value path.

## 6. Production boundary

No production payout, escrow/stake, settlement/refund selector, signing/broadcast deployment, money-state DB mutation, key movement, token deployment, or other mainnet value-path modification is authorized by this review.

Current money-path status remains HOLD pending landed runtime code + tests, strict consumption gating, and the existing G-1/mainnet trust prerequisites.