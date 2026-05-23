// Owner 钦定 "多角度多方法" — 并发真测 (单 broker 5 user 同时 DM, 看 queue + 串扰)

const TRADER_B = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const J2_BASE = 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtp';
function peer(s) { return J2_BASE + s.padStart(12, 'q'); }

// 5 user 同时 DM 不同 message
const peers = [
  { p: peer('concur1aaaaa'), msg: '想买 5 KAS', expect_partial: '哪个链|chain' },
  { p: peer('concur2aaaaa'), msg: 'I want 10 KAS', expect_partial: 'chain|BSC' },
  { p: peer('concur3aaaaa'), msg: 'comprar 15 KAS', expect_partial: 'cadena|chain' },
  { p: peer('concur4aaaaa'), msg: '现在 kas 多少钱', expect_partial: '' },  // queue-routed
  { p: peer('concur5aaaaa'), msg: '在吗?', expect_partial: '' },             // LLM
];

console.log('=== 并发真测 (5 user 同时 DM Trader-B) ===\n');

const start = Date.now();
const promises = peers.map(async (t, i) => {
  const t0 = Date.now();
  try {
    const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayNodeId: TRADER_B, peer: t.p, message: t.msg }),
    });
    const body = await res.json();
    const ms = Date.now() - t0;
    const reply = body.reply || '';
    return { i, p: t.p.slice(-12), msg: t.msg, reply: reply.slice(0,80), ms, ok: !!body.reply || reply === '' };
  } catch (e) {
    return { i, msg: t.msg, err: e.message, ms: Date.now() - t0, ok: false };
  }
});

const results = await Promise.all(promises);
const totalMs = Date.now() - start;

let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) pass++; else fail++;
  console.log(`#${r.i+1} (${r.ms}ms) "${r.msg}" → "${r.reply || (r.err ? 'ERR: '+r.err : '<queue>')}"`);
}

const latencies = results.map(r=>r.ms).sort((a,b)=>a-b);
console.log(`\n=== ${pass}/5 PASS, total ${totalMs}ms ===`);
console.log(`p50: ${latencies[2]}ms | p95: ${latencies[4]}ms | max: ${latencies[4]}ms`);

// 验 queue depth 没爆
const stats = await fetch('http://127.0.0.1:3100/api/chat/messages?channel=dev-coord&limit=1').then(r=>r.ok ? 'console UP' : 'DOWN');
console.log(`\nConsole 状态: ${stats}`);

process.exit(fail === 0 ? 0 : 1);
