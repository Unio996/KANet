# KCC1 Conformance Evidence from a Stateful Settlement System

**Working title:** KCC1 × KANet Conformance Vector Proposal v0.1  
**Prepared:** 2026-07-17  
**Target:** KCC-0001 discussion and a future machine-readable vector repository  
**Reviewed KCC1 head:** 55b28d86b4acd6f40b4596c8eff930f84ef96d91  
**KANet evidence snapshot:** eab2ebbc0d0b87a4644617b4f5e5e24030eac396  
**Status:** Design draft; bytes and hashes must be generated from a pinned KCC1 revision before publication

## 1. Purpose

This proposal turns experience from a live Kaspa testnet settlement system into project-neutral KCC1 conformance evidence.

It does not propose that KCC1 adopt KANet-specific business logic. It proposes a reproducible method for testing KCC1 against stateful, multi-entrypoint, multi-input, template-authenticated covenants that have already exercised registration, continuation, settlement, refund, dispute, and exit paths.

The first release should answer four questions:

1. Can two independent implementations derive identical KCC1 ABI bytes and hashes?
2. Can an independent reader reconstruct the same program and state view from landed transaction bytes?
3. Do negative mutations fail for the exact normative reason expected?
4. Can existing non-KCC1 deployments coexist without being silently reclassified as KCC1?

## 2. Evidence principles

### 2.1 Pin the specification

Every vector set identifies the KCC1 PR commit or accepted revision it tests. Draft vectors are disposable compatibility snapshots, not promises of compatibility with the final KCC1.

### 2.2 Separate producer and verifier

The producer may use silverc and a KANet transaction builder. The verifier must independently parse scripts, calculate signatures / tags / template hashes, decode state, and inspect outputs. Shared hashing primitives are acceptable; shared artifact interpretation is not sufficient evidence.

### 2.3 Publish bytes, not only JSON claims

Compiler metadata is useful, but the decisive inputs are the actual redeem script, signature script, transaction inputs / outputs, and the exact bytes used in every hash preimage.

### 2.4 Pair every positive vector with a minimal negative mutation

A vector proves little if many invalid encodings also pass. Each positive case should have a negative case changing one property only: a length prefix, dispatch byte, field boundary, output index, leader position, opening, or template byte.

### 2.5 Preserve historical semantics

Legacy KANet template hashes and positional selectors remain valid under their own explicit profile. A KCC1 verifier must not accept them merely because the surrounding covenant has similar semantics.

## 3. Proposed package layout

Each vector is a self-contained directory:

    vectors/
      manifest.json
      program-abi.json
      source.sil
      artifact.json
      redeem-script.hex
      signature-script.hex
      transaction.json
      expected.json
      mutations/
        one-change-negative-01.json

The top-level manifest should include:

| Field | Meaning |
|---|---|
| vector_id | Stable, descriptive vector identifier |
| spec | KCC number, revision / commit, and tested sections |
| profile | Explicit encoding and dispatch profile |
| source_digest | Digest of source and compiler inputs |
| compiler | Name, version, commit, and flags |
| program_abi_digest | Digest of canonical Program ABI representation |
| network | Offline, testnet, or mainnet plus network identifier |
| transaction_id | Optional landed transaction reference |
| expected_verdict | accept or reject |
| expected_reason | One normative rule, not a generic script failure |

## 4. First vector suite

| ID | Case | Expected result | KCC1 surface |
|---|---|---|---|
| V01 | Single-entrypoint covenant with no dispatch tag and state.start=0 | Accept | Program ABI, single-entry dispatch, P2SH envelope |
| V02 | Same single-entrypoint call with a spurious four-byte dispatch tag | Reject | Dispatch cardinality |
| V03 | Multi-entrypoint covenant using canonical four-byte FunctionSignature tags | Accept | Canonical types, function signatures, collision-free tags |
| V04 | Semantically equivalent multi-entrypoint covenant using legacy OP_0 / OP_1 positional selectors | Reject as KCC1; accept only under explicit legacy profile | Version separation |
| V05 | State encoding boundaries for int, bool, byte, bytes, byte[N], arrays, and records | Accept valid cases; reject malformed forms | Value ABI, PushExplicit |
| V06 | P2SH invocation whose final pushed item is the redeem script | Accept; reject reordered or non-final redeem script | Invocation envelope |
| V07 | Extract prefix / state / suffix from a compiler artifact and reconstruct the full redeem script exactly | Accept | State window and template |
| V08 | Two different prefix / suffix boundaries with identical raw concatenation | KCC1 hashes must differ | Length-bound TemplateHash |
| V09 | Template view with one declared mutable state field | Accept declared mutation; reject mutation outside the view | Template views |
| V10 | Same-template continuation and explicitly authorized cross-template continuation | Accept valid transitions; reject unapproved template substitution | Continuation authentication |
| V11 | Multiple same-ID inputs with one leader and one or more delegators | Accept correct role assignment; reject wrong leader, missing coverage, duplicate coverage | Covenant ID lineage |
| V12 | Virtual element opening and authenticated update | Accept valid opening / update; reject wrong opening and stale commitment | Virtual elements |
| V13 | Historical covenant carrying legacy Hash(prefix || suffix) | Reject as KCC1 even if it remains valid under kanet-legacy-v0 | Non-ambiguous migration |

