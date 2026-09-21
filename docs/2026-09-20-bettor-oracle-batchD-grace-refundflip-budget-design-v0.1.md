> **Status**: CURRENT (v0.3 · 2026-09-20 据 NWT 复核 b6ed32e9 并入 N1–N6 · 设计审两轮已满,N1–N6 转 J2 实现验收项,NWT 实现复核逐条查)
> ⚠ **判据被 1614 F2 取代(2026-09-21)**:下文「宽限窗」「常量」「晚 seal 守卫」各节与 N6 中的 `effective_grace = min(GRACE_MS, effective_upper)` 与 `effective_upper < GRACE_MIN ⇒ 晚 seal 冻结` 已改为 `effective_upper < GRACE_MS ⇒ 冻结、不压缩宽限`(GRACE_MIN 只作配置校验);**以 `kasia-console/src/lib/proto-settlement-budget.mjs` 为准**,本文正文不动。

# oracle 整合 批 D 设计 v0.3：宽限窗 + 2h refund_flip 预算 + 冻结 + outcome_end 门 + 晚 seal 守卫

- 属主设计:oracle 整合 v0.2 §5/§7/§10 R3。**批 D 必先于批 B**;批 A 已合(3589baa2)。
- 依据:J2 时序 facts + NWT 红队 D1–D6(3d3bbe30)+ 复核 N1–N6(b6ed32e9)+ NWT 主网 pmt 85 样本。不动 live;实现后 simnet 端到端再上主网。

## 0. 时序 facts(已核)
- **refund_flip** pmt ≥ deadline+7,200,000,任何人无签名。**close_commit** pmt ≥ deadline+30s。**seal** 由注数==seal_count 触发(与 deadline 无关)。winning_side 需 sealed(可 pre-deadline)。唯一 post-deadline = close_commit。
- **pmt 落后墙钟**:NWT 85 样本 min133.2/中位141.0/p90145.6/max149.4s(极差 16s,全程 isSynced 单调)。稳态极稳,**风险在未同步/落后/重启**。每步 20–40s(瓶颈 tick);写值→close_commit landed ~30s。

## 1. promote 门（批 D 核心;全部按 pmt 域,pmt 有效性见 §5）
promote(verdict→winning_side)当且仅当**全部成立**:
1. `status='sealed'` ∧ `winning_side IS NULL` ∧ `settlement_frozen_at IS NULL`(同一 UPDATE 谓词,D2)。
2. **结果已知(D3+N3)**:`outcome_end_ms` 为**有限数**(`Number.isFinite`;判定题∧空 ⇒ 拒 promote+记因,见 N3)∧ `pmt ≥ outcome_end_ms` ∧ 被引用 verdict 的 **`pmt_at ≥ outcome_end_ms`**(N1:pmt_at 是新列,非墙钟 created_at)。
3. **未过 cutoff**:`pmt < promotion_cutoff_pmt = deadline_ms + 7,200,000 − PROMOTION_SAFETY_MS`。
4. **宽限窗(D4+N6)**:`consistency_met_at + effective_grace ≤ pmt < promotion_cutoff_pmt`,其中 **`effective_grace = min(GRACE_MS, effective_upper)`**;`effective_upper = promotion_cutoff_pmt − consistency_met_at − CLOSE_PIPELINE_MARGIN`;**`effective_upper < GRACE_MIN` ⇒ 晚 seal 处置(§4)冻结**。`consistency_met_at`(N1)= 使"≥2 独立来源一致"首次成立的那条 verdict 的 **pmt_at**,由 verdict 行**确定性推出、不另存可变列**。
5. **R2 一致**:≥2 独立来源(extractor/uma)一致;窗内任一不一致 verdict 或 `outcome IS NULL`(弃权/异议)⇒ 冻结。仅 `pmt_at` 非 NULL 的 verdict 计入一致性与被引用。
6. **R5 预检**:胜方侧恰 1 确认注 ∧ 奖池>0,否则冻结。
不满足 ⇒ §3 冻结。

## 2. 常量（N2 校准,env 可覆盖带启动校验）
- **PROMOTION_SAFETY_MS = 1,200,000(20min)**,**启动校验 SAFETY ≥ LAG_MAX + CLOSE_PIPELINE_MARGIN + 一个 tick**(⇒ 下界 ≥ 900,000/15min);不满足 ⇒ 拒启动或回默认 + LOUD 记日志(N2:防本机 pmt 落后 LAG_MAX 时 SAFETY 太小导致 promote 白写)。有效区间 [15min, 60min]。
- **GRACE_MS 默认 1,800,000(30min)**;**GRACE_MIN = 300,000(5min)**;`effective_grace = min(GRACE_MS, effective_upper)`(§1.4,N6)。
- **LAG_MAX = 600,000(10min)**;**CLOSE_PIPELINE_MARGIN = 120,000(2min)**。

