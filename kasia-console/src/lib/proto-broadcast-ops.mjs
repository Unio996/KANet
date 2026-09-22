// proto-broadcast-ops.mjs — market_genesis/bet_mint 真正"构造+发 covenant_broadcast"的胶水层
// (J2, 账本1425/1438, Stage 1 覆盖 market_genesis; bet_mint 原两步(步骤A铸stake筹码+步骤B
// register_append)已被 D-020(账本1446/1448, a4878d7d)取消——register_append 现在是下注唯一的
// 单笔交易, 步骤A(buildBetMintStepAAndBroadcast 等)已随之删除)。
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
  scriptPublicKeyFromHex, buildMarketGenesisTxJson, buildRegisterAppendTxJson,
  selectFeeUtxoByConstruction, filterFeeCandidates, SIGNED_INPUT_CEILING_SOMPI,
  CONTINUATION_OUTPUT_SOMPI, REGISTER_APPEND_TICKET_OUT_INDEX,
} from './proto-tx-assembly.mjs';
import { assertFactsResponse } from './proto-settlement-c1.mjs';
import { selectAndReserveFeeUtxo, reservedFeeOutpoints, releaseReservationOnPrepared, deferReservationReconciliation } from './proto-fee-reservation.mjs';
import {
  computeShardLeafRedeemScript, computeKttGenesisArtifact, computeTicketGenesisArtifact,
  loadFeeProfileCap, loadProtocolConstants,
} from './proto-covenant-builder.mjs';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from './pool-bshard-artifacts.mjs';
import { marketIntentKeyFor, markMarketStatus, getMarketRow } from './proto-market-intent.mjs';
import { betIntentKeyFor, getBetIntent } from './proto-bet-intent.mjs';
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

/**
 * F3(设计 v0.2.1 §3.1.2, 账本1614/1615/1616, Codex df07b0ec MUST): 创世/下注的 fee 候选取数——
 * 取代旧 toFeeUtxoCandidates(get_address_utxos{address} 裸映射, **无任何过滤**: 无 covenant 判断、
 * 无 spk 复核、无区间、无 unknown fail-closed——已删除)。换成结算路径同款的 facts 形态 L
 * (`{facts:true, minAmount, maxAmount}`, relay 侧过滤 + 事实字段)+ assertFactsResponse(与结算
 * 共用同一份回执校验, 形状不合法 fail-closed 抛)+ filterFeeCandidates(与结算共用同一个资格函数,
 * F3 新增的 unknown 分类同样在此生效)。
 * 🔴 取舍 A(设计 §3.1.3, 账本1462): feeMinAmount 传 0n, 不传 loadFeeProfileCap(kind)——cap 是"异常上限"
 *   不是"预期值", 拿它预筛会把真正够用的小面值种子 UTXO(0.5/0.5/0.95 KAS)错误滤掉(账本1462原始 bug);
 *   可行性交给下游 selectFeeUtxoByConstruction 的真实构造逐个尝试, 不在这里猜下界。
 * @returns {Promise<{candidates:Array}|{error:string}>}
 */
