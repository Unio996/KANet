// trade-protocol-filter.capture-gate.test.mjs — captureSideLockDaa IBD 门 + 结构性不可达免重来 regression
// (J2 2026-08-30, Bettor 批·NWT 红队 ①-④, docs/2026-08-30-j2-console-ibd-memory-growth-diagnosis.md §9.3②)。
// 真 migration 临时库(同 broker-fee-emit-package-switch.test.mjs 自举惯例) + 真 captureSideLockDaa(非复刻), 离线: 不连 kaspad、不连 relay。
// 守什么:
//   G1 门关(isSynced!=true)      ⇒ 返回 skipped='node-not-synced', 【RpcClient 构造计数 = 0】(NWT ③)
//   G2 结构性不可达(锚点 getBlock 抛 cannot find header 且 锚点 daa < 剪裁点) ⇒ reason='anchor-pruned' + 标记; 第二次同 side/同锚点【不再构造】
//   G3 暂态 not-found(锚点 daa >= 剪裁点 / 剪裁点读不到)        ⇒ 不标记, 第二次仍构造(NWT ②)
//   G4 门开 + kaspa_tx_log 命中路径 行为不变(daa 由 getBlock header 得, finality 门照旧)
//   G5 isNodeSyncedCached: TTL 内 readFn 只调 1 次(门自身不再每 side 建客户端)
// Run: cd kasia-console && node src/services/trade-protocol-filter.capture-gate.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._CAPGATE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_capgate_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _CAPGATE_TEST_BOOTSTRAPPED: '1', KASPA_RPC_URL: 'ws://127.0.0.1:1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { captureSideLockDaa, _captureUnreachableState, _resetCaptureUnreachable } = await import('./trade-protocol-filter.js');
const { isNodeSyncedCached, _resetNodeSyncedCache } = await import('./preprune-capture-worker.mjs');
// 离线: 用 deps.rpcUrl 绕开 getWorkingRpc(否则会探 KASPA_RPC_URL 再走 Resolver 发现, 联网); FakeRpc 不真连。
const RPC_URL = 'ws://127.0.0.1:1';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const SYNCED = { synced: true, isSynced: true, reason: 'ok' }, NOTSYNCED = { synced: false, isSynced: false, reason: 'not-synced' };
const ANCHOR = 'ab'.repeat(32), TIP = 'cd'.repeat(32), TXHIT = 'ef'.repeat(32), TXMISS1 = '11'.repeat(32), TXMISS2 = '22'.repeat(32), TXMISS3 = '33'.repeat(32);
// 索引锚点: deadline hint 60,000,000 → 锚 ANCHOR@60,000,100, 覆盖段 [59M,61M]
sqlite.prepare('INSERT OR REPLACE INTO spc_daa_index (block_hash, daa_score, timestamp_ms) VALUES (?, ?, ?)').run(ANCHOR, 60_000_100, 1_780_000_000_000);
sqlite.prepare('INSERT OR REPLACE INTO spc_daa_index_coverage (start_daa, end_daa) VALUES (?, ?)').run(59_000_000, 61_000_000);
sqlite.prepare('INSERT OR REPLACE INTO kaspa_tx_log (tx_id, block_hash, block_time, from_address, to_address, amount, outputs_json, observed_at, network) VALUES (?, ?, 0, ?, ?, 0, ?, 0, ?)').run(TXHIT, TIP, 'a', 'b', '[]', 'testnet-12');

function fakeRpcFactory({ notFound = [], headerDaa = 80_000_000, tipDaa = 80_000_500 } = {}) {
  const st = { ctor: 0, connect: 0, disconnect: 0, getBlock: 0 };
  class FakeRpc {
    constructor() { st.ctor++; }
    async connect() { st.connect++; }
    async disconnect() { st.disconnect++; }
    async getBlockDagInfo() { return { sink: TIP, pruningPointHash: 'pp'.repeat(16), virtualDaaScore: BigInt(tipDaa) }; }
    async getBlock({ hash }) { st.getBlock++; if (notFound.includes(hash)) throw new Error(`RPC Server (remote error) -> cannot find header ${hash}`); return { block: { header: { daaScore: BigInt(headerDaa) }, transactions: [], verboseData: { selectedParentHash: '0'.repeat(64) } } }; }
  }
  return { st, FakeRpc };
}
const base = { side_p2sh: 'kaspatest:qq', stake_amount: 100, network: 'testnet-12', approxDaaHint: 60_000_000 };

console.log('[G1] 门关 ⇒ skip + RpcClient 构造 0 次:');
{
  _resetCaptureUnreachable(); const { st, FakeRpc } = fakeRpcFactory();
  const r = await captureSideLockDaa({ ...base, side_lock_tx: TXMISS1 }, { isNodeSynced: async () => NOTSYNCED, RpcClientCtor: FakeRpc, rpcUrl: RPC_URL });
  ok(r.daa === null && r.skipped === 'node-not-synced' && /node-not-synced/.test(r.reason), `返回 {daa:null, skipped:'node-not-synced'} (${r.reason})`);
  ok(st.ctor === 0 && st.connect === 0 && st.getBlock === 0, `RpcClient 构造=${st.ctor} connect=${st.connect} getBlock=${st.getBlock} (全 0)`);
  const r2 = await captureSideLockDaa({ ...base, side_lock_tx: TXMISS1 }, { isNodeSynced: async () => ({ synced: false, isSynced: null, reason: 'rpc-fail: connect timeout' }), RpcClientCtor: FakeRpc, rpcUrl: RPC_URL });
  ok(r2.skipped === 'node-not-synced' && st.ctor === 0, `isSynced=null(读不到) 也 fail-closed skip, 构造仍 0`);
}

