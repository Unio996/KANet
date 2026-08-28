# Codex review — unsynced Redline-7 plurality fix + gate-(a) v0.2 follow-up

Verdict: **MATERIAL PROGRESS / two remaining acceptance defects.**

I reviewed the current `bshard-m3-deploy` delta after bridge commit `e6d3d2f82cc8226d90ec5920b6d1737173671f4d`, including `tx-mass-ub.mjs`, the independent plurality oracle/fixtures, and the updated §6-3 gate-(a) broadcast plan. No production deployment or money-path authorization is given.

## 1. Redline-7 plurality bug: FIXED AT CODE/MATH LAYER

The previous unsafe assumption `plurality == 1` is removed. The estimator now computes per-cell plurality as:

`ceil((63 + spk_len + (has_covenant ? 32 : 0)) / 100)`

with input covenant status sourced from the matched UTXO entry and output covenant status sourced from the output itself. Storage mass now carries `p^2` in the harmonic terms and `Σp` in the relaxed/general branch logic. This matches the deployed `7b1e18cc` `utxo_plurality` and `calc_storage_mass` model.

The independent NWT oracle is also materially stronger than the prior p=1-only evidence. In particular, the plain->covenant same-value vector producing `3C/v` is a real discriminator for the old under-estimation bug, not a self-confirming fixture.

So I now mark:

- **plurality semantics: CLOSED at code/math layer**
- **old p=1 under-estimation: CLOSED**
- **Redline-7 enforce mode: still HOLD**

The last item remains HOLD because the local estimator still has to accumulate authoritative node/mempool observe evidence over the intended production shapes before any fail-closed enforcement is justified.

### Acceptance defect R7-A: durable test still depends on local scratch path

`kasia-relay/src/lib/tx-mass-ub.test.mjs` currently loads:

`D:/kanet-tn12/scratch/_j2_mass_ub/plurality-fixtures.json`

while the same fixtures have now been durably committed at:

`docs/provenance/2026-08-28-redline7-mass/plurality-fixtures.json`.

This means the production test suite is not clean-checkout reproducible even though the evidence artifact is now durable. A fresh machine can have the correct repo and still fail simply because the host-local `D:/.../scratch` file is absent.

**MUST-FIX before calling the plurality acceptance suite durable:** make the test resolve the committed fixture relative to the repository/module path, and add a clean-checkout/no-scratch self-test or CI assertion. The durable oracle already points in the right direction; the executable acceptance test must stop depending on the gitignored source-of-truth copy.

## 2. Gate-(a) v0.2: claim-on-successor requirement is correctly strengthened

The updated broadcast plan now requires the live RPC-read-back `O_AUTHORIZED` successor to be consumed by the intended `claim(0)` branch and that claim to actually LAND/depth, rather than merely constructing the spend offline. That closes the evidence gap I identified previously.

The negative-vector discipline is also improved: fee-floor, missing-input, not-finalized, transport, and already-spent-before-script rejection are explicitly classified as **inconclusive** for covenant/provenance proof instead of being counted as success merely because the node rejected the transaction.

So I mark:

- **gate-(a) live acceptance shape: PASS direction**
- **gate-(a) overall: still OPEN until the planned deployed-path run exists**

### Acceptance defect GA-A: evidence manifest is internally stale

The v0.2 normative text correctly says `claim` must be broadcast and landed, but the evidence-file inventory still describes:

`live/claim.tx.json, live/recovery.tx.json` as “§3 只构造不广播的两支”.

That contradicts the new criterion. It creates a real provenance ambiguity: a future reviewer could satisfy the file list with a construct-only claim even though the normative acceptance now requires a landed claim.

**MUST-FIX before the live run:** update the evidence contract so claim and recovery are separate:

- `live/claim.tx.json` + txid/depth/landed proof = mandatory chain evidence;
- `live/recovery.tx.json` = construct-only / out-of-scope for chain execution.

The README/MANIFEST should state the same distinction, and the final run should fail if claim lacks a landed/depth record.

## 3. Scope / status

Current accurate status:

- §10 live-arms skip->exit0 bug: **CLOSED** from prior round.
- Redline-7 plurality math/code: **CLOSED**.
- Redline-7 durable acceptance test path: **OPEN / MUST-FIX R7-A**.
- Redline-7 observe->enforce transition: **OPEN / HOLD pending authoritative observe evidence**.
- gate-(a) v0.2 acceptance design: **PASS direction**.
- gate-(a) evidence manifest consistency: **OPEN / MUST-FIX GA-A**.
- gate-(a) deployed-path closure: **OPEN pending actual same-cid successor readback + landed claim**.

No covenant build, migration, restart, deployment, enforce-mode flip, production signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
