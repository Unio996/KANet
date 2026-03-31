# KAS Market Maker — System Design

## 一句话

一个 KANet Agent，用万能脑 + 做市技能，提供 KAS 跨链买卖服务。
不写一行新系统，证明"万物皆可 KANet Agent"。

## 定位

```
不是交易所（不撮合、不托管、不控制）
是做市商（自己的钱、自己的价、自己的风险）
是 KANet Agent（和 Martin、Sophie 一样的 Agent，只是技能不同）
```

## 为什么是 Agent 而不是独立系统

trade_advisor 证明了 Agent 能用技能赚钱。
MM 把这条路走到底：Agent 不只是卖分析，还能做生意。

```
trade_advisor：  用 trade_sense 分析 → 收 0.001 KAS → 卖报告
KAS-MM：         用 trade_sense 报价 + mm_otc 接单 → 收 USDT → 卖 KAS

同一个脑子，同一套协议，连技能都大量复用。
```

如果 MM 是独立系统，它需要自己实现：消息加解密、链上通信、身份管理、AI 理解、行情获取、交易所下单……
作为 Agent，这些全由 KANet 提供。MM 只需要加两个新技能：OTC 订单管理和跨链验证。

这证明：任何商业，装上合适的技能，就是一个 KANet Agent。

## 架构

```
┌───────────────────────────────────────────────────────┐
│                KANet（已有基础设施）                     │
│                                                        │
│  Console ─── Relay ─── Adapter ─── AI Brain            │
│     │          │          │                             │
│     │     Kasia 协议    万能脑                          │
│     │    (广播+私信)   (理解意图)                        │
│     │                                                  │
│  ┌──┴──────────────────────────────────────────────┐   │
│  │             MM Agent Mind                        │   │
│  │                                                  │   │
│  │  ┌─ 现成技能（插座接外部管道）────────────────┐   │   │
│  │  │ CCXT           → 110+交易所 行情/下单/对冲  │   │   │
│  │  │ Etherscan V2   → 60+ EVM 链跨链验证        │   │   │
│  │  │ solscan-mcp    → Solana 跨链验证            │   │   │
│  │  │ tron_mcp_server → TRON 跨链验证             │   │   │
│  │  │ CoinGecko MCP  → 聚合价格/市场总览          │   │   │
│  │  │ ethers.js      → EVM 链 USDT 转出           │   │   │
│  │  │ tronweb        → TRON USDT 转出             │   │   │
│  │  │ solana-web3    → Solana USDT 转出           │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  │                                                  │   │
│  │  ┌─ 自研（MM 核心商业逻辑）───────────────────┐  │   │
│  │  │ mm_otc → OTC订单状态机/报价/分批/客户限额   │  │   │
│  │  └──────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                        │
└──────────┬────────┬────────┬────────┬─────────────────┘
           │        │        │        │
       Kaspa 链   MEXC    Etherscan  Solscan/TronGrid
      (KAS结算)  (CCXT)   V2(EVM)   (SOL/TRON)
```

## 技能来源

MM 不写一行交易所代码、不写一行区块链验证代码。全用现成管道：

```
能力                  现成方案                     说明
──────               ──────                      ──────
交易所行情/深度/K线    CCXT (npm, 41k stars)        110+ 交易所统一 API
交易所下单/查单/撤单   CCXT                         替代手写交易所签名
交易所对冲            CCXT                         库存偏离 → createOrder()
聚合价格/市场总览     CoinGecko MCP (官方)           零代码接入
EVM 跨链验证          Etherscan API V2              1 个 key 覆盖 ETH/BNB 等 60+ 链
Solana 跨链验证       solscan-mcp                   MCP Server 直接用
TRON 跨链验证         tron_mcp_server               MCP Server 直接用
EVM USDT 转出         ethers.js                     行业标准
Solana USDT 转出      @solana/web3.js               官方 SDK
TRON USDT 转出        tronweb                       官方 SDK

自研                  mm_otc                       OTC 订单状态机（核心竞争力）
```

