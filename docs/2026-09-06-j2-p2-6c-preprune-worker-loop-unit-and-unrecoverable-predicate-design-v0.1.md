# P2-6c · `preprune-capture-worker` 循环单位改逻辑盘 + "不可恢复"判据换剪枝点两条件 + `pruned_expired_waived` 入终态 · 设计 v0.1.2（不写码）

> **v0.1.2（2026-09-06T23:0xZ · NWT 红队 22:5xZ：α GREEN · γ GREEN · β GREEN-conditional 四条件）采纳项**：
> (1) **M = merge_depth_bound = 36,000 不是缓冲，是让 (b) 成立的结构最小值**：rusty-kaspa 剪的是 past(P)（扣保留集），不按 daa 排序；daa < P 的块若在 anticone(P) 会留下，但 merge depth 规则保证 anticone(P) 的块 daa ≥ P − 36,000 ⇒ `daa < P − 36,000 ⇒ 必在 past(P)`。12 h 不需要。另加：剪枝**遍历**有顺序但不保证即时（IBD 期 0 推进、READY 后几分钟跑完），所以"锚点已剪、tx 块暂时还在"在遍历中途可能出现——但那块已在 past(P)、我们没有它的 hash、几分钟内必被剪 ⇒ 标它不是误标；08-06 的"剪枝点之下 204,305 DAA 仍能取到"是遍历被饿死的产物，非稳态。
> (2) **α-1 D_anchor 改 10,000**（每步最小降幅 1 ⇒ 10,000 步只保证 10,000 DAA；20,000 在低并行段可能走满不中又 300 s）。α-2 R_max 真界 = (k+1)=125/步 × 10,000 = 1.25M，取 2.48M 更保守可留。
> (3) **替代上界成立（NWT 只读实测）**：`U = daa_at(created_at) + 36,000` 对全部 2,863 条有 `side_lock_daa` 的行 `side_lock_daa ≤ U` 2,863/2,863（93% 余量 ≥100k）；tx 晚于 `created_at` 的 83 条最大 3 s，1 h 余量比最坏 lead 大 1,200×。落码时该核查进 test。
> (4) **fy1yk 可界**（我 §3.1b/§7 过度悲观）：索引最早点 2026-07-10T02:51Z，"取 timestamp ≥ created_at 的第一个索引点"对 06-21 的行返回 07-10 那点——仍是 tx daa 的合法（松）上界 ⇒ U = daa@07-10 + 36k ≪ P − M ⇒ 可标；fail-closed 只在索引里没有任何 timestamp ≥ created_at 的点（行比最新索引还新）时触发。
> (5) **(a) 的代理块条件写死**：`anchor-pruned` 只在 `anchor.daa ≥ U`（不早于 tx）∧ `anchor.daa < P − M` ∧ 错误恰为 `cannot find header`（非 rpc/超时）时算真实失败。
> (6) **β 先 dry-run 一窗**：log-only 打 `would-mark market=… U= P= M= reason= upperBoundSource=` 行，计数 ≈72（≤73）核对后再开写。
> (7) events 消费者今核：`side_lock_daa_unrecoverable` 只有 worker 自己读（seed/常量），**今天没有任何结算读者**（worker 注释"供 K-17 替代结算识别"是意图非现状）⇒ 误标今天无自动钱路后果；Owner 批仍必要（K-17 读者上线即成其输入）。`pruned_expired_waived` 读者 = 两处监控 ⇒ γ 安全。
> (8) **验收拆两组**：可标/已标组 `Σ ≤ 30 s / 15 min、max ≤ 5 s`；表 1 "≥剪枝点不标"的 7 个盘（U ≈ tip，tip 回溯可达 10,000 步）单列 `max ≤ 60 s` 并要求 `anchorSource=index` 命中率；`Σ ≤ 30 s` 整体保留为守恒量。
> 落地序：α → 一窗 → β dry-run 一窗 → β 真写（Owner 批）→ γ。

