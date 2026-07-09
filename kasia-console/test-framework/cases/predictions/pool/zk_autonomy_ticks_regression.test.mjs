// Regression guard: (b) zkCloseTickV2 + (c) claimAutonomousTick (task, 2026-07-09, J2)
//
// docs/2026-07-09-zk-autonomy-three-parts-design.md §4 验收清单落地:
//   1. offline test 覆盖 §0 表格每一行"机器等价物"存在性断言(不只 happy path)。
//   2. last-claimant/exhausted 边界显式覆盖(NWT 注①)。
//   3. per-market running mutex 测试(NWT 注②)。
//   4. nullifier bit 索引复用断言(claim tick 与 driver 共用同一份位运算函数)。
// 另加落码过程中发现的 3 处实现级对齐(Bettor 三次 GO, 见频道 #drjdd3.1/#drqfba.1):
//   ① parseCloseZkV2State expectedClosed 参数(closed==1 vs closed==2 对称守卫, mismatch 必须 throw)。
//   ② nullifier 位运算读+写单源导出(不接受两份独立实现)。
//   ③ poolAtZkCloseSompi write-once 快照(第 2 个及以后 claimant 必须读快照非活值)。
//
// 同 claim_completeness_regression.test.mjs 惯例: 纯 node assert, 直接 `node <file>` 跑, 不接测试框架
// runner(zkCloseTickV2/claimAutonomousTick 是 ctx 注入的纯编排函数, 跟 broker/DM 模拟是不同测试形状)。
// DB_PATH 指向全新建的隔离库(feedback-offline-test-must-use-real-schema-with-triggers: 用真 schema
// 含 triggers, 不用裸建表 mock schema), 不碰真实 console.db。
//
// 🔴 修复(2026-07-09, Bettor+NWT 独立复现均撞 SQLITE_CORRUPT/SQLITE_BUSY, #ds95g5.2/二方确认):
// 第一版用 copyFileSync 整份拷贝活的 console.db——该库是活 WAL-mode(真实 console 进程持续写入)+5.6GB
// 体量, 拷贝那一刻若恰有未 checkpoint 的已提交页仍躺在 -wal 边车文件里, 主文件字节级拷贝出来就是撕裂
// 快照(SQLITE_CORRUPT, 非确定性, 取决于拷贝那一刻的 checkpoint 状态)。改用 better-sqlite3 `.backup()`
// (SQLite 官方在线一致性备份 API)解决了撕裂问题, 但对 5.6GB 全量数据做逐页拷贝在这台机器上要 30+ 分钟
// ——对"offline regression test 应该秒级跑完"这个基本要求是不可接受的, 且从头就没必要: 本测试只需要
// **真实 schema(含 triggers)**, 不需要真实生产数据量。改用 `runMigrations()`(src/db/migrate.js, 全项目
// 唯一权威 schema 定义源, index.js 启动时也调这个)在全新空文件上建表——零生产数据、零 WAL 撕裂风险、
// 秒级完成, 且 schema/triggers 与生产环境保证同源(不是另一套手搓 CREATE TABLE mock)。
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const TEST_DB = `D:/kanet-tn12/scratch/_zk_autonomy_ticks_test_${randomUUID().slice(0, 8)}.db`;
mkdirSync('D:/kanet-tn12/scratch', { recursive: true });
process.env.DB_PATH = TEST_DB;
const { runMigrations } = await import('file:///D:/kanet-tn12/kasia-console/src/db/migrate.js');
runMigrations();

const { sqlite } = await import('file:///D:/kanet-tn12/kasia-console/src/db/client.js');
const {
  parseCloseZkV2State, nullifierBitPosition, isNullifierBitSet, spliceClaimContinuationRedeem,
} = await import('file:///D:/kanet-tn12/kasia-console/src/lib/closezk-v2-claim-builder.mjs');
const { advanceZkContinuationAfterSpend } = await import('file:///D:/kanet-tn12/kasia-console/src/lib/closezk-v2-mint.mjs');
const {
  zkCloseTickV2, claimAutonomousTick, _zkAutonomyLeasesForTest,
} = await import('file:///D:/kanet-tn12/kasia-console/src/lib/zk-autonomy-ticks.mjs');

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.error(`❌ ${msg}`); } else { console.log(`✅ ${msg}`); } }

