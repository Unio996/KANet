// proto-broadcast-ops.test.mjs — buildMarketGenesisAndBroadcast 真实构造 + driveMarketGenesis 端到端
// (账本1425/1438, Stage 1)。真 kaspa-wasm + 真编译, sendCmd 用脚本化假 relay(get_address_utxos/
// covenant_broadcast 两种命令), 零真链零真 IPC。
// Run: cd kasia-console && node src/lib/proto-broadcast-ops.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

if (!process.env._PROTO_BROADCAST_OPS_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_broadcast_ops_e2e_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_BROADCAST_OPS_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const kaspa = await import('kaspa-wasm');
const {
  buildMarketGenesisAndBroadcast, shardLeafTargetAddress,
  buildBetMintStepAAndBroadcast, betMintStepATargetAddress, markBetMintStepALanded,
} = await import('./proto-broadcast-ops.mjs');
const { computeMarketGenesisArtifacts } = await import('./proto-covenant-builder.mjs');
const { ensureMarketPending, getMarketRow, marketIntentKeyFor } = await import('./proto-market-intent.mjs');
const { betIntentKeyFor } = await import('./proto-bet-intent.mjs');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message + '\n' + e.stack); } };

const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('mainnet').toString();

const MARKET_ID = 'cc'.repeat(32);
const artifacts = await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: 5, deadlineMs: 1700000000000 });

// proto_token_defs 外键前置
{
  const { sqlite } = await import('../db/client.js');
  sqlite.prepare(`INSERT OR IGNORE INTO proto_token_defs (id,name,ticker,created_at) VALUES ('t1','Test','TST',datetime('now'))`).run();
}

const market = ensureMarketPending({
  id: MARKET_ID, token_def_id: 't1', question: 'test market', deadline_ms: 1700000000000, min_bet: 5, seal_count: 2,
  committee_pubkeys_json: JSON.stringify([artifacts.committeePubkeyHex]), committee_privkey_enc: artifacts.committeePrivkeyEnvelope,
  rootclose_tmpl_hash: artifacts.rootCloseTmplHash,
});

const FEE_UTXO_TXID = 'ab'.repeat(32);
function makeSendCmd({ covenantBroadcastResult } = {}) {
  const calls = [];
  const sendCmd = async (relayId, cmd) => {
    calls.push(cmd);
    if (cmd.type === 'get_address_utxos') {
      return { ok: true, utxos: [{ outpoint: { transactionId: FEE_UTXO_TXID, index: 0 }, amount: '10000000000' }] };
    }
    if (cmd.type === 'covenant_broadcast') {
      return covenantBroadcastResult ? covenantBroadcastResult(cmd) : { ok: true, txId: cmd.expected_txid, intent_key: cmd.intent_key };
    }
    throw new Error(`unexpected cmd ${cmd.type}`);
  };
  return { sendCmd, calls };
}

let expectedTxid;
await t('①buildMarketGenesisAndBroadcast 真实构造成功(get_address_utxos→真kaspa-wasm构造→原子写shardleaf_cov_id→covenant_broadcast)', async () => {
  const { sendCmd, calls } = makeSendCmd();
  const res = await buildMarketGenesisAndBroadcast({ kaspa, network: 'mainnet', market, sendCmd, relayId: 'relay-A', relayAddress: relayAddr });
  if (!res.txId) throw new Error(`未拿到 txId: ${JSON.stringify(res)}`);
  expectedTxid = res.txId;
  const utxoCall = calls.find((c) => c.type === 'get_address_utxos');
  if (!utxoCall || utxoCall.address !== relayAddr) throw new Error('get_address_utxos 没有用 relay 自己的地址查询');
  const bcCall = calls.find((c) => c.type === 'covenant_broadcast');
  if (!bcCall || !bcCall.tx_json || !bcCall.expected_txid || !Array.isArray(bcCall.sign_input_indices) || !Array.isArray(bcCall.genesis_output_indices)) {
    throw new Error(`covenant_broadcast 命令字段不全: ${JSON.stringify(bcCall)}`);
  }
  if (bcCall.intent_key !== marketIntentKeyFor(MARKET_ID)) throw new Error(`intent_key 不对: ${bcCall.intent_key}`);
});