> **Status**: DRAFT-FOR-REVIEW · J2 · 2026-09-06T22:3xZ（`date -u`）· Bettor 派工 ledger 957（P2-6 A 包验收关闭后的下一层）· 交 **NWT 红队** → Bettor → 🔴 **落地须 Owner 批**（bettor side 的终态转换 = 结算路径，钱路状态机）· **本稿零代码零表零开关**。
> 建在：J1 `docs/2026-08-06-preprune-recapture-permanent-failure-load-rootcause-design.md` v0.7（§2.1 满占空比重试循环、§2.3 闸用错量、§4.2① 剪枝点 + 两条件 fail-closed、§4.2 单位判据、§6 验收）+ 本人 `docs/2026-09-06-j2-p2-6-…-design-v0.1.md`（6a/6b 已落 `e5578a23`）。**不重做那两稿；本稿只补它们各自留下的"未写"格**：08-06 稿 §7 影响面（J2 出数）与 §8.1（`deadline_daa` 分布）、6c 的形。
> 基线（修前，W2 = 2026-09-06T21:59:20→22:14:20Z，15.0 min 门开窗，`scratch/_j2_p2_acceptance_window2_page_2026-09-06T21-56Z.md`）：worker 三 tick 墙钟 151,445 / 145,822 / 517,024 ms（同步段 0），`preprune.recapture` **169 次 Σ811.4 s，max 297.7 s（aukqt-s1）**，aukqt-s1 三次 Σ327.4 s、aukqt-s0 Σ121.1 s、2ua7d-s0 Σ69.8 s、ukqt-s10 Σ47.0 s；每 tick `scanned=177 recaptured=0`；**同一批分片每 tick 重走同样的失败回溯**。

## 0. 一句话
6a/6b 之后 worker 的同步成本已归零，剩下的 ~91% 占空比全是 `recaptureSideLockDaaForMarket` → `captureSideLockDaa` 的**异步 RPC 反向回溯**：177 个分片（93 个逻辑盘、3,568 个 NULL side 行）每 tick 各走一遍、每遍 `recaptured=0`。根因两条：(1) **叶子里已经有"锚点 < 剪枝点 ⇒ 结构性不可达"的判断**（`trade-protocol-filter.js:1290–1305`，进程内 `_captureUnreachableAnchors/_captureUnreachableTx`），但它只在**有 `spc_daa_index` 锚点且第一步 `cannot find header`** 时触发；aukqt 这批**没有锚点**（coverage 单点区间命不中，08-06 §8.2）⇒ 从 tip 反走 `MAX_STEPS=10,000` 个 `getBlock`（≈297 s）后以 `no-block-hash` 放弃，而 **`deadline_daa < 剪枝点` 这个一眼判死的谓词从没被评估**；(2) 调用方 `recaptureSideLockDaaForMarket` 把叶子的 `reason` **整个丢掉**（08-06 §4.2③），worker 的标记闸又用 `_coverageFloor()`（floor = 56,983,539，177 个里 **0 个** `deadline_daa < floor`，08-06 §2.3 实证）⇒ 永远标不上。
修法三件同批：**①** 判据换成 08-06 §4.2① 的两条件（`deadline_daa`（或其替代上界）< 剪枝点 daa ∧ 一次真实取块失败），并把叶子的 `reason` 传回 worker；**②** `pruned_expired_waived` 入 `TERMINAL_STATUSES`；**③** 循环单位改逻辑盘 + SQL 预滤。另加一条**纯成本**短路（不改状态）：走不到的 tip 回溯不走。

