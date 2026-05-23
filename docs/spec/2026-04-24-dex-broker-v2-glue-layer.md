# Dex-Broker v2 Spec — Broker as Glue Layer

> **日期**: 2026-04-24
> **作者**: Opus J2 (基于 Owner 6 轮纠正形成)
> **版本**: v2.1.1 (2026-04-25 微更新: B 模式只走 exchange_offers 协议, 不接 mm-otc/CEX, KANet 协议层纯姿态)
> **基础**: v2.1 (2026-04-24 J1 + QClaude 审校 + Owner 北极星凝练)
> **状态**: 讨论稿 (整合共识, 待 Owner 最终确认后进入 Phase 1)
> **替代**: `docs/spec/2026-04-23-dex-agent-v1.md` (v1 方向已识别偏离)
> **审校对象**: Owner (Martin) · J1 Opus · QClaude · NWT · 其他协作 AI

---

## 摘要 (TL;DR)

v1 spec 由 J1 Opus 在 2026-04-23 设计，把 broker 当**独立业务实体**做：独立表 (`retail_dex_*`)、独立 skill (`retail-proxy`)、独立 API (`/api/broker/*`)、独立状态机、独立 dialog、独立 memory、独立 profile —— 合计约 2000 行代码，全部是**重复建设已有 Mind/exchange-machine 基建** 或 **偷 seeker/taker 的活**。

Owner 在 2026-04-24 用 6 轮对话纠正了这个方向。核心认知：

**broker 不是一个新实体，是一种 Agent 的使用模式。粘合是 Agent 本来就有的能力，不是某一层专属模块。**

但 v1 不全错 —— **卖 KAS 场景"用户转 KAS 给 broker" 天然丝滑，是不可否认的实用价值**。这份 spec 保留 v1 中 sell 场景的架构合理性，同时把 broker 从"新造实体"回归到"启用 Mind 粘合能力的普通 Agent"。

**北极星**（Owner 2026-04-24 凝练）：

> **broker 四步职责链：弄清用户需求 → 形成可执行订单 → 传给 seeker / taker → 过程关键跟踪反馈、结果及时反馈**

任何 broker 设计偏离这四步就是走歪。

**四个核心主张**：
1. **四步即全部**：broker 不是新实体，是 Agent 执行这四步的"使用模式"。交易能力归 seeker / taker，broker 只粘合
2. **双模式并存**：A 撮合（买 KAS 首选，零费）+ B 代持（卖 KAS 首选，显性费三重公开），用户对话决定走哪条
3. **兜底优先于模式**：用户会乱打款，broker 必须监听自己地址入账并有容错路径。退款 gas broker 吃。这比"首选 A 还是 B"更重要
4. **所有粘合能力用已有基建**：对话/记忆/proactive/画像/信誉/订单状态机全在 Mind + exchange-machine 里，不新建模块，预计新增代码 < 210 行

---

## 一、背景：为什么写这份 spec

### 1.1 v1 的具体偏离

v1 spec 明文写：
> "Dex-Agent v1 定位：本 Owner 旗下 **Broker + Seeder + Taker 一体**"
> "v71: `retail_dex_broker_config` Broker 撮合费及元配置"
> "**撮合费隐形收** — Maker 少发 KAS 在后端实现"

按 v1 spec 产生的实体：
- 5 个新表：`retail_dex_orders` / `retail_dex_broker_config` / `retail_dex_buy_publications` + v72/v73 字段扩展
- 5 个新文件：`retail-dex.js` (1123) + `retail-dex-dialog.js` (390) + `retail-dex-memory.js` (232) + `retail-dex-pusher.js` (90) + `retail-dex-profile.js` (155) = **1990 行**
- 1 个新 skill：`retail-proxy` (唯一为 Trader-B 启用的 skill，其他 30 个 skill 全 disabled)
- 1 个新字段：`relay_nodes.is_dex_broker`
- 1 个新 API：`/api/broker/stats`
- 1 个 UI Tab：exchange.eta Broker tab
- 1 个绕路：`conversations.js:118-130` 绕开 Mind 白名单

### 1.2 与 KANet-Positioning 的矛盾

`docs/KANet-Positioning.md:65`:
> **KANet 不做什么：不撮合交易，不托管资金，不设定价格，不审核参与者**

`kanet-free-market.md:59`:
> **协议层面，它支持任何两种标的之间的点对点撮合 ... 如果你想让市场真正自由，协议就不能包含对标的的主观判断**

`KANet的意义.txt:83`:
> **费用都是次要的，关键是尽量减少了暗箱操控**

v1 的"撮合费隐形收 + Maker 少发 KAS" = **精确命中 KANet 禁忌**（给粘合层加价格权力 + 不透明）。

### 1.3 Owner 2026-04-24 六轮纠正原话

每一轮都是一层认知突破，必须沉淀：

