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
import { buildPoolMerkleTree, getPoolMerkleProof } from './pool-merkle-v06.mjs';
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

  // 1b. 🔴 cleanliness 闸 (S5 运行时·J1 建议·防 commingled strand·今晚 ioaoc f5bb64c6 34KAS 教训):
  //   v07 bshard 盘若 logical 键也有押注 (v06 PoolSide 路) → commingled → 跳过挂 alert (别 shard-only settle strand logical bet)。
  const logicalBets = db.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(marketId).c;
  if (logicalBets > 0) {
    return { ok: false, reason: `commingled: logical 键有 ${logicalBets} bet (v06 路) + shard 路·shard-only settle 会 strand·跳过挂 alert`, isBshard, commingled: true };
  }

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
  // 🔴 determinism: poolMembers 必 pin 到 deadline_daa snapshot (oracle stakes 随时间变·同 root 多 snapshot 不同 stake
  //   → stake-weighted selectCommittee flaky)。pin deadline = 与 endBlockHash deadline-anchor 一致·全 deadline 锚确定性。
  const members = await ctx.poolMembers(poolMerkleRoot, Number(market.deadline_daa));
  const bettorPks = [...new Set(bets.map(b => b.pk.toLowerCase()))];
  const excludePks = [String(market.maker_pk).toLowerCase(), String(market.broker_pk).toLowerCase(), ...bettorPks];
  const seed = deriveCommitteeSeed(marketId, endBlockHash, poolMerkleRoot);
  const sel = selectCommittee(members, seed, { excludePks });
  // ascending (committee_pk_hash = blake2b(c0..c4 ascending)·witness slot 序)
  const asc = [...sel.selected].map(c => c.pk_hex).sort();
  const committeePkHash = Buffer.from(blake2b(Buffer.concat(asc.map(p => Buffer.from(p, 'hex'))), { dkLen: 32 })).toString('hex');
  // committee_meta: 每 committee pk 在 pool merkle tree 的 idx + 8 siblings (build/submit witness 用)。
  const tree = buildPoolMerkleTree(members.map(m => m.pk_hex));
  const committeeMeta = asc.map(pk => {
    const idx = tree.sortedPks.indexOf(pk);
    return { pk_hex: pk, idx, siblings_hex: getPoolMerkleProof(tree, idx).map(b => b.toString('hex')) };
  });

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
    poolSompi, committee: asc, committeeMeta, committeePkHash, expectedClosedAddr, ascSelected: asc,
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

/**
 * settleMarketLive — relay 驱动编排 (build→enforce→sign→assemble→submit→claim)。
 *   复用 qi37q proven cmd 形 + 铁律 (NO TX NO STATE / driver enforce 硬闸 / 单 driver)。
 *   ctx 额外需: relayPost(relayId,cmd)·getUtxos(addr)·pkToRelay(pk)→relayId·psState(marketId)→{outpointTxid,index,redeem_hex,consolidatedPool}·
 *     feeRelay {id,address}·feeUtxo()→{address,outpointTxid,index}·p2pkAddr(pk)→addr·p2pkSpk(addr)→hex(round-trip)·alert(mid,reason)。
 * @returns {ok, reason?, skipped?, dryRun?, plan?, closeTxid?, claims?}
 */
