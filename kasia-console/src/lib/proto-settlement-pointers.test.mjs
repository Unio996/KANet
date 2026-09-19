// proto-settlement-pointers.test.mjs — 批9 9-1 D 笔: 结算各步"预期输入指针"模块(设计 v0.3.4 §18.1 / §19.2 / §19.5 P 组)。
// 夹具: 真 migration 临时库(DB_PATH)+ 真 kaspa-wasm 交易(Transaction / CovenantBinding / populateGenesisCovenants / finalize / serializeToSafeJSON——与各 builder 同一组 API),
//   链 = 两笔 append(A1 A2)→ seal(S)→ close_commit(CC, intent step='resolve')→ convert_to_claim(V), 输入输出布局与 builder 一致(下标取自 E 笔导出的常量之外, 这里用字面量独立写出)。
// 🟡 诚实边界: 交易是"按 builder 的输出布局用同一组 wasm API 造出来的", 不是 builder 的真实产物(真实 builder 链由 proto-claim-draw / golden 测试覆盖, 真链证据在 9-4 simnet);
//   spk 除 ticket 外是占位(指针模块不验它们, 那是 C1/M6 在链上取证时的事); ticket spk 来自真实的 computeTicketGenesisArtifact。
// 零链 / 零 IPC / 零私钥。Run: cd kasia-console && node src/lib/proto-settlement-pointers.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_POINTERS_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_pointers_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_POINTERS_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}
const kaspa = await import('kaspa-wasm');
const { sqlite } = await import('../db/client.js');
const { resolveStepPointers, PointerError, pointerCodes } = await import('./proto-settlement-pointers.mjs');
const { STEP_INPUT_ROLES } = await import('./proto-settlement-chain-checks.mjs');
const { deriveLeafOutpoint, deriveHeldKttOutpoint } = await import('./proto-leaf-state.mjs');
const { computeTicketGenesisArtifact } = await import('./proto-covenant-builder.mjs');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'eq'}: 期望 ${String(b)}, 实际 ${String(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const jeq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m || 'jeq'}:\n  ${x}\n  != ${y}`); };
const CODES = pointerCodes();
const seenCodes = new Set();
function rejP(fn, code, where = {}) {
  let e = null;
  try { fn(); } catch (x) { e = x; }
  if (!e) throw new Error(`应该抛 ${code}, 实际成功返回`);
  if (!(e instanceof PointerError)) throw new Error(`应该是 PointerError, 实际 ${e && e.constructor && e.constructor.name}: ${e && e.message}`);
  if (e.code !== code) throw new Error(`期望 code=${code}, 实际 ${e.code}: ${e.detail}`);
  if (!CODES.includes(e.code)) throw new Error(`code ${e.code} 不在闭集内`);
  for (const [k, v] of Object.entries(where)) if (e[k] !== v) throw new Error(`.${k} 期望 ${v}, 实际 ${e[k]}`);
  seenCodes.add(e.code);
  return e;
}

// ── 夹具 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const hex = (label) => Buffer.from(label.padEnd(32, '_').slice(0, 32)).toString('hex');           // 64 位小写 hex
const spkOf = (label) => 'aa20' + hex(label) + '87';
const noPrefix = (h) => String(h).replace(/^0x/, '').toLowerCase();
const PK1 = '11'.repeat(32), PK2 = '22'.repeat(32);
const LEAFCOV = hex('leaf-covenant'), BOGUS_COV = 'ee'.repeat(32);
const V20 = 20_000_000n;
let seq = 0;
const newMarketId = () => hex(`market-${++seq}`);
const T0 = '2026-09-20T00:00:01.000Z', T1 = '2026-09-20T00:00:02.000Z';
const now0 = '2026-09-20T00:00:00.000Z';

sqlite.prepare(`INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)`).run('tok1', 'Test', 'TST', now0);

function buildTx(spec) {
  const spkObj = (h) => new kaspa.ScriptPublicKey(0, h);
  const inputs = spec.ins.map((op) => {
    const previousOutpoint = { transactionId: op.txid, index: op.index };
    return { previousOutpoint, signatureScript: new Uint8Array([1, 2, 3]), sequence: 0n, sigOpCount: 2, computeBudget: 70, utxo: { outpoint: previousOutpoint, amount: 50000000n, scriptPublicKey: spkObj(spkOf('prev')), blockDaaScore: 7n } };
  });
  const tx = new kaspa.Transaction({
    version: 1, inputs, outputs: spec.outs.map((o) => new kaspa.TransactionOutput(V20, spkObj(o.spk))),
    lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  });
  const groups = [];
  spec.outs.forEach((o, i) => {
    if (o.mode === 'cont') tx.outputs[i].covenant = new kaspa.CovenantBinding(o.auth, new kaspa.Hash(o.covId));
    if (o.mode === 'genesis') groups.push(new kaspa.GenesisCovenantGroup(o.auth, [i]));
  });
  if (groups.length) tx.populateGenesisCovenants(groups);
  tx.finalize();
  const outs = tx.outputs;
  const covIds = outs.map((o) => (o.covenant ? String(o.covenant.covenantId).toLowerCase() : null));
  const res = { id: String(tx.id).toLowerCase(), json: tx.serializeToSafeJSON(), covIds, spec };
  tx.free();
  return res;
}
const cont = (label, covId, auth = 0) => ({ spk: spkOf(label), mode: 'cont', covId, auth });
const gen = (label, auth) => ({ spk: spkOf(label), mode: 'genesis', auth });
const plain = (spk) => ({ spk, mode: 'plain' });
const ticketSpk = (pk, side, stake, M) => noPrefix(computeTicketGenesisArtifact({ bettorPk: pk, direction: side, stake, shardPoolId: M }).scriptPubKeyHex);

let chainSeq = 0;
/** 造一条完整链并写库。mods: {A1,A2,S,CC,V: spec=>spec 改交易布局; winningSide; bet2Ticket:(A2)=>({txid,vout}); swapAppendOrder; sameLandedAt} */
function seedChain(M, mods = {}) {
  const n = ++chainSeq;
  const genesisTxid = hex(`genesis-${n}`);
  const fee = (l) => ({ txid: hex(`fee-${l}-${n}`), index: 0 });
  const ext = (name, spec) => (mods[name] ? mods[name](spec) : spec);
  const A1 = buildTx(ext('A1', { ins: [{ txid: genesisTxid, index: 0 }, fee('a1')], outs: [cont('leaf', LEAFCOV, 0), plain(ticketSpk(PK1, 0, 10, M)), gen('ktt1', 1)] }));
  const A2 = buildTx(ext('A2', { ins: [{ txid: A1.id, index: 0 }, { txid: A1.id, index: 2 }, fee('a2')], outs: [cont('leaf', LEAFCOV, 0), plain(ticketSpk(PK2, 1, 990, M)), gen('ktt2', 2)] }));
  const S = buildTx(ext('S', { ins: [{ txid: A2.id, index: 0 }, { txid: A2.id, index: 2 }, fee('s')], outs: [gen('rootclose', 2), gen('token-rc', 2)] }));
  const CC = buildTx(ext('CC', { ins: [{ txid: S.id, index: 0 }, fee('cc')], outs: [cont('rootclose-closed', S.covIds[0] ?? BOGUS_COV, 0)] }));
  const V = buildTx(ext('V', { ins: [{ txid: CC.id, index: 0 }, { txid: S.id, index: 1 }, fee('v')], outs: [gen('rootclaim', 2), gen('token-rclaim', 2)] }));

  sqlite.prepare(`INSERT INTO proto_markets (id, token_def_id, question, deadline_ms, min_bet, seal_count, committee_pubkeys_json, committee_privkey_enc, rootclose_tmpl_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(M, 'tok1', 'q?', 1700000000000, 1, 2, '[]', 'enc', 'aa'.repeat(32), now0, now0);
  sqlite.prepare('UPDATE proto_markets SET status = ?, winning_side = ?, shardleaf_txid = ?, shardleaf_vout = ?, shardleaf_cov_id = ? WHERE id = ?').run('resolved', mods.winningSide ?? 1, genesisTxid, 0, LEAFCOV, M);
  const b1 = `bet${n}-1`, b2 = `bet${n}-2`;
  const tk2 = mods.bet2Ticket ? mods.bet2Ticket(A2) : { txid: A2.id, vout: 1 };
  const insBet = (id, pk, side, stake, tx, vout) => sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, ticket_txid, ticket_vout, created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(id, M, pk, side, stake, 'confirmed', tx, vout, now0);
  insBet(b1, PK1, 0, 10, A1.id, 1);
  insBet(b2, PK2, 1, 990, tk2.txid, tk2.vout);
  const insBetIntent = (key, betId, tx, landedAt) => sqlite.prepare(`INSERT INTO proto_bet_intents (intent_key, bet_id, step, status, prepared_txid, prepared_tx_json, submitted_txid, landed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(key, betId, 'append', 'landed', tx.id, tx.json, tx.id, landedAt, now0, now0);
  const la1 = mods.sameLandedAt ? T1 : T0;
  if (mods.swapAppendOrder) { insBetIntent(`bet:${b2}:append`, b2, A2, T1); insBetIntent(`bet:${b1}:append`, b1, A1, la1); }
  else { insBetIntent(`bet:${b1}:append`, b1, A1, la1); insBetIntent(`bet:${b2}:append`, b2, A2, T1); }
  const insSettle = (step, tx) => sqlite.prepare(`INSERT INTO proto_settlement_intents (intent_key, subject_type, subject_id, step, status, prepared_txid, prepared_tx_json, submitted_txid, landed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(`settle:market:${M}:${step}`, 'market', M, step, 'landed', tx.id, tx.json, tx.id, T1, now0, now0);
  insSettle('seal', S); insSettle('resolve', CC);
  // convert_to_claim 意图挂在 claim 主体下(intent 模块的 STEP_SUBJECT_TYPE; 原夹具插成 market 主体是造不出来的键)——9-2b 离线端到端暴露后改为真 claim 行 + claim 主体
  const claimId = hex(`claim-${n}`);
  sqlite.prepare("INSERT INTO proto_claims (id, market_id, bettor_pk, side, amount, created_at) VALUES (?,?,?,'win',?,?)").run(claimId, M, PK2, 990, now0);
  sqlite.prepare(`INSERT INTO proto_settlement_intents (intent_key, subject_type, subject_id, step, status, prepared_txid, prepared_tx_json, submitted_txid, landed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(`settle:claim:${claimId}:convert_to_claim`, 'claim', claimId, 'convert_to_claim', 'landed', V.id, V.json, V.id, T1, now0, now0);
  return { M, A1, A2, S, CC, V, b1, b2, claimId, keys: { A1: `bet:${b1}:append`, A2: `bet:${b2}:append`, S: `settle:market:${M}:seal`, CC: `settle:market:${M}:resolve`, V: `settle:claim:${claimId}:convert_to_claim` } };
}
const seed = (mods) => seedChain(newMarketId(), mods);
const res = (step, M) => resolveStepPointers({ step, marketId: M, db: sqlite, kaspa });
const snapAll = (M) => JSON.stringify(['seal', 'close_commit', 'convert_to_claim', 'claim_draw'].map((s) => res(s, M)));
const setJson = (table, key, fn) => {
  const row = sqlite.prepare(`SELECT prepared_tx_json FROM ${table} WHERE intent_key = ?`).get(key);
  const j = JSON.parse(row.prepared_tx_json); fn(j);
  sqlite.prepare(`UPDATE ${table} SET prepared_tx_json = ? WHERE intent_key = ?`).run(JSON.stringify(j), key);
};
const setCol = (table, key, col, v) => sqlite.prepare(`UPDATE ${table} SET ${col} = ? WHERE intent_key = ?`).run(v, key);
const op = (txid, index) => ({ transactionId: txid, index });

// ══ P1–P8: 八格各一个正向 ═══════════════════════════════════════════════════════════════════════════════════════════
await t('P1/P2 seal 步(格 1 seal·leaf、格 2 seal·held): 取自最新 landed append(A2)的输出 0 / 2; leaf 的 covenantId = proto_markets.shardleaf_cov_id, held 的 = 该 append 输出[2] 的 genesis covenantId(每笔 append 都不同)', async () => {
  const c = seed(); const r = res('seal', c.M);
  jeq(Object.keys(r.roles), STEP_INPUT_ROLES.seal);
  jeq(r.roles.leaf, { outpoint: op(c.A2.id, 0), expectedCovenantId: LEAFCOV, source: 'append', producedBy: { table: 'proto_bet_intents', key: c.keys.A2 } });
  jeq(r.roles.held, { outpoint: op(c.A2.id, 2), expectedCovenantId: c.A2.covIds[2], source: 'append', producedBy: { table: 'proto_bet_intents', key: c.keys.A2 } });
  if (c.A2.covIds[2] === c.A1.covIds[2]) throw new Error('夹具应使两笔 append 的 KTT covenantId 不同(否则本用例分不出"取的是哪一笔")');
});
await t('P1b 没有任何 landed 的 append: leaf 退回 genesis(proto_markets.shardleaf_txid/vout, source=genesis); 但 seal 步没有 held ⇒ pointer_dependency_not_landed', async () => {
  const M = newMarketId();
  sqlite.prepare(`INSERT INTO proto_markets (id, token_def_id, question, deadline_ms, min_bet, seal_count, committee_pubkeys_json, committee_privkey_enc, rootclose_tmpl_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(M, 'tok1', 'q?', 1700000000000, 1, 2, '[]', 'enc', 'aa'.repeat(32), now0, now0);
  rejP(() => res('seal', M), 'pointer_dependency_not_landed', { role: 'leaf' });                       // 创世未落链(shardleaf_txid 空)
  sqlite.prepare('UPDATE proto_markets SET shardleaf_txid = ?, shardleaf_vout = 0, shardleaf_cov_id = ? WHERE id = ?').run(hex('g0'), LEAFCOV, M);
  rejP(() => res('seal', M), 'pointer_dependency_not_landed', { role: 'held' });
  rejP(() => res('close_commit', M), 'pointer_dependency_not_landed');
  rejP(() => resolveStepPointers({ step: 'seal', marketId: hex('no-such-market'), db: sqlite, kaspa }), 'pointer_dependency_not_landed');
});
await t('P1c 指针取的 append 与 proto-leaf-state.deriveLeafOutpoint / deriveHeldKttOutpoint 取的是同一笔(两处查询排序一致)', async () => {
  const c = seed(); const r = res('seal', c.M);
  const lo = deriveLeafOutpoint(c.M), ho = deriveHeldKttOutpoint(c.M);
  eq(lo.txid, r.roles.leaf.outpoint.transactionId); eq(lo.vout, r.roles.leaf.outpoint.index);
  eq(ho.txid, r.roles.held.outpoint.transactionId); eq(ho.vout, r.roles.held.outpoint.index);
});
await t('P3 close_commit 步(格 3): rootClose = seal 意图(landed)的输出 0, covenantId = 该输出的 genesis covenantId', async () => {
  const c = seed(); const r = res('close_commit', c.M);
  jeq(Object.keys(r.roles), STEP_INPUT_ROLES.close_commit);
  jeq(r.roles.rootClose, { outpoint: op(c.S.id, 0), expectedCovenantId: c.S.covIds[0], source: 'settlement', producedBy: { table: 'proto_settlement_intents', key: c.keys.S } });
});
await t('P4/P5 convert_to_claim 步(格 4 rootClose、格 5 held): rootClose = close_commit(intent step=resolve)输出 0 且 covenantId 与格 3 相等(续约保持 id); held = seal 输出 1', async () => {
  const c = seed(); const r = res('convert_to_claim', c.M);
  jeq(Object.keys(r.roles), STEP_INPUT_ROLES.convert_to_claim);
  jeq(r.roles.rootClose, { outpoint: op(c.CC.id, 0), expectedCovenantId: c.S.covIds[0], source: 'settlement', producedBy: { table: 'proto_settlement_intents', key: c.keys.CC } });
  eq(c.CC.covIds[0], c.S.covIds[0], '夹具: 续约保持 covenant id');
  jeq(r.roles.held, { outpoint: op(c.S.id, 1), expectedCovenantId: c.S.covIds[1], source: 'settlement', producedBy: { table: 'proto_settlement_intents', key: c.keys.S } });
});
await t('P6/P7/P8 claim_draw 步(格 6 rootClaim、格 7 held、格 8 ticket): rootClaim / held = convert_to_claim 意图输出 0 / 1; ticket = 赢家那一条下注(bet2)的 landed append 意图输出 1, 无 covenant', async () => {
  const c = seed(); const r = res('claim_draw', c.M);
  jeq(Object.keys(r.roles), STEP_INPUT_ROLES.claim_draw);
  jeq(r.roles.rootClaim, { outpoint: op(c.V.id, 0), expectedCovenantId: c.V.covIds[0], source: 'settlement', producedBy: { table: 'proto_settlement_intents', key: c.keys.V } });
  jeq(r.roles.held, { outpoint: op(c.V.id, 1), expectedCovenantId: c.V.covIds[1], source: 'settlement', producedBy: { table: 'proto_settlement_intents', key: c.keys.V } });
  jeq(r.roles.ticket, { outpoint: op(c.A2.id, 1), expectedCovenantId: null, source: 'bet', producedBy: { table: 'proto_bet_intents', key: c.keys.A2 } });
});
await t('P8b 赢家票 = winnerBetId 那一行(不是"最新的 append"): 胜方改成 side=0(bet1)⇒ 票取自 bet1 的 append(A1)输出 1', async () => {
  const c = seed({ winningSide: 0 }); const r = res('claim_draw', c.M);
  jeq(r.roles.ticket, { outpoint: op(c.A1.id, 1), expectedCovenantId: null, source: 'bet', producedBy: { table: 'proto_bet_intents', key: c.keys.A1 } });
});

// ══ P9 系列: prepared_tx_json 的完整性(finalize / 读取范围 / 损坏) ═══════════════════════════════════════════════════
const TAMPER_TARGETS = [['A2', 'proto_bet_intents', 'seal'], ['S', 'proto_settlement_intents', 'close_commit'], ['CC', 'proto_settlement_intents', 'convert_to_claim'], ['V', 'proto_settlement_intents', 'claim_draw']];
await t('P9 ▲ 篡改 prepared_tx_json 的一个输出面值(JSON 里自带的 id 字段没动)⇒ pointer_txid_mismatch——deserializeFromSafeJSON 不重算 id, 只有 finalize() 才暴露(去掉 finalize / 改读原始 JSON 的变异必红)', async () => {
  for (const [name, table, step] of TAMPER_TARGETS) {
    const c = seed(); res(step, c.M);
    setJson(table, c.keys[name], (j) => { j.outputs[0].value = String(BigInt(j.outputs[0].value) + 1n); });
    rejP(() => res(step, c.M), 'pointer_txid_mismatch', { step });
  }
});
await t('P9b ▲ 篡改输出的 covenant id(被 txid 覆盖)⇒ 同码 pointer_txid_mismatch', async () => {
  for (const [name, table, step] of TAMPER_TARGETS) {
    const c = seed();
    setJson(table, c.keys[name], (j) => { j.outputs[0].covenant.covenantId = '11'.repeat(32); });
    rejP(() => res(step, c.M), 'pointer_txid_mismatch', { step });
  }
});
await t('P9c 篡改【不被 txid 覆盖】的字段(computeBudget / sigOpCount / signatureScript / utxo.amount)⇒ 四步的指针结果逐字段不变(证明模块没读它们); 对照: 篡改被覆盖的 sequence ⇒ 拒(证明篡改手段本身有效)', async () => {
  const c = seed(); const before = snapAll(c.M);
  for (const [key, table] of [[c.keys.A1, 'proto_bet_intents'], [c.keys.A2, 'proto_bet_intents'], [c.keys.S, 'proto_settlement_intents'], [c.keys.CC, 'proto_settlement_intents'], [c.keys.V, 'proto_settlement_intents']]) {
    setJson(table, key, (j) => { for (const i of j.inputs) { i.computeBudget = 99; i.sigOpCount = 9; i.signatureScript = 'deadbeef'; if (i.utxo) i.utxo.amount = '1'; } });
  }
  eq(snapAll(c.M), before, '不被覆盖的字段改动后指针应逐字段不变');
  setJson('proto_settlement_intents', c.keys.S, (j) => { j.inputs[0].sequence = '5'; });
  rejP(() => res('close_commit', c.M), 'pointer_txid_mismatch');
});
await t('P9d prepared_tx_json 不是合法 JSON / 不是交易 ⇒ pointer_tx_malformed(与"列为空"分开)', async () => {
  for (const bad of ['{not json', '{"x":1}', '[]', '42']) {
    const c = seed(); setCol('proto_settlement_intents', c.keys.S, 'prepared_tx_json', bad);
    rejP(() => res('close_commit', c.M), 'pointer_tx_malformed', { step: 'close_commit' });
  }
});
await t('P9e prepared_tx_json 为 NULL / 空串 / 纯空白 ⇒ pointer_tx_missing; landed 行的 submitted_txid 为空或非法 ⇒ pointer_txid_mismatch', async () => {
  for (const v of [null, '', '   ']) { const c = seed(); setCol('proto_settlement_intents', c.keys.S, 'prepared_tx_json', v); rejP(() => res('close_commit', c.M), 'pointer_tx_missing'); }
  for (const v of [null, 'nothex', 'AB'.repeat(32).slice(0, 10)]) {
    const c = seed(); setCol('proto_settlement_intents', c.keys.S, 'submitted_txid', v);
    const e = rejP(() => res('close_commit', c.M), 'pointer_txid_mismatch');
    if (!/submitted_txid 缺失或不是 64 位 hex/.test(e.detail)) throw new Error(`报文应指明 submitted_txid 本身有问题(不是 id 比对失败): ${e.detail}`);
  }
  const c = seed(); setCol('proto_settlement_intents', c.keys.S, 'submitted_txid', c.S.id.toUpperCase());
  eq(res('close_commit', c.M).roles.rootClose.outpoint.transactionId, c.S.id, 'submitted_txid 大小写不敏感, 指针恒为小写');
});

// ══ P10 谱系 / P11 covenantId 一致 / P16 genesis 独立重算 ════════════════════════════════════════════════════════════
await t('P10 ▲ 谱系断开(只读 previousOutpoint): seal 的输入 0/1 没花掉最新 append 的输出(含"同 txid 另一 index")/ close_commit 的输入 0 没花掉 seal 输出 0 / convert_to_claim 的输入 0、1 没花掉 close_commit 输出 0、seal 输出 1 ⇒ pointer_lineage_mismatch; 且更早的步骤不受影响', async () => {
  const cases = [
    ['S 输入0 花了别处', { S: (s) => { s.ins[0] = { txid: hex('elsewhere'), index: 0 }; return s; } }, 'close_commit', 'seal'],
    ['S 输入0 同 txid 另一 index', { S: (s) => { s.ins[0] = { ...s.ins[0], index: 1 }; return s; } }, 'close_commit', 'seal'],
    ['S 输入1(held)花了别处', { S: (s) => { s.ins[1] = { txid: hex('elsewhere2'), index: 2 }; return s; } }, 'close_commit', 'seal'],
    ['CC 输入0 花了别处', { CC: (s) => { s.ins[0] = { txid: hex('elsewhere3'), index: 0 }; return s; } }, 'convert_to_claim', 'close_commit'],
    ['CC 输入0 同 txid 另一 index', { CC: (s) => { s.ins[0] = { ...s.ins[0], index: 1 }; return s; } }, 'convert_to_claim', 'close_commit'],
    ['V 输入0(rootClose)花了别处', { V: (s) => { s.ins[0] = { txid: hex('elsewhere4'), index: 0 }; return s; } }, 'claim_draw', 'convert_to_claim'],
    ['V 输入1(held)花了别处', { V: (s) => { s.ins[1] = { txid: hex('elsewhere5'), index: 1 }; return s; } }, 'claim_draw', 'convert_to_claim'],
    ['V 输入1 同 txid 另一 index', { V: (s) => { s.ins[1] = { ...s.ins[1], index: 0 }; return s; } }, 'claim_draw', 'convert_to_claim'],
  ];
  for (const [name, mods, badStep, okStep] of cases) {
    const c = seed(mods);
    res(okStep, c.M);                                                                                     // 更早的步骤照常通过
    rejP(() => res(badStep, c.M), 'pointer_lineage_mismatch', { step: badStep });
    void name;
  }
});
await t('P11 ▲ covenantId 不一致: close_commit 输出的 covenantId ≠ seal 输出 0 的(续约必须保持 id)⇒ 拒; append 输出 0 的 covenantId ≠ proto_markets.shardleaf_cov_id ⇒ 拒', async () => {
  const c1 = seed({ CC: (s) => { s.outs[0] = cont('rootclose-closed', BOGUS_COV, 0); return s; } });
  res('close_commit', c1.M);
  rejP(() => res('convert_to_claim', c1.M), 'pointer_covenant_inconsistent', { step: 'convert_to_claim', role: 'rootClose' });
  const c2 = seed({ A2: (s) => { s.outs[0] = cont('leaf', BOGUS_COV, 0); return s; } });
  rejP(() => res('seal', c2.M), 'pointer_covenant_inconsistent', { step: 'seal', role: 'leaf' });
  const c3 = seed({ CC: (s) => { s.outs[0] = plain(spkOf('rootclose-closed')); return s; } });            // 续约输出没有 covenant
  rejP(() => res('convert_to_claim', c3.M), 'pointer_covenant_inconsistent');
});
await t('P16 ▲ genesis 组输出的 covenantId 与 kaspa.covenantId(authorizing 输入 outpoint, [该输出]) 独立重算不等 ⇒ 拒(校验 builder 的 genesis 派生, 不是防 DB 篡改: 这些交易 txid 自洽); 期望 genesis 的输出没有 covenant 也拒', async () => {
  const bogus = (label, auth) => cont(label, BOGUS_COV, auth);
  const cases = [
    ['A2 输出2(合并 KTT)', { A2: (s) => { s.outs[2] = bogus('ktt2', 2); return s; } }, 'seal'],
    ['S 输出0(RootClose)', { S: (s) => { s.outs[0] = bogus('rootclose', 2); return s; } }, 'close_commit'],
    ['S 输出1(代币)', { S: (s) => { s.outs[1] = bogus('token-rc', 2); return s; } }, 'close_commit'],
    ['V 输出0(RootClaim)', { V: (s) => { s.outs[0] = bogus('rootclaim', 2); return s; } }, 'claim_draw'],
    ['V 输出1(代币)', { V: (s) => { s.outs[1] = bogus('token-rclaim', 2); return s; } }, 'claim_draw'],
    ['S 输出0 没有 covenant', { S: (s) => { s.outs[0] = plain(spkOf('rootclose')); return s; } }, 'close_commit'],
  ];
  for (const [name, mods, step] of cases) { const c = seed(mods); rejP(() => res(step, c.M), 'pointer_covenant_inconsistent', { step }); void name; }
  // authorizing 输入指错(covenant 是按另一个输入派生的)也算不一致: 用 auth=0 造 genesis 形状的 id, 但 populate 时按 auth=2 派生 ⇒ 这里直接让输出声明 auth=0 的 bogus id
  const c = seed(); res('claim_draw', c.M);
});
await t('P17 输出下标越界 ⇒ pointer_output_missing(seal 只剩 1 个输出 / convert_to_claim 只剩 1 个输出)', async () => {
  const c1 = seed({ S: (s) => { s.outs = s.outs.slice(0, 1); return s; } });
  rejP(() => res('close_commit', c1.M), 'pointer_output_missing', { step: 'close_commit' });
  const c2 = seed({ V: (s) => { s.outs = s.outs.slice(0, 1); return s; } });
  res('convert_to_claim', c2.M);
  rejP(() => res('claim_draw', c2.M), 'pointer_output_missing', { step: 'claim_draw' });
});

// ══ P12 赢家 / P13 前置未 landed / P15 票不一致 ═══════════════════════════════════════════════════════════════════
await t('P12 胜方已确认下注 ≠ 1(0 条 / 2 条 / winning_side 未写)⇒ pointer_winner_ambiguous(复用 deriveWinnerBet 的 fail-closed 语义, 不另写一份)', async () => {
  const c0 = seed(); sqlite.prepare(`UPDATE proto_bets SET status = 'pending' WHERE id = ?`).run(c0.b2);
  rejP(() => res('claim_draw', c0.M), 'pointer_winner_ambiguous', { step: 'claim_draw', role: 'ticket' });
  const c2 = seed(); sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES (?,?,?,?,?,?,?)`).run(`${c2.b1}-extra`, c2.M, PK1, 1, 5, 'confirmed', now0);
  const e = rejP(() => res('claim_draw', c2.M), 'pointer_winner_ambiguous');
  if (!/恰好 1 条/.test(e.detail)) throw new Error(`应带 deriveWinnerBet 的原报文: ${e.detail}`);
  const cn = seed(); sqlite.prepare('UPDATE proto_markets SET winning_side = NULL WHERE id = ?').run(cn.M);
  rejP(() => res('claim_draw', cn.M), 'pointer_winner_ambiguous');
  res('convert_to_claim', cn.M);                                                                        // 更早的步骤不取赢家, 不受影响
});
await t('P13 前置意图不是 landed ⇒ pointer_dependency_not_landed(seal / resolve / convert_to_claim 各为 submitted 或缺行或 ambiguous; 赢家那笔 append 未 landed)', async () => {
  for (const status of ['submitted', 'prepared', 'ambiguous', 'pending']) {
    const c = seed();
    setCol('proto_settlement_intents', c.keys.S, 'status', status); rejP(() => res('close_commit', c.M), 'pointer_dependency_not_landed', { step: 'close_commit' });
    const d = seed(); setCol('proto_settlement_intents', d.keys.CC, 'status', status); res('close_commit', d.M); rejP(() => res('convert_to_claim', d.M), 'pointer_dependency_not_landed');
    const e = seed(); setCol('proto_settlement_intents', e.keys.V, 'status', status); res('convert_to_claim', e.M); rejP(() => res('claim_draw', e.M), 'pointer_dependency_not_landed');
  }
  const lat = seed(); setCol('proto_bet_intents', lat.keys.A2, 'status', 'submitted');                     // 最新的 append(A2)还没 landed ⇒ "最新 landed 的 append"是 A1
  eq(res('seal', lat.M).roles.leaf.outpoint.transactionId, lat.A1.id, 'append 的选取必须只看 landed');
  rejP(() => res('close_commit', lat.M), 'pointer_lineage_mismatch');                                    // seal 花的是 A2, 与"最新 landed 的 append = A1"对不上
  const gone = seed(); sqlite.prepare('DELETE FROM proto_settlement_intents WHERE intent_key = ?').run(gone.keys.CC);
  rejP(() => res('convert_to_claim', gone.M), 'pointer_dependency_not_landed');
  const w = seed({ winningSide: 0 }); setCol('proto_bet_intents', w.keys.A1, 'status', 'submitted');       // 赢家是 bet1, 其 append 未 landed; 最新 landed append 仍是 A2, seal/谱系不受影响
  res('convert_to_claim', w.M);
  rejP(() => res('claim_draw', w.M), 'pointer_dependency_not_landed', { step: 'claim_draw', role: 'ticket' });
});
await t('P14 append 的 landed_at 同毫秒平局 ⇒ 取 rowid 大者(append 严格串行 ⇒ 创建顺序 == 落链顺序); 指针模块与 proto-leaf-state 两处查询取同一笔', async () => {
  const c = seed({ sameLandedAt: true, swapAppendOrder: true });                                        // A1 的行后插入(rowid 更大)且 landed_at 与 A2 相同 ⇒ A1 应胜出
  const r = res('seal', c.M);
  eq(r.roles.leaf.outpoint.transactionId, c.A1.id, '平局应取 rowid 大者(A1)'); eq(r.roles.held.outpoint.transactionId, c.A1.id);
  const lo = deriveLeafOutpoint(c.M), ho = deriveHeldKttOutpoint(c.M);
  eq(lo.txid, c.A1.id, 'deriveLeafOutpoint 同一平局规则'); eq(ho.txid, c.A1.id, 'deriveHeldKttOutpoint 同一平局规则');
  const d = seed({ sameLandedAt: true });                                                               // 常规插入顺序: A2 后插入 ⇒ A2
  eq(res('seal', d.M).roles.leaf.outpoint.transactionId, d.A2.id); eq(deriveLeafOutpoint(d.M).txid, d.A2.id);
});
await t('P15 ▲ 票三者不一致 ⇒ pointer_ticket_inconsistent(proto_bets.ticket_txid ≠ append 意图 submitted_txid / ticket_vout ≠ 1 / 输出 spk ≠ 现算 ticket spk / 输出带 covenant); 更早的步骤不受影响', async () => {
  const cases = [
    ['ticket_txid 不等', { bet2Ticket: () => ({ txid: hex('some-other-tx'), vout: 1 }) }],
    ['ticket_vout=2', { bet2Ticket: (A2) => ({ txid: A2.id, vout: 2 }) }],
    ['ticket_vout=0', { bet2Ticket: (A2) => ({ txid: A2.id, vout: 0 }) }],
    ['输出 spk 不是现算的', { A2: (s) => { s.outs[1] = plain(spkOf('wrong-ticket')); return s; } }],
    ['输出带 covenant', { A2: (s) => { s.outs[1] = { ...cont('ticket', BOGUS_COV, 0), spk: s.outs[1].spk }; return s; } }],
  ];
  for (const [name, mods] of cases) {
    const c = seed(mods);
    res('convert_to_claim', c.M);
    const e = rejP(() => res('claim_draw', c.M), 'pointer_ticket_inconsistent', { step: 'claim_draw', role: 'ticket' });
    void name; void e;
  }
});

// ══ 收尾: 闭集 / 入参 / 边界 ═══════════════════════════════════════════════════════════════════════════════════════
await t('闭集: pointerCodes() = 设计 §19.2 的 9 个(冻结); 上面各用例见到的每个失败 code 都在其中, 且 9 个都至少被触发过一次(闭集里没有死码)', async () => {
  eq(CODES.length, 9); if (!Object.isFrozen(CODES)) throw new Error('必须冻结');
  for (const c of ['pointer_dependency_not_landed', 'pointer_tx_missing', 'pointer_tx_malformed', 'pointer_txid_mismatch', 'pointer_output_missing', 'pointer_lineage_mismatch', 'pointer_covenant_inconsistent', 'pointer_winner_ambiguous', 'pointer_ticket_inconsistent']) {
    if (!CODES.includes(c)) throw new Error(`缺 ${c}`);
    if (!seenCodes.has(c)) throw new Error(`${c} 从未被触发过`);
  }
});
await t('调用方错误 ⇒ TypeError(未知步骤 / marketId 非 64 位小写 hex / 缺 db / 缺 kaspa)', async () => {
  const c = seed(); const A = (o) => () => resolveStepPointers({ step: 'seal', marketId: c.M, db: sqlite, kaspa, ...o });
  for (const o of [{ step: 'refund' }, { step: undefined }, { marketId: 'abc' }, { marketId: c.M.toUpperCase() }, { marketId: undefined }, { db: undefined }, { db: {} }, { kaspa: undefined }, { kaspa: {} }]) {
    let e = null; try { A(o)(); } catch (x) { e = x; } if (!(e instanceof TypeError)) throw new Error(`${JSON.stringify(Object.keys(o))} 应 TypeError, 实际 ${e && e.constructor.name}`);
  }
});
// ══ 9-1 F3 笔(NWT D-1 / D-2) ═══════════════════════════════════════════════════════════════════════════════════════════
function trackedKaspa({ failFinalize = false } = {}) {
  const st = { txCreated: 0, txFreed: 0, outCreated: 0, outFreed: 0 };
  class TrackedOut extends kaspa.TransactionOutput { constructor(...a) { super(...a); st.outCreated++; } free() { st.outFreed++; return super.free(); } }
  const Transaction = {
    deserializeFromSafeJSON: (j) => {
      const tx = kaspa.Transaction.deserializeFromSafeJSON(j); st.txCreated++;
      const origFree = tx.free.bind(tx); tx.free = () => { st.txFreed++; return origFree(); };
      if (failFinalize) tx.finalize = () => { throw new Error('boom: finalize 失败(注入)'); };
      return tx;
    },
  };
  return { st, k: { ...kaspa, Transaction, TransactionOutput: TrackedOut } };
}
const resWith = (k, step, M) => resolveStepPointers({ step, marketId: M, db: sqlite, kaspa: k });
await t('D-1 ▲ wasm 对象释放有测试守着: 每次装载的 Transaction 恰好释放一次(成功路径四步: 装载 1/2/3/5 笔, 创建数 == 释放数), 每个 covenant 输出的独立重算用的 TransactionOutput 也显式释放', async () => {
  const c = seed();
  const expectLoaded = { seal: 1, close_commit: 2, convert_to_claim: 3, claim_draw: 5 };            // A2 | +S | +CC | +V 与赢家 append(= A2 再载一次)
  for (const step of ['seal', 'close_commit', 'convert_to_claim', 'claim_draw']) {
    const { st, k } = trackedKaspa(); resWith(k, step, c.M);
    eq(st.txCreated, expectLoaded[step], `${step}: 装载笔数`); eq(st.txFreed, st.txCreated, `${step}: Transaction 创建数 == 释放数`);
    ok(st.outCreated > 0, `${step}: 应创建过 TransactionOutput(genesis 重算)`); eq(st.outFreed, st.outCreated, `${step}: TransactionOutput 创建数 == 释放数`);
  }
});
await t('F3-1 ▲ covenantId 本身抛错的路径: probe TransactionOutput 仍被释放(创建数 == 释放数), 报 pointer_covenant_inconsistent(genesisId=null)——变异"probe.free() 挪出 finally、只在 covenantId 成功后释放"必红', async () => {
  const c = seed(); const { st, k } = trackedKaspa();
  const kThrow = { ...k, covenantId: () => { throw new Error('boom: covenantId 抛错(注入)'); } };
  rejP(() => resWith(kThrow, 'seal', c.M), 'pointer_covenant_inconsistent');
  ok(st.outCreated > 0, '应创建过 probe TransactionOutput');
  eq(st.outFreed, st.outCreated, 'covenantId 抛错路径: TransactionOutput 创建数 == 释放数');
  eq(st.txFreed, st.txCreated, 'covenantId 抛错路径: Transaction 创建数 == 释放数');
});
await t('D-1 ▲ 错误路径同样释放: finalize() 抛错 ⇒ pointer_tx_malformed 且已释放; id 不符(篡改)⇒ pointer_txid_mismatch 且已释放; 谱系断开 / covenant 不一致 / 输出缺失 / 票不一致(此前已装载的交易全部释放)', async () => {
  { const c = seed(); const { st, k } = trackedKaspa({ failFinalize: true });
    rejP(() => resWith(k, 'seal', c.M), 'pointer_tx_malformed'); eq(st.txCreated, 1); eq(st.txFreed, 1, 'finalize 抛错路径'); }
  { const c = seed(); setJson('proto_settlement_intents', c.keys.S, (j) => { j.outputs[0].value = String(BigInt(j.outputs[0].value) + 1n); });
    const { st, k } = trackedKaspa(); rejP(() => resWith(k, 'close_commit', c.M), 'pointer_txid_mismatch'); ok(st.txCreated >= 2); eq(st.txFreed, st.txCreated, 'id 不符路径'); }
  const paths = [
    [{ S: (s) => { s.ins[0] = { txid: hex('elsewhere'), index: 0 }; return s; } }, 'close_commit', 'pointer_lineage_mismatch'],
    [{ CC: (s) => { s.outs[0] = cont('rootclose-closed', BOGUS_COV, 0); return s; } }, 'convert_to_claim', 'pointer_covenant_inconsistent'],
    [{ V: (s) => { s.outs = s.outs.slice(0, 1); return s; } }, 'claim_draw', 'pointer_output_missing'],
    [{ bet2Ticket: () => ({ txid: hex('some-other-tx'), vout: 1 }) }, 'claim_draw', 'pointer_ticket_inconsistent'],
  ];
  for (const [mods, step, code] of paths) { const c = seed(mods); const { st, k } = trackedKaspa(); rejP(() => resWith(k, step, c.M), code); ok(st.txCreated > 0); eq(st.txFreed, st.txCreated, `${code} 路径`); eq(st.outFreed, st.outCreated, `${code} 路径的 TransactionOutput`); }
});
await t('D-2 ▲ import 指针模块不再打开默认库(真 import 图证明, 不是只扫本文件的 import 行): 子进程在【无 DB_PATH】下真 import 指针 / C1 / chain-checks / builder / winner-bet / leaf-state-encode 全部成功; 对照臂: 带 DB 客户端的 proto-settlement-inputs / proto-leaf-state 在同样条件下必被 M0a 拒(证明这个探测手段本身有效)', async () => {
  const env = { ...process.env }; delete env.DB_PATH; delete env._PROTO_POINTERS_TEST_BOOTSTRAPPED;
  const probe = (mod) => spawnSync(process.execPath, ['-e', `import('./src/lib/${mod}').then(() => console.log('IMPORT-OK')).catch((e) => { console.log('IMPORT-FAIL: ' + String(e.message).split('\\n')[0].slice(0, 120)); process.exitCode = 1; })`], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 60000 });
  for (const mod of ['proto-settlement-pointers.mjs', 'proto-settlement-c1.mjs', 'proto-settlement-chain-checks.mjs', 'proto-tx-assembly-settlement.mjs', 'proto-tx-assembly.mjs', 'proto-winner-bet.mjs', 'proto-leaf-state-encode.mjs']) {
    const r = probe(mod); if (!/IMPORT-OK/.test(r.stdout || '')) throw new Error(`${mod} 在无 DB_PATH 下 import 失败: ${(r.stdout || '') + (r.stderr || '')}`.slice(0, 300));
  }
  for (const mod of ['proto-settlement-inputs.mjs', 'proto-leaf-state.mjs']) {
    const r = probe(mod); if (!/IMPORT-FAIL: .*DB_PATH not set/.test(r.stdout || '')) throw new Error(`对照臂 ${mod} 应被 M0a 拒(否则探测手段无效): ${(r.stdout || '') + (r.stderr || '')}`.slice(0, 300));
  }
  // encodeLeafStateBytes 搬家后: 两处导出是同一个函数(re-export 保持既有 import 方不变)
  const a = (await import('./proto-leaf-state.mjs')).encodeLeafStateBytes, b = (await import('./proto-leaf-state-encode.mjs')).encodeLeafStateBytes;
  ok(a === b, 'proto-leaf-state 应 re-export 同一个 encodeLeafStateBytes');
});
await t('模块边界: 源码(去注释)不 import kaspa-wasm / relay 通道 / DB 客户端 / better-sqlite3, 不读 process.env; 不读不被 txid 覆盖的字段(utxo / signatureScript / computeBudget / sigOpCount); 只 import 既定的四个模块', async () => {
  const src = fs.readFileSync(new URL('./proto-settlement-pointers.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const bad = [/from\s+['"]kaspa-wasm['"]/, /import\s*\(\s*['"]kaspa-wasm/, /relay-manager/, /proto-relay-ipc/, /db\/client/, /better-sqlite3/, /\bprocess\.env\b/, /\bsendCommand/, /\.utxo\b/, /signatureScript/, /computeBudget/, /sigOpCount/, /\.run\(/, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/];
  jeq(bad.filter((re) => re.test(src)).map(String), []);
  const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
  jeq(imports, ['./proto-covenant-builder.mjs', './proto-tx-assembly-settlement.mjs', './proto-tx-assembly.mjs', './proto-winner-bet.mjs']);   // F3: 不再经 proto-settlement-inputs.mjs(带 db/client.js)
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
