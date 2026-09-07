# Codex review — G-1 relay coverage correction

Checked against canonical bridge HEAD `3276d08015cc04aea95ffa3a3b7f1d857cb31167`; canonical bridge had no commit/blob/content delta from the previous processed/writeback baseline. Active branch `bshard-m3-deploy` advanced from `bf86cd3a77fa03f0a922db4dd0a4075b9fce84f8` to `18e2ddfa73ce29baf29ea380e56b52a0b4c5b533` (`ahead_by=8`, `behind_by=0`). The compare contains docs/ledger only; no runtime implementation file changed in this interval.

## Independent code-level findings

1. The correction to the 23:13:54Z rebalance interpretation is valid. `splitUtxosRelay()` and `consolidateUtxosRelay()` in `kasia-relay/src/lib/utxo-split.mjs` import only `withSendLock`, `filterPendingUtxos`, and `markUtxoSpent` from `transaction.mjs`; they build/sign transactions locally and call `pending.submit(rpc)` directly. They do not transit `_sendKaspaInner()`.

2. `_sendKaspaInner()` does contain an `rpc.getServerInfo()` check and rejects when `isSynced` is false. Therefore the observed split/consolidate success cannot be used as evidence that this existing check saw `isSynced=true`; that path bypasses the check entirely.

3. `p2sh.mjs` has direct `rpc.submitTransaction(...)` money-path submission points. At the reviewed submission site the transaction is invariant-checked and then submitted directly, with no node-trust assertion immediately guarding the submit. This independently supports the conclusion that G-1 cannot be closed by changing only `_sendKaspaInner()`.

## Ruling

- `23:13:54Z rebalance proves isSynced-only predicate insufficient`: **RETRACT / NOT SUPPORTED by that event**. That event proves a **coverage hole** in the relay money-path instead.
- `isSynced-only predicate is insufficient in general`: **remains independently supported** by the separate nearly-synced/IBD-flapping evidence already recorded; keep the two evidence chains separate.
- G-1 relay-layer coverage must include at minimum: `_sendKaspaInner()` plus both direct `utxo-split.mjs` submit paths plus every direct P2SH transaction submission path. A single assertion at a genuinely common low-level broadcast boundary would be preferable only if code inspection proves all money-path submits actually transit it; current code does not establish such a single common boundary.
- The proposed trust invariant should be positive/fail-closed: expected network identity AND positively verified readiness/freshness. `false`, RPC failure, timeout, malformed response, stale/unknown state, wrong network, or no node must all reject money-path submission.
- Do not treat `isSynced===true` alone as sufficient production readiness.

## Implementation status

This active-branch interval is documentation/evidence only. No runtime G-1 implementation was added, so **G-1 remains OPEN/HOLD** pending code, negative tests, coverage proof for all money-path submission families, and post-change evidence.

No production payout/refund/settlement selector change, signing/broadcast deployment, money-state DB mutation, key movement, or other production money-path modification is authorized by this review.
