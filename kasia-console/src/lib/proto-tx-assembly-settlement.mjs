// proto-tx-assembly-settlement.mjs — 原型v0结算六步的生产builder(J2 2026-09-19, 实现计划v0.4
// §2, Owner D-022批准)。不签名不广播——只构造tx_json, 供driveSettlementIntent(proto-settlement-
// intent.mjs)状态机 → covenant_broadcast(relay签名+广播)。
//
// 拆到独立文件而不是塞进已有的proto-tx-assembly.mjs(market_genesis+register_append+共享helper,
// 已560行)——六个新builder各自的完整流程量级与buildRegisterAppendTxJson相当(~110行), 塞进同一
// 文件会超出既有量级一倍以上(Bettor审实现计划v0.1时批准此拆分, 要求import复用不复制粘贴)。
//
// 复用的共享helper/常量全部来自proto-tx-assembly.mjs(不重复定义):
// selectChangeShape/selectFeeUtxoByConstruction/computeRequiredFeeSompiOrThrow/scriptPublicKeyFromHex/
// assertImpliedFeeMatches/assertKaspadInputVersionRule/GENESIS_OUTPUT_SOMPI/CONTINUATION_OUTPUT_SOMPI/
// PROTO_V0_COMPUTE_BUDGET。

import {
  selectChangeShape, scriptPublicKeyFromHex, assertImpliedFeeMatches, assertKaspadInputVersionRule,
  GENESIS_OUTPUT_SOMPI, CONTINUATION_OUTPUT_SOMPI, PROTO_V0_COMPUTE_BUDGET,
} from './proto-tx-assembly.mjs';
import { computeRootCloseGenesisArtifact, computeKttGenesisArtifact, p2sh } from './proto-covenant-builder.mjs';
import { encodeConvertToRootcloseAction, combineActionAndRedeem } from './proto-convert-to-rootclose-witness.mjs';
import { encodeKttTransferZeroOutAction, combineKttActionAndRedeem } from './proto-ktt-transfer-witness.mjs';
import { assertMassWithinCeiling } from './proto-mass-ceiling.mjs';

// ── 输出 index 布局具名常量(同register_append既有模式, 账本1439"vout在builder里定义为具名常量,
//   推算函数引用同一个常量"纪律——不在两处各自重复写字面量0/1/2)。 ──
export const MARKET_SEAL_ROOTCLOSE_OUT_INDEX = 0; // RootClose genesis 输出
export const MARKET_SEAL_TOKEN_OUT_INDEX = 1;     // 代币转出到RootClose 输出

/**
 * ① market_seal（`ShardLeaf_direct.convert_to_rootclose`）——设计文档§1.1/实现计划v0.4§2.1。
 * @param {object} o
 * @param {*} o.kaspa  kaspa-wasm模块(注入)
 * @param {string} o.network
 * @param {string} o.marketId  32字节hex(无0x)
 * @param {string} o.committeePubkeyHex  32字节hex(无0x), proto_markets.committee_pubkeys_json[0]
 * @param {number} o.deadlineMs
 * @param {string} o.rootCloseTmplHash  32字节hex(无0x), proto_markets.rootclose_tmpl_hash(已存,
 *   仅用于fail-closed校验, 见computeRootCloseGenesisArtifact)
 * @param {Buffer} o.leafRedeemScript  当前leaf(封盘前最后一次续约后)的裸redeem脚本字节, 调用方用
 *   computeShardLeafRedeemScript(proto-covenant-builder.mjs)按当前state现算得到
 * @param {{txid:string, vout:number}} o.leafOutpoint  leaf当前UTXO(proto_markets.shardleaf_txid/vout)
 * @param {string} o.leafCovId  leaf自己的covenant_id(proto_markets.shardleaf_cov_id)
 * @param {object|null} o.heldInput  count>1时非null: {txid,vout,value,scriptPublicKeyHex,
 *   redeemScript(Buffer),entryAbi,stateFieldCount}(合并KTT, 同register_append的heldInput同一形状)
 * @param {{local_yes:number,local_no:number,count:number,pool_value:number}} o.currentState  封盘时
 *   leaf的真实state(deriveLeafState现算, 必须等于sealCount)
 * @param {object} o.feeUtxo  {txid,vout,value,scriptPublicKeyHex}
 * @param {string} o.relayChangeScriptPublicKeyHex
 * @param {object} o.convertToRootcloseEntryAbi  compileSilV100(...)._raw.contracts.ShardLeaf_direct.
 *   entries.convert_to_rootclose(当前市场ctor下重新编译现读, 不跨市场复用)
 * @param {string} o.tokPrefixHex  KanetTestToken模板prefix(hex, 无0x)——loadProtocolConstants()供
 * @param {string} o.tokSuffixHex  同上suffix
 * @param {bigint} o.absFeeCapSompi  feeProfile.market_seal.cap(proto-v0-template-anchors.json)
 * @returns {{txJson:string, expectedTxid:string, rootCloseCovId:string, tokenCovId:string,
 *   includeChange:boolean, changeSompi:bigint, requiredFee:bigint, netLoss:bigint,
 *   signInputIndices:number[], genesisOutputIndices:number[]}}
 */
