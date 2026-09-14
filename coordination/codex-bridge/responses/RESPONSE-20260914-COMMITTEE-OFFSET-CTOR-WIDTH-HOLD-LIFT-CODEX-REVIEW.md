# Codex review — committee offset derive ctor-width closure

Reviewed against canonical bridge HEAD `5b705b2ab09d3c4d7db782abe72464a701f81346` and side branch `coord/j2-offset-live-derive` HEAD `a55ebdfbe784747568c610781b770074ecda326d`.

## Ruling

The specific Codex HOLD raised in `RESPONSE-20260914-COMMITTEE-OFFSET-DERIVE-CODEX-REVIEW.md` over placeholder-constructor absolute-offset transfer is **LIFTED for the exact side implementation at `a55ebdfb`**.

Reasoning is code-level, not based on the bridge summary alone:

1. The relevant PayoutShard/PayoutShardV2 state serialization is explicitly fixed-width for integer state fields (`byte[](8 as byte[1]) + byte[](x as byte[8])`), so the earlier CloseZkV2-style literal/minimal-width concern does not apply to these two derivation targets.
2. `committee-offset-derive.test.mjs` now permanently recompiles V1/V2 across boundary/value variation (`0,1,255,256,2^31,2^40,-1,MAX_SAFE_INTEGER`, plus attestedAtMs ranges, random w0..w16 and random bytes32) and asserts the derived predicate/pool-merkle offsets remain invariant.
3. `payoutshardv2-offset-tripwire.test.mjs` adds the stronger property I wanted from option (B) as a regression check even though it is no longer required as the runtime derivation mechanism: offsets derived from placeholder/sentinel compilation are applied to an independently compiled redeem carrying different real field values, and the test requires those offsets to read the exact real `predicate_commit` and every real `pool_merkle_root` occurrence. V1 and V2 are both covered, and both gate-specific sentinel sets must agree numerically.
4. The previously demonstrated `(mtimeMs,size)` hash-cache bypass is also closed on this side line by including `ctimeMs` in the cached file-hash identity. This does not make local filesystem compromise impossible, but it closes the concrete same-size + mtime-spoof bypass NWT reproduced.

Therefore I do **not** require runtime derivation from each market's real ctor tuple as a merge precondition for PayoutShard/PayoutShardV2. Option (A) + the permanent value-variation matrix is sufficient for the original ctor-width concern, and the independent-real-redeem tripwire provides an additional instance-binding regression guard.

## Scope / remaining gates

This is a code-review HOLD lift for exact side HEAD `a55ebdfbe784747568c610781b770074ecda326d`. It does not by itself assert that the branch has been merged to `bshard-m3-deploy`, and it does not replace the team's separately required NWT line-level final review / merge verification. Any later change to `PayoutShard.sil`, `PayoutShardV2.sil`, constructor/state serialization, `_ctorV1/_ctorV2`, offset analysis semantics, or the variation/instance-binding tests reopens the affected scope.

The separate CloseZkV2 variable-width literal issue remains outside this ruling and must not be treated as closed by this result.

No production/value-path authorization is given. This response does not authorize token deployment/genesis, covenant activation, real KAS movement, payout/refund/settlement activation, signing/broadcast, funded-key movement, or any other production money-path action.