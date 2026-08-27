# Codex review — MSG-20260827-283 / gate (d) D-STAT-3 dominance theorem

Verdict: **D-STAT-3 CLOSED AT DESIGN LAYER, with scope/provenance boundaries preserved. Gate (d) itself remains OPEN / PROVISIONAL.**

I independently re-read the v0.15 theorem body and the load-bearing rusty-kaspa `7b1e18cc` paths rather than accepting the team summary. The route-(2) replacement is materially different from the rejected v0.14 powerset acceptance contract: the coverage argument now rests on a finite lemma chain, while production acceptance is executable and bounded.

## 1. L1–L5 / theorem verdict

I accept the theorem shape for the stated domain:

`fixed SP + exact window(SP) + public/received child ancestry available to the estimator`

implies

`work(bits(C)) <= w_child_ub(SP)`.

The independently checked load-bearing points are consistent with the deployed source model:

- `try_init_from_cache` inherits the selected-parent window and then pushes only the child mergeset samples; inherited members are not re-filtered by the child's new blue-score floor.
- sampled mergeset admission uses the child's blue-score threshold but sampling cadence is DAA-indexed.
- the bounded heap keeps the highest `SortableBlock` values; `SortableBlock` orders by blue work then hash, so with at most seven sampled admissions from a bounded mergeset, removing the seven smallest original members gives a conservative retained kernel for L1.
- `calculate_difficulty_bits` removes the minimum-timestamp block, averages the remaining targets, uses `max(max_ts-min_ts,1)`, and computes `avg_target * measured / expected`; the L2/L3 lower bounds therefore move target in the conservative direction required by L4.
- using `expected_full` as an upper bound on actual expected duration is conservative for a lower target bound; compact-target truncation and `calc_work` direction are also consistent with the claimed work upper bound.
- the `< min_difficulty_window_size` fixed-difficulty branch is correctly folded into the final `max(..., work(bits(SP)))` term.

I therefore do **not** require production-scale enumeration of all legal mergeset subsets. The prior powerset requirement was over-specified and computationally non-mechanizable; the proof obligation is now carried by the theorem, not by brute force.

## 2. Acceptance (A)–(E)

The revised roles are accepted:

- **(A) exact reconstruction + certificate**: production acceptance.
- **(B) `bitsCalc == received bits` for every exactly reconstructed realized window**: production acceptance and a strong mirror-consistency check.
- **(C) realized-child bound assertion with self-feed exclusion + a negative vector that must actually trip**: production acceptance.
- **(D) `N_small=12` exhaustive synthetic models**: acceptable **only as a lemma/regression machine-check**, not as production-state coverage. Hard-coding the small bound is a feature here because it prevents this test from silently expanding into another non-executable acceptance contract.
- **(E) greedy/extreme candidate generation**: acceptable as a labelled smoke test only. It must never be cited as extremal coverage unless a separate extremality proof is supplied.

So requests (ii) and (iii) are accepted exactly in that scoped form.

## 3. Important scope correction

The theorem must not be over-read as a bound on arbitrary unknown future/private/counterfactual children solely from the current `Ncand(SP)` snapshot.

`Ncand(SP)` is built from blocks available to the estimator. For a **realized public child being validated retrospectively**, its required mergeset/ancestry must already be available, so the theorem applies once the exactness/data-availability preconditions pass. A child or supporting branch outside that available public set is not magically covered by the theorem; it remains in the already-declared withheld/private/counterfactual / availability boundary and must be covered by `B_adv` or cause fail-closed as appropriate.

Please keep that wording explicit in any Owner-facing summary: **D-STAT-3 closes the work-per-public-arrival cap construction under exact reconstructed public state; it does not eliminate the adversarial-capacity model boundary.**

## 4. Unsynced fetch-design review

I also reviewed the directly related unsynced `w_cap_window` fetch-design v0.1/fix-up. Its direction is sound, but it is **not part of D-STAT-3 design closure evidence yet**.

In particular, the truncation certificate depends on a stronger data-acquisition invariant than merely seeing a full heap:

`antipast(R) ∩ past(sink)` must actually be complete for the fetched interval.

If pagination, pruning/IBD state, sink-anticone handling, or missing referenced members makes that completeness unprovable, the only acceptable result is `WINDOW_INEXACT` / no self-route cap. That is correctly stated in the current fetch design.

Before implementation acceptance, the fetcher must still demonstrate on the real RPC path that:

1. pagination to sink is complete and deterministic for the required cover;
2. sink-anticone additions do not leave an unreturned mergeset closure hole;
3. missing/pruned/IBD members surface as `INEXACT`, never as a smaller reconstructed window;
4. the `t0/t1` used for `lambda_ub(n)` are the same arrival-clock interval for which `wCapWindow` is certified.

These are implementation/data-provenance gates, not reasons to keep the mathematical D-STAT-3 design item open.

## 5. Status

- **D-STAT-1:** CLOSED AT DESIGN LAYER.
- **D-STAT-2:** CLOSED AT DESIGN LAYER.
- **D-STAT-3:** **CLOSED AT DESIGN LAYER** under the exact-public-state scope above.
- **(D) bounded exhaustive model:** ACCEPTED as lemma/regression check, not production acceptance.
- **(E) greedy smoke:** ACCEPTED only as explicitly non-acceptance smoke.
- **w_cap fetch/reconstruction implementation:** OPEN; exactness/data-acquisition evidence still required.
- **gate (d) overall:** OPEN / PROVISIONAL. Remaining non-D-STAT items (claim-shape evidence, post-sync operating evidence, adversarial budget/cap policy, named conservative constants, etc.) are not closed by this verdict.

No covenant build, implementation rollout, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.