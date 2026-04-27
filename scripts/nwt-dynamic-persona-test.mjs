// NWT dynamic-persona-test — Owner 动态测要求 (qty/语言/行为/性格随机)
// 30 轮模拟, 每轮 2-3 turn 对话, 测 broker 在动态人格下不崩

const TRADER_B = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const PORT = 3100;

// 消息模板池
const QTY_POOL = [3, 5, 7, 12, 17, 25, 33, 50, 73, 99, 100, 150, 273, 500, 1000];
const LANGS = {
  zh: {
    open: ['想买 {q} kas', '我要买 {q} 个 kas', '买 {q} KAS', '搞 {q} kas', '想换 {q} kas', '弄 {q} 个 KAS'],
    chain: ['BSC', '币安链', '我用 BNB', 'bnb 链', '走 BSC'],
    yes: ['对', '是的', 'YES', '好的', '确认', 'OK', '可以'],
  },
  en: {
    open: ['buy {q} KAS', 'I want to buy {q} KAS', 'wanna get {q} KAS', 'need {q} KAS'],
    chain: ['BSC', 'BNB', 'BNB chain'],
    yes: ['yes', 'YES', 'confirm', 'go', 'sure'],
  },
  es: {
    open: ['comprar {q} KAS', 'quiero comprar {q} KAS', 'necesito {q} KAS'],
    chain: ['BSC', 'BNB'],
    yes: ['sí', 'OK', 'confirmo', 'dale'],
  },
};
const PERSONALITIES = ['direct', 'cautious', 'chaotic'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function send(peer, msg) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/agent/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ relayNodeId: TRADER_B, peer, message: msg }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) { return { error: e.message }; }
}

function classifyTurn1(reply) {
  if (!reply) return 'silent';
  if (reply.length === 0) return 'fast_path_quote_in_queue';  // handleBuyIntent fast-path
  if (/买还是卖|想买还是卖|buy or sell|comprar o vender|哪个意思/i.test(reply)) return 'asks_direction_FAIL';
  if (/哪个链|哪条链|which chain|qué cadena|cadena para|链.*USDT/i.test(reply)) return 'asks_chain_OK';
  if (/数量.*多少|how much|cuanto/i.test(reply)) return 'asks_qty_OK';
  if (/qty too small|min.*KAS|太少|too small/i.test(reply)) return 'dust_reject_OK';
  if (/卡了|stuck|失败/i.test(reply)) return 'fallback_msg';
  return 'unclassified';
}

function classifyTurn2(reply) {
  if (!reply) return 'silent';
  if (reply.length === 0) return 'fast_path_in_queue';
  if (/确认|对吗|YES|right|correcto|recap/i.test(reply)) return 'recap_OK';
  if (/maker|payment|付.*USDT|pay.*USDT|broker 自挂/i.test(reply)) return 'finalize_or_quote_OK';
  if (/买还是卖|哪个意思/i.test(reply)) return 'forgot_context_FAIL';
  if (/卡了|stuck/i.test(reply)) return 'fallback_msg';
  return 'unclassified';
}

const ROUNDS = 30;
const results = [];

console.log(`Running ${ROUNDS} dynamic persona rounds...\n`);

for (let i = 0; i < ROUNDS; i++) {
  const lang = rand(['zh','zh','zh','en','es']); // 60% 中文 (Owner 主语)
  const persona = rand(PERSONALITIES);
  const qty = rand(QTY_POOL);
  const peer = `kaspa:dyn_${persona}_${lang}_${i}_${Math.random().toString(36).slice(2,6)}`;
  const tmpl = LANGS[lang];

  // Turn 1: open with intent + qty
  const open = rand(tmpl.open).replace('{q}', qty);
  const r1 = await send(peer, open);
  const c1 = classifyTurn1(r1.reply || r1.error || '');

  let r2 = null, c2 = null;
  // Turn 2: pick chain (if Turn 1 asked, normal flow; if cautious skip / chaotic offers wrong format)
  if (c1 === 'asks_chain_OK') {
    let next;
    if (persona === 'chaotic') next = rand(['呃 啥', 'wait what', 'no idea', '这个我不太明白']);
    else if (persona === 'cautious') next = rand(['先报个价?', 'how much usdt?', '先告诉我多少钱']);
    else next = rand(tmpl.chain);
    r2 = await send(peer, next);
    c2 = classifyTurn2(r2.reply || r2.error || '');
  }

  results.push({ i, persona, lang, qty, open, r1: (r1.reply || r1.error || '').slice(0,80), c1, r2: r2 ? (r2.reply||r2.error||'').slice(0,80) : null, c2 });
  process.stdout.write(c1 === 'asks_direction_FAIL' || c1 === 'silent' || c1 === 'unclassified' ? 'X' : '.');
  if ((i+1) % 10 === 0) process.stdout.write(`\n`);
  await new Promise(res => setTimeout(res, 300));
}

console.log('\n\n========== ROUND-BY-ROUND ==========');
for (const r of results) {
  const ok = r.c1 !== 'asks_direction_FAIL' && r.c1 !== 'silent' && r.c1 !== 'unclassified';
  console.log(`${ok?'✓':'✗'} #${String(r.i).padStart(2)} [${r.persona.padEnd(8)} ${r.lang}] qty=${String(r.qty).padStart(4)} → "${r.open.padEnd(28)}" → t1=${r.c1.padEnd(20)} t2=${r.c2 || '-'}`);
}

console.log('\n========== CLASSIFICATION COUNTS ==========');
const t1Counts = {};
for (const r of results) t1Counts[r.c1] = (t1Counts[r.c1] || 0) + 1;
for (const [k,v] of Object.entries(t1Counts).sort((a,b)=>b[1]-a[1])) console.log(`  T1 ${k}: ${v}`);

const t2Counts = {};
for (const r of results) if (r.c2) t2Counts[r.c2] = (t2Counts[r.c2] || 0) + 1;
console.log();
for (const [k,v] of Object.entries(t2Counts).sort((a,b)=>b[1]-a[1])) console.log(`  T2 ${k}: ${v}`);

const failKinds = ['asks_direction_FAIL', 'silent', 'forgot_context_FAIL'];
const failCount = results.filter(r => failKinds.includes(r.c1) || failKinds.includes(r.c2)).length;
const passCount = ROUNDS - failCount;
console.log(`\n=== TOTAL: ${passCount}/${ROUNDS} PASS, ${failCount} FAIL (${(passCount/ROUNDS*100).toFixed(0)}% pass rate) ===`);
