> **Status**: CURRENT（2026-09-20，NWT；对象 = `docs/2026-09-20-bettor-oracle-batchD-grace-refundflip-budget-design-v0.1.md`（主线 `b287d6d1`）；设计审、只报 MUST，SHOULD 记票；D-021：只写设计缺口类别）

# oracle 批 D 设计 v0.1（宽限窗 + 2h refund_flip 预算 + 冻结 + 晚 seal 守卫）—— NWT 红队

## 结论：**方向与时间结构对（cutoff 按 pmt、晚 seal 直接冻结、冻结不改值、与批 A 触发器同向）；但有 6 条 MUST 缺口，其中 3 条是"门有洞"（冻结的 TOCTOU、冻结列无约束、promote 前置漏了"结果已知"），另 3 条是取值/定义。** 修完送我复核一轮即可。

## 我先补的实测（J2 只测了 simnet 25 s 窗口）
主网只读节点，`getBlockDagInfo.pastMedianTime` 对本机墙钟的落后量，每 3 s 一采、共 **85 个样本 / 253 s**（只读采样器，0 错误）：落后 **min 133.2 s / 中位 141.0 s / p90 145.6 s / p99=max 149.4 s**（极差 16.2 s）；节点全程 `isSynced=true`；pmt **单调不回退**；但**相邻采样间 pmt 常不变**（84 个间隔里 60 个，pmt 按块批次跳变而不是连续走）；区块率约 9.55 块/s。结论：**主网稳态落后 ≈ 2.3 min（133–149 s），与 J2 的 simnet 139 s 一致；4 分钟窗内抖动 ~16 s。** 局限：**这仍是单个 4 分钟窗**——不给"落后永远 ≤150 s"的保证，所以 D5 用读数有效性条件而非常数。 这支持"pmt 落后墙钟对我们有利"的说法，但它是**稳态读数**，不覆盖节点落后/重启/IBD 的情形（见 D5）。

## 六条 MUST
**D1 冻结检查点有 TOCTOU：只在 `listWork` 检查 `settlement_frozen_at IS NULL` 堵不住"已在飞"的 close_commit。** 一个 tick 里从 `listWork` 挑出市场到真正广播之间有数秒到数十秒（C1 取证预算最多 15 s、pmt 门读取、构造、IPC），这期间被冻结的市场仍会被广播。设计要求：**在核心的广播前闸（`stage='gate'`，pmt 门旁）再次读取冻结列并 fail-closed**（读不到/非空 ⇒ 不广播），并同样加到 `store.dependenciesLanded('close_commit')`。另需明确写进设计：**已 prepared 的 close_commit（字节已签名、可能已广播）不受冻结影响**——冻结的效力止于"prepared 之前"，所以冻结必须早于该市场的第一个 tick 进入 close_commit（对应 R3 的 cutoff/宽限窗），别让运维以为"事后冻结能拦住已 prepared 的交易"。

**D2 `settlement_frozen_at` 需要与批 A 同一级的 DB 约束，否则 M2 的"争议⇒冻结⇒走 refund"可被一条 SQL 撤销。** 现稿只是一列。要求：① 触发器 `OLD.settlement_frozen_at IS NOT NULL` 时拒绝任何改动（含清空 NULL）——冻结**单向**；② `BEFORE INSERT` 必须 NULL；③ **`BEFORE UPDATE OF winning_side` 在 `OLD.settlement_frozen_at IS NOT NULL` 时 ABORT**（冻结市场在 DB 层就不能被 promote，而不是靠 adapter 记得检查）；④ promote 的 UPDATE 谓词在**同一条语句**里带 `settlement_frozen_at IS NULL`，堵"检查→写入"之间的竞态；⑤ 该列时间域定成一种（现稿"INTEGER pmt/ts"含糊）并配 `settlement_frozen_reason`（异议 / 人工 / 预检失败 / 过 cutoff / 晚 seal）。

**D3 promote 前置五条漏了"结果已可知"（M6）。** `winning_side` 是**写一次**且**seal 可远早于 deadline**——一个过早写入的值（缓冲的 verdict、有 bug 的 voter）会永久锁死市场且无法更正。promote 必须再加一条：**`pmt ≥ outcome_end_ms`（以及 verdict 的 `created_at` ≥ outcome_end_ms）**；否则拒绝并记录。这条在批 A 的触发器里没有（批 A 不知道 pmt），必须在批 D 的 promote 门里。

**D4 GRACE 需要下限，且要定义"宽限窗从哪个 verdict 起算、异议怎么处理"。** 现稿有上界公式、放不下"压缩到上界"，压到 30 秒也算宽限窗——那只是个形式。要求：定义 `GRACE_MIN_MS`（例如 5 min）——上界 < 下限 ⇒ 视同晚 seal，直接冻结/人工；宽限窗起点 = **满足 R2 一致性条件的那一刻**（不是第一条 verdict 的 `created_at`）；宽限窗内出现**任何**不一致的 verdict 或 ABSTAIN/异议行 ⇒ 冻结（把批 A 的"outcome 可为 NULL"用起来）。另外上界公式里"`promotion_cutoff_pmt − verdict_written_at(墙钟)`"混用了 pmt 与墙钟两个时间域：请统一（采样时同时记 pmt），或在公式里显式减去稳态落后量的上界。

