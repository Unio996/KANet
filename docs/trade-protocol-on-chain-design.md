# KANet 交易协议上链设计 v1

> 2026-03-27 设计稿。**链是源头，DB 是索引。**
>
> 核心原则：交易的每一步都通过 Kaspa 广播上链，本地 DB 只是链上数据的可查询索引。
> 现有状态机、资金锁定、限额检查、执行追踪全部复用，不新建表、不重写逻辑。

---

## 一、设计原则（不可妥协）

1. **链是源头，DB 是索引** — 订单簿是 Scout 扫到的所有 `kanet_sell/buy` 消息的聚合，不是 `mm_orders` 表
2. **KAS 必须在交易对一侧** — KAS/X 模型，X 是任何外链资产。KAS 侧链上可执行，X 侧链上可验证。协议自洽
3. **双方地址必须上链** — 卖方的收款地址 + 买方的付款地址，全在协议消息里声明，为退款/争议/风控提供链上证据
4. **广播 = 行动** — 不是"先操作 DB 再广播"，是"先广播，过滤器从链上事件驱动业务逻辑"
5. **乐观渲染 + 轮询确认** — 广播成功后 UI 立即显示"已上链"，后台轮询 `mm_orders WHERE broadcast_txid = txId` 确认索引写入后解锁操作按钮
6. **一个订单 = 一个频道** — 频道名就是 orderId，所有生命周期事件在同一个频道
7. **问责上链** — 谁的过错导致交易中断，永久记录在链上，构成天然信誉系统

---

## 二、频道架构

不设中心化市场频道。每个订单就是一个独立频道。

```
频道名 = orderId（如 818d5d2a）

发现机制：
  Scout 扫全链每一个 TX → 发现 kanet_sell/buy → 过滤器 → mm_orders 索引
  "市场" = mm_orders 表 = Scout 扫到的所有订单的本地聚合

频道内容（一笔交易的完整生命周期）：
  TX1: kanet_sell_v1       发布
  TX2: kanet_accept_v1     接单
  TX3: kanet_paid_v1       付款证明
  TX4: kanet_delivered_v1  交割证明
  或：
  TX2: kanet_accept_v1     接单
  TX3: kanet_timeout_v1    超时（问责）
  TX4: kanet_accept_v1     下一个人接单
  TX5: kanet_paid_v1       付款证明
  TX6: kanet_delivered_v1  交割证明
```

三层通道各司其职：
- **订单频道**（orderId）：协议消息，过滤器处理，不触发 AI 回复
- **Chat 频道**（otc-market / general / ...）：保持不变，聊天讨论社交
- **comm 加密通道**：可选隐私层，私下议价/大额 OTC

---

## 三、协议消息定义

所有消息通过 Kaspa bcast TX 发送到频道 `{orderId}`。
`sender_address` 由 TX 签名证明，不可伪造。

### 3.1 kanet_sell_v1 — 卖出 KAS

```json
{
  "t": "kanet_sell_v1",
  "v": 1,
  "id": "818d5d2a",
  "amt": 100,
  "price": 0.04,
  "want": "USDT",
  "chain": "bnb",
  "recv": "0x0938415CFaA63DAF581366e7cB999bd591AB0C0E"
}
```

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| t | string | ✓ | 消息类型 |
| v | number | ✓ | 协议版本 `1` |
| id | string | ✓ | 订单 UUID |
| amt | number | ✓ | 卖出 KAS 数量 |
| price | number | ✓ | 单价（USDT/KAS） |
| want | string | ✓ | 想要的资产符号 `USDT` / `USDC` |
| chain | string | ✓ | 结算链 `bnb` / `eth` / `sol` / `tron` |
| recv | string | ✓ | 外链收款地址（卖方接收 USDT 的地址） |

> sender_address（卖方 KAS 地址）从 TX 本身获取。

### 3.2 kanet_buy_v1 — 买入 KAS

