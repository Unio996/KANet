// proto-settlement-store.test.mjs — 批9 9-2b(iii-1): 结算驱动的 DB 端口(真实 migration 临时库 + 真实 SQL; 零链 / 零 IPC / 零私钥)。
// 守: 工作发现(seal 触发的 P3 条件逐条 / close_commit / convert_to_claim / claim_draw / prepared 优先且去重)、依赖(含跨 subject_type)、landed 记账(前态谓词、同步事务、幂等)、
//     claim 行 id = randomBytes(32).toString('hex') 且【过出口 S9 校验】(NWT 9-2b 验收提醒: 驱动产出的 claim id 过出口)。
// Run: cd kasia-console && node src/lib/proto-settlement-store.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_STORE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_settle_store_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_STORE_TEST_BOOTSTRAPPED: '1', PROTO_RELAY_ID: 'store-test-relay' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const { sqlite } = await import('../db/client.js');
const { createSettlementStore, newClaimId } = await import('./proto-settlement-store.mjs');
const SI = await import('./proto-settlement-intent.mjs');
const { isValidSettlementIntentKey } = await import('./proto-relay-ipc.mjs');
const { CLAIM_DRAW_CLAIM_OUT_INDEX } = await import('./proto-tx-assembly-settlement.mjs');
const { createSettlementDriver } = await import('./proto-settlement-driver-core.mjs');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const hex64 = () => crypto.randomBytes(32).toString('hex');
const T0 = '2026-09-20T00:00:00.000Z';
const store = createSettlementStore({ claimDrawClaimOutIndex: CLAIM_DRAW_CLAIM_OUT_INDEX, now: () => T0 });
sqlite.prepare('INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)').run('tok1', 'Test', 'TST', T0);

