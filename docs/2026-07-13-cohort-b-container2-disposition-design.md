> **Status**: CURRENT (设计稿 v1.1·Bettor 方向审 GREEN-with-3-notes + NWT 红队 GREEN-with-1-MUST-FIX 已折入)

# cohort B(10 盘)容器②先行处置 + 附属拆雷设计

**作者**: J2 · 2026-07-13 · Bettor 派工(队列(2)，Owner"一鼓作气"重开班段，#i5cl3g)
**依据**: 今晚 dry-run(`docs/2026-07-13-bshard-poolspine-maker-bond-reclaim-design.md`)坐实——这 10 盘卡在闸②(`hasVerifiedContainer2Evidence=false`)，跟 7pori 拆雷前同款结构性卡住(legacy `dispatchRefund` 建过 `refund_tx_obj` 但 `handleRefunding` 因 isBshard-skip 永远碰不到)。

## 0. 范围(查资产已核实，非猜测)

10 盘：`trf38/ghj3i/qi37q/o053f/17q0b/nnd1g/y3lqh/t5eww/uwb4z/7g8bu`。逐盘核实 `payout_shards` 行已存在(consolidate 已完成，`payout_ps_outpoint` 有值)——container② 结构性可执行，非猜测。bet 数跨度大(1~52 笔，nnd1g 52 笔最大)，金额跨度需 dry-run 时逐盘列出，不假设均质。

## 1. 复用清单(零新机制)

| 资产 | 用途 |
|---|---|
| `computeRefundPlan(marketId, ctx)`(`bshard-auto-settler.mjs:634+`) | 纯计算 container② 退款方案(refundRoot/committee/expectedCancelledAddr)，7pori 已验 |
| `cancelMarketLive(marketId, ctx)`(`bshard-auto-settler.mjs:706+`) | container② 全链路编排(build cancel_attest→enforce→sign→submit→refund_claim 循环)，7pori 已验，零改动直接复用 |
| `reclaimBshardMakerBond(marketId, ctx)`(今晚新交付) | container① 收口，10 盘 container② 完成后逐盘调用，已测已 live-proven |

**本设计唯一的新代码 = 一个"清 legacy 死形状字段"的小工具函数**(§2)，其余全部复用今晚已验证的组合，不重造。

## 2. 附属拆雷：清 legacy 死形状四字段

10 盘的 `metadata` 都带着 `refund_tx_obj`/`refund_reason`/`refund_dispatched_at`/`refund_amount` 四个字段——这是 legacy `dispatchRefund` 在 isBshard-skip 生效前误建的死形状(跟 7pori 拆雷前一模一样)。当前它们**无害**(`handleRefunding` 摸不到，不会被误签名广播)，但正是这类"看似无害的错形状痕迹"是定时雷——将来若 isBshard-skip 逻辑被改动/放开，这些错形状 tx 可能被意外拾起签名广播。

```js
// bshard-auto-settler.mjs 新增导出:
export function clearLegacyRefundDeadShape(marketId, db) {
  const market = db.prepare('SELECT metadata, protocol_status FROM pool_markets WHERE id = ?').get(marketId);
  if (!market) return { ok: false, reason: 'market 不存在' };
  // 🔴 NWT 红队 MUST-FIX(已折入): 只查 refund_tx_obj 存在是必要非充分条件——若这函数将来被
  // 误用在一个非 bshard 市场上(该市场的 refund_tx_obj 是 legacy handleRefunding 正常流程中的
  // 合法 in-flight 状态，非死形状)，会把一笔真实待广播的退款静默清空，handleRefunding 下次 tick
  // 直接 skip(meta.refund_tx_obj 缺失)，钱卡死且零报错。纵深防御: 不能只信调用方传对了
  // marketId 列表，函数内部自己也校验 isBshard(同 reclaimBshardMakerBond 闸①同款判据)。
  const isBshard = !!db.prepare('SELECT 1 FROM market_shards WHERE logical_market_id = ? LIMIT 1').get(marketId);
  if (!isBshard) return { ok: false, reason: '非 bshard 市场——refund_tx_obj 可能是 legacy 正常流程 in-flight 状态，拒绝清理(纵深防御)' };
  // tripwire guard(同 7pori 拆雷惯例): 必须真的带着 refund_tx_obj 才生效，防误清空盘
  let meta = {}; try { meta = JSON.parse(market.metadata || '{}'); } catch { return { ok: false, reason: 'metadata 坏 JSON' }; }
  if (!meta.refund_tx_obj) return { ok: false, reason: '无 refund_tx_obj，无需清理(幂等)', already: true };
  const before = { refund_tx_obj: meta.refund_tx_obj, refund_reason: meta.refund_reason, refund_dispatched_at: meta.refund_dispatched_at, refund_amount: meta.refund_amount };
  const { refund_tx_obj, refund_reason, refund_dispatched_at, refund_amount, ...rest } = meta;
  db.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run(JSON.stringify(rest), marketId);
  db.prepare(`INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
              VALUES (lower(hex(randomblob(16))), 'settlement', 'legacy_refund_deadshape_cleared', 'clearLegacyRefundDeadShape', 'warn', ?, ?, datetime('now'))`)
    .run(`market=${marketId.slice(0,12)} 四字段清除`, JSON.stringify({ market_id: marketId, before }));
  return { ok: true, cleared: before };
}
```

**执行时机(命门，锁死顺序)**：只在 container② 确认完成(`cancelMarketLive` 返回 `complete: true`)**之后**才清——清理动作本身不影响 container①(spine 是独立 UTXO)，但为了跟 7pori 保持同款可审计时序(先完成再拆雷，不倒序)，本设计仍要求 container②完成优先。

## 3. 执行序(镜像 7pori，ramp 纪律不降)

对每一盘：
1. `computeRefundPlan(marketId, ctx)` dry-run，人眼核对 betCount/refundRoot/committee。
2. Bettor 批字样 → `cancelMarketLive(marketId, ctx)` 实执行(container②，bettor 侧退款)。
3. `verifyClosedLanded`/`verifyClaimLanded`(cancelMarketLive 内建)确认 `complete: true` 才继续。
4. `clearLegacyRefundDeadShape(marketId, db)` 清死形状四字段(§2)。
5. `reclaimBshardMakerBond(marketId, ctx)` dry-run → 批字样 → 实执行(container①，今晚已验证的原语原样复用)。

**分批 ramp(Bettor 钦定)**：先 1 盘(建议 `y3lqh` 或 `7g8bu`，bet 数最小=1，风险面最小)走完整 5 步全链路，NWT+Bettor 双人闸逐步核实，全绿后再批量剩余 9 盘——不放"一次性对 10 盘齐发"的批。

## 4. 待 NWT 红队的点

1. `clearLegacyRefundDeadShape` 的 tripwire guard 够不够(会不会误清一个"看似有 refund_tx_obj 但其实是别的合法用途"的盘)？
2. §3 步骤 4(清死形状)在步骤 3(container②完成)之后、步骤 5(container①)之前——这个顺序是否有更安全的替代(比如反过来先清后跑②)？
3. nnd1g(52 笔 bet)的 `cancelMarketLive` 內 `refundClaimData` 循环 52 次逐笔 claim，是否需要额外超时/中断恢复的关注点(7pori 只有 1 笔，未覆盖这个量级)？
