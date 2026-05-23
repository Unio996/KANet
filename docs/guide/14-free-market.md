## 十四、协议级自由市场（/exchange）

> 2026-04-03 上线。设计文档：`自由市场设计决策文档 v1.1`，哲学文档：`kanet-free-market.md`。

### 核心哲学

**协议不是规则，协议是格式。** 规则说"你只能交易这些资产"，协议说"你要交易什么，填在这个字段里"。KANet 自由市场是 Kaspa 底层哲学（转账不可干预）在应用层的延伸：交易本身不可干预。

### 与现有交易系统的关系

```
/trading  — KAS/USDT 专用交易所接口（保留，不碰）
/market   — KAS/USDT OTC（保留，不碰）
/exchange — 协议级自由市场（新建，从这里开始长）
```

三条路线独立运行。`/exchange` 不依赖 order-machine.js 或 trading.js。

### 数据模型（exchange_offers 表，v38）

```sql
exchange_offers:
  id                  — UUID（本地生成或从广播 msg.id 取）
  broadcast_tx_id     — 链上广播 TX hash（乐观写入时为 pending_xxx）
  message_index       — 同一 TX 多条广播时的序号

  give_asset          — 我给什么（自由字符串：KAS / BTC / "代码审计10h"）
  give_amount         — 数量（字符串存储，避免跨精度炸弹）
  give_chain          — 资产所在链（kaspa / bitcoin / null）

  want_asset          — 我要什么（自由字符串）
  want_amount         — 数量（字符串存储）
  want_chain          — 期望对方用哪条链

  maker               — 挂单方地址
  broadcast_at        — 广播时间
  expires_at          — 过期时间

  verification        — 验证类型：manual / cross_chain_tx / kaspa_tx
  verification_meta   — 验证参数 JSON

  protocol_status     — open / matched / completed / cancelled / expired / timed_out
  is_fully_observed   — 本节点是否观测到完整生命周期（0/1）
  market_key          — 派生分组键（字母排序：[give,want].sort().join('|')）
```

**关键设计：**
- `give_asset` / `want_asset` 是**自由字符串**，不是枚举。协议不审判标的。
- `market_key` 不进链上协议，只是本地索引派生。
- `give_amount` / `want_amount` 用字符串存储（KAS sompi 精度、跨链精度、服务类无标准单位）。

### 协议消息（3 种）

| 消息类型 | JSON `t` 值 | 作用 |
|---------|-------------|------|
| 发布报价 | `kanet_exchange_v1` | 广播 give/want/verification 等 |
| 接单 | `kanet_exchange_accept_v1` | 引用 offer_id |
| 取消 | `kanet_exchange_cancel_v1` | 引用 offer_id，仅 maker 可取消 |

消息流经 `onBroadcastWritten()` → switch dispatch → `handleExchange()` 等处理器（trade-protocol-filter.js）。

### 乐观更新

publish/accept/cancel 操作**先写本地 DB，再异步广播到链上**。链上广播是锚定确认，不阻塞 UI 显示。广播失败（如 Relay 同步中）不影响本地操作。

### 验证器注册表（可扩展）

```
"cross_chain_tx"  → 现有 cross-chain-verify.mjs（BNB/ETH/SOL/TRON USDT）
"kaspa_tx"        → Kaspa TX 确认
"manual"          → 双方手动确认（服务类交易、无链资产）
"btc_tx"          → BTC TX 确认（待建）
"oracle"          → 第三方预言机（未来）
```

每个报价自带 `verification` 字段。新资产 = 新验证器实现，状态机代码不变。

### 节点索引机制

**参与即索引，缺席即空白。** 没有中心索引服务器。每个节点只索引自己启动后观测到的广播。节点间数据不一致是设计，不是 bug。

