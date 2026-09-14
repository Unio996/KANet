// proto-broadcast-ops.mjs — market_genesis/bet_mint 真正"构造+发 covenant_broadcast"的胶水层
// (J2, 账本1425/1438, Stage 1 覆盖 market_genesis; Stage 2 本笔补 bet_mint 步骤A(铸stake筹码);
// 步骤B(register_append, 需要 held 查找+同市场串行)留 Stage 3)。
//
// 职责分层: proto-market-intent.mjs/proto-bet-intent.mjs 只管状态机(pending→prepared→submitted→
// landed), 不碰 kaspa-wasm; proto-tx-assembly.mjs/proto-covenant-builder.mjs 只管纯构造(不碰 IPC/DB
// 状态转移); 本文件是两者之间"driveMarketGenesis/driveBetIntent 需要的 buildAndBroadcast({attempt})
// 回调"的真正实现——拿 fee UTXO、调构造函数、原子写入 shardleaf_cov_id(账本1438②要求"发 IPC 之前"、
// "同一次 DB 写入")、发 covenant_broadcast 命令。
//
// 🔴 M0a 门: 不 bare-import relay-manager——sendCmd/relayId 全部由调用方(proto-driver.mjs)注入,
// 本文件只依赖 kaspa-wasm(注入)+ proto-tx-assembly.mjs/proto-covenant-builder.mjs/proto-market-intent.mjs。
//
// 🔴 账本1438②(Bettor裁定, 已否决"由 relay 侧 ingestPhase 传回再写"这条路): shardleaf_cov_id 是纯本地
// 确定性值(buildMarketGenesisTxJson 返回值, 只依赖已经算好的 tx 结构, 不依赖链上事实), 必须在发
// covenant_broadcast 命令之前就地写入 proto_markets, 不能等 relay 回执。用 markMarketStatus 一次
// UPDATE 语句写入(better-sqlite3 单语句本身是原子的, 满足"同一个数据库事务"的要求)。

import { sqlite } from '../db/client.js';
import {
  scriptPublicKeyFromHex, buildMarketGenesisTxJson, buildKttGenesisTxJson, buildRegisterAppendTxJson,
  selectFeeUtxo, GENESIS_OUTPUT_SOMPI, CONTINUATION_OUTPUT_SOMPI, REGISTER_APPEND_TICKET_OUT_INDEX,
} from './proto-tx-assembly.mjs';
import {
  computeShardLeafRedeemScript, computeKttGenesisArtifact, computeTicketGenesisArtifact,
  STAKE_CHIP_OWNER_UNBOUND, loadFeeProfileCap, loadProtocolConstants,
} from './proto-covenant-builder.mjs';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from './pool-bshard-artifacts.mjs';
import { marketIntentKeyFor, markMarketStatus } from './proto-market-intent.mjs';
import { betIntentKeyFor } from './proto-bet-intent.mjs';
import {
  deriveLeafState, deriveLeafOutpoint, deriveHeldKttOutpoint, assertNoInFlightAppend,
  assertLeafAndHeldConsistent, assertLeafStateMatchesChain, assertHeldKttOutpointMatchesChain,
} from './proto-leaf-state.mjs';
import { PROTO_COVENANT_BROADCAST_TYPE } from './proto-relay-guard.mjs';

