# 盈透 + Polymarket 接入方案

## 目标

用户在 KANet UI 上能：
1. 连接盈透账户 → 看持仓 → Agent 帮分析和交易
2. 连接 Polymarket → 看预测市场 → Agent 帮下注

## 一、盈透（IBKR）接入

### 用户操作流程

1. 打开 stocks 页面 → 点"连接券商"
2. 选 Interactive Brokers
3. 系统提示：需要先在本地启动 IB Gateway（给下载链接和配置步骤）
4. 用户输入：IB Gateway 地址（默认 localhost:5000）+ 账户 ID
5. 系统测试连接 → 成功 → 显示账户余额和持仓
6. 之后 Agent 能通过技能查持仓、下单

### 技术实现

#### 后端

**文件 1: `kasia-console/src/services/broker-ibkr.js`**（新建）

实现 BrokerAdapter 接口，调 IBKR Client Portal API：
- `authenticate()` — GET `/iserver/auth/status`，验证 session 有效
- `startKeepAlive()` — 每 60 秒 POST `/tickle`，session 失效时标记 `status='disconnected'` 并通知前端重连
- `stopKeepAlive()` — 停止保活定时器（断开连接时调用）
- `getAccount()` — GET `/portfolio/{accountId}/summary`
- `getPositions()` — GET `/portfolio/{accountId}/positions/0`
- `getQuote(symbol)` — GET `/iserver/marketdata/snapshot?conids={conid}`
- `searchSymbol(query)` — GET `/iserver/secdef/search?symbol={query}`
- `placeOrder(order)` — POST `/iserver/account/{accountId}/orders`
- `cancelOrder(orderId)` — DELETE `/iserver/account/{accountId}/order/{orderId}`
- `getOrders()` — GET `/iserver/account/orders`

gateway 地址 + accountId 加密存在 broker_accounts 表。

**IBKR Session 保活机制**：

IB Gateway session 默认几分钟不活动就登出。如果 session 过期，API 会静默返回空数据或 401，用户看不出是断线还是真没持仓。

broker-ibkr.js 必须有：
- `startKeepAlive()` — 连接成功后启动，每 60 秒 POST `/tickle`
- tickle 返回非 200 或 authenticated=false → 标记 `broker_accounts.status = 'disconnected'`
- 前端 stocks.eta 展示连接状态：🟢 connected / 🔴 disconnected（重连按钮）
- 所有 API 调用前先检查 status，disconnected 时返回明确错误而不是空数据

**文件 2: `kasia-console/src/api/broker.js`**（新建）

7 个 API 端点（见 broker-interface-design.md）。

**文件 3: `kasia-console/src/db/migrate.js`**

v35: broker_accounts 表。

**文件 4: `kasia-console/src/index.js`**

注册 broker 路由。

#### 前端

**stocks.eta** 加：
- 顶部"连接券商"按钮 → 展开连接表单（选券商 → 输入地址 → 测试 → 保存）
- 连接后显示：账户余额、持仓列表、盈亏
- 每个持仓可展开看详情

#### Agent 技能

**`agent-mind/src/skills/onboard-broker.mjs`**（新建）
- 对话引导连接券商
- IBKR 特殊步骤：下载 IB Gateway → 配置 → 测试

**`agent-mind/src/skills/stock-executor.mjs`**（新建）
- ACTION: `[ACTION:STOCK_ORDER broker=ibkr side=buy symbol=AAPL qty=10 type=limit price=248]`
- 默认 paper trading
- 安全检查：仓位限制

### IBKR IB Gateway 用户指南（Agent 要能说出来）

```
1. 下载 IB Gateway: https://www.interactivebrokers.com/en/trading/ibgateway-stable.php
2. 安装后启动，选 "Paper Trading" 模式（模拟盘）
3. 用 IBKR 账号登录
4. 登录后 Gateway 运行在 localhost:5000
5. 回到 KANet stocks 页面，点"连接券商"
6. 输入地址 localhost:5000，点测试
7. 连接成功后就能看到持仓和余额
```

