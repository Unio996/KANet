// J2 stress test: 100 轮 broker robust regression
// Owner 命令 - 不只 happy path. 跑随机 buy/sell + 多语言 + 长 context + 边界 + 并发
// 出 PASS/FAIL 矩阵 + 失败 case 详情, 不刷频道, 一次出结果.
import { setTimeout as sleep } from 'node:timers/promises';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const URL = 'http://127.0.0.1:3100/api/agent/reply';

// 真 user 真自然话, 不只 "买 50 KAS" 模板
const TEMPLATES = {
  zh_buy: [
    '买 N KAS', '我要买 N KAS', '买 N 个 KAS', '想买 N 个 kas', '买 N kas',
    '我想买点 kas, 大概 N 个', '帮我买 N KAS 吧', '我要 N 个 KAS, 用 BSC',
    '想买 N KAS, 用什么链付？',
  ],
  zh_sell: [
    '卖 N KAS', '我要卖 N KAS', '想卖点 kas, N 个', '我有 N kas 想卖',
    '帮我卖 N KAS', '卖出 N KAS 用 BSC',
  ],
  en_buy: [
    'buy N KAS', 'I want to buy N KAS', 'I need N KAS via BSC',
    "let's buy N KAS", 'purchase N KAS please',
  ],
  es_buy: [
    'comprar N KAS', 'quiero comprar N KAS', 'Hola, comprar N KAS BSC',
  ],
  // 边界 case
  edge: [
    '买 0.05 KAS',          // dust 应当 LLM 友好拒
    '买 9999999 KAS',       // 巨大量, broker 自挂超 limit 5000 应当 LLM 友好拒
    '买 KAS',               // 没数量 → deterministic 应回 "数量多少?"
    '想买',                  // 没 kas 关键词 → intent=null → LLM
    '我付了 0xabc123...',    // PAID_REGEX 路径
    'NO',                    // cancel 词
    'YES',                   // confirm 词 (但无 pending quote, 应当 LLM 兜底)
    '滚',                    // STOP 关键词, 触发 anti-spam (NWT bug fix 25509be4)
    '别联系',                 // 同上
    '',                      // 空 message (fastify 应 reject)
  ],
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function makeMsg(category) {
  if (category === 'edge') return pick(TEMPLATES.edge);
  const tpl = pick(TEMPLATES[category]);
  const qty = Math.random() < 0.3 ? (Math.random() * 99 + 1).toFixed(2)
            : String(Math.floor(Math.random() * 100) + 1);
  return tpl.replace(/N/g, qty);
}

function classify(reply, message, category) {
  const r = (reply || '').toString();
  // expected behavior per category
  if (category === 'edge') {
    if (message === '') return r.length === 0 ? '🟡 EMPTY' : '🟡 EMPTY-OK';
    if (message === '滚' || message === '别联系') return /(再见|无法|stop|do_not_contact|noted|抱歉)/i.test(r) || r === '' ? '✓ STOP-OK' : '🟡 STOP-OTHER';
    if (/0\.05/.test(message)) return /(too small|min 1|最小|起|至少)/i.test(r) ? '✓ DUST-REJECT' : '🟡 DUST-OTHER';
    if (/9999999/.test(message)) return /(limit|超|exceed|无法|insufficient|价格)/i.test(r) ? '✓ LIMIT-REJECT' : '🟡 LIMIT-OTHER';
    if (/我付了/.test(message)) return /(收到|确认|未识别|tx|哈希|payment|付款)/i.test(r) ? '✓ PAID-OK' : '🟡 PAID-OTHER';
    return '🟡 EDGE-' + r.slice(0, 20);
  }
  // normal buy/sell — should hit DET path or HappyPath '' or LLM
  if (/(哪个链|哪条链|which chain|qué cadena|cadena para)/i.test(r)) return '✓ DET';
  if (/(数量多少|how many|cuántos)/i.test(r)) return '✓ DET-NoQty';
  if (r === '') return '✓ HAPPY-PATH (handler regex 命中, 真挂单)';
  if (/(买还是卖|是买.*还是卖|are you.*buy.*sell)/i.test(r)) return '✗ ASK-DIRECTION (deterministic 失效)';
  if (/(LLM 卡了|稍后再试|卡了 1)/i.test(r)) return '⚠ LLM-TIMEOUT';
  if (r.length < 5) return '🟡 SHORT-' + JSON.stringify(r);
  return '🟡 LLM-OK (free reply len=' + r.length + ')';
}

const ROUNDS = parseInt(process.argv[2] || '100');
const PARALLEL = parseInt(process.argv[3] || '5');
const CATS = ['zh_buy', 'zh_buy', 'zh_buy', 'zh_sell', 'en_buy', 'es_buy', 'edge', 'edge'];

console.log(`Stress: ${ROUNDS} rounds × ${PARALLEL} parallel`);
const start = Date.now();
const stats = {};
const fails = [];

async function runOne(idx) {
  const cat = pick(CATS);
  const message = makeMsg(cat);
  const peer = `kaspa:qpfake_stress_${Date.now().toString(36)}_${idx.toString(36)}`;
  const t0 = Date.now();
  let verdict, reply, err;
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ relayNodeId: BROKER_RELAY_ID, peer, message }),
    });
    const data = await res.json().catch(() => ({}));
    reply = data.reply ?? data.error ?? '';
    if (!res.ok) verdict = `✗ HTTP ${res.status}`;
    else verdict = classify(reply, message, cat);
  } catch (e) {
    err = e.message;
    verdict = '✗ EXC';
  }
  const dt = Date.now() - t0;
  stats[verdict] = (stats[verdict] || 0) + 1;
  if (verdict.startsWith('✗') || verdict.startsWith('⚠')) {
    fails.push({ idx, cat, message, verdict, reply: (reply||'').slice(0,150), err, dt });
  }
  return { idx, cat, message, verdict, dt };
}