const SHARD_LEAF_DIRECT_SIL = new URL('./ShardLeaf_direct.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** 在 get_address_utxos(address) 的返回集里找特定 outpoint, 找到 ⇒ {value}(隐含"未花费+scriptPubKey
 * 匹配该地址", 因为 RPC 只按地址匹配返回它自己的 scriptPubKey 下的 UTXO), 找不到 ⇒ null。 */
function findUtxoValueAt(rawUtxos, txid, vout) {
  const hit = (rawUtxos || []).find((u) => u.outpoint && u.outpoint.transactionId === txid && Number(u.outpoint.index) === Number(vout));
  return hit ? BigInt(hit.amount || 0) : null;
}

/** get_address_utxos 原始返回项 → buildMarketGenesisTxJson 期望的 feeUtxo 形状。 */
function toFeeUtxoCandidates(rawUtxos, feeSpk, feeSpkHex) {
  return (rawUtxos || [])
    .filter((u) => u.outpoint)
    .map((u) => ({ txid: u.outpoint.transactionId, vout: u.outpoint.index, value: BigInt(u.amount || 0), scriptPublicKeyHex: feeSpkHex }));
}

/**
 * driveMarketGenesis 的 buildAndBroadcast({attempt}) 回调实体。
 * @param {object} o
 * @param {*} o.kaspa  kaspa-wasm(注入)
 * @param {string} o.network
 * @param {object} o.market  proto_markets 行(id/min_bet/seal_count/rootclose_tmpl_hash 必须已存在)
 * @param {Function} o.sendCmd  relay-manager.sendCommandAsync(注入)
 * @param {string} o.relayId  PROTO_RELAY_ID
 * @param {string} o.relayAddress  该 relay 的收款地址(bech32)——找零回它自己
 * @returns {Promise<{txId:string}|{error:string}>}
 */
export async function buildMarketGenesisAndBroadcast({ kaspa, network, market, sendCmd, relayId, relayAddress }) {
  const { Address, addressFromScriptPublicKey } = kaspa;
  const relaySpk = kaspa.payToAddressScript(new Address(relayAddress));
  const relaySpkHex = '0x' + relaySpk.script;

  const leafRedeem = computeShardLeafRedeemScript({
    marketId: market.id, minBet: market.min_bet, sealCount: market.seal_count,
    rootcloseTmplHash: market.rootclose_tmpl_hash, state: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 },
  });

  const cap = loadFeeProfileCap('market_genesis');
  const minRequired = GENESIS_OUTPUT_SOMPI + cap; // 保守下界: 留够 GENESIS 输出 + 整个 cap 的余量, 保证 selectChangeShape 有解
  const utxoRes = await sendCmd(relayId, { type: 'get_address_utxos', address: relayAddress }, 15000, 'proto-driver');
  if (!utxoRes?.ok) return { error: `get_address_utxos failed: ${utxoRes?.error || 'no response'}` };
  const candidates = toFeeUtxoCandidates(utxoRes.utxos, relaySpk, relaySpkHex);
  let feeUtxo;
  try { feeUtxo = selectFeeUtxo(candidates, minRequired); }
  catch (e) { return { error: e.message }; }

  let built;
  try {
    built = buildMarketGenesisTxJson({
      kaspa, network, feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
      shardLeafScriptPubKeyHex: leafRedeem.scriptPubKeyHex, absFeeCapSompi: cap,
    });
  } catch (e) { return { error: `buildMarketGenesisTxJson failed: ${e.message}` }; }

  // 🔴 账本1438②: 发 IPC 之前原子写入(单条 UPDATE), 不等 relay 回执。
  markMarketStatus(market.id, { shardleaf_cov_id: built.shardLeafCovId });

  const rep = await sendCmd(relayId, {
    type: PROTO_COVENANT_BROADCAST_TYPE,
    intent_key: marketIntentKeyFor(market.id),
    tx_json: built.txJson,
    sign_input_indices: built.signInputIndices,
    expected_txid: built.expectedTxid,
    genesis_output_indices: built.genesisOutputIndices,
    continuation_output_indices: built.continuationOutputIndices,
  }, 30000, 'proto-driver');

  if (rep?.ok && rep?.txId) return { txId: rep.txId };
  return { error: rep?.error || `covenant_broadcast failed (code=${rep?.code || 'unknown'})` };
}

/** market_genesis 落链判据用的地址(genesis ShardLeaf_direct 输出的 P2SH bech32 地址)——从 rootclose_tmpl_hash
 * 等已存字段确定性重算(genesis state 全0), 不依赖任何随机值。 */
export function shardLeafTargetAddress({ kaspa, network, market }) {
  const leafRedeem = computeShardLeafRedeemScript({
    marketId: market.id, minBet: market.min_bet, sealCount: market.seal_count,
    rootcloseTmplHash: market.rootclose_tmpl_hash, state: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 },
  });
  const spk = scriptPublicKeyFromHex(kaspa, leafRedeem.scriptPubKeyHex);
  return kaspa.addressFromScriptPublicKey(spk, network).toString();
}

