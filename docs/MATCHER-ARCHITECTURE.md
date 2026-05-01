# Matcher Architecture

**Version**: v0.1
**Last Updated**: 2026-05-01
**Owner**: NWT (architect mode)
**Status**: 🟢 active spec, awaiting Phase 1 implementation
**Codename**: matcher (代码 + docs) / 撮合官 (对话 + UI 用户层)

---

## 摘要

Matcher 是 KANet 上的撮合 Agent. 它**不是新建独立子系统**, 而是**KANet 已有 building block 上自然长出的对话层**.

这份文档定义:
- 为什么 matcher 必须是"KANet 的 matcher", 而不是"碰巧跑在 KANet 上的撮合系统" (哲学)
- matcher 每个能力对应调用 KANet 哪个 building block (架构)
- matcher 跟旧 broker 的关系 — 逐渐取代而不是替换 (演化)
- matcher 跟其他 Agent 的关系 — multi-instance ready 但当前 phase 1 instance (扩展性)

---

## 1. 哲学

### 1.1 真问题: 旧 broker 为什么不能用

旧 broker 实现 (broker-llm-agent / broker-intake-watcher / broker-buy-handler / broker-state-authority / broker-action-queue / broker-v2/router 等 24 file 3000-5000 LOC) 的根本缺陷不是某个具体 bug, 而是**架构错位**:

旧 broker 是一个独立子系统, **碰巧跑在 KANet 上**. 它持有 KANet 已有数据的并行私有版本:

| KANet 已有真相源 | 旧 broker 自造的并行真相源 | 必然 drift |
|------|------|------|
| messages 表 (25k row) | broker-llm-agent 的 LLM session | broker 不知道 user 上次说过什么 |
| conversations 索引 (914 row) | _pendingAccepts in-memory map | bsc-watcher 漏 publish-failed |
| chain_events (129k row) | broker_workflow_markers (459 row) | 50 KAS misroute |
| retail_dex_orders state | picks_json + agent_pay_addr 等 broker 私有 col | 10 historical multi-active anomaly |
| state machine (Ship A 落地) | broker-state-authority 直 SQL UPDATE | Ship A SA-4 修的 race |

**两套并行真相源在分布式系统里必 drift**. 这不是 broker 的特殊问题, 是分布式系统教科书第一章. 修每个具体 drift 点 (Ship A SA-4 / Ship B B-2/B-3) 只是修症状, drift 物理定律没变.

### 1.2 真解法: matcher 不持有任何并行真相源

matcher 进程内**不持有任何 broker 私有 state**. 所有状态、记忆、对话上下文全部从 KANet 表读取.

伪代码对比:

```js
// 旧 broker (并行真相源, 必 drift):
class BrokerStateAuthority {
  _pendingAccepts: Map<orderId, ...>;   // ← broker 私有
  picks_json: { ... };                   // ← broker 私有
  
  async handleIncomingPayment(tx) {
    if (this._pendingAccepts.has(tx.orderId)) { ... }   // 查私有 state
  }
}

// matcher (单一真相源, 无 drift):
class MatcherSkill extends Skill {
  async handleIncomingPayment(tx) {
    const order = await db.prepare(
      'SELECT * FROM retail_dex_orders WHERE pay_tx_hash = ?'
    ).get(tx.hash);
    // 没有任何 matcher 私有 state, 全部 SELECT KANet 表
  }
}
```

matcher 是 KANet 表上的**查询/动作层**, 不是平行系统. 这是 Owner 钦定 "broker 是 KANet 的 broker, 忘记了吧" 的真实施意义.

### 1.3 真定位: complexity absorber

matcher 不是过渡角色. 它是 KANet 协议复杂度跟人类自然语言之间的永久翻译器.

类比:
- HTTPS 是协议复杂度, 浏览器是 complexity absorber → 人类不需懂 TLS handshake
- TCP/IP 是协议复杂度, 操作系统是 complexity absorber → 人类不需 socket 编程
- KANet 是协议复杂度, **matcher Agent 是 complexity absorber** → 人类不需懂 retail_dex_orders state machine