```json
{
  "t": "kanet_buy_v1",
  "v": 1,
  "id": "f5708d93",
  "amt": 100,
  "price": 0.04,
  "pay": "USDT",
  "chain": "bnb",
  "pay_from": "0x9477..."
}
```

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| t | string | ✓ | 消息类型 |
| v | number | ✓ | 协议版本 |
| id | string | ✓ | 订单 UUID |
| amt | number | ✓ | 买入 KAS 数量 |
| price | number | ✓ | 单价 |
| pay | string | ✓ | 支付资产符号 |
| chain | string | ✓ | 支付链 |
| pay_from | string | ✓ | 外链付款地址（买方发送 USDT 的地址） |

> sender_address（买方 KAS 地址 = KAS 收款地址）从 TX 获取。

### 3.3 kanet_accept_v1 — 接受订单

频道：`{被接受的订单 id}`

```json
{
  "t": "kanet_accept_v1",
  "v": 1,
  "ref": "818d5d2a",
  "counter_id": "f5708d93",
  "chain": "bnb",
  "pay_from": "0x9477...",
  "kas_addr": "kaspa:qptg465n..."
}
```

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| t | string | ✓ | 消息类型 |
| v | number | ✓ | 协议版本 |
| ref | string | ✓ | 被接受的原始订单 ID |
| counter_id | string | ✓ | 接单方的对手订单 UUID |
| chain | string | ✓ | 选定的结算链 |
| pay_from | string | 买方必填 | 外链付款地址 |
| kas_addr | string | ✓ | 接单方 KAS 地址（显式声明，方便过滤器直接读取） |

> sender_address 由 TX 证明接单方身份。

### 3.4 kanet_paid_v1 — 付款证明

频道：`{订单 id}`

```json
{
  "t": "kanet_paid_v1",
  "v": 1,
  "id": "818d5d2a",
  "chain": "bnb",
  "tx": "0xf428ef174aef75a9eb2b063cfc5b45142a2e91b9...",
  "amt": 0.40,
  "to": "0x0938..."
}
```

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| t | string | ✓ | 消息类型 |
| v | number | ✓ | 协议版本 |
| id | string | ✓ | 订单 ID |
| chain | string | ✓ | 付款链 |
| tx | string | ✓ | 付款 TX hash（跨链，可在区块浏览器验证） |
| amt | number | ✓ | 付款金额 |
| to | string | ✓ | 收款地址 |

### 3.5 kanet_delivered_v1 — KAS 交割证明

频道：`{订单 id}`

```json
{
  "t": "kanet_delivered_v1",
  "v": 1,
  "id": "818d5d2a",
  "tx": "78043dc2ba368565687b74cb...",
  "amt": 100,
  "to": "kaspa:qptg465n..."
}
```

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| t | string | ✓ | 消息类型 |
| v | number | ✓ | 协议版本 |
| id | string | ✓ | 订单 ID |
| tx | string | ✓ | KAS TX hash（Kaspa 链上可验证） |
| amt | number | ✓ | KAS 数量 |
| to | string | ✓ | 收款 KAS 地址 |

### 3.6 kanet_cancel_v1 — 取消订单

频道：`{订单 id}`

```json
{
  "t": "kanet_cancel_v1",
  "v": 1,
  "id": "818d5d2a",
  "reason": "价格变动"
}
```

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| t | string | ✓ | 消息类型 |
| v | number | ✓ | 协议版本 |
| id | string | ✓ | 订单 ID |
| reason | string | | 取消原因（可选） |

### 3.7 kanet_timeout_v1 — 超时问责

频道：`{订单 id}`。由系统自动广播，记录谁的过错导致交易中断。

```json
{
  "t": "kanet_timeout_v1",
  "v": 1,
  "id": "818d5d2a",
  "who": "kaspa:qptg465n...",
  "reason": "payment_timeout_15min",
  "at_status": "accepted"
}
```

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| t | string | ✓ | 消息类型 |
| v | number | ✓ | 协议版本 |
| id | string | ✓ | 订单 ID |
| who | string | ✓ | 超时方的 KAS 地址 |
| reason | string | ✓ | 超时原因 |
| at_status | string | ✓ | 超时时订单处于的状态 |

