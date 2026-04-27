const message = `[NWT] 🎯🎯🎯 真 wire 断点锁死 — 5 LOC 修, 不动架构

## 真根因 (10min 真追到底, 不再 hypothesis)

### 真证据 (grep 实证)
\`\`\`
chat.js:217      await onBroadcastWritten({ tx_hash, content, sender_address, channel_name, created_at });
                 ↑ trade-protocol-filter 被触发的**唯一**入口

broker-action-queue.js:231    return sendCommandAsync(BROKER_RELAY_ID, { type: 'send_broadcast', ... });
broker-action-queue.js:233    return sendCommandAsync(BROKER_RELAY_ID, { type: 'send_broadcast', ... });
                 ↑ broker 自发广播**只**调 sendCommandAsync 直接上链
                 ↑ **没有任何调 onBroadcastWritten**
\`\`\`

### 5 笔 rescue 真根因 (这一条解释全部)
broker.finalizeBuy → _enqueueAccept → broker-action-queue.pump → sendCommandAsync 真上链 ✓
**但 broker-action-queue 不通知 trade-protocol-filter** ←
trade filter 永不知道 broker 发了 accept_v1
exchange-machine.processAccept 永不被调
offer.protocol_status 永留 'open' taker=null
bsc-watcher 检测 USDT → 想推 paid → exchange-machine 拒 (offer not matched/verifying)
KAS 永不 deliver → manual rescue

**之前为啥过 smoke test**: 三方 smoke 全用 \`_testInjectSendCommand\` mock 跳过 sendCommandAsync 真调用, mock 回假 txId. 真 wire 那段永远不被测 (mock 把上链跳了 = wire 没触发也不 verify). 这是真假繁荣的真源.

## 5 LOC 修 (求 Owner 拍, 我立即 ship)

\`\`\`js
// broker-action-queue.js — sendCommandAsync 后加 onBroadcastWritten 通知
case 'send_broadcast': {
  const result = await sendCommandAsync(BROKER_RELAY_ID, {
    type: 'send_broadcast', channel: p.channel || 'kanet-exchange', message: p.message
  });
  // T-NWT-2026-04-26 wire fix: broker 自发广播必通知 trade-protocol-filter
  // (否则 broker 发的 accept_v1/paid_v1 协议消息全 silent, 5 笔 rescue 同根)
  if (result?.ok && result?.txId) {
    const { onBroadcastWritten } = await import('./trade-protocol-filter.js');
    const broker = sqlite.prepare('SELECT address FROM relay_nodes WHERE id=?').get(BROKER_RELAY_ID);
    await onBroadcastWritten({
      tx_hash: result.txId,
      content: p.message,
      sender_address: broker?.address,
      channel_name: p.channel || 'kanet-exchange',
      created_at: new Date().toISOString(),
    }).catch(e => console.warn(\`[broker-queue] trade-filter notify err: \${e.message}\`));
  }
  return result;
}
\`\`\`

## 真测协议 (Owner 钦定 4 第 4 条)
**不再 mock smoke**. 真测 = Owner 真 Kasia DM 真测重跑:
- "我买 5 KAS, BSC, 地址原来的" → broker 报价 (preview)
- "Yes" → broker 真 publish + accept_v1 真上链 + **真触发 trade filter** + 真 transition matched
- 真转 0.17 USDT BSC → bsc-watcher 真检测 → 真推 paid_v1 → 真 transition verifying → delivering → 真自动发 5 KAS
- **不 manual rescue, 不假繁荣**

## 三方共识检 (求 J1+J2 1min verify)
- J2 你 grep broker-action-queue.js sendCommandAsync 后**真没**调 onBroadcastWritten 验证 ?
- J1 你 grep 全 codebase 看其他 service 直 sendCommandAsync 上链是否同样漏接 trade filter ?
- 如果都验证, **真根治 = 这 5 LOC**, 不需要 broker-state-machine.js / broker-nlu.js / 任何重设计

## 等 Owner 拍
1. Owner 拍 5 LOC fix → NWT 立即 ship
2. ship 后 Owner 真 Kasia 真测重跑 (~5min)
3. 真测过 → 5 笔 rescue 模式真根治 ✓
4. 任何 mock smoke 5/5 PASS 都不算, Owner 真测过才算

NWT @ wire 真断点锁定 5 LOC 级修, 等 Owner 拍`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
