// fee-split-phase2.test.mjs — B线落2 验收(J2 2026-07-12, 设计 docs/2026-07-12-fee-split-phase2-commit-anchor-design.md v1.2)。
// 覆盖 DoD#2 全清单: commit v2 round-trip / 篡改拒 / 隐瞒拒 / predicate-null 篡改 BUST(P1 负例) /
// P2 degenerate 早退不撞 selectCommittee / P3 hint 交叉断言 / NULL 老市场 byte-equal / v184 trigger 负测试。
// Run: cd kasia-console && node src/lib/fee-split-phase2.test.mjs
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import fs from 'fs';
import {
  computeMarketCommitV2, deriveMarketPredicateCommit, computeMarketCommit, computePredicateCommit,
  computePariMutuelPayout,
} from './pool-shard-settle.mjs';
import { buildPredictionV1InterimRules, computeFeeRulesCommit, deriveRoleFeeLeaves } from './fee-split.mjs';
import { _enforceCloseAttestCore } from './bshard-close-enforce.mjs';
import { computeSettlePlan, deriveResumePlanFromEvidence } from '../services/bshard-auto-settler.mjs';
import { payoutRoot as buildPayoutRoot } from '../lib/pool-payout-root.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };

const BROKER = 'a1'.repeat(32);
const INTRO = 'b2'.repeat(32);
const META_HASH = 'c3'.repeat(32);
const PREDICATE = { metric: 'score', op: '>', operand: 3 };

console.log('[test] ① buildPredictionV1InterimRules 形状钉死(NWT P5):');
{
  const withIntro = buildPredictionV1InterimRules({ brokerPk: BROKER, introducerPk: INTRO });
  ok(withIntro.preset === 'prediction-v1-interim' && withIntro.roles.length === 5, 'preset 名 + 5 roles(有 introducer 变体)');
  ok(withIntro.roles.find(r => r.name === 'provider').bps === 9820, 'provider=9820(有 intro)');
  ok(withIntro.roles.find(r => r.name === 'oracle').bps === 0 && withIntro.roles.find(r => r.name === 'node').bps === 0, '委员叶 bps=0(挂 D-008 政策卡, 非 bug)');
  const noIntro = buildPredictionV1InterimRules({ brokerPk: BROKER });
  ok(noIntro.roles.length === 4 && noIntro.roles.find(r => r.name === 'provider').bps === 9840, 'introducer 缺席整角色剔除, provider=9840');
  ok(throws(() => buildPredictionV1InterimRules({}), /brokerPk 必需/), '无 broker 拒(走 legacy 0费路径)');
  // 委员 bps=0 → derive 层零叶(两变体)
  const { feeLeaves } = deriveRoleFeeLeaves(withIntro, '1000000000', { committeePks: ['cc'.repeat(32)] });
  ok(feeLeaves.length === 2 && feeLeaves.every(l => l.type !== 'committee'), 'bps=0 委员角色零叶(broker+introducer 两叶)');
}

console.log('[test] ② computeMarketCommitV2(P1 公式 + 注4c 类型 pin):');
{
  const rules = buildPredictionV1InterimRules({ brokerPk: BROKER });
  const c1 = computeMarketCommitV2(rules, { predicate: PREDICATE });
  const c2 = computeMarketCommitV2(rules, { predicate: PREDICATE });
  ok(/^[0-9a-f]{64}$/.test(c1) && c1 === c2, `round-trip 确定性: ${c1.slice(0, 16)}…`);
  const tampered = JSON.parse(JSON.stringify(rules));
  tampered.roles.find(r => r.name === 'broker').bps = 300;
  tampered.roles.find(r => r.name === 'provider').bps = 9700;
  ok(computeMarketCommitV2(tampered, { predicate: PREDICATE }) !== c1, '篡改 bps → commit 变');
  const cNull = computeMarketCommitV2(rules, { marketMetadataHash: META_HASH });
  ok(cNull !== c1 && /^[0-9a-f]{64}$/.test(cNull), 'predicate-null identity 锚变体 ≠ predicate 变体');
  ok(throws(() => computeMarketCommitV2(rules, {}), /identity 锚|marketMetadataHash/), 'predicate-null 缺 metadataHash 拒烤(P1 锚无源)');
  ok(computeMarketCommitV2(rules, { marketMetadataHash: META_HASH.toUpperCase() }) === cNull, 'metadataHash 大小写归一(类型 pin)');
}

