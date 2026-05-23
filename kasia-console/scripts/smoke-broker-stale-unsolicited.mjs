// smoke-broker-stale-unsolicited.mjs — T-J2-10 12h unsolicited refund
// 造 unsolicited_wait 标记 + > 12h ago + 原 chain_events tx → tick → sendKas + DM + chain_event 标记 + 幂等

import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'crypto';

process.env.DB_PATH = process.env.DB_PATH || 'C:/kanet/kasia-console/data/console.db';
const db = new Database(process.env.DB_PATH);

const BROKER = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const brokerAddr = db.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(BROKER)?.address;

const sent = [];
const fakeSend = async (relayId, cmd) => { sent.push({ relayId, ...cmd }); return { ok: true, txId: 'smoke_' + randomBytes(8).toString('hex') }; };
const mkPeer = () => 'kaspa:q' + randomBytes(32).toString('hex');

function injectUnsolicited({ peer, amount, hoursAgo }) {
  // 1. 原 tx event
  const srcId = randomUUID();
  const srcAt = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  db.prepare(`
    INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, ?, ?, ?, 'tx', ?, 'smoke', ?)
  `).run(srcId, `smoke_tx_${srcId.slice(0,8)}`, peer, brokerAddr, JSON.stringify({ amount: String(amount) }), srcAt);
  // 2. broker_intake_processed unsolicited_wait
  const procId = randomUUID();
  db.prepare(`
    INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, ?, NULL, NULL, 'broker_intake_processed', ?, 'broker-intake-watcher', ?)
  `).run(procId, `smoke_intake_proc_${procId.slice(0,8)}`,
    JSON.stringify({ src_event_id: srcId, outcome: 'unsolicited_wait' }), srcAt);
  return { srcId, procId };
}

function cleanup() {
  db.prepare(`DELETE FROM chain_events WHERE txid LIKE 'smoke_%' OR txid LIKE 'unsolicited_refund_smoke_%'`).run();
}

async function run() {
  cleanup();
  const mod = await import('../src/services/broker-intake-watcher.js');
  mod._testInjectSendCommand(fakeSend);

  const u1 = mkPeer();
  injectUnsolicited({ peer: u1, amount: 50, hoursAgo: 13 });  // > 12h, 应退

  const u2 = mkPeer();
  injectUnsolicited({ peer: u2, amount: 30, hoursAgo: 5 });  // < 12h, 不退

  // Case 1: 第一次 tick — 退 u1, 不退 u2
  const r1 = await mod._scanStaleUnsolicited();
  console.log('tick 1:', r1);

  const sendKasCnt = sent.filter(s => s.type === 'send_kas').length;
  const dmCnt = sent.filter(s => s.type === 'send_message').length;
  console.log(`sent: ${sendKasCnt} send_kas, ${dmCnt} send_message`);

  // Case 2: 重复 tick 防重 (chain_event marker)
  const before = sent.length;
  const r2 = await mod._scanStaleUnsolicited();
  const diff = sent.length - before;
  console.log('tick 2 (repeat):', r2, 'diff sent:', diff);

  const checks = [
    [r1.handled === 1, 'Case 1 handled=1 (only u1 13h 触发)'],
    [r1.scanned === 1, 'Case 1 scanned=1 (u2 5h 不入 SQL)'],
    [sendKasCnt === 1, 'Case 1 一次 sendKas 退款'],
    [sent.find(s => s.type === 'send_kas')?.amount_kas === 50, 'Case 1 退款金额 50'],
    [sent.find(s => s.type === 'send_kas')?.target === u1, 'Case 1 退到 u1'],
    [dmCnt === 1, 'Case 1 一次 DM 通告'],
    [sent.find(s => s.type === 'send_message')?.message?.includes('12h'), 'Case 1 DM 含 12h 文本'],
    [r2.handled === 0, 'Case 2 重复 tick 防重'],
    [diff === 0, 'Case 2 不再发 send_kas/DM'],
  ];
  let ok = 0;
  for (const [p, l] of checks) { console.log(`${p ? '✓' : '✗'} ${l}`); if (p) ok++; }
  console.log(`\n${ok}/${checks.length} PASS${ok === checks.length ? ' ✓' : ' ✗'}`);

  cleanup();
  mod._testResetSendCommand();
  process.exit(ok === checks.length ? 0 : 1);
}

run().catch(e => { console.error('SMOKE ERR:', e.stack || e.message); cleanup(); process.exit(1); });
