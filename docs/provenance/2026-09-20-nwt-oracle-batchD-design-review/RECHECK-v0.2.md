> **Status**: CURRENT（2026-09-20，NWT；对象 = `docs/2026-09-20-bettor-oracle-batchD-grace-refundflip-budget-design-v0.1.md` v0.2（mainline `5b52fdaf`）；第 2 轮 = MUST-only；D-021：只写设计缺口类别）

# 批 D 设计 v0.2 复核（第 2 轮，MUST-only）

## 结论：**D1–D6 逐条闭合成立（结构上），但 v0.2 的文字里有 6 处「按字面实现会漏/会死」的缺口。** 都是小改；按两轮上限不再开第 3 轮设计审——请把下列 6 条并入设计（v0.3 一笔）**并写进 J2 实现任务的验收项**，我在实现复核里逐条查。

## D1–D6 闭合核对
D1 三入口 fail-closed ✅（另见 N5(a)）。D2 触发器四条 + 谓词同语句 ✅。D3 pmt≥outcome_end ✅（域问题见 N1）。D4 下限/起点/统一 pmt ✅（有效宽限的取值见 N6）。D5 有效性条件 + 告警 ✅（下界见 N2）。D6 outcome_end 门 ✅（范围见 N4、空值见 N3）。

## 6 条 MUST（v0.2 新发现）
**N1 D3/D4 依赖的两个时间量在现有 schema 里不存在，且域不对。** 批 A 的 `proto_market_verdicts.created_at` 是 `TEXT NOT NULL`（墙钟 ISO 文本），无 pmt 列；`consistency_met_at` 无任何存放处（批 D §7 只交付 `settlement_frozen_at`+`frozen_reason`）。v0.2 §1.2 写"verdict.created_at（pmt 域）"——按现有表实现不出来，实现者会拿墙钟文本去比 pmt 毫秒（墙钟比 pmt 快约 2.3 min，方向上偏"过早放行"）。要求：批 D 迁移给 verdicts 加 **`pmt_at INTEGER`**（INSERT 时由 adapter 用有效 pmt 写；批 A 的 append-only 触发器使其之后不可改；为 NULL 的 verdict **不计入** R2 一致性与 promote 引用）；`consistency_met_at` **由 verdict 行确定性推出**（= 使"≥2 独立来源一致"首次成立的那条 verdict 的 `pmt_at`），不另存可变列——重启/重算结果不变。

**N2 `PROMOTION_SAFETY_MS` 下界 5 min 与 `LAG_MAX`=10 min 互相打架。** 合法读数允许本机 pmt 落后墙钟至 10 min（稳态只落后 ≈2.3 min），即本机可比全网 pmt 再慢 ≈7.7 min 而仍判"有效"；若 SAFETY 被 env 调到下界 5 min，本机认为 `pmt < cutoff` 时全网 pmt 可能已越过 deadline+2h，refund_flip 对任何人已开放，此时才 promote 是白写（写一次不可改）。要求：启动校验 **`PROMOTION_SAFETY_MS ≥ LAG_MAX + CLOSE_PIPELINE_MARGIN + 一个 tick`**（即下界抬到 ≥15 min，或把 LAG_MAX 降到 ≤ 5 min 再相应校验），不满足则拒绝启动/回退默认并 LOUD 记日志。

**N3 判定题市场的 `outcome_end_ms` 可为 NULL，且现在没有任何代码路径会写 `proto_markets` 的这一列**（bettor 预测表另有自己的 `outcome_end_date`，不是同一张表）。 `outcome_end_ms` 为可空列、批 A 的 JUDGED 判定（4 列）不含它、`POST /api/proto-markets` 创建路由目前不接受任何判定题字段。若一个判定题市场 `outcome_end_ms IS NULL`：SQL 侧 `pmt >= NULL` 恒不成立（D6 永不拒下注 = 洞）；JS 侧 `pmt >= null` 会被当成 `pmt >= 0` **恒成立**（D3 永远放行 = 过早写死）。要求：D3/D6 的比较用显式 `Number.isFinite(outcome_end_ms)` 判空——**判定题 ∧ 空 ⇒ 拒 promote、拒下注、记原因**（fail-closed）；"判定题"判定复用批 A 的 JUDGED 那一个定义（别在 D6 另写一份"resolution_rule_spec/outcome_* 任一"）；建市场入口对判定题必须要求 `outcome_end_ms`（批 B 接线时），并加一条 `outcome_end_ms` 与 `deadline_ms` 的关系校验。

