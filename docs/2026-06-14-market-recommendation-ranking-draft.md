# 市场推荐排序 — 草案 (Owner 钦定·待全员对抗讨论)

> **日期**: 2026-06-14
> **来源**: Owner——"48 支球队世界杯, 库里单子太少; 更重要是推荐排序, 需要搞一个出来。认真思考梳理草案, 所有智能体真正对抗性讨论。"
> **性质**: Bettor 架构草案 (带提案 + 对抗洞, 非 decree)。待全员对抗收敛 → Owner 终裁。
> **守红线**: G5 (机制/范式, 非经济闭环); 用户需求第一。

---

## 0. 核心 thesis (草案的灵魂, 先立这个再谈信号)

**推荐排序对 KANet 不是"什么热门排前面"——是"什么热门 AND 我们能可靠结算"。**

通用平台的排序优化【参与度】(engagement)。但 KANet 多一条命门: **推荐一个我们判不了的市场 = 推荐一笔退款 = Owner 最初 Q2 问题在规模上重演**。48 支球队世界杯一上, 库里会炸出几百个市场(moneyline/让分/大小球/角球/球员 props × 上百场), 其中很多 props/小众我们 oracle **判不可靠**(见 binary-decomposition 纲领 oracle 能力分层 L1/L2/L3)。若排序只看热门, 会把判不了的推到用户面前 → 到期退款 → 信任崩。

∴ **judgeability (oracle 结算置信度) 是排序的【一等信号/闸】, 不是事后补丁。** 这把推荐排序直接绑到 #25 UMA oracle 能力引擎 + Q2 闭合 + 纲领的能力分层。**这是 KANet 推荐排序区别于 Polymarket 的根本。**

---

## 1. 问题 (为什么现在要)

- 库存暴涨在即: 48 队 WC = 几百市场(纲领: 每场 ×N binary 谓词)。用户没法浏览全部。
- 现状: broker DM/tg-bot 列市场但**无排序/推荐**(`broker_recommendations` 表存在但**空, 没人推**)。
- 需要: 把"用户想押 + 我们能可靠公平结算"的市场surface 到前面。

---

## 2. 排序信号 (草案·待对抗增删权重)

市场分 = 加权组合:

| 信号 | 含义 | 为什么 | 数据源 |
|---|---|---|---|
| **★judgeability** | oracle 判这市场的结算置信度(L1 比分算术=高 / L2 半场=中 / L3 props=低/无) | **不推判不了的=不制造退款(Q2)** | #25 能力分层 + 源可得性 |
| **liquidity** | 总押注额 / 押注人数 | 活跃=有意思+结算更稳 | pool_markets/sides |
| **urgency** | deadline 临近度(衰减) | 快截止=该现在押 | deadline |
| **relevance** | 类别匹配用户兴趣 / 全局热度 | 用户想看的 | 用户历史/全局 |
| **trust** | broker 声誉 + oracle 声誉 | 高声誉经手=可信(PoW+PoS) | reputation.js |
| **freshness** | 新市场 boost | 防冷启动饿死(新市场无流动性) | created_at |
| **diversity 惩罚** | down-rank 近重复(同场同类) | 不刷屏同一场 | 去重 |

**score = w1·judgeability × (w2·liquidity + w3·urgency + w4·relevance + w5·trust + w6·freshness) − w7·diversity_penalty**

(judgeability 用**乘子**不是加项——判不了的市场不管多热都该压到底, 这是 thesis 的数学表达。)

---

## 3. KANet-unique 核心: judgeability 闸 vs 信号 (第一个对抗点)

- **硬闸版**: judgeability < 阈值的市场**根本不推荐**(可建可押, 但不进推荐列表)。= 永不推退款, 但缩小可推库存(props 全砍)。
- **软信号版**: judgeability 当乘子, 低的压到底但仍可见。= 库存大, 但用户可能押到判不了的。
- **折中(我倾向)**: judgeability 当乘子 + **明确标注**(可判市场标"✓可结算", 不可判标"⚠人工/UMA 仲裁/可能退款")——让用户知情选择, 不骗。配 fixture-mock-extract 预审闸(判不了的预审就拦)。

---

## 4. 反操纵 (第二个对抗点·命门)

排序一旦影响曝光=钱, 必被攻击:
- **broker 刷市场**: 建一堆垃圾市场冲榜 → 防=trust(broker 声誉)当乘子 + 新 broker 低权重 + 单 broker 曝光配额。
- **wash-betting 刷流动性**: 自己押自己冲 liquidity → 防=liquidity 算**distinct 押注者**(去重 sybil) + reputation-weighted stake, 非裸金额。
- **judgeability 伪报**: broker 声称可判骗推荐 → 防=judgeability 由**我们 oracle 引擎(#25)独立评**, 非 broker 自报。
- 借鉴 oracle 选取的 anti-sybil + PoW+PoS 思路。

---

## 5. 冷启动 / 个性化 / 链上性 (第三组对抗点)

- **冷启动**: 新市场无流动性/历史 → freshness boost + reputation 闸(高声誉 broker 的新市场可冒头, 防垃圾)。
- **个性化 vs 全局**: 个性化(用户押注历史→兴趣)更准但有冷启动+隐私+复杂度; 全局排序简单中立。**草案: V1 全局 + 类别 filter, V2 加个性化。**
- **链上 vs 链下**: 排序是 UX 层, **链下 advisory** 算(Console)即可(不像 settle 要链上 trustless)。但**输入信号(liquidity/reputation/judgeability)要可审**(基于链上/可验数据, 不是 broker 能伪造的黑箱)。= 排序算法链下, 但喂它的数都链上可查。

---

## 6. 跟其他工作的接点

- **#25 UMA 引擎**: judgeability 信号的来源(能判哪些 domain/谓词)。推荐排序是 #25 的**头号消费者**——oracle 能判的越多, 可推库存越大。
- **binary-decomposition 纲领**: 每场 WC = N binary 谓词, 每个谓词带 judgeability tier → 排序按 tier。
- **seeder 供货**: 48 队 WC 库存(Owner 第①点)= seeder 镜像 Polymarket WC 市场。供货 + 排序是一对(供得多才需要排; 排得好供货才有用)。
- **broker_recommendations 表**: 现成的落地处(填它)。
- **reputation.js**: trust 信号现成。

---

## 7. 待对抗的关键决定 (全员出立场+互挑)

1. **目标函数**: 排序优化什么? 参与度 / 结算成功率 / 流动性 / 加权混合? (定这个才能定权重)
2. **judgeability = 硬闸 vs 软乘子 vs 折中标注?** (§3, thesis 的落地方式)
3. **反操纵够不够?** (§4, broker 刷市场/wash-bet/judgeability 伪报, 攻击面 top-N)
4. **个性化 V1 要不要?** (§5, 还是先全局)
5. **链下 advisory 排序的输入可审性够吗?** (§5, 防黑箱)
6. **权重怎么定+怎么调?** (静态 / 学习 / A-B?)

---

## 8. 红线
- 草案=认识框架, 非定稿。全员对抗收敛 → Owner 终裁 → 才落码。
- 守用户需求第一(judgeability 标注=不骗用户)+ G5(机制非经济)。

---
*Bettor-tn 草案。Owner 钦定。待全员真对抗讨论 → 收敛 → Owner 终裁。*
