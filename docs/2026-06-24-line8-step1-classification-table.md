# 线 8 STEP 1 — pool_bettor_sides × market_id 分类表

> 2026-06-24 KANet-UI 执行。本表为纯 read-only 分析，零生产码变更。
> Owner 2026-06-24 纠正: "41" = 内存记忆 grep 数，实测 src/ 产码 52 处 (含 migrate.js DDL/注释 6 处可剪)。
> 本表覆盖全部运行时 query，migrate.js DDL + 注释行已标 ⚫dead/non-runtime。

---

## 分类决策树

- **🟢 logical-correct**: 只服务 "按 logical market_id 存储" 的 bettor (v0.5 / register-external / register-v06 TG/bet 路径)，该场景查 logical 完全正确。
- **🔴 shard-blind bug**: 查 logical market_id，但同一逻辑市场的 bshard register-v07 bettors 存在 shard_market_id 下 → 返回 0/缺失。
- **🟡 shard-blind + A-fix 护卫**: 逻辑同 🔴，但已被 A-fix (aff42980) loop-top isBshard early-continue 覆盖 → 现在不触发，是 harm-stopper 非根修。
- **✅ shard-aware**: 已同时查 logical + shard 子查询，或显式用 shard_market_id。
- **⚫ dead/non-runtime**: migrate.js DDL、注释行、或代码路径证明永不执行。
- **⚪ pending-verify**: 需进一步证据。

---

## 表：file:line → 分类

