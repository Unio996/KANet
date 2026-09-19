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
  rootclose_tmpl_hash: artifacts.rootCloseTmplHash, shardleaf_own_redeem_len: artifacts.shardLeafOwnRedeemLen,
});

const FEE_UTXO_TXID = 'ab'.repeat(32);
function makeSendCmd({ covenantBroadcastResult } = {}) {
  const calls = [];
  const sendCmd = async (relayId, cmd) => {
    calls.push(cmd);
    if (cmd.type === 'get_address_utxos') {
      // 账本1462修复后 SIGNED_INPUT_CEILING_SOMPI(1.0 KAS)会预先过滤面值过大的候选——原100 KAS巨额假面值
      // 已不再可用(会被判定"超过上限被排除"), 改用真实种子面值同量级的0.5 KAS(genesis真实所需仅≈0.213 KAS)。
      return { ok: true, utxos: [{ outpoint: { transactionId: FEE_UTXO_TXID, index: 0 }, amount: '50000000' }] };
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
    const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: marketRow.min_bet, sealCount: marketRow.seal_count, rootcloseTmplHash: marketRow.rootclose_tmpl_hash, state, ownRedeemLen: marketRow.shardleaf_own_redeem_len });
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
        // 账本1462修复后 SIGNED_INPUT_CEILING_SOMPI(1.0 KAS)会预先过滤面值过大的候选——原100 KAS巨额假
        // 面值已不再可用, 改用0.95 KAS(真实种子面值, 高于首笔下注在精确mass门控下的最小可行区间(约0.925~0.93 KAS, 2026-09-19订正; 原"≈0.82 KAS"来自旧本地估算))。
        if (cmd.address === relayAddr) return { ok: true, utxos: [{ outpoint: { transactionId: FEE_UTXO_TXID, index: 0 }, amount: '95000000' }] };
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

// ══════════════ 账本1462: 闸3金丝雀中止根因回归——真实种子面值(0.5/0.5/0.95 KAS)全链路 ══════════════
// 现象: proto-v0-funds 只有 0.5/0.5/0.95 KAS 三枚UTXO(1404/1456定案面值), market_genesis每个tick报
// no_suitable_fee_utxo。根因: 旧公式(GENESIS_OUTPUT_SOMPI+cap / CONTINUATION*2+GENESIS+cap)算出的
// "保守下界"(≈0.6-1.2 KAS)比真实所需(≈0.41-0.44 KAS requiredFee)宽松得多, 把这三枚真实种子UTXO全部
// 预筛掉——从未真正尝试构造。本节独立于上面的假面值(10000000000=100 KAS)测试段, 单独验证换成
// selectFeeUtxoByConstruction 之后, 用【真实种子面值】能不能真的选中+构造成功。
{
  const { computeShardLeafRedeemScript, computeKttGenesisArtifact } = await import('./proto-covenant-builder.mjs');
  const { deriveLeafState } = await import('./proto-leaf-state.mjs');
  const { buildRegisterAppendAndBroadcast } = await import('./proto-broadcast-ops.mjs');
  const { scriptPublicKeyFromHex } = await import('./proto-tx-assembly.mjs');
  const { sqlite } = await import('../db/client.js');

  const MARKET_ID_2 = 'ee'.repeat(32);
  const artifacts2 = await computeMarketGenesisArtifacts({ marketId: MARKET_ID_2, minBet: 5, deadlineMs: 1700000000000 });
  const market2 = ensureMarketPending({
    id: MARKET_ID_2, token_def_id: 't1', question: 'seed-face-value market(账本1462)', deadline_ms: 1700000000000, min_bet: 5, seal_count: 2,
    committee_pubkeys_json: JSON.stringify([artifacts2.committeePubkeyHex]), committee_privkey_enc: artifacts2.committeePrivkeyEnvelope,
    rootclose_tmpl_hash: artifacts2.rootCloseTmplHash, shardleaf_own_redeem_len: artifacts2.shardLeafOwnRedeemLen,
  });

  const SEED_0_5 = 50_000_000n, SEED_0_95 = 95_000_000n;
  const decodeInputAmounts = (txJson) => JSON.parse(txJson).inputs.map((i) => BigInt(i.utxo.amount));

  let genesisFeeValue;
  await t('⑫账本1462 genesis: 真实种子三枚UTXO(0.5/0.5/0.95 KAS)候选 ⇒ 构造成功且选中0.5 KAS(不再被保守下界一刀切拒绝)', async () => {
    const sendCmd = async (relayId, cmd) => {
      if (cmd.type === 'get_address_utxos') {
        // lint-allow-chain-amount-precision: SEED_0_5/SEED_0_95 是 sompi 整数 BigInt(非 KAS 浮点数), String(bigint)
        // 精确无损, 不是 KI-30 防的"KAS 浮点转字符串丢精度"那类风险(且这是构造 mock UTXO fixture, 非真实链上TX)。
        return { ok: true, utxos: [
          { outpoint: { transactionId: 'e1'.repeat(32), index: 0 }, amount: String(SEED_0_5) },
          { outpoint: { transactionId: 'e2'.repeat(32), index: 0 }, amount: String(SEED_0_5) },
          { outpoint: { transactionId: 'e3'.repeat(32), index: 0 }, amount: String(SEED_0_95) },
        ] };
      }
      if (cmd.type === 'covenant_broadcast') {
        genesisFeeValue = decodeInputAmounts(cmd.tx_json)[0];
        return { ok: true, txId: cmd.expected_txid, intent_key: cmd.intent_key };
      }
      throw new Error(`unexpected cmd ${cmd.type}`);
    };
    const res = await buildMarketGenesisAndBroadcast({ kaspa, network: 'mainnet', market: market2, sendCmd, relayId: 'relay-B', relayAddress: relayAddr });
    if (!res.txId) throw new Error(`应该构造成功(0.5/0.5/0.95三枚候选里应有可行解), 实际: ${JSON.stringify(res)}`);
    if (genesisFeeValue !== SEED_0_5) throw new Error(`应该选中0.5 KAS(第一个真实构造成功的, 按升序尝试不是0.95), 实际选中fee input面值=${genesisFeeValue}`);
  });

  const GENESIS_TXID_2 = 'e4'.repeat(32);
  sqlite.prepare(`UPDATE proto_markets SET shardleaf_txid = ?, shardleaf_vout = 0 WHERE id = ?`).run(GENESIS_TXID_2, MARKET_ID_2);
  const marketRow2 = getMarketRow(MARKET_ID_2);

  sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES (?, ?, ?, 0, 20, 'pending', datetime('now'))`)
    .run('bet-1462-001', MARKET_ID_2, 'f1'.repeat(32));
  const bet1462_1 = sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get('bet-1462-001');

  function leafAddressFor2(state) {
    const leafRedeem = computeShardLeafRedeemScript({ marketId: MARKET_ID_2, minBet: marketRow2.min_bet, sealCount: marketRow2.seal_count, rootcloseTmplHash: marketRow2.rootclose_tmpl_hash, state, ownRedeemLen: marketRow2.shardleaf_own_redeem_len });
    const spk = scriptPublicKeyFromHex(kaspa, leafRedeem.scriptPubKeyHex);
    return kaspa.addressFromScriptPublicKey(spk, 'mainnet').toString();
  }
  function heldAddressFor2(poolValue) {
    const artifact = computeKttGenesisArtifact({ amount: poolValue, ownerCovIdHex: marketRow2.shardleaf_cov_id });
    const spk = scriptPublicKeyFromHex(kaspa, artifact.scriptPubKeyHex);
    return kaspa.addressFromScriptPublicKey(spk, 'mainnet').toString();
  }
  // 首笔(genesis之后剩0.5/0.95, 无genesis找零单独建模——只测fee候选集合本身够不够, 不追加第三个候选,
  // 因为找零值本身不影响"能不能选中0.95这个真实需要的面值"这条断言)的fee候选: [0.5, 0.95]。
  function makeRealFeeSendCmd({ feeCandidates, heldOutpoint } = {}) {
    const calls = [];
    const currentState = deriveLeafState(MARKET_ID_2);
    const leafAddress = leafAddressFor2(currentState);
    const leafOutpointTxid = currentState.count === 0 ? GENESIS_TXID_2 : null;
    const sendCmd = async (relayId, cmd) => {
      calls.push(cmd);
      if (cmd.type === 'get_address_utxos') {
        if (cmd.address === leafAddress) {
          const txid = heldOutpoint ? heldOutpoint.leafTxid : leafOutpointTxid;
          return { ok: true, utxos: [{ outpoint: { transactionId: txid, index: 0 }, amount: '1000' }] };
        }
        if (heldOutpoint && cmd.address === heldAddressFor2(currentState.pool_value)) {
          return { ok: true, utxos: [{ outpoint: { transactionId: heldOutpoint.txid, index: 2 }, amount: '20000000' }] };
        }
        if (cmd.address === relayAddr) {
          // txid 必须是合法 64 位 hex(32 字节 Hash) — 早前 `f${i}`.repeat(16) 只拼出32字符(16字节),
          // kaspa-wasm 反序列化时报 "size error: Slice must have the length of Hash"。
          // lint-allow-chain-amount-precision: feeCandidates 里的 v 全部是 sompi 整数 BigInt, String(v) 精确
          // 无损(非 KI-30 防的 KAS 浮点转字符串场景), 且这是 mock UTXO fixture 非真实链上TX。
          return { ok: true, utxos: feeCandidates.map((v, i) => ({ outpoint: { transactionId: (10 + i).toString(16).padStart(2, '0').repeat(32), index: 0 }, amount: String(v) })) };
        }
        return { ok: true, utxos: [] };
      }
      if (cmd.type === 'covenant_broadcast') return { ok: true, txId: cmd.expected_txid, intent_key: cmd.intent_key, _tx_json: cmd.tx_json };
      throw new Error(`unexpected cmd ${cmd.type} addr=${cmd.address}`);
    };
    return { sendCmd, calls };
  }

  let firstBetTxid2, firstBetFeeValue;
  await t('⑬账本1462 首笔下注(无held)真实种子候选[0.5,0.95] KAS ⇒ 0.5太小构造不出可行找零形状(首笔最小可行落在约0.925~0.93 KAS区间, 2026-09-19精确mass门控订正; 原"≈0.82 KAS"来自旧本地估算), 逐个真实尝试后选中0.95且构造成功', async () => {
    const { sendCmd, calls } = makeRealFeeSendCmd({ feeCandidates: [SEED_0_5, SEED_0_95] });
    const res = await buildRegisterAppendAndBroadcast({ kaspa, network: 'mainnet', market: marketRow2, bet: bet1462_1, sendCmd, relayId: 'relay-B', relayAddress: relayAddr });
    if (!res.txId) throw new Error(`应该最终用0.95 KAS构造成功, 实际: ${JSON.stringify(res)}`);
    firstBetTxid2 = res.txId;
    const bcCall = calls.find((c) => c.type === 'covenant_broadcast');
    firstBetFeeValue = decodeInputAmounts(bcCall.tx_json).at(-1); // fee输入是最后一个input(见buildRegisterAppendTxJson的[leaf,(held?),fee]布局)
    if (firstBetFeeValue !== SEED_0_95) throw new Error(`应该选中0.95 KAS(0.5太小逐个尝试后失败, 0.95是第一个真实构造成功的), 实际选中fee input面值=${firstBetFeeValue}`);
  });

  const { markBetAppendLanded: markBetAppendLanded2 } = await import('./proto-broadcast-ops.mjs');
  markBetAppendLanded2({ betId: bet1462_1.id, txid: firstBetTxid2 });
  sqlite.prepare(`INSERT INTO proto_bet_intents (intent_key, bet_id, step, status, submitted_txid, landed_at, created_at, updated_at) VALUES (?, ?, 'append', 'landed', ?, datetime('now'), datetime('now'), datetime('now'))`)
    .run(betIntentKeyFor(bet1462_1.id, 'append'), bet1462_1.id, firstBetTxid2);

  sqlite.prepare(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES (?, ?, ?, 1, 30, 'pending', datetime('now'))`)
    .run('bet-1462-002', MARKET_ID_2, 'f2'.repeat(32));
  const bet1462_2 = sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get('bet-1462-002');

  await t('⑭账本1462 第二笔下注(有held)真实种子候选[0.5] KAS ⇒ 如实报告(Bettor要求): 你实算最小可行约0.56 KAS, 0.5低于此值, 应当构造失败并报错(不是意外成功)', async () => {
    const { sendCmd } = makeRealFeeSendCmd({ feeCandidates: [SEED_0_5], heldOutpoint: { txid: firstBetTxid2, leafTxid: firstBetTxid2 } });
    const res = await buildRegisterAppendAndBroadcast({ kaspa, network: 'mainnet', market: marketRow2, bet: bet1462_2, sendCmd, relayId: 'relay-B', relayAddress: relayAddr });
    if (res.txId) throw new Error(`如实报告: 预期0.5 KAS对第二笔下注(有held)不够用应该失败, 实际却构造成功了(txId=${res.txId}) —— 说明真实最小可行面值比之前估算的≈0.56 KAS更低, 需要更新对execution page的成本核算指导`);
    if (!res.error || !/no_suitable_fee_utxo/.test(res.error)) throw new Error(`预期失败原因是no_suitable_fee_utxo, 实际: ${JSON.stringify(res)}`);
  });

  await t('⑮账本1462 第二笔下注(有held)真实种子候选[0.95] KAS ⇒ 0.95远高于≈0.56 KAS最小可行值, 应当构造成功(确认0.95作为execution page保底值仍然可靠)', async () => {
    const { sendCmd } = makeRealFeeSendCmd({ feeCandidates: [SEED_0_95], heldOutpoint: { txid: firstBetTxid2, leafTxid: firstBetTxid2 } });
    const res = await buildRegisterAppendAndBroadcast({ kaspa, network: 'mainnet', market: marketRow2, bet: bet1462_2, sendCmd, relayId: 'relay-B', relayAddress: relayAddr });
    if (!res.txId) throw new Error(`0.95 KAS应该足够第二笔下注(有held)构造成功, 实际: ${JSON.stringify(res)}`);
  });

  await t('⑯账本1462 全部候选面值 > SIGNED_INPUT_CEILING_SOMPI(1.0 KAS) ⇒ 全部被预先过滤, 报no_suitable_fee_utxo, 不浪费一次真实构造尝试', async () => {
    const sendCmd = async (relayId, cmd) => {
      if (cmd.type === 'get_address_utxos') {
        return { ok: true, utxos: [{ outpoint: { transactionId: 'ff'.repeat(32), index: 0 }, amount: '150000000' }] }; // 1.5 KAS
      }
      throw new Error(`不该走到这里: ${cmd.type}`);
    };
    const res = await buildMarketGenesisAndBroadcast({ kaspa, network: 'mainnet', market: market2, sendCmd, relayId: 'relay-B', relayAddress: relayAddr });
    if (!res.error || !/no_suitable_fee_utxo/.test(res.error)) throw new Error(`应该报no_suitable_fee_utxo(全部候选超过SIGNED_INPUT_CEILING_SOMPI), 实际: ${JSON.stringify(res)}`);
    if (!/超过上限被排除/.test(res.error)) throw new Error(`报错信息应该说明是因为超过上限被排除, 不是构造失败, 实际: ${res.error}`);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
