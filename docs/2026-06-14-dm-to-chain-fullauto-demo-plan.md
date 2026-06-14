# 电报DM → 链上结算 全自动端到端 Demo — 编排计划（demo-first 北极星）

> **日期**: 2026-06-14
> **缘起**: Owner 钦定 demo-first 下一步——"好好搞一个测试，必须上链，从源头通过DM，全自动，你来安排"。
> **主持/编排**: Bettor-tn（架构 + 链上验收）。
> **定位**: 对外测试网公开（北极星）的核心演示。**闭合 Owner 最初 Q2**——"我之前通过电报DM押注，到时间都是退款了事" → 现在一笔 DM 押注**全自动**走到**链上真结算真赢**。

---

## 0. 一句话 + DoD

一笔押注从**电报DM**进（真用户入口）→ 真源市场 → 跨节点真分布式委员会判真比赛 → **链上 settle** → 赢家真收 KAS，**全程零人工**，每阶段**链上 ground-truth 验**。

**DoD（全过才算成，禁 echo-PASS）**:
1. 押注**从 Telegram DM 发起**（非 API 直调）→ bettor stake **真上链锁**（PoolSide P2SH lock，check_utxo_landed=landed）。
2. 委员会**跨节点真分布式**（≥1 J1:3300 委员，今天验过的 chain-derived 池）。
3. 判**真比赛**（真 ESPN 终分，NWT 独立 ground-truth 对照=判对）。
4. **settle 链上**（settle_txid check_utxo_landed=landed）+ 赢家地址真收 KAS（独立 check）。
5. **全自动**（一条命令跑完，0 人工干预）+ **可复现**（落 test-framework/cases/predictions/）。

---

## 1. 管线（5 阶段，从源头通过DM，全自动，上链）

```
①建市(真源)         broker 建 v0.7 POOL, outcome_market_source=espn, 选已结束真比赛, deadline 设刚过
   ↓
②从源头=电报DM押注   测试 persona 走 tg-bot /bet 菜单 → 选该市场 → 押【真赢方】→ register-v06 → PoolSide stake 真上链
   ↓
③自动委员判          deadline 过 → 委员采样(跨节点 chain-derived 池) → deriveVote 判真 ESPN 终分 → 投票上链
   ↓
④自动 settle         decideConsensus → collecting_sigs → 委员签 → settle TX 广播 → 落链
   ↓
⑤赢家收款            winner(=DM 押注者) 地址真收 KAS
```

每阶段链上验（rule-46）：①PoolSide lock_tx landed ②oracle_relay_ids 含 J1:3300 + 投票 txid landed ③NWT 独立 ESPN 终分 vs 委员判 ④settle_txid landed ⑤winner UTXO landed。

---

## 2. 分工（认领 + ETA）

| 角色 | 谁 | 交付 |
|---|---|---|
| **真源市场 + 独立 ground-truth** | **NWT** | 选 1 场已结束真 ESPN 赛（终分明确，judgeable spec）+ 建市参数（outcome_market_source=espn）+ 独立读 ESPN 终分当真值对照③ |
| **电报DM押注上链（demo 核心新部分）** | **KANet-UI** | tg-bot /bet 流程**真走到 register-v06 链上 stake**（非只菜单显示，扩 L2 handler test）；确认 DM-originated bet 真锁 PoolSide。这是"从源头通过DM"的关键 |
| **自动管线（委员判→settle）** | **J2** | DM 来源市场走完整 v0.7 committee settle pipeline，零人工；voter cron + settler tick 自动跑 |
| **跨节点委员 determinism** | **J1** | 委员含 J1:3300 真投票（今天 chain-derived 池 + ensurePoolSnapshotByRoot），settle 跨节点 byte-equal |
| **编排 + 链上验收 + 测试框架落地** | **Bettor(我)** | demo 编排设计（本文）+ 每阶段链上 ground-truth 验 + DoD 收口 + case 进 test-framework |

---

## 3. 关键技术点（防坑）

- **真源时序**: 用**已结束**的真比赛（终分已知），市场 deadline 设**刚过** → 委员立判，不等真实赛程。复用 line-E harness 的真 ESPN fetch（N=35=95.8% 已证判得准）。
- **押真赢方**: 比赛已结束知道结果 → DM 押**实际赢方** → ⑤ winner 真付（证完整价值路径，非 refund）。
- **DM 真上链非模拟**: ② 必须是 tg-bot handler **真触发 register-v06 → 真广播 PoolSide lock TX**，不是 mock。L2 handler test 只测了菜单显示，这里要**扩到真下单上链**。
- **跨节点真委员**: ③ 委员必含 J1:3300（真分布式，今天验过），非全 :3200 单机——否则退回 cosmetic。
- **全自动**: voter cron（PREDICTION_VOTER_TICK_SEC=60）+ settler tick 自动驱动，demo 跑起后不碰。

---

## 4. 序 + 红线

- 这是 **demo-first 的核心交付**（design-v2 部署并行、§4 实施 gate 在本 demo 后）。
- 守 G5：报**机制端到端闭环**（DM→链上 settle 全自动），testnet 范式，非经济闭环。
- 测完才算过：5 阶段链上 ground-truth 全验 PASS 才报 Owner，禁 echo-PASS / 半截报。

---
*Bettor-tn 编排。Owner "你来安排，全自动" 驱动。闭合 Q2。各位认领 + ETA → 建 → 跑 → 我链上验收 → 报 Owner。*
