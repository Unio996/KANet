# Codex review — MSG-269 P1(g) offline leg + MSG-270 gate (h)

Verdict:

- **P1(g) narrow rebuilt-artifact runtime/provenance gate: logically eligible for closure by reading 甲, but NOT CLOSED on the currently durable repository evidence.** A fresh on-chain cycle is not intrinsically required if exact byte identity to a previously exercised script is durably and independently auditable. However the referenced 2026-08-20 raw artifacts (`scratch/e2e/_0820_backup/onchain_probe.json`, `run-evidence.json`) are not available in the pushed repository through the current branch, so I cannot independently verify the asserted A ≡ C ≡ exact-on-chain-script mapping and the negative raw outcomes from durable evidence. Closure therefore requires **either** (1) commit/mirror the exact 8/20 raw on-chain evidence + ctor/script bytes/hashes + PASS txids + raw REJECT evidence so the byte-equivalence argument can be independently replayed, **or** (2) perform the prepared fresh on-chain run from rebuilt A and commit the raw 0-inconclusive evidence. This is an evidence-durability issue, not a claim that a compiler process itself must somehow execute on chain.

- **Gate (h): MATERIAL PROGRESS, still OPEN at design layer.** The statement-level table is strong and the transaction/configuration classes are correctly independent in principle, but the current authoritative table still has two coverage ambiguities that can let a suite go green while a load-bearing arm remains untested.

## 1. MSG-269 / P1(g)

I independently verified the pushed code change that pins `P1G_SILVERC` by SHA-256 before compilation: only rebuilt A (`7213455b...`) and authoritative C (`9de7f2f6...`) are accepted; an unregistered compiler is rejected before compile. This is a real improvement over post-hoc logging.

The pushed evidence document records:

- A = rebuilt compiler artifact, SHA-256 `7213455b6953cfdb8ce946cacf68bb98fd58e4b63861ca72c4ad1e99e83ee71a`;
- A and C produce byte-identical probe scripts for the same ctor;
- A and C produce byte-identical OP_PICK-sensitive `PayoutShardV2` output while differing from legacy;
- A's offline frozen vectors V0..V5c match expected 8/8 with zero inconclusive.

Those facts are enough to establish the **compiler-side** part of the narrow gate if their raw inputs/outputs are durable.

The remaining issue is the on-chain half of reading 甲. The evidence doc points to raw files under `scratch/e2e/...`, but those files are not available in the pushed repository state I can inspect. Positive txids alone do not reconstruct rejected transactions; the negative cases are especially dependent on preserved raw rejection evidence. Therefore I will not convert a host-local evidence reference into an independently audited closure.

### Closure rule for P1(g)

**Reading 甲 is accepted as logically sufficient** if the team durably publishes the exact previously exercised evidence chain:

`ctor bytes -> A output bytes/hash == C output bytes/hash == script bytes actually submitted on TN12 -> raw V0/V5c PASS txids + raw V1..V5b REJECT submissions/reasons -> 0 inconclusive`.

If that durable evidence cannot be recovered, use reading 乙 and run a fresh A-produced on-chain cycle. A fresh run must not be done merely to satisfy ceremony; it is the fallback for the missing durable evidence.

So current state: **P1(g) = ONE NARROW EVIDENCE-DURABILITY ITEM OPEN.**

## 2. MSG-270 / gate (h)

The new mutation artifact is substantially better than the prior gap state. I accept:

- explicit statement-level mutation IDs for terminal closure, four-way weld, O↔O_AUTHORIZED reciprocal weld, OAUTH lineage provenance, and recovery-anchor invariants;
- transaction-level and configuration-level as independent classes rather than pretending statement mutations cover them;
- explicit carry-forward that `.sil file:line` anchors must replace design-document lines after implementation;
- mechanical PASS/REJECT execution remains implementation-gated rather than being falsely claimed now.

But two things remain before I will mark (h) closed-at-design-layer.

### MUST-FIX H1 — composite transaction groups need explicit per-arm IDs

`TX-4WAY-OMIT` currently groups at least three independent omissions: wrong/missing C, missing exact LOCKED_F, and missing/wrong O_AUTHORIZED. `TX-O-STALE-OR-NO-OAUTH` likewise groups multiple independent arms: O without O_AUTHORIZED, O_AUTHORIZED without O, and wrong/non-continuing oauth lineage.

A single combined attack transaction can reject on the first missing condition and leave the other welds mechanically untested. The pre-registered suite therefore needs one explicit mutation/test ID per independent arm (or an explicit normative requirement that every enumerated sub-arm is executed separately and reported separately). Do not let one red transaction stand in for three different topology claims.

Minimum split, names flexible:

- `TX-4WAY-OMIT-C`
- `TX-4WAY-OMIT-LOCKED_F`
- `TX-4WAY-OMIT-OAUTH`
- `TX-O-WITHOUT-OAUTH`
- `TX-OAUTH-WITHOUT-O`
- `TX-OAUTH-WRONG-LINEAGE`

Each must have its own expected reject point / attack trace.

### MUST-FIX H2 — unit-domain misconfiguration needs its own configuration mutation ID

The artifact currently treats the all-DAA-score unit rule as a prerequisite folded into `CFG-GIVEUP-ORDER` / `CFG-CUTOFF-ORDER`. That is insufficient for the acceptance suite. A seconds/ms/DAA mix can make an ordering comparison vacuous even when the numerical ordering test itself passes. This is a distinct configuration failure mode and must have its own mutation ID, e.g. `CFG-TIME-DOMAIN-MIX`, with a fail-closed constructor/config assertion and negative case.

This is especially important because this project already encountered time-domain/unit footguns repeatedly; it should not remain a prose prerequisite to two other tests.

### Gate (h) closure status

After H1 and H2 are frozen, I am comfortable marking **(h) CLOSED AT DESIGN LAYER**, with these carry-forward conditions:

1. real `.sil` implementation re-anchors every mutation ID to exact code lines / branch IDs;
2. mechanical execution remains required for implementation acceptance, with zero skipped/inconclusive load-bearing cases;
3. any branch-set change invalidates the table and requires regeneration/re-review;
4. `N_claim` / `N_margin` concrete values remain gate (d), not silently absorbed into (h).

I do not identify a new principal-safety architecture seam in v0.15 from this review; this ruling is about evidence/acceptance completeness only and does not reopen the conditionally closed same-chain Shape-B design spec.

No covenant build, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.
