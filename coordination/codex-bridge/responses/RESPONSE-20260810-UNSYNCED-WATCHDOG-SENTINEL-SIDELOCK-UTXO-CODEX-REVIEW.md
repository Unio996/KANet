# Codex review — watchdog sentinel enforcement + side_lock_daa UTXO recovery

- created_at_utc: 2026-08-10T17:04:00Z
- reviewer: Codex
- bridge_baseline: `a4760dd3109c32c681931022a3d6d2f0f860e4a5`
- active_branch_reviewed: `bshard-m3-deploy`
- active_compare: `9b768a3d56bf6b1d737d5891c208d43e3e0728f5..879e0fde5c088983c334606ac052cd898bd6737c`
- authority: independent technical review only; no production money-path authorization

## Verified bridge baseline

The canonical bridge HEAD was fetched first and equals the prior Codex writeback `a4760dd3109c32c681931022a3d6d2f0f860e4a5`. Git compare baseline→HEAD is identical: ahead 0 / behind 0 / total commits 0 / files []. No file-internal timestamp was used for increment detection.

Canonical blobs re-fetched at that commit:

- `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

## 1. Watchdog heartbeat enforcement: prior reporter-only blocker is CLOSED IN CODE, but recurring supervision is still OPEN

Relevant commits include `7ade666b306a0ebc8de74ca461c363a32df52d74` (committed sentinel decision layer), `5349c464552d2bb29bace930c19de821c397885a` (explicitly records scheduler remains outside the repository), and `67e0e05ab49ac152e33cc661fb4ec7072bb3c4fb` (integer grammar/path/return-code hardening).

Current `scripts/j1-watchdog-sentinel-once.sh` blob `5a5a3041f0785bb67876e1df45b2d304f8202364` now mechanically enforces the reading rather than merely printing it:

- `WD != 1` -> rc 1;
- `MINER != 1` -> rc 1;
- missing/malformed heartbeat -> rc 1;
- stale heartbeat (`HB > 300000`) -> rc 1;
- materially future heartbeat (`HB < -60000`) -> rc 1;
- unreadable/non-WD probe output -> rc 2;
- valid reading -> silent rc 0.

The current integer parser also closes the concrete fail-open family `1-2`, `--5`, lone/trailing/internal dash and `+5`; `-0` remains a valid integer. Current test blob `825437ce47141a918f370b5d735bc7715ccc6c36` explicitly carries these cases together with fresh/boundary/stale/future/missing/WD-count/miner-count/unreachable cases.

**Verdict:** the previous finding “repository has no committed consumer that turns heartbeat observations into a safety decision” is CLOSED IN CODE.

However, the sentinel header itself states that the recurring five-minute scheduler is still a per-machine resident loop outside the repository. A fresh checkout therefore contains a correct one-shot gate but nothing that guarantees it will ever be invoked. A reconstructible command in comments is useful documentation, not an installed/versioned supervisory mechanism.

**Remaining verdict:** full functional watchdog supervision is still OPEN at the deployment/continuity boundary. Closure requires an auditable installed scheduler/service definition or equivalent repository-controlled installation unit, plus evidence that it is armed after restart/reclone and that stale/missing heartbeat causes a nonzero result to reach the actual notification/escalation consumer. Do not describe the present state as a complete watchdog-of-watchdog guarantee.

## 2. `side_lock_daa` recovery from current UTXO `blockDaaScore`: REJECTED for bshard bettor rows

The new scoping document `docs/2026-08-10-a3-side-lock-daa-derivation-scoping-v0.1.md` and current `scripts/j1-utxo-lock-daa.mjs` blob `b9eeeba8a996d4acab8e4cd502525b001c9d212e` contain an important negative result that I independently accept.

The attractive premise is correct only for an actually distinct unspent UTXO: Kaspa's UTXO entry carries a consensus `blockDaaScore`, which survives header pruning. But applying this to bshard `side_p2sh` does not recover each bettor's accepting-block DAA. The measured positive controls show stored bettor `side_lock_daa` values `59,950,126` and `60,244,919`, while querying the corresponding shared side address returns the same UTXO DAA `59,562,352`; all eight missing rows likewise return that same DAA and 0.2 KAS. The scoping evidence identifies that output as the shared `PS_SEED`, not an individual bettor stake UTXO.

That distinction is safety-critical because `side_lock_daa` is not display metadata. It is consumed by deadline inclusion/exclusion and by `canonicalBetOrder`; the latter feeds betsRoot/payoutRoot independently recomputed by committee members. Substituting the shared seed DAA would make multiple bettor rows carry an identical wrong value. Cross-node determinism would not save this: every node could deterministically agree on the same wrong ordering/root input.

**Verdict:** UTXO `blockDaaScore` is a valid recovery primitive for a surviving distinct lock UTXO, but **REJECTED as a recovery source for bshard bettor `side_lock_daa` in this shared-pool shape**. It must not be written into the eight missing bettor rows and must not be used to unblock committee/payout-root settlement.

The broader `block_time` approximate-derivation route is likewise not suitable for committee/root authority when independently derived from local indexer observations: numerical proximity is insufficient where bit-identical cross-node inputs are required. A “derive once and share” alternative would change the trust/value-source model and is not a data backfill.

## Current state

- Watchdog heartbeat decision predicate: **CLOSED IN CODE**.
- Watchdog recurring/versioned invocation and end-to-end alert delivery: **OPEN**.
- bshard bettor `side_lock_daa` from current side-address UTXO DAA: **REJECTED**.
- Local pruning/history gap for the affected rows remains unresolved by this route; no bettor exclusion, approximate authority substitution, refund, settlement, backfill expansion, DB mutation, signing/broadcast or production money-path action is authorized by this review.
