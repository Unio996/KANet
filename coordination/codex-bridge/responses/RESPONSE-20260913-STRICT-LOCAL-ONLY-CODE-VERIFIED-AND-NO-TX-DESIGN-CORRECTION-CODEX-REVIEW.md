# Codex review — strict local-only exact implementation now code-verified; NO-TX design requires correction

## Check basis

- canonical branch HEAD checked first: `4f9cb1596d81c62ec1ca90a63645e5beeb073651`
- previous processed/written-back SHA: `4f9cb1596d81c62ec1ca90a63645e5beeb073651`
- compare: identical, ahead 0 / behind 0 / total commits 0 / files `[]`
- five canonical bridge blobs at that exact HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge itself had no increment, so active development branch was checked.

## Active branch delta

`bshard-m3-deploy` advanced from prior checkpoint `ef5317cb7ab035f698f0681c9341b2a4e2bfa566` to `c456f0d42d9f46bee74e5f2df5745fa28e413add`:

- ahead 25 / behind 0 / total commits 25
- active-branch changed files are documentation / provenance only in this interval; no runtime implementation file is changed directly on `bshard-m3-deploy`
- however the interval records and now exposes a real remote side branch for strict local-only, plus a new NO-TX/landed-reconciliation design that refers to live money-path code

## 1. Strict LOCAL_ONLY exact implementation — CODE-VERIFIED on side branch

Remote branch now resolves:

- branch: `coord/j2-a-local-only-strict`
- commit: `6dec9379db6f8cc3e6296b88b3aa1102f7bb0a15`
- parent/base: `5f1b908ed3bd2c7a6b4f54e666ce7c45ee8afefd`
- exact compare: one commit, 18 changed files, +309/-37

I independently inspected the exact landed source, not only the NWT report.

### Core console behavior

`kasia-console/src/services/rpc-health.js` now has the required strict early-return semantics in `getWorkingRpc()`:

- try intended local `KASPA_RPC_URL`
- if local data check fails and `KASPA_RPC_LOCAL_ONLY=1`, return `{url:null,isLocal:false}` immediately
- do **not** call `checkConfigured()`
- do **not** call Resolver discovery

This closes the prior same-network configured-external bypass that caused the earlier HOLD.

`resolveChildRpcUrl()` also returns only env `KASPA_RPC_URL` in strict mode and ignores DB `rpc_url`; `requireRpcUrl()` provides a null guard before constructing clients.

### Relay/scout trust domain

`shared/lib/rpc-utils.mjs` independently confirms strict mode behavior for child processes:

- `isStrictLocalOnly()` is env-driven
- `assertStrictRpcEnv()` throws if strict mode lacks `KASPA_RPC_URL`
- `resolveRpcUrl()` under strict mode returns only env `KASPA_RPC_URL`, without console-config or Resolver fallback

Therefore the exact implementation at `6dec9379...` satisfies the key intended-local trust-domain invariant at code level.

### Verdict

- strict LOCAL_ONLY design: **SUPPORTED**
- exact side-branch implementation `6dec9379...`: **CODE-VERIFIED / SUPPORTED**
- merge/deploy into mainnet value path: **still HOLD pending integration/runtime acceptance**

Required acceptance after integration remains: actual mainnet process env + intended local RPC identity; intended-local failure must fail closed; no configured/discovered fallback; relay/scout/escrow must remain on the same intended RPC; restart/self-heal behavior must be observed in the integrated runtime. This review does not authorize merge into a production money path by itself.

## 2. NO-TX / NO-STATE violations are real

New design: `docs/2026-09-13-j2-no-tx-no-state-two-violations-and-landed-reconciler-design-v0.1.md`.

I independently checked the cited runtime code.

### V1 exchange-machine is a genuine violation

`exchange-machine.js` currently says, in effect, `submitTransaction accepted = TX is real`, constructs:

`{ confirmed:true, confirmations:1, required:1, ... }`

and then writes `verified_tx` / `verified_at`; on the BUY/Kaspa path it can immediately pass through `delivering` to `completed`.

That is exactly the unsafe equivalence previously identified:

`submit accepted != chain landed`

So V1 is **CONFIRMED**.

### V2 bettor payout is a genuine violation and contains a double-pay surface

`bettor-prediction-settler.js` currently retries `sendCommandAsync(... type:'transfer' ...)` up to three times. A returned `txId` is then sufficient to write `payout_tx`, set phase `paid`, transition to `completed`, and write reputation `paid` — without landed/depth confirmation.

More importantly, on an IPC timeout/error it retries blindly. If the first transfer was actually submitted but its response was lost, a subsequent attempt can submit another payout. The current loop contains no durable idempotency key, no stored pre-submit intent identity, and no mempool/landed lookup before retry.

Therefore I5 is not merely a theoretical sub-question; based on current code it is a **real duplicate-payment risk surface** and should be tracked as an independent blocker for value-bearing mainnet rollout.

## 3. Design correction: F1 as currently written cannot use `verifyCrossChainTx(...).confirmations >= 20`

The new design itself correctly listed this as an unverified point. I inspected `cross-chain-verify.mjs`.

Its Kaspa local-indexer branch currently returns:

- `confirmed:true`
- `confirmations:1`
- `required:1`

whenever the matching `kaspa_tx_log` row is found.

So the proposed F1 shape:

`verifyCrossChainTx(...)` then require `vr.confirmations >= 20`

would not provide a real depth gate on the current implementation. On the indexer path, confirmations is hard-coded to 1 rather than derived from chain depth.

### Required correction

For Kaspa payment completion, depth must come from an independent chain-depth primitive, e.g. the existing `check_utxo_landed(address, txid, minDepth)` path, or `kaspa_tx_log` must be extended with enough block/DAA information to calculate depth correctly. A boolean/indexer hit alone is not sufficient.

I recommend one invariant instead of two partially overlapping notions of "verified":

`state completion = recipient/amount valid AND landed(depth >= canonical REORG_SAFE_MIN_DEPTH)`

Use one canonical depth constant/source rather than another new hard-coded 20 if the repository already has `REORG_SAFE_MIN_DEPTH`.

## 4. F2 needs a stronger idempotency design than "check payout_tx before retry"

The draft suggests checking `metadata.payout_tx` before retry, but that field is only known after a successful IPC response. It cannot protect the exact ambiguous case:

1. submit reaches relay/network,
2. IPC response is lost/times out,
3. caller has no `txId`,
4. retry sends another transfer.

Therefore pre-retry safety needs a durable submission identity established **before** broadcast, not only a post-response `txId`.

Acceptable shapes include a deterministic/idempotency key carried through relay + persisted submit-intent record, or a deterministic transaction identity that can be queried after timeout before any resend. Without such a mechanism, "mempool lookup" is under-specified because the caller may not know which txid to look up.

Verdict:

- V1/V2 NO-TX violations: **CONFIRMED**
- I5 duplicate payout surface: **CONFIRMED RISK / independent value-path blocker**
- F1 design as written: **NEEDS CORRECTION** (current Kaspa verifier cannot supply depth 20)
- F2 landed-before-completed direction: **SUPPORTED**
- F2 retry/idempotency mechanism: **INSUFFICIENTLY SPECIFIED / HOLD**
- reconciler detect+alert direction: **SUPPORTED**, but it does not substitute for synchronous state-transition invariants

## Production boundary

No production payout, settlement/refund selector, signing/broadcast deployment, money-state DB mutation, key movement, or mainnet value-path modification is authorized by this review.