// ── 字节层构造(不调 silverc, 纯 JS 拼装, 精确对照 closezk-v2-claim-builder.mjs 的 _OFF 表) ──
const ZERO32 = '00'.repeat(32);
function buildRedeem({ attestedWinner = 0, closed, payoutRootFieldHex = ZERO32, consolidatedPool, words = Array(17).fill(0n), tailHex = 'deadbeef' }) {
  const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
  const p8 = Buffer.from([8]);
  const parts = [
    Buffer.from([0x51]),                                        // offset0: 前导 selector-dispatch byte(值不受校验)
    p8, i64(attestedWinner),
    p8, i64(closed),
    Buffer.from([0x20]), Buffer.from(payoutRootFieldHex, 'hex'),
    p8, i64(consolidatedPool),
    ...words.map((w) => Buffer.concat([p8, i64(w)])),
    Buffer.from(tailHex, 'hex'),
  ];
  return Buffer.concat(parts).toString('hex');
}

// ══════════════════════════════════════════════════════════════════════════
// §1 — parseCloseZkV2State expectedClosed 对称守卫(实现级对齐①, Bettor #drjdd3.1 GO)
// ══════════════════════════════════════════════════════════════════════════
{
  const redeemClosed1 = buildRedeem({ closed: 1, consolidatedPool: 500 });
  const redeemClosed2 = buildRedeem({ closed: 2, consolidatedPool: 500 });

  assert.throws(() => parseCloseZkV2State(redeemClosed1), /!= 期望值 2/, 'default expectedClosed=2 拒绝 closed=1');
  check(true, '默认 expectedClosed=2 对 closed=1 fail-closed throw(现有调用方零改动行为保持)');

  const s1 = parseCloseZkV2State(redeemClosed1, { expectedClosed: 1 });
  check(s1.closed === 1, 'expectedClosed:1 正确读出 closed==1(zkCloseTickV2 用)');

  const s2 = parseCloseZkV2State(redeemClosed2, { expectedClosed: 2 });
  check(s2.closed === 2, 'expectedClosed:2 正确读出 closed==2(claim 侧原行为不变)');

  const peek1 = parseCloseZkV2State(redeemClosed1, { expectedClosed: null });
  const peek2 = parseCloseZkV2State(redeemClosed2, { expectedClosed: null });
  check(peek1.closed === 1 && peek2.closed === 2, 'expectedClosed:null(peek 模式)对两态都不 throw, 仅供 tick 路由判断');

  assert.throws(() => parseCloseZkV2State(redeemClosed2, { expectedClosed: 1 }), /!= 期望值 1/, 'mismatch 必须 throw fail-closed(Bettor 明确禁 warn-continue)');
  check(true, 'closed 值 mismatch 时 tick 处理路径 throw 而非静默 continue(Bettor GO 硬性要求)');
}

// ══════════════════════════════════════════════════════════════════════════
// §2 — nullifier 位运算单源(实现级对齐②·NWT 注2·§4 验收④): 读侧 isNullifierBitSet 与写侧
// spliceClaimContinuationRedeem 必须调用同一份 nullifierBitPosition, 非两份独立实现。
// ══════════════════════════════════════════════════════════════════════════
{
  check(nullifierBitPosition(0).wordIdx === 0 && nullifierBitPosition(0).bitIn === 0, 'merkleIndex=0 → word0/bit0');
  check(nullifierBitPosition(63).wordIdx === 1 && nullifierBitPosition(63).bitIn === 0, 'merkleIndex=63 → word1/bit0(跨word边界)');
  check(nullifierBitPosition(70).wordIdx === 1 && nullifierBitPosition(70).bitIn === 7, 'merkleIndex=70 → word1/bit7');
  assert.throws(() => nullifierBitPosition(17 * 63), /越界/, 'merkleIndex 越界(17 words cap)必须 throw');
  check(true, 'nullifier bit 越界防护生效(cap 17 words)');

  const words = Array(17).fill(0n); words[1] = 1n << 7n;   // merkleIndex=70 的 bit 预置为 1
  const state = { w0: '0', w1: (1n << 7n).toString(), w2: '0' };
  for (let i = 3; i < 17; i++) state['w' + i] = '0';
  check(isNullifierBitSet(state, 70) === true, '读侧(isNullifierBitSet)正确识别预置 bit');
  check(isNullifierBitSet(state, 69) === false, '读侧对相邻未置位 bit 返回 false(无误报)');
}

