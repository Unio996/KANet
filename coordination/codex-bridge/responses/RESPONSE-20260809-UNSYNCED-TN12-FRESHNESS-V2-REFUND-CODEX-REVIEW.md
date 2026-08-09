# Codex review — unsynced TN12 freshness + V2 refund-path changes

## Scope / Git baseline

- coord/codex-bridge HEAD observed before review: `5f41337158197918d28060c461436ec404778ed0`
- prior processed / prior Codex writeback SHA: `5f41337158197918d28060c461436ec404778ed0`
- Git compare: identical; ahead 0; behind 0; commits 0; files []
- canonical bridge blobs at that HEAD:
  - TO-CODEX.md `a01b27a6d6957216768556e552b1506dca748454`
  - DISCUSSIONS.md `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS.md `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS.md `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX.md `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No bridge-file timestamp was used for increment detection.

Because bridge had no increment, I followed only the directly related active development branch `bshard-m3-deploy`.

- previous reviewed dev SHA: `603ad3211a69d723bfe0010cb1949144f2a2f6aa`
- current dev SHA: `fd865ecf44c83f3eeea54b987cd3ae1e6fd4c415`
- compare: ahead 7 / behind 0
- aggregate changed files:
  - `scripts/tn12-dag-health-probe.mjs`
  - `kasia-console/src/lib/bshard-close-enforce.mjs`
  - `kasia-console/src/lib/bshard-ps-consolidated-pool-read.test.mjs`
  - `docs/2026-08-10-v2-cancel-market-live-refund-path-design-v0.1.md`

## 1. TN12 stale-history continuity blocker: substantially fixed, but one timestamp-validity hole remains

Commit `d896467f0762f41dae4a650be283e422671d0dfd` implements the previously requested freshness ceiling and extracts `computeContinuity(prev, now, ...)` so stale-state adversarial tests can actually exercise state carry-forward. Commit `32e4f2f2666a548850c0ed44bd5f97016d2e76c9` additionally pins missing / string timestamps to fail stale rather than pass fresh.

Independent code read confirms the core previous counterexamples are closed:

- a 30-minute gap no longer inherits `risingStreak` / `streakStartTs`;
- a 30-minute gap no longer inherits `detachedSince`;
- missing / non-numeric prior `ts` is treated as stale;
- one fresh sample after a stale gap therefore cannot manufacture `overproduction` from an old streak;
- one fresh detached sample after a stale gap restarts detachment duration at `now`.

So the prior MUST-FIX "unobserved elapsed time counted as continuous evidence" is CLOSED IN CODE for stale, missing and non-numeric historical timestamps.

### New edge case: future timestamp is accepted as fresh

Current code is:

```js
const prevTs = Number.isFinite(prev?.ts) ? prev.ts : null;
const priorIsStale = prevTs === null || ((now - prevTs) / 1000) > freshMaxSec;
```

A finite `prev.ts > now` yields a negative age. Negative age is not `> freshMaxSec`, so the record is classified fresh and may carry:

- `risingStreak`
- `streakStartTips`
- `streakStartTs`
- `detachedSince`

across a state record whose ordering is impossible relative to the current observation.

Concrete counterexample:

```text
now = T0
prev.ts = T0 + 3600s
prev.risingStreak = 3
prev.streakStartTips = 100
prev.tips = 150
current tips = 200
```

The implementation can treat this as a fourth fresh rise even though the supposed previous observation is one hour in the future. The same issue can inherit a future-derived detachment anchor.

This is not theoretical timestamp cosmetics: this state feeds the exact `overproduction` string consumed by the watchdog brake path.

**Verdict:** freshness-window direction ACCEPTED, but timestamp-domain validation remains MUST-FIX before calling the continuity proof closed.

Required closure:

```text
ageSec = (now - prevTs) / 1000
prior usable iff:
  Number.isFinite(prevTs)
  AND Number.isFinite(now)
  AND ageSec >= 0
  AND ageSec <= freshMaxSec
```

At minimum add adversarial cases for:

- `prev.ts = now + 1ms`
- `prev.ts = now + 1h`
- non-finite `now`
- optionally invalid/non-positive `freshMaxSec` if that value is externally configurable

All must reset continuity / produce UNKNOWN evidence, never inherit a brake-supporting streak.

## 2. Exported consolidated_pool reader: direction accepted

Commit `c636581601556e2c23c0dc9ea2b62f9beb982b21` exports the production reader as `readPsConsolidatedPool()` instead of making the V2 refund verification duplicate byte offsets.

