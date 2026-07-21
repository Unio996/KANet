// pool-mybets-h2-split.test.mjs — H2 regression (2026-07-17, docs/2026-07-17-h2-mybets-multiwin-split-design.md
// v1.1, NWT GREEN 12cce211). 真 migration 库 + 真 fastify route(registerPoolRoutes + inject, 非复刻/非 mock
// 计算) — 覆盖 /api/pool/my-positions 对同 bettor 跨分片(同逻辑市场)多笔赢单的拆分正确性 + 对冲 bettor
// (同 pk 双向下注)不误判赢/不吃错方向份额。
// Run: cd kasia-console && node src/api/pool-mybets-h2-split.test.mjs   (自举同 pool-bettor-refund-claim.test.mjs)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._H2_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_h2split_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: {
      ...process.env, DB_PATH: tmpDb, _H2_TEST_BOOTSTRAPPED: '1',
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
function seedShard(logicalId, shardId, index) {
  sqlite.prepare(`
    INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, created_at, updated_at)
    VALUES (?, 'test-relay', ?, 'testhash', 9999999999, 'v0.7', 'shard_internal', datetime('now'), datetime('now'))
  `).run(shardId, `kaspatest:shardp2sh${index}`);
  sqlite.prepare(`
    INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, status, created_at)
    VALUES (?, ?, ?, ?, 'settled', datetime('now'))
  `).run(logicalId, index, shardId, `kaspatest:shardp2sh${index}`);
}
function seedSide(shardId, bettorPk, direction, stakeAmount) {
  const r = sqlite.prepare(`
    INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(shardId, bettorPk, direction, stakeAmount, `kaspatest:sidep2sh-${randomUUID().slice(0, 6)}`,
    (randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')).slice(0, 64));
  return r.lastInsertRowid;
}
function setEvidence(logicalId, winnerDetails, winDirection) {
  sqlite.prepare(`UPDATE pool_markets SET metadata = ? WHERE id = ?`).run(
    JSON.stringify({ settle_evidence: { winner_details: winnerDetails, win_direction: winDirection, complete: true, chain_settled: true } }),
    logicalId
  );
}
function addrAndPk() {
  const priv = new kaspa.PrivateKey(randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64));
  const addr = priv.toKeypair().toAddress('testnet-12').toString();
  const pk = kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(addr)).toString();
  return { addr, pk };
}
async function myPositions(addr) {
  const res = await app.inject({ method: 'GET', url: `/api/pool/my-positions?linked_addr=${encodeURIComponent(addr)}` });
  return JSON.parse(res.payload);
}

console.log('[test] case A — bettor wins across 2 shards of the same logical market, same direction:');
{
  const logicalId = `h2test-a-${randomUUID().slice(0, 6)}`;
  const shard0 = `${logicalId}-s0`, shard1 = `${logicalId}-s1`;
  seedLogicalMarket(logicalId);
  seedShard(logicalId, shard0, 0);
  seedShard(logicalId, shard1, 1);
  const { addr, pk } = addrAndPk();
  seedSide(shard0, pk, 0, 500_000_000);   // 5 KAS
  seedSide(shard1, pk, 0, 300_000_000);   // 3 KAS
  const txId = (randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')).slice(0, 64);
  setEvidence(logicalId, [{ pk, amount: 1_600_000_000, txId }], 0);   // 16 KAS total, stake ratio 5:3

  const body = await myPositions(addr);
  const rows = body.positions.filter(p => p.market_id === shard0 || p.market_id === shard1);
  ok(rows.length === 2, 'both shard rows present');
  ok(rows.every(p => p.did_win === true), 'both rows marked did_win=true');
  const sum = rows.reduce((s, p) => s + p.actual_payout_kas, 0);
  ok(Math.abs(sum - 16) < 1e-9, `sum(actual_payout_kas) === 16 exactly (got ${sum})`);
  const s0 = rows.find(p => p.market_id === shard0), s1 = rows.find(p => p.market_id === shard1);
  ok(Math.abs(s0.actual_payout_kas - 10) < 1e-9, `shard0 (5/8 stake) gets 10 KAS (got ${s0.actual_payout_kas})`);
  ok(Math.abs(s1.actual_payout_kas - 6) < 1e-9, `shard1 (3/8 stake) gets 6 KAS (got ${s1.actual_payout_kas})`);
  ok(rows.every(p => p.bshard_claim_txid === txId), 'both rows point at the same real claim txId');
}

console.log('[test] case A2 — indivisible split (remainder distributed by side_id ASC, sum still exact):');
{
  const logicalId = `h2test-a2-${randomUUID().slice(0, 6)}`;
  const shard0 = `${logicalId}-s0`, shard1 = `${logicalId}-s1`, shard2 = `${logicalId}-s2`;
  seedLogicalMarket(logicalId);
  seedShard(logicalId, shard0, 0); seedShard(logicalId, shard1, 1); seedShard(logicalId, shard2, 2);
  const { addr, pk } = addrAndPk();
  seedSide(shard0, pk, 0, 1); seedSide(shard1, pk, 0, 1); seedSide(shard2, pk, 0, 1);   // equal stake, 3-way
  const txId = (randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')).slice(0, 64);
  setEvidence(logicalId, [{ pk, amount: 100, txId }], 0);   // 100 / 3 = 33.33... sompi, indivisible

  const body = await myPositions(addr);
  const rows = body.positions.filter(p => [shard0, shard1, shard2].includes(p.market_id));
  const sumSompi = Math.round(rows.reduce((s, p) => s + p.actual_payout_kas, 0) * 1e8);
  ok(sumSompi === 100, `sum exactly 100 sompi despite indivisible split (got ${sumSompi})`);
}

console.log('[test] case A3 — BigInt precision (MUST-FIX, NWT 12cce211): 17613.9 KAS-scale amount, no silent floating-point corruption:');
{
  const logicalId = `h2test-a3-${randomUUID().slice(0, 6)}`;
  const shard0 = `${logicalId}-s0`, shard1 = `${logicalId}-s1`;
  seedLogicalMarket(logicalId);
  seedShard(logicalId, shard0, 0); seedShard(logicalId, shard1, 1);
  const { addr, pk } = addrAndPk();
  const stake0 = 60_000_000_000_000n, stake1 = 40_000_000_000_000n;   // 600,000 / 400,000 KAS — far past 2^53 when multiplied together
  seedSide(shard0, pk, 0, Number(stake0)); seedSide(shard1, pk, 0, Number(stake1));
  const txId = (randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')).slice(0, 64);
  const totalAmount = 1_761_390_000_000_000n;   // ~17,613,900 KAS-scale
  setEvidence(logicalId, [{ pk, amount: totalAmount.toString(), txId }], 0);

  const body = await myPositions(addr);
  const rows = body.positions.filter(p => p.market_id === shard0 || p.market_id === shard1);
  const sumSompi = BigInt(Math.round(rows.reduce((s, p) => s + p.actual_payout_kas, 0) * 1e8));
  // exact BigInt expected split (mirrors production splitWinnerAmountByStake logic)
  const groupTotal = stake0 + stake1;
  const expected0 = (totalAmount * stake0) / groupTotal;
  const expected1 = totalAmount - expected0;
  const s0 = rows.find(p => p.market_id === shard0), s1 = rows.find(p => p.market_id === shard1);
  ok(BigInt(Math.round(s0.actual_payout_kas * 1e8)) === expected0, `shard0 exact BigInt split (expected ${expected0})`);
  ok(BigInt(Math.round(s1.actual_payout_kas * 1e8)) === expected1, `shard1 exact BigInt split (expected ${expected1})`);
  ok(sumSompi === totalAmount, `sum exactly equals totalAmount at 17M-KAS scale (no float precision loss, got ${sumSompi} vs ${totalAmount})`);
}

console.log('[test] case B — hedge bettor (same pk bets BOTH directions), losing-direction row must not claim a share:');
{
  const logicalId = `h2test-b-${randomUUID().slice(0, 6)}`;
  const shard0 = `${logicalId}-s0`, shard1 = `${logicalId}-s1`, shard2 = `${logicalId}-s2`;
  seedLogicalMarket(logicalId);
  seedShard(logicalId, shard0, 0); seedShard(logicalId, shard1, 1); seedShard(logicalId, shard2, 2);
  const { addr, pk } = addrAndPk();
  seedSide(shard0, pk, 0, 500_000_000);   // YES, winning direction, 2 shards
  seedSide(shard1, pk, 0, 300_000_000);   // YES, winning direction
  seedSide(shard2, pk, 1, 400_000_000);   // NO, losing direction (hedge)
  const txId = (randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')).slice(0, 64);
  setEvidence(logicalId, [{ pk, amount: 1_600_000_000, txId }], 0);   // win_direction = 0 (YES)

  const body = await myPositions(addr);
  const rows = body.positions.filter(p => [shard0, shard1, shard2].includes(p.market_id));
  const winRows = rows.filter(p => p.did_win === true);
  const loseRow = rows.find(p => p.market_id === shard2);
  ok(winRows.length === 2, `only the 2 YES rows marked did_win=true (got ${winRows.length})`);
  ok(loseRow?.did_win === false, 'NO (hedge) row marked did_win=false, not misjudged as a win');
  ok(loseRow?.actual_payout_kas == null, 'NO row claims zero share of the YES payout');
  const winSum = winRows.reduce((s, p) => s + p.actual_payout_kas, 0);
  ok(Math.abs(winSum - 16) < 1e-9, `YES-side sum still exactly 16 KAS, not diluted by the hedge row (got ${winSum})`);
}

console.log('[test] backward-compat — single winning row (the common, pre-H2 case) unaffected:');
{
  const logicalId = `h2test-compat-${randomUUID().slice(0, 6)}`;
  const shard0 = `${logicalId}-s0`;
  seedLogicalMarket(logicalId);
  seedShard(logicalId, shard0, 0);
  const { addr, pk } = addrAndPk();
  seedSide(shard0, pk, 0, 500_000_000);
  const txId = (randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')).slice(0, 64);
  setEvidence(logicalId, [{ pk, amount: 1_000_000_000, txId }], 0);

  const body = await myPositions(addr);
  const row = body.positions.find(p => p.market_id === shard0);
  ok(row?.did_win === true && Math.abs(row.actual_payout_kas - 10) < 1e-9, `single row gets the full 10 KAS unchanged (got ${row?.actual_payout_kas})`);
}

await app.close();
console.log(fails === 0 ? '\n[test] ALL PASS' : `\n[test] ${fails} FAILURE(S)`);
// process.exit() here races a libuv async-handle teardown from the fastify instance (native
// assertion crash after the harness already recorded PASS/FAIL) — set exitCode and let node
// drain the loop naturally instead of forcing an abrupt exit.
process.exitCode = fails === 0 ? 0 : 1;
