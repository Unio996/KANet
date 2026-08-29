# Codex independent review — unsynced gate-(a) fee/mass preflight

## Check basis

- canonical branch at start: `coord/codex-bridge` HEAD `ee48b64c95e2ee468760b75840d4db03762b9989`
- previous processed/written-back baseline: same commit `ee48b64c95e2ee468760b75840d4db03762b9989`
- actual Git compare: identical; ahead 0 / behind 0; no canonical file diff
- canonical blobs re-read from Git objects:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Canonical bridge had no delta. Directly-related active branch `bshard-m3-deploy` advanced from prior checkpoint `1833dc4caec98275af4b367b184a75d2ba73a0aa` to `a97343a2a38a06e38fce5fa6c561349fde6fae4b`. The relevant unsynced change reviewed here is `62c2228d726d055c4de6ee7e99cfa59ca435e123`; unrelated ops/indexer/ZK/UI/broker/eventloop work was excluded from collaboration feedback.

## Independent code-level review

The runbook change correctly removes the old fixed `0.01 KAS/input` assumption and recognizes that a covenant UTXO has plurality `p=2`, not `p=1`. That is consistent with the current `kasia-relay/src/lib/tx-mass-ub.mjs` implementation and the durable Redline-7 provenance package. The estimator's storage term is value-sensitive: it computes terms of the form `C * p^2 / value`, and its main result is `max(compute, storage, transient)`. Current estimator blob at the reviewed active branch is `bff772ce92650d085f261817aa07448d48a526f2`.

The new 1 KAS seed is therefore a materially better probe shape than dust, and the new fee-floor preflight is useful for avoiding ordinary mempool fee rejection. This is operational evidence/preparation, not gate-(a) closure evidence.

### MUST-FIX before any broadcast: close the fee ↔ output-value loop mechanically

The current runbook says broadcast fee is derived as:

`estimateMassUpperBound * 100 sompi/mass * 1.5`

while the same runbook says the covenant seed is recovered by P "minus fee". Therefore the fee changes at least one final output value, while `estimateMassUpperBound`'s storage mass itself depends on final input/output values. A one-pass sequence of "estimate pre-fee shape -> choose fee -> reduce recovery/change output" is not a proof that the final transaction still satisfies the fee floor. `1.5` is slack, but slack is not a mechanically checked invariant.

Required construction rule:

1. construct the candidate with the intended fee/output amounts;
2. run `estimateMassUpperBound` over that **final exact transaction plus exact matched UTXOs**;
3. require, fail-closed, `actual_fee >= final_mass_upper * MIN_SOMPI_PER_MASS` before signing/submission;
4. if changing fee changes an output value, iterate/rebuild until the check is stable (or use a separately proven analytic upper bound covering the final value range);
5. persist final tx bytes/hash, final mass components, matched-UTXO values/covenant IDs/pluralities, actual fee and the inequality result in gate-(a) evidence.

A warning is insufficient at the broadcast boundary. The existing Redline-7 `warn-only` policy may remain appropriate for general observe mode, but this dedicated Owner-authorized gate-(a) broadcast path must treat an indeterminate/failed final fee-floor check as **STOP / no broadcast**. Otherwise a malformed preflight can still fall through to mempool rejection and contaminate N6-N9/P interpretation.

### Additional boundary

`100 sompi/mass` and the local estimator should be treated as the pinned gate-(a) construction assumption until authoritative TN12 node/mempool evidence is captured. A normal fee/mass/standardness rejection remains INCONCLUSIVE, not a covenant/provenance PASS. `getMempoolEntry.mass` / landed evidence can provide the third independent anchor once the node is READY.

## Status

- 1 KAS seed instead of dust: **PASS direction**.
- covenant plurality p=2 in current local estimator: **PASS / previously closed at code-math layer**.
- fixed harness fee removal: **PASS direction**.
- fee/mass preflight as documentation only: **NOT yet fail-closed**.
- final-tx fee↔mass fixed-point / post-construction invariant: **OPEN / MUST-FIX before broadcast**.
- Redline-7 production enforcement generally: **unchanged HOLD**.
- gate-(a) deployed-path closure: **OPEN**.
- same-chain Shape-B / A′ design status: **unchanged**.

No Owner dust/seed budget, signing, broadcast, covenant build, deployment, restart, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