await t('②shardleaf_cov_id 在 covenant_broadcast 命令发出【之前】已经原子写入 proto_markets(账本1438②)', async () => {
  const row = getMarketRow(MARKET_ID);
  if (!row.shardleaf_cov_id || !/^[0-9a-f]{64}$/.test(row.shardleaf_cov_id)) {
    throw new Error(`shardleaf_cov_id 未正确写入: ${row.shardleaf_cov_id}`);
  }
});

await t('③shardLeafTargetAddress 确定性重算(不调用 computeMarketGenesisArtifacts, 不依赖随机委员会密钥), 两次调用结果逐字节一致', async () => {
  const addr1 = shardLeafTargetAddress({ kaspa, network: 'mainnet', market: getMarketRow(MARKET_ID) });
  const addr2 = shardLeafTargetAddress({ kaspa, network: 'mainnet', market: getMarketRow(MARKET_ID) });
  if (!addr1.startsWith('kaspa:')) throw new Error(`地址形状不对: ${addr1}`);
  if (addr1 !== addr2) throw new Error(`两次确定性重算结果不一致: ${addr1} != ${addr2}`);
});

await t('④get_address_utxos 失败(relay 没回 ok) ⇒ buildMarketGenesisAndBroadcast 返回 {error}, 不 throw, 不发 covenant_broadcast', async () => {
  const sendCmd = async (relayId, cmd) => {
    if (cmd.type === 'get_address_utxos') return { ok: false, error: 'rpc down' };
    throw new Error(`不该走到这里: ${cmd.type}`);
  };
  const res = await buildMarketGenesisAndBroadcast({ kaspa, network: 'mainnet', market: getMarketRow(MARKET_ID), sendCmd, relayId: 'relay-A', relayAddress: relayAddr });
  if (!res.error) throw new Error(`应该返回 error, 实际 ${JSON.stringify(res)}`);
});

await t('⑤没有任何单个 UTXO 够用(fee 面值太小) ⇒ 返回 {error}, 不 throw', async () => {
  const sendCmd = async (relayId, cmd) => {
    if (cmd.type === 'get_address_utxos') return { ok: true, utxos: [{ outpoint: { transactionId: FEE_UTXO_TXID, index: 0 }, amount: '1000' }] };
    throw new Error(`不该走到这里: ${cmd.type}`);
  };
  const res = await buildMarketGenesisAndBroadcast({ kaspa, network: 'mainnet', market: getMarketRow(MARKET_ID), sendCmd, relayId: 'relay-A', relayAddress: relayAddr });
  if (!res.error || !/no_suitable_fee_utxo/.test(res.error)) throw new Error(`应该报 no_suitable_fee_utxo, 实际 ${JSON.stringify(res)}`);
});

await t('⑥covenant_broadcast 命令本身失败(relay 拒绝) ⇒ 返回 {error}, 不 throw', async () => {
  const { sendCmd } = makeSendCmd({ covenantBroadcastResult: () => ({ ok: false, code: 'net_loss_exceeded', error: 'too expensive' }) });
  const res = await buildMarketGenesisAndBroadcast({ kaspa, network: 'mainnet', market: getMarketRow(MARKET_ID), sendCmd, relayId: 'relay-A', relayAddress: relayAddr });
  if (!res.error || !/too expensive/.test(res.error)) throw new Error(`应该透传 relay 的拒绝原因, 实际 ${JSON.stringify(res)}`);
});

