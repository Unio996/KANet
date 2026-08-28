# Codex review — 2026-08-28 unsynced §10 live-arms / Redline-7 / §6-3 gate-(a)

Verdict: **material progress, but Redline-7 estimator has a consensus-model bug and must not enter enforce.**

This review is based on an actual bridge compare first. `coord/codex-bridge` was identical to the prior processed/written commit `438e46e96466b9b8d7c756762e3f3422bc83fd5b`; the canonical bridge files had no content delta. I therefore inspected only directly-related unsynced `bshard-m3-deploy` work and excluded unrelated coordination/maintenance commits.

## 1. §10 run-all fail-open — FIX ACCEPTED

The prior bug was: a load-bearing arm could be `SKIP` because an input was missing, while the orchestrator only failed on explicit `FAIL`, allowing exit 0.

Current `kasia-console/scripts/u1-live-arms/run-all.mjs` fixes the defect in the correct layer:

- all five required inputs are validated **before the first arm executes**;
- missing/nonexistent submission input exits 2 with zero arm results;
- there is no accepted `SKIP` verdict;
- execute mode requires L1–L8 each exactly once and all `PASS`;
- dry-run has an explicit per-arm `PASS/DRY` map;
- parse failure, missing arm, unexpected verdict, duplicate/misaligned arm => non-zero.

The selftest also adds the important negative: omit each required argument individually => exit 2, `MISSING_INPUT`, empty results, zero DB writes.

**Verdict:** the specific `SKIP -> exit 0` MUST-FIX is **CLOSED AT CODE/TEST LAYER**. This does not change the existing rule that GREEN-at-live still requires Owner D-005 authorization plus actual post-migration L1–L8 evidence.

## 2. Redline-7 local mass estimator — NEW MUST-FIX: UTXO plurality is modeled incorrectly

I independently checked `tx-mass-ub.mjs` against rusty-kaspa commit `7b1e18cc`, especially `consensus/core/src/mass/mod.rs`.

The new estimator correctly mirrors many pieces: serialized-size terms, v1 compute-budget mass, v0 sigop mass, transient mass, and the KIP-9 harmonic/arithmetic formulas **if every UTXO plurality p=1**.

However, the implementation currently assumes exactly that for storage mass. Its `storageMass()` computes only from amounts and treats each input/output as plurality 1. It merely throws when an **input SPK length >100 bytes**.

That is not the consensus rule.

At `7b1e18cc`, `utxo_plurality(spk, has_covenant_id)` is:

`ceil((63 + script_len + (has_covenant_id ? 32 : 0)) / 100)`

and `calc_storage_mass()` uses each cell's **p²** in the harmonic terms and total **sum(plurality)** in the relaxed/general branch selection and arithmetic-input term.

This matters immediately for the exact transactions Redline-7 is intended to protect:

- a normal covenant UTXO with a ~34/35-byte script and a covenant id already has `63 + ~35 + 32 ~= 130` bytes => **plurality 2**, despite `spkLen << 100`;
- covenant outputs likewise can have plurality 2;
- the current `normalizeTx()` notices `output.covenant`, but `storageMass()` discards that fact;
- for inputs, `normalizeTx()` records `spkLen` but does not carry `covenantId` / `has_covenant_id` into the storage calculation.

Therefore the stated boundary “only input SPK >100B might have plurality>1” is false for covenant UTXOs.

A minimal unsafe shape demonstrates the direction. With one ordinary p=1 input and one same-value covenant p=2 output, consensus relaxed storage mass is proportional to:

`4*C/v - 1*C/v = 3*C/v`,

while the current local estimator treats both as p=1 and returns:

`1*C/v - 1*C/v = 0`.

That is a direct **under-estimation**, which is the unsafe direction for a fee-floor guard.

The independent `storage-mass-oracle.mjs` already implements the correct generic `plurality` mathematics, but current test vectors default every cell to `plurality=1`; therefore the oracle did not catch the production-shape omission.

### Required fix before any enforce proposal

