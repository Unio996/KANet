> **Status**: CURRENT

# /mybets 最小接通设计 — 赔付凭证(txid) + 分页保护 + /earnings 死链修复

**作者**: KANet-UI（2026-07-12，Owner 主线令①差距评估 → Bettor #he... GO）
**背景**: Owner 补令"系统基础功能都是有的，不要重复造轮子，重在梳理和接通"。差距评估（已报频道）发现 `/mybets` 三项覆盖里唯一真空 = 赔付凭证不可验——后端 `my-positions` 早已返回 `claim_txid`/`settle_txid`/`refund_txid`（`pool.js:3322-3324`），前端 `formatMyBets()`（`prediction-menu.mjs`）从未显示。同时发现无分页保护（对比 `/earnings` 有）。

**v1.1 更正（NWT 红队 14aa4e68 抓出两个 MUST-FIX，已折入）**：
- **H1**：`pool_bettor_sides.claim_txid` 全库只有 2 处写入点，全是**退款专属**（`bettor-refund-claim-auto.mjs` 自动退款 + `pool.js:4023` 手动取消退款端点）——bshard v0.7 **赢家 claim 从未写这一列**。真正权威源是 `settle_evidence.winner_details[].txId`（`pool.js:3241` 已经 match 出 `myWin`，但从未暴露进 API response）。修法：后端新增只读字段 `bshard_claim_txid` 暴露它。
- **H2**：同市场同 direction 多笔赢单场景，链上是多笔独立 claim tx、多个不同金额，聚合显示后单一凭证可能指向跟聚合金额不符的交易——比没凭证更糟。修法：本轮 DoD 收窄，只在该市场该方向恰好 1 笔赢单时显示凭证。

**v1.2 更正（Owner 实测发现 DNS 不存在，Bettor 坐实，本文作者认账未验证的引用错误——重大方向调整）**：
- 原方案"复用 `/earnings` 的 explorer 链接"整个前提**不成立**：`explorer-tn12.kaspa.org` **DNS 不存在**（`nslookup` 实测 `ENOTFOUND`，对照 `kaspa.org` 解析正常）。TN12 是 KANet 自建私有测试网，**没有任何人架设过公网 explorer**——`/earnings` 命令自 6/22 起给用户发的就是一条死链，本设计沿用了同一个从未被验证过的引用（"读代码看到有人在用" ≠ "验证过外部服务真实存在"）。
- **修法**：赔付凭证从"可点击 explorer 链接"降级为**txid 纯文本行**（Telegram monospace，用户可复制留存；不是"点开即验"，是"拿到可对照的原始凭证"）。`/earnings` 同一处死链**并入本设计一并修**（Bettor 裁定：同一处文案形态，一次审一次落码，不拆两轮）。
- **纪律记账**：外部 URL/域名类引用，审查（作者本人 + NWT 两轮红队 + Bettor 方向审，三道关全部漏掉）必须独立 `curl`/`nslookup` 实测，不能当既定事实吃——尤其"自建/私有/testnet"环境下默认怀疑公网服务的存在性。NWT checklist 已补此项。

## §0.1 后端小改动（H1 落位）

`pool.js` 的 `my-positions` 端点内，`myWin` 已经在 `pool.js:3241` 被 match 出来。只需把它的 `txId` 字段一并放进 API response（紧邻 `actual_payout_kas` 那几行）：
```js
bshard_claim_txid: myWin?.txId || null,  // 权威源: settle_evidence.winner_details[].txId, 已链验 received===true
```
唯一涉及后端的改动，纯新增只读字段，不改变任何既有字段语义。

## §1 变更①：赔付凭证 —— txid 纯文本（v1.2，非链接）

**接入位置**：`formatMyBets()` 里逐 direction 状态行之后（`prediction-menu.mjs` 约行 342 `lines.push('• ${dir} ...')` 之后）。

**txid 取值优先序（四级）**：
1. `bshard_claim_txid`（§0.1 新增字段——v0.7 赢家 claim 的权威源，已链验）
2. `claim_txid`（退款专属，legacy/取消退款场景）
3. `settle_txid`（v0.6 非 claim 路径）
4. `refund_txid`（退款）