## 1. 现场（2026-09-06T22:2xZ 活库 readonly · Pin §8）
"scanned 类" = `side_lock_daa IS NULL` 的分片，其逻辑盘非终态且未标不可恢复 = **177 分片 / 93 逻辑盘 / 3,568 side 行**（= 每 tick `scanned=177`）。按状态 × `deadline_daa` 分类（剪枝点 daa **78,217,530**@20:10Z，floor 56,983,539）：
| 状态 | `deadline_daa` 类 | 分片 | 逻辑盘 | side 行 | 本稿处置 |
|---|---|---|---|---|---|
| verifying | ∈ [floor, 剪枝点) | **118** | 72 | 2,139 | ① 两条件：可标不可恢复（= 08-06 "≤122 上界"那批）|
| verifying | **NULL** | 32 | **1**（`…fy1yk`）| **1,004** | ① 用替代上界（§3.1b）；08-06 §4.2 "真缺口" |
| pruned_expired_waived | NULL | 15 | 9 | 282 | ② 入终态即出集合 |
| pruned_expired_waived | ∈ [floor, 剪枝点) | 4 | 4 | 71 | ② |
| refunding | ≥ 剪枝点（840,742,023 坏值）| 2 | 1（`…nnd1g`）| 52 | **不标**（08-06 第三支：坏数据，单独报警）|
| verifying | ≥ 剪枝点 | 5 | 5 | 19 | **不标**（未剪，暂态；继续重试但走 §3.4 成本短路）|
| pending_bettors | ≥ 剪枝点 | 1 | 1 | 1 | 不标 |
- 对照 08-06 §2.3：`deadline_daa < floor` = **0** ✓（floor 闸永不触发的实证复现）；`≥ 链高/坏值` 8 → 今天 8（5+2+1）✓；NULL 47 → 今天 47（32+15）✓；`[floor, 剪枝点)` 122 ✓。**两个月分布没变**——因为没有任何一条能被标掉，也没有任何一条能恢复。
- 全部 33,149 个 NULL side 行 `side_lock_tx` 都非空（never_locked = 0）⇒ 都是"锁了、但 daa 没抓到"，不是脏行。
- 已标不可恢复 341 个逻辑盘（全部 07-17，`_hasBeenMarkedUnrecoverable` 6b 后 O(1) 跳过）。

## 2. 机制（读码 · 坐标）
- `preprune-capture-worker.mjs _tickBody`：`SELECT DISTINCT market_id … side_lock_daa IS NULL`（:222，1,575 分片，429 ms）→ 逐**分片** resolve 逻辑盘 → 终态跳 → 已标跳（6b）→ `recaptureSideLockDaaForMarket(shardId)` → `_markUnrecoverableIfBeyondFloor(logicalMarket, rc.remaining)`（每逻辑盘只调一次，判 `deadline_daa < floor` 才标）。
- `pool-market-settler-v06.mjs:420 recaptureSideLockDaaForMarket`：取该分片全部 NULL side（fy1yk-s* 每片 ~31 行、aukqt-s* ~32 行）→ 逐 side `captureSideLockDaa({…, approxDaaHint: deadline_daa})` → `catch { cap = {daa:null} }` / 忽略 `cap.reason` → 返回 `{recaptured, remaining}`。**reason 在这里丢失。**
- `trade-protocol-filter.js:1216 captureSideLockDaa`：进程内缓存 `_captureUnreachableTx`（按 side_lock_tx）/ `_captureUnreachableAnchors`（按锚点 hash）→ ③ 门（叶子）→ `kaspa_tx_log` 有 block_hash 则从它起，否则 `_indexAnchor(approxDaaHint)`（`spc_daa_index` ≥ hint 的最近块 **且** `spc_daa_index_coverage` 区间命中；08-06 §8.2：coverage 多为单点区间，几乎命不中）→ 都没有 ⇒ **从 tip 起** `_scanBackwardForTx` 最多 `MAX_STEPS=10,000` 个 `getBlock`（每步 ~30 ms ⇒ ~300 s = W2 的 297.7 s）。只有"有锚点 ∧ 第一步 cannot find header ∧ anchor.daa < pruningDaa"才标 `anchor-pruned`（进程内、重启即忘）。剪枝点 daa 读法已在（`pruningDaa()`：`getBlockDagInfo().pruningPointHash → getBlock → header.daaScore`，60 s 缓存）。
- 🔴 **判据错位**：`deadline_daa` 是 tx daa 的**天然上界**（bet 必在 deadline 前，代码注释自述），`deadline_daa < pruningDaa` ⇒ tx 所在块必已剪 ⇒ 任何回溯都到不了；而 tip 回溯只覆盖 `[tip − 10,000, tip]`（≈17 min 的链），对一个 20 天前的 tx 结构性无望。两件事都在叶子手边（hint、pruningDaa），却谁也没比一下。

