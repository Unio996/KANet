# Codex review — unsynced P1(g) provenance + (h)/(b) acceptance-state update

Verdict: **material progress, but no implementation authorization.**

## 1. Git baseline

Canonical bridge had no increment relative to last processed/written commit `18dc7bcc53979f6a70a04efb4bc9b7848b35f7d4` (`coord/codex-bridge` identical, ahead 0 / behind 0). The substantive increment is on the directly-related active branch `bshard-m3-deploy`, current HEAD `a2254e45bfbcb93a14c9663bba90e692808f63fb`.

## 2. P1(g) provenance — substantial closure, but one runtime leg still missing

I independently accept two upgrades as material:

1. **Source durability is materially fixed.** The new `silverc-oppick-8065184.bundle` plus its recorded full-history checkout removes the prior failure mode where `8065184` existed only as a local branch or depended on the upstream retaining `d25bd34`. This is stronger than the old base+patch-only recovery story.
2. **The clean-rebuild comparison has real discriminatory power.** The report compares patched rebuild A against the exact same base without the patch B, then against authoritative fixed compiler C. `A == C` byte-for-byte at generated script level and `A != B` isolates the OP_PICK patch rather than merely distinguishing two unrelated compilers. Using `PayoutShardV2.sil` with real `byte[](val,size)` sites is a valid load-bearing probe for the changed codegen path.

I also accept the recorded environment tuple (`rustc 1.96.1`, `cargo 1.96.1`, `x86_64-pc-windows-msvc`, tracked `Cargo.lock` hash) as useful rebuild evidence. Lack of byte-identical EXE is **not itself a failure** unless deterministic executable builds are claimed; script-byte equivalence against the authoritative compiler is the more relevant semantic criterion here.

However, I do **not** yet mark gate (g) fully CLOSED. The current clean-rebuild report proves compiler-output equivalence for one dense OP_PICK-bearing production contract, but it does not show the **rebuilt artifact itself** running the frozen runtime positive/negative probe family on the relevant Toccata path. Before full closure, run the rebuilt compiler through the already-frozen primitive/runtime vectors (at minimum valid signature PASS, signature mutation REJECT, digest mutation REJECT, wrong-key REJECT, plus the OP_PICK-sensitive contract path) and preserve raw outcomes with zero inconclusive. This is a narrow remaining gate, not a reopening of the source-durability work.

So P1(g) status is now:

- durable fixed source/history: **PASS**;
- isolated base-vs-patch codegen discrimination: **PASS**;
- clean rebuild script-byte equivalence to authoritative fixed compiler for the tested contract: **PASS**;
- executable byte identity: **NOT REQUIRED unless claimed deterministic**;
- rebuilt-artifact runtime probe on frozen vectors: **OPEN / FINAL NARROW MUST-FIX**.

## 3. Gate (h) — current head correctly exposes an acceptance-suite gap

The current active HEAD records that the topology/mutation audit found **14 v0.11–v0.15 load-bearing requires without concrete mutation IDs in the normative acceptance body**. I agree this is a real gap, not bookkeeping noise.

A statement like “this require must be mutation-tested” in changelog/prose is not equivalent to a pre-registered test cell. Gate (h) therefore remains **OPEN** until those 14 requires are each mapped to an explicit mutation ID, expected attack trace, and expected PASS/REJECT result in the authoritative acceptance suite. Transaction-level and configuration-level mutations must remain separate classes; they cannot be inferred from statement-level coverage.

The current matrix remains a useful coverage index, but it is not closure evidence while those cells exist only as prose obligations.

## 4. Gate (b) — schema/design exists; implementation acceptance is unblocked conceptually, not passed

I agree with the current correction that gate (b) should build on the existing A2-whole acceptance design and existing typed-receipt schema, not invent a new receipt format. The eight receipt fields and the threshold / baked-root membership / deterministic-successor contract already provide a usable pre-registered acceptance target.

But this changes only the task shape:

- **design/schema availability: PASS**;
- **acceptance contract can be extended to statement/transaction/config mutation layers: PASS direction**;
- **real A2-whole receipt-verifying covenant: still not present / not accepted by this review**;
- **gate (b): OPEN until real implementation + frozen negatives + zero-inconclusive evidence**.

Do not treat “unblocked” as authorization to build or deploy a money-moving covenant. Any actual production-path implementation still requires the separate Owner/code gate already recorded.

## 5. Current net state

`same-chain Shape-B design-spec` remains **conditionally design-closed**. This review does not reopen it.

The next evidence-bearing order should be:

`finish rebuilt-artifact runtime probe for (g)` → `materialize the 14 missing mutation IDs for (h)` → `only after authorized implementation exists, execute (b)+(h) against the real compiled covenant/topology`.

No covenant build, implementation rollout, deployment, DB mutation, signing/broadcast, settlement/refund, key movement, or production money-path action is authorized by this review.
