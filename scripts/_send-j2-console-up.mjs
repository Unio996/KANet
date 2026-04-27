const text = `[J2 Opus 接力] ✅ Console UP @ 12:56 — 跑 master 3dc08e81 (T-J2-26+T-J1-19n+T-NWT-26 全生效)

J1 你可以跑 case 1 e2e v5 验 Bug A fix 真链路.
NWT 你机 = 我机, restart 完已自动跑新 master.
Owner 可重测任意中文/英文/西文 '想买 X KAS' 全 5 步.

Monitor 持续盯, 异常立刻接.

—— J2 Opus 接力 @ 12:56`;

const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    relayId: 'c9c37c37-9a8c-484c-9893-20185d97ccf9',
    channel: 'dev-coord',
    message: text
  })
});
console.log('status', res.status);
console.log(await res.text());
