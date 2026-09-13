// escrow-landed-gate.test.mjs — (c) 第 5 笔 (B) · Codex 8118732e HOLD: escrow_landed_at 硬消费门 negative test。
// 真 migration 临时库 + 真 exchange-machine.transition(单一所有权点) + 真 applyIntentLanded; 零链零 IPC。
// 守什么: submit 返回 txid 但【永不落链】⇒ matched / verifying / delivering / completed 全部不可达(transition 返回原状态);
//        对账器把 intent landed 回填后 ⇒ 可达; taker 门 409 形; 普通 exchange offer 不受影响; 退款/取消不拦; harness 翻转臂。
// Run: cd kasia-console && node src/services/escrow-landed-gate.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._ESCROW_GATE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_escrow_gate_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _ESCROW_GATE_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: 'mainnet' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { transition } = await import('./exchange-machine.js');
const { escrowGateFor, takerAcceptGate, applyIntentLanded, usesEscrowLock, assertSettleEligible } = await import('./escrow-landed-gate.mjs');
const { ensureIntent, recordIntentPhase, markIntent, getIntent, intentKeyFor } = await import('../lib/submit-intent.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const status = (id) => sqlite.prepare('SELECT protocol_status FROM exchange_offers WHERE id = ?').get(id).protocol_status;
const row = (id) => sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(id);
let n = 0;
function insertOffer(id, { status = 'open', meta = {}, prediction = true, escrow_p2sh = null, taker_lock = null } = {}) {
  sqlite.prepare(`INSERT INTO exchange_offers (id, broadcast_tx_id, give_asset, give_amount, want_asset, want_amount, maker, maker_relay_id, market_key, protocol_status, metadata, escrow_p2sh, taker_escrow_lock_tx)
                  VALUES (?, ?, ?, '1', 'KAS', '10', 'kaspa:qmaker', 'relay-maker', 'k', ?, ?, ?, ?)`)
    .run(id, `b${++n}`, prediction ? 'prediction_outcome_share' : 'USDT', status, JSON.stringify(meta), escrow_p2sh, taker_lock);
  return row(id);
}
const LOCK = 'e1'.padEnd(64, '1');

// ── negative: txid 返回但永不落链 ⇒ 下游价值动作全部不可达 ──
{
  insertOffer('n1', { meta: { escrow_lock_tx: LOCK, stake_locked_kas: 5 } });
  ensureIntent({ intentKind: 'escrow_lock', offerId: 'n1', relayId: 'r', targetAddress: 'kaspa:qescrow', amountKas: '5' });
  recordIntentPhase({ intentKey: intentKeyFor('escrow_lock', 'n1'), phase: 'submitted', txid: LOCK });   // submitted, 永不 landed
  transition('n1', 'matched', { taker: 'kaspa:qtaker' });
  ok(status('n1') === 'open' && row('n1').taker === null, 'negative: submitted-未落链 → matched 不可达(仍 open, taker 未写)');
  ok(!takerAcceptGate('n1').ok && /not landed/.test(takerAcceptGate('n1').reason), 'negative: taker 接受门拒(409 形)');
  ok(!assertSettleEligible(row('n1')).ok, 'negative: 无结算资格');
  // 即使有人把状态推进到了 verifying(直接 INSERT 模拟历史行), delivering/completed 仍不可达
  insertOffer('n2', { status: 'verifying', meta: { escrow_lock_tx: LOCK } });
  transition('n2', 'delivering');
  ok(status('n2') === 'verifying', 'negative: verifying→delivering 不可达(无对手方价值移动)');
  insertOffer('n3', { status: 'delivering', meta: { escrow_lock_tx: LOCK } });
  transition('n3', 'completed');
  ok(status('n3') === 'delivering', 'negative: delivering→completed 不可达(无声誉终态: paid 只在 completed 后)');
  // 退款/取消不拦
  transition('n3', 'refunded');
  ok(status('n3') === 'refunded', '退款不是对手方价值移动 → refunded 可达');
  transition('n1', 'cancelled');
  ok(status('n1') === 'cancelled', 'cancelled 可达');
}
// ── positive: 对账器把 intent landed 回填 ⇒ 门开 ──
{
  insertOffer('p1', { meta: { escrow_lock_tx: LOCK } });
  ensureIntent({ intentKind: 'escrow_lock', offerId: 'p1', relayId: 'r', targetAddress: 'kaspa:qescrow', amountKas: '5' });
  recordIntentPhase({ intentKey: intentKeyFor('escrow_lock', 'p1'), phase: 'submitted', txid: LOCK });
  const landed = markIntent(intentKeyFor('escrow_lock', 'p1'), { status: 'landed', landed_depth: 25, landed_at: new Date().toISOString() });
  const ap = applyIntentLanded(landed);
  ok(ap.applied && ap.column === 'escrow_landed' && row('p1').escrow_landed_at && row('p1').escrow_landed_depth === 25, 'applyIntentLanded: escrow_lock landed → escrow_landed_at/depth 回填');
  ok(!applyIntentLanded(landed).applied, 'applyIntentLanded 幂等(第二次不覆盖)');
  transition('p1', 'matched', { taker: 'kaspa:qtaker' });
  ok(status('p1') === 'matched' && takerAcceptGate('p1').ok, 'positive: 落链后 matched 可达, taker 门开');
  transition('p1', 'verifying'); transition('p1', 'delivering'); transition('p1', 'completed');
  ok(status('p1') === 'completed', 'positive: 无 taker 锁的 offer 落链后一路到 completed');
}
// ── taker 锁: maker 落了、taker 没落 ⇒ matched 可达(taker 门只看 maker), 但结算态不可达; taker 落了 ⇒ 可达 ──
{
  insertOffer('t1', { status: 'open_awaiting_taker_stake', meta: { escrow_lock_tx: LOCK }, escrow_p2sh: 'kaspa:qp2sh', taker_lock: 't1'.padEnd(64, 'a') });
  sqlite.prepare('UPDATE exchange_offers SET escrow_landed_at = ?, escrow_landed_depth = 22 WHERE id = ?').run(new Date().toISOString(), 't1');
  transition('t1', 'matched');
  ok(status('t1') === 'matched', 'taker 锁: maker 落 → matched 可达');
  transition('t1', 'verifying');
  ok(status('t1') === 'matched' && /taker escrow lock not landed/.test(escrowGateFor(row('t1'), 'verifying').reason), 'taker 锁未落 → verifying 不可达(无结算资格)');
  ensureIntent({ intentKind: 'taker_stake', offerId: 't1', relayId: 'r', targetAddress: 'kaspa:qp2sh', amountKas: '5' });
  recordIntentPhase({ intentKey: intentKeyFor('taker_stake', 't1'), phase: 'submitted', txid: 't1'.padEnd(64, 'a') });
  applyIntentLanded(markIntent(intentKeyFor('taker_stake', 't1'), { status: 'landed', landed_depth: 21, landed_at: new Date().toISOString() }));
  transition('t1', 'verifying');
  ok(status('t1') === 'verifying' && row('t1').taker_escrow_landed_depth === 21, 'taker 锁落 → verifying 可达');
}
// ── 非预测 offer / 无锁预测 offer 不受门约束 ──
{
  insertOffer('x1', { prediction: false });
  transition('x1', 'matched', { taker: 'kaspa:qt' });
  ok(status('x1') === 'matched' && !usesEscrowLock(row('x1')), '普通 exchange offer 不受门约束');
  insertOffer('x2', { meta: {} });
  transition('x2', 'matched', { taker: 'kaspa:qt' });
  ok(status('x2') === 'matched' && !usesEscrowLock(row('x2')), '无 escrow 锁的预测 offer(老路)不受门约束');
}
// ── harness 翻转臂 ──
{ const before = fails; insertOffer('h1', { meta: { escrow_lock_tx: LOCK } }); transition('h1', 'matched'); ok(status('h1') === 'matched', 'harness-flip (expect FAIL)'); if (fails === before + 1) { fails--; console.log('  ✅ harness flip arm went red as required'); } else { fails++; } }

console.log(fails ? `\n❌ ${fails} failure(s)` : '\n✅ all escrow-landed-gate vectors passed');
process.exit(fails ? 1 : 0);
