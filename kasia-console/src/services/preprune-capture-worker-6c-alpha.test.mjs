// preprune-capture-worker-6c-alpha.test.mjs — P2-6c α regression (J2 2026-09-06, 设计
// docs/2026-09-06-j2-p2-6c-preprune-worker-loop-unit-and-unrecoverable-predicate-design-v0.1.md v0.1.2 §3.3/§3.4, NWT α GREEN, Bettor 959)。
// 真 migration 临时库(同 trade-protocol-filter.capture-gate.test.mjs 自举惯例) + 真 captureSideLockDaa / recaptureSideLockDaaForMarket / _tick(非复刻), 离线: 不连 kaspad、不连 relay。
// 守什么:
//   A1 _walkIsFutile 纯判据: hint < tip − 2,480,000 − 1,000 才 futile; 边界不 futile; null 不 futile
//   A2 α-1 放宽锚点: spc_daa_index 有 daa ≥ hint 的行、coverage 不命中、差 ≤ 10,000 ⇒ 从它起走(anchorSource=index-nocoverage), 不从 tip 走(getBlockDagInfo 0 次)
//   A3 放宽锚点差 > 10,000 ⇒ 不用(anchorSource=tip, 走 sink)
//   A4 α-2 walk-futile: 无锚点且 hint 远在 tip 回溯界之外 ⇒ reason/skipped='walk-futile', anchorSource=none, getBlock 0 次, 【不标记】(unreachable 集合不变, 第二次照样进来)
//   A5 放宽锚点已剪(第 0 步 cannot find header 且 anchor.daa < 剪裁点) ⇒ 既有 anchor-pruned 逻辑照旧触发 + 标记
//   A6 recaptureSideLockDaaForMarket 直方图: reasons 按族名归并('rpc-fail: …' ⇒ 'rpc-fail'), anchorSources 计数, 旧字段 recaptured/remaining 不变
//   A7 worker 循环单位 = 逻辑盘: 2 分片同一逻辑盘 + 1 非 bshard 盘 + 1 终态盘 + 1 孤儿分片 ⇒ scanned=2 shards=3, fake recapture 恰被 S1/S2/N 各调 1 次, 终态/孤儿 0 次; 不可恢复判据用分片 remaining 之和(stillNullCount=2); 标后下 tick 跳过
// Run: cd kasia-console && node src/services/preprune-capture-worker-6c-alpha.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._ALPHA_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_6calpha_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _ALPHA_TEST_BOOTSTRAPPED: '1', KASPA_RPC_URL: 'ws://127.0.0.1:1', PREPRUNE_CAPTURE_WORKER: '' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { randomUUID } = await import('node:crypto');
const tpf = await import('./trade-protocol-filter.js');
const { captureSideLockDaa, _walkIsFutile, _captureUnreachableState, _resetCaptureUnreachable, CAPTURE_WALK_REACH_MAX_DAA, CAPTURE_WALK_SLACK_DAA, CAPTURE_ANCHOR_MAX_AHEAD_DAA } = tpf;
const { recaptureSideLockDaaForMarket } = await import('./pool-market-settler-v06.mjs');
const worker = await import('./preprune-capture-worker.mjs');
const { _tick, _listLogicalMarketsWithNullSides, _resetUnrecoverableSet, _unrecoverableSetSize, TERMINAL_STATUSES } = worker;
const RPC_URL = 'ws://127.0.0.1:1';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const SYNCED = { synced: true, isSynced: true, reason: 'ok' };
sqlite.pragma('foreign_keys = OFF');

