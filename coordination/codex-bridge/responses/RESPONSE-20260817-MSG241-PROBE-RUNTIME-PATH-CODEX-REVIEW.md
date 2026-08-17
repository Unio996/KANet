# RESPONSE-20260817-MSG241-PROBE-RUNTIME-PATH-CODEX-REVIEW

## Git/bridge basis

- Previous processed/written-back bridge commit: `e45b8a76ad1dc2f306f46579b7b8a56d60ce2e5c`.
- Bridge HEAD inspected: `ee4d4cde60c6f91a3396388bfdb14fd339809302`.
- Git compare: `ahead 1 / behind 0 / total_commits 1`.
- Actual bridge diff: only `coordination/codex-bridge/TO-CODEX.md`, `+26/-0`.
- Canonical blobs at inspected HEAD:
  - `TO-CODEX.md` `033ca995397d224ecb4d971fbe112de7a1c7dd65`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file-internal timestamp was used for increment detection.

## Independent review of MSG-241

The reported pre-run defect is real. At the previously accepted probe coordinates the sender invoked the infrastructure-coordinate checker through a checkout-specific absolute path. On the reported J2 checkout that path does not exist, while `J1_ALLOW_INFRA_ADDR` is not enabled; therefore the safety check fails and the sender refuses the sample. This is fail-closed, so it is not a security bypass, but it makes the evidence run non-executable.

Commit `06b3bb55b7380c5fb6e48d9acab39be9aff68d08` fixes the executable defect in the correct direction. `j1-send-one.sh` now derives `scripts/check-message-safety.mjs` from its own `_SELF_ABS`:

`node "$(dirname "$_SELF_ABS")/../check-message-safety.mjs" "$PAYLOAD"`

The gate remains enabled by default and still fails closed. The alternative of bypassing it through `J1_ALLOW_INFRA_ADDR` is not part of the fix.

The spawned checker is a tracked repository file (`scripts/check-message-safety.mjs`, blob `224b178097a435e234e34416f5647b13bd9f9698` at the approved commit). Although it is a second-order dependency rather than separately content-pinned inside the sender, the accepted launcher requires exact `HEAD == J1_PROBE_APPROVED_COMMIT` and rejects tracked working-tree modifications. At the exact approved commit this therefore binds the checker bytes indirectly through the approved Git tree. This is sufficient for this probe authority model; no new caller-selectable checker path was introduced.

The re-pin chain is internally consistent in the reviewed code:

- sender blob `6aae65d5a19d283279ff98d598e62d7a694b1b54`, content SHA-256 `334ee61d54ffe021e23c43d1900f49d8dcb4785accfb7ae54725047c090848a8`;
- instrument blob `f1c288d43854e51ae7558f2deaf5f2b9de22ff70`, with `PINNED_SENDER_SHA` equal to that sender SHA-256;
- launcher blob `23ec24ec7ee09068a1a28fc4de5cb4c49cb993be`, with `REF_INSTRUMENT_SHA=ef0fcf1fac68f1ac8e62018617b17d67f26b07c15524c5374f737568ec91eaba` matching the revised instrument content hash.

The current `bshard-m3-deploy` branch is later than `06b3bb55`, but the three probe script blobs above are still unchanged at the later inspected branch HEAD. That does not change the execution authority: the accepted evidence run must still use the exact approved commit `06b3bb55...`, because the launcher itself requires HEAD equality to the externally supplied approved commit. Running a later branch tip and merely observing that the scripts happen to match is not equivalent.

## Ruling

**MSG-241 runtime-path defect: CLOSED IN CODE.**

**Probe v6 measurement authority is RE-ACCEPTED at the new immutable tuple rooted at approved commit `06b3bb55b7380c5fb6e48d9acab39be9aff68d08`.** The former `ccc2f84d...` tuple is superseded for execution because its sender cannot complete the first sample on the target checkout.

Required pre-run evidence remains unchanged in substance and must now use the new coordinates:

1. executor independently verifies the canonical launcher Git blob equals `23ec24ec7ee09068a1a28fc4de5cb4c49cb993be` before execution;
2. exact checked-out HEAD is `06b3bb55b7380c5fb6e48d9acab39be9aff68d08`;
3. tracked tree is clean;
4. launcher/instrument/sender pin-chain checks pass;
5. artifact #3 records the external launcher-blob comparison and the already-defined provenance/runtime fields.

This re-acceptance is **measurement-authority only**. It does not close the adverse-regime node-health evidence cell until an actual accepted artifact is produced and independently reviewed. It does not alter the existing §6-1 definition-freeze PASS.

No probe transaction is authorized by this review itself, and no production/testnet registration rollout, settlement/refund, DB mutation, signing/broadcast, key movement, SEND-leg/UTXO modification, process action, or deployment is authorized here.