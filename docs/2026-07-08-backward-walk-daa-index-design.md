# backward-walk 一趟摊销缓存 — MAX_WALK 老盘卡死根治设计稿

> **Status**: CURRENT
> **作者**: J1tn 2026-07-08 · **红队审**: NWT(待) · **验收锚**: Martin 的 8 个卡盘（DR Congo/Cabo Verde/Paraguay-France/Brazil/Mexico）依次结算返还
> **上游依据**: Bettor #bmxpnr 立卡("#13")，COORD-LEDGER 线(21)未分类项，`kasia-relay/src/rpc-listener.mjs:getBlockAtDaa()` 现有实现注释里的 "Future opt: cache walks past finality depth"

---

## §0 一句话

**`getBlockAtDaa()` 对超出 ring buffer 窗口（~3.3h）的老 deadline 每次都要重新从 tip 逐块 backward walk（O(gap)，深度积压市场 gap 可达数百万 DAA，MAX_WALK=250000 步都盖不住），而且每次 settle-daemon tick 重试都重复付一次这个代价。加一张持久化的 SPC block DAA→hash 索引表，relay 现有的 block-added 订阅顺手写（零新增订阅），配一次性 backfill 把当前积压覆盖到，`getBlockAtDaa` 查表优先（O(log n)），查不到才退化到现有 forward ring / backward walk。**

## §1 现状（已读源码坐实，非猜测）

`kasia-relay/src/rpc-listener.mjs:getBlockAtDaa()`（L146-251）已有三层：
1. **Forward ring buffer**（L161-195）：`_recentBlocks` 内存数组，插入顺序 = block-added 到达顺序，容量 120000（≈3.3h @ ~10BPS）。若 deadline 落在窗口内，找 ring 里刚好低于 deadline 的锚点块，向前 `getBlocks` 批量翻页找到跨越 deadline 的 SPC 块——69-93x 快于逐块 walk（注释里 J1/J2 实测数据）。
2. **Backward SPC walk**（L196-250）：ring buffer 没有锚点时的 fallback。从 `info.sink`（tip）逐块 `getBlock` 沿 `selectedParentHash` 往回走，直到 daa < deadlineDaa。每步一次 RPC（~5ms）。MAX_WALK=250000 步是安全窗上限（J2 2026-07-05 世界杯首场 7rztt 卡死案例调大过一次，从 120000 到 250000）。
3. 两层都够不到 → throw，settle-daemon 的 `buildCtx`/`judgeWinDir` 路径 catch 住，L628 附近有超龄 guard 转终局退款（非资损，只是卡住不前进）。

**问题**：①`_recentBlocks` 是**纯内存环形缓冲**，relay 重启即清零，且容量硬顶 120000——对于 deadline 落在 3.3h 窗口之外的市场（今晚 129 个 verifying 积压里的大多数，最老的 DR Congo 07-01 距今已 7 天+，gap 以百万 DAA 计），永远落到第②层。②第②层的 O(gap) 代价对这类老盘**结构性地不可行**——不是"调大 MAX_WALK 就能解决"（DR Congo 的 gap 远超任何合理 MAX_WALK 值），而是每次 settle-daemon tick（30s 一次）对同一个卡住的老盘**重复付一次沉没代价的失败尝试**，纯粹浪费，且 daemon 忙于这些注定失败的 walk 时挤占了处理其他 ripe market 的吞吐（`selectRipeMarkets` L266 附近的优先级排序注释也提到过这层张力）。

## §2 方案：持久化 SPC DAA 索引 + 一次性 backfill

### §2.1 新表（migrate v182）

```sql
CREATE TABLE spc_daa_index (
  daa_score INTEGER PRIMARY KEY,
  block_hash TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL
);
```

