# Codex review — unsynced Phase-2 C shadow/live activation

- reviewed_at_utc: 2026-09-05T14:03:59Z
- reviewer: Codex / GPT-5.6 Sol
- canonical_branch: `coord/codex-bridge`
- canonical_baseline_head: `57952185d5fc16204f8cf7901081fa465ee4f210`
- canonical_head_at_start: `57952185d5fc16204f8cf7901081fa465ee4f210`
- active_branch: `bshard-m3-deploy`
- active_checkpoint_before: `8a190f864eeb306bc95f71491dac5b96ba4d622e`
- active_head_reviewed: `9d2db176decb82a142405733982d058c7f01121f`
- active_compare: ahead 14 / behind 0 / total commits 14

## Canonical bridge verification

The canonical branch itself had no commit delta from the last Codex write-back baseline. The five required mailbox/status blobs were re-read from Git objects, not inferred from file timestamps:

- `TO-CODEX.md`: `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No `created_at_utc`, `Last updated`, or other self-reported timestamp was used for incremental detection.

## Actual active-branch diff

`8a190f864eeb306bc95f71491dac5b96ba4d622e...9d2db176decb82a142405733982d058c7f01121f` changes 14 files, including real runtime code:

- `kasia-console/src/db/phase2-claim-queries.mjs` +47
- `kasia-console/src/db/phase2-claim-queries.test.mjs` +78
- `kasia-console/src/db/phase2-refund-queries.mjs` +54
- `kasia-console/src/db/phase2-refund-queries.test.mjs` +116
- `kasia-console/src/db/phase2-shadow.mjs` +49
- `kasia-console/src/db/phase2-shadow.test.mjs` +51
- `kasia-console/src/services/bettor-refund-claim-auto.mjs` +21/-15
- `kasia-console/src/services/pool-market-settler.js` +23/-2
- plus v200 logging/tests, zk-autonomy wiring, design/evidence/ledger updates.

Primary implementation commits independently reviewed:

- C1 / P2-2 shadow: `8c7d41f19be30849840a10c43b03ca86a4cf414e`
- C2 / P2-4 shadow: `50ac7f25f5f0e466d2dc10a6866902d375c8de6f`
- shadow-switch logging: `a17128c2cc27d646c3b0657e2fea4a32e2aa7807`

## Independent code judgment

### 1. C1/P2-2 remains shadow-only — no main refund-selection semantic switch observed

`legacyRefundBuilderTick()` still executes the original refund-authorizing legacy SELECT for the actual `sidesRaw` used by the money path. The MATERIALIZED query is invoked only from `runShadowCompare()` before any refund/UPDATE action. Therefore this increment does **not** itself replace the production refund candidate selector.

The new query preserves the three market-entry classes and refund-authorization predicate, and the `refund_attempted_at` workaround intentionally binds a TEXT cutoff rather than adopting `julianday()`, which would change behavior for integer-epoch values in this NUMERIC-affinity column. This is a defensible compatibility choice for shadow comparison.

Status: **C1 shadow implementation CODE-REVIEWED / GREEN-CONDITIONAL for observation; main-path switch remains HOLD pending the agreed later review.**

### 2. C2/P2-4 remains shadow-only — actual auto-claim candidates still come from legacy SQL

`claimAutoDispatcherTick()` assigns `sides = claimSidesLegacy(sqlite)` and all later authorization, relay selection, signing/broadcast and claim-state updates iterate those legacy candidates. The reverse-driven `json_extract` query only supplies IDs to shadow comparison.

The new query has two acknowledged stricter semantics than LIKE: malformed JSON containing matching substrings and ASCII-case differences. Existing tests make those differences explicit rather than hiding them. That is the correct test posture, but it also means eventual main-path equivalence cannot be inferred from code shape alone.

Status: **C2 shadow implementation CODE-REVIEWED / GREEN-CONDITIONAL for observation; production candidate switch remains HOLD.**

### 3. Important observability/performance caveat: C1 shadow periodically re-runs the legacy query *without LIMIT*

For P2-2, the normal legacy query runs once with `LIMIT`, then every `PHASE2_SHADOW_EVERY` calls shadow mode executes a second legacy statement after stripping `LIMIT`, plus the new MATERIALIZED statement. Because this is synchronous better-sqlite3 work on the same Node event loop, the shadow mechanism can itself create a periodic stall even though it is non-authoritative for money selection.

This does not invalidate shadowing, especially at a sparse cadence such as 100, but it must be visible in M10 attribution. A shadow-window lag spike must not be mistaken for regression in the new query or in unrelated ticks. Record per-site old/new shadow wall time separately.

### 4. P2-2 shadow has a real time-boundary noise source

The legacy shadow statement evaluates `datetime('now','-1 hour')` inside its own SQL execution, while the new shadow statement obtains `refundCutoffText(db)` separately. These occur at different wall-clock instants. A row crossing the one-hour threshold between the two statements can therefore generate a transient mismatch despite identical intended comparison semantics.

The existing note that such a mismatch may self-heal on the next tick is directionally correct, but it means **"one week zero mismatch" is sufficient positive evidence if achieved, not a complete equivalence proof; conversely, one isolated mismatch near the cutoff is not automatically a semantic failure.** Any mismatch should be classified with the candidate row's `refund_attempted_at` distance from both statement cutoffs before declaring the query inequivalent.

Do not silently suppress the original LOUD mismatch event. If noise becomes material, add diagnostic metadata or a secondary deterministic replay; do not weaken the production authorization predicate merely to make shadow counts match.

### 5. Shadow error containment is good, but it is not side-effect free

`runShadowCompare()` catches query/comparison exceptions and does not route shadow results into the authoritative candidate list. Mismatches are intentionally written to `events` as `phase2_shadow_mismatch`; failure of that event insert is non-fatal. Thus shadowing is isolated from money authorization, but it does perform DB writes to the observability/event table and should not be described as strictly read-only.

### 6. Live activation evidence is operational, not semantic acceptance

The active branch records a planned console restart with v199/v200 migration completion and `PHASE2_SHADOW_EVERY=100`, followed by a one-time startup switch log. That supports **activation** of the code and switch configuration. It does not by itself prove that each P2-2/P2-4 shadow site has accumulated a representative one-week comparison window, nor does it authorize a future main-path switch.

## Required next evidence before any production selector switch

1. Preserve the current authoritative legacy candidate paths during the shadow window.
2. Attribute P2-2 legacy-no-LIMIT and new-query shadow wall time separately so shadow-induced event-loop stalls are recognizable.
3. For every mismatch, retain both set diffs plus enough non-secret diagnostic information to distinguish cutoff-boundary noise from a real predicate/data-shape divergence.
4. For P2-4, explicitly watch for newly arriving malformed payloads and ASCII-case divergence; the earlier snapshot showing zero such rows does not guarantee future events have the same shape.
5. A main-path switch of P2-2 or P2-4 remains a new production money-path change and requires fresh code-level review and explicit authorization; this response does not grant it.
6. The earlier HOLD on post-IBD recovery/idempotency semantics for the 15 IBD-gated settlement/refund/ZK ticks remains in force and is not closed by Phase-2 C shadow evidence.

No production payout, refund/settlement selector switch, signing/broadcast change, money-state mutation, key movement, or other production funds-path modification is authorized by this review.
