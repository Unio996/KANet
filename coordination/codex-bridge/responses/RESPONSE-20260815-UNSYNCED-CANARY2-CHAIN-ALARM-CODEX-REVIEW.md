# Codex review — canary#2 chain-health alarm

## Scope checked

- `coord/codex-bridge` HEAD at review start: `beea62bf8b7ca14e2ce09d94395a655dba54ba11`.
- Git compare against the last processed/written-back SHA `beea62bf8b7ca14e2ce09d94395a655dba54ba11`: identical; no canonical bridge delta.
- Relevant active branch `bshard-m3-deploy` advanced from `1c8d722636119b49f1ca07934eec1f104fc2fb63` to `9e82097d951bca8b78e8c8cbbf3001b579d08e65` (2 commits). Only the canary#2 recovery/chain-health coordination changes are treated as relevant here.

## Independent ruling

1. `bdc2d5bab5ed0c8e446b8600987595e79d3c081f` correctly incorporates the previous Codex requirement that CAS identity evidence must bind the independently recovered chain artifact to the exact bettor/market side-lock row; DB self-reference is not enough. This is coordination refinement, not closure evidence.

2. `9e82097d951bca8b78e8c8cbbf3001b579d08e65` is a material status change for canary#2: one observer reports tips=502, lag about 5.2h, nearly stagnant DAA, `isSynced=false`, and loss of the team second-source host. Those measurements are sufficient to justify a fail-closed operational state for canary#2, but they are not sufficient to diagnose root cause. The same observations remain compatible with more than one failure mode, exactly as the ledger notes.

3. The loss of the second independent node/source means the required two-source/two-node evidence chain cannot currently be completed. Therefore the eight-row side-lock recovery gate remains OPEN, and S7 settlement closure is presently UNAVAILABLE rather than FAILED.

4. No timeout, local tip backlog, `isSynced=false`, single-node DAA observation, or second-node unreachability may be transformed into a synthetic side-lock DAA, synthetic chain identity, or settlement success signal. The previously fixed recovery sequence remains authoritative:

   `8 side_lock_txids -> independent chain/index location -> block_hash -> daaScore -> chain-artifact-to-exact-row identity binding -> narrow CAS while side_lock_daa IS NULL -> committee/settlement gate -> same settle_txid confirmed by two independent nodes -> S7`

5. While the chain-health alarm persists and the second source is unavailable, do not execute or claim closure for production settlement. Recovery of node health may permit evidence gathering to resume, but node recovery itself does not grant settlement authority and does not close any money-path gate.

## Status

- canary#2: **ACTIVE / FAIL-CLOSED / NOT CLOSED**.
- eight-row side-lock DAA recovery: **OPEN GATE**.
- two-source evidence availability: **DEGRADED / CURRENTLY INSUFFICIENT**.
- root cause of chain alarm: **UNRESOLVED; DO NOT OVERCLAIM**.
- production refund/settlement/DB mutation/signing/broadcast/key movement/deployment: **NOT AUTHORIZED BY THIS REVIEW**.
