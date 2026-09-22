# Codex review — D-032 single-judge closure

## Verdict

**Single-judge direction is supported, but D-032 is not yet sufficient for valuable/autonomous judged-market enablement.** Removing the second Polymarket/UMA adjudicator correctly eliminates the previously confirmed cross-source proposition-identity defect and polarity mismatch class. It does **not** by itself bind the human-facing market proposition/title to the sole machine predicate/source/event.

## Independent findings

1. **Dual-judge defect: materially removed by design.** Rejecting `outcomeConditionId` / polymarket-shaped judged inputs, removing the UMA derivation branch, and reducing promotion eligibility to the canonical extractor eliminates the earlier case where ESPN and Polymarket could answer different propositions while being mapped into one 0/1 space.

2. **Remaining MUST — question/title ↔ machine proposition identity binding.** A single judge can still deterministically settle the wrong question if an operator creates a title such as “Lakers win?” while the frozen ESPN URL/predicate identifies another game/team/metric. `validateResolutionPredicate`, source whitelisting, dry-run, `side_map`, and deadline checks validate syntax/executability, not semantic identity between the displayed proposition and the machine-resolved proposition. A non-blocking TypeSafe advisory does not close this invariant.

   Before valuable/autonomous judged markets, creation must freeze a machine-readable canonical proposition identity and make the displayed question derive from it or require an explicit operator attestation against a rendered canonical statement. At minimum bind/freeze: canonical source event identity, subject/team identity, metric/operator/operand/scale, value time, tie/push rule, and YES/NO side mapping. Prefer generating the public resolution sentence/title from these fields rather than accepting an unrelated free-form title as authoritative.

3. **Public view change is good but should expose identity, not only rule mechanics.** `judge:{kind,predicate,tie_rule,value_time}` is useful. It should also expose the canonical event identifier/participants (or equivalent source identity) used by the extractor, so a reviewer can verify that the displayed market and resolver refer to the same event.

4. **Human-only metadata labeling is correct.** `secondary_sources`, `ambiguity_handler`, `dispute_keywords`, and `edge_case_examples` should not be represented as automated adjudication controls while the pipeline does not consume them. Removing them from mandatory machine-safety claims is supported.

5. **`unexpected_verdict_kind` fail-closed guard is supported.** Keeping a guard for impossible non-extractor verdicts is appropriate even after deleting the second adjudicator. It should remain a system-fault freeze, not a normal disagreement path.

6. **No production authorization.** Adapter default-OFF and Owner-specific valuable-market gate remain required. This review does not authorize migration, restart, signing/broadcast, settlement/refund automation, relay funding, or any mainnet funds-path change.

## Required evidence before closing D-032

- Negative creation test: valid ESPN source/predicate for event B paired with a human title/proposition for event A must be rejected or forced through explicit attested canonical rendering; it must not silently create an autonomously resolvable market.
- Mutation-proof test: remove/bypass the proposition-identity check and prove the negative test turns RED.
- Round-trip/public-view test: the frozen canonical event identity + predicate + tie/push rule + YES/NO mapping rendered to users must match the values actually consumed by the resolver.
- Existing single-judge tests should additionally prove polymarket/UMA-shaped inputs are rejected and non-extractor verdicts fail closed.

## Gate status

- D-032 single-judge architectural pivot: **SUPPORTED**.
- Previous cross-source identity/polarity defect: **REMOVED BY DESIGN**, pending implementation tests.
- Human question/title ↔ sole machine proposition binding: **OPEN MUST**.
- Valuable/autonomous judged markets: **HOLD**.
- Production/mainnet funds-path expansion: **HOLD**.
