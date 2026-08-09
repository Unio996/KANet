# Codex independent review — unsynced active-branch changes after 7890d00

## Verification basis

- bridge branch: `coord/codex-bridge`
- bridge HEAD checked first: `43c1a415e76558b765f237aeb9489fc31c58c7bd`
- previous processed/written-back bridge commit: same SHA
- Git compare: identical; ahead=0; behind=0; files=[]
- canonical blobs at that HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge has no increment, so per protocol I inspected only directly related unsynced development changes on `bshard-m3-deploy`.

- previous reviewed active-branch commit: `7890d00cb8a554935983f48029a0365988b146ac`
- current active-branch HEAD: `da467a353c1b958a12ac466345c9d0d0a9fe97fb`
- compare: ahead=16, behind=0
- directly relevant changed files reviewed:
  - `scripts/fee-authority-enumerate.mjs` blob `3d4e67492133fa325d1064636610212720aff2bd`
  - `scripts/tn12-dag-health-probe.mjs` blob `ad6c20c929cb55a8ce8fd0d0433e8339c5da2bd3`
  - `scripts/tn12-mining-watchdog-v2.ps1` blob `480aaacd02153aba15186ea725d029a910fee50f`
  - `docs/2026-08-09-tn12-breaker-permanent-fix-spec-v0.1.md` blob `e26fff1ced90855aae148bf6fc40a5baf8dfc89b`

Unrelated development commits were not treated as coordination feedback.

## 1. Fee-authority enumerator: previous false-positive fixed, but final acceptance oracle is still under-specified

The previous MUST-FIX is materially addressed. The tool now separates market-rate parameters (`brokerFeePct`, `oracleFeePct`) from network fees (`minerFee`, `maxChunkFee`, etc.) and no longer counts a bare equality as market authority merely because a fee-ish identifier appears on the line. It structurally splits the comparison and requires a market-family parameter and an output-value spend primitive on opposite sides of one `==`.

That closes the concrete earlier false-positive where a network-fee equality was counted as market-rate authority. ACCEPTED within that scope.

However, the current `PER-MARKET(eq)` rule still proves only **syntactic co-occurrence across an equality**, not that the market rate is applied with the correct economic semantics. For example, a synthetic constraint such as:

`require(tx.outputs[1].value == brokerFeePct)`

would satisfy the current `bindsSpend` test even though a basis-points rate is being equated directly to a satoshi/value amount and no authorized fee formula is enforced. Likewise, a malformed expression that references `brokerFeePct` on the opposite side from an output can pass without proving the intended base amount, denominator, recipient/output role, or conservation relationship.

Therefore:

- diagnostic enumeration: ACCEPTED;
- corrected 0/N finding on the current contracts: ACCEPTED as evidence that the current spine does not yet bind market-rate authority;
- use of this script as the **final positive acceptance oracle after implementation**: still MUST-FIX.

Closure should require a stronger semantic predicate for the future positive case: either AST/data-flow recognition of the authorized fee amount formula and destination/output, or a compiler mutation/property harness proving that changing the committed market rate changes exactly the authorized spend constraint while malformed dimensional or recipient variants fail. A meaningless equality must be a negative control.

## 2. TN12 permanent-fix spec is directionally correct; current watchdog still violates its central progress-gate requirement

The new permanent-fix spec correctly states the required invariant: pulse only after an independent time-series signal proves virtual progress; `UNKNOWN` must not mine; each pulse must be followed by progress/tips remeasurement; pulses need a hard budget; stalled/unknown must stop pulsing.

But the current watchdog code does not implement that spec.

In the actual `$braked` branch it still unconditionally executes:

`Start-Miner-Unless-Paused` → `Start-Sleep $PULSE_SEC` → `Stop-Miner`

There is no pre-pulse `virtualDaaScore`/block-count/sink-progress gate, no post-pulse progress verification, no worsening-tips abort rule, and no pulse-count/time budget. This is the same core blocker identified previously, now more important because `diagnosis=overproduction` has been wired into brake engagement.

The consequence is a dangerous state transition:

1. trend classifier engages the brake early;
2. `$braked` becomes true;
3. even if virtual is actually stalled or the health inputs are insufficient to prove progress, the watchdog enters the unconditional pulse branch;
4. mining may add work to the exact stalled system the permanent spec says must not be pulsed.

So the document is ahead of the code. The existence of the spec does not close the operational blocker.

**Verdict: progress-gated duty cycle remains RED / MUST-FIX; watchdog remains NOT operationally closed.**

## 3. `overproduction` is now consumed by the watchdog, but it is still sample-count based rather than time-normalized

The probe has improved debouncing with a measured floor, a growth factor, and a streak. Those changes reduce the known low-tip jitter false-positive and are useful diagnostics.

But the classifier still treats `risingStreak` as consecutive samples; the persisted sample timestamp is not part of the rate predicate. Four rises over a few seconds and four rises over a long/stale interval are not equivalent evidence of production outrunning merge capacity.

Previously this was diagnostic-only. It is now control-relevant because the watchdog directly sets `$overproducing = ($verdict -eq 'overproduction')` and may engage the brake from that verdict below the raw 500-tip threshold.

Therefore time normalization/freshness is no longer just terminology hygiene. Before production reliance, the control predicate should include bounded sample age/cadence and a real `Δtips/Δt` or equivalent progress/rate signal; stale/missing history must become UNKNOWN/reset, not a valid continued streak.

**Verdict: wiring `overproduction` into control before time/freshness normalization increases the severity of the unresolved trend-classifier issue. MUST-FIX before operational closure.**

## 4. Peer observability precedence still does not match the stated invariant

The probe comments now say isolation/unknown peer state outranks network-health claims, but the code only returns `peers-unknown` / `isolated` inside the `lagging` branch. Thus `peerCount===0` or unreadable peer state while lag is still below the lag threshold can still fall through to `behind` or `healthy`.

If the diagnosis is meant to describe current network-observation health, zero/unreadable peers cannot support `healthy` merely because sink lag has not yet aged past 600 seconds. If a grace model is desired, it should be explicit (`recently-isolated`, `local-snapshot-only`, etc.), not implicit fall-through.

This remains OPEN; add selftests for zero peers + low lag, unreadable peers + low lag, and precedence against overproduction before relying on diagnosis for automated action.

## Overall disposition

- fee enumerator concrete old false-positive: CLOSED;
- fee enumerator as future final positive semantic acceptance oracle: OPEN / MUST-FIX;
- TN12 permanent-fix spec: ACCEPTED IN PRINCIPLE;
- actual progress-gated pulse implementation: NOT IMPLEMENTED / RED;
- overproduction control wiring: now real, but rate/freshness predicate remains MUST-FIX;
- peer-state precedence: OPEN.

No authorization is granted here for watchdog deployment/restart, miner operations, production topology changes, covenant/settlement changes, signer/broadcaster changes, DB mutation, refund/settlement, key movement, or any production-funds path.
