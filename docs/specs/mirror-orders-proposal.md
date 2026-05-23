# Mirror Orders — NWT Proposal

> Agent CEX 交易自动在 Exchange 挂镜像单，免费注入流动性。

## 目标

Agent 在 CEX 买卖 KAS 时，自动在 Exchange 挂一个价格更优的镜像单。用 CEX 交易活动免费给 Exchange 注入流动性，零额外成本零额外风险。

## 触发点

`exchange-orders.js` placeOrder 成功后（CEX 单已下），调 `_publishMirrorOffer`。

## 函数设计

```javascript
_publishMirrorOffer(cexOrder, agent):
  1. 计算镜像价格: CEX 价格 × (1 - mirror_offset_pct), 默认 0.1%
  2. 金额: 和 CEX 单相同
  3. 过期时间: 5min（短周期，跟随 CEX 订单生命周期）
  4. verification: cross_chain_tx
  5. 调 POST /api/exchange/publish 发布
  6. 记录 mirror_cex_order_id 到 verification_meta（关联 CEX 单）
```

## CEX 成交后处理

getOrder 返回 filled 时，cancel 对应的 Exchange 镜像单。
位置: `action-executor.mjs _monitorSellMaker` 的轮询逻辑（已有 30s 轮询）。

## 风控

- **fund_lock**: 镜像 SELL 单锁 KAS，CEX 单不锁（CEX 有自己余额管理）
- 不能同时锁超过 `total_exposure_limit`
- 镜像单过期自动释放 fund_lock
- **config_entries**: `mirror_enabled` (bool) + `mirror_offset_pct` (float, 默认 0.1%)

## 第一版范围

- 只做 SELL 方向镜像（给 KAS 要 USDT），锁 KAS
- BUY 方向镜像需要锁 USDT，复杂度高，后续版本
- 不做自动调价（过期就过期，下次 CEX 交易挂新的）

## 失败处理

镜像单 publish 失败 = 静默失败 + console.log。
CEX 单不受影响。镜像是 best-effort 流动性增强，不是核心交易路径。

## maker 地址

触发 placeOrder 的那个 Agent，和 CEX 单同一个 Agent。

## 改动文件

| 文件 | 改动 |
|------|------|
| exchange-orders.js | placeOrder 成功后调 _publishMirrorOffer |
| exchange-orders.js | getOrder filled 时调 cancelMirrorOffer |
| exchange.js | publish 端点不变（复用） |
| config_entries | mirror_enabled + mirror_offset_pct |

## 审查状态

- J2 审查: 通过 ✅ (4 个问题已回应)
- Martin 审查: 通过 ✅
- 排在 autoTaker 之后实现
