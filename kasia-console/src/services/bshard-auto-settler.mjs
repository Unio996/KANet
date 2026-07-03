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
  // 多片 rolling shard: getMarketBets 现 fold-gather 跨全片 union (Phase 1·2026-06-30)·bets 含全片注·
  //   poolSompi=Σ全片·payoutRoot 覆盖全片 winner。consolidate 侧 consolidateAllShards 已逐片折进单 PS (体积有界·
  //   迭代委员签证路·非 on-chain fold·不撞 9999 SIZE 墙·2026-06-20 pivot)。∴ 不再拒多片。multiShard 仍返作 info。
  if (betCount === 0) return { ok: false, reason: '真 0-bet → refund 路 (非 strand)', isBshard, betCount: 0, degenerate: true, multiShard };

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
  //   #15 fix (2026-06-30·多-winner threaded): 每笔 thread outpoint(closeTxid:0→claim_i:1)+consolidated_pool(-=payout)
  //   +w-bitmap(set merkle_index bit)·续约 input redeem 经 splicePayoutContinuation·每笔验 winner 实收 + my-splice==handler psContAddress 才 thread 下一笔。
  //   旧码复用 closeTxid:0 + closedState w=0 每 winner → 第2 winner 花已 spent 的 closeTxid:0 必失败 (单 winner 侥幸过)。
  const claimData = winnerClaimData(plan.winners);
  let psOutTxid = closeTxid, psOutIdx = 0;
  let curPool = BigInt(ps.consolidatedPool);
  let curState = { consolidated_pool: curPool.toString(), closed: 1, payoutRoot: plan.payoutRoot };
  for (let i = 0; i < 17; i++) curState['w' + i] = 0;
  let curRedeem = compilePayoutShardRedeem({ poolMerkleRoot: ps.poolMerkleRoot, predicateCommit: ps.predicateCommit, consolidatedPool: String(ps.consolidatedPool), closed: 1, payoutRoot: plan.payoutRoot });
  // #task33 (2026-07-03·NWT GREEN·docs/2026-07-03-bshard-claim-completeness-and-retry-design.md):
  //   丢单点①②(climb-fail/round-trip-fail, continue) = 数据/编码问题非时序问题, 独立标记 needsManualAttribution,
  //   不进 settled_partial_claims 重试队列(见 §4.2.1 🟡风险-1)。丢单点③④⑤(submit-fail/not-landed/splice-mismatch,
  //   break) = 可重试类, 走 settled_partial_claims。complete 谓词(§4.1 🟡风险-2): 全部 claims 条目
  //   received===true 且无 error 字段, 且 claims.length===claimData.length(无遗漏 attempt)。
  const claims = [];
  let needsManualAttribution = false;
  for (const cd of claimData) {
    if (!cd.climbOk) { ctx.alert?.(marketId, `claim climb fail winner ${cd.pk.slice(0, 8)}`); claims.push({ pk: cd.pk, amount: cd.amount, error: 'climb fail' }); needsManualAttribution = true; continue; }
    const winnerAddr = ctx.p2pkAddr(cd.pk);
    if (ctx.p2pkSpk && ctx.p2pkSpk(winnerAddr).toLowerCase() !== ('20' + cd.pk + 'ac').toLowerCase()) {
      ctx.alert?.(marketId, `winner P2PK round-trip fail ${cd.pk.slice(0, 8)}`); claims.push({ pk: cd.pk, amount: cd.amount, error: 'round-trip fail' }); needsManualAttribution = true; continue;   // 防 hex 双编码
    }
    const claimRes = await ctx.relayPost(ctx.feeRelay.id, {
      type: 'bshard_payout_claim',
      witness: { self_out_idx: 1, payout_out_idx: 0, bettor_pk: cd.pk, payout: cd.amount, merkle_index: cd.merkle_index, siblings_hex: cd.siblings_hex },
      inputs: { payoutshard: { redeem_hex: curRedeem, outpointTxid: psOutTxid, index: psOutIdx, state: curState }, fee: await ctx.feeUtxo() },
      outputs: { payout: { address: winnerAddr }, change_address: ctx.feeRelay.address },
    });
    const claimTx = claimRes?.txId;
    if (!claimTx) { ctx.alert?.(marketId, `claim submit fail ${cd.pk.slice(0, 8)}: ${claimRes?.error}`); claims.push({ pk: cd.pk, amount: cd.amount, error: claimRes?.error || 'no txId' }); break; }
    const received = await verifyClaimLanded(ctx, winnerAddr, claimTx);
    if (!received) {
      ctx.alert?.(marketId, `claim not landed ${cd.pk.slice(0, 8)} — STOP threading (NO-TX-NO-STATE)`);
      claims.push({ pk: cd.pk, amount: cd.amount, txId: claimTx, received: false, error: 'not landed' }); break;
    }
    // thread continuation: pool-=payout · w[merkle_index/63] set bit(merkle_index%63)
    const newState = { consolidated_pool: (curPool - BigInt(cd.amount)).toString(), closed: 1, payoutRoot: plan.payoutRoot };
    for (let i = 0; i < 17; i++) newState['w' + i] = curState['w' + i];
    const word = Math.floor(Number(cd.merkle_index) / 63), bit = Number(cd.merkle_index) % 63;
    newState['w' + word] = (BigInt(newState['w' + word]) + (1n << BigInt(bit))).toString();
    const contRedeem = splicePayoutContinuation(curRedeem, newState);
    if (ctx.p2shAddr && claimRes.psContAddress && ctx.p2shAddr(contRedeem) !== claimRes.psContAddress) {
      ctx.alert?.(marketId, `claim continuation splice mismatch ${cd.pk.slice(0, 8)} — STOP threading`);
      claims.push({ pk: cd.pk, amount: cd.amount, txId: claimTx, received, error: 'splice mismatch' }); break;
    }
    claims.push({ pk: cd.pk, amount: cd.amount, txId: claimTx, received });
    psOutTxid = claimTx; psOutIdx = 1; curPool = curPool - BigInt(cd.amount); curState = newState; curRedeem = contRedeem;
  }
  // completed 不变量(task33 §4.1): 每个 claimData 条目都有 attempt 记录 + 全部 received===true + 全部无 error。
  const complete = claims.length === claimData.length && claims.every(c => c.received === true && !c.error);
  if (!complete) ctx.alert?.(marketId, `claim 未完整: attempted=${claims.length}/${claimData.length}, received=${claims.filter(c => c.received === true && !c.error).length} — settled_partial_claims${needsManualAttribution ? ' + needs_manual_attribution' : ''}`);
  return { ok: true, closeTxid, claims, plan, complete, needsManualAttribution };
}

