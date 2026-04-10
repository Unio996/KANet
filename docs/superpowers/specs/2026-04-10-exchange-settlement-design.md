# KANet Free Market Settlement Architecture

> 设计日期：2026-04-10
> 状态：Draft — 等待 review 后分阶段实施

---

## 定位

KANet 的自由市场不是一个 DEX，不是一个 OTC 平台——它是**跨链万物交易协议**。

三个核心原语：
1. **报价广播** — 任何资产、任何链、任何数量，一笔链上 TX 全网可见
2. **跨链验证** — 不依赖桥，直接在目标链上验证转账
3. **自动结算** — 验证通过后自动交割 + 对冲，无需人工

交易双方不需要在同一条链上，不需要持有同一种资产，不需要信任对方。协议本身就是信任层。

---

## 现有能力清单

### 已实现且可用

| 能力 | 位置 | 状态 |
|------|------|------|
| exchange_offers 表（链无关、资产无关） | migrate.js v38-39 | 32 字段，完整状态机 |
| 状态机（open→matched→verifying→completed） | exchange-machine.js | 完整，含超时+争议 |
| 链上广播（bcast 明文格式） | relay.mjs send_broadcast | 已修复，Scout 可索引 |
| 跨链 USDT 验证（BNB/ETH/SOL/TRON） | cross-chain-verify.mjs | 4 链完整，3 次重试 |
| 多链钱包（私钥加密存储） | agent_wallets 表 | Martin: BNB/ETH/SOL/TRON |
| Uniswap V3 Swap（稳定币互换） | relay.js:611-705 | Polygon/BNB/ETH 三链 |
| CEX 自动对冲（6 家交易所） | trade-protocol-filter.js executeHedge | 限价单 + 熔断 |
| Seeder 自动挂单 | market-seeder.js | 5min tick，价格跟随市价 |
| submit-payment 端点 | exchange.js:335-354 | taker 提交 TX hash |
| _verifyAndComplete 异步验证 | exchange-machine.js:333-401 | 3 次 × 60s，失败自动 dispute |
| KAS 发送（Relay IPC） | relay.mjs type:transfer | 可编程调用 |
| Fund Lock 资金锁定 | fund-lock.js | 完整，但只接 mm_orders |

### 未接通（Gap）

| Gap | 描述 | 影响 |
|-----|------|------|
| 挂单无收款地址 | verification_meta 是空 JSON | 买家不知道往哪付 |
| 接单无选链 | accept 不接收 selected_chain | 多链收款无法锁定 |
| 验证后不发 KAS | completed 后只做对冲，不自动发 KAS | 交割断裂 |
| Swap 白名单过窄 | 只有 USDC/USDT/USDC.e | 不能收 ETH/BNB 等 |
| 跨链验证只验 USDT | verifyCrossChainTx 只解析 Transfer 事件 | 不能验证原生币或其他 token |
| Fund Lock 未接入 | exchange_offers 不锁 KAS | 超卖风险 |
| Brain 无感知 | proactive 上下文没有 exchange_offers | Agent 不知道单子被接了 |

---

## 交易场景全景

### 场景 1：KAS → USDT（Phase 1 核心）

最简单、最高频的场景。卖家有 KAS，买家有 USDT。

```
卖家(Martin)                           买家(外部用户)
    │                                      │
    │  挂单: SELL 100 KAS                  │
    │  want: 3.25 USDT                     │
    │  accept: BNB/ETH/SOL/TRON            │
    │  收款地址: 0x9477...(BNB)            │
    │         0x5A0E...(ETH)               │
    │         J2b9...(SOL)                 │
    │         TT9U...(TRON)                │
    │◄─────────────────────────────────────│
    │                                      │  看到挂单
    │                                      │  选择 BNB 链
    │                                      │  Accept
    │  matched                             │
    │                                      │  付 3.25 USDT 到 0x9477...(BNB)
    │                                      │  提交 TX hash
    │  verifying                           │
    │  _verifyAndComplete:                 │
    │    ✓ BNB链确认15块                   │
    │    ✓ 金额 ≥ 3.25 USDT               │
    │    ✓ 收款地址匹配                     │
    │  completed                           │
    │                                      │
    │  自动: 发 100 KAS 给买家             │◄─── 收到 KAS
    │  自动: CEX 买回 100 KAS（对冲）       │
    │  Done                                │
```

### 场景 2：KAS → 任意 ERC20

买家没有 USDT，但有 ETH/BNB/DAI 等。

```
卖家(Martin)                           买家
    │                                      │
    │  挂单: SELL 100 KAS                  │
    │  want: 3.25 USDT (等值任意资产)       │
    │◄─────────────────────────────────────│
    │                                      │  没有 USDT，有 ETH
    │                                      │  选择 ETH 链，付 0.001 ETH
    │                                      │  提交 TX hash
    │  verifying:                          │
    │    ✓ 验证 ETH 到账                   │
    │    ✓ 自动 swap ETH → USDT            │
    │    ✓ 到账 USDT ≥ 3.25               │
    │  completed                           │
    │  自动发 KAS + 对冲                    │
```

