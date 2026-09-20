> **Status**: CURRENT（2026-09-20，NWT；对象 = 分支 `coord/j2-oracle-batchD-v0` @ `ffe95ffa`（基线 `ce249c48`，24 文件）；实现复核 MUST-only；D-021：只写缺口类别）

# oracle 批 D 实现复核（MUST-only）

## 结论：**N1–N6 与 D1–D6 在代码里都成立；有 2 条 MUST 要改（都是几行）：promote 门的异议过滤太窄（会在有异议时照常 promote）、受理点门只看 pmt 留了一个"结果已知、pmt 还没到"的下注窗口。** relay 触碰与 ⑤ freeze-after-write 的结论见下：**relay 改动钱路安全且向后兼容；⑤ 保留应急刹车、不焊死。**

## 我做了什么（独立于 J2 的自报）
- 在我自己的检出上取该 commit，把 J2 的 8 个测试文件 + relay `utxo-facts.test` 全部重跑：**全绿**（19/13/5/30/17/11/24 + route + relay 43）。
- **15 个我自己写的变异**（核心闸 fail-open ×2、listWork/dependenciesLanded 去冻结判据、`PROMOTE_UPDATE_SQL` 去冻结谓词、受理门 `>=`→`>`、判定题空 `outcome_end` 放行、promote 门去 pmt≥outcome_end、有效宽限不取 min、去 isSynced、冻结时钟回退错、3 条触发器去除/放宽、晚 seal 守卫对非判定题也生效）：**15/15 被杀，树已还原（`git status` 干净）**。
- 新建库上跑 v212+v213：16 条批 D 触发器全在；**主网库只读副本（VACUUM INTO）** 上迁移通过，遗留行（a59c 等）行为与批 A 一致。
- 触发器 16 探针（冻结后写值/清冻结/改 reason/`INSERT OR REPLACE` 覆盖/预冻结 INSERT/浮点与空白 reason/同语句"写值+冻结"/`pmt_at` 域…）全部行为符合设计。
- promote 门 9 探针（含对照臂）——发现 M1。

## 2 条 MUST
**M1 promote 门的"异议/弃权 ⇒ 冻结"只看 `extractor/uma ∧ pmt_at 非空 ∧ pmt_at ≥ outcome_end` 的 verdict，其余一律被无声忽略。** 我用真函数喂了 9 组：对照臂（两个来源一致）⇒ promote ✅；**同一批一致 verdict 之外再加一条**——(A) extractor 的 `outcome=NULL` 但 `pmt_at=NULL`、(C) extractor 反向 outcome 但 `pmt_at=NULL`、(B) `human` 反向 outcome、(B2) `human` 的 `outcome=NULL`——**全部仍然 `promote`**；只有"extractor/uma 且 `pmt_at≥outcome_end`"的异议才冻结（F、G 冻结）。设计 §1.5/§3 写的是"窗内**任一**不一致 verdict 或 outcome IS NULL ⇒ 冻结；委员异议/人工 flag ⇒ 冻结"，N1 只规定 `pmt_at` 为 NULL 的 verdict **不计入一致性**——**排除出"赞成票"是对的，排除出"反对票"是 fail-open**：写值一次不可改，宁可多冻。典型触发：adapter 在读 pmt 失败时写下的异议行（`pmt_at=NULL`）会被整条无视。要求：**赞成集**保持现状（extractor/uma ∧ `pmt_at≥outcome_end`）；**反对集 = 该市场上所有非 `llm` 的 verdict（extractor/uma/human），不论 `pmt_at` 是否为空、不论早晚**，只要 `outcome IS NULL` 或与胜方不同 ⇒ `freeze`（reason 区分）。`llm` 只是提案，是否也触发冻结由 Bettor 定（我倾向也冻，成本为零）。补 4 条测试：A/B/B2/C，并各配一个变异（放宽过滤⇒必红）。

**M2 受理点 outcome_end 门只比 pmt，留出一个"结果已知、pmt 还没到"的窗口。** pmt 稳态落后墙钟约 2.3 min（我实测 133–149 s），LAG_MAX 允许到 10 min：`wall ≥ outcome_end` 之后的这段时间里 `pmt < outcome_end`，门仍**受理**下注——正是 D6 要堵的"结果已知后下注选赢侧"，只是窗口缩到了 2.3–10 min。要求：门改成 **`max(墙钟, pmt) ≥ outcome_end_ms` 即拒**（墙钟取控制台本机；时钟偏差只会多拒不会多收）。pmt 的有效性/fail-closed 语义不变。补测试：`pmt = outcome_end − 140 s` 而 `wall = outcome_end + 1 s` ⇒ 必拒。