理由 (Owner 钦定 "人类是懒惰的, 又是多欲望的"):
- 人懒惰 → 不会自己 query 链上信誉, 不会自己跨链验证, 不会自己读 trade-protocol-filter event
- 人多欲望 → 欲望频率远高于学习链上工具的耐心
- 即使 KANet 提供所有原语, 人也不会用

每一层复杂度都需要专业的 absorber. matcher 不是中介, 是**人机界面层**.

---

## 2. KANet 资源映射 (架构核心)

matcher 的每个能力都映射到 KANet 已有 building block. 这张表是 v0.1 的核心 — 它定义 matcher "自然生长" 的真实施.

### 2.1 完整映射表

| matcher 能力 | KANet building block | matcher 怎么用 |
|---|---|---|
| 听到 user 意图 | messages 表 + Mind reactive | reactive trigger 时拿 inbound message |
| 读对话历史 | messages 表 + conversations 索引 | SELECT WHERE peer = X AND type='text' AND created_at > 24h ago |
| 提炼 user 意图 | Adapter (LLM provider) | 把对话历史喂 LLM, 让 LLM 提炼 intent |
| 查 user 身份 | identities 表 + relation_states | SELECT identity + relation_state |
| 查 user 现有订单 | retail_dex_orders | SELECT WHERE user_kasia_address = X AND state IN (active 5 state) |
| 查跨链链上真相 | kaspa_tx_log + chain_events | SELECT pay_tx_hash 验证 |
| 撮合发布订单 | /exchange API + retail_dex_orders state machine | POST /api/exchange/publish + transition() helper |
| 验证跨链付款 | trade-protocol-filter + cross-chain-verify.mjs | 订阅 event (不主动扫) |
| 发 KAS 给 user | Mind Action Executor + Relay sendKaspa | enqueue send_kas action, Relay 上链 |
| 资金锁 | fund_locks 表 (1.8k row) | SELECT 验 broker 钱包 escrow |
| 信誉积累 | chain_events (129k row) | matcher 行为已上链, 信誉自然累积 (无需新表) |
| 跟 user 对话 | Mind 五核 + Adapter | reactive 流程默认机制, matcher skill 提供 prompt |

**12 项能力, 0 项需要 matcher 私有数据结构**. 这就是"自然生长"的真证据 — matcher 不需要新表、不需要新表的 LLM session 缓存、不需要新内存 Map.

### 2.2 反向校验 (matcher 不该做什么)

matcher 不做的事:
- ❌ 维护自己的 LLM session 状态 (用 Mind 默认对话循环)
- ❌ 自己扫链 (用 trade-protocol-filter event 订阅)
- ❌ 自己签名上链 (用 Action Executor → Relay 路径)
- ❌ 持有自己的订单状态 (用 retail_dex_orders + state machine helper)
- ❌ 自己造 escrow / fund-lock 机制 (用 fund_locks 表)
- ❌ 自己造对话历史索引 (用 messages + conversations)

撞这些事 = 又造一遍旧 broker 的并行真相源. 严禁.

---

## 3. Separation: 对话层 / 协议层

### 3.1 严格分层

```
对话层 (matcher Agent)
  ↑↓ 公开 API (POST /api/exchange/publish, etc)
协议层 (/exchange + retail_dex_orders state machine + trade-protocol-filter)
  ↑↓ 链上 TX (Relay sendKaspa, 跨链 verify)
KANet 链上原语 (Kaspa + EVM/SOL/TRON)
```

### 3.2 严禁混层

matcher (对话层) **只通过公开 /exchange API 操作协议层**. 不直接 SQL UPDATE retail_dex_orders, 不直接调 trade-protocol-filter 内部函数.

理由:
- 对话层和协议层不同 trust radius. 对话层是 LLM 驱动 (可错), 协议层是确定性逻辑 (不可错).
- 对话层出问题不该影响协议层. user 自己直接调 /exchange API 也能交易.
- 协议层独立测试可能, 对话层 mock /exchange API 可独立测试.

