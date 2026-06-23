# Broker 预测市场分量加强 — 设计 (Bettor, 2026-06-12)

> Owner 2026-06-12: "驱动智能体用 dm 真正押注，真正去管理。broker，在预测市场分量要加强。"
> 守铁律: 用户需求第一 / 简单高效 / 不重造已有 / 防御性 suspect。

## 0. 一句话

让 **broker 成为预测市场的 DM 介绍人**: 用户 DM broker → broker 列它经手的活跃市场 + 介绍 → 用户表达押注意图 → broker 委派给现有 prediction FSM 完成真链下注 → broker 按 settle 已有机制收 fee。**不重造 FSM, 不碰签名载荷, 只补 DM 介绍/委派层 + 让 broker 可见可归因。**

## 1. 现状事实 (架构地图实证, file:line)

| 维度 | 现状 | 位置 |
|---|---|---|
| DM 路由 | `/`前缀或数字+活跃 session → prediction-agent-mind FSM; 否则 → broker-llm-agent。**两套分离** | conversations.js L337-375 |
| 预测押注 FSM | 独立菜单 FSM (`/predict` `/my_bets` `/cancel`), 真下注上链 (taker-handshake + taker-stake → P2SH escrow) | prediction-agent-mind.mjs L26-35 状态机, L312-371 真链 |
| broker 在预测 DM | **零**: SYSTEM_PROMPT 0 提 prediction, 用户问 broker 预测市场答不上 | broker-llm-agent.js L48-119 |
| broker fee 机制 | **已全通**: broker_relay_id + broker_fee_pct + broker_pk; settler 算 brokerFee 记 phase2_broker_fee_sompi | pool_markets v135; pool-market-settler.js L1364-1365, L1909 |
| broker 收入显示 | Lane① 已验 (kanet-broker.js 读 phase2_broker_fee_sompi, 实落 6.73 KAS) | kanet-broker.js L25-113 |

**结论**: fee 管线 (链上分账 + 显示) 已完整。**唯一缺口 = DM 介绍/委派层** —— broker 不是预测市场的 DM 门面。

## 2. 设计 (分阶段, 简单优先)

### Phase 1 — broker 当预测市场 DM 介绍人 (低风险高价值)

**broker-llm-agent.js (HIGH-RISK Critical 8, 改前必扫 T-J/T-NWT/Bug)**:
1. SYSTEM_PROMPT 补一段: "你也可介绍预测市场。用户问预测/想押注时,列出你经手的活跃市场 (broker_relay_id=本 relay), 介绍后引导用户进入下注流程。"
2. 加 tool `intro_prediction_markets`: 查 `pool_markets WHERE broker_relay_id=本broker AND status=active`, 返回市场标题+deadline+broker_fee_pct。
3. 加委派: 用户表达"押市场 X"意图 → broker 回复引导 (`发 /predict 开始下注` 或直接 handoff prediction-agent-mind)。

**最简版 (防御性 suspect, 先不深耦合)**: broker 只做"介绍 + 引导到 /predict", **不**深度接管 FSM。用户 DM broker 问预测 → broker 列市场 + 说"发 /predict 下注" → 进现有 FSM。委派靠用户一个命令, 不靠 broker 内部调 FSM (降耦合风险)。

### Phase 2 — broker 在预测 DM 流程可见 + 收 fee 透传 (归因)

**prediction-agent-mind.mjs**:
1. 市场列表 + stake options 显示 "本市场 broker: <name>, 介绍费 <pct>%" (若 broker_relay_id 存在)。
2. `/my_bets` 显示每注经手 broker。

= 让用户看见 broker 在预测市场的价值 (介绍人 + 收费), broker 收入已在链上 (settler) 真实发生。

### Phase 3 — broker 主动管理 (Owner "真正去管理")

broker 可看自己经手的预测市场状态 (active/settled/收入), 主动 DM 用户"你押的市场 X 结算了, 赢了 N KAS"。复用 kanet-broker.js 看板 + 加主动 DM 通知。

## 3. 不做什么 (防过度设计)

- **不**重造 prediction FSM (已工作, 真上链)。
- **不**碰签名载荷 / canonical (broker fee 已在 settler 链上, 不动)。
- **不**在 broker 里复制下注逻辑 (委派, 不复制)。
- Phase 1 **不**深度耦合 broker↔FSM (先松耦合: broker 介绍 + 用户命令进 FSM)。

## 4. 真 DM 押注演示 (Owner "真正押注", Tier 4)

链路接通后驱动 pre-funded tester-1/2/3:
1. 建一个 broker 经手的真预测市场 (broker_relay_id 设为某 broker)。
2. tester DM broker → broker 介绍该市场 → tester 走 /predict 真下注 → pool_bettor_sides 落链。
3. settle 后验 broker 收到 phase2_broker_fee_sompi (链上)。
= broker 介绍人 + 真 DM 押注 + broker 真收入 三证合一。**Tier 4 真链 DM round-trip, 非 /api/agent/reply mock。**

## 5. 分工 (待团队对抗 + Owner 终裁)

| 块 | owner | 依赖 |
|---|---|---|
| DM 链路接通 (handler+dispatcher live) | KANet-UI + NWT | 进行中 (Lane④) |
| Phase 1 broker 介绍 (broker-llm-agent) | 待定 (HIGH-RISK, 慎) | DM 链路 live |
| Phase 2 broker 可见+fee 透传 (prediction-agent-mind) | KANet-UI | Phase 1 |
| 真 DM 押注演示驱动 + 事后审 | Bettor | 全链路接通 |

## 6. 风险

- broker-llm-agent.js = HIGH-RISK Critical 8 (T-J1-19f 双 system msg 灾难史)。Phase 1 改 SYSTEM_PROMPT 必走完整 review + Tier 4 真链测 (守 KB 测试框架铁律: broker user-facing 必 Tier 4)。
- 松耦合优先 (broker 介绍→用户命令→FSM), 不一上来深度接管, 降 blast radius。

## 7. 团队共识 (2026-06-12 对抗)

**松耦合 vs 深度接管 → 松耦合胜 (各域 owner 实证):**
- **J1 (跨节点/determinism 域) ✅松耦合**: fee per-market 签 payload immutable, 松耦合不碰它 = 跨节点域看安全; 深接管碰 settle/fee 路 = 撞 determinism 铁律险。
- **J2 (settler/fee 域) ✅松耦合**: 深接管 = 高 blast radius (碰 FSM/betting/settle = 复杂度灌回 critical agent); 松耦合 = 最小改 (SYSTEM_PROMPT 补 + tool 列本 broker 活跃市场), 零 determinism/canonical 风险。
- NWT (parked, 挖矿优先后补) / KANet-UI (待表态)。

**Phase 1 验收标准 (J2 caveat 焊死):**
1. 用户 copy 全大白话, **0 impl-jargon** (禁 'broker_fee_pct' 等术语漏给用户) — 守 [[feedback-user-copy-no-impl-jargon]]。
2. broker **只介绍真经手的活跃市场** (broker_relay_id=本 broker AND status=active), 严禁幻觉编市场。
3. **Tier 4 真链 DM round-trip** 测 (非 /api/agent/reply mock) 才算 PASS。
4. **0 碰签名载荷/canonical** (fee 已在 settler 链上 immutable)。
5. 松耦合: broker 介绍→用户命令→现有 FSM, broker **不**内部调 FSM (降耦合)。
