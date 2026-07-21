# ABSTAIN 退款手动 Runbook（#47，2026-07-04）

> 用于：某 v0.7 bshard 盘因判定源永久拿不到结果（比赛取消、数据源长期故障等）导致 `settle_failed` 反复 ABSTAIN，operator 人工确认后手动退款。**不是自动机制**——什么时候该退，由人判断。

## 何时用

- `pool_markets.protocol_status = 'settle_failed'`，日志里反复出现 `UMA judge ABSTAIN` 或 `judge ABSTAIN`（非 `getBlockAtDaa`/`build fail` 等其它原因）。
- 已确认这不是暂时性的（数据源短暂抽风会自己恢复，不要立刻退款；确认是真的长期拿不到判定，比如比赛官方取消、oracle 源永久下线）。
- **一旦退款，这个盘永远不能再正常结算**（`closed` 是一次性 XOR 闩，cancel_attest 之后 close_attest 再也走不通）。宁可多等，别错退能判的盘。

## 前置检查

```js
// 确认 market 状态 + 有多少 bettor
const m = sqlite.prepare("SELECT * FROM pool_markets WHERE id = ?").get(marketId);
console.log(m.protocol_status, m.deadline, m.deadline_daa);
```

## 执行步骤

在 `kasia-console` 目录下，用 Node 直接调用（不经 HTTP，因为这是 operator 工具非常规用户路径）：

```js
import { buildCtx, ensureReady } from './src/services/bshard-settle-daemon.mjs';
import { computeRefundPlan, cancelMarketLive } from './src/services/bshard-auto-settler.mjs';

await ensureReady();               // 加载 kaspa-wasm + 委员 pk→relay map
const ctx = buildCtx();

// 1. 先 dry-run 看退款计划（谁退多少，不上链）
const plan = await computeRefundPlan(marketId, ctx);
console.log(plan);                 // 检查 refunds 数组金额对不对

// 2. 确认无误后真正执行（会上链：cancel_attest + 逐个 refund_claim）
const res = await cancelMarketLive(marketId, ctx);
console.log(res);
```

`cancelMarketLive` 内部会：
1. 重新算一遍 `computeRefundPlan`
2. consolidate（若还没做过）
3. 委员 4-of-5 签 `cancel_attest`（closed 0→2 write-once）
4. 逐个 bettor 走 `refund_claim`，每笔链上验证到账才继续下一笔

## 结果判读

- `res.ok === true && res.complete === true`：全部退款成功，`res.claims` 里每条都有 `received: true` 且无 `error`。
- `res.complete === false`：部分退款失败（比如中途某个 relay 掉线）。**别重跑整个 `cancelMarketLive`**——`cancel_attest` 已经把 `closed` 锁到 2 了，再跑一次 `cancelMarketLive` 会重新尝试 cancel_attest（这时链上已经是 closed=2，一定会失败）。剩下的 bettor 需要手动续跑 refund_claim 循环（从 `res.cancelTxid` 开始 thread，参考 `bshard-auto-settler.mjs` 里 `cancelMarketLive` 第 7 步的逻辑，或问 J2）。
- 每笔 `claims[i].txId` 都应该能在区块浏览器上查到，收款地址 = 对应 bettor 的 P2PK。

## 写回 DB（人工，暂无自动 writeback）

退款全部确认到账后，手动把市场标记为已处理（当前没有专门的 `refunded_manual` 状态，跟团队确认用哪个状态更合适，或者至少在 `metadata` 里记一笔审计痕迹）：

```js
sqlite.prepare("UPDATE pool_markets SET metadata = json_set(metadata, '$.manual_refund', ?) WHERE id = ?")
  .run(JSON.stringify({ reason: '...', cancelTxid: res.cancelTxid, claims: res.claims, executed_by: '...', executed_at: new Date().toISOString() }), marketId);
```

## 铁律

- **别在没人工确认"真永久判不了"之前就跑这个**——一旦 cancel_attest 上链，这个盘再也不能正常结算了。
- 先 dry-run（只调 `computeRefundPlan`，不调 `cancelMarketLive`）核对退款金额，再真正执行。
- 出问题找 J2（结算域）。

## 额外 case（NWT 2026-07-04 daemon 审计发现，极小概率但记一笔）

如果一个市场是走**正常结算路径**（非 ABSTAIN），`settleMarketLive` 的 close_attest 已经成功上链（covenant 真实 `closed=1`），但紧接着 daemon 的 writeback（DB 写 `settle_evidence`）这一步本身失败（比如 DB 锁）——这种情况下市场会卡在 `settle_failed`，但**跟这份 runbook 的"永久 ABSTAIN 退款"场景完全不同**：

- **别对这类市场跑 `cancelMarketLive`**——它已经 `closed=1` 了（正常结算方向），不是该退款的场景（退款是给"判不出结果"的市场用的，判定结果已经有了不该走这条路）。
- 先查链上真相：spine/PS 地址的实际 `closed` 值是 0 还是 1（直接查 PS UTXO 的 redeem script 状态，或问 J2 复用 #21/tdz3v 那次的链上验证方法）。
- 若确认 `closed=1`（close 已成功，只是 claim/writeback 没走完）：需要手动 resume **claim 循环**（不是重新 cancel/close），参考 `bshard-auto-settler.mjs` 里 `settleMarketLive` 第 7 步的 claim 逻辑（跟 `cancelMarketLive` 第 7 步的 refund_claim 结构一样，只是调 `bshard_payout_claim` 不是 `bshard_refund_claim`）。问 J2。