## 二、Polymarket 接入

### 用户操作流程

1. 打开 predictions 页面 → 看到事件列表（已有）
2. 点某个事件 → 看到概率和订单簿
3. 点"我要交易" → 系统检查有没有 Polygon 钱包
4. 没有 → 引导创建 Polygon 钱包（Agent 页 → 钱包 → 创建 Polygon）
5. 有钱包但没 USDC → 提示充值 USDC 到 Polygon 地址
6. 有钱包有 USDC → 显示下单面板（买 Yes/No，数量，价格）
7. 下单 → polymarket.js 签名并提交到 CLOB API

### 技术实现

#### 后端

polymarket.js 已经有完整的交易接口（placeOrder/cancelOrder/getPositions/getOrderBook）。

stocks.js 里已经有 Polymarket 的 API 端点。

**缺的是**：
- Approve USDC 给 CTF Exchange 合约的端点（首次交易前需要）
- 查询 Approval 状态的端点

新增 3 个端点到 stocks.js：
```
POST /api/polymarket/:relay_node_id/approve  — Approve USDC（链上 TX）
GET  /api/polymarket/:relay_node_id/status   — 钱包+余额+Approval 状态
GET  /api/polymarket/:relay_node_id/approve-status — 查询 Approval TX 状态
```

**Approval 状态机**（前端必须体现）：
```
not_approved → 显示"授权 USDC"按钮
approve_pending (TX 已发, 等确认) → 禁用下单，显示"授权中..."
approved → 正常下单
approve_failed → 显示"授权失败，重试"按钮 + 错误原因
```

Approve 是链上 TX，可能失败或 pending 很久。`/approve` 端点发 TX 后返回 `{ txHash }`，前端轮询 `/approve-status` 直到 confirmed 或 failed。不能假设一调就成功。

#### 前端

**predictions.eta** 加：
- 每个事件卡片加"交易"按钮
- 点击展开：订单簿 + 下单面板（Yes/No 方向、数量、价格）
- 顶部显示：Polygon 钱包状态 + USDC 余额
- 没钱包时显示引导卡片

#### Agent 技能

prediction_sense.mjs 已有。补一个交易能力：

**在 prediction_sense.mjs 里加 execute 类 intent**：
- ACTION: `[ACTION:PREDICT_BET market_id=958442 side=yes amount=10 price=0.85]`
- 安全检查：最大单笔金额限制

### Polymarket 接入指南（Agent 要能说出来）

```
1. 在 Agent 概览 → 钱包 → 创建 Polygon 钱包
2. 从其他地方转 USDC (Polygon) 到你的钱包地址
3. 回到预测市场页面，选一个事件
4. 点"交易"，选 Yes 或 No，输入金额
5. 首次交易需要 Approve USDC（一次性操作）
6. 确认下单
```

## 执行优先级

| 步骤 | 内容 | 预计工作量 |
|------|------|-----------|
| 1 | predictions.eta 加交易面板 + approve API | 中 |
| 2 | broker_accounts 表 + broker-ibkr.js | 中 |
| 3 | broker.js API 端点 | 小 |
| 4 | stocks.eta 加连接券商入口 + 持仓显示 | 中 |
| 5 | onboard-broker 技能 | 小 |
| 6 | stock-executor 技能 | 小 |

Polymarket 先做（后端代码已有，只缺 UI），IBKR 后做（需要从零建）。

## 测试

### Polymarket
1. predictions 页面能看到事件列表 ✓（已有）
2. 点事件能看到订单簿
3. 没钱包时显示引导
4. 有钱包有 USDC 能下单
5. Agent 问"Polymarket 怎么用"能回答

### IBKR
1. stocks 页面点"连接券商"
2. 输入 localhost:5000 + accountId → 测试连接
3. 连接后显示持仓
4. Agent 能查持仓、下单（paper trading）
5. Agent 问"怎么接盈透"能一步步指导