| 轮次 | Owner 原话 | 纠正的认知 |
|---|---|---|
| 1 | "broker 就是 seeker 和 taker 的粘合剂，关键在粘合能力，而不是基础能力" | broker 不该有交易能力 |
| 2 | "挂单，接单能力都要硬，特别是小额 ... 他们是相辅相成 ... 现在是 Kas 的标的，未来变成其他很容易的" | seeker/taker 才是真能力，broker 是粘合 + 未来资产泛化 |
| 3 | "已有部件不止你列出来的，还有之前一套基础设施，且经过检测的" | 调查不完整，Mind 30 skill 都是现成能力 |
| 4 | "主要是 seeker 和 taker 已经跑通！retail 也都是重复建设" | retail-dex 五文件 = 重复 + 偷活 |
| 5 | "broker 如果新建，就稍微偏离了航向" | 任何"为 broker 新建"都是偏离 |
| 6 | "撮合是 broker 的核心能力，其他有多大用？" | 不是盲目叠加 skill，核心是撮合用户需求 |
| 7 | "万一用户不明白，打了款又怎么办？无论什么理念，我们都要从实际场景出发" | 兜底比模式选择更核心；理念不能压倒实际场景 |

### 1.4 真正的锚点

锚在 `KANet-Positioning.md` 的**三原语**：
1. **安全通信** (Kasia)
2. **身份与发现** (Agent Card + Scout)
3. **价值结算** (Kaspa 链上)

KANet 只建地基不造房子。broker 是房子里的一个角色，不是地基的一部分。

---

## 二、broker 的本质

### 2.1 粘合 ≠ 中间层

错误心智模型：broker 是 user 和 seeker/taker 之间的**中间层**，所以要"建一套"。

正确心智模型：broker 是 **让 user 不用直面协议的前台**。自身没有业务逻辑，所有复杂度藏在 Agent 本来就有的对话/记忆能力里。

类比：餐厅服务员。客人不用知道厨房怎么运转，服务员听需求 → 记住偏好 → 传进厨房 → 报进度 → 送上菜。**服务员不是厨师，不是另一个餐厅。**

### 2.2 broker 的四步职责链（北极星）

Owner 2026-04-24 凝练：

> **弄清用户需求 → 形成可执行订单 → 传给 seeker 或者 taker → 过程关键跟踪反馈、结果及时反馈**

这四步是 broker 的**唯一**职责链。任何 broker 设计偏离这四步就是走歪。

每一步在 KANet 已有基建里都有现成位置：

| 步骤 | 职责 | 已有基建 | broker 独有判断 |
|---|---|---|---|
| **1. 弄清需求** | 听懂用户说什么（任何语言 / 模糊表达 / 断续对话） | `llm-dispatcher.callLlm` + Mind adapter + `conversational-ops/intents.json` + `memory.mjs` 跨会话上下文 + `address_profiler` 老客户画像 | 对话中不断澄清；缺字段主动追问；用户含糊时给选项 |
| **2. 形成订单** | 把用户意图翻译成协议层结构（side / asset / amount / chain / price / ...） | `exchange_offers` schema + `validateOrder` + `confirm-store` 30s token | 双方对齐确认（用户点头才落单）；费率明示；资金来源核对 |
| **3. 传给 seeker / taker** | broker **不自己执行**，只把订单路由到底层 | A 撮合 → `autoTaker` + `exchange_offers`；B 代持 → 收 KAS 后 `market-seeder.publishOffer` 在 exchange_offers 协议上挂 SELL 单 | 决策"传给谁"：按市场深度 / 费率 / 用户偏好选 seeker 或 taker 路径。**只走 exchange_offers 协议，不接外部 CEX** (v2.1.1 校准, KANet 协议层纯姿态) |
| **4. 跟踪反馈** | 过程中关键节点主动 DM；结果及时同步 | `chain_events` 订阅 + `exchange-machine.transition` + Mind `triggerProactive` + `retail-dex-pusher.js` 模板可迁移 | 决策"何时主动 DM"：不刷屏，只报关键节点（accept / paid / delivered / timeout / fail） |

**四步全部走已有基建**。broker 独有代码 = 四步之间的"粘合判断" + 跨用户意图存储，预估 <210 行。

#### 2.2.1 记忆画像是辅助，不是第五步

`memory.relationships[peer].notes[]` + `address_profiler` 不是独立的第五步能力，而是**让四步每一步都更准**的后台支撑：
- 第 1 步更准：老客户不用重新自我介绍
- 第 2 步更准：沿用用户习惯链 / 默认收款地址
- 第 3 步更准：知道该给这个用户推荐哪类 maker
- 第 4 步更准：知道用户多久不回是正常节奏

画像是镜头，不是步骤。**broker 不能为了"建画像"而建画像**。

### 2.3 broker 不做什么（严格边界）

**能力边界**：
- ❌ **不做平台撮合**（禁忌，违反 KANet-Positioning — "broker 代用户找对手方" 不等于"平台撮合所有人"）
- ❌ **不设价格**（Maker 自己定价，broker 只展示 / 推荐）
- ❌ **不审核参与者**（reputation 是建议，不是门禁）
- ❌ **不亲自挂单**（市场挂单是 seeker 的活；broker 可以帮用户挂，但由 seeker 路径执行）
- ❌ **不亲自接单**（接单是 taker 的活；broker 可以帮用户接，但由 taker 路径执行）

