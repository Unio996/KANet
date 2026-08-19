# RESPONSE-20260820-MSG252-S6-3-V04-CODEX-REVIEW

## Verdict

S6-3 v0.4 materially improves the design, but I do **not** close both MUST-FIX items yet.

- **MUST-FIX A: PARTIALLY CLOSED at mechanism-shape level; one protocol-semantic gap remains.**
- **MUST-FIX B: NOT CLOSED. The downgrade away from strict atomic fair exchange is correct, but the current `bounded-loss` / `no principal theft` claim is not yet mechanically justified.**
- **Quorum / committee-root independence remains a hard pre-real-funds deployment gate.**
- No implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or money-path authorization is granted.

## A — what the real code proves, and what it does not

I independently read `kasia-console/src/lib/PayoutShardV2.sil` on `bshard-m3-deploy` (blob `7e0fe1bf6c4a0d44b04da2bc7daa1aeb2bd53e64`). The current `close_attest` path really does enforce:

1. five `checkSig(...)` checks with `require(validSigs >= 4)`;
2. five distinct committee pubkeys;
3. Merkle-membership of each committee key against ctor-baked `poolMerkleRoot`;
4. deterministic successor-state validation via `validateOutputState(...)`;
5. value conservation on the successor output.

So J1/J2 are correct that `committeePkHash` is not the authority anchor: it is derived entirely from witness-supplied committee keys and is therefore only self-consistency. The authority-bearing checks are the membership proofs against baked `poolMerkleRoot`. Deleting those while retaining only `committeePkHash` would silently destroy committee-set authority. That refactor trap deserves a pinned negative test.

However, one important semantic distinction remains unresolved:

**`PayoutShardV2.close_attest` proves threshold authorization of the current covenant spend/transaction. It does not, by itself, prove that the covenant verified an independently signed §6-1 typed `OutcomeAttestation` receipt.**

`checkSig` here is transaction-spend authorization. The v0.4 text still talks as if the existing precedent directly proves:

`external typed OutcomeAttestation -> covenant verifies that receipt -> authoritative successor state`.

That is stronger than what this code demonstrates.

Therefore A closes only after v0.5 freezes exactly one of these semantics:

### A1 — transaction-native attestation consumption
Committee members sign the unique state-transition transaction itself, and the transaction sighash/serialized successor mechanically commits every authority-bearing §6-1 field: protocol/domain, version, network, market/session identity, outcome, evidence commitment, committee epoch/set root, replay material, policy/version, and exact successor-state commitment. In this design, the transaction signatures **are** the on-chain attestation-consumption mechanism; do not claim that a separate off-chain receipt was independently verified on-chain.

### A2 — standalone receipt verification
The covenant truly verifies the signatures over the canonical §6-1 `OutcomeAttestation` message bytes and then derives one unique successor state from that verified receipt. If SilverScript cannot verify arbitrary-message signatures in the required form, this route is not available without another cryptographic construction.

Pick one. Do not blur A1 and A2. The current PayoutShardV2 precedent is evidence for A1-style threshold-gated state transition, not automatically A2.

## B — honest downgrade is correct, but `bounded-loss` is currently overclaimed

I accept the downgrade from **atomic fair exchange** to a weaker coordinated-settlement claim. Across heterogeneous domains with independent finality and no shared clock, the earlier strict cross-chain timing inequality was not a defensible protocol invariant.

But v0.4 now states two things that are not yet proven:

1. `authorization atomicity`: there is no state where A is authorized and B is not;
2. worst-case exposure is only `timelock window + fee-level griefing`, **not principal theft**.

The first statement is only true if `authorization` is defined as **existence of one valid shared receipt that both leg covenants can independently verify**, not "receipt has been consumed/included on both chains". On-chain inclusion is inherently non-atomic: A can consume the receipt while B has not yet done so.

The second statement is currently the sharper problem. If, after BOTH_LOCKED, a valid shared attestation makes both legs claimable but each leg can later refund independently after its timeout, the following execution is still possible unless an additional invariant forbids it:

- shared attestation exists;
- party X claims Y's leg;
- Y fails to get its reciprocal claim finalized before its local deadline;
- X later refunds its own still-unclaimed leg.

That is **principal loss**, not fee-level griefing.

So v0.5 must freeze one principal-safety invariant. For example:

- **receipt-revokes-refund:** once a valid shared settlement receipt exists for the session, refund is permanently disabled on both locked outputs; each beneficiary may claim later, so execution may be asynchronous but principal cannot return to the party who already received the other leg; or
- another covenant rule that mechanically proves `claim(other_leg) => own_leg cannot subsequently refund to self`.

If neither heterogeneous chain can enforce such a rule, then the claim must be downgraded again. In that case call it something like **non-atomic coordinated settlement with bounded lock duration**, not `bounded-loss` and not `no principal theft`.

`completed` / `refund` mutual exclusion per individual output is necessary but insufficient; the safety property must be **cross-leg/session-level**.

## Exact closure state

- §2 role anchor: PASS.
- HTLC/adaptor/light-client comparison: PASS with the narrowed wording already adopted.
- Pre-second-lock griefing fix: PASS.
- A mechanism shape (`threshold + baked committee-root membership + deterministic successor`): PASS.
- A semantic bridge from §6-1 typed receipt to the actual SilverScript authorization primitive: **OPEN / MUST-SPECIFY A1 vs A2**.
- B downgrade away from atomic fair exchange: PASS.
- B `bounded-loss / no principal theft`: **OPEN / MUST-FIX cross-leg principal-safety invariant**.
- Committee/quorum independence: HARD PRE-REAL-FUNDS DEPLOYMENT GATE.

Do not implement against an ambiguous A1/A2 model, and do not advertise `bounded-loss` until the cross-leg principal-safety property is mechanically specified and negative-tested.
