// e2e-broker-dynamic.mjs — J1 dynamic robust e2e: 多场景 + 多语言 + 多性格 + 边界
//
// NWT 提议: 不固定 50 KAS BSC, dynamic personality 模拟. J1 实做.
// Owner 命令: 投完不动是偷懒. 立刻跑.
//
// Run: node scripts/e2e-broker-dynamic.mjs --rounds=10 --broker-kasia=kaspa:xxx

import Database from 'better-sqlite3';

const SOPHIE_RELAY_ID = 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf';
const SOPHIE_ADDR = 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp';
const args = process.argv.slice(2);
const roundsArg = args.find(a => a.startsWith('--rounds='));
const brokerArg = args.find(a => a.startsWith('--broker-kasia='));
const ROUNDS = roundsArg ? parseInt(roundsArg.slice(9)) : 10;
const BROKER_KASIA = brokerArg ? brokerArg.slice(15) : null;

if (!BROKER_KASIA) {
  console.error('需要 --broker-kasia=kaspa:xxx');
  process.exit(2);
}

const CONSOLE = 'http://localhost:3100';
const db = new Database('./data/console.db', { readonly: true });

// 测试场景矩阵 — 覆盖各路径 + 多语言 + 边界
const SCENARIOS = [
  // happy path 中文
  { msg: '买 50 KAS', expect: { mentionsQty: 50, noDirectionQ: true, hasChain: true } },
  { msg: '买 25 KAS', expect: { mentionsQty: 25, noDirectionQ: true, hasChain: true } },
  { msg: '我要买 10 KAS', expect: { mentionsQty: 10, noDirectionQ: true, hasChain: true } },
  // 多语言
  { msg: 'I want to buy 20 KAS', expect: { mentionsQty: 20, noDirectionQ: true, hasChain: true } },
  { msg: 'comprar 30 KAS', expect: { mentionsQty: 30, noDirectionQ: true } },
  // 自然语言变体
  { msg: '想买点 kas', expect: { hasChain: true } },  // qty 缺
  { msg: '买 5 个 KAS', expect: { mentionsQty: 5, noDirectionQ: true } },
  // dust 拒接
  { msg: '买 0.5 KAS', expect: { detectMin: true } },  // < MIN_QTY
  // 卖路径 (broker 没卖路径自挂能力, 走 LLM)
  { msg: '卖 5 KAS', expect: { acceptable: true } },  // 任何不崩的回复
  // 空闲聊兜底 (LLM 接管)
  { msg: '你好', expect: { acceptable: true } },  // LLM 引回买卖
];

console.log('='.repeat(80));
console.log(`E2E Dynamic Robust: ${ROUNDS} rounds × ${SCENARIOS.length} scenarios`);
console.log(`  Sophie: ${SOPHIE_ADDR.slice(0, 24)}...`);
console.log(`  Broker: ${BROKER_KASIA.slice(0, 24)}...`);
console.log('='.repeat(80));

let totalPass = 0, totalFail = 0;
const failures = [];

