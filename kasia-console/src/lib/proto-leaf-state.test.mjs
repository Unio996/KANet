// proto-leaf-state.test.mjs — Bettor 1428 复核订正的 register_append 前置三件事(账本1425/1428续)。
// 真 migration 临时库(DB_PATH), 零链零 IPC(assertLeafStateMatchesChain 的 chainUtxo 由调用方注入,
// 同 M0a 门既有手法)。
// Run: cd kasia-console && node src/lib/proto-leaf-state.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_LEAF_STATE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_leaf_state_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_LEAF_STATE_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const {
  deriveLeafState, assertNoInFlightAppend, encodeLeafStateBytes, computeExpectedLeafScriptPubKey, assertLeafStateMatchesChain,
  deriveLeafOutpoint, deriveHeldKttOutpoint, assertHeldKttOutpointMatchesChain, assertLeafAndHeldConsistent,
} = await import('./proto-leaf-state.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

const now = new Date().toISOString();
sqlite.prepare(`INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)`).run('tok1', 'Test', 'TST', now);
function mkMarket(id) {
  sqlite.prepare(`INSERT INTO proto_markets (id, token_def_id, question, deadline_ms, min_bet, seal_count, committee_pubkeys_json, committee_privkey_enc, rootclose_tmpl_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, 'tok1', 'q?', 1700000000000, 100, 2, '[]', 'enc', 'aa'.repeat(32), now, now);
}
function mkBet({ id, marketId, side, stake, status }) {
  sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, marketId, 'bb'.repeat(32), side, stake, status, now);
}
function mkIntent({ key, betId, step, status }) {
  sqlite.prepare(`INSERT INTO proto_bet_intents (intent_key, bet_id, step, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(key, betId, step, status, now, now);
}

// ============ deriveLeafState ============
mkMarket('m_zero');
t('deriveLeafState-1: 0 注 ⇒ 全 0', () => {
  const s = deriveLeafState('m_zero');
  if (s.local_yes !== 0 || s.local_no !== 0 || s.count !== 0 || s.pool_value !== 0) throw new Error(JSON.stringify(s));
});

mkMarket('m_one');
mkBet({ id: 'b1', marketId: 'm_one', side: 0, stake: 50, status: 'confirmed' });
t('deriveLeafState-2: 1 注(side=0, stake=50) ⇒ local_yes=50, local_no=0, count=1, pool_value=50', () => {
  const s = deriveLeafState('m_one');
  if (s.local_yes !== 50 || s.local_no !== 0 || s.count !== 1 || s.pool_value !== 50) throw new Error(JSON.stringify(s));
});

mkMarket('m_three');
mkBet({ id: 'b2', marketId: 'm_three', side: 0, stake: 30, status: 'confirmed' });
mkBet({ id: 'b3', marketId: 'm_three', side: 1, stake: 70, status: 'confirmed' });
mkBet({ id: 'b4', marketId: 'm_three', side: 0, stake: 20, status: 'confirmed' });
t('deriveLeafState-3: 3 注混合两边(30@0, 70@1, 20@0) ⇒ local_yes=50, local_no=70, count=3, pool_value=120', () => {
  const s = deriveLeafState('m_three');
  if (s.local_yes !== 50 || s.local_no !== 70 || s.count !== 3 || s.pool_value !== 120) throw new Error(JSON.stringify(s));
});

mkBet({ id: 'b5_pending', marketId: 'm_three', side: 0, stake: 999, status: 'pending' });
// 🔴 D-020(账本1446/1448): 'chip_minted_pending_stake' 中间态随两步设计取消而删除(status CHECK
// 只剩 pending/confirmed)——原本要证明的"未确认不计入"性质由 pending 这一个值单独覆盖, 不需要
// 第二个未确认状态值来加强这条断言。
t('deriveLeafState-4: 未落链(pending)的下注不计入累加(只信已确认)', () => {
  const s = deriveLeafState('m_three');
  if (s.local_yes !== 50 || s.local_no !== 70 || s.count !== 3 || s.pool_value !== 120) throw new Error(`未确认行不该被计入: ${JSON.stringify(s)}`);
});

// ============ assertNoInFlightAppend ============
mkMarket('m_serial');
mkBet({ id: 'b_serial1', marketId: 'm_serial', side: 0, stake: 10, status: 'confirmed' });
t('assertNoInFlightAppend-1: 没有任何 in-flight append intent ⇒ 通过(不 throw)', () => {
  assertNoInFlightAppend('m_serial');
});
mkIntent({ key: 'proto-bet:b_serial1:append', betId: 'b_serial1', step: 'append', status: 'prepared' });
t('assertNoInFlightAppend-2: 存在 prepared 状态的 append intent ⇒ 拒绝(market_append_in_flight)', () => {
  let threw = null;
  try { assertNoInFlightAppend('m_serial'); } catch (e) { threw = e; }
  if (!threw || !/market_append_in_flight/.test(threw.message)) throw new Error('应该拒绝并报 market_append_in_flight');
});

mkMarket('m_serial_submitted');
mkBet({ id: 'b_serial2', marketId: 'm_serial_submitted', side: 0, stake: 10, status: 'confirmed' });
mkIntent({ key: 'proto-bet:b_serial2:append', betId: 'b_serial2', step: 'append', status: 'submitted' });
t('assertNoInFlightAppend-3: submitted 状态同样拒绝', () => {
  let threw = null;
  try { assertNoInFlightAppend('m_serial_submitted'); } catch (e) { threw = e; }
  if (!threw) throw new Error('应该拒绝');
});

mkMarket('m_serial_landed');
mkBet({ id: 'b_serial3', marketId: 'm_serial_landed', side: 0, stake: 10, status: 'confirmed' });
mkIntent({ key: 'proto-bet:b_serial3:append', betId: 'b_serial3', step: 'append', status: 'landed' });
t('assertNoInFlightAppend-4: 已 landed 的 append intent 不算 in-flight ⇒ 通过', () => {
  assertNoInFlightAppend('m_serial_landed');
});

// 🔴 D-020(账本1446/1448): 原"只有 mint(步骤A) intent 在飞, 不算 append in-flight"向量随两步设计
// 取消而删除——proto_bet_intents.step CHECK 现在只剩 'append' 一个值, 不存在 step='mint' 这种行了。

// ============ encodeLeafStateBytes / computeExpectedLeafScriptPubKey / assertLeafStateMatchesChain ============
t('encodeLeafStateBytes: 4 个 int 各自 [08]+8字节小端, 总长 36 字节', () => {
  const buf = encodeLeafStateBytes({ local_yes: 111, local_no: 222, count: 3, pool_value: 4444 });
  if (buf.length !== 36) throw new Error(`长度应该是 36, 实际 ${buf.length}`);
  if (buf.toString('hex') !== '086f0000000000000008de00000000000000080300000000000000085c11000000000000') {
    throw new Error(`编码不对: ${buf.toString('hex')}(应与真实编译产物 2026-09-15 手工验证过的字节一致)`);
  }
});

// 用一段假的 32 字节前段 + 36 字节任意占位 state + 若干字节后段, 模拟一个"redeem 脚本", 验证 P2SH 计算逻辑正确
// (真实端到端一致性——这份编码与真实 ShardLeaf_direct.sil 编译产物的 state 区段字节完全一致——已在
// proto-covenant-builder.test.mjs 的 T4 对照 + 上面 encodeLeafStateBytes 的真实字节向量里验证过,
// 这里只测"prefix+state+suffix 拼接与 P2SH 哈希"这段独立逻辑本身)。
const fakeRedeem = Buffer.concat([Buffer.from([0xaa]), Buffer.alloc(36, 0x00), Buffer.from([0xbb, 0xcc])]);
const fakeLayout = { start: 1, len: 36 };

t('computeExpectedLeafScriptPubKey: 不同 state 产出不同 P2SH(证明真的把 state 编码进去参与哈希, 不是忽略它)', () => {
  const spk1 = computeExpectedLeafScriptPubKey({ shardLeafRedeemScript: fakeRedeem, stateLayout: fakeLayout, state: { local_yes: 1, local_no: 0, count: 1, pool_value: 1 } });
  const spk2 = computeExpectedLeafScriptPubKey({ shardLeafRedeemScript: fakeRedeem, stateLayout: fakeLayout, state: { local_yes: 2, local_no: 0, count: 1, pool_value: 2 } });
  if (spk1 === spk2) throw new Error('不同 state 不该产出相同 P2SH');
  if (!/^0xaa20[0-9a-f]{64}87$/.test(spk1)) throw new Error(`P2SH 形状不对: ${spk1}`);
});

mkMarket('m_drift_ok');
mkBet({ id: 'b_drift_ok', marketId: 'm_drift_ok', side: 0, stake: 42, status: 'confirmed' });
const okState = { local_yes: 42, local_no: 0, count: 1, pool_value: 42 };
const okSpk = computeExpectedLeafScriptPubKey({ shardLeafRedeemScript: fakeRedeem, stateLayout: fakeLayout, state: okState });
t('assertLeafStateMatchesChain-1: 推算状态与链上 UTXO 的 scriptPubKey 一致 + 未花费 ⇒ 通过', () => {
  const r = assertLeafStateMatchesChain({ marketId: 'm_drift_ok', shardLeafRedeemScript: fakeRedeem, stateLayout: fakeLayout, chainUtxo: { scriptPublicKeyHex: okSpk, spent: false } });
  if (!r.ok) throw new Error('应该通过');
});

t('assertLeafStateMatchesChain-2: 库推算出的状态与链上实际 P2SH 差 1 sompi(某个字段改错) ⇒ leaf_state_drift', () => {
  const wrongSpk = computeExpectedLeafScriptPubKey({ shardLeafRedeemScript: fakeRedeem, stateLayout: fakeLayout, state: { ...okState, pool_value: 43 } }); // 故意错1
  let threw = null;
  try { assertLeafStateMatchesChain({ marketId: 'm_drift_ok', shardLeafRedeemScript: fakeRedeem, stateLayout: fakeLayout, chainUtxo: { scriptPublicKeyHex: wrongSpk, spent: false } }); }
  catch (e) { threw = e; }
  if (!threw || !/leaf_state_drift/.test(threw.message)) throw new Error('应该拒绝并报 leaf_state_drift');
});

t('assertLeafStateMatchesChain-3: 指针 UTXO 已被花费 ⇒ leaf_state_drift(即使 scriptPubKey 恰好还对得上)', () => {
  let threw = null;
  try { assertLeafStateMatchesChain({ marketId: 'm_drift_ok', shardLeafRedeemScript: fakeRedeem, stateLayout: fakeLayout, chainUtxo: { scriptPublicKeyHex: okSpk, spent: true } }); }
  catch (e) { threw = e; }
  if (!threw || !/leaf_state_drift/.test(threw.message)) throw new Error('应该拒绝并报 leaf_state_drift');
});

t('assertLeafStateMatchesChain-4: chainUtxo 为 null(查不到, 指针错误或已花到未追踪的输出) ⇒ leaf_state_drift', () => {
  let threw = null;
  try { assertLeafStateMatchesChain({ marketId: 'm_drift_ok', shardLeafRedeemScript: fakeRedeem, stateLayout: fakeLayout, chainUtxo: null }); }
  catch (e) { threw = e; }
  if (!threw || !/leaf_state_drift/.test(threw.message)) throw new Error('应该拒绝并报 leaf_state_drift');
});

// ============ T4 对照: computeExpectedLeafScriptPubKey 用真实 ShardLeaf_direct 编译产物,
// 与"把推算出的 state 当 ctor init_* 独立重编"两条路径算出同一个 P2SH ============
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
{
  const { computeMarketGenesisArtifacts } = await import('./proto-covenant-builder.mjs');
  const { compileSilV100, ctorBytes32V100, ctorIntV100 } = await import('./pool-bshard-artifacts.mjs');
  const { p2sh } = await import('./proto-covenant-builder.mjs');

  mkMarket('m_t4');
  mkBet({ id: 'b_t4_a', marketId: 'm_t4', side: 0, stake: 111, status: 'confirmed' });
  mkBet({ id: 'b_t4_b', marketId: 'm_t4', side: 1, stake: 222, status: 'confirmed' });

  const MARKET_ID = 'ab'.repeat(32), MIN_BET = 100, DEADLINE_MS = 1700000000000;
  const artifacts = await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: MIN_BET, deadlineMs: DEADLINE_MS });
  const stateLayout = { start: 1, len: 36 }; // ShardLeaf_direct 已知形状(多次真实编译验证过), 本处独立断言而非信任

  t('T4 对照: computeExpectedLeafScriptPubKey(基于 genesis 编译产物+推算 state) 与独立用推算 state 当 ctor 重编 ShardLeaf_direct 算出的 P2SH 逐字节一致', () => {
    const state = deriveLeafState('m_t4');
    if (state.local_yes !== 111 || state.local_no !== 222 || state.count !== 2 || state.pool_value !== 333) {
      throw new Error(`deriveLeafState 结果不对: ${JSON.stringify(state)}`);
    }
    const expectedSpk = computeExpectedLeafScriptPubKey({ shardLeafRedeemScript: artifacts.shardLeafDirect.script, stateLayout, state });

    const c = JSON.parse(fs.readFileSync('./scripts/proto-v0-template-anchors.json', 'utf8'));
    const ps_tmpl_hash = c.contracts.PoolSideTicket.ps_tmpl_hash, token_tmpl_hash = c.contracts.KanetTestToken.token_tmpl_hash;
    const independentCtor = [
      ctorBytes32V100(MARKET_ID), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
      ctorIntV100(2), ctorIntV100(MIN_BET), ctorBytes32V100(artifacts.rootCloseTmplHash), ctorBytes32V100('00'.repeat(32)),
      ctorBytes32V100(token_tmpl_hash),
      ctorIntV100(state.local_yes), ctorIntV100(state.local_no), ctorIntV100(state.count), ctorIntV100(state.pool_value),
    ];
    const independentCompiled = compileSilV100('./src/lib/ShardLeaf_direct.sil', independentCtor, 'ShardLeaf_direct');
    const independentSpk = '0x' + p2sh(Buffer.from(independentCompiled.script));
    if (independentSpk.toLowerCase() !== expectedSpk.toLowerCase()) {
      throw new Error(`computeExpectedLeafScriptPubKey(${expectedSpk}) != 独立重编译(${independentSpk}) — AB11 手写编码假设与真实编译器行为不一致`);
    }
  });
}

// ============ deriveLeafOutpoint / deriveHeldKttOutpoint(账本1439, 0/1/2笔已landed append) ============
function mkIntentFull({ key, betId, step, status, submittedTxid, landedAt }) {
  sqlite.prepare(`INSERT INTO proto_bet_intents (intent_key, bet_id, step, status, submitted_txid, landed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(key, betId, step, status, submittedTxid, landedAt, now, now);
}

mkMarket('m_op0');
sqlite.prepare(`UPDATE proto_markets SET shardleaf_txid = ?, shardleaf_vout = 0 WHERE id = ?`).run('ge'.repeat(32), 'm_op0');
t('deriveLeafOutpoint-0笔landed: 退回genesis的shardleaf_txid/vout', () => {
  const o = deriveLeafOutpoint('m_op0');
  if (o.txid !== 'ge'.repeat(32) || o.vout !== 0) throw new Error(JSON.stringify(o));
});
t('deriveHeldKttOutpoint-0笔landed: 返回null(第一笔下注形状)', () => {
  const h = deriveHeldKttOutpoint('m_op0');
  if (h !== null) throw new Error(`应该是null, 实际 ${JSON.stringify(h)}`);
});

mkMarket('m_op1');
sqlite.prepare(`UPDATE proto_markets SET shardleaf_txid = ?, shardleaf_vout = 0 WHERE id = ?`).run('ge'.repeat(32), 'm_op1');
mkBet({ id: 'b_op1', marketId: 'm_op1', side: 0, stake: 10, status: 'confirmed' });
mkIntentFull({ key: 'proto-bet:b_op1:append', betId: 'b_op1', step: 'append', status: 'landed', submittedTxid: 'a1'.repeat(32), landedAt: '2026-09-15T01:00:00.000Z' });
t('deriveLeafOutpoint-1笔landed: 用该intent的submitted_txid+续约输出索引0', () => {
  const o = deriveLeafOutpoint('m_op1');
  if (o.txid !== 'a1'.repeat(32) || o.vout !== 0) throw new Error(JSON.stringify(o));
});
t('deriveHeldKttOutpoint-1笔landed: 用该intent的submitted_txid+合并KTT输出索引2', () => {
  const h = deriveHeldKttOutpoint('m_op1');
  if (!h || h.txid !== 'a1'.repeat(32) || h.vout !== 2) throw new Error(JSON.stringify(h));
});

mkBet({ id: 'b_op1b', marketId: 'm_op1', side: 1, stake: 20, status: 'confirmed' });
mkIntentFull({ key: 'proto-bet:b_op1b:append', betId: 'b_op1b', step: 'append', status: 'landed', submittedTxid: 'a2'.repeat(32), landedAt: '2026-09-15T02:00:00.000Z' });
t('deriveLeafOutpoint-2笔landed: 取landed_at最新的那一条, 不是随便一条', () => {
  const o = deriveLeafOutpoint('m_op1');
  if (o.txid !== 'a2'.repeat(32)) throw new Error(`应该是第2笔(a2...), 实际 ${o.txid.slice(0, 8)}`);
});

mkBet({ id: 'b_op1c', marketId: 'm_op1', side: 0, stake: 30, status: 'pending' });
mkIntentFull({ key: 'proto-bet:b_op1c:append', betId: 'b_op1c', step: 'append', status: 'submitted', submittedTxid: 'a3'.repeat(32), landedAt: null });
t('deriveLeafOutpoint-submitted(未landed)的append不计入, 仍取上一笔已landed的', () => {
  const o = deriveLeafOutpoint('m_op1');
  if (o.txid !== 'a2'.repeat(32)) throw new Error(`submitted append不该被算入, 应仍是a2..., 实际 ${o.txid.slice(0, 8)}`);
});

// ============ assertHeldKttOutpointMatchesChain(账本1439②, 三种drift) ============
mkMarket('m_held_ok');
mkBet({ id: 'b_held_ok', marketId: 'm_held_ok', side: 0, stake: 42, status: 'confirmed' });
const LEAF_COV_ID = 'cc'.repeat(32);
const { computeKttGenesisArtifact } = await import('./proto-covenant-builder.mjs');
const { CONTINUATION_OUTPUT_SOMPI } = await import('./proto-tx-assembly.mjs');
const heldArtifact = computeKttGenesisArtifact({ amount: 42, ownerCovIdHex: LEAF_COV_ID });
t('assertHeldKttOutpointMatchesChain-1: scriptPubKey+value+未花费全对 ⇒ 通过', () => {
  const r = assertHeldKttOutpointMatchesChain({ marketId: 'm_held_ok', leafCovId: LEAF_COV_ID, chainUtxo: { scriptPublicKeyHex: heldArtifact.scriptPubKeyHex, spent: false, value: CONTINUATION_OUTPUT_SOMPI } });
  if (!r.ok) throw new Error('应该通过');
});
t('assertHeldKttOutpointMatchesChain-2: 已花费 ⇒ held_ktt_drift', () => {
  let threw = null;
  try { assertHeldKttOutpointMatchesChain({ marketId: 'm_held_ok', leafCovId: LEAF_COV_ID, chainUtxo: { scriptPublicKeyHex: heldArtifact.scriptPubKeyHex, spent: true, value: CONTINUATION_OUTPUT_SOMPI } }); }
  catch (e) { threw = e; }
  if (!threw || !/held_ktt_drift/.test(threw.message)) throw new Error('应该拒绝并报held_ktt_drift');
});
t('assertHeldKttOutpointMatchesChain-3: scriptPubKey不符(例如amount对不上) ⇒ held_ktt_drift', () => {
  const wrongArtifact = computeKttGenesisArtifact({ amount: 43, ownerCovIdHex: LEAF_COV_ID });
  let threw = null;
  try { assertHeldKttOutpointMatchesChain({ marketId: 'm_held_ok', leafCovId: LEAF_COV_ID, chainUtxo: { scriptPublicKeyHex: wrongArtifact.scriptPubKeyHex, spent: false, value: CONTINUATION_OUTPUT_SOMPI } }); }
  catch (e) { threw = e; }
  if (!threw || !/held_ktt_drift/.test(threw.message)) throw new Error('应该拒绝并报held_ktt_drift');
});
t('assertHeldKttOutpointMatchesChain-4: value不等于CONTINUATION_OUTPUT_SOMPI ⇒ held_ktt_drift', () => {
  let threw = null;
  try { assertHeldKttOutpointMatchesChain({ marketId: 'm_held_ok', leafCovId: LEAF_COV_ID, chainUtxo: { scriptPublicKeyHex: heldArtifact.scriptPubKeyHex, spent: false, value: CONTINUATION_OUTPUT_SOMPI - 1n } }); }
  catch (e) { threw = e; }
  if (!threw || !/held_ktt_drift/.test(threw.message)) throw new Error('应该拒绝并报held_ktt_drift');
});
t('assertHeldKttOutpointMatchesChain-5: chainUtxo为null(查不到) ⇒ held_ktt_drift', () => {
  let threw = null;
  try { assertHeldKttOutpointMatchesChain({ marketId: 'm_held_ok', leafCovId: LEAF_COV_ID, chainUtxo: null }); }
  catch (e) { threw = e; }
  if (!threw || !/held_ktt_drift/.test(threw.message)) throw new Error('应该拒绝并报held_ktt_drift');
});

// ============ assertLeafAndHeldConsistent(账本1439③) ============
t('assertLeafAndHeldConsistent-1: pool_value=0 且 held=null(第一笔下注前) ⇒ 一致, 通过', () => {
  const r = assertLeafAndHeldConsistent('m_op0');
  if (!r.ok) throw new Error('应该通过');
});
t('assertLeafAndHeldConsistent-2: pool_value>0 且 held存在(已有landed append) ⇒ 一致, 通过', () => {
  const r = assertLeafAndHeldConsistent('m_op1');
  if (!r.ok) throw new Error('应该通过');
});
t('assertLeafAndHeldConsistent-3: pool_value>0 但没有任何landed append(构造矛盾场景) ⇒ pool_state_inconsistent', () => {
  mkMarket('m_inconsistent1');
  mkBet({ id: 'b_inc1', marketId: 'm_inconsistent1', side: 0, stake: 10, status: 'confirmed' }); // 已确认但从未真的append过(数据完整性异常场景)
  let threw = null;
  try { assertLeafAndHeldConsistent('m_inconsistent1'); } catch (e) { threw = e; }
  if (!threw || !/pool_state_inconsistent/.test(threw.message)) throw new Error('应该拒绝并报pool_state_inconsistent');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