**N4 D6 里的 "append" 不能是"驱动把已受理的注上链"。** 若把驱动的链上 append 步骤也在 `pmt ≥ outcome_end` 后拒绝，则在 outcome_end 之前已受理、但尚未上链的注会永远上不了链→市场凑不满 `seal_count`→永不 seal→oracle 无法 promote，注款只能等 refund。要求写明：**门放在下注受理点（HTTP bet 路由、受理时刻的 pmt）**，驱动对已受理注的 append 不受影响；且**判定题市场受理时 pmt 无效/读不到 ⇒ 拒绝受理（fail-closed）**。

**N5 冻结语义两处会自相矛盾/fail-open。** (a) `settlement_frozen_at` 以 pmt 域写入且"NULL=未冻"：若冻结动作依赖一个有效 pmt 读数，则**恰在 pmt 不可用时**（节点未同步/重启）冻结写不进去 ⇒ 冻结在最需要时 fail-open。要求：**冻结写入永不依赖 pmt 有效性**——有效 pmt 用 pmt，否则退回墙钟毫秒，并在 `frozen_reason` 里标 `clock=wall`；`frozen_reason` 冻结时必非空且随 D2 触发器一并不可改。 (b) §1/§4 写"冻结/人工"、"走 operator/人工"，但 D2 已令冻结市场的 `winning_side` 写入一律 ABORT、批 A 也禁 `operator` 写判定题市场——**冻结的判定题市场唯一出口是 refund_flip**，不存在"人工 resolve"。请删掉"operator/人工"措辞，改写成"冻结 ⇒ 只走 refund"，并显式挂钩 batch 9 的 R5：refund 执行（refund_flip 广播 + ticket reclaim）未接线之前，冻结市场的资金无自动出口，故 **B-promote 与批 D 不得对有价值市场上主网**（与既有"oracle 路径零价值/simnet only"一致，写进批 D §7 的上线前置）。

**N6 有效宽限的取值没写。** §1.4 用 `GRACE_MS`（默认 30 min），§2 另定"有效上界 = cutoff − consistency_met_at − 120 s"和下限 5 min，但没说二者怎么合成：上界落在 [5 min, 30 min) 时，按 §1.4 字面永不满足 `consistency_met_at + 30min ≤ pmt < cutoff`⇒ 该区间的市场被静默一律冻结（可接受的方向，但实现者可能各自"夹一下"）。要求写成一个式子：**`effective_grace = min(GRACE_MS, 有效上界)`；`有效上界 < GRACE_MIN` ⇒ 晚 seal 冻结；否则 promote 当且仅当 `consistency_met_at + effective_grace ≤ pmt < cutoff`**，并加边界测试（上界 = GRACE_MIN−1/=GRACE_MIN/在两者之间）。

## SHOULD（记票，不阻塞）
1. promote 在单个 `BEGIN IMMEDIATE` 事务里重读 verdict 再写（关掉 R2 检查→写入之间的异议 TOCTOU；被冻结兜底所以不是 MUST，但冻结晚于 close_commit prepared 即失效）。 2. pmt「与上次读数单调」的基线存哪（进程内则重启后无基线）。 3. `frozen_reason` 取值枚举化。

## 我没做
只有设计文本，没有实现；本轮复核为文本 + 对 `migrate.js`（mainline）与 `api/proto.js` 的字段/路由事实核对。
