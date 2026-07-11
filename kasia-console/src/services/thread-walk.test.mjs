// thread-walk.test.mjs — claim 线程 thread-walk resume 验收(J2 2026-07-12, 设计 docs/2026-07-12-claim-
// thread-walk-resume-design.md §4-1 + NWT diff 核点)。真 settleMarketLive/compilePayoutShardRedeem/
// splicePayoutContinuation(非复刻), in-memory fixture。
// Run: cd kasia-console && node src/services/thread-walk.test.mjs
// (自举: settleMarketLive:306 读模块级 sqlite 非 ctx.db——必须 DB_PATH 隔离库, pregate.test 同款)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._TW_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_threadwalk_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _TW_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

import { blake2b } from '@noble/hashes/blake2b';
const { sqlite } = await import('../db/client.js');
const { settleMarketLive, splicePayoutContinuation } = await import('./bshard-auto-settler.mjs');
const { computePariMutuelPayout } = await import('../lib/pool-shard-settle.mjs');
const { payoutRoot: buildPayoutRoot } = await import('../lib/pool-payout-root.mjs');
const { compilePayoutShardRedeem } = await import('../lib/pool-shard-register.mjs');
sqlite.pragma('foreign_keys = OFF');   // fixture dummy 列不构造整图 FK(被测=thread-walk, 与 FK 无关)

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const MID = 'ext-pool-v07-test-threadwalk';
const SHARD = `${MID}-s0`;
const W1 = { pk: 'aa'.repeat(32), stake: '2000000000', direction: 1 };
const W2 = { pk: 'ab'.repeat(32), stake: '1000000000', direction: 1 };
const L1 = { pk: 'bb'.repeat(32), stake: '1000000000', direction: 0 };
const CLOSE_TXID = 'cc'.repeat(32);
const PMR = 'd1'.repeat(32);
const PC = 'd2'.repeat(32);
const SEED = 20000000;
const fakeP2sh = (redeemHex) => 'p2shtest:' + Buffer.from(blake2b(Buffer.from(String(redeemHex)), { dkLen: 20 })).toString('hex');

// ── 与生产同源构造: plan.winners(payoutLeaves 序)→ 逐步状态转移 → 候选续约地址序(真 splice/真 compile)──
const pm = computePariMutuelPayout({ bettors: [W1, W2, L1].map(b => ({ pk: b.pk, stake: b.stake, direction: b.direction })), winningDirection: 1 });
const ROOT = buildPayoutRoot(pm.payoutLeaves).toString('hex');
const POOL0 = (BigInt(W1.stake) + BigInt(W2.stake) + BigInt(L1.stake) + BigInt(SEED)).toString();   // consolidatedPool 含 seed
const closedRedeem = compilePayoutShardRedeem({ poolMerkleRoot: PMR, predicateCommit: PC, consolidatedPool: POOL0, closed: 1, payoutRoot: ROOT });
const steps = [];   // steps[k] = { addr(第k+1步续约地址), txId(该步claim txid), poolAfter }
{
  let curRedeem = closedRedeem, curPool = BigInt(POOL0);
  const curState = { consolidated_pool: curPool.toString(), closed: 1, payoutRoot: ROOT };
  for (let i = 0; i < 17; i++) curState['w' + i] = 0;
  pm.payoutLeaves.forEach((leaf, idx) => {
    const ns = { consolidated_pool: (curPool - BigInt(leaf.amount)).toString(), closed: 1, payoutRoot: ROOT };
    for (let k = 0; k < 17; k++) ns['w' + k] = curState['w' + k];
    const word = Math.floor(idx / 63), bit = idx % 63;
    ns['w' + word] = (BigInt(ns['w' + word]) + (1n << BigInt(bit))).toString();
    curRedeem = splicePayoutContinuation(curRedeem, ns);
    curPool -= BigInt(leaf.amount);
    Object.assign(curState, ns);
    steps.push({ addr: fakeP2sh(curRedeem), txId: ('e' + idx).padEnd(2, '0').repeat(32).slice(0, 64), poolAfter: curPool.toString() });
  });
}

// 真 schema 通用 INSERT: 指定列 + NOT NULL 无默认列自动补 dummy(pregate.test 同款)
function _insertDyn(table, fields) {
  const req = sqlite.pragma(`table_info(${table})`).filter(c => c.notnull === 1 && c.dflt_value == null && !(c.name in fields) && c.pk === 0);
  const all = { ...fields };
  for (const c of req) all[c.name] = (c.type === 'INTEGER' || c.type === 'REAL') ? 0 : 'x';
  const cols = Object.keys(all);
  sqlite.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => all[c]));
}
function freshDb({ txLogSteps = 0 } = {}) {
  for (const t of ['pool_markets', 'market_shards', 'pool_bettor_sides', 'payout_shards', 'kaspa_tx_log', 'events']) sqlite.prepare(`DELETE FROM ${t}`).run();
  _insertDyn('pool_markets', { id: MID, protocol_version: 'v0.7', metadata: JSON.stringify({ settle_evidence: { close_txid: CLOSE_TXID, win_direction: 1, payout_root: ROOT } }), resolution_rule_spec: '{}', protocol_status: 'settled_partial_claims' });
  _insertDyn('market_shards', { logical_market_id: MID, shard_market_id: SHARD, shard_index: 0, status: 'sealed' });
  for (const b of [W1, W2, L1]) _insertDyn('pool_bettor_sides', { market_id: SHARD, bettor_pk: b.pk, stake_amount: b.stake, direction: b.direction });
  _insertDyn('payout_shards', { logical_market_id: MID, pool_merkle_root: PMR, predicate_commit: PC });
  for (let k = 0; k < txLogSteps; k++) {
    _insertDyn('kaspa_tx_log', { tx_id: steps[k].txId, outputs_json: JSON.stringify([{ address: 'winner-addr' }, { address: steps[k].addr }]), block_time: 1000 + k });
  }
  return sqlite;
}

