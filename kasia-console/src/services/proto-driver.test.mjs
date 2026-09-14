// proto-driver.test.mjs — 后台驱动 Stage 1(只覆盖 market_genesis)离线向量(账本1438③)。
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

async function makeMarket(tag) {
  const marketId = tag.repeat(64).slice(0, 64);
  const artifacts = await computeMarketGenesisArtifacts({ marketId, minBet: 5, deadlineMs: 1700000000000 });
  return ensureMarketPending({
    id: marketId, token_def_id: 't1', question: 'q', deadline_ms: 1700000000000, min_bet: 5, seal_count: 2,
    committee_pubkeys_json: JSON.stringify([artifacts.committeePubkeyHex]), committee_privkey_enc: artifacts.committeePrivkeyEnvelope,
    rootclose_tmpl_hash: artifacts.rootCloseTmplHash,
  });
}

function makeSendCmd() {
  const calls = [];
  const sendCmd = async (relayId, cmd) => {
    calls.push(cmd);
    if (cmd.type === 'get_address_utxos') return { ok: true, utxos: [{ outpoint: { transactionId: 'ab'.repeat(32), index: 0 }, amount: '10000000000' }] };
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

// ══════════════ ⑥bet_mint步骤A(Stage 2): pending intent 被驱动推进 ══════════════
const { ensureBetIntent, getBetIntent } = await import('../lib/proto-bet-intent.mjs');
let betId1;
// 🔴 共享 DB 里此时可能还留着前面测试(④/⑤)没推完的市场行(genesis_pending/genesis_submitted)——
// cap 必须给够余量, sendCmd 必须能通用处理全部类型(不能像前几个测试那样窄范围throw), 否则会被
// leftover 市场行的推进/落地检查抢走 cap 或撞上"不该走到这里"的窄范围假设。
await t('⑥bet_mint 步骤A pending intent 经 runProtoDriverTick 真实推进到 submitted(真kaspa-wasm KTT genesis构造)', async () => {
  const { runProtoDriverTick } = await import('./proto-driver.mjs');
  betId1 = 'bet-driver-001';
  sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES (?, ?, ?, 0, 20, 'pending', datetime('now'))`).run(betId1, market1.id, 'cc'.repeat(32));
  ensureBetIntent({ betId: betId1, step: 'mint' });
  const { sendCmd, calls } = makeSendCmd();
  const out = await runProtoDriverTick({ sendCmd, relayId: RELAY_ID, kaspa, network: 'mainnet', relayAddress: relayAddr, log: quiet, cap: 20 });
  if (out.betMintAdvanced !== 1) throw new Error(`期望推进1条bet_mint, 实际 ${JSON.stringify(out)}`);
  const intent = getBetIntent(`proto-bet:${betId1}:mint`);
  if (intent.status !== 'submitted') throw new Error(`期望 submitted, 实际 ${intent.status}`);
  if (!calls.some((c) => c.type === 'covenant_broadcast' && c.intent_key === `proto-bet:${betId1}:mint`)) throw new Error('没有真的为这个bet发出 covenant_broadcast');
});

// ══════════════ ⑦bet_mint步骤A landed后proto_bets记账 ══════════════
await t('⑦bet_mint 步骤A submitted intent landed 后, proto_bets.mint_txid/status 被真实写回(两张表之间的桥)', async () => {
  const { runProtoDriverTick } = await import('./proto-driver.mjs');
  const intentBefore = getBetIntent(`proto-bet:${betId1}:mint`);
  const sendCmd = async (relayId, cmd) => {
    if (cmd.type === 'get_address_utxos') return { ok: true, utxos: [{ outpoint: { transactionId: 'ab'.repeat(32), index: 0 }, amount: '10000000000' }] };
    if (cmd.type === 'covenant_broadcast') return { ok: true, txId: cmd.expected_txid, intent_key: cmd.intent_key };
    if (cmd.type === 'check_utxo_landed') return { ok: true, landed: true, depth: 25 };
    throw new Error(`unexpected cmd ${cmd.type}`);
  };
  const out = await runProtoDriverTick({ sendCmd, relayId: RELAY_ID, kaspa, network: 'mainnet', relayAddress: relayAddr, log: quiet, cap: 20 });
  if (out.betMintLanded !== 1) throw new Error(`期望判定1条landed, 实际 ${JSON.stringify(out)}`);
  const bet = sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get(betId1);
  if (bet.mint_txid !== intentBefore.submitted_txid) throw new Error(`proto_bets.mint_txid 应该等于 intent.submitted_txid(实际 ${bet.mint_txid} vs ${intentBefore.submitted_txid})`);
  if (bet.status !== 'chip_minted_pending_stake') throw new Error(`proto_bets.status 应该推进, 实际 ${bet.status}`);
  const intentAfter = getBetIntent(`proto-bet:${betId1}:mint`);
  if (intentAfter.status !== 'landed') throw new Error(`intent 行也应该推进到 landed, 实际 ${intentAfter.status}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
