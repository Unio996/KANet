# Codex review — unsynced external README scope corrections

## Git evidence basis

- Bridge baseline/current HEAD before this response: `1cd7d58a9d66057e04acf02d1575bfa204f7384b` (compare identical).
- Active branch baseline: `708edf91f10245dcb9caeaaaa40e5a4ccc2185fb`.
- Active branch reviewed HEAD: `43971b567a91b76b54a028ef0fc7d8231c4a2317`.
- Compare: ahead 13, behind 0.
- Relevant changed paths: `docs/examples/kanet-external/README.md`, `docs/iteration/COORD-LEDGER.md`, `docs/iteration/HANDOFF-NOW.md`.
- Current blobs: README `ff6b65f6409128c5eec26d86ec1bc8c3b833170d`; COORD-LEDGER `6473cb3a512e7411b215f0b7a2863d91d81f24f8`; HANDOFF-NOW `6312f700b1400fe7c1ba52af3b487f3421083e44`.

## Verdict

`SCOPE_CORRECTION_ACCEPTED__TOP_LEVEL_SEND_READY_CLAIM_STILL_TOO_STRONG__FRESH_HOST_SYNC_AND_BROADCAST_E2E_REMAIN_OPEN__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

1. **The new scope correction is valid and important.** The active coordination record now explicitly retracts the claim that a genuinely new external machine was tested. The observation was only an empty appdir on a host already running another TN12 node; the reported `--addpeer` path had only reached sync start, not sync completion. Removing the “2h10m” figure from outward-facing guidance is therefore correct.

2. **The README top-level promise remains broader than the proved evidence.** It still says an unknown external developer can follow the guide “from zero” to an on-chain message using their own node. That statement currently combines several unclosed steps:
   - no completed synchronization run on a genuinely fresh host;
   - no independently verified external `--to` transaction construction/broadcast/acceptance path from the current source;
   - no txid + inclusion + fee/change reconciliation + recipient-side plaintext recovery bundle.

   Until those exist, the accurate claim is: identity/envelope/offline construction self-checks are reproducible; the architecture permits an independently operated TN12 node; complete fresh-host node bootstrap and current-script send/receive E2E remain unverified.

3. **The README correctly narrows test scope later in the document, but the first-screen summary still conflicts with that boundary.** A reader can reasonably stop at the opening promise and miss the later qualification. The opening section should carry the strictest evidence boundary, not the aspirational architecture conclusion.

4. **The coordination lesson about predicate-aligned positive controls is accepted.** A positive control for one query path does not validate a different predicate (for example, exact-code lookup versus `LIKE '<code>%'`). Any new extractor/index must emit its own positive control and explicit coverage boundary.

5. **Roadmap convergence does not lift settlement gates.** The newly synchronized roadmap/coordination text correctly preserves the existing requirement for one settlement-truth authority and mechanical enumeration of every `completed` writer. No deployment, signing, broadcast, refund, settlement or other funds-path action is authorized by this review.

## Required closure evidence

- A genuinely fresh host or VM with no pre-existing TN12 process/state, with command line, network environment, start/end DAA, elapsed time, peer discovery path, and successful completion evidence.
- Current pinned source commit and wasm blob.
- One disposable TN12 send: txid, inclusion/depth, exact fee/change, recipient-side production-path decryption and plaintext hash match.
- Opening README language changed so it does not claim complete from-zero send readiness before those artifacts exist.
