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
import { computeRootCloseGenesisArtifact, computeRootClaimGenesisArtifact, computeTicketGenesisArtifact, computeKanetTokenClaimGenesisArtifact, computeKttGenesisArtifact, p2sh } from './proto-covenant-builder.mjs';
import { encodeConvertToRootcloseAction, combineActionAndRedeem } from './proto-convert-to-rootclose-witness.mjs';
import { encodeCloseCommitAction } from './proto-close-commit-witness.mjs';
import { encodeConvertToClaimAction } from './proto-convert-to-claim-witness.mjs';
import { encodeClaimDrawAction } from './proto-claim-draw-witness.mjs';
import { encodeAuthorizeSpendAction } from './proto-ticket-authorize-witness.mjs';
import { payoutLeafHex } from './proto-payout-leaf.mjs';
import { assertTicketSigningKey } from './proto-signing-key-binding.mjs';
import { encodeKttTransferZeroOutAction, combineKttActionAndRedeem } from './proto-ktt-transfer-witness.mjs';
import { assertMassWithinCeiling } from './proto-mass-ceiling.mjs';
import { decryptCommitteePrivkey } from './proto-committee-key.mjs';

// ── 输出 index 布局具名常量(同register_append既有模式, 账本1439"vout在builder里定义为具名常量,
//   推算函数引用同一个常量"纪律——不在两处各自重复写字面量0/1/2)。 ──
export const MARKET_SEAL_ROOTCLOSE_OUT_INDEX = 0; // RootClose genesis 输出
export const MARKET_SEAL_TOKEN_OUT_INDEX = 1;     // 代币转出到RootClose 输出

/**
 * market_seal见证的具名参数映射(从buildMarketSealTxJson抽出的纯函数, 字节不变)——NWT批3独立验证N1:
 * 真实封盘形状里held输入下标与token输出下标恒相等(都是1), 共识看不出tokenInIdx/tokenOutIdx互换, 所以把
 * 映射抽成可单测的纯函数, 用两者不同的向量证明: tokenInIdx来自held输入的真实下标, tokenOutIdx来自
 * MARKET_SEAL_TOKEN_OUT_INDEX, rcOutIdx来自MARKET_SEAL_ROOTCLOSE_OUT_INDEX, 各归各位。
 * @param {{heldIdx:number, rcPrefixHex:string, rcSuffixHex:string, tokPrefixHex:string, tokSuffixHex:string}} o
 *   rcPrefixHex/rcSuffixHex 无0x; tokPrefixHex/tokSuffixHex 与调用方传入形状一致(原样透传)
 */
export function sealWitnessArgs({ heldIdx, rcPrefixHex, rcSuffixHex, tokPrefixHex, tokSuffixHex }) {
  return {
    rcOutIdx: MARKET_SEAL_ROOTCLOSE_OUT_INDEX, rc_prefix: '0x' + rcPrefixHex, rc_suffix: '0x' + rcSuffixHex,
    tokenInIdx: heldIdx, tokenOutIdx: MARKET_SEAL_TOKEN_OUT_INDEX, tok_prefix: tokPrefixHex, tok_suffix: tokSuffixHex,
  };
}

/**
 * 见证索引与交易真实布局的结构断言(NWT批3独立验证F2(c), Bettor采纳): 见证里的tokenInIdx必须真的指向花掉held
 * 代币outpoint的输入、tokenOutIdx必须真的是以新owner covenant现算出的代币输出、主输出(RootClose/RootClaim)
 * 必须真的在primaryOutIdx——固定布局下这些恒等式是惰性的, 布局一变(多held/换序)就大声失败而不是把错位索引
 * 编进见证。只读tx对象, 不改字节。
 */
