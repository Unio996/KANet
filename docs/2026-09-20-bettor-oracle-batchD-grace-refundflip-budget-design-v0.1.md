> **Status**: CURRENT (v0.2 · 2026-09-20 据 NWT 红队 3d3bbe30 修 D1–D6 · 待 NWT MUST-only 复核)

# oracle 整合 批 D 设计 v0.2：宽限窗 + 2h refund_flip 预算 + 冻结 + outcome_end 门 + 晚 seal 守卫

- 属主设计:oracle 整合 v0.2 §5/§7/§10 R3。**批 D 必先于批 B**;批 A 已合(3589baa2)。
- 依据:J2 时序 facts + NWT 红队 D1–D6(3d3bbe30)+ NWT 主网 pmt 采样。不动 live;实现后 simnet 端到端再上主网。

## 0. 时序 facts(已核)
- **refund_flip** pmt ≥ deadline+7,200,000,任何人无签名可广播。**close_commit** pmt ≥ deadline+30s。**seal** 由注数==seal_count 触发(与 deadline 无关,可 pre-deadline);winning_side 需 status='sealed'(可 pre-deadline 写)。唯一 post-deadline = close_commit。
- **pmt 落后墙钟**(NWT 85 样本/253s:min 133.2 / 中位 141.0 / p90 145.6 / max 149.4s,极差 16s,全程 isSynced、单调、按块批跳变;J2 simnet 139s 吻合)。稳态极稳,**风险在节点落后/未同步/重启,不在抖动**。
- 每步 20–40s(瓶颈 tick 粒度);写值→close_commit landed 实测 ~30s。

## 1. promote 门（写 winning_side 的全部前置,批 D 核心）
promote(verdict→winning_side)当且仅当**全部成立**:
1. 市场 `status='sealed'` ∧ `winning_side IS NULL` ∧ `settlement_frozen_at IS NULL`(同一 UPDATE 谓词,D2)。
2. **结果已知(D3)**:`pmt ≥ outcome_end_ms` ∧ 被引用 verdict 的 `created_at`(pmt 域)`≥ outcome_end_ms`。防结果未出就写死。
3. **未过 cutoff(D1/D5)**:`pmt < promotion_cutoff_pmt = deadline_ms + 7,200,000 − PROMOTION_SAFETY_MS`。
4. **宽限窗已过(D4)**:`consistency_met_at + GRACE_MS ≤ pmt`,起点 = 满足 R2 一致性(≥2 独立来源一致)那一刻,**不是第一条 verdict**。
5. **R2 一致(§B-promote)**:≥2 独立来源 extractor/uma verdict 一致;窗内出现任一不一致 verdict 或 `outcome IS NULL`(弃权/异议)⇒ **冻结**,不 promote。
6. **R5 胜方可结算预检**:胜方侧恰 1 确认注 ∧ 奖池>0,否则冻结/人工。
不满足 3/4/6 或过 cutoff ⇒ 落 §3 冻结/人工。**所有时间统一按 pmt 域**(D4);pmt 有效性见 §5。

## 2. 常量（D5 校准,env 可覆盖带上下界）
- **PROMOTION_SAFETY_MS = 1,200,000(20min)**,校验区间 [5min, 60min]。⇒ `promotion_cutoff = deadline + 7,200,000 − 1,200,000`(deadline+100min,pmt 域)。
- **GRACE_MS 默认 1,800,000(30min)**,**下限 GRACE_MIN=300,000(5min)**;**有效上界 = promotion_cutoff_pmt − consistency_met_at − CLOSE_PIPELINE_MARGIN(120s)**;若有效上界 < GRACE_MIN ⇒ 视同晚 seal(§4)直接冻结/人工。
- **LAG_MAX = 600,000(10min)** 用于 pmt 有效性(§5)。

## 3. 冻结 settlement_frozen_at（D1+D2）
- 新列 `settlement_frozen_at INTEGER`(pmt 域,NULL=未冻)+ `frozen_reason TEXT`。
- **DB 约束(D2,批 A 同级触发器,放批 D 迁移)**:BEFORE INSERT NEW.settlement_frozen_at 必 NULL;BEFORE UPDATE 单向(OLD 非空 ⇒ 拒改/拒清空);**BEFORE UPDATE OF winning_side:OLD.settlement_frozen_at 非空 ⇒ ABORT**;promote 的 UPDATE 谓词同语句带 `settlement_frozen_at IS NULL AND winning_side IS NULL AND status='sealed'`,`changes==0` 视为已判定/已冻。
- **冻结 TOCTOU 堵所有 close_commit 入口(D1,fail-closed)**:① listWork 选行加 `settlement_frozen_at IS NULL`;② `store.dependenciesLanded('close_commit')` 再读一次冻结列;③ 核心广播前闸(pmt 门旁)再读一次。**三处任一为冻结即拒发**。写明:**已 prepared 的 close_commit 意图不受冻结影响 ⇒ 冻结必须早于该市场第一个进 close_commit 的 tick**(冻结应在 promote 前发生,promote 与 close_commit 之间才是不可撤窗)。
- 冻结触发:R2 不一致/弃权、R5 预检失败、过 cutoff、晚 seal(§4)、委员异议/人工 flag。

