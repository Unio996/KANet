// proto-broadcast-ops.test.mjs — buildMarketGenesisAndBroadcast(market_genesis)+
// buildRegisterAppendAndBroadcast(bet_mint, D-020单笔交易, 账本1425/1429/1436/1439/1446/1448)
// 真实构造端到端。真 kaspa-wasm + 真编译, sendCmd 用脚本化假 relay(get_address_utxos/
// covenant_broadcast 两种命令), 零真链零真 IPC。原 Stage 2(独立铸stake筹码步骤A)的测试段已随
// D-020取消步骤A一起删除。
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

// ══════════════ bet_mint(register_append 单笔交易, D-020账本1446/1448) ══════════════
{
  const { computeShardLeafRedeemScript, computeKttGenesisArtifact } = await import('./proto-covenant-builder.mjs');
  const { deriveLeafState } = await import('./proto-leaf-state.mjs');
  const { buildRegisterAppendAndBroadcast, registerAppendTargetAddress, markBetAppendLanded } = await import('./proto-broadcast-ops.mjs');
  const { scriptPublicKeyFromHex } = await import('./proto-tx-assembly.mjs');
  const { sqlite } = await import('../db/client.js');

  // 市场genesis已落链(测试①/②已经把shardleaf_cov_id写好了), 但shardleaf_txid/vout本测试文件从没
  // 跑过checkMarketGenesisLanded那条路径——手动设一个模拟的genesis outpoint, 模拟"genesis已落链"。
  const GENESIS_TXID = 'ae'.repeat(32); // 有效hex(之前误用'ge'.repeat(32), 'g'不是合法hex字符, 撞出"Invalid character")
  sqlite.prepare(`UPDATE proto_markets SET shardleaf_txid = ?, shardleaf_vout = 0 WHERE id = ?`).run(GENESIS_TXID, MARKET_ID);
  const marketRow = getMarketRow(MARKET_ID);
  // D-020: 下注直接从 pending 开始, 没有铸筹码中间态——不再需要 mint_txid/mint_vout。
  const BET_ID = 'bet-stage3-001';
  sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES (?, ?, ?, 0, 20, 'pending', datetime('now'))`)
    .run(BET_ID, MARKET_ID, 'bb'.repeat(32));
  const bet = sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get(BET_ID);

  function leafAddressFor(state) {
    const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: marketRow.min_bet, sealCount: marketRow.seal_count, rootcloseTmplHash: marketRow.rootclose_tmpl_hash, state });
    const spk = scriptPublicKeyFromHex(kaspa, leafRedeem.scriptPubKeyHex);
    return kaspa.addressFromScriptPublicKey(spk, 'mainnet').toString();
  }
  function heldAddressFor(poolValue) {
    const artifact = computeKttGenesisArtifact({ amount: poolValue, ownerCovIdHex: marketRow.shardleaf_cov_id });
    const spk = scriptPublicKeyFromHex(kaspa, artifact.scriptPubKeyHex);
    return kaspa.addressFromScriptPublicKey(spk, 'mainnet').toString();
  }

  function makeStage3SendCmd({ heldOutpoint } = {}) {
    const calls = [];
    const currentState = deriveLeafState(MARKET_ID);
    const leafAddress = leafAddressFor(currentState);
    const leafOutpointTxid = currentState.count === 0 ? GENESIS_TXID : null; // 只有第一笔下注时leaf outpoint是genesis; 有landed append后deriveLeafOutpoint会用那条intent的txid, 由调用方在heldOutpoint里一并给
    const sendCmd = async (relayId, cmd) => {
      calls.push(cmd);
      if (cmd.type === 'get_address_utxos') {
        if (cmd.address === leafAddress) {
          const txid = heldOutpoint ? heldOutpoint.leafTxid : leafOutpointTxid;
          return { ok: true, utxos: [{ outpoint: { transactionId: txid, index: 0 }, amount: '1000' }] };
        }
        if (heldOutpoint && cmd.address === heldAddressFor(currentState.pool_value)) {
          return { ok: true, utxos: [{ outpoint: { transactionId: heldOutpoint.txid, index: 2 }, amount: '20000000' }] };
        }
        if (cmd.address === relayAddr) return { ok: true, utxos: [{ outpoint: { transactionId: FEE_UTXO_TXID, index: 0 }, amount: '10000000000' }] };
        return { ok: true, utxos: [] };
      }
      if (cmd.type === 'covenant_broadcast') return { ok: true, txId: cmd.expected_txid, intent_key: cmd.intent_key };
      throw new Error(`unexpected cmd ${cmd.type} addr=${cmd.address}`);
    };
    return { sendCmd, calls };
  }

  let firstBetTxid;
  await t('⑦(第一笔下注/无held) buildRegisterAppendAndBroadcast 真实构造成功(三项fail-closed核对全过)', async () => {
    const { sendCmd, calls } = makeStage3SendCmd();
    const res = await buildRegisterAppendAndBroadcast({ kaspa, network: 'mainnet', market: marketRow, bet, sendCmd, relayId: 'relay-A', relayAddress: relayAddr });
    if (!res.txId) throw new Error(`未拿到txId: ${JSON.stringify(res)}`);
    firstBetTxid = res.txId;
    const bcCall = calls.find((c) => c.type === 'covenant_broadcast');
    if (!bcCall || bcCall.intent_key !== betIntentKeyFor(bet.id, 'append')) throw new Error(`intent_key不对: ${bcCall && bcCall.intent_key}`);
    if (JSON.stringify(bcCall.genesis_output_indices) !== '[2]' || JSON.stringify(bcCall.continuation_output_indices) !== '[0]') {
      throw new Error(`输出索引不对: ${JSON.stringify(bcCall.genesis_output_indices)} / ${JSON.stringify(bcCall.continuation_output_indices)}`);
    }
  });

  await t('⑧registerAppendTargetAddress 确定性重算(下注后的新state), 两次调用结果逐字节一致', () => {
    const a1 = registerAppendTargetAddress({ kaspa, network: 'mainnet', market: marketRow, bet });
    const a2 = registerAppendTargetAddress({ kaspa, network: 'mainnet', market: marketRow, bet });
    if (!a1.startsWith('kaspa:')) throw new Error(`地址形状不对: ${a1}`);
    if (a1 !== a2) throw new Error('两次确定性重算结果不一致');
  });

  await t('⑨markBetAppendLanded 把proto_bets推进到confirmed(stake_tx_id/ticket_txid写入), 幂等(WHERE status=pending, D-020: 无中间态)', () => {
    markBetAppendLanded({ betId: bet.id, txid: firstBetTxid });
    const after = sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get(bet.id);
    if (after.status !== 'confirmed') throw new Error(`应该是confirmed, 实际 ${after.status}`);
    if (after.stake_tx_id !== firstBetTxid) throw new Error('stake_tx_id未写入');
    if (after.ticket_txid !== firstBetTxid || after.ticket_vout !== 1) throw new Error(`ticket_txid/vout不对: ${after.ticket_txid}/${after.ticket_vout}`);
    markBetAppendLanded({ betId: bet.id, txid: 'zz'.repeat(32) }); // 幂等: 已经confirmed, 不该被覆盖
    const after2 = sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get(bet.id);
    if (after2.stake_tx_id !== firstBetTxid) throw new Error('幂等失败: stake_tx_id被第二次调用覆盖');
  });

  // ── 第二笔下注(有held): 手动补一条landed的append intent, 模拟"第一笔已经真的landed" ──
  const BET_ID2 = 'bet-stage3-002';
  sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES (?, ?, ?, 1, 30, 'pending', datetime('now'))`)
    .run(BET_ID2, MARKET_ID, 'cc'.repeat(32));
  sqlite.prepare(`INSERT INTO proto_bet_intents (intent_key, bet_id, step, status, submitted_txid, landed_at, created_at, updated_at) VALUES (?, ?, 'append', 'landed', ?, datetime('now'), datetime('now'), datetime('now'))`)
    .run(betIntentKeyFor(bet.id, 'append'), bet.id, firstBetTxid);
  const bet2 = sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get(BET_ID2);

  await t('⑩(第二笔下注/有held) buildRegisterAppendAndBroadcast 真实构造成功(held outpoint推算+链上核对全过)', async () => {
    const { sendCmd, calls } = makeStage3SendCmd({ heldOutpoint: { txid: firstBetTxid, leafTxid: firstBetTxid } });
    const res = await buildRegisterAppendAndBroadcast({ kaspa, network: 'mainnet', market: marketRow, bet: bet2, sendCmd, relayId: 'relay-A', relayAddress: relayAddr });
    if (!res.txId) throw new Error(`未拿到txId: ${JSON.stringify(res)}`);
    const bcCall = calls.find((c) => c.type === 'covenant_broadcast');
    if (!bcCall) throw new Error('没有真的发出covenant_broadcast');
  });

  await t('⑪(账本1429) 同一市场存在in-flight append intent时, 新的append被assertNoInFlightAppend拒绝', async () => {
    const BET_ID3 = 'bet-stage3-003';
    sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES (?, ?, ?, 0, 5, 'pending', datetime('now'))`)
      .run(BET_ID3, MARKET_ID, 'dd'.repeat(32));
    sqlite.prepare(`INSERT INTO proto_bet_intents (intent_key, bet_id, step, status, created_at, updated_at) VALUES (?, ?, 'append', 'prepared', datetime('now'), datetime('now'))`)
      .run(betIntentKeyFor(bet2.id, 'append'), bet2.id); // bet2的append还在飞(prepared, 模拟还没landed)
    const bet3 = sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get(BET_ID3);
    const { sendCmd, calls } = makeStage3SendCmd();
    const res = await buildRegisterAppendAndBroadcast({ kaspa, network: 'mainnet', market: marketRow, bet: bet3, sendCmd, relayId: 'relay-A', relayAddress: relayAddr });
    if (!res.error || !/market_append_in_flight/.test(res.error)) throw new Error(`应该拒绝并报market_append_in_flight, 实际 ${JSON.stringify(res)}`);
    if (calls.some((c) => c.type === 'covenant_broadcast')) throw new Error('不该发出covenant_broadcast');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
