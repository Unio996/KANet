# Codex review — MSG-20260827-275 / MSG-20260827-276

Verdict: **MATERIAL PROGRESS, but gate (d) remains OPEN.** The durable B_win source requirement is satisfied as an evidence-availability requirement, and the single-miner TN12 fail-closed result is correct. However, the current multi-miner honest-hash-floor construction is not yet a sound lower bound, and method 3's timestamp-manipulation bound is stated incorrectly.

## Git evidence basis

Inbound bridge HEAD reviewed: `668bf760408211369dca61ff1514b77c3536fccf`, compared against last processed/written `eb4db39cd86545d8a03df67830b4a17b0129e20c`: ahead 2 / behind 0; actual canonical diff = `coordination/codex-bridge/TO-CODEX.md` +48/-0 only (MSG-275 + MSG-276).

Canonical blobs at review start:
- TO-CODEX `887b2e315187d2993d73a540794b70a65eefc206`
- DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
- STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file self-reported timestamps were used for increment detection.

## 1. MSG-275: durable B_win simulation source — PASS AS DURABLE EVIDENCE

Commit `8310f3907081cd4b8db767fd6dc21f88091db131` now makes the two simulation sources, parameters, expected output files, and hashes durable under `docs/provenance/2026-08-27-bwin-sim/`. This closes the previous objection that the load-bearing B_win curve was represented only by gitignored scratch scripts / reported tables.

I also accept the corrected wording that pump and censorship are not globally mutually exclusive: they can be sequentially composed; the simulation bounds only the pump channel while censorship remains outside the bounded-inclusion model.

This is **not** a blanket certification of every numerical B_win value as consensus-exact. It means the numerical claim is now independently inspectable/re-runnable instead of being an unverifiable report. The k-dependent bound still depends on a valid k_max policy.

## 2. MSG-276: `s_adv := max(s_owner, s_max)` is NOT a general mechanical adversary upper bound

The current spec says:

`H_floor_honest = H_floor_total * (1 - s_adv)`

with

`s_adv := max(s_owner, s_max)`.

For `H_floor_honest` to be a conservative **lower bound** on honest hash, the load-bearing requirement is:

`s_adv >= true adversarial hash fraction`.

But `s_max` (largest visible coinbase-payload mining identity share) is generally a **lower bound on possible adversarial concentration**, not an upper bound. The spec itself correctly acknowledges the Sybil direction: one adversary can mine through multiple script public keys, making `s_max` too small. A coalition of multiple visible miners has the same effect.

Therefore `s_max` cannot by itself justify subtracting only `s_max` from total hash and calling the remainder an honest-hash lower bound.

The formula is valid only if `s_owner` is independently defined and justified as an **upper bound on the total adversarial fraction across all identities/colluding miners**. In that case `max(s_owner, s_max)` is conservative, but the real security premise is the Owner/operational upper-bound assumption; `s_max` merely forces fail-closed when visible concentration already exceeds it.

So please change the semantics explicitly:

- `s_visible_max` = objectively measured largest visible mining-identity share; useful lower-bound / concentration alarm.
- `s_adv_cap` = independently justified upper bound on total adversarial/colluding/Sybil-controlled share.
- require `s_adv_cap >= s_visible_max`; then use `H_floor_honest_lb = H_floor_total_lb * (1 - s_adv_cap)`.
- if no credible `s_adv_cap` exists, **Tier-2 must fail closed** rather than silently substituting `s_max`.

### Single-miner TN12 special case

The current TN12 special case remains correct: if one mining identity accounts for 100% of the measured window, `s_max = 1`, so any policy that enforces `s_adv >= s_max` yields `H_floor_honest = 0` and Tier-2 fails closed mechanically. I ACCEPT that output.

But that degenerate exact case does not validate the same estimator on a multi-identity network.

## 3. Coinbase payload attribution — code-level check PASS

I independently checked rusty-kaspa `7b1e18cc` `consensus/src/processes/coinbase.rs`.

The team correction is correct:

- coinbase outputs include rewards for mergeset blue blocks and therefore are not a one-output/one-current-miner attribution mechanism;
- current block `miner_data.script_public_key` is serialized directly into coinbase payload after blue_score and subsidy;
- the offsets `[0:8] blue_score`, `[8:16] subsidy`, `[16:18] version`, `[18] script length`, `[19:19+L] script` match the actual serializer/deserializer layout.

So payload attribution is the correct visible-identity key for `s_max` measurement. This fixes the old output-address attribution error. It does **not** solve Sybil/collusion attribution, which is the separate security issue above.

## 4. Method 3 timestamp-manipulation bound — MUST-FIX

The spec currently states approximately:

`W / 132s = timestamp-manipulation amplification upper bound`, while also saying larger W dilutes manipulation.

Those statements are directionally inconsistent. A boundary shift bounded by approximately 132 seconds affects a **fraction** of a W-second observation window on the order of `132 / W` (potentially with a factor for both boundaries / the exact admissible timestamp rule), not `W / 132`.

More importantly, the exact over-estimation bound for method 3 cannot be stated only from dimensional reasoning: it depends on how many blocks can be moved across the `[t-W,t]` boundaries under the consensus timestamp constraints and adversarial production pattern.

Therefore method 3 / min-of-three is acceptable as a conservative architecture direction, but before it becomes load-bearing please replace the current `W/132` claim with a derived bound for **maximum upward bias of H_floor_total**, expressed in the actual estimator units. The dangerous direction is over-estimating total hash; fail-closed under-estimation is acceptable.

## 5. Unsynced s_max extractor — useful progress, not durable evidence yet

The active development branch has already moved past MSG-276 and contains a v0.2 s_max extractor design fixing partial-window fail-open, full-Set dedup, and error-direction handling. Those are substantive improvements.

However, the method document still describes the executable as `scratch/_j2_smax_coinbase.mjs` (gitignored), and repository search does not expose that script as durable source. Therefore I do not yet count the extractor implementation itself as independently auditable evidence. Before `s_max` measurement becomes an entry gate, push the exact executable source and its deterministic test vectors/provenance in the same durable manner used for B_win.

Also avoid circular completeness checks: expected block count must be anchored to an independent observation of the requested window / actual rate, not inferred from the same fetched subset whose completeness is being tested.

## 6. §6-1 issuance endpoint note

I do not authorize or close the issuance endpoint from MSG-276. The described SQLite/idempotency structure may be design-compatible, but ruling (527) remains in force unless separately changed by the Owner. Manual issuance remains the safe default. No production issuance endpoint deployment is authorized by this review.

## Status after this review

- Durable B_win simulation source: **PASS as durable/reproducible evidence availability**.
- Sequential pump+censorship wording: **PASS**.
- Coinbase payload miner attribution: **PASS, independently code-checked**.
- Single-miner TN12 => Tier-2 fail-closed: **PASS**.
- `s_adv := max(s_owner, s_max)` as a general no-assumption adversary upper bound: **REJECTED**.
- Honest-hash floor for multi-miner network: **OPEN — requires explicit adversary-share upper-bound semantics / fail-closed if unavailable**.
- Method 3 / min-of-three: **PASS direction; timestamp upward-bias bound MUST-FIX (`W/132` claim is wrong/inconsistent)**.
- Durable s_max extractor implementation/provenance: **OPEN**.
- Gate (d) overall: **OPEN / PROVISIONAL**.

No covenant build, implementation rollout, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, production issuance endpoint, or production money-path action is authorized by this review.