## 5. Byte-level cases

### V01 / V02 — Single-entrypoint dispatch

Use a minimal covenant with:

- exactly one entrypoint;
- one state field;
- no compiler-injected positional selector;
- state.start=0.

The positive signature script contains only the encoded arguments followed by the final pushed redeem script. The negative mutation inserts an otherwise well-formed four-byte tag. This pins KCC1's “omitted for exactly one entrypoint” rule without involving application logic.

### V03 / V04 — Hashed tags versus positional selectors

Use a two-entrypoint state machine with small signatures. Publish:

- UTF-8 bytes of each canonical FunctionSignature;
- the full hash;
- the first four bytes used as dispatch tag;
- complete positive signature scripts;
- a tag-collision check over the Program ABI.

Then replay the same semantic call with a one-byte OP_0 or OP_1 selector. A KCC1 verifier must reject it. A separately selected kanet-legacy-v0 verifier may accept it.

This is a genuine deployed-implementation boundary. Existing KANet sources explicitly describe register_append as entry 0 / OP_0 and convert_to_rootclose as entry 1 / OP_1, while a three-entry settlement covenant describes settle, dispute, and refund as OP_0, OP_1, and OP_2.

### V05 — State integer boundaries

At minimum test:

- 0, 1, -1, 127, -127, 128, -128;
- the maximum and minimum values allowed by KCC1's signed-magnitude state representation;
- malformed negative zero;
- non-eight-byte state payloads;
- a value that is valid as a minimal invocation ScriptNum but invalid as a state field, and vice versa.

The vector must distinguish invocation PushMinimal from state PushExplicit. A round-trip through one compiler is not enough; the independent verifier must compare the literal payload bytes.

### V06 — P2SH envelope

Positive case:

    encoded arguments || optional valid dispatch tag || final pushed redeem script

Negative mutations:

- redeem script is not the final item;
- multi-entrypoint tag is omitted;
- tag is pushed with the wrong width;
- argument and tag order is reversed;
- trailing data follows the redeem script.

### V07 — State window round-trip

KANet already has a useful extraction invariant in kasia-console/src/lib/pool-template-artifact.mjs:

    prefix || state || suffix == full redeem script

Convert this into a project-neutral KCC1 vector:

1. Pin Program ABI state.start and state.len.
2. Extract the byte slices independently.
3. Decode each state field according to the ABI.
4. Re-encode the fields with PushExplicit.
5. Reconstruct the redeem script exactly.
6. Reject a one-byte window shift even if a permissive parser can still read pushes.

### V08 — Length-bound template hash

Use the classic ambiguous boundary:

| Case | prefix | suffix | Raw concatenation |
|---|---|---|---|
| A | 61 | 6263 | 616263 |
| B | 6162 | 63 | 616263 |

Hash(prefix || suffix) cannot distinguish A from B. KCC1's length-bound preimage must produce two different hashes. Publish the exact LE64 length bytes and full hash preimages.

This vector is especially important because current KANet code computes a legacy template from Buffer.concat([prefix, suffix]), and on-chain covenant code also authenticates blake2b(gatePrefix + gateSuffix). The evidence should be presented as a migration reason, not as a claim that old deployments were KCC1-conformant.

### V09 — Template view

Start with a program whose state contains:

- one field permitted to change;
- one field fixed by the view;
- surrounding immutable script bytes.

Accept a continuation changing only the declared field. Reject:

- a change in the fixed field;
- a one-byte change in prefix or suffix;
- a view with an out-of-range field;
- a view that aliases only part of an encoded push.

### V10 — Same-template and cross-template continuation

Produce two positive cases:

1. A continuation authenticated against the same length-bound template hash.
2. A migration to a different template accepted only through an explicit authorization rule in the source covenant.

Negative cases substitute a different template with identical state, or correct target bytes at an unapproved output index.