## 4. 晚 seal 守卫（缺口 a,D4 边界）
- seal landed 时若 `pmt ≥ promotion_cutoff_pmt`(或有效宽限上界 < GRACE_MIN):**不走 oracle 宽限/自动 promote**,直接 `settlement_frozen_at` + frozen_reason='late_seal',走 operator/人工;adapter 只登记 verdict 供审计不 promote。seal 跨 cutoff 的边界案例加测试(D 复核④)。

## 5. pmt 有效性 + 停摆告警（D5）
- **pmt 读数有效当且仅当**:`isSynced===true` ∧ `|墙钟 − pmt| ≤ LAG_MAX(10min)` ∧ 与上次读数单调不减;否则按**读失败**处理(promote 推迟)。读失败方向安全(推到 cutoff、过 cutoff 一律冻结),**不靠 SAFETY 常数盖**。
- **SAFETY 真正保护 promote 之后的流水线停摆**(重启 / no_suitable_fee_utxo / relay 健康门拒),用**告警**覆盖:(a) promote 后 X 分钟未 close_commit landed 且距 refund_flip < Y ⇒ 报警;(b) promote 窗内 pmt 连续读失败 > N tick ⇒ 报警。X/Y/N 取值随 SAFETY/tick 定,进 runbook。

## 6. 下注端点 outcome_end 门（D6,B-promote 上线前置）
- POST /api/proto-markets/:id/bet 与 append 现只查 status==='betting'。**判定题市场**(有 resolution_rule_spec/outcome_* 任一)在 `pmt ≥ outcome_end_ms` 后**拒绝下注/append**(防结果已知后下注选赢侧,与晚 seal 抢跑同根)。**无判定题的 operator 市场不受此约束**。此条是 **B-promote 上线前置**。

## 7. 批 D 交付范围
- schema:`settlement_frozen_at` + `frozen_reason` 列 + 其 DB 约束触发器(D2)。
- 常量:PROMOTION_SAFETY_MS=1.2e6[5–60min]、GRACE_MS=1.8e6 默认 / GRACE_MIN=3e5、LAG_MAX=6e5、CLOSE_PIPELINE_MARGIN=1.2e5。
- 驱动侧:promote 门六前置(§1)、pmt 有效性(§5)、close_commit 冻结三入口 fail-closed(§3)、晚 seal 守卫(§4)、停摆告警(§5)。
- 下注端点 outcome_end 门(§6,B-promote 前置)。
- **不含**:verdict 计算/写入与实际 promote 写值动作(批 B);本批是给批 B 铺好时间/冻结/预算/结果已知的闸。
- 测试+变异:cutoff 前后、outcome_end 前后、宽限窗未到/到、一致性未满/满、窗内不一致/弃权→冻结、冻结堵三入口、晚 seal 直接冻结、pmt 无效(未同步/超滞后/非单调)、frozen 单向不可撤、winning_side 在冻结市场 ABORT、下注 outcome_end 门。

## 8. D1–D6 闭合对照
- D1 冻结 TOCTOU → §3 三入口 fail-closed + "冻结须早于第一个 close_commit tick"。
- D2 冻结列 DB 约束 → §3 触发器(单向/INSERT NULL/winning_side 冻结时 ABORT/promote 谓词带 frozen)+ frozen_reason + pmt 时间域。
- D3 结果已知 → §1.2 promote 加 pmt≥outcome_end_ms ∧ verdict.created_at≥outcome_end_ms。
- D4 GRACE 下限/起点/一致性/时间域 → §1.4/§2/§1.5,统一 pmt 域,起点=一致性满足时刻,窗内不一致/弃权→冻结。
- D5 pmt 有效性 + SAFETY 重定位 + 告警 → §5,SAFETY=20min[5–60],读失败方向安全,停摆靠告警。
- D6 下注 outcome_end 门 → §6,B-promote 前置,operator 市场豁免。