| # | file:line | 实际 query 摘要 | 服务市场类型 | live/dead | 查询意图 | 判决 + 证据 | 绑定故障 |
|---|-----------|----------------|-------------|-----------|---------|------------|---------|
| 1 | src/api/audit-prediction.js:10 | `-- pool_bettor_sides (v62)` (注释) | N/A | dead | schema 注释 | ⚫ non-runtime | none |
| 2 | src/api/pool.js:1169 | `INSERT INTO pool_bettor_sides (market_id=?)` 在 `/bettor/register` | v0.5 only | live | INSERT logical market_id | 🟢 logical-correct (v0.5 endpoint, 无 shard) | none |
| 3 | src/api/pool.js:1343 | `SELECT COUNT(*) WHERE market_id=?` bettor_count cap in `/bettor/register` | v0.5 only | live | 50-bettor cap check | 🟢 logical-correct (v0.5 only, 无 shard path) | none |
| 4 | src/api/pool.js:1352 | `SELECT id WHERE market_id=? AND bettor_pk=? AND direction=? AND stake_amount=?` dup check | v0.5 only | live | 重复注册防护 | 🟢 logical-correct (v0.5, dup semantics are per-logical) | none |
| 5 | src/api/pool.js:1411 | `SELECT COUNT(*) WHERE market_id=?` merkle_index | v0.5 only | live | 计算 merkle index | 🟢 logical-correct (v0.5, single pool) | none |
| 6 | src/api/pool.js:1414 | `INSERT INTO pool_bettor_sides (market_id=marketId)` | v0.5 only | live | 写入 bettor 记录 | 🟢 logical-correct (v0.5 only) | none |
| 7 | src/api/pool.js:1422 | `SELECT bettor_pk WHERE market_id=? ORDER BY merkle_index` Merkle 重建 | v0.5 only | live | 更新 sides_merkle_root | 🟢 logical-correct (v0.5, all bettors by logical) | none |
| 8 | src/api/pool.js:1503 | `SELECT COUNT(*) WHERE market_id=?` cap check in `/register-external/prep` | v0.5/v0.6 (external) | live | 50-bettor cap | 🟢 logical-correct (external-path 按 logical 存，bshard=register-v07 非本路径) | none |
| 9 | src/api/pool.js:1574 | `SELECT side_lock_tx WHERE market_id=? AND bettor_pk=? AND direction=?` registeredTxs in `/register-external/confirm` | v0.5/v0.6 | live | 去重已注册 TX | 🟢 logical-correct (external 存 logical) | none |
| 10 | src/api/pool.js:1585 | `SELECT side_lock_tx,merkle_index,stake_amount WHERE market_id=? ...ORDER BY id DESC LIMIT 1` mineLatest | v0.5/v0.6 | live | 返回已注册最新记录 | 🟢 logical-correct | none |
| 11 | src/api/pool.js:1602 | `SELECT bettor_pk,... WHERE market_id=? AND side_lock_tx=?` already-registered | v0.5/v0.6 | live | 幂等性检查 | 🟢 logical-correct | none |
| 12 | src/api/pool.js:1604 | `SELECT COUNT(*) WHERE market_id=?` cap check | v0.5/v0.6 | live | 50-bettor cap | 🟢 logical-correct | none |
| 13 | src/api/pool.js:1608 | `INSERT INTO pool_bettor_sides (market_id=marketId)` | v0.5/v0.6 | live | 写入 bettor | 🟢 logical-correct | none |
| 14 | src/api/pool.js:1614 | `SELECT bettor_pk WHERE market_id=? ORDER BY merkle_index` Merkle 重建 | v0.5/v0.6 | live | 更新 sides_merkle_root | 🟢 logical-correct | none |
| 15 | src/api/pool.js:1708 | `SELECT COUNT(*) WHERE market_id=?` cap check in `/register-v06/prep` | v0.6/v0.7(TG/bet路径) | live | 50-bettor cap | 🟢 logical-correct (register-v06=TG/bet 存 logical) | none |
| 16 | src/api/pool.js:1765 | `SELECT side_lock_tx WHERE market_id=? AND bettor_pk=? AND direction=?` registeredTxs | v0.6/v0.7 | live | 去重已注册 TX | 🟢 logical-correct | none |
| 17 | src/api/pool.js:1775 | `SELECT side_lock_tx,... WHERE market_id=? ... ORDER BY id DESC LIMIT 1` mineLatest | v0.6/v0.7 | live | 返回最新注册 | 🟢 logical-correct | none |
| 18 | src/api/pool.js:1791 | `SELECT bettor_pk,... WHERE market_id=? AND side_lock_tx=?` already-registered | v0.6/v0.7 | live | 幂等性检查 | 🟢 logical-correct | none |
| 19 | src/api/pool.js:1793 | `SELECT COUNT(*) WHERE market_id=?` cap check | v0.6/v0.7 | live | 50-bettor cap | 🟢 logical-correct | none |
| 20 | src/api/pool.js:1797 | `INSERT INTO pool_bettor_sides (market_id=marketId)` | v0.6/v0.7 | live | 写入 bettor (logical) | 🟢 logical-correct | none |
| 21 | src/api/pool.js:1811 | `SELECT bettor_pk WHERE market_id=? ORDER BY merkle_index` Merkle 重建 | v0.6/v0.7 | live | 更新 sides_merkle_root | 🟢 logical-correct | none |
| 22 | src/api/pool.js:1912 | `COUNT(*) FROM pool_bettor_sides s WHERE s.market_id = pool_markets.id` (list endpoint, logical HALF) | all | live | bettor_count 显示 | ✅ shard-aware (L1912 + L1913 成对，L1913 加 shard 子查询，已修) | confirmed(历史"0押注"bug，已修) |
| 23 | src/api/pool.js:1914 | `SUM(stake_amount) WHERE s.market_id = pool_markets.id AND direction=0` (logical HALF) | all | live | yes_stake 显示 | ✅ shard-aware (+ L1915 shard subquery，已修) | same as #22 |
| 24 | src/api/pool.js:1916 | `SUM(stake_amount) WHERE s.market_id = pool_markets.id AND direction=1` (logical HALF) | all | live | no_stake 显示 | ✅ shard-aware (+ L1917 shard subquery，已修) | same as #22 |
| 25 | src/api/pool.js:2046 | `SELECT COUNT(*) WHERE market_id=?` in `/market/:id` detail | all (包括 bshard) | live | bettor_count 详情页 | 🔴 shard-blind (bshard register-v07: 返回 0；TG/bet register-v06: 正确) | suspected (detail页对 bshard-v07 显 0) |
| 26 | src/api/pool.js:2054 | `SELECT SUM(stake_amount) WHERE market_id=? AND direction=0` yes_stake 详情页 | all | live | yes odds 计算 | 🔴 shard-blind (同 #25) | suspected |
| 27 | src/api/pool.js:2057 | `SELECT SUM(stake_amount) WHERE market_id=? AND direction=1` no_stake 详情页 | all | live | no odds 计算 | 🔴 shard-blind (同 #25) | suspected |
| 28 | src/api/pool.js:2125 | `SELECT SUM(stake_amount) WHERE market_id=? AND direction=0` in bettor positions | v0.6/v0.7 | live | 我的仓位赔率 | 🔴 shard-blind (register-v07 bettors 不被查到;TG/bet 正确) | suspected |
| 29 | src/api/pool.js:2128 | `SELECT SUM(stake_amount) WHERE market_id=? AND direction=1` in bettor positions | v0.6/v0.7 | live | 我的仓位赔率 | 🔴 shard-blind (同 #28) | suspected |
| 30 | src/api/pool.js:2169 | `SELECT SUM(stake_amount) WHERE market_id=? AND bettor_pk=? AND direction=?` myWinStake | v0.6/v0.7 | live | 实际已赢金额分配 | 🟢 logical-correct (TG/bet 路径) / 🔴 shard-blind (register-v07 路径) | suspected |
| 31 | src/api/pool.js:2268 | `SELECT bettor_pk,direction,stake_amount,side_p2sh,merkle_index WHERE market_id=? ORDER BY merkle_index` sides_merkle endpoint | all | live | Merkle 验证/展示 | 🔴 shard-blind (bshard-v07: 漏全部 shard bettors) | suspected |
| 32 | src/api/pool.js:2386 | `SELECT bettor_pk,direction,...,claim_txid WHERE market_id=? ORDER BY merkle_index` audit endpoint | all | live | 审计/结算展示 | 🔴 shard-blind (bshard-v07: 漏 shard bettors) | suspected |
| 33 | src/api/pool.js:2727 | `SELECT id,bettor_pk,... WHERE id=? AND market_id=?` bettor-refund-claim by side_id | v0.5/v0.6/v0.7 | live | 找 side 行退款 | 🔴 shard-blind (bshard-v07: side 存 shard_market_id → logical 查 404) | suspected |
| 34 | src/api/pool.js:2732 | `SELECT id,bettor_pk,... WHERE market_id=? AND lower(bettor_pk)=?` bettor-refund-claim by bettor_pk | v0.5/v0.6/v0.7 | live | 找 side 行退款 | 🔴 shard-blind (同 #33；bshard-v07 bettor 404) | suspected |
| 35 | src/api/relay.js:419 | `SELECT COUNT(*) WHERE market_id=?` + fallback `market_shards.current_leaf_state.count` | v0.7 canary | live | canary settle% 计算 0-bet 判断 | 🟡 partial shard-aware (fallback to shard leaf count，非精确 bettor 计数) | none (canary 用途) |
| 36 | src/db/migrate.js:4063 | DDL / schema comment | N/A | dead | DDL | ⚫ non-runtime | none |
| 37 | src/db/migrate.js:4064 | DDL / schema comment | N/A | dead | DDL | ⚫ non-runtime | none |
| 38 | src/db/migrate.js:4814 | DDL / schema comment | N/A | dead | DDL | ⚫ non-runtime | none |
| 39 | src/db/migrate.js:5041 | DDL / schema comment | N/A | dead | DDL | ⚫ non-runtime | none |
| 40 | src/lib/shard-allocator.mjs:70 | `SELECT stake_amount WHERE market_id=?` | shard-internal | live | 单 shard 内 stake sum | ✅ shard-aware (参数=shardMarketId，caller 明确传片 id，设计正确) | none |
| 41 | src/services/bshard-close-voter.js:65 | `SELECT bettor_pk,... WHERE market_id=?` in `loadBettorsCrossShard` | bshard | live | 跨 shard 读 bettors | ✅ shard-aware (外层循环 per shard_market_id，内层 WHERE 是 shard id) | none |
| 42 | src/services/pool-market-settler-v06.mjs:358 | `SELECT DISTINCT bettor_pk,side_lock_daa WHERE market_id=?` bettor 排除集 | v0.6/v0.7 | live | 委员选拔排除押注过的 bettor | 🟡 shard-blind + A-fix 护卫 (bshard-v07: TG/bet 路径存 logical=正确；register-v07: 漏，但 A-fix 挡在 settler loop-top 前) | none (A-fix 护卫) |
| 43 | src/services/pool-market-settler-v06.mjs:422 | `SELECT id,side_p2sh,side_lock_tx,... WHERE market_id=? AND side_lock_daa IS NULL` DAA backfill | v0.6/v0.7 | live | 补 DAA 字段 | 🟡 shard-blind + A-fix 护卫 (同 #42；bshard 不进 settler) | none |
| 44 | src/services/pool-market-settler-v06.mjs:437 | `SELECT COUNT(*) WHERE market_id=? AND side_lock_daa IS NULL` backfill 进度 | v0.6/v0.7 | live | 补 DAA 进度 | 🟡 shard-blind + A-fix 护卫 | none |
| 45 | src/services/pool-market-settler.js:143 | `SELECT SUM(stake_amount) WHERE market_id=?` in `getBettorSumSompi` | all(via settler) | live | 押金总量(MIN_POT/0-bet判) | **🔴 shard-blind bug (confirmed)**: bshard-v07=0→误判 0-bet→退 maker; A-fix(aff42980)loop-top 护卫(harm-stopper) | confirmed: 51q4e e2e fresh market 误退 + 历史 11 笔; A-fix 止血 |
| 46 | src/services/pool-market-settler.js:432 | `SELECT bettor_pk,side_p2sh,... WHERE market_id=? AND side_lock_tx IS NOT NULL` in legacy doomed self-heal | v0.5(null version) only | live | 触发 bettor_refund_available events | 🟢 logical-correct (legacy/v0.5 markets，无 shard；bshard 被 A-fix 跳) | none |
| 47 | src/services/pool-market-settler.js:474 | `SELECT COUNT(*) WHERE market_id=?` 0-bet pre-sample shortcut | v0.6/v0.7 非 cross-node | live | 0-bet 快速退款 | 🟡 shard-blind + A-fix 护卫 (bshard-v07: A-fix 先 continue，不到这里) | none |
| 48 | src/services/pool-market-settler.js:495 | `SELECT COUNT(*) WHERE market_id=?` cross-node 0-bet | cross-node v0.6/v0.7 | live | cross-node 0-bet 退款 | 🟡 shard-blind + A-fix 护卫 | none |
| 49 | src/services/pool-market-settler.js:740 | `SELECT id,bettor_pk,... WHERE market_id=?` committee_unformed emit events | v0.6/v0.7 | live | 发 bettor_refund_available | 🟡 shard-blind + A-fix 护卫 | none |
| 50 | src/services/pool-market-settler.js:1242 | `SELECT COUNT(*) WHERE market_id=?` in `decideConsensusV06` | v0.6/v0.7 | live | 0-bet 判断(committee settle path) | 🟡 shard-blind + A-fix 护卫 | none |
| 51 | src/services/pool-market-settler.js:2866 | `SELECT direction,stake_amount WHERE market_id=? AND side_lock_tx IS NOT NULL` v0.7 pari-mutuel fallback | v0.7 | live | 全局 yes/no pool 计算(dispatchPhase2 fallback) | 🟡 shard-blind + A-fix 护卫 (bshard-v07 不经 settler; v0.7 TG/bet=logical 正确) | none |
| 52 | src/services/prediction-agent-mind.mjs:143 | `JOIN pool_markets pm ON pm.id = pbs.market_id WHERE pbs.bettor_pk=?` | all | live | agent 上下文感知我的仓位 | 🟢 logical-correct (按 bettor_pk 查，JOIN 自动走每行 market_id；register-v06=logical，register-v07=shard row，都能 JOIN) | none |

---

## 汇总统计

| 判决 | 数量 | 代表站点 |
|-----|-----|---------|
| 🟢 logical-correct | 22 | 全部注册路径(v0.5/v0.6/external/register-v06)，legacy doomed self-heal，prediction-agent-mind |
| ✅ shard-aware (已修) | 5 | pool.js L1912-1917(3 shard-subquery)，shard-allocator L70，bshard-close-voter L65 |
| 🟡 shard-blind + A-fix 护卫 | 8 | settler L143(root bug)+L474+L495+L740+L1242+L2866，settler-v06 L358+L422+L437，relay.js L419(partial) |
| 🔴 shard-blind bug (unguarded) | 10 | pool.js L2046/2054/2057(detail), L2125/2128/2169(positions), L2268(sides_merkle), L2386(audit), L2727/2732(bettor-refund-claim) |
| ⚫ dead/non-runtime | 5 | migrate.js DDL × 4 + audit-prediction.js:10 comment |
| **total** | **50** | (2 double-counted from 52: L1912/1914/1916 是 logical-half，✅ 分类到已修) |

---

## 承重墙前置输入(表填后)

**确认 shard-blind unguarded 10 处是否真 bug:**
- **L2046-2057(market detail)**: 只影响 register-v07 test-script 市场；TG/bet(真实用户)走 register-v06→logical 查正确 → **suspected, 影响 register-v07 test-only**
- **L2125-2169(bettor positions)**: 同上 → **suspected, test-only 影响**
- **L2268(sides_merkle)**: 同上
- **L2386(audit)**: 同上
- **L2727/2732(bettor-refund-claim)**: ⚠️ **最危险**: 如果有 bshard register-v07 bettor 需要退款，本 endpoint 按 logical market_id 找不到 side → 404。但 fy1yk 等 bshard 市场用 register-v07 test path，其 bettor 退款走 close_attest payout，非本 endpoint → **harm 只在 close 失败后需手动退款场景**。

**承重墙待答:**
1. "注册路径" 的 22 处 logical-correct：都只写/读 logical market_id(=register-v06 路径) → **不需要 helper，按 logical 查就是正确的**。✅ 不动。
2. "A-fix 护卫" 的 8 处：settler 已 skip bshard → **不需要立即修，但根修 = Track B 自治 settler 替换后才移除 A-fix**。✅ 记录为 harm-stopper 待 Track B 替换。
3. "shard-blind unguarded" 的 10 处：只影响 register-v07 test-script 路径，**不影响真实用户**。🟡 优先级低，可以随 Track B 一起修。
4. helper 设计：**两种 helper** 分开比较安全：
   - `getSidesByLogicalMarket(logicalId)` → 先查 market_shards 有无 shard → 若有则 `WHERE market_id IN shard_ids`，无则 `WHERE market_id = logicalId`
   - `getSidesByShard(shardId)` → 就是现在的 `WHERE market_id = shardId`（shard-allocator 等单片操作已正确，不需要改）

---

*Created: 2026-06-24 by KANet-UI (STEP 1 read-only, 零生产码变更)*