const TIP = 'cd'.repeat(32);
function fakeRpcFactory({ notFound = [], headerDaa = 80_000_000, tipDaa = 80_000_500, txAtHash = {} } = {}) {
  const st = { ctor: 0, getBlock: 0, dagInfo: 0, blocks: [] };
  class FakeRpc {
    constructor() { st.ctor++; }
    async connect() {}
    async disconnect() {}
    async getBlockDagInfo() { st.dagInfo++; return { sink: TIP, pruningPointHash: 'pp'.repeat(16), virtualDaaScore: BigInt(tipDaa) }; }
    async getBlock({ hash }) {
      st.getBlock++; st.blocks.push(hash);
      if (notFound.includes(hash)) throw new Error(`RPC Server (remote error) -> cannot find header ${hash}`);
      const txs = txAtHash[hash] ? [{ verboseData: { transactionId: txAtHash[hash] } }] : [];
      return { block: { header: { daaScore: BigInt(headerDaa) }, transactions: txs, verboseData: { selectedParentHash: '0'.repeat(64) } } };
    }
  }
  return { st, FakeRpc };
}
const base = { side_p2sh: 'kaspatest:qq', stake_amount: 100, network: 'testnet-12' };
const idx = (hash, daa) => sqlite.prepare('INSERT OR REPLACE INTO spc_daa_index (block_hash, daa_score, timestamp_ms) VALUES (?, ?, ?)').run(hash, daa, 1_780_000_000_000);

console.log('[A1] _walkIsFutile 纯判据:');
{
  const tip = 80_000_500;
  const edge = tip - CAPTURE_WALK_REACH_MAX_DAA - CAPTURE_WALK_SLACK_DAA;   // 严格小于才 futile
  ok(CAPTURE_WALK_REACH_MAX_DAA === 2_480_000 && CAPTURE_WALK_SLACK_DAA === 1000 && CAPTURE_ANCHOR_MAX_AHEAD_DAA === 10_000, `常量 = 设计 v0.1.2 (R_max ${CAPTURE_WALK_REACH_MAX_DAA}, slack ${CAPTURE_WALK_SLACK_DAA}, D_anchor ${CAPTURE_ANCHOR_MAX_AHEAD_DAA})`);
  ok(_walkIsFutile(edge - 1, tip) === true, 'hint = 界−1 ⇒ futile');
  ok(_walkIsFutile(edge, tip) === false, 'hint = 界 ⇒ 不 futile(严格 <)');
  ok(_walkIsFutile(tip - 100, tip) === false, 'hint 贴近 tip ⇒ 不 futile');
  ok(_walkIsFutile(null, tip) === false && _walkIsFutile(1, null) === false && _walkIsFutile('x', tip) === false, 'hint/tip 缺失或非数 ⇒ 不 futile(保守: 照旧走)');
}

console.log('[A2] α-1 放宽锚点(coverage 不命中, 差 ≤ 10,000) ⇒ 从索引块起走, 不从 tip 走:');
{
  _resetCaptureUnreachable();
  const A = 'a2'.repeat(32), TX = 'e2'.repeat(32);
  idx(A, 70_000_500);                        // hint 70,000,000, 差 500, coverage 表对 70M 无区间
  const { st, FakeRpc } = fakeRpcFactory({ headerDaa: 69_999_900, txAtHash: { [A]: TX } });
  const r = await captureSideLockDaa({ ...base, side_lock_tx: TX, approxDaaHint: 70_000_000 }, { isNodeSynced: async () => SYNCED, RpcClientCtor: FakeRpc, rpcUrl: RPC_URL, pruningDaaFn: async () => 60_000_000 });
  ok(r.reason === 'ok' && r.daa === 69_999_900, `reason=ok daa=69,999,900 (got ${JSON.stringify(r)})`);
  ok(r.anchorSource === 'index-nocoverage', `anchorSource=index-nocoverage (got ${r.anchorSource})`);
  ok(st.blocks[0] === A && !st.blocks.includes(TIP) && st.getBlock === 1, `首块 = 索引锚点, 未走 sink(finality 门那次 getBlockDagInfo 照旧, 不算走 tip) (first=${String(st.blocks[0]).slice(0, 6)}, getBlock=${st.getBlock}, dagInfo=${st.dagInfo})`);
}

console.log('[A3] 放宽锚点差 > 10,000 ⇒ 不用, 退回 tip:');
{
  _resetCaptureUnreachable();
  const A = 'a3'.repeat(32), TX = 'e3'.repeat(32);
  idx(A, 72_010_001);                        // hint 72,000,000, 差 10,001
  const { st, FakeRpc } = fakeRpcFactory({ tipDaa: 72_500_000 });   // tip 与 hint 差 0.5M < 界 ⇒ 不 futile
  const r = await captureSideLockDaa({ ...base, side_lock_tx: TX, approxDaaHint: 72_000_000 }, { isNodeSynced: async () => SYNCED, RpcClientCtor: FakeRpc, rpcUrl: RPC_URL, pruningDaaFn: async () => 60_000_000 });
  ok(r.reason === 'no-block-hash' && r.anchorSource === 'tip', `reason=no-block-hash anchorSource=tip (got ${JSON.stringify(r)})`);
  ok(st.dagInfo === 1 && st.blocks[0] === TIP, `从 sink 走 (dagInfo=${st.dagInfo}, first=${String(st.blocks[0]).slice(0, 6)})`);
}

