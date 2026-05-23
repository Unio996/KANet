const message = `[NWT] ✅ wire fix SHIP commit 36087428d — Owner authorized "按你的思路执行" 立即 ship

## 1 file +26 -3 LOC, lint clean, pre-commit 通过

\`\`\`
kasia-console/src/services/broker-action-queue.js
case 'accept_v1':
case 'paid_v1': {
  const result = await sendCommandAsync(...);  // 原本就有
  // ↓ 新加 (15 LOC 真 wire 修):
  if (result?.ok && result?.txId) {
    const { onBroadcastWritten } = await import('./trade-protocol-filter.js');
    const broker = sqlite.prepare('SELECT address FROM relay_nodes WHERE id=?').get(BROKER_RELAY_ID);
    await onBroadcastWritten({
      tx_hash, content: p.message, sender_address: broker?.address,
      channel_name: p.channel || 'kanet-exchange',
      created_at: new Date().toISOString(),
    });
  }
  return result;
}
\`\`\`

## 还差 2 步真生效

### 1. 重启 console (broker-action-queue.js ES module 必须 reload)
等 Owner 钦定重启窗口. 重启 = 杀 30+ node 进程 + bash kanet-start.sh, 影响所有 relay/Mind/adapter ~30s 不可用.

### 2. Owner 真测重跑 (Owner 钦定 4 第 4 条)
重启完, Owner 真 Kasia 真测:
- "我买 X KAS, BSC, 地址 0x..."
- broker 真 publish + accept_v1 真上链 + **真触发 trade filter (修复后)**
- 真转 X * 0.034 USDT BSC
- broker **真自动发 X KAS** (不再 manual rescue)
- 不 silent, 不假繁荣

真测过 → 5 笔 rescue 模式真根治 ✓
不过 → 我立即继续追 (不再列方案, 真追)

## 防回归 lint (后续, 不 block 本次 ship)

J1+J2 后续可加 lint rule:
- 任何 sendCommandAsync({type:'send_broadcast', ...}) 调用必伴 onBroadcastWritten 通知
- 静态扫所有 broker / agent service 文件
- 命中漏报 → fail commit

## 三方共识 verify
- J1 e4f89a8815 grep 同步定位一致 wire 断点 ✓
- J2 fa874d3d25 spec 撤 (broker-state-machine.js 80 LOC 不需要, 真 fix 是 15 LOC) — 求 J2 ack
- NWT 11a9a2fa84 提案 → Owner 14:38 钦定 "按你的思路执行" → ship 完

NWT @ wire fix 真 ship, 等 Owner 拍重启窗口`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
