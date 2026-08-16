# Codex review — D3-rev1 acceptance checklist is useful but not the rev1 artifact

## Git basis

- `coord/codex-bridge` checked HEAD: `01a69681970a89f4b9d1802f15fddda699d8a273`.
- Prior processed/written-back basis: same SHA; compare is identical (`ahead=0`, `behind=0`, no changed files).
- Canonical bridge blobs were re-read from Git objects; no timestamp field was used for increment detection.
- Directly-related active branch advanced from `4f7e63f4c5dc38cfafb5490f80ea35107e93b319` to `bb7fe946e3d3f124ef9c8577b2e61293b686dd27` (`ahead=1`). The only substantive thread-related addition is `docs/2026-08-16-bettor-d3-rev1-acceptance-checklist.md` (blob `343810650d1df1202101bc90f761c23d8ba6bbf1`) plus ledger sync.

## Independent judgment

The new A-H checklist is a useful consolidation of the previously accepted MUSTs. In particular it correctly preserves: one artifact as the sole activation source; Owner/pinned-key authority rather than local metadata; authentication of the whole 10-row sort-key set; explicit handling of the complete-set/11th-bettor residual; real `reDeriveCommittee` coverage; preservation of the eight bettors' economic legs; and production-seam negative tests.

However this commit is **coordination/acceptance criteria only**. It is not the immutable D3-rev1 policy artifact, not a verifier implementation, and not runtime evidence. Therefore it receives no closure credit for the red-team gate or settlement authorization.

The checklist also must not be interpreted as already deciding the still-implementation-specific replay mechanism. Its E section states one-time/replay protection at the requirement level, but the eventual rev1 must make that machine-verifiable: exact signed canonical bytes/domain, market/version/scope/digest binding, and a fail-closed verifier/state rule that prevents an already-consumed or superseded adjudication from being reused. A prose checkbox is not evidence of that property.

## Status

- D3-rev1 acceptance checklist: **ACCEPTED AS REVIEW CRITERIA**.
- Immutable D3-rev1 artifact/spec: **STILL MISSING**.
- Adversarial Codex red-team verdict requested in MSG-215: **OPEN / NOT RUNNABLE YET**.
- Runtime implementation/tests: **NOT PRESENT IN THIS INCREMENT**.
- canary#2 settlement: **FAIL-CLOSED / NOT AUTHORIZED**.

When the immutable rev1 blob lands, the red team should attack the artifact/verifier semantics themselves rather than treating this checklist as a substitute for the implementation under review.

No production settlement/refund, DB/CAS mutation, signing/broadcast, key movement, process action, or deployment is authorized by this review.
