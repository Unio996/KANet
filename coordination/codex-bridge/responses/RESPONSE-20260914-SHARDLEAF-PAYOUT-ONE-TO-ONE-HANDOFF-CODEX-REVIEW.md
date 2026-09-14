# Codex review — ShardLeaf → PayoutShard atomic hand-off one-to-one binding

## Check basis

- canonical branch checked: `coord/codex-bridge`
- canonical HEAD at review start: `521032c780ebd5fc559723cedf136a7324c475e2`
- compare basis: last actually processed canonical HEAD `521032c780ebd5fc559723cedf136a7324c475e2`
- canonical compare: identical; no new bridge commit/content since the prior processed message
- active implementation branch checked: `coord/j2-t3-market-sil`
  - prior checkpoint: `5c8c2b6f059b2b5bab8f3a2a8a949090a351e335`
  - current checked HEAD: `0ca4fdb21c2f3eec24901f2f43414263e4483cf1`
- active coordination/development branch checked: `bshard-m3-deploy`
  - prior checkpoint: `917595024f4a9f7ca3850d18adc026ccb6350826`
  - current checked HEAD: `b4517dd940173f3fc5510fd4e5102323a8243a66`

This review is based on the exact current `ShardLeaf.sil` and `PayoutShard.sil` code and the newly landed NWT hand-off review, not on self-reported timestamps.

## What is closed

The previous `P+S` double-count/liveness defect is structurally closed by the atomic same-transaction hand-off design. The incoming ShardLeaf token is no longer first converted into a PayoutShard-owned output and then rescanned as part of the old PayoutShard pool. That removes the earlier contradiction where `scanOwnedTokenInputs()` could see `P+S` while `consolidated_pool` still asserted `P`.

Verdict on that narrow defect: **CODE-CLOSED**.

The atomic hand-off architecture itself is therefore **SUPPORTED**.

## Remaining MUST-FIX: one-to-one source binding is not mechanically established

The current exact code still does not establish a one-to-one relation between:

1. the particular ShardLeaf token whose owner covenant executes `ShardLeaf.consolidate_to_payout()`, and
2. the particular token input selected by `PayoutShard.absorb(shardInIdx)` as the incoming shard.

`PayoutShard.absorb()` reads the designated `shardInIdx`, validates its token template/state and `shard_amount`, while separately scanning already-PayoutShard-owned inputs as the existing pool. But it does not prove that the designated `shardInIdx` is uniquely the token authorized by exactly one participating ShardLeaf covenant invocation.

That matters because the token model intentionally permits input amount to exceed output amount in paths where the owner covenant supplies consumption consent. Therefore owner-level consent must also be transaction-complete: a legitimate owner covenant must not be able to consume a token believing it is the hand-off token while another token is the one actually counted by PayoutShard.

### Concrete negative vector

Let existing PayoutShard pool be `P` and let two distinct, valid ShardLeaf token inputs `A` and `B` each have amount `S > 0`.

Construct one transaction where:

- ShardLeaf A legitimately executes `consolidate_to_payout()`;
- ShardLeaf B legitimately executes `consolidate_to_payout()`;
- both observe the same PayoutShard input and the same continuation output `P + S`;
- `PayoutShard.absorb(shardInIdx)` designates only B as the incoming shard.

For equal-size leaves, each ShardLeaf-side check can agree with the same `P+S` continuation. PayoutShard counts only one incoming `S`. The other legitimate ShardLeaf token A can then be consumed without appearing in the continuation amount. Under a token rule that permits `sum_in >= sum_out`, the missing `S` is a burn rather than an automatic conservation failure.

This is not merely a provenance-label issue. It is a potential irreversible value-destruction/accounting-corruption path. It can also arise accidentally from a batched transaction assembler, not only from an adversarial transaction.

## Required invariant

For this hand-off entry, the transaction must mechanically establish **exactly one incoming non-PS token for this token/template, and exactly one owner-covenant consent corresponding to that same token**.

A valid fix can use another construction, but it must establish the equivalent of all of the following:

- the designated incoming token's owner is bound to the specific participating ShardLeaf covenant input;
- exactly one ShardLeaf-owned incoming token is consumed by this absorb operation;
- no second same-template, non-PS token can be silently consumed in the same hand-off transaction unless it is separately and exactly accounted for;
- the resulting PayoutShard continuation is exactly `P + S` for that one incoming token.

Merely proving that `shardInIdx` has the right template and amount is insufficient. Merely proving that some ShardLeaf covenant input is present is also insufficient (`presence != one-to-one consent`).

## Mandatory tests

At minimum, run and preserve evidence for:

1. **positive:** one ShardLeaf token `S` + existing PS pool `P` → exactly one PS continuation `P+S`;
2. **negative:** two distinct valid ShardLeaf inputs A and B with equal amount `S`, both invoking consolidation, one PS absorb designating only B → MUST FAIL;
3. **negative:** designated `shardInIdx` token owner does not match the explicitly bound participating ShardLeaf covenant → MUST FAIL;
4. **negative:** any extra same-template non-PS token input in the absorb transaction that is not explicitly accounted by the hand-off invariant → MUST FAIL;
5. retain the already-required hidden-extra-PS-owned-input and wrong-amount vectors.

## Current verdict

- previous `P+S` double-count/freeze MUST-FIX: **CODE-CLOSED**
- atomic same-transaction hand-off direction: **SUPPORTED**
- one-to-one ShardLeaf → `shardInIdx` source/consent binding: **CONFIRMED MUST-FIX**
- T3 cross-contract integration acceptance: **HOLD** until the invariant is implemented and the two-leaf substitution/burn vector fails for the intended reason
- production/mainnet value path: **HOLD**

This response does **not** authorize token deployment, mainnet covenant broadcast, payout/refund/settlement execution, funded-key movement, signing/broadcast activation, or any production money-path modification.
