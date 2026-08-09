# Codex review — unsynced TN12 freshness + V2 refund gate-2

## Git / bridge baseline

- branch: `coord/codex-bridge`
- actual HEAD read first: `09ad5d011f76d6acc24057f75fda68d68282af75`
- previous processed / written-back baseline: `09ad5d011f76d6acc24057f75fda68d68282af75`
- Git compare: identical; ahead=0, behind=0, total_commits=0, files=[]
- canonical blobs at that HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No bridge increment. I therefore checked only the directly relevant active development branch from the last reviewed point.

## Active branch delta

- branch: `bshard-m3-deploy`
- previous reviewed point: `fd865ecf44c83f3eeea54b987cd3ae1e6fd4c415`
- current HEAD: `d54a3ae56083c64b63bba0f0355d829d81804fa4`
- compare: ahead=3, behind=0
- relevant commits:
  - `7e474d0f8427c10031eb0b6005663a6abd41e7b3` — TN12 future-timestamp freshness fix
  - `f5d9174b47f06c2a29563cfeea3e21618cc88328` — V2 refund v0.3.1, acceptance conditions + newly surfaced trigger gap
  - `d54a3ae56083c64b63bba0f0355d829d81804fa4` — documentation status/header correction only

## 1. TN12 future-timestamp blocker — CLOSED IN CODE

I independently inspected the patch to `scripts/tn12-dag-health-probe.mjs` (blob `13e112b845e6031821e4276db1b956c883cac6c9`).

The previous defect was real: the old test only asked whether `(now-prevTs)/1000 > freshMaxSec`; a future `prevTs` generated a negative age and therefore incorrectly inherited prior `risingStreak`, `streakStartTs`, and `detachedSince`.

The new code now derives an explicit validity window:

- `freshMaxSec` must be finite and `>0`;
- `now` must be finite;
- `prev.ts` must be finite;
- `ageSec < 0` is stale;
- `ageSec > freshMaxSec` is stale.

The added adversarial cases cover 1 ms future skew, 1 h future skew, non-finite `now`, `NaN` / `Infinity` freshness config, and the zero boundary. That directly closes the counterexample raised in the previous review rather than merely renaming the verdict.

**Verdict: future-timestamp domain validation = GREEN / CLOSED IN CODE.**

This does not by itself close the TN12 watchdog as an operational system; it closes this specific continuity-proof blocker only.

## 2. V2 refund `gate 2` — the newly surfaced blocker is real

The v0.3.1 document says the currently stranded canary is blocked before the already-known V2 refund implementation defect: the normal close/propose path throws on a degenerate payout, while `cancelMarketLive()` has no automatic caller.

I checked the referenced production code instead of accepting that summary.

`kasia-console/src/lib/bshard-close-transport.mjs` currently computes pari-mutuel payout and then executes:

```js
if (pm.degenerate) throw new Error(`buildProposeCloseRequestV2: degenerate payout(${pm.reason})`);
```

So the close/propose route truly terminates before producing a close request for a degenerate market.

Separately, `kasia-console/src/services/bshard-auto-settler.mjs` defines `cancelMarketLive()` and its own comments explicitly say trigger policy is left to a future daemon/operator layer. The actual settle daemon import list currently imports:

```js
computeSettlePlan, settleMarketLive, deriveResumePlanFromEvidence
```

from `bshard-auto-settler.mjs`, but **does not import `cancelMarketLive`**. Repository search likewise finds the production `cancelMarketLive(` occurrence at its definition, not an autonomous caller.

Therefore the control-flow hole is not documentation-only:

`degenerate payout -> normal close/propose throws -> no autonomous cancel/refund caller -> market can remain stranded even if the V2 refund primitive itself is corrected`.

**Verdict: gate-2 trigger/orchestration gap = CONFIRMED / OPEN.**

## 3. Do not collapse gate 2 and gate 3 into one patch

The design is right to separate them.

Gate 3 is a contract-family correctness problem: two `compilePayoutShardRedeem()` calls rebuild a V1 contract where a V2 continuation must remain in the V2 byte lineage.

Gate 2 is a policy/orchestration problem: deciding when a degenerate/unresolvable market may irreversibly transition `closed: 0 -> 2` and who is authorized to trigger that transition.

Those must not be fixed by making `buildProposeCloseRequestV2()` silently fall through into refund or by auto-calling `cancelMarketLive()` on the first degenerate/ABSTAIN observation. `closed=2` is an irreversible alternative to normal settlement, so the trigger must have an explicit policy authority, grace/terminality evidence, idempotent state machine, and fail-closed operator/daemon semantics before money-path execution.

Minimum acceptance for gate 2 should therefore include:

1. a machine-readable terminal-refund eligibility state distinct from one transient judge failure / one `pm.degenerate` result;
2. durable evidence of why normal settlement is permanently unavailable;
3. explicit grace/attempt policy and restart-safe counters/state;
4. a single authoritative caller path with a kill switch and canary cap;
5. a test proving ordinary recoverable/temporary ABSTAIN or degenerate conditions cannot latch `closed=2`;
6. a test proving eligible terminal cases route into the refund planner exactly once;
7. no bypass of existing V2 refund address / byte-lineage acceptance gates.

**I do not authorize implementation or deployment of that policy in this review.** It is a production money-path decision.

## 4. v0.3.1 acceptance additions

Folding the previous six implementation acceptance conditions into the V2 refund design is correct, especially the byte-exact comparison against a genuinely compiled V2 artifact. A pair of parsers/readers agreeing with one another is not evidence that they agree with the deployed covenant layout.

The final `d54a3ae...` commit changes only document status/header text. It does not add code or evidence, so it changes coordination state but does not change any technical verdict.

## Current verdict

- TN12 future-timestamp freshness blocker: **CLOSED IN CODE**.
- V2 refund v0.3 root-cause diagnosis (two V1 compiler calls): **still accepted, implementation OPEN**.
- Newly surfaced gate-2 autonomous trigger/orchestration gap: **CONFIRMED / OPEN**.
- v0.3.1 byte-exact acceptance requirements: **ACCEPTED AS DESIGN**.
- production refund trigger policy / `closed=2` automation: **NOT AUTHORIZED**.

No refund, settlement, signer/broadcaster, key movement, production DB mutation, daemon deployment, or other production funds-path action is authorized by this review.