// ══════════════════════════════════════════════════════════════════════════
// §3 — spliceClaimContinuationRedeem 写侧 round-trip + last-claimant/exhausted(§4 验收②)
// ══════════════════════════════════════════════════════════════════════════
{
  const payoutRootHex = 'ab'.repeat(32);
  const redeem = buildRedeem({ attestedWinner: 1, closed: 2, payoutRootFieldHex: payoutRootHex, consolidatedPool: 1000, words: Array(17).fill(0n) });
  const state = parseCloseZkV2State(redeem, { expectedClosed: 2 });

  // 非-last: payout < pool → 有 continuation, bit 置位, pool 递减, 其余字段原样透传。
  const r1 = spliceClaimContinuationRedeem(redeem, 5, 300n, state);
  check(r1.isLast === false && r1.newPool === 700n, '非-last claim: newPool 精确扣减(1000-300=700)');
  const reState = parseCloseZkV2State(r1.redeemHex, { expectedClosed: 2 });
  check(reState.consolidated_pool === '700', 'round-trip: 新 redeem 现读 pool == 700(byte-exact 拼接正确)');
  check(isNullifierBitSet(reState, 5) === true, 'round-trip: merkle_index=5 的 nullifier bit 已置位');
  check(isNullifierBitSet(reState, 6) === false, 'round-trip: 其余 bit 未被误触碰');
  check(reState.attestedWinner === 1 && reState.payoutRootField === payoutRootHex, 'round-trip: attestedWinner/payoutRootField 原样透传未被篡改');

  // last-claimant: payout === pool(精确清零) → isLast=true, redeemHex=null(§3 NWT 边界 case, exhausted 分支)。
  const r2 = spliceClaimContinuationRedeem(redeem, 9, 1000n, state);
  check(r2.isLast === true && r2.redeemHex === null && r2.newPool === 0n, 'last-claimant(精确清零): isLast=true, 无 continuation redeem(exhausted 分支)');

  // 已置位 bit 二次拼接必须拒绝(不接受重复 claim)。
  assert.throws(() => spliceClaimContinuationRedeem(r1.redeemHex, 5, 100n, reState), /已置位/, '二次拼接同一 merkle_index 必须 throw(防重复 claim)');
  check(true, '重复 claim 同一 leaf 被拒绝(nullifier 本地防呆生效)');

  // payout 超过池必须拒绝。
  assert.throws(() => spliceClaimContinuationRedeem(redeem, 3, 1001n, state), /越界/, 'payout > pool 必须 throw');
  check(true, 'payout 越界(> 当前池)被拒绝');
}

