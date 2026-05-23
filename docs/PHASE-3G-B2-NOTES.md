# Phase 3g Sub 7 (B-2) — fund_lock 跨 sim/real 不锁 + inventory_aware_bankroll 双套独立

**Status**: Doc-only sub (Sub 6 B-1 已 cover B-2 全部实施).

## 架构决断 (Bettor r79 §3 + r82 §3)

**fund_lock 跨 sim/real 不锁**:
- `bettor_sim_positions` (sim sandbox) 跟 `bettor_real_positions` (real 真投) **完全分表**.
- 同一 `market_id` 双押 (sim + real) **OK** — sim 是 sandbox 演练, real 是真投, 用途独立.
- 自然 enforce: 表分开,SQL JOIN 不互查,fund_lock 互相不阻塞.

**inventory_aware_bankroll 双套独立**:
- sim bankroll: `bettor-scanner.js::getOpenInventory(relayNodeId)` 现有, query `bettor_sim_positions` total. `DEFAULT_BANKROLL = 1000` default.
- real bankroll: `bettor_real_config.daily_cap_usd` / `weekly_cap_usd` / `max_real_size_per_market_usd` (Sub 6 B-1 v101 migration). Sophie wallet 实际 USDC.e 余额是上游 deployment-level constraint.

## 实施 (Sub 6 B-1 已含)

Sub 6 `decideRealPath` 内 `preBetGateCheck`:
```js
const marketUsed = db.prepare(`
  SELECT COALESCE(SUM(size_usd), 0) AS u
  FROM bettor_real_positions
  WHERE market_id = ? AND status IN ('filled', 'pending')
`).get(adj.market_id || '');
if ((marketUsed?.u || 0) + size > cfg.max_real_size_per_market_usd) {
  return { ok: false, reason: 'per-market cap' };
}
```

- 只 query `bettor_real_positions` (real 表), 不 JOIN sim 表 → fund_lock 跨 sim/real 不锁 enforce
- per-market cap 防 real 单 market 过曝
- sim path 走 `bettor-scanner.js::getOpenInventory` (不变)

## 决断 source

- Bettor r79 §3(b) 字面: "sim = sandbox 演练 / real = 真投, 用途不同, 不应 fund_lock 互相阻塞"
- Bettor r82 §3 字面: "Sub 6 L122 marketUsed JOIN bettor_real_positions WHERE market_id 已 cover fund_lock 跨 sim/real 不锁 enforce. r79 §3(b) decision 实施完整. B-2 实施: doc 加注释说明 fund_lock 分表设计 + 不需新 SQL. 1 LOC doc only."
- J1 #159 §4 propose: "sub 7 是否可降级为 1 LOC doc only (sub 6 已 cover B-2 全部)?"
- Bettor r82 §3 verdict: **服 降级 doc only**.

## Phase 4 sediment (Sub 7 不涵盖)

未来 KANet broker integration 时:
- `bettor_real_positions` schema 可能 evolve (TX hash, signature ledger, settlement chain)
- 不影响 sim 路径
- broker 整合时 cross-host fund_lock 协议设计 (E-1 quorum + Phase 4 broker 整合后续)

## verify

- ✅ 分表实施: v101 migration (Sub 6 B-1) `bettor_real_positions` 跟 `bettor_sim_positions` 完全分
- ✅ per-market cap: `decideRealPath` query 不 JOIN sim 表 = fund_lock 不锁
- ✅ inventory 双套独立: sim getOpenInventory + real bettor_real_config 缓存独立
- ✅ Architect 决断 cross-verify chain (r79 + r82) 全 align
