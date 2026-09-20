> **Status**: CURRENT (v0.2 · 2026-09-20 据 NWT 红队审 66ebadc6 修订 6 条 MUST · 待 NWT 复核一轮)

# oracle → proto_markets.winning_side 整合设计 v0.2（复用现有 oracle 决策引擎，不造新轮子）

- 出处：Owner 2026-09-20「整合现有 oracle 系统写 winning_side，千万不要新造轮子。检查、评估、整合、迭代」。
- 依据：oracle 现状 Explore 报告 + NWT 红队审 v0.1（66ebadc6，6 MUST）+ D-030 TypeSafe。
- 排序：D-029 主网首轮（受控判定，已跑通 1602）之后；本设计走既有门：Bettor 设计 → NWT 红队 → 实现（分批）→ NWT 审 diff → 合入 → 迭代。

## 0. 一句话
现有 oracle 决策引擎（委员会、已知源证据抽取、UMA 镜像、ABSTAIN-not-guess）成熟且为老市场在跑，但**结构上看不见 proto_markets**，且主网现无可用 oracle 池。整合 = **两段式**：oracle/引擎只写**追加式判定表 proto_market_verdicts（proposal/vote）**，再经**确定性来源或人工确认**提升为 `winning_side`（DB 层强制 write-once、永不改）；复用引擎，不重写；**AI 只产 proposal、绝不直写钱路列**。

## 1. 复用什么（现成，不动内核）
委员会 Path、`deriveVote` 已知源抽取器（确定性判 / LLM 共识、ABSTAIN-not-guess）、UMA 镜像（48h 定稿窗）、押金/罚没、voter/settler cron 形态。

## 2. 缺口 + 现状（Explore + NWT 实核）
1. `winning_side` 裸 INTEGER，**无 CHECK/触发器/应用层写入方**，今唯一写入 = 手写 SQL。
2. 主网 **is_oracle=1 relay 共 0 个**，oracle_registry/pool_membership/stake_enrollments/pool_markets 全 0 行 ⇒ "5 人委员会+押金"今天在主网**跑不起来**。
3. 委员会现由**建市场调用方在请求体传**（bettor.js:1277），非固定白名单。
4. 🔴 covenant 自带 **REFUND_FLIP_GRACE_MS=7,200,000（2h）**：deadline 后 2h 任何人可把市场翻退款态 ⇒ **oracle 全链路必须在 deadline+2h 内完成 close_commit landed，否则赢家被退款**（结构性硬约束）。
5. voter cron 不扫 proto_markets；proto_markets 只有自由文本 `question`、无判定题字段。

## 3. 设计（两段式 + DB 强制 + schema+adapter）
### 3.1 schema（migrate 新版本）
- **判定题**：`resolution_rule_spec`(5 必填) 或 `outcome_market_source`+`outcome_condition_id`；建市场必填其一。
- **结果可知时刻 `outcome_end_ms`（M6）**：≠ covenant `deadline_ms`。建市场校验 `deadline_ms ≥ outcome_end_ms + 投票预算 + 宽限窗 + 余量`，且全预算 < 2h（M2/M6）。
- **委员会白名单**：`outcome_oracle_relay_ids`（建市场后**不可改**，M4），alive 校验。
- **判定追加表 `proto_market_verdicts`（M3）**：(market_id, source_kind[extractor|uma|llm|human], relay_id?, outcome, confidence?, evidence_ref, created_at)；append-only，是 winning_side 的**不可改判定记录**来源。
- **write-once DB 触发器（M1）**：`proto_markets` BEFORE UPDATE OF winning_side：`OLD.winning_side IS NOT NULL → ABORT`、`NEW.winning_side IN (0,1)`、`status='sealed'`；写后**永不改**（M2，取消 v0.1 §4-3"宽限窗内可更正"）。
### 3.2 adapter（新增，不改引擎）
- voter cron 加分支扫 `proto_markets`（sealed、过 `outcome_end_ms`、winning_side IS NULL），喂 `deriveVote` → **写 `proto_market_verdicts`（不写 winning_side）**。
- **提升到 winning_side 仅允许（M3）**：(a) 确定性已知源抽取器且报告 final / UMA 镜像已定稿；(b) 人工确认。**纯 LLM 只产 proposal，不得提升**。
- 提升前**预检（M5）**：胜方侧恰 1 条已确认下注 ∧ 奖池>0，否则不写值、走人工/退款（防卡 winner_count）。
- 提升写法：`UPDATE proto_markets SET winning_side=? WHERE id=? AND status='sealed' AND winning_side IS NULL`（触发器兜底）；`changes==0` 视为已判定，停。
- **oracle 题市场禁 operator 直写（M1）**：建了判定题的市场,operator 手写路径被拒（否则"先到先写"让 operator 永远抢在 oracle 前）；operator 受控写仅限**无判定题**的市场（如主网首轮那种）。
### 3.3 TypeSafe（D-030，仅 proposal）
LLM 路径主观题用 TypeSafe（Noul/Choice+confidence）**只产 proto_market_verdicts 的 proposal 与置信参考,绝不自行提升 winning_side**；只发非敏感/合成/公开输入,绝不进出口闸。