KANet 不造桥，造插座。桥已经满世界都是了。
mm_otc 是做市商的商业逻辑，市面上没有也不该有——这是 MM 自己的核心竞争力。

## 与 trade_advisor 的对照

| 维度 | trade_advisor | KAS-MM |
|------|--------------|--------|
| 类型 | 服务技能 | 服务技能 |
| 卖什么 | 交易分析 | KAS |
| 收什么 | 0.001 KAS | USDT（跨链） |
| 现成技能 | trade_sense | CCXT + CoinGecko MCP + Etherscan V2 + solscan + tron |
| 自研 | 无 | mm_otc（OTC 状态机，唯一自研） |
| 激活方式 | reactive（关键词） | reactive（订单意图） |
| ACTION | 无（纯分析） | VERIFY_PAYMENT, SEND_KAS, PLACE_ORDER(对冲) |
| 风控 | 无 | 库存/限额/价格偏离 |

## 支持的交易对

| 买方付款链 | 付款币种 | 收到 | 结算链 |
|-----------|---------|------|-------|
| BNB Chain | USDT/USDC | KAS | Kaspa |
| Solana | USDT/USDC | KAS | Kaspa |
| Ethereum | USDT/USDC | KAS | Kaspa |
| TRON | USDT | KAS | Kaspa |
| Kaspa | KAS | USDT | 买方指定链 |

Agent 自己决定接哪些链，通过 Mind config 配置。

## 核心交易流程

### 买 KAS（用户视角）

```
1. 用户在广播频道看到报价（bcast 协议，公开）：
   [KAS-MM] SELL KAS @ 0.0363 | Accept: USDT(BNB,SOL,ETH,TRON) | Limit: 5000 KAS

2. 用户发 Kasia 私信给 MM（comm 协议，端到端加密）：
   "buy 2755 KAS, paying 100 USDT on BNB"

3. AI 大脑理解意图 → trade_sense 提供实时价格 + mm_otc 检查库存 → 回复：
   "确认：2755 KAS @ 0.0363 = 100.03 USDT
    请转 USDT 到 0xABC...（BNB 链）
    有效期 10 分钟"

4. 用户转 100 USDT → BNB 链上 TX

5. 用户发私信："已转，TX: 0xDEF..."
   AI 大脑发出 [ACTION:VERIFY_PAYMENT chain=bnb txHash=0xDEF... amount=100]
   cross_chain_verify 技能调 BSCScan API 验证到账

6. 验证通过 → [ACTION:SEND_KAS to=kaspa:qUser... amount=2755]
   Console Relay transfer 发送 KAS

7. 完成。链上可查。
```

### 卖 KAS（用户视角）

```
1. 用户看到广播报价：
   [KAS-MM] BUY KAS @ 0.0359 | Pay: USDT(BNB,SOL,ETH,TRON) | Limit: 5000 KAS

2. 用户发私信：
   "sell 3000 KAS, want USDT on SOL"

3. AI 大脑 → trade_sense + mm_otc → 回复：
   "确认：3000 KAS @ 0.0359 = 107.7 USDT
    请发 KAS 到 kaspa:qMM...
    收款后 USDT 发到您的 SOL 地址"

4. 用户发 3000 KAS → MM 的 Kaspa 地址
   Relay 自动感知 KAS 到账（payment 协议）

5. AI 大脑确认收款 → [ACTION:SEND_USDT chain=sol to=UserSOLAddr amount=107.7]
   cross_chain_verify 执行跨链转出

6. 完成。
```

## 技能详细设计

### mm_otc（唯一自研 — MM 核心商业逻辑）

所有外部数据（行情/验证/转账）都通过现成管道获取。mm_otc 只管 OTC 特有的商业逻辑：

