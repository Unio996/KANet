// prediction-payout-gate.test.mjs — (c) F2 派彩 landed 门 + delivering 扫描 离线向量 (J2 2026-09-13, 设计 v0.3 §4 F2-正/反/幂等)。
// 真 migration 临时库 + 假 sendCmd + 假 transition(只允许 delivering→completed, 写 metadata) ; 零链零 IPC。
// Run: cd kasia-console && node src/services/prediction-payout-gate.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PAYOUT_GATE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_payout_gate_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PAYOUT_GATE_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: 'mainnet' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { submitPayoutIntent, completeIfLanded, sweepDeliveringPayouts } = await import('./prediction-payout-gate.mjs');
const { ensureIntent, getIntent, intentKeyFor } = await import('../lib/submit-intent.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const quiet = { log: () => {}, error: () => {} };
const MIN = 20;

function insertOffer(id, status = 'delivering', meta = {}) {
  sqlite.prepare(`INSERT INTO exchange_offers (id, broadcast_tx_id, give_asset, give_amount, want_asset, want_amount, maker, maker_relay_id, market_key, protocol_status, metadata)
                  VALUES (?, ?, 'prediction_outcome_share', '1', 'KAS', '10', 'kaspa:qmaker', 'relay-maker', 'k', ?, ?)`)
    .run(id, `bcast-${id}`, status, JSON.stringify({ settle_winner: 'YES', maker_won: true, settle_kas_delta: 5, ...meta }));
  return sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(id);
}
const status = (id) => sqlite.prepare('SELECT protocol_status FROM exchange_offers WHERE id = ?').get(id).protocol_status;
const meta = (id) => JSON.parse(sqlite.prepare('SELECT metadata FROM exchange_offers WHERE id = ?').get(id).metadata || '{}');
const paidRows = () => sqlite.prepare(`SELECT count(*) AS n FROM prediction_reputation_log WHERE event_type = 'paid'`).get().n;
// 假 transition: 形同 exchange-machine.transition 的 delivering→completed 分支
// lint-allow-protocol-status-direct: 离线测试替身(模拟 exchange-machine.transition 的单一所有权写入, 生产码不走这里)
function transitionFn(id, next, extra = {}) {
  const cur = status(id);
  if (cur !== 'delivering' || next !== 'completed') return;
  sqlite.prepare('UPDATE exchange_offers SET protocol_status = ?, metadata = COALESCE(?, metadata), updated_at = ? WHERE id = ?').run(next, extra.metadata || null, new Date().toISOString(), id);
}
let _txn = 0;   // 全局计数: 不同假 relay 实例的 txid 不得撞(撞了 = 别的向量的 offer 在本向量"落链")
function makeRelay() {
  const R = { broadcasts: [], mempool: new Set(), landed: new Map() };
  R.sendCmd = async (relayId, cmd) => {
    if (cmd.type === 'get_mempool_entry') return { ok: true, found: R.mempool.has(cmd.txid) };
    if (cmd.type === 'check_utxo_landed') { const d = R.landed.get(cmd.txid); return { ok: true, landed: d != null && d >= (cmd.minDepth || 0), depth: d ?? null }; }
    if (cmd.type === 'transfer') { const txid = `tx${++_txn}`.padEnd(64, '0'); R.broadcasts.push(txid); R.mempool.add(txid); return { ok: true, txId: txid }; }
    throw new Error('unexpected ' + cmd.type);
  };
  return R;
}

// ── F2-正 / F2-反: submitted 不落 ⇒ 留 delivering 无 'paid'; 落到 25 ⇒ completed + 'paid' 恰一行; 再核 ⇒ 幂等 ──
{
  const R = makeRelay();
  const offer = insertOffer('p1');
  const s = await submitPayoutIntent({ sendCmd: R.sendCmd, relayId: 'relay-escrow', offer, winnerAddr: 'kaspa:qwinner', amountKas: '5.00000000', log: quiet });
  ok(s.txId && meta('p1').settle_outcome_phase === 'submitted' && meta('p1').payout_tx === s.txId && status('p1') === 'delivering', 'submitPayoutIntent: metadata phase=submitted, offer 仍 delivering');
  R.landed.set(s.txId, 3);
  const g1 = await completeIfLanded({ sendCmd: R.sendCmd, transitionFn, offer, intent: s.intent, minDepth: MIN, log: quiet });
  ok(!g1.completed && status('p1') === 'delivering' && paidRows() === 0 && meta('p1').settle_outcome_phase === 'submitted', 'F2-反: depth 3 < 20 → 留 delivering, 无 reputation 行');
  R.landed.set(s.txId, 25);
  const g2 = await completeIfLanded({ sendCmd: R.sendCmd, transitionFn, offer, intent: getIntent(s.intent.intent_key), minDepth: MIN, log: quiet });
  ok(g2.completed && status('p1') === 'completed' && paidRows() === 1 && meta('p1').settle_outcome_phase === 'paid' && meta('p1').payout_landed_depth === 25 && getIntent(s.intent.intent_key).status === 'landed', 'F2-正: depth 25 → completed + reputation paid 恰一行 + intent landed');
  const g3 = await completeIfLanded({ sendCmd: R.sendCmd, transitionFn, offer, intent: getIntent(s.intent.intent_key), minDepth: MIN, log: quiet });
  ok(g3.completed && g3.already && paidRows() === 1, 'F2-幂等: 再核一次不再写 reputation');
  const s2 = await submitPayoutIntent({ sendCmd: R.sendCmd, relayId: 'relay-escrow', offer, winnerAddr: 'kaspa:qwinner', amountKas: '5.00000000', log: quiet });
  ok(s2.reused && R.broadcasts.length === 1, 'F2-幂等: 再 submit 同 offer → reused, broadcasts 仍 1');
}
// ── F2-反 b: 超 30 min 未落 ⇒ payout_not_landed 告警 1 行(限频) ──
{
  const R = makeRelay();
  const offer = insertOffer('p2');
  const s = await submitPayoutIntent({ sendCmd: R.sendCmd, relayId: 'relay-escrow', offer, winnerAddr: 'kaspa:qwinner', amountKas: '5', log: quiet });
  sqlite.prepare('UPDATE submit_intents SET updated_at = ? WHERE intent_key = ?').run(new Date(Date.now() - 31 * 60 * 1000).toISOString(), s.intent.intent_key);
  await completeIfLanded({ sendCmd: R.sendCmd, transitionFn, offer, intent: getIntent(s.intent.intent_key), minDepth: MIN, log: quiet });
  await completeIfLanded({ sendCmd: R.sendCmd, transitionFn, offer, intent: getIntent(s.intent.intent_key), minDepth: MIN, log: quiet });
  const n = sqlite.prepare(`SELECT count(*) AS c FROM events WHERE event_type = 'payout_not_landed'`).get().c;
  ok(n === 1 && status('p2') === 'delivering', 'F2-反 b: 31 min 未落 → payout_not_landed 恰 1 行(限频), 仍 delivering');
}
// ── sweep: pending intent(进程在 IPC 前死) ⇒ 续发再核; submitted 且落 ⇒ completed; 无 intent ⇒ noIntent ──
{
  const R = makeRelay();
  insertOffer('s1'); ensureIntent({ intentKind: 'payout', offerId: 's1', relayId: 'relay-escrow', targetAddress: 'kaspa:qw', amountKas: '2' });   // pending, 从未发出
  const o2 = insertOffer('s2'); const t2 = await submitPayoutIntent({ sendCmd: R.sendCmd, relayId: 'relay-escrow', offer: o2, winnerAddr: 'kaspa:qw', amountKas: '2', log: quiet }); R.landed.set(t2.txId, 30);
  insertOffer('s3');   // 本补丁前进入 delivering 的老行, 无 intent
  insertOffer('s4', 'completed');   // 不在扫描范围
  const before = R.broadcasts.length;
  const sw = await sweepDeliveringPayouts({ sendCmd: R.sendCmd, transitionFn, minDepth: MIN, log: quiet });
  // 扫描面 = p2(上一向量, submitted 未落) + s1 + s2 + s3 = 4
  ok(sw.scanned === 4 && sw.resent === 1 && sw.completed === 1 && sw.waiting === 2 && sw.noIntent === 1 && R.broadcasts.length === before + 1, `sweep: pending→续发1 · submitted落→completed1 · 未落→waiting2 · 无intent→跳过1 (${JSON.stringify(sw)})`);
  ok(status('s2') === 'completed' && status('s1') === 'delivering' && meta('s1').settle_outcome_phase === 'submitted' && status('s3') === 'delivering', 'sweep 后状态: s2 completed, s1 submitted 留 delivering, s3 不动');
  const sw2 = await sweepDeliveringPayouts({ sendCmd: R.sendCmd, transitionFn, minDepth: MIN, log: quiet });
  ok(sw2.resent === 0 && R.broadcasts.length === before + 1, 'sweep 第二次: 不再重发(幂等)');
}
// ── harness 翻转臂 ──
{
  const before = fails;
  ok(paidRows() === 999, 'harness-flip (expect FAIL)');
  if (fails === before + 1) { fails--; console.log('  ✅ harness flip arm went red as required'); } else { fails++; }
}
console.log(fails ? `\n❌ ${fails} failure(s)` : '\n✅ all payout-gate vectors passed');
process.exit(fails ? 1 : 0);
