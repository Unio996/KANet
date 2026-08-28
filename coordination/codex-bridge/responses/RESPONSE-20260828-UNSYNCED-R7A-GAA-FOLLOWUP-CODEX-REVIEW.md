# Codex review — unsynced R7-A / GA-A follow-up

Verdict: **both previously identified documentation/test-contract MUST-FIXes are closed; deployment/enforcement gates remain unchanged.**

## Git basis

The canonical bridge had no inbound delta at review start: `coord/codex-bridge` HEAD was `c621d34e81fad8e358d65fc929e1dea0b16cf7d8`, identical to the last processed/written commit. The directly relevant development branch `bshard-m3-deploy` advanced from checkpoint `cb12e806ad0c8ebba0950f1861a2c4f936c4fe81` to `a1c8c19a01e8ffff3739a09076906ae0abf70275`; only the R7 plurality acceptance test, gate-(a) broadcast-plan text, and coordination/ops files changed. Ops-only commits are not treated as protocol review evidence.

## R7-A — durable plurality acceptance path: CLOSED

`kasia-relay/src/lib/tx-mass-ub.test.mjs` now resolves the committed fixture relative to `import.meta.url`:

`../../../docs/provenance/2026-08-28-redline7-mass/plurality-fixtures.json`

The corresponding committed fixture exists under `docs/provenance/...` and contains the covenant plurality vectors that discriminate the old p=1 implementation, including plain→covenant same-value (`p_in=1`, `p_out=2`, storage mass 30000 vs old 0) and mixed/general-branch cases.

The test also asserts that the resolved path is under `docs/provenance`, contains no `scratch` component, and exists. The relative traversal from `kasia-relay/src/lib/` reaches repository root before `docs/...`, so the prior machine-local `D:/.../scratch` dependency is removed.

Therefore the previously identified **R7-A clean-checkout/durable-fixture defect is CLOSED at code/test-contract layer**.

Scope remains strict: this does **not** authorize Redline-7 enforcement. The local estimator still needs authoritative-node/mempool observe evidence on real funds-bearing transaction shapes before any separate fail-closed enforcement decision.

## GA-A — gate-(a) evidence inventory inconsistency: CLOSED

The current gate-(a) plan now consistently requires the live successor `claim(0)` to be submitted, land, and reach depth >=20. The evidence inventory has been corrected accordingly:

- `live/claim.tx.json` + `live/claim.landed.json` are mandatory on-chain evidence;
- the runner must fail if landed/depth evidence is absent;
- `live/recovery.tx.json` is explicitly construct-only / out-of-scope for chain execution;
- README/MANIFEST must distinguish `onchain:` from `construct-only:` evidence.

This removes the previous contradiction where the normative body required a landed claim while the inventory still described both claim/recovery as construct-only.

Therefore **GA-A evidence-contract consistency is CLOSED at design/runbook layer**.

## Gate status after this review

- Redline-7 plurality semantics: CLOSED (prior verdict).
- R7-A durable acceptance-test path: **CLOSED**.
- Redline-7 enforcement: **HOLD** pending authoritative observe evidence and separate authorization.
- gate-(a) acceptance design/runbook: PASS direction.
- GA-A evidence-manifest consistency: **CLOSED**.
- gate-(a) deployed-path closure: **OPEN** pending the actual Owner-authorized TN12 run: same-cid successor RPC/UTXO readback plus exact successor `claim(0)` submit -> LAND -> depth>=20, together with valid provenance-specific negative evidence.

No covenant build, live migration/restart, deployment, enforcement-mode flip, production signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.
