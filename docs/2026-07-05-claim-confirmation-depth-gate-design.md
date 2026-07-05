# #33 claim 确认深度门 + resume 接入 ripe query — 设计（2026-07-05, J2）

## 背景

昨晚（2026-07-04 夜）在验证 7rztt/i044k 两个 World Cup bshard 盘的 claim 续跑修复时，发现两个独立、未被 racing 污染的 continuation UTXO 神秘消失（1029KAS 级别）。排除了多 daemon 撞车、跨 agent 操作、reorg（block 仍 isChainBlock=true）。团队收敛结论：`verifyClaimLanded`（`bshard-auto-settler.mjs:333`）目前只做浅确认（"当下 UTXO 存不存在"，8 次 × 4s），跟 2026-06-30 "phantom-leaf" 事故（`reference-landed-shallow-confirm-reorg-phantom-leaf`）同一族根因：TN12 高 reorg 率下，浅确认判定"落地"的 claim 之后仍可能被踢出（自身或前序 TX），导致下一笔 claim 依赖的 continuation outpoint 变成幽灵引用。

同时，`settled_partial_claims` 状态从未被纳入 `selectRipeMarkets` 的候选池，意味着一旦市场卡在这个状态，daemon 永远不会自动重试——只能靠手动 resume（我昨晚写的 position-based resume 逻辑已验证两次正确，但触发方式目前只能手动调用）。

## 现状已有资产（复用，不重造）

`kasia-relay/src/lib/p2sh.mjs:1465` 的 `checkUtxoLanded(address, txid, networkId, minDepth=0)` **已经存在**，是 2026-06-30 phantom-leaf 根治时为 register_append land-gate 写的通用深度确认函数：
- `minDepth=0`（未传）= 旧版 first-seen 行为，向后兼容
- `minDepth>0` = 要求 `virtualDaaScore - blockDaaScore >= minDepth` 才判定 `landed:true`
- fail-closed：`blockDaaScore` 缺失也判 `landed:false`（不猜）
- 已通过 relay 命令 `check_utxo_landed` 暴露（`relay.mjs:1083`），接受 `cmd.minDepth`

**这次不需要新造深度确认机制，只需要让 claim 路径调用这个已有、已经经过 phantom-leaf 事故验证的函数**，跟 register_append 用同一套。

## 改动范围（三处，都在 `bshard-auto-settler.mjs`）

### ① `verifyClaimLanded` 换成深度门

现状（`bshard-auto-settler.mjs:333-342`）：
```js
async function verifyClaimLanded(ctx, winnerAddr, claimTx) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const entries = await ctx.getUtxos(winnerAddr);
      if (entries.some(e => ... transactionId === claimTx)) return true;
    } catch {}
    await _sleep(4000);
  }
  return false;
}
```

改为：调用 `ctx.relayPost(ctx.feeRelay.id, { type: 'check_utxo_landed', address: winnerAddr, txid: claimTx, minDepth: CLAIM_CONFIRM_DEPTH })`，轮询直到 `r.landed === true` 或超过尝试上限。`CLAIM_CONFIRM_DEPTH` 复用 register_append 同款默认值 **20**（已经过 phantom-leaf 实测校准，TN12 reorg 深度恒定 1，20 = 20× 安全余量）。

轮询窗口：depth-20 在 TN12 出块速度下大约几秒到十几秒即可达到（register_append 那次实测 ~2.5s@8BPS 量级），但为防御网络慢/瞬态，仍保留有界重试（例如 20 次 × 3s = 60s 上限，超过判 `false` 走原有"claim not landed — STOP threading"分支，不是新行为，只是判定标准变严格）。

**关键属性（跟今天所有 money-path 教训一致）**：
- fail-closed：depth 查不到/取不到 = 不算 landed，不会误判"成功"。
- 不改变"没 landed 就 STOP threading"的既有安全语义，只是把"landed"的定义从"当下存在"提高到"过了安全深度"。
- 对已经 completed 的老市场零影响（只影响新发生的 claim 判定时机，不回溯改写历史记录）。

### ② `close` 落地确认（`verifyClosedLanded`）同款升级

`bshard-auto-settler.mjs:273` 的 `verifyClosedLanded` 目前也是同款浅确认（10 次轮询查 UTXO 存不存在，没有深度）。close_attest 同样是 claim 链的起点，如果 close 本身是浅确认的，后续所有 claim 都建立在一个可能被 reorg 的地基上。**同一次改动里一并升级**，同样用 `check_utxo_landed` + `minDepth=20`。

### ③ `selectRipeMarkets` 纳入 `settled_partial_claims`

`bshard-settle-daemon.mjs` 的 `selectRipeMarkets` WHERE 条件目前是：
```sql
AND protocol_status IN ('pending_bettors', 'verifying')
```
加入 `'settled_partial_claims'`，让 daemon 的正常 tick 能够重新捡起卡住的市场，调用 `settleOneMarket` → `settleMarketLive`（内部已经有昨晚验证过的 resume 逻辑：读 `settle_evidence.close_txid` 跳过重复 close，读 `winner_details` 位置匹配跳过已完成 claim + 正确 thread continuation state）。

**顺序依赖**：③ 必须在 ①②（深度门）之后部署，否则 daemon 自动重试会重新踩到同样的浅确认陷阱（这也是昨晚顺序：如果先做③不做①②，daemon 自动 resume 反而放大问题——每个 tick 都可能撞一次新的浅确认误判）。

## 验证计划（部署前）

1. 单测：mock `ctx.relayPost` 返回不同 `landed`/`depth` 组合，验证 `verifyClaimLanded`/`verifyClosedLanded` 的轮询终止条件正确（尤其 fail-closed 路径：depth 缺失/depth 不足都不能提前返回 true）。
2. 干净小盘实测：找一个新产生的、bettor 数量少（<10）的 bshard 盘，走完整 close+claim 流程，确认深度门不引入误判（不会把真实成功的 claim 判定失败）且轮询能在合理时间内完成。
3. `selectRipeMarkets` 改动：先只加 WHERE 条件不改优先级，观察 24 个 stranded 盘里有没有被daemon 正常捡起且不再撞 UTXO-not-found（如果 NWT 的 forensic 查清楚了 1029KAS 那笔具体去向，可以针对性验证那个市场）。

## 不在本次范围

- #51（economic layer/fee-split/maker-reclaim）：独立问题，post-launch 单独做，不混在这次改动里。
- 24 个 stranded 盘的具体 DB reconcile（NWT 负责，需要先有区块扫描 forensic 结果才能判定该市场当前真实进度）。