1. Normalize every input/output into `{amount, plurality}` using the exact consensus formula and exact `has_covenant_id` semantics.
2. Inputs must derive covenant-id presence from the matched UTXO entry, not from the spending tx output shape.
3. Outputs must include covenant presence in plurality.
4. `storageMass()` must use `sum(plurality)`, `p²`, and the exact consensus relaxed/general branch predicate, not object counts with implicit p=1.
5. Add covenant-plurality vectors where p=2 is load-bearing, including at minimum:
   - plain input -> covenant output, same value (must expose the current 0-vs-positive undercount);
   - covenant input -> plain output;
   - covenant input -> covenant output;
   - multi-input/multi-output mixed p=1/p=2 cases where relaxed/general branch selection changes.
6. The independent oracle must receive the same cells only as raw test fixtures; do not derive its expected plurality by calling production estimator helpers, otherwise the test becomes self-confirming.
7. Re-run dominance/production-shape tests after the plurality fix. Existing V1–V8/D-series green results do **not** establish a safe upper bound for covenant money paths because the current vectors do not cover the missing p>1 regime.

**Verdict:** Redline-7 local estimator is **NOT yet an upper bound for covenant transactions**. Observe-only mode may remain diagnostic if explicitly marked non-authoritative, but **enforce is HOLD**. The proposed 7-day `ub_ok=100%` criterion also cannot repair this by itself if authoritative mass is unavailable/inconclusive for precisely the relevant shapes; fix the model first, then observe.

## 3. Redline-7 authoritative observe hook — direction accepted, still evidence-gated

The new submit wrapper is a sensible observe mechanism: after submit it tries `getMempoolEntry`, and on fee rejection it parses the node-provided compute-mass text; it keeps `ub_ok / violation / inconclusive` separate and cleans the pending Map in `finally` with a cap.

I accept this as **observe plumbing direction**, not as estimator closure. In particular:

- `getMempoolEntry` fields must be verified against the live node API before treating `entry.mass` as authoritative;
- reject-text evidence currently covers the known compute-mass form only; storage/transient rejection text remains an explicit inconclusive path;
- `inconclusive=0`, no eviction, no estimator throw, and per-shape coverage remain necessary before a later enforce review.

No enforce authorization is given.

## 4. §6-3 gate-(a) broadcast plan — one criterion is still too weak

The new transition-probe broadcast plan is mostly well scoped: isolated Owner-controlled TN12 key, no relay/market/pool UTXOs, real genesis -> same-cid successor readback, independent negative genesis instances, and durable evidence packaging.

However criterion “successor can enter intended branch” is currently weakened to **offline construction only** for both claim and recovery. That does not close the deployed-runtime part of gate (a): a transaction can serialize correctly while the successor's actual consensus state/cov-id/script cannot be spent as intended.

The plan already says cleanup should use the phase-1 **claim** branch. Make that cleanup transaction part of the acceptance evidence:

`live successor RPC readback same cid -> construct claim from that exact outpoint -> submit -> LAND/depth evidence`.

Recovery can remain construct-only for this minimal probe if waiting for its timelock is explicitly out of scope. But at least one intended successor spend must execute on the deployed path; otherwise gate (a) remains at “continuation exists” rather than “continuation is usable”.

Also preserve negative-cause discipline: a negative only counts if it fails for the intended covenant/provenance reason. Fee-floor, missing-input, not-finalized, or generic transport rejection must not be credited as a wrong-cid/state/script negative.

**Gate (a) remains OPEN** until the exact same-cid successor is read back from RPC/UTXO and a real intended successor branch lands, with wrong-cid / missing-binding / stale-or-wrong-state negatives attributable to the intended guard.

## Status after this review

- §10 `run-all` SKIP fail-open: **CLOSED AT CODE/TEST LAYER**.
- §10 code-layer GREEN: unchanged; GREEN-at-live remains **HOLD** pending D-005/live evidence.
- Redline-7 old wasm mass guard: still **confirmed inactive/fail-open** on TN12.
- Redline-7 local replacement: **OPEN / MUST-FIX plurality semantics; NOT SAFE FOR ENFORCE**.
- Redline-7 authoritative observe wrapper: **PASS direction / evidence-gated**.
- §6-3 gate (a): **OPEN**; live same-cid successor readback plus at least one real successor spend still required.

No covenant build, live migration/restart, deployment, enforce-mode flip, production signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path modification is authorized by this review.