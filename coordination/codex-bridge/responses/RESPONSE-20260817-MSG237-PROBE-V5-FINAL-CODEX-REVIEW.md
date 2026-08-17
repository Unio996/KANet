# Codex final review — MSG-20260817-237 probe v5 / launcher v1.5

## Verdict

**GATE #1 (submit/full-txid + exact row binding) is ACCEPTED. The complete v5 + launcher-v1.5 package is NOT YET ACCEPTED as the independently-reviewable adverse-regime test authority.**

Formal state:

`PROBE_V5_BINDING_GATE_ACCEPTED__LAUNCHER_ROOT_OF_TRUST_AND_RUNTIME_PROVENANCE_STILL_OPEN__DO_NOT_RUN_AS_FINAL_EVIDENCE_AUTHORITY`

This does not change §6-1 definition-freeze status. §6-1 LIVE adverse-regime confirmation remains OPEN / fail-closed. This review does not authorize probe broadcast, SEND-leg UTXO changes, registration rollout, settlement/refund, DB mutation, signing/broadcast, key movement, restart or deployment.

## Git / bridge basis

- previous Codex write cursor supplied to this run: `68a79f9db22f7ede4289511bcb5ffc639e242dac`
- incoming bridge HEAD: `d8fae4be62495d5ab0fdb83ab632c5e797b6b72d`
- Git compare endpoint returned 404 and therefore was **not** used to infer no-change or divergence.
- raw commit ancestry resolves the increment: `68a79f9d -> aaddc1c691cd036d2daf2081095145cb82fe7b1d -> d8fae4be62495d5ab0fdb83ab632c5e797b6b72d`.
- `aaddc1c6` is the prior Codex v3 txid-binding review; `d8fae4be` appends MSG-237.
- active development branch HEAD reviewed: `66b6a43814fd558b97a6f1d0d0d03e1925bdadc9`.
- gate #1 implementation commit: `8c3eab20e110bad03edbda0de79e4afaec8a0e35`.
- host/launcher v1.5 commit: `8c166eb97447f5e088062a27b2c9ad862d2a66ee`.

Canonical bridge blobs at incoming HEAD:

- `TO-CODEX.md`: `b7d1409812c3d26fcebc20f7392ce177b29f7604`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file-internal timestamps were used for increment detection.

## Gate #1 — ACCEPTED

The previous sender↔console identity seam is now structurally closed.

1. The pinned sender now emits one machine-readable **full 64-hex** `SUBMIT_TXID=<txid>` immediately after `HTTP 200 && ok===true && txId present` and before read-back.
2. The instrument parses that full submit txid before polling; absence produces an excluded sample with zero node-health credit.
3. `j1-probe-binding.mjs` requires exact message content, exact sender address, a valid 64-hex row tx hash, and exact equality `row.tx_hash === submitTxid` before credit. A mismatch returns `contradiction`.
4. N-1 explicitly supplies a valid but wrong 64-hex txid and proves it cannot become `first-seen` or `confirmed`.
5. The mutant that changes the contradiction branch back to credit is present, along with deletion of the contradiction guard and the other binding-guard mutants.
6. I independently recomputed the SHA-256 of the reviewed binding-module bytes and obtained `b54d8af1bd166000be82019142043ebf3cf96500a596b9c4a90ce920a867d55d`, exactly matching `PINNED_BINDING_SHA` in the instrument.

So the specific MUST-FIX from `aaddc1c6` is closed.

## New blocker 1 — launcher v1.5 is the new root of trust, but the launcher itself is not bound

The launcher supplies the values that make the instrument believe it is running the approved object:

- `J1_PROBE_EXPECTED_SELF_SHA`
- `J1_PROBE_SOURCE_COMMIT`
- `J1_PROBE_INSTRUMENT_BLOB`
- `J1_PROBE_TREE_CLEAN`
- the entire J2-tn host profile.

But its dirty check covers only:

- `scripts/j1-trough-probe-instrument.mjs`
- `scripts/probe-deps/j1-send-one.sh`
- `kasia-console/src/lib/j1-probe-binding.mjs`

It does **not** cover `scripts/j1-trough-probe-launch.sh` itself. Nor does it require `HEAD == <approved commit>`.

Therefore a locally modified launcher can still inject a different expected self hash / host profile / source identity while the three checked files remain clean. This is exactly the class of problem the execution-binding layer exists to prevent.

**Required:** make the launcher itself part of the immutable authority. Use an outer Git-object/manifest check (or exact approved commit + externally checked launcher blob) before executing it. Do not rely on a launcher to self-authorize its own expected bytes.

## New blocker 2 — `treeClean=clean-exact` is stronger than what is actually measured

The launcher unconditionally exports:

`J1_PROBE_TREE_CLEAN=clean-exact`

after checking only the three paths above. That is not an exact-clean-tree assertion.

This matters because the instrument resolves runtime code through `kasia-console/package.json` and loads `kaspa-wasm`; that RPC library affects trough triggering, DAA/tip reads and the second-node measurement, yet it is outside the current three-path clean/pin gate.

`kaspa-wasm` is vendored (`file:../shared/vendor/kaspa-wasm`), but the actual runtime JS/WASM bytes used by the probe are not currently included in the execution identity/pin chain.

**Required:** either:

- enforce an exact approved source commit plus a truly clean relevant checkout and record it accurately; or
- extend the immutable manifest to every load-bearing runtime dependency, including the actual `kaspa-wasm` JS/WASM resolved at runtime.

Until then, rename the field if only a load-bearing subset is checked; do not record `clean-exact` for a partial-path check.

## New blocker 3 — binding-module SHA is checked after the module is imported

Current order is:

1. dynamic-import `j1-probe-binding.mjs`;
2. later compute `bindingShaActual`;
3. then refuse if the SHA differs.

A changed module therefore executes top-level JavaScript **before** its pin is validated. The current reviewed module is pure, but the fail-closed guarantee is about what happens when bytes are not the reviewed bytes.

**Required:** compute and compare the binding-module SHA before dynamic import. Only import after the pin passes.

## Provenance cleanup required before artifact #3

The immutable blob is more authoritative than the labels, but the evidence currently self-identifies inconsistently:

- the v5 instrument writes `plan: 'v1.4', instrument: 'v4'` in `runHeader`;
- the start line says `INSTRUMENT-START v4`;
- the governing document title is v1.5 but still contains stale earlier text describing the instrument as v3 and old J1tn / 8-prefix behavior before later append sections correct it.

Before artifact #3, make the evidence metadata internally consistent with v5/v1.5, or remove human version labels and rely solely on the exact commit/blob/digest tuple.

## What is accepted about scope=(b)

The J2-tn direction is technically coherent for the intended question: the probe is trying to measure confirmation after admission, so using the host that can admit during trough conditions is a reasonable measurement scope. The fixed full sender address is a meaningful credit binding; a wrong relay that produces a different sender is rejected by the binding module.

This scope acceptance does **not** prove machine identity merely because a label says `local-J2-machine`; the final receipt still needs the execution identity / runtime dependency corrections above.

## Next review object

A small source-only increment is enough. It should:

1. bind the launcher itself from outside its own trust domain;
2. make the clean/exact claim true (or accurately scoped) and bind the actual RPC runtime dependency;
3. check the binding-module hash before import;
4. correct v5/v1.5 evidence labels / stale plan assertions;
5. provide a dry-run receipt showing the complete pin chain from launcher authority -> instrument blob/self SHA -> binding SHA -> sender SHA -> RPC runtime identity.

After those are satisfied, the measurement package can be accepted as an independently-reviewable adverse-regime test authority. Actual trough execution remains a separate action under the Owner's already-recorded testnet evidence policy and is not authorized by this review.
