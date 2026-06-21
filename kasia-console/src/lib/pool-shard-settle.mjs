// pool-shard-settle.mjs — (A)-model rolling-shard settle orchestration (production register wiring (c), J2 2026-06-21).
//
// At deadline + oracle verdict (winning direction), settle a logical market:
//   1. computePariMutuelPayout : REAL bettor pari-mutuel payout (缺口1 — winners split the WHOLE pool ∝ their stake,
//        NOT the demo synthetic equal-split). degenerate (no winning side) → refund path (cancel_attest, closed 0→2).
//   2. consolidate            : each shard's current ShardLeaf → the per-market PayoutShard (bshard_consolidate, cov_id-bind, proven).
//   3. close_attest           : committee 4-of-5 attest the pari-mutuel payoutRoot (closed 0→1) — reuses the oracle committee
//        two-phase preimage→sign→submit (the oracle relays sign; same flow as cross-node 1000 / production-shape verify).
//   4. claim                  : per-winner store-payout (bshard_payout_claim) — bettor-triggered or auto-claim (separate).
//
// NO TX NO STATE: market_shards/payout_shards status updates ONLY after the on-chain settle TX landed.
// determinism: payoutRoot computed off-chain (BigInt, exact); committee attests it (committee-trust, same as v07).

import { payoutRoot as buildPayoutRoot, merkleProof } from './pool-payout-root.mjs';
import { spliceLeafState } from './pool-shard-register.mjs';

const z32 = '00'.repeat(32);

/**
 * REAL bettor pari-mutuel payout (缺口1). Winners (direction == winningDirection) split the WHOLE pool (all stakes,
 * winning + losing) proportionally to their OWN stake. Optional feeBps skimmed off the top (broker/oracle) before split.
 * Integer-exact (BigInt); rounding remainder (dust) assigned to winners[0] so Σpayout == distributable exactly.
 *
 * @param {object} o {
 *   bettors: [{ pk(hex), direction(0|1), stake(sompi int|string|bigint) }],
 *   winningDirection: 0|1,
 *   poolTotalSompi?: total pool (default = Σ all stakes),
 *   feeBps?: basis points skimmed before split (default 0)
 * }
 * @returns {{ degenerate:boolean, reason?:string, winners:[{pk,amount}], poolTotal:string, distributable:string, feeSompi:string }}
 */
export function computePariMutuelPayout({ bettors, winningDirection, poolTotalSompi = null, feeBps = 0 }) {
  if (winningDirection !== 0 && winningDirection !== 1) throw new Error(`winningDirection must be 0|1, got ${winningDirection}`);
  const pool = poolTotalSompi != null ? BigInt(poolTotalSompi) : bettors.reduce((s, b) => s + BigInt(b.stake), 0n);
  const feeSompi = pool * BigInt(feeBps) / 10000n;
  const distributable = pool - feeSompi;
  const winners = bettors.filter(b => Number(b.direction) === winningDirection);
  const totalWinStake = winners.reduce((s, b) => s + BigInt(b.stake), 0n);

  // degenerate: no winning side (single-sided pool / all-loser) → settler can't pay winners → refund (cancel_attest path).
  if (winners.length === 0 || totalWinStake === 0n) {
    return { degenerate: true, reason: 'no winning-side bettors → refund', winners: [], poolTotal: pool.toString(), distributable: distributable.toString(), feeSompi: feeSompi.toString() };
  }
  const payouts = winners.map(b => ({ pk: b.pk, amount: BigInt(b.stake) * distributable / totalWinStake }));
  const assigned = payouts.reduce((s, p) => s + p.amount, 0n);
  payouts[0].amount += (distributable - assigned);   // dust → winners[0] (Σ == distributable exact)
  return { degenerate: false, winners: payouts.map(p => ({ pk: p.pk, amount: p.amount.toString() })), poolTotal: pool.toString(), distributable: distributable.toString(), feeSompi: feeSompi.toString() };
}