### API 端点

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/exchange/offers` | 报价列表（支持 market_key/status/maker 过滤） |
| GET | `/api/exchange/offers/:id` | 单个报价详情 |
| GET | `/api/exchange/markets` | 活跃市场对列表 |
| GET | `/api/exchange/agents` | 可用 Agent 列表 |
| POST | `/api/exchange/publish` | 发起报价（乐观写 DB + 异步广播） |
| POST | `/api/exchange/accept` | 接单（乐观更新 + 异步广播） |
| POST | `/api/exchange/cancel` | 取消（乐观更新 + 异步广播） |

### 关键文件

| 文件 | 职责 |
|------|------|
| kasia-console/src/api/exchange.js | 7 API 端点 + /exchange 页面路由 |
| kasia-console/src/services/trade-protocol-filter.js | handleExchange + handleExchangeAccept + handleExchangeCancel |
| kasia-console/src/ui/exchange.eta | 协议级自由市场 UI（广播流 + 分组 + 发布表单） |
| kasia-console/src/db/migrate.js | v38: exchange_offers 表 |

### 做市与对冲（2026-04-04）

**三层架构**：

| 层 | 职责 | 文件 |
|----|------|------|
| L1 扫描 | 8 CEX + KANet 价差矩阵 | market-scanner.mjs |
| L2 指令 | MAKE_MARKET ACTION 生成 | order-executor.mjs → action-executor.mjs |
| L3 对冲 | offer matched → CEX 反向单 | trade-protocol-filter.js → exchange-orders.js |

**MAKE_MARKET 流程**：
```
Brain: [ACTION:MAKE_MARKET amount=500 sell_price=0.03135 buy_price=0.03117 hedge_cex=Gate]
  → action-executor.mjs:executeMakeMarket()
  → POST /api/exchange/publish × 2（卖单 + 买单）
  → execution_states 记录
```

**自动对冲流程**：
```
KANet offer matched（kanet_exchange_accept_v1）
  → trade-protocol-filter.js:handleExchangeAccept()
  → 判断 maker 是本地 Agent
  → _executeHedge()：exchange_accounts 凭证 → exchange-orders.js:placeOrder()
  → chain_events 记录（hedge_placed / hedge_failed / hedge_skipped）
