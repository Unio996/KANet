# Aevo Options Connection — NWT Proposal

> 日期：2026-04-12
> 状态：待审查（Martin 审 → J2 测）

## 目标

连接 Aevo 期权协议，Agent 可以买卖期权、管理持仓、查看 Greeks。部署在 Arbitrum，存款走 USDC。

## 架构（4 层，和 Aave 一致）

### L1: aevo-client.js（纯函数，REST API + 签名）

Aevo 用 REST API + API Key 认证（不是合约调用）。

```javascript
// 核心操作
createOrder({ instrument, side, amount, price, orderType }) → orderId
cancelOrder(orderId) → boolean
getPositions() → [{ instrument, side, amount, avgPrice, markPrice, pnl, greeks }]
getOrderbook(instrument) → { bids, asks }
getAccount() → { equity, available, margin_used, portfolio_greeks }

// Greeks 查询
getInstrumentGreeks(instrument) → { delta, gamma, theta, vega, iv }
```

**认证**（双层）：
- REST API：API Key + API Secret（header 认证）
- Order 签名：EIP-712 typed data 签名（signing_key，和 Hyperliquid 同模式）
- 存 `agent_connections` 表（auth_mode=api_key），走现有 encrypt/decrypt 链路。

**后续增强**：WebSocket 实时推送（orderbook + 持仓变动），第一版用 REST 轮询。

**API Base**：`https://api.aevo.xyz`（主网）

### L2: API 端点（kasia-console/src/api/defi.js 扩展）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/defi/aevo/account` | 账户状态（equity/margin/available） |
| GET | `/api/defi/aevo/positions` | 持仓列表（含 Greeks） |
| GET | `/api/defi/aevo/orderbook/:instrument` | 订单簿 |
| POST | `/api/defi/aevo/order` | 下单（买/卖 call/put） |
| DELETE | `/api/defi/aevo/order/:id` | 取消订单 |

### L3: Skill 层（agent-mind/src/skills/aevo-manager.mjs）

Mind 感知期权持仓和 Greeks：

```
AEVO POSITIONS:
  ETH-20260501-4000-C: Long 2 @ $45.20 | Mark $52.10 | PnL +$13.80
    Delta 0.65 | Gamma 0.02 | Theta -$3.40 | Vega $8.20 | IV 42%
  BTC-20260601-120000-P: Long 1 @ $1200 | Mark $980 | PnL -$220
    Delta -0.35 | Gamma 0.01 | Theta -$5.80 | Vega $15.40 | IV 55%

Portfolio Greeks: Delta +0.95 | Gamma +0.05 | Theta -$12.60

INSIGHT: Portfolio is net long delta — bullish bias. High theta decay.
```

**激活条件**：reactive 关键词（options/greeks/aevo/put/call），proactive 每小时。

### L4: UI（/aevo 独立页面）

**布局**：
```
/aevo
├── Header: Account Overview（equity/available/margin used/portfolio Greeks）
├── Positions Table
│   ├── Instrument | Side | Qty | Avg Price | Mark | PnL | Delta | Theta | IV
│   └── Close 按钮
├── Order Form
│   ├── Instrument 选择（ETH/BTC expiry/strike/type）
│   ├── Side（Buy/Sell）
│   ├── Quantity + Price
│   └── Submit
└── Greeks Dashboard
    ├── Portfolio Greeks 面板（Delta/Gamma/Theta/Vega 柱状图）
    └── IV Surface（如果数据可用）
```

## 安全规则

1. 单笔期权成本上限：config_entries `aevo_max_order_usdc`，默认 100 USDC
2. Margin 使用率上限：config_entries `aevo_max_margin_used_pct`，默认 80%（超过禁止新开仓）
3. 卖期权（naked short）需要 Owner approval（`aevo_naked_short_mode=approval`）
4. 所有操作记录 chain_event（aevo_order/aevo_cancel）
5. API Key 加密存储，走现有 encrypt/decrypt

## 改动范围

| 文件 | 动作 | 行数估计 |
|------|------|---------|
| kasia-console/src/services/aevo-client.js | 新建 | ~150 |
| kasia-console/src/api/defi.js | 扩展 | ~80 |
| agent-mind/src/skills/aevo-manager.mjs | 新建 | ~100 |
| kasia-console/src/ui/aevo.eta | 新建 | ~200 |
| kasia-console/src/index.js | 路由注册 | ~5 |

**总计**：~535 行，5 个文件。

## 与 Aave/Hyperliquid 的区别

| | Aave | Hyperliquid | Aevo |
|---|------|-------------|------|
| 类型 | 借贷 | 永续合约 | 期权 |
| 连接方式 | 合约调用 | EIP-712 签名 | REST + API Key |
| 核心数据 | healthFactor | PnL/资金费率 | Greeks/IV |
| 风险指标 | 清算线 | 爆仓价 | 组合 Delta |
| 存款链 | Arbitrum | Arbitrum | Arbitrum |

## 审查要点

请 Martin 审查时关注：
1. API Key 管理——复用 agent_connections 还是新建 aevo_credentials？
2. 签名方式——HMAC-SHA256 具体实现
3. 期权 instrument 命名规范（ETH-YYYYMMDD-STRIKE-C/P）
4. naked short 的 approval 流程怎么和 execution_states 对接
