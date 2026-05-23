# Hyperliquid 永续合约连接方案

> 日期：2026-04-12
> 负责：Martin（写） → NWT（审代码） → J2（测）
> 状态：方案待审

## 目标

Agent 连接 Hyperliquid 永续合约 DEX（Arbitrum L1 结算），实现做空对冲 KAS 下跌风险、趋势跟踪、资金费率套利。

## 架构——4 层（与 Aave 一致）

### 底层：hyperliquid-client.js

npm 包 `hyperliquid`（官方 SDK），EIP-712 钱包签名。

```javascript
import { Hyperliquid } from 'hyperliquid';

// 初始化（用 Arbitrum 私钥，和 Aave 同一个钱包）
const sdk = new Hyperliquid({ privateKey, testnet: false });
await sdk.connect();

// 核心操作
async function placeOrder(params)     // 开仓/加仓
async function closePosition(asset)   // 平仓
async function getPositions()         // 查持仓
async function getAccountInfo()       // 查账户（余额/保证金/PnL）
async function cancelOrder(orderId)   // 取消委托
async function setLeverage(asset, leverage) // 设杠杆
async function getOpenOrders()        // 查活跃委托
async function getFundingRate(asset)  // 查资金费率
```

**关键实现细节：**
- 认证：EIP-712 typed data 签名，用 Arbitrum 私钥。支持 agent wallet（委托签名，不暴露主钥）
- **关键陷阱**：查询持仓/账户时必须用 master 钱包地址，不能用 agent wallet 地址（返回空数据）
- 存款：Arbitrum USDC → Hyperliquid bridge（链上 TX，1-3 分钟到账，最低 5 USDC）
- 提款费：1 USDC（固定）
- 下单：REST POST `/exchange`，EIP-712 签名后提交。市价(IOC)/限价(GTC)/止损止盈(trigger)
- 持仓：szi 有符号（正=多，负=空），unrealizedPnl 实时算
- 资金费率：每 8h 结算，正费率空头收钱，负费率多头收钱
- Node.js 版本：npm `hyperliquid` 需 v22+（原生 WebSocket）
- Rate limit：1200 weight/min，单请求 1 weight

### API 层：/api/defi/hyperliquid/*

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/defi/hyperliquid/status | 账户状态（余额/持仓/PnL） |
| GET | /api/defi/hyperliquid/positions | 当前持仓列表 |
| GET | /api/defi/hyperliquid/funding | 资金费率（当前+历史） |
| POST | /api/defi/hyperliquid/order | 下单 { asset, side, size, price?, type, leverage } |
| POST | /api/defi/hyperliquid/close | 平仓 { asset } |
| DELETE | /api/defi/hyperliquid/order/:id | 取消委托 |
| POST | /api/defi/hyperliquid/deposit | 从 Arbitrum 存入 USDC |
| POST | /api/defi/hyperliquid/withdraw | 提取 USDC 回 Arbitrum |

所有 POST 端点从 agent_wallets 取加密私钥 → 解密 → 调 hyperliquid-client。

### Skill 层：hyperliquid-manager.mjs

Mind skill，和 stock-tracker/aave-manager 同模式。

```
gatherContext():
  - 调 /api/defi/hyperliquid/status 拿账户
  - 调 /api/defi/hyperliquid/funding 拿费率
  - 返回 { instructions, data }

formatForBrain():
  === HYPERLIQUID PERPETUALS ===
  Account: $57.80 USDC | Margin Used: $12.50 | Available: $45.30
  
  Positions (1):
    ETH-PERP: SHORT 0.1 @ $3,250 | Unrealized: +$8.50 | Leverage: 5x
    Liq Price: $3,580 | Funding: +0.003%/8h (earning)
  
  Funding Rates:
    BTC: +0.012% | ETH: +0.003% | KAS: -0.008%
  
  Rules:
  - HYPER_OPEN: open long/short position
  - HYPER_CLOSE: close position
  - Max leverage: 5x (configurable)
  - Stop-loss mandatory for all positions
```

ACTION 格式：
```
[ACTION:HYPER_OPEN asset=ETH side=SHORT size=0.1 leverage=5 stop_loss=3580]
[ACTION:HYPER_CLOSE asset=ETH]
```

### UI 层

DeFi 大 tab → Hyperliquid sub-tab：
- 账户概览：余额/保证金使用率/总 PnL
- 持仓列表：每行含 asset/方向/size/entry/mark/PnL/liq price/funding
- 下单面板：asset 选择/方向/数量/杠杆/止损/止盈
- 资金费率表：主流 perp 的当前费率+8h 趋势
- 历史交易记录

## 安全规则

1. **最大杠杆 5x**（config_entries `hyper_max_leverage`，默认 5）
2. **止损强制**：开仓必须设止损，否则拒绝
3. **单仓位上限**：config_entries `hyper_max_position_usdc`（默认 50 USDC）
4. **总仓位上限**：账户 margin 使用率 < 60%，超过禁止新开仓
5. **做空需 Owner 确认**：默认 approval 模式，auto 需显式开启
6. **私钥复用 Arbitrum 钱包**：和 Aave 同一个 agent_wallets 记录

## 改动文件

| 文件 | 操作 | 行数估计 |
|------|------|---------|
| kasia-console/src/services/hyperliquid-client.js | **新建** | ~150 |
| kasia-console/src/api/defi.js | 修改（加 hyperliquid 路由） | ~100 |
| agent-mind/src/skills/hyperliquid-manager.mjs | **新建** | ~120 |
| kasia-console/src/ui/exchange.eta | 修改（DeFi tab 加 Hyperliquid sub-tab） | ~50 |

总计：新增 ~270 行，修改 ~150 行。

## 依赖

- npm 包：`hyperliquid`（官方 SDK）
- Arbitrum 钱包已创建（和 Aave 共用）
- USDC 余额用于保证金（和 Aave 共享，注意不要双重占用）
- ethers.js 已在项目中

## 与 Aave 的资金冲突

**关键问题**：Aave supply 锁定 USDC + Hyperliquid deposit 也锁定 USDC。同一笔钱不能两边用。

**解法**：
- Agent 资产总览里显示「Aave 存入 / Hyperliquid 保证金 / 可用余额」三部分
- 开仓前检查：Arbitrum 钱包 USDC 余额（不含 Aave 存入的），够才下单
- Skill 层 gatherContext 同时拉 Aave status + Hyperliquid status，Brain 看到完整资金画像

## 风险

- Hyperliquid SDK 版本兼容性（npm 包更新频繁）
- 资金费率套利需要精确计时（8h 结算窗口）
- 清算风险：5x 杠杆 ETH 20% 反向移动即爆仓
- Arbitrum → Hyperliquid 存款需要链上 TX（gas）

## 审查要点（请 NWT/J2 关注）

1. SDK 初始化：`new Hyperliquid({ privateKey })` 是否需要额外参数（如 walletAddress）？
2. 存款流程：Arbitrum USDC → Hyperliquid 的合约地址和 ABI？SDK 是否封装了？
3. 止损实现：SDK 原生支持 TP/SL 还是需要单独下条件单？
4. 资金费率查询：API 是否返回历史费率还是只有当前？Brain 需要趋势判断