### V11 — Leader / delegator roles

Use at least three inputs sharing one Covenant ID. The vector should publish input order and identify the first shared-ID input as leader.

Negative mutations:

- move the expected leader without updating witnesses;
- omit one same-ID input from global coverage;
- cover one continuation twice;
- let a delegator validate only local shape while no leader validates cardinality;
- introduce an unrelated same-template input with a different Covenant ID.

### V12 — Virtual elements

Choose one small committed value rather than an entire settlement structure. Publish Packed(value), its opening, commitment, old state, and updated state.

Reject a wrong opening, ambiguous packing, stale old commitment, and an update whose new commitment does not match the authenticated output.

### V13 — Historical profile separation

This vector intentionally carries:

- legacy Hash(prefix || suffix);
- a positional multi-entrypoint selector;
- an otherwise valid historical covenant invocation.

Expected outcomes:

| Verifier profile | Verdict |
|---|---|
| kanet-legacy-v0 | Evaluate according to the historical covenant rules |
| kcc1-draft-pinned | Reject before claiming KCC1 conformance |
| auto / unspecified | Reject as ambiguous |

This prevents compatibility tooling from “upgrading by interpretation.”

## 6. KANet evidence sources

The initial extraction work can use these existing implementation anchors:

| Evidence | Repository-relative source |
|---|---|
| prefix / state / suffix round-trip and legacy template calculation | kasia-console/src/lib/pool-template-artifact.mjs |
| two-entrypoint positional selectors | kasia-console/src/lib/ShardLeaf_direct.sil |
| three-entrypoint positional selectors | kasia-console/src/lib/PoolSpine_v08_chunk.sil |
| on-chain legacy prefix + suffix template authentication | kasia-console/src/lib/CloseZkV2.sil |
| multi-input registration and continuation builders | kasia-console/src/lib/pool-register-builder.mjs and related builders |

Before publication, each extracted example should be minimized. A conformance vector should keep only the script behavior needed to exercise the KCC1 rule.

## 7. Tooling plan

### Producer

Add an exporter beside the compiler integration that emits:

- pinned source and compiler metadata;
- canonical Program ABI;
- redeem and signature script hex;
- state field boundaries;
- KCC1 template hash preimage and result;
- canonical FunctionSignature bytes, hash, and tag;
- referenced transaction bytes when a landed example exists.

### Independent verifier

Build the verifier as a separate package and process:

1. Raw manifest and byte files.
2. Structural schema validation.
3. KCC1 value decoding.
4. FunctionSignature and tag recomputation.
5. State-window and full-script reconstruction.
6. Template / view hashing.
7. Transaction-level continuation checks.
8. Expected accept / reject comparison.

It should report the first violated normative rule and all recomputed values. It must never “fix” noncanonical input before checking it.

### CI

Run three jobs:

- producer determinism: two clean builds yield byte-identical packages;
- independent verification: all positives pass and negatives fail for the pinned reason;
- historical profile separation: legacy vectors never pass under KCC1.

## 8. Publication sequence

1. Share the vector manifest design and V08 boundary case in the KCC1 discussion.
2. Confirm the maintainers' preferred repository / serialization format.
3. Publish V01–V08 as the small ABI and template core.
4. Add V09–V12 after the corresponding KCC1 sections stabilize.
5. Add landed testnet transitions only after removing addresses, operational secrets, and unrelated application data.
6. Ask a second implementation team to reproduce expected bytes without using the KANet exporter.

## 9. Acceptance criteria

The first evidence pack is complete when:

- every vector pins one KCC1 revision and explicit profile;
- all expected bytes can be reproduced from disclosed inputs;
- an independent verifier agrees with the expected verdicts;
- every positive has a one-change negative;
- at least one landed testnet transaction is reconstructed end to end;
- legacy deployments remain clearly valid only under their historical profile;
- no vector requires a KANet service, database, or trusted API to verify.

## 10. Suggested short PR message

We operate a stateful Kaspa testnet settlement system with multi-entrypoint covenants, compiler-derived state windows, template-authenticated continuations, and multi-input aggregation. We would like to contribute project-neutral KCC1 conformance vectors rather than application-specific requirements.

The first proposed pack covers single- and multi-entry dispatch, PushExplicit state encoding, P2SH envelope ordering, prefix/state/suffix reconstruction, length-bound TemplateHash, template views, same-ID leader/delegator roles, and explicit rejection of historical positional-selector / raw-concatenation-hash profiles as KCC1.

Would the maintainers prefer these vectors in this repository, a companion repository, or as fixtures attached to the PR while the document is still Draft?