## 你问的两处
**① relay `handleGetPastMedianTime` 加返 `isSynced`（范围外单独审）：钱路安全、向后兼容，无 MUST。** 只读，走同一个共享 RpcClient（同节点成立）；不签不广播不碰密钥；`getServerInfo` 读不到 ⇒ `isSynced:null`，消费端（`readValidatedPmt`）按 `is_synced_missing` fail-closed。兼容矩阵：新 console + 旧 relay ⇒ 仅**判定题**受理拒（现网没有判定题市场）、既有 close_commit 门不受影响；旧 console + 新 relay ⇒ 多一个字段被忽略（`checkPmtGate` 按具名字段取值）。SHOULD：① 现在是先 `getServerInfo` 再 `getBlockDagInfo` 串行，各 5 s 超时；RPC 已连上但两者都慢时最坏 ≈10 s（外加 `waitForRpc` 8 s）超过控制台 15 s IPC 超时——只会 fail-closed 且只在降级时，但它是既有 close_commit pmt 门的路径，建议两读并行（`Promise.all`）让最坏不比改前多。② `relay.mjs` 该 case 的注释仍写"只回 {ok, pastMedianTimeMs, observedAtMs}"，已陈。

**⑤ freeze-after-write：保留应急刹车，不焊死。** 独立核实（不采信 J2 自报）：
- 冻结列在 `kasia-console/src` + `kasia-relay/src` 里**只被读 3 处**，都在 close_commit 分支：`store:54`（listWork 选行）、`store:99`（dependenciesLanded 的 close_commit 块）、`core:173`（广播前闸）；另 `store:152`/`service:104` 是端口定义。convert/claim 的发现 SQL、dependenciesLanded 的 convert/claim 分支、markLanded、preparedRows 都不引用它。
- **prepared/submitted 的 close_commit 不受冻结影响**：`advanceStep` 对 prepared 行跳过 dependenciesLanded、`driveIntent` 同字节重播而不进 `buildAndBroadcast`（闸 ③ 在其内），submitted 走 landed 检查——都不经闸。
- **数据库层也不拦**：在新库上对"已写值又冻结"的市场直接执行 `markLanded(resolve)` 的真 SQL（`SET status='resolved'`）⇒ **允许**（触发器只盯 `UPDATE OF winning_side`）；同一市场再写 winning_side / 清冻结 / 改 reason ⇒ 全部 ABORT。
- 所以 (b) close_commit 已 prepared/broadcast 后冻结 ⇒ 照常 landed→resolved→建 claim；(c) close_commit 已 landed 后冻结 ⇒ convert/claim 照常走完，**不 strand**；(a) 还是 pending 时冻结 ⇒ 三入口跳过 ⇒ 等自然 refund_flip，"不 strand"的真前提是 refund 执行批（未接线），已由 N5b 挡住有价值市场上主网。
- 唯一副作用是展示层（SHOULD）：公开市场列表仍会带 `winning_side`，"写值后冻结"的市场对外看起来像有赢家。建议列表里带出 `settlement_frozen_at`（或对冻结市场隐藏 winning_side）。同时请 J2 按计划把 (b)(c) 钉成回归 + 变异（给 convert/claim 误加冻结检查 ⇒ 必红）。

## SHOULD（记票，不阻塞）
promote 在 `BEGIN IMMEDIATE` 里重读 verdict（已在 v0.2 票）；非 `llm` 的**早于 outcome_end** 的反向 verdict 是否也应冻结（M1 修法里我已按"不论早晚"写，若 Bettor 觉得过严可只排除它）；`frozen_reason` 枚举化；pmt 单调基线在内存（重启后无基线，已在票）；公开列表带冻结标志（上）；relay 两读并行 + 陈旧注释（上）。

## 我没做
未部署、未在 simnet 端到端跑（等批 B）；批 D 不含 promote 的调用方，所以 M1 的"实际写值"还没有真实调用者——这也是现在改最便宜的原因。
