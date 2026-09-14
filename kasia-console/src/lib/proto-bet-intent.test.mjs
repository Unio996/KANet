// proto-bet-intent.test.mjs — 两步下注状态机离线向量(J2 2026-09-14, 设计 v0.1 §2.3.1, NWT MUST-FIX 1336)。
// 真 migration 临时库(DB_PATH) + 假 sendCmd(脚本化 relay), 零链零 IPC。同 submit-intent.test.mjs 手法。
// Run: cd kasia-console && node src/lib/proto-bet-intent.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_BET_INTENT_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_bet_intent_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_BET_INTENT_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: 'mainnet' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const BI = await import('./proto-bet-intent.mjs');
const {
  driveBetIntent, checkBetIntentLanded, resumeStaleBetIntents, recordBetIntentPhase,
  getBetIntent, ensureBetIntent, markBetIntent, betIntentKeyFor, activeBetIntent, checkDependencyLanded,
} = BI;

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}: ${JSON.stringify(cond)}`); fails++; } };
const quiet = { log: () => {}, error: () => {} };

// 造一个测试用的 proto_markets/proto_token_defs/proto_bets 行(FK 目标, 不测这些表本身的逻辑, 只满足外键)。
function seedBet(betId, marketId = 'm1', tokenDefId = 't1') {
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT OR IGNORE INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)`).run(tokenDefId, 'Test', 'TST', now);
  sqlite.prepare(`INSERT OR IGNORE INTO proto_markets (id,token_def_id,deadline_ms,min_bet,committee_pubkeys_json,committee_privkey_enc,rootclose_tmpl_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(marketId, tokenDefId, 1700000000000, 100, '[]', 'enc', 'aa'.repeat(32), now, now);
  sqlite.prepare(`INSERT OR IGNORE INTO proto_bets (id,market_id,bettor_pk,side,stake,status,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(betId, marketId, 'bb'.repeat(32), 0, 1000, 'pending', now);
}

function makeRelay() {
  const R = { mempool: new Set(), landed: new Map(), calls: [], mode: 'ok', n: 0 };
  R.sendCmd = async (relayId, cmd) => {
    R.calls.push(cmd);
    if (cmd.type === 'get_mempool_entry') return { ok: true, found: R.mempool.has(cmd.txid) };
    if (cmd.type === 'check_utxo_landed') { const d = R.landed.get(cmd.txid); return { ok: true, landed: d != null && d >= (cmd.minDepth || 0), depth: d ?? null }; }
    throw new Error(`unexpected cmd ${cmd.type}`);
  };
  return R;
}
function makeBuildAndBroadcast(R, { failTimes = 0 } = {}) {
  let calls = 0;
  return async ({ attempt, intentKey }) => {
    calls++;
    if (calls <= failTimes) return { error: 'simulated build failure' };
    const txid = `tx${++R.n}`.padEnd(64, '0');
    recordBetIntentPhase({ intentKey, phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }) });
    R.mempool.add(txid);
    recordBetIntentPhase({ intentKey, phase: 'submitted', txid });
    return { txId: txid };
  };
}

console.log('[test] ① mint 步骤: pending → 首次 build 成功 → submitted:');
{
  const R = makeRelay();
  seedBet('bet1');
  const res = await driveBetIntent({
    sendCmd: R.sendCmd, relayId: 'relay-A', betId: 'bet1', step: 'mint',
    targetAddress: 'kaspatest:mint-addr', buildAndBroadcast: makeBuildAndBroadcast(R), log: quiet,
  });
  ok(!!res.txId, 'mint 拿到 txId');
  const intent = getBetIntent(betIntentKeyFor('bet1', 'mint'));
  ok(intent.status === 'submitted', `mint intent status=submitted (实际 ${intent.status})`);
}

console.log('[test] ② 幂等: 再调一次 driveBetIntent(同 betId/step) → reused, 不重新构造:');
{
  const R = makeRelay();
  const buildFn = makeBuildAndBroadcast(R);
  let buildCalls = 0;
  const wrapped = async (o) => { buildCalls++; return buildFn(o); };
  const res = await driveBetIntent({
    sendCmd: R.sendCmd, relayId: 'relay-A', betId: 'bet1', step: 'mint',
    targetAddress: 'kaspatest:mint-addr', buildAndBroadcast: wrapped, log: quiet,
  });
  ok(res.reused === true, 'mint 第二次调用 reused=true');
  ok(buildCalls === 0, `buildAndBroadcast 未被再次调用(实际调用 ${buildCalls} 次)`);
}

console.log('[test] ③ 链式依赖闸: append 在 mint 未 landed 时必须 HOLD, 不允许构造:');
{
  const R = makeRelay();
  const mintIntent = getBetIntent(betIntentKeyFor('bet1', 'mint'));
  ok(mintIntent.status === 'submitted', `前提: mint 仍是 submitted 未 landed(实际 ${mintIntent.status})`);
  let buildCalls = 0;
  let threw = null;
  try {
    await driveBetIntent({
      sendCmd: R.sendCmd, relayId: 'relay-A', betId: 'bet1', step: 'append', dependsOn: mintIntent.intent_key,
      targetAddress: 'kaspatest:append-addr', buildAndBroadcast: async () => { buildCalls++; return { txId: 'should-not-happen' }; }, log: quiet,
    });
  } catch (e) { threw = e; }
  ok(threw && threw.hold === true, 'append 在依赖未 landed 时 throw HoldError');
  ok(threw && threw.code === 'dependency_not_landed', `hold code 正确(实际 ${threw && threw.code})`);
  ok(buildCalls === 0, `buildAndBroadcast 未被调用(实际 ${buildCalls} 次) —— 没有在错误时机构造交易`);
}

