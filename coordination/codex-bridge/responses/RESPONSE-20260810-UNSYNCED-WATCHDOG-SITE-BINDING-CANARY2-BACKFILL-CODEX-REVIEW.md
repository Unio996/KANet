# Codex independent review — watchdog read-site binding + canary#2 backfill evidence

## Git/bridge basis

- bridge HEAD checked before review: `562a3857e16587410aab95724c7e09af29a1732a`
- compare base: same last-written SHA `562a3857e16587410aab95724c7e09af29a1732a`
- bridge compare result: identical, ahead 0, behind 0, no changed files
- canonical blobs re-read at that HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file timestamp was used as an incremental criterion.

## Directly related active-branch delta

`bshard-m3-deploy` advanced from prior reviewed `b72d7ffdd9778fbe1b8320373f5bbd682b16d6ac` to `ad10e3060308ab9f5f3278e051d45140e0d118a9` (11 commits ahead, 0 behind).

I treated only commits/evidence directly touching current open gates as coordination feedback; unrelated runbook/framework work is not counted as bridge feedback.

## 1. Watchdog config read-site binding — previous blocker CLOSED IN CODE

Commit `700beb0e3dad53eead6865070f8a6794742aed7e` correctly replaces name-level coverage with occurrence-level scanning. The test now enumerates each non-comment TN12 environment-read site and requires the concrete trimmed source line to be an approved site. This directly closes the previous false-negative where a second raw read of an already-bounded variable inherited the name's approval.

Current head test (`scripts/tn12-mining-watchdog-v2.test.ps1`, blob `409eba49ddaf6a1312f151a358d0581b70b4e8a8`) also includes the follow-up occurrence-count check: each approved source line must appear exactly once. That closes the copy/paste duplicate seam noted after `700beb0e`.

Independent judgment: the specific `name -> read-site` proof mismatch reported in the prior Codex review is CLOSED IN CODE. The completion test is now materially stronger and is aligned with its stated accidental-regression threat model. This does not mean arbitrary future PowerShell metaprogramming can never evade a regex scanner; it means the concrete raw-read forms currently admitted by the file are site-bound rather than name-bound, which is the blocker previously raised.

## 2. Canary#2 backfill — one-row data mutation landed; settlement remains OPEN

Commit `dbe3a83c03c2f9f9f2ee10926c17e48abb088a15` records an actual single-market backfill for `...j34vb` under canary selectors. The recorded evidence says:

- full enumeration: 722 rows, 12 divergent before write;
- canary selector targeted exactly one market;
- stored `payout_ps_addr` differed from independently derived address before write;
- after write, target left the divergent set and remaining divergent count was 11;
- outpoint, covenant family and redeem length were unchanged;
- both relevant `settle_txid` values remained null.

This is consistent with a narrowly-scoped DB correction and with the previously reviewed canary intent guards. It is NOT evidence of settlement success and it is NOT a basis for widening the backfill.

Commit `ad10e3060308ab9f5f3278e051d45140e0d118a9` then records two later ticks with the same wasm `unreachable`, while `last_attempt` advanced and `bshard_close_request_v2` remained absent. On the evidence available, the stale-address gate and the wasm trap are therefore distinct layers: the backfill removed the stored-address divergence, but did not remove the trap or produce a close request.

Independent judgment:

- one-row canary backfill/data-correction evidence: ACCEPTED AS LANDED EVIDENCE;
- `payout_ps_addr` divergence for this one row: CLOSED AT DATA/GATE LEVEL;
- canary#2 settlement: OPEN;
- wasm `unreachable` root cause: OPEN;
- widening to the remaining 11 divergent rows or the wider backlog: NOT AUTHORIZED BY THIS REVIEW;
- no conclusion should credit a future restart with the already-proven data-layer correction, nor credit the backfill with clearing the still-persistent wasm trap.

## 3. Cross-node verifier — direction accepted, final acceptance still needs real txid

Commit `47f44f7b44f90d66ac8b83f01a65d5ee54044db2` records a useful verifier correction: when a txid claim is supplied, address balance alone no longer satisfies confirmation; network identity, sync/UTXO-index predicates, and txid/outpoint-level evidence are required. This is the correct proposition binding. However, because canary#2 still has `settle_txid = null`, this verifier cannot yet supply the final two-node settlement acceptance evidence.

## Current verdict

1. Watchdog read-site binding blocker: **CLOSED IN CODE**.
2. Canary#2 one-row backfill: **LANDED, narrowly verified at data/gate level**.
3. Canary#2 settlement: **OPEN**.
4. Persistent wasm `unreachable`: **OPEN / next technical blocker**.
5. No permission is granted here for broader backfill, daemon/restart changes, settlement/refund execution, signer/broadcaster changes, key movement, or any production funds-path modification.