**关键：** swap 发生在卖家侧，买家不需要关心。买家用什么付就付什么，卖家的 Agent 自动换成想要的资产。

### 场景 3：跨链资产桥

不涉及 KAS，纯粹的跨链资产转移。

```
用户 A                                 用户 B
    │                                      │
    │  挂单: GIVE 100 USDT (tron)          │
    │  WANT: 99.5 USDT (bnb)              │
    │◄─────────────────────────────────────│
    │                                      │  有 BNB 链 USDT
    │                                      │  Accept → 付 99.5 USDT (BNB) 给 A
    │  验证 BNB 到账                       │
    │  自动发 100 USDT (TRON) 给 B         │◄─── 收到 TRON USDT
    │  Done (赚 0.5 USDT 桥接费)           │
```

**Agent 可以自主做这个：** 看到 TRON↔BNB 价差 → 自动挂跨链桥单 → 赚桥接费。

### 场景 4：服务/实物交易

```
卖家                                   买家
    │                                      │
    │  挂单: GIVE 1 "Code Review (10h)"    │
    │  WANT: 500 KAS                       │
    │  verification: manual                │
    │◄─────────────────────────────────────│
    │                                      │  Accept
    │  awaiting_manual_confirm             │
    │  （线下完成 Code Review）              │
    │  双方各自 Confirm                     │
    │  completed                           │
```

manual 验证不能自动化——但这没关系。协议不限制资产类型，只限制验证方式。

### 场景 5：Agent 跨链套利

```
Agent(Martin)                          Agent(Sophie)
    │                                      │
    │  发现: TRON USDT 比 BNB 贵 0.3%     │
    │  挂单: GIVE 100 USDT (bnb)           │
    │  WANT: 100.3 USDT (tron)             │
    │◄─────────────────────────────────────│
    │                                      │  发现: 这笔我有 TRON USDT
    │                                      │  Accept → 付 100.3 USDT (TRON)
    │  验证 TRON 到账                       │
    │  自动发 100 USDT (BNB) 给 Sophie     │
    │  Martin 赚 0.3 USDT                  │
    │  Sophie 赚了 BNB 链上的 USDT         │
```

---

## 结算架构设计

### 核心原则

1. **验证在先，交割在后** — 永远先验证买家付款，再发送卖家资产
2. **原子性** — 验证+交割+对冲作为一个事务，任何环节失败全部回滚
3. **链无关** — 同一套逻辑处理所有链，差异封装在验证器和钱包层
4. **资产无关** — 报价格式不限制资产类型，验证器按资产类型路由

### 结算流程（通用）

```
┌─────────────────────────────────────────────────────┐
│                    PUBLISH                          │
│  give: {asset, amount, chain}                       │
│  want: {asset, amount, chain}                       │
│  accepted_chains: [{chain, address}, ...]           │
│  verification: cross_chain_tx / manual / kaspa_tx   │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                    ACCEPT                           │
│  taker 选择 payment_chain                           │
│  锁定 receive_address (从 accepted_chains 取)       │
│  写入 taker_chain + taker_payment_address           │
│  状态: open → matched                              │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                SUBMIT PAYMENT                       │
│  taker 付款（链上转账）                              │
│  提交 TX hash                                       │
│  状态: matched → verifying                          │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│               VERIFY (async, 3×60s)                 │
│                                                     │
│  路由到验证器:                                       │
│  ├─ USDT Transfer → verifyCrossChainTx              │
│  ├─ 原生币 (ETH/BNB) → verifyNativeTransfer (TODO)  │
│  ├─ 任意 ERC20 → verifyERC20Transfer (TODO)         │
│  ├─ KAS → verifyKaspaTransfer (已有)                │
│  └─ manual → 双方手动确认                            │
│                                                     │
│  验证通过 → completed                               │
│  3次失败 → auto-dispute                             │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              SETTLEMENT (auto)                      │
│                                                     │
│  1. 发送 give_asset 给 taker                        │
│     ├─ KAS: Relay IPC type:transfer                 │
│     ├─ EVM token: ethers.js transfer                │
│     └─ SOL/TRON: 对应 SDK                           │
│                                                     │
│  2. 可选 swap (如果收到的不是想要的资产)              │
│     └─ Uniswap V3 exactInputSingle                  │
│                                                     │
│  3. CEX 对冲 (如果涉及 KAS)                         │
│     └─ executeHedge 限价单                           │
│                                                     │
│  4. 记录 chain_events                               │
│                                                     │
│  任何步骤失败 → dispute + 释放 fund_lock             │
└─────────────────────────────────────────────────────┘
```

### 验证器扩展路线