async function fetchFeeCandidates({ sendCmd, relayId, relayAddress, relaySpkHex, label }) {
  let res;
  try {
    res = await sendCmd(relayId, {
      type: 'get_address_utxos', address: relayAddress, facts: true, minAmount: '0', maxAmount: SIGNED_INPUT_CEILING_SOMPI.toString(),
    }, 15000, 'proto-driver');
  } catch (e) { return { error: `get_address_utxos(facts,${label}) transport error: ${e.message}` }; }
  let parsed;
  try { parsed = assertFactsResponse(res, { form: 'list' }); }
  catch (e) { return { error: `get_address_utxos(facts,${label}) invalid response(fail-closed): ${e.message}` }; }
  const fee = filterFeeCandidates({ utxos: parsed.utxos, truncated: parsed.truncated, relaySpkHex, feeMinAmount: 0n });
  if (fee.status !== 'ok') {
    return { error: `${label}: no_suitable_fee_utxo(fee 候选不足, status=${fee.status}, 毒化=${fee.skippedPoisoned} 越界=${fee.skippedOutOfRange} unknown=${fee.skippedUnknown} truncated=${fee.truncated})` };
  }
  return { candidates: fee.candidates };
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
    ownRedeemLen: market.shardleaf_own_redeem_len,
  });

  const cap = loadFeeProfileCap('market_genesis');
  const feeRes = await fetchFeeCandidates({ sendCmd, relayId, relayAddress, relaySpkHex, label: 'market_genesis' });
  if (feeRes.error) return { error: feeRes.error };
  // 账本1462修复: 不再用"GENESIS_OUTPUT_SOMPI+cap"这个保守下界预筛候选(cap 是异常上限不是预期值, 会把
  // 真正够用的种子面值 UTXO 错误滤掉)——改为按真实构造逐个尝试, 第一个真能编出交易的就是答案。
  // F4(设计 v0.2.1 §3.2, 账本1614/1615/1616): 换 selectAndReserveFeeUtxo(检查两层预留集 ∧ 真实构造 ∧
  // 记入预留集, 同一同步段完成——与结算路径 proto-settlement-ops.mjs build() 的唯一选择点共用同一份
  // reservedFeeOutpoints/selectAndReserveFeeUtxo 实现, D-031)。intentKey 用于诊断; 预留在这次广播尝试
  // (成功/失败都算"有结果")结束后释放——本函数自己做 IPC 广播, 不像结算路径要跨到 driver-core.mjs 释放。
  let feeUtxo, built;
  try { ({ feeUtxo, built } = selectAndReserveFeeUtxo({
    candidates: feeRes.candidates,
    tryBuild: (u) => buildMarketGenesisTxJson({
      kaspa, network, feeUtxo: u, relayChangeScriptPublicKeyHex: relaySpkHex,
      shardLeafScriptPubKeyHex: leafRedeem.scriptPubKeyHex, absFeeCapSompi: cap,
    }),
    readReserved: () => reservedFeeOutpoints({ db: sqlite }),
    intentKey: marketIntentKeyFor(market.id),
    selectFeeUtxoByConstruction,
  })); }
  catch (e) { return { error: e.message }; }

  // 🔴 账本1438②: 发 IPC 之前原子写入(单条 UPDATE), 不等 relay 回执。
  markMarketStatus(market.id, { shardleaf_cov_id: built.shardLeafCovId });

  // F4(MUST-2, NWT 账本1623/1624): 释放时机按结果分两支, 同 driver-core.mjs 的结算路径——sendCmd 正常
  // resolve(不论 ok true/false, relay 给出确定答复)⇒ 立即释放; sendCmd 本身抛错(IPC 超时/无响应, 结果
  // 不确定)⇒ 不释放, 交 deferReservationReconciliation 到期查 DB(真实 relay 广播代码在 IPC 应答前就已经
  // ingestPhase 回 console, "没等到回执"不等于"relay 什么也没做")。
  let rep;
  try {
    rep = await sendCmd(relayId, {
      type: PROTO_COVENANT_BROADCAST_TYPE,
      intent_key: marketIntentKeyFor(market.id),
      tx_json: built.txJson,
      sign_input_indices: built.signInputIndices,
      expected_txid: built.expectedTxid,
      genesis_output_indices: built.genesisOutputIndices,
      continuation_output_indices: built.continuationOutputIndices,
    }, 30000, 'proto-driver');
  } catch (networkErr) {
    // 不确定结果, 不释放——保持本函数一贯的"不 throw, 返回 {error}"契约(调用方 driveMarketGenesis 不接抛错)。
    deferReservationReconciliation(feeUtxo, () => !!(getMarketRow(market.id) || {}).genesis_prepared_tx_json);
    return { error: `covenant_broadcast transport error: ${networkErr && networkErr.message ? networkErr.message : String(networkErr)}` };
  }
  releaseReservationOnPrepared(feeUtxo);
  if (rep?.ok && rep?.txId) return { txId: rep.txId };
  return { error: rep?.error || `covenant_broadcast failed (code=${rep?.code || 'unknown'})` };
}

