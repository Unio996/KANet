// windir-infer.test.mjs — 合卡 Fix-A 验收(J2 2026-07-12, 设计 docs/2026-07-12-bucketA-windir-backfill-
// and-unreachable-pregate-design.md §2/§4-1)。真函数(_inferWinDirectionFromChain/deriveResumePlanFromEvidence/
// compilePayoutShardRedeem 真编译)+ in-memory fixture。
// Run: cd kasia-console && node src/services/windir-infer.test.mjs
import Database from 'better-sqlite3';
import { blake2b } from '@noble/hashes/blake2b';
import { deriveResumePlanFromEvidence, _inferWinDirectionFromChain } from './bshard-auto-settler.mjs';
import { computePariMutuelPayout } from '../lib/pool-shard-settle.mjs';
import { payoutRoot as buildPayoutRoot } from '../lib/pool-payout-root.mjs';
import { compilePayoutShardRedeem } from '../lib/pool-shard-register.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pool_markets (id TEXT PRIMARY KEY, protocol_version TEXT, metadata TEXT, resolution_rule_spec TEXT, fee_rules TEXT);
    CREATE TABLE market_shards (logical_market_id TEXT, shard_market_id TEXT, shard_index INTEGER, status TEXT DEFAULT 'sealed');
    CREATE TABLE pool_bettor_sides (market_id TEXT, bettor_pk TEXT, stake_amount TEXT, direction INTEGER, side_lock_daa INTEGER, side_lock_tx TEXT);
    CREATE TABLE payout_shards (logical_market_id TEXT, pool_merkle_root TEXT, predicate_commit TEXT);
    CREATE TABLE kaspa_tx_log (tx_id TEXT PRIMARY KEY, outputs_json TEXT);
    CREATE TABLE events (id TEXT PRIMARY KEY, event_scope TEXT, event_type TEXT, source TEXT, level TEXT, summary TEXT, payload_json TEXT, created_at TEXT);
  `);
  return db;
}

const MID = 'ext-pool-v07-test-windir';
const SHARD = `${MID}-s0`;
const WINNER = { pk: 'aa'.repeat(32), stake: '2000000000', direction: 1 };
const LOSER = { pk: 'bb'.repeat(32), stake: '1000000000', direction: 0 };
const CLOSE_TXID = 'cc'.repeat(32);
const PMR = 'd1'.repeat(32);
const PC = 'd2'.repeat(32);
const SEED = 20000000;
// 测试用确定性 p2sh(推断只要求候选与链上地址同函数同 redeem 时相等——真 p2sh 派生非被测点)
const fakeP2sh = (redeemHex) => 'p2shtest:' + Buffer.from(blake2b(Buffer.from(String(redeemHex)), { dkLen: 20 })).toString('hex');

function seed(db, { metadata, chainAddrOverride = null, noTxLog = false, rrs = '{}' } = {}) {
  db.prepare('INSERT INTO pool_markets (id, protocol_version, metadata, resolution_rule_spec) VALUES (?,?,?,?)').run(MID, 'v0.7', JSON.stringify(metadata || {}), rrs);
  db.prepare('INSERT INTO market_shards (logical_market_id, shard_market_id, shard_index) VALUES (?,?,0)').run(MID, SHARD);
  for (const b of [WINNER, LOSER]) db.prepare('INSERT INTO pool_bettor_sides (market_id, bettor_pk, stake_amount, direction) VALUES (?,?,?,?)').run(SHARD, b.pk, b.stake, b.direction);
  db.prepare('INSERT INTO payout_shards (logical_market_id, pool_merkle_root, predicate_commit) VALUES (?,?,?)').run(MID, PMR, PC);
  if (!noTxLog) {
    // 链上 output0 地址 = 真编译 dir=1 候选 redeem 的地址(除非 override)
    const pm1 = computePariMutuelPayout({ bettors: [WINNER, LOSER].map(b => ({ pk: b.pk, stake: b.stake, direction: b.direction })), winningDirection: 1 });
    const root1 = buildPayoutRoot(pm1.payoutLeaves).toString('hex');
    const pool = (BigInt(WINNER.stake) + BigInt(LOSER.stake) + BigInt(SEED)).toString();
    const redeem1 = compilePayoutShardRedeem({ poolMerkleRoot: PMR, predicateCommit: PC, consolidatedPool: pool, closed: 1, payoutRoot: root1 });
    const addr = chainAddrOverride || fakeP2sh(redeem1);
    db.prepare('INSERT INTO kaspa_tx_log (tx_id, outputs_json) VALUES (?,?)').run(CLOSE_TXID, JSON.stringify([{ address: addr, amount: 1 }]));
  }
}
const mkCtx = (db) => ({ db, p2shAddr: fakeP2sh, psSeedSompi: SEED });

const EV_NO_DIR = { close_txid: CLOSE_TXID };   // 老版本 evidence 形状: 缺 win_direction 缺 winner_details(桶A 22 盘形)

console.log('[test] ① root-match 推断成功(链上 output0 == dir=1 候选地址):');
{
  const db = freshDb();
  seed(db, { metadata: { settle_evidence: EV_NO_DIR } });
  const r = deriveResumePlanFromEvidence(MID, mkCtx(db));
  ok(r.ok === true && r.winDir === 1, `推断 winDir=1, resume ok: ${JSON.stringify({ ok: r.ok, winDir: r.winDir })}`);
  const pm1 = computePariMutuelPayout({ bettors: [WINNER, LOSER].map(b => ({ pk: b.pk, stake: b.stake, direction: b.direction })), winningDirection: 1 });
  ok(r.payoutRoot === buildPayoutRoot(pm1.payoutLeaves).toString('hex'), 'payoutRoot == 链锚方向重算值');
  const back = JSON.parse(db.prepare('SELECT metadata FROM pool_markets WHERE id=?').get(MID).metadata);
  ok(back.settle_evidence.win_direction === 1, '回写 evidence.win_direction=1(json_set 单语句)');
  ok(db.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='backfill_windir_inferred'`).get().c === 1, '审计事件 backfill_windir_inferred 单发');
  // 幂等: 再跑一次不重写不炸
  const r2 = deriveResumePlanFromEvidence(MID, mkCtx(db));
  ok(r2.ok === true && r2.winDir === 1, '第二次直走快路(win_direction 已回补, 零推断)');
}