console.log('[test] ④ mint landed 后, append 才能真正推进:');
{
  const R = makeRelay();
  const mintIntent = getBetIntent(betIntentKeyFor('bet1', 'mint'));
  R.landed.set(mintIntent.submitted_txid, 10); // 模拟 10 confirmation depth
  const landedRes = await checkBetIntentLanded({ sendCmd: R.sendCmd, relayId: 'relay-A', intent: mintIntent, targetAddress: 'kaspatest:mint-addr', minDepth: 5 });
  ok(landedRes.landed === true, 'checkBetIntentLanded 判定 mint 已 landed');
  const mintAfter = getBetIntent(mintIntent.intent_key);
  ok(mintAfter.status === 'landed', `mint intent 行更新为 landed(实际 ${mintAfter.status})`);

  const dep = checkDependencyLanded({ step: 'append', depends_on: mintIntent.intent_key });
  ok(dep.ok === true, 'checkDependencyLanded 现在放行');

  const res = await driveBetIntent({
    sendCmd: R.sendCmd, relayId: 'relay-A', betId: 'bet1', step: 'append', dependsOn: mintIntent.intent_key,
    targetAddress: 'kaspatest:append-addr', buildAndBroadcast: makeBuildAndBroadcast(R), log: quiet,
  });
  ok(!!res.txId, 'append 现在能拿到 txId');
  const appendIntent = getBetIntent(betIntentKeyFor('bet1', 'append'));
  ok(appendIntent.status === 'submitted', `append intent status=submitted(实际 ${appendIntent.status})`);
  ok(appendIntent.depends_on === mintIntent.intent_key, 'append 行记录了正确的 depends_on');
}

console.log('[test] ⑤ ensureBetIntent 拒绝没有 dependsOn 的 append(数据完整性守卫):');
{
  let threw = null;
  try { ensureBetIntent({ betId: 'bet2', step: 'append' }); } catch (e) { threw = e; }
  ok(threw && /dependsOn/.test(threw.message), 'append 缺 dependsOn 时 ensureBetIntent 直接 throw');
}

console.log('[test] ⑥ markBetIntent 单调性: 不能从 submitted 退回 pending:');
{
  const mintIntent = getBetIntent(betIntentKeyFor('bet1', 'mint'));
  ok(mintIntent.status === 'landed', '前提: mint 已是 landed');
  const after = markBetIntent(mintIntent.intent_key, { status: 'pending' });
  ok(after.status === 'landed', `尝试退回 pending 被拒, 仍是 landed(实际 ${after.status})`);
}

console.log('[test] ⑦ resolvePrepared: prepared 行且 txid 已在 mempool → submitted, 不重新构造:');
{
  seedBet('bet3');
  const R = makeRelay();
  const key = betIntentKeyFor('bet3', 'mint');
  ensureBetIntent({ betId: 'bet3', step: 'mint' });
  const txid = 'deadbeef'.repeat(8);
  recordBetIntentPhase({ intentKey: key, phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }) });
  R.mempool.add(txid); // 已经在 mempool 里(比如上次构造成功广播了, 但 IPC 回执没送达调用方)
  let buildCalls = 0;
  const res = await driveBetIntent({
    sendCmd: R.sendCmd, relayId: 'relay-A', betId: 'bet3', step: 'mint',
    targetAddress: 'kaspatest:mint-addr3', buildAndBroadcast: async () => { buildCalls++; return { txId: 'wrong' }; }, log: quiet,
  });
  ok(res.txId === txid, `resolvePrepared 从 mempool 确认恢复出正确 txid(实际 ${res.txId})`);
  ok(buildCalls === 0, `buildAndBroadcast 未被调用(实际 ${buildCalls} 次) —— prepared 态走恢复不走重建`);
}

console.log('[test] ⑧ resumeStaleBetIntents: 扫到陈旧 prepared 行并恢复:');
{
  seedBet('bet4');
  const R = makeRelay();
  const key = betIntentKeyFor('bet4', 'mint');
  ensureBetIntent({ betId: 'bet4', step: 'mint' });
  const txid = 'cafebabe'.repeat(8);
  recordBetIntentPhase({ intentKey: key, phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }) });
  R.mempool.add(txid);
  // 人为把 updated_at 拨到 10 分钟前, 模拟"陈旧"
  sqlite.prepare(`UPDATE proto_bet_intents SET updated_at = datetime('now', '-10 minutes') WHERE intent_key = ?`).run(key);
  const out = await resumeStaleBetIntents({
    sendCmd: R.sendCmd, targetAddressFor: () => 'kaspatest:mint-addr4', relayIdFor: () => 'relay-A',
    olderThanMs: 5 * 60 * 1000, log: quiet,
  });
  ok(out.scanned === 1, `扫到 1 条陈旧 prepared 行(实际 ${out.scanned})`);
  ok(out.resolved === 1, `成功恢复 1 条(实际 ${out.resolved})`);
  const after = getBetIntent(key);
  ok(after.status === 'submitted', `恢复后状态为 submitted(实际 ${after.status})`);
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — proto-bet-intent 两步链状态机(依赖闸/幂等/单调/恢复) 全绿'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