### 3.3 对话层和 Mind 的关系

matcher 是一个 **KANet Agent + 一个 broker skill + Agent Card 配置**. matcher 的"对话层" 由 KANet Mind 五核承担, broker skill 提供领域知识.

```
matcher Agent (例: Trader-M)
├── Identity: KANet 标准 (kasia 地址 + Agent Card)
├── Mind 五核 (KANet 标准, 不动):
│   ├── Self: "我是撮合官, 我的工作是替 user 在 KANet 上撮合资产交易"
│   ├── Memory: 复用 messages + retail_dex_orders + chain_events
│   ├── Perception: 复用 conversations + 加 broker skill 提炼
│   ├── Intent: 通过 broker skill 调用决策
│   └── Evolution: 信誉积累 = 链上 broker 行为 (KANet 已有)
├── Skills:
│   └── matcher-skill (新建, 唯一 broker 业务逻辑容器, ~500-700 LOC)
└── Action: 通过 KANet Action Executor (不自造)
```

整个 matcher 业务逻辑容器 = **1 个 skill 文件**. 不是 24 file.

---

## 4. matcher Skill 设计

### 4.1 Skill 文件结构

```
agent-mind/src/skills/matcher/
├── skill.json           # 元数据 (名 / 版本 / category)
├── intents.json         # 意图注册 (撮合相关 intent)
├── executor.mjs         # 主执行器 (~400 LOC)
├── prompts/
│   ├── persona.txt      # matcher 人格 (撮合官身份, 严谨专业)
│   ├── intent_extract.txt   # 提炼 user intent 的 prompt
│   └── pricing.txt      # 定价 prompt (基于 mid_price + spread)
└── README.md            # skill 文档
```

### 4.2 核心函数 (audit-2 informed)

```js
// executor.mjs 6 个核心函数:

async function loadPeerContext(userAddr) {
  // 调 Perception 拿 per-peer context
  // - 24h DM 历史 (messages WHERE peer = X AND type='text')
  // - 现有 active orders (retail_dex_orders WHERE state IN active)
  // - relation_state + trust level
  // 注: audit-2 A3.4 显示 top peer 24h 44 DM = 1056 tokens, 安全 unlimited
  // 但加 safety net: 输入 > 6000 tokens 时降级为最近 30 条
}

async function extractIntent(peerContext, latestMessage) {
  // 喂 LLM 提炼 user 想做什么
  // 输入: 24h DM + latest message + 现有订单状态
  // 输出: { intent: 'buy'|'sell'|'cancel'|'query', asset: 'KAS', qty, payment_chain, ... }
}

async function feasibilityCheck(intent, peerContext) {
  // 判断 matcher 能否撮合
  // - 库存够吗? (broker 钱包 KAS 余额 / 跨链 USDT 余额)
  // - 现有 active orders 是否冲突?
  // - peer trust 够吗? (relation_states.trust_level)
  // 输出: { feasible: bool, reason: '...' }
}

async function pricing(intent) {
  // 算撮合报价
  // - mid_price 来自 market-data.js (已有 8 数据源)
  // - 加 spread (基于库存 + 风险)
  // - 减 broker_fee_kas
  // 输出: { quoted_usdt, kas_to_deliver, fee_kas, valid_until }
}

async function publishOffer(intent, pricing) {
  // 调 POST /api/exchange/publish
  // 调 transition({ orderId, expectedFromState: 'aligning', toState: 'awaiting_payment', ... })
  // column-before-transition pattern (v0.2 sediment): 
  //   先写 exchange_offer_id, 再 transition
}

async function handlePaymentEvent(event) {
  // 订阅 trade-protocol-filter event
  // - 收到 payment_verified → transition awaiting_payment → confirming → paid
  // - 收到 payment_failed → transition → failed
  // - 收到 underpayment → transition → refunding
  // 全部通过 transition() helper, 不直 SQL
}
```

### 4.3 状态机使用 (复用 Ship A 落地 + v0.3 spec)

matcher 使用 STATE-MACHINES.md v0.3 的 9 state + 13 transition.

