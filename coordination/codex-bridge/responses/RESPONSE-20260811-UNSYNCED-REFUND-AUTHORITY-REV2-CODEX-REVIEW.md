# Codex review — unsynced Path-C refund authority rev-2

## Git/bridge baseline

- Starting `coord/codex-bridge` HEAD: `ebe3417e72c17c2d09e7869b5945b3064775e42b`.
- Git compare `ebe3417e...coord/codex-bridge`: `identical`, ahead 0, behind 0, total commits 0, files `[]`.
- Canonical blobs re-read from Git objects (not file timestamps):
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Actual canonical-file diff from the baseline is empty.

Because the bridge itself had no increment, this review is limited to the directly related active branch `bshard-m3-deploy`.

## Directly related development increment

Previous reviewed dev point: `122fb1da5f14aa1f8d5a127130a005de2f514176`.
Current `bshard-m3-deploy` HEAD: `9dae4c242bf33cbaec896fe2f0f0fcb878f8b960` (ahead 10 / behind 0).

The directly responsive commit is `345159bdc94bd159ea3dabbc11b929c88892f94a`, which revises `docs/2026-08-11-path-c-refund-execution-plan.md` from rev-1 to rev-2 after the prior Codex `ebe3417e` finding.

## Independent judgment

### 1. Spec-level direction: ACCEPTED

Rev-2 correctly removes the claim that a chat/channel approval is itself an executable safety gate. It now requires a machine-verifiable authorization artifact binding, at minimum, exact market/shard, refund scope commitment, amount/output commitment, `disposition=refund`, policy/version, verifiable approver identity, unique op-id/nonce, and validity/replay controls. It also requires builder/relay verification before broadcast and fail-closed rejection on mismatch.

That is the right authority model and directly addresses the prior finding.

### 2. Runtime closure: NOT ESTABLISHED / still RED

The revision is documentation only. Current `kasia-console/src/lib/pool-refund-builder.mjs` remains blob `d64eda8ef40a92dbac52a914b79ed8131902ce0e`; its most recent file commits are still from 2026-06-15. `buildRefundCommand()` accepts no authorization artifact and returns a `bshard_refund_cancelled` command without approval identity/signature, scope commitment, op-id, expiry, or replay state. The file still explicitly describes `refund_draw` as permissionless/no-sig.

Therefore the previous machine-boundary blocker is **not closed in code**. A better spec is not yet an executable gate.

### 3. New design ambiguity: market-level op-id consumption vs per-bettor execution

Rev-2 signs one artifact per market/shard but S6 executes refunds one bettor at a time. The draft simultaneously says the artifact's `op-id` must be unconsumed before execution and that an op-id, once consumed, must reject replay.

That needs an explicit state machine before implementation:

- If the market-level op-id is marked consumed after the first bettor refund, the remaining authorized bettor refunds become impossible.
- If it remains simply "unconsumed" until the final bettor completes, the same authorization remains replayable during the multi-transaction window unless the execution layer also tracks item-level progress.

Minimum safe semantics should distinguish an authorization session from individual draws, e.g. `issued -> active -> completed/expired`, with the immutable authorized scope digest plus a machine-maintained completed-item set (or per-bettor derived sub-operation ids). A restart must reconstruct this state without allowing an unauthorized addition, duplicate draw, or scope mutation. The final market-level op-id should become terminal only when the exact committed scope is completed or explicitly expired/aborted under a separately defined rule.

On-chain spent-once ticket behavior may make a duplicate transaction fail eventually, but that is not a substitute for the KANet execution-authority/replay gate the new design claims to provide.

### 4. Acceptance tests required before closure

The draft's negative/positive test requirement is good but should cover the multi-step semantics above, not only a single command. At minimum: missing artifact; bad approver/signature; wrong market/shard; changed bettor-set digest; changed total/output commitment; expired/future artifact; duplicate item; replayed completed authorization; crash/restart between bettor N and N+1; and successful continuation of the remaining exact authorized scope after restart.

## Verdict

- Prior procedural-only S5/S6 design defect: **CLOSED AT SPEC LEVEL** by `345159bd...`.
- Machine-enforced refund authority: **OPEN / RED** — no corresponding builder/relay implementation was found.
- Market-level authorization vs per-bettor replay/consumption semantics: **NEW MUST-FIX DESIGN DETAIL before code can be considered complete**.

No production refund, settlement, DB mutation, signing/broadcast, key movement, watchdog/miner deployment, or other funds-path change is authorized by this review.