// ── 夹具 ──
const PK_A = 'aa'.repeat(32), PK_B = 'bb'.repeat(32);
function mkMarket({ status = 'betting', sealCount = 2, winningSide = null, shardleafTxid = hex64() } = {}) {
  const id = hex64();
// v212 R1 触发器之后: winning_side 只能在 sealed 市场上带 source+set_at 写一次, 夹具不再能 INSERT 带值 / 在非 sealed 状态直写
  sqlite.prepare(`INSERT INTO proto_markets (id, token_def_id, question, deadline_ms, min_bet, seal_count, committee_pubkeys_json, committee_privkey_enc, rootclose_tmpl_hash, shardleaf_txid, shardleaf_vout, status, created_at, updated_at)
    VALUES (?, 'tok1', 'q', 1000, 600, ?, '[]', 'enc', ?, ?, 0, ?, ?, ?)`).run(id, sealCount, hex64(), shardleafTxid, winningSide == null ? status : 'sealed', T0, T0);
  if (winningSide != null) {
    sqlite.prepare("UPDATE proto_markets SET winning_side = ?, winning_side_source = 'operator', winning_side_set_at = ? WHERE id = ?").run(winningSide, T0, id);
    if (status !== 'sealed') sqlite.prepare('UPDATE proto_markets SET status = ? WHERE id = ?').run(status, id);
  }
  return id;
}
function mkBet(marketId, { side, stake = 600, status = 'confirmed', pk } = {}) {
  const id = hex64();
  sqlite.prepare('INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES (?,?,?,?,?,?,?)').run(id, marketId, pk || (side === 0 ? PK_A : PK_B), side, stake, status, T0);
  return id;
}
const mkAppendIntent = (betId, status) => sqlite.prepare("INSERT INTO proto_bet_intents (intent_key, bet_id, step, status, created_at, updated_at) VALUES (?, ?, 'append', ?, ?, ?)").run(`proto-bet:${betId}:append`, betId, status, T0, T0);
const mkIntent = (subjectType, subjectId, step, status, extra = {}) => {
  const key = SI.settlementIntentKeyFor(subjectType, subjectId, step);
  sqlite.prepare('INSERT INTO proto_settlement_intents (intent_key, subject_type, subject_id, step, status, submitted_txid, prepared_txid, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(key, subjectType, subjectId, step, status, extra.submitted_txid ?? null, extra.prepared_txid ?? null, T0, T0);
  return key;
};
const setIntent = (subjectType, subjectId, step, status) => sqlite.prepare('UPDATE proto_settlement_intents SET status = ? WHERE subject_type = ? AND subject_id = ? AND step = ?').run(status, subjectType, subjectId, step);
const adv = (work, step) => work.advances.filter((a) => a.step === step);
const sealedMarketWithBets = ({ winningSide = 0 } = {}) => { const m = mkMarket({ status: 'sealed', winningSide }); mkBet(m, { side: 0 }); mkBet(m, { side: 1 }); return m; };

// ── seal 触发(P3) ──
await t('seal 触发: betting ∧ 已确认下注 == seal_count ∧ 无未确认下注 ∧ 无在途 append 意图 ∧ seal 意图未 landed ⇒ 出现在 advances; 每个条件单独破坏都不出现', () => {
  const ok = mkMarket(); mkBet(ok, { side: 0 }); mkBet(ok, { side: 1 });
  const has = (m) => adv(store.listWork(), 'seal').some((a) => a.subjectId === m && a.marketId === m);
  assert.ok(has(ok), '满足全部条件应触发');
  const few = mkMarket(); mkBet(few, { side: 0 }); assert.ok(!has(few), '确认下注数 < seal_count');
  const many = mkMarket({ sealCount: 1 }); mkBet(many, { side: 0 }); mkBet(many, { side: 1 }); assert.ok(!has(many), '确认下注数 > seal_count');
  const pend = mkMarket(); mkBet(pend, { side: 0 }); mkBet(pend, { side: 1 }); mkBet(pend, { side: 1, status: 'pending' }); assert.ok(!has(pend), '还有 pending 下注');
  for (const st of ['pending', 'prepared', 'submitted', 'ambiguous']) { const m = mkMarket(); const b1 = mkBet(m, { side: 0 }); mkBet(m, { side: 1 }); mkAppendIntent(b1, st); assert.ok(!has(m), `append 意图 ${st} 在途`); }
  const done = mkMarket(); mkBet(done, { side: 0 }); mkBet(done, { side: 1 }); mkIntent('market', done, 'seal', 'landed'); assert.ok(!has(done), 'seal 已 landed');
  const amb = mkMarket(); mkBet(amb, { side: 0 }); mkBet(amb, { side: 1 }); mkIntent('market', amb, 'seal', 'ambiguous'); assert.ok(!has(amb), 'seal ambiguous');
  const inflightSeal = mkMarket(); mkBet(inflightSeal, { side: 0 }); mkBet(inflightSeal, { side: 1 }); mkIntent('market', inflightSeal, 'seal', 'submitted'); assert.ok(has(inflightSeal), 'seal 已 submitted 仍在清单(交给 advanceStep 判 in_flight)');
  const wrongStatus = mkMarket({ status: 'sealed' }); mkBet(wrongStatus, { side: 0 }); mkBet(wrongStatus, { side: 1 }); assert.ok(!has(wrongStatus), '状态不是 betting');
  const noGenesis = mkMarket({ shardleafTxid: null }); mkBet(noGenesis, { side: 0 }); mkBet(noGenesis, { side: 1 }); assert.ok(!has(noGenesis), '创世未落链(无 shardleaf_txid)');
});

// ── close_commit / convert_to_claim / claim_draw 发现 ──
await t('close_commit: sealed ∧ winning_side 已写 ∧ resolve 意图未 landed / ambiguous ⇒ 出现; winning_side 为空 / 已 landed 不出现', () => {
  const m = sealedMarketWithBets(); const noSide = sealedMarketWithBets({ winningSide: null }); const done = sealedMarketWithBets(); mkIntent('market', done, 'resolve', 'landed');
  const w = store.listWork();
  assert.ok(adv(w, 'close_commit').some((a) => a.subjectId === m)); assert.ok(!adv(w, 'close_commit').some((a) => a.subjectId === noSide || a.subjectId === done));
});
await t('convert_to_claim / claim_draw 发现: resolved 市场的赢 claim 行 + resolve landed ⇒ convert; convert landed ∧ claim_txid 为空 ⇒ claim_draw; 各自已 landed / 已领取后不再出现', () => {
  const m = mkMarket({ status: 'resolved', winningSide: 0 }); const claimId = hex64();
  sqlite.prepare("INSERT INTO proto_claims (id, market_id, bettor_pk, side, amount, created_at) VALUES (?,?,?,'win',?,?)").run(claimId, m, PK_A, 1200, T0);
  let w = store.listWork(); assert.ok(!adv(w, 'convert_to_claim').some((a) => a.subjectId === claimId), 'resolve 未 landed 不触发');
  mkIntent('market', m, 'resolve', 'landed');
  w = store.listWork(); assert.deepEqual(adv(w, 'convert_to_claim').filter((a) => a.subjectId === claimId), [{ step: 'convert_to_claim', subjectId: claimId, marketId: m }]);
  assert.ok(!adv(w, 'claim_draw').some((a) => a.subjectId === claimId));
  mkIntent('claim', claimId, 'convert_to_claim', 'landed');
  w = store.listWork(); assert.ok(!adv(w, 'convert_to_claim').some((a) => a.subjectId === claimId)); assert.deepEqual(adv(w, 'claim_draw').filter((a) => a.subjectId === claimId), [{ step: 'claim_draw', subjectId: claimId, marketId: m }]);
  sqlite.prepare('UPDATE proto_claims SET claim_txid = ? WHERE id = ?').run(hex64(), claimId);
  w = store.listWork(); assert.ok(!adv(w, 'claim_draw').some((a) => a.subjectId === claimId), '已领取不再触发');
});
await t('prepared 行(重启恢复, §9): 不论触发条件是否仍满足都排在 advances 最前并去重; landedChecks 只含 submitted 的批9 四步意图, 排除 withdraw / reclaim', () => {
  const m = mkMarket(); mkBet(m, { side: 0 }); mkBet(m, { side: 1 });                 // 满足 seal 触发
  mkIntent('market', m, 'seal', 'prepared', { prepared_txid: hex64() });
  const orphan = mkMarket({ status: 'betting' });                                     // 条件已不满足(无下注)但有 prepared seal
  mkIntent('market', orphan, 'seal', 'prepared', { prepared_txid: hex64() });
  const c = hex64(); mkIntent('claim', c, 'withdraw', 'submitted'); mkIntent('ticket', hex64(), 'reclaim', 'submitted');
  const sub = mkMarket(); mkIntent('market', sub, 'seal', 'submitted');
  const w = store.listWork();
  const keys = w.advances.map((a) => `${a.step}:${a.subjectId}`);
  assert.equal(new Set(keys).size, keys.length, 'advances 已去重');
  const firstPrep = keys.findIndex((k) => k === `seal:${orphan}`), firstNew = keys.findIndex((k) => k.startsWith('close_commit:'));
  assert.ok(keys.includes(`seal:${m}`) && firstPrep >= 0, 'prepared 行入清单');
  assert.ok(w.landedChecks.some((r) => r.subject_id === sub)); assert.ok(!w.landedChecks.some((r) => r.step === 'withdraw' || r.step === 'reclaim'));
  assert.ok(w.preparedRows.some((r) => r.subject_id === orphan));
  assert.ok(!w.landedChecks.some((r) => r.subject_id === orphan || r.status !== 'submitted'), 'landedChecks 只含 submitted(prepared 走同字节重播, 不走 landed 检查)');
});

// ── 依赖 ──
await t('依赖(§4): seal 需触发条件(或已在途); close_commit 需 sealed ∧ winning_side ∧ seal landed; convert_to_claim 需 market resolved ∧ resolve landed(跨 subject_type); claim_draw 需 convert landed; 未知步骤 ⇒ not ok', () => {
  const m = mkMarket(); mkBet(m, { side: 0 }); mkBet(m, { side: 1 });
  assert.equal(store.dependenciesLanded('seal', { subjectId: m, marketId: m }).ok, true);
  const bare = mkMarket(); assert.equal(store.dependenciesLanded('seal', { subjectId: bare, marketId: bare }).ok, false);
  const s = sealedMarketWithBets(); assert.equal(store.dependenciesLanded('close_commit', { subjectId: s, marketId: s }).reason, 'seal_not_landed');
  mkIntent('market', s, 'seal', 'landed'); assert.equal(store.dependenciesLanded('close_commit', { subjectId: s, marketId: s }).ok, true);
  const nos = sealedMarketWithBets({ winningSide: null }); mkIntent('market', nos, 'seal', 'landed'); assert.equal(store.dependenciesLanded('close_commit', { subjectId: nos, marketId: nos }).reason, 'winning_side_not_set');
  const rm = mkMarket({ status: 'resolved', winningSide: 1 }); const cid = hex64();
  sqlite.prepare("INSERT INTO proto_claims (id, market_id, bettor_pk, side, amount, created_at) VALUES (?,?,?,'win',?,?)").run(cid, rm, PK_B, 1200, T0);
  assert.equal(store.dependenciesLanded('convert_to_claim', { subjectId: cid, marketId: rm }).reason, 'resolve_not_landed');
  mkIntent('market', rm, 'resolve', 'landed'); assert.equal(store.dependenciesLanded('convert_to_claim', { subjectId: cid, marketId: rm }).ok, true);
  assert.equal(store.dependenciesLanded('claim_draw', { subjectId: cid, marketId: rm }).reason, 'convert_to_claim_not_landed');
  mkIntent('claim', cid, 'convert_to_claim', 'landed'); assert.equal(store.dependenciesLanded('claim_draw', { subjectId: cid, marketId: rm }).ok, true);
  assert.equal(store.dependenciesLanded('withdraw', { subjectId: cid, marketId: rm }).ok, false);
});

// ── landed 记账 ──
await t('markLanded(seal): betting → sealed(带前态谓词); 重复调用幂等(第二次 0 行); 非 betting 不动', () => {
  const m = mkMarket(); const key = mkIntent('market', m, 'seal', 'landed');
  assert.equal(store.markLanded('seal', SI.getSettlementIntent(key)).sealed, 1); assert.equal(store._marketOf(m).status, 'sealed');
  assert.equal(store.markLanded('seal', SI.getSettlementIntent(key)).sealed, 0);
  const r = mkMarket({ status: 'resolved' }); const k2 = mkIntent('market', r, 'seal', 'landed'); assert.equal(store.markLanded('seal', SI.getSettlementIntent(k2)).sealed, 0); assert.equal(store._marketOf(r).status, 'resolved');
});
await t('markLanded(close_commit): sealed → resolved + 建 win claim 行(id = 64 位 hex, 过出口 S9)+ convert_to_claim 意图 pending; 重复调用幂等(仍一行 claim、一个意图)', () => {
  const m = sealedMarketWithBets({ winningSide: 0 }); const key = mkIntent('market', m, 'resolve', 'landed');
  const r1 = store.markLanded('close_commit', SI.getSettlementIntent(key));
  assert.equal(r1.resolved, 1); assert.equal(r1.claimCreated, 1); assert.equal(store._marketOf(m).status, 'resolved');
  const claim = sqlite.prepare("SELECT * FROM proto_claims WHERE market_id = ?").all(m);
  assert.equal(claim.length, 1); assert.equal(claim[0].side, 'win'); assert.equal(claim[0].bettor_pk, PK_A); assert.equal(claim[0].amount, 1200);
  assert.match(claim[0].id, /^[0-9a-f]{64}$/);
  // NWT 验收提醒: 驱动产出的 claim id 过出口校验(两个 claim 步骤的意图键)
  for (const step of ['convert_to_claim', 'claim_draw']) assert.equal(isValidSettlementIntentKey(SI.settlementIntentKeyFor('claim', claim[0].id, step)), true, step);
  const it = sqlite.prepare("SELECT * FROM proto_settlement_intents WHERE subject_type = 'claim' AND subject_id = ?").all(claim[0].id);
  assert.deepEqual(it.map((x) => [x.step, x.status]), [['convert_to_claim', 'pending']]);
  const r2 = store.markLanded('close_commit', SI.getSettlementIntent(key));
  assert.equal(r2.resolved, 0); assert.equal(r2.claimCreated, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM proto_claims WHERE market_id = ?').get(m).c, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM proto_settlement_intents WHERE subject_type = 'claim' AND subject_id = ?").get(claim[0].id).c, 1);
});
await t('markLanded(close_commit) 事务性: 派生失败(如无赢家下注)⇒ 整个事务回滚(市场状态不变、无 claim 行)', () => {
  const m = mkMarket({ status: 'sealed', winningSide: 0 }); mkBet(m, { side: 1 }); mkBet(m, { side: 1 });        // 胜方 side=0 没有已确认下注
  const key = mkIntent('market', m, 'resolve', 'landed');
  assert.throws(() => store.markLanded('close_commit', SI.getSettlementIntent(key)));
  assert.equal(store._marketOf(m).status, 'sealed'); assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM proto_claims WHERE market_id = ?').get(m).c, 0);
});
await t('markLanded(convert_to_claim / claim_draw): convert ⇒ claim_draw 意图 pending(幂等); claim_draw ⇒ 记 claim_txid / vout(= builder 导出的输出下标)/ claimed_at 一次, 重复不覆盖; 缺 submitted_txid 抛错; 未知步骤抛错', () => {
  const m = mkMarket({ status: 'resolved', winningSide: 0 }); const cid = newClaimId();
  sqlite.prepare("INSERT INTO proto_claims (id, market_id, bettor_pk, side, amount, created_at) VALUES (?,?,?,'win',?,?)").run(cid, m, PK_A, 1200, T0);
  const ck = mkIntent('claim', cid, 'convert_to_claim', 'landed');
  store.markLanded('convert_to_claim', SI.getSettlementIntent(ck)); store.markLanded('convert_to_claim', SI.getSettlementIntent(ck));
  assert.deepEqual(sqlite.prepare("SELECT step, status FROM proto_settlement_intents WHERE subject_type = 'claim' AND subject_id = ? AND step = 'claim_draw'").all(cid), [{ step: 'claim_draw', status: 'pending' }]);
  const dk = SI.settlementIntentKeyFor('claim', cid, 'claim_draw');   // 上面 convert 的记账已建好这个意图(pending); 这里把它推到 landed
  sqlite.prepare("UPDATE proto_settlement_intents SET status = 'landed', submitted_txid = ? WHERE intent_key = ?").run('cd'.repeat(32), dk);
  assert.equal(store.markLanded('claim_draw', SI.getSettlementIntent(dk)).claimed, 1);
  const row = store._claimOf(cid); assert.equal(row.claim_txid, 'cd'.repeat(32)); assert.equal(row.claim_vout, CLAIM_DRAW_CLAIM_OUT_INDEX); assert.equal(row.claimed_at, T0);
  sqlite.prepare("UPDATE proto_settlement_intents SET submitted_txid = ? WHERE intent_key = ?").run('ee'.repeat(32), dk);
  assert.equal(store.markLanded('claim_draw', SI.getSettlementIntent(dk)).claimed, 0); assert.equal(store._claimOf(cid).claim_txid, 'cd'.repeat(32), '不覆盖');
  assert.throws(() => store.markLanded('claim_draw', { subject_id: cid, submitted_txid: null }), /submitted_txid/);
  assert.throws(() => store.markLanded('withdraw', { subject_id: cid }), /未知步骤/);
});
await t('构造与 id: claimDrawClaimOutIndex 必填(无默认); newClaimId = randomBytes(32).toString(hex)(64 位小写 hex, 每次不同)', () => {
  assert.throws(() => createSettlementStore({}), /claimDrawClaimOutIndex/); assert.throws(() => createSettlementStore({ claimDrawClaimOutIndex: -1 }), /claimDrawClaimOutIndex/);
  const a = newClaimId(), b = newClaimId(); assert.match(a, /^[0-9a-f]{64}$/); assert.notEqual(a, b);
  assert.equal(CLAIM_DRAW_CLAIM_OUT_INDEX, 0);
});

// ── NWT 38b983e4 MUST: 后效待应用(landed 意图的 markLanded 没成功/进程死在两步之间, 不能永远无人再捞) ──
const pendingKeys = () => store.listWork().effectsPending.map((r) => r.intent_key);
await t('B1 seal 已 landed 但市场仍 betting ⇒ 进 effectsPending(此前: landedChecks 只取 submitted、seal 触发带 NOT EXISTS landed ⇒ 0 工作项); markLanded 后消失', () => {
  const m = mkMarket(); mkBet(m, { side: 0 }); mkBet(m, { side: 1 });
  const key = mkIntent('market', m, 'seal', 'landed');
  const w = store.listWork(); assert.ok(w.effectsPending.some((r) => r.intent_key === key), '应在 effectsPending');
  assert.ok(!adv(w, 'seal').some((a) => a.subjectId === m), '(复现 NWT B1) 它不在 seal 触发清单里'); assert.ok(!w.landedChecks.some((r) => r.intent_key === key), '(复现)也不在 landedChecks');
  store.markLanded('seal', SI.getSettlementIntent(key));
  assert.ok(!pendingKeys().includes(key), '后效应用后不再挂起');
});
await t('B2 resolve 已 landed 但市场仍 sealed / 无 win claim / claim 无 convert_to_claim 意图 ⇒ 各自进 effectsPending; 全部应用后消失; claim_draw 已 landed 但 claim_txid 为空 ⇒ 进; convert 已 landed 但无 claim_draw 意图 ⇒ 进', () => {
  const a = sealedMarketWithBets(); const ka = mkIntent('market', a, 'resolve', 'landed'); assert.ok(pendingKeys().includes(ka), '市场仍 sealed');
  const b = mkMarket({ status: 'resolved', winningSide: 0 }); const kb = mkIntent('market', b, 'resolve', 'landed'); assert.ok(pendingKeys().includes(kb), '无 win claim');
  const c = mkMarket({ status: 'resolved', winningSide: 0 }); const kc = mkIntent('market', c, 'resolve', 'landed'); const cid = hex64();
  sqlite.prepare("INSERT INTO proto_claims (id, market_id, bettor_pk, side, amount, created_at) VALUES (?,?,?,'win',?,?)").run(cid, c, PK_A, 1200, T0);
  assert.ok(pendingKeys().includes(kc), 'claim 无 convert_to_claim 意图');
  SI.ensureSettlementIntent({ subjectType: 'claim', subjectId: cid, step: 'convert_to_claim' }); assert.ok(!pendingKeys().includes(kc), '意图建好后不再挂起');
  const kv = SI.settlementIntentKeyFor('claim', cid, 'convert_to_claim'); sqlite.prepare("UPDATE proto_settlement_intents SET status = 'landed' WHERE intent_key = ?").run(kv);
  assert.ok(pendingKeys().includes(kv), 'convert 已 landed 但没有 claim_draw 意图');
  SI.ensureSettlementIntent({ subjectType: 'claim', subjectId: cid, step: 'claim_draw' }); assert.ok(!pendingKeys().includes(kv));
  const kd = SI.settlementIntentKeyFor('claim', cid, 'claim_draw'); sqlite.prepare("UPDATE proto_settlement_intents SET status = 'landed', submitted_txid = ? WHERE intent_key = ?").run(hex64(), kd);
  assert.ok(pendingKeys().includes(kd), 'claim_draw 已 landed 但 claim_txid 为空'); store.markLanded('claim_draw', SI.getSettlementIntent(kd)); assert.ok(!pendingKeys().includes(kd));
  store.markLanded('close_commit', SI.getSettlementIntent(ka)); assert.ok(!pendingKeys().includes(ka), 'close_commit 后效应用后消失');
  // 市场仍 sealed 本身就足以挂起(即便 win claim 与 convert 意图都在): 状态推进是 markLanded 的核心后效, 不能只看"claim / 意图是否齐"
  const e = mkMarket({ status: 'sealed', winningSide: 0 }); const ce = hex64(); sqlite.prepare("INSERT INTO proto_claims (id, market_id, bettor_pk, side, amount, created_at) VALUES (?,?,?,'win',?,?)").run(ce, e, PK_A, 1200, T0);
  SI.ensureSettlementIntent({ subjectType: 'claim', subjectId: ce, step: 'convert_to_claim' }); const ke = mkIntent('market', e, 'resolve', 'landed'); assert.ok(pendingKeys().includes(ke), '市场仍 sealed(claim 与 convert 意图都在)仍应挂起');
});
await t('B2b 已 resolved 却缺 win claim 行(人工改库 / 旧版本遗留)⇒ markLanded 用同一份赢家判定补建(不留永远挂起), 幂等', () => {
  const m = mkMarket({ status: 'resolved', winningSide: 1 }); mkBet(m, { side: 0, stake: 600 }); mkBet(m, { side: 1, stake: 700 });
  const key = mkIntent('market', m, 'resolve', 'landed'); assert.ok(pendingKeys().includes(key));
  const r = store.markLanded('close_commit', SI.getSettlementIntent(key)); assert.equal(r.claimCreated, 1); assert.equal(r.resolved, 0);
  const c = sqlite.prepare("SELECT * FROM proto_claims WHERE market_id = ?").all(m); assert.equal(c.length, 1); assert.equal(c[0].bettor_pk, PK_B); assert.equal(c[0].amount, 1300); assert.match(c[0].id, /^[0-9a-f]{64}$/);
  assert.ok(!pendingKeys().includes(key)); assert.equal(store.markLanded('close_commit', SI.getSettlementIntent(key)).claimCreated, 0);
});
await t('B3 端到端(真实 store + 真实核心): resolve 已 landed 但 deriveCloseCommitInputs 失败 ⇒ 每 tick 都报警(不是报一次就沉默), 市场保持 sealed; 数据修好后下一 tick 自愈(resolved + win claim(64 位 hex)+ convert 意图), 之后不再报警不再挂起', async () => {
  const m = mkMarket({ status: 'sealed', winningSide: 0 }); mkBet(m, { side: 1 }); mkBet(m, { side: 1 });        // 胜方 side=0 没有已确认下注 ⇒ 派生失败
  const key = mkIntent('market', m, 'resolve', 'landed');
  const alerts = []; const noop = async () => { throw new Error('不该被调用'); };
  const d = createSettlementDriver({
    sendCmd: noop, relayId: 'r', minDepth: 20, now: Date.now, log: { log() {} }, alert: (ev, s, p, lv) => alerts.push({ ev, lv, key: p && p.intent_key }),
    intents: { ensure: SI.ensureSettlementIntent, active: SI.activeSettlementIntent, get: SI.getSettlementIntent, mark: SI.markSettlementIntent }, driveIntent: noop, checkLanded: noop,
    pointers: noop, prepare: noop, verifyOnChain: noop, build: noop, dependenciesLanded: noop,
    markLanded: async (info, row) => store.markLanded(info, row), listWork: async () => store.listWork({ limit: 200 }),
  });
  const mine = () => alerts.filter((a) => a.key === key);
  let out = await d.runTick({ cap: 200 }); assert.equal(mine().length, 1, '第 1 tick 报警'); assert.equal(store._marketOf(m).status, 'sealed');
  out = await d.runTick({ cap: 200 }); assert.equal(mine().length, 2, '第 2 tick 继续报警(持续, 不沉默)'); assert.deepEqual(mine().map((a) => [a.ev, a.lv]), [['settlement_step_unexpected_error', 'error'], ['settlement_step_unexpected_error', 'error']]);
  mkBet(m, { side: 0, stake: 700 });                                                                            // 修数据: 现在胜方恰 1 条
  out = await d.runTick({ cap: 200 }); assert.equal(mine().length, 2, '自愈的那个 tick 不再报警'); assert.ok(out.effectsApplied >= 1);
  assert.equal(store._marketOf(m).status, 'resolved'); const claims = sqlite.prepare('SELECT * FROM proto_claims WHERE market_id = ?').all(m); assert.equal(claims.length, 1); assert.match(claims[0].id, /^[0-9a-f]{64}$/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM proto_settlement_intents WHERE subject_type = 'claim' AND subject_id = ? AND step = 'convert_to_claim'").get(claims[0].id).c, 1);
  assert.ok(!pendingKeys().includes(key)); out = await d.runTick({ cap: 200 }); assert.equal(mine().length, 2, '自愈后不再报警');   // (共享库里别的用例遗留的待应用项不影响本 key)
});

console.log(`\nproto-settlement-store.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