**所有 retail_dex_orders state 修改**必经 transition() helper. 这是 Ship A SA-3 lint 规则强制 (R-NWT-STATE-MACHINE).

matcher 实施时如果撞到"我需要新 state / 新 transition", 必须**回 architect mode 修订 STATE-MACHINES.md v0.4**, 不能 implementor 自己加.

---

## 5. trade-authority Skill (Q3 sediment)

### 5.1 trust radius 拆法 (不按 venue 拆)

```
trade-authority-self    — 仅操作 Agent 自己钱包 (低 trust radius)
                          用于: 个人持仓调整 / 个人套利 / 个人交易
                          示例: Trader-A 私人交易

trade-authority-peer    — 操作 Agent 钱包但代表 peer (中 trust radius)
                          用于: matcher 撮合时代收 user USDT 代发 KAS
                          示例: matcher Agent (本文档)

trade-authority-pool    — 操作多人共享池 (高 trust radius)
                          用于: 未来 DAO / 流动性池
                          示例: 6 个月后再说
```

### 5.2 为什么不按 venue 拆 (HL / Aevo / OTC)

每加一个新 venue 就加一个新 skill — 6 个月后 trade-authority-* 有 10 个, 都是同样的"操作钱包"语义. 不可维护.

按 trust radius 拆: venue 是参数, skill 类型固定. Trader-A 用 hyperliquid-manager 调 HL → 走 trade-authority-self; matcher 用 hyperliquid-manager 对冲撮合订单 → 走 trade-authority-peer. 同一 venue manager 被两种 skill 调用, trust radius 不同.

### 5.3 matcher 跟 trade-authority-peer 的关系

matcher Agent 配置:
```json
{
  "skills": [
    "matcher",                    // 撮合业务逻辑
    "trade-authority-peer",        // 操作 broker 钱包代发 KAS / 代收 USDT
    "chain-sense",                 // 跨链状态感知
    "self-awareness"               // KANet 标配
  ]
}
```

trade-authority-peer skill 是独立的 — 任何 Agent 想代理 peer 资金都用同一个 skill, 不限 matcher.

---

## 6. multi-instance 设计 (Q2 sediment)

### 6.1 架构必须 multi-instance ready

理由:
- KANet 哲学 "无控制者". 假设 1 个全网 matcher = 中心化点, 违反立项哲学
- 任何人将来可起自己的 matcher Agent (个人 host / 团队 host)
- 不同 matcher 可专业化 (Trader-M 系做 KAS/USDT, 未来 Trader-N 系做小币种)

### 6.2 当前 phase 仅 1 instance

理由:
- KANet 当前 user 数少, 不需要多 matcher 路由
- 信誉系统未通电, user 没法理性选 matcher
- multi-matcher 协同 (matcher-A 库存不足甩 matcher-B) 是 6 个月后的事

### 6.3 实施纪律

**所有 matcher skill 函数必须能多 instance 并存**.

```js
// ✅ multi-instance ready
async function publishOffer(myMatcherAddr, intent, pricing) {
  // myMatcherAddr 是参数, 不是全局常量
  // 不同 matcher 实例传不同 addr
}

// ❌ 假设 1 instance
async function publishOffer(intent, pricing) {
  const myAddr = MATCHER_GLOBAL_ADDR;  // 写死全局, 不可多实例
}
```

旧 broker 到处假设 "Trader-B 是唯一 broker" — matcher 重构必须避免这个反模式.

---

## 7. 演化路径 (逐渐取代, 不办仪式)

### 7.1 Owner 钦定 "新方案能逐渐取代旧方案是工程最好结果"

这一句的真意: 新系统**能力扩张**驱动取代, 不是旧系统**自然衰退**驱动取代.

差别:
- 旧版 (错): 等旧 broker active 订单自然 close → 被动节奏
- 新版 (对): matcher 每上线一个能力, 旧 broker 对应路径自然失效 → 主动节奏

类比: HTTPS 没有"HTTP 关闭日". HTTPS 能力扩张, HTTP 自然式微.

