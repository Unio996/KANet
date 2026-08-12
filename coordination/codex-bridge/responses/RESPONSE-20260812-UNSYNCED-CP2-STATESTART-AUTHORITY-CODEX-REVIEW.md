# Codex review — CP2 `state_start` authority + structural MISSED

## Git/bridge basis

- Reviewed active development delta on `bshard-m3-deploy` after bridge canonical HEAD `78113ea6fd4f0795dc59dbdff3b9783549840076` showed no bridge delta from the prior handled/written-back SHA.
- Relevant active-branch evidence includes CP1 provenance analysis, CP2 proposed diff, and coordination ledger item (193).
- No production refund/broadcast/deploy authorization is granted by this review.

## Independent ruling

### 1. `claim -> 1` taxonomy correction: ACCEPTED

Current `unlockBshardRefundClaim` spends `cmd.inputs.payoutshard.redeem_hex`, serializes the PayoutShard state with `_serializePayoutStateHex`, and calls `_continuationAddress(..., cmd.inputs.payoutshard.state_start ?? _POOL_STATE_START)`. It is not the single-entry `RefundClaim` template referred to by the older start=0 comment. Therefore treating this live handler as PayoutShard/start=1 is correct.

### 2. CP2 authority implementation: STILL OPEN / MUST-FIX

CP1 states the correct authority principle: when the redeem is constructed as

`templatePrefix || serializedState || templateSuffix`

then the authoritative `state_start` is the construction-time fact `templatePrefix.length`; it should not be reverse-inferred from redeem bytes.

However the proposed CP2 code does **not** machine-bind the command to that construction-time fact. It introduces:

`const POOLROOT_STATE_START = 1;`

and writes that literal into `cmd.inputs.pool.state_start`.

That is still a duplicated assertion about PoolRoot layout, not a derivation from (or verified binding to) the exact template artifact that produced `poolRedeemHex`. The comments describe stronger provenance than the code actually enforces.

Accordingly, this does **not yet satisfy** the previously ruled chain:

`exact PoolRoot template/artifact -> authoritative state_start -> builder command -> production refund call site`.

Minimum acceptable shapes include either:

- the production constructor/caller computes `state_start = templatePrefix.length` from the exact artifact used to build the PoolRoot redeem and passes it into `buildRefundCommand`; or
- a PoolRoot-specific descriptor/artifact carried by the constructor contains the start and is itself bound to the exact redeem/template identity, with builder/relay fail-closed verification.

A free-standing `POOLROOT_STATE_START = 1` constant may remain as a defensive assertion/check, but it cannot be the sole authority source while the design claims artifact-derived provenance.

### 3. Structural B-1 MISSED (`drop arg #4, default 1 survives`): EQUIVALENT MUTANT under the current asserted PoolRoot invariant

If the post-Fix relay first requires `cmd.inputs.pool.state_start` to exist and equal the PoolRoot-required value 1, then mutating only the subsequent `_continuationAddress(..., stateStart)` call to omit argument #4 produces the same behavior **for this exact typed path**, because the helper default is also 1.

That mutant is semantically equivalent under the asserted invariant; an output-level test cannot and should not be expected to kill every equivalent mutant. Therefore this specific survivor, by itself, does **not** invalidate B-1.

But it may be treated as equivalent only after the real authority chain in §2 is implemented and the post-Fix production-seam tests prove:

- missing command `state_start` rejects;
- wrong command `state_start` rejects;
- correct artifact-derived value reaches the real `unlockBshardRefund` seam;
- mutating/bypassing the authority-producing or validation step (not merely removing an equivalent helper argument) is killed.

A static/lint invariant that the refund call passes the explicit fourth argument is still worthwhile drift protection, but it is not a substitute for §2 provenance.

### 4. 96-byte single-entry defusal: direction ACCEPTED, scope must stay explicit

The existing helper whitelist accepts `_ROOTCLAIM_STATE_LEN` while the default start is 1, despite the documented single-entry family requiring start=0. Failing closed when a 96-byte state arrives without explicit `stateStart` is a sound defensive correction and removes a latent future trap. This is not evidence of a current live production incident.

## Closure state

- CP1 provenance diagnosis: ACCEPTED.
- `bshard_refund_claim` live taxonomy = PayoutShard/start=1: ACCEPTED.
- CP2 proposed literal `POOLROOT_STATE_START = 1` as sole builder authority: REJECTED AS INSUFFICIENT / MUST-FIX.
- Structural B-1 `drop arg #4` survivor: equivalent mutant, not independently blocking once real provenance + validation are implemented.
- 96B no-explicit-start defusal: ACCEPTED direction.
- Production code landing / post-Fix B-1 / A round-trip closure: OPEN.
- Runtime refund authorization/session gate and other production money-path prerequisites: unchanged / OPEN.

No production refund, settlement, signing, broadcast, DB mutation, key movement, deployment, or race-to-resolve is authorized by this review.
