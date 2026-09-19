// proto-settlement-intent.test.mjs — 结算六步(market_seal/close_commit/convert_to_claim/
// claim_draw/withdraw/输家ticket自我回收)状态机离线向量 (J2 2026-09-16, 设计
// docs/2026-09-16-j2-proto-v0-settlement-design-v0.1.md §2、实现计划v0.2 §3/§7批2，Owner D-022批准)。
// 真 migration 临时库(DB_PATH) + 假 sendCmd(脚本化 relay), 零链零 IPC。同 proto-bet-intent.test.mjs 手法
// (本模块结构直接移植自它, 泛化 subject_type/subject_id；depends_on 在这里真实使用, 是与
// proto-bet-intent.mjs 最大的行为差异, ⑦组专门测这条)。
// Run: cd kasia-console && node src/lib/proto-settlement-intent.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_SETTLEMENT_INTENT_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_settlement_intent_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_SETTLEMENT_INTENT_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: 'mainnet' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const SI = await import('./proto-settlement-intent.mjs');
const {
  driveSettlementIntent, checkSettlementIntentLanded, resumeStaleSettlementIntents, recordSettlementIntentPhase,
  getSettlementIntent, ensureSettlementIntent, markSettlementIntent, settlementIntentKeyFor, isDependencyLanded,
} = SI;
const { PROTO_COVENANT_BROADCAST_TYPE } = await import('./proto-relay-guard.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}: ${JSON.stringify(cond)}`); fails++; } };
const quiet = { log: () => {}, error: () => {} };

// 造测试用的 proto_markets/proto_token_defs/proto_claims 行(FK 目标, 不测这些表本身的逻辑, 只满足外键)。
function seedMarket(marketId, tokenDefId = 't1') {
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT OR IGNORE INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)`).run(tokenDefId, 'Test', 'TST', now);
  sqlite.prepare(`INSERT OR IGNORE INTO proto_markets (id,token_def_id,deadline_ms,min_bet,committee_pubkeys_json,committee_privkey_enc,rootclose_tmpl_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(marketId, tokenDefId, 1700000000000, 100, '[]', 'enc', 'aa'.repeat(32), now, now);
}
function seedClaim(claimId, marketId) {
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT OR IGNORE INTO proto_claims (id,market_id,bettor_pk,side,amount,created_at) VALUES (?,?,?,?,?,?)`)
    .run(claimId, marketId, 'bb'.repeat(32), 'win', 1000, now);
}

function makeRelay() {
  const R = { mempool: new Set(), landed: new Map(), calls: [] };
  R.sendCmd = async (relayId, cmd) => {
    R.calls.push(cmd);
    if (cmd.type === 'get_mempool_entry') return { ok: true, found: R.mempool.has(cmd.txid) };
    if (cmd.type === 'check_utxo_landed') { const d = R.landed.get(cmd.txid); return { ok: true, landed: d != null && d >= (cmd.minDepth || 0), depth: d ?? null }; }
    throw new Error(`unexpected cmd ${cmd.type}`);
  };
  return R;
}
function makeBuildAndBroadcast(R) {
  return async ({ intentKey }) => {
    const txid = `tx${++R._n}`.padEnd(64, '0');
    recordSettlementIntentPhase({ intentKey, phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }) });
    R.mempool.add(txid);
    recordSettlementIntentPhase({ intentKey, phase: 'submitted', txid });
    return { txId: txid };
  };
}

console.log('[test] ① market:seal（无依赖）: pending → build 成功 → submitted:');
{
  const R = makeRelay(); R._n = 0;
  seedMarket('m1');
  const res = await driveSettlementIntent({
    sendCmd: R.sendCmd, relayId: 'relay-A', subjectType: 'market', subjectId: 'm1', step: 'seal',
    targetAddress: 'kaspatest:rootclose-addr', buildAndBroadcast: makeBuildAndBroadcast(R), log: quiet,
  });
  ok(!!res.txId, 'seal 拿到 txId');
  const intent = getSettlementIntent(settlementIntentKeyFor('market', 'm1', 'seal'));
  ok(intent.status === 'submitted', `seal intent status=submitted (实际 ${intent.status})`);
  ok(intent.depends_on === null, `seal 无依赖, depends_on 为 null(实际 ${intent.depends_on})`);
}

console.log('[test] ② 幂等: 再调一次 driveSettlementIntent(同 subject/step) → reused, 不重新构造:');
{
  const R = makeRelay(); R._n = 0;
  let buildCalls = 0;
  const wrapped = async (o) => { buildCalls++; return makeBuildAndBroadcast(R)(o); };
  const res = await driveSettlementIntent({
    sendCmd: R.sendCmd, relayId: 'relay-A', subjectType: 'market', subjectId: 'm1', step: 'seal',
    targetAddress: 'kaspatest:rootclose-addr', buildAndBroadcast: wrapped, log: quiet,
  });
  ok(res.reused === true, 'seal 第二次调用 reused=true');
  ok(buildCalls === 0, `buildAndBroadcast 未被再次调用(实际调用 ${buildCalls} 次)`);
}

console.log('[test] ③ markSettlementIntent 单调性: 不能从 landed 退回 pending:');
{
  const R = makeRelay();
  const intent = getSettlementIntent(settlementIntentKeyFor('market', 'm1', 'seal'));
  R.landed.set(intent.submitted_txid, 10);
  const landedRes = await checkSettlementIntentLanded({ sendCmd: R.sendCmd, relayId: 'relay-A', intent, targetAddress: 'kaspatest:rootclose-addr', minDepth: 5 });
  ok(landedRes.landed === true, 'checkSettlementIntentLanded 判定已 landed');
  const after1 = getSettlementIntent(intent.intent_key);
  ok(after1.status === 'landed', `intent 行更新为 landed(实际 ${after1.status})`);
  const after2 = markSettlementIntent(intent.intent_key, { status: 'pending' });
  ok(after2.status === 'landed', `尝试退回 pending 被拒, 仍是 landed(实际 ${after2.status})`);
}

console.log('[test] ④(本模块特有) depends_on 真实生效: resolve 依赖 seal, seal landed 前后 isDependencyLanded 结果不同:');
{
  seedMarket('m2');
  ensureSettlementIntent({ subjectType: 'market', subjectId: 'm2', step: 'seal' });
  ok(isDependencyLanded('market', 'm2', 'seal') === true, 'seal 本身无依赖, isDependencyLanded 恒 true');
  ok(isDependencyLanded('market', 'm2', 'resolve') === false, 'm2 的 seal 还没 landed 时, resolve 的依赖判定为 false');
  const sealIntent = ensureSettlementIntent({ subjectType: 'market', subjectId: 'm2', step: 'resolve' });
  ok(sealIntent.depends_on === settlementIntentKeyFor('market', 'm2', 'seal'), `resolve 行的 depends_on 正确指向 seal 的 intent_key(实际 ${sealIntent.depends_on})`);
  markSettlementIntent(settlementIntentKeyFor('market', 'm2', 'seal'), { status: 'submitted', submitted_txid: 'txseal'.padEnd(64, '0') });
  markSettlementIntent(settlementIntentKeyFor('market', 'm2', 'seal'), { status: 'landed', landed_depth: 10 });
  ok(isDependencyLanded('market', 'm2', 'resolve') === true, 'm2 的 seal landed 后, resolve 的依赖判定变为 true');
}

console.log('[test] ⑤ claim 归属(convert_to_claim/claim_draw/withdraw)与错误组合被拒:');
{
  seedMarket('m3'); seedClaim('c1', 'm3');
  const key = settlementIntentKeyFor('claim', 'c1', 'convert_to_claim');
  ok(key === 'settle:claim:c1:convert_to_claim', `intent_key 格式正确(实际 ${key})`);
  let threw = null;
  try { settlementIntentKeyFor('market', 'c1', 'convert_to_claim'); } catch (e) { threw = e; }
  ok(threw !== null, 'step 与 subject_type 不匹配(convert_to_claim 属于 claim, 不是 market)被拒');
}

console.log('[test] ⑥ resolvePrepared: prepared 行且 txid 已在 mempool → submitted, 不重新构造:');
{
  seedMarket('m4');
  const R = makeRelay();
  const key = settlementIntentKeyFor('market', 'm4', 'seal');
  ensureSettlementIntent({ subjectType: 'market', subjectId: 'm4', step: 'seal' });
  const txid = 'deadbeef'.repeat(8);
  recordSettlementIntentPhase({ intentKey: key, phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }) });
  R.mempool.add(txid);
  let buildCalls = 0;
  const res = await driveSettlementIntent({
    sendCmd: R.sendCmd, relayId: 'relay-A', subjectType: 'market', subjectId: 'm4', step: 'seal',
    targetAddress: 'kaspatest:rootclose-addr4', buildAndBroadcast: async () => { buildCalls++; return { txId: 'wrong' }; }, log: quiet,
  });
  ok(res.txId === txid, `resolvePrepared 从 mempool 确认恢复出正确 txid(实际 ${res.txId})`);
  ok(buildCalls === 0, `buildAndBroadcast 未被调用(实际 ${buildCalls} 次) —— prepared 态走恢复不走重建`);
}

console.log('[test] ⑦ resumeStaleSettlementIntents: 扫到陈旧 prepared 行并恢复:');
{
  seedMarket('m5');
  const R = makeRelay();
  const key = settlementIntentKeyFor('market', 'm5', 'seal');
  ensureSettlementIntent({ subjectType: 'market', subjectId: 'm5', step: 'seal' });
  const txid = 'cafebabe'.repeat(8);
  recordSettlementIntentPhase({ intentKey: key, phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }) });
  R.mempool.add(txid);
  sqlite.prepare(`UPDATE proto_settlement_intents SET updated_at = datetime('now', '-10 minutes') WHERE intent_key = ?`).run(key);
  const out = await resumeStaleSettlementIntents({
    sendCmd: R.sendCmd, targetAddressFor: () => 'kaspatest:rootclose-addr5', relayIdFor: () => 'relay-A',
    olderThanMs: 5 * 60 * 1000, log: quiet,
  });
  ok(out.scanned === 1, `扫到 1 条陈旧 prepared 行(实际 ${out.scanned})`);
  ok(out.resolved === 1, `成功恢复 1 条(实际 ${out.resolved})`);
  const after = getSettlementIntent(key);
  ok(after.status === 'submitted', `恢复后状态为 submitted(实际 ${after.status})`);
}

console.log('[test] ⑧a resolvePrepared: 同字节重播遇 inputs_spent 但 kaspa_tx_log 有正向落地证据 → submitted(不重建):');
{
  seedMarket('m6');
  const R = makeRelay();
  const key = settlementIntentKeyFor('market', 'm6', 'seal');
  ensureSettlementIntent({ subjectType: 'market', subjectId: 'm6', step: 'seal' });
  const txid = 'a1a1a1a1'.repeat(8);
  recordSettlementIntentPhase({ intentKey: key, phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }) });
  R.sendCmd = async (relayId, cmd) => {
    R.calls.push(cmd);
    if (cmd.type === 'get_mempool_entry') return { ok: true, found: false };
    if (cmd.type === 'check_utxo_landed') return { ok: true, landed: false, depth: null };
    if (cmd.type === PROTO_COVENANT_BROADCAST_TYPE) return { code: 'inputs_spent', error: 'transaction output already spent' };
    throw new Error(`unexpected cmd ${cmd.type}`);
  };
  sqlite.prepare(`INSERT INTO kaspa_tx_log (tx_id, observed_at, network) VALUES (?, ?, 'mainnet')`).run(txid, new Date().toISOString());

  let threw = null, res = null;
  try {
    res = await driveSettlementIntent({
      sendCmd: R.sendCmd, relayId: 'relay-A', subjectType: 'market', subjectId: 'm6', step: 'seal',
      targetAddress: 'kaspatest:rootclose-addr6', buildAndBroadcast: async () => { throw new Error('should-not-be-called: prepared 态走重播不走重建'); }, log: quiet,
    });
  } catch (e) { threw = e; }
  ok(threw === null, `没有 throw(实际 ${threw && threw.message})`);
  ok(res && res.txId === txid, `resolvePrepared 靠 kaspa_tx_log 正向证据确认 submitted, txid 不变(实际 ${res && res.txId})`);
  const after = getSettlementIntent(key);
  ok(after.status === 'submitted', `intent 行落为 submitted, 不是 ambiguous(实际 ${after.status})`);
}

console.log('[test] ⑧b resolvePrepared: inputs_spent 且 kaspa_tx_log 查无正向证据 → ambiguous 终态, HOLD 不重建不放弃:');
{
  seedMarket('m7');
  const R = makeRelay();
  const key = settlementIntentKeyFor('market', 'm7', 'seal');
  ensureSettlementIntent({ subjectType: 'market', subjectId: 'm7', step: 'seal' });
  const txid = 'b2b2b2b2'.repeat(8);
  recordSettlementIntentPhase({ intentKey: key, phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }) });
  R.sendCmd = async (relayId, cmd) => {
    R.calls.push(cmd);
    if (cmd.type === 'get_mempool_entry') return { ok: true, found: false };
    if (cmd.type === 'check_utxo_landed') return { ok: true, landed: false, depth: null };
    if (cmd.type === PROTO_COVENANT_BROADCAST_TYPE) return { code: 'inputs_spent', error: 'transaction output already spent' };
    throw new Error(`unexpected cmd ${cmd.type}`);
  };

  let threw = null;
  let buildCalls = 0;
  try {
    await driveSettlementIntent({
      sendCmd: R.sendCmd, relayId: 'relay-A', subjectType: 'market', subjectId: 'm7', step: 'seal',
      targetAddress: 'kaspatest:rootclose-addr7', buildAndBroadcast: async () => { buildCalls++; return { txId: 'should-not-happen' }; }, log: quiet,
    });
  } catch (e) { threw = e; }
  ok(threw && threw.hold === true, 'driveSettlementIntent throw 了 HoldError');
  ok(threw && threw.code === 'ambiguous_inputs_spent', `hold code 正确(实际 ${threw && threw.code})`);
  ok(buildCalls === 0, `buildAndBroadcast 未被调用(实际 ${buildCalls} 次)`);
  const after = getSettlementIntent(key);
  ok(after.status === 'ambiguous', `intent 行落为 ambiguous 终态(实际 ${after.status})`);

  const afterPatch = markSettlementIntent(key, { status: 'prepared' });
  ok(afterPatch.status === 'ambiguous', `尝试把 ambiguous 改回 prepared 被拒(实际 ${afterPatch.status})`);
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — proto-settlement-intent 六步状态机(幂等/单调/依赖/恢复/inputs_spent 歧义终态) 全绿'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
