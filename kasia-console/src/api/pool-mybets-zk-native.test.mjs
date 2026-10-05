// pool-mybets-zk-native.test.mjs — 账本1857: /api/pool/my-positions 对 ZK 原生盘的赢/输 + 到账(claim 落链后)。
// 真 migration 库 + 真 fastify route。赢向/叶子/到账全部来自 claim tick 同源(zk_continuation.attestedWinner / computePariMutuelPayout / zk_escape_audit)。
// Run: cd kasia-console && node src/api/pool-mybets-zk-native.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._ZKMB_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_zkmybets_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: {
      ...process.env, DB_PATH: tmpDb, _ZKMB_TEST_BOOTSTRAPPED: '1',
      // pool.js transitively imports rpc-health.js which fail-fasts at module load if these
      // are unset (2026-05-26 根治, no silent mainnet fallback) — this test never actually
      // opens an RPC connection, just needs the module to load.
      KASPA_RPC_URL: process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210',
      KASPA_NETWORK: process.env.KASPA_NETWORK || 'testnet-12',
    },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const Fastify = (await import('fastify')).default;
const { sqlite } = await import('../db/client.js');
const { registerPoolRoutes } = await import('./pool.js');
const kaspa = await import('kaspa-wasm');
const { randomUUID } = await import('node:crypto');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

sqlite.pragma('foreign_keys = OFF');

const app = Fastify({ logger: false });
await registerPoolRoutes(app);
await app.ready();

function seedLogicalMarket(id) {
  sqlite.prepare(`
    INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, created_at, updated_at, metadata)
    VALUES (?, 'test-relay', 'kaspatest:testp2sh', 'testhash', 9999999999, 'v0.7', 'completed', datetime('now'), datetime('now'), '{}')
  `).run(id);
}