export function buildMarketSealTxJson({
  kaspa, network, marketId, committeePubkeyHex, deadlineMs, rootCloseTmplHash,
  leafRedeemScript, leafOutpoint, leafCovId, heldInput, currentState,
  feeUtxo, relayChangeScriptPublicKeyHex, convertToRootcloseEntryAbi,
  tokPrefixHex, tokSuffixHex, absFeeCapSompi,
}) {
  if (currentState.count <= 0) throw new Error(`buildMarketSealTxJson: currentState.count(${currentState.count}) 必须>0`);

  // RootClose genesis的完整state(7字段): 沿用leaf当前state的4个下注字段, closed/winningSide/
  // payoutRoot全0(实际值由close_commit提供, 设计文档§1.2)。
  const rootCloseState = {
    local_yes: currentState.local_yes, local_no: currentState.local_no,
    count: currentState.count, pool_value: currentState.pool_value,
    closed: 0, winningSide: 0, payoutRoot: '00'.repeat(32),
  };
  const rcArtifact = computeRootCloseGenesisArtifact({ marketId, committeePubkeyHex, deadlineMs, rootCloseTmplHash, state: rootCloseState });
  const rcSpkObj = scriptPublicKeyFromHex(kaspa, rcArtifact.scriptPubKeyHex);

  // ── 输入 index 布局: [0]leaf [1]held?(可选) [最后]fee ── (同register_append既有模式)
  const inputs = [];
  const leafOutpointObj = { transactionId: leafOutpoint.txid, index: leafOutpoint.vout };
  inputs.push({ kind: 'leaf' });
  let heldIdx = -1, feeIdx;
  if (heldInput) { heldIdx = inputs.length; inputs.push({ kind: 'held' }); }
  feeIdx = inputs.length; inputs.push({ kind: 'fee' });

  const leafSpk = scriptPublicKeyFromHex(kaspa, '0x' + p2sh(leafRedeemScript));
  const feeUtxoSpk = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);
  const heldSpk = heldInput ? scriptPublicKeyFromHex(kaspa, heldInput.scriptPublicKeyHex) : null;

  const mkInput = (outpoint, value, spk, sigScriptHex) => ({
    previousOutpoint: outpoint, signatureScript: sigScriptHex ?? new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET,
    utxo: { outpoint, amount: value, scriptPublicKey: spk, blockDaaScore: 0n },
  });

  const mkTx = (feeChangeSompi) => {
    // covenant_id是outpoint的函数(kaspa.covenantId(prevOutpoint,[{index,output}])), fee输入的
    // previousOutpoint是唯一还未在这一步之前"绑定"过的outpoint, 同market_genesis/register_append
    // 既有约定, genesis类输出的covenant_id都用fee input的outpoint派生(账本1434③要求, 规避
    // authorizing input本身是covenant的未知项)。
    const feeOutpointObj = { transactionId: feeUtxo.txid, index: feeUtxo.vout };
    const rcCovIdHex = String(kaspa.covenantId(feeOutpointObj, [{ index: MARKET_SEAL_ROOTCLOSE_OUT_INDEX, output: new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, rcSpkObj) }]));
    const tokenArtifact = computeKttGenesisArtifact({ amount: currentState.pool_value, ownerCovIdHex: rcCovIdHex });
    const tokenSpkObj = scriptPublicKeyFromHex(kaspa, tokenArtifact.scriptPubKeyHex);

    const rcPrefix = rcArtifact.script.subarray(0, rcArtifact.stateLayout.start);
    const rcSuffix = rcArtifact.script.subarray(rcArtifact.stateLayout.start + rcArtifact.stateLayout.len);
    const leafAction = encodeConvertToRootcloseAction(kaspa, convertToRootcloseEntryAbi, {
      rcOutIdx: MARKET_SEAL_ROOTCLOSE_OUT_INDEX, rc_prefix: '0x' + rcPrefix.toString('hex'), rc_suffix: '0x' + rcSuffix.toString('hex'),
      tokenInIdx: heldIdx, tokenOutIdx: MARKET_SEAL_TOKEN_OUT_INDEX, tok_prefix: tokPrefixHex, tok_suffix: tokSuffixHex,
    });
    const leafSigScript = combineActionAndRedeem(kaspa, leafAction, leafRedeemScript);
    const heldSigScript = heldInput
      ? combineKttActionAndRedeem(kaspa, encodeKttTransferZeroOutAction(kaspa, heldInput.entryAbi, heldInput.stateFieldCount, [0]), heldInput.redeemScript)
      : null;

    const txInputs = [];
    txInputs[0] = mkInput(leafOutpointObj, CONTINUATION_OUTPUT_SOMPI, leafSpk, leafSigScript);
    if (heldInput) txInputs[heldIdx] = mkInput({ transactionId: heldInput.txid, index: heldInput.vout }, heldInput.value, heldSpk, heldSigScript);
    txInputs[feeIdx] = mkInput(feeOutpointObj, feeUtxo.value, feeUtxoSpk, new Uint8Array(0));

    const t = new kaspa.Transaction({
      version: 1,
      inputs: txInputs,
      outputs: [
        new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, rcSpkObj),
        new kaspa.TransactionOutput(GENESIS_OUTPUT_SOMPI, tokenSpkObj),
        ...(feeChangeSompi === undefined ? [] : [new kaspa.TransactionOutput(feeChangeSompi, feeUtxoSpk)]),
      ],
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    // 每个genesis输出各自独立一个GenesisCovenantGroup(单-index数组)——同market_genesis/
    // register_append的唯一既有用法, 合并两个输出成一组会导致真实covenant_id算错(见设计文档§0.5
    // WrongGenesisCovenantId踩坑记录)。
    t.populateGenesisCovenants([new kaspa.GenesisCovenantGroup(feeIdx, [MARKET_SEAL_ROOTCLOSE_OUT_INDEX]), new kaspa.GenesisCovenantGroup(feeIdx, [MARKET_SEAL_TOKEN_OUT_INDEX])]);
    return t;
  };

  // leftover公式(账本1455纪律): fee输入面值 + leaf自身续约价值 + held自身续约价值(若有) −
  // 两个新建输出各自的CONT/GENESIS面值——leaf/held这两个非fee输入各自1:1抵扣掉RootClose/token这
  // 两个输出对应的那一份, 是它们自带的续约价值, 不是凭空冒出来的(同buildRegisterAppendTxJson的
  // 同名公式, 已在那里修过"漏计非fee输入真实面值"这个真实bug, 见proto-tx-assembly.mjs同名注释)。
  const heldInputValue = heldInput ? heldInput.value : 0n;
  const leftover = feeUtxo.value + CONTINUATION_OUTPUT_SOMPI + heldInputValue - CONTINUATION_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI;
  const shape = selectChangeShape({
    kaspa, network, leftoverSompi: leftover,
    buildTxWithChange: (c) => mkTx(c), buildTxNoChange: () => mkTx(undefined),
    absFeeCapSompi,
  });
  assertImpliedFeeMatches(shape.tx, shape.netLoss, 'market_seal');
  assertKaspadInputVersionRule(shape.tx, 'market_seal');
  {
    // 账本1497 Bettor MUST: 构造期mass上限fail-closed断言, 与register_append同一plurality判定
    // 原则——leaf/held都是covenant续约输入(p=2), fee是普通输入(p=1), 用inputs[]的kind标记逐个映射,
    // 不是猜的(与上面mkTx真实塞入txInputs的顺序严格一致)。
    const inputPluralities = inputs.map((slot) => (slot.kind === 'fee' ? 1n : 2n));
    assertMassWithinCeiling({
      kaspa, network, tx: shape.tx, inputPluralities, feeUtxoValueSompi: feeUtxo.value, label: 'market_seal',
    });
  }

  const rootCloseCovId = String(shape.tx.outputs[MARKET_SEAL_ROOTCLOSE_OUT_INDEX].covenant.covenantId);
  const tokenCovId = String(shape.tx.outputs[MARKET_SEAL_TOKEN_OUT_INDEX].covenant.covenantId);

  return {
    txJson: shape.tx.serializeToSafeJSON(),
    expectedTxid: shape.tx.id,
    rootCloseCovId, tokenCovId,
    includeChange: shape.includeChange,
    changeSompi: shape.changeSompi,
    requiredFee: shape.requiredFee,
    netLoss: shape.netLoss,
    signInputIndices: [feeIdx],
    genesisOutputIndices: [MARKET_SEAL_ROOTCLOSE_OUT_INDEX, MARKET_SEAL_TOKEN_OUT_INDEX],
  };
}
