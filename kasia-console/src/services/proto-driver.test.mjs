// proto-driver.test.mjs — 后台驱动 market_genesis + bet_mint(register_append, D-020单笔交易,
// 账本1446/1448)离线向量(账本1438③)。原 Stage 2(独立铸stake筹码步骤A)的推进/落地测试段已随
// D-020取消步骤A一起删除。
// 真 migration 临时库(DB_PATH) + 假 sendCmd + 真 kaspa-wasm 构造(通过 runProtoDriverTick→
// buildMarketGenesisAndBroadcast 这条真实链路), 不起真 setInterval(测 driveOnce/runProtoDriverTick
// 这两个可注入的纯函数, isProtoDriverEnabled()/startProtoDriver() 的环境变量分支单独测)。
// Run: cd kasia-console && node src/services/proto-driver.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

if (!process.env._PROTO_DRIVER_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_driver_e2e_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_DRIVER_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const kaspa = await import('kaspa-wasm');
const { sqlite } = await import('../db/client.js');
const { computeMarketGenesisArtifacts } = await import('../lib/proto-covenant-builder.mjs');
const { ensureMarketPending, getMarketRow } = await import('../lib/proto-market-intent.mjs');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message + '\n' + e.stack); } };
const quiet = { log: () => {}, warn: () => {} };

sqlite.prepare(`INSERT OR IGNORE INTO proto_token_defs (id,name,ticker,created_at) VALUES ('t1','Test','TST',datetime('now'))`).run();

const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('mainnet').toString();
const RELAY_ID = 'proto-driver-test-relay';
sqlite.prepare(`INSERT OR IGNORE INTO relay_nodes (id, name, address, network, created_at) VALUES (?, ?, ?, 'mainnet', datetime('now'))`).run(RELAY_ID, 'proto-driver-test', relayAddr);

// F3(设计 v0.2.1 §3.1.2): fee 候选取数换成 facts 形态 L(proto-broadcast-ops.mjs 的 fetchFeeCandidates),
// mock 对 facts:true 的 get_address_utxos 请求必须回 assertFactsResponse 认得的形状; leaf/held 的查询
// (无 facts 字段)不受影响, 仍是旧的裸 {ok,utxos:[{outpoint,amount}]}。
const relaySpkHexNoPrefix = kaspa.payToAddressScript(new kaspa.Address(relayAddr)).script;
function feeUtxosResponse(items) {
  return {
    ok: true, facts: true, factsVersion: 1, form: 'list', truncated: false,
    utxos: items.map((it) => ({
      outpoint: it.outpoint, amount: String(it.amount), covenantId: null,
      scriptPublicKey: { version: 0, scriptHex: relaySpkHexNoPrefix },
    })),
  };
}

async function makeMarket(tag) {
  const marketId = tag.repeat(64).slice(0, 64);
  const artifacts = await computeMarketGenesisArtifacts({ marketId, minBet: 5, deadlineMs: 1700000000000 });
  return ensureMarketPending({
    id: marketId, token_def_id: 't1', question: 'q', deadline_ms: 1700000000000, min_bet: 5, seal_count: 2,
    committee_pubkeys_json: JSON.stringify([artifacts.committeePubkeyHex]), committee_privkey_enc: artifacts.committeePrivkeyEnvelope,
    rootclose_tmpl_hash: artifacts.rootCloseTmplHash, shardleaf_own_redeem_len: artifacts.shardLeafOwnRedeemLen,
  });
}

function makeSendCmd() {
  const calls = [];
  const sendCmd = async (relayId, cmd) => {
    calls.push(cmd);
    // 账本1462修复后 SIGNED_INPUT_CEILING_SOMPI(1.0 KAS)会预先过滤面值过大的候选——原100 KAS巨额假面值
    // 已不再可用, 改用真实种子面值同量级的0.5 KAS(genesis真实所需仅≈0.213 KAS)。
    if (cmd.type === 'get_address_utxos') return feeUtxosResponse([{ outpoint: { transactionId: 'ab'.repeat(32), index: 0 }, amount: '50000000' }]);
    if (cmd.type === 'covenant_broadcast') return { ok: true, txId: cmd.expected_txid, intent_key: cmd.intent_key };
    if (cmd.type === 'check_utxo_landed') return { ok: true, landed: false, depth: null };
    throw new Error(`unexpected cmd ${cmd.type}`);
  };
  return { sendCmd, calls };
}