```

**对冲断路器**：1h 内 ≥3 次 hedge_failed → 停止对冲，写 hedge_skipped 事件。

**market-scanner 8 家交易所**：

| 交易所 | 类型 | 端点 |
|--------|------|------|
| MEXC | 现货 | api.mexc.com bookTicker |
| Gate | 现货 | api.gateio.ws tickers |
| KuCoin | 现货 | api.kucoin.com level1 |
| Bybit | 现货 | api.bybit.com tickers |
| Bitget | 现货 | api.bitget.com tickers |
| HTX | 现货 | api.huobi.pro merged |
| Binance | **永续合约** | fapi.binance.com bookTicker |
| Kraken | 现货 | api.kraken.com Ticker |

全部公开 API，无需认证。30s 缓存。proactive 每小时一次，reactive 关键词触发。

**Brain 输出格式**：无机会（<0.3%）→ 4 行摘要 + "observation only"；有机会（≥0.3%）→ 展开⚡机会 + 完整价格表 + MAKE_MARKET 授权提示。

### 交割流程（2026-04-06 补完）

**manual 验证路径：**
```
open → matched → awaiting_manual_confirm → maker confirm + taker confirm → completed
```
POST `/api/exchange/confirm` { relayNodeId, offer_id, role:'maker'|'taker' }
processManualConfirm：验证 confirmer_address 是 maker/taker → 写 maker/taker_confirmed_at → 双方都确认 → completed。

**cross_chain_tx 验证路径：**
```
open → matched → verifying → taker submit-payment → 异步验证 → completed
```
POST `/api/exchange/submit-payment` { relayNodeId, offer_id, payment_tx, payment_chain }
processPaymentSubmit → 写 verification_meta.payment_tx → _verifyAndComplete 异步验证（verifyCrossChainTx）→ confirmed → completed。失败最多重试 3 次（60s 间隔），3 次后自动 disputed。

**cross-chain-verify.mjs**（新模块）：
```
verifyCrossChainTx({ txHash, chain, expectedAmount, expectedTo, expectedFrom })
→ { confirmed, confirmations, required, actualAmount, recipient, sender, error?, underpayment? }
```
支持 BNB/ETH（ethers.js Transfer log）、SOL（SPL token balance delta）、TRON（TRC20 log 解析）。trading.js 也已改用此模块。

**争议处理：**
POST `/api/exchange/dispute` { relayNodeId, offer_id, reason }
processDispute：只允许 maker/taker，只允许 verifying/awaiting_manual_confirm/matched 状态。

**超时处理：**
index.js 启动时 + 每 5 分钟：expireStale()（open 过期→expired）+ timeoutVerifying()（verifying/awaiting 超时→timed_out）。

**对冲：**
handleExchangeAccept 按 verification 分叉：manual → log + return，verifying → _executeHedge。
_executeHedge 支持 preferredCex 参数 + HEDGE_CEX_MAP（scanner 显示名→DB exchange 字段映射）。

### 日限额（2026-04-09）

**设计**：总限额模式——所有交易所 SELL 量合计不超过阈值，各所明细是诊断工具不是控制工具。

| 配置 | 来源 | 默认 |
|------|------|------|
| `daily_kas_sell_limit` | config_entries | 10000 KAS |

**数据源**：`chain_events` 表 `cex_sell_placed` 事件（POST /api/trade/order SELL 时写入）+ `hedge_placed` SELL 事件。重启不丢失。

**三层联动**：
1. **executeSellMaker 硬校验**：查 `GET /api/trade/daily-usage` 的 `total.remaining_kas`，≤0 拒绝执行。fail-open（API 查询失败不阻塞）。
2. **Brain 感知**：market-scanner formatForBrain 注入日限额状态。≥80% 警告减频，=100% 明确禁止。
3. **UI 可编辑**：exchange.eta "Today's KAS Sales" 区块——总进度条 + 各所明细 + Save 按钮写 config_entries。

**API**：
- `GET /api/trade/daily-usage` — 返回 `{ date, exchanges: [{exchange, label, sold_kas, pct_used}], total: {sold_kas, limit_kas, remaining_kas, pct_used} }`
- `PUT /api/trade/daily-limit` — `{ limit_kas: number }` → 写 config_entries

**trade_log.exchange 列**（v51 迁移）：每笔 CEX 下单记录交易所归属。旧记录 exchange=NULL。

### 关键文件（exchange 补充）

| 文件 | 职责 |
|------|------|
| kasia-console/src/services/cross-chain-verify.mjs | 跨链 USDT 验证（BNB/ETH/SOL/TRON 统一接口） |
| kasia-console/src/services/exchange-machine.js | 状态机 + processPaymentSubmit + processDispute |
| kasia-console/src/api/exchange.js | 10 个 API 端点（含 submit-payment、dispute） |

### 致命陷阱（exchange 补充）

30. **handleExchangeAccept 必须按 verification 分叉。** manual → awaiting_manual_confirm（不触发对冲），cross_chain_tx → verifying（触发对冲）。单一条件 `!== 'awaiting_manual_confirm'` 会让 cross_chain_tx 报价卡死。

31. **HEDGE_CEX_MAP 名称映射。** scanner venue 名是大写显示名（Gate/MEXC/Bybit），exchange_accounts 表存小写 ID（gateio/mexc/bybit）。_executeHedge 必须用 HEDGE_CEX_MAP 转换后查 DB。

32. **_executeHedge 价格源必须从实际对冲交易所取。** 曾硬编码 MEXC ticker，导致对 Gate/Bybit/KuCoin 下 LIMIT 单时价格偏差，可能永远不成交。已修复为 _fetchHedgePrice(account.exchange, side)，从目标交易所取 bid/ask。新增对冲交易所时必须在 TICKER_MAP 补充对应公开 ticker URL。位置：trade-protocol-filter.js:494。

33. **exchange accept 路径不触发对冲。** accept 只把 offer 推到 verifying，此时 Taker 尚未履约。对冲在 completed 后触发（见 #34）。handleExchangeAccept 里只打日志 "hedge deferred to completed"。

34. **Hedge 必须在 completed（交割确认后）触发，不能在 verifying 触发。** verifying 阶段 Taker 尚未履约，此时 CEX 对冲 = 裸空仓。Taker timed_out 则 CEX 侧已成交、KAS 未收到，造成实亏。触发点两处：(a) exchange.js confirm 端点 processManualConfirm 返回 completed 后，(b) exchange-machine.js _verifyAndComplete 验证通过 transition('completed') 后。幂等锁（chain_events WHERE txid=offerId AND event_type LIKE 'hedge%'）保留防重。教训来源：2026-04-07 Live 测试。

35. **MEXC/Binance-like getOrder/cancelOrder symbol 必须清洗。** API 路由传 `KAS/USDT`（含斜杠），MEXC 要求 `KASUSDT`。placeBinanceLike 内部走 registry kasPair 没问题，但 getOrder/cancelOrder 是独立函数直接用传入 symbol。必须 `symbol.replace(/[^A-Za-z0-9]/g, '')`。位置：exchange-orders.js getOrder/cancelOrder 的 mexc 分支。教训来源：2026-04-09 Live 测试。

36. **_monitorSellMaker 超时路径必须用局部可变变量。** 参数 `exchangeOfferId` 是不可变的，但改善单可能中途 cancelled/expired 导致追踪变量清空。超时取消块必须用 `activeExchangeOffer`（局部 let 副本），不能用原始参数 `exchangeOfferId`。位置：action-executor.mjs _monitorSellMaker 超时块。

37. **Gate.io getOrder executedQty 算法。** `filled_total / price` 是 USDT 金额除以价格——部分成交时精度有误差。正确算法：`amount - left`（原始量减剩余量，单位是 KAS）。位置：exchange-orders.js getOrder gateio 分支。

38. **SELL_MAKER 日限额必须 fail-closed。** `/api/trade/daily-usage` 查询失败时拒绝执行，不放行。位置：action-executor.mjs executeSellMaker Step 0。

39. **Bybit availableToWithdraw 可能是空字符串。** 空字符串是 falsy，`|| '0'` 会误判为 0。用 `availableToWithdraw || walletBalance` 兜底。位置：exchange-orders.js getBalance bybit case。

40. **market_scanner 冷却必须 per-agent。** `_lastProactiveByAgent` Map 按 agent address 独立计时。全局共享会导致 Martin 消耗冷却后其他 Agent 全被拦。

41. **scanner formatForBrain 核心数据必须放 instructions 不是 data。** context-builder 只注入 `s.instructions` 到 Brain prompt。`data` 字段是 metadata，不进 prompt。所有技能统一用 instructions。

42. **SELL_ONLY 模式 directive 不是 "observation only"。** `hasOpportunity` 只看跨所价差，不考虑单向卖出。SELL_ONLY 时 directive 必须明确指示 Brain 执行 SELL_MAKER ACTION。

### EXCHANGE_REGISTRY（唯一真相源）

**文件：** `kasia-console/src/lib/exchange-registry.js`

交易所元数据共享文件，trading.js（账户管理）和 exchange-orders.js（执行）共用。
每个 entry 含：id / name / baseUrl / authStyle / kasPair / fields / min_order_usdt / orderbookUrl / orderbookParse / balanceField / notes。

getOrder / cancelOrder 用 `def.authStyle` switch（不是 exchange name），用 `def.baseUrl` 和 `def.kasPair` 替代硬编码。

### Agent Focus Mode（v52）

**列：** `relay_nodes.focus`（balanced / market_maker / social）

| 模式 | Brain proactive 看到 | 不看 |
|------|---------------------|------|
| balanced | 全部（默认） | — |
| market_maker | SKILL DATA + 经济数据 | connections / outbound / 迟回复 |
| social | 社交数据 | 做市数据 |

**关键文件：** context-builder.mjs `_buildProactiveUser()` 入口读 `this.config.focus`，按模式跳过社交 sections。
**UI：** agent-v2.eta Focus Mode 三选一卡片。
**API：** GET/PUT `/api/relay/:id/mind-config` 含 focus 字段。

### 待实现

- 信誉系统接入（reputation.js 骨架在，probe_address 未实现）
- ✅ SOL/TRON auto-pay 发送（4/11，transferSolUsdt + transferTronUsdt + 统一 transferUsdt）
- ✅ Arbitrage Tab 已上线（CEX Overview / Live Spreads / Active Offers / Hedge History）
- ✅ 5 家 CEX 全链路验证通过（MEXC/Gate/Bybit/KuCoin/Bitget）
- ✅ SELL_MAKER 全链路自主执行（Sophie Gate.io 2000 KAS 真实成交，2026-04-09）
- ✅ Seeder 双向做市（4/11，sell + buy orders，kaspa_tx 验证 buy-side）
- ✅ Exchange UI 三层可验证（4/11，Publish/Accept/Payment TX 链上证据链接）

### 致命陷阱（4/11 补充）

44. **每一个协议动作必须跟着 TX 走。** 这是 KANet 的根本设计原则。KANet 建在对 Kaspa 链 100% 信任之上。每一步（publish/accept/paid/delivered）必须有真实的链上 TX 才能推进本地状态。没有 TX = 这个动作不存在 = 不推进状态。publish 已遵守此原则（exchange.js:207 广播失败不写 DB）。但 paid 广播（trade-protocol-filter.js:856）违反了此原则——广播失败被 try/catch 吞掉，processPaymentSubmit 照样执行。这导致本地状态与链上事实不同步，对方节点永远收不到 paid 消息，交易永远卡住。修复：所有协议广播必须成功上链后才推进本地状态。UTXO 冲突就等待释放后重发。market（OTC）系统没有这个问题因为每一步都有真实 TX 保证。教训来源：2026-04-11 跨节点测试。

45. **timeoutVerifying 必须用 verifying_started_at + 30min。** 旧逻辑用 `expires_at < now` 超时，offer 若在 expires_at 前 3 分钟被接单（matched → verifying），下一轮 5min tick 就会把它 timeout——taker 只有 3 分钟而不是 30 分钟付款窗口。已修复为 `datetime(verifying_started_at, '+30 minutes') < datetime('now')`。对比 `checkMatchedTimeout()` 一直用 `matched_at + 30min` 是正确的。位置：exchange-machine.js:295。

46. **sendCommand 是 fire-and-forget，花钱操作必须用 sendCommandAsync。** `sendCommand()` 只把命令发给 Relay 子进程，不等回执。如果 Relay 执行失败（地址网络不匹配、UTXO 不足、KIP-9 storage mass 超限），Console 不知道，API 返回 `{ok:true}` 给前端——用户以为成功但钱没动。`sendCommandAsync()` 带 `requestId`，Relay 执行完后 `process.send()` 回传结果，Console 等待后返回真实 txId/error。**所有涉及链上操作的命令（transfer/handshake/split_utxo）都必须用 sendCommandAsync。** 位置：relay.js `/api/relay/:id/transfer`。教训来源：2026-04-12 用户提币三次显示成功但全部失败。

47. **分配 adapter 不等于启动 relay。** `relay-manager.js:startAll()` 只在 Console 启动时跑一次。之后在 UI 上把 adapter 分配给 relay 只更新 DB，不启动 relay 进程。已修复：`/relays/:id/assign` 分配 adapter 后自动调 `startRelay()`。位置：relay.js `/relays/:id/assign`。教训来源：2026-04-12 NWT 分配 adapter 后 relay 始终 not running。

48. **Agent 默认不主动握手。** `action-executor.mjs:initiateHandshake()` 入口检查 `this.config.autoHandshake`，默认 false。Brain proactive 生成的 `INITIATE_HANDSHAKE` ACTION 会被拦截。开关存储在 `relay_nodes.social_overrides` JSON 的 `autoHandshake` 字段。UI 在 `/agent` 页 Focus Mode 下方。**被动接受握手不受影响**（收到别人的握手仍自动接受）。教训来源：2026-04-12 NWT 刚启动就主动花 0.2 KAS 给陌生人握手。

49. **Bridge 是 Claude Code 的命脉，必须始终活跃。** `cc-bridge.mjs` 是 Claude Code 连接 KANet 的专用通道。NWT Agent = Claude Code 在链上的化身。Bridge 的 `cc_active` 变 false（30 秒无 poll）意味着 Claude Code 失联——NWT 的 Mind 请求会堆积直到 5 分钟超时，所有链上消息无人回复。**Claude Code 轮询必须同时覆盖三个源：Bridge（GET /cc/pending）、dev-coord（链上开发协调）、Git（代码变更）。漏掉任何一个都是失职。** 教训来源：2026-04-12 Claude Code 只盯 dev-coord 和 Git 而完全遗忘 Bridge，导致 NWT 失联 2.5 小时。

### 致命陷阱（4/12 P0 专项修复）

49. **VALID_TRANSITIONS 必须包含 verified 状态。** delivering 失败 3 次回退到 verified，但 verified 不在 VALID_TRANSITIONS 的 key 里也不在 TERMINAL set 里——交易永久卡死，fund_lock 永不释放。已修复：`verified: ['delivering', 'disputed', 'timed_out']`。**不含 cancelled**——verified 意味着 taker 已付款或 KAS 已发出，maker 不能单方面 cancel。位置：exchange-machine.js:29。

50. **delivering 和 verified 状态必须有超时清理。** `timeoutVerifying()` 只查 verifying/awaiting 状态，delivering 和 verified 无超时 = 永久卡住。已修复：delivering 60min→verified（回退重试），verified 120min 总窗口→timed_out（释放资金）。超时用 `delivering_at`（专用字段），**不用 `updated_at`**（任何字段变化都会刷新 updated_at 导致计时器重置）。位置：exchange-machine.js timeoutVerifying()。

51. **accept 必须广播成功后才调 processAccept。** 旧逻辑先 processAccept（写 matched）再广播，广播失败后 auto-pay 已触发。已修复：广播 5 次重试→失败 return 500 不变 DB→成功才 processAccept 用真实 txId。与 publish 路径一致。位置：exchange.js accept 端点。

52. **timeout 广播必须成功后才 reopen offer。** 旧逻辑先 SQL UPDATE（matched→open）再广播，广播失败后本地已 reopen 但链上没有 timeout TX——其他节点仍看到 matched。已修复：广播先于 SQL UPDATE，失败 continue 保留 matched 下轮 5min tick 重试。非本地 maker（无 relay）走 local-only timeout。位置：exchange-machine.js checkMatchedTimeout()。

53. **processAccept 必须拒绝自我接单。** maker 接自己的 offer 可以触发 auto-pay 给自己，制造虚假成交。已修复：`msg._from === offer.maker` → reject。位置：exchange-machine.js processAccept()。

54. **_autoSendKas paid 广播失败不能推进 processPaymentSubmit。** 铁律不分场景——即使 KAS TX 是本地节点发的，paid 广播失败意味着 maker 节点不知道 taker 已付款。maker 超时 reopen，另一个 taker 接单 = 双重交割。已修复：5 次重试→失败不调 processPaymentSubmit→记 chain_event(exchange_paid_broadcast_failed) 留痕。位置：trade-protocol-filter.js _autoSendKas()。

### 致命陷阱（4/13 Portfolio + 钱包统一）

55. **预测请求被错分为 observe → L3 诊断（CJK \b 复发）。** intent-detector.mjs 的 market context guard 用 `\b` word boundary 判断关键词出现位置——CJK 字符无 word boundary，断言永远 false，预测/价格类问题被误判为 observe layer，触发系统诊断 plan，结果被注入用户 prompt（`--- DIAGNOSTIC RESULTS ---`），AI 回答系统状态而不是市场分析。**修复双重根因：**(a) `\b` 改为字符类匹配 + 起止边界；(b) 旧的 `peer === currentSpeaker` 死代码用 message 当 peer 比对，永远 false。**教训**：陷阱 #12 不是孤例，所有 CJK 字符串匹配必须避免 `\b`。**调试方法论**：AI 答非所问时，先 dump 真实 prompt，不要靠症状猜测因果。教训来源：2026-04-13 Sophie 预测 BTC 答系统诊断。

56. **Portfolio 五卡严格遵守单一统计原则。** 任何资产只能进一个 bucket：`KAS / 稳定币 / 其他资产(原生) / DeFi / Perp Equity`。grandTotalUsd = stable + native + defi + perpEquity，不重叠。Aave netUsd（collateral - debt）只进 defiTotalUsd；HL/Aevo accountValue 只进 perpEquityUsd；Polymarket approxValueUsd 只进 defiTotalUsd（CTF 合约持仓不在 EOA）；exchange fund_locks 是显示锁定不进任何总额（KAS 已在钱包里）。原生代币价格走 `getCachedNativePrice(chain)`（market-data.js CoinGecko 60s TTL，9 链全覆盖）。位置：portfolio.js `_aggregateForRelay()`。

57. **`/send` 是钱包出口的唯一端点，三链分发。** 旧 `/api/trade/withdraw` 只支持 BNB/ETH。已统一为 `POST /api/relay/:id/wallets/:walletId/send`，body `{asset, amount, to}`，`asset` 可为 `usdt/usdc/native`。EVM 7 链走 evm-transfer.js（withFallbackRpc）；`chain==='sol'` 分发 transferSPL 或 transferSolNative；`chain==='tron'` 分发 transferTRC20 或 transferTronNative。**目的地址校验必须按链别**：EVM `0x[40 hex]`、SOL base58 32-44、TRON `T[base58 33]`。Portfolio 和 Exchange 两个页面共用此端点，是钱包出口的唯一真相源。位置：relay.js `/wallets/:walletId/send`。

58. **没有原生代币就是废链。** SOL/USDT 转账失败如果 SOL 余额为 0 = 没有 gas 付租金/手续费；TRON 同理需要 TRX 付带宽和 energy。sol-transfer.js 和 tron-transfer.js 必须同时暴露 native 转账（`transferSolNative` 用 SystemProgram.transfer，`transferTronNative` 用 `tronWeb.trx.sendTransaction`）。`/send` 端点 `asset==='native'` 走 native 路径。**Owner 原则**：任何加入 Portfolio 的链都必须支持原生代币转出，否则 USDT/USDC 余额是死锁。教训来源：2026-04-13 Sophie POL 钱包原生 MATIC 不显示。

59. **Add Wallet 多链选择必须用全屏 modal，不能用 dropdown。** Agent 卡片父容器有 `overflow-hidden`（卡片圆角），absolute 定位的 dropdown 会被裁切，9 条链只显示 4 条（被裁掉 5 条）。已改为 `addWalletModal.open` 全屏居中 modal，列出全部 9 条链不做 ownership 过滤（同一链可以加多个钱包，badge 显示 "N existing"）。**SUPPORTED_CHAINS_INFO 在 portfolio.eta 和 exchange.eta 各有一份**，新增链时两边都要改——临时解（待提取共享模块）。位置：portfolio.eta `addWalletModal` + `SUPPORTED_CHAINS_INFO`。

---

