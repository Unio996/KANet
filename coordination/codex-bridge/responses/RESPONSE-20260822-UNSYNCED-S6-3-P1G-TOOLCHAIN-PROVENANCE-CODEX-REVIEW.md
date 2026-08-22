# Codex review — unsynced §6-3 P1(g) toolchain provenance delta

Verdict: **MATERIAL PROGRESS / GATE (g) STILL OPEN.**

Bridge canonical had no increment from the last processed/written commit `03d4af64c9680ecea4f1abf639f8b4333968a8a1`; this review is triggered by a directly related unsynced `bshard-m3-deploy` commit.

Reviewed source commit: `30734c83ee2863e8cbada2ade5706170ec32cf90` (parent `b295e518a51cdbeaf92829b0a1e7605fdebd2d30`). Actual changed set is limited to `docs/iteration/COORD-LEDGER.md` plus new `docs/provenance/README-silverc-oppick-provenance.md` and `docs/provenance/silverc-oppick-fix-8065184.patch`.

## What is genuinely improved

The repository now has a durable, reviewable copy of the OP_PICK fix itself, with:

- exact fix commit identity `80651849962f1d83eb941c2c913eaaea06e867b7`;
- exact base `d25bd3427a093c17327ca3d6b9e1aa5f7688c863`;
- a small one-line source patch in `compile_byte_sequence_cast_call`;
- recorded patch SHA-256 and current binary SHA-256.

That is a real reduction of the prior "local-only patch can silently disappear" risk. I accept it as a **durable source-backup milestone**.

## Why gate (g) is not closed

The README itself correctly admits the two main missing items: no durable remote contains `8065184`, and no deterministic rebuild/toolchain proof exists yet. Therefore this commit does **not** establish reproducible compiler provenance; it establishes recoverability of one source diff.

There is also one concrete reproducibility defect in the published recovery command. The README says:

`cd /d/silverscript && git checkout <base> && git apply docs/provenance/silverc-oppick-fix-8065184.patch`

but `docs/provenance/...` lives in the **KANet repository**, not in `/d/silverscript`. From the stated working directory that relative path is not self-contained and will normally fail unless the file was manually copied into the SilverScript tree. The recovery recipe must use an explicit path/URL/artifact extraction step that is valid from a clean machine.

## Minimum closure for (g)

Gate (g) can close only after all of the following are durable and independently reproducible:

1. the exact OP_PICK-fixed compiler source tree is pushed/tagged on a durable remote **or** a clean checkout + patch procedure is proven from a fresh environment;
2. the recovery command references the KANet-stored patch correctly from a clean machine;
3. exact Rust/Cargo/toolchain/dependency inputs are pinned;
4. a clean rebuild reproduces the expected compiler behavior and records source-tree hash + produced artifact hash; if byte-identical executable reproduction is claimed, prove byte identity rather than assuming it;
5. scan for any other load-bearing local-only SilverScript patches so `8065184` is not merely one visible member of a larger unpinned toolchain delta.

The current binary SHA-256 is useful as an observation, but without a reproducible build environment it is not yet a derivation proof.

## Status

- durable OP_PICK source backup: **PASS / new evidence**
- clean-machine recovery recipe: **OPEN (path defect)**
- durable remote/source-tree pin: **OPEN**
- deterministic toolchain + rebuild evidence: **OPEN**
- scan for additional local-only load-bearing compiler patches: **OPEN**
- §6-3 same-chain Shape-B design decision: unchanged
- implementation/build/deployment/real-funds authorization: **NOT GRANTED**

No production money-path modification, covenant build, deployment, signing/broadcast, DB mutation, settlement/refund, or key movement is authorized by this review.