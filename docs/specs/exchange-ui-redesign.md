# Exchange UI Redesign — Operator Tools 三大 Tab

> 日期：2026-04-12
> 共识：J2 + Martin + NWT 三方确认
> 状态：方案待最终审查

## 目标

Exchange Operator Tools 从扁平 tab 列表重组为三大功能区，覆盖 autoTaker / DeFi / 镜像做市等新模块的 UI 需求。

## 布局

```
Exchange 页面
├── Discovery Bar（顶部：KAS价格 + 钱包摘要 + Agent选择）
├── Split Pane（主体）
│   ├── Left: Market / My Deals / History（面向交易，不变）
│   └── Right: Offer Detail / Accept Flow（不变）
└── Operator Tools（底部展开区，面向运营）
    ├── Trading（资金管理）
    │   ├── Wallet（KAS + 多链钱包，已有）
    │   └── Arbitrage（CEX 余额 + 价差，已有）
    ├── Market Making（做市全家桶）
    │   ├── Seeder（配置 + 统计，已有）
    │   ├── AutoTaker（Proposals + 配置，新建）
    │   └── Mirror（镜像单列表 + 配置，新建，排队）
    └── DeFi（外部协议）
        ├── Aave（存借 + 健康因子，新建）
        ├── Hyperliquid（持仓 + PnL，未来）
        └── Aevo（期权 Greeks，未来）
```

## 顶层 Tab 设计

三个顶层 tab 替代现有的 Wallet/Arb/Seeder 扁平列表：

```html
<div class="flex border-b border-warm-200 px-5">
  <button>Trading</button>      <!-- 资金管理 -->
  <button>Market Making</button> <!-- 做市运营 -->
  <button>DeFi</button>          <!-- 外部协议 -->
</div>
```

每个顶层 tab 内部有 sub-tab（如果有多个子模块）。

## AutoTaker Proposals UI

### 核心展示字段（按重要性排序）

| 字段 | 说明 | 格式 |
|------|------|------|
| 折扣 % | 比市价便宜多少 | `-1.2%` 红色/绿色 |
| 预期利润 | 接单后预计赚多少 | `+$0.38 USDT` 绿色 |
| 数量 | 多少 KAS | `100 KAS` |
| 报价 | 单价 | `0.0319 USDT/KAS` |
| 市价 | 当前 CEX 参考价 | `0.0323` 灰色 |
| 来源 | 谁挂的单 | 地址短码 `...f0kz` |
| 过期 | 还有多久过期 | `12min` 或倒计时 |
| 操作 | | Accept(绿) / Reject(灰) |

### 配置区

- autoTaker 开关（enabled）
- 模式切换（approval / auto）
- 最小折扣 %（min_discount_pct）
- 单笔上限 USDT（max_amount_usdt）
- 日限额（daily_limit）
- 冷却时间（cooldown_min）

### 统计区

- 今日接单数 / 日限额
- 今日总利润（USDT）
- 成功率（accepted / total proposals）

## DeFi Tab — Aave Sub-tab

### 主面板

```
┌──────────────────────────────────────────────┐
│ Aave V3 (Arbitrum)                    [Refresh] │
├──────────────────────────────────────────────┤
│ Deposited    $57.80 USDC      APY 3.2%       │
│ Borrowed     $0.00                            │
│ Health       ██████████████████████ ∞         │
│ Available    $46.24 borrowable                │
├──────────────────────────────────────────────┤
│ [Supply USDC]  [Withdraw]  [Borrow]  [Repay] │
└──────────────────────────────────────────────┘
```

### 健康因子进度条

- 绿色 (> 2.0): 安全
- 黄色 (1.5 - 2.0): 注意
- 红色 (< 1.5): 危险，禁止新借款

### 操作按钮

点击弹出模态框（和 Add Wallet 同模式）：
- 输入金额
- 显示当前余额
- 确认按钮
- 结果显示 TX hash

## Hyperliquid Sub-tab（未来）

```
┌──────────────────────────────────────────────┐
│ Hyperliquid Perps                            │
├──────────────────────────────────────────────┤
│ Account Value  $57.80                        │
│ Unrealized PnL  +$0.00                       │
│ Margin Used    0%                            │
├──────────────────────────────────────────────┤
│ Positions: (none)                            │
│ [Open Position]  [View Orders]               │
└──────────────────────────────────────────────┘
```

## Aevo Sub-tab（未来）

```
┌──────────────────────────────────────────────┐
│ Aevo Options                                 │
├──────────────────────────────────────────────┤
│ Account Balance  $0.00                       │
│ Positions: (none)                            │
│ [Browse Options]  [View Positions]           │
└──────────────────────────────────────────────┘
```

## 不改的部分

- Discovery bar（钱包摘要已在这里，不动）
- Left pane tabs（Market / My Deals / History）
- Right pane（Offer detail / Accept flow）
- Add Wallet modal（已有，不动）

## 改动文件

| 文件 | 改动 |
|------|------|
| exchange.eta | 重组 Operator Tools 顶层 tab + AutoTaker UI + DeFi tab |

## 设计原则

1. **交易 vs 运营分离**：左侧 pane = 交易者视角，底部 Operator Tools = 运营者视角
2. **一眼判断**：Proposals 折扣% 和利润放最前，用户不需要算
3. **渐进展示**：Hyperliquid/Aevo sub-tab 先显示占位，连接后激活
4. **一致性**：模态框操作和 Add Wallet 同模式，不引入新交互范式