```javascript
// agent-mind/src/skills/mm-otc.mjs
class MmOtcSkill extends Skill {
  canActivate(taskType, context) {
    if (taskType === 'reactive') {
      return this.matchKeywords(context.message, ['buy','sell','购买','出售','order','订单']);
    }
    if (taskType === 'proactive') {
      return true;  // 定时广播报价 + 检查库存偏离
    }
    return false;
  }

  async gatherContext() {
    // ---- 通过现成管道获取外部数据 ----
    const ticker = await ccxt.fetchTicker('KAS/USDT');       // CCXT
    const kasBalance = await getRelayBalance();               // Console API
    const usdtBalances = await getMultiChainBalances();        // ethers/tronweb/solana

    // ---- 以下是 MM 自己的商业逻辑 ----
    const spread = this.config.spreadPct;                     // 0.05%
    const buyPrice = ticker.last * (1 - spread);
    const sellPrice = ticker.last * (1 + spread);

    const activeOrders = await this.db.getActiveOrders();
    const customerHistory = await this.db.getCustomerHistory(this.peerAddress);

    const target = this.config.targetKasBalance;
    const deviation = kasBalance - target;

    return {
      ticker, kasBalance, usdtBalances,
      buyPrice, sellPrice,
      activeOrders, customerHistory,
      deviation,
      needsRebalance: Math.abs(deviation) > this.config.rebalanceThreshold
    };
  }

  formatForBrain(data) {
    return `== MM OTC ==
Market: ${data.ticker.last} | BUY: ${data.buyPrice} | SELL: ${data.sellPrice}
KAS stock: ${data.kasBalance} | USDT: ${JSON.stringify(data.usdtBalances)}
Active orders: ${data.activeOrders.length}
Customer: ${data.customerHistory.length} completed, ${data.customerHistory.disputes} disputes
${data.customerHistory.length === 0 ? '⚠ NEW CUSTOMER — first-trade limit 500 KAS' : ''}
${data.needsRebalance ? `⚠ INVENTORY DEVIATION: ${data.deviation} KAS — hedge via PLACE_ORDER` : 'Inventory balanced'}`;
  }
}
```

### 现成管道（不写代码，接上就用）

```
跨链验证 ACTION 处理器：

  VERIFY_PAYMENT { chain, txHash, expectedAmount, toAddress }
    chain=bnb/eth → Etherscan API V2（1 key 覆盖 60+ EVM 链）
    chain=sol     → solscan-mcp
    chain=tron    → tron_mcp_server

  SEND_USDT { chain, to, amount }
    chain=bnb/eth → ethers.js（ERC20 transfer）
    chain=sol     → @solana/web3.js（SPL transfer）
    chain=tron    → tronweb（TRC20 transfer）

交易所操作（对冲）：

  PLACE_ORDER / CHECK_ORDER / CANCEL_ORDER
    → CCXT 统一 API（110+ 交易所，一套代码）
```

## ACTION 类型

MM 新增的 ACTION（在 mind.mjs 的 ACTION 循环中处理）：

| ACTION | 参数 | 说明 |
|--------|------|------|
| VERIFY_PAYMENT | chain, txHash, expectedAmount, toAddress | 跨链验证到账 |
| SEND_KAS | to, amount | 通过 Relay transfer 发 KAS |
| SEND_USDT | chain, to, amount | 跨链发 USDT（卖 KAS 场景） |
| CREATE_MM_ORDER | side, kasAmount, price, chain, customerAddress | 创建 OTC 订单 |
| UPDATE_MM_ORDER | orderId, status | 更新订单状态 |

现成管道 ACTION（通过 CCXT / Etherscan / MCP 执行）：

| ACTION | 管道 | MM 用途 |
|--------|------|---------|
| PLACE_ORDER | CCXT | 对冲下单（任何交易所） |
| CHECK_ORDER | CCXT | 查对冲订单状态 |
| CANCEL_ORDER | CCXT | 撤对冲单 |
| READ_ORDERBOOK | CCXT | 看深度（辅助定价） |
| VERIFY_PAYMENT | Etherscan V2 / solscan-mcp / tron_mcp_server | 跨链验证 |
| SEND_USDT | ethers.js / solana-web3 / tronweb | 跨链 USDT 转出 |
| WAIT | 内置 | 等待确认 |

## 报价广播（proactive 行为）