## 3. 修法
### 3.1 ①"不可恢复"判据 = 08-06 §4.2① 两条件（状态改变 · 钱路 · Owner 批）
**谓词（机械可核）**：对逻辑盘 L，标 `side_lock_daa_unrecoverable` 当且仅当
- (b) **`U_L < P − M`**，其中 `U_L` = L 的 tx-daa 上界，`P` = 节点自报剪枝点 daa（`pruningDaa()`，同一 RPC，60 s 缓存），**`M = merge_depth_bound = 36,000`（v0.1.2 (1)：不是缓冲，是结构最小值——merge depth 规则保证 anticone(P) 的块 daa ≥ P − 36,000，故 `daa < P − 36,000 ⇒ 必在 past(P)` = 必被剪；不取 12 h）**；
- (a) **本 tick 对 L 的某个 NULL side 做了一次真实取块尝试且失败**，失败 `reason ∈ {anchor-pruned, no-block-hash(走完 MAX_STEPS), daa-unresolved}`，**不含** `node-not-synced` / `no-rpc` / `rpc-fail` / `anchor-not-found-transient` / `walk-futile`（那是我们这边坏或方法到不了，不是链上剪了）。**`anchor-pruned` 的代理块条件写死（v0.1.2 (5)）：`anchor.daa ≥ U_L`（锚点不早于 tx）∧ `anchor.daa < P − M` ∧ 错误恰为 `cannot find header`（非 rpc/超时）**。
- `U_L` 的取法（**替代上界**，解决 08-06 "NULL deadline 真缺口"）：
  1. `pool_markets.deadline_daa` 非 NULL 且 `< 链高`（排除 840,742,023 这类坏值：`deadline_daa > tip_daa` ⇒ 坏数据，**不标**、单独 warn 一行、计数进 events `deadline_daa_implausible`）；
  2. 否则 `U_L` = `daa_at(min(side.created_at))`：该盘最早 NULL side 行的 `created_at` 经 `spc_daa_index`（时间→daa，取 **timestamp ≥ 该时刻的第一个索引点**——它是 tx daa 的合法上界，哪怕很松）换算，再 **+ 36,000** 余量（side 行在 ingest 时插入，tx 最迟在其前后几秒确认；NWT 实测 2,863/2,863 行 `side_lock_daa ≤ U`，tx 晚于 created_at 最大 3 s）；**fail-closed 只在索引里没有任何 timestamp ≥ created_at 的点（行比最新索引还新）时触发 ⇒ 不标**。fy1yk（32 片 / 1,004 行，deadline NULL，created 2026-06-21）：索引最早点 2026-07-10T02:51Z ⇒ U = daa@07-10 + 36k ≪ P − M ⇒ **可界可标**（v0.1.2 (4)，我首稿"6 月无索引 ⇒ 不标"过度悲观，撤回）。
