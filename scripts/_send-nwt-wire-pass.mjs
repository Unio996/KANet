const message = `[NWT] 🎉 wire fix v3 真测 PASS — buy 路径真融入 exchange 完整闭环

## commit 13aca342a (wire-fix-v3) 真测结果

\`\`\`
seed peer + DM "想买 5 KAS" → "BSC" → "YES"
broker LLM 真调 finalize_order tool → finalizeBuy → _enqueueAccept → broker-action-queue
真上链 accept_v1 (tx broker-queue OK)
broker-action-queue **真调 onBroadcastWritten** (我的 wire fix v3 strip retry suffix 真生效)
trade-protocol-filter JSON.parse 通过 → handleExchangeAccept → processAccept
exchange-machine.transition open → matched
routeToVerification → matched → verifying

✓ offer 9f8230a2 protocol_status='verifying'
✓ taker 真填 PEER
✓ matched_at + verifying_started_at 真写
\`\`\`

## 真根因 5 笔 rescue 完整 trace (历史)

5 次都同模式:
1. broker accept_v1 真上链 ✓
2. broker-action-queue 不通知 trade-filter (chat.js:217 路径独占 onBroadcastWritten 入口) ✗
3. trade-filter 永不知道 broker 发了协议消息 → exchange-machine 永不 transition ✗
4. offer 留 'open' taker=null
5. bsc-watcher 真检测 USDT → 想推 paid → exchange-machine 拒 (offer not matched/verifying) → KAS 永不 deliver
6. Owner 等钱 → manual rescue

## 真根治 (3 commit chain)
- 36087428d v1: 加 onBroadcastWritten 调用 (但 condition 错 result.ok 永 undefined)
- 654803c71 v2: condition 改 result.txId (但 retry suffix 破 JSON 还没修)
- **13aca342a v3: strip retry [r2] suffix → JSON 干净 → trade-filter 真 dispatch ✓**

## ack J1 4992cebc54 grep 同步
J1 14:54 ack 我方向对: broker-action-queue 同进程同步调 onBroadcastWritten 不依赖 Scout 异步, 真覆盖 ingest 漏掉的 case.

## ack J2 #3 32fa2a7566 接位 + Owner "卖单方向同问题"
J2 #3 真追 NWT wire fix 只覆盖 \`accept_v1\`/\`paid_v1\` 2 个 case, **可能漏卖单路径** (cancel_v1 / delivered_v1 / etc.). 我先验买, 卖路径让 J2 #3 grep + 类似修.

## ⚠ 还差 Owner 真 Kasia 真测验证

我 probe 用 fake seed peer + LLM 真路径. 但**最严标准 (Owner 4 钦定第 4 条)** = Owner 真 Kasia 真测才算 ship 完成.

求 Owner 真 Kasia 重跑 (类似 14:13 但小额 测验):
- "Kas 现在多少钱"
- "我买 1 KAS, BSC, 地址 0x..."
- "YES"
- 真转 0.034 USDT BSC
- broker **真自动发 1 KAS** (不再 manual rescue)
- 全程 ~30s, 不 silent

通过 → 5 笔 rescue 模式真根治 ✓ + buy 路径 v1.0 真 production-ready
不通过 → 立即 RCA 不二次 ship

## J2 #3 卖单方向并行追

J2 grep cancel_v1/delivered_v1/timeout_v1/dispute_v1 等是否同模式漏 onBroadcastWritten 通知. 修法 same pattern (broker-action-queue 任何 send_broadcast 真发后必通知 trade filter).

NWT @ 13aca342a wire-fix v3 真生效, 等 Owner 真测 + J2 #3 卖单`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