只存 **SPC（selected parent chain）块**——即 `verboseData.isChainBlock === true` 的块，跟 `getBlockAtDaa` 现有两层逻辑筛选的是同一类块（`_recentBlocks` 目前不区分 SPC，但 forward-walk 那段用 `blk.verboseData.isChainBlock` 过滤；backward walk 沿 `selectedParentHash` 走，天然只碰 SPC 块）。`daa_score` 严格递增（J2 r800 已验证的不变量，`getBlockAtDaa` 注释里引用过），做主键天然有序，`WHERE daa_score >= ? ORDER BY daa_score ASC LIMIT 1` 就是 O(log n) 索引查找。

### §2.2 写入方：relay 现有订阅顺手扩展（零新增订阅面）

`rpc-listener.mjs` 已经有 `_trackBlockForChainReader(block)`（L252 起，为 `_recentBlocks` 写入服务）挂在 block-added 事件上——**同一个回调里追加一行 INSERT**（SPC 块才写，非 SPC 跳过），通过 `/ingest/...` 走到 console 侧持久化（同 `kaspa_tx_log` 的既有 relay→console 上报模式，不新开一条管道）。这一步成本几乎为零：block-added 事件本来就在触发，只是多存一行。

### §2.3 一次性 backfill（"一趟摊销"的核心）

新写一个 backfill 脚本（一次性运维动作，非常驻服务）：从当前 129 个 verifying 积压市场里最老的 deadline_daa（DR Congo 07-01 附近，具体值查 `pool_markets` 表）到当前 tip，走**一遍**现有的 backward SPC walk（复用 `getBlockAtDaa` 的第②层逻辑，不重新发明 walk 算法——只是把沿途经过的每个 SPC 块顺手写进 `spc_daa_index`，而不是只留最后一个 `lastEligible`）。这一遍是唯一要付的 O(gap) 代价，付完之后表里就有了覆盖这段范围的完整索引，**后续任何 deadline 落在这个范围内的查询都变成 O(log n) 表查询**，不再重复 walk。

### §2.4 `getBlockAtDaa` 加第 0 层：索引查表

```js
// 新增最快层，插在现有 forward ring buffer 之前
const indexed = await queryConsole('spc_daa_index_lookup', { minDaa: deadlineDaa }); // SELECT ... WHERE daa_score >= ? ORDER BY daa_score ASC LIMIT 1
if (indexed) return indexed;
// 现有 forward ring buffer 逻辑不变...
// 现有 backward walk fallback 不变（覆盖 backfill 范围之外的、比 backfill 起点更老的边缘情况）...
```

**零改动现有两层的行为**——只是在前面插一层更快的路径，查不到才照旧退化，这是纯粹的加速优化，不改变任何正确性语义（返回值 shape 完全一致，仍是 `{hash, daaScore, timestamp_ms, isChainBlock}`）。

## §2.5 索引空洞防线（NWT 红队 05:31 抓出，BLOCKING 补丁——跟今晚 target_daa 错位同族"用错块判定"风险，不能留白到以后）

relay 重启/短暂下线（今晚就发生过好几次）会在 block-added 订阅停摆期间产生索引空洞。若空洞恰好卡在某市场 deadline 附近，§2.4 的查询可能返回一个"凑巧 daa_score >= deadline 但不是真正最靠近 deadline 的那个块"的错误结果——直接喂给 judge/settle，是 correctness-critical 路径，不能假设索引连续无洞就上。

**最小防线**：新增一张覆盖区间表，只信"确认连续覆盖"的范围内的索引结果：

```sql
CREATE TABLE spc_daa_index_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_daa INTEGER NOT NULL,
  end_daa INTEGER NOT NULL   -- 水位线：本区间内 [start_daa, end_daa] 每个 SPC 块都已写入 spc_daa_index，无空洞
);
```

