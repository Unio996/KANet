# Codex review — unsynced active-branch follow-up (R7-A / gate-a / §10 live-arms)

Verdict: **material progress; no production authorization.**

## Bridge baseline

- `coord/codex-bridge` checked HEAD: `6b9882544d9e48a5ade9dbbe317b0d2afa838816`
- compare base→head: identical, ahead 0 / behind 0 / files=[]
- canonical blobs:
  - TO-CODEX `761460b40d37650c775b11a8b3be6d0c2c4e91c0`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Canonical bridge had no delta, so this review is triggered only by directly related active-branch changes.

Active branch inspected: `bshard-m3-deploy` HEAD `5b7604e963b330bcf367dcb81da8c74988e49aac`.

## 1. Redline-7 plurality semantics: CLOSED at code/math layer

The old replacement estimator incorrectly treated all UTXO cells as plurality 1. Current `tx-mass-ub.mjs` now computes per-cell plurality as:

`ceil((63 + spk_len + (has_covenant ? 32 : 0)) / 100)`

with input covenant state coming from the matched UTXO entry and output covenant state from the output. Storage mass now uses the plurality-weighted `p^2` / `Σp` formulas rather than object count. Commit `b9a5b7af076a83113106d1c95f1dfb6d540f09f0` is the load-bearing fix.

The dedicated test suite now includes covenant plurality cases that kill the old implementation, including a plain p=1 input to same-value covenant p=2 output, for which the correct storage term is non-zero while the forced-p=1 mutant yields the old unsafe value.

**Verdict:** plurality MUST-FIX is closed at code/math layer.

### R7-A durable acceptance path: CLOSED

The acceptance test no longer loads its load-bearing fixture from host-local `D:/.../scratch`. It resolves the committed fixture under `docs/provenance/2026-08-28-redline7-mass/plurality-fixtures.json` relative to `import.meta.url`, asserts the path is under `docs/provenance`, asserts it does not contain `scratch`, and asserts the file exists. Commit: `0a738320ab2f69dffed81680679fc9b8b999b24b`.

**Verdict:** the prior clean-checkout reproducibility gap is closed.

### Important boundary

Redline-7 **enforcement is still HOLD**. The local estimator may continue in observe/diagnostic mode, but fail-closed enforcement still requires authoritative node/mempool comparison on real funds-bearing transaction shapes demonstrating that the local estimate does not underbound the deployed-node requirement, with no silent/inconclusive acceptance.

## 2. §10 live-arms runner fail-open: CLOSED at code/test layer

The previous orchestration defect (`missing input -> SKIP -> run-all exit 0`) is fixed in commit `99416c7ad1f6f87f01ada1179fdda15cc241df39`.

Current runner behavior is mechanically fail-closed:

- all required CLI inputs are validated before the first arm runs;
- missing parameter/file exits 2 with zero arm execution;
- there is no SKIP success path;
- `--execute` requires L1-L8 exactly once, all PASS;
- dry-run uses the explicit PASS/DRY map only;
- parse failure, missing arm, duplicate/unexpected verdict, or nonmatching verdict produces non-zero exit;
- any failure stops the sequence.

**Verdict:** runner fail-open MUST-FIX is closed at code/test layer.

**Scope remains unchanged:** §10 `GREEN-at-live` is still HOLD until Owner-authorized D-005 migration/restart and a real post-migration L1-L8 execution produce durable live evidence. Code-layer green is not live green.

## 3. gate (a) broadcast/evidence contract: design direction accepted; deployed-path gate still OPEN

Current v0.2 broadcast plan correctly requires the exact RPC-readback `O_AUTHORIZED` successor to be spent by the intended `claim(0)` branch on-chain:

`read exact outpoint + cov_id -> construct claim -> submit -> LAND -> depth >= 20`.

Recovery remains explicitly construct-only / out-of-scope for chain execution. The evidence inventory is now consistent with that model:

- `live/claim.tx.json` + `live/claim.landed.json` are mandatory on-chain evidence;
- missing landed/depth evidence must fail the run;
- `live/recovery.tx.json` is explicitly construct-only;
- README/MANIFEST must distinguish `onchain:` from `construct-only:`.

The negative-test rejection discipline is also correct: fee-floor, missing-input, not-finalized, transport failure and already-spent failures are inconclusive for covenant/provenance claims; only a rejection demonstrably reaching the intended covenant/provenance layer counts.

Load-bearing plan commits include `d515c8c467321de16b78e3b0a6258bbbcfc257e9`, `2601c7f20ef8050df8381290a89f5f10085479d1`, and the evidence-contract fix `9e1be13c55d475bdf295f74aeccbb5ea26f583a9`.

**Verdict:** gate-(a) acceptance/runbook shape is PASS direction, but gate (a) overall remains OPEN until the real TN12 deployed-path run proves same-cid successor readback plus landed intended successor spend and durable provenance-specific negative evidence.

## Current status

- same-chain Shape-B design: conditionally closed (unchanged)
- §10 code layer: green (unchanged)
- §10 live runner fail-open: closed
- §10 GREEN-at-live: HOLD
- Redline-7 plurality semantics: closed
- Redline-7 clean-checkout acceptance path: closed
- Redline-7 enforce: HOLD pending authoritative observe evidence
- gate (a) runbook/evidence contract: pass direction
- gate (a) deployed-path closure: OPEN

No covenant build, live migration/restart, deployment, enforcement-mode flip, production signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.
