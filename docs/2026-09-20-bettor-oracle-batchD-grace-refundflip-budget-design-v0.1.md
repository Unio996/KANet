> **Status**: CURRENT (v0.1 · 待 NWT 红队)

# oracle 整合 批 D 设计 v0.1：宽限窗 + 2h refund_flip 预算 + 冻结 + 晚 seal 守卫

- 属主设计:`docs/2026-09-20-bettor-oracle-to-proto-winning-side-integration-design-v0.1.md`(v0.2)§5/§7/§10 R3 的落地数与机制。
- 排序:**批 D 必先于批 B(adapter 写值)**(NWT 定);批 A 已合(3589baa2)。
- 依据:J2 时序 facts(2026-09-20,标注 代码/实测/推算)。不动 live;实现后 simnet 端到端(含争议/超时/退款)再上主网。

## 0. J2 时序 facts(设计前提,已核)
- **refund_flip**:RootClose.sil:166 `tx.time ≥ temporal(deadline_ms + 7,200,000)` + `closed==0`,**无签名、任何人可广播**;按 **pmt**(非墙钟)。
- **close_commit**:`tx.time ≥ temporal(deadline_ms)`,驱动门加 30s ⇒ **pmt ≥ deadline+30s**。
- **seal**:由"确认注数 == seal_count(现固定 2)"触发,**与 deadline 无关**,可远早于 deadline;seal 后 status='sealed'、拒新注。⇒ **winning_side(需 sealed)可在 deadline 前写**(诚实 oracle 不会,因结果未知);唯一 post-deadline 是 close_commit。
- **pmt 落后墙钟 ~139s**(单 25s 窗,与旧注释 ~133s 吻合);区块率 ~11/s;landed 判定要 REORG_SAFE_MIN_DEPTH=20 深(~2s),**每步瓶颈=tick 粒度**(现 20s),每步 20–40s;写值→close_commit landed **实测 ~30s**。
- 距 refund_flip 墙钟余量 ≈ 2h − ~4min ≈ **116min**。
- ⚠️ 两缺口:(a) **晚 seal**——下注端点/append 不检查 deadline(a59c 是 deadline 后 5 天补第二注→seal 在 deadline 后→refund_flip 一 seal 即开放,宽限=0);(b) **不足 seal_count 的市场永不 seal**(无 RootClose/无 refund_flip,oracle 不适用,ticket_reclaim 未接线)。

## 1. promotion_cutoff（写 winning_side 的最晚时刻,按 pmt）
- `promotion_cutoff_pmt = deadline_ms + 7,200,000 − PROMOTION_SAFETY_MS`,**PROMOTION_SAFETY_MS = 600,000(10min)**(盖:2 tick 失手 + 一次 relay/console 重启 + 节点抖动 + pmt 读失败 fail-closed 顺延;远大于实测 30s 流水线)。
- **promote(verdict→winning_side)前必须 `节点当前 pmt < promotion_cutoff_pmt`**;否则**不写值**、转 §3 冻结/人工(防"winning_side 已写但已被 refund_flip 翻退款"的不一致态)。按 pmt 判(pmt 落后墙钟 ~139s 对我们有利,不吃进预算)。
- 诚实:PROMOTION_SAFETY_MS 是保守常数,不是精确预算;pmt 读失败连续顺延无自动放行上限(安全方向拖延),10min 余量覆盖它、超了就落 §3。

## 2. 宽限窗 GRACE_MS（verdict 落表 → promote 之间的争议期）
- verdict 行随时可写(verdicts 表无 status 约束);**promote 需 (市场 sealed) ∧ (verdict_written_at + GRACE_MS ≤ now) ∧ (pmt < promotion_cutoff) ∧ (未冻结) ∧ (胜方侧恰 1 确认注 ∧ 奖池>0,R5 预检)**。
- **GRACE_MS 默认 1,800,000(30min)**,硬上界 = `promotion_cutoff_pmt − verdict_written_at 对应墙钟 − 写值到 close_commit landed 余量(取 120s 保守=2 tick+深度)`;放不下则该市场宽限窗压缩到上界、上界<0 则拒 promote 走 §3。
- 正常市场(outcome_end 早于 deadline):宽限窗落在 outcome_end→deadline 之间,对 post-deadline 预算**零占用**。

## 3. 冻结与终局
- 新列 `proto_markets.settlement_frozen_at`(INTEGER pmt/ts,NULL=未冻);触发条件:委员异议 / 人工 flag / promote 前预检失败(胜方侧非恰 1 注或奖池 0)/ 过 promotion_cutoff。
- **listWork 的 close_commit 触发条件加 `settlement_frozen_at IS NULL`**(冻结市场不建 close_commit)。winning_side 一经写入永不改(批 A 触发器);冻结市场不写 winning_side。
- **终局 = 自然 refund_flip(deadline+2h)**:R5——需有人广播 refund_flip + 逐票 reclaim,批 9 只探测不执行 ⇒ **退款执行批落地前,oracle 判定路径仅零价值/simnet 市场**;runbook 写明冻结/弃权终局 = 人工执行 refund_flip+reclaim。

## 4. 晚 seal 守卫（缺口 a）
- seal landed 时若 `pmt ≥ deadline_ms + 7,200,000 − PROMOTION_SAFETY_MS`(refund_flip 已开放或将开放、宽限窗 ≤0):**该市场不走 oracle 宽限/自动 promote**,直接标 settlement_frozen_at 走 operator/人工(立即写值立即 close 或人工退款);设计写死,不给自动路径。
- adapter 扫描时对这类市场只登记 verdict(供审计)、不 promote。

## 5. 不足 seal_count 市场（缺口 b）
- 永不 seal ⇒ 无 winning_side 写入点、无 RootClose/refund_flip。oracle 路径不适用。终局需 ticket_reclaim(未接线)——**本批不解决,runbook 记为已知未接线项**;建市场侧可选加"到期未满 seal_count 自动 cancel + 退款"设计票(另立)。

## 6. 批 D 交付范围
- schema:`proto_markets.settlement_frozen_at` 列(+ 批 A 已有 winning_side_set_at)。
- 常量:PROMOTION_SAFETY_MS=600,000、GRACE_MS 默认 1,800,000(env 可覆盖,带上界校验)。
- 逻辑(驱动侧 proto-settlement store/core):promote 前置五条(§2)+ promotion_cutoff 检查(§1)+ 晚 seal 守卫(§4)+ close_commit listWork 加 `settlement_frozen_at IS NULL`(§3)。
- **本批只加"何时/是否 promote 与是否 close_commit"的门,不含 adapter 的 verdict 计算/写入(批 B)、不含实际 promote 写值动作(批 B)**——批 D 是给批 B 铺好时间/冻结/预算的闸。
- 测试:promotion_cutoff 边界(cutoff 前/后)、宽限窗未到/到、冻结跳过 close_commit、晚 seal 直接冻结、pmt 读失败顺延、与批 A 触发器/既有 close_commit pmt 门不冲突;变异覆盖每个谓词。

## 7. 待 NWT 红队
重点:promotion_cutoff 公式与 PROMOTION_SAFETY_MS 取值是否够(尤其 pmt 读失败无上限顺延)、GRACE_MS 上界公式、冻结列检查点是否堵住所有 close_commit 路径、晚 seal 阈值、与 M2"winning_side 写后永不改"及批 A 触发器自洽、pmt 单点采样的风险。
