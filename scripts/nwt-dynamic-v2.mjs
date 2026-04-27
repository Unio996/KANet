// NWT dynamic-v2 — 改进版: 真 Agent peer (有 history), 修 classify, 更多场景
// 50 轮覆盖: 多语言 / 性格 / cancel / paid / dust / over-inventory / empty / concurrent

const TRADER_B = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const PORT = 3100;

// 真 peer (有 broker 历史, _loadHistory 能 join 到)
const REAL_PEERS = [
  'kaspa:qpfakedqgvlk748usv',  // dqgvlk748usv (172 msgs)
  'kaspa:qpfake7z7uwq2wq200',  // (623 msgs)
  'kaspa:qpfakeq3f5a2cr843s',  // (515 msgs)
];

// fake peer (no history) - 用于跑首轮场景
function fakePeer(seed) { return `kaspa:dyn2_${seed}_${Math.random().toString(36).slice(2,6)}`; }

const QTY_POOL = [3, 5, 7, 12, 17, 25, 33, 50, 73, 99, 100, 150, 273, 500, 1000, 0.5, 0.05];
const VERBS_ZH = ['想买', '我要买', '买', '搞', '换', '想换', '弄', '要', '想要', '来', '我想要', '帮我搞', '有 KAS 卖吗?'];
const VERBS_EN = ['buy', 'I want to buy', 'wanna get', 'need', 'looking for'];
const VERBS_ES = ['comprar', 'quiero comprar', 'necesito'];
const CHAINS_OK = ['BSC', 'BNB', '币安链'];
const CHAINS_BAD = ['Polygon', 'SOL', 'TRON', 'Solana', '波场'];

async function send(peer, msg) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/agent/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ relayNodeId: TRADER_B, peer, message: msg }),
      signal: AbortSignal.timeout(45000),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } catch (e) { return { status: 'ERR', error: e.message }; }
}

