# Codex review — MSG-20260827-273 / MSG-20260827-274 · gate (d)

Verdict: **proof-structure materially improved; gate (d) remains OPEN / PROVISIONAL.**

## 1. D-MUST-FIX-1

**PASS at proof-structure level.**

The prior invalid statement that weak `N_claim` evidence is simply “absorbed by `N_margin`” is gone. The new structure correctly separates:

- named timeline components (`M_observe`, `N_claim`, `M_reorg`, `M_congest`),
- a separate explicitly unallocated slack `S_unalloc`, and
- a hard prerequisite that real claim-shape depth data must exist before `N_claim` becomes evidence rather than a placeholder.

Important carry-forward: `S_unalloc = 2 × N_claim` is still a declaration, not evidence. It cannot become deployable merely by being named; the ≥30 real claim-shape sample rule must replace the placeholder sizing.

## 2. D-MUST-FIX-2 / B_win

### Qualitative boundedness: ACCEPTED

MSG-274 corrects MSG-273 in the right direction.

For a fixed finite injected-hash ratio `k`, the qualitative claim that the DAA pump is bounded is credible under the cited difficulty/timestamp model: to prevent difficulty from hardening while blocks arrive k× faster, the sampled timestamp span must be kept large; sustained artificial expansion requires timestamps to run ahead of receiver wall-clock, and published blocks are constrained by the +132 s future-timestamp rule. Lagging timestamps shrink the measured window and therefore harden difficulty faster, so they do not provide an unbounded DAA-pump channel.

Therefore I accept the structure:

`B_win = f(k_max)`

rather than the retracted “unbounded for any miner-controlled timestamps” conclusion.

### Numerical curve: NOT YET independently auditable

I do **not** yet grant closure credit to the specific numerical table (`k=1000 -> 53,070`, `k=1e6 -> 75,749`) or to the statement `55,200 <=> k_max ~ 1000` as durable independent evidence.

The pushed simulation report explicitly says the load-bearing scripts are:

- `scratch/_nwt_bwin_sim.mjs`
- `scratch/_nwt_bwin_adversarial.mjs`

and that they are **gitignored**. I can read the table and the team's reproduction claims, but I cannot independently inspect or rerun the actual algorithm from the durable repository. For this review protocol, a reported table is not a substitute for the test/simulation source that produced it.

**MUST before the numerical B_win bound is usable:** push the exact simulation source (or an equivalent durable derivation script) plus the exact parameter set / source commit and expected output hashes/table. Then the `f(k)` curve can be independently reproduced.

The qualitative boundedness argument does not depend on this missing artifact; the numerical deployment bound does.

## 3. k_max policy

I do **not** recommend naming `k_max = 1000` as an acceptable public-testnet Tier-2 security assumption on today's near-zero-hashrate TN12.

The ratio is only meaningful relative to a credible pre-attack honest-hash baseline. On a nearly empty network, “1000× current hash” may still be operationally cheap, so the assumption is weak exactly where the protocol would rely on it most.

Preferred policy shape:

1. Owner defines the tolerated adversarial mining budget / trust model, not Codex by fiat.
2. Tier-2 additionally requires a **minimum stable honest-hash baseline** (or equivalent network-difficulty/hashrate floor) measured over a named pre-entry window.
3. Derive the admissible `k_max` from that floor and the stated adversarial budget.
4. If the baseline falls below the floor, Tier-2 fails closed; do not silently keep the old ratio.

If Owner explicitly chooses `k_max <= 1000` despite the near-zero baseline, it must be described as an **experimental weak trust assumption**, not adversarially robust public-testnet security. My recommendation for the north-star Tier-2 claim is to wait until the network has a credible stable hashrate floor, or otherwise keep Tier-2 disabled / experimental-only.

## 4. Censorship channel

**Accepted as out-of-model only under the already explicit bounded-inclusion/reactive-liveness assumption.**

One wording correction: “pump and censorship are mutually exclusive” is too strong if read as a whole-strategy statement. The same miner cannot use the same timestamp mode simultaneously to maximize future-timestamp DAA pump and deep past-timestamp desynchronization, but an adversary can **sequence** phases (pump, then censor, or vice versa). This does not require `N` to cover censorship because censorship is already outside the bounded-inclusion model; it does mean the proof should say “mechanistically incompatible in the same phase,” not “globally mutually exclusive attacks.”

## 5. P3 fee-source model

**PASS at structure/model level; design choice still OPEN.**

The v0.2 model correctly identifies that the current Shape-B pseudocode does not globally cap ordinary input count, so the claim transaction can add an ordinary fee input. It also correctly separates sompi-domain fee reserve from DAA-domain latency/margin and identifies T5 claim as the principal-safety-sensitive fee path.

Between the two choices, I recommend **(b) allow extra ordinary fee inputs** for the current design direction. It avoids the structural failure where future mass/fee changes make a fixed O-funded claim unspendable, while keeping recipient/value/covenant provenance welded by the existing Shape-B constraints. The tradeoff is explicit: claimant/watchtower must be able to fund fees.

If (b) is selected, `min_O` must be redefined only around the O/storage/value-floor function it truly serves; claim fee reserve belongs to claimant/watchtower operating readiness, not to `min_O`.

This recommendation is report/design-layer only and does not authorize modifying v0.15 or production code.

## 6. Residual gate (d) list after this review

The remaining deployment-side items are:

1. ≥30 real **claim-shape**, depth-qualified observations for `N_claim` and dispersion / `S_unalloc` sizing.
2. Post-sync `W_dis` operating-envelope evidence with both wall-clock duration and reference/network DAA advance.
3. Durable/reproducible B_win simulation/derivation source, then a named Owner-approved `k_max` tied to a credible hash-rate/difficulty floor.
4. Final P3 choice `(a)` vs `(b)`; recommendation = `(b)`.
5. Named conservative final constants after the above evidence; environment violation must fail closed.

Watchtower multiplicity may reduce observation risk only if the observers are truly independent failure domains. Multiple relays on the same KANet host remain N=1 for this purpose.

## 7. Status

- D-MUST-FIX-1 proof structure: **CLOSED**.
- D-MUST-FIX-2 qualitative boundedness structure: **CLOSED**.
- B_win numerical curve / 55,200 deployment value: **OPEN — durable simulation source missing**.
- `k_max` policy: **OPEN — Owner decision; k=1000 not recommended as a robust near-zero-hashrate public-testnet assumption**.
- censorship: **out-of-model under bounded-inclusion; wording must allow sequential composition**.
- P3 fee-source structure: **PASS**; design choice remains OPEN, recommendation `(b)`.
- gate (d) overall: **OPEN / PROVISIONAL**.

No covenant build, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.
