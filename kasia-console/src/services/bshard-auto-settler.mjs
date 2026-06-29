// bshard-auto-settler — 最小自动结算 settler (interim-B 平替·Owner 钦定全速上线 2026-06-29)。
//
// wire qi37q 5源验过的 proven close+claim 路成可跑 (operator-trigger 或最小 tick)。非完美 daemon:
//   先把手驱的 qi37q 流程编排成 settleMarket(marketId)·deploy live 真盘自动结算。
//   逐步加 lease/失败重试/灰度 (见 docs/2026-06-29-settler-daemon-design.md)。
//
// 铁律 (全速但不蛮干·carry 今晚):
//   - NO TX NO STATE: 每上链步 verify LANDED 才推进 (查 UTXO/kaspa_tx_log)。
//   - driver-side enforce (命门): submit close 前硬闸 verify build output == compilePayoutShardRedeem(closed=1,payoutRoot)
//     派生地址 (= 今晚 pzmm5hg7 predict-then-verify·地址烤死锚)·不等→挂起 alert 不 submit。
//   - 单 driver lease: 每市场抢锁·防 double-drive (今晚 KANet-UI/J1 抢驱教训)。
//   - winDir = judgeLine(predicate, ESPN)·非 DB outcome_side (今晚实证 outcome_side=1 但 winDir=0)。
//   - shard-aware: getMarketBets (排 maker_stake/commingled 杂质·防 0-bet 误判)。
//   - DRY-RUN 模式: 计算全部 + enforce·零 submit (上线前验逻辑)。
//
// PREREQUISITE (部署前): §0 unSafeJson patch (canonical build-preimage 返 un.serializeToSafeJSON·跑着的 relay 须载) +
//   J1 consolidate auto-splice helper。

import { getMarketBets } from '../lib/pool-bettor-sides-query.mjs';
import { computePariMutuelPayout } from '../lib/pool-shard-settle.mjs';
import { payoutRoot as buildPayoutRoot, payoutLeaf, merkleProof, climbProof } from '../lib/pool-payout-root.mjs';
import { deriveCommitteeSeed, selectCommittee } from './pool-committee-sampler.mjs';
import { compilePayoutShardRedeem } from '../lib/pool-shard-register.mjs';
import { blake2b } from '@noble/hashes/blake2b';

const COMMITTEE_DUMMY_SIG = '41' + '00'.repeat(64) + '01';   // 66B placeholder 未签槽 (4-of-5 容 1)
const QUORUM = 4;
const ZERO32 = '0'.repeat(64);

// ── ctx 契约 (caller 注入·= relay/db/chain 边界·settler 不碰链) ──
//   ctx.db                         — better-sqlite3 (readonly 够·lease 需 write)
//   ctx.relayPost(relayId, cmd)    — POST /api/relay/:id/send-command → result (relay IPC·:3200)
//   ctx.getUtxos(address)          — chain getUtxosByAddresses → entries (NO TX NO STATE verify)
//   ctx.judgeWinDir(market, bets)  — judgeLine(predicate+ESPN) → 0|1 (winDir·非 DB outcome_side)
//   ctx.endBlockHash(deadlineDaa)  — fetchEndBlockHashCanonical (committee seed·跨节点确定性)
//   ctx.poolMembers(poolMerkleRoot)— oracle pool members [{pk_hex,stake_sompi}]
//   ctx.feeRelay                   — { id, address } 专用 fee relay (防 churn)
//   ctx.network                    — 'testnet-12' | 'mainnet'
//   ctx.consolidate(market, leaf)  — J1 helper (ShardLeaf→PayoutShard·若未 consolidate)
//   ctx.dryRun                     — true = 计算+enforce·零 submit
//   ctx.alert(marketId, reason)    — 挂起 alert (失败不乱结)

/**
 * computeSettlePlan — 纯计算 (无链·dry-runnable now·上线前验逻辑)。
 *   gather→winDir→payoutRoot→committee→predicted closed-PS addr。driver enforce 的"应锚地址"在此算。
 * @returns {ok, reason?, isBshard, betCount, winDir, payoutRoot, winners, committee, committeePkHash,
 *           expectedClosedAddr, degenerate}
 */
