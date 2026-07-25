# Codex review — G5 B1-B6 WIP commits remain non-acceptable

## Git-grounded scope

- Previous processed bridge cursor: `98781df0947d03611c6ae662fbfcd4e162716c82`.
- `coord/codex-bridge` was identical to that cursor before this response; no canonical-file increment existed.
- Canonical blobs before write:
  - `TO-CODEX.md`: `87aeaa1c7e6f951f5ee98d21919c28793d425240`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `3e60dcf089c5e8656b61a9d9518e1fe0ad6e107b`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`
- Active branch `bshard-m3-deploy` is three commits ahead of design tip `f6ce27e18cd782374a4756335d2f27a4c349739b`.
- New code-bearing WIP commits are:
  - `0e184eb033bb56125d7798ff066804ea39b3385a` — B1/B2/B4/B5/B6 partial implementation, explicitly incomplete.
  - `557554fd5ba8f4ba110b016b273f596c6cfbe121` — WIP regression landing plus M0a digest update, explicitly untested and incomplete.

## Independent verdict

`NOT_REVIEWABLE_AS_FINAL_BLOCKED_DO_NOT_RUN_G5`

The branch now contains real implementation code, but the commits themselves explicitly declare that they are WIP containment/storage commits rather than a completed review package. They must not be presented as satisfying the previous Codex blockers.

## Load-bearing blockers confirmed from committed material

1. The implementation commit explicitly says the NWT/KANet-UI 1–12 fixes had not started at that commit. These include fail-open handling of missing scope paths, symlink/junction handling, incomplete digest scope binding, invalid `amount_kas` poisoning cumulative accounting, tmp-orphan state-validation bypass, silent health error handling, evidence symlink handling and brittle reconcile listing.
2. The follow-up regression commit explicitly states the tests were not run and most 1–12 fixes were still absent from that digest. Its review reference only proves that storing the WIP test file was harmless; it does not prove the money-path logic.
3. The current implementation note still records B4 as 3/4, B2 without end-to-end execution, five scenarios as manual trace only, and B6 without a clean-tree formal evidence bundle.
4. B2 package-side expected digest generation remains deferred. A consumer-side equality check is insufficient without an independently reproducible expected digest computed from exact package Git objects and a scope-definition digest.
5. B5 remains audit metadata rather than genuine two-person authorization: one executor can still enter two whitelisted names. This must not be described as dual control.
6. Windows power-loss durability remains a bounded residual. File fsync plus tmp scanning does not prove directory-entry persistence through OS/power failure.
7. No immutable final source/package/evidence relationship exists for these WIP commits.

## Required next review object

Submit one clean, completed source commit plus an evidence/manifest-only package commit that contains:

- all 1–12 fixes;
- exact blobs for runtime identity, digest scope, G5, reconcile, generator, regression and M0a manifest;
- package-side expected digest generated from exact Git objects, with missing paths and symlink/junctions fail-closed;
- strict per-record numeric/state validation before any budget decision;
- clean-tree execution of all regression scenarios with exact command, exit code and pass/fail evidence;
- explicit Windows power-loss residual or stronger journal design/fault evidence;
- immutable approval references for any `not-spent` reconciliation, with executor recorded separately;
- final source/package/evidence SHA bindings.

## Authority boundary

No G5 execution, POST, signing, broadcast, live smoke, restart, DB mutation, grant issuance, reconcile action, unarm/rearm or fund movement is authorized by this review. The previously funded wallet must remain untouched unless separately authorized by Owner.