/** Pari-mutuel refund payout (degenerate market): each bettor refunded their OWN stake (refundRoot leaf = blake2b(pk‖stake)). */
export function computeRefundPayout({ bettors }) {
  return { winners: bettors.map(b => ({ pk: b.pk, amount: BigInt(b.stake).toString() })) };
}

/**
 * 命门③ settle-enforce — 委员 re-derive 闸 (Owner 钦定). 委员【不签任意 payoutRoot】: 从 predicate + 冻结共享 ESPN 快照
 * 独立 judgeLine re-derive winningSide → computePariMutuelPayout 重算 payoutRoot → 验 tx 的 claimedPayoutRoot ==
 * 自己 re-derive 才 sign_input_for_settle{safe_json} 签. 假 winningSide/payoutRoot → re-derive 不符 → 拒签 →
 * 4-of-5 不够 → close_attest BUST. determinism: judgeLine(predicate, fields) 任何节点 byte-identical → 同 verdict →
 * 同 payoutRoot → 跨节点委员同意 (Owner 钦定① consensus-correct). 冻结快照非各自 live-fetch (破 determinism + 403 自伤,
 * 配 [[project-oracle-consensus-launders-poison-rulings]]).
 *
 * @param {object} o {
 *   rcOn(relayId, cmd)→Promise, committeeRelayId, txSafeJson(un.serializeToSafeJSON()), claimedPayoutRoot(hex tx attests),
 *   predicate(market resolution_predicate object), frozenFields(冻结 ESPN structured fields 快照), bettors, feeBps=0
 * }
 * @returns {{ ok, signature?, verdict?, reDerivedRoot?, reason? }}
 */
export async function enforceCommitteeSign({ rcOn, committeeRelayId, txSafeJson, claimedPayoutRoot, predicate, frozenFields, bettors, feeBps = 0 }) {
  const { judgeLine } = await import('./judgeline.mjs');
  const verdict = judgeLine(predicate, frozenFields);                 // 'YES' | 'NO' | 'ABSTAIN' (byte-identical 跨节点)
  if (verdict !== 'YES' && verdict !== 'NO') {
    return { ok: false, reason: `judgeLine ${verdict} (字段不足/无法判, abstain-not-guess) — 委员拒签` };
  }
  const winningDirection = verdict === 'YES' ? 0 : 1;
  const pm = computePariMutuelPayout({ bettors, winningDirection, feeBps });
  if (pm.degenerate) return { ok: false, reason: `degenerate (${pm.reason}) — 单边池需 refund 路` };
  const reDerivedRoot = settlePayoutRoot(pm.winners);
  if (reDerivedRoot !== String(claimedPayoutRoot)) {
    return { ok: false, reason: `命门③ REJECT: re-derive payoutRoot ${reDerivedRoot.slice(0, 14)} != claimed ${String(claimedPayoutRoot).slice(0, 14)} (假 winningSide/payoutRoot)` };
  }
  const sj = await rcOn(committeeRelayId, { type: 'sign_input_for_settle', tx_hex: txSafeJson, input_index: 0, safe_json: true });
  if (!sj?.signature) return { ok: false, reason: `re-derive 匹配但 relay 签失败: ${JSON.stringify(sj).slice(0, 100)}` };
  return { ok: true, signature: sj.signature, verdict, reDerivedRoot };
}

/** payoutRoot (depth-10, ≤1024) for a winners-with-amount list. Throws >1024 (needs rolling payout-shard). */
export function settlePayoutRoot(winners) {
  return buildPayoutRoot(winners).toString('hex');
}

/**
 * Consolidate all shards of a logical market into its PayoutShard, then return the final PS outpoint + consolidated_pool.
 * Iterative: each shard's CURRENT ShardLeaf (spliced from shard_redeem_hex + current_leaf_state) → bshard_consolidate.
 * @param {object} o { db, rc, landed, p2sh, logicalMarketId, payoutShard:{payout_redeem_hex, payout_ps_outpoint, payout_cov_id}, relayAddr, transfer }
 * @returns {{ psOutpoint, consolidatedPool, consolidatedShards }}
 */