**问责上链后，永久可查。** 任何人扫某地址在所有订单频道的记录，即可得出：

```
Martin 交易历史（链上事实陈列）：
  ├─ 818d5d2a: 接单 → 超时未付款 ❌ (kanet_timeout_v1)
  ├─ f5708d93: 接单 → 付款 → 完成 ✅
  └─ 141c60d9: 接单 → 付款 → 完成 ✅
  完成率: 2/3 = 66%
```

---

## 四、状态机变化

### 4.1 新增回退路径

接单方条件不满足或超时时，订单回退到 `published`，允许下一个接单方尝试。

```
现有：
  published → accepted, cancelled, expired
  accepted  → paying, cancelled, expired

改为：
  published → accepted, cancelled, expired
  accepted  → paying, published, cancelled, expired
                       ↑ 接单方不符合条件或超时 → 回退待接
```

### 4.2 回退 + 接单候选机制

```
频道 818d5d2a 链上记录：
  TX1: kanet_sell_v1      Sophie 发布
  TX2: kanet_accept_v1    Martin 接单 → handleAccept → 条件校验
       ├─ 通过 → transition(published → accepted)
       └─ 失败（余额不足/超限）→ 订单保持 published

  假设 Martin 接单成功但超时未付款：
  TX3: kanet_timeout_v1   系统广播问责（Martin 超时）
       → transition(accepted → published)  回退
       → 过滤器回扫频道，找下一个 kanet_accept_v1

  TX4: kanet_accept_v1    远程Agent 接单
       → handleAccept → 条件校验 → 通过
       → transition(published → accepted)
  TX5: kanet_paid_v1      远程Agent 付款
  TX6: kanet_delivered_v1 Sophie 交割
```

所有 accept 都在链上，过滤器按序处理。第一个失败后自动尝试下一个。

### 4.3 抢单保护

状态机天然防抢单：

```
Martin 接单  → transition(published → accepted) ✅
远程Agent 接单 → transition(accepted → accepted) ❌ 状态机拒绝
```

`VALID_TRANSITIONS['accepted']` 不包含 `accepted`。先到先得。
后来者的 accept 留在链上，作为候选——如果当前接单方失败，过滤器回扫时会找到它。

---

## 五、过滤器设计（trade-protocol-filter.js）

### 5.1 核心函数

```javascript
// trade-protocol-filter.js
// 链上协议消息 → 现有业务逻辑的桥
// 挂载点：broadcast_messages 写入后触发
// 不替换 Chat 系统，是新增的协议处理管道

async function onBroadcastWritten(row) {
  // row = { tx_hash, content, sender_address, channel_name, created_at }

  // 快速跳过非协议消息（字符串前缀匹配，纳秒级）
  if (!row.content.startsWith('{"t":"kanet_')) return

  const msg = JSON.parse(row.content)
  msg._tx = row.tx_hash           // 链上锚点
  msg._from = row.sender_address  // 发送者（TX 签名证明）
  msg._channel = row.channel_name // 频道（= orderId）
  msg._at = row.created_at        // 时间

  switch (msg.t) {
    case 'kanet_sell_v1':
    case 'kanet_buy_v1':
      await handleOrder(msg); break
    case 'kanet_accept_v1':
      await handleAccept(msg); break
    case 'kanet_paid_v1':
      await handlePaid(msg); break
    case 'kanet_delivered_v1':
      await handleDelivered(msg); break
    case 'kanet_cancel_v1':
      await handleCancel(msg); break
    case 'kanet_timeout_v1':
      await handleTimeout(msg); break
  }
}
```

### 5.2 Handler 逻辑（调用现有服务）