console.log('[test] ② zero-match(链上地址与两候选都不符)→ fail-closed + 漂移信号:');
{
  const db = freshDb();
  seed(db, { metadata: { settle_evidence: EV_NO_DIR }, chainAddrOverride: 'p2shtest:' + 'ff'.repeat(20) });
  const r = deriveResumePlanFromEvidence(MID, mkCtx(db));
  ok(r.ok === false && /零吻合/.test(r.reason), `fail-closed: ${r.reason.slice(0, 60)}`);
  ok(db.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='windir_infer_drift'`).get().c === 1, '漂移信号事件单独 event_type(不与 pre-gate 混桶, Bettor 注3)');
  const back = JSON.parse(db.prepare('SELECT metadata FROM pool_markets WHERE id=?').get(MID).metadata);
  ok(back.settle_evidence.win_direction === undefined, '零回写(fail-closed 不救不写)');
}

console.log('[test] ③ 链读靶缺(close_txid 不在 kaspa_tx_log)→ fail-closed 落 F3 账(非漂移):');
{
  const db = freshDb();
  seed(db, { metadata: { settle_evidence: EV_NO_DIR }, noTxLog: true });
  const r = deriveResumePlanFromEvidence(MID, mkCtx(db));
  ok(r.ok === false && /indexer 缺口/.test(r.reason), `fail-closed(F3 账): ${r.reason.slice(0, 60)}`);
  ok(db.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='windir_infer_drift'`).get().c === 0, '非漂移场景不发漂移信号(分桶准确)');
}

console.log('[test] ④ zk_native 市场拒推断(V1 redeem 布局专属):');
{
  const db = freshDb();
  seed(db, { metadata: { settle_evidence: EV_NO_DIR }, rrs: JSON.stringify({ zk_native: true }) });
  const r = deriveResumePlanFromEvidence(MID, mkCtx(db));
  ok(r.ok === false && /zk_native/.test(r.reason), 'zk 市场 fail-closed');
}

console.log('[test] ⑤ win_direction 有效时零推断(现状路径字节不动——与既有 settler test 互证):');
{
  const db = freshDb();
  const pm1 = computePariMutuelPayout({ bettors: [WINNER, LOSER].map(b => ({ pk: b.pk, stake: b.stake, direction: b.direction })), winningDirection: 1 });
  seed(db, { metadata: { settle_evidence: { close_txid: CLOSE_TXID, win_direction: 1, payout_root: buildPayoutRoot(pm1.payoutLeaves).toString('hex') } }, noTxLog: true });
  const r = deriveResumePlanFromEvidence(MID, mkCtx(db));   // noTxLog: 有效 win_direction 根本不该碰 tx_log
  ok(r.ok === true && r.winDir === 1, '有效 win_direction 直走现状路径(推断零触发, tx_log 缺也无妨)');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — Fix-A: root-match 链锚推断/回写幂等/零吻合漂移信号分桶/indexer 缺口 F3 账/zk 拒/现状路径零触'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