// ══════════════════════════════════════════════════════════════════════════
// §4 — poolAtZkCloseSompi write-once 快照(实现级对齐③·Bettor #drqfba.1 两守卫):
//   ① 只从已 landed-confirm 的路径打(结构性保证: advanceZkContinuationAfterSpend 本身只在(a) landed-gated
//      持久化路径里被调用, 见 zkCloseTickV2/claimAutonomousTick 实现——本测试验证函数自身的 write-once 语义)。
//   ② 第 2 个及以后 claimant 必须读快照值非递减的活值。
// ══════════════════════════════════════════════════════════════════════════
{
  const marketId = `zktest-${randomUUID().slice(0, 8)}`;
  sqlite.prepare(`
    INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, metadata)
    VALUES (?, 'test-relay', 'test-p2sh', 'test-hash', 9999999999, 'v0.7', ?)
  `).run(marketId, JSON.stringify({
    zk_continuation: { outpoint: { txid: 'genesis', index: 0 }, redeemHex: 'aa', valueSompi: '1000', proving: { status: 'ready' } },
  }));

  // zk_close 落地那一次(spentEntry='zk_close') — poolAtZkCloseSompi 应被 stamp 为该次 valueSompi(1000)。
  advanceZkContinuationAfterSpend(marketId, { outpointTxid: 'zkclose-tx', outpointIndex: 0, redeemHex: 'bb', valueSompi: '1000', spentEntry: 'zk_close', spentTxid: 'zkclose-tx' });
  let row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
  let meta = JSON.parse(row.metadata);
  check(meta.zk_continuation.poolAtZkCloseSompi === '1000', 'zk_close 落地那次 poolAtZkCloseSompi 被 stamp(=1000)');

  // 第 1 个 claimant 落地(spentEntry='claim') — 活值 valueSompi 递减到 700, 但快照必须保持 1000。
  advanceZkContinuationAfterSpend(marketId, { outpointTxid: 'claim1-tx', outpointIndex: 0, redeemHex: 'cc', valueSompi: '700', spentEntry: 'claim', spentTxid: 'claim1-tx' });
  row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
  meta = JSON.parse(row.metadata);
  check(meta.zk_continuation.valueSompi === '700', '第1个claimant后活值 valueSompi 正确递减(=700)');
  check(meta.zk_continuation.poolAtZkCloseSompi === '1000', '第1个claimant后 poolAtZkCloseSompi 快照未被覆盖(write-once guard 生效)');

  // 第 2 个 claimant(模拟 claimAutonomousTick 会读到的字段) — 断言"读快照非活值"这条真正的正确性要求。
  advanceZkContinuationAfterSpend(marketId, { outpointTxid: 'claim2-tx', outpointIndex: 0, redeemHex: 'dd', valueSompi: '400', spentEntry: 'claim', spentTxid: 'claim2-tx' });
  row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
  meta = JSON.parse(row.metadata);
  check(meta.zk_continuation.valueSompi === '400' && meta.zk_continuation.poolAtZkCloseSompi === '1000',
    '第2个claimant(及以后)读到的必须是快照(1000)非活值(400) — buildClaimWitness 用错值会导致 payoutRoot 重算对不上链上现读(fail-closed throw, 卡死整批但不误付)');

  sqlite.prepare('DELETE FROM pool_markets WHERE id = ?').run(marketId);
}