/**
 * driveBetIntent(step='mint') 的 buildAndBroadcast({attempt}) 回调实体(Stage 2, bet_mint 步骤A:
 * 铸stake筹码, owner=STAKE_CHIP_OWNER_UNBOUND, 账本1436)。结构与 buildMarketGenesisAndBroadcast
 * 完全对称(同样是"1 fee 输入 genesis 一个新 covenant 实例"的形状), 无需像市场创世那样原子写
 * covenant_id(stake 筹码没有类似 shardleaf_cov_id 的落链校验需求, 账本1425/1436的裁定范围止步于
 * owner 值本身, 不延伸到额外落库校验)。
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.network
 * @param {object} o.bet  proto_bets 行(id/stake 必须已存在)
 * @param {Function} o.sendCmd
 * @param {string} o.relayId
 * @param {string} o.relayAddress
 * @returns {Promise<{txId:string}|{error:string}>}
 */
export async function buildBetMintStepAAndBroadcast({ kaspa, network, bet, sendCmd, relayId, relayAddress }) {
  const { Address } = kaspa;
  const relaySpk = kaspa.payToAddressScript(new Address(relayAddress));
  const relaySpkHex = '0x' + relaySpk.script;

  const kttArtifact = computeKttGenesisArtifact({ amount: bet.stake, ownerCovIdHex: STAKE_CHIP_OWNER_UNBOUND });

  const cap = loadFeeProfileCap('bet_mint_step_a');
  const minRequired = GENESIS_OUTPUT_SOMPI + cap;
  const utxoRes = await sendCmd(relayId, { type: 'get_address_utxos', address: relayAddress }, 15000, 'proto-driver');
  if (!utxoRes?.ok) return { error: `get_address_utxos failed: ${utxoRes?.error || 'no response'}` };
  const candidates = toFeeUtxoCandidates(utxoRes.utxos, relaySpk, relaySpkHex);
  let feeUtxo;
  try { feeUtxo = selectFeeUtxo(candidates, minRequired); }
  catch (e) { return { error: e.message }; }

  let built;
  try {
    built = buildKttGenesisTxJson({
      kaspa, network, feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
      kttScriptPubKeyHex: kttArtifact.scriptPubKeyHex, absFeeCapSompi: cap,
    });
  } catch (e) { return { error: `buildKttGenesisTxJson failed: ${e.message}` }; }

  const rep = await sendCmd(relayId, {
    type: PROTO_COVENANT_BROADCAST_TYPE,
    intent_key: betIntentKeyFor(bet.id, 'mint'),
    tx_json: built.txJson,
    sign_input_indices: built.signInputIndices,
    expected_txid: built.expectedTxid,
    genesis_output_indices: built.genesisOutputIndices,
    continuation_output_indices: built.continuationOutputIndices,
  }, 30000, 'proto-driver');

  if (rep?.ok && rep?.txId) return { txId: rep.txId };
  return { error: rep?.error || `covenant_broadcast failed (code=${rep?.code || 'unknown'})` };
}

/** bet_mint 步骤A 落链判据用的地址(KTT genesis 输出的 P2SH bech32 地址)——从 bet.stake 确定性重算
 * (owner 恒为 STAKE_CHIP_OWNER_UNBOUND, 不依赖任何随机值)。 */
export function betMintStepATargetAddress({ kaspa, network, bet }) {
  const kttArtifact = computeKttGenesisArtifact({ amount: bet.stake, ownerCovIdHex: STAKE_CHIP_OWNER_UNBOUND });
  const spk = scriptPublicKeyFromHex(kaspa, kttArtifact.scriptPubKeyHex);
  return kaspa.addressFromScriptPublicKey(spk, network).toString();
}

/**
 * bet_mint 步骤A landed 后的 proto_bets 记账(driveBetIntent/checkBetIntentLanded 只更新
 * proto_bet_intents 表, 不知道 proto_bets 的存在——这条 UPDATE 是两张表之间唯一的桥, 单独成一个
 * 具名函数放在这个"胶水层"文件里, 不塞进 proto-bet-intent.mjs(该文件职责单一, 文件头注明确
 * "不碰 proto_bets 表")。WHERE status='pending' 做幂等(重复调用/并发 tick 不会二次改写或报错)。
 * genesisOutputIndices 恒为 [0](buildKttGenesisTxJson 的既定形状), vout 因此恒为 0。
 */
