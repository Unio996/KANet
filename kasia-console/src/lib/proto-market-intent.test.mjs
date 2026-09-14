// proto-market-intent.test.mjs — market_genesis(单步)状态机离线向量(J2, 账本1423/1425)。
// 真 migration 临时库(DB_PATH) + 假 sendCmd(脚本化 relay), 零链零 IPC。同 proto-bet-intent.test.mjs 手法。
// Run: cd kasia-console && node src/lib/proto-market-intent.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_MARKET_INTENT_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_market_intent_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_MARKET_INTENT_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: 'mainnet' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const MI = await import('./proto-market-intent.mjs');
const {
  driveMarketGenesis, checkMarketGenesisLanded, resumeStaleMarketIntents, recordMarketIntentPhase,
  getMarketRow, ensureMarketPending, markMarketStatus, marketIntentKeyFor, marketIdFromIntentKey,
} = MI;

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}: ${JSON.stringify(cond)}`); fails++; } };
const quiet = { log: () => {}, error: () => {} };

const now = new Date().toISOString();
sqlite.prepare(`INSERT OR IGNORE INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)`).run('t1', 'Test', 'TST', now);

function seedMarketFields(id) {
  return {
    id, token_def_id: 't1', question: 'will it rain?', deadline_ms: 1700000000000, min_bet: 100,
    seal_count: 2, committee_pubkeys_json: '["cc".repeat(32)]', committee_privkey_enc: 'enc', rootclose_tmpl_hash: 'aa'.repeat(32),
  };
}

function makeRelay() {
  const R = { mempool: new Set(), landed: new Map(), calls: [], n: 0 };
  R.sendCmd = async (relayId, cmd) => {
    R.calls.push(cmd);
    if (cmd.type === 'get_mempool_entry') return { ok: true, found: R.mempool.has(cmd.txid) };
    if (cmd.type === 'check_utxo_landed') { const d = R.landed.get(cmd.txid); return { ok: true, landed: d != null && d >= (cmd.minDepth || 0), depth: d ?? null }; }
    if (cmd.type === 'covenant_broadcast') return R.replayResponse || { txId: cmd.prepared_txid };
    throw new Error(`unexpected cmd ${cmd.type}`);
  };
  return R;
}
function makeBuildAndBroadcast(R, marketId, { failTimes = 0 } = {}) {
  let calls = 0;
  return async ({ attempt }) => {
    calls++;
    if (calls <= failTimes) return { error: 'simulated build failure' };
    const txid = `tx${++R.n}`.padEnd(64, '0');
    recordMarketIntentPhase({ intentKey: marketIntentKeyFor(marketId), phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }) });
    R.mempool.add(txid);
    recordMarketIntentPhase({ intentKey: marketIntentKeyFor(marketId), phase: 'submitted', txid });
    return { txId: txid };
  };
}

console.log('[test] ① marketIntentKeyFor/marketIdFromIntentKey 往返:');
{
  ok(marketIntentKeyFor('m1') === 'genesis:m1', 'attempt=1 无后缀');
  ok(marketIntentKeyFor('m1', 2) === 'genesis:m1#2', 'attempt=2 加 #2 后缀');
  ok(marketIdFromIntentKey('genesis:m1') === 'm1', '反解 attempt=1');
  ok(marketIdFromIntentKey('genesis:m1#2') === 'm1', '反解 attempt=2 去掉后缀');
  ok(marketIdFromIntentKey('proto-bet:bet1:mint') === null, '非 genesis: 前缀返回 null(不误吃 bet intent key)');
}

console.log('[test] ② 硬条件①: ensureMarketPending 必须先于任何 IPC 建 pending 行, driveMarketGenesis 找不到行必须 throw:');
{
  const R = makeRelay();
  let threw = null;
  try {
    await driveMarketGenesis({ sendCmd: R.sendCmd, relayId: 'relay-A', marketId: 'never-ensured', targetAddress: 'x', buildAndBroadcast: async () => ({ txId: 'x' }), log: quiet });
  } catch (e) { threw = e; }
  ok(threw && /not found/.test(threw.message), 'driveMarketGenesis 对未 ensure 过的 marketId 拒绝(不会隐式建行)');
  ok(R.calls.length === 0, '拒绝发生在任何 IPC 调用之前');
}

console.log('[test] ③ genesis_pending → 首次 build 成功 → genesis_submitted:');
{
  const R = makeRelay();
  const row = ensureMarketPending(seedMarketFields('m1'));
  ok(row.status === 'genesis_pending', `ensureMarketPending 落表状态是 genesis_pending(实际 ${row.status})`);
  const res = await driveMarketGenesis({
    sendCmd: R.sendCmd, relayId: 'relay-A', marketId: 'm1',
    targetAddress: 'kaspatest:genesis-addr', buildAndBroadcast: makeBuildAndBroadcast(R, 'm1'), log: quiet,
  });
  ok(!!res.txId, 'genesis 拿到 txId');
  const market = getMarketRow('m1');
  ok(market.status === 'genesis_submitted', `market status=genesis_submitted(实际 ${market.status})`);
  ok(market.genesis_submitted_txid === res.txId, 'genesis_submitted_txid 记录一致');
}

console.log('[test] ④ 幂等: 再调一次 driveMarketGenesis(同 marketId) → reused, 不重新构造:');
{
  const R = makeRelay();
  let buildCalls = 0;
  const res = await driveMarketGenesis({
    sendCmd: R.sendCmd, relayId: 'relay-A', marketId: 'm1',
    targetAddress: 'kaspatest:genesis-addr', buildAndBroadcast: async () => { buildCalls++; return { txId: 'should-not-happen' }; }, log: quiet,
  });
  ok(res.reused === true, '第二次调用 reused=true');
  ok(buildCalls === 0, `buildAndBroadcast 未被再次调用(实际 ${buildCalls} 次)`);
}

console.log('[test] ⑤ checkMarketGenesisLanded: landed 深度不够 → 仍是 genesis_submitted; 深度够 → status 推进到 betting(=active) + 写 shardleaf_txid/vout:');
{
  const R = makeRelay();
  const market = getMarketRow('m1');
  R.landed.set(market.genesis_submitted_txid, 5); // 深度 5, 不够 REORG_SAFE_MIN_DEPTH(20)
  const r1 = await checkMarketGenesisLanded({ sendCmd: R.sendCmd, relayId: 'relay-A', market, targetAddress: 'kaspatest:genesis-addr', minDepth: 20 });
  ok(r1.landed === false, `深度 5 < minDepth 20 ⇒ landed=false(实际 ${r1.landed})`);
  ok(getMarketRow('m1').status === 'genesis_submitted', '未落链确认前状态保持 genesis_submitted');

  R.landed.set(market.genesis_submitted_txid, 25); // 深度 25, 够了
  const r2 = await checkMarketGenesisLanded({ sendCmd: R.sendCmd, relayId: 'relay-A', market, targetAddress: 'kaspatest:genesis-addr', minDepth: 20, shardleafVout: 0 });
  ok(r2.landed === true, `深度 25 >= minDepth 20 ⇒ landed=true(实际 ${r2.landed})`);
  const finalMarket = getMarketRow('m1');
  ok(finalMarket.status === 'betting', `落链确认后 status=betting(=active)(实际 ${finalMarket.status})`);
  ok(finalMarket.shardleaf_txid === market.genesis_submitted_txid, 'shardleaf_txid 从 genesis_submitted_txid 写入');
  ok(finalMarket.shardleaf_vout === 0, 'shardleaf_vout 写入');
  ok(finalMarket.genesis_landed_depth === 25, 'genesis_landed_depth 记录');
}

console.log('[test] ⑥ minDepth 缺失/非正数 ⇒ throw(不是静默用 0):');
{
  const R = makeRelay();
  const market = getMarketRow('m1');
  let threw = null;
  try { await checkMarketGenesisLanded({ sendCmd: R.sendCmd, relayId: 'relay-A', market, targetAddress: 'x' }); }
  catch (e) { threw = e; }
  ok(threw && /minDepth > 0 required/.test(threw.message), 'minDepth 缺失时 throw');
}

console.log('[test] ⑦ genesis_prepared 态但无签名字节(F2-R) → hold, 不重发不重建:');
{
  const R = makeRelay();
  ensureMarketPending(seedMarketFields('m2'));
  recordMarketIntentPhase({ intentKey: marketIntentKeyFor('m2'), phase: 'prepared', txid: 'tx-no-bytes'.padEnd(64, '0') });
  // 手动清空 tx_json 模拟"有 txid 无字节"(正常路径不会发生, 这是防御性测试)
  markMarketStatus('m2', { genesis_prepared_tx_json: null });
  let threw = null;
  try {
    await driveMarketGenesis({ sendCmd: R.sendCmd, relayId: 'relay-A', marketId: 'm2', targetAddress: 'kaspatest:m2-addr', buildAndBroadcast: async () => ({ txId: 'should-not-happen' }), log: quiet });
  } catch (e) { threw = e; }
  ok(threw && threw.hold === true, 'prepared 无字节 ⇒ HoldError');
  ok(threw && threw.code === 'prepared_without_bytes', `hold code 正确(实际 ${threw && threw.code})`);
}

console.log('[test] ⑧ genesis_ambiguous 终态: 一旦置位, markMarketStatus 不能覆盖 status, driveMarketGenesis 直接 throw hold 不重试:');
{
  const R = makeRelay();
  ensureMarketPending(seedMarketFields('m3'));
  markMarketStatus('m3', { status: 'genesis_ambiguous', genesis_last_error: 'test-induced' });
  const attempted = markMarketStatus('m3', { status: 'genesis_submitted' }); // 尝试覆盖
  ok(attempted.status === 'genesis_ambiguous', `ambiguous 后 status 不可被覆盖(实际 ${attempted.status})`);
  let threw = null;
  try {
    await driveMarketGenesis({ sendCmd: R.sendCmd, relayId: 'relay-A', marketId: 'm3', targetAddress: 'x', buildAndBroadcast: async () => ({ txId: 'x' }), log: quiet });
  } catch (e) { threw = e; }
  ok(threw && threw.hold === true, 'ambiguous market ⇒ driveMarketGenesis 直接 throw hold');
  ok(R.calls.length === 0, '没有对 ambiguous 市场发起任何新 IPC(不重建不重试)');
}

console.log('[test] ⑨ resumeStaleMarketIntents(F2-R 重启捡回): genesis_prepared 且 updated_at 早于 cutoff 的行被扫到并 resolvePrepared:');
{
  const R = makeRelay();
  ensureMarketPending(seedMarketFields('m4'));
  const txid = 'tx-stale'.padEnd(64, '0');
  recordMarketIntentPhase({ intentKey: marketIntentKeyFor('m4'), phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }) });
  sqlite.prepare(`UPDATE proto_markets SET updated_at = ? WHERE id = 'm4'`).run(new Date(Date.now() - 10 * 60 * 1000).toISOString());
  R.mempool.add(txid); // 模拟"已经在 mempool 里"(重启前已提交, 只是没来得及记 submitted)
  const out = await resumeStaleMarketIntents({
    sendCmd: R.sendCmd, targetAddressFor: () => 'kaspatest:m4-addr', relayIdFor: () => 'relay-A',
    olderThanMs: 5 * 60 * 1000, log: quiet,
  });
  ok(out.scanned === 1, `扫到 1 条陈旧 prepared 行(实际 ${out.scanned})`);
  ok(out.resolved === 1, `成功 resolve 1 条(实际 ${out.resolved})`);
  ok(getMarketRow('m4').status === 'genesis_submitted', `m4 状态推进到 genesis_submitted(实际 ${getMarketRow('m4').status})`);
}

console.log('[test] ⑩ shardleaf_cov_id(账本1429/1431): prepared 阶段写入 + 落链 fail-closed 重算比对:');
{
  const kaspa = await import('kaspa-wasm');
  const { scriptPublicKeyFromHex } = await import('./proto-tx-assembly.mjs');

  const marketId = 'm5';
  ensureMarketPending({ id: marketId, ...seedMarketFields(marketId) });
  const R = makeRelay();
  const txid = 'tx-m5'.padEnd(64, '0');

  const realFundingOutpoint = { transactionId: 'ff'.repeat(32), index: 0 };
  const forgedFundingOutpoint = { transactionId: 'ee'.repeat(32), index: 0 }; // 伪造: 不同的 input outpoint
  const genesisSpkHex = '0x' + 'aa20' + 'bb'.repeat(32) + '87';
  const genesisOutput = { value: 20_000_000n, scriptPublicKeyHex: genesisSpkHex };
  const spk = scriptPublicKeyFromHex(kaspa, genesisSpkHex);
  const realCovId = String(kaspa.covenantId(realFundingOutpoint, [{ index: 0, output: new kaspa.TransactionOutput(genesisOutput.value, spk) }]));

  recordMarketIntentPhase({ intentKey: marketIntentKeyFor(marketId), phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }), shardLeafCovId: realCovId });
  ok(getMarketRow(marketId).shardleaf_cov_id === realCovId, 'prepared 阶段 shardleaf_cov_id 写入成功');
  recordMarketIntentPhase({ intentKey: marketIntentKeyFor(marketId), phase: 'submitted', txid });

  R.landed.set(txid, 25);

  console.log('  -- ⑩a 落链交易真实 input[0] outpoint 与存的值一致 ⇒ 通过, 推进到 betting --');
  const rOk = await checkMarketGenesisLanded({
    sendCmd: R.sendCmd, relayId: 'relay-A', market: getMarketRow(marketId), targetAddress: 'kaspatest:m5-addr', minDepth: 20,
    kaspa, fetchLandedGenesisTx: async () => ({ fundingOutpoint: realFundingOutpoint, genesisOutput }),
  });
  ok(rOk.landed === true, `一致时 landed=true(实际 ${rOk.landed})`);
  ok(getMarketRow(marketId).status === 'betting', `一致时状态推进到 betting(实际 ${getMarketRow(marketId).status})`);
}

console.log('[test] ⑪ 伪造落链交易的 input outpoint 不同 ⇒ 拒绝推进, genesis_ambiguous, 不自动重建:');
{
  const kaspa = await import('kaspa-wasm');
  const { scriptPublicKeyFromHex } = await import('./proto-tx-assembly.mjs');

  const marketId = 'm6';
  ensureMarketPending({ id: marketId, ...seedMarketFields(marketId) });
  const R = makeRelay();
  const txid = 'tx-m6'.padEnd(64, '0');

  const realFundingOutpoint = { transactionId: 'ff'.repeat(32), index: 0 };
  const forgedFundingOutpoint = { transactionId: 'ee'.repeat(32), index: 0 };
  const genesisSpkHex = '0x' + 'aa20' + 'cc'.repeat(32) + '87';
  const genesisOutput = { value: 20_000_000n, scriptPublicKeyHex: genesisSpkHex };
  const spk = scriptPublicKeyFromHex(kaspa, genesisSpkHex);
  const realCovId = String(kaspa.covenantId(realFundingOutpoint, [{ index: 0, output: new kaspa.TransactionOutput(genesisOutput.value, spk) }]));

  recordMarketIntentPhase({ intentKey: marketIntentKeyFor(marketId), phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }), shardLeafCovId: realCovId });
  recordMarketIntentPhase({ intentKey: marketIntentKeyFor(marketId), phase: 'submitted', txid });
  R.landed.set(txid, 25);

  let threw = null;
  try {
    await checkMarketGenesisLanded({
      sendCmd: R.sendCmd, relayId: 'relay-A', market: getMarketRow(marketId), targetAddress: 'kaspatest:m6-addr', minDepth: 20,
      kaspa, fetchLandedGenesisTx: async () => ({ fundingOutpoint: forgedFundingOutpoint, genesisOutput }), // 伪造: 不同 input
    });
  } catch (e) { threw = e; }
  ok(threw && threw.hold === true && threw.code === 'covid_mismatch', `不一致时 throw MarketIntentHoldError(covid_mismatch)(实际 ${threw?.code})`);
  const after = getMarketRow(marketId);
  ok(after.status === 'genesis_ambiguous', `状态推进到 genesis_ambiguous, 不是 betting(实际 ${after.status})`);
  ok(!!after.genesis_last_error, 'genesis_last_error 记录了不一致原因');
}

console.log(`\n${fails === 0 ? '✅✅ ALL PASS' : `❌ ${fails} 处失败`}`);
process.exitCode = fails === 0 ? 0 : 1;