## 4. NWT 6 MUST → 逐条闭合
- **M1 write-once**：DB 触发器强制(OLD 非空 ABORT + 值∈{0,1} + status=sealed)；winning_side 引用不可改的 proto_market_verdicts；oracle 题市场禁 operator 直写。✔§3.1/3.2
- **M2 时间预算 <2h + 不自相矛盾**：全链路(委员会+宽限窗+close_commit landed)预算 <2h(否则输给 refund_flip)；宽限窗带上界；**winning_side 写后永不改**，争议⇒冻结该市场结算、走自然 refund_flip,不改值。✔§3.1/§5
- **M3 AI 不直写钱路**：两段式,adapter 只写 verdicts;提升仅确定性源 final / UMA 定稿 / 人工;纯 LLM=proposal。✔§3.2/3.3
- **M4 委员会固定白名单不可改 + 诚实标注**：`outcome_oracle_relay_ids` 建后不可改;**若全由 KANet 运营,如实标"单运营方裁决机"**(见§8,与 H0 一致),不写成 5/5 去中心化。✔§3.1/§8
- **M5 终局与执行者 + 胜方可结算预检**：默认终局=自然 refund_flip(+2h);退款侧 claim/withdraw 由后续批接线(批 9 不接,明写);提升前校验胜方恰 1 确认注∧奖池>0,否则人工/退款。✔§3.2/§5
- **M6 outcome_end_ms**：加列;建市场校验 deadline_ms ≥ outcome_end_ms+预算;voter 在 outcome_end_ms 前不投。✔§3.1

## 5. 终局与宽限窗（M2/M5 落点）
- **总预算硬上界 < 2h**（refund_flip grace）：outcome_end → 投票 → 宽限窗 → close_commit landed 必须 <2h。宽限窗 N 有上界，且 close_commit 触发条件落在 **listWork 现有 `close_commit` 判据里加 `winning_side_set_at + grace < now`**（不新增 resolved_pending 状态，避免碰现有 `m.status='sealed'` 谓词，§4-4）。
- 争议(委员异议/人工 flag) ⇒ **冻结该市场结算,winning_side 不写/不改**,到 deadline+2h 走自然 refund_flip(赢家拿回本金,零价值测试币无损)。写值即终局。

## 6. 与受控判定并存（v0 过渡）
- 无判定题市场:operator 受控 write-once(主网首轮那种)。
- 有判定题市场:**禁 operator 直写**,只走 oracle/verdicts 提升(M1)。二者按"市场是否配判定题"分流,不并存竞争同一列。