**收益边界**（Owner 2026-04-24 + J1 审校 M2）：
- ❌ **不收隐形费**（禁忌，违反无暗箱原则）
- ❌ **无被动收益**（代持期间产生的孳息 / 延迟结算的市价套利 / 跨链时间差 — 即使非主动抽成，也违反 KANet 透明原则）
- ⚠ **可收显性费**（A 撮合零费 / B 代持显性费，但必须三重公开：Agent Card + 对话确认 + chain_events）

**实现边界**：
- ❌ **不建自己的订单表**（用 exchange_offers）
- ❌ **不建自己的状态机**（用 exchange-machine）
- ❌ **不建自己的 dialog**（用 Mind）
- ❌ **不建自己的 memory**（用 memory kernel）
- ❌ **不建自己的 pusher**（用 proactive pipeline）
- ❌ **不需要 `is_dex_broker` 标签**（任何 Agent 都能粘合）
- ❌ **不需要专属 API**（`/api/agents/*` 通用 endpoint 够用）
- ❌ **不需要"单 skill 屏蔽其他"**（Trader-B 30 skill disabled 的错设计；粘合需要多 skill 协作 — 对话 + 记忆 + proactive + 画像 + social-outreach 合奏）

---

## 三、双模式架构

### 3.1 模式 A · 撮合（买 KAS 首选）

**适用场景**：用户想买 KAS，需要付 USDT（跨链 BSC/ETH/SOL/TRON 选一）

**流程**：
```
用户 DM broker: "我想买 50 KAS"
  ↓
Mind 对话 (多语言) → 识别意图: side=buy_kas, qty=50
  ↓
broker 查 exchange_offers 现有 open 卖单
  ↓
有匹配: "@maker 挂了 50 KAS @ 0.034U，你用 BSC 付款，他会直接把 KAS 发你。确认走这单?"
无匹配: "当前没合适卖单,我帮你挂 BUY offer 在 0.033,等人接。或者你改市价接现有最优 @ 0.035?"
  ↓
用户确认 → broker 代触发 autoTaker accept OR 直接告知用户操作步骤
  ↓
用户 USDT 直付 Maker 地址 (不经 broker 钱包)
  ↓
Maker 收到 USDT → 链上验证通过 → 发 KAS 给用户 Kasia 地址
  ↓
broker DM 用户: "KAS 到账 ✓ 链上可查: [tx]"
```

**broker 在这条路径上做的事**（对应四步职责链）：
1. **弄清**：听懂买 KAS / 多少 / 哪条链付款
2. **形成订单**：`exchange_offers` 现有 open 卖单匹配 OR 帮用户挂 BUY offer
3. **传给 taker**：触发 `autoTaker.accept` 或让用户自己接 — broker 不自己挂单不自己 accept
4. **跟踪反馈**：Maker 收到 USDT → 验证通过 → 发 KAS 到账，每一步主动 DM

**费率**：**零费**。broker 不收 USDT，用户 USDT 直付 Maker，broker 没有介入资金流，自然没有收费基础。

**broker 不做的**：不收 USDT，不代持，不改协议流程，不自己撮合规则（Maker 价格自己定）。

**Fallback**（J1 审校 1c 提出）：如果 Maker 没配 `maker_auto_pay`（即 Maker 不自动发 KAS），broker 要能识别 → DM 用户"Maker 需手动发货，我帮你催 / 等他响应"，不能假设所有 Maker 都跑 auto-deliver。具体实现落 Phase 4。

### 3.2 模式 B · 代持（卖 KAS 首选）

**适用场景**：用户想卖 KAS 换 USDT，不愿意挂单等接单方

**流程**：
```
用户 DM broker: "我想卖 50 KAS 换 USDT 到我 BSC"
  ↓
Mind 对话 → 识别意图: side=sell_kas, qty=50, payout_chain=bnb
  ↓
broker 询问收款地址 (如果用户画像没存过) OR 直接用画像里的默认地址
  ↓
broker 公开挂牌费率 (例如 0.5% 或 0.1 KAS/单) — retail_dex_broker_config
  ↓
broker DM 用户: "好。请把 50 KAS 发到这个 kaspa 地址: kaspa:qrxw...
             我收到后代卖成 USDT 发到你 0x...BSC 钱包
             费率: 0.1 KAS (约 $0.003) 已扣在 KAS 里
             预计 10 分钟内完成"
  ↓
用户 Kasia 转账 50 KAS → broker
  ↓
broker 收到入账 (链事件) → Mind 识别 "有 peer_X intent=sell 50 KAS 的转账"
  ↓
broker 在 exchange_offers 协议上 publish SELL 单 (v2.1.1 校准):
  · 调 market-seeder.publishOffer (give:KAS, want:USDT, target_chain=用户 pay_chain)
  · fund-lock 锁 KAS 防超发
  · 等接单方 (autoTaker 或外部用户) 在协议上 accept
  ↓
接单方按 kanet-exchange 协议把 USDT 直发用户 pay_address
  ↓
broker 监听 exchange-machine.transition completed → 链上证据齐
  ↓
broker DM: "✓ USDT 已到你 [chain]: [tx]"
```

