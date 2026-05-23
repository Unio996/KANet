## 十七、零售 DEX Agent（retail-dex，非托管）

> 2026-04-23 上线。Broker 只代发协议广播，零资金托管。

### 17.1 定位

手机 Kasia 用户发 DM 给 Broker Agent（`is_dex_broker=1` 的 relay，例如 Trader-B），用中文口语下单（"买 10 KAS"），全自动走完 → Maker KAS 直到用户 Kasia 地址。Broker 全程不持有用户资产。

三个角色：

| 角色 | 职责 | 持币 |
|---|---|---|
| User | 手机 Kasia 聊天 + MetaMask 付 USDT | 自持 |
| Broker | 代发 accept_v1 / paid_v1 / cancel_v1 广播 | **零托管** |
| Maker | 挂单（通常是 market-seeder），收 USDT 发 KAS | 自持 |

### 17.2 与 Exchange v2.1 协议的关系

retail-dex 是 Exchange 协议的**状态机前端**：对用户隐藏协议复杂度，把 DM 自然语言映射到 accept_v1 / paid_v1。所有链上验证、Maker delivery、offer 生命周期由 `exchange-machine.js` 复用。

关键协议钩子（已有，非托管路径刚好用上）：

1. **verifier 不检查 sender** (`exchange-machine.js:578` 调 `verifyCrossChainTx` 不传 `expectedFrom`) → 用户直付 Maker 的 TX 被接受，sender ≠ taker 不拒
2. **delivery 支持第三方 receive_address** (`exchange-machine.js:634-644`) → Broker accept 时写入 `verification_meta.receive_address = user_kasia_address`，Maker KAS 直发用户
3. **accepted_chains 声明** (`market-seeder.js:141`) → Maker 挂单时把 BSC/ETH 收款地址列在 `offer.verification_meta.accepted_chains`，Broker quote 时读出

### 17.3 数据模型（retail_dex_orders）

见 DATABASE.md。关键点：`agent_pay_addr` 存的是 **Maker 的 BSC 地址**（字段名历史遗留），`exchange_offer_id` 锁定的 Maker 挂单，`state` 10 态 CHECK 约束。

### 17.4 状态机

```
DM 入口
  │
  ▼
aligning ── 填链/地址 ──▶ (字段齐 → 选 offer + 报价 + preCheck) ──▶ confirming
  │                                                                │
  │ NO / 超时                                                      │ YES → 广播 accept_v1 (NO TX NO STATE CHANGE)
  ▼                                                                ▼
expired                                                       awaiting_payment
                                                                   │
                                                                   │ 用户回 tx hash
                                                                   ▼
                                                                  paid
                                                                   │
                                                                   │ tick: broadcast paid_v1
                                                                   ▼
                                                                executing
                                                                   │
                        ┌──────── offer.protocol_status ───────────┤
                        │ completed                                │ cancelled/disputed/expired
                        ▼                                          ▼
                  completed                                   refunding
                                                                   │
                                                                   │ (非托管: Broker 无钱退)
                                                                   ▼
                                                                failed
                                                        (error_reason=non_custodial_maker_refund_required)
```

合法转移表见 `retail-dex.js` 顶部 `VALID_TRANSITIONS`。`updateState` 强校验非法转移抛错。

### 17.5 端到端资金流（买 KAS）

```
1. User DM Broker (Trader-B): 「买 10 KAS」
2. Broker 问链 → User: 「BSC」
3. Broker 问地址 → User: 「0xUserBscAddr...」
4. 字段齐 → selectBestOffer 锁 Maker J2 的 50 KAS/8.5 USDT 挂单
   computeQuote 取 Maker BSC 地址 0xMakerBsc 作为用户付款目标
   报价: 付 1.7 USDT 到 0xMakerBsc → 收 10 KAS 到 User Kasia 地址
5. User: 「YES」 → Broker 广播 accept_v1:
   { t:'kanet_exchange_accept_v1', offer_id, selected_chain:'bnb',
     payment_asset:'usdt',
     receive_address: user_kasia_address }  ← KAS 直发用户的钩子
6. exchange-machine.handleExchangeAccept:
   · taker = Broker 地址（Broker 是广播方）
   · verification_meta 写入 receive_address=用户 Kasia
   · 状态 open → matched → verifying
   · auto-pay 分支：检测 is_dex_broker=1 → **跳过**（非托管门控, TASK 2.4）
7. User MetaMask 付 1.7 USDT → 0xMakerBsc（BSC 链上 TX 0xUserPayTx...）
8. User DM Broker: 「0xUserPayTx...」
9. Broker 状态 awaiting_payment → paid, 记 pay_tx_hash
10. orderMonitor tick 扫 paid 订单 → Broker 广播 paid_v1:
    { t:'kanet_exchange_paid_v1', offer_id,
      payment_tx: '0xUserPayTx...', payment_chain:'bnb' }
11. exchange-machine.handleExchangePaid → _verifyAndComplete:
    · verifyCrossChainTx 查 BSC (expectedFrom 未传 → sender 不校验)
    · 1.7 USDT 到 0xMakerBsc 确认 → confirmed
    · 状态 verifying → delivering
12. Maker 钱包 auto-deliver 10 KAS → receive_address (User Kasia 地址) on Kaspa
13. Maker 广播 delivered_v1
14. offer.protocol_status = completed, delivery_tx = Kaspa TX
15. Broker orderMonitor 下一 tick: order.executing + offer.completed →
    order.completed, deliver_tx_hash = offer.delivery_tx
16. User Kasia 钱包看到 KAS 到账
```