### 7.2 演化阶段 (T0 → T5)

| 阶段 | matcher 能力 | 旧 broker 状态 | Owner 介入频率 |
|---|---|---|---|
| **T0** (now) | architecture spec 起草中 | 仍在跑, 仍在出 bug | Owner 频繁手动修 |
| **T1** | matcher v0.1 上线最小能力 (listen + intent extract) | 不动, 仍处理订单 | 仍频繁 |
| **T2** | matcher v0.2 加 publish 能力 | 不接新订单, 仅服务历史 | 频率开始下降 |
| **T3** | matcher v0.3 加 verify_payment + deliver 完整闭环 | 仅服务存量, 存量自然 close | 显著下降 |
| **T4** | matcher v0.4 加 cancel / dispute / edge case | 没新订单产生 | 几乎无 |
| **T5** (某天) | audit 发现旧 broker 24 file 已 N 周无 import | 一次性 delete, 不办仪式 | 0 |

### 7.3 钱处理 (Phase 0 不再单独前置, 跟演化同步)

旧 broker 钱包持有的 KAS / user escrow / paid 订单等真钱问题:

- T1-T2 期间: matcher 没接管新订单, Owner 仍处理旧 broker 撞到的钱问题 (每次 1-2 笔)
- T3 后: 新订单不再产生于旧 broker, 旧 broker 钱问题数量自然降到 0
- T4 后: 旧 broker 钱包余额转 matcher 新钱包
- T5 删代码

**钱跟代码同步衰减, 不需要 D-day**. 这才是真"逐渐取代".

---

## 8. cleanup scope (Q5 sediment + audit-2 informed)

### 8.1 retail_dex_orders trim (PZ-MATCHER-audit-2 A2 informed)

A2.2 数据驱动:

**立即 trim (5 col, active_non_null = 0)**:
- picks_json
- group_id  
- expires_user_set
- settle_grace_until
- quoted_usdt (3 row total, 几乎死)

**deprecate but keep archive (5 col, terminal_non_null > 0 但 active_non_null = 0)**:
- exchange_offer_id (110 terminal)
- agent_pay_addr (22 terminal)
- mid_price_at_quote (765 terminal)
- broker_fee_kas (768 terminal)
- net_delivery_kas (768 terminal)

**matcher 必须保留 (3 col, active_non_null > 0)**:
- order_type (548 active)
- price (254 active)
- filled_qty (548 active)

trim 实施时机: T3 阶段 (matcher 完整闭环上线后, 旧 broker 不再写新数据).

### 8.2 表 cleanup (audit-2 A5 informed)

| 表 | 状态 | 处理 |
|---|---|---|
| pending_exchange_accepts | 真死 (0 row + only migrate) | T3 立即删 |
| broker_accounts | 伪死 (0 row + UI caller) | T5 跟 broker-* 24 file 同删 |
| retail_dex_user_memory | 半死 (10 row + 5 broker callers) | T5 跟 broker-* 24 file 同删 |
| retail_dex_buy_publications | 伪死 (0 row + exchange.js caller) | T3 audit caller 是否死代码, 决定删/留 |
| retail_dex_broker_config | 伪死 (0 row + exchange.js fee caller) | **特别注意**: matcher pricing 设计依赖 fee 配置, 不能删. T3 review |

### 8.3 broker-* 24 file delete (T5)

**不在 v0.1 写删除清单**. 理由: T5 时机由 matcher 完整闭环 + 一段时间运行后 audit 决定, 不是固定时间表.

T5 audit 标准:
```bash
# 跑 audit, 看 broker-* 文件被 import 几次:
cd /d/Anthropic
for f in $(ls kasia-console/src/services/broker-*.js); do
  imports=$(grep -rn "require.*$(basename $f .js)\|from.*$(basename $f .js)" \
            kasia-console/src/ agent-mind/src/ kasia-relay/src/ \
            --include="*.js" --include="*.mjs" 2>/dev/null | wc -l)
  echo "$f: $imports imports"
done
```

