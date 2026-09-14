// proto-broadcast-ops.mjs — market_genesis/bet_mint 真正"构造+发 covenant_broadcast"的胶水层
// (J2, 账本1425/1438, Stage 1: 先覆盖 market_genesis; bet_mint 两步在 Stage 2/3 补)。
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

import { scriptPublicKeyFromHex, buildMarketGenesisTxJson, selectFeeUtxo, GENESIS_OUTPUT_SOMPI } from './proto-tx-assembly.mjs';
import { computeShardLeafRedeemScript, loadFeeProfileCap } from './proto-covenant-builder.mjs';
import { marketIntentKeyFor, markMarketStatus } from './proto-market-intent.mjs';
import { PROTO_COVENANT_BROADCAST_TYPE } from './proto-relay-guard.mjs';

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
