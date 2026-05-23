# Aave V3 连接方案

> 日期：2026-04-12
> 负责：J2（写） → Martin（审代码） → NWT（实测）
> 状态：方案待审

## 目标

Agent 连接 Aave V3 借贷协议（Arbitrum 部署），实现存 USDC 赚利息、抵押借款。

## 架构——4 层

### 底层：aave-client.js

纯 ethers.js 合约调用，不碰 DB，不碰 Mind。

```javascript
// Arbitrum 合约地址
const POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const RPC  = 'https://arb1.arbitrum.io/rpc';

// 4 个核心操作
async function supply(privateKey, asset, amount)   // 存入赚利息
async function withdraw(privateKey, asset, amount) // 取回资产
async function borrow(privateKey, asset, amount, rateMode=2) // 抵押借款（2=浮动利率）
async function repay(privateKey, asset, amount, rateMode=2)  // 还款

// 查询
async function getAccountData(address)
// 返回: { totalCollateralUSD, totalDebtUSD, availableBorrowUSD, ltv, healthFactor }

async function getAssetAPY(asset)
// 返回: { supplyAPY, borrowAPY }
```

**关键实现细节：**
- supply/repay 前必须 ERC20 approve（Pool 地址）
- amount 用 token 原生精度（USDC=6, WETH=18）
- getUserAccountData 返回 USD 值用 8 位精度
- healthFactor 用 18 位精度（>1e18 = 安全）

### API 层：/api/defi/aave/*

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/defi/aave/status | 当前存借状态 + APY |
| POST | /api/defi/aave/supply | 存入 { walletId, asset, amount } |
| POST | /api/defi/aave/withdraw | 取回 { walletId, asset, amount } |
| POST | /api/defi/aave/borrow | 借款 { walletId, asset, amount } |
| POST | /api/defi/aave/repay | 还款 { walletId, asset, amount } |

所有 POST 端点从 agent_wallets 取加密私钥 → 解密 → 调 aave-client → 返回 txHash。

### Skill 层：aave-manager.mjs

Mind skill，和 market-scanner/stock-tracker 同模式。

```
gatherContext():
  - 调 /api/defi/aave/status 拿状态
  - 返回 { instructions, data }

formatForBrain():
  === AAVE LENDING (Arbitrum) ===
  Deposited: 57.80 USDC (APY 3.2%)
  Borrowed: 0 USDC
  Health Factor: ∞ (no debt)
  Available to borrow: 46.24 USDC (80% LTV)
  
  Rules:
  - AAVE_SUPPLY: deposit idle USDC to earn yield
  - AAVE_WITHDRAW: retrieve deposited assets
  - Health Factor must stay above 1.5
```

ACTION 格式：
```
[ACTION:AAVE_SUPPLY asset=USDC amount=50]
[ACTION:AAVE_WITHDRAW asset=USDC amount=20]
[ACTION:AAVE_BORROW asset=USDC amount=30]
[ACTION:AAVE_REPAY asset=USDC amount=30]
```

### UI 层

Exchange Operator Tools 加 **DeFi** tab：
- 显示 Aave 存借状态（存款/借款/健康因子/APY）
- Supply/Withdraw 按钮
- 健康因子进度条（绿>2.0 / 黄1.5-2.0 / 红<1.5）

## 安全规则

1. **healthFactor < 1.5 禁止新 borrow** — 防清算
2. **borrow 默认 approval 模式** — 不自动借款，需 Owner 确认
3. **单笔 supply/withdraw 上限** — config_entries 可配（默认 1000 USDC）
4. **私钥解密走现有链路** — agent_wallets.privkey_encrypted → decrypt()

## 改动文件

| 文件 | 操作 | 行数估计 |
|------|------|---------|
| kasia-console/src/services/aave-client.js | **新建** | ~120 |
| kasia-console/src/api/defi.js | **新建** | ~80 |
| agent-mind/src/skills/aave-manager.mjs | **新建** | ~100 |
| kasia-console/src/ui/exchange.eta | 修改（加 DeFi tab） | ~30 |
| kasia-console/src/index.js | 修改（注册 defi 路由） | ~2 |

总计：新增 ~300 行，修改 ~32 行。

## 依赖

- ✅ Arbitrum 钱包已创建（0x9E1338...）
- ✅ USDC 57.80 已到账
- ✅ ETH gas 0.004 已到账
- ✅ ethers.js 已在项目中
- ✅ Uniswap swap 代码可参考（relay.js 624-718）

## 风险

- Aave V3 合约地址需要确认（用的是官方文档地址）
- APY 查询可能需要额外合约调用（PoolDataProvider）
- Arbitrum RPC 免费节点可能有速率限制