// ══════════════ ①硬条件①: isProtoDriverEnabled() 环境变量分支 ══════════════
await t('①a 未设 PROTO_DRIVER_ENABLED ⇒ isProtoDriverEnabled()=false', async () => {
  delete process.env.PROTO_DRIVER_ENABLED;
  const { isProtoDriverEnabled } = await import('./proto-driver.mjs?t=' + Date.now());
  if (isProtoDriverEnabled()) throw new Error('应该是 false');
});

await t('①b PROTO_RELAY_ID 未配置(即使 PROTO_DRIVER_ENABLED=1) ⇒ startProtoDriver() 不启动(打印 disabled, _started 仍为 false)', async () => {
  process.env.PROTO_DRIVER_ENABLED = '1';
  // 不设置 PROTO_RELAY_ID(proto-relay-guard.mjs 在本进程首次 import 时已经把它冻结成 null, 这里再 delete
  // env 也不会让已冻结的常量变化——这正是本测试要断言的性质: 硬条件①判据用的是冻结值, 不是运行时现读)。
  const { startProtoDriver, stopProtoDriver, _protoDriverTestState } = await import('./proto-driver.mjs');
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try { startProtoDriver(); } finally { console.log = origLog; }
  const state = _protoDriverTestState();
  if (state.started) { stopProtoDriver(); throw new Error('不该启动(_started=true)'); }
  if (!logs.some((l) => l.includes('[proto-driver] disabled'))) throw new Error(`没有打印 disabled 日志(实际 ${JSON.stringify(logs)})`);
  delete process.env.PROTO_DRIVER_ENABLED;
});

// ══════════════ ②市场genesis_pending行被驱动推进 ══════════════
let market1;
await t('②genesis_pending 行经 runProtoDriverTick 真实推进到 genesis_submitted(真kaspa-wasm构造)', async () => {
  const { runProtoDriverTick } = await import('./proto-driver.mjs');
  market1 = await makeMarket('1');
  const { sendCmd, calls } = makeSendCmd();
  const out = await runProtoDriverTick({ sendCmd, relayId: RELAY_ID, kaspa, network: 'mainnet', relayAddress: relayAddr, log: quiet, cap: 5 });
  if (out.genesisAdvanced !== 1) throw new Error(`期望推进1条, 实际 ${JSON.stringify(out)}`);
  const after = getMarketRow(market1.id);
  if (after.status !== 'genesis_submitted') throw new Error(`期望 genesis_submitted, 实际 ${after.status}`);
  if (!calls.some((c) => c.type === 'covenant_broadcast')) throw new Error('没有真的发出 covenant_broadcast');
});

// ══════════════ ③genesis_submitted行被landed-check(未落地)══════════════
await t('③genesis_submitted 行经 runProtoDriverTick 做 landed-check(check_utxo_landed 未落地, 状态不变)', async () => {
  const { runProtoDriverTick } = await import('./proto-driver.mjs');
  const { sendCmd } = makeSendCmd();
  const out = await runProtoDriverTick({ sendCmd, relayId: RELAY_ID, kaspa, network: 'mainnet', relayAddress: relayAddr, log: quiet, cap: 5 });
  if (out.genesisLandedChecked !== 1) throw new Error(`期望做1次landed-check, 实际 ${JSON.stringify(out)}`);
  if (out.genesisLanded !== 0) throw new Error('未落地不该被判成 landed');
  const after = getMarketRow(market1.id);
  if (after.status !== 'genesis_submitted') throw new Error(`状态不该变(实际 ${after.status})`);
});