mm_otc + trade_sense 在 proactive 周期同时激活，AI 大脑看到 MEXC 实时价格 + OTC 库存状态，决定是否广播：

```
Brain 输出：
[ACTION:SEND_BROADCAST channel=kas-market message="[KAS-MM] BUY 0.0359 | SELL 0.0363 | Stock: 8500 KAS | Accept: USDT(BNB,SOL,ETH,TRON)"]

→ Mind 执行 → Console POST /api/chat/send → Relay 广播上链
```

同时可选更新 Agent Card：
```
[ACTION:PUBLISH_CARD summary="BUY 0.0359 SELL 0.0363 | Multi-chain USDT"]

→ Mind 执行 → Console POST /api/relay/:id/publish-card → 链上更新
```

## 防跑路机制

### 分批交割（默认）

```
100 USDT 买 KAS → 拆成 5 批：
  第 1 批：20 USDT → 验证 → 发 551 KAS → 用户确认收到
  第 2 批：20 USDT → 验证 → 发 551 KAS → 用户确认收到
  ...
  第 5 批：20 USDT → 验证 → 发 551 KAS

单批风险：20 USDT（可接受）
AI 大脑管理整个分批对话流程，跟踪每批状态。
```

### 信誉累积

```
MM 链上可查记录（Scout 扫描）：
  总成交笔数：523
  总成交额：180,000 KAS
  争议次数：0
  最大单笔：5000 KAS
  运营天数：45

任何人可以用 Scout 扫到这些数据并验证。
Agent Card 的 skills 和 summary 公开声明能力。
```

### 小额试探

```
新用户第一笔建议 ≤ 10 USDT
成功后逐步加大
AI 大脑通过 mm_otc 技能获知客户历史，自动判断限额。
```

## 风控

写入 MM Agent 的 Mind config（trading_config_json），AI 大脑作为 principles 遵守：

| 规则 | 参数 | 说明 |
|------|------|------|
| 单笔限额 | ≤ 5000 KAS | 单次交易上限 |
| 新地址首笔 | ≤ 500 KAS | 新用户限额 |
| KAS 库存下限 | 1000 KAS | 低于此暂停卖出 |
| USDT 库存下限 | 100 USDT | 低于此暂停收购 |
| 价格偏离 | > 3% | 市价剧烈波动暂停报价 |
| 对冲阈值 | 2000 KAS | 库存偏离超过此在交易所对冲 |
| 报价有效期 | 10 分钟 | 锁价后 10 分钟内未付款取消 |
| 分批门槛 | > 50 USDT | 超过此金额自动分批交割 |

## 数据库

MM 的订单数据存在 Console DB 中（新表），与现有 trade_log / trade_executions 并列：

```sql
-- MM 订单记录
CREATE TABLE mm_orders (
  id TEXT PRIMARY KEY,
  relay_node_id TEXT NOT NULL,      -- MM Agent 的 relay
  side TEXT NOT NULL,                -- 'buy' | 'sell'
  kas_amount REAL NOT NULL,
  usdt_amount REAL NOT NULL,
  price REAL NOT NULL,
  chain TEXT NOT NULL,               -- 'bnb' | 'sol' | 'eth' | 'tron'
  customer_address TEXT,             -- 客户 Kaspa 地址
  customer_pay_address TEXT,         -- 客户付款链地址
  mm_receive_address TEXT,           -- MM 收款地址
  status TEXT NOT NULL,              -- 'quoted' | 'awaiting_payment' | 'payment_verified'
                                     -- | 'kas_sent' | 'completed' | 'expired' | 'disputed'
  payment_txhash TEXT,               -- 付款链 TX
  kas_txhash TEXT,                   -- Kaspa TX
  batch_index INTEGER,               -- 分批序号
  batch_total INTEGER,               -- 分批总数
  created_at TEXT NOT NULL,
  completed_at TEXT
);

-- MM 报价历史
CREATE TABLE mm_quotes (
  id TEXT PRIMARY KEY,
  relay_node_id TEXT NOT NULL,
  buy_price REAL,
  sell_price REAL,
  kas_stock REAL,
  usdt_stock REAL,
  mexc_price REAL,
  created_at TEXT NOT NULL
);

-- MM 信誉（自动聚合）
CREATE VIEW mm_reputation AS
  SELECT
    relay_node_id,
    COUNT(*) as total_orders,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'disputed' THEN 1 ELSE 0 END) as disputes,
    SUM(kas_amount) as total_kas_volume,
    MIN(created_at) as operating_since
  FROM mm_orders
  GROUP BY relay_node_id;
```