export function assertWitnessIndexLayout({ tx, label, tokenInIdx, heldOutpoint, tokenOutIdx, expectedTokenOutSpkHex, primaryOutIdx, expectedPrimaryOutSpkHex }) {
  const noPrefix = (h) => String(h).replace(/^0x/, '').toLowerCase();
  const held = tx.inputs[tokenInIdx];
  if (!held || String(held.previousOutpoint.transactionId) !== String(heldOutpoint.txid) || Number(held.previousOutpoint.index) !== Number(heldOutpoint.vout)) {
    throw new Error(`${label}: fail-closed — 见证tokenInIdx(${tokenInIdx})指向的输入不是held代币outpoint(${heldOutpoint.txid}:${heldOutpoint.vout}), 输入布局与见证映射已不一致`);
  }
  const tokOut = tx.outputs[tokenOutIdx];
  if (!tokOut || noPrefix(tokOut.scriptPublicKey.script) !== noPrefix(expectedTokenOutSpkHex)) {
    throw new Error(`${label}: fail-closed — 见证tokenOutIdx(${tokenOutIdx})指向的输出spk不是预期的代币输出, 输出布局与见证映射已不一致`);
  }
  const primary = tx.outputs[primaryOutIdx];
  if (!primary || noPrefix(primary.scriptPublicKey.script) !== noPrefix(expectedPrimaryOutSpkHex)) {
    throw new Error(`${label}: fail-closed — 见证主输出下标(${primaryOutIdx})指向的输出spk不是预期的genesis输出, 输出布局与见证映射已不一致`);
  }
}

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
 * @param {object} o.heldInput  必填(为null则构造期fail-closed, 见函数体N2注释): {txid,vout,value,scriptPublicKeyHex,
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
  // NWT批3独立验证N2(Bettor转达): heldInput为null时下面heldIdx会保持-1, 把tokenInIdx=-1编进
  // convert_to_rootclose见证——共识必拒(不丢钱)但应该构造期fail-closed。v0每笔register_append都会产出一枚
  // 合并KTT(count>=1即存在held代币, 封盘时pool_value>0且全池代币必须整体转出), 因此任何合法封盘下
  // heldInput都必须存在。
  if (!heldInput) {
    throw new Error(`buildMarketSealTxJson: fail-closed — heldInput为null(count=${currentState.count}, pool_value=${currentState.pool_value}); 封盘必须转出合并KTT(convert_to_rootclose要求tokenInIdx指向真实held输入), 不能把tokenInIdx=-1编进见证`);
  }

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
    const leafAction = encodeConvertToRootcloseAction(kaspa, convertToRootcloseEntryAbi, sealWitnessArgs({
      heldIdx, rcPrefixHex: rcPrefix.toString('hex'), rcSuffixHex: rcSuffix.toString('hex'), tokPrefixHex, tokSuffixHex,
    }));
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
  assertWitnessIndexLayout({
    tx: shape.tx, label: 'market_seal',
    tokenInIdx: heldIdx, heldOutpoint: { txid: heldInput.txid, vout: heldInput.vout },
    tokenOutIdx: MARKET_SEAL_TOKEN_OUT_INDEX,
    expectedTokenOutSpkHex: computeKttGenesisArtifact({ amount: currentState.pool_value, ownerCovIdHex: String(shape.tx.outputs[MARKET_SEAL_ROOTCLOSE_OUT_INDEX].covenant.covenantId).toLowerCase() }).scriptPubKeyHex,
    primaryOutIdx: MARKET_SEAL_ROOTCLOSE_OUT_INDEX, expectedPrimaryOutSpkHex: rcArtifact.scriptPubKeyHex,
  });
  {
    // 账本1497 Bettor MUST: 构造期mass上限fail-closed断言, 与register_append同一plurality判定
    // 原则——leaf/held都是covenant续约输入(p=2), fee是普通输入(p=1), 用inputs[]的kind标记逐个映射,
    // 不是猜的(与上面mkTx真实塞入txInputs的顺序严格一致)。
    const inputHasCovenant = inputs.map((slot) => slot.kind !== 'fee');
    assertMassWithinCeiling({
      kaspa, network, tx: shape.tx, inputHasCovenant, feeUtxoValueSompi: feeUtxo.value, label: 'market_seal',
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

// ── 输出 index 布局具名常量(同market_seal既有模式) ──
export const CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX = 0; // RootClose续约输出(closed:1)
/**
 * B4-2(NWT批4离线审): 节点finality比较是 tx.lock_time < 区块头past-median-time(严格小于, 且pmt滞后墙钟),
 * 只校验 Date.now()>=deadlineMs 是单边代理: 在[deadline, deadline+pmt滞后+时钟偏差)内提交, 本地放行而节点以
 * NotFinalized拒。构造守卫加固定余量。🟡 【暂定值300s】: NWT建议下限120s, 但2026-09-19只读实测本机主网节点(官方2.0.1, isSynced=true)
 * 墙钟−pastMedianTime=128.8~136.7s(10秒内6个样本, 均值约132.5s, 与共识常量TIMESTAMP_DEVIATION_TOLERANCE=132吻合), 120s低于该滞后、
 * 主网上会NotFinalized; 300s≈2.2倍。样本窗口很短且本机时钟未做NTP校准, 仍需更长时间/多次采样确认。simnet实测见
 * docs/provenance/2026-09-19-j2-fullchain-simnet/;
 * 提交侧把NotFinalized归"可重试、无状态变更"(不进ambiguous)是驱动层(批9)的约束, 见实现计划§2.2。
 */
export const CLOSE_COMMIT_DEADLINE_MARGIN_MS = 300_000;
/** B4-6: v0单操作员5槽同一把委员keypair重复5次——只证明"合约逻辑可执行", 不是4-of-5门限安全(账本1497 Codex复核)。 */
export const COMMITTEE_MODE_SINGLE_OPERATOR_5X_SAME_KEY = 'single_operator_5x_same_key';

/**
 * ② close_commit（`RootClose.close_commit`）——设计文档§1.2/实现计划v0.5 §2.2批4。
 *
 * MUST-1(CLTV): tx对象的顶层`lockTime`字段设为`deadline_ms`(RootClose.sil的
 * `require(tx.time >= temporal(deadline_ms))`——tx.time读的正是tx自己的lockTime量级, 账本已确认
 * 的CLTV按数值判域规则); committee签名输入(RootClose自己)的`sequence`取普通值`0`(本文件mkInput
 * 既有约定, 恒为0, 天然满足——CLTV生效要求至少一个输入sequence!=最大值)。本函数额外在构造时
 * fail-closed校验`Date.now() >= deadlineMs`(MUST-1"提交时节点当前时间必须已经真实超过deadline_ms"
 * 的构造侧代理——本仓构造与提交是背靠背的同一动作, 构造时校验等价于提交时校验)。
 *
 * 委员5槽签名(R8, RootClose.sil close_commit形参c0Pk..c4Pk/c0Sig..c4Sig): v0单操作员, 5槽同一把
 * 委员keypair重复5次(账本1497 Codex复核点名"5槽重复同一签名只是原型形状证据, 不得外推成4-of-5
 * 门限安全结论"——如实记录, 不冒充真正的门限签名)。签名对象是**本次候选tx(含本次候选找零形状的
 * 全部outputs)**的sighash(SighashType.All承诺全部输出值), 因此每次`selectChangeShape`试探不同
 * 找零候选(shapeA草稿/shapeA终稿/shapeB)都必须**各自重新签一次**——不能像register_append的leaf
 * witness那样跨候选复用(那是无签名AB11声明宏, 与tx内容无关; 这里是真实签名, 依赖tx内容)。
 *
 * 委员私钥解密-即用-即弃(账本1354/1497纪律): `committeePrivkeyEnvelope`解密后只存进本函数作用域
 * 内的局部变量, 用于`kaspa.createInputSignature`后立即随函数返回而失去引用, 不log、不进返回值、
 * 不进错误消息、不写入任何持久化位置。
 *
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.network
 * @param {string} o.marketId  32字节hex(无0x)
 * @param {string} o.committeePubkeyHex  32字节hex(无0x)
 * @param {string} o.committeePrivkeyEnvelope  proto_markets.committee_privkey_enc(加密信封字符串)
 * @param {number} o.deadlineMs
 * @param {string} o.rootCloseTmplHash  32字节hex(无0x), proto_markets.rootclose_tmpl_hash
 * @param {{txid:string, vout:number}} o.rootCloseOutpoint  RootClose当前UTXO(market_seal产出的
 *   RootClose genesis输出, 或更早一次close_commit的续约输出——本builder不关心是哪一种, 只要是
 *   closed==0的那一个)
 * @param {string} o.rootCloseUtxoScriptPublicKeyHex  必填(B4-5): 该UTXO在链上的spk(调用方从UTXO快照/产出它的交易
 *   输出取), 入口断言必须等于本函数按sealedState现算的当前RootClose spk
 * @param {string} o.rootCloseCovId  RootClose自己的covenant_id(不变, market_seal时已算出)
 * @param {{local_yes:number,local_no:number,count:number,pool_value:number}} o.sealedState
 *   market_seal之后不再变化的4个下注字段(closed/winningSide/payoutRoot由本函数用0/newWinningSide/
 *   newPayoutRootHex现填, 不需要调用方传入当前值)
 * @param {number} o.newWinningSide  0=YES 1=NO
 * @param {string} o.newPayoutRootHex  32字节hex(无0x), off-chain算好的winner+fee leaves merkle root
 * @param {string} o.tokPrefixHex  KanetTestToken模板prefix(hex, 无0x)——noTokenInput witness供
 * @param {string} o.tokSuffixHex  同上suffix
 * @param {object} o.feeUtxo  {txid,vout,value,scriptPublicKeyHex}
 * @param {string} o.relayChangeScriptPublicKeyHex
 * @param {bigint} o.absFeeCapSompi  feeProfile.close_commit.cap
 * @returns {{txJson:string, expectedTxid:string, rootCloseContinuationCovId:string,
 *   includeChange:boolean, changeSompi:bigint, requiredFee:bigint, netLoss:bigint,
 *   signInputIndices:number[]}}
 */
export function buildCloseCommitTxJson({
  kaspa, network, marketId, committeePubkeyHex, committeePrivkeyEnvelope, deadlineMs, rootCloseTmplHash,
  rootCloseOutpoint, rootCloseUtxoScriptPublicKeyHex, rootCloseCovId, sealedState, newWinningSide, newPayoutRootHex,
  tokPrefixHex, tokSuffixHex, feeUtxo, relayChangeScriptPublicKeyHex, absFeeCapSompi,
}) {
  if (newWinningSide !== 0 && newWinningSide !== 1) throw new Error(`buildCloseCommitTxJson: newWinningSide必须是0或1, 实际${newWinningSide}`);
  if (!/^[0-9a-f]{64}$/.test(newPayoutRootHex)) throw new Error(`buildCloseCommitTxJson: newPayoutRootHex必须是32字节hex, 实际${newPayoutRootHex}`);
  // MUST-1构造侧代理(设计文档§1.2/实现计划v0.5): 提交时节点当前时间必须真实超过deadline_ms——
  // 本仓构造与提交是背靠背的同一逻辑单元(MUST-2), 构造时校验等价于提交时校验。
  if (Date.now() < Number(deadlineMs) + CLOSE_COMMIT_DEADLINE_MARGIN_MS) {
    throw new Error(`buildCloseCommitTxJson: fail-closed — Date.now()(${Date.now()}) < deadlineMs(${deadlineMs}) + 余量(${CLOSE_COMMIT_DEADLINE_MARGIN_MS}ms), RootClose.close_commit的require(tx.time>=temporal(deadline_ms))可能被节点以NotFinalized拒绝(节点用past-median-time严格小于比较, 滞后墙钟), 拒绝构造(避免留下prepared/ambiguous残留)`);
  }

  const currentRcState = { local_yes: sealedState.local_yes, local_no: sealedState.local_no, count: sealedState.count, pool_value: sealedState.pool_value, closed: 0, winningSide: 0, payoutRoot: '00'.repeat(32) };
  const newRcState = { ...currentRcState, closed: 1, winningSide: newWinningSide, payoutRoot: newPayoutRootHex };
  const currentArtifact = computeRootCloseGenesisArtifact({ marketId, committeePubkeyHex, deadlineMs, rootCloseTmplHash, state: currentRcState });
  const newArtifact = computeRootCloseGenesisArtifact({ marketId, committeePubkeyHex, deadlineMs, rootCloseTmplHash, state: newRcState });
  const closeCommitEntryAbi = currentArtifact.entries.close_commit;
  // B4-5(NWT批4): 现算的当前RootClose spk必须等于调用方给的链上UTXO spk——sealedState与链上不符时节点会以P2SH不匹配拒收
  // (不丢钱), 但这里入口就大声失败, 不等节点拒。链上spk由调用方从UTXO快照/产出该UTXO的交易输出取, 不是本函数现算的。
  if (typeof rootCloseUtxoScriptPublicKeyHex !== 'string' || String(rootCloseUtxoScriptPublicKeyHex).replace(/^0x/, '').toLowerCase() !== String(currentArtifact.scriptPubKeyHex).replace(/^0x/, '').toLowerCase()) {
    throw new Error(`buildCloseCommitTxJson: fail-closed — 现算的当前RootClose spk(${currentArtifact.scriptPubKeyHex}) != 调用方给的链上UTXO spk(${rootCloseUtxoScriptPublicKeyHex}); sealedState/deadline/committee与链上已不自洽`);
  }

  const rcOutpointObj = { transactionId: rootCloseOutpoint.txid, index: rootCloseOutpoint.vout };
  const feeOutpointObj = { transactionId: feeUtxo.txid, index: feeUtxo.vout };
  const rcSpkCurrent = scriptPublicKeyFromHex(kaspa, currentArtifact.scriptPubKeyHex);
  const rcSpkNew = scriptPublicKeyFromHex(kaspa, newArtifact.scriptPubKeyHex);
  const feeUtxoSpk = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);

  // 委员私钥解密-即用-即弃: 只存本函数作用域内, mkTx闭包内多次使用(selectChangeShape会调用
  // buildTxWithChange/buildTxNoChange最多3次, 每次找零候选值不同都要重新签一次, 见函数头注),
  // 函数返回后这个局部变量随作用域一起失去引用——不log、不进返回值。
  // B4-7(NWT批4): PrivateKey对象整个函数只建一次, finally里free()并丢掉hex引用(不落盘不入日志, 这里只缩短驻留)。
  // 🟡 已知边界(如实标注, NWT终审确认): decryptCommitteePrivkey返回的hex字符串在JS堆里仍要等GC才回收, 置null只是去掉本函数对它的引用,
  // 不能保证立即清除内存; JS没有可靠的字符串清零手段。
  let committeePrivHex = decryptCommitteePrivkey(committeePrivkeyEnvelope);
  const committeePrivObj = new kaspa.PrivateKey(committeePrivHex);

  const mkInput = (outpoint, value, spk, sigScriptHex) => ({
    previousOutpoint: outpoint, signatureScript: sigScriptHex ?? new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET,
    utxo: { outpoint, amount: value, scriptPublicKey: spk, blockDaaScore: 0n },
  });

  const mkTx = (feeChangeSompi) => {
    const outputs = [
      new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, rcSpkNew),
      ...(feeChangeSompi === undefined ? [] : [new kaspa.TransactionOutput(feeChangeSompi, feeUtxoSpk)]),
    ];
    // 🔴 B4-1(NWT批4, HIGH阻断): 必须【先】给RootClose续约输出挂CovenantBinding、【再】让委员签名。共识sighash
    // (consensus/core/src/hashing/sighash.rs:233-235, tx.version>=1)把output.covenant(有无+authorizing_input+
    // covenant_id)写进outputs hash; 先签后挂则签名承诺的是"无covenant"版tx, 对最终tx无效(validSigs=0<4, 节点拒)。
    // txid不含witness, 所以只比txid的测试测不出这个时序——回归必须真验签(见settlement测试的sighash_port验签)。
    outputs[CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX].covenant = new kaspa.CovenantBinding(0, new kaspa.Hash(rootCloseCovId));
    // 先建一版RootClose输入sigScript为空的skeleton, 供委员对**本次候选tx**签名(SighashType.All
    // 承诺全部outputs, 找零值一变签名就必须重算——sighash的计算天然忽略被签名输入自己的sigScript
    // 内容, 同fee输入既有签名时序, 不需要先填好committee witness再签)。
    const presignTx = new kaspa.Transaction({
      version: 1,
      inputs: [
        mkInput(rcOutpointObj, CONTINUATION_OUTPUT_SOMPI, rcSpkCurrent, new Uint8Array(0)),
        mkInput(feeOutpointObj, feeUtxo.value, feeUtxoSpk, new Uint8Array(0)),
      ],
      outputs, lockTime: BigInt(deadlineMs), subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    const rawSigHex = kaspa.createInputSignature(presignTx, 0, committeePrivObj, kaspa.SighashType.All);
    const sigNo0x = rawSigHex.startsWith('0x') ? rawSigHex.slice(2) : rawSigHex;
    // createInputSignature输出66字节(push-opcode 0x41 + 64字节签名 + 1字节sighash类型, 同kasia-relay/
    // p2sh.mjs unlockBshardCloseAttest文件头注确认的既有格式)——ABI的'sig'类型只要那65字节的真实
    // payload(签名+sighash类型), 不要开头的push-opcode字节, 由encodeCloseCommitAction自己重新
    // push编码一遍。
    if (sigNo0x.length !== 132) throw new Error(`buildCloseCommitTxJson: 委员createInputSignature长度异常, 期望66字节(132 hex字符), 实际${sigNo0x.length / 2}字节`);
    const sig65Hex = sigNo0x.slice(2);

    const witnessAction = encodeCloseCommitAction(kaspa, closeCommitEntryAbi, {
      c0Pk: committeePubkeyHex, c1Pk: committeePubkeyHex, c2Pk: committeePubkeyHex, c3Pk: committeePubkeyHex, c4Pk: committeePubkeyHex,
      c0Sig: sig65Hex, c1Sig: sig65Hex, c2Sig: sig65Hex, c3Sig: sig65Hex, c4Sig: sig65Hex,
      rootOutIdx: CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX, new_winningSide: newWinningSide, new_payoutRoot: newPayoutRootHex,
      tok_prefix: tokPrefixHex, tok_suffix: tokSuffixHex,
    });
    const rcSigScript = combineActionAndRedeem(kaspa, witnessAction, currentArtifact.script);

    const t = new kaspa.Transaction({
      version: 1,
      inputs: [
        mkInput(rcOutpointObj, CONTINUATION_OUTPUT_SOMPI, rcSpkCurrent, rcSigScript),
        mkInput(feeOutpointObj, feeUtxo.value, feeUtxoSpk, new Uint8Array(0)), // fee待relay签
      ],
      outputs, lockTime: BigInt(deadlineMs), subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    // RootClose续约: CovenantBinding到RootClose自己(authorizing_input=0, covenant_id不变——close_commit
    // 不创建新covenant实例, 只是同一个RootClose续约, 同register_append的leaf续约同一手法)。
    t.outputs[CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX].covenant = new kaspa.CovenantBinding(0, new kaspa.Hash(rootCloseCovId));
    return t;
  };

  // leftover公式: RootClose自己不动value(close_commit不改变continuation面值, 同.sil"close不动
  // value"注释), 因此它自身续约的CONTINUATION_OUTPUT_SOMPI credit与新output的CONTINUATION_OUTPUT_SOMPI
  // 恰好抵消——leftover只剩fee输入自己的面值(比register_append/market_seal更简单, 因为这里只有
  // 一个非fee输入且它的输出值不变)。
  const leftover = feeUtxo.value;
  let shape;
  try {
    shape = selectChangeShape({
      kaspa, network, leftoverSompi: leftover,
      buildTxWithChange: (c) => mkTx(c), buildTxNoChange: () => mkTx(undefined),
      absFeeCapSompi,
    });
  } finally {
    committeePrivObj.free();
    committeePrivHex = null;
  }
  assertImpliedFeeMatches(shape.tx, shape.netLoss, 'close_commit');
  assertKaspadInputVersionRule(shape.tx, 'close_commit');
  {
    // 账本1497 Bettor MUST: RootClose输入是covenant续约(p=2), fee是普通输入(p=1)。
    assertMassWithinCeiling({
      kaspa, network, tx: shape.tx, inputHasCovenant: [true, false], feeUtxoValueSompi: feeUtxo.value, label: 'close_commit',
    });
  }

  const rootCloseContinuationCovId = String(shape.tx.outputs[CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX].covenant.covenantId);

  return {
    txJson: shape.tx.serializeToSafeJSON(),
    expectedTxid: shape.tx.id,
    rootCloseContinuationCovId,
    includeChange: shape.includeChange,
    changeSompi: shape.changeSompi,
    requiredFee: shape.requiredFee,
    netLoss: shape.netLoss,
    signInputIndices: [1],
    // B4-6: 如实标注——5槽同一把委员keypair, 不是4-of-5门限; 下游(意图记录/响应)必须带着这个标签。
    committeeMode: COMMITTEE_MODE_SINGLE_OPERATOR_5X_SAME_KEY,
  };
}

// ── ③ convert_to_claim 的 index 布局具名常量 ──
export const CONVERT_TO_CLAIM_ROOTCLOSE_IN_INDEX = 0; // RootClose(closed:1)输入
export const CONVERT_TO_CLAIM_HELD_IN_INDEX = 1;      // 合并KTT(owner=RootClose covid)输入
export const CONVERT_TO_CLAIM_FEE_IN_INDEX = 2;       // fee输入
export const CONVERT_TO_CLAIM_CLAIM_OUT_INDEX = 0;    // RootClaim genesis 输出
export const CONVERT_TO_CLAIM_TOKEN_OUT_INDEX = 1;    // 代币转出到RootClaim 输出

/**
 * convert_to_claim见证的具名参数映射(纯函数, 同sealWitnessArgs的理由: 真实形状里held输入下标与token输出下标
 * 同为1, 共识与黄金回归都看不出tokenInIdx/tokenOutIdx换位, 抽出来用两者不同的向量单测)。
 * @param {{heldIdx:number, claimPrefixHex:string, claimSuffixHex:string, tokPrefixHex:string, tokSuffixHex:string}} o
 *   claimPrefixHex/claimSuffixHex 无0x; tokPrefixHex/tokSuffixHex 原样透传
 */
export function convertToClaimWitnessArgs({ heldIdx, claimPrefixHex, claimSuffixHex, tokPrefixHex, tokSuffixHex }) {
  return {
    claimOutIdx: CONVERT_TO_CLAIM_CLAIM_OUT_INDEX, claim_prefix: '0x' + claimPrefixHex, claim_suffix: '0x' + claimSuffixHex,
    tokenInIdx: heldIdx, tokenOutIdx: CONVERT_TO_CLAIM_TOKEN_OUT_INDEX, tok_prefix: tokPrefixHex, tok_suffix: tokSuffixHex,
  };
}

/**
 * ③ convert_to_claim（`RootClose.convert_to_claim`）——设计文档§1.3/实现计划v0.6 §2.3批5。
 *
 * [RootClose(closed:1,CONT), 合并KTT(owner=RootClose covid,GENESIS), fee] →
 * [RootClaim genesis(7字段照抄+claimed_bitmap:0,CONT), 代币转给RootClaim(owner=RootClaim covid,GENESIS), 找零]。
 * RootClose/held两个输入的sigScript由本函数填(RootClose走convert_to_claim声明宏见证、held走KTT zero-out见证),
 * 只有fee输入需要relay签(signInputIndices=[2])。无lockTime(该entry无CLTV), 无委员签名。
 *
 * MUST-4: 新建RootClaim genesis输出KAS值用CONTINUATION_OUTPUT_SOMPI(CONT), 代币输出用GENESIS_OUTPUT_SOMPI,
 * 不取字面DUST_MIN(1000 sompi会让storage mass的p²/v项爆炸)。
 *
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.network
 * @param {string} o.marketId  32字节hex(无0x)
 * @param {string} o.committeePubkeyHex  32字节hex(无0x)
 * @param {number} o.deadlineMs
 * @param {string} o.rootCloseTmplHash  32字节hex(无0x), proto_markets.rootclose_tmpl_hash(fail-closed校验用)
 * @param {{txid:string, vout:number}} o.rootCloseOutpoint  RootClose当前UTXO(close_commit产出的续约输出, closed:1)
 * @param {string} o.rootCloseUtxoScriptPublicKeyHex  必填(B4-5): 该UTXO在链上的spk(取自产出它的close_commit交易输出), 入口断言必须等于现算的当前RootClose spk
 * @param {string} o.rootCloseCovId  RootClose自己的covenant_id(不变, market_seal时已算出)
 * @param {{local_yes:number,local_no:number,count:number,pool_value:number,closed:number,winningSide:number,payoutRoot:string}} o.closedState
 *   RootClose当前(close_commit之后)的完整7字段state, closed必须是1
 * @param {{txid:string, vout:number}} o.heldTokenOutpoint  必填: 合并KTT当前UTXO(market_seal产出的代币输出, 面值GENESIS_OUTPUT_SOMPI)
 * @param {string} o.tokPrefixHex  KanetTestToken模板prefix(hex, 0x前缀形状同market_seal调用方传入)
 * @param {string} o.tokSuffixHex  同上suffix
 * @param {object} o.feeUtxo  {txid,vout,value,scriptPublicKeyHex}
 * @param {string} o.relayChangeScriptPublicKeyHex
 * @param {bigint} o.absFeeCapSompi  feeProfile.convert_to_claim.cap
 * @returns {{txJson:string, expectedTxid:string, claimCovId:string, tokenCovId:string,
 *   claimPrefixHex:string, claimSuffixHex:string, claimState:object,
 *   includeChange:boolean, changeSompi:bigint, requiredFee:bigint, netLoss:bigint,
 *   signInputIndices:number[], genesisOutputIndices:number[]}}
 */
export function buildConvertToClaimTxJson({
  kaspa, network, marketId, committeePubkeyHex, deadlineMs, rootCloseTmplHash,
  rootCloseOutpoint, rootCloseUtxoScriptPublicKeyHex, rootCloseCovId, closedState, heldTokenOutpoint,
  tokPrefixHex, tokSuffixHex, feeUtxo, relayChangeScriptPublicKeyHex, absFeeCapSompi,
}) {
  if (closedState.closed !== 1) throw new Error(`buildConvertToClaimTxJson: fail-closed — closedState.closed=${closedState.closed}, RootClose.convert_to_claim的require(closed==1)必然拒绝(尚未close_commit?)`);
  if (closedState.winningSide !== 0 && closedState.winningSide !== 1) throw new Error(`buildConvertToClaimTxJson: closedState.winningSide必须是0或1, 实际${closedState.winningSide}`);
  if (!(closedState.pool_value > 0)) throw new Error(`buildConvertToClaimTxJson: closedState.pool_value(${closedState.pool_value})必须>0(全池代币整体转出)`);
  // 同market_seal的N2守卫: 没有持有代币输入时tokenInIdx无处可指, convert_to_claim的scanOwnedTokenInputs()==pool_value必然不成立。
  if (!heldTokenOutpoint) throw new Error('buildConvertToClaimTxJson: fail-closed — heldTokenOutpoint为空; convert_to_claim要求全池代币作为输入整体转出, 没有持有代币输入必然被拒');

  // RootClose当前(closed:1)redeem脚本: computeRootCloseGenesisArtifact自带fail-closed(模板hash必须等于已存rootCloseTmplHash)。
  const rcArtifact = computeRootCloseGenesisArtifact({ marketId, committeePubkeyHex, deadlineMs, rootCloseTmplHash, state: closedState });
  const convertToClaimEntryAbi = rcArtifact.entries.convert_to_claim;
  // B4-5(NWT批4, Bettor/NWT裁定同样加到convert_to_claim): 现算的当前RootClose(closed:1) spk必须等于调用方给的链上UTXO spk
  // (调用方从UTXO快照/产出该UTXO的close_commit交易输出取, 不是本函数现算的)——closedState与链上不符时节点会以P2SH不匹配拒收
  // (不丢钱), 这里入口就大声失败。
  if (typeof rootCloseUtxoScriptPublicKeyHex !== 'string' || String(rootCloseUtxoScriptPublicKeyHex).replace(/^0x/, '').toLowerCase() !== String(rcArtifact.scriptPubKeyHex).replace(/^0x/, '').toLowerCase()) {
    throw new Error(`buildConvertToClaimTxJson: fail-closed — 现算的当前RootClose spk(${rcArtifact.scriptPubKeyHex}) != 调用方给的链上UTXO spk(${rootCloseUtxoScriptPublicKeyHex}); closedState/deadline/committee与链上已不自洽`);
  }
  // RootClaim genesis(8字段: 7字段照抄RootClose自身state, claimed_bitmap:0)。
  const claimState = {
    local_yes: closedState.local_yes, local_no: closedState.local_no, count: closedState.count, pool_value: closedState.pool_value,
    closed: closedState.closed, winningSide: closedState.winningSide, payoutRoot: closedState.payoutRoot, claimed_bitmap: 0,
  };
  const claimArtifact = computeRootClaimGenesisArtifact({ marketId, state: claimState });
  const claimPrefix = claimArtifact.script.subarray(0, claimArtifact.stateLayout.start);
  const claimSuffix = claimArtifact.script.subarray(claimArtifact.stateLayout.start + claimArtifact.stateLayout.len);
  // held代币: owner=RootClose自己的covenant_id, amount=pool_value(市场封盘时已铸的合并KTT)。
  const heldArtifact = computeKttGenesisArtifact({ amount: closedState.pool_value, ownerCovIdHex: rootCloseCovId });

  const rcOutpointObj = { transactionId: rootCloseOutpoint.txid, index: rootCloseOutpoint.vout };
  const heldOutpointObj = { transactionId: heldTokenOutpoint.txid, index: heldTokenOutpoint.vout };
  const feeOutpointObj = { transactionId: feeUtxo.txid, index: feeUtxo.vout };
  const rcSpk = scriptPublicKeyFromHex(kaspa, rcArtifact.scriptPubKeyHex);
  const heldSpk = scriptPublicKeyFromHex(kaspa, heldArtifact.scriptPubKeyHex);
  const claimSpk = scriptPublicKeyFromHex(kaspa, claimArtifact.scriptPubKeyHex);
  const feeUtxoSpk = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);

  // 两个genesis输出的covenant_id都以fee输入outpoint派生(同market_seal既有约定, 账本1434③)。claim的covenant_id
  // 决定新代币输出的owner, 所以必须先于token输出算出(纯函数, 不查链)。
  const claimCovIdHex = String(kaspa.covenantId(feeOutpointObj, [{ index: CONVERT_TO_CLAIM_CLAIM_OUT_INDEX, output: new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, claimSpk) }]));
  const newTokenArtifact = computeKttGenesisArtifact({ amount: closedState.pool_value, ownerCovIdHex: claimCovIdHex });
  const newTokenSpk = scriptPublicKeyFromHex(kaspa, newTokenArtifact.scriptPubKeyHex);

  const rcAction = encodeConvertToClaimAction(kaspa, convertToClaimEntryAbi, convertToClaimWitnessArgs({
    heldIdx: CONVERT_TO_CLAIM_HELD_IN_INDEX, claimPrefixHex: claimPrefix.toString('hex'), claimSuffixHex: claimSuffix.toString('hex'), tokPrefixHex, tokSuffixHex,
  }));
  const rcSigScript = combineActionAndRedeem(kaspa, rcAction, rcArtifact.script);
  const heldSigScript = combineKttActionAndRedeem(kaspa, encodeKttTransferZeroOutAction(kaspa, heldArtifact.entryAbi, heldArtifact.stateFieldCount, [0]), heldArtifact.script);

  const mkInput = (outpoint, value, spk, sigScriptHex) => ({
    previousOutpoint: outpoint, signatureScript: sigScriptHex ?? new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET,
    utxo: { outpoint, amount: value, scriptPublicKey: spk, blockDaaScore: 0n },
  });

  const mkTx = (feeChangeSompi) => {
    const txInputs = [];
    txInputs[CONVERT_TO_CLAIM_ROOTCLOSE_IN_INDEX] = mkInput(rcOutpointObj, CONTINUATION_OUTPUT_SOMPI, rcSpk, rcSigScript);
    txInputs[CONVERT_TO_CLAIM_HELD_IN_INDEX] = mkInput(heldOutpointObj, GENESIS_OUTPUT_SOMPI, heldSpk, heldSigScript);
    txInputs[CONVERT_TO_CLAIM_FEE_IN_INDEX] = mkInput(feeOutpointObj, feeUtxo.value, feeUtxoSpk, new Uint8Array(0));
    const t = new kaspa.Transaction({
      version: 1,
      inputs: txInputs,
      outputs: [
        new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, claimSpk),
        new kaspa.TransactionOutput(GENESIS_OUTPUT_SOMPI, newTokenSpk),
        ...(feeChangeSompi === undefined ? [] : [new kaspa.TransactionOutput(feeChangeSompi, feeUtxoSpk)]),
      ],
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    // 每个genesis输出各自独立一个GenesisCovenantGroup(单-index数组), 同market_seal(设计文档§0.5 WrongGenesisCovenantId)。
    t.populateGenesisCovenants([
      new kaspa.GenesisCovenantGroup(CONVERT_TO_CLAIM_FEE_IN_INDEX, [CONVERT_TO_CLAIM_CLAIM_OUT_INDEX]),
      new kaspa.GenesisCovenantGroup(CONVERT_TO_CLAIM_FEE_IN_INDEX, [CONVERT_TO_CLAIM_TOKEN_OUT_INDEX]),
    ]);
    return t;
  };

  // leftover: RootClose输入自带CONT抵扣claim输出的CONT, held输入自带GENESIS抵扣token输出的GENESIS, 只剩fee输入面值。
  const leftover = feeUtxo.value + CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI - CONTINUATION_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI;
  const shape = selectChangeShape({
    kaspa, network, leftoverSompi: leftover,
    buildTxWithChange: (c) => mkTx(c), buildTxNoChange: () => mkTx(undefined),
    absFeeCapSompi,
  });
  assertImpliedFeeMatches(shape.tx, shape.netLoss, 'convert_to_claim');
  assertKaspadInputVersionRule(shape.tx, 'convert_to_claim');
  assertWitnessIndexLayout({
    tx: shape.tx, label: 'convert_to_claim',
    tokenInIdx: CONVERT_TO_CLAIM_HELD_IN_INDEX, heldOutpoint: heldTokenOutpoint,
    tokenOutIdx: CONVERT_TO_CLAIM_TOKEN_OUT_INDEX,
    expectedTokenOutSpkHex: computeKttGenesisArtifact({ amount: closedState.pool_value, ownerCovIdHex: String(shape.tx.outputs[CONVERT_TO_CLAIM_CLAIM_OUT_INDEX].covenant.covenantId).toLowerCase() }).scriptPubKeyHex,
    primaryOutIdx: CONVERT_TO_CLAIM_CLAIM_OUT_INDEX, expectedPrimaryOutSpkHex: claimArtifact.scriptPubKeyHex,
  });
  // 账本1497 Bettor MUST: RootClose与held代币都是covenant输入(p=2), fee是普通输入(p=1)。
  assertMassWithinCeiling({
    kaspa, network, tx: shape.tx, inputHasCovenant: [true, true, false], feeUtxoValueSompi: feeUtxo.value, label: 'convert_to_claim',
  });

  const claimCovId = String(shape.tx.outputs[CONVERT_TO_CLAIM_CLAIM_OUT_INDEX].covenant.covenantId);
  const tokenCovId = String(shape.tx.outputs[CONVERT_TO_CLAIM_TOKEN_OUT_INDEX].covenant.covenantId);
  if (claimCovId.toLowerCase() !== claimCovIdHex.toLowerCase()) {
    throw new Error(`buildConvertToClaimTxJson: fail-closed — 真实tx output[${CONVERT_TO_CLAIM_CLAIM_OUT_INDEX}]的covenant_id(${claimCovId}) != 预算值(${claimCovIdHex}), 新代币输出的owner会指向错误的covenant`);
  }

  return {
    txJson: shape.tx.serializeToSafeJSON(),
    expectedTxid: shape.tx.id,
    claimCovId, tokenCovId,
    claimPrefixHex: claimPrefix.toString('hex'), claimSuffixHex: claimSuffix.toString('hex'), claimState,
    includeChange: shape.includeChange,
    changeSompi: shape.changeSompi,
    requiredFee: shape.requiredFee,
    netLoss: shape.netLoss,
    signInputIndices: [CONVERT_TO_CLAIM_FEE_IN_INDEX],
    genesisOutputIndices: [CONVERT_TO_CLAIM_CLAIM_OUT_INDEX, CONVERT_TO_CLAIM_TOKEN_OUT_INDEX],
  };
}

// ══════════ ④ claim_draw(批6, RootClaim.claim_draw, 仅 full 分支: payout == pool_value) ══════════
export const CLAIM_DRAW_ROOTCLAIM_IN_INDEX = 0; // RootClaim(closed:1, claimed_bitmap:0)输入
export const CLAIM_DRAW_TICKET_IN_INDEX = 1;    // 赢家 ticket 输入(authorize_spend 需 bettor 签名)
export const CLAIM_DRAW_HELD_IN_INDEX = 2;      // 合并 KTT(owner=RootClaim covid)输入
export const CLAIM_DRAW_FEE_IN_INDEX = 3;       // fee 输入
export const CLAIM_DRAW_CLAIM_OUT_INDEX = 0;    // KanetTokenClaim genesis 输出
export const CLAIM_DRAW_TOKEN_OUT_INDEX = 1;    // 代币转给新 KanetTokenClaim 的输出
export const CLAIM_DRAW_UNUSED_OUT_INDEX = 0;   // rootOutIdx/remainTokenOutIdx: 仅 partial 分支用, full 分支不读(RootClaim.sil 行172 if 内)

/**
 * claim_draw 见证的具名参数映射(纯函数, 同 sealWitnessArgs/convertToClaimWitnessArgs 的理由): 抽出来用【所有索引参数两两不同】的哨兵输入单测,
 * 证明每个索引落在它自己具名的字段上。键名 = entryAbi.params 里的真实参数名。
 */
export function claimDrawWitnessArgs({
  rootOutIdx, claimOutIdx, tokenInIdx, tokenOutIdx, remainTokenOutIdx, ticketInIdx,
  payout, merkleIndex, treeDepth, siblings, ticketPrefixLen, ticketSuffixLen,
  tokPrefixHex, tokSuffixHex, claimPrefixHex, claimSuffixHex,
}) {
  return {
    rootOutIdx, claimOutIdx, tokenInIdx, tokenOutIdx, remainTokenOutIdx,
    payout, merkle_index: merkleIndex, tree_depth: treeDepth, siblings,
    ticketInIdx, ticket_prefix_len: ticketPrefixLen, ticket_suffix_len: ticketSuffixLen,
    tok_prefix: tokPrefixHex, tok_suffix: tokSuffixHex,
    claim_prefix: '0x' + claimPrefixHex, claim_suffix: '0x' + claimSuffixHex,
  };
}

/**
 * ④ claim_draw（`RootClaim.claim_draw`）——设计文档§1.4/§4、实现计划v0.8 §2.4批6。**只做 full 分支**(payout == pool_value, 无 RootClaim 续约输出):
 * [RootClaim(closed:1,CONT), 赢家ticket(GENESIS, 普通P2SH无covenant), 合并KTT(owner=RootClaim covid,GENESIS), fee] →
 * [KanetTokenClaim genesis(market_cov_id=RootClaim covid, winner_pk=票面bettorPk, amount=payout, CONT), 代币转给新KanetTokenClaim(GENESIS), 找零]。
 * 签名输入: fee(relay 签) + ticket(bettor 签, authorize_spend)——bettorSig 由本函数现签(用 committee_privkey_enc 解密, v0 bettor_pk===委员公钥)。
 *
 * 🔴 签名前 MUST-PROVE(Codex, 前置①): 在任何签名之前, 由 proto_bets + 链上 ticket spk 推导并证明应签公钥, 断言与手上私钥的公钥逐字节相等
 * (assertTicketSigningKey), 不等 fail-closed。🔴 签名时序(B4-1 教训): ticket 签名承诺全部输出含 covenant——必须在 populateGenesisCovenants 之后、
 * 对本次候选 tx 现签(每个找零候选各签一次), 并用 sighash 独立移植真验签(见测试)。
 *
 * 中止条件(fail-closed, 不构造): payout != pool_value(partial 分支不在本轮范围); payout < 1000(RootClaim.sil:103); 票面方向 != winningSide;
 * 现算 leaf(depth-0)!= claimState.payoutRoot; claimed_bitmap != 0(v0 单赢家只会领一次); 链上 RootClaim spk != 现算(B4-5 同款)。
 *
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.network
 * @param {string} o.marketId  32字节hex(无0x)
 * @param {{local_yes:number,local_no:number,count:number,pool_value:number,closed:number,winningSide:number,payoutRoot:string,claimed_bitmap:number}} o.claimState
 *   RootClaim 当前 8 字段 state(convert_to_claim 刚建时 claimed_bitmap=0)
 * @param {{txid:string,vout:number}} o.rootClaimOutpoint  RootClaim 当前 UTXO(convert_to_claim 输出0)
 * @param {string} o.rootClaimUtxoScriptPublicKeyHex  必填: 该 UTXO 的链上 spk(取自产出它的 convert_to_claim 交易输出), 入口断言 == 现算
 * @param {string} o.rootClaimCovId  RootClaim 自己的 covenant_id(convert_to_claim 输出0 的 covenant_id)
 * @param {{txid:string,vout:number}} o.heldTokenOutpoint  合并 KTT(owner=RootClaim covid)当前 UTXO(convert_to_claim 输出1)
 * @param {{txid:string,vout:number}} o.ticketOutpoint  赢家 ticket UTXO(register_append 输出1)
 * @param {string} o.ticketUtxoScriptPublicKeyHex  该 ticket 的链上 spk(取自产出它的 register_append 交易输出)
 * @param {{bettor_pk:string, side:number, stake:number}} o.bet  赢家那条 proto_bets 行(推导应签公钥用)
 * @param {string} o.committeePrivkeyEnvelope  committee_privkey_enc(v0: bettor_pk===committee 公钥, 用它签 ticket)
 * @param {number} o.payout
 * @param {string} o.tokPrefixHex 同 market_seal 调用方形状(0x 前缀 hex)
 * @param {string} o.tokSuffixHex
 * @param {object} o.feeUtxo  {txid,vout,value,scriptPublicKeyHex}
 * @param {string} o.relayChangeScriptPublicKeyHex
 * @param {bigint} o.absFeeCapSompi
 */
export function buildClaimDrawTxJson({
  kaspa, network, marketId, claimState, rootClaimOutpoint, rootClaimUtxoScriptPublicKeyHex, rootClaimCovId, heldTokenOutpoint,
  ticketOutpoint, ticketUtxoScriptPublicKeyHex, bet, committeePrivkeyEnvelope, payout,
  tokPrefixHex, tokSuffixHex, feeUtxo, relayChangeScriptPublicKeyHex, absFeeCapSompi,
}) {
  const who = 'buildClaimDrawTxJson';
  if (claimState.closed !== 1) throw new Error(`${who}: fail-closed — claimState.closed=${claimState.closed}, claim_draw 的 require(closed==1) 必然拒绝`);
  if (payout !== claimState.pool_value) throw new Error(`${who}: fail-closed — payout(${payout}) != pool_value(${claimState.pool_value}): 只实现 full 分支(无 RootClaim 续约), partial 分支不在本轮范围, 立即停止不构造`);
  if (!(payout >= 1000)) throw new Error(`${who}: fail-closed — payout(${payout}) < 1000, RootClaim.sil:103 require(payout>=1000) 必然拒绝`);
  if (claimState.claimed_bitmap !== 0) throw new Error(`${who}: fail-closed — claimed_bitmap(${claimState.claimed_bitmap}) != 0: v0 单赢家只领一次, slot 已被占用`);
  if (!heldTokenOutpoint || !ticketOutpoint) throw new Error(`${who}: fail-closed — heldTokenOutpoint / ticketOutpoint 必填`);
  if (Number(bet.side) !== claimState.winningSide) throw new Error(`${who}: fail-closed — 票面方向(side=${bet.side}) != claimState.winningSide(${claimState.winningSide}): require(tk.direction==winningSide) 必然拒绝(这张不是赢票)`);
  // (A) 路线 depth-0: payoutRoot 必须等于 leaf = blake2b256(bettorPk‖le8(payout))(RootClaim.sil:112)
  const bettorPk = String(bet.bettor_pk).toLowerCase();
  if (payoutLeafHex(bettorPk, payout) !== String(claimState.payoutRoot).toLowerCase()) {
    throw new Error(`${who}: fail-closed — 现算 leaf(depth-0, bettorPk=${bettorPk.slice(0, 8)}…, payout=${payout}) != claimState.payoutRoot: 这张票/这个 payout 不在 payoutRoot 里, merkle 证明必然失败`);
  }

  const claimArtifact = computeRootClaimGenesisArtifact({ marketId, state: claimState });
  // B4-5 同款: 现算的当前 RootClaim spk 必须等于调用方给的链上 UTXO spk
  if (typeof rootClaimUtxoScriptPublicKeyHex !== 'string' || String(rootClaimUtxoScriptPublicKeyHex).replace(/^0x/, '').toLowerCase() !== String(claimArtifact.scriptPubKeyHex).replace(/^0x/, '').toLowerCase()) {
    throw new Error(`${who}: fail-closed — 现算的当前RootClaim spk(${claimArtifact.scriptPubKeyHex}) != 调用方给的链上UTXO spk(${rootClaimUtxoScriptPublicKeyHex}); claimState/marketId 与链上已不自洽`);
  }
  const ticketArtifact = computeTicketGenesisArtifact({ bettorPk, direction: Number(bet.side), stake: Number(bet.stake), shardPoolId: marketId });
  const ticketPrefixLen = ticketArtifact.stateLayout.start;
  const ticketSuffixLen = ticketArtifact.script.length - ticketArtifact.stateLayout.start - ticketArtifact.stateLayout.len;

  // 🔴 签名前 MUST-PROVE: 私钥只以局部变量存在, 断言通过前不签名、不进入任何构造后续步骤。
  let committeePrivHex = decryptCommitteePrivkey(committeePrivkeyEnvelope);
  assertTicketSigningKey({ kaspa, privKeyHex: committeePrivHex, bet, marketId, ticketUtxoSpkHex: ticketUtxoScriptPublicKeyHex, label: 'claim_draw ticket' });
  const bettorPrivObj = new kaspa.PrivateKey(committeePrivHex);

  const ktcArtifact = computeKanetTokenClaimGenesisArtifact({ marketCovIdHex: String(rootClaimCovId).toLowerCase(), winnerPkHex: bettorPk, amount: payout });
  const heldArtifact = computeKttGenesisArtifact({ amount: claimState.pool_value, ownerCovIdHex: String(rootClaimCovId).toLowerCase() });
  const ktcPrefix = ktcArtifact.script.subarray(0, ktcArtifact.stateLayout.start);
  const ktcSuffix = ktcArtifact.script.subarray(ktcArtifact.stateLayout.start + ktcArtifact.stateLayout.len);

  const rcOutpointObj = { transactionId: rootClaimOutpoint.txid, index: rootClaimOutpoint.vout };
  const ticketOutpointObj = { transactionId: ticketOutpoint.txid, index: ticketOutpoint.vout };
  const heldOutpointObj = { transactionId: heldTokenOutpoint.txid, index: heldTokenOutpoint.vout };
  const feeOutpointObj = { transactionId: feeUtxo.txid, index: feeUtxo.vout };
  const rcSpk = scriptPublicKeyFromHex(kaspa, claimArtifact.scriptPubKeyHex);
  const ticketSpk = scriptPublicKeyFromHex(kaspa, ticketArtifact.scriptPubKeyHex);
  const heldSpk = scriptPublicKeyFromHex(kaspa, heldArtifact.scriptPubKeyHex);
  const ktcSpk = scriptPublicKeyFromHex(kaspa, ktcArtifact.scriptPubKeyHex);
  const feeUtxoSpk = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);

  // 新 KanetTokenClaim 的 covenant_id(fee 输入 outpoint 派生, 同 market_seal/convert_to_claim 约定)先于 token 输出算出。
  const ktcCovIdHex = String(kaspa.covenantId(feeOutpointObj, [{ index: CLAIM_DRAW_CLAIM_OUT_INDEX, output: new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, ktcSpk) }]));
  const newTokenArtifact = computeKttGenesisArtifact({ amount: payout, ownerCovIdHex: ktcCovIdHex });
  const newTokenSpk = scriptPublicKeyFromHex(kaspa, newTokenArtifact.scriptPubKeyHex);

  const claimAction = encodeClaimDrawAction(kaspa, claimArtifact.entries.claim_draw, claimDrawWitnessArgs({
    rootOutIdx: CLAIM_DRAW_UNUSED_OUT_INDEX, claimOutIdx: CLAIM_DRAW_CLAIM_OUT_INDEX, tokenInIdx: CLAIM_DRAW_HELD_IN_INDEX, tokenOutIdx: CLAIM_DRAW_TOKEN_OUT_INDEX,
    remainTokenOutIdx: CLAIM_DRAW_UNUSED_OUT_INDEX, ticketInIdx: CLAIM_DRAW_TICKET_IN_INDEX,
    payout, merkleIndex: 0, treeDepth: 0, siblings: [], ticketPrefixLen, ticketSuffixLen,
    tokPrefixHex, tokSuffixHex, claimPrefixHex: ktcPrefix.toString('hex'), claimSuffixHex: ktcSuffix.toString('hex'),
  }));
  const rcSigScript = combineActionAndRedeem(kaspa, claimAction, claimArtifact.script);
  const heldSigScript = combineKttActionAndRedeem(kaspa, encodeKttTransferZeroOutAction(kaspa, heldArtifact.entryAbi, heldArtifact.stateFieldCount, [0]), heldArtifact.script);
  const ticketSigScriptFor = (sig65Hex) => combineActionAndRedeem(kaspa, encodeAuthorizeSpendAction(kaspa, ticketArtifact.entries.authorize_spend, { bettorSig: '0x' + sig65Hex }), ticketArtifact.script);
  const DUMMY_SIG65 = '00'.repeat(65);

  const mkInput = (outpoint, value, spk, sigScript) => ({
    previousOutpoint: outpoint, signatureScript: sigScript ?? new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET,
    utxo: { outpoint, amount: value, scriptPublicKey: spk, blockDaaScore: 0n },
  });
  const buildTx = (feeChangeSompi, ticketSigScript) => {
    const txInputs = [];
    txInputs[CLAIM_DRAW_ROOTCLAIM_IN_INDEX] = mkInput(rcOutpointObj, CONTINUATION_OUTPUT_SOMPI, rcSpk, rcSigScript);
    txInputs[CLAIM_DRAW_TICKET_IN_INDEX] = mkInput(ticketOutpointObj, GENESIS_OUTPUT_SOMPI, ticketSpk, ticketSigScript);
    txInputs[CLAIM_DRAW_HELD_IN_INDEX] = mkInput(heldOutpointObj, GENESIS_OUTPUT_SOMPI, heldSpk, heldSigScript);
    txInputs[CLAIM_DRAW_FEE_IN_INDEX] = mkInput(feeOutpointObj, feeUtxo.value, feeUtxoSpk, new Uint8Array(0));
    const t = new kaspa.Transaction({
      version: 1, inputs: txInputs,
      outputs: [
        new kaspa.TransactionOutput(CONTINUATION_OUTPUT_SOMPI, ktcSpk),
        new kaspa.TransactionOutput(GENESIS_OUTPUT_SOMPI, newTokenSpk),
        ...(feeChangeSompi === undefined ? [] : [new kaspa.TransactionOutput(feeChangeSompi, feeUtxoSpk)]),
      ],
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    t.populateGenesisCovenants([
      new kaspa.GenesisCovenantGroup(CLAIM_DRAW_FEE_IN_INDEX, [CLAIM_DRAW_CLAIM_OUT_INDEX]),
      new kaspa.GenesisCovenantGroup(CLAIM_DRAW_FEE_IN_INDEX, [CLAIM_DRAW_TOKEN_OUT_INDEX]),
    ]);
    return t;
  };
  // 🔴 B4-1 教训: ticket 签名承诺全部输出(含 covenant)——先建出 covenant 已就位的候选 tx, 再对它现签, 再用真实签名重建最终 tx(sighash 不含输入自己的 sigScript)。
  const mkTx = (feeChangeSompi) => {
    const draft = buildTx(feeChangeSompi, ticketSigScriptFor(DUMMY_SIG65));
    const raw = kaspa.createInputSignature(draft, CLAIM_DRAW_TICKET_IN_INDEX, bettorPrivObj, kaspa.SighashType.All);
    const noPrefix = raw.startsWith('0x') ? raw.slice(2) : raw;
    if (noPrefix.length !== 132) throw new Error(`${who}: ticket createInputSignature 长度异常, 期望66字节(132 hex), 实际${noPrefix.length / 2}字节`);
    return buildTx(feeChangeSompi, ticketSigScriptFor(noPrefix.slice(2)));
  };

  // leftover: RootClaim 自带 CONT 抵扣 claim 输出 CONT; held 自带 GENESIS 抵扣 token 输出 GENESIS; ticket 的 GENESIS 面值回到 fee/找零。
  const leftover = feeUtxo.value + CONTINUATION_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI + GENESIS_OUTPUT_SOMPI - CONTINUATION_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI;
  let shape;
  try {
    shape = selectChangeShape({ kaspa, network, leftoverSompi: leftover, buildTxWithChange: (c) => mkTx(c), buildTxNoChange: () => mkTx(undefined), absFeeCapSompi });
  } finally {
    bettorPrivObj.free();
    committeePrivHex = null; // 🟡 hex 字符串仍待 GC(已知边界, 同 close_commit)
  }
  assertImpliedFeeMatches(shape.tx, shape.netLoss, 'claim_draw');
  assertKaspadInputVersionRule(shape.tx, 'claim_draw');
  assertClaimDrawLayout({
    tx: shape.tx, rootClaimOutpoint, ticketOutpoint, heldTokenOutpoint,
    expectedKtcSpkHex: ktcArtifact.scriptPubKeyHex,
    expectedTokenOutSpkHex: computeKttGenesisArtifact({ amount: payout, ownerCovIdHex: String(shape.tx.outputs[CLAIM_DRAW_CLAIM_OUT_INDEX].covenant.covenantId).toLowerCase() }).scriptPubKeyHex,
  });
  // 账本1497 MUST: RootClaim(covenant) / ticket(普通P2SH, register_append 输出1 无 covenant, 节点记录已核) / held KTT(covenant) / fee(普通)
  assertMassWithinCeiling({ kaspa, network, tx: shape.tx, inputHasCovenant: [true, false, true, false], feeUtxoValueSompi: feeUtxo.value, label: 'claim_draw' });

  const ktcCovId = String(shape.tx.outputs[CLAIM_DRAW_CLAIM_OUT_INDEX].covenant.covenantId);
  if (ktcCovId.toLowerCase() !== ktcCovIdHex.toLowerCase()) throw new Error(`${who}: fail-closed — 真实tx output[${CLAIM_DRAW_CLAIM_OUT_INDEX}]的covenant_id(${ktcCovId}) != 预算值(${ktcCovIdHex}), 新代币输出的owner会指向错误的covenant`);
  return {
    txJson: shape.tx.serializeToSafeJSON(), expectedTxid: shape.tx.id,
    claimCovId: ktcCovId, tokenCovId: String(shape.tx.outputs[CLAIM_DRAW_TOKEN_OUT_INDEX].covenant.covenantId),
    includeChange: shape.includeChange, changeSompi: shape.changeSompi, requiredFee: shape.requiredFee, netLoss: shape.netLoss,
    signInputIndices: [CLAIM_DRAW_FEE_IN_INDEX], genesisOutputIndices: [CLAIM_DRAW_CLAIM_OUT_INDEX, CLAIM_DRAW_TOKEN_OUT_INDEX],
    ticketPrefixLen, ticketSuffixLen,
  };
}

/** claim_draw 见证索引与交易真实布局的结构断言(同 assertWitnessIndexLayout 的理由; claim_draw 的 ticketInIdx/tokenInIdx 在真实形状里是 1/2, 互换可被发现)。 */
export function assertClaimDrawLayout({ tx, rootClaimOutpoint, ticketOutpoint, heldTokenOutpoint, expectedKtcSpkHex, expectedTokenOutSpkHex }) {
  const noPrefix = (h) => String(h).replace(/^0x/, '').toLowerCase();
  const same = (inp, op) => inp && String(inp.previousOutpoint.transactionId) === String(op.txid) && Number(inp.previousOutpoint.index) === Number(op.vout);
  if (!same(tx.inputs[CLAIM_DRAW_ROOTCLAIM_IN_INDEX], rootClaimOutpoint)) throw new Error('claim_draw: fail-closed — inputs[0] 不是 RootClaim outpoint, 输入布局与见证映射已不一致');
  if (!same(tx.inputs[CLAIM_DRAW_TICKET_IN_INDEX], ticketOutpoint)) throw new Error(`claim_draw: fail-closed — 见证 ticketInIdx(${CLAIM_DRAW_TICKET_IN_INDEX}) 指向的输入不是 ticket outpoint, 输入布局与见证映射已不一致`);
  if (!same(tx.inputs[CLAIM_DRAW_HELD_IN_INDEX], heldTokenOutpoint)) throw new Error(`claim_draw: fail-closed — 见证 tokenInIdx(${CLAIM_DRAW_HELD_IN_INDEX}) 指向的输入不是 held 代币 outpoint, 输入布局与见证映射已不一致`);
  const claimOut = tx.outputs[CLAIM_DRAW_CLAIM_OUT_INDEX], tokOut = tx.outputs[CLAIM_DRAW_TOKEN_OUT_INDEX];
  if (!claimOut || noPrefix(claimOut.scriptPublicKey.script) !== noPrefix(expectedKtcSpkHex)) throw new Error(`claim_draw: fail-closed — 见证 claimOutIdx(${CLAIM_DRAW_CLAIM_OUT_INDEX}) 指向的输出不是预期的 KanetTokenClaim genesis 输出`);
  if (!tokOut || noPrefix(tokOut.scriptPublicKey.script) !== noPrefix(expectedTokenOutSpkHex)) throw new Error(`claim_draw: fail-closed — 见证 tokenOutIdx(${CLAIM_DRAW_TOKEN_OUT_INDEX}) 指向的输出不是预期的代币输出`);
}