- **标记动作不变**：写 `events(side_lock_daa_unrecoverable, payload{marketId, deadlineDaa|createdAtDaa, pruningDaa, margin, stillNullCount, reason})` + `Set.add`（6b）。payload 多带 `pruningDaa/margin/reason/upperBoundSource` 四字段（审计可复算）。
- **叶子改动（观测→信息）**：`recaptureSideLockDaaForMarket` 返回值加 `reasons: {<reason>: count}`（不再丢 `cap.reason`）；worker 据此判 (a)。这是 08-06 §4.2③ 那条"最贵的推断本可省掉"。
- 🔴 **误标 = 什么后果、什么不会发生**（Bettor ②）：标记**只**让 worker 不再重试 recapture；它**不**改 `protocol_status`、不动任何 UTXO、不触发 refund。NULL daa 的 side 会让 `sampleAndStoreCommittee` fail-loud ⇒ 盘停在 verifying（现状：这 93 个盘已经停了两个月）⇒ 要么走 quorum-timeout 路，要么人工处置。⇒ **误标的真实代价** = "本可恢复的 side 被放弃重试 ⇒ 该盘继续卡住"，与不标的现状**同一状态**，只是少了一个每 tick 重试的机会。反例分析（同 memory `project-owner-settle-not-refund-orphan-permanent-loss-precedent` 的纪律：任何"永久"都要说清）：
  | 反例 | 两条件下会不会误标 | 为什么 |
  |---|---|---|
  | tx 在 [P − M, P) 仍可取（"剪枝点之下仍有一段能取到"）| **不会**：(b) 要求 `U_L < P − M` | M 就是为这个留的 |
  | `deadline_daa` 坏值（840,742,023）| 不会：`> tip` 判坏数据不标 | 08-06 第三支 |
  | deadline 正常但 tx 其实在 deadline **之后**（违反"bet 必在 deadline 前"）| 若 tx 未剪：(a) 会成功抓到 daa ⇒ 不标；若 tx 已剪：本就不可恢复 | (a) 是真实取块结果，不是推断 |
  | 我们节点自己剪得比别人深（本机 P 大）| 不会误标别人可恢复的——**但会标本机不可恢复的**；跨节点 recapture 不在本 worker 范围（08-06 §4.2 已注） | 标记是本机事件表，别的节点各自判 |
  | 节点 `getBlockDagInfo` 抖动给出错误 P | `pruningDaa()` 失败返回 null ⇒ (b) 不成立 ⇒ 不标 | fail-closed |
  | 本 tick 的失败是暂态（RPC 慢/断）| reason 为 `rpc-fail`/`no-rpc`/`node-not-synced` ⇒ (a) 不成立 | 白名单式 reason |
  **可逆性**：标记 = events 行 + 内存 Set；人工纠错 = 删该 events 行 + 重启（或 6b 的 `_resetUnrecoverableSet`）⇒ 下 tick 重试。写进 runbook 一行。**没有任何一步会让资金"永久不可退"多于现状**；真正"永久"的是链上剪枝本身，不是这个标记。