| 阶段 | 验证器 | 支持资产 | 复杂度 |
|------|--------|---------|--------|
| Phase 1 | verifyCrossChainTx | USDT (BNB/ETH/SOL/TRON) | 已完成 |
| Phase 2 | verifyNativeTransfer | ETH, BNB, MATIC, SOL 原生币 | 低 — 查 TX value 字段 |
| Phase 3 | verifyERC20Transfer | 任意 ERC20 (白名单) | 低 — 改 Transfer 事件的 token 地址 |
| Phase 4 | verifyWithSwap | 收到非目标资产 → auto swap → 验证最终到账 | 中 — 组合 verify + swap |
| Future | verifyBTC | BTC 链验证 | 高 — 需要 BTC RPC |

### Swap 扩展路线

当前白名单（relay.js SWAP_TOKENS）：

```javascript
// 现有
polygon: { usdc, usdc.e, usdt }
bnb:     { usdc, usdt }
eth:     { usdc, usdt }

// Phase 2 扩展
polygon: { + wmatic, weth, dai }
bnb:     { + wbnb, busd, dai }
eth:     { + weth, dai, frax }

// Phase 3: 开放白名单配置
// 任何有 Uniswap V3 池子的 ERC20 都可以加
```

### 交割资产发送能力

| 资产类型 | 发送方式 | 已有？ |
|---------|---------|--------|
| KAS | Relay IPC `type: transfer` | ✅ 已有 |
| EVM 原生币 (ETH/BNB/MATIC) | ethers.js `signer.sendTransaction` | ✅ 钱包+私钥已有，发送逻辑需加 |
| ERC20 (USDT/USDC/任意) | ethers.js `contract.transfer` | ✅ swap 里已有 approve 逻辑，transfer 类似 |
| SOL SPL Token | @solana/web3.js | ⚠️ 钱包有，发送需加 |
| TRC20 | tronweb | ⚠️ 钱包有，发送需加 |

---

## 分阶段实施

### Round 1：USDT 直付链路打通（当前）

**目标：** 买家能看到收款地址 → 选链 → 付 USDT → 自动验证 → 自动发 KAS

改动：
- market-seeder.js: 发布时查 agent_wallets 带多链收款地址
- exchange.js: accept 接收 selected_chain
- exchange-machine.js: _verifyAndComplete 后自动发 KAS
- exchange.eta: 显示收款地址 + 选链 + 提交 TX hash
- fund-lock 接入 exchange_offers

不改：
- 验证器（已有 USDT 验证）
- 状态机逻辑
- submit-payment 端点（已有）
- CEX 对冲（已有）

### Round 2：原生币支付 + Swap

**目标：** 买家可以用 ETH/BNB 等原生币付款

改动：
- cross-chain-verify.mjs: 加 verifyNativeTransfer（查 TX value）
- exchange-machine.js: 收到非 USDT 后触发 auto-swap
- relay.js: swap 白名单扩展 + 多跳路由
- exchange.eta: 买家选择付款资产（不只是选链）

### Round 3：跨链资产桥

**目标：** 不涉及 KAS 的纯跨链资产转移

改动：
- 结算层支持 EVM token 发送（不只是 KAS）
- 验证器支持任意 ERC20
- Agent 自主发现跨链套利机会

### Round 4：Agent 自主做市

**目标：** Agent 根据市场信号自主挂单/吃单/套利

改动：
- context-builder 注入 exchange_offers 状态
- Brain 做市指令模板
- Agent 间跨链撮合

---

## 安全边界

| 风险 | 防护 | 已有？ |
|------|------|--------|
| 超卖（KAS 不够发） | Fund Lock 锁定 | ⚠️ 需接入 |
| 假付款（TX hash 造假） | 跨链验证 3×60s | ✅ |
| 验证超时 | 自动 dispute | ✅ |
| CEX 对冲失败 | 熔断器（3次/1h） | ✅ |
| UTXO 冲突 | Relay mutex | ✅ |
| Agent 私钥泄露 | 加密存储 + 进程隔离 | ✅ |
| Swap 滑点 | 5% slippage 上限 | ✅ |
| 重放攻击 | TX hash 去重 | ✅ |

---

## 与老 OTC 系统的关系

| | 老 OTC (mm_orders) | 新自由市场 (exchange_offers) |
|--|-------------------|---------------------------|
| 报价方式 | Brain 生成 ACTION | Seeder 自动 / Brain / 手动 |
| 链上存在 | 无（纯 DB） | 有（bcast 广播） |
| 验证 | 手动 / 跨链 | 跨链为主，手动兜底 |
| 交割 | auto-advance 状态机 | _verifyAndComplete |
| 对冲 | 有 | 有 |
| 资产类型 | 只有 KAS↔USDT | 任意资产↔任意资产 |
| 跨链 | 固定 4 链 | 可扩展 |

**长期方向：** exchange_offers 吃掉 mm_orders 的功能。不需要两套系统。

---

## 一句话总结

KANet 的自由市场 = **链上报价 + 跨链验证 + 自动结算 + Agent 做市**。不是 DEX，不是 CEX，不是桥——是三者的协议级融合，由 AI Agent 自主运营。