// ══════════════ ④每tick上限生效 ══════════════
await t('④每 tick 上限生效: 3 个 pending 市场 + cap=2 ⇒ 只推进2个, 第3个下一轮才处理', async () => {
  const { runProtoDriverTick } = await import('./proto-driver.mjs');
  const mA = await makeMarket('2');
  const mB = await makeMarket('3');
  const mC = await makeMarket('4');
  const { sendCmd } = makeSendCmd();
  const out = await runProtoDriverTick({ sendCmd, relayId: RELAY_ID, kaspa, network: 'mainnet', relayAddress: relayAddr, log: quiet, cap: 2 });
  if (out.actioned !== 2) throw new Error(`期望本轮只动2个(cap=2), 实际 actioned=${out.actioned}`);
  const advancedCount = [mA, mB, mC].filter((m) => getMarketRow(m.id).status === 'genesis_submitted').length;
  if (advancedCount !== 2) throw new Error(`期望恰好2个市场被推进, 实际 ${advancedCount}`);
});

// ══════════════ ⑤重叠tick被跳过(单飞) ══════════════
await t('⑤重叠 tick 被跳过: 第一次 driveOnce 还在跑(慢 sendCmd 卡住)时并发调第二次 ⇒ 第二次立即返回 skipped', async () => {
  const { driveOnce, _protoDriverTestState } = await import('./proto-driver.mjs');
  let resolveSlow;
  const slowPromise = new Promise((r) => { resolveSlow = r; });
  const slowSendCmd = async (relayId, cmd) => {
    if (cmd.type === 'check_utxo_landed') { await slowPromise; return { ok: true, landed: false, depth: null }; }
    return { ok: true, utxos: [], txId: 'x' };
  };
  const before = _protoDriverTestState().skippedOverlap;
  const fakeHealthy = async () => ({ ok: true, name: 'proto-driver-test', address: relayAddr, balanceKas: 0 });
  const p1 = driveOnce({ sendCmd: slowSendCmd, relayId: RELAY_ID, kaspa, network: 'mainnet', log: quiet, cap: 5, assertHealthyFn: fakeHealthy });
  await new Promise((r) => setTimeout(r, 50)); // 让 p1 真正进入 in-flight(assertProtoRelayHealthy 走完, 卡在 check_utxo_landed)
  const p2 = await driveOnce({ sendCmd: slowSendCmd, relayId: RELAY_ID, kaspa, network: 'mainnet', log: quiet, cap: 5, assertHealthyFn: fakeHealthy });
  if (!p2.skipped) throw new Error(`第二次应该被跳过, 实际 ${JSON.stringify(p2)}`);
  const after = _protoDriverTestState().skippedOverlap;
  if (after !== before + 1) throw new Error(`skippedOverlap 计数应该+1(实际 before=${before} after=${after})`);
  resolveSlow();
  await p1; // 收尾, 避免未处理 promise 泄漏到下一个测试
});