### 3.2 ② `pruned_expired_waived` 入 `TERMINAL_STATUSES`（状态判据 · 单独小笔 · Owner 知悉）
- 状态名逐字 = 已剪枝/已过期/已豁免；`bshard-coherence-observability-monitor.mjs:33` 已把它当"已归因、非在途"；`src/` 里**没有写入方**（历史一次性处置写的）。加入 worker 的 `TERMINAL_STATUSES` 只影响 worker 是否重试 recapture（对已剪盘 recapture 无意义）；不影响结算/退款路径（那些路径各自读状态）。出集合：19 分片 / 13 逻辑盘 / 353 side 行。
- 红队要核：全仓 `grep -rn "pruned_expired_waived"` 只有两处监控 + 本 worker ⇒ 没有别的读者把它当"在途"。
### 3.3 ③ 循环单位改逻辑盘 + SQL 预滤（形改 · 不碰 recapture 调用形）
- 一条 SQL 产出候选：NULL 分片 → `LEFT JOIN market_shards` 归并逻辑盘 → `JOIN pool_markets` 滤 `protocol_status NOT IN (TERMINAL ∪ {pruned_expired_waived})` → 排除已标集合（6b Set 在 JS 侧过滤，或 `NOT IN (SELECT DISTINCT json_extract … )` 走 v201 索引）⇒ 每 tick 迭代 **93 → ①② 后 ≤ 7 个逻辑盘**（表 1 里"不标"的 7 个 + 新盘）。
- 每个候选逻辑盘：对其分片逐个 `recaptureSideLockDaaForMarket(shardId)`（**调用形不变**），汇总 `reasons`，然后 `_markUnrecoverable(L, remaining, reasons)`（3.1）。
- `scanned` 语义从"分片数"改"逻辑盘数"：读者只有 `preprune-capture-monitor.mjs`（只读 `tick_count/updated_at`，不读 scanned）⇒ 无阈值/比较受影响（NWT 6c 条件核过）；日志行同时打两个数 `scanned=<逻辑盘> shards=<分片>` 避免读旧页的人对不上。
### 3.4 α · 纯成本短路（不改状态 · 先行笔 · 判据写成可核的数）
**回溯语义（`trade-protocol-filter.js:1262–1330`）**：起点 = `kaspa_tx_log.block_hash`（有则用）→ 否则 `_indexAnchor(U)` = `spc_daa_index` 里 `daa_score ≥ U` 的最近块 **且** `spc_daa_index_coverage` 区间命中 → 否则 **tip（`getBlockDagInfo().sink`）**；沿 `verboseData.selectedParentHash` 逐块回走，每块 `getBlock(includeTransactions)` 找 `side_lock_tx`，上限 `MAX_STEPS = 10,000`。实测速率 **≈2 DAA/步**（a4343 校准：5,839 步 ≈ 11,600 DAA，代码注释自述）⇒ 10,000 步 ≈ 20,000 DAA ≈ 33 min 的链；**期望值，不是界**。**界**：每步沿 selected parent 降的 DAA = 该块蓝 mergeset 大小 ∈ [1, `mergeset_size_limit`]，TN12 = **248**（`bps.rs`, k=124）⇒ 10,000 步最多回退 **R_max = 2,480,000 DAA**（≈69 h @10 bps）。
**α-1 锚点放宽（主收益）**：`_resolveStartCursor` 接受 `spc_daa_index` 里 `daa_score ≥ U` 的最近块 **不再要求 coverage 区间命中**，条件 `anchor.daa − U ≤ D_anchor`（**D_anchor = 10,000 DAA**（v0.1.2 (2)：每步最小降幅 1 ⇒ 10,000 步**保证**覆盖 10,000 DAA；20,000 在低并行段可能走满不中又 300 s）；走前可用 100 步探测实际 DAA/步再放宽，留作 α 实现选项）。coverage 命不中（08-06 §8.2 单点区间）是 aukqt 这批走 tip 的直接原因，而 coverage 对**向下回走**的正确性无关（见反例表）。锚点若已剪 ⇒ 第 0 步 `cannot find header` ⇒ 既有 `anchor-pruned` 逻辑（`:1290–1305`，含 `anchor.daa < pruningDaa` 核）⇒ **一次真实取块失败**（满足 §3.1 (a)），worker 的 (b) 带 M 另核后才标。
**α-2 tip 回溯无望短路（次收益，仅无任何锚点时）**：无 `kaspa_tx_log` hash ∧ 无 α-1 锚点（`spc_daa_index` 在 [U, U + D_anchor] 无块）⇒ 若 **`U < tip_daa − R_max − slack`**（`tip_daa` = 同一 `getBlockDagInfo().virtualDaaScore`；`R_max` = 2,480,000；`slack` = 1,000）⇒ 返回 `reason: 'walk-futile'` **不走**；否则照旧从 tip 走（可能到得了）。它只省成本、**不满足 (a)、不标**，下 tick 再来。
**数（W2 基线 → 期望）**：aukqt（U = 58,695,372，tip ≈ 79.3M，P = 78.2M）：α-1 命中索引块 ⇒ 1 次 `getBlock` `cannot find header` ⇒ `anchor-pruned`（~30 ms，原 297.7 s）；若 6 月段无索引块 ⇒ α-2：`tip − U ≈ 20.6M > R_max 2.48M` ⇒ walk-futile（0 次 RPC）。fy1yk（U 由 created_at 换算 ≈ 6 月下旬）同。`[P − R_max, P)` 之间（≈ 69 h 内剪掉的）不满足 α-2，但 α-1 一定有索引块（近期索引连续）⇒ 仍是 1 步。期望一窗 `preprune.recapture` Σ 从 811 s 降到 ≤ 30 s。
**反例表（Bettor 问"短路会不会把本可恢复的盘误判为跳过"）**：
| 情形 | α-1 | α-2 | 结论 |
|---|---|---|---|
| tx 块在 (U − 20,000 DAA, U]（正常：bet 在 deadline 前不久）| 从锚点走 ≤10,000 步命中 | 不触发（有锚点）| 恢复，比 tip 走快 |
| tx 块比 U 早超过 D_anchor（bet 下得很早、deadline 很晚）| 走满 10,000 步未命中 ⇒ `no-block-hash`（与现状同，现状从 tip 更到不了）| — | 不恢复，不标（(a) 满足但 (b) 未必；若 (b) 也满足则是真剪了）——**与现状同一结果，只是更快失败** |
| 锚点已剪但 tx 块未剪 | **不可能**：anchor.daa ≥ U ≥ tx.daa，剪枝从旧到新，锚点没了则更旧的 tx 块也没了；"剪枝点之下仍有一段能取到"只可能让**锚点还在**（那就正常走）| — | 无误判 |
| tx 块在 selected chain 的 anticone（侧块）| 走 selected parent 看不见 | 同 | **现状（tip 走）同样看不见**，不是新缺口；记为已知限制（accepting block 才在链上；本方法找的是含 tx 的块）|
| `U` 错：tx 其实在 deadline **之后**（协议无效 bet）| 锚点在 tx 之下 ⇒ 走不到；tip 走可能到 | — | 少一次恢复机会；该 bet 本就违反"bet 在 deadline 前"不变量；且 (b) 用同一 U ⇒ 若 U < P − M 会被标——**这是唯一"错 U ⇒ 错标"的通路**，标记可逆（§3.1），并要求写入方 `deadline_daa` 正确（坏值已单列报警）|
| α-2 判 walk-futile 但其实走得到 | **不可能**：R_max 是每步降幅上界 × 步数上限 ⇒ 10,000 步到不了 U 以下 | | 无误判；只可能"能走到却没短路"（保守方向）|
| `getBlockDagInfo` 抖动给错 tip/P | tip 只用于 α-2 且方向保守（tip 偏小 ⇒ 更不短路）；P 缺失 ⇒ 既有逻辑不标 | | fail-closed |
⇒ **答案**：α-1/α-2 都不会把本可恢复的盘误判为跳过；α-2 只是把"必败的 10,000 步"省掉、下 tick 照常；唯一的错标通路来自错的 `deadline_daa`（§3.1 已列、可逆）。
**观测**：`reasons` 直方图进 tick 行（`walk-futile` / `anchor-pruned` / `no-block-hash` / `rpc-fail` …）；α-1 命中锚点时打 `anchorSource=index-nocoverage` 计数。