## 7. 分批（NWT 采纳的顺序）
**A**(DB 触发器 write-once + proto_market_verdicts 表 + close_commit 触发加 winning_side_set_at 谓词，范围按 M1 扩) → **D**(宽限窗 + 2h 预算校验，**必须先于 B**) → **B-shadow**(adapter 只写 verdicts、影子运行不提升) → **simnet 端到端**(含 ABSTAIN/异议/超时/退款终局) → **B-promote**(对确定性源开提升，上线前须 M4/M6) → **C**(TypeSafe 仅 proposal/置信)。每批 设计→红队→实现→审→合，simnet 验后才上主网。

## 8. 诚实框架（M4）
主网现 0 个 is_oracle relay ⇒ 短期内若判定由 KANet 自运营,**如实定性为"单运营方裁决机(operator-adjudicator)"**,不冒充去中心化委员会;真委员会需先做 oracle 报名/押金上链(另立票)。去中心化是**演进目标**,不是现状标签。此定性与 broker D-025"索引器只是便利、链强制"同一诚实口径。

## 9. 不影响
D-029 主网首轮(已跑通)、批 9 结算机制、驱动开关、主网 live 状态。

## 10. v0.2 复核采纳（NWT GREEN 带条件 dff2d8ba）：R1–R5 验收条件 + §4-5 补
- **R1（批 A）触发器覆盖面 + 列定义**：write-once 触发器须 **BEFORE INSERT**(NEW.winning_side 必 NULL) + **BEFORE UPDATE**(OLD 非空 ABORT、值∈{0,1}、status=sealed) + **BEFORE DELETE**(有值 / 有下注或意图的市场拒删)，堵 INSERT OR REPLACE 绕过。审计列：`winning_side_source`∈{operator,extractor,uma,human}、`winning_side_set_at`、`winning_side_verdict_id`。**operator 禁写与 verdict 引用落进触发器**（非 adapter——手写 SQL 不经 adapter）：source='operator' ∧ 市场有判定题 ⇒ ABORT；source∈{extractor,uma,human} 须有 verdict_id 指向同市场同值判定行。诚实：触发器防应用 / 运维失误，**不防能 DROP TRIGGER / 伪造 verdict 的机器写权**；human 写入口须经带鉴权接口 + 审计。
- **R2（B-promote）多源 / 多数**：自动提升前提 = **≥2 独立来源抽取一致 ∧ 全部 extractor/uma 类 verdict 一致**，否则不提升、进人工 / 退款（恢复 v0.1 canonical+secondary 交叉，单源一次故障不得自动动钱）。
- **R3（批 D）两个数 + 冻结列**：`promotion_cutoff ≤ deadline + 7,200,000 − 宽限窗 − close_commit 落链余量`，晚于此不提升（防 winning_side 已写而市场已被翻退款的不一致态）；宽限窗给公式 / 取值；冻结态存 `settlement_frozen_at`（或 dispute 表），listWork 的 close_commit 触发条件检查它。
- **R4（批 A）题面不可改触发器**：`outcome_oracle_relay_ids / resolution_rule_spec / outcome_market_source / outcome_condition_id / outcome_end_ms / question` 在首笔下注或 genesis 落链后一律拒 UPDATE。
- **R5（B-promote 上线前置）refund_flip 非自动**：自然 refund_flip 需有人广播 + 逐票 reclaim，批 9 只探测不执行 ⇒ **退款执行批落地前，oracle 判定路径仅允许零价值 / simnet 市场**；真值市场以该批为前置；runbook 写明弃权 / 争议终局 = 人工执行 refund_flip + reclaim。
- **§4-5 补（SHOULD）**：winning_side 写入路径与 close_commit 参数派生（`proto-winner-bet.mjs` 读 winning_side）不循环——但"独立"**仅指**"驱动入参 == `assertCloseCommitArgsFromDb` 的 DB 派生值"这道核对，**不验证 winning_side 判定值本身**，不能当判定值的第二道防线。
