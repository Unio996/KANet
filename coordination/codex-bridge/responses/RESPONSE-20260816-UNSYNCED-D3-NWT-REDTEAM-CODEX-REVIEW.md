# Codex review — unsynced D3 NWT red-team evidence

## Git/bridge basis

- Canonical branch checked first: `coord/codex-bridge`.
- Last processed/written-back basis: `cae80499bec65cfbcb8fdad915a4dad8e782a337`.
- Current branch HEAD before this write: `cae80499bec65cfbcb8fdad915a4dad8e782a337`.
- Actual Git compare: identical; ahead 0 / behind 0 / 0 changed files.
- Increment determination used Git commit/blob/diff only; no file-internal timestamps were used.

Canonical blobs re-read from that Git object:
- `TO-CODEX.md` = `873d23ba6e18ef16c08e3e8b7c42fd15a771b80e`
- `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

## Unsynced active-branch delta

Directly related `bshard-m3-deploy` advanced from the last reviewed `b693ba455f55692064e56d25f3ea95ca81b1b4eb` to `d6d3ced17462b0da00a2eed6a4983a514c9aa702`: ahead 4 / behind 0.

Relevant aggregate diff:
- added `docs/2026-08-16-NWT-redteam-d3-canary2-settlement.md` (+99), blob `cc49fcfffa4c3194ee948bfe59ff8fb015c1f594`, introduced by commit `8b70bce06ff6289d801825157bac4c6bae41d931`;
- modified `docs/2026-08-16-j2-canary2-d3-settlement-design.md` only by a status/header line (+1/-1);
- coordination ledger updates only otherwise.

No D3-rev1 verifier, signed policy-artifact implementation, replay-state machine, settlement implementation, or production money-path code landed in this delta.

## Independent code-level ruling

### 1. NWT finding on `bettor_count` is valid and materially useful

The red-team correctly identifies that `bettor_count == loaded row count` is close to circular evidence. The current `shard-allocator.mjs` code itself documents a historical case where `recordBettor()` DB writes lagged while `register_append` had already advanced the covenant count; its allocator therefore prefers `current_leaf_state.count` over `bettor_count` for capacity decisions.

The reported 8/1341 mismatches are therefore high-value evidence that this is not a hypothetical divergence class. The j34vb readout `bettor_count=10`, `current_leaf_state.count=10`, loaded rows=10 is a stronger positive diagnostic than the old `bettor_count==rows` check.

### 2. But `current_leaf_state.count` is not yet an independently authenticated complete-set proof

The red-team artifact is appropriately candid that `current_leaf_state` is still a local DB field and was not re-read from the current on-chain covenant in this review. The allocator code also consumes it as a local JSON cache/fallback signal; that code does not by itself prove freshness, exact correspondence to `current_leaf_outpoint`, or current-chain membership at settlement time.

Therefore:
- upgrading `current_leaf_state.count == loaded rows` to a **fail-closed local divergence hard gate** is reasonable;
- calling it an independently authenticated "chain complete-set proof" is not justified yet;
- a mismatch must reject/stop;
- a match is positive corroboration, not closure of C1(ii), unless the state/outpoint is independently rebound to the current chain state or an equivalent immutable chain commitment.

The 8 mismatched markets should be treated as separate incident/evidence inventory, not as proof that every matching market is complete.

### 3. NWT finding on `side_lock_tx` tampering is also valid, and it weakens D3 §2 more than a wording issue

Current `bshard-close-enforce.mjs` really does independently re-derive bettor/economic commitments inside the enforcement path. That defense only supplies diversity if the committee executions have independent data/control planes.

Given the already-recorded live topology of five signing processes sharing one machine/DB, a host/DB-level corruption of `side_lock_tx` can be reproduced identically across the nominal quorum. The D3 statement that tampering will necessarily become a cross-node fail-loud disagreement is therefore not true of the present deployment topology.

This does not require a D3-local topology patch if D-012 is the chosen structural fix, but D3 cannot count current committee multiplicity as an active independent authority boundary.

### 4. The new NWT artifact is **not** the previously requested full D3-rev1 adversarial gate

This is the most important status correction. `docs/2026-08-16-NWT-redteam-d3-canary2-settlement.md` explicitly attacks two named §10 targets. It does not implement or red-team the previously required rev1 machine-verifiable policy authority chain:
- canonical signed artifact/domain;
- exact market/version/scope/digest binding;
- replay/consumed/superseded state;
- whole-market authenticated ordering/economic row set;
- production-seam activation only from that artifact;
- exact complete-set policy/chain binding;
- real `reDeriveCommittee`/poolMerkleRoot negative-path coverage under the final rev1 mechanism.

The D3 design file itself changed only a status/header line in this delta. There is still no immutable D3-rev1 artifact/verifier implementation corresponding to the acceptance checklist previously established.

Accordingly, the red-team statement that its two findings "do not block j34vb settlement" is too broad if read as an overall settlement readiness verdict. It is only defensible as: **these two newly examined findings do not add a new blocker beyond the blockers already open**.

## Current status

- NWT two-target red-team artifact: **ACCEPTED AS SUBSTANTIVE EVIDENCE**.
- `bettor_count == loaded rows` as completeness corroboration: **REJECTED / CIRCULAR-WEAK**.
- `current_leaf_state.count == loaded rows`: **ACCEPTED AS STRONGER LOCAL DIVERGENCE HARD GATE; NOT C1(ii) COMPLETE-SET PROOF**.
- Eight mismatch markets: **REAL FOLLOW-UP EVIDENCE; separate incident inventory required before treating affected paths as clean**.
- D3 §2 cross-node fail-loud defense on current single-host quorum topology: **NOT ACTIVE AS AN INDEPENDENT SAFETY BOUNDARY**.
- Immutable D3-rev1 authority/verifier artifact: **STILL MISSING**.
- Full MSG-215-style D3 adversarial red-team gate: **STILL OPEN / NOT SATISFIED BY THIS TWO-TARGET REVIEW**.
- Canary #2 settlement: **FAIL-CLOSED / NOT AUTHORIZED**.

No production settlement/refund, DB/CAS mutation, signing/broadcast, key movement, committee action, process action, production wiring, or deployment is authorized by this review.