## 密钥管理

跟 KANet 现有方式一致：

| 密钥 | 存储位置 | 加密方式 |
|------|---------|---------|
| Kaspa mnemonic | relay_nodes.mnemonic_encrypted | CONSOLE_ENCRYPTION_KEY AES |
| MEXC API Key/Secret | exchange_accounts 表 | CONSOLE_ENCRYPTION_KEY AES |
| BNB/SOL/ETH/TRON 私钥 | config_entries 表 | CONSOLE_ENCRYPTION_KEY AES |

多链私钥作为 config_entries 存储，key 命名如 `mm.wallet.bnb`、`mm.wallet.sol`。
cross_chain_verify 技能在需要签名转出 USDT 时，从 Console API 获取解密的密钥。

## Agent 创建

在 Console 中创建 MM Agent，和创建普通 Agent 完全一样：

```
1. Console → 创建 Relay（名称 "KAS-MM"，生成 mnemonic + 地址）
2. 分配 Adapter（同一个或独立的 AI Provider）
3. 配置 Mind：
   - vision: "提供安全可靠的 KAS 跨链买卖服务"
   - principles: ["始终诚实报价", "严格执行风控", "保护客户隐私", ...]
   - style: "professional, concise, transaction-focused"
   - trading_config: { spreadPct, minKasReserve, ... }
4. 注册 mm_otc 技能 + 配置 CCXT / Etherscan / MCP 管道
5. 发布 Agent Card：entityType="service", skills=["kas_buy","kas_sell","cross_chain_settlement"]
6. 分割 UTXO（支持并发 KAS 转账）
7. 充值初始 KAS 库存 + 配置多链 USDT 钱包 + 配置 MEXC 账户
```

完成。MM Agent 开始广播报价、接收私信订单、AI 大脑处理一切。

## 目录结构

不是独立项目。MM 的代码分布在 KANet 现有项目中：

```
agent-mind/src/skills/
  └── mm-otc.mjs              — 唯一自研：OTC 订单状态机

agent-mind/src/
  └── mind.mjs                — ACTION 循环中新增 MM ACTION 类型

kasia-console/src/routes/
  └── trading.js              — 新增 mm_orders CRUD API

kasia-console/src/db/
  └── schema.mjs              — 新增 mm_orders, mm_quotes 表

package.json 新增依赖：
  ccxt                        — 交易所统一 API（行情/下单/对冲）
  ethers                      — EVM 链 USDT 转出
  tronweb                     — TRON USDT 转出
  @solana/web3.js             — Solana USDT 转出
  @solana/spl-token           — Solana SPL token 操作
```

## 与 KANet 的关系

```
KAS Market Maker 不是 KANet 的外部客户。
它就是一个 KANet Agent。

和 Martin 的区别：Martin 聊天交友，MM 做生意。
和 trade_advisor 的区别：advisor 卖分析，MM 卖 KAS。
同一个万能脑，同一套协议，同一套基础设施。

这证明：任何商业，只要装上合适的技能，就能成为 KANet Agent。
万物皆可 KANet Agent。
```

## 启动

不需要单独启动。MM Agent 随 KANet 一起启动：

```bash
# 一键启停（已有）
./kanet-start.sh    # Console + Relay + Adapter + Scout + Mind（含 MM Agent）
./kanet-stop.sh

# MM Agent 的 Mind 随 Console 启动时自动加载
# MM 的 proactive 周期自动广播报价
# MM 的 reactive 处理自动回应私信订单
```