```javascript
import { createOrder, transition, getOrder, linkOrders } from './order-machine.js'
import { lockFunds, releaseFunds } from './fund-lock.js'
import { quickStart } from './execution-state.js'
import { recordChainEvent } from './chain-event.js'
import { checkLimits } from './trade-limits.js'

async function handleOrder(msg) {
  // 查是否已有此订单（本地发的 → 补填 broadcast_txid）
  const existing = sqlite.prepare(
    'SELECT id FROM mm_orders WHERE id = ?'
  ).get(msg.id)

  if (existing) {
    // 本地已创建，补填链上锚点
    sqlite.prepare(
      'UPDATE mm_orders SET broadcast_txid = ? WHERE id = ?'
    ).run(msg._tx, msg.id)
    return
  }

  // 远程订单 → 创建本地索引
  createOrder({
    id: msg.id,
    agentAddress: msg._from,
    side: msg.t === 'kanet_sell_v1' ? 'sell' : 'buy',
    kasAmount: msg.amt,
    price: msg.price,
    chain: msg.chain,
    broadcastTxid: msg._tx,
    mmReceiveAddress: msg.recv || null,
    customerPayAddress: msg.pay_from || null,
  })
}

async function handleAccept(msg) {
  const order = getOrder(msg.ref)
  if (!order) return
  if (order.status !== 'published') return  // 已被接，跳过（链上保留作为候选）

  // 限额检查
  const limitCheck = checkLimits(
    msg._from, order.kas_amount,
    order.kas_amount * order.price, order.mode || 'manual'
  )
  if (!limitCheck.ok) return  // 条件不满足，订单保持 published，等下一个

  // 状态推进
  transition(msg.ref, 'accepted', { txHash: msg._tx })

  // 资金锁定
  lockFunds(msg._from, msg.ref, /* asset, amount, balance */)

  // 执行追踪
  quickStart({
    type: 'accept_order',
    source: 'peer',
    agentAddress: order.agent_address,
    orderId: msg.ref,
  })

  // 创建对手方订单并互链
  if (msg.counter_id) {
    createOrder({
      id: msg.counter_id,
      agentAddress: msg._from,
      side: order.side === 'sell' ? 'buy' : 'sell',
      kasAmount: order.kas_amount,
      price: order.price,
      chain: msg.chain,
      peerAddress: order.agent_address,
      counterpartyOrderId: msg.ref,
      broadcastTxid: msg._tx,
    })
    linkOrders(msg.ref, msg.counter_id)
  }
}

async function handlePaid(msg) {
  transition(msg.id, 'paid', { txHash: msg.tx })
  recordChainEvent({
    txid: msg.tx,
    eventType: 'payment',
    fromAddress: msg._from,
    toAddress: msg.to,
    amount: msg.amt,
    observedBy: 'protocol',
    payload: { orderId: msg.id, chain: msg.chain },
  })
}

async function handleDelivered(msg) {
  transition(msg.id, 'completed', { txHash: msg.tx })
  recordChainEvent({
    txid: msg.tx,
    eventType: 'kas_delivery',
    fromAddress: msg._from,
    toAddress: msg.to,
    amount: msg.amt,
    observedBy: 'protocol',
    payload: { orderId: msg.id },
  })
}

async function handleCancel(msg) {
  transition(msg.id, 'cancelled', {
    reason: msg.reason || 'cancelled via protocol'
  })
  releaseFunds(msg.id)
}

async function handleTimeout(msg) {
  const order = getOrder(msg.id)
  if (!order) return

  // 回退到 published，释放资金
  transition(msg.id, 'published', {
    reason: `timeout: ${msg.reason} (${msg.who})`,
    force: true
  })
  releaseFunds(msg.id)

  // 回扫频道，寻找下一个候选 accept
  await tryNextAccept(msg.id)
}

async function tryNextAccept(orderId) {
  // 从 broadcast_messages 查找该频道所有 kanet_accept_v1
  // 按 created_at 排序，跳过已处理的（超时方的地址）
  const accepts = sqlite.prepare(`
    SELECT * FROM broadcast_messages
    WHERE channel_name = ? AND content LIKE '%kanet_accept_v1%'
    ORDER BY created_at ASC
  `).all(orderId)

  const order = getOrder(orderId)
  if (order.status !== 'published') return

  for (const row of accepts) {
    const msg = JSON.parse(row.content)
    msg._tx = row.tx_hash
    msg._from = row.sender_address
    // 跳过已超时的接单方
    const wasTimedOut = sqlite.prepare(`
      SELECT 1 FROM broadcast_messages
      WHERE channel_name = ? AND content LIKE '%kanet_timeout_v1%'
      AND content LIKE ?
    `).get(orderId, `%${row.sender_address}%`)
    if (wasTimedOut) continue

    await handleAccept(msg)
    if (getOrder(orderId).status === 'accepted') break  // 找到了
  }
}
```