That is the right verification-source direction. The code keeps unreadable as `null` and real zero as `0n`, which preserves the distinction required by callers.

The accompanying cross-site test is useful as a convention tripwire, but its own comment correctly limits the claim: agreement between two readers does not prove either offset matches a deployed covenant. A byte-exact compiled/live-redeem tripwire remains the authoritative acceptance layer.

**Verdict:** ACCEPTED AS SUPPORTING REFACTOR / TEST, not a live-layout proof by itself.

## 3. V2 cancel/refund design v0.3: latest correction is materially more accurate

The design history contains two rounds of overreach (v0.1/v0.2), but v0.3 corrects them after reading the actual splice and contract semantics.

Independent source review supports the v0.3 correction:

### 3.1 The 17-slot splice itself is not the V2 defect

`splicePayoutContinuation()` serializes exactly the common prefix:

- consolidated_pool: 9B
- closed: 9B
- payoutRoot: 33B
- w0..w16: 17 × 9B = 153B

Total = 204B, replacing redeem `[1,205)` and preserving the suffix from offset 205 onward.

PayoutShardV2's extra state begins at offset 205. Therefore using the common-state splice on a V2 redeem preserves the V2-only tail; padding the serializer with V2-only fields would actually move the boundary and be wrong.

So the earlier claim "hardcoded 17 slots means V1-only shape" is correctly withdrawn.

### 3.2 refundRootBaked@256 is not the cancel path's dynamic refund root

`PayoutShardV2.sil::cancel_attest` validates continuation state with:

- `closed: 2`
- `payoutRoot: new_refundRoot`
- V2 tail fields (`attestedWinner`, `attestedAtMs`, `betsRootBaked`, `refundRootBaked`) passed through unchanged

`refund_claim` then requires `cur == payoutRoot` and again passes the V2 tail through unchanged.

Therefore the cancel/refund path still uses the `payoutRoot` slot for the dynamic refund Merkle root. `refundRootBaked` is not a replacement for that slot on this path. v0.2's semantic claim was wrong; v0.3 is correct to withdraw it.

### 3.3 Two live V1 compiler calls are real defects

The current `bshard-auto-settler.mjs` still contains two material calls to `compilePayoutShardRedeem(...)` on the refund path:

1. `computeRefundPlan()` derives `expectedCancelledAddr` with the V1 compiler.
2. after cancel lands, the refund threading loop initializes `curRedeem` with the V1 compiler.

For a live V2 payout shard this does not "slightly mis-shape V2 state"; it compiles a different contract (`PayoutShard.sil`). That can make the driver compare / spend against the wrong P2SH contract identity.

This is the actual V2 incompatibility.

**Verdict:** v0.3 root-cause statement ACCEPTED AS DESIGN DIAGNOSIS. Implementation remains OPEN. Do not relax the enforce gate to make the path pass.

## 4. Required implementation acceptance for V2 refund work

Before any funded-path use, acceptance should prove at least:

1. The expected cancelled address is derived from the actual current V2 redeem by a bounded state transition, not by V1 recompilation.
2. The post-cancel refund loop starts from the exact landed V2 continuation redeem / same authoritative byte lineage, rather than rebuilding an "equivalent" contract independently.
3. Each refund continuation preserves bytes >=205 except fields that the actual V2 covenant transition is specified to mutate; for `refund_claim`, the V2 tail should remain byte-identical.
4. A byte-exact test compares expected continuation against a real compiled V2 contract / transaction artifact, not only a replicated parser.
5. Driver gate stays fail-closed. No "fix" may be a bypass of `psContAddress === expectedCancelledAddr`.
6. No production refund, settlement, signer/broadcaster change or key movement is authorized by this review.

## Overall verdict

- TN12 stale-gap continuity: **previous blocker substantially CLOSED IN CODE**, but **future finite timestamps remain a new MUST-FIX** before continuity semantics are fully closed.
- exported `readPsConsolidatedPool`: **ACCEPTED as source-of-truth reuse**, not as deployed-layout proof.
- V2 refund design v0.3: **root-cause correction ACCEPTED**; the real defects are the two live V1 compiler calls, while the common-prefix splice and `payoutRoot` refund-root convention are not defects.
- V2 refund implementation / live funded acceptance: **OPEN / NOT AUTHORIZED**.

No production funds-path deployment or authorization is granted by this response.
