# NWT — `w_cap_window` 重建器取数设计 v0.1（纯设计·不落码·@7b1e18cc）

> 作者 NWT · 2026-08-27 · 派工 Bettor（等 Codex 283 时）· 目标 = 给 (23) v0.15 支配定理的 `window(SP)` 精确重建定**取数管线**（RPC only，输入清单见 `2026-08-27-nwt-wcap-reconstructor-input-feasibility.md`）。坐标 `git show 7b1e18cc:<path>`；不确定处标 **须实测**。**Codex 不授权 build/deploy——本稿纯设计层。**

## ① `getBlocks` 前向分页语义
`getBlocks(lowHash, includeBlocks=true, includeTransactions=false)`（`rpc/service/src/service.rs:426-477`）:
- **返回序 = 前向拓扑**：`antipast_hashes_between(low, high=sink, max_blocks)`（`consensus/src/processes/sync/mod.rs`）先 `find_highest_common_chain_block(low, sink)` 归一到 sink 链，再 `forward_chain_iterator(low→sink).skip(1)` 沿**选中链前向**，每个链块吐其 `consensus_ordered_mergeset`（滤掉 `original_low` past 的）⇒ **低→高、mergeset 序**。
- **含 lowHash**：handler `once(low_hash).chain(block_hashes)`（:470 前后）⇒ **low 被返回**（"+1 because low_hash is also returned" :452）。
- **每页 ≤ 249 块**：`max_blocks = mergeset_size_limit()+1 = 249`（:452-453）；`blocks.len()+gd.mergeset_size() > max_blocks ⇒ break`。
- **分页游标 = `high_hash = highest_reached`**（返回值第二项）：下一页 `getBlocks(lowHash = 上页 high_hash)`。**停止条件**：`high_hash == sink`（`service.rs:459` `filtered_sink_anticone` 分支即"到顶"）⇒ 已达 sink，翻页结束。
- **`isChainBlock`**（verboseData）：标该块是否在选中（virtual）链上 ⇒ 重建时**认 selected-parent 链**用（区分链块 vs mergeset 侧块）；`selectedParentHash` 直接给父。
- 🔴 **方向注**：getBlocks 只能**前向**（low→sink）。取"近 [t0,t1]"须先定一个**够老的 low 锚 R**，再前向翻到 sink。R 的取法 = ②。

## ② 锚点 R 选取（证书乙的**在线**判定，非猜数字）
证书乙（(23) v0.15）：`window(SP)` 精确 ⟺ 重建堆**满 661** ∧ **堆内最小蓝功 > blue_work(R)** ∧ **R 后 mergeset 成员零缺失**。
- **为什么 R 要够老**：`26,440` 蓝分只是**准入地板**（`lowest_daa_blue_score`）；窗成员按**蓝功**留最高 661，可比"bs(SP)−26,440"更老（继承不重过滤，(23) v0.14）。`S = {已收 b: bs(b) ≥ bs_top−36,000}`（merge depth）⇒ 最老 SP 在 `bs_top−36,000`，其窗成员可到 `bs_top−36,000−26,440 = bs_top−62,440` 蓝分。
- 🔴 **在线判定（用 F9，不猜）**：`blue_work` 沿祖先**单调不减**（`ghostdag/protocol.rs:99-104/:161`）⇒ 比 R 更深的**未取块**其 `blue_work ≤ blue_work(R)`。故 **R 够老 ⟺ `blue_work(R) < min_{SP∈S} heapMin(window(SP))`**（heapMin = 该窗第 661 高蓝功）：此时任何未取块蓝功 ≤ blue_work(R) < heapMin ⇒ 进不了任何 window(SP) ⇒ 停。**判据是"堆最小蓝功 > R 蓝功"，不是某个蓝分/DAA 深度数。**
- **三可读量的保守起锚（仅**起点猜测**，证书才是判据）**：header 全给 `blueScore/daaScore/timestamp`。
  - blueScore：起锚 `bs_top − 62,440`（62,440 = 36,000+26,440，见上）——**保守起点**，不足则按在线判定继续深挖。
  - daaScore / timestamp：仅作**旁证/翻页进度**，不作深度判据（daa≠blue，(23) 教训；时间受戳操纵）。
- **迭代**：起锚 R₀ = 首个 `bs ≤ bs_top−62,440` 的已收块 → 前向翻到 sink → 重建全 `window(SP)` → 算 `m = min_{SP∈S} heapMin`；若 `blue_work(R) ≥ m`（或有窗未满 661）⇒ **加深 R**（取更老锚，补翻新增旧块）→ 重算，直到 `blue_work(R) < m ∧ 全窗满 661 ∧ 零缺失`。**收敛**：blue_work 单调 ⇒ 每加深 R 蓝功严格降，有限步达标（真 genesis 兜底 = 证书甲）。

