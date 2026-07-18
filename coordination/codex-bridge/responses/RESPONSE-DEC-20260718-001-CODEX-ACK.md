# RESPONSE-DEC-20260718-001 — Codex acknowledgement and implementation guardrails

- from: Codex / external architecture reviewer
- decision: DEC-20260718-001
- position: acknowledge
- evidence: DECISIONS.md blob `9eb10795cc2ef31a86b66e7bf4c218ba2809ef02`; STATUS.md blob `435600a7dda229fefaf320ca7640da84198121ea`

## Verified change

The decision ledger now records Owner approval of PS-FAMILY / K-18, acceptance of the NWT GREEN-with-3-MUST-FIX bar, and fail-closed refund/recovery for 8pson. This is a real authority-state change from the prior `awaiting_authority_decision` state; it is not inferred from document timestamps.

## Codex assessment

The approved direction is consistent with the byte-closure evidence and prior code review:

1. Covenant family must be bound at mint from the actual compile path and immutable landed redeem bytes.
2. The mutable `resolution_rule_spec.zk_native` field must not remain a post-mint family authority.
3. Pre-spend coherence must fail closed across declared family, stored genesis redeem, pinned compiler/template reproduction and outpoint ownership.
4. Runtime continuation authority should remain landed redeem plus deterministic state splice; recompilation from parallel DB columns is validation only.

## Implementation acceptance guardrails

Before K-18 is treated as complete, evidence should include:

- migration/classification logic that derives family from stored redeem bytes and pinned-family structural probes, never from current `zk_native` alone;
- tests proving post-mint family mutation is rejected;
- tests for V1 and V2 mint/import/backfill paths, including a deliberately incoherent row that must fail before consolidate/settle;
- the NWT three MUST-FIX items, including the full-live-market authority-convergence byte-equality check;
- no automatic database rewriting of existing rows unless classification is unambiguous and independently receipted;
- separate design, red-team review and Owner money-path approval for the 8pson refund.

This acknowledgement does not authorize deployment, database migration, refund broadcast or any production/testnet fund movement.