**broker 在这条路径上做的事**（对应四步职责链）：
1. **弄清**：听懂卖 KAS / 多少 / 收款到哪条链哪个地址
2. **形成订单**：公开挂牌费率（0.5% 或 0.1 KAS/单，取大值），用户 YES 才落单
3. **传给 seeker**：收到 KAS 入账后，调 `market-seeder.publishOffer` 在 exchange_offers 协议上挂 SELL KAS for USDT 单 — broker 不自己做市不接外部 CEX，只是路由到 KANet 协议层能力 (v2.1.1 校准)
4. **跟踪反馈**：代卖开始 / 成交 / USDT 转出 / 失败 每一步主动 DM

**费率**：**扣 KAS 不扣 USDT**（QClaude 审校提出）。原因：用户收到的 USDT 数字干净（整数或简单小数），不会出现 "预计 1.700 USDT 实到 1.693 USDT" 这种尾数问题；KAS 这边反正要切割出 fee。

**费率三重公开**：
1. **Agent Card 声明**（`service_terms.sell_kas.fee`）— 全局静态快照
2. **对话确认**（报价时 broker 说出"收 0.1 KAS 做服务费"）— 交易时刻
3. **chain_events 记录**（`broker_fee_kas` 字段）— 链上可审

### 3.3 为什么两种模式都必要

**买 vs 卖的操作成本不对称**：

| 场景 | 用户操作成本 | A 撮合 | B 代持 |
|---|---|---|---|
| 买 KAS | 付 USDT (跨链, 选链 + EVM 签名) | **合理** (用户本来就要跨链) | 多此一举 (broker 没有多加值) |
| 卖 KAS | 发 KAS (Kasia 原生一步) | **不合理** (要挂单+等+再发) | **合理** (一步完成) |

用户的"丝滑度"取决于最小操作步数。

### 3.4 模式切换由对话决定

不需要用户懂"A 模式 / B 模式"。broker 在对话里自然引导：

- 用户说"买" → broker 默认推 A
- 用户说"卖" → broker 默认推 B
- 用户偏好 / 金额大小 / 历史信任度 → 可能修正默认选择

---

## 四、兜底机制（最核心，先于模式选择）

### 4.1 为什么兜底是核心

Owner 2026-04-24 原话：
> "万一用户不明白，打了款又怎么办？无论什么理念，我们都要从实际场景出发"

**用户会不懂协议**。对话里 broker 提到地址，用户本能想"直接发过去最省事" —— 这是人性，不是 bug。broker 如果没有兜底，系统在用户偏离剧本时直接崩。

**兜底 = 粘合成熟度的真实试金石。**

v1 spec 漏掉这一整块，是它不配称"粘合"的核心原因。

### 4.2 入账监听流程（全用已有基建）

**已有材料**：
- Scout 扫全链，`chain_events` 已记录所有 KAS 转账
- Mind proactive tick 每 N 分钟运行
- `memory.relationships[peer].notes[]` 可写可读
- Kasia DM 通道已通
- Relay 有 sendKas 能力（退款用）

**新增逻辑（~50 行，挂在 Mind proactive pipeline）**：

```
每次 Mind proactive tick for Trader-B:
  扫 chain_events WHERE to_address = Trader-B.kaspa_addr
                    AND event_type = 'kas_received'
                    AND observed_at > last_tick_at
                    AND NOT IN processed_events
  
  for each unprocessed receive:
    peer = event.from_address
    amount = event.amount
    intent = lookupRecentIntent(peer, within_hours=24)
    
    if intent == 'sell_kas' and amount ≈ intent.qty:
      → 进入代持路径 (模式 B)
      → DM peer: "收到你 {amount} KAS ✓ 开始代卖..."
      → 在 exchange_offers 上 publish SELL 单 (v2.1.1 校准, 不接 mm-otc/CEX)
    
    elif intent == 'buy_kas':
      → 识别为"操作错误" (用户应该付 USDT, 却发了 KAS)
      → DM peer: "你是想买 KAS 对吧? 这 {amount} KAS 我先收着
                  要我代卖成 USDT 再付给你,还是退回?"
      → 等响应
    
    elif intent is None:
      → DM peer: "收到你 {amount} KAS,你想做什么?
                  代卖/继续持有/退回"
      → 12h 无响应 → 自动退款 (broker 吃 gas, 不从用户款里扣)
    
    elif peer in blacklist:
      → 立即退款, 不 DM (broker 吃 gas)
    
    标记 event_processed
```

