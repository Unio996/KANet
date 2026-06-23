# #29 推荐排序 收敛设计 — prevet-gated broker recommendation ranking

> **日期**: 2026-06-15 · **Lead**: NWT-tn (对抗+推荐域, Bettor r631 钦定驱动) · **状态**: 收敛设计草案 → 对抗讨论 → Owner 终裁
> **共识基础**: NWT 威胁模型 (5 面) + J2 立场 (C-gated + history 权重 + cold-start bond) 已对齐。
> **守红线**: 机制验证非经济闭环 (G5); 测试网零价值。

## 0. 现状 (查码)
- `broker_recommendations` (v167): `broker_relay_id · market_id · prevet_score · prevet_tier · bond_txid · bond_status · history_accuracy_at_time · UNIQUE(broker,market)`.
- recommend 已 **prevet-gated** (auto-recommend on create 带 prevet tier/score) + **self-broker 默认** (broker 荐自己经手市场, 多数市场 self-broker).
- **排序算法本身未建 = #29 核心**。

## 1. 收敛排序公式
`rank_score = f(prevet_quality[C-gated], broker_reputation[高权重], skin_in_game[slashable bond])`

1. **prevet_quality (C-gated 硬前置)**: 仅 prevet tier=pass 市场可推 (gate)。其中 prevet_score(0-10) 计入, **但归一/capped** 不让单一高分主导 (prevet 有残留 FP 风险, 不过信)。硬前置: **C FP<5%** (MVP 已达; full-gate 推进中)。
2. **broker_reputation (history_accuracy, 高权重 = 反操纵核心)**: broker 过往推荐市场的 **settle-对率 / 不-refund 率** (`history_accuracy_at_time`)。荐过 dispute/不可判市场的 broker → reputation 降 → 降排。**track record 造不了假** = 防自荐偏向的真信号 (不是"有没有推荐", 而是"推荐得准不准")。
   - **cold-start (新 broker 无 history)**: 用 **bond 作默认信号兜底** (防新人挡门, Owner 倾向)。新 broker 凭 bond 拿 baseline 排名, 随时间累积 reputation。
3. **skin_in_game (slashable bond)**: `bond_txid/bond_status`。bond **可 slash** (推荐的市场 dispute/不可判/错-settle → 罚, 耦合 gate B dispute slash)。使 sybil/spam 昂贵 + 激励对齐。

## 2. 威胁 → 缓解映射 (NWT 5 面 + sybil)
| 威胁 | 缓解 |
|---|---|
| **prevet-FP 污染** (耦合 C) | C-gated + prevet_score capped (不过信 tier=pass; C FP<5% 前置) |
| **sybil 多 PK 刷** | 每推荐付 bond (每 sybil 身份付费) + cold-start 无 history = 低排 → sybil 昂贵且无效 |
| **self-broker 偏向** | 排序用**独立信号** (history_accuracy + bond + prevet_quality), **非"推荐存在"本身** (人人自荐, 存在≠质量) |
| **bond gaming** | bond **slashable** on 坏推荐 (非无条件退) |
| **cold-start 挡新人** | bond 兜底 baseline (Owner 倾向防挡门) |
| **中心化** | bond 兜底放新人进 + reputation 是挣来非 gated; ⚠残留张力: 纯 reputation favors 老 broker, bond 兜底缓解 |

## 3. 待 Owner 终裁 (开放决策)
1. **权重公式**: prevet_score cap 值 + history vs bond 权重比 (倾向 history 高权重, bond 仅 cold-start 兜底)。
2. **bond 参数**: bond 额度 + slash% + slash 触发条件 (耦合 gate B dispute — 何为"坏推荐")。
3. **self-broker 处理**: self-broker 是常态 → 倾向**不罚不奖** (既不因自荐降权, 也不因"被推荐"加权)。
4. **prevet_score 是否计入还是仅作 gate**: 选项 (a) 仅 pass/no-pass gate, 排序不看 score; (b) score 归一计入。倾向 (a) 更稳 (避免 prevet 残留 FP 经 score 放大)。

## 4. 共识状态
- NWT 威胁模型 (5 面) + J2 立场 (C-gated + history 高权重 + cold-start bond + bond-slashable) = **对齐**。
- 本设计 = 两者收敛。**待对抗讨论 (各 agent 出立场) + Owner 终裁权重/bond 参数 → 落码 (J2/owner 域)**。
- NWT 后续: Owner 终裁后, 对最终排序逻辑出 **attack-PoC** (sybil 刷排 / self-bias 操纵 / bond 绕过) 验设计真防得住。

---
*NWT-tn 驱动 (Bettor r631)。设计基于 broker_recommendations v167 schema + NWT 威胁模型 + J2 判定域立场。impl gated 在 Owner 终裁。*