**D5 pmt 的读数要带有效性条件，并给"读失败顺延"一个显式告警与上界。** ① 只用 pmt 会在**本机节点落后/未同步/重启后回追**时误判：本机 pmt 落后网络越多，越会"以为还有时间"而实际 refund_flip 已对全网开放。要求 pmt 读数仅在 **`getServerInfo.isSynced===true` 且 `|墙钟 − pmt| ≤ LAG_MAX`（取稳态 ≈140 s 的 3 倍量级，例如 ≤ 10 min）** 时有效，否则按"读失败"处理；两次连续读数必须单调。② 你问的"读失败无上限顺延 10 min 盖得住吗"——**这个 10 min 不是被读失败消耗的**：读失败只会让 promote 推迟到 cutoff，过了 cutoff 一律冻结（方向安全）；`PROMOTION_SAFETY_MS` 真正保护的是 **promote 之后**的 close_commit 流水线（实测 ~30 s）与驱动/console 重启、`no_suitable_fee_utxo`、relay 健康门拒绝等**停摆**。它对这些停摆能覆盖到几分钟级的一次重启，覆盖不了"relay 余额顶格被拒（捐款面）"这类可长期存在的停摆——所以要**加告警而不是加常数**：promote 后 X 分钟内 close_commit 未 landed 且距 refund_flip < Y ⇒ 立即报警；pmt 连续读失败超过 N tick 且市场在 promote 窗内 ⇒ 报警。③ 建议 `PROMOTION_SAFETY_MS` 取 **20 min**、并带上下界校验（5–60 min）：正常市场（宽限窗在 deadline 之前）这项**零成本**，只影响"晚判定"的市场少一点自动化机会，换来对短停摆的容错。

**D6 下注端点不检查 deadline / outcome_end——批 D 只守了 seal 一端，没有守"结果已知之后还能下注"。** 我核了 `POST /api/proto-markets/:id/bet`：只检查 `status==='betting'`，不检查 deadline，更不检查 `outcome_end_ms`；市场按"确认注数==seal_count"封盘，与时间无关。所以对**有判定题的市场**，结果已知后仍可下注、而下注方能选赢的一侧——这是**经济性缺口**，与"晚 seal ⇒ refund_flip 抢跑"是同一个根因的两个后果。设计里只写了后果一（晚 seal 守卫），根因没有关。要求：判定题市场的下注/append 在 **`now ≥ outcome_end_ms`（或 `pmt ≥ outcome_end_ms`）后一律拒绝**（应用层，并作为 B-promote 的上线前置）；无判定题的 operator 市场不受此条约束。

## 你问的六点
① **`PROMOTION_SAFETY_MS`=10 min 够不够**：对"一次重启 + 两个 tick"够，对长期停摆不够也不该靠常数——见 D5②，建议 20 min + 告警 + 上下界。 ② **GRACE 上界公式**：结构对（正常市场宽限窗落在 outcome_end→deadline，对 post-deadline 预算零占用），但要 D4 的下限、统一时间域、起点定义。 ③ **冻结检查点是否堵住所有 close_commit 路径**：`store.listWork` 是唯一的入口（HTTP 的 close 类路由仍是 501 桩、bet 侧驱动只做 genesis/append），所以入口是唯一的，但**没有堵住"入口之后"**——D1。 ④ **晚 seal 阈值取 cutoff 合不合适**：合适（cutoff 本身已含 10 min 余量），加一句：seal 落链前后 pmt 跨过 cutoff 的边界案例要有测试。 ⑤ **与 M2「写后永不改」及批 A 触发器自洽**：写后不改 ✅、冻结不改值 ✅、`status` 保持 sealed 与批 A 的 `OLD.status='sealed'` 一致 ✅；缺的是 D2（冻结列无约束）。 ⑥ **pmt 单点采样风险**：稳态很稳（上面实测），风险不在抖动而在**节点状态**（落后/未同步/重启），所以我建议的不是"多采几窗定常数"而是**读数有效性条件**（D5①）；J2 若要多窗数据，我的采样器可以直接复用。

## SHOULD（记票）
1. 冻结后驱动不要对该市场的 `RootClose` 漂移持续报 `settlement_chain_fact_drift`（refund_flip 发生后无害）。 2. 冻结/promote 的测试要含"同一 tick 内先 promote 后 freeze"与"freeze 与 promote 并发"。 3. `PROMOTION_SAFETY_MS`/`GRACE_MS` 的 env 覆盖要在启动日志里打出实际值（同哨兵/开关的可见性约定）。 4. 不足 seal_count 市场：设计写"未接线"是诚实的；建议在 runbook 里给出人工处置步骤。

## 我没做
没有验证批 D 的实现（只有设计）；没有对"节点落后/未同步"情形下的 pmt 行为做实测（稳态采样之外）。
