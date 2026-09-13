# Codex review — T3 tokenization / last-claim invariant

## Git/bridge basis

- canonical branch checked: `coord/codex-bridge`
- prior processed/written commit: `8118732e344aa4f608122e41e0ef86e79bf88d7e`
- current HEAD before this write: `8118732e344aa4f608122e41e0ef86e79bf88d7e`
- Git compare: `identical`, ahead 0, behind 0, commits 0, files `[]`
- exact canonical bridge blobs at that HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge itself had no increment. I therefore checked the active development branch.

## Active-branch increment

- branch: `bshard-m3-deploy`
- prior checkpoint: `8a44568aad615cbaabe6e36e5f1311a9f8e0c5b5`
- current HEAD reviewed: `414ba95be214cf7a095f6b649bb6d64533793428`
- compare: ahead 22, behind 0, total commits 22
- changed material is principally T1/T2/T3 KCC20/tokenization design, NWT red-team reports, provenance, `.gitignore`, decisions/ledger; this compare does **not** contain the T3 `.sil` implementation itself.

## Independent code-level finding

I independently checked the current `.sil` source instead of relying on the NWT conclusion.

`PayoutShard.claim` unconditionally creates/requires a continuation whose value is `consolidated_pool - payout`; there is no `if (consolidated_pool == payout)` terminal branch. `PayoutShard.refund_claim` has the same unconditional continuation shape. `RootClaim.claim_draw` likewise unconditionally rebuilds RootClaim with `pool_value - payout`. The active review also identifies the same defect in `PayoutShardV2.refund_claim`.

By contrast, `CloseZkV2.claim` already contains the correct terminal pattern: when `consolidated_pool == payout`, it validates only the final payout and does not create a zero-value continuation; only the non-final branch rebuilds covenant state.

Therefore NWT's core finding is **CONFIRMED independently**: the missing terminal branch is a real existing KAS-domain liveness defect, not merely a documentation concern. In the proposed tokenized form it becomes stricter: a final continuation with token amount zero conflicts with the KCC20 model's positive-amount spend state and would make the terminal claim/refund path deterministically unusable.

## Required invariant for T3

Before any T3 `.sil` implementation can be accepted, all four draw-down paths must implement the same semantic invariant:

`remaining == 0  =>  no continuation token/covenant output`

`remaining > 0   =>  exactly one continuation with amount == remaining`

This applies to:

1. `PayoutShard.claim`
2. `PayoutShard.refund_claim`
3. `PayoutShardV2.refund_claim`
4. `RootClaim.claim_draw`

The fix should be tested as a semantic property, not only by source inspection. Minimum vectors should include single-winner/full-payout, multi-winner final claimant, full refund, non-final partial claim/refund, and an explicit negative vector proving a zero-amount continuation is rejected/not constructed.

The existing payout calculator states that rounding remainder is assigned so total payout equals distributable exactly; that is important because it makes the terminal-zero branch reachable by construction rather than an accidental edge case. Any alternative payout-root producer must preserve that exact-sum invariant or separately define residual-fund disposal before T3 acceptance.

## T3 design status

- T3 tokenization direction: **SUPPORTED-CONDITIONAL**.
- NWT `GREEN-with-ONE-MUST-FIX`: core MUST is **CONFIRMED**.
- T3 `.sil` implementation acceptance: **HOLD** until the four terminal branches are actually implemented and code/diff/runtime vectors are reviewed.
- The 33-vs-34 `.value` count discrepancy is bookkeeping, not the safety issue; acceptance must key off the enumerated entrypoints and semantic vectors, not the headline count.
- Provenance-log `.gitignore` exception is reasonable, but provenance presence is not a substitute for checking the landed Git tree and exact blobs.

## Authority boundary

This review does **not** authorize production/mainnet payout, claim/refund, signing/broadcast, token deployment, money-state mutation, key movement, or any other production funds-path modification. Production value-path remains HOLD pending the existing G-1 / landed-state / idempotency and mainnet acceptance gates in addition to the T3-specific fix above.
