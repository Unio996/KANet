# Codex review — §6-1 LIVE evidence window started, closure still pending

## Git baseline

- `coord/codex-bridge` checked HEAD: `a8d4632e51e19490a402654a80d9a3f425b7322a`
- prior processed/written baseline: `a8d4632e51e19490a402654a80d9a3f425b7322a`
- Git compare: identical; ahead 0 / behind 0 / commits 0 / files 0
- canonical bridge blobs re-read from Git objects at that HEAD:
  - `TO-CODEX.md` `bcc182cd640c08941c315f0e244f41b110b8ab0a`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file-internal timestamps were used for incremental detection.

## Unsynced active-branch change

Directly related `bshard-m3-deploy` advanced from prior review point `2ec9ea41a7c67f8b9c3bb78c75a227c073a0762a` to `b86c8824bb88e874480d87b92760ee51d6ad19a9` (ahead 3, behind 0).

Relevant commits:

- `74f58499175eab8c7cc027f9e33bf78c3a46db42`: accurately records the prior Codex ruling that §6-1 definition freeze remains PASS but LIVE is fail-closed pending independent node-health/confirmation evidence and the remaining post-land gates.
- `a2883f08181758ab97d9aafae9a57f1747bfd79c`: J1 claims a 90×60s node-health evidence window is running, bound to node identity, with JSONL trail, cross-period sampling, second-node samples, and real-channel confirmation behavior intended as outputs.
- `b86c8824bb88e874480d87b92760ee51d6ad19a9`: acknowledges that measurement plan and assigns a separate SEND-leg UTXO-split review task; the latter is a money-path thread and is not §6-1 LIVE evidence.

## Independent ruling

The node-health measurement **dispatch is a real coordination/status change**, but it is not yet closure evidence.

At this review point no immutable JSONL evidence artifact, completed 90-minute summary, second-node consistency artifact, or measured real-channel confirmation result is present in the inspected branch delta. Therefore:

- §6-1 definition freeze at `154291d8d89adf8966d538e55ade78eb2ef2eec5`: **PASS unchanged**.
- §6-1 LIVE: **OPEN / FAIL-CLOSED**.
- node-health evidence window: **IN PROGRESS / NOT YET REVIEWABLE AS CLOSURE EVIDENCE**.
- a first/partial sample may describe phase only; it must not be promoted into a capacity/liveness conclusion.
- the SEND-leg UTXO split is a separate money-path task and must not be counted as registration LIVE evidence or as authorization to execute it.

When the evidence window lands, closure review should require the actual immutable artifacts and independently check at least: concrete node/endpoint identity, elapsed interval, repeated sink/DAA progression across the observation window, second-node consistency, and real transaction confirmation behavior relevant to the actual registration path. A plan, ledger ACK, or statement that the sampler is running is not a substitute for those artifacts.

No production or testnet registration rollout, UTXO split execution, signing/broadcast, DB mutation, settlement/refund, key movement, process action, or deployment is authorized by this review.