// getUtxos fixture: liveMap = { addr → [{entry:{outpoint,amount}}] }, 其余地址返回 []
const mkCtx = (db, { liveMap = {}, relayPost = null } = {}) => ({
  db, p2shAddr: fakeP2sh, psSeedSompi: SEED,
  getUtxos: async (addr) => liveMap[addr] || [],
  relayPost: relayPost || (async () => ({ error: 'test-stub: relay unavailable' })),
  feeUtxo: async () => ({ dummy: true }),
  p2pkAddr: (pk) => 'p2pk:' + pk.slice(0, 12),
  p2pkSpk: null,
  feeRelay: { id: 'test-relay', address: 'test-change-addr' },
  alert: (mid, reason) => console.log(`    [alert] ${String(mid).slice(-8)}: ${String(reason).slice(0, 110)}`),
});

const N = pm.payoutLeaves.length;   // 3 叶(W1/W2 两赢家 + 无fee → 2? 实际 winners=2, payoutLeaves=2)
console.log(`[fixture] payoutLeaves=${N} 叶, 候选序 ${steps.length} 步, POOL0=${POOL0}`);

console.log('[test] ① 空 details + 链上已推进 k=1 步 → 探测走到 1, 恢复 txId==fixture, 从位置 1 续跑(claim 撞 stub 停=fail-loud):');
{
  const db = freshDb({ txLogSteps: 1 });
  // 位置 1 的 tip live(steps[0] 之后的 continuation): addr=steps[0].addr, outpoint=steps[0].txId, amount=poolAfter
  const live = { [steps[0].addr]: [{ entry: { outpoint: { transactionId: steps[0].txId, index: 1 }, amount: steps[0].poolAfter } }] };
  const r = await settleMarketLive(MID, mkCtx(db, { liveMap: live }));
  ok(r.ok === true && r.claims?.[0]?.txId === steps[0].txId && r.claims?.[0]?.received === true, `claim[0] 恢复(txId==${steps[0].txId.slice(0, 8)}…, received=true)`);
  ok(r.complete === false && r.claims.length >= 1, `未全清(claim[1] 撞 relay stub fail-loud): complete=${r.complete}`);
  ok(db.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='claim_thread_recovered'`).get().c === 1, '审计事件 claim_thread_recovered 批量一条');
}

console.log('[test] ② 全付清盘(全部 steps 在 tx_log + 终态无 live)→ 探测走完全部 → complete=true 转正:');
{
  const db = freshDb({ txLogSteps: N });
  const r = await settleMarketLive(MID, mkCtx(db, { liveMap: {} }));   // 全花完, 无 live tip
  ok(r.ok === true && r.complete === true, `complete=true(全早已付清只是 DB 不知道, 一步转正): ${JSON.stringify({ ok: r.ok, complete: r.complete })}`);
  ok(r.claims.length === N && r.claims.every((c, i) => c.txId === steps[i].txId && c.received === true), 'claims 全量恢复且 txId 逐位==链上 fixture(历史账补平)');
}

console.log('[test] ③ tx_log 空(索引盲区)→ 探测停位置 0, claim[0] 撞 stub = 与现状同行为:');
{
  const db = freshDb({ txLogSteps: 0 });
  const r = await settleMarketLive(MID, mkCtx(db, { liveMap: {} }));
  ok(r.ok === true && r.claims.length === 1 && !!r.claims[0].error, `停位置 0, claim[0] fail-loud: ${r.claims[0]?.error?.slice(0, 40)}`);
  ok(db.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='claim_thread_recovered'`).get().c === 0, '零恢复零审计(不虚报)');
}

console.log('[test] ④ H2 断言: live tip 余额 != 推演 curPool → STOP fail-closed(非 warn-continue):');
{
  const db = freshDb({ txLogSteps: 1 });
  const live = { [steps[0].addr]: [{ entry: { outpoint: { transactionId: steps[0].txId, index: 1 }, amount: '12345' } }] };   // 错余额
  const r = await settleMarketLive(MID, mkCtx(db, { liveMap: live }));
  ok(r.ok === false && /amount 断言 FAIL/.test(r.reason), `STOP: ${r.reason?.slice(0, 60)}`);
}

console.log('[test] ⑤ 序漂移早停(NWT H1 fixture): tx_log 里是"乱序"的续约地址(第2步先发生)→ 探测第一步查不到 → 停位置 0:');
{
  const db = freshDb({ txLogSteps: 0 });
  // 只放 steps[1](按当前序的第2步地址)——探测第一步找 steps[0].addr 查不到 → fail-closed 停
  _insertDyn('kaspa_tx_log', { tx_id: steps[1].txId, outputs_json: JSON.stringify([{ address: steps[1].addr }]), block_time: 1001 });
  const r = await settleMarketLive(MID, mkCtx(db, { liveMap: {} }));
  ok(r.ok === true && r.claims.length === 1 && !!r.claims[0].error, '序漂移 → 早停位置 0(不猜不跳步, fail-closed), 第三桶记账');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — thread-walk: 空details恢复/全付清转正/索引盲区同现状/H2 amount STOP/序漂移早停'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
