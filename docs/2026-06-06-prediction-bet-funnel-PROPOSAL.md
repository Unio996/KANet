# 押注 funnel 重设·9 链资金入口接入预测市场·方案 (= 待 Bettor 关 1 审 + Owner 终裁)

> Owner 2026-06-06 18:42 钦定: "九条链现在都在了. 你先把这句话读懂. 不要乱漂移."
> KANet-UI doc-owner 出方案. **不 ship 不动码** 等讨论 + Owner 终裁.

## 0. 议题

KANet 现 /exchange 已 ship 9 链多资产 → KAS 双向兑换 (= BSC/ETH/SOL/TRON USDT auto-pay 等). 预测市场 /predictions/pool/* 现要求 maker 必有 KAS. **两端独立**, 用户必须**自己跳页 + 自己计算**:

1. 想押注 → 发现没 KAS → 回 /exchange → 选链 → 兑 → 等链上确认 → 回押注页 → 提交
2. 押注赢 → 拿 KAS → 想换回 USDT → 跑回 /exchange → 反向

= **funnel 没串**. 用户视角是两个 product 不是一条流程.

## 1. 用户旅程理想态

```
[Step 1 用户带任意资产]      [Step 2 KANet 自动桥]         [Step 3 押注]
USDT (BSC/ETH/SOL/TRON)  →  exchange auto-route       → 锁 KAS 押 PoolSide
BNB / ETH / SOL / TRX    →  系统算 "1000 KAS 需 X"     → 提交链上 TX
KAS (原生)               →  跳过 exchange 直接押       → 看仲裁

[Step 4 赢家自动反向]
PoolSide claim KAS  →  系统问 "兑回 USDT 哪条链?"  →  自动 exchange 反向 → 用户外部地址收 USDT
```

= 一条线性 flow. 用户**只做意图决定** (押什么 + 押多少 + 押哪边), 资产路由 KANet 帮.

## 2. 现状能力盘点 (= 9 链已 ready 实证)

| 能力 | ship 状态 | 文件 |
|---|---|---|
| OTC 多链 publish/accept (BNB/ETH USDT) | ✓ ship | `src/api/exchange.js` |
| EVM auto-pay (BNB/ETH USDT) | ✓ ship | `src/services/evm-transfer.js` + `exchange-machine.js` |
| SOL auto-pay USDT | ✓ ship | `services/sol-transfer.mjs` |
| TRON auto-pay USDT | ✓ ship | `services/tron-transfer.mjs` |
| Market Seeder 双向做市 (USDT→KAS + KAS→USDT) | ✓ ship | `services/market-seeder.js` |
| Fund-lock 跨 exchange + pool 协调 | ✓ ship | `services/fund-lock.js` (= exchange offers + pool maker stake 共池预留) |
| Pool market 创建 (KAS 押) | ✓ ship | `src/api/pool.js` create-v0.5/v0.6/v0.7 |
| Pool 押注 register | ✓ ship | `src/api/pool.js` register-v06/prep+confirm |
| 余额跨链查询 | ⚠ 部分 | `src/api/relay.js` `/wallets` (= 显单 relay 多链余额) |
| **押注 funnel UI** | **❌ 缺** | 待本方案 |
| **赢家反向兑换 prompt** | **❌ 缺** | 待本方案 |

= 9 链兑换 + 预测市场各自能用, **缺粘合层 + UI funnel**.

## 3. 设计方案

### 3.1 押注入口 funnel UI (= 件 1)

**触发点**: bot `/bet` flow stage amount + web `/predictions/pool/:id` 押注按钮.

**逻辑**:
```
用户输入 "押 100 KAS"
  ↓
KANet 查 user wallet KAS balance (relay /wallets endpoint)
  ↓
case A: 余额 ≥ 100 KAS
  → 直接走现有 register-v06 flow
case B: 余额 < 100 KAS, 但 USDT/BNB/ETH/SOL/TRX 够换
  → 弹 modal "你有 X USDT 在 BSC. 兑 100 KAS 需 Y USDT (= 当前 OTC 报价).
     一键兑换 + 押注?"
  → 用户点 "好":
    a. 后台 POST /api/exchange/accept (= 用 maker 报价 100 KAS, 用户给 USDT)
    b. 等链上付款检测 (= exchange-machine 现 flow, 几分钟)
    c. KAS 到账 user wallet
    d. 自动跳押注 confirm (= 余额≥100 后真走 register-v06)
case C: 多链多资产可用
  → 弹 modal 列资产选择
case D: 完全没钱
  → 弹"先去 faucet 领测试币" (= testnet only) / "先充值" (mainnet)
```

**实现量**:
- 新 `src/ui/bet-funnel-modal.eta` 模块组件 (= 模态对话框)
- web `predictions-pool-detail.eta` + bot `prediction-menu.mjs` 押注按钮触发
- 后端 0 新 endpoint (= 全复用)
- ~2-3 小时 code

### 3.2 赢家反向兑换 prompt (= 件 2)

**触发点**: 用户 settle 后 PoolSide claim 拿到 KAS, bot push + web /mybets 显示.

**逻辑**:
```
用户赢 100 KAS → claim_txid is_accepted
  ↓
push "🎉 你赢 100 KAS. 兑回 USDT?"
  ↓
case A: 用户点 "好"
  → 列他可达链 (= 之前 USDT 来自哪条链, 默认那条)
  → 报价 + 自动 POST /api/exchange/publish (= 用户卖 100 KAS 要 USDT)
  → maker 来撮合 (现 seeder 自动 fill)
  → 链上反向 KAS→USDT
  → 完成后 push "USDT 已发 0x...地址"
case B: 不点
  → KAS 留在 KAS 钱包, 用户可以再押
```

**实现量**:
- 新 `bet-cashout-modal.eta` + bot `/cashout` command
- 复用 existing /api/exchange/publish + market-seeder 反向做市
- ~1-2 小时 code

### 3.3 sidebar 调整 (= 件 3, 微调不重排)

不删兑换不藏. 调:
- "市场" 顶 → 改 "预测市场" (= reflect 主旅程)
- 子项: 看市场 / 发起预测 / 我的市场 (待加) / **兑换 (前置+后置)** (= 用户能直接点进 funnel 内嵌的 exchange 工具)

兑换保留 sidebar 子项 (= 用户主动想兑换时入口, 不只是 funnel 内嵌).

**实现量**: sidebar.eta + 加 /my-markets.eta + index.js 路由. ~30 min.

### 3.4 跨节点考虑 (= Owner r242 提的"市场跨节点")

- Market publish 已 chain-derived (= 7 cross-node ingest 实证)
- Bet funnel + cashout 不需要新跨节点机制 (= 用户操作走 user 自家节点的 wallet)
- 数据一致性: pool_markets 跨节点同源 (= path A envelope ingest 已 ship)

## 4. 实施 step (= 不动 backend, 全 UI + funnel 逻辑)

1. **件 1 押注 funnel modal** — 2-3 hr (= 主线, 直击 Owner 业务流)
2. **件 2 赢家 cashout prompt** — 1-2 hr
3. **件 3 sidebar 微调 + /my-markets** — 30 min

总 ~5-6 hr. 全后端 0 改动 (= 复用现有 exchange + pool endpoint).

**先后顺序**: 件 1 > 件 2 > 件 3. 件 1 ship 后 user 流程已通, 件 2/3 是上下游优化.

## 5. 风险

- 跨链兑换链上确认时间 (= BSC/ETH 数分钟). funnel modal 显进度条 + 告知"等付款入账", 用户可能 abandon.
- 报价滑点: 用户看到 "100 KAS = 50 USDT", 真兑时市场动了报价变. modal 显 "实际报价 ±5%" 告知.
- maker 缺货: 用户想买 KAS 但 OTC offer 池没合适 offer. funnel fallback "稍后再试" + 触发 market-seeder 补货.
- 跨链 fund-lock 冲突: 同 user 同时跑兑换 + 押注, fund-lock 表已存在但 funnel 触发两 lock 需 race-safe.

## 6. 未做的 (= 诚实边界)

- 现 OTC 只 USDT→KAS 自动. **原生资产 (BNB/ETH/SOL/TRX) → KAS 不直接** 走 — 需先 swap 成 USDT (= 用户视角多一步, 或者 funnel 内嵌 swap).
- mainnet 真用户付费保护 (= testnet 测试币零成本, mainnet 加滑点保护 + 资金 escrow)
- 自动反向兑换的 maker 池流动性 (= 现 seeder 单笔双向, 大额需扩 seeder 策略)

## 7. 待 Bettor 关 1 审 + Owner 终裁

**Bettor 关 1 角度**:
- (i) 方向: 押注 funnel 接 9 链 = 业务流补漏, 是去 bug 还是新功能?
- (ii) 复用: 全复用 exchange + pool 现 endpoint, 不动 backend 不动 SS. 风险低?
- (iii) 跨域影响: funnel modal 嵌入 exchange-machine flow, 与 D7 主线 settle 路冲突吗?
- (iv) 测试: 跨链 funnel e2e 怎么 regression?

**Owner 终裁**:
1. 方向是不是?
2. 件 1 / 2 / 3 哪个先? 全做 OR 分批?
3. 排期: D7 闭后做 / 现在并行做?
4. 跟 sidebar 简化 (= r568 议题) 冲突吗?

我 STANDBY 等 Bettor 关 1 ③ + Owner 拍.