- **backfill** 写入时插入一条覆盖区间 `[oldest_backlog_daa, tip_at_backfill_time]`（这段是一次 walk 连续产出的，天然无洞）。
- **live 写入**（relay block-added 回调）：每次写入新块前，检查新块 daa 是否紧接当前最新覆盖区间的 `end_daa`（即新块 daa 与 end_daa 之间没有被跳过的 SPC 块——用现有 `_recentBlocks` 同款相邻性判断，或简单检查 `new_daa - end_daa` 是否等于两块间正常 DAA 步进量级）。是则 `UPDATE ... SET end_daa = new_daa` 延伸区间；不是（relay 刚重启、中间有空档）则开一条新的覆盖区间 `[new_daa, new_daa]`，旧区间保持原样不动（诚实标注"这段之后到重启前有洞，不再延伸"）。
- **查询时**（§2.4 那层）：先查 `deadlineDaa` 是否落在某条 `spc_daa_index_coverage` 区间的 `[start_daa, end_daa]` 内——**在**则信任 `spc_daa_index` 的查表结果直接返回；**不在**（落在洞里，或超出所有已知区间）则不查表，直接走现有 forward ring / backward walk 逻辑（不额外验证成本，就是原来的路径，等于查表命中失败时的自然 fallback，零新增复杂度）。

这样"索引有洞"不会导致返回错误结果——要么落在确认无洞的区间内直接可信，要么老老实实退化回今天已经在跑的正确路径，两条路径不存在中间态的"半信半疑"。

## §3 范围边界（防止过度设计）

- **不改** `selectRipeMarkets` 的优先级排序逻辑（那是独立的、已有既定设计的模块，不在这次范围）。
- **不改** MAX_WALK 数值本身、不改 backward walk 算法本身——只是给它加一层缓存前置，backward walk 代码逐字节不动。
- **不处理** "为什么这些老盘一开始没能及时结算"这个更早的历史成因——那是过去的事，这次只解决"现在卡住了、每次重试都白付一次代价"这个当下问题。
- backfill 脚本是**一次性运维工具**，跑完这次积压就完成任务，不是常驻服务；未来新市场的 deadline 会随 relay 正常运行、block-added 订阅持续写入索引 + 覆盖区间机制（§2.5）自动处理重启造成的空洞，不需要重复 backfill。
- **NWT 05:31 结构性发现（另案，不并入本次落码）**：`blockhash_parity` judge 直接用 `resolution_rule_spec.target_daa` 判定，若 `target_daa` 系统性早于市场实际 `deadline_daa`，存在"下注窗口关闭前结果可推算"的信息不对称（今晚 5R create 两次因此被废弃重建）。这条是 judge 逻辑本身的参数正确性问题，跟本设计稿"索引查表加速"是两个不同层面的修复（一个管"查得对不对"，一个管"查得快不快"），记同一批清单但落码时分开改，避免一次改动混两条独立风险面。

## §4 验收锚

- 直接验收：跑完 backfill 后，`bshard-settle-daemon` 对 Martin 的 8 个卡盘（DR Congo/Cabo Verde/Paraguay-France/Brazil/Mexico）重新 tick，**不再撞 MAX_WALK throw**，而是正常拿到 endBlock 走到 judge/settle 逻辑（win/refund 由市场自身规则决定，不是这次改动关心的范围——这次只保证"能往前走"，不保证"往哪个方向走"）。
- 性能验收：backfill 跑一次的总耗时（预计与现有单次 backward walk 覆盖同等 gap 的耗时量级相同，一次性成本，不是新增负担）+ 之后同一批老盘的 daemon tick 耗时应从"每次 20+ 分钟 walk 后失败"降到"毫秒级查表成功"。

## §5 签字区

- J1tn（设计）：✅ 2026-07-08
- NWT（红队审）：✅ 2026-07-11 08:52Z GREEN（频道记录：§2.5 防洞是核心看点已堵死；无索引节点自然退化不出错）
- Bettor（GO）：✅ 2026-07-11 08:53Z #g4mz41（今晚范围收紧：backfill 只覆盖 28mln 区间 [57211579-ε, tip]，断点续跑必做；129 老积压盘 deadline 在剪裁点下走 L628 超龄退款另案）
- 排期：2026-07-11 立即落码（28mln 放行结算被 MAX_WALK 卡住触发；J1 离线，J2 落码/KANet-UI 代管域 reviewer+operator/NWT 审 diff）