console.log('[G2] 结构性不可达(锚点 cannot find header 且 锚点 daa < 剪裁点) ⇒ anchor-pruned + 标记, 第二次不构造:');
{
  _resetCaptureUnreachable(); const { st, FakeRpc } = fakeRpcFactory({ notFound: [ANCHOR] });
  const deps = { isNodeSynced: async () => SYNCED, RpcClientCtor: FakeRpc, rpcUrl: RPC_URL, pruningDaaFn: async () => 70_000_000 };
  const r = await captureSideLockDaa({ ...base, side_lock_tx: TXMISS1 }, deps);
  ok(r.daa === null && r.reason === 'anchor-pruned' && r.skipped === 'anchor-pruned', `第一次: reason=${r.reason}`);
  ok(st.ctor === 1 && st.getBlock === 1 && st.disconnect >= 1, `第一次构造 1 / getBlock 1 / disconnect>=1 (${JSON.stringify(st)}; 既有路径 no-block-hash 分支+finally 双断连, 对真客户端 no-op)`);
  const s = _captureUnreachableState(); ok(s.anchors.has(ANCHOR) && s.txs.has(TXMISS1), '锚点与 side 已标记(内存)');
  const r2 = await captureSideLockDaa({ ...base, side_lock_tx: TXMISS1 }, deps);
  ok(r2.reason === 'anchor-pruned(cached)' && st.ctor === 1, `同 side 第二次: 不构造 (构造仍 ${st.ctor})`);
  const r3 = await captureSideLockDaa({ ...base, side_lock_tx: TXMISS2 }, deps);
  ok(r3.reason === 'anchor-pruned(cached)' && st.ctor === 1 && _captureUnreachableState().txs.has(TXMISS2), `同锚点另一 side: 不构造, 且该 side 也标记`);
}

console.log('[G3] 暂态 not-found(锚点 daa >= 剪裁点 / 剪裁点读不到) ⇒ 不标记, 第二次仍构造:');
{
  _resetCaptureUnreachable(); const { st, FakeRpc } = fakeRpcFactory({ notFound: [ANCHOR] });
  const deps = { isNodeSynced: async () => SYNCED, RpcClientCtor: FakeRpc, rpcUrl: RPC_URL, pruningDaaFn: async () => 50_000_000 };  // 剪裁点在锚点之前 ⇒ 不该找不到, 暂态
  const r = await captureSideLockDaa({ ...base, side_lock_tx: TXMISS3 }, deps);
  ok(r.daa === null && r.reason === 'anchor-not-found-transient' && !r.skipped, `reason=${r.reason}, 无 skipped`);
  ok(_captureUnreachableState().anchors.size === 0 && _captureUnreachableState().txs.size === 0, '未标记');
  const r2 = await captureSideLockDaa({ ...base, side_lock_tx: TXMISS3 }, deps);
  ok(st.ctor === 2 && r2.reason === 'anchor-not-found-transient', `第二次仍构造 (构造=${st.ctor})`);
  const deps2 = { ...deps, pruningDaaFn: async () => null };
  await captureSideLockDaa({ ...base, side_lock_tx: TXMISS3 }, deps2);
  ok(_captureUnreachableState().anchors.size === 0, '剪裁点读不到 ⇒ 也不标(fail-safe 向暂态)');
}

console.log('[G4] 门开 + kaspa_tx_log 命中 ⇒ 原路径不变(daa 来自 getBlock header, finality 门):');
{
  _resetCaptureUnreachable(); const { st, FakeRpc } = fakeRpcFactory({ headerDaa: 80_000_000, tipDaa: 80_000_500 });
  const r = await captureSideLockDaa({ ...base, side_lock_tx: TXHIT }, { isNodeSynced: async () => SYNCED, RpcClientCtor: FakeRpc, rpcUrl: RPC_URL });
  ok(r.daa === 80_000_000 && r.reason === 'ok', `daa=${r.daa} reason=${r.reason}`);
  ok(st.ctor === 1 && st.disconnect === 1, `构造 1 / disconnect 1`);
  const { st: st2, FakeRpc: F2 } = fakeRpcFactory({ headerDaa: 80_000_490, tipDaa: 80_000_500 });
  const r2 = await captureSideLockDaa({ ...base, side_lock_tx: TXHIT }, { isNodeSynced: async () => SYNCED, RpcClientCtor: F2, rpcUrl: RPC_URL });
  ok(r2.daa === null && /not-yet-finality-safe/.test(r2.reason), `finality 门照旧 (${r2.reason})`);
}

console.log('[G5] isNodeSyncedCached: TTL 内只读一次:');
{
  _resetNodeSyncedCache(); let calls = 0; let t = 1_000_000;
  const readFn = async () => { calls++; return NOTSYNCED; }; const now = () => t;
  const a = await isNodeSyncedCached({ ttlMs: 30_000, readFn, now }); const b = await isNodeSyncedCached({ ttlMs: 30_000, readFn, now });
  ok(calls === 1 && a.cached === false && b.cached === true && b.synced === false, `两次调用 readFn=${calls} (cached=${b.cached})`);
  t += 31_000; const c = await isNodeSyncedCached({ ttlMs: 30_000, readFn, now }); ok(calls === 2 && c.cached === false, `TTL 过期重读 (readFn=${calls})`);
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — captureSideLockDaa IBD 门(构造 0)/结构性不可达免重来/暂态不标/命中路径不变/门缓存'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
