# oracle 整合批 D(v213)—— 实现说明(2026-09-20, J2)

设计 `docs/2026-09-20-bettor-oracle-batchD-grace-refundflip-budget-design-v0.1.md` v0.3 §1–§8(N1–N6)。范围: 给批 B 铺时间 / 冻结 / 预算 / 结果已知的闸; **不含 verdict 写入与实际 promote 写值(批 B)**, 不动主网 live, 只合不部署。

## 交付(逐条对派单)
1. **migrate v213**: `proto_markets.settlement_frozen_at` + `frozen_reason`; `proto_market_verdicts.pmt_at`; 触发器 7 个新增(冻结 INSERT 必 NULL / 域 / 单向 / reason 必填 / reason 不脱离冻结 / **D2 冻结禁写 winning_side(含同语句)** / pmt_at 域) + 重建批 A 的 `verdict_ref`(加 `v.pmt_at IS NOT NULL`)。
2. **promote 门**(`lib/proto-settlement-budget.mjs::evaluatePromoteGate`, 纯函数, 本批无调用方): 六前置 + N1(仅 pmt_at 非 NULL 且 ≥ outcome_end 的 extractor/uma 计入; `consistency_met_at` 行推不存列)+ N3(`typeof number && isFinite`; 判定题∧空 ⇒ reject 记因)+ N6(`effective_grace = min(GRACE, cutoff − cma − MARGIN)`, `< GRACE_MIN` ⇒ freeze late_seal); 返回 `promote/wait/freeze/stop/reject`; `PROMOTE_UPDATE_SQL` + `promoteWinningSide`(谓词同语句带 sealed ∧ 未判 ∧ 未冻)。
3. **close_commit 冻结三入口 fail-closed**: ① `store.listWork` 选行 `settlement_frozen_at IS NULL`; ② `store.dependenciesLanded('close_commit')` 重读; ③ 核心广播前闸(pmt 门之前)`deps.isSettlementFrozen`——**严格 fail-closed**: 只有端口明确返回 `false` 才放行(true / 非布尔 / 抛错 / 市场不存在一律按冻结); 已 prepared 的意图(字节已落库)不受冻结影响。`isSettlementFrozen` 成为核心的**必需依赖**(缺则 DriverDepsError)。
4. **受理点 outcome_end 门**(`lib/proto-bet-intake.mjs` + `api/proto.js` bet 路由): 判定题(复用批 A 定义, 现抽成 `db/proto-judged.mjs` 单一来源, 触发器 SQL 与 JS 判据共用, 测试钉文本一致)∧ 有限 outcome_end ∧ pmt ≥ outcome_end ⇒ 409; 判定题∧outcome_end 空 ⇒ 409; 判定题受理时 pmt 无效 / 读不到 ⇒ 503 fail-closed; 无判定题豁免且不读 pmt; **门在受理点、驱动 append 路径未改**(N4)。所有拒绝在任何 DB 写 / IPC 之前(路由测试断言无 bets / 意图行)。
5. **常量 + 启动校验**: SAFETY=20min[15–60] 校验 `≥ LAG_MAX + MARGIN + tick`(N2), env `PROTO_PROMOTION_SAFETY_MS / PROTO_GRACE_MS / PROTO_GRACE_MIN_MS / PROTO_PMT_LAG_MAX_MS / PROTO_CLOSE_PIPELINE_MARGIN_MS`; 非法值回默认 + LOUD(error 日志); 默认自身与 tick 矛盾 ⇒ 拒启动(`startProtoSettlementDriver` REFUSED)。
6. **pmt 有效性**(§5): `isSynced===true ∧ |读取墙钟−pmt| ≤ LAG_MAX ∧ 单调不减`(进程内共享校验器, 内存基线); **冻结写入不依赖 pmt 有效**(`chooseFreezeClock`: pmt 有效写 pmt, 否则墙钟 + `frozen_reason` 标 `clock=wall`, 恒非空)。**relay 侧加了 `isSynced` 布尔字段**(见下"判断 ①")。
7. **停摆告警(§5)**: **本批未做, 记票**(见下)。

