// smoke-broker-intake.mjs — Phase 3 兜底 4 场景 smoke
// 造 4 种 chain_events (意图一致/反向/陌生/黑名单) + 注入 send 捕获, 验证路由
//
// Run: node scripts/smoke-broker-intake.mjs
// Exit 0 if 4/4 PASS.

import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'crypto';

process.env.DB_PATH = process.env.DB_PATH || 'C:/kanet/kasia-console/data/console.db';
const db = new Database(process.env.DB_PATH);

const BROKER = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const brokerAddr = db.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(BROKER)?.address;
if (!brokerAddr) { console.error('no broker relay'); process.exit(1); }

// 拦截 send 动作: 记录而不真发
const sent = [];
const fakeSend = async (relayId, cmd) => {
  sent.push({ relayId, ...cmd });
  return { ok: true, txId: 'smoke_' + randomBytes(4).toString('hex') };
};

const mkPeer = () => 'kaspa:q' + randomBytes(32).toString('hex');

function injectEvent({ peer, amount, ms_ago = 60_000 }) {
  const id = randomUUID();
  const obsAt = new Date(Date.now() - ms_ago).toISOString();
  db.prepare(`
    INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, ?, ?, ?, 'tx', ?, 'smoke', ?)
  `).run(id, `smoke_tx_${id.slice(0,8)}`, peer, brokerAddr, JSON.stringify({ amount: String(amount) }), obsAt);
  return id;
}

function injectOrder({ user, side, qty }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO retail_dex_orders (id, user_kasia_address, side, order_type, qty, state, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, 'market', ?, 'aligning', ?, ?, ?)
  `).run(id, user, side, String(qty), now, now, now);
  return id;
}

function injectBlock(peer) {
  db.prepare(`
    INSERT INTO relation_states (id, local_address, peer_address, is_blocked, trust_level, status, updated_at)
    VALUES (?, ?, ?, 1, 'blocked', 'blocked', ?)
  `).run(randomUUID(), brokerAddr, peer, new Date().toISOString());
}

function cleanup() {
  db.prepare(`DELETE FROM chain_events WHERE txid LIKE 'smoke_tx_%' OR txid LIKE 'broker_intake_%' AND payload LIKE '%smoke%'`).run();
  db.prepare(`DELETE FROM chain_events WHERE event_type='broker_intake_processed' AND payload LIKE '%src_event_id%' AND observed_at > datetime('now','-10 minutes')`).run();
  db.prepare(`DELETE FROM retail_dex_orders WHERE user_kasia_address LIKE 'kaspa:q%' AND created_at > datetime('now','-10 minutes')`).run();
  db.prepare(`DELETE FROM relation_states WHERE peer_address LIKE 'kaspa:q%' AND is_blocked=1 AND updated_at > datetime('now','-10 minutes')`).run();
}

async function run() {
  console.log(`broker=${brokerAddr.slice(-20)}`);

  // Import after DB setup
  const mod = await import('../src/services/broker-intake-watcher.js');
  mod._testInjectSendCommand(fakeSend);

  cleanup();

  // Case 1: 意图一致 sell_kas 50, 入账 50 KAS
  const p1 = mkPeer();
  injectOrder({ user: p1, side: 'sell_kas', qty: 50 });
  injectEvent({ peer: p1, amount: 50 });

  // Case 2: 意图反向 buy_kas, 但发了 KAS
  const p2 = mkPeer();
  injectOrder({ user: p2, side: 'buy_kas', qty: 30 });
  injectEvent({ peer: p2, amount: 10 });

  // Case 3: 无意图 (陌生转入)
  const p3 = mkPeer();
  injectEvent({ peer: p3, amount: 100 });

  // Case 4: 黑名单
  const p4 = mkPeer();
  injectBlock(p4);
  injectEvent({ peer: p4, amount: 25 });

  // Run tick
  const result = await mod.intakeTick();
  console.log('tick:', result);

  // Check sent commands for each peer
  const outcomes = {};
  for (const s of sent) {
    const peerTail = s.target.slice(-8);
    const sides = {
      [p1.slice(-8)]: 'p1', [p2.slice(-8)]: 'p2', [p3.slice(-8)]: 'p3', [p4.slice(-8)]: 'p4',
    };
    const k = sides[peerTail] || 'unknown';
    outcomes[k] = s.type === 'send_kas' ? 'REFUND' : s.message.slice(0, 40);
  }
  console.log('outcomes:', outcomes);

  const pass = [
    [outcomes.p1?.includes('开始代卖'), 'Case 1 意图一致 → 代卖'],
    [outcomes.p2?.includes('想买 KAS'), 'Case 2 意图反向 → 询问'],
    [outcomes.p3?.includes('你想做什么'), 'Case 3 无意图 → 询问'],
    [outcomes.p4 === 'REFUND', 'Case 4 黑名单 → 退款'],
  ];

  let ok = 0;
  for (const [p, label] of pass) {
    console.log(`${p ? '✓' : '✗'} ${label}`);
    if (p) ok++;
  }

  // Verify mark_processed (4 new broker_intake_processed rows)
  const processed = db.prepare(`SELECT count(*) c FROM chain_events WHERE event_type='broker_intake_processed' AND observed_at > datetime('now','-1 minute')`).get().c;
  console.log(`broker_intake_processed rows last 1min: ${processed} (expect ≥ 4)`);

  cleanup();
  console.log(`${ok}/4 PASS${ok === 4 ? ' ✓' : ' ✗'}`);
  process.exit(ok === 4 ? 0 : 1);
}

run().catch(e => { console.error('SMOKE ERR:', e.stack || e.message); cleanup(); process.exit(1); });