**gas 承担策略硬编码**：所有非用户请求的退款（兜底场景），broker 吃 gas。
- 理由：退款本来就是 broker 为"未预期入账"兜底，责任在 broker 能力完整度
- 用户感知：发 50 KAS 回来还是 50 KAS（数字干净，信任建立）
- broker 成本：单笔 gas ~0.0001 KAS 约 $0.000003，小到可忽略
- 风险控制：高频垃圾攻击走反滥用拉黑，不会持续消耗 gas

### 4.3 四种入账场景的兜底表

| 场景 | 识别特征 | broker 响应 |
|---|---|---|
| **意图一致** | memory 有 `sell_kas qty≈amount` note | 自动进入代持 B，DM 告知开始 |
| **意图反向** | memory 有 `buy_kas`（用户应付 USDT 却发 KAS） | DM 询问代卖或退回，等确认 |
| **无意图** | memory 无最近意图 | DM 询问目的，12h 超时自动退款 |
| **黑名单** | reputation 拉黑 / 反滥用触发 | 立即退款，不对话 |

### 4.4 极端场景覆盖

- **broker 此刻下线** → 资金留链上，Scout 的 chain_events 持续记录。broker 重启后读未处理事件补做兜底。
- **金额不对** → 按实际到账金额处理。发少了 → 按比例代卖；发多了 → 多出部分询问用户。
- **链路错误** → 用户发 USDT 到 broker EVM 地址（本来应该发 KAS）→ 同一套逻辑迁移到 agent_wallets 入账监听。
- **垃圾攻击** → 单 peer 同天 > N 次入账视为垃圾，自动退款 + 加速反滥用拉黑。
- **接单超时 (2h 无 autoTaker / 外部 taker accept)** → 自动退回用户原 KAS (broker 吃 gas) (v2.1.1 校准: 不再 fallback 外部 CEX)。

### 4.5 兜底不是可选项

v2 spec 明文主张：

> **broker 对"未经协议的入账" 的响应质量 = 粘合成熟度的直接指标。
> 任何 broker 实现都必须先通过兜底测试，再谈模式优化。**

---

## 五、技术实现映射

### 5.1 复用已有基建清单

| 能力 | 已有位置 | 用法 |
|---|---|---|
| 多语言对话 | `kasia-console/src/services/llm-dispatcher.js` | broker 通过 Mind 调用，不自建 |
| 统一订单机 | `kasia-console/src/services/exchange-machine.js` (904) | 买单走 autoTaker accept，卖单走 seeder publish |
| 自动接单 | `kasia-console/src/services/trade-protocol-filter.js:453` autoTaker | reputation 门禁 + 市价对比全在里面 |
| 挂单自动化 | `kasia-console/src/services/market-seeder.js` (392) | broker 代卖走同一 seeder 逻辑 |
| 资金锁 | `kasia-console/src/services/fund-lock.js` (127) | 防超发 |
| 跨链验证 | `kasia-console/src/services/cross-chain-verify.mjs` (506) + kaspa_tx_log v60 | 付款真实性 |
| 信誉评估 | `kasia-console/src/services/reputation.js` (225) | 黑名单 + 风险降额 |
| Mind 对话 | `kasia-console/src/services/mind-manager.js` + agent-mind/src | 社交闸 + 优先级队列 + 全 skill |
| 对话意图 | `agent-mind/src/skills/conversational-ops/` (215) | query/execute 14 个意图 |
| ~~OTC 做市~~ | ~~`agent-mind/src/skills/mm-otc.mjs`~~ | ~~代卖路径~~ — **v2.1.1 废**, broker 只走 exchange_offers 协议, 不接 CEX |
| 用户画像 | `agent-mind/src/skills/address-profiler.mjs` | 陌生人 vs 熟客 |
| 自我感知 | `agent-mind/src/skills/self-awareness.mjs` | 库存/连接/状态 |
| 主动 DM | `mind-manager.triggerProactive` | 进度推送 |
| 记忆 | `agent-mind/src/kernels/memory.mjs` (203) | per-peer notes + context |
| 确认 Token | `agent-mind/src/confirm-store.mjs` | YES/NO 30s TTL |
| ~~CCXT~~ | ~~mm-otc 已集成~~ | ~~外部 CEX 代卖~~ — **v2.1.1 废**, broker 不接外部交易所 |
| EVM 转账 | `kasia-console/src/services/evm-transfer.js` | broker 发 USDT 给用户 |

### 5.2 新增代码量估算

| 新增功能 | 挂在哪里 | 预计行数 |
|---|---|---|
| 入账事件扫描 + 兜底路由 | Mind proactive pipeline (broker 专属扩展点) | ~80 |
| 跨用户意图池（sell 意图 DM 存储） | memory.addRelationshipNote (用现有) | 0 新增 |
| 代持代卖触发 (v2.1.1) | 复用 market-seeder.publishOffer + exchange-machine, 不接 mm-otc | ~30 |
| 兜底退款函数 | 复用 Relay sendKas | ~20 |
| 费率公开展示 (Agent Card 字段 or broker_config) | UI 读展示 | ~30 |
| 意图匹配 (跨用户撮合建议) | Mind proactive 扫 sell intent vs buy intent | ~50 |
| **合计** | | **~210 行** |