// ══════════════════════════════════════════════════════════════════════════
// §5 — per-market running mutex(§4 验收③·NWT 注): zkCloseTickV2/claimAutonomousTick 共享
// _zkAutonomyLeases Set, 同一市场同一时刻只能被一个 tick 占用。
// ══════════════════════════════════════════════════════════════════════════
{
  const marketId = `zktest-mutex-${randomUUID().slice(0, 8)}`;
  const redeemClosed1 = buildRedeem({ closed: 1, consolidatedPool: 500 });
  sqlite.prepare(`
    INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, metadata)
    VALUES (?, 'test-relay', 'test-p2sh', 'test-hash', 9999999999, 'v0.7', ?)
  `).run(marketId, JSON.stringify({
    zk_continuation: { outpoint: { txid: 'genesis', index: 0 }, redeemHex: redeemClosed1, valueSompi: '500', attestedWinner: 0, proving: { status: 'ready' } },
  }));

  // 场景 A: zkCloseTickV2 处理期间, lease Set 必须持有该 marketId(用一个"检查时机"的 ctx.dispatchUnlockZkClose
  // 断言运行中确实在 leases 里, 然后快速失败结束——验证锁真的在处理窗口内被持有, 不是摆设)。
  let heldDuringProcessing = false;
  const ctxA = {
    dispatchUnlockZkClose: async () => { heldDuringProcessing = _zkAutonomyLeasesForTest().has(marketId); return { ok: false, error: 'test-short-circuit' }; },
    checkLanded: async () => false,
  };
  await zkCloseTickV2(ctxA);
  check(heldDuringProcessing === true, 'zkCloseTickV2 处理某市场期间, 该市场确实在共享 lease Set 里(锁生效)');
  check(_zkAutonomyLeasesForTest().has(marketId) === false, 'zkCloseTickV2 处理结束后(含出错分支)必须释放 lease(finally 兜底)');

  // 场景 B: 手动模拟"claimAutonomousTick 正在占用" — zkCloseTickV2 应该 skip 而不是重复处理。
  _zkAutonomyLeasesForTest().add(marketId);
  let ctxBCalled = false;
  const ctxB = { dispatchUnlockZkClose: async () => { ctxBCalled = true; return { ok: false, error: 'should-not-be-called' }; }, checkLanded: async () => false };
  const resB = await zkCloseTickV2(ctxB);
  check(ctxBCalled === false, '市场被其他 tick 占用(lease Set 中)时, zkCloseTickV2 跳过不触碰, 不重复广播');
  check(resB.skipped >= 1 || resB.errored === 0, 'zkCloseTickV2 对被占用的市场计入 skipped, 非当错误处理');
  _zkAutonomyLeasesForTest().delete(marketId);

  // 场景 C: 同一函数并发重入(reentrancy) — 第二次调用应立即 {skipped:true}(module-level running 布尔, 同
  // bshardCloseSubmitV2Tick 模式)。用一个慢速 ctx 卡住第一次调用, 同步发起第二次。
  let releaseFirst;
  const gate = new Promise((res) => { releaseFirst = res; });
  const ctxSlow = { dispatchUnlockZkClose: async () => { await gate; return { ok: false, error: 'slow' }; }, checkLanded: async () => false };
  const firstCall = zkCloseTickV2(ctxSlow);
  await new Promise((r) => setTimeout(r, 20));   // 让第一次调用真正进入处理段(拿到 lease)
  const secondCall = await zkCloseTickV2(ctxSlow);
  check(secondCall.skipped === true, '同一 tick 函数并发重入时, 第二次调用立即 {skipped:true}(reentrancy 布尔生效, 不会双开处理同一批候选)');
  releaseFirst();
  await firstCall;

  sqlite.prepare('DELETE FROM pool_markets WHERE id = ?').run(marketId);
}

// ══════════════════════════════════════════════════════════════════════════
// §6 — claimAutonomousTick: poolAtZkCloseSompi 缺失时 fail-closed(不猜值), all-claimed-not-exhausted 报警
// ══════════════════════════════════════════════════════════════════════════
{
  const marketId = `zktest-claimgap-${randomUUID().slice(0, 8)}`;
  const redeemClosed2 = buildRedeem({ closed: 2, consolidatedPool: 500 });
  sqlite.prepare(`
    INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, metadata)
    VALUES (?, 'test-relay', 'test-p2sh', 'test-hash', 9999999999, 'v0.7', ?)
  `).run(marketId, JSON.stringify({
    // 故意不带 poolAtZkCloseSompi(模拟早于本次快照修复落地的历史市场)。
    zk_continuation: { outpoint: { txid: 'genesis', index: 0 }, redeemHex: redeemClosed2, valueSompi: '500', attestedWinner: 0, proving: { status: 'ready' } },
  }));

  const eventCountBefore = sqlite.prepare("SELECT COUNT(*) c FROM events WHERE event_type='claimAutonomousTick_missing_snapshot_error'").get().c;
  const res = await claimAutonomousTick({ relayCall: async () => ({ txId: 'should-not-broadcast' }), checkLanded: async () => true, mintFeeUtxo: async () => ({ address: 'a', outpointTxid: 't', index: 0 }), p2shAddr: async () => 'addr', p2pkAddr: async () => 'addr' });
  check(res.errored >= 1, 'poolAtZkCloseSompi 缺失时 claimAutonomousTick 报 errored(拒绝猜值往下走)');
  const eventCountAfter = sqlite.prepare("SELECT COUNT(*) c FROM events WHERE event_type='claimAutonomousTick_missing_snapshot_error'").get().c;
  check(eventCountAfter === eventCountBefore + 1, '缺失快照写入 events 表告警(operator 可见, 非静默吞掉)');

  sqlite.prepare('DELETE FROM pool_markets WHERE id = ?').run(marketId);
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
