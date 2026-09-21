// proto-settlement-ops.mjs — 批9 9-2b(iii-2): 结算驱动的【步骤端口】——四步 builder 的入参装配(prepare / build)。设计 §5 / §6 / §8 / §11。
// 核心(proto-settlement-driver-core.mjs)只认端口; store 管 DB 状态; 这里管"从 DB / 指针 / 链上事实装出每个 builder 需要的全部入参"。
//   prepare(step, ctx): phase 'target' ⇒ 只要 { targetAddress }(landed 检查 / 同字节重播用: 该步骤产出的 covenant P2SH 地址);
//                       phase 'inputs' ⇒ { targetAddress, expectedSpks, feeMinAmount, deadlineMs, inflightOutpoints, pointers }(C1 取证的预期)。
//   build(step, ctx):   fee 输入逐个真实构造(selectFeeUtxoByConstruction); chainParents 每个候选各补一次 fee 项(withFeeParent, 不是常量); 返回 relay 需要的 tx_json 等。
// 🔴 驱动层永不接触私钥: 只把 proto_markets.committee_privkey_enc(加密信封字符串)原样交给 builder, 解密 / 签名 / free 都在 builder 内(已测)。
// 🔴 只读 DB(纯查询), 不写任何表; 不 import relay-manager; 不含 withdraw / ticket_reclaim; network 由调用方传入(来自配置), 不取自任何行。
import { sqlite } from '../db/client.js';
import {
  computeShardLeafRedeemScript, computeKttGenesisArtifact, computeTicketGenesisArtifact, computeRootCloseGenesisArtifact, computeRootClaimGenesisArtifact,
  computeKanetTokenClaimGenesisArtifact, loadFeeProfileCap, loadProtocolConstants,
} from './proto-covenant-builder.mjs';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from './pool-bshard-artifacts.mjs';
import { selectFeeUtxoByConstruction, CONTINUATION_OUTPUT_SOMPI } from './proto-tx-assembly.mjs';
import { buildMarketSealTxJson, buildCloseCommitTxJson, buildRefundFlipTxJson, buildConvertToClaimTxJson, buildClaimDrawTxJson } from './proto-tx-assembly-settlement.mjs';
import { assertFactsResponse, MIN_FACTS_IPC_TIMEOUT_MS } from './proto-settlement-c1.mjs';
import { assertCloseCommitArgsFromDb } from './proto-settlement-inputs.mjs';
import { payoutLeafHex } from './proto-payout-leaf.mjs';
import { deriveWinnerBet } from './proto-winner-bet.mjs';
import { deriveLeafState } from './proto-leaf-state.mjs';
import { resolveStepPointers } from './proto-settlement-pointers.mjs';