// ══════════════ ⑥bet_mint(register_append单笔交易, D-020账本1446/1448): pending intent 被驱动推进 ══════════════
const { ensureBetIntent, getBetIntent } = await import('../lib/proto-bet-intent.mjs');
let betId1;
// 🔴 共享 DB 里此时可能还留着前面测试(④/⑤)没推完的市场行(genesis_pending/genesis_submitted)——
// cap 必须给够余量, sendCmd 必须能通用处理全部类型(不能像前几个测试那样窄范围throw), 否则会被
// leftover 市场行的推进/落地检查抢走 cap 或撞上"不该走到这里"的窄范围假设。
// market1 的 genesis 从没真的走到 check_utxo_landed=true 这一步(③故意测的是"未落地"分支)——
// buildRegisterAppendAndBroadcast 的 deriveLeafOutpoint 在没有任何 landed append 时会回退到
// proto_markets.shardleaf_txid/vout(genesis 的落链 outpoint), 手动补上模拟"genesis 已落链"。
sqlite.prepare(`UPDATE proto_markets SET shardleaf_txid = ?, shardleaf_vout = 0 WHERE id = ?`).run(market1.genesis_prepared_txid || 'ac'.repeat(32), market1.id);
const market1Row = getMarketRow(market1.id);
await t('⑥bet_mint(register_append) pending intent 经 runProtoDriverTick 真实推进到 submitted(真kaspa-wasm构造, 三项fail-closed核对全过)', async () => {
  const { runProtoDriverTick } = await import('./proto-driver.mjs');
  betId1 = 'bet-driver-001';
  sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES (?, ?, ?, 0, 20, 'pending', datetime('now'))`).run(betId1, market1Row.id, 'cc'.repeat(32));
  ensureBetIntent({ betId: betId1, step: 'append' });
  const sendCmd = async (relayId, cmd) => {
    if (cmd.type === 'get_address_utxos') {
      // F3: fee 候选取数带 facts:true(proto-broadcast-ops.mjs fetchFeeCandidates), leaf 查询不带——按此分流。
      if (cmd.facts) return feeUtxosResponse([{ outpoint: { transactionId: 'fe'.repeat(32), index: 0 }, amount: '95000000' }]);   // 账本1462: 0.95 KAS, 高于首笔下注最小可行区间(约0.925~0.93 KAS, 2026-09-19精确mass门控订正; 原≈0.82 KAS来自旧本地估算)
      return { ok: true, utxos: [{ outpoint: { transactionId: market1Row.shardleaf_txid, index: 0 }, amount: '20000000' }] }; // N-1(2026-09-19): leaf UTXO真实面值恒=CONTINUATION_OUTPUT_SOMPI(20,000,000)
    }
    if (cmd.type === 'covenant_broadcast') return { ok: true, txId: cmd.expected_txid, intent_key: cmd.intent_key };
    if (cmd.type === 'check_utxo_landed') return { ok: true, landed: false, depth: null };
    throw new Error(`unexpected cmd ${cmd.type}`);
  };
  const out = await runProtoDriverTick({ sendCmd, relayId: RELAY_ID, kaspa, network: 'mainnet', relayAddress: relayAddr, log: quiet, cap: 20 });
  if (out.betAppendAdvanced !== 1) throw new Error(`期望推进1条bet_mint, 实际 ${JSON.stringify(out)}`);
  const intent = getBetIntent(`proto-bet:${betId1}:append`);
  if (intent.status !== 'submitted') throw new Error(`期望 submitted, 实际 ${intent.status}`);
});

// ══════════════ ⑦bet_mint(register_append) landed后proto_bets记账 ══════════════
await t('⑦bet_mint(register_append) submitted intent landed 后, proto_bets.status 直接 pending→confirmed 被真实写回(两张表之间的桥, D-020: 无中间态)', async () => {
  const { runProtoDriverTick } = await import('./proto-driver.mjs');
  const intentBefore = getBetIntent(`proto-bet:${betId1}:append`);
  const sendCmd = async (relayId, cmd) => {
    if (cmd.type === 'get_address_utxos') {
      if (cmd.facts) return feeUtxosResponse([{ outpoint: { transactionId: 'fe'.repeat(32), index: 0 }, amount: '95000000' }]);
      return { ok: true, utxos: [{ outpoint: { transactionId: market1Row.shardleaf_txid, index: 0 }, amount: '20000000' }] };
    }
    if (cmd.type === 'covenant_broadcast') return { ok: true, txId: cmd.expected_txid, intent_key: cmd.intent_key };
    if (cmd.type === 'check_utxo_landed') return { ok: true, landed: true, depth: 25 };
    throw new Error(`unexpected cmd ${cmd.type}`);
  };
  const out = await runProtoDriverTick({ sendCmd, relayId: RELAY_ID, kaspa, network: 'mainnet', relayAddress: relayAddr, log: quiet, cap: 20 });
  if (out.betAppendLanded !== 1) throw new Error(`期望判定1条landed, 实际 ${JSON.stringify(out)}`);
  const bet = sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get(betId1);
  if (bet.status !== 'confirmed') throw new Error(`proto_bets.status 应该直接推进到 confirmed(D-020无中间态), 实际 ${bet.status}`);
  if (bet.stake_tx_id !== intentBefore.submitted_txid) throw new Error(`proto_bets.stake_tx_id 应该等于 intent.submitted_txid(实际 ${bet.stake_tx_id} vs ${intentBefore.submitted_txid})`);
  const intentAfter = getBetIntent(`proto-bet:${betId1}:append`);
  if (intentAfter.status !== 'landed') throw new Error(`intent 行也应该推进到 landed, 实际 ${intentAfter.status}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
