# Griefing 防御设计决议(abstain/refund 对抗经济学)

> 2026-06-10 | 设计: J1(经济模型)+ J2(settler)+ NWT(红队) | 综合/裁决记录: Bettor-tn(架构) | **Owner 终裁: 同意(附条件,见 §5)**
> 性质: **版本化封存决议** —— 档1 开测上线 / 档2 mainnet 前冻结可审计版本。本 doc 定稿即封存基线。
> 触发: Owner 对 `docs/2026-06-10-prediction-oracle-system-assessment.md` 的对抗审,点出 "abstain/refund griefing = 最大未证项"。

---

## 1. 问题(Owner 洞察)
abstain-not-guess 是好判决纪律,但 **abstain→full refund 让弃权成为输方的"免费期权"**:输方有动机操纵 oracle 弃权(模糊源 / 攻证据 fetch)→ 市场 refund → 取消败注(heads 赢 / tails 退、单边无损)。testnet 零价值不会自然暴露,"开测攒"攒不出来。必须协议层定价,不能只当判决美德。

## 2. 完整设计(5 层,robust-by-construction)经 ~10 轮对抗收敛、三方签字

| 层 | 职责 | 关键点 |
|---|---|---|
| **(A) prevet 主防** | 只放**直接字段-结构化-持久源**题(winner 字段 / price 阈值)| 无复杂 LLM 推理题(critical 拒)、无歧义/易逝源 → 掐源歧义(NWT①)+ 推理重入(NWT②)+ 保 recoverability(NWT③) |
| **阈值 3 态** | settle = 任一 side ≥4-of-5;abstain-refund = ≥4-of-5 **主动**"不可判";**两者皆不达 → 中间态 dispute(不自动退款、不奖 griefer)** | 防"corrupt 1-2 oracle grief 成 refund";堵 split-vote(3Y/2N 落 dispute) |
| **propose→挑战窗→finalize** | settle/refund 先 propose、窗内可挑战、再 finalize | 防 force-wrong-settle(资金移动前纠);**类型化证据**:proposed_refund→同源重读(证当时可得→slash griefer);proposed_settle→**异源修正证据**(同源重跑是 theater);**修正证据须过同 (A) prevet 门**(防假源翻正确 settle = 挑战机制不成新攻击面) |
| **slash** | 恶意 abstain/propose 证实 → slash bond 补对手方 + oracle | victim = 天然 verifier(有 skin+信息);复用已 SSRF 硬化的 deriveVote 裁,零新可信件 |
| **显式诚实边界** | **源真错 + 超挑战窗 = 不可约 oracle 天花板**(UMA/Chainlink 同款) | 自动挑战(同源重跑)对"genuinely 误导真源"是 theater → 该类逃逸 = 边界;testnet 零价值接受;mainnet **if deployed** 靠多源 + 更长窗 + UMA 人工 dispute 进一步收 |

J1 经济自证: haircut 单独**做不到 -EV**(输 -S vs 打折退 -hS,任何 h<1 退款恒优 → 输方永远偏好 grief)→ 主威慑 = **阈值分离 + slash**(haircut 退为摩擦+补偿非门)。

## 3. 三方签字
- J1 #45/#46: 挑战窗双态 + 类型化证据模型 + 修正证据过同尺门(防反向)— 签
- J2 (synth 1/2,2/2): (A) prevet 结构化+持久+直接字段门 + settler 落阈值3态/挑战窗 — 签
- NWT r22/r23/r24: 红队 3+2 残留全压测,(A)+(B) 闭合或划入边界,挑战机制新攻击面堵死 — **终签"栈全闭 + 诚实边界框架对"**

## 4. NWT 红队残留 → 归属
NWT ①源独立性 / ②推理重入+force-wrong-settle / ③recoverability:全由 (A) prevet 收窄(主) + (B) 挑战窗兜底(异源修正证据) + 显式边界(源真错超窗)闭合或划界。

## 5. Owner 终裁(2026-06-10)+ 落地条件

**问1 — 档1 开测上线 / 档2 封存:同意。** 条件:
1. **档2 版本化封存**:本 doc = 设计定稿 + commit hash 锚定;§6 列 mainnet/真金前置条件。封存 = 冻结可审计版本。
2. **NWT 攻击样本不取消、改打档1范围**:prevet 收窄能否被绕 + 阈值3态全投票组合覆盖(KI-28:结构防御无攻击样本验证 ≠ ship close)。

**问2 — 4-of-5 / ≥4-of-5 / abstain 不计票:同意。** 硬条件:
1. **中间态 = 代码 `else` 分支,非第3个显式条件**:settle + abstain-refund 显式;其余一切(含非法枚举值 / 未来新增投票类型)**无条件落 dispute**(封五-issue "非法枚举行为未定义")。
2. **no-show 语义显式写规格**:1 no-show → settle 需剩 4 全票;2 no-show → settle 与 abstain-refund 均不可达 → 必 dispute。跨节点容错测试(validator 死亡自主结算)在新条件下**重验、确认不回归**。
3. **档1 模式 dispute 必须有终态出口**(挑战窗不在线):dispute 超时 → 现有 `dispatchRefund`+grace **或** owner 手动终裁,**二选一写死、不留空**(否则 = stuck order 换形态回归)。

**问3 — 诚实边界写进对外说明 + 报告:同意无保留。** mainnet 部分用 **"if deployed"** 语态(Track B 文档惯例)。

**五-issue 归属核对**:k-of-n 不一致 → 三态吸收;split-vote → 三态吸收;非法枚举 → 问2 条件1;ABSTAIN 经济边界 → 问3 + 本封存 doc(经济激励部分随档2)。**悬空两条进 J2 settler 任务卡 DoD:① `dispatchRefund` 三路统一 ② guess-fallback 全库 grep。**

## 6. 档2 mainnet/真金前置条件(封存,if deployed)
真金部署前必须激活档2全套:propose→挑战窗→finalize + 类型化证据 + slash + bond(bond ≥ 市场值上限 解 force-wrong-settle 欠抵押)+ 多源委员(减相关失效)+ 更长挑战窗 + UMA 人工 dispute(收源真错超窗边界)。本 doc commit hash = 档2 设计基线锚点。

## 7. 开测就绪影响
门 C 闭 = SSRF CRIT ✅ + prevet FP→0% ✅ + griefing 档1(本决议待 J2 实现+NWT 攻击样本验)。**档1 实现+验过 才算门 C 闭**(不是"设计了就算")。开测就绪 = 门 B(J1 找零核弹)+ 档1 实现验证(J2/NWT)+ onboarding 收尾。