export function markBetMintStepALanded({ betId, txid }) {
  sqlite.prepare(`
    UPDATE proto_bets SET mint_txid = ?, mint_vout = 0, status = 'chip_minted_pending_stake'
    WHERE id = ? AND status = 'pending'
  `).run(txid, betId);
}

/**
 * driveBetIntent(step='append') 的 buildAndBroadcast({attempt}) 回调实体(Stage 3, bet_mint 步骤B:
 * register_append, 账本1425/1429/1436/1439)。构造前的三项 fail-closed 核对(账本1429/1439, Bettor
 * 明确要求"放在构造B之前的同一个fail-closed步骤里完成", 不分散到多处):
 *   ① assertNoInFlightAppend: 同一市场 append 串行(调用方——proto-driver.mjs——已经在外层做过一次,
 *      这里再做一次是双重防线, 便宜的查询, 不怕重复)。
 *   ② 链上核对 leaf 当前 UTXO(assertLeafStateMatchesChain)+ held KTT UTXO(若存在,
 *      assertHeldKttOutpointMatchesChain)——两者的 outpoint 由 deriveLeafOutpoint/
 *      deriveHeldKttOutpoint(账本1439①)推算, 链上现状经 get_address_utxos 查询(找到=未花费+
 *      scriptPubKey匹配该地址, 找不到=null, 两种情况下面两个 assert 函数自己处理)。
 *   ③ assertLeafAndHeldConsistent: pool_value 与 held 存在性的交叉一致性检查。
 * 任一失败直接 throw(不吞、不重试、不构造)。
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.network
 * @param {object} o.market  proto_markets 行(需要 shardleaf_cov_id 已经写好, 即 genesis 已 landed)
 * @param {object} o.bet  这一笔要 append 的 proto_bets 行(id/side/stake/bettor_pk/mint_txid/mint_vout 必须已存在)
 * @param {Function} o.sendCmd
 * @param {string} o.relayId
 * @param {string} o.relayAddress
 * @returns {Promise<{txId:string}|{error:string}>}
 */