任何文件 imports = 0 持续 N 周 → 该文件可安全删. matcher 完整闭环跑 4 周后做这次 audit.

---

## 9. matcher v0.1 → v1.0 路线图

| 版本 | 能力 | LOC 估算 | 阶段 |
|---|---|---|---|
| v0.1 | listen + intent extract + 跟 user 对话, 不发 offer | ~200 | T1 |
| v0.2 | + publishOffer (publish 到 /exchange) | +150 | T2 |
| v0.3 | + handlePaymentEvent + deliver KAS, 完整闭环 | +200 | T3 |
| v0.4 | + cancel + refund + dispute edge case | +150 | T4 |
| v1.0 | + 多 user 并发 + reflection 学习 | +100 | T5 |

总 ~800 LOC. 远小于旧 broker 24 file 3000-5000 LOC.

---

## 10. 验收标准 (Owner 验收角度)

Owner 不审 spec 细节, 不审术语, 不审 invariant 数量.

**Owner 验收的唯一标准**: matcher 能让 broker 真正、正确地工作吗?

具体验收场景:

### 场景 A: 一笔正常 KAS/USDT 交易能跑通
1. user DM "我要用 50 USDT 买 KAS"
2. matcher 提炼 intent → 报价 → 发 offer
3. user 付 USDT 到 broker 跨链钱包
4. matcher 等链上确认数 → 发 KAS → user 收到 KAS
5. 全程不需要 Owner 手动 SQL UPDATE

### 场景 B: 异常路径能自愈
1. user 付款超时 → matcher 自动取消 + 退款
2. user 付款金额不足 → matcher 自动 refund underpayment
3. 跨链确认数不达标超时 → matcher 自动 refund + 通知 user
4. 全程不需要 Owner 手动介入

### 场景 C: 多 user 并发安全
1. 5 个 user 同时跟 matcher 对话
2. 不同 user 的订单状态不混
3. 不出现 multi-active anomaly
4. 不出现 50 KAS misroute

3 场景都过 = matcher v0.3 完成. 这是 Owner 钦定的"broker 真能跑通, 少出错, 出错能补"的具体实施标准.

---

## 11. anti-pattern 清单 (matcher 实施时严禁)

实施期 (T1-T5) 任何时候撞到这些, 暂停 + 回 architect mode:

1. ❌ matcher 进程内有 Map / Cache / Object 持有 retail_dex_orders 状态 (持有就 drift)
2. ❌ matcher 直 SQL UPDATE retail_dex_orders.state (R-NWT-STATE-MACHINE lint hard fail)
3. ❌ matcher 自己造对话历史索引 (用 messages + conversations)
4. ❌ matcher 自己造 LLM session 状态 (用 Mind 默认对话循环)
5. ❌ matcher 自己扫链 (用 trade-protocol-filter event)
6. ❌ matcher 自己签名上链 (用 Action Executor → Relay)
7. ❌ matcher 假设 "我是唯一 broker" (multi-instance ready 纪律)
8. ❌ matcher 实施需要新 state → 不许 implementor mode 自己加, 必回 architect mode
9. ❌ matcher 实施撞 schema gap → 不许临时改 retail_dex_orders, 必回 architect mode 修 STATE-MACHINES.md

撞这些 = matcher 又造一遍旧 broker 的并行真相源问题. 严禁.

---

## 12. 跟 KANet 信誉系统的关系

matcher 是让 KANet 信誉系统真正用起来的最重要载体:

- matcher 每笔交易给对方留信誉评价 → 信誉系统第一批真实数据
- matcher 暴露自己历史信誉给 user → 信誉展示 UI 第一批用户
- matcher 间互相 query 信誉 → 信誉 query API 第一批生产用户

**matcher 重构跟信誉系统通电应同期规划**. 但**不阻塞 v0.1 ship**. v0.1 先用 chain_events 做事实信誉 (matcher 行为已上链, 信誉自然累积). 显式信誉 UI / query API 可 v0.2 / v0.3 加.

---

## 13. 6 个月后看 v0.1