## 4. 落地顺序与包
| 笔 | 内容 | 状态影响 | 审批 |
|---|---|---|---|
| 6c-α | §3.4 成本短路 + 叶子 `reasons` 上传 + §3.3 循环单位/预滤/双计数日志 | 无（只少走无望回溯；不标任何东西）| NWT |
| 6c-β | §3.1 ① 两条件标记（含替代上界、坏值报警、payload 四字段）| **有**（events 标记 = worker 永不再试）| NWT 红队 + **Owner 批** |
| 6c-γ | §3.2 ② `pruned_expired_waived` 入终态 | 有（worker 范围）| NWT + Owner 知悉 |
| 收尾 | 08-06 稿 §7 影响面（本稿 §1 表即是）合稿；一窗验收 | | Bettor |
α 先落可以立刻拿到 W2 基线的对照（Σ811 s → 秒级）而不改任何状态；β/γ 再改状态。

## 5. 验收（每笔 · 修前基线 = W2）
- α：门开一窗（≥10 min）`preprune.recapture` 整体 **Σ ≤ 30 s / 15 min**（守恒量，基线 811 s）；**分两组**（v0.1.2 (8)）：可标/已标组（表 1 前两行 + 已标 341）`max ≤ 5 s`（基线 297.7 s）；表 1 "≥剪枝点不标"的 7 个盘（U ≈ tip，tip 回溯可达 10,000 步 ≈300 s）单列 `max ≤ 60 s` 并报 `anchorSource=index` 命中率；`walk-futile` 计数 ≈ 118+32 分片的 side 数量级；`scanned=<逻辑盘> shards=<分片>` 两数都在；lag ≥4 s 仍 0；`reasons` 直方图出现在 tick 行。
- β **先 dry-run 一窗**（v0.1.2 (6)）：log-only 打 `would-mark market=… U= P= M= reason= upperBoundSource=` 行，计数 ≈72（+fy1yk 1）≤ 73 核对后再开写。真写首窗新增 `side_lock_daa_unrecoverable` 事件数 ≈ 73 —— **不多于表 1 "可标"两行的逻辑盘数 73**；`ge_pp` 7 个盘 **0** 标记（负测试 08-06 §6.3/§6.4：`deadline < P` 但取块成功 ⇒ 不标；`deadline ≥ P` 但取块失败 ⇒ 不标）；`deadline_daa_implausible` 事件 = 1（nnd1g）；下一窗 `scanned` 从 93 降到 ≤ 7。
- γ：出集合 13 逻辑盘；`scanned` 再降 13。
- 08-06 §6.2 的"可证伪预测（下次陷阱前 tick 数 62~68）"随 α 应失效——同为验收。
- 离线用例：两条件四象限（deadline<P−M × 取块成功/失败）各一；坏值 > tip 不标；NULL deadline 用 created_at 换算成立/不成立各一；`rpc-fail`/`node-not-synced` 不算 (a)；`walk-futile` 不标但计数；`pruned_expired_waived` 出集合；循环单位改后 recapture 调用次数 = 分片数不变。