### 5.3 挂载点

过滤器挂在 `broadcast_messages` 写入的两个入口（`chat.js`），作为**新增管道**，不影响 Chat 现有逻辑：

```
POST /api/chat/send（本地发送）
  → INSERT broadcast_messages
  → onBroadcastWritten(row)     ← 协议过滤器（新增）
  → 原有 auto-reply 逻辑        ← Chat 系统（不动）

POST /api/chat/ingest（Scout 上报）
  → INSERT broadcast_messages
  → onBroadcastWritten(row)     ← 协议过滤器（新增）
  → 原有 auto-reply 逻辑        ← Chat 系统（不动）
```

### 5.4 幂等保证

- `broadcast_messages.tx_hash` UNIQUE → 同一 TX 不会触发两次过滤器
- `handleOrder` 检查 `mm_orders.id` 是否已存在 → 本地订单不重复创建
- `handleAccept` 检查 `order.status !== 'published'` → 已接单的不重复处理
- `transition()` 有状态机校验 → 非法状态转换被拒绝

---

## 六、数据流

### 6.1 发布订单

```
UI → POST /api/chat/send (bcast kanet_sell_v1 → 频道 {orderId})
   → Relay 广播到 Kaspa 链 → txId 返回
   → INSERT broadcast_messages (tx_hash = txId)
   → onBroadcastWritten() → handleOrder() → createOrder(broadcast_txid = txId)

UI 乐观渲染：
   → 显示"已上链 ✅"（禁用操作按钮）
   → 轮询 GET /api/trade/mm-orders?broadcast_txid={txId}
   → 命中 → 解锁操作按钮
   → 3秒超时 → 提示"索引同步中"
```

### 6.2 接受订单

```
UI → POST /api/chat/send (bcast kanet_accept_v1 → 频道 {orderId})
   → 链上 → broadcast_messages → onBroadcastWritten()
   → handleAccept() → checkLimits() → transition(accepted) → lockFunds()
```

### 6.3 付款

```
现有 pay_usdt 逻辑不变（真实跨链 TX），成功后追加广播：

trading.js pay_usdt 成功:
   → 现有逻辑：transition('paid') + recordChainEvent()
   → 新增：bcast kanet_paid_v1 → 频道 {orderId}
```

### 6.4 交割

```
现有 send_kas 逻辑不变（Relay 发送 KAS），成功后追加广播：

trading.js send_kas 成功:
   → 现有逻辑：transition('completed') + recordChainEvent()
   → 新增：bcast kanet_delivered_v1 → 频道 {orderId}
```

### 6.5 超时问责 + 回退

```
mind-manager.js 超时检查:
   → 发现 accepted 订单超时未付款
   → bcast kanet_timeout_v1 → 频道 {orderId}（问责上链）
   → handleTimeout() → transition(accepted → published) → releaseFunds()
   → tryNextAccept() → 回扫频道找候选 → handleAccept()
```

### 6.6 远程 Agent 订单（跨节点交易）

