# Codex independent review — unsynced SilverScript compiler scope and pinning risk

## Git/Blob inspection basis

- Last processed / written-back bridge commit: `26d4df97722ceee42130bce3b42752b851c01ffb`.
- Initial `coord/codex-bridge` compare against that commit: `identical`, ahead `0`, behind `0`.
- Canonical bridge blobs at inspection:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- No canonical bridge file diff existed. Increment detection used Git compare and blob identity only; no in-file timestamp was used.
- Related active branch compare: base `100a2bd0d88170e497d0bef9391506a706db15d2` to `bshard-m3-deploy` was ahead by `2`, behind by `0`; only `docs/iteration/HANDOFF-NOW.md` changed (`+89/-1`), current blob `b9240e6c180696030273468b31f1888858169b32`.
- Independently inspected current `CLAUDE.md`, blob `cb781eb9ac70d8d0c7369e584dcd0f3375e97daa`, and upstream `kaspanet/silverscript` commit `bfc5a4565f905462e747ad40011dd07812757357` (`compile.rs refactor (#178)`).

## Verdict

`UPSTREAM_SINGLE_CALLSITE_SCOPE_CORRECTION_ACCEPTED__KANET_LOCAL_COMPILER_ASSURANCE_CLAIM_REJECTED__MONEY_PATH_COMPILER_MUST_BE_PINNED_AUDITED_AND_REBUILT_BEFORE RELIANCE__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. The current CLAUDE.md statement is materially stale and internally unsafe

`CLAUDE.md` still states both that upstream lacks the fix and that any third party using upstream `silverc` still has the OP_PICK bug. It also states that KANet-local generated covenants do not have the bug. The active handoff now reports the opposite for the specific upstream callsite after upstream refactor #178, while also narrowing the KANet-local assurance to only the one callsite that was encountered and patched.

This is not a cosmetic documentation mismatch. `CLAUDE.md` is a mandatory first-read execution authority. Its current text can cause two opposite operational errors:

1. external users may be incorrectly warned that current upstream source necessarily contains the known off-by-one; and
2. KANet developers may incorrectly infer that the local compiler is globally safe because one observed callsite was patched.

The second error is more serious because KANet's money-path covenant generation reportedly uses the older local compiler tree.

### 2. Upstream refactor evidence supports a mechanism change, not a global correctness proof

Upstream commit `bfc5a456...` is a broad compiler refactor. The active evidence that the relevant callsite now routes stack accounting through `emit_op(..., -1)` supports the narrow conclusion that the previously observed manual adjustment at that callsite is gone.

It does **not** by itself prove:

- every OP_PICK-related path is correct;
- all stack-delta behavior is correct;
- KANet's locally patched compiler is behaviorally equivalent to current upstream;
- generated covenants are byte-for-byte or behaviorally equivalent;
- no new regression was introduced by the refactor.

The handoff correctly labels its inspection as source-shape evidence without compilation, tests, or behavioral differential execution. That boundary must remain explicit.

### 3. KANet's local compiler is now an unpinned, divergent money-path toolchain

The active evidence says the KANet tree remains on the pre-refactor manual stack-accounting model and that the local repair commit was never pushed. Therefore the relevant risk is no longer just “one unpublished fix may disappear.” The larger risk is:

- covenant generation depends on a local source tree outside the repository authority chain;
- the tree is structurally divergent from current upstream;
- the build artifact, source commit, dependency lock, and generated output are not bound by an immutable manifest;
- a rebuild on another host may silently use a different compiler and generate different scripts;
- no mechanical gate currently proves which compiler produced a deployed covenant.

For a compiler that emits scripts controlling funds, this is a supply-chain and reproducibility defect, not merely technical debt.

### 4. Counting manual stack adjustments is a useful risk locator, not defect evidence

The reported `110` manual stack-accounting sites and `0` `emit_op` sites in the old local tree indicate a much larger human-maintained trusted surface than current upstream. They do not prove 110 bugs, and the handoff correctly avoids that claim.

The appropriate engineering conclusion is that grep counts should drive a structured audit and migration decision, not be used as acceptance evidence. Each relevant code path needs semantic review and tests. Particular priority should go to code reachable from KANet's deployed or planned covenant templates.

### 5. Required closure package before relying on newly generated money-path covenants

Before any new covenant generated by this compiler is treated as deployable or funds-safe, require one immutable package containing:

1. exact compiler repository, commit SHA, complete tree hash, submodule/dependency lock and build command;
2. compiler binary hash and reproducible-build evidence, or an explicit statement that the build is not reproducible;
3. full list and hashes of source covenant inputs;
4. generated `.sil` / script artifacts and hashes;
5. golden tests for the known OP_PICK case and its sister paths;
6. differential generation and execution against an explicitly selected upstream baseline;
7. stack-depth invariant tests covering all code paths reachable from KANet templates, not merely regex counts;
8. transaction-level positive and negative execution tests on isolated TN12 fixtures;
9. a provenance record binding every deployed covenant/template hash to the exact compiler artifact that generated it;
10. rollback and invalidation rules for artifacts generated by any superseded compiler.

Until then, existing deployed artifacts may remain under their current Owner-authorized operational status, but no new assurance should be inferred from “the local bug was fixed.”

### 6. Correct authority wording for the mandatory first-read document

Because Owner text is not to be silently rewritten, append a dated status correction directly below the stale note, with an immutable source tuple. It should separate four claims:

- **upstream current source, observed callsite:** old manual adjustment removed by #178;
- **upstream global compiler correctness:** unproven;
- **KANet local pre-refactor tree:** structurally retains manual accounting and only one encountered callsite is known patched;
- **generated/deployed covenant provenance:** requires exact compiler/build/template binding and remains open where absent.

Do not use `git branch -r --contains <KANet-local SHA>` to answer whether upstream independently fixed the behavior. That command only answers whether the exact local commit is an ancestor of a remote branch.

## Authorization boundary

This review does not authorize modifying, rebuilding, deploying, signing, broadcasting, migrating, settling, refunding, or otherwise moving production or test assets. Any money-path compiler migration or regenerated covenant requires the existing design → red-team → code → diff → isolated test → explicit authority chain.