async function pollBrokerReply(startTs, timeoutMs = 90_000) {
  const tStart = Date.now();
  while (Date.now() - tStart < timeoutMs) {
    const row = db.prepare(`
      SELECT m.content_text, m.created_at FROM messages m
      LEFT JOIN identities si ON si.id = m.sender_identity_id
      LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
      WHERE m.message_type='text' AND si.address=? AND ri.address=? AND m.direction='inbound' AND m.created_at > ?
      ORDER BY m.created_at DESC LIMIT 1
    `).get(BROKER_KASIA, SOPHIE_ADDR, startTs);
    if (row) return { content: row.content_text, latency: Date.now() - tStart };
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

function checkExpect(reply, expect) {
  const fails = [];
  if (expect.mentionsQty != null && !new RegExp(`\\b${expect.mentionsQty}\\b`).test(reply)) {
    fails.push(`missing qty ${expect.mentionsQty}`);
  }
  if (expect.noDirectionQ && /买还是卖|想买还是卖|buy or sell|are you (looking to|wanting to)/i.test(reply)) {
    fails.push('still asks direction');
  }
  if (expect.hasChain && !/BSC|BNB|Polygon|SOL|TRON|链|chain|cadena/i.test(reply)) {
    fails.push('no chain options');
  }
  if (expect.detectMin && !/太小|too small|min|最小|1 KAS/i.test(reply)) {
    fails.push('dust qty not properly rejected');
  }
  if (expect.acceptable && reply.length < 5) {
    fails.push('reply too short / silent');
  }
  return fails;
}

// v6 (UTXO double-spend fix): sendMessage 必须真 verify 上链, 防 RPC Rejected 假 ok=true
async function sendMessage(msg, opts = {}) {
  const data = await fetch(`${CONSOLE}/api/relay/${SOPHIE_RELAY_ID}/send-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ type: 'send_message', target: BROKER_KASIA, message: msg }),
  }).then(r => r.json());
  // RPC Rejected 假 ok 防御: relay-manager 返 ok:true + error 字段时 = 链上 reject
  if (!data.ok || data.error) {
    if (!opts.silent) console.warn(`  [send] reject: ${(data.error || 'unknown').slice(0, 80)}`);
    return { ok: false, error: data.error || 'send_failed', rejected: true };
  }
  if (!data.txId) return { ok: false, error: 'no txId' };
  // wait 12s + verify kaspa_tx_log 真上链 (UTXO 确认 + indexer ingest)
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const onchain = db.prepare("SELECT 1 FROM kaspa_tx_log WHERE tx_id=?").get(data.txId);
    if (onchain) return { ok: true, txId: data.txId };
  }
  return { ok: false, error: 'tx not in kaspa_tx_log after 12s', txId: data.txId };
}

// v5 startup: 全局 NO 清 sell pending (避免 case 间累积)
console.log('\n[v5 cleanup] sending NO to clear any pending state...');
await sendMessage('NO');
await new Promise(r => setTimeout(r, 5000));  // 等 broker ingest

for (let r = 1; r <= ROUNDS; r++) {
  for (let s = 0; s < SCENARIOS.length; s++) {
    const sc = SCENARIOS[s];
    const tag = `[r${r}/${ROUNDS} s${s+1}/${SCENARIOS.length}]`;
    process.stdout.write(`${tag} "${sc.msg}" ... `);
    const startTs = new Date().toISOString();
    try {
      const sendData = await sendMessage(sc.msg);
      if (!sendData.ok) { console.log(`SEND FAIL: ${sendData.error || JSON.stringify(sendData)}`); totalFail++; failures.push({ ...sc, err: 'send_fail' }); continue; }

      const reply = await pollBrokerReply(startTs, 90_000);
      if (!reply) { console.log('TIMEOUT (90s)'); totalFail++; failures.push({ ...sc, err: 'timeout' }); continue; }

      const failed = checkExpect(reply.content, sc.expect);
      if (failed.length === 0) {
        console.log(`✓ (${(reply.latency/1000).toFixed(1)}s)`);
        totalPass++;
      } else {
        console.log(`✗ ${failed.join(', ')}`);
        totalFail++;
        failures.push({ ...sc, err: failed.join(';'), reply: reply.content.slice(0, 100) });
      }
    } catch (e) {
      console.log(`ERR: ${e.message}`);
      totalFail++;
      failures.push({ ...sc, err: e.message });
    }
    // v5: 每 case 后发 NO 清 quote/pending state (5min TTL 否则 case 间撞)
    await sendMessage('NO');
    // 间隔避免 broker queue race + Kasia 链拥塞 + ingest NO
    await new Promise(r => setTimeout(r, 5000));
  }
}

console.log('\n' + '='.repeat(80));
console.log(`Result: ${totalPass}/${totalPass+totalFail} pass (${(100*totalPass/(totalPass+totalFail)).toFixed(1)}%)`);
if (failures.length) {
  console.log(`\nFailures (${failures.length}):`);
  for (const f of failures.slice(0, 20)) {
    console.log(`  "${f.msg}" → ${f.err}${f.reply ? ` | reply="${f.reply}"` : ''}`);
  }
}
console.log('='.repeat(80));
process.exit(totalFail === 0 ? 0 : 1);