## ③ 增量缓存
- **按 SP 缓存 `window(SP)`**（键 = SP hash）：`window(C) = window(SP) ⊕ push_mergeset(C)`（`window.rs:265-282`）⇒ 有父窗则 **O(1) 继承**（克隆 + ≤7 次堆操作，F5），全网一遍 O(N)。
- **去重**：块按 hash 唯一；mergeset 引用去重（`consensus_ordered_mergeset` 已去 original_low past）。
- **重组失效（reorg/新 tip）**：`window(SP)` 只依赖 SP 的**过去**（DAG 祖先），过去不因新 tip 改 ⇒ **已缓存的 window(SP) 对已确定的 SP 恒有效**（DAG 祖先不可变）。失效只发生在：`S` 集合随 `bs_top` 前移而**滑动**（新块进 S、旧块出 S），需**新块**建窗（增量）+ 旧块出 S 后其窗可**逐出缓存**；`bs_top` 的 sink 若 reorg 回退（virtual 重选）⇒ `S`/`bs_top` 重算，但各 `window(SP)` 缓存仍有效（SP 过去不变）。**须实测**：reorg 深度对 `S` 边界的抖动（(23) 的 `M_reorg` 域）。

## ④ 失败处置
- **分页中断**：游标 = 上页 `high_hash`，从它续翻（幂等，getBlocks 无副作用）。
- **节点重启**：console/relay 重启不影响（RPC 无状态查询）；节点自身重启 ⇒ 等 `isSynced=true` 再取（`service.rs` `is_sink_recent_and_connected`）。
- **剪裁越锚**：`pruning_depth = max(finality_depth + 2·36,000 + 4·248·124 + …, BPS·PRUNING_DURATION) ≥ finality_depth+195,258`（`bps.rs:96-107`）≫ 62,440 ⇒ **稳态下近 1.7 h 窗恒在保留区**（`reference-tn12-pruning-wall-and-archival-semantics`）。🔴 **须实测边界**：(a) **IBD 期**节点本地无全史 ⇒ 证书甲/乙皆不成立 ⇒ `WINDOW_INEXACT`（正确 fail-closed，(23) v0.15）；(b) **剪裁点刚越过锚**的瞬态 / **pruning proof** 下头部是否可 getBlock（剪裁后 header 保留但 body 剪 ⇒ verboseData 是否仍全？**须实测** getBlock 在剪裁点附近的 verboseData 完整性）。
- **`WINDOW_INEXACT`**：② 在线判定不达标 ⇒ (1) 若因 R 不够老 ⇒ 加深 R 重试；(2) 若因成员缺失（mergeset 引用未收 hash 且节点也无）⇒ 非 IBD 则异常、IBD 则等同步；(3) 兜底 = **不出 cap，回 (a-total)**（估计器 fail-closed，**不归 B_adv**，Codex 281）。**绝不静默取过大 `T_lb`。**

## ⑤ 与 (21) `hVisUb` 接口
重建器（(24) 承接，(21) `hVisUb` 的 `wCapWindow` 实参由此填）输出：
```
{ wCapWindow: <sompi/work 单位, = max_{SP∈S} w_child_ub(SP)>,   // null ⇒ 回 (a-total)
  S_size: <|S|>,
  certificate: { kind: 'GENESIS'|'TRUNCATION'|'INEXACT',
                 R: <锚块 hash | null>, R_blue_work, heapMin_min: <min_{SP∈S} heapMin>,
                 missing: <缺失成员数, 0 = 精确> },
  t0Ms, t1Ms,          // 与 λ_ub(n) 接收计窗一致
  target_commit: '7b1e18cc', rpc_url, sampled_at }        // provenance
```
- `certificate.kind == 'INEXACT'` ∨ `missing > 0` ⇒ `wCapWindow = null` ⇒ (21) `hVisUb` 硬闸 `NO_W_CAP`/`WINDOW_INEXACT` ⇒ 回 (a-total)。
- `hVisUb = λ_ub(n) · wCapWindow / ((t1Ms−t0Ms)/1000)`；`t0/t1` 须与 (21) 的 own-clock 接收计窗**同区间**（否则单位/窗不一致）。

## 待实测清单（同步后）
- getBlocks 实测每页块数 / 翻齐 62,440 蓝分的轮数 / 秒级可行性；
- 剪裁点附近 getBlock verboseData 完整性（body 剪后 mergeset/selectedParent 是否仍返回）；
- reorg 对 `S`/`bs_top` 边界抖动幅度（接 (23) `M_reorg`）；
- IBD 期 `WINDOW_INEXACT` 触发率；
- 起锚 62,440 是否常一次达标（在线判定加深次数分布）。
