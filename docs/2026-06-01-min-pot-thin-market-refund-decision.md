# 决议 — 薄市场/小池处理:settler pre-check + refund-void(min-pot 议题)

> **性质**: Owner 钦定对抗+建设讨论 → 5-agent 收敛 → 本文 = 决议存底,Owner 终裁。
> **主持**: Bettor-tn(facilitator)| **对抗方**: J1(SS)/ J2(settler)/ KANet-UI(UI)/ NWT(攻击审)
> **缘起**: #1.4 ccvr9 实证 — 输方池(NO)2 KAS 太小 → oracle/broker 费输出小 → KIP-9 存储质量爆 13M > 500k cap → 卡 needs_larger_pot。
> **Owner 定调**: "没有对手方，没人玩儿" —— 预测市场是两边对赌的游戏,没人接另一边就不是真市场 → 退款作废,maker 本金全回无亏、只是没玩成。
> **状态**: ✅ **Owner 终裁锁定(2026-06-01):选项 A 认可,落地。** 执行中。

---

## 0. 核心洞察(对抗逼出)

**卡的不是 maker stake,是【输方池】。** ccvr9 maker 100 KAS(YES)一点不小,但它赢 → 输方=NO 仅 2 KAS,oracle/broker 费从这 2 KAS 出 → 小输出 → KIP-9 爆。**maker 门槛、总池门槛都解决不了 —— 只有卡【最终输方那侧的池】才对**(NWT 实证:SS L298 现 require 总池 ≥1e10=100KAS,ccvr9 102KAS 过了门、输方侧 2KAS 照样结不了)。

## 1. 决议(选项 A first-ship,0 SS 改动)

1. **判定(settler pre-check,显式非 string-match)**: settle 前显式算 `losingPool`(= 最终输方侧总注)。`if losingPool < THRESHOLD → 作废`,否则正常 settle。`THRESHOLD = N_committee × oracleBond + brokerFee + KIP-9 margin`(ccvr9: 5×1KAS=5KAS > 2KAS pool = 必拒)。**禁用现在那套 catch 错误文本 match**(KI-49 silent-skip 脆弱,J2 实证)。
2. **作废 = N+1 笔各自退款(J1 澄清,非 1 TX)**: maker 走 `PoolSpine refund_maker_unjoined`(entry 2)+ 每个 bettor 走 `PoolSide refund_market_cancelled`(entry 2)。各退各的本金。**0 SS 改动**(两个 entry 都已存)。委员/broker 不拿钱 = 流动性不足的自然惩罚。链上可证(各 refund_txid)。
3. **状态 + 通知(J2)**: settler 加 `cancelled` 状态(verifying 与 refunded 之间)→ dispatchPhase2 检出 too_small → status='cancelled' + chain_event `market_cancelled`(reason='thin_losing_side')→ 通知 maker+bettor 自取退款。
4. **proactive 补充(KANet-UI,REDUCE 但不替代兜底)**: bot /bet 显示池子 per-side(YES X / NO Y)+ 押注薄侧时警告。**注意: proactive 防不全** —— bet 时不知 deadline 前最终池会涨多大,/prep 硬门不可靠 → 兜底 refund-void 绕不开。

## 2. 拒绝的替代(对抗淘汰)

- **❌ create-时 min_maker_stake floor**(KANet-UI a)→ J1 反:错位防御,maker 100KAS 挡不住薄输方侧。池太小 ≠ maker stake 太小。
- **❌ oracle 费从 broker pool 出**(KANet-UI b)→ J1 反:broker fee 默认 0%,即使 1% 也远不够 5×1KAS oracle bond;强行=maker 自付 oracle,经济不通。
- **❌ 卡死 needs_larger_pot**(现状)→ 钱卡住、maker+bettor 都怒。

## 3. Phase-2 硬化(非 first-ship,留档)

- **SS 加 `require(losingPool >= THRESHOLD)`** 在 settle_aggregate(winner 已知时)= defense-in-depth,settler 失守也不让坏 settle 上链。
- **SS 自适应 payout**(选项 B,J1)= 委员费 floor / 固定小额 ≥KIP-9 floor,免动不动作废 —— 等 **KIP-17**(silverc loop/math 原语)。
- **NWT verifier baked**: attack-static check settler 尊重 losingPool 阈值不绕 + SS min-pot 不被绕。

## 4. 冷启动(另议,非本决议 scope)

"没人玩"还指向"怎么吸引对手方":market-seeder 做市/种子流动性引活冷门市场。这是流动性设计,与"没人玩怎么办(=退款)"分开,单独议。

---

*Bettor-tn facilitate + 5-agent 对抗收敛(J1 SS owner 推选项 A + 给阈值公式;J2 settler cancelled 状态 + 显式判定;KANet-UI proactive 补充;NWT verifier 守)。Owner '没对手方没人玩' 定调。请 Owner 终裁。守 G5。*