## 6. 不做 / 排除
- ❌ 只调大 `MAX_STEPS` / 只拉长 tick（08-06 §4.1）。
- ❌ 用 `_coverageFloor()` 当判据（08-06 §2.3 证伪，本稿 §1 复现 0/177）。
- ❌ 把不可恢复标记落 `pool_markets` 新列或改 `protocol_status`（那是结算状态机的字段，超出 worker 范围；events + 6b Set 已够，且可逆）。
- ❌ 跨节点 recapture（08-06 §4.2 已注：各节点各判）。

## 7. 未核 / 风险
- ~~`daa_at(created_at)` 换算依赖 6 月索引~~ → v0.1.2 (4) 撤回：取 timestamp ≥ created_at 的第一个索引点即合法上界，fy1yk 可界。
- ~~M 1 h vs 12 h~~ → v0.1.2 (1) 定 36,000（结构最小值）。
- `pruned_expired_waived` 的写入方在 `src/` 外（历史脚本）：若将来有新写入方把"未归因"的盘也写成这个状态，②会让 worker 漏掉它——文档化为"该状态 = 已归因终态"的契约。

## 8. Pin
活库 readonly 2026-09-06T22:2xZ · console 20:41:14Z 进程（6a+6b 在）· 剪枝点 daa 78,217,530（20:10:25Z `[trade-filter:capture]` 行）· floor 56,983,539 · W2 基线见 `scratch/_j2_p2_acceptance_window2_page_2026-09-06T21-56Z.md` · 数字随 IBD/结算推进而变，引用前重读。