console.log('[A4] α-2 walk-futile: 无锚点且 hint 远在 tip 回溯界之外 ⇒ 不走、不标:');
{
  _resetCaptureUnreachable();
  const TX = 'e4'.repeat(32);
  const { st, FakeRpc } = fakeRpcFactory({ tipDaa: 80_000_500 });   // 索引里无 ≥ 10M 且 ≤ 10M+10k 的行(前面插的都 ≥ 70M, 差 > 10k)
  const deps = { isNodeSynced: async () => SYNCED, RpcClientCtor: FakeRpc, rpcUrl: RPC_URL, pruningDaaFn: async () => 60_000_000 };
  const r = await captureSideLockDaa({ ...base, side_lock_tx: TX, approxDaaHint: 10_000_000 }, deps);
  ok(r.daa === null && r.reason === 'walk-futile' && r.skipped === 'walk-futile' && r.anchorSource === 'none', `reason/skipped=walk-futile anchorSource=none (got ${JSON.stringify(r)})`);
  ok(st.getBlock === 0 && st.dagInfo === 1, `getBlock 0 次(只读了一次 dagInfo) (getBlock=${st.getBlock}, dagInfo=${st.dagInfo})`);
  const s = _captureUnreachableState();
  ok(s.anchors.size === 0 && s.txs.size === 0, `不标记: unreachable anchors=${s.anchors.size} txs=${s.txs.size}`);
  const r2 = await captureSideLockDaa({ ...base, side_lock_tx: TX, approxDaaHint: 10_000_000 }, deps);
  ok(r2.reason === 'walk-futile' && st.ctor === 2, `第二次照样进来重判(非 cached 形) (reason=${r2.reason}, ctor=${st.ctor})`);
  // 同 hint 但 tip 近 ⇒ 不 futile, 正常从 sink 走
  const { st: st2, FakeRpc: F2 } = fakeRpcFactory({ tipDaa: 10_500_000 });
  const r3 = await captureSideLockDaa({ ...base, side_lock_tx: 'e5'.repeat(32), approxDaaHint: 10_000_000 }, { ...deps, RpcClientCtor: F2 });
  ok(r3.reason === 'no-block-hash' && r3.anchorSource === 'tip' && st2.getBlock === 1, `tip 近 ⇒ 照旧走 sink (got ${JSON.stringify(r3)}, getBlock=${st2.getBlock})`);
}

console.log('[A5] 放宽锚点已剪(第 0 步 cannot find header, anchor.daa < 剪裁点) ⇒ 既有 anchor-pruned 逻辑照旧 + 标记:');
{
  _resetCaptureUnreachable();
  const A = 'a5'.repeat(32), TX = 'e6'.repeat(32);
  idx(A, 74_000_100);                        // hint 74,000,000, 无 coverage
  const { st, FakeRpc } = fakeRpcFactory({ notFound: [A] });
  const deps = { isNodeSynced: async () => SYNCED, RpcClientCtor: FakeRpc, rpcUrl: RPC_URL, pruningDaaFn: async () => 75_000_000 };
  const r = await captureSideLockDaa({ ...base, side_lock_tx: TX, approxDaaHint: 74_000_000 }, deps);
  ok(r.reason === 'anchor-pruned' && r.skipped === 'anchor-pruned' && r.anchorSource === 'index-nocoverage', `anchor-pruned via 放宽锚点 (got ${JSON.stringify(r)})`);
  ok(st.getBlock === 1 && _captureUnreachableState().anchors.has(A), `一次取块失败即标记 (getBlock=${st.getBlock})`);
  const r2 = await captureSideLockDaa({ ...base, side_lock_tx: TX, approxDaaHint: 74_000_000 }, deps);
  ok(r2.reason === 'anchor-pruned(cached)' && st.ctor === 1, `第二次 cached, 不构造 (reason=${r2.reason}, ctor=${st.ctor})`);
}

