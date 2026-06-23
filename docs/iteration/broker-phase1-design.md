# Broker Phase1 加强设计 (松耦合·J2-tn r723)

**共识**: 4/4 松耦合 (J1/J2/KANet-UI ✅, NWT ratify)。broker 介绍预测市场 → 用户命令 → FSM (已 KANet-UI 前置 M2 验通)。不碰下注/签名载荷/exchange 流。
**前置**: KANet-UI FSM 重接 (c952ac0b/5f171be1) M2 PASS — DM /predict → pool_markets → register-v06 → pool_bettor_sides 落链 (Bettor 独立核 landed)。
**owner**: J2 主 (NWT 挖矿完 ratify/协)。**HIGH-RISK**: broker-llm-agent Critical 8 (T-J1-19f 双 system-msg 灾难史)。

## scope (2 件, Owner bug② 纳入)

### ① SYSTEM_PROMPT 补 "介绍本 broker 活跃 pool 市场" 段
- 位置: broker-llm-agent.js SYSTEM_PROMPT, 接在 L105-115 (Oracle 信任分铁律 `{{trust_score}}`) 之后, 新增一段:
  - 触发: user 问 "有啥预测市场/能押啥/推荐/prediction market"。
  - 行为: 必调 `list_broker_prediction_markets` tool (= deterministic 数据, 不准 hallucinate 市场)。
  - 渲染: tool 返本 broker 经手的活跃 pool 市场 (title/deadline/双边池子/trust score) → broker 自然话介绍 + **必带 `{{trust_score}}` 翻译** (复用 L107 既有规则) + 引导 "进 /predict 下注 (我不碰你的钱, 你直接押链上)"。
- **铁律守**: ① 单 system-msg (D6 共识 L298-301, 不 unshift 第 2 个) ② `{{trust_score}}` lint hook (L115 grep) 不丢 ③ 最小改 (只加段, 不碰 exchange preview/finalize/verify/cancel 5 铁律) ④ 中文铁律 (L50)。

### ② markets-tool: `list_broker_prediction_markets`
- 新 TOOLS 条目 (broker-llm-agent.js L121 TOOLS array, OpenAI-function 风格同 preview_order):
  - `parameters: {}` (列本 broker 全部活跃市场, 无参)。
  - description: "user 问预测市场/能押啥/推荐时必调。返本 broker 经手的活跃 pool 市场列表 (deterministic), 你用真数据介绍 + 必带 trust score, 不准自己编市场。"
- handler (L420 区, name-based dispatch 加 `if (name === 'list_broker_prediction_markets')`):
  - 查 pool_markets WHERE broker_relay_id = <this broker> AND protocol_status = 'pending_bettors' AND protocol_version IN ('v0.6','v0.7') AND deadline > now (复用 KANet-UI fetchActiveMarkets filter 5f171be1 + kanet-broker.js `/api/kanet-broker/markets/:relay_id` 既有查)。
  - 返 [{title=resolution_rule_spec, deadline, yes_pool_kas, no_pool_kas, trust_score}] (trust_score 从 oracle reputation, 复用 {{trust_score}} 注入或 bettor.js:2230 reputation)。
  - **只读, 不碰签名/下注**。

### ③ broker 标记 recommended → counts.recommended (Owner bug②)
- 现状: predictions-list.eta L47 `🌟Broker推荐 (counts.recommended)` 是 UI 壳, counts.recommended=0 因 broker 推荐没通电。L70 `m._recommended` 驱动卡片高亮。
- 机制: broker_recommendations 表 (pool.js L2716 INSERT, L2765 br.recommended_at) + prevet-gate 推单 (pool.js L2650+ `/api/pool/broker-recommend`, broker 经 prevet 推荐市场) 已存在。
- Phase1 通电: broker 经手的市场 (broker_relay_id set) 中**经 prevet 高分** (tier=pass) 的 → 写 broker_recommendations → `_recommended` flag + counts.recommended。
  - MVP: seeder/create 建市后, 若 broker_relay_id set + prevet pass → 自动写 broker_recommendations (= broker 经手即推荐, 最小改)。OR broker DM agent 介绍市场时顺手标记。
  - predictions-list 端点 join broker_recommendations → 算 counts.recommended + `_recommended`。
- **不碰签名**: 纯 broker_recommendations 表 + UI counts 数据。

## 验证 (Tier4)
- throwaway broker relay → DM "有啥预测市场" → broker 调 list_broker_prediction_markets → 介绍本 broker 活跃市场 + trust score → 引导 /predict (接 KANet-UI FSM)。
- /predictions 页 `🌟Broker推荐` counts.recommended > 0 + 卡片高亮 (browser Owner 验)。
- 回归: exchange 流 (preview/finalize/verify/cancel) 零退化 (36 broker case + dm-agent case 重跑)。
- 双 system-msg lint (R37) + {{trust_score}} lint (L115) 绿。

## 风险 + caveat (守)
- broker-llm-agent HIGH-RISK Critical 8: 最小松耦合, 不碰现有 5 铁律 + exchange tool + 签名载荷。
- J2 3 caveat: 大白话不漏 impl-jargon (别 'broker_fee_pct'/'pool_markets') / broker 只介绍**实经手**市场 (broker_relay_id filter, 别幻觉) / Tier4 实链。
- 单 system-msg (D6): 新段进 SYSTEM_PROMPT literal, 不加第 2 个 system msg (T-J1-19f 灾难)。
