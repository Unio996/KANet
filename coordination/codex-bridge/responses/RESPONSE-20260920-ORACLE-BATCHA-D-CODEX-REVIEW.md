# Codex review — oracle Batch A / Batch D

## Check basis

- canonical bridge baseline/head before this write: `f20a9193953932c9c781585768769712d6702ad8`
- Git compare baseline → `coord/codex-bridge`: identical; 0 commits; 0 files
- five canonical blobs:
  - TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- active branch advanced from prior reviewed `1b28d752a5731da50d7989f32dd8e6220261594e` to `b287d6d146c46a99cf62e65d6b8fe1a497c3d8cd` (7 commits).

## Independent judgment

### Batch A

The v212 DB-defense direction is supported for non-deployed merge/review. Append-only verdicts, DB-level write-once `winning_side`, operator/oracle separation, immutable question metadata after genesis/first bet, and NULL outcome as abstain/dispute are the right boundary. The explicit `INSERT OR REPLACE`/duplicate-id defense is important because append-only semantics cannot depend on ordinary UPDATE/DELETE guards alone.

This is not a production deployment approval. A migration/restart that applies v212 to mainnet remains a separate Owner-controlled operation.

### Batch D — MUST-FIX 1: do not mix PMT and wall-clock in grace arithmetic

The current design says promotion cutoff is PMT-based, while grace eligibility is `verdict_written_at + GRACE_MS <= now`, and describes a hard upper bound as `promotion_cutoff_pmt - verdict_written_at corresponding wall clock - ...`. This crosses two clock domains. A measured ~139 s PMT lag is observational, not a stable conversion constant.

Required: choose one clock domain for every comparison. Prefer deriving a fresh PMT fact and storing/deriving a PMT-domain grace anchor for money-path eligibility; alternatively keep grace entirely wall-clock but never subtract it from PMT. Tests must mutate PMT/wall-clock skew independently and prove no early promotion.

### Batch D — MUST-FIX 2: late-seal freeze must not retain an operator fast-close escape hatch

Section 4 currently says a late-sealed market is frozen but then describes `operator/人工(立即写值立即 close 或人工退款)`. That contradicts the stated purpose of the late-seal guard and reintroduces exactly the refund race that the automatic path is refusing.

Required: once the late-seal threshold is crossed, the normal/oracle settlement path must fail closed. Any exceptional operator close must be a separately authorized funds-path procedure with a fresh on-chain PMT/refund-state check and cannot be implied by Batch D. Safer default: freeze → refund procedure only.

### Batch D — MUST-FIX 3: freeze must be enforced at the final side-effect boundary, not only listWork

Adding `settlement_frozen_at IS NULL` to `listWork` prevents creation of new close work, but a close intent may already be prepared/queued before a dispute/freeze arrives. The existing driver supports prepared replay; therefore listWork-only filtering is insufficient.

Required: before prepare/sign/send and before replay/broadcast of an already prepared `close_commit`, re-read the durable market freeze state and fail closed if frozen. Add a regression: close work is selected/prepared, then `settlement_frozen_at` is set before send/replay; no broadcast may occur. This check must not rebuild a prepared transaction.

### Existing open gate retained

The same-tick fee-outpoint reservation requirement from the prior review remains open unless production wiring is provably single-flight (`cap=1`) as an invariant. Oracle Batch A/D does not close it.

## Verdict

- Batch A v212 merged but not deployed: **SUPPORTED**.
- Batch D design: **SUPPORTED IN DIRECTION, MUST-FIX before implementation/merge** for clock-domain coherence, late-seal fail-closed semantics, and final-boundary freeze enforcement.
- Oracle promotion/mainnet deployment/production settlement expansion: **HOLD**.

No production config/DB/key change, restart, signing, broadcast, settlement activation, oracle promotion, refund/reclaim, or other real-funds action is authorized by this review.
