// zk-native-position-result.mjs — 账本1857: ZK 原生盘的"赢/输 + 每个赢家拿多少"读侧, 供 /api/pool/my-positions。
//
// 背景: my-positions 的 did_win/actual_payout 只认 settle_evidence.win_direction + winner_details, 而那只有 bshard-settle-daemon 写;
// ZK 原生路径(judge→close_attest→handoff→prove→zk_close→claimAutonomousTick)不写 settle_evidence。
// 不并行再算一遍: 这里调用 claim tick(zk-autonomy-ticks.mjs _claimOneMarket)用的【同一组函数】——
//   赢向 = metadata.zk_continuation.attestedWinner(handoff 落链时从链上 PayoutShardV2 读出并持久化);
//   叶子 = computePariMutuelPayout({ bettors: getMarketBets(...), winningDirection, poolTotalSompi: zc.poolAtZkCloseSompi, feeLeaves: deriveCloseFeeLeaves(...) }).payoutLeaves
//          (与 claim tick 逐字同源, 叶序 = claim 顺序: 第 i 笔 claim 领第 i 个叶子);
//   已到账 = metadata.zk_escape_audit 里 entry==='claim' 的条目(advanceZkContinuationAfterSpend 在 check_utxo_landed 通过后才写 ⇒ landed-gated)。
// 金额单位 = KTT 筹码(stake_ktt 单位), 不是 KAS。

/**
 * @param {{meta:object, bettorPk:string, marketId:string, db:object, deps:{getMarketBets:Function, deriveCloseFeeLeaves:Function, computePariMutuelPayout:Function}}} o
 * @returns {null | {winDirection:0|1, leaves:Array<{pk:string,amount:string}>|null, claimedCount:number, claimTxids:string[], leafIdxForPk:number[], poolKnown:boolean}}
 *   null = 不是 ZK 原生盘/还没 attest(无赢向) ⇒ 调用方保持原行为。leaves=null = 赢向已知但池快照(poolAtZkCloseSompi)还没 stamp(zk_close 前), 金额未知。
 */
export function deriveZkNativeResult({ meta, bettorPk, marketId, db, deps }) {
  const zc = meta?.zk_continuation;
  if (!zc) return null;
  const win = Number(zc.attestedWinner);
  if (win !== 0 && win !== 1) return null;
  const audit = Array.isArray(meta.zk_escape_audit) ? meta.zk_escape_audit : [];
  const claimTxids = audit.filter((a) => a && a.entry === 'claim' && a.txid).map((a) => String(a.txid));
  const out = { winDirection: win, leaves: null, claimedCount: claimTxids.length, claimTxids, leafIdxForPk: [], poolKnown: zc.poolAtZkCloseSompi != null };
  if (zc.poolAtZkCloseSompi == null) return out;
  const { bets } = deps.getMarketBets(marketId, db);
  const feeLeaves = deps.deriveCloseFeeLeaves(marketId, zc.poolAtZkCloseSompi) || [];
  const pm = deps.computePariMutuelPayout({ bettors: bets, winningDirection: win, poolTotalSompi: zc.poolAtZkCloseSompi, feeLeaves });
  if (pm.degenerate) return out;
  out.leaves = pm.payoutLeaves;
  const me = String(bettorPk).toLowerCase();
  pm.payoutLeaves.forEach((l, i) => { if (String(l.pk).toLowerCase() === me) out.leafIdxForPk.push(i); });
  return out;
}

/**
 * 账本1865: "判决已定但无赢家"的盘(zk-no-winners.mjs 写 completed + metadata.no_winners)。每个持仓都是输(按定义没有人押中赢向), 无 claim、无叶子。
 * @returns {null | {winDirection:0|1, noWinners:true}}  非该类盘 ⇒ null(调用方走原分支)
 */
export function noWinnersInfo(meta) {
  if (!meta || meta.no_winners !== true) return null;
  const w = Number(meta.judged_winner);
  if (w !== 0 && w !== 1) return null;
  return { winDirection: w, noWinners: true };
}

/** 本人在叶子里已到账/待到账的总额(筹码单位, BigInt): landed = 叶下标 < claimedCount。 */
export function sumMyLeaves(res) {
  let landed = 0n, pending = 0n; const txids = [];
  for (const i of res.leafIdxForPk) {
    const amt = BigInt(res.leaves[i].amount);
    if (i < res.claimedCount) { landed += amt; if (res.claimTxids[i]) txids.push(res.claimTxids[i]); } else pending += amt;
  }
  return { landed, pending, txids };
}