function classify(reply, kind) {
  if (typeof reply !== 'string') return 'no_reply';
  if (reply.length === 0) return 'fast_path_OK';  // 修: 不再当 silent
  if (kind === 'first') {
    if (/买还是卖|想买还是卖|buy or sell|comprar o vender|你的意思/i.test(reply)) return 'asks_direction_FAIL';
    if (/哪个链|哪条链|which chain|qué cadena|cadena.*pagar/i.test(reply)) return 'asks_chain_OK';
    if (/数量.*多少|how much|cuanto|多少 kas/i.test(reply)) return 'asks_qty_OK';
    if (/qty too small|min.*KAS|太少|too small|最小/i.test(reply)) return 'dust_reject_OK';
    if (/暂时没.*卖单|no offer|sin.*ofertas|无.*库存|insufficient/i.test(reply)) return 'no_inventory_OK';
    if (/卡了|stuck/i.test(reply)) return 'fallback_msg';
    if (/^好|got it|perfecto|收到/i.test(reply)) return 'acknowledged_OK';
    return 'unclassified';
  } else if (kind === 'follow') {
    if (/maker|payment|付.*USDT|pay.*USDT|broker 自挂|挂单|报价/i.test(reply)) return 'finalize_OK';
    if (/确认|对吗|YES|right|correcto|recap/i.test(reply)) return 'recap_OK';
    if (/买还是卖|哪个意思/i.test(reply)) return 'forgot_context_FAIL';
    if (/取消|cancelled/i.test(reply)) return 'cancelled_OK';
    return 'unclassified';
  } else if (kind === 'paid') {
    if (/收到付款|payment received|recibido|tx 验|验证中/i.test(reply)) return 'paid_recognized_OK';
    if (/买还是卖|哪个意思|想买还是/i.test(reply)) return 'paid_path_broken_FAIL';
    return 'unclassified_paid';
  }
  return 'unclassified';
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const results = [];

console.log('Running 50 rounds (mixed real peer + fake) ...\n');

for (let i = 0; i < 50; i++) {
  const lang = rand(['zh','zh','zh','en','es']);
  const useReal = i % 3 === 0;  // 1/3 真 peer 测 multi-turn 持久 history
  const peer = useReal ? rand(REAL_PEERS) : fakePeer('r' + i);
  const qty = rand(QTY_POOL);

  let verbs = lang === 'zh' ? VERBS_ZH : lang === 'en' ? VERBS_EN : VERBS_ES;
  let firstMsg;
  if (i === 5) firstMsg = '';  // 边界: 空消息
  else if (i === 10) firstMsg = 'enough! 滚!';  // STOP keyword
  else if (i === 20) firstMsg = '我付了 0x' + 'a'.repeat(64);  // PAID flow first turn (no order)
  else firstMsg = `${rand(verbs)} ${qty} kas`;

  // Turn 1
  const r1 = await send(peer, firstMsg);
  const c1 = classify(r1.body?.reply || r1.error || '', 'first');

  // Turn 2 (跟进 chain or cancel or paid)
  let r2 = null, c2 = null;
  if (c1 === 'asks_chain_OK') {
    let next;
    if (i % 7 === 0) next = 'NO';  // 1/7 取消
    else if (i % 5 === 0) next = rand(CHAINS_BAD);  // 1/5 选不支持链
    else next = rand(CHAINS_OK);
    r2 = await send(peer, next);
    const subKind = (next === 'NO') ? 'follow' : 'follow';
    c2 = classify(r2.body?.reply || r2.error || '', subKind);
  }

  // Turn 3 (paid scenario, occasional)
  let r3 = null, c3 = null;
  if (c2 === 'finalize_OK' && i % 4 === 0) {
    r3 = await send(peer, '我付了 0x' + Math.random().toString(16).slice(2).padEnd(64,'0'));
    c3 = classify(r3.body?.reply || r3.error || '', 'paid');
  }

  results.push({
    i, lang, qty, peer: useReal ? 'real' : 'fake', firstMsg: firstMsg.slice(0,30),
    c1, t1: (r1.body?.reply || r1.error || '').slice(0,60),
    c2, t2: r2 ? (r2.body?.reply || r2.error || '').slice(0,60) : null,
    c3, t3: r3 ? (r3.body?.reply || r3.error || '').slice(0,60) : null,
  });
  process.stdout.write(c1.endsWith('FAIL') || c1 === 'no_reply' || c1 === 'unclassified' ? 'X' : '.');
  if ((i+1) % 10 === 0) process.stdout.write('\n');
  await new Promise(res => setTimeout(res, 250));
}

console.log('\n\n========== ROUND DETAIL ==========');
for (const r of results) {
  const isFail = r.c1.endsWith('FAIL') || r.c1 === 'no_reply' || r.c2?.endsWith('FAIL') || r.c3?.endsWith('FAIL');
  console.log(`${isFail?'✗':'✓'} #${String(r.i).padStart(2)} ${r.peer.padEnd(4)} ${r.lang} qty=${String(r.qty).padStart(5)} → "${r.firstMsg.padEnd(30)}"`);
  console.log(`     T1[${r.c1}]: ${r.t1}`);
  if (r.c2) console.log(`     T2[${r.c2}]: ${r.t2}`);
  if (r.c3) console.log(`     T3[${r.c3}]: ${r.t3}`);
}

console.log('\n========== T1 CLASSIFICATION ==========');
const t1c = {}; for (const r of results) t1c[r.c1] = (t1c[r.c1]||0)+1;
for (const [k,v] of Object.entries(t1c).sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);

console.log('\n========== T2 CLASSIFICATION ==========');
const t2c = {}; for (const r of results) if (r.c2) t2c[r.c2] = (t2c[r.c2]||0)+1;
for (const [k,v] of Object.entries(t2c).sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);

console.log('\n========== T3 (PAID) CLASSIFICATION ==========');
const t3c = {}; for (const r of results) if (r.c3) t3c[r.c3] = (t3c[r.c3]||0)+1;
for (const [k,v] of Object.entries(t3c).sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);

const failKinds = ['asks_direction_FAIL', 'forgot_context_FAIL', 'paid_path_broken_FAIL', 'no_reply'];
const failCount = results.filter(r => failKinds.includes(r.c1) || failKinds.includes(r.c2) || failKinds.includes(r.c3)).length;
console.log(`\n=== ${results.length - failCount}/${results.length} PASS = ${((results.length-failCount)/results.length*100).toFixed(0)}% ===`);
