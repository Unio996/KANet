> **Status**: CURRENT

# /mybets 最小接通设计 — explorer 链接 + 分页保护

**作者**: KANet-UI（2026-07-12，Owner 主线令①差距评估 → Bettor #he... GO）
**背景**: Owner 补令"系统基础功能都是有的，不要重复造轮子，重在梳理和接通"。差距评估（已报频道）发现 `/mybets` 三项覆盖里唯一真空 = 赔付凭证不可点验——后端 `my-positions` 早已返回 `claim_txid`/`settle_txid`/`refund_txid`（`pool.js:3322-3324`），前端 `formatMyBets()`（`prediction-menu.mjs`）从未显示。同时发现无分页保护（对比 `/earnings` 有）。本设计 = 把这两点接通，**零新造**：复用 `/earnings` 已验证可用的 explorer 链接公式 + 分页公式，不发明新机制。

## §1 变更①：explorer 链接接通

**复用点**：`messages.mjs:203` 的公式，逐字复用（已在 `mainnet`/`testnet-12` 两网都跑过，`/earnings` 命令验证过可达）：
```js
const explorer = (CONFIG.network === 'mainnet') ? 'https://explorer.kaspa.org' : 'https://explorer-tn12.kaspa.org';
```
`CONFIG` 已经在 `prediction-menu.mjs:7` import 过，零新增依赖。

**接入位置**：`formatMyBets()` 里逐 direction 状态行之后（`prediction-menu.mjs` 约行 342 `lines.push('• ${dir} ...')` 之后），当该 direction 的所有笔存在统一的 payout txid 时追加一行链接。txid 取值优先序（跟后端字段对齐，同一 direction 内部笔多的话取第一笔非空即可，同市场同 direction 通常是同一笔 settle/claim tx）：
1. `claim_txid`（bshard v0.7 赢家 claim）
2. `settle_txid`（v0.6 或非 claim 路径）
3. `refund_txid`（退款）

只在 `onlyWon` / `onlyLost`（其实 lost 没有自己的 txid，是对方 claim，不挂链接）/ `onlyRefund` / `onlySettledPending`（这个还没 txid，不挂）分支里，`onlyWon` 和 `onlyRefund` 两种状态挂链接。

## §2 变更②：分页保护

**复用点**：`messages.mjs:227/233` 的公式，逐字复用：
```js
for (const m of by.slice(0, 10)) { ... }
if (by.length > 10) lines.push(t(lang, 'earnings_more', { n: by.length - 10 }));
```
`/mybets` 按市场分组（`byMarket` Map），无 web UI 落点可跳转（核实过：不存在类似 `broker-home` 的 bettor-positions 网页），所以"还有 N 单"不带跳转链接，只提示优先看最近的。**Cap 值定 15**（比 `/earnings` 的 10 略宽——押注消息比收益消息短，Telegram 4096 字符预算更松），按 `byMarket` 的 Map 插入序（= `created_at DESC`，已经是"最近优先"）取前 15 个 market。

## §3 Before/After 示例（用户实际看到的文案）

**Before**（当前，赢单无凭证）：
```
📍 France vs Morocco: France wins?
• YES 5.0000 KAS · 🎉 Won +5.2500 KAS
  Pool: 55% YES / 45% NO
  Placed: 07-08 14:30
```

**After**（赢单挂可点验链接）：
```
📍 France vs Morocco: France wins?
• YES 5.0000 KAS · 🎉 Won +5.2500 KAS
  https://explorer-tn12.kaspa.org/txs/a1b2c3d4e5f6...
  Pool: 55% YES / 45% NO
  Placed: 07-08 14:30
```

**分页提示**（当 > 15 个市场时，附加在 detail 汇总行之后、逐盘列表之前）：
```
📊 12 bets across 20 markets
Total staked: 145.2000 KAS
...
··· 5 more markets not shown (most recent 15 shown first)
```

## §4 新增 i18n key（EN + ZH，插入 `i18n.mjs`，紧邻既有 `mybets_*` key 群）

```js
// EN
mybets_explorer_link: '  {url}',
mybets_more: '··· {n} more markets not shown (most recent {shown} shown first)',
// ZH
mybets_explorer_link: '  {url}',
mybets_more: '··· 还有 {n} 单未显示 (优先显示最近 {shown} 单)',
```

## §5 明确不做什么（划边界，防 scope creep）

- 不新增后端字段——`claim_txid`/`settle_txid`/`refund_txid` 已存在，只是接线。
- 不新造 explorer 服务/域名——复用 `explorer-tn12.kaspa.org`/`explorer.kaspa.org`，`/earnings` 已验证外部可达。
- 不做"查看全部"网页跳转——不存在对应网页，诚实截断+提示，不编造功能。
- 不改 `/earnings` 本身——只是复用其公式，`messages.mjs` 零改动。
- 不改动状态判定逻辑（won/lost/refunded 五态）——那部分已覆盖良好，本次只加链接展示层。

## §6 落码前置

1. 本设计 NWT 红队（重点：txid 取值优先序有无遗漏分支/分页 cap 值是否合理/多笔同 direction 场景 txid 取值是否可能取到错误的那笔）。
2. **用户面文案改动 = 铁律 0，本设计 §3/§4 的实际用户文案样例需 Owner 批复后才能落码**（即使红队 GREEN，文案仍要过 Owner 这一关）。
3. 落码后跑 tg-bot 现有测试 + 手工验证至少一笔真实 won/refunded 单，确认链接可点开且指向正确 tx。