/** market_genesis 落链判据用的地址(genesis ShardLeaf_direct 输出的 P2SH bech32 地址)——从 rootclose_tmpl_hash
 * 等已存字段确定性重算(genesis state 全0), 不依赖任何随机值。 */
export function shardLeafTargetAddress({ kaspa, network, market }) {
  const leafRedeem = computeShardLeafRedeemScript({
    marketId: market.id, minBet: market.min_bet, sealCount: market.seal_count,
    rootcloseTmplHash: market.rootclose_tmpl_hash, state: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 },
    ownRedeemLen: market.shardleaf_own_redeem_len,
  });
  const spk = scriptPublicKeyFromHex(kaspa, leafRedeem.scriptPubKeyHex);
  return kaspa.addressFromScriptPublicKey(spk, network).toString();
}

/**
 * driveBetIntent(step='append') 的 buildAndBroadcast({attempt}) 回调实体(bet_mint 唯一步骤:
 * register_append, 单笔交易, 账本1425/1429/1436/1439/1446/1448 D-020)。构造前的三项 fail-closed 核对(账本1429/1439, Bettor
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
 * @param {object} o.bet  这一笔要 append 的 proto_bets 行(id/side/stake/bettor_pk 必须已存在)
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
    ownRedeemLen: market.shardleaf_own_redeem_len,
  });
  const leafSpk = scriptPublicKeyFromHex(kaspa, leafRedeem.scriptPubKeyHex);
  const leafAddress = kaspa.addressFromScriptPublicKey(leafSpk, network).toString();
  const leafUtxoRes = await sendCmd(relayId, { type: 'get_address_utxos', address: leafAddress }, 15000, 'proto-driver');
  if (!leafUtxoRes?.ok) return { error: `get_address_utxos(leaf) failed: ${leafUtxoRes?.error || 'no response'}` };
  const leafValue = findUtxoValueAt(leafUtxoRes.utxos, leafOutpoint.txid, leafOutpoint.vout);
  try {
    assertLeafStateMatchesChain({
      marketId, shardLeafRedeemScript: leafRedeem.script, stateLayout: leafRedeem.stateLayout,
      chainUtxo: leafValue === null ? null : { scriptPublicKeyHex: leafRedeem.scriptPubKeyHex, spent: false, value: leafValue }, // N-1: 传真实面值, assertLeafStateMatchesChain核对==CONTINUATION_OUTPUT_SOMPI
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
    ctorIntV100(market.shardleaf_own_redeem_len),
  ];
  const sldCompiled = compileSilV100(SHARD_LEAF_DIRECT_SIL, sldCtor, 'ShardLeaf_direct');
  const registerAppendEntryAbi = sldCompiled._raw.contracts.ShardLeaf_direct.entries.register_append;

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
  // 账本1462修复: feeProfile 键名从遗留的 'bet_mint_step_b'(D-020 之前的两步设计残留命名)改为
  // 'register_append'(见 scripts/proto-v0-template-anchors.json/.mjs 同步改名), 数据内容不变。
  const cap = loadFeeProfileCap('register_append');
  const feeRes = await fetchFeeCandidates({ sendCmd, relayId, relayAddress, relaySpkHex, label: 'register_append' });
  if (feeRes.error) return { error: feeRes.error };
  // 账本1462修复(同 market_genesis 一侧): 不再用"CONTINUATION+GENESIS+GENESIS+cap"这个保守下界预筛
  // 候选——改为按真实构造逐个尝试。buildRegisterAppendTxJson 内部的 leaf/held 输入值来源
  // (currentStateUtxoValueOf/heldInput.value)与上面①②步骤查到的链上现状同源, 未受影响(账本1455教训)。
  // F4: 同 market_genesis 侧, 换 selectAndReserveFeeUtxo, 广播尝试结束后释放(finally)。
  let feeUtxo, built;
  try { ({ feeUtxo, built } = selectAndReserveFeeUtxo({
    candidates: feeRes.candidates,
    tryBuild: (u) => buildRegisterAppendTxJson({
      kaspa, network,
      leafRedeemScript: leafRedeem.script, leafStateLayout: leafRedeem.stateLayout, leafOutpoint, leafCovId,
      currentState, newState, heldInput, feeUtxo: u, relayChangeScriptPublicKeyHex: relaySpkHex,
      registerAppendEntryAbi,
      registerAppendArgs: {
        side: bet.side, stake: bet.stake, bettorPk: '0x' + bet.bettor_pk,
        psPrefix: '0x' + ps_prefix, psSuffix: '0x' + ps_suffix, tokPrefix: '0x' + token_prefix, tokSuffix: '0x' + token_suffix,
      },
      ticketScriptPubKeyHex: ticketArtifact.scriptPubKeyHex, mergedKttScript: mergedKttArtifact.script, absFeeCapSompi: cap,
    }),
    readReserved: () => reservedFeeOutpoints({ db: sqlite }),
    intentKey: betIntentKeyFor(bet.id, 'append'),
    selectFeeUtxoByConstruction,
  })); }
  catch (e) { return { error: e.message }; }

  // F4(MUST-2, NWT 账本1623/1624): 释放时机按结果分两支, 同 market_genesis 一侧。
  let rep;
  try {
    rep = await sendCmd(relayId, {
      type: PROTO_COVENANT_BROADCAST_TYPE,
      intent_key: betIntentKeyFor(bet.id, 'append'),
      tx_json: built.txJson,
      sign_input_indices: built.signInputIndices,
      expected_txid: built.expectedTxid,
      genesis_output_indices: built.genesisOutputIndices,
      continuation_output_indices: built.continuationOutputIndices,
    }, 30000, 'proto-driver');
  } catch (networkErr) {
    deferReservationReconciliation(feeUtxo, () => !!(getBetIntent(betIntentKeyFor(bet.id, 'append')) || {}).prepared_tx_json);
    return { error: `covenant_broadcast transport error: ${networkErr && networkErr.message ? networkErr.message : String(networkErr)}` };
  }
  releaseReservationOnPrepared(feeUtxo);
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
    ownRedeemLen: market.shardleaf_own_redeem_len,
  });
  const spk = scriptPublicKeyFromHex(kaspa, leafRedeem.scriptPubKeyHex);
  return kaspa.addressFromScriptPublicKey(spk, network).toString();
}

/**
 * register_append landed 后的 proto_bets 记账(两张表之间的桥, proto-bet-intent.mjs 只更新
 * proto_bet_intents 表, 不知道 proto_bets 的存在——这条 UPDATE 是唯一的桥, 单独成一个具名函数放在
 * 这个"胶水层"文件里, 不塞进 proto-bet-intent.mjs 那边):
 * status 推进到 'confirmed'(deriveLeafState 的 SQL 查询就是靠这个状态筛选已确认下注, landed 后立即
 * 推进能让下一笔下注马上看到正确的 pool_value)、stake_tx_id/ticket_txid/ticket_vout 写入。
 * 🔴 D-020(账本1446/1448): WHERE 从 status='chip_minted_pending_stake'(旧两步中间态)改成
 * status='pending'——下注不再有铸筹码中间态, register_append 是唯一的一步, 直接 pending→confirmed。
 * WHERE status='pending' 做幂等(重复调用/并发 tick 不会二次改写或报错)。
 */
export function markBetAppendLanded({ betId, txid }) {
  sqlite.prepare(`
    UPDATE proto_bets SET status = 'confirmed', confirmed_at = datetime('now'), stake_tx_id = ?, ticket_txid = ?, ticket_vout = ?
    WHERE id = ? AND status = 'pending'
  `).run(txid, txid, REGISTER_APPEND_TICKET_OUT_INDEX, betId);
}
