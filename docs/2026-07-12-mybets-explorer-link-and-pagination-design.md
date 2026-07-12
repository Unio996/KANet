> **Status**: CURRENT

# /mybets 最小接通设计 — explorer 链接 + 分页保护

**作者**: KANet-UI（2026-07-12，Owner 主线令①差距评估 → Bettor #he... GO）
**背景**: Owner 补令"系统基础功能都是有的，不要重复造轮子，重在梳理和接通"。差距评估（已报频道）发现 `/mybets` 三项覆盖里唯一真空 = 赔付凭证不可点验——后端 `my-positions` 早已返回 `claim_txid`/`settle_txid`/`refund_txid`（`pool.js:3322-3324`），前端 `formatMyBets()`（`prediction-menu.mjs`）从未显示。同时发现无分页保护（对比 `/earnings` 有）。本设计 = 把这两点接通，**零新造**：复用 `/earnings` 已验证可用的 explorer 链接公式 + 分页公式，不发明新机制。

**v1.1 更正（NWT 红队 14aa4e68 抓出两个 MUST-FIX，v1.0 判定 RED，已折入）**：
- **H1**：`pool_bettor_sides.claim_txid` 全库只有 2 处写入点，全是**退款专属**（`bettor-refund-claim-auto.mjs` 自动退款 + `pool.js:4023` 手动取消退款端点）——bshard v0.7 **赢家 claim 从未写这一列**。v1.0 把 `claim_txid` 排优先级第一当"赢家 claim tx"用，对活着的 v0.7 市场会给用户一个打不开自己赢钱记录的链接，比不挂还糟。真正的权威源是 `settle_evidence.winner_details[].txId`（`pool.js:3241` 已经 match 出 `myWin`，`myWin.amount` 已经用来算 `actualPayoutKas`，但 `myWin.txId` 从未放进 API response）——修法：**后端加一个字段暴露它**（小改动，非重造），见 §0.1。
- **H2**：同市场同 direction 多笔赢单场景，链上是多笔独立 claim tx、多个不同金额，但显示层把它们聚合成一个总额。若仍然只挂一个链接，用户点开看到的交易金额可能跟聚合显示的总额不一致——"可验证凭证指错交易"比"没有凭证"更糟。修法：**本轮 DoD 收窄，只在该市场该方向恰好 1 笔赢单时挂链接**，多笔场景不挂（NWT 措辞："禁止显示可能错的证据，比挂错安全"），根因（v0.7 多笔聚合缺口，对照 legacy v0.6 分支 `pool.js:3287-3296` 已处理这个场景）另立续卡，不在本轮范围内。

## §0.1 新增：后端小改动（v1.1 新增，回应 H1）

`pool.js` 的 `my-positions` 端点内，`myWin` 已经在 `pool.js:3241` 被 match 出来。只需把它的 `txId` 字段一并放进 API response（紧邻 `actual_payout_kas` 那几行）：
```js
bshard_claim_txid: myWin?.txId || null,  // 权威源: settle_evidence.winner_details[].txId, 已链验 received===true
```
这是本设计唯一涉及后端的改动，纯新增只读字段，不改变任何既有字段语义，不影响其他调用方。

## §1 变更①：explorer 链接接通

**复用点**：`messages.mjs:203` 的公式，逐字复用（已在 `mainnet`/`testnet-12` 两网都跑过，`/earnings` 命令验证过可达）：
```js
const explorer = (CONFIG.network === 'mainnet') ? 'https://explorer.kaspa.org' : 'https://explorer-tn12.kaspa.org';
```
`CONFIG` 已经在 `prediction-menu.mjs:7` import 过，零新增依赖。

**接入位置**：`formatMyBets()` 里逐 direction 状态行之后（`prediction-menu.mjs` 约行 342 `lines.push('• ${dir} ...')` 之后）。

**txid 取值优先序（v1.1 更正，四级）**：
1. `bshard_claim_txid`（新增字段，§0.1——v0.7 赢家 claim 的权威源，已链验）
2. `claim_txid`（退款专属，legacy/取消退款场景）
3. `settle_txid`（v0.6 非 claim 路径）
4. `refund_txid`（退款）

**挂链接条件（v1.1 收窄，回应 H2）**：
- `onlyRefund` 分支：直接挂（`refund_txid` 单笔对单笔，无聚合歧义）。
- `onlyWon` 分支：**仅当 `a.count === 1`**（该市场该方向恰好 1 笔押注，`a` = `byDir` 里的聚合对象，`prediction-menu.mjs:293` 定义）才挂 `bshard_claim_txid`；`a.count > 1`（同方向多笔）不挂，避免金额-交易不匹配。
- `onlyLost` / `onlySettledPending` / `onlyWonPending`：不挂（lost 没有自己的 txid 是对方 claim；后两者 txid 还未产生或未链验）。

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

- 后端只加**一个只读字段**（`bshard_claim_txid`，暴露已算出的 `myWin.txId`）——不新增查询/不改变既有字段语义/不影响其他调用方，仍在"接通"精神内（NWT/Bettor 认定"小改动非重造"）。
- 不新造 explorer 服务/域名——复用 `explorer-tn12.kaspa.org`/`explorer.kaspa.org`，`/earnings` 已验证外部可达。
- 不做"查看全部"网页跳转——不存在对应网页，诚实截断+提示，不编造功能。
- 不改 `/earnings` 本身——只是复用其公式，`messages.mjs` 零改动。
- 不改动状态判定逻辑（won/lost/refunded 五态）——那部分已覆盖良好，本次只加链接展示层。
- **本轮不解决同市场同方向多笔赢单的金额-交易消歧**（H2 根因）——只做到"多笔场景不挂错的链接"，根治留续卡（J2 域，跟 register 乐观写病根卡同批，Bettor #heqew5.2 已确认）。

## §6 落码前置

1. v1.1（本次修订）送 NWT 重审（H1/H2 两处修法是否堵严：`bshard_claim_txid` 字段值来源准确性/`a.count===1` 判据边界/四级优先序完整性）。
2. **用户面文案改动 = 铁律 0，§3/§4 的用户文案样例需 Owner 批复**——与红队重审并行进行（Bettor #heqew5.2 确认两闸不互等），Owner 侧会额外注明"本轮多笔同向赢单不显链接"的 scope 说明。
3. 落码后跑 tg-bot 现有测试 + 手工验证至少一笔真实 won（单笔场景）/refunded 单，确认链接可点开且指向正确 tx；额外验证一笔"同方向多笔赢单"场景确认不挂链接（负例）。
