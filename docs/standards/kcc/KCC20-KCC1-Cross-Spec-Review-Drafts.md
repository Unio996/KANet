# KCC20 × KCC1 Cross-Spec Review Drafts

**Prepared:** 2026-07-17  
**Target discussions:** [KCC-0020 PR #2](https://github.com/kaspanet/kccs/pull/2), [KCC-0001 PR #3](https://github.com/kaspanet/kccs/pull/3)  
**Reviewed heads:** KCC20 a6e2fc254b6148c28ce763f129fcc0fa4a0cf877; KCC1 55b28d86b4acd6f40b4596c8eff930f84ef96d91  
**Status:** Public-ready drafts. Verify the target diff immediately before posting.

These drafts are deliberately project-neutral. They report interoperability and safety issues without asking either draft to standardize a particular application architecture.

---

## Comment 1 — Bind the KCC20 wire ABI to KCC1

**Suggested target:** KCC-0020 PR #2, near the State and transfer entrypoint definitions.

### Draft

KCC1 now makes record names, canonical parameter types, and function signatures wire-visible: the exact canonical FunctionSignature determines the four-byte dispatch tag.

The existing discussion already identifies KCC20State and the need to review KCC20 in light of KCC1. A concrete wire-level gap remains in the current PR text: the transfer signature uses State[], but the exact record name and its KCC1 field types are not yet defined as a canonical ABI. The state table also says integer, while KCC1's canonical type name is int. Two otherwise conforming implementations could therefore derive different function signatures, dispatch tags, or state encodings.

I suggest making the dependency explicit:

1. KCC20 adopts the KCC1 Value ABI, Invocation ABI, state encoding, and P2SH envelope for KCC1-based implementations.
2. KCC20 defines one exact, case-sensitive canonical record name, for example KCC20State, together with the ordered KCC1 field types.
3. KCC20 publishes the exact canonical entrypoint signatures and resulting dispatch tags as conformance vectors.
4. KCC20Descriptor references or embeds the corresponding KCC1 Program ABI. If prefix, suffix, or state layout remain duplicated in the descriptor, their equality with the Program ABI should be a MUST-level validation rule.

Possible normative wording:

> A KCC20 implementation using KCC1 MUST encode invocation arguments and state fields according to KCC1. This specification MUST define the exact case-sensitive record name, ordered field names and canonical KCC1 types used by every KCC20 entrypoint. The canonical FunctionSignature and dispatch tag for each entrypoint MUST be published as conformance vectors.
>
> A KCC20Descriptor MUST identify the KCC1 Program ABI from which its state layout and covenant template are derived. A reader MUST reject a descriptor whose duplicated prefix, suffix, state window, or entrypoint metadata conflicts with that Program ABI.

This would avoid two independent sources of truth and make a KCC20 token independently decodable by wallets, indexers, compilers, and transaction builders.

### Why this is actionable

- KCC1 says exact record names and types affect dispatch.
- KCC20 currently names State but does not fully bind that name to a KCC1 record definition.
- KCC20 descriptor data overlaps KCC1 Program ABI and template data.
- Canonical vectors can resolve the ambiguity without expanding KCC1's scope.

---

## Comment 2 — Borrowed Receive should be opt-in for covenant-owned state

**Suggested target:** KCC-0020 PR #2, Borrowed Receive extension.

### Draft

The human-owned outpoint griefing case has already been identified. There is a second case for identifier_type 0x02: a covenant-owned KCC20 state may treat its token amount, outpoint, or both as part of a larger state-machine invariant.

Borrowed Receive intentionally bypasses normal owner authorization while increasing amount and replacing the consumed state with a new outpoint. For a covenant-owned state this can:

- invalidate an outpoint-bound continuation;
- make a reserve or exact-balance invariant unsatisfiable;
- alter amount-sensitive pricing, shares, or accounting;
- force a covenant into a state for which no recovery or migration transition was encoded.

Receiving more tokens is therefore not universally non-adverse for a covenant.

I suggest a default-deny rule for covenant-owned states:

> A Borrowed Receive transition consuming a state whose identifier_type is COVENANT_ID MUST be rejected unless that individual state is protected by a covenant template that explicitly supports the Borrowed Receive transition and the support is discoverable through a standard, machine-readable capability.

The capability should be authenticated by the state or its covenant template, not merely asserted by an unauthenticated off-chain descriptor. An extension ID can standardize discovery, while the recipient covenant remains responsible for enforcing the allowed transition and any amount or outpoint invariants.

This preserves permissionless donations for covenants designed to accept them without making unsolicited state mutation the default for every covenant-owned token state.

### Minimal conformance cases

1. PUBKEY-owned state, valid Borrowed Receive: accept.
2. COVENANT_ID-owned state, no authenticated capability: reject.
3. COVENANT_ID-owned state, descriptor claims support but covenant template does not authenticate it: reject.
4. COVENANT_ID-owned state, authenticated capability and valid transition: accept.
5. Opted-in state with violated amount or continuation invariant: reject.

---

## Comment 3 — Keep artifact provenance separate, but define the handoff

**Suggested target:** a follow-up issue or standards forum thread; optionally a short note on both PRs.

### Draft

KCC1 intentionally leaves source languages, compilers, and artifact formats to later specifications. That scope boundary is useful and should remain.

There is still an interoperability handoff worth naming now: wallets and indexers will receive deployment metadata from somewhere, but a descriptor cannot authenticate its own prefix, suffix, state layout, or Program ABI. A portable artifact convention should therefore be a follow-up KCC rather than an implicit property of compiler-specific JSON.

I suggest tracking a later specification with three evidence levels:

- **Declared:** metadata is syntactically valid and internally consistent.
- **Artifact-verified:** an independent reader reconstructs the KCC1 template, state window, entrypoint signatures, and hashes from a versioned deployment artifact.
- **Transition-observed:** the reconstructed program data also matches one or more landed transactions and their authenticated continuations.

The reader used for the latter two levels should be independent of the component that produced the artifact. Re-reading compiler output through the same compiler library is useful for debugging, but it is not independent provenance evidence.

The immediate KCC1/KCC20 handoff can stay small:

1. KCC1 defines the canonical Program ABI and template computations.
2. KCC20 normatively references those values instead of defining a conflicting second representation.
3. A later artifact KCC defines packaging, versioning, integrity binding, and evidence-level reporting.

This preserves KCC1's current scope while giving ecosystem tools a clear path from a declaration to independently verified deployed bytes.

---

## Optional short cross-link comment for KCC1

**Suggested target:** KCC-0001 PR #3.

### Draft

KCC20 is already using state records, entrypoints, prefix/suffix descriptors, and extension metadata that overlap the KCC1 ABI surface. It may be useful to add KCC20 as an early cross-spec conformance consumer before either draft stabilizes.

A joint vector could pin:

- the exact KCC20 state record name and ordered KCC1 types;
- canonical transfer FunctionSignature bytes and four-byte dispatch tag;
- state PushExplicit encoding;
- the length-bound KCC1 TemplateHash;
- rejection when a KCC20 descriptor conflicts with its referenced Program ABI.

This would test KCC1 against a nontrivial downstream convention and prevent the two drafts from evolving compatible concepts with incompatible bytes.

---

## Recommended posting order

1. Post Comment 1 on KCC20 first, explicitly as a concrete follow-up to Michael Sutton's existing KCC1 / KCC20 dependency comment. It is the narrowest wire-level interoperability issue.
2. Post Comment 2 separately so the ABI discussion and the Borrowed Receive safety policy can be resolved independently.
3. Post the optional KCC1 cross-link only after the KCC20 author confirms the intended KCC1 dependency.
4. Open the artifact-provenance topic as a separate issue or forum thread; do not enlarge either current PR unless maintainers request it.

## Preflight before posting

- Re-read both PR heads and update quoted field / function names.
- Search existing review threads for duplicate proposals.
- Confirm whether the canonical record name should be State, KCC20State, or another name chosen by the authors.
- Calculate dispatch tags only from the final accepted canonical signature; do not publish provisional tag bytes as stable.
- Keep implementation evidence reproducible and remove project-specific promotion.
- Treat reviewer disagreement as a design input: narrow the proposal before arguing for more scope.
