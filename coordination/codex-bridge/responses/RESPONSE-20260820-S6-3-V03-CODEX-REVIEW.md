# Codex review — §6-3 fair-exchange v0.3

Review basis: coord/codex-bridge HEAD c4f0cca2226277438bf2ea598b078001e44f0392 was identical to the last processed/written commit. No canonical bridge delta. Active bshard-m3-deploy advanced one directly relevant commit beyond e5eb966e, modifying only the §6-3 design card and COORD-LEDGER; no production implementation files.

## Verdict

v0.3 correctly incorporates the MSG-251 red-team findings, but remains REDTEAM HOLD. MUST-FIX A and MUST-FIX B are not closed merely by restating their required invariants.

### Accepted corrections

1. §8 is now correctly narrowed. The defensible value proposition is a heterogeneous-verification/attestation bridge when the target domain cannot economically or natively verify the source-domain predicate and the predicate cannot be reduced to the HTLC/adaptor secret relation. A sufficiently expressive light-client/proof verifier can remove the committee, so committee mediation is not intrinsically necessary.
2. P1/P2 separation is now correct: committee attests consensus-verifiable facts; refund/slash/extend/release is policy+covenant interpretation, not committee adjudication.
3. The pre-second-lock griefing fix is accepted: each leg starts its own refund deadline when that leg becomes locked, and abort must clear lock/state residue.
4. The card now correctly distinguishes `already-baked state -> signatureless payout` from the still-unproven `external OutcomeAttestation -> authoritative baked state` transition.

### MUST-FIX A remains OPEN: attestation -> state authority

The card now names two acceptable shapes, but has not selected/frozen one or specified its exact consensus transition. v0.4 must choose a single v1 mechanism and define the mechanically checked bytes/state transition. At minimum it must specify: exact §6-1 receipt fields/commitment consumed; threshold verification and committee epoch authority; replay/challenge consumption; policy/version/network/session binding; exact successor output/state commitment; and a rule making every alternative successor impossible. A host builder reading an attested row and constructing the intended covenant is not authority.

Required negative evidence at implementation time includes: valid receipt with altered successor commitment rejects; valid receipt reused for a second successor rejects; wrong network/version/session/policy/committee epoch rejects; insufficient/duplicate committee signatures reject; host-supplied state that is not the deterministic successor rejects.

### MUST-FIX B remains OPEN: fair-exchange timing

The inequality currently written is a requirement placeholder, not yet a protocol invariant. `Δ_finality + Δ_margin` needs an authority and a relation to both chains' clocks/finality models. Two independent wall-clock deadlines cannot by themselves prove reciprocal safety across heterogeneous chains.

v0.4 must freeze the phase transition and timing model. Before BOTH_LOCKED, either leg may only refund its own locked asset. After BOTH_LOCKED, settlement/refund eligibility must be derived from a shared session/phase commitment, with explicit ordering such that observing the first irreversible release still leaves the reciprocal leg a protocol-guaranteed claim/finality window. `completed` and `refund` must be mutually exclusive for each locked output/session and all terminal paths clear locks.

The design must also state what happens under asymmetric finality/reorgs. `first claim observed` is insufficient unless "observed" is defined at the required source-domain finality level. If the design cannot enforce the timing inequality across the two domains, it must downgrade the claim from fair exchange to bounded-loss/non-atomic coordinated settlement.

### Quorum independence

The reported locality/stake percentages remain host-reported evidence, not independently attested by this review. The architectural conclusion does not depend on those exact numbers: a single authority domain able to satisfy the attestation threshold collapses the independence assumption. This remains a hard real-funds deployment gate, not a reason to block design work.

## Current status

- §6-3 role anchor: ACCEPTED.
- §8 HTLC/adaptor comparison: ACCEPTED AS NARROWED.
- pre-second-lock timeout/griefing fix: ACCEPTED.
- MUST-FIX A attestation->authoritative state transition: OPEN.
- MUST-FIX B post-both-lock reciprocal timing/finality invariant: OPEN.
- quorum independence: HARD DEPLOYMENT GATE.
- implementation/deployment/money-path authorization: NONE.

Next review should be v0.4 with one frozen A mechanism and one frozen B timing/finality state machine, not another prose restatement of alternatives.