export async function buildRegisterAppendAndBroadcast({ kaspa, network, market, bet, sendCmd, relayId, relayAddress }) {
  const { Address } = kaspa;
  const marketId = market.id;
  const leafCovId = market.shardleaf_cov_id;
  if (!leafCovId) return { error: 'market has no shardleaf_cov_id recorded — genesis not landed yet' };

  // ── 唯一的 fail-closed 前置步骤(账本1429/1439, 三项都在这里做) ──
  try { assertNoInFlightAppend(marketId); } catch (e) { return { error: e.message }; }

  const currentState = deriveLeafState(marketId);
  let leafOutpoint, heldOutpointRaw;
  try {
    leafOutpoint = deriveLeafOutpoint(marketId);
    heldOutpointRaw = deriveHeldKttOutpoint(marketId);
    assertLeafAndHeldConsistent(marketId);
  } catch (e) { return { error: e.message }; }

  const leafRedeem = computeShardLeafRedeemScript({
    marketId, minBet: market.min_bet, sealCount: market.seal_count, rootcloseTmplHash: market.rootclose_tmpl_hash, state: currentState,
  });
  const leafSpk = scriptPublicKeyFromHex(kaspa, leafRedeem.scriptPubKeyHex);
  const leafAddress = kaspa.addressFromScriptPublicKey(leafSpk, network).toString();
  const leafUtxoRes = await sendCmd(relayId, { type: 'get_address_utxos', address: leafAddress }, 15000, 'proto-driver');
  if (!leafUtxoRes?.ok) return { error: `get_address_utxos(leaf) failed: ${leafUtxoRes?.error || 'no response'}` };
  const leafValue = findUtxoValueAt(leafUtxoRes.utxos, leafOutpoint.txid, leafOutpoint.vout);
  try {
    assertLeafStateMatchesChain({
      marketId, shardLeafRedeemScript: leafRedeem.script, stateLayout: leafRedeem.stateLayout,
      chainUtxo: leafValue === null ? null : { scriptPublicKeyHex: leafRedeem.scriptPubKeyHex, spent: false },
    });
  } catch (e) { return { error: e.message }; }

  let heldArtifact = null;
  if (heldOutpointRaw) {
    heldArtifact = computeKttGenesisArtifact({ amount: currentState.pool_value, ownerCovIdHex: leafCovId });
    const heldSpk = scriptPublicKeyFromHex(kaspa, heldArtifact.scriptPubKeyHex);
    const heldAddress = kaspa.addressFromScriptPublicKey(heldSpk, network).toString();
    const heldUtxoRes = await sendCmd(relayId, { type: 'get_address_utxos', address: heldAddress }, 15000, 'proto-driver');
    if (!heldUtxoRes?.ok) return { error: `get_address_utxos(held) failed: ${heldUtxoRes?.error || 'no response'}` };
    const heldValue = findUtxoValueAt(heldUtxoRes.utxos, heldOutpointRaw.txid, heldOutpointRaw.vout);
    try {
      assertHeldKttOutpointMatchesChain({
        marketId, leafCovId,
        chainUtxo: heldValue === null ? null : { scriptPublicKeyHex: heldArtifact.scriptPubKeyHex, spent: false, value: heldValue },
      });
    } catch (e) { return { error: e.message }; }
  }

  // ── 前置核对全过, 开始真正构造 ──
  const newState = {
    local_yes: currentState.local_yes + (bet.side === 0 ? bet.stake : 0),
    local_no: currentState.local_no + (bet.side === 1 ? bet.stake : 0),
    count: currentState.count + 1,
    pool_value: currentState.pool_value + bet.stake,
  };

  const { ps_tmpl_hash, token_tmpl_hash, ps_prefix, ps_suffix, token_prefix, token_suffix } = loadProtocolConstants();
  const sldCtor = [
    ctorBytes32V100(marketId), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(marketId),
    ctorIntV100(market.seal_count), ctorIntV100(market.min_bet), ctorBytes32V100(market.rootclose_tmpl_hash), ctorBytes32V100('00'.repeat(32)),
    ctorBytes32V100(token_tmpl_hash), ctorIntV100(currentState.local_yes), ctorIntV100(currentState.local_no), ctorIntV100(currentState.count), ctorIntV100(currentState.pool_value),
  ];
  const sldCompiled = compileSilV100(SHARD_LEAF_DIRECT_SIL, sldCtor, 'ShardLeaf_direct');
  const registerAppendEntryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.register_append;

  const stakeArtifact = computeKttGenesisArtifact({ amount: bet.stake, ownerCovIdHex: STAKE_CHIP_OWNER_UNBOUND });
  const stakeInput = {
    txid: bet.mint_txid, vout: bet.mint_vout, value: GENESIS_OUTPUT_SOMPI, scriptPublicKeyHex: stakeArtifact.scriptPubKeyHex,
    redeemScript: stakeArtifact.script, entryAbi: stakeArtifact.entryAbi, stateFieldCount: stakeArtifact.stateFieldCount,
  };
  let heldInput = null;
  if (heldOutpointRaw) {
    heldInput = {
      txid: heldOutpointRaw.txid, vout: heldOutpointRaw.vout, value: CONTINUATION_OUTPUT_SOMPI, scriptPublicKeyHex: heldArtifact.scriptPubKeyHex,
      redeemScript: heldArtifact.script, entryAbi: heldArtifact.entryAbi, stateFieldCount: heldArtifact.stateFieldCount,
    };
  }

  const ticketArtifact = computeTicketGenesisArtifact({ bettorPk: bet.bettor_pk, direction: bet.side, stake: bet.stake, shardPoolId: marketId });
  const mergedKttArtifact = computeKttGenesisArtifact({ amount: newState.pool_value, ownerCovIdHex: leafCovId });

  const { Address: _A } = kaspa;
  const relaySpk = kaspa.payToAddressScript(new Address(relayAddress));
  const relaySpkHex = '0x' + relaySpk.script;
  const cap = loadFeeProfileCap('bet_mint_step_b');
  const minRequired = CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + cap;
  const feeUtxoRes = await sendCmd(relayId, { type: 'get_address_utxos', address: relayAddress }, 15000, 'proto-driver');
  if (!feeUtxoRes?.ok) return { error: `get_address_utxos(fee) failed: ${feeUtxoRes?.error || 'no response'}` };
  const feeCandidates = toFeeUtxoCandidates(feeUtxoRes.utxos, relaySpk, relaySpkHex);
  let feeUtxo;
  try { feeUtxo = selectFeeUtxo(feeCandidates, minRequired); }
  catch (e) { return { error: e.message }; }

  let built;
  try {
    built = buildRegisterAppendTxJson({
      kaspa, network,
      leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout, leafOutpoint, leafCovId,
      currentState, newState, heldInput, stakeInput, feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
      registerAppendEntryAbi,
      registerAppendArgs: {
        side: bet.side, stake: bet.stake, bettorPk: '0x' + bet.bettor_pk,
        psPrefix: '0x' + ps_prefix, psSuffix: '0x' + ps_suffix, tokPrefix: '0x' + token_prefix, tokSuffix: '0x' + token_suffix,
      },
      ticketScriptPubKeyHex: ticketArtifact.scriptPubKeyHex, mergedKttScript: mergedKttArtifact.script, absFeeCapSompi: cap,
    });
  } catch (e) { return { error: `buildRegisterAppendTxJson failed: ${e.message}` }; }

  const rep = await sendCmd(relayId, {
    type: PROTO_COVENANT_BROADCAST_TYPE,
    intent_key: betIntentKeyFor(bet.id, 'append'),
    tx_json: built.txJson,
    sign_input_indices: built.signInputIndices,
    expected_txid: built.expectedTxid,
    genesis_output_indices: built.genesisOutputIndices,
    continuation_output_indices: built.continuationOutputIndices,
  }, 30000, 'proto-driver');

  if (rep?.ok && rep?.txId) return { txId: rep.txId };
  return { error: rep?.error || `covenant_broadcast failed (code=${rep?.code || 'unknown'})` };
}