console.log('[A6] recaptureSideLockDaaForMarket 直方图(reasons 族名归并 / anchorSources), 旧字段不变:');
{
  _resetCaptureUnreachable();
  const M = `alpha6-${randomUUID().slice(0, 6)}`;
  sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, deadline_daa, protocol_version, protocol_status, created_at, updated_at)
    VALUES (?, 'r', 'kaspatest:x', 'h', 999999999, ?, 'v0.7', 'verifying', datetime('now'), datetime('now'))`).run(M, 10_000_000);
  const ins = sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, side_lock_daa, created_at) VALUES (?, ?, 0, 100, 'p', ?, NULL, datetime('now'))`);
  ins.run(M, '61'.repeat(32), 'f1'.repeat(32)); ins.run(M, '62'.repeat(32), 'f2'.repeat(32)); ins.run(M, '63'.repeat(32), 'f3'.repeat(32));
  // 三行: 前两行 walk-futile(tip 远), 第三行让 getBlockDagInfo 抛 ⇒ 'rpc-fail: …' 归 'rpc-fail'
  let calls = 0;
  const { FakeRpc } = fakeRpcFactory({ tipDaa: 80_000_500 });
  class F3 extends FakeRpc { async getBlockDagInfo() { calls++; if (calls === 3) throw new Error('boom'); return super.getBlockDagInfo(); } }
  const rc = await recaptureSideLockDaaForMarket(M, { isNodeSynced: async () => SYNCED, RpcClientCtor: F3, rpcUrl: RPC_URL, pruningDaaFn: async () => 60_000_000 });
  ok(rc.recaptured === 0 && rc.remaining === 3, `recaptured=0 remaining=3 (got ${JSON.stringify(rc)})`);
  ok(rc.reasons && rc.reasons['walk-futile'] === 2 && rc.reasons['rpc-fail'] === 1 && Object.keys(rc.reasons).length === 2, `reasons={walk-futile:2, rpc-fail:1} 族名归并 (got ${JSON.stringify(rc.reasons)})`);
  ok(rc.anchorSources && rc.anchorSources.none === 2 && Object.keys(rc.anchorSources).length === 1, `anchorSources={none:2}(rpc-fail 那行在 anchorSource 定型前抛, 不计) (got ${JSON.stringify(rc.anchorSources)})`);
  const empty = await recaptureSideLockDaaForMarket(`nope-${randomUUID().slice(0, 6)}`);
  ok(empty.recaptured === 0 && empty.remaining === 0 && empty.reasons && Object.keys(empty.reasons).length === 0, `无 NULL 行 ⇒ {0,0,{},{}} (got ${JSON.stringify(empty)})`);
}

