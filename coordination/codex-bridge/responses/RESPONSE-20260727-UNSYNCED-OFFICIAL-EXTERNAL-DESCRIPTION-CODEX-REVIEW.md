# Codex review — unsynced official external description

## Git basis

- Last processed bridge commit: `64c4b821f1d13703b99aed910a4264f1dc2c3847`
- Incoming `coord/codex-bridge`: identical to the baseline; no canonical-file diff.
- Incoming canonical blobs:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch checked because bridge had no increment: `bshard-m3-deploy`.
- Active branch HEAD: `05cca19040a5e91982ef93b192728719c80b650e`.
- Compare from previously reviewed WIP tip `557554fd5ba8f4ba110b016b273f596c6cfbe121`: ahead by 2 commits; actual changed path is only `docs/2026-07-26-kanet-official-external-description.md`.
- Document blob: `8e0c97f819e20a43a3b31cac4def549611e3a8f8`.

## Independent code findings

1. `bettor-prediction-settler.js` sends the transfer, accepts a returned `txId`, and then transitions the offer to `completed` without calling `checkUtxoLanded` or another chain-landing verifier. Current blob: `63a3f746cc73191235bfb49594740cc33cda72e5`.
2. `exchange-machine.js` explicitly constructs `vr = { confirmed: true, confirmations: 1, ... }` for Kaspa payments solely because a txid was returned. Current blob: `72ebffcbb44faf1ff730506a666aff243cc7c975`.
3. Therefore the document's own disclosure that two money paths do not satisfy the promised "链上结算、任何人都能自己验" condition is code-grounded.

## Verdict

`OWNER_WORDING_PRESERVED__DOCUMENT_STATUS_CURRENT_REJECTED__PROTOCOL_PROMISE_ONLY`

The Owner-ratified wording may remain byte-for-byte unchanged. However, the file-level label `Status: CURRENT` is too broad because the same document proves that two live settlement paths do not meet the promise today. The wording is currently a protocol/product commitment, not a complete current-state claim across all paths.

Required correction:

- Keep the ratified wording unchanged.
- Change the document-level classification to a protocol promise/target statement, or add a machine-readable current-state matrix around it.
- At minimum classify separately:
  - identity,
  - encrypted communication,
  - settlement,
  - external reachability.
- Do not state or imply that all four are currently externally reachable and independently verifiable.

The two money-path fixes remain separately gated design/code work. This review does not authorize deployment, restart, listener exposure, database mutation, signing, broadcast, or funds movement.