const SHARD_LEAF_DIRECT_SIL = new URL('./ShardLeaf_direct.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FEE_PROFILE_KIND = Object.freeze({ seal: 'market_seal', close_commit: 'close_commit', refund_flip: 'refund_flip', convert_to_claim: 'convert_to_claim', claim_draw: 'claim_draw' });
const MARKET_COLS = 'id, deadline_ms, min_bet, seal_count, committee_pubkeys_json, rootclose_tmpl_hash, shardleaf_txid, shardleaf_vout, shardleaf_cov_id, shardleaf_own_redeem_len, status, winning_side, payout_root';

const lc = (h) => String(h ?? '').replace(/^0x/i, '').toLowerCase();
const spkAddress = (kaspa, network, spkHex) => kaspa.addressFromScriptPublicKey(new kaspa.ScriptPublicKey(0, lc(spkHex)), network).toString();
const opOf = (o) => ({ txid: lc(o.txid ?? o.transactionId), vout: Number(o.vout ?? o.index) });

/** 市场行(显式列, 不 SELECT *; 私钥信封列只在需要签名的两步单独取)。 */
function marketRow(db, marketId) {
  const m = db.prepare(`SELECT ${MARKET_COLS} FROM proto_markets WHERE id = ?`).get(marketId);
  if (!m) throw new Error(`settlement ops: 市场 ${String(marketId).slice(0, 12)}… 不存在`);
  let pubkeys; try { pubkeys = JSON.parse(m.committee_pubkeys_json); } catch { pubkeys = null; }
  if (!Array.isArray(pubkeys) || !/^[0-9a-f]{64}$/.test(lc(pubkeys[0]))) throw new Error(`settlement ops: 市场 ${String(marketId).slice(0, 12)}… 的 committee_pubkeys_json[0] 不是 32 字节 hex`);
  return { ...m, committeePubkeyHex: lc(pubkeys[0]) };
}
const envelopeOf = (db, marketId) => { const r = db.prepare('SELECT committee_privkey_enc AS env FROM proto_markets WHERE id = ?').get(marketId); if (!r || !r.env) throw new Error('settlement ops: 市场缺 committee_privkey_enc 信封'); return r.env; };
const marketIdOfClaim = (db, claimId) => { const r = db.prepare('SELECT market_id FROM proto_claims WHERE id = ?').get(claimId); if (!r) throw new Error(`settlement ops: claim ${String(claimId).slice(0, 12)}… 不存在`); return r.market_id; };

/** 封盘后不再变化的 4 个下注字段(= 已确认下注的求和; seal / close_commit / convert / claim 全程同一份)。 */
function sealedStateOf(db, marketId, m) {
  const s = deriveLeafState(marketId);
  if (s.count !== m.seal_count) throw new Error(`settlement ops: 已确认下注数(${s.count}) != seal_count(${m.seal_count})`);
  return s;
}
/** RootClose(closed:1)的 7 字段 state: 4 个下注字段 + closed=1 + winningSide(DB, 操作员裁决 write-once)+ payoutRoot(由赢家下注现算 depth-0 leaf)。 */
function closedStateOf(db, marketId, m) {
  const s = sealedStateOf(db, marketId, m);
  const w = deriveWinnerBet(marketId, { db, who: `settlement-ops closedState(${marketId.slice(0, 12)}…)` });
  if (w.poolValue !== s.pool_value) throw new Error(`settlement ops: 赢家派生的 pool_value(${w.poolValue}) != 已确认下注求和(${s.pool_value})`);
  return { winner: w.winner, closed: { ...s, closed: 1, winningSide: w.market.winning_side, payoutRoot: payoutLeafHex(lc(w.winner.bettor_pk), w.poolValue) } };
}
const rootCloseArtifact = (m, marketId, state) => computeRootCloseGenesisArtifact({ marketId, committeePubkeyHex: m.committeePubkeyHex, deadlineMs: Number(m.deadline_ms), rootCloseTmplHash: lc(m.rootclose_tmpl_hash), state });
const OPEN_ROOTCLOSE = (s) => ({ ...s, closed: 0, winningSide: 0, payoutRoot: '00'.repeat(32) });

const feeMin = (step) => loadFeeProfileCap(FEE_PROFILE_KIND[step]);   // 该步最低可行 fee 输入面值 = fee profile 的 cap(保守: 覆盖最坏 fee)

/**
 * prepare: 纯读 DB 派生。
 * @param {string} step  驱动步骤名 seal | close_commit | convert_to_claim | claim_draw
 * @param {{phase:'target'|'inputs', marketId?:string, subjectId:string, kaspa:any, network:string, pointers?:object, intent?:object, db?:object}} ctx
 */
export async function prepare(step, ctx) {
  const { phase, kaspa, network, subjectId } = ctx; const db = ctx.db || sqlite;
  if (!FEE_PROFILE_KIND[step]) throw new RangeError(`settlement ops: 未知步骤 ${step}`);
  const claimStep = step === 'convert_to_claim' || step === 'claim_draw';
  const marketId = claimStep ? marketIdOfClaim(db, subjectId) : (ctx.marketId || subjectId);
  const m = marketRow(db, marketId);
  const out = { inflightOutpoints: [], deadlineMs: Number(m.deadline_ms) };

  if (step === 'seal') {
    const s = sealedStateOf(db, marketId, m);
    const leaf = computeShardLeafRedeemScript({ marketId, minBet: m.min_bet, sealCount: m.seal_count, rootcloseTmplHash: lc(m.rootclose_tmpl_hash), state: s, ownRedeemLen: m.shardleaf_own_redeem_len });
    const held = computeKttGenesisArtifact({ amount: s.pool_value, ownerCovIdHex: lc(m.shardleaf_cov_id) });
    out.expectedSpks = { leaf: leaf.scriptPubKeyHex, held: held.scriptPubKeyHex };
    out.targetAddress = spkAddress(kaspa, network, rootCloseArtifact(m, marketId, OPEN_ROOTCLOSE(s)).scriptPubKeyHex);   // seal 输出0 = RootClose(closed:0) genesis
  } else if (step === 'close_commit') {
    const s = sealedStateOf(db, marketId, m);
    const { closed } = closedStateOf(db, marketId, m);
    out.expectedSpks = { rootClose: rootCloseArtifact(m, marketId, OPEN_ROOTCLOSE(s)).scriptPubKeyHex };
    out.targetAddress = spkAddress(kaspa, network, rootCloseArtifact(m, marketId, closed).scriptPubKeyHex);            // close_commit 输出0 = RootClose(closed:1) 续约
  } else if (step === 'refund_flip') {
    // R-a: 输入 = RootClose(closed:0)(与 close_commit 同一预期 spk); 输出 0 = RootClose(closed:2) 续约(winningSide / payoutRoot 保持 0)
    const s = sealedStateOf(db, marketId, m);
    out.expectedSpks = { rootClose: rootCloseArtifact(m, marketId, OPEN_ROOTCLOSE(s)).scriptPubKeyHex };
    out.targetAddress = spkAddress(kaspa, network, rootCloseArtifact(m, marketId, { ...OPEN_ROOTCLOSE(s), closed: 2 }).scriptPubKeyHex);
  } else if (step === 'convert_to_claim') {
    const { closed } = closedStateOf(db, marketId, m);
    const held = computeKttGenesisArtifact({ amount: closed.pool_value, ownerCovIdHex: pointerCovId(ctx, db, kaspa, step, marketId, 'rootClose') });   // 合并 KTT 的 owner = RootClose covenant id(seal 产出, 续约保持)
    out.expectedSpks = { rootClose: rootCloseArtifact(m, marketId, closed).scriptPubKeyHex, held: held.scriptPubKeyHex };
    out.targetAddress = spkAddress(kaspa, network, computeRootClaimGenesisArtifact({ marketId, state: { ...closed, claimed_bitmap: 0 } }).scriptPubKeyHex);    // convert_to_claim 输出0 = RootClaim
  } else {   // claim_draw
    const { closed, winner } = closedStateOf(db, marketId, m);
    const rootClaimCovId = pointerCovId(ctx, db, kaspa, step, marketId, 'rootClaim');
    const claimState = { ...closed, claimed_bitmap: 0 };
    out.expectedSpks = {
      rootClaim: computeRootClaimGenesisArtifact({ marketId, state: claimState }).scriptPubKeyHex,
      ticket: computeTicketGenesisArtifact({ bettorPk: lc(winner.bettor_pk), direction: Number(winner.side), stake: Number(winner.stake), shardPoolId: marketId }).scriptPubKeyHex,
      held: computeKttGenesisArtifact({ amount: closed.pool_value, ownerCovIdHex: rootClaimCovId }).scriptPubKeyHex,
    };
    out.targetAddress = spkAddress(kaspa, network, computeKanetTokenClaimGenesisArtifact({ marketCovIdHex: rootClaimCovId, winnerPkHex: lc(winner.bettor_pk), amount: closed.pool_value }).scriptPubKeyHex);   // claim_draw 输出0 = KanetTokenClaim
  }
  if (phase === 'inputs') { out.feeMinAmount = feeMin(step); out.pointers = ctx.pointers; }
  return out;
}

/** 预期 covenant id 取自指针(链上事实的预期; C1 另行对链取证)。'target' 阶段 ctx 没带 pointers 时自己解析一次。 */
function pointerCovId(ctx, db, kaspa, step, marketId, role) {
  const pointers = ctx.pointers || resolveStepPointers({ step, marketId, db, kaspa });
  const p = pointers && pointers.roles && pointers.roles[role];
  if (!p || !/^[0-9a-f]{64}$/.test(lc(p.expectedCovenantId))) throw new Error(`settlement ops: 指针里缺 ${role} 的 expectedCovenantId`);
  return lc(p.expectedCovenantId);
}

/**
 * build: 装配四步 builder 的全部入参并【逐个 fee 候选真实构造】; 只读 DB, 不签名(签名在 builder 内, 私钥只经信封)。
 * @param {string} step
 * @param {{marketId?:string, subjectId:string, prep:object, chainParents:object, feeCandidates:object[], withFeeParent:Function, pmtEvidence?:object, kaspa:any, network:string, relaySpkHex:string, db?:object}} ctx
 * @returns {Promise<{txJson:string, expectedTxid:string, signInputIndices:number[], genesisOutputIndices?:number[], continuationOutputIndices?:number[]}>}
 */
export async function build(step, ctx) {
  const { kaspa, network, relaySpkHex, prep, chainParents, feeCandidates, withFeeParent, subjectId } = ctx; const db = ctx.db || sqlite;
  if (!FEE_PROFILE_KIND[step]) throw new RangeError(`settlement ops: 未知步骤 ${step}`);
  if (!Array.isArray(feeCandidates) || feeCandidates.length === 0) throw new Error('settlement ops: build 需要 C1 给出的 fee 候选(feeCandidates)');
  const claimStep = step === 'convert_to_claim' || step === 'claim_draw';
  const marketId = claimStep ? marketIdOfClaim(db, subjectId) : (ctx.marketId || subjectId);
  const m = marketRow(db, marketId);
  const pointers = prep && prep.pointers;
  if (!pointers || !pointers.roles) throw new Error('settlement ops: build 需要 prep.pointers');
  const consts = loadProtocolConstants();
  const tokPrefixHex = '0x' + consts.token_prefix, tokSuffixHex = '0x' + consts.token_suffix;
  const cap = loadFeeProfileCap(FEE_PROFILE_KIND[step]);
  const base = { kaspa, network, marketId, absFeeCapSompi: cap, relayChangeScriptPublicKeyHex: relaySpkHex, tokPrefixHex, tokSuffixHex };
  const tryEach = (make) => selectFeeUtxoByConstruction(feeCandidates, (u) => make(u, withFeeParent(chainParents, u)));
  let built;

  if (step === 'seal') {
    const s = sealedStateOf(db, marketId, m);
    const leaf = computeShardLeafRedeemScript({ marketId, minBet: m.min_bet, sealCount: m.seal_count, rootcloseTmplHash: lc(m.rootclose_tmpl_hash), state: s, ownRedeemLen: m.shardleaf_own_redeem_len });
    const held = computeKttGenesisArtifact({ amount: s.pool_value, ownerCovIdHex: lc(m.shardleaf_cov_id) });
    const leafOp = opOf(chainParents.leaf.outpoint), heldOp = opOf(chainParents.held.outpoint);
    const sldCtor = [
      ctorBytes32V100(marketId), ctorBytes32V100(consts.ps_tmpl_hash), ctorBytes32V100(marketId), ctorIntV100(m.seal_count), ctorIntV100(m.min_bet), ctorBytes32V100(lc(m.rootclose_tmpl_hash)), ctorBytes32V100('00'.repeat(32)),
      ctorBytes32V100(consts.token_tmpl_hash), ctorIntV100(s.local_yes), ctorIntV100(s.local_no), ctorIntV100(s.count), ctorIntV100(s.pool_value), ctorIntV100(m.shardleaf_own_redeem_len),
    ];
    const convertToRootcloseEntryAbi = compileSilV100(SHARD_LEAF_DIRECT_SIL, sldCtor, 'ShardLeaf_direct')._raw.contracts.ShardLeaf_direct.entries.convert_to_rootclose;
    built = tryEach((feeUtxo, parents) => buildMarketSealTxJson({
      ...base, committeePubkeyHex: m.committeePubkeyHex, deadlineMs: Number(m.deadline_ms), rootCloseTmplHash: lc(m.rootclose_tmpl_hash),
      leafRedeemScript: leaf.script, leafOutpoint: leafOp, leafCovId: lc(m.shardleaf_cov_id),
      heldInput: { txid: heldOp.txid, vout: heldOp.vout, value: CONTINUATION_OUTPUT_SOMPI, scriptPublicKeyHex: held.scriptPubKeyHex, redeemScript: held.script, entryAbi: held.entryAbi, stateFieldCount: held.stateFieldCount },
      currentState: s, feeUtxo, convertToRootcloseEntryAbi, chainParents: parents,
    })).built;
  } else if (step === 'close_commit') {
    const s = sealedStateOf(db, marketId, m);
    const { closed, winner } = closedStateOf(db, marketId, m);
    // 驱动层闸(C2 / B4-4): 拟签的 newWinningSide / newPayoutRootHex 必须恰是由 DB(另一条派生路径)算出的值, 且 expectedPoolValue = 已由 C1 spk 断言证明的链上 pool_value
    const derived = assertCloseCommitArgsFromDb(marketId, { newWinningSide: m.winning_side, newPayoutRootHex: payoutLeafHex(lc(winner.bettor_pk), closed.pool_value), expectedPoolValue: s.pool_value }, { db });
    const rc = rootCloseArtifact(m, marketId, OPEN_ROOTCLOSE(s));
    built = tryEach((feeUtxo, parents) => buildCloseCommitTxJson({
      ...base, committeePubkeyHex: m.committeePubkeyHex, committeePrivkeyEnvelope: envelopeOf(db, marketId), deadlineMs: Number(m.deadline_ms), rootCloseTmplHash: lc(m.rootclose_tmpl_hash),
      rootCloseOutpoint: opOf(chainParents.rootClose.outpoint), rootCloseUtxoScriptPublicKeyHex: rc.scriptPubKeyHex, rootCloseCovId: pointerCovId({ pointers }, db, kaspa, step, marketId, 'rootClose'),
      sealedState: s, newWinningSide: derived.newWinningSide, newPayoutRootHex: derived.newPayoutRootHex, feeUtxo, pmtEvidence: ctx.pmtEvidence, chainParents: parents,
    })).built;
  } else if (step === 'refund_flip') {
    const s = sealedStateOf(db, marketId, m);
    const rc = rootCloseArtifact(m, marketId, OPEN_ROOTCLOSE(s));
    built = tryEach((feeUtxo, parents) => buildRefundFlipTxJson({
      ...base, committeePubkeyHex: m.committeePubkeyHex, deadlineMs: Number(m.deadline_ms), rootCloseTmplHash: lc(m.rootclose_tmpl_hash),
      rootCloseOutpoint: opOf(chainParents.rootClose.outpoint), rootCloseUtxoScriptPublicKeyHex: rc.scriptPubKeyHex, rootCloseCovId: pointerCovId({ pointers }, db, kaspa, step, marketId, 'rootClose'),
      sealedState: s, feeUtxo, pmtEvidence: ctx.pmtEvidence, chainParents: parents,
    })).built;
  } else if (step === 'convert_to_claim') {
    const { closed } = closedStateOf(db, marketId, m);
    const rcClosed = rootCloseArtifact(m, marketId, closed);
    built = tryEach((feeUtxo, parents) => buildConvertToClaimTxJson({
      ...base, committeePubkeyHex: m.committeePubkeyHex, deadlineMs: Number(m.deadline_ms), rootCloseTmplHash: lc(m.rootclose_tmpl_hash),
      rootCloseOutpoint: opOf(chainParents.rootClose.outpoint), rootCloseUtxoScriptPublicKeyHex: rcClosed.scriptPubKeyHex, rootCloseCovId: pointerCovId({ pointers }, db, kaspa, step, marketId, 'rootClose'),
      closedState: closed, heldTokenOutpoint: opOf(chainParents.held.outpoint), feeUtxo, chainParents: parents,
    })).built;
  } else {   // claim_draw
    const { closed, winner } = closedStateOf(db, marketId, m);
    const claimState = { ...closed, claimed_bitmap: 0 };
    const ticketArtifact = computeTicketGenesisArtifact({ bettorPk: lc(winner.bettor_pk), direction: Number(winner.side), stake: Number(winner.stake), shardPoolId: marketId });
    built = tryEach((feeUtxo, parents) => buildClaimDrawTxJson({
      ...base, claimState, rootClaimOutpoint: opOf(chainParents.rootClaim.outpoint), rootClaimUtxoScriptPublicKeyHex: computeRootClaimGenesisArtifact({ marketId, state: claimState }).scriptPubKeyHex,
      rootClaimCovId: pointerCovId({ pointers }, db, kaspa, step, marketId, 'rootClaim'), heldTokenOutpoint: opOf(chainParents.held.outpoint),
      ticketOutpoint: opOf(chainParents.ticket.outpoint), ticketUtxoScriptPublicKeyHex: ticketArtifact.scriptPubKeyHex,
      bet: { bettor_pk: lc(winner.bettor_pk), side: Number(winner.side), stake: Number(winner.stake) }, committeePrivkeyEnvelope: envelopeOf(db, marketId), payout: closed.pool_value, feeUtxo, chainParents: parents,
    })).built;
  }
  const r = { txJson: built.txJson, expectedTxid: built.expectedTxid, signInputIndices: built.signInputIndices };
  if (built.genesisOutputIndices) r.genesisOutputIndices = built.genesisOutputIndices;
  if (built.continuationOutputIndices) r.continuationOutputIndices = built.continuationOutputIndices;
  return r;
}

/**
 * R-a / M5 的纯决策(无 IO, 可单测): 给定 facts 形态 L 在 closed=2 地址上的读回(listRes)与形态 O 在 closed=0 地址上对旧 outpoint 的读回(oldRes),
 * 判 ① 后继(covenantId ∧ spk version 0 ∧ scriptHex ∧ 面值)与 ② 旧 outpoint 已花。任何一条不满足 ⇒ { flipped:false, reason }。地址级(只看"这个地址上有没有 UTXO")一律不算数。
 * @param {{listRes:{utxos:Array,truncated:boolean}, oldRes:{found:Array,missing:Array}, covId:string, flippedSpkHex:string, contValue:bigint}} o
 */
export function decideRefundFlipFromFacts({ listRes, oldRes, covId, flippedSpkHex, contValue }) {
  const succ = listRes.utxos.find((u) => u.covenantId === covId && u.scriptPublicKey.version === 0 && lc(u.scriptPublicKey.scriptHex) === lc(flippedSpkHex) && u.amount === contValue);
  if (!succ) return { flipped: false, reason: listRes.truncated ? 'no_matching_successor_window_truncated' : 'no_matching_successor' };
  if (oldRes.found.length > 0 || oldRes.missing.length !== 1) return { flipped: false, reason: 'old_outpoint_still_unspent' };
  return { flipped: true, successor: succ };
}

/**
 * R-a / M5: 只读探测"该市场的 RootClose 是否已被(任何人)翻成 closed=2"。fail-closed 到"未翻": 任何一步读不到 / 不合法 ⇒ { flipped: false }(调用方不据此动状态)。
 * 🔴 判据【三缺一不可】,不得地址级——closed=2 的 P2SH 地址公开可算,任何人可向它撒 dust:
 *   ① facts 形态 L 在 closed=2 spk 的地址上(面值精确 = CONTINUATION_OUTPUT_SOMPI)读到一个条目,其 covenantId == 该市场 RootClose 的 covenant id(seal 意图输出 0 的 covenantId,来自指针)∧ spk(version 0 + scriptHex)== 现算的 closed=2 spk;
 *      covenantId 不可伪造(covenant 续约输出只有花掉同一 covenant 输入的交易才能造出), 所以 truncated / 被挤掉只会造成假阴性, 不会假阳性;
 *   ② 旧 RootClose outpoint(seal 输出 0)已被花: facts 形态 O 在 closed=0 spk 的地址上按该 outpoint 查, 落在 missing 里;
 *   ③ 后继输出所在交易已 landed 且深度 ≥ minDepth: check_utxo_landed(closed=2 地址, 后继 txid, minDepth)——与 own-flip 落地判据同一原语(NO TX NO STATE / 抗 reorg)。
 * 后继 txid 来源 = ① 里 facts 读回的后继 outpoint.transactionId(NWT 落点 ①); 花费交易 == 该 txid 的依据 = covenant 连续性(该 covenant 只有一个存活 UTXO, ② 证明旧 outpoint 已被花, ① 证明后继带同一 covenantId)。
 *   ⚠ 白名单 read 集(proto-relay-ipc)里没有"按 outpoint 查花费交易"的命令, 加它 = 新增 IPC 面, 本批不做; 已如实写入批说明。
 * @returns {Promise<{flipped:boolean, reason?:string, txid?:string, outpoint?:{transactionId:string,index:number}, depth?:number|null, spenderVerified?:'covenant_continuity'}>}
 */
export async function probeRefundFlip({ marketId, kaspa, network, requestFacts, sendCmd, relayId, minDepth, db = sqlite, ipcTimeoutMs = MIN_FACTS_IPC_TIMEOUT_MS }) {
  if (typeof requestFacts !== 'function' || typeof sendCmd !== 'function') throw new TypeError('probeRefundFlip: requestFacts / sendCmd 必填');
  if (!Number.isInteger(minDepth) || minDepth <= 0) throw new TypeError('probeRefundFlip: minDepth 必须是正整数');
  const m = marketRow(db, marketId);
  const s = sealedStateOf(db, marketId, m);
  const pointers = resolveStepPointers({ step: 'refund_flip', marketId, db, kaspa });
  const oldRc = pointers.roles.rootClose; const covId = lc(oldRc.expectedCovenantId);
  if (!/^[0-9a-f]{64}$/.test(covId)) return { flipped: false, reason: 'no_expected_covenant_id' };
  const openSpk = lc(rootCloseArtifact(m, marketId, OPEN_ROOTCLOSE(s)).scriptPubKeyHex);
  const flippedSpk = lc(rootCloseArtifact(m, marketId, { ...OPEN_ROOTCLOSE(s), closed: 2 }).scriptPubKeyHex);
  const openAddr = spkAddress(kaspa, network, openSpk), flippedAddr = spkAddress(kaspa, network, flippedSpk);
  const cont = CONTINUATION_OUTPUT_SOMPI.toString();
  // ① 后继(带 covenantId ∧ spk)
  const listRes = assertFactsResponse(await requestFacts(flippedAddr, { facts: true, minAmount: cont, maxAmount: cont }, { timeoutMs: ipcTimeoutMs }), { form: 'list' });
  // ② 旧 outpoint 已花(missing)
  const requested = [{ transactionId: lc(oldRc.outpoint.transactionId), index: Number(oldRc.outpoint.index) }];
  const oRes = assertFactsResponse(await requestFacts(openAddr, { facts: true, outpoints: requested }, { timeoutMs: ipcTimeoutMs }), { form: 'outpoints', requested });
  const dec = decideRefundFlipFromFacts({ listRes, oldRes: oRes, covId, flippedSpkHex: flippedSpk, contValue: CONTINUATION_OUTPUT_SOMPI });
  if (!dec.flipped) return { flipped: false, reason: dec.reason };
  const succ = dec.successor;
  // ③ 后继交易已 landed 且深度足够
  const txid = succ.outpoint.transactionId;
  const landed = await sendCmd(relayId, { type: 'check_utxo_landed', address: flippedAddr, txid, minDepth }, 15000, 'internal');
  if (!(landed && landed.landed === true)) return { flipped: false, reason: 'successor_not_deep_enough', txid, depth: landed && landed.depth != null ? landed.depth : null };
  return { flipped: true, txid, outpoint: succ.outpoint, depth: landed.depth ?? null, spenderVerified: 'covenant_continuity' };
}
