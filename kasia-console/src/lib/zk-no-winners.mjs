// zk-no-winners.mjs — 账本1865(Bettor 选项1): ZK 原生盘"判决已定但无赢家"的终态。
//
// 背景(simnet 实测, 见 provenance 2026-10-05-j2-no-winners): 全体押了输的一方(或单边池输)⇒ computePariMutuelPayout degenerate('no winning-side bettors → refund'),
//   buildProposeCloseRequestV2 在【任何手续费 UTXO / 链上动作之前】抛错, judge-propose tick 每 5 分钟重试一次直到永远; 没有任何 tick 驱动 cancel/refund 合约 ⇒ 盘永远 verifying, 并永久占 ZK_MAX_LIVE_MARKETS 一个名额。
// 选项1(Bettor 裁): 终态 + metadata 标记, 零 KAS, 不动链上(筹码/粉尘留在 PayoutShard, 回收归 retire/sweep 设计)。
//   - 只在【判决已定】后写: 调用方是 judge-propose tick, 在 ctx.judgeWinDir 返回 0/1 之后才会走到 buildPropose 抛 degenerate; ABSTAIN/未决议时 judgeWinDir 先抛, 走原重试, 到不了这里。本函数仍断言 winningDirection ∈ {0,1}。
//   - 状态值取 'completed'(复用既有终态, 不发明新值): 老 settler / judge-propose / claim / handoff / close tick 的候选集都不含它; liveMarketCapReached / seeder 的"未完结"集把它当完结;
//     而 'cancelled' 会被 bettor 退款扫描当成要退款(无 spine 盘必报错), 'attested_v2'+exhausted 会被 broker-fee-emit 当成有 claim 费要核对(无 claim ⇒ CRITICAL 告警)。
//     broker-fee-emit 的候选条件是 (completed ∧ settle_txid 非空) ∨ zk_continuation.exhausted=1, 本盘两者皆否。
//   - 展示: metadata.no_winners=true + judged_winner(0/1) + judged_at + no_winners_source{type,condition_id}; my-positions 对本盘每个持仓都是输(见 zk-native-position-result.mjs noWinnersInfo)。

/** buildProposeCloseRequestV2 抛的 degenerate 文本(单源: bshard-close-transport.mjs:387 + pool-shard-settle.mjs 的 reason)。 */
export const NO_WINNERS_ERROR_RE = /degenerate payout\(no winning-side bettors/;
export function isNoWinnersError(e) { return NO_WINNERS_ERROR_RE.test(String((e && e.message) || e || '')); }

/**
 * 把"判决已定、无赢家"的盘写成终态(CAS: 只从 pending_bettors/verifying 转, 幂等)。
 * @param {{prepare:Function}} db
 * @returns {{ok:boolean, changed:boolean, reason?:string}}
 */
export function markZkNoWinners(db, marketId, winningDirection, nowIso = new Date().toISOString()) {
  if (winningDirection !== 0 && winningDirection !== 1) return { ok: false, changed: false, reason: 'verdict not final (winningDirection must be 0 or 1)' };
  const row = db.prepare('SELECT protocol_status, metadata, outcome_market_source, outcome_condition_id FROM pool_markets WHERE id = ?').get(marketId);
  if (!row) return { ok: false, changed: false, reason: 'market not found' };
  if (row.protocol_status !== 'pending_bettors' && row.protocol_status !== 'verifying') return { ok: true, changed: false, reason: `status ${row.protocol_status} (not markable)` };
  let meta = {}; try { meta = JSON.parse(row.metadata || '{}'); } catch { return { ok: false, changed: false, reason: 'bad metadata' }; }
  if (meta.bshard_close_request_v2 || meta.zk_continuation) return { ok: false, changed: false, reason: 'close already in flight (bshard_close_request_v2/zk_continuation present)' };
  meta.no_winners = true;
  meta.judged_winner = winningDirection;
  meta.judged_at = nowIso;
  meta.no_winners_source = { type: row.outcome_market_source || null, condition_id: row.outcome_condition_id || null };
  const r = db.prepare("UPDATE pool_markets SET protocol_status = 'completed', metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND protocol_status IN ('pending_bettors','verifying')").run(JSON.stringify(meta), marketId);
  return { ok: true, changed: r.changes > 0 };
}