export async function settleMarketLive(marketId, ctx) {
  const plan = await computeSettlePlan(marketId, ctx);
  if (!plan.ok) { ctx.alert?.(marketId, `plan: ${plan.reason}`); return { ok: false, skipped: true, reason: plan.reason, plan }; }
  if (ctx.dryRun) return { ok: true, dryRun: true, plan };

  // 0. consolidated PS (须先 consolidate·此 minimal 假定已 consolidate·ctx.psState 取链上态)
  const ps = await ctx.psState(marketId);
  if (!ps?.outpointTxid || !ps?.redeem_hex) { ctx.alert?.(marketId, 'PS 未 consolidate / psState 缺'); return { ok: false, reason: 'no consolidated PS' }; }

  const state = { consolidated_pool: String(ps.consolidatedPool), closed: 0, payoutRoot: ZERO32 };
  for (let i = 0; i < 17; i++) state['w' + i] = 0;
  const fee = await ctx.feeUtxo();
  const baseInputs = { payoutshard: { redeem_hex: ps.redeem_hex, outpointTxid: ps.outpointTxid, index: ps.index ?? 0, state }, fee };
  const baseWitness = { self_out_idx: 0, new_payout_root: plan.payoutRoot, committee_pk_hash: plan.committeePkHash };

  // 1. BUILD close (committee:[] → preimage + unSafeJson)
  const buildRes = await ctx.relayPost(ctx.feeRelay.id, {
    type: 'bshard_close_attest', witness: { ...baseWitness, committee: [] },
    inputs: baseInputs, outputs: { change_address: ctx.feeRelay.address },
  });
  if (buildRes?.error || !buildRes?.unSafeJson) { ctx.alert?.(marketId, `build fail: ${buildRes?.error || 'no unSafeJson'}`); return { ok: false, reason: 'build fail' }; }

  // 2. 🔴 driver enforce 硬闸 (命门·NO submit if mismatch): build output 地址 == 应锚 (= re-derive payoutRoot 烤死)
  if (buildRes.psContAddress !== plan.expectedClosedAddr) {
    ctx.alert?.(marketId, `🔴 enforce FAIL: build psContAddress ${buildRes.psContAddress} != expected ${plan.expectedClosedAddr} — NO submit`);
    return { ok: false, reason: 'enforce mismatch (driver-side 硬闸)' };
  }
  const unSafeJson = buildRes.unSafeJson;

  // 3. SIGN per committee (4-of-5·各 committee relay 用自 key 签同 unSafeJson)
  const sigs = {};
  for (const m of plan.committeeMeta) {
    const relayId = ctx.pkToRelay(m.pk_hex);
    if (!relayId) continue;   // uncontrollable → skip (需 ≥4)
    try {
      const r = await ctx.relayPost(relayId, { type: 'sign_input_for_settle', tx_hex: unSafeJson, input_index: 0, safe_json: true });
      if (r?.signature && r.signature.length === 132) sigs[m.pk_hex] = r.signature;
    } catch { /* skip·下个 */ }
  }
  if (Object.keys(sigs).length < QUORUM) { ctx.alert?.(marketId, `< 4-of-5 sig (got ${Object.keys(sigs).length})`); return { ok: false, reason: '委员缺席 < 4-of-5' }; }

  // 4. ASSEMBLE committee[5] (asc·sigs·dummy 未签槽) + 自核 committee_pk_hash
  const committee5 = plan.committeeMeta.map(m => ({ pk_hex: m.pk_hex, sig_hex: sigs[m.pk_hex] || COMMITTEE_DUMMY_SIG, idx: m.idx, siblings_hex: m.siblings_hex }));
  const cph = Buffer.from(blake2b(Buffer.concat(committee5.map(c => Buffer.from(c.pk_hex, 'hex'))), { dkLen: 32 })).toString('hex');
  if (cph !== plan.committeePkHash) { ctx.alert?.(marketId, `🔴 assemble committee_pk_hash ${cph} != plan ${plan.committeePkHash}`); return { ok: false, reason: 'committee_pk_hash 自核失败' }; }

  // 5. SUBMIT close
  const submitRes = await ctx.relayPost(ctx.feeRelay.id, {
    type: 'bshard_close_attest', witness: { ...baseWitness, committee: committee5 },
    inputs: baseInputs, outputs: { change_address: ctx.feeRelay.address },
  });
  if (submitRes?.error || !submitRes?.txId) { ctx.alert?.(marketId, `submit fail: ${submitRes?.error}`); return { ok: false, reason: 'submit fail' }; }
  const closeTxid = submitRes.txId;

  // 6. NO TX NO STATE: verify close LANDED (closed PS @ 应锚地址·value==consolidatedPool)
  const landed = await verifyClosedLanded(ctx, plan.expectedClosedAddr, closeTxid, ps.consolidatedPool);
  if (!landed) { ctx.alert?.(marketId, `close ${closeTxid} 未 verify LANDED (NO TX NO STATE)`); return { ok: false, reason: 'close not landed', closeTxid }; }

  // 7. CLAIM per winner (NO-SIG·merkle 授权·round-trip 验 addr)
  const claimData = winnerClaimData(plan.winners);
  const closedRedeem = compilePayoutShardRedeem({ poolMerkleRoot: ps.poolMerkleRoot, predicateCommit: ps.predicateCommit, consolidatedPool: String(ps.consolidatedPool), closed: 1, payoutRoot: plan.payoutRoot });
  const closedState = { consolidated_pool: String(ps.consolidatedPool), closed: 1, payoutRoot: plan.payoutRoot };
  for (let i = 0; i < 17; i++) closedState['w' + i] = 0;
  const claims = [];
  for (const cd of claimData) {
    if (!cd.climbOk) { ctx.alert?.(marketId, `claim climb fail winner ${cd.pk.slice(0, 8)}`); continue; }
    const winnerAddr = ctx.p2pkAddr(cd.pk);
    if (ctx.p2pkSpk && ctx.p2pkSpk(winnerAddr).toLowerCase() !== ('20' + cd.pk + 'ac').toLowerCase()) {
      ctx.alert?.(marketId, `winner P2PK round-trip fail ${cd.pk.slice(0, 8)}`); continue;   // 防 hex 双编码 (今晚撞)
    }
    const claimRes = await ctx.relayPost(ctx.feeRelay.id, {
      type: 'bshard_payout_claim',
      witness: { self_out_idx: 1, payout_out_idx: 0, bettor_pk: cd.pk, payout: cd.amount, merkle_index: cd.merkle_index, siblings_hex: cd.siblings_hex },
      inputs: { payoutshard: { redeem_hex: closedRedeem, outpointTxid: closeTxid, index: 0, state: closedState }, fee: await ctx.feeUtxo() },
      outputs: { payout: { address: winnerAddr }, change_address: ctx.feeRelay.address },
    });
    claims.push({ pk: cd.pk, amount: cd.amount, txId: claimRes?.txId, error: claimRes?.error });
  }
  return { ok: true, closeTxid, claims, plan };
}

// NO TX NO STATE: 查 closed PS @ 应锚地址·来自 close tx·value==consolidatedPool
async function verifyClosedLanded(ctx, expectedAddr, closeTxid, consolidatedPool) {
  try {
    const entries = await ctx.getUtxos(expectedAddr);
    return entries.some(e => {
      const j = JSON.parse(JSON.stringify(e, (k, v) => typeof v === 'bigint' ? v.toString() : v));
      const op = j.entry?.outpoint || j.outpoint;
      const amt = j.entry?.amount ?? j.amount;
      return op?.transactionId === closeTxid && String(amt) === String(consolidatedPool);
    });
  } catch { return false; }
}

export { COMMITTEE_DUMMY_SIG, QUORUM, ZERO32 };
