# RESPONSE-20260725 — G5 v2 B1-B6 hardening design review

- from: Codex
- bridge baseline: `4777114fb89955770ad5a6b133ca174fad9b867c`
- bridge compare: identical before this write
- active branch: `bshard-m3-deploy`
- active branch HEAD inspected: `f6ce27e18cd782374a4756335d2f27a4c349739b`
- active relation: 7 commits ahead of `a7aeb28d0b1cc9805dfd100e4c3893b2c1540752` (previous review observed 5)
- new substantive artifact: `docs/2026-07-25-j2-g5-b1-b6-hardening-design.md`
- artifact blob: `dd87066b47b7481fff62d9a38e0cfebf2cb4e43f`
- verdict: `DESIGN_PARTIAL_ACCEPTANCE_IMPLEMENTATION_AND_EVIDENCE_REQUIRED`

## Accepted design direction

1. B1 correctly moves runtime identity trust to the server boundary: dedicated `ADMIN_SECRET_RUNTIME_IDENTITY` plus server-side `ADMIN_IP_ALLOWLIST`, with negative tests.
2. B2 correctly demotes broad-directory `git diff` to supplemental diagnostics and introduces a startup-frozen digest compared against an Owner-approved snapshot.
3. B4 correctly recognizes that the real TN12 host is Windows and that POSIX directory-fsync assumptions cannot be imported silently.
4. B6 correctly proposes a reproducible evidence generator rather than asking Codex to infer GREEN from commit messages and narrative documents.

These are design improvements only. Current `health.js` blob remains `a85c3c619bd7c206295d79eb88f04f15e6c59416` and still exposes the endpoint without server-side protection; no B1-B6 implementation or new regression evidence is present at this HEAD.

## Remaining design corrections

### D1 — B2 package-side digest generation cannot remain undefined/deferred

The consumer-side equality check is only meaningful if the expected digest is produced by a specified, reproducible authority. Before implementation acceptance, define and test the generation path:

- expected digest must be computed from the exact Git objects at `package_commit`, not from an arbitrary current working tree;
- the shared scope definition itself must be included in the digest/package manifest;
- generation must fail on missing scope paths and duplicate/ambiguous normalized paths rather than silently `continue`;
- package snapshot must bind `package_commit`, scope-definition blob, tree digest, file count and per-file digest evidence.

Deferring the generator until re-activation is acceptable operational sequencing, but it leaves B2 technically open and prevents an immutable evidence package now.

### D2 — B4 overclaims Windows crash durability

File `fsync` plus scanning `*.tmp-*` is useful hardening, but the design sentence claiming that a real POST can no longer disappear from journal accounting is stronger than the demonstrated guarantee. Without a durable directory-entry guarantee, a power-loss boundary around file creation/rename can still leave uncertain namespace visibility. Scanning tmp files only helps when the tmp directory entry survives and is visible after restart.

Close this in one of two ways:

1. use a Windows-appropriate durable append/pre-existing journal mechanism whose file handle is flushed before POST, avoiding correctness dependence on a newly created/renamed directory entry; or
2. state the remaining power-loss residual precisely, cap it, and obtain explicit Owner acceptance for this pilot.

Do not label the proposed tmp scan as complete crash-safety until a real crash/reboot fault-injection test proves the intended recovery behavior on the TN12 host.

### D3 — B5 is audit labeling, not dual authorization

`--approver-1/--approver-2` names, even with a whitelist and string inequality, are supplied by the same CLI invoker. They do not prove that two independent people approved the budget-releasing `not-spent` verdict. The design itself admits this.

Minimum acceptable pilot governance:

- require two distinct immutable approval references created outside the reconcile invocation;
- bind each reference, approver identity, evidence digest and authorization scope into the journal;
- require the references to identify the exact journal id and `not-spent` verdict;
- record the actor who executed reconcile separately from the approvers;
- never describe a same-operator two-name entry as two-person control.

Cryptographic signatures are preferable. Without independent approval artifacts, this remains an Owner-approved procedural residual, not a closed control.

### D4 — B6 needs source/package/evidence Git relations

The proposed bundle must include and verify:

- `source_commit` and an evidence/manifest-only `package_commit` relation;
- generator script blob and regression harness blob;
- clean-tree assertion and exact command/exit status/pass/fail output;
- content digests recomputed from the committed source tree;
- evidence file SHA-256 and package manifest binding;
- no reliance on `generated_at` as identity or freshness authority.

A JSON file generated from an unpinned log is not yet an immutable package.

## Operational boundary

- `BLOCKED_DO_NOT_RUN_G5` remains in force.
- No G5 POST, signing, broadcast, live smoke, restart, DB mutation, grant issuance, unarm/rearm or fund movement is authorized by this review.
- Submit committed B1/B2/B4/B5/B6 implementation, negative tests and immutable source/package/evidence bundle for code-level re-review.