console.log('[test] ③ deriveMarketPredicateCommit 三分支(老市场 byte-equal 现状):');
{
  const rrs = JSON.stringify({ resolution_predicate: PREDICATE });
  // (a) legacy predicate 市场 == 旧 inline 公式逐位
  const mLegacy = { resolution_rule_spec: rrs, fee_rules: null, broker_pk: BROKER, introducer_pk: null, market_metadata_hash: META_HASH };
  ok(deriveMarketPredicateCommit(mLegacy) === computeMarketCommit(PREDICATE, { brokerPk: BROKER, introducerPk: null }), 'legacy predicate 市场 byte-equal 旧公式');
  // (b) legacy predicate-null → 裸 metadata_hash
  const mNull = { resolution_rule_spec: '{}', fee_rules: null, broker_pk: BROKER, market_metadata_hash: META_HASH };
  ok(deriveMarketPredicateCommit(mNull) === META_HASH, 'legacy predicate-null 市场 == 裸 metadata_hash(字节不动)');
  // (c) fee_rules 市场 → v2(含 predicate)
  const rules = buildPredictionV1InterimRules({ brokerPk: BROKER });
  const mFee = { ...mLegacy, fee_rules: JSON.stringify(rules) };
  ok(deriveMarketPredicateCommit(mFee) === computeMarketCommitV2(rules, { predicate: PREDICATE }), 'fee_rules+predicate → v2 公式');
  // (d) fee_rules + predicate-null → v2 identity 锚(P1 第三分支闭合)
  const mFeeNull = { ...mNull, fee_rules: JSON.stringify(rules) };
  ok(deriveMarketPredicateCommit(mFeeNull) === computeMarketCommitV2(rules, { marketMetadataHash: META_HASH }), 'fee_rules+predicate-null → v2 identity 锚(不再裸 metadata_hash)');
  ok(throws(() => deriveMarketPredicateCommit({ ...mFee, fee_rules: '{bad json' })), '坏 fee_rules JSON → fail-loud throw');
}

console.log('[test] ④ enforce 命门①(P1/P3, _enforceCloseAttestCore 负例——真函数非复刻):');
{
  const MY_PK = 'dd'.repeat(32);
  const rules = buildPredictionV1InterimRules({ brokerPk: BROKER });
  const onChainV2 = computeMarketCommitV2(rules, { marketMetadataHash: META_HASH });
  // psRedeemHex: offset-518 放 commit(V1 layout), 前后填 0
  const mkRedeem = (commit) => '00'.repeat(518) + commit + '00'.repeat(64);
  const ctx = { myOracleKeys: [MY_PK], marketMetadataHash: META_HASH, resolutionRuleSpec: { judge_type: 'blockhash_parity', target_daa: 1 } };
  const base = { market_id: 'm-p2test', predicate: null, psRedeemHex: mkRedeem(onChainV2), committee_pk: MY_PK, broker_pk: BROKER, introducer_pk: null };
  // (i) 篡改 feeRules(载荷) vs 链上 v2 commit → hash-bind FAIL
  const tampered = JSON.parse(JSON.stringify(rules));
  tampered.roles.find(r => r.name === 'broker').address = 'ee'.repeat(32);
  const r1 = await _enforceCloseAttestCore({ ...base, broker_pk: 'ee'.repeat(32), fee_rules: JSON.stringify(tampered) }, ctx);
  ok(r1.pass === false && /hash-bind FAIL/.test(r1.reason), `篡改规则(换 broker 地址) → BUST: ${r1.reason?.slice(0, 60)}`);
  // (ii) 隐瞒 feeRules(载荷不带, 链上 v2)→ legacy 分支算 metadata_hash ≠ v2 → BUST(P1 论证表第三行)
  const r2 = await _enforceCloseAttestCore({ ...base }, ctx);
  ok(r2.pass === false && /hash-bind FAIL/.test(r2.reason), `隐瞒规则(predicate-null) → 裸 metadata_hash ≠ 链上 v2 → BUST: ${r2.reason?.slice(0, 60)}`);
  // (iii) P3: hint 与规则地址分叉 → 拒签(在 commit 比对前拦)
  const r3 = await _enforceCloseAttestCore({ ...base, broker_pk: 'ee'.repeat(32), fee_rules: JSON.stringify(rules) }, ctx);
  ok(r3.pass === false && /P3 交叉断言/.test(r3.reason), `P3 hint 分叉 → 拒签: ${r3.reason?.slice(0, 50)}`);
  // (iv) 坏 JSON → 拒签
  const r4 = await _enforceCloseAttestCore({ ...base, fee_rules: '{bad' }, ctx);
  ok(r4.pass === false && /非法 JSON/.test(r4.reason), `坏 JSON 载荷 → 拒签`);
  // (v) 正确规则+正确 commit → 通过命门①(在后续 chainReader 缺失处才停 = 证明 commit 门已过)
  const r5 = await _enforceCloseAttestCore({ ...base, fee_rules: JSON.stringify(rules) }, ctx);
  ok(r5.pass === false && /chainReader 缺/.test(r5.reason) && !/hash-bind/.test(r5.reason), `合法规则过命门①(停在预期的 chainReader 缺失, 非 hash-bind): ${r5.reason?.slice(0, 50)}`);
}

