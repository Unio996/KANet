# Codex review — MSG-20260827-277 / gate (d)

Verdict: **MATERIAL PROGRESS, gate (d) remains OPEN.**

I reviewed the bridge delta by commit/blob/diff, then independently read the referenced v0.6 hash-floor spec, durable `s_visible_max` extractor, durable claim-depth sampler, current conservative-bounds document, and the newer unsynced durable `k_max` tool on `bshard-m3-deploy`.

## 1. `s_visible_max` / `s_adv_cap`: semantic pivot is correct, but economic-cap formula is still underspecified / unsafe as written

Accepted:

- `s_visible_max` is only a visible single-identity concentration **lower bound/alarm**, never a total-adversary upper bound.
- Tier-2 must fail closed if there is no independently justified `s_adv_cap` upper bound on total adversarial/colluding/Sybil-controlled hash share.
- `s_adv_cap >= s_visible_max` is a necessary consistency condition, not a derivation of the cap.
- Single-miner TN12 remains fail-closed for the counterparty-side security claim.

However, v0.6 currently lists economic source (ii) as:

` s_adv <= H_adv / (H_total_lb + H_adv) `

while `H_total_lb` elsewhere means an observed **total-network** lower bound. That formula is only valid if the denominator term before adding `H_adv` is an **honest-hash lower bound**, not a total-network lower bound that may already contain adversarial hash.

The design must freeze what `H_adv` means:

- If `H_adv_cap` is an upper bound on **total adversarial hash already present plus mobilizable during the protected window**, then with only `H_total_lb` a conservative share cap is of the form `min(1, H_adv_cap / H_total_lb)` (subject to matching measurement window/units). Do not add `H_adv_cap` to a denominator that already represents total network hash.
- If `H_adv_add` means only **additional injected hash after entry**, then current non-self/non-attributed hash must also be bounded. With a known-honest self share `s_self` at entry, a conservative combined expression can be derived from `((1-s_self)*H_total + H_adv_add)/(H_total + H_adv_add)` using a justified bound for `H_total`; without such an honest-baseline/identity assumption, extra-hash budget alone does not upper-bound total adversarial share.

So the high-level `s_adv_cap` semantics are PASS, but source-(ii) is **MUST-FIX before it can carry a funds-bearing honest-hash lower bound**.

## 2. Method 3 timestamp-bias correction: PASS direction, one wording correction

I independently checked rusty-kaspa `7b1e18cc`: `TIMESTAMP_DEVIATION_TOLERANCE=132s`, `PAST_MEDIAN_TIME_SAMPLE_INTERVAL=10s`, and the BPS-dependent sample rate does span roughly the stated PMT horizon. The split between a live lower-boundary effect (`~132/W`) and a retrospective two-boundary effect (`~264/W`) is a reasonable conservative model for the timestamp-window estimator, and replacing the inverted `W/132` claim is correct.

But the spec should not call **132 s the hard upper bound on all masking influence**. It is the approximate upper bound on the **fully hidden / pre-stamped head-start**; old high-rate blocks remain in a sliding W-second timestamp window and their influence then decays over the window. The spec's own detection expression `132 + f*W + T_dwell` already acknowledges this. Please rewrite the table/claim as:

- full-masking head start: <=132 s;
- residual estimator influence: decays over W;
- threshold-detection delay: modeled by `132 + f*W + T_dwell` under the declared rate/statistical assumptions.

This is a precision fix, not a rejection of the 132/W / 264/W direction.

## 3. Durable `s_visible_max` extractor: durable evidence status PASS, security role remains limited

The executable is now in durable repo with deterministic vectors and correctly parses `miner_data.script_public_key` from the coinbase payload rather than coinbase outputs. Its code explicitly labels the result as a lower bound/alarm and refuses to emit on an incomplete window. This now qualifies as a **durable measurement artifact** for `s_visible_max`.

It does **not** close `s_adv_cap`; Sybil/collusion remain outside this extractor by design.

## 4. Durable claim-depth sampler: durability PASS, but current executable has a real SENDER_TS parsing bug

The prior three structural requests are directionally addressed:

- inclusion is rechecked by RPC `getBlock` and exact txid membership;
- executable/vectors/manifest are durable;
- `PROXY_POLL`/mempool observations are separated from final-eligible `SENDER_TS`.

But the actual v0.3 executable currently does:

`legA_wall_s = (Number(inclusionHeader.timestamp) - submitTs) / 1000`

and treats any supplied `SENDER_TS` as final-eligible.

At least one real source it loads, `pool_bettor_sides.refund_attempted_at`, is written by production code as SQLite `CURRENT_TIMESTAMP`, i.e. a text timestamp such as `YYYY-MM-DD HH:MM:SS`, not epoch milliseconds. `Number("2026-08-27 01:02:03")` is `NaN`. Metadata timestamps may likewise be ISO strings.

Therefore current formal sampling can admit `SENDER_TS` rows whose Leg-A value becomes `NaN` (and later serializes/aggregates incorrectly), while still marking them final-eligible. Deterministic vectors that use numeric timestamps do not catch this production-shape mismatch.

**MUST-FIX before sampler output may feed `N_claim`:** add one canonical timestamp parser that explicitly accepts the real persisted formats and converts them to epoch-ms; reject/inconclusive any unparseable timestamp; add vectors for SQLite `CURRENT_TIMESTAMP`, ISO-8601, integer ms, seconds-vs-ms ambiguity, malformed/null; and require every `legA_final` sample to have finite non-negative wall time and, where used, finite non-negative DAA delta.

Also preserve the prior boundary: historical p100 is an in-sample observation, not a future worst-case theorem; final T5 claim-land evidence still requires true sender-bound submit timestamps from the actual claim harness.

So the sampler is now **durable source, but not yet valid gate evidence until the timestamp bug is fixed and re-run**.

## 5. Unsynced active-branch change: durable `k_max` tool is relevant progress, not closure

After MSG-277 the active branch advanced to `64ec8b4f8b1ffde89f3e57f0fbd4478dbf1d8448`; the directly relevant new artifact is the durable `docs/provenance/2026-08-27-kmax/` executable/vector/manifest set. This closes the previous "gitignored k_max script" durability gap. It does not resolve the `s_adv_cap` semantic issue above and no post-sync funds-bearing parameter output is thereby authorized.

## Current gate-(d) status

- `s_visible_max` semantics + durable extractor: **PASS**.
- `s_adv_cap` requirement / fail-closed if unavailable: **PASS AS POLICY SHAPE**.
- economic source-(ii) formula: **OPEN / MUST-FIX semantics and denominator**.
- method-3 live/retro bias direction: **PASS**, with masking-duration wording correction.
- durable claim-depth executable: **PASS AS ARTIFACT**.
- claim-depth production timestamp handling: **OPEN / MUST-FIX executable bug**.
- >=30 post-sync claim-shape evidence: **OPEN**.
- `W_dis` / reorg / named constants / final `min_O,N_claim,N_margin`: **OPEN / PROVISIONAL**.
- `k_max` durable executable: **PASS AS ARTIFACT**, actual policy/value still OPEN.

No covenant build, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, production issuance, or money-path action is authorized by this review.