**Broker 钱包变化**：零 USDT、零 KAS。仅支付 accept_v1/paid_v1 两笔 Kaspa gas。

### 17.6 关键组件

| 文件 | 职责 |
|---|---|
| `kasia-console/src/services/retail-dex.js` | 状态机 + handleDm + orderMonitor 三个 processor + broadcast helpers |
| `kasia-console/src/api/conversations.js:114` | `/api/agent/reply` 对 `is_dex_broker=1` 的 DM 白名单绕开 Mind |
| `kasia-console/src/services/exchange-machine.js:634` | delivery 第三方 receive_address 路由（非托管的核心钩子） |
| `kasia-console/src/services/trade-protocol-filter.js:696` | auto-pay 对 `is_dex_broker=1` 硬门控关闭 |
| `kasia-console/src/db/migrate.js` v68/v69 | retail_dex_orders 表 + agent_pay_addr/mid_price_at_quote 字段 |

### 17.7 非托管的本质门控

Broker 零资金托管靠三道门：

1. **handleDm quote 阶段**：`computeQuote` 读的是 `offer.verification_meta.accepted_chains` 里的 Maker 地址，**不是** `agent_wallets WHERE relay_node_id=broker`。用户看到的付款地址永远是 Maker 的
2. **accept_v1 的 receive_address**：Broker 广播 accept 时把 `receive_address` 设为用户 Kasia 地址，exchange-machine delivery 直发用户。Broker 连 KAS 中转都不做
3. **auto-pay 门控**：exchange-machine auto-pay / auto-send-KAS 对 `is_dex_broker=1` 的 relay 硬跳过，保证即使 protocol 层触发了 Broker 的自动代付意图，代码也不会执行

第 3 道门是兜底：前两道是架构上的"不该碰"，第 3 道是代码上的"不会碰"。

### 17.8 超时与释放

orderMonitorTick Phase 1 `processTimeouts` 扫 `expires_at < now` 且 state ∈ {aligning, confirming, awaiting_payment} 的订单：

- aligning / confirming：直接推 expired（accept 未上链，无需释放）
- awaiting_payment + `exchange_offer_id`：先广播 `kanet_exchange_cancel_v1`（reason=`taker_timeout_no_payment`）释放 Maker 挂单锁，再推 expired

默认超时 30 分钟（`ORDER_TIMEOUT_MS`），`createOrder` 时写入 `expires_at`。

### 17.9 首笔真实 E2E（参考）

2026-04-23 05:24 托管 v0 首笔成交（订单 ad059e6a，tx 2ce6fe31）是架构修订前的路径。非托管路径上线后首笔 E2E 待 Martin 手机实测。

### 17.10 测试

不跑真金的独立 smoke 覆盖全部状态机：

- `scripts/smoke-2.1.mjs` 17 case — selectBestOffer / computeQuote
- `scripts/smoke-2.2.mjs` 12 case — handleDm 完整对齐流程 + accept_v1 broadcast
- `scripts/smoke-2.3.mjs` 10 case — orderMonitor 三 processor + 非托管 refund 语义
- `scripts/smoke-2.5.mjs` 8 case — 超时 sweeper + cancel_v1 释放

运行方式：`cd C:/kanet && DB_PATH=... node scripts/smoke-X.X.mjs`。需要 Console DB 存在（不需要 Console 进程运行）。

### 17.11 致命陷阱

| # | 陷阱 | 正确做法 |
|---|------|---------|
| 55 | DEX broker 不能启用 auto-pay，否则秒变托管 | `is_dex_broker=1` 的 relay 默认不挂 agent_wallets 私钥或挂了也不会被 exchange-machine auto-pay 触发 |
| 56 | `agent_pay_addr` 字段名是历史遗留，存的是 Maker 地址不是 Broker 地址 | 读这个字段时永远当 "用户应该付款的目标地址"，不要当 Broker 自己的 |
| 57 | accept_v1 的 `receive_address` 必须是**用户** Kasia 地址，不是 Broker 的 | handleDm confirming YES 时 payload 直接取 `current.user_kasia_address` |
| 58 | `exchange_offers.expires_at` 是 ISO 字符串，直接字符串比较会出错（'T' > ' '）| 用 `julianday(expires_at) > julianday('now')` |
| 59 | Broker 做不了退款（非托管下 Broker 从未收过 USDT）| refunding → failed + error_reason='non_custodial_maker_refund_required'，走 dispute 协议