**显示条件（H2 收窄）**：
- `onlyRefund` 分支：直接显示（`refund_txid` 单笔对单笔，无聚合歧义）。
- `onlyWon` 分支：**仅当 `a.count === 1`**（该市场该方向恰好 1 笔押注）才显示 `bshard_claim_txid`；`a.count > 1` 不显示，避免金额-交易不匹配。
- `onlyLost` / `onlySettledPending` / `onlyWonPending`：不显示。

**格式**（v1.2 无 URL，纯文本 monospace 便于复制）：
```
• YES 5.0000 KAS · 🎉 Won +5.2500 KAS
  TX: a1b2c3d4e5f6...
```

## §2 变更②：分页保护

**复用点**：`messages.mjs:227/233` 的公式，逐字复用：
```js
for (const m of by.slice(0, 10)) { ... }
if (by.length > 10) lines.push(t(lang, 'earnings_more', { n: by.length - 10 }));
```
`/mybets` 按市场分组（`byMarket` Map），无 web UI 落点可跳转（核实过：不存在类似 `broker-home` 的 bettor-positions 网页），"还有 N 单"不带跳转链接，只提示优先看最近的。**Cap 值定 15**，按 `byMarket` 的 Map 插入序（= `created_at DESC`）取前 15 个 market。

## §3 变更③：`/earnings` 死链修复（v1.2 并入，Bettor 裁定同批）

`messages.mjs:203` 的 `explorer` 变量 + `:230` 的链接拼接删除，改成同款 txid 纯文本：
```js
// 删除: const explorer = (...) ? '...' : '...';
// 删除: if (m.settle_txid) line += `  ${explorer}/txs/${m.settle_txid}`;
// 改为:
if (m.settle_txid) line += `  TX: ${m.settle_txid}`;
```
影响面：`brokerEarnings()` 单函数，逐行明确的改动，不影响其它字段/其它命令。

## §4 新增 i18n key（EN + ZH，插入 `i18n.mjs`，紧邻既有 `mybets_*` key 群）

```js
// EN
mybets_tx_line: '  TX: {txid}',
mybets_more: '··· {n} more markets not shown (most recent {shown} shown first)',
// ZH
mybets_tx_line: '  TX: {txid}',
mybets_more: '··· 还有 {n} 单未显示 (优先显示最近 {shown} 单)',
```

## §5 Before/After 示例（用户实际看到的文案，v1.2 txid 文本版）

**Before**（当前，赢单无凭证）：
```
📍 France vs Morocco: France wins?
• YES 5.0000 KAS · 🎉 Won +5.2500 KAS
  Pool: 55% YES / 45% NO
  Placed: 07-08 14:30
```

**After**（赢单挂 txid 凭证，纯文本可复制）：
```
📍 France vs Morocco: France wins?
• YES 5.0000 KAS · 🎉 Won +5.2500 KAS
  TX: a1b2c3d4e5f6...
  Pool: 55% YES / 45% NO
  Placed: 07-08 14:30
```

**分页提示**（当 > 15 个市场时）：
```
📊 12 bets across 20 markets
Total staked: 145.2000 KAS
...
··· 5 more markets not shown (most recent 15 shown first)
```

## §6 明确不做什么（划边界，防 scope creep）

- 后端只加一个只读字段（`bshard_claim_txid`）——不新增查询/不改变既有字段语义。
- **不声称任何外部可验证性**——txid 是本地/相关方可核对的原始凭证，不是"点开即验"的公网服务（因为压根没有这个服务）。
- 不做"查看全部"网页跳转——不存在对应网页。
- 不改动状态判定逻辑（won/lost/refunded 五态）——已覆盖良好，本次只加凭证展示层。
- 本轮不解决同市场同方向多笔赢单的金额-交易消歧（H2 根因）——续卡，J2 域，跟 register 乐观写病根卡同批。
- `/earnings` 死链修复（§3）范围限定在删除 URL 拼接改纯文本，不改该函数其它逻辑。

## §7 落码前置

1. v1.2（本次修订）送 NWT 复审——重点：txid 四级优先序未被改坏 + `/earnings` 改动零波及其它字段（NWT checklist 已加 URL 可达性实测项，本轮无 URL 无需再测）。
2. **用户面文案改动 = 铁律 0**，§5 的 txid 文本版样例需 Owner 批复（与红队复审并行，Bettor 已确认两闸不互等）。
3. 落码后跑 tg-bot 现有测试 + 手工验证至少一笔真实 won（单笔场景）/refunded 单，确认 txid 文本正确显示；验证 `/earnings` 输出不再含任何 URL。