const { computePariMutuelPayout, deriveSettlementFeeLeaves } = await import('../lib/pool-shard-settle.mjs');
const rnd = () => (randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')).slice(0, 64);
function addrAndPk() {
  const priv = new kaspa.PrivateKey(rnd());
  const addr = priv.toKeypair().toAddress('testnet-12').toString();
  return { addr, pk: kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(addr)).toString() };
}
const A = addrAndPk(), B = addrAndPk(), BROKER = addrAndPk();
const logicalId = `zkmb-${randomUUID().slice(0, 6)}`, shardId = `${logicalId}-s0`;
const spec = JSON.stringify({ title: 'zk native', zk_native: true });
sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, created_at, updated_at, metadata, resolution_rule_spec, broker_pk, broker_fee_pct)
  VALUES (?, 'r', NULL, 'h', 9999999999, 'v0.7', 'attested_v2', datetime('now'), datetime('now'), '{}', ?, ?, 190)`).run(logicalId, spec, BROKER.pk);
sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, created_at, updated_at) VALUES (?, 'r', NULL, 'h', 9999999999, 'v0.7', 'shard_internal', datetime('now'), datetime('now'))`).run(shardId);
sqlite.prepare(`INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, status, created_at) VALUES (?, 0, ?, 'kaspatest:s', 'settled', datetime('now'))`).run(logicalId, shardId);
const side = (pk, dir, stake) => sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`).run(shardId, pk, dir, stake, 'kaspatest:p' + rnd().slice(0, 6), rnd());
side(A.pk, 0, 1000); side(B.pk, 1, 2000);
const setMeta = (m) => sqlite.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run(JSON.stringify(m), logicalId);
const get = async (addr) => JSON.parse((await app.inject({ method: 'GET', url: `/api/pool/my-positions?linked_addr=${encodeURIComponent(addr)}` })).payload).positions.find((p) => p.market_id === shardId);
const POOL = '3000';
const { feeLeaves } = deriveSettlementFeeLeaves({ brokerPk: BROKER.pk, brokerFeePctBps: 190 }, POOL);
const pm = computePariMutuelPayout({ bettors: [{ pk: A.pk, stake: 1000, direction: 0 }, { pk: B.pk, stake: 2000, direction: 1 }], winningDirection: 0, poolTotalSompi: POOL, feeLeaves });
const aLeaf = pm.payoutLeaves.findIndex((l) => l.pk === A.pk); const aAmt = BigInt(pm.payoutLeaves[aLeaf].amount);
const zcBase = { outpoint: { txid: rnd(), index: 0 }, redeemHex: 'aa', valueSompi: POOL, attestedWinner: 0, attestedAtMs: 1, proving: { status: 'ready' } };

console.log('[test] ZK 原生盘 my-positions');
setMeta({ zk_continuation: { ...zcBase } });   // attest 后、zk_close 前: 赢向已知, 池快照未 stamp
{
  const a = await get(A.addr), b = await get(B.addr);
  ok(a.logical_market_id === logicalId && b.logical_market_id === logicalId, '输出带 logical_market_id(=逻辑盘 id, 不是 shard id)');
  ok(a.zk_native === true && a.did_win === true && a.outcome_winner === 0 && a.outcome_side === 'YES', 'attest 后: 赢家 did_win=true, outcome=YES(无 settle_evidence 也成立)');
  ok(a.actual_payout_kas === null && a.actual_payout_chain_verified === false && a.pool_known === false, 'zk_close 前: 金额未知 ⇒ actual null(不猜)');
  ok(b.did_win === false && b.outcome_winner === 0 && b.actual_payout_kas === null, '输家 did_win=false');
}
setMeta({ zk_continuation: { ...zcBase, poolAtZkCloseSompi: POOL } });   // zk_close 后、claim 前
{
  const a = await get(A.addr);
  ok(a.did_win === true && a.actual_payout_kas === null && a.payout_pending_units === aAmt.toString() && a.claims_landed === 0, `claim 前: 待领 ${aAmt} 筹码(叶子取自 computePariMutuelPayout 同源), actual 仍 null`);
}
{
  const txs = Array.from({ length: pm.payoutLeaves.length }, () => rnd());
  setMeta({ zk_continuation: { ...zcBase, poolAtZkCloseSompi: POOL }, zk_escape_audit: txs.slice(0, aLeaf + 1).map((t) => ({ entry: 'claim', txid: t })) });
  const a = await get(A.addr), b = await get(B.addr);
  ok(a.actual_payout_units === aAmt.toString() && Math.abs(a.actual_payout_kas - Number(aAmt) / 1e8) < 1e-18 && a.actual_payout_chain_verified === true && a.bshard_claim_txid === txs[aLeaf] && a.payout_pending_units === '0', `claim 落链后: 赢 ${aAmt} 筹码, chain_verified=true, 带该笔 claim txid`);
  ok(b.did_win === false && b.actual_payout_kas === null, '输家仍是输, 无金额');
}
// 回归: 非 ZK(带 settle_evidence)盘不受影响
{
  setMeta({ settle_evidence: { winner_details: [{ pk: A.pk, amount: 777, txId: rnd() }], win_direction: 0, complete: true, chain_settled: true } });
  const a = await get(A.addr);
  ok(a.did_win === true && a.zk_native === undefined && Math.abs(a.actual_payout_kas - 777 / 1e8) < 1e-18, '回归: settle_evidence 路径照旧(无 zk_native 字段)');
}
// 账本1865: 判决已定但无赢家(completed + metadata.no_winners): 每个持仓都是输, 每行带 no_winners:true; 其它盘的行 no_winners:false
console.log('[test] 无赢家盘(账本1865)');
{
  const a0 = await get(A.addr);
  ok(a0.no_winners === false, '回归: 普通盘的行 no_winners===false(键恒在)');
  sqlite.prepare('UPDATE pool_bettor_sides SET direction = 0 WHERE bettor_pk = ?').run(B.pk);   // 全体押 YES(方向 0)
  sqlite.prepare("UPDATE pool_markets SET protocol_status = 'completed' WHERE id = ?").run(logicalId);
  setMeta({ no_winners: true, judged_winner: 1, judged_at: '2026-10-05T15:00:00.000Z', no_winners_source: { type: 'polymarket', condition_id: '0x' + 'ab'.repeat(32) } });
  const a = await get(A.addr), b = await get(B.addr);
  ok(a.no_winners === true && b.no_winners === true, '无赢家盘: 每行 no_winners===true');
  ok(a.did_win === false && b.did_win === false && a.outcome_winner === 1 && b.outcome_winner === 1, '每个持仓都是输(did_win=false), outcome_winner=judged_winner(NO)');
  ok(a.zk_native === true && a.claims_landed === 0 && a.actual_payout_kas === null && a.payout_pending_units === null, '无 claim、无金额、无待领');
  // judged_winner 缺失 ⇒ 不进该分支(不乱判)
  setMeta({ no_winners: true });
  const c = await get(A.addr);
  ok(c.no_winners === false && c.did_win !== true, 'no_winners 但 judged_winner 缺失 ⇒ 不进该分支(no_winners 键 false, 不猜)');
}
console.log(fails ?`\n${fails} FAIL` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