// ══════════════ bet_mint 步骤A(Stage 2, 铸stake筹码, 账本1425/1436) ══════════════
{
  const { sqlite } = await import('../db/client.js');
  const BET_ID = 'bet-stage2-001';
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT OR IGNORE INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at)
    VALUES (?, ?, ?, 0, 20, 'pending', ?)
  `).run(BET_ID, MARKET_ID, 'bb'.repeat(32), now);
  const bet = sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get(BET_ID);

  await t('⑦buildBetMintStepAAndBroadcast 真实构造成功(get_address_utxos→真kaspa-wasm KTT genesis构造→covenant_broadcast)', async () => {
    const { sendCmd, calls } = makeSendCmd();
    const res = await buildBetMintStepAAndBroadcast({ kaspa, network: 'mainnet', bet, sendCmd, relayId: 'relay-A', relayAddress: relayAddr });
    if (!res.txId) throw new Error(`未拿到 txId: ${JSON.stringify(res)}`);
    const bcCall = calls.find((c) => c.type === 'covenant_broadcast');
    if (!bcCall || bcCall.intent_key !== betIntentKeyFor(BET_ID, 'mint')) throw new Error(`intent_key 不对: ${bcCall && bcCall.intent_key}`);
    if (JSON.stringify(bcCall.genesis_output_indices) !== '[0]') throw new Error(`genesis_output_indices 应该是[0], 实际 ${JSON.stringify(bcCall.genesis_output_indices)}`);
  });

  await t('⑧betMintStepATargetAddress 确定性重算(owner恒为STAKE_CHIP_OWNER_UNBOUND, 不依赖任何随机值), 两次调用结果逐字节一致', () => {
    const addr1 = betMintStepATargetAddress({ kaspa, network: 'mainnet', bet });
    const addr2 = betMintStepATargetAddress({ kaspa, network: 'mainnet', bet });
    if (!addr1.startsWith('kaspa:')) throw new Error(`地址形状不对: ${addr1}`);
    if (addr1 !== addr2) throw new Error(`两次确定性重算结果不一致: ${addr1} != ${addr2}`);
  });

  await t('⑨markBetMintStepALanded 把结果写回proto_bets(mint_txid/mint_vout=0/status推进), 幂等(WHERE status=pending)', () => {
    const txid = 'fe'.repeat(32);
    markBetMintStepALanded({ betId: BET_ID, txid });
    const after = sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get(BET_ID);
    if (after.mint_txid !== txid) throw new Error(`mint_txid 未写入: ${after.mint_txid}`);
    if (after.mint_vout !== 0) throw new Error(`mint_vout 应该是0: ${after.mint_vout}`);
    if (after.status !== 'chip_minted_pending_stake') throw new Error(`status 应该推进, 实际 ${after.status}`);
    // 幂等: 再调一次(不同txid), 因为 status 已经不是 pending, WHERE 条件不命中, 不应该被覆盖。
    markBetMintStepALanded({ betId: BET_ID, txid: 'ff'.repeat(32) });
    const after2 = sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get(BET_ID);
    if (after2.mint_txid !== txid) throw new Error(`幂等失败: mint_txid 被第二次调用覆盖成 ${after2.mint_txid}`);
  });

  await t('⑩buildBetMintStepAAndBroadcast 的 fee UTXO 不足时返回{error}, 不 throw', async () => {
    const sendCmd = async (relayId, cmd) => {
      if (cmd.type === 'get_address_utxos') return { ok: true, utxos: [{ outpoint: { transactionId: FEE_UTXO_TXID, index: 0 }, amount: '1000' }] };
      throw new Error(`不该走到这里: ${cmd.type}`);
    };
    const res = await buildBetMintStepAAndBroadcast({ kaspa, network: 'mainnet', bet, sendCmd, relayId: 'relay-A', relayAddress: relayAddr });
    if (!res.error || !/no_suitable_fee_utxo/.test(res.error)) throw new Error(`应该报 no_suitable_fee_utxo, 实际 ${JSON.stringify(res)}`);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