console.log('[test] ⑤ computeSettlePlan P2 前置 + fee 叶(真函数+in-memory fixture):');
{
  const mkDb = () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE pool_markets (id TEXT PRIMARY KEY, protocol_version TEXT, metadata TEXT, maker_pk TEXT, broker_pk TEXT,
        pool_merkle_root TEXT, deadline_daa INTEGER, fee_rules TEXT, resolution_rule_spec TEXT, market_metadata_hash TEXT, introducer_pk TEXT);
      CREATE TABLE market_shards (logical_market_id TEXT, shard_market_id TEXT, shard_index INTEGER, status TEXT DEFAULT 'sealed');
      CREATE TABLE pool_bettor_sides (market_id TEXT, bettor_pk TEXT, stake_amount TEXT, direction INTEGER, side_lock_daa INTEGER, side_lock_tx TEXT);
      CREATE TABLE payout_shards (logical_market_id TEXT, pool_merkle_root TEXT, predicate_commit TEXT);
    `);
    return db;
  };
  const MID = 'ext-pool-v07-test-phase2';
  const SHARD = `${MID}-s0`;
  const W = { pk: 'aa'.repeat(32), stake: '2000000000', direction: 1 };
  const L = { pk: 'bb'.repeat(32), stake: '1000000000', direction: 0 };
  const MEMBERS = Array.from({ length: 8 }, (_, i) => ({ pk_hex: (10 + i).toString(16).padStart(2, '0').repeat(32), stake_sompi: '1000000000' }));
  const seed = (db, { feeRules = null, bets = [W, L] } = {}) => {
    db.prepare(`INSERT INTO pool_markets (id, protocol_version, metadata, maker_pk, broker_pk, pool_merkle_root, deadline_daa, fee_rules) VALUES (?,?,?,?,?,?,?,?)`)
      .run(MID, 'v0.7', '{}', 'f0'.repeat(32), BROKER, 'e0'.repeat(32), 12345, feeRules);
    db.prepare('INSERT INTO market_shards (logical_market_id, shard_market_id, shard_index) VALUES (?,?,0)').run(MID, SHARD);
    for (const b of bets) db.prepare('INSERT INTO pool_bettor_sides (market_id, bettor_pk, stake_amount, direction) VALUES (?,?,?,?)').run(SHARD, b.pk, b.stake, b.direction);
  };
  const mkCtx = (db, winDir) => {
    const flags = { poolMembersCalled: false };
    return {
      ctx: {
        db,
        judgeWinDir: async () => winDir,
        endBlockHash: async () => 'ab'.repeat(32),
        poolMembers: async () => { flags.poolMembersCalled = true; return MEMBERS; },
        p2shAddr: null, psSeedSompi: 20000000,
      },
      flags,
    };
  };
  // (i) P2: 单边盘(全 direction=1)+winDir=0 → degenerate 早退, selectCommittee 链路(poolMembers)零触发
  {
    const db = mkDb();
    seed(db, { bets: [W, { ...L, direction: 1 }] });
    const { ctx, flags } = mkCtx(db, 0);
    const r = await computeSettlePlan(MID, ctx);
    ok(r.ok === false && r.degenerate === true, `P2: degenerate 早退: ${r.reason?.slice(0, 40)}`);
    ok(flags.poolMembersCalled === false, 'P2: 早退发生在选委员之前(poolMembers 零调用——原顺序会先撞 selectCommittee)');
  }
  // (ii) legacy(fee_rules NULL)→ payoutRoot byte-equal 无费重算(存量字节不动)
  {
    const db = mkDb();
    seed(db, {});
    const { ctx } = mkCtx(db, 1);
    const r = await computeSettlePlan(MID, ctx);
    const pmNoFee = computePariMutuelPayout({ bettors: [W, L].map(b => ({ pk: b.pk, stake: b.stake, direction: b.direction })), winningDirection: 1 });
    ok(r.ok === true && r.payoutRoot === buildPayoutRoot(pmNoFee.payoutLeaves).toString('hex'), 'legacy 市场 payoutRoot byte-equal 无费口径(存量零变化)');
  }
  // (iii) fee_rules 市场 → broker 叶进 payoutLeaves, Σ守恒==pool
  {
    const rules = buildPredictionV1InterimRules({ brokerPk: BROKER });
    const db = mkDb();
    seed(db, { feeRules: JSON.stringify(rules) });
    const { ctx } = mkCtx(db, 1);
    const r = await computeSettlePlan(MID, ctx);
    const pool = BigInt(W.stake) + BigInt(L.stake);
    const expectBrokerAmt = (pool * 160n / 10000n).toString();
    const brokerLeaf = r.winners.find(w => w.pk === BROKER);
    ok(r.ok === true && !!brokerLeaf && brokerLeaf.amount === expectBrokerAmt, `fee 市场: broker 叶 ${brokerLeaf?.amount} == floor(pool*160/10000)=${expectBrokerAmt}`);
    ok(r.winners.reduce((s, w) => s + BigInt(w.amount), 0n) === pool, `Σ(payoutLeaves)==pool ${pool}(精确清零守恒)`);
    // (iv) resume 同费口径: evidence root = 含费 root → resume ok(fee 市场 resume 不结构性失效)
    db.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run(JSON.stringify({ settle_evidence: { close_txid: 'cc'.repeat(32), win_direction: 1, payout_root: r.payoutRoot } }), MID);
    const rr = deriveResumePlanFromEvidence(MID, { db });
    ok(rr.ok === true && rr.payoutRoot === r.payoutRoot, 'fee 市场 resume 重算含费 root 吻合(resume 不失效)');
  }
}

console.log('[test] ⑥ v184 migration 真跑(隔离临时库)+ write-once trigger 负测试(Bettor 注2, NWT 核点④):');
{
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_phase2_v184_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  // 按文件头约定从 kasia-console 目录跑本测试 → cwd 即 kasia-console(run-migrations.mjs 相对路径成立)
  execSync(`node scripts/run-migrations.mjs`, { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const db = new Database(tmpDb);
  const cols = db.pragma('table_info(pool_markets)').map(c => c.name);
  ok(cols.includes('fee_rules'), 'v184a: fee_rules 列在真 migration 后存在');
  // 真 schema 有若干 NOT NULL 无默认列——按 pragma 动态补 dummy(测试只关心 fee_rules 的 trigger 行为)
  const info = db.pragma('table_info(pool_markets)');
  const required = info.filter(c => c.notnull === 1 && c.dflt_value == null);
  const insCols = ['id', ...required.filter(c => c.name !== 'id').map(c => c.name)];
  db.prepare(`INSERT INTO pool_markets (${insCols.join(',')}) VALUES (${insCols.map(() => '?').join(',')})`)
    .run('m-trg-test', ...required.filter(c => c.name !== 'id').map(c => (c.type === 'INTEGER' || c.type === 'REAL' ? 0 : 'x')));
  db.prepare(`UPDATE pool_markets SET fee_rules = '{"schema_v":1}' WHERE id='m-trg-test'`).run();   // NULL→值 允许(一次)
  ok(db.prepare(`SELECT fee_rules FROM pool_markets WHERE id='m-trg-test'`).get().fee_rules === '{"schema_v":1}', 'NULL→值 写入允许(一次)');
  ok(throws(() => db.prepare(`UPDATE pool_markets SET fee_rules = '{"schema_v":2}' WHERE id='m-trg-test'`).run(), /write-once/), 'v184b trigger: 已有值改写 → RAISE(结构性不可能, L4)');
  ok(throws(() => db.prepare(`UPDATE pool_markets SET fee_rules = NULL WHERE id='m-trg-test'`).run(), /write-once/), 'v184b trigger: 清空 → RAISE');
  ok(!throws(() => db.prepare(`UPDATE pool_markets SET fee_rules = '{"schema_v":1}' WHERE id='m-trg-test'`).run()), '等值 UPDATE(no-op 语义)放行——settler 整行 UPDATE 不误伤');
  db.close();
  try { fs.unlinkSync(tmpDb); } catch {}
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — B线落2: commit v2 双向 BUST(含 P1 第三分支)/P2 早退/P3 交叉断言/存量 byte-equal/fee 叶守恒/resume 同费/v184 trigger'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
