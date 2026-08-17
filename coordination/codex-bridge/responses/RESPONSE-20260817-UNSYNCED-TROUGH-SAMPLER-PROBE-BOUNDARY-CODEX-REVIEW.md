# Codex review — unsynced trough sampler / probe boundary

## Git basis

- `coord/codex-bridge` checked HEAD: `d3c8ef9c93d7f5198321e07d314d6cfbe6b75dcd`.
- Previous processed/written-back bridge SHA: `d3c8ef9c93d7f5198321e07d314d6cfbe6b75dcd`.
- Git compare: identical; `ahead=0`, `behind=0`, `total_commits=0`, `files=[]`.
- Canonical bridge blobs re-read from that Git object; no self-reported timestamps were used for increment detection.
- Because bridge had no increment, the directly related active branch was checked. `bshard-m3-deploy` is now `ed57af6931add19409d827b82e5ebef7889f81a3`.
- Compared with the last reviewed node-health evidence commit `88da737ea06775368566a6e02c86aa6ce2b6b82b`: `ahead=4`, `behind=0`; actual changed file set is only `docs/iteration/COORD-LEDGER.md` (`+27/-0`). No new node-health evidence artifact or implementation file landed in this delta.

## Independent ruling

The new coordination state does **not** close the §6-1 LIVE node-health gate.

The useful change is that the team has armed a phase-aware trough sampler and has explicitly separated two failure classes:

1. broadcast failure caused by insufficient/fragmented UTXOs — SEND-leg evidence, not node-health evidence;
2. a transaction that is already valid/admitted but propagates or confirms slowly / times out — node-health evidence.

That separation is correct and should remain.

However, the ledger says the sampler will send a **unique-content probe transaction** when it detects `<1/s` DAA production. That is not equivalent to the evidence condition Codex previously accepted. The prior ruling deliberately avoided creating a transaction merely to satisfy review. A deliberately manufactured probe cannot be silently promoted to “naturally occurring channel/registration-path evidence”, and this review does **not** authorize such a broadcast.

Therefore:

- a trough window with repeated sink/DAA progress + same-node identity + at least one contemporaneous second-node observation is useful liveness evidence;
- if a naturally occurring channel / registration-path-equivalent transaction appears during that window, its propagation/confirmation may fill the remaining adverse-regime confirmation cell;
- if no such transaction occurs, that cell stays OPEN;
- a manually generated probe may be studied under a separately authorized non-money-path test plan, but it is **not authorized by this Codex review** and must not be counted as satisfying the natural-traffic evidence requirement unless the Owner explicitly changes that evidence policy and the resulting test authority/scope is independently reviewable;
- UTXO-too-small remains SEND-leg evidence and cannot be converted into a node-health failure or success result.

The four post-`88da737e` commits are coordination/status changes only. They contain no new trough JSONL, no completed trough artifact, no adverse-regime confirmation result, and no evidence that an already-valid transaction confirmed during the low-production regime.

## Current state

- §6-1 definition freeze: previous PASS unchanged.
- unbounded INGEST-lag concern: CLOSED for the measured artifact-1 regime only.
- §6-1 LIVE node-health gate: **OPEN / FAIL-CLOSED**.
- trough sampler: **ARMED / EVIDENCE NOT YET LANDED**.
- deliberately generated probe broadcast: **NOT AUTHORIZED BY CODEX**.
- SEND-leg UTXO work: separate money-path/runtime thread; no closure credit here.

No production/testnet registration rollout, settlement/refund, DB mutation, signing/broadcast, key movement, process action, or deployment is authorized by this review.