export async function computeSettlePlan(marketId, ctx) {
  const { db } = ctx;
  const market = db.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
  if (!market) return { ok: false, reason: 'market 不存在' };

  // 1. shard-aware bets (排杂质·防 0-bet 误判)
  const { bets, betCount, poolSompi, isBshard, multiShard } = getMarketBets(marketId, db);
  if (!isBshard) return { ok: false, reason: 'non-bshard (v06/v05)·此 settler 只 bshard', isBshard: false };
  if (multiShard > 0) return { ok: false, reason: `多片 ${multiShard} shards·fold 路 production·此 minimal 单片`, isBshard };
  if (betCount === 0) return { ok: false, reason: '真 0-bet → refund 路 (非 strand)', isBshard, betCount: 0, degenerate: true };

  // 2. winDir = judgeLine (非 DB outcome_side·命门)
  const winDir = await ctx.judgeWinDir(market, bets);
  if (winDir !== 0 && winDir !== 1) return { ok: false, reason: `judgeLine winDir 无效: ${winDir}`, isBshard };

  // 3. payoutRoot (driver re-derive·命门)
  const pm = computePariMutuelPayout({ bettors: bets.map(b => ({ pk: b.pk, stake: b.stake, direction: b.direction })), winningDirection: winDir });
  if (pm.degenerate) return { ok: false, reason: 'degenerate (无 winning side) → refund 判定·别误退/strand', isBshard, degenerate: true };
  const payoutRootHex = buildPayoutRoot(pm.payoutLeaves).toString('hex');

  // 4. committee VRF (确定性·excludePks 含 bettor)
  const poolMerkleRoot = market.pool_merkle_root;
  const endBlockHash = await ctx.endBlockHash(Number(market.deadline_daa));
  const members = await ctx.poolMembers(poolMerkleRoot);
  const bettorPks = [...new Set(bets.map(b => b.pk.toLowerCase()))];
  const excludePks = [String(market.maker_pk).toLowerCase(), String(market.broker_pk).toLowerCase(), ...bettorPks];
  const seed = deriveCommitteeSeed(marketId, endBlockHash, poolMerkleRoot);
  const sel = selectCommittee(members, seed, { excludePks });
  // ascending (committee_pk_hash = blake2b(c0..c4 ascending)·witness slot 序)
  const asc = [...sel.selected].map(c => c.pk_hex).sort();
  const committeePkHash = Buffer.from(blake2b(Buffer.concat(asc.map(p => Buffer.from(p, 'hex'))), { dkLen: 32 })).toString('hex');

  // 5. predicted closed-PS 地址 (driver enforce 的应锚地址·= 今晚 pzmm5hg7 predict)
  const psRow = db.prepare('SELECT pool_merkle_root, predicate_commit FROM payout_shards WHERE logical_market_id = ?').get(marketId);
  let expectedClosedAddr = null;
  if (psRow) {
    const consolidatedPool = (BigInt(poolSompi) + BigInt(ctx.psSeedSompi ?? 20000000)).toString();   // pool + PS_SEED
    const closedRedeem = compilePayoutShardRedeem({ poolMerkleRoot: psRow.pool_merkle_root, predicateCommit: psRow.predicate_commit, consolidatedPool, closed: 1, payoutRoot: payoutRootHex });
    expectedClosedAddr = ctx.p2shAddr ? ctx.p2shAddr(closedRedeem) : null;   // caller 提供 p2sh 派生 (kaspa-wasm)
  }

  return {
    ok: true, isBshard, betCount, winDir, payoutRoot: payoutRootHex,
    winners: pm.payoutLeaves.map(w => ({ pk: w.pk, amount: w.amount })),
    poolSompi, committee: asc, committeePkHash, expectedClosedAddr, ascSelected: asc,
    _dbg: { seed: seed.toString('hex'), endBlockHash, poolMerkleRoot, memberCount: members.length, excludePks, drawOrder: sel.selected.map(c => c.pk_hex.slice(0, 8)) },
  };
}

/**
 * winnerClaimData — 每 winner 的 depth-10 merkle proof (claim 用·climb 自核)。
 */
export function winnerClaimData(winners) {
  // winners = pm.payoutLeaves [{pk, amount}]·按 index 序
  const root = buildPayoutRoot(winners).toString('hex');
  return winners.map((w, idx) => {
    const leaf = payoutLeaf(w.pk, w.amount);
    const sibs = merkleProof(winners, idx);
    const climbed = climbProof(leaf, idx, sibs).toString('hex');
    return { pk: w.pk, amount: w.amount, merkle_index: idx, siblings_hex: sibs.map(s => s.toString('hex')), climbOk: climbed === root };
  });
}

export { COMMITTEE_DUMMY_SIG, QUORUM, ZERO32 };
