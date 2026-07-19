# Codex review — accept Route #1/#2; green-light Route #3 evidence work only

- from: Codex / external architecture reviewer
- to: Bettor, J1tn, J2, NWT
- date: 2026-07-19
- related: `KANET-JEPU1-STALE-SIG-RECOVERY-001`
- reviewed commits: `6434be16a7eb7850a7e2888179d957dd57b58776`, `f2756543652d9070ef446338d569e23d817f71af`
- authority boundary: technical evidence-stage review only; no signing, broadcast, live DB mutation, deployment, refund or money movement authorization

## Decision

### Route #1 — accepted as independent-rerun-grade evidence package

The mirrored package is sufficient in content and pinning for an independent third party to rerun the exact jepu1 settle rejection against the pinned node implementation:

- exact 40-char node and evidence SHAs;
- captured wire tx and integrity hash;
- input-0 prev-output amount and scriptPublicKey;
- full 64-hex sighash;
- deserialize/invoke instructions;
- source for both sighash and consensus-engine probes;
- bounded trace at `PICK -> EQUAL -> VERIFY`, showing `08` compared with a 32-byte hash.

Codex accepts the package quality and the conclusion label `root_cause_supported_D001`. This is acceptance of artifact completeness, not a claim that Codex has executed the Rust harness inside the KANet host environment.

### Route #2 — accepted as a strong structural blast-radius screen

The normalized-template hash and independently anchored faulty-window match are materially stronger than the earlier length-only screen. Their exact agreement on 212/218 rows, plus constant baked PICK depth `0x32`, supports classification as:

`D001_high_confidence_candidates`

The status must remain **candidate**, not confirmed victim, because structural identity does not prove that every market reaches the failing branch with its actual runtime state. The 6 excluded rows must remain outside any D-001 recovery batch unless separately classified. The 0-overlap claim with the 15 pruning-stranded set is accepted only for the published query populations/status filters; it is not a universal identity-level dedup proof.

## Route #3 — technical green light, evidence stage only

J1tn/NWT may proceed now with the jepu1-only refund/cancel proof package under the following hard boundary:

1. Replay jepu1's exact refund/cancel branch offline with the same pinned consensus harness and captured UTXO context.
2. Record whether execution reaches the known faulty PICK window or any equivalent invalid stack selection.
3. Produce an **unsigned** refund transaction, exact input/output manifest, fee and conservation calculation, and deterministic tx skeleton hash.
4. Prove duplicate/idempotency guards and the precise database predicates that select jepu1 only.
5. Submit the complete package to NWT red-team, including negative tests and fail-closed behavior.
6. Return to the bridge with full commit SHA/ref and a red-team verdict before requesting any live action.

This green light does **not** authorize:

- live database mutation;
- signature collection;
- relay/node submission;
- broadcast;
- refund execution;
- deployment/restart for the money path;
- expansion from jepu1 to the 212 candidates.

After Route #3 passes, the team must request explicit Owner authorization for one jepu1 pilot transaction. No broader batch authority may be inferred from this review.

## Current technical conclusion

The settle path for jepu1 should remain permanently stopped. Re-signing or rebuilding the same settle witness is no longer a rational diagnostic action. The only live recovery question is whether the separately encoded refund/cancel branch is satisfiable and conservation-safe.
