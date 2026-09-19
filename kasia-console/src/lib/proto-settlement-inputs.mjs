// proto-settlement-inputs.mjs — B4-4(NWT批4离线审, Bettor 2026-09-19 前置②): 驱动层 MUST——
// buildCloseCommitTxJson 是"任意结果的签名预言机": 它对 newWinningSide / newPayoutRootHex 不核对(5 个委员槽自动签名)。
// 所以调用方(结算意图状态机/ingest)必须: ①从 DB 派生这两个值(不接受调用方随手传入); ②断言 Σ payouts == pool_value;
// ③payoutRoot 由现算而非传入; 任一不符 fail-closed, 不调用 builder。
//
// v0 (A) 路线(设计文档 §4): 单一 payout 值覆盖全部 pool_value ⇒ depth-0, payoutRoot = leaf 本身,
//   leaf = blake2b256(bettorPk(32B) ‖ le8(payout))(RootClaim.sil:112 claim_draw 的同一公式)。
//   claim 候选必须恰好 1 条(Bettor 1354: "v0 single-operator assumption violated, refusing to auto-pick")。
//
// 🟡 诚实边界: 本文件的 leaf 公式是按 RootClaim.sil:112 手工对照出的; 对链上合约的真实认可要等批6 claim_draw 的 simnet
// (depth-0 merkle 验证)——在那之前它是"与合约源码逐行对照 + 已知答案向量(blake2b 标准向量)"级别的证据, 不是链上共识证据。

import { sqlite } from '../db/client.js';

/** RootClaim.sil:103 require(payout >= 1000)。payout<1000 的市场 claim_draw 永远无法执行(结构性阻塞, 见账本1484), 签 close_commit 会把钱锁死。 */
export const CLAIM_PAYOUT_MIN = 1000;

export { payoutLeafHex } from './proto-payout-leaf.mjs';
import { payoutLeafHex } from './proto-payout-leaf.mjs';

/**
 * 从 DB 派生 close_commit 的两个签名内容值 + 断言。
 * @returns {{newWinningSide:0|1, newPayoutRootHex:string, payouts:{bettorPk:string, payout:number}[], poolValue:number, winnerBetId:string}}
 */
export function deriveCloseCommitInputs(marketId, { db = sqlite } = {}) {
  const who = `deriveCloseCommitInputs(${marketId})`;
  const market = db.prepare('SELECT id, status, winning_side, payout_root FROM proto_markets WHERE id = ?').get(marketId);
  if (!market) throw new Error(`${who}: fail-closed — 市场不存在`);
  if (market.status !== 'sealed') throw new Error(`${who}: fail-closed — 市场状态是 ${market.status}, close_commit 只允许在 sealed(market_seal 已落链)之后`);
  if (market.winning_side !== 0 && market.winning_side !== 1) {
    throw new Error(`${who}: fail-closed — proto_markets.winning_side=${market.winning_side}(必须是 0/1): 胜方必须由操作员的 resolve 裁决先写进 DB, 不接受调用方临时传入`);
  }
  const bets = db.prepare(`SELECT id, bettor_pk, side, stake FROM proto_bets WHERE market_id = ? AND status = 'confirmed'`).all(marketId);
  const poolValue = bets.reduce((s, b) => s + b.stake, 0);
  if (!(poolValue > 0)) throw new Error(`${who}: fail-closed — 已确认下注的 pool_value=${poolValue}, 没有可结算的池子`);
  const winners = bets.filter((b) => b.side === market.winning_side);
  if (winners.length !== 1) {
    throw new Error(`${who}: fail-closed — 胜方(side=${market.winning_side})的已确认下注有 ${winners.length} 条, (A) 路线要求恰好 1 条(v0 single-operator assumption violated, refusing to auto-pick one)`);
  }
  const winner = winners[0];
  // (A) 路线: 单一 payout 值覆盖全部 pool_value。
  const payouts = [{ bettorPk: String(winner.bettor_pk).toLowerCase(), payout: poolValue }];
  const sumPayouts = payouts.reduce((s, p) => s + p.payout, 0);
  if (sumPayouts !== poolValue) throw new Error(`${who}: fail-closed — Σ payouts(${sumPayouts}) != pool_value(${poolValue})`);
  if (payouts.some((p) => p.payout < CLAIM_PAYOUT_MIN)) {
    throw new Error(`${who}: fail-closed — payout(${payouts[0].payout}) < ${CLAIM_PAYOUT_MIN}: RootClaim.claim_draw 的 require(payout>=1000) 永远无法满足(账本1484), 签 close_commit 会把池子锁死; 这类小额市场应走取消/退款路径而不是结算`);
  }
  const newPayoutRootHex = payoutLeafHex(payouts[0].bettorPk, payouts[0].payout); // depth-0: root = leaf
  if (market.payout_root && String(market.payout_root).replace(/^0x/i, '').toLowerCase() !== newPayoutRootHex) {
    throw new Error(`${who}: fail-closed — proto_markets.payout_root(已落库)与由 proto_bets 现算的值不一致(db_payout_root_drift): 库=${String(market.payout_root).slice(0, 12)}… 现算=${newPayoutRootHex.slice(0, 12)}…`);
  }
  return { newWinningSide: market.winning_side, newPayoutRootHex, payouts, poolValue, winnerBetId: winner.id };
}

/**
 * 驱动层闸: 调用 buildCloseCommitTxJson 之前, 断言要签的 newWinningSide/newPayoutRootHex 恰是由 DB 派生的值。
 * 不符 ⇒ throw(不调用 builder, 不签名)。返回派生结果供驱动直接用。
 */
export function assertCloseCommitArgsFromDb(marketId, { newWinningSide, newPayoutRootHex }, opts = {}) {
  const d = deriveCloseCommitInputs(marketId, opts);
  if (newWinningSide !== d.newWinningSide) {
    throw new Error(`close_commit_args_not_from_db: fail-closed — 拟签的 newWinningSide(${newWinningSide}) != 由 DB 派生的 ${d.newWinningSide}`);
  }
  if (String(newPayoutRootHex ?? '').replace(/^0x/i, '').toLowerCase() !== d.newPayoutRootHex) {
    throw new Error(`close_commit_args_not_from_db: fail-closed — 拟签的 newPayoutRootHex(${String(newPayoutRootHex).slice(0, 12)}…) != 由 proto_bets 现算的 ${d.newPayoutRootHex.slice(0, 12)}…`);
  }
  return d;
}