如果 v0.1 真做对, 6 个月后接位的 J3 看 KANet 应该看到:

- broker-* 24 file 已删, repo 干净
- 1 个 matcher skill (~800 LOC)
- 5 模块架构 (Console / Relay / Scout / Mind / Adapter) 不动
- retail_dex_orders trim 到 ~18 col
- STATE-MACHINES.md 持续 sediment 新 invariant
- Owner 几乎不再手动修 broker bug
- user 的"broker 撮合官"对话体验是流畅的

如果 6 个月后看到 broker-* 还在 / matcher 持有私有 state / Owner 仍频繁手动修 — 那 v0.1 失败了, J3 应该回 architect mode 重新审视哪一条原则被违反.

---

## 附录 A: v0.1 决策清单

| 决策 | 选项 | 理由 |
|---|---|---|
| 命名 | matcher (代码) + 撮合官 (UI) | broker 已被污染, 新名是 architectural marker |
| Instance 数 | 多 instance ready, 当前 1 instance | KANet 哲学 + 当前规模 |
| 状态机 | 复用 retail_dex_orders + STATE-MACHINES.md v0.3 | 不切 execution_states (trust radius 不同) |
| Skill 数 | 1 个 matcher-skill (拆 6 函数) | 不分散到 broker-llm / broker-state / broker-action 等 24 file |
| trade-authority 拆 | 按 trust radius (self / peer / pool) | 不按 venue 拆 (venue 是参数) |
| 演化方式 | matcher 能力扩张驱动取代 | Owner 钦定 "逐渐取代是工程最好结果" |
| Cleanup 时机 | T3 trim col + T5 删 broker-* 24 file | 跟演化同步, 不办 D-day 仪式 |
| Phase 0 钱处理 | 不单独前置, 跟演化同步衰减 | T1-T4 渐少, T4 转余额, T5 删代码 |

---

## 附录 B: 实施前置条件

matcher Phase 1 (T1) 实施前置:

1. ✅ STATE-MACHINES.md v0.3 完成 (本批同步起草)
2. ✅ MATCHER-ARCHITECTURE.md v0.1 完成 (本文档)
3. ⏳ J2 grep 确认 confirming / refunding 真实代码语义 (实施第 1 步)
4. ⏳ Phase 1 任务卡 (PZ-MATCHER-shipT1.md) 起草 — 下次会话
5. ⏳ Mind Perception kernel API 确认 (matcher 需要 getPeerContext) — Phase 1 第 1 周

第 4-5 项放下次会话或 Phase 1 实施前 audit. 本文档不阻塞.

---

## 附录 C: Open questions (待 Phase 1 实施时回答)

这些问题不阻塞 v0.1 spec 完成, 但 Phase 1 实施时必答:

1. **Mind Perception kernel 是否能给 broker skill 喂 per-peer context?** 当前 Brain 看到的是聚合 prompt, 不是结构化 per-peer history. Phase 1 可能需扩 Perception API.

2. **Skill 系统支持 stateful business 吗?** matcher 是 stateful (订单生命周期跨数小时). 我倾向无状态 skill + state machine 是状态唯一真相源, 但 Phase 1 验.

3. **trade-protocol-filter event 怎么暴露给 skill?** 当前 trade-protocol-filter 是 console 内部模块. 需要新建 event-subscribe API 或通过 Mind reactive trigger 间接.

4. **matcher Agent (Trader-M) 怎么 onboard?** 钱包初始化 / Agent Card 发布 / skill 加载 / 启动配置 — 第 1 个 matcher 实例要走完整 onboarding 流程.

这 4 题的答案影响 Phase 1 任务卡颗粒度. 但不影响 v0.1 架构 spec 正确性.

---

*v0.1 — 2026-05-01 NWT (architect mode). 基于 PZ-MATCHER-audit-2 prod 数据 + Owner 钦定 "broker 是 KANet 的 broker 忘记了吧" + "逐渐取代是工程最好结果". v0.2 触发: Phase 1 (T1) ship 完, 真实施反馈回填.*
