# Codex independent review — Oracle Batch D v0.3

Review basis:
- canonical bridge checkpoint: `fd1aa7cb8529644fba83bd95d783c78e1301dba5`
- bridge compare: checkpoint...`coord/codex-bridge` = identical (0 commits, 0 files)
- active development branch advanced from `b287d6d146c46a99cf62e65d6b8fe1a497c3d8cd` to `ce249c487507ef99d42f198cddcf34bdc9ea5290` (2 commits)
- reviewed Batch D v0.3 blob: `709e10a49d86ddf3c9a35a24cb22faa3535c319b`

## Verdict

Direction remains supported, but **Batch D implementation/production activation remains HOLD**. v0.3 closes much of the previous clock-domain and late-seal ambiguity, but two safety-contract contradictions remain MUST-FIX before implementation acceptance.

### MUST 1 — freeze must revoke an already-prepared close_commit before broadcast/replay

Section 3 now correctly requires a durable freeze re-read at the core broadcast boundary, but the same section says: `已 prepared 的 close_commit 不受冻结影响 ⇒ 冻结必须早于该市场第一个进 close_commit 的 tick`.

Those statements cannot both define the safety contract. A prepared intent is not a landed transaction. If `settlement_frozen_at` is written after prepare but before first send or a prepared replay, the final send/replay boundary must refuse broadcast. Otherwise the durable freeze is advisory and the exact TOCTOU case previously identified remains open.

Required regression: select/prepare close_commit -> persist prepared bytes -> write freeze -> invoke normal send and crash-recovery replay -> **zero broadcast in both paths**, while preserving the prepared bytes/txid (no rebuild/re-sign). A transaction already submitted/landed is a different state and cannot be revoked by this gate.

### MUST 2 — do not silently shorten the dispute grace to make a late verdict fit the refund budget

v0.3 defines `effective_grace = min(GRACE_MS, effective_upper)` and permits promotion whenever the resulting grace is >= `GRACE_MIN`. This means a configured 30-minute dispute window can automatically collapse toward 5 minutes merely because consistency was reached late. That converts timing pressure into a weaker dispute-safety policy and can accelerate an irreversible winning-side decision precisely in the highest-race-risk window.

Fail-closed rule should be: if the **full configured GRACE_MS** plus `CLOSE_PIPELINE_MARGIN` no longer fits before `promotion_cutoff_pmt`, freeze/refund. `GRACE_MIN` may be useful as a configuration validation lower bound, but should not authorize runtime compression of a configured grace period unless Owner explicitly adopts "adaptive grace" as a separate funds-path policy decision with evidence that the reduced dispute period is acceptable.

Required boundary tests: full grace fits exactly -> eligible only after full grace; full grace misses cutoff by 1 ms -> freeze; late consistency must never produce earlier promotion by shrinking grace.

## What v0.3 does improve

- Eligibility is now materially kept in the PMT domain: verdict `pmt_at`, `outcome_end_ms`, consistency time, cutoff and promotion comparison are PMT-based. Wall clock is used only as a fail-safe fallback for recording a freeze when PMT is unavailable, not to establish promotion eligibility.
- `Number.isFinite(outcome_end_ms)` and fail-closed judged-market handling remove the null/NaN ambiguity.
- Frozen judged markets now have an explicit refund-only terminal policy; the previous implicit manual-resolve escape is removed.
- The outcome-end gate is correctly placed at bet acceptance rather than retroactively preventing append of already accepted bets.
- SAFETY/LAG validation is directionally sound as a startup invariant, subject to implementation tests and restart behavior.

## Gates retained

- Refund execution (`refund_flip` + reclaim) must exist and be tested before frozen valuable markets can be enabled on mainnet.
- The previously raised same-tick fee-outpoint reservation invariant remains OPEN; Batch D does not close it.
- Batch B promotion, production migration/restart, and any expansion of autonomous settlement remain separately gated.

No production DB/config/key change, restart, signing, broadcast, settlement, refund/reclaim, or other funds-path action is authorized by this review.
