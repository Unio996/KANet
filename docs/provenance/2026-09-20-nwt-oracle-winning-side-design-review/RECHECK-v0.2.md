> **Status**: CURRENT（2026-09-20，NWT；对象 = 设计 v0.2（主线 `533c3fa6`）；Bettor 令：复核一轮、不重审全稿；D-021：只写设计缺口类别）

# oracle→`winning_side` 设计 v0.2 复核 —— NWT

## 结论：**GREEN（带条件）——6 条 MUST 的原则都接住了，可以派批 A；但正文有 5 处"写进去才算数"的小缺口（R1–R5），请并进批 A / 批 D / B-promote 的验收，不需要再出一版设计。**

## 6 条 MUST 的复核
| # | 结论 | 说明 |
|---|---|---|
| M1 DB 层 write-once | ✅ 原则闭合，**触发器覆盖面要补**（R1） | 写后永不改、值∈{0,1}、status=sealed、oracle 题市场禁 operator 直写、引用不可改的判定表——都对 |
| M2 时间预算 / 不自相矛盾 | ✅ 闭合，**补两个数**（R3） | "写后永不改；争议⇒冻结、走自然 refund_flip"消除了矛盾；`deadline_ms ≥ outcome_end_ms + 预算` 把投票和宽限窗放在 deadline 之前，deadline 后的 2h 全留给 close_commit——这个结构是对的（§5 里"outcome_end→landed 必须 <2h"的说法比实际约束更紧，无害） |
| M3 AI 不直写钱路 | ✅ 闭合，**补自动提升的判据**（R2） | 两段式 + 纯 LLM 只做 proposal |
| M4 白名单 / 诚实标注 | ✅ 闭合，**"不可改"要落到机制**（R4） | §8 的"单运营方裁决机"标注很好 |
| M5 终局与预检 | ✅ 闭合，**补一条上线门**（R5） | 提升前"胜方恰 1 确认注 ∧ 奖池>0"预检对；封盘后确认下注集合不再变，预检稳定 |
| M6 `outcome_end_ms` | ✅ 闭合 | 建市场校验 + voter 不早投 |

## R1–R5（小 MUST，文字/验收层面）
**R1 触发器覆盖面 + 列定义**：① 只有 `BEFORE UPDATE OF winning_side` 约不到 **`INSERT`（新行直接带 winning_side）、`INSERT OR REPLACE`（先删后插绕过 UPDATE 触发器）、`DELETE`**——同样加 `BEFORE INSERT`（`NEW.winning_side` 必须 NULL）与 `BEFORE DELETE`（已有 winning_side 或已有下注/意图的市场拒删）。② v0.1 里的审计列 `winning_side_source / _set_at / _set_by` 在 v0.2 §3.1 里**消失了**，而 §5、§7 都在用 `winning_side_set_at`；请在 §3.1 明确列出 `winning_side_source`、`winning_side_set_at`、`winning_side_verdict_id`。③ "oracle 题市场禁 operator 直写"和"winning_side 引用判定记录"目前写在 adapter 层（§3.2）——operator 手写 SQL 不经过 adapter，所以**必须写进触发器**：`source='operator'` 且该市场有判定题 ⇒ ABORT；`source ∈ {extractor,uma,human}` 必须存在 `verdict_id` 指向同市场同值的判定记录。④ 一句诚实的话：触发器防的是应用 bug 和运维失误；**能写库的人仍可 `DROP TRIGGER` / 伪造 verdict 行**，所以 human 路径的写入口要经带鉴权的接口并留审计，别把触发器当成对恶意 DB 写者的防线。

**R2 自动提升的判据缺了"多源/多数"**：v0.1 有"data_source_canonical 与 secondary 交叉 + 委员会全票"，v0.2 把提升条件写成"确定性抽取器报告 final"——单个数据源的一次故障或被投毒就直接自动动钱。请把提升前提写全：**至少 2 个独立来源的抽取结果一致（canonical + secondary），且全部 `extractor/uma` 类 verdict 一致**；任一不一致 ⇒ 不提升、进人工/退款。

**R3 两个缺的数**：① **提升截止时刻**：`promotion_cutoff ≤ deadline_ms + 7,200,000 − 宽限窗 − close_commit 落链余量`，晚于它的判定**不提升**（否则出现"winning_side 已写、市场却已被翻成退款"的不一致态）；宽限窗 N 请给具体公式/取值范围，不要停在"Owner 定"。② **冻结（争议）状态**存哪：加 `settlement_frozen_at`（或 dispute 表），并在 `listWork` 的 close_commit 触发条件里同时检查；否则"争议⇒冻结"没有落点。

**R4 不可改要落成机制**：`outcome_oracle_relay_ids`、`resolution_rule_spec`、`outcome_market_source/condition_id`、`outcome_end_ms`（以及被抓取源引用的 `question`）——**在市场出现第一笔下注/genesis 落链后一律不可 UPDATE**（触发器），否则"建后不可改"只是口头约定，运营可以在下注后改题面/裁判。

**R5 一条上线门**：设计已如实写明"退款侧 claim/withdraw 后续批接线"，但还要写清一件事——**"自然 refund_flip"不是自动发生的**：需要有人广播 refund_flip 交易并且逐张票据 reclaim，批 9 驱动只探测不执行。所以：**在"退款执行批"落地之前，oracle 判定路径只允许用于零价值/simnet 市场**；真值市场启用它须以退款执行批为前置，并在 runbook 写明弃权/争议终局 = 人工执行 refund_flip + reclaim。

## SHOULD（记票）
1. 文稿里 v0.1 的 §4 五条表述被 M1–M6 映射替换，**第 5 条"`assertCloseCommitArgsFromDb` 与 builder 同源于同一列，'独立'只指驱动入参==DB 派生值、不验证判定值本身"的说法没有出现在 v0.2 里**（你回复里说改了，但文件里 grep 不到）——请补回去，别让后来人把它当成判定值的第二道防线。 2. 人工确认写入口的鉴权/双人复核。 3. 批 A 的 `winning_side_set_at` 建议用节点 `pastMedianTime` 口径。

## 批次
采纳的顺序 A→D→B-shadow→simnet→B-promote→C 我认可。建议把 **R1、R4 并进批 A 的验收**（触发器全覆盖 + 不可改触发器 + 列定义），**R3 并进批 D**，**R2、R5 并进 B-promote 的上线前置**。我在批 A 出 diff 时按这些项逐条变异（删触发器分支 / 绕过 REPLACE / 改题面后再写值等）。
