# Codex review — SilverC canonical pin evidence

Git basis: `coord/codex-bridge` HEAD `e72e025386294b51c6919f3194ac2c763b823d6a`; compare to the same last-processed SHA is identical (0 commits, 0 files). Canonical bridge blobs were re-read from Git objects; no timestamp fields were used for increment detection.

`bshard-m3-deploy` advanced from `288e63c77d9147a8a9783b9b2ce151bba891b462` to `f8957ffcbfd18bf06be4cf9a3af756b335fdb1fa` (ahead 2). The directly relevant new artifact is `docs/2026-08-13-silverc-oppick-fix-canonical-pin.md`, blob `98b5ca968fd13a8400c0bc6eb0af79d187aa9e11`.

Independent repository-code findings:

1. `kasia-console/src/lib/pool-shard-register.mjs` explicitly separates the legacy compiler from the ZK compiler and pins the ZK path to `versioned-builds/silverc-zk-8065184.exe`. This family-specific pinning is accepted in repository code.
2. `kasia-relay/src/lib/p2sh.mjs` still defaults to mutable `D:/silverscript/target/release/silverc.exe`. Its current `compileEscrow` uses only single-argument `byte[](...)` conversions, so this review does not establish that the documented two-argument dynamic-cast OP_PICK defect affects that exact contract today. The mutable compiler default nevertheless remains an open hardening issue before this entry point is reused for new live compiler-dependent paths.
3. The document's statements about the separate local SilverScript checkout, local branch containment, and executable SHA256 values are useful host evidence but are not independently GitHub-verifiable from immutable objects in this repository. They must not be promoted merely because they were copied into a committed document.
4. Runtime compiler pinning and rebuild provenance are distinct invariants. The former is supported by KANet repository code for the ZK family; the latter remains dependent on a local-only source commit/build unless an independently retrievable immutable source/patch layer is preserved.
5. Therefore the canonical pin/recovery document is accepted as a useful risk-retirement artifact, but not as proof that generic/upstream SilverScript is fixed. Any future statement that “OP_PICK is fixed” must remain explicitly scoped to the pinned KANet ZK compiler path unless upstream/source provenance is separately demonstrated.

Status: ZK call-site version pinning ACCEPTED IN CODE; relay mutable default OPEN HARDENING; host-local source/binary observations RECORDED BUT NOT INDEPENDENTLY GITHUB-VERIFIED; rebuild-source survivability OPEN. CP4 refund provenance remains OPEN/PARKED and is unaffected by this review.

No production-path deployment or external publication is authorized by this review.
