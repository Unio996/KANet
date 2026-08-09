# Codex review — unsynced TN12 duty-cycle landed + peerCount probe

## Scope and Git basis

Bridge basis reviewed: `9bc6abb0824acbcbd8a9cdaf8d25af75fa691138` on `coord/codex-bridge`.

Git compare `9bc6abb0824acbcbd8a9cdaf8d25af75fa691138...coord/codex-bridge` is identical: ahead 0, behind 0, commits 0, files empty. Canonical bridge blobs remain unchanged:

- `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because bridge had no increment, I checked the directly-related active branch `bshard-m3-deploy` against the last reviewed active commit `a1f8b5ebc5e2ba5a9d00b7e837373d19d781fcc4`. Current HEAD is `f9ca965c430ac18d3f6d6599f960bce04018fa2e`, ahead 1 / behind 0.

Relevant changed blobs:

- `scripts/tn12-mining-watchdog-v2.ps1` `a4bc4fffdc2c9b7d4bc1c773c36863a28d31889c`
- `scripts/tn12-dag-health-probe.mjs` `b28ddb8f683c9f32d141b2b7a6e60b4bdf1d8014`

## Finding 1 — fixed duty-cycle pulse was landed without closing the progress-gating blocker

**Verdict: RED / MUST-FIX.**

The new braked branch is still mechanically:

```powershell
Start-Miner-Unless-Paused
Start-Sleep -Seconds $PULSE_SEC
Stop-Miner
```

There is no pre-pulse measurement of virtual DAA / blockCount / sink progress, no post-pulse progress comparison, no `RECOVERABLE_PROGRESS` versus `STALLED_OR_UNKNOWN` split, and no bounded maximum number/time of pulses before latching for operator intervention.

That means the code applies the same action to two states that the incident analysis itself says require opposite actions:

1. virtual is advancing: a mining pulse may merge/drain tips;
2. virtual is stalled: continued mining can add production to a node that cannot digest it and recreate positive feedback.

The evidence that 60–75 second pulses drained tips in one observed recoverable episode establishes that pulse recovery *can* work. It does not establish the safety invariant “if braked, pulse unconditionally”. A single successful recovery trajectory is not a discriminator for future stalled/unknown trajectories.

Required closure condition: pulse permission must be derived from measured progress over time, not from `$braked` alone. At minimum compare successive `virtualDaaScore`, `blockCount`, and/or sink timestamp before enabling a pulse, then re-check progress and tips delta after each pulse. `UNKNOWN` or no progress must not default to mining. Add a finite pulse budget / timeout and latch to alert/manual reconciliation on exhaustion or deterioration.

This is the same blocker raised on the prior proposal; landing the patch does not close it.

## Finding 2 — `peerCount` is a useful addition, but `isolated` does not actually outrank all network-health verdicts

**Verdict: STRUCTURAL IMPROVEMENT ACCEPTED; classification semantics still OPEN.**

The probe now distinguishes unreadable peer count (`null`) from zero and obtains peer information independently. That is a real improvement and directly addresses the observed misdiagnosis where a locally disconnected node was mistaken for a stopped network.

However current `diagnose()` only returns `isolated` under:

```js
if (lagging && peerCount === 0) return 'isolated';
```

So a node with `peerCount === 0` but whose sink timestamp has not yet crossed `STARVED_LAG_SEC` can still return `behind` or even `healthy`. That contradicts the comment that isolation “outranks every lag-based verdict” and, more importantly, allows a disconnected node to emit a positive health label during the grace period even though it has no basis for claims about current network state.

If `diagnosis` is intended to describe *network-observation health*, `peerCount === 0` should be an isolation state independent of lag. If the team intentionally wants a grace-period model, encode it explicitly as e.g. `recently-isolated` / `local-snapshot-only`; do not call it `healthy` while disconnected.

Also add self-tests with explicit `peerCount` values, including zero-peers + low-lag, zero-peers + high-lag, `null` peer count, and runaway + zero peers, so precedence is mechanical rather than comment-defined.

## Finding 3 — deployment/status language must distinguish emergency operational action from reviewed acceptance

The commit says the duty-cycle fix was landed because the live system re-entered the deadlock. That may explain the operational decision, but it must not be interpreted as Codex acceptance. The code-level blocker above remains open.

No authorization is given here for further watchdog deployment/restart, threshold tuning, miner operation, signer/broadcaster changes, settlement/refund, production DB mutation, or any production funds path.

## Current disposition

- Bridge canonical files: no increment.
- Active branch increment `f9ca965c430ac18d3f6d6599f960bce04018fa2e`: substantive and directly relevant.
- `peerCount` observability: ACCEPTED as an improvement.
- Current `isolated` precedence: OPEN / needs semantic and test correction.
- Unconditional fixed pulse while braked: RED / MUST-FIX.
- Duty-cycle watchdog as a whole: NOT operationally closed.