export async function consolidateAllShards({ db, rc, landed, p2sh, logicalMarketId, payoutShard, relayAddr, transfer, resume = null }) {
  const allShards = db.prepare(`SELECT * FROM market_shards WHERE logical_market_id = ? ORDER BY shard_index ASC`).all(logicalMarketId);
  // resume(部分 consolidate 后续跑): 跳 shard_index < resume.fromShardIdx, PS 从 resume.psTx/pool 起(已 consolidate 片的 leaf 已花).
  const shards = resume ? allShards.filter(s => s.shard_index >= resume.fromShardIdx) : allShards;
  let psTx = resume ? resume.psTx : String(payoutShard.payout_ps_outpoint).split(':')[0];
  let psIdx = resume ? Number(resume.psIdx || 0) : Number(String(payoutShard.payout_ps_outpoint).split(':')[1] || 0);
  // PS genesis 烤的初始 consolidated_pool(= PS_SEED, 非 0): state_start=1, [1]=PUSH8(0x08), [2..9]=consolidated_pool i64LE.
  //   handler 守恒 weld 用 in[ps].value(=consolidated_pool)→ 必传匹配的, 否则 EvalFalse.
  let consolidatedPool = resume ? BigInt(resume.pool) : Buffer.from(payoutShard.payout_redeem_hex, 'hex').readBigInt64LE(2);
  let psRedeem = Buffer.from(payoutShard.payout_redeem_hex, 'hex'); psRedeem.writeBigInt64LE(consolidatedPool, 2); psRedeem = psRedeem.toString('hex');   // reflect 当前 consolidated_pool
  let count = 0;
  for (const shard of shards) {
    if (!shard.shard_redeem_hex || !shard.current_leaf_state) throw new Error(`shard ${shard.shard_market_id} missing redeem/state — cannot consolidate (fail-closed)`);
    const st = JSON.parse(shard.current_leaf_state);
    const leafRedeem = spliceLeafState(shard.shard_redeem_hex, st);
    const [leafTx, leafIdxStr] = String(shard.current_leaf_outpoint).split(':');
    const fee = await transfer(relayAddr, 30_000_000);
    const cj = await rc({
      type: 'bshard_consolidate',
      inputs: {
        payoutshard: { redeem_hex: psRedeem, outpointTxid: psTx, index: psIdx, state: { consolidated_pool: consolidatedPool.toString(), closed: 0, payoutRoot: z32, w0: 0 }, state_start: 1 },
        shardleaf: { redeem_hex: leafRedeem, outpointTxid: leafTx, index: Number(leafIdxStr || 0), pool_value: st.pool_value },
        fee: { address: relayAddr, outpointTxid: fee, index: 0 },
      },
      outputs: { change_address: relayAddr },
    });
    const conTx = cj.txId || cj.txid;
    if (!conTx || !await landed(conTx, cj.psContAddress)) throw new Error(`consolidate shard ${shard.shard_index} no land: ${JSON.stringify(cj).slice(0, 140)}`);
    consolidatedPool += BigInt(st.pool_value);
    psTx = conTx; psIdx = 0; count++;
    // 更新 psRedeem: 每 consolidate 后 PS 续约到新地址(consolidated_pool 增)→ 下一 consolidate 的 input redeem 须反映新 state.
    //   consolidate 只动 consolidated_pool(closed=0/payoutRoot=z32/w0..16=0 不变)→ 替换 state 区首字段 i64LE([1]=PUSH8, [2..9]=consolidated_pool).
    const rbuf = Buffer.from(psRedeem, 'hex'); rbuf.writeBigInt64LE(consolidatedPool, 2); psRedeem = rbuf.toString('hex');
    try { db.prepare(`UPDATE market_shards SET status = 'settling' WHERE shard_market_id = ?`).run(shard.shard_market_id); } catch { /* readonly driver DB → bookkeeping best-effort; on-chain settle is the truth */ }
  }
  return { psOutpoint: `${psTx}:${psIdx}`, consolidatedPool: consolidatedPool.toString(), consolidatedShards: count };
}