console.log('[A7] worker 循环单位 = 逻辑盘(2 分片 + 非 bshard + 终态 + 孤儿), 不可恢复判据用分片 remaining 之和, 标后跳过:');
{
  _resetUnrecoverableSet();
  const sfx = randomUUID().slice(0, 6);
  const L = `alpha7-L-${sfx}`, S1 = `${L}-s0`, S2 = `${L}-s1`, N = `alpha7-N-${sfx}`, T = `alpha7-T-${sfx}`, O = `alpha7-orphan-${sfx}`;
  const mk = sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, deadline_daa, protocol_version, protocol_status, created_at, updated_at)
    VALUES (?, 'r', 'kaspatest:x', 'h', 999999999, ?, 'v0.7', ?, datetime('now'), datetime('now'))`);
  mk.run(L, 1_000_000, 'verifying'); mk.run(S1, 1_000_000, 'open'); mk.run(S2, 1_000_000, 'open'); mk.run(N, 90_000_000, 'verifying'); mk.run(T, 1_000_000, 'zk_settled');
  const sh = sqlite.prepare(`INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, created_at) VALUES (?, ?, ?, 'kaspatest:s', 0)`);
  sh.run(L, 0, S1); sh.run(L, 1, S2);
  const ins = sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, side_lock_daa, created_at) VALUES (?, ?, 0, 100, 'p', ?, NULL, datetime('now'))`);
  for (const [m, i] of [[S1, 1], [S2, 2], [N, 3], [T, 4], [O, 5]]) ins.run(m, `7${i}`.repeat(32), `7${i}`.repeat(32));
  sqlite.prepare('INSERT OR REPLACE INTO spc_daa_index_coverage (start_daa, end_daa) VALUES (?, ?)').run(50_000_000, 95_000_000);   // floor 50M: L(1M) 在 floor 之下 ⇒ 可标; N(90M) 不标

  const groups = _listLogicalMarketsWithNullSides();
  const gL = groups.find(g => g.logicalMarket.id === L), gN = groups.find(g => g.logicalMarket.id === N);
  ok(groups.every(g => !TERMINAL_STATUSES.has(g.logicalMarket.protocol_status)), 'SQL 侧剔终态');
  ok(gL && gL.shardIds.length === 2 && gL.shardIds.includes(S1) && gL.shardIds.includes(S2), `L 归组 2 分片 (got ${JSON.stringify(gL?.shardIds)})`);
  ok(gN && gN.shardIds.length === 1 && gN.shardIds[0] === N, 'N(非 bshard) 分片 = 自身');
  ok(!groups.some(g => g.logicalMarket.id === T) && !groups.some(g => g.shardIds.includes(O)), '终态 T 与孤儿 O 不在组里');

  const called = [];
  const fakeRecapture = async (marketId) => { called.push(marketId); return { recaptured: 0, remaining: 1, reasons: { 'walk-futile': 1 }, anchorSources: { none: 1 } }; };
  const r1 = await _tick({ readNodeSynced: async () => SYNCED, recaptureSideLockDaaForMarket: fakeRecapture });
  const mine = called.filter(id => id.includes(sfx));
  ok(mine.length === 3 && mine.includes(S1) && mine.includes(S2) && mine.includes(N) && !called.includes(T) && !called.includes(O), `recapture 恰被 S1/S2/N 各调 1 次, T/O 0 次 (got ${JSON.stringify(mine)})`);
  ok(r1.scanned >= 2 && r1.shards >= 3 && r1.shards === called.length, `scanned(逻辑盘)=${r1.scanned} ≥2, shards=${r1.shards} = recapture 调用数 ${called.length}`);
  ok(r1.reasons && r1.reasons['walk-futile'] === called.length && r1.anchorSources?.none === called.length, `直方图跨分片聚合 (got ${JSON.stringify(r1.reasons)} ${JSON.stringify(r1.anchorSources)})`);
  const ev = sqlite.prepare(`SELECT payload_json FROM events WHERE event_type = 'side_lock_daa_unrecoverable' AND payload_json LIKE ?`).all(`%"marketId":"${L}"%`);
  ok(ev.length === 1 && JSON.parse(ev[0].payload_json).stillNullCount === 2, `L 标不可恢复一次且 stillNullCount = 分片之和 2 (got ${ev.map(e => e.payload_json).join(' | ')})`);
  ok(sqlite.prepare(`SELECT COUNT(*) c FROM events WHERE event_type = 'side_lock_daa_unrecoverable' AND payload_json LIKE ?`).get(`%"marketId":"${N}"%`).c === 0, 'N(deadline 在 floor 之上) 不标');
  ok(_unrecoverableSetSize() >= 1, `6b 集合已含新标 (size=${_unrecoverableSetSize()})`);
  called.length = 0;
  const r2 = await _tick({ readNodeSynced: async () => SYNCED, recaptureSideLockDaaForMarket: fakeRecapture });
  const mine2 = called.filter(id => id.includes(sfx));
  ok(mine2.length === 1 && mine2[0] === N, `下 tick L 被 6b 集合跳过, 只剩 N (got ${JSON.stringify(mine2)}; scanned=${r2.scanned})`);
  const hb = sqlite.prepare('SELECT last_scanned_null_rows, tick_count FROM spc_prune_capture_heartbeat WHERE id = 1').get();
  ok(hb && hb.last_scanned_null_rows === called.length && hb.tick_count >= 2, `heartbeat 仍记分片口径 (got ${JSON.stringify(hb)})`);
}

console.log(fails === 0 ? '\n✅✅ ALL PASS — P2-6c α: anchor relax + walk-futile + reasons histogram + logical-market loop unit' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