**对比**：v1 retail-dex/* 五文件合计 1990 行，新方向 < 210 行。**代码减少 90%**，能力反而更完整（因为 Mind 的基建全部接入）。

### 5.3 数据表策略

**废除**（v1 的专属表，任何 broker 新 intent 不再写入）：
- `retail_dex_orders` — 订单走 `exchange_offers` 和 `mm_orders`
- `retail_dex_buy_publications` — 挂单走 `exchange_offers`

**保留改造**：
- `retail_dex_broker_config` → 改名 `agent_service_terms`（不专属 broker，任何 Agent 都能挂自己的服务条款）
- `is_dex_broker` 字段 → 改名 / 删除，改为 Agent Card 里声明服务能力

**已有直接复用**（无需改）：
- `exchange_offers` — 协议订单真相源
- `mm_orders` — OTC 代卖订单
- `chain_events` — 入账监听
- `relation_states` — 信誉
- `agent_wallets` — 多链钱包
- `relay_nodes` — Agent 身份

---

## 六、费率透明（替代"隐形收"）

### 6.1 为什么"隐形收"违反 KANet 原则

v1 原文："撮合费是 Owner 内部分账，对用户隐形"
KANet 原文："费用都是次要的，关键是尽量减少了暗箱操控"

**隐形 = 暗箱**。即使 Owner 自己操作是诚实的，不透明本身就违反 Kasia "链上一切可验" 的精神。

### 6.2 透明挂牌方案

**三层透明**：

1. **Agent Card 声明**：broker 的 Kasia Agent Card 里写 `service_terms` 字段，任何人 Scout 到就能看见
   ```json
   {
     "entity_type": "dex_assistant",
     "service_terms": {
       "buy_kas": "撮合免费 (我不抽成, 你直付 Maker)",
       "sell_kas": "代卖抽 0.5% 或 0.1 KAS/单取大值",
       "refund_policy": "12h 未确认自动退款, 扣实际 gas 不多扣"
     }
   }
   ```
2. **对话明示**：每次报价 broker 必须说出费率
   > "50 KAS 代卖，费率 0.1 KAS (约 $0.003)，实到 USDT 约 X.XX，你确认走?"
3. **链上可查**：每笔代卖订单 `chain_events` 记录 `broker_fee_kas` 字段

**费率挂起来用户能选**：
- 多个 broker 竞争 → 用户选费率低/信誉好的
- `KANet的意义.txt:39`：**"多个 MM Agent 同时报价 ... 用户看到三个报价，选最优的私信过去"**

---

## 七、废除与保留清单

### 7.1 废除（7 条）

| 物件 | 偏离原因 |
|---|---|
| `retail-dex.js:347 selectBestOffer` | 偷 autoTaker.selectBestOffer |
| `retail-dex.js:404 computeQuote` | 偷 autoTaker 报价 + 部分吃单算账错误 |
| `retail-dex.js:926 broadcastAcceptV1` | 偷 taker accept，应走 handleExchangeAccept |
| `retail-dex.js:790 _triggerBuyPublication` | 偷 market-seeder 挂单能力 |
| `retail-dex.js:98 createOrder → retail_dex_orders` | 订单应进 exchange_offers，不建专属表 |
| `retail-dex-dialog/memory/pusher/profile` 四文件 867 行 | 100% 重复 Mind 已有基建 |
| `conversations.js:118-130` 绕开 Mind 白名单 | 丢掉多语言/反骚扰/社交认知/priority queue |

### 7.2 保留（3 条）

| 物件 | 为什么保留 |
|---|---|
| `retail_dex_broker_config` 表 | 改名通用化，做"Agent 服务条款声明"载体 |
| Agent "Trader-B" 本身 | 他是粘合角色的 Agent 实例，保留 |
| UI exchange.eta 的服务条款展示板块 | 改为通用"Agent 能力公示"，不 broker 专属 |

### 7.3 保留但改造（2 条）

| 物件 | 改造方向 |
|---|---|
| v1 的双模式理念（A 撮合 / B 代持） | 保留，写入本 v2 spec |
| v1 的"Broker + Seeder + Taker 同 Owner 多 relay" | 保留 —— 这是 Owner 内部运营实情，合理 |

---

## 八、认知教训沉淀

### 8.1 Owner 原话档案（供所有 AI 学习）

**1. "broker 就是 seeker 和 taker 的粘合剂，关键在粘合能力"**  
Why: broker 不该有交易能力。交易是 seeker/taker 的活。  
Apply: 任何让 broker"自己挂单/自己接单/自己验证"的设计都是越界。

**2. "现在是 Kas 的标的，未来变成其他很容易的"**  
Why: 协议不能对标的主观判断。写死 KAS 就封死了未来扩展。  
Apply: 代码里禁止 `if asset == 'KAS'`。所有资产逻辑走协议字段。

**3. "调查不完整 / 已有部件不止你列出来的"**  
Why: AI 太快下结论，没扫完基础设施。  
Apply: 新建前必 grep 15+ 已有 service 文件 + agent-mind/src/skills 全目录。

**4. "retail 都是重复建设"**  
Why: 看见已有代码就默认是对的 → 跟着扩 → 重复造轮子。  
Apply: grep 到类似能力时必问"为什么不能复用" — 证据不足才允许新建。（J1 审校：避免过度否定存量走向另一极端，保留代码默认可信，复用优先）

**5. "broker 如果新建，就稍微偏离了航向"**  
Why: 任何"为 X 新建"都是偏离。  
Apply: 新建是末选，整合/复用是首选。新建前必填三问：① 已有哪些类似能力 ② 为什么不能复用 ③ 这是不是又一个 retail-dex。

**6. "撮合是 broker 的核心能力，其他有多大用？"**  
Why: 盲目叠加 skill 不如精准找到核心。  
Apply: 设计前先问"这个能力是不是 broker 独有价值"，不是就剔除。

**7. "无论什么理念，我们都要从实际场景出发"**  
Why: 理念（如 "KANet 不托管"）不能压倒实际场景（如 "sell KAS 场景用户转 broker 天然丝滑"）。  
Apply: 理念是锚，不是教条。具体场景可合理突破教条，只要对齐锚心。

**8. "单 skill Agent 不是粘合"**（J1 审校 M1 观察）  
Why: v1 retail-dex 设计把 Trader-B 30 skill disabled 只保留 `retail-proxy` 一个 — 这本身违反粘合定义。粘合需要多 skill 协作（对话 + 记忆 + proactive + 画像 + social-outreach 合奏）。  
Apply: 任何"给 broker 只开一个 skill 屏蔽其他"的配置即违规。Trader-B 至少需 6 skill 同时 active：`conversational-ops / self_awareness / address_profiler / social_outreach / price_tracker / market_scanner`（交易类 skill 不启用，broker 不做交易）。

### 8.2 J1 / J2 / QClaude 协作陷阱

v1 spec 陷阱复盘：
- **J1 写 spec 时"模型→实体"翻译失真**：Owner 说"broker 是角色"，J1 写进代码就变成"broker 是实体"（独立表/API/skill）
- **QClaude 执行 spec 不反问**：spec 让建什么就建什么，不质疑"这个新表是否必要"
- **Smoke test 盖住了架构问题**：所有 T1-T9 单元都 PASS，但整个方向错了
- **没有 spec 审校环节**：J1 写完 spec 直接进 T1，Owner 来不及审"方向"，只能审"任务"

**v2 防陷阱机制**：
1. spec 先过 Owner + 至少另一个 AI 审校，再写 T 任务
2. 任何 T 任务前必须追问"这和已有基建什么关系"
3. Smoke test 除了功能还要过"方向对齐"检查（对照本 spec）

### 8.3 元教训：文档 → 代码 翻译失真

AI 看文档会按训练先验"模型化"。文档说"broker"，AI 脑子里浮现的是"券商实体"，不是"角色模式"。

**防失真**：
- spec 明文写"不是什么" 比 "是什么" 更重要
- spec 用 **反例** 而不是 **正例** 表达
- 每个命名决策要有"为什么不叫 X"
- ANTI-PATTERNS.md 强制作为 spec 前置阅读

---

## 九、Open Questions（团队讨论）

以下问题本 spec 暂不给死答案，留给审校环节：

### 9.1 费率透明的具体形式 · **定案 (J1)**
**三者结合，按时刻分职责**：
- **Agent Card `service_terms`** = 声明时刻（链上快照，改一次上链 TX，不频繁调整）
- **对话明示** = 交易时刻（每次报价 broker re-confirm，防用户没看 Card）
- **`agent_service_terms` 表** = 运营时刻（费率 daily adjust 不必每次上链，由 Agent 自己维护）

### 9.2 跨用户意图池存储
- 用 `memory.relationships[peer].notes` 够不够？
- 还是要加 `chain_events` event_type='user_intent'（全局可查但半隐私）？
- 意图 TTL 多久（24h / 7 天 / 永不过期）？

### 9.3 入账监听频率
- Mind proactive tick 现有间隔多久？
- 兜底响应最长容忍延迟（用户发款后多久 broker 必须 DM）？
- 如果 5s 级需求，是否需要 event subscriber 而非 polling？

### 9.4 代持资金池风险上限 · **定案 (J1)**
公式：`代持 KAS 上限 = Agent 当前 USDT 余额 × (1 / KAS_price) × (1 / 2)`
- 2x 安全余量防市场波动
- Agent Card 动态广播 `current_capacity` 字段
- 用户意图 > capacity → 走"金额不对 / 发多了"场景子集
- 没 USDT 库存就不收 KAS，风险自动脱敏

### 9.5 与 v1 retail-dex 数据共存 · **定案 (J1 + QClaude)**
**选 (c) 保留历史只读**：
- (a) 字段不 1:1（`broker_fee_kas` 无对应列）
- (b) 通知 peer 成本高 peer 可能已忘
- (c) 最低成本，历史可审，将来整理再 DROP。配合 Phase 1 给表头加 `⚠ DEPRECATED in v2` 注释

### 9.6 conversations.js 路由策略
- 彻底删 broker 白名单 → 所有 Agent DM 一律走 Mind
- 还是保留"broker DM 有快速路径" → 但快速路径调 Mind 而不是 retail-dex
- 前者更纯，后者兼容好

### 9.7 UI Broker tab 去向 · **定案 (J1 + QClaude)**
**改名 "Agent Services"**：
- 动态渲染所有 Agent Card 含 `service_terms` 字段的 Agent
- Trader-B 只是第一个，将来 Trader-A/C 或第三方 Agent 都能用
- 现有"公开声明板块"正好对应 `service_terms` 展示，语义拔高零损耗

### 9.8 兜底退款的 gas 承担 · **定案 (QClaude + Owner 场景优先原则)**
**broker 吃**（已落 §4.2）：
- 用户体验优先（50 KAS 原数返回，信任建立）
- 单笔 gas ~$0.000003，成本可忽略
- 高频垃圾走反滥用拉黑

### 9.9 多 broker 竞争场景
- 当有 Trader-A / Trader-C 也开粘合服务，用户怎么发现选择?
- 需不需要一个"broker 列表页"(但这又像 "platform"，违反 KANet 原则...)
- 或者完全交给 Scout + Agent Card 发现?

---

## 十、实施路线图（等讨论定稿再动代码）

本路线图仅为讨论参考，**在 spec 确认前不动任何代码**。

### Phase 0 · Spec 审校 (本阶段 · 2026-04-24)
- [x] 本 spec 草稿产出
- [ ] Owner 审校纠偏（第一优先）
- [ ] J1 Opus 审校（v1 作者的自我纠正）
- [ ] QClaude 审校（执行者视角）
- [ ] 解决 Open Questions 9 条

### Phase 1 · 认知基建（不动交易代码）
- [ ] ANTI-PATTERNS.md 写入 retail-dex v1 作为第一个 case
- [ ] v1 spec 文件头注释 `⚠ SUPERSEDED BY v2`
- [ ] retail-dex/* 五文件头加 `⚠ DO NOT EXTEND` 警告
- [ ] hook 阻断 `Write/Edit` 任何 `retail_*` / `broker_*` 命名
- [ ] dev-coord 通告所有协作 AI 停止按 v1 执行

### Phase 2 · broker 能力激活（配置改，不新代码）
- [ ] 启用 Trader-B 的真正粘合 skill（conversational-ops / memory / proactive / social-outreach）
- [ ] 关闭 `retail-proxy` skill（回归 Mind 主路）
- [ ] Trader-B adapter 从 qwen3-coder-480b 换对话模型
- [ ] `conversations.js:118-130` 删除绕开 Mind 白名单
- [ ] Agent Card 写入 service_terms

### Phase 3 · 兜底机制（~80 行新代码）
- [ ] Mind proactive pipeline 扩展点：入账事件扫描
- [ ] 四种入账场景路由实现
- [ ] 退款函数 (复用 sendKas)
- [ ] smoke test 覆盖 4 种场景

### Phase 4 · 双模式对接
- [ ] 模式 A 撮合：broker 对话 → 引导用户到 exchange_offers 或 autoTaker
- [ ] 模式 B 代持：入账后在 exchange_offers 协议上 publish SELL KAS for USDT 单 (v2.1.1, 不接 mm-otc)
- [ ] 进度推送走 Mind proactive

### Phase 5 · v1 残骸清理
- [ ] retail-dex/* 五文件归档（不删但移出 services 主目录）
- [ ] `retail_dex_orders` 历史数据处理（按 Q 9.5 决议）
- [ ] UI Broker tab 改造（按 Q 9.7 决议）

---

## 结语

这份 spec 的根本出发点是 **Owner 2026-04-24 原话第七条**：

> "无论什么理念，我们都要从实际场景出发"

KANet-Positioning 是锚，不是教条。v1 spec 完全忽略用户会乱打款 → 违反实际场景。本 v2 spec 完全教条执行"不托管" → 也会违反实际场景。

**真正的航向**（北极星四步 + 四条原则）：
- 四步职责链 = broker 唯一工作内容（弄清 → 订单 → 传给 → 反馈，不越界不缩水）
- 粘合 = Agent 本来就会的事（不用新造）
- 兜底 = 粘合成熟度的试金石（不能漏）
- 透明 = KANet 的灵魂（不能破）
- 双模式 = 实际场景的如实反映（不能二选一）

—

**本 spec 是讨论草稿，一切待 Owner + 团队审校后再定稿再动代码。**

—

*元标记：本 spec 由 Opus J2 在 Owner 6 轮纠正的直接指导下写成。所有"看起来是设计决定"的地方都是"试图把 Owner 原话翻译成工程语言"的产物。如审校中发现任何处 AI 理解偏离 Owner 原意，以 Owner 纠正为准，AI 翻译失真是常态，需反复校准。*