## 3. 冻结 settlement_frozen_at（D1+D2+N5）
- 列 `settlement_frozen_at INTEGER` + `frozen_reason TEXT`(**冻结时必非空**,N5a)。
- **冻结写入不依赖 pmt 有效性(N5a)**:pmt 有效则写 pmt、否则退回墙钟毫秒并 `frozen_reason` 标 `clock=wall`(防未同步/重启时冻结写不进的 fail-open)。
- **DB 约束(D2,批 A 同级触发器,批 D 迁移)**:BEFORE INSERT NEW.settlement_frozen_at 必 NULL;BEFORE UPDATE 单向(OLD 非空 ⇒ 拒改/清空)+ frozen_reason 随之不可改;**BEFORE UPDATE OF winning_side:OLD.settlement_frozen_at 非空 ⇒ ABORT**;promote UPDATE 谓词同语句带 `settlement_frozen_at IS NULL AND winning_side IS NULL AND status='sealed'`。
- **冻结 TOCTOU 三入口 fail-closed(D1)**:① listWork 选行 `settlement_frozen_at IS NULL`;② `store.dependenciesLanded('close_commit')` 重读冻结列;③ 核心广播前闸(pmt 门旁)重读。任一为冻结即拒发。**已 prepared 的 close_commit 不受冻结影响 ⇒ 冻结必须早于该市场第一个进 close_commit 的 tick**(冻结发生在 promote 前;promote→close_commit 之间是不可撤窗)。
- **冻结终局 = 只走 refund(N5b)**:D2 令冻结市场 winning_side 写入 ABORT + 批 A 禁 operator 写判定题市场 ⇒ **冻结判定题市场无"人工 resolve"出口,唯一出口 = 自然 refund_flip**。删除 v0.2 "走 operator/人工"措辞。挂钩 R5:refund 执行(refund_flip 广播 + ticket reclaim)未接线前,**有价值市场不得上主网**(§7 上线前置)。

## 4. 晚 seal 守卫（D4 边界）
seal landed 时若 `effective_upper < GRACE_MIN`(等价 pmt 已逼近/越 cutoff):置 `settlement_frozen_at`(N5a 时钟规则)+ `frozen_reason='late_seal'`,只走 refund;adapter 只登记 verdict 供审计。seal 跨 cutoff 边界加测试。

## 5. pmt 有效性 + 停摆告警（D5）
- **pmt 有效当且仅当** `isSynced===true` ∧ `|墙钟 − pmt| ≤ LAG_MAX(10min)` ∧ 与上次单调不减;否则读失败(promote 推迟;过 cutoff 一律冻结,方向安全)。**冻结写入不受此限**(§3,N5a)。
- **SAFETY 保护 promote 后流水线停摆**(重启/no_suitable_fee_utxo/relay 健康门拒),靠告警覆盖:(a) promote 后 X 分钟未 close_commit landed 且距 refund_flip<Y ⇒ 报警;(b) promote 窗内 pmt 连续读失败 > N tick ⇒ 报警。X/Y/N 进 runbook。

## 6. 下注 outcome_end 门（D6+N3+N4,B-promote 上线前置)
- 门放在**下注受理点**(HTTP bet 路由,受理时刻 pmt),**不是驱动对已受理注的 append**(N4:否则 outcome_end 前已受理未上链的注永上不了链→永不 seal→只能退款)。
- **判定题**(复用批 A `JUDGED` 定义,N3 不另写一份)且 `Number.isFinite(outcome_end_ms)` 且 `pmt ≥ outcome_end_ms` ⇒ **拒受理下注/append**;判定题受理时 **pmt 无效/读不到 ⇒ 拒受理(fail-closed,N4)**;判定题 ∧ outcome_end_ms 空 ⇒ 拒受理 + 记因(N3)。**无判定题 operator 市场豁免**。

## 7. 批 D 交付范围 + 上线前置
- schema:`settlement_frozen_at` + `frozen_reason`(+DB 约束触发器 D2/N5)、`proto_market_verdicts.pmt_at INTEGER`(INSERT 写、批 A append-only 保不可改、NULL 不计一致性/不可被引用,N1)。
- 常量(§2)+ 启动校验(N2)。
- 驱动侧:promote 六前置(§1)、pmt 有效性(§5)、close_commit 冻结三入口(§3)、晚 seal(§4)、停摆告警(§5)。
- 下注端点受理点 outcome_end 门(§6)。
- **上线前置(N5b)**:refund 执行(refund_flip+reclaim)未接线前,**批 D/B-promote 不得对有价值市场上主网**;仅零价值/simnet;runbook 写明冻结/弃权终局 = 待 refund 执行批。
- **不含**:verdict 计算/写入与实际 promote 写值(批 B)。批 D 是给批 B 铺时间/冻结/预算/结果已知的闸。
- 测试+变异:见 §8 各 N 边界 + D1–D6 原项。

## 8. N1–N6 闭合(转 J2 实现验收项,NWT 实现复核逐条查)
- **N1** verdicts 加 `pmt_at`(INSERT 写、不可改、NULL 排除);`consistency_met_at` 由行推(首次≥2 源一致那条的 pmt_at),不存可变列。
- **N2** SAFETY 启动校验 ≥ LAG_MAX+MARGIN+tick(下界 15min),违则拒启/回默认+LOUD。
- **N3** `Number.isFinite(outcome_end_ms)`;判定题∧空 ⇒ 拒 promote+拒受理下注+记因;判定题复用批 A JUDGED 定义;批 B 创建入口对判定题必填 outcome_end_ms + 与 deadline 关系校验。
- **N4** D6 门在受理点,驱动 append 已受理注不受影响;判定题受理时 pmt 无效 ⇒ 拒受理。
- **N5** (a) 冻结写入不依赖 pmt(退墙钟+标 clock=wall)、frozen_reason 必非空且不可改;(b) 冻结 ⇒ 只走 refund(无人工 resolve),挂 R5 上线前置。
- **N6** `effective_grace=min(GRACE_MS, effective_upper)`;`effective_upper<GRACE_MIN` ⇒ 晚 seal 冻结;promote iff `consistency_met_at+effective_grace ≤ pmt < cutoff`;边界测试(上界=GRACE_MIN−1/=GRACE_MIN/之间)。
- SHOULD(记票):promote 在单个 BEGIN IMMEDIATE 事务内重读 verdict 再写;pmt 单调基线存放(重启后无基线的处理);frozen_reason 枚举化。