## 我做的判断 / 需要 NWT / Bettor 知道的(有异议请指出)
1. **触了 relay**: `kasia-relay/src/lib/utxo-facts.mjs::handleGetPastMedianTime` 现回 `{ok, pastMedianTimeMs, observedAtMs, isSynced}`(isSynced 来自同一共享 RpcClient 的 `getServerInfo()`, 读不到 ⇒ null)。原因: §5 要 `isSynced===true`, 而 9-0 的 pmt 读只有三个字段; 用 console 侧 rpc-health 会引入"读 pmt 的节点 ≠ 判 isSynced 的节点"的分歧。9-0 的 P1 测试(原"恰好三个字段")已改为四个并新增 P1b 三态测试; 既有 close_commit 门只用 pmt/observedAt, 不受影响。**部署含义: relay 未升级时判定题受理 fail-closed(`is_synced_missing`), 无判定题市场不受影响**。
2. **R2"独立来源"** = 不同的 `source_kind ∈ {extractor, uma}`(同类型多条不算独立; llm / human 不计入自动路径)——取最保守解读; 设计原文"≥2 独立来源"未细化, 批 B 若要"同类型不同 relay 也算独立"须改设计。
3. **`mode` 只实现 'auto'**: human 确认路径的语义(是否走宽限窗 / R2)归批 B, 传 `mode:'human'` 返回 `wait mode_not_supported_in_batch_D`。
4. **晚 seal 守卫只对判定题市场生效**(operator 市场——如主网首轮 a59c——即使 seal 时已过 cutoff 也不冻, 否则会把受控 write-once 路径堵死); 决策时刻取 pmt, pmt 无效退墙钟(墙钟 ≥ pmt ⇒ 更早判 late, 方向保守); 挂在服务层 `makeMarkLanded`(seal landed 后, 含 effectsPending 重跑, 守卫幂等且永不抛)——核心本身未加晚 seal 逻辑。
5. **冻结可发生在 winning_side 已写之后**(触发器只禁"冻结之后写值", 不禁"写值之后冻结"): 留作应急停 close_commit 的出口; 设计说"promote→close_commit 之间是不可撤窗"指的是常规流程, DB 层没有把它焊死。若要焊死(写值后禁冻结)是一行触发器, 但会失去应急手段——请定。
6. **verdict 引用要 `pmt_at`** 使批 A 测试夹具需默认给 pmt_at(已改, 批 A 24 例仍全绿)。
7. **pmt 单调基线只在内存**: 重启后第一次有效读数建立基线(设计 SHOULD 票: 基线存放/重启处理), 进程内驱动与 HTTP 受理门共用同一条(`sharedPmtValidator`)。
8. **X10 = 记录在案的等价变异**: `trg_pm_d_frozen_no_winning_side` 里 `OLD.settlement_frozen_at IS NOT NULL OR` 与 `one_way` 触发器 + NEW 半边相互冗余(纵深防御, 单点变异不可见); 未删。K04(从 REQUIRED_DEPS 删 isSettlementFrozen)也是等价变异(第二处类型检查仍拒), 已从脚本移除。
9. 受理门每次判定题下注会向 relay 发一次只读 `get_past_median_time`(量小); 无判定题市场零新增依赖。

## 测试 / 变异
- 新增: `db/proto-settlement-freeze-v213.test.mjs` 13 例、`lib/proto-settlement-budget.test.mjs` 19 例、`lib/proto-bet-intake.test.mjs` 5 例、`api/proto-bet-intake-route.test.mjs` 9 断言(路由接线); 扩展: core 测试(+3 例 30 全绿)、store 测试(+3 例 17 全绿)、service 测试(+1 例 11 全绿)、relay `utxo-facts.test`(P1 改 + P1b, 43 全绿)、批 A 夹具默认 pmt_at(24 全绿)。db / proto 家族 / fresh-db-boot / proto-relay-ipc 全绿。
- 变异 `mutate-batchD.mjs`: **89 变异(源码级 74 + 触发器级 15)88 杀 + 1 等价(X10)**; 首轮 87/90(B24 缺测→补字符串数字/小数 pmt_at 用例、K04 等价移除、X10 等价)已保留 `mutation-raw-round1.keep.txt`。覆盖 N1(pmt_at 计入/排除/引用)、N2(SAFETY 区间 ±1 与动态下界恰等/差 1/拒启)、N3(isFinite / 判定题定义单一来源)、N4(读 pmt 仅判定题 / fail-closed / 不碰 bets)、N5(冻结时钟 pmt vs wall / reason 非空 / 单向 / D2)、N6(upper=GRACE_MIN−1 / =GRACE_MIN / 之间 / 之上)、cutoff / outcome_end / 宽限窗 / 一致性 / 冻结三入口 / 晚 seal / pmt 无效 / frozen 单向 / 受理门 各边界。

## 记票(不在本笔)
- **停摆告警(§5 X/Y/N)**: (a) promote 后 X 分钟未 close_commit landed 且距 refund_flip<Y ⇒ 报警; (b) promote 窗内 pmt 连续读失败 > N tick ⇒ 报警——需 promote 有调用方后才有意义, 随批 B; X/Y/N 进 runbook。
- SHOULD(设计 §8): promote 在单个 BEGIN IMMEDIATE 事务内重读 verdict 再写; pmt 单调基线持久化 / 重启处理; frozen_reason 枚举化(现为 `[a-z0-9_]+|clock=…` 自由串)。
- 冻结/晚 seal 的运维可见性(events 表 / 报警闭集里没登记冻结事件, 现只有日志 `[proto-settlement-freeze] … FROZEN`)——批 B 一起补。
- 批 B 创建入口: 判定题必填 outcome_end_ms + 与 deadline 关系校验(N3 后半)。

## 诚实边界
触发器防应用 / 运维失误与手写 SQL, **不防能 DROP TRIGGER 的机器写权**; 冻结 = 只走 refund(N5b), **refund 执行(refund_flip 广播 + 逐票 reclaim)未接线前, 判定题 / 有价值市场不得上主网**(本批不解决); 本批无 promote 调用方 ⇒ 生产上冻结只会由晚 seal 守卫触发。