```
远程 Agent 广播 kanet_sell_v1 到频道 {orderId}:
  → Scout 捕获 → POST /api/chat/ingest → broadcast_messages
  → onBroadcastWritten() → handleOrder()
  → mm_orders 创建（来源 = 链上）
  → 本地 UI 看到这个订单 → 可以接单

本地 Agent 接单:
  → 广播 kanet_accept_v1 → 频道 {orderId}
  → 远程 Scout 捕获 → 远程过滤器触发 → 远程 mm_orders 更新
```

---

## 七、Scout / Relay 关系

```
Scout = 观察者（扫全链，发现远程协议消息，上报 Console）
Relay = 代理人（代表 Agent 广播协议消息到链上）

发出动作：
  Console → Relay 广播 → 链上 TX
  Console 同时存 broadcast_messages（/api/chat/send 已有逻辑）
  过滤器立即触发（不等 Scout 回来）

接收动作：
  链上广播 → Scout 捕获 → POST /api/chat/ingest → broadcast_messages
  过滤器触发 → 业务逻辑

去重：
  broadcast_messages.tx_hash UNIQUE
  本地发送先写入 → Scout 捕获同一 TX → INSERT OR IGNORE → 不重复触发
```

Scout 挂了不影响本地操作。远程消息在 Scout 重启后 catch-up 补上。

---

## 八、身份与信任模型

### 8.1 KAS 地址身份

Kaspa TX 签名天然证明发送者拥有该 KAS 地址。每条协议消息的 `sender_address` 不可伪造。

### 8.2 跨链验证

不验证"这个 BNB 地址是不是你的"，验证"我的收款地址到没到账"。

```
卖方声明: recv = 0x0938...
买方付款: 从 pay_from 发 USDT 到 0x0938...
卖方验证: 0x0938... 收到了 → 发 KAS 到买方的 kas_addr
```

### 8.3 为什么 KAS 必须在交易对一侧

```
KAS/X 模型：
  KAS 侧：TX 签名 + fund_lock + Relay 交割 → 链上可执行
  X 侧：跨链 TX 验证到账 → 链上可验证
  可执行 + 可验证 = 协议自洽

X/Y 模型（双外链）：
  两侧都不在 Kaspa 上 → 无链上执行力 → fund_lock 是空话
  等待 vProgs 成熟后用 HTLC 实现
```

### 8.4 天然信誉系统

协议消息本身构成信誉。无需单独的信誉评分系统。

```
扫某地址在所有订单频道的记录：

  kanet_accept_v1 出现在 5 个频道
  kanet_delivered_v1 出现在 4 个频道（4 笔完成）
  kanet_timeout_v1 记录 1 次（1 笔超时，该地址被问责）

  链上事实：完成率 80%，1 次超时
```

接单时自动审核对手方：
- 扫链上历史 → 完成率、超时次数、交易规模
- 低于阈值 → 降低自动模式限额 / 提醒 Owner
- 这不是评分，是事实陈列。链上数据不会说谎。

### 8.5 演进路径

| 阶段 | fund_lock | 信任模型 |
|------|-----------|---------|
| 现在 | DB 软锁 | Agent 守约 + 跨链验证 |
| 中期 | Kaspa 脚本硬锁（L1） | 链上不可绕过 |
| 远期 | vProgs HTLC | 跨链原子交换，完全无需信任 |

每一步向后兼容。今天的 KAS/X 协议不需要改，只是执行层升级。

---

## 九、改动清单

### 新增文件（1 个）

| 文件 | 职责 |
|------|------|
| `kasia-console/src/services/trade-protocol-filter.js` | 链上协议消息 → 现有业务逻辑的桥 |

### 修改文件（5 个）

| 文件 | 改动 |
|------|------|
| `kasia-console/src/api/chat.js` | 两个写入点 INSERT 后调 `onBroadcastWritten(row)` |
| `kasia-console/src/ui/market.eta` | publishOrder → 先广播再轮询；doAction('accept') → 广播 kanet_accept_v1 |
| `kasia-console/src/api/trading.js` | pay_usdt 成功后广播 kanet_paid_v1；send_kas 成功后广播 kanet_delivered_v1 |
| `kasia-console/src/services/order-machine.js` | VALID_TRANSITIONS 增加 `accepted → published` 回退路径 |
| `kasia-console/src/services/mind-manager.js` | 超时处理改为广播 kanet_timeout_v1 + 回退 |

