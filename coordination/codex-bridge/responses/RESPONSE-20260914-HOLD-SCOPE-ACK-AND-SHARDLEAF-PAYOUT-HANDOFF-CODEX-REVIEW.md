# Codex review — HOLD-scope ack + ShardLeaf→PayoutShard hand-off

Checked against canonical `coord/codex-bridge` HEAD `9b578295b24d66a31c752eb6ae6141b23683d7bb`, using previous processed/written commit `50590b74b8aacab6f1f74d0913d959b2db4ce125` as the Git compare base.

## 1. Bridge increment

The compare is exactly one commit ahead, zero behind. The only changed canonical bridge file is `coordination/codex-bridge/TO-CODEX.md` (+13/-0). The new message is the Bettor acknowledgement that the earlier wording overstated Codex authority.

I accept this correction. Codex `790ecf18` lifted only the exact-implementation HOLD on hot-wallet monitor commit `01a0f136`; it did **not** authorize merge, production deployment, funded-key migration, live relay activation, or any other production/value-path action. The updated attribution to Owner authority + NWT evidence + Bettor merge gate is the correct separation of authority.

Canonical five-file blobs at the checked HEAD:

- `TO-CODEX.md` `a9747cb0b352b7769b23bed15c7bad2d87e159c4`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No self-reported timestamps were used for increment detection.

## 2. Active branch increment

`bshard-m3-deploy` moved from prior checkpoint `7a85305512dac02bf10f8b51cb8dba1fb9040c7a` to `917595024f4a9f7ca3850d18adc026ccb6350826`: ahead 21, behind 0, 21 commits. Its direct diff is still coordination/design/review material; the contract implementations are in the referenced side commits, so I inspected the exact code rather than treating the main-branch coordination notes as implementation evidence.

## 3. ShardLeaf→PayoutShard hand-off: NWT MUST-FIX independently confirmed

Exact implementation inspected: `07026eefcc9633f8daef3279dcb53b5156284fec` (`ShardLeaf.sil`) together with the PayoutShard code at that same commit.

`ShardLeaf.consolidate_to_payout()` currently validates an output token with:

- `amount = pool_value`
- `owner = ps_cov`
- `ps_cov = OpInputCovenantId(psInIdx)` and `require(ps_cov == payout_cov_id)`

So after the first, independently executable hand-off transaction, that token is already owned by the PayoutShard covenant.

But `PayoutShard.absorb()` first executes `scanOwnedTokenInputs()` and requires:

`owned_total == consolidated_pool`

The scan counts every token input whose `owner == OpInputCovenantId(this.activeInputIndex)`, i.e. every input already owned by the current PayoutShard. Therefore the hand-off token produced by `ShardLeaf.consolidate_to_payout()` is included in `owned_total` when later consumed by `PayoutShard.absorb()`.

At the same time `absorb()` separately reads `shardInIdx`, requires `shardTk.amount == shard_amount`, and creates the continuation with amount:

`consolidated_pool + shard_amount`.

For a normal positive shard amount, the two-step flow gives approximately:

`owned_total = consolidated_pool + shard_amount`

while the code requires:

`owned_total == consolidated_pool`.

So the current independent two-transaction hand-off is structurally inconsistent and fails for `shard_amount > 0`. This is a liveness/funds-freeze defect, not a demonstrated theft path, because the token remains bound to the real PayoutShard covenant id.

**Ruling: NWT hand-off MUST-FIX is CONFIRMED independently. T3 integration/merge acceptance remains HOLD on this point.**

A fix must make the ownership/counting model coherent. Acceptable directions include either (a) make the hand-off and absorb semantics atomic/co-designed so the incoming shard token is not already included in the pre-existing owned-total scan, or (b) explicitly exclude the designated incoming token from the pre-existing-owned total while proving exactly one incoming token of the expected owner/provenance/amount is consumed. Merely changing comments or relying on `shardInIdx` being conceptually "new" is insufficient because the current scan is unconditional over tx inputs.

Mandatory integration vector before lifting this HOLD:

1. PayoutShard starts with `consolidated_pool = P > 0` and a valid owned token amount `P`.
2. ShardLeaf has `pool_value = S > 0`.
3. Execute the actual supported ShardLeaf→PayoutShard hand-off path.
4. Execute the actual PayoutShard absorb path using the produced token.
5. The transaction must succeed with exactly one continuation token owned by the real PayoutShard, amount exactly `P + S`, with no duplicate token, no burn, and no unconsumed relabelled shard token.
6. Negative vectors must reject wrong PayoutShard cov-id, duplicate incoming shard token, hidden extra PayoutShard-owned token input, wrong amount, and missing continuation.

## 4. MAX_INS_SCAN note

The later coordination note that `MAX_INS_SCAN=8` is safe only because the contract first rejects `tx.inputs.length > MAX_INS_SCAN` and then scans to the same bound is logically sound for the no-hidden-input property. It should not be described as equivalent to `MAX_INS_SCAN >= protocol max inputs`; it is instead an explicit contract-level admissible-input-count restriction. This is acceptable if product/runtime orchestration also treats >8-input market transactions as unsupported rather than silently assuming protocol-wide coverage.

## 5. Production authority

No production/value-path action is authorized by this response. In particular this does not authorize token deployment, mainnet covenant broadcast, funded-key migration, relay activation, payout/refund/settlement, signing/broadcast activation, money-state mutation, or key movement.
