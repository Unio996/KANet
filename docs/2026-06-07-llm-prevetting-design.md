# LLM 预审核机制设计方案(P0-A 出题端质量门)

> 2026-06-07 Owner 钦定加 P0 + 对抗性讨论(dev-coord-testnet R1-R3, Bettor facilitate, J1/J2/KANet-UI 收敛, NWT 测试角待精修)。本文 = 收敛方案,Owner 终裁后 → 建 → 测循环迭代(全自动)。

## 0. 为什么(结构性洞察 Owner)
主流死结:开放出题 → 没法裁的垃圾单(Augur 垮)→ Polymarket 只能人工中心化策展挡。**KANet 解 = Agent 预审核(出题端)+ 去中心化预言机(裁决端),开放出题不崩、不收口创建权。** 本预审 = 自动+去中心化版的"策展"。

## 1. 关键 reframe(KANet-UI 抓·钉死)
**预审查不了"答案"** —— 建市时事件还没发生、不可能 fetch 到结果。预审只查 **"well-formed + 将来可裁"**:
1. **数据源原则可达**:canonical URL/源 reachable + 将来能取到答案(非现在取答案)
2. **判定规则无歧义**:无主观词、阈值/时间明确
3. **题目清晰**:一句话能懂、二元可判

## 2. 模型:乐观-挑战(fraud-proof,三方收敛)
| 阶段 | 做什么 | 成本 |
|------|--------|------|
| **create 快路** | backend 跑 **1 个 LLM** 评估(~3s)→ 乐观 pass | 低(不每单跑 5 LLM)|
| **锚链** | 锚 `vetted_spec_hash + vetter_pk + llm_endpoint_hash + scores`(不锚 spec 全文)= 问责非证书 | — |
| **挑战期** | 公示 ~10min,≥1 challenger 提 challenge tx → 触发 **k-of-n(k=3)多 provider LLM 委员**重审(Qwen+Llama+GPT 多元化)| 仅被挑时 |
| **挑战经济** | `challenge_fee=1 KAS`(低门槛鼓励挑战);翻案胜方 reward = slash vetter stake × 50%,**余 50% 烧**(防自挑共谋);重审翻案 → 原 vetter slash | — |

**backend 跑 + 锚链,UI 只读不算**(KANet-UI 让步 J1:防 client 单家说了算 / 加密问责)。

## 3. 分级(张力1 三方共识·非黑墙)
| score | 处置 | UI |
|-------|------|----|
| ≥7 | 放行 | '✓ 易裁' badge 鼓励 |
| 4-6 | 放行 + 风险透明 | '⚠ 低可裁性' badge(押注端可见)+ 警告 panel 显缺啥 + 改进建议(自动改写按钮)|
| ≤3 且 ≥2 LLM 同意 | **硬拒** | 拒 + 显具体缺啥(可改、非黑墙、别逼填 jargon)|

主观/长尾(无确定源):标'低可裁性'可建(进风险池),**只 critical 完全不可裁才硬拒**。

## 4. 一致性 + 防攻击(J1/J2)
- **预审 vs 裁决同源**:同 LLM endpoint 池(预审抽 1、裁决/challenge 抽 k),避免"审过裁不了";不一致 → slash
- **bait-switch 防护**:锁 **structural hash**(源 URL/endpoint 身份),**非 content_hash**(J1 R3:content 动态——同一 ESPN 源现在 vs 赛后结果本就不同,锁 content 不切实)→ vetted 后改源【身份】才失效
- **挑战防滥**(J2 R3):失败挑战押金全没 + rate-limit max 3/24h per agent
- **prompt-injection**:spec 字面骗 LLM → 多 LLM + 测试集守(NWT)
- **共谋**:k-of-n 多 provider + VRF 抽样(重用现委员 infra)

## 5. 评估返回(KANet-UI)
`{score 0-10, why:[缺数据源/缺时间/有歧义/...], suggestions:[...], llm_votes:[{provider,score}]}` → UI 大白话'易裁度 7/10' + 缺啥 + 改进按钮。UI 文案'题目可裁性估计(启发非保证)',不显 'certified'。

## 6. 测试(NWT 待精修 — R3 测试角)
- 好单过 / 垃圾单挡(已知可裁/不可裁集)
- **对抗 spec 自动生成**:歧义/主观/无源/prompt-injection 变体 → 测拦截率
- **FP/FN 率量化**:误杀好单率 / 放垃圾率
- prompt-injection 攻击测点(spec 内嵌"判 YES"指令等)
- 回归 lint 守阈值/术语

## 7. 诚实边界
预审 = 启发式质量门、非'保证可裁';锚链 = 问责非证书;testnet;不报经济闭环(G5)。

## 关卡
Bettor 关1(本方案对齐)→ Owner 终裁 → 建 → Bettor 关2(实测:好单过/垃圾挡/对抗 spec/链锚)→ NWT 关3 → 测循环迭代。