// Run in batches
const queue = Array.from({ length: ROUNDS }, (_, i) => i);
let completed = 0;
async function worker() {
  while (queue.length > 0) {
    const idx = queue.shift();
    if (idx === undefined) break;
    await runOne(idx);
    completed++;
    if (completed % 20 === 0) console.log(`  progress ${completed}/${ROUNDS}`);
  }
}
await Promise.all(Array.from({ length: PARALLEL }, () => worker()));

const totalMs = Date.now() - start;
console.log(`\n=== ${ROUNDS} rounds done in ${(totalMs/1000).toFixed(1)}s (${(ROUNDS/totalMs*1000).toFixed(1)} req/s) ===\n`);

const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]);
console.log('Verdict distribution:');
for (const [v, c] of sorted) {
  const pct = (c / ROUNDS * 100).toFixed(1);
  console.log(`  ${v.padEnd(40)} ${String(c).padStart(4)} (${pct}%)`);
}

if (fails.length > 0) {
  console.log(`\nFailures / Warnings (${fails.length}):`);
  for (const f of fails.slice(0, 30)) {
    console.log(`  [#${f.idx} ${f.cat} ${f.dt}ms] ${f.verdict}`);
    console.log(`    msg=${JSON.stringify(f.message)}`);
    console.log(`    reply=${JSON.stringify(f.reply).slice(0,200)}`);
    if (f.err) console.log(`    err=${f.err}`);
  }
  if (fails.length > 30) console.log(`  ... ${fails.length - 30} more`);
}

const passed = Object.entries(stats).filter(([v]) => v.startsWith('✓')).reduce((s,[,c]) => s+c, 0);
const warned = Object.entries(stats).filter(([v]) => v.startsWith('⚠') || v.startsWith('🟡')).reduce((s,[,c]) => s+c, 0);
const failed = Object.entries(stats).filter(([v]) => v.startsWith('✗')).reduce((s,[,c]) => s+c, 0);
console.log(`\nSummary: ${passed} PASS, ${warned} WARN, ${failed} FAIL (of ${ROUNDS})`);
process.exit(failed > 0 ? 1 : 0);