// NO TX NO STATE: 查 closed PS @ 应锚地址·来自 close tx·value==consolidatedPool
// #14 fix (2026-06-30): poll·非单发 (submit≠landed·单发 ~1s 未确认假阴·我单片 close 撞过)。
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function verifyClosedLanded(ctx, expectedAddr, closeTxid, consolidatedPool) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const entries = await ctx.getUtxos(expectedAddr);
      const ok = entries.some(e => {
        const j = JSON.parse(JSON.stringify(e, (k, v) => typeof v === 'bigint' ? v.toString() : v));
        const op = j.entry?.outpoint || j.outpoint;
        const amt = j.entry?.amount ?? j.amount;
        return op?.transactionId === closeTxid && String(amt) === String(consolidatedPool);
      });
      if (ok) return true;
    } catch { /* transient·retry */ }
    await _sleep(4000);
  }
  return false;
}

// #15 helper: claim 后 winner P2PK 实收链验 (NO TX NO STATE·thread 下一笔前确认)。
async function verifyClaimLanded(ctx, winnerAddr, claimTx) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const entries = await ctx.getUtxos(winnerAddr);
      if (entries.some(e => { const j = JSON.parse(JSON.stringify(e, (k, v) => typeof v === 'bigint' ? v.toString() : v)); return (j.entry?.outpoint || j.outpoint)?.transactionId === claimTx; })) return true;
    } catch { /* retry */ }
    await _sleep(4000);
  }
  return false;
}

// #15 multi-winner claim 续约 splice (复刻 relay p2sh.mjs _serializePayoutStateHex + _continuationAddress·_POOL_STATE_START=1)。
//   PayoutShard state 区在 redeem offset 1: PUSH8(i64 pool)+PUSH8(i64 closed)+PUSH32(payoutRoot)+17×PUSH8(i64 w0..16)。
function _i64LE(x) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(x)); return b; }
function _pushData(buf) { return Buffer.concat([Buffer.from([buf.length]), buf]); }
function _serializePayoutStateHex(s) {
  const parts = [_pushData(_i64LE(s.consolidated_pool)), _pushData(_i64LE(s.closed)), _pushData(Buffer.from(String(s.payoutRoot).replace(/^0x/, ''), 'hex'))];
  for (let i = 0; i < 17; i++) parts.push(_pushData(_i64LE(s['w' + i] ?? 0)));
  return Buffer.concat(parts);
}
function splicePayoutContinuation(inputRedeemHex, newState, stateStart = 1) {
  const redeem = Buffer.from(inputRedeemHex, 'hex');
  const sb = _serializePayoutStateHex(newState);
  return Buffer.concat([redeem.slice(0, stateStart), sb, redeem.slice(stateStart + sb.length)]).toString('hex');
}

export { COMMITTEE_DUMMY_SIG, QUORUM, ZERO32, splicePayoutContinuation };
