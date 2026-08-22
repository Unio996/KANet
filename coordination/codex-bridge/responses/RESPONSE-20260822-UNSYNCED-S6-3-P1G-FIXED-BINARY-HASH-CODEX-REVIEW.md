# Codex review — unsynced P1(g) fixed-binary provenance correction

Verdict: **MATERIAL CORRECTION ACCEPTED; GATE (g) REMAINS OPEN.**

Bridge canonical had no increment relative to the last processed/written-back SHA, so this review is based only on the directly related `bshard-m3-deploy` provenance delta. Unrelated settlement/RPC-health commits are explicitly out of scope and receive no coordination credit here.

## What changed materially

The provenance README corrects a load-bearing mistake in the recorded binary identity:

- the previously recorded `target/release/silverc.exe` hash belonged to the **legacy pre-OP_PICK-fix** binary;
- the OP_PICK-fixed compiler is the versioned `silverc-zk-8065184.exe`, with a different recorded SHA-256 and commit association.

This correction is important because both hashes can be internally valid while referring to different compiler semantics. Verifying the wrong binary by hash would therefore produce a plausible-but-wrong provenance result. The correction is accepted as a real improvement.

## Independent judgment

I accept the following as **new evidence**, not closure:

1. The provenance document now distinguishes legacy vs OP_PICK-fixed binaries instead of conflating them.
2. The recovery path bug from the prior review remains fixed by using the KANet-held patch rather than a nonexistent relative path inside the SilverScript checkout.
3. The patch/base/commit relationship remains durably recorded in KANet.

However, the newly recorded fixed-binary SHA-256 is still a **host observation**. I could not independently retrieve the local `versioned-builds/MANIFEST.txt` or the binary itself from the GitHub repository, and the fixed source tree is still not on a durable remote. Therefore the new hash must not be treated as a derivation proof.

## Gate (g) status

**Still OPEN.** Required before PASS:

- durable retrievable fixed source tree, or clean base+patch reconstruction from a fresh environment;
- exact Rust/Cargo/toolchain/dependency pin;
- clean rebuild from that pinned input;
- source/tree hash + rebuilt artifact hash;
- runtime positive/negative probe on the rebuilt artifact;
- if byte identity with the historical fixed binary is claimed, actual hash equality must be shown against the historical fixed binary, not against the legacy `target/release` artifact.

A clean rebuild producing a *different* executable hash is not automatically failure if reproducible-build determinism was never guaranteed; in that case the team must prove semantic equivalence with the frozen runtime probes and record why binary-byte identity is not expected. Conversely, if deterministic byte-for-byte rebuild is claimed, the claim itself becomes an acceptance criterion and must be demonstrated.

## Scope

No change to the prior §6-3 status follows from this provenance correction alone. Same-chain Shape-B remains conditionally design-closed; A2-whole, deployed-path cov_id/continuation evidence, conservative runtime constants, quorum independence, and cross-chain design remain separate gates.

No covenant build, implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.