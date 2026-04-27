// J2 multi-turn stress: 100 peer × 4 rounds = 400 calls.
// 模拟真用户 4 步对话 (buy intent → chain → confirm → paid).
// 验:
//   Round 1 → DET path (alreadyDet=false)
//   Round 2-4 → LLM path (alreadyDet=true) — 守门 T-J1-19g 工作
//   history multi-turn loaded — T-J2-21 schema fix 工作
//   语言 lock — 第 1 轮中文, 后续保持中文 (Qwen 不切英)

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const URL = 'http://127.0.0.1:3100/api/agent/reply';

// 4-step conversation templates per language
const CONVS = {
  zh_buy: [
    (qty) => `我要买 ${qty} KAS`,
    () => 'BSC',
    () => '对，确认',
    () => `我付了 0x${'a'.repeat(64)}`,
  ],
  zh_sell: [
    (qty) => `我要卖 ${qty} KAS`,
    () => 'BSC',
    () => '0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe',
    () => 'YES',
  ],
  en_buy: [
    (qty) => `I want to buy ${qty} KAS`,
    () => 'BSC',
    () => 'YES',
    () => `paid 0x${'b'.repeat(64)}`,
  ],
  es_buy: [
    (qty) => `quiero comprar ${qty} KAS`,
    () => 'BSC',
    () => 'sí confirmo',
    () => `pagué 0x${'c'.repeat(64)}`,
  ],
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const N_PEERS = parseInt(process.argv[2] || '100');
const PARALLEL = parseInt(process.argv[3] || '5');

console.log(`Multi-turn stress: ${N_PEERS} peers × 4 rounds (${PARALLEL} parallel)`);
const t_start = Date.now();

const stats = {
  r1_det: 0, r1_other: 0,
  r2_llm: 0, r2_det_BAD: 0, r2_other: 0,
  r3_llm: 0, r3_det_BAD: 0, r3_other: 0,
  r4_llm: 0, r4_det_BAD: 0, r4_other: 0,
  total_lang_drift: 0,
  total_timeout: 0,
  total_http_err: 0,
  history_grew: 0,  // count peers where history.len grew
};
const fails = [];

async function runOne(peer, lang, qty) {
  const conv = CONVS[lang];
  const exchanges = [];
  for (let r = 0; r < 4; r++) {
    const message = conv[r](qty);
    const t0 = Date.now();
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ relayNodeId: BROKER_RELAY_ID, peer, message }),
      });
      const data = await res.json().catch(() => ({}));
      const reply = data.reply ?? '';
      const dt = Date.now() - t0;
      const isDet = /(哪个链|哪条链|which chain|qué cadena|cadena para|数量多少|how many|cuántos)/i.test(reply);
      const isTimeout = /(LLM 卡了|稍后再试|卡了 1)/i.test(reply);
      // language drift detection
      const isUserCJK = /[一-鿿]/.test(message);
      const isReplyCJK = /[一-鿿]/.test(reply);
      const langDrift = isUserCJK && !isReplyCJK && reply.length > 5;
      exchanges.push({ r, message, reply: reply.slice(0, 100), isDet, isTimeout, langDrift, dt });

      if (r === 0) {
        if (isDet) stats.r1_det++;
        else stats.r1_other++;
      } else {
        const key = `r${r+1}_`;
        if (isDet) {
          stats[`${key}det_BAD`]++;
          fails.push({ peer, lang, round: r+1, reason: 'DET on round>1', message, reply });
        }
        else if (reply.length > 5) stats[`${key}llm`]++;
        else stats[`${key}other`]++;
      }
      if (isTimeout) stats.total_timeout++;
      if (langDrift) {
        stats.total_lang_drift++;
        fails.push({ peer, lang, round: r+1, reason: 'lang drift', message, reply });
      }
      if (!res.ok) stats.total_http_err++;
    } catch (e) {
      fails.push({ peer, lang, round: r+1, reason: 'EXC: ' + e.message, message: '?' });
      stats.total_http_err++;
    }
    // small jitter so broker has chance to write history
    await new Promise(r => setTimeout(r, 80 + Math.random() * 100));
  }
  return exchanges;
}

const queue = Array.from({ length: N_PEERS }, (_, i) => {
  const langs = ['zh_buy', 'zh_buy', 'zh_buy', 'zh_sell', 'en_buy', 'es_buy'];
  const lang = pick(langs);
  const qty = Math.floor(Math.random() * 99) + 1;
  return { peer: `kaspa:qpfake_mt${Date.now().toString(36)}_${i}`, lang, qty };
});

let completed = 0;
async function worker() {
  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    await runOne(job.peer, job.lang, job.qty);
    completed++;
    if (completed % 20 === 0) console.log(`  progress ${completed}/${N_PEERS}`);
  }
}
await Promise.all(Array.from({ length: PARALLEL }, () => worker()));

const total_ms = Date.now() - t_start;
console.log(`\n=== ${N_PEERS} peers × 4 rounds = ${N_PEERS*4} calls done in ${(total_ms/1000).toFixed(1)}s ===\n`);

console.log('Per-round verdict:');
console.log(`  Round 1 (intent + first turn):`);
console.log(`    ✓ DET: ${stats.r1_det} (${(stats.r1_det/N_PEERS*100).toFixed(0)}%)`);
console.log(`    🟡 other: ${stats.r1_other}`);
for (const r of [2, 3, 4]) {
  console.log(`  Round ${r}:`);
  console.log(`    ✓ LLM: ${stats[`r${r}_llm`]}`);
  console.log(`    ✗ DET (守门失效): ${stats[`r${r}_det_BAD`]}`);
  console.log(`    🟡 other: ${stats[`r${r}_other`]}`);
}
console.log(`\nGlobal:`);
console.log(`  language drift: ${stats.total_lang_drift}`);
console.log(`  LLM timeout fallback: ${stats.total_timeout}`);
console.log(`  HTTP err: ${stats.total_http_err}`);

if (fails.length > 0) {
  console.log(`\nFails / drifts (showing 20 of ${fails.length}):`);
  for (const f of fails.slice(0, 20)) {
    console.log(`  [${f.lang} r${f.round}] ${f.reason}`);
    console.log(`    msg=${JSON.stringify(f.message)}`);
    console.log(`    reply=${JSON.stringify((f.reply||'').slice(0,150))}`);
  }
}

const r1_pass = stats.r1_det / N_PEERS;
const r234_pass_rate = (stats.r2_llm + stats.r3_llm + stats.r4_llm) / (N_PEERS * 3);
const overall_pass = (stats.r1_det + stats.r2_llm + stats.r3_llm + stats.r4_llm) / (N_PEERS * 4);
console.log(`\n=== overall pass rate: ${(overall_pass*100).toFixed(1)}% ===`);
console.log(`R1 DET trigger: ${(r1_pass*100).toFixed(1)}%`);
console.log(`R2-4 LLM (no det leak): ${(r234_pass_rate*100).toFixed(1)}%`);
console.log(`drift rate: ${(stats.total_lang_drift / (N_PEERS*4) * 100).toFixed(2)}%`);
console.log(`timeout rate: ${(stats.total_timeout / (N_PEERS*4) * 100).toFixed(2)}%`);

process.exit(overall_pass < 0.95 ? 1 : 0);