### 不动的部分

| 模块 | 状态 |
|------|------|
| `order-machine.js` 状态机 | **复用**（仅加一条回退路径） |
| `fund-lock.js` 资金锁定 | **复用** |
| `trade-limits.js` 限额检查 | **复用** |
| `execution-state.js` 执行追踪 | **复用** |
| `chain-event.js` 链上事实归档 | **复用** |
| `trade-action.js` 权限闸门 | **复用** |
| Chat 系统（chat.js 现有逻辑） | **不动** |
| 安全底线 10 条 | **全部保留** |
| 三模式 auto/approval/manual | **保留** |

---

## 十、实施步骤

### Phase 1：过滤器 + Publish 上链

1. 新建 `trade-protocol-filter.js`（handleOrder + handleCancel）
2. `chat.js` 两个写入点挂载 `onBroadcastWritten()`（新增管道，不影响 Chat）
3. `market.eta` publishOrder() 改为先广播 `kanet_sell_v1`/`kanet_buy_v1` 到频道 `{orderId}`
4. 广播成功后轮询确认索引写入
5. **验证**：广播上链 → 过滤器创建 mm_order → broadcast_txid 有值

### Phase 2：Accept + 抢单 + 回退

1. `trade-protocol-filter.js` 补充 handleAccept + handleTimeout + tryNextAccept
2. `order-machine.js` 增加 `accepted → published` 回退路径
3. `market.eta` doAction('accept') 改为广播 `kanet_accept_v1` 到频道 `{orderId}`
4. `mind-manager.js` 超时改为广播 `kanet_timeout_v1` + 回退
5. **验证**：接单上链 → 超时问责上链 → 订单回退 → 下一个候选自动接上

### Phase 3：交易事件上链

1. `trade-protocol-filter.js` 补充 handlePaid + handleDelivered
2. `trading.js` pay_usdt 成功后广播 `kanet_paid_v1`
3. `trading.js` send_kas 成功后广播 `kanet_delivered_v1`
4. **验证**：订单频道完整记录全生命周期

### Phase 4：真链全流程测试

1. 本地两个 Agent 完整跑通：publish → accept → pay → deliver
2. 验证每一步 broadcast_messages 和 mm_orders 一致
3. 验证订单频道有完整交割记录
4. 验证 Kaspa 区块浏览器能看到每步 TX
5. 测试超时回退 + 候选接单

### Phase 5：跨节点测试

1. 模拟远程 Agent 发布订单（Scout 发现）
2. 本地 Agent 接单，走完全流程
3. 验证过滤器正确处理远程订单
4. 验证信誉数据可从链上重建

---

## 十一、协议演进预留

### 11.1 版本兼容

`v` 字段确保前向兼容。v1 解析器忽略 v2 中的未知字段。

### 11.2 未来万物上链

当前专为 KAS/X token swap 设计。未来新增资产类型只需定义新消息类型：

```
kanet_sell_v1 / kanet_buy_v1     — KAS ↔ 外链代币（当前）
kanet_svc_offer_v1               — KAS ↔ 服务（未来）
kanet_good_list_v1               — KAS ↔ 实物商品（未来）
kanet_data_offer_v1              — KAS ↔ 数据/信息（未来）
```

新类型复用同一个过滤器框架（switch 加 case）、同一个频道架构（一个订单一个频道）、同一个状态机。

### 11.3 旧协议兼容

| 旧消息 | 处理 |
|--------|------|
| 旧 kanet_sell_v1（缺 id/price/recv） | 过滤器兼容：缺字段时用 sender_address 补 recv，自动生成 id |
| 旧 kanet_accept_v1（走 comm 而非 bcast） | 现有 mm-otc.mjs 继续处理，逐步引导到新广播流程 |

过渡期两套并行，不强制迁移。
