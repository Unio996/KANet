# Codex independent review — KANet integration thesis

- bridge_base: `65edb895ba3123976d92c2090a062011115f4e48`
- bridge_compare: identical
- source: `docs/2026-07-31-why-integrate-kanet-adversarial-conclusion.md`
- source_blob: `76f97c1faac3da94ba947b667abca17d2f0014ed`

## Verdict

`PROBLEM_SELECTION_DIRECTION_ACCEPTED__UNIQUE_CROSS_DOMAIN_POSITION_UNPROVEN__ATOMICITY_DOES_NOT_REQUIRE_ONE_NEUTRAL_ADJUDICATOR__PUBLIC_PREIMAGE_IS_NOT_PRIVATE_DIGITAL_DELIVERY__DESIGN_ONLY`

The document correctly starts from the possibility that a simple payment plugin should not integrate KANet. Its stronger discriminator — whether value is exposed before a binding completes — is useful, but incomplete. It must also identify the exact state transition, the independently controlled domains, what each domain can verify, and the additional trust assumptions introduced by KANet.

The claim that cross-domain settlement is KANet’s uniquely irreplaceable position is unsupported. Cross-domain exchange can use linked hash/time conditions, adaptor signatures, light-client verification, committees, solvers, bridges, or escrow. The defensible conclusion is only that cross-domain exchange is a class where an additional coordination layer may help when neither domain alone can enforce the whole transition.

Atomicity also does not necessarily require one neutral adjudication domain. In an atomic swap, each chain can enforce its own local condition while cryptographic linkage and timeout ordering create the global property. The design must distinguish single-domain adjudication, cryptographically coupled local adjudication, external attestation, and non-atomic sequential execution.

The hashlocked digital-goods example has a material privacy flaw. A preimage revealed in a transaction is generally public, not buyer-only. That is unsuitable for reusable license keys, credentials, API tokens, or private download secrets. A viable design needs buyer-specific encryption, verifiable encryption, adaptor-style conditional revelation, or a buyer-bound one-time credential. Hash equality alone also does not prove that the revealed item is the promised item.

Therefore the next step should not be framed merely as “an escrow needing no signature.” It should be a concrete fair-exchange design card specifying participants, assets, state machine, atomicity boundary, privacy, authenticity, timeout/griefing behavior, replay/front-running handling, evidence continuity, deterministic recovery, and a comparison against a direct HTLC/adaptor-signature design without KANet.

Recommended status split:

```text
lifecycle_status: current_draft
review_status: adversarial_round_complete
owner_status: pending
implementation_authority: none
```

No implementation or deployment authority is granted by this review.