/** bet_mint 步骤B 落链判据用的地址——新 leaf 续约输出(REGISTER_APPEND_LEAF_CONT_OUT_INDEX)的 P2SH
 * bech32 地址, 从"下注后"的新 state 确定性重算。 */
export function registerAppendTargetAddress({ kaspa, network, market, bet }) {
  const currentState = deriveLeafState(market.id);
  const newState = {
    local_yes: currentState.local_yes + (bet.side === 0 ? bet.stake : 0),
    local_no: currentState.local_no + (bet.side === 1 ? bet.stake : 0),
    count: currentState.count + 1,
    pool_value: currentState.pool_value + bet.stake,
  };
  const leafRedeem = computeShardLeafRedeemScript({
    marketId: market.id, minBet: market.min_bet, sealCount: market.seal_count, rootcloseTmplHash: market.rootclose_tmpl_hash, state: newState,
  });
  const spk = scriptPublicKeyFromHex(kaspa, leafRedeem.scriptPubKeyHex);
  return kaspa.addressFromScriptPublicKey(spk, network).toString();
}

/**
 * bet_mint 步骤B landed 后的 proto_bets 记账(两张表之间的桥, 同 markBetMintStepALanded 的既有模式):
 * status 推进到 'confirmed'(deriveLeafState 的 SQL 查询就是靠这个状态筛选已确认下注, landed 后立即
 * 推进能让下一笔下注马上看到正确的 pool_value)、stake_tx_id/ticket_txid/ticket_vout 写入。
 * WHERE status='chip_minted_pending_stake' 做幂等。
 */
export function markBetAppendLanded({ betId, txid }) {
  sqlite.prepare(`
    UPDATE proto_bets SET status = 'confirmed', confirmed_at = datetime('now'), stake_tx_id = ?, ticket_txid = ?, ticket_vout = ?
    WHERE id = ? AND status = 'chip_minted_pending_stake'
  `).run(txid, txid, REGISTER_APPEND_TICKET_OUT_INDEX, betId);
}
