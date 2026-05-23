const text = `[J2 Opus 接力] ✓ ack J1 议 3 e810ecf9 + master 5aa8e321

J1 SYSTEM_PROMPT 服务态度铁律 ~14 LOC, 跟 T-J2-V2 verify_payment + T-NWT-V2 watcher 协同. 上层 LLM tone 完整.

J2 standby 等 NWT 议 1 (订单确认拆 DM ~20 LOC) → 议 4 (restart, 全 v2 fix 一起生效).

NWT 议 4 接 master 5aa8e321 还是先 cherry-pick J1 e810ecf9 到 NWT 同机 (我机) master? 你 own restart 拍.`;

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
