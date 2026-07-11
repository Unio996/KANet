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
import { _shard9PhantomExcludeFor } from './bshard-close-voter.js';
import { computePariMutuelPayout } from '../lib/pool-shard-settle.mjs';
import { deriveRoleFeeLeaves } from '../lib/fee-split.mjs';
import { payoutRoot as buildPayoutRoot, payoutLeaf, merkleProof, climbProof } from '../lib/pool-payout-root.mjs';
import { deriveCommitteeSeed, selectCommittee } from './pool-committee-sampler.mjs';
import { compilePayoutShardRedeem, REORG_SAFE_MIN_DEPTH } from '../lib/pool-shard-register.mjs';
import { buildPoolMerkleTree, getPoolMerkleProof } from './pool-merkle-v06.mjs';
import { blake2b } from '@noble/hashes/blake2b';
import { sqlite } from '../db/client.js';

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
  // excludeSideLockTx(2026-07-11, Bettor #g3x7lm.2 抓漏): committee侧(bshard-close-voter.js loadBettors/
  // excludeSideLockTx)早接了这份排除表, driver侧(这里)漏接过——不接会算出320笔而非309笔, propose builder
  // 跟committee各算各的payoutRoot, 必分叉BUST。单一真相源(_shard9PhantomExcludeFor), 不在这里复制表。
  const { bets, betCount, poolSompi, isBshard, multiShard } = getMarketBets(marketId, db, _shard9PhantomExcludeFor(marketId));
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

  // 2b. 🔴 degenerate 前置直判(B线落2 NWT P2, 2026-07-12): 从 bets+winDir 直判, 必须发生在 selectCommittee
  //   之前——步骤对调(fee 叶需要 committeePks)后, 单边盘若 members 除 exclude 后不够 COMMITTEE_SIZE,
  //   selectCommittee 会先 throw, 本该 refund 的盘变 stuck-throw。直判不需要 pm 不需要委员。
  if (!bets.some(b => Number(b.direction) === winDir)) {
    return { ok: false, reason: 'degenerate (无 winning side) → refund 判定·别误退/strand', isBshard, degenerate: true };
  }

  // 3(原4). committee VRF (确定性·excludePks 含 bettor)——B线落2 与 payout 对调: fee 叶派生需要 committeePks。
  //   对调安全前提(NWT 注4a CONFIRMED): seed/members/excludePks 无一输入依赖 payout 输出。
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

  // 4(原3). payoutRoot (driver re-derive·命门)——B线落2: fee_rules 市场从 committed 规则派生 fee 叶
  //   (组件单源 deriveRoleFeeLeaves, 委员集=刚选出的 asc; interim 规则委员叶 bps=0 天然零叶)。
  //   fee_rules NULL(全部存量+zk 市场) → feeLeaves=[] → computePariMutuelPayout 行为与改前字节不动。
  //   pool 基数=V1 口径 Σ注(poolSompi, 与委员 enforce 同源同基数; V2 的 consolidatedPool 含 seed 口径不适用)。
  let feeLeaves = [];
  if (market.fee_rules) {
    ({ feeLeaves } = deriveRoleFeeLeaves(JSON.parse(market.fee_rules), poolSompi, { committeePks: asc }));
  }
  const pm = computePariMutuelPayout({ bettors: bets.map(b => ({ pk: b.pk, stake: b.stake, direction: b.direction })), winningDirection: winDir, feeLeaves });
  if (pm.degenerate) return { ok: false, reason: 'degenerate (无 winning side) → refund 判定·别误退/strand', isBshard, degenerate: true };
  const payoutRootHex = buildPayoutRoot(pm.payoutLeaves).toString('hex');

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
 * deriveResumePlanFromEvidence — resume-fix (2026-07-11, docs/2026-07-11-backlog-markets-resume-fix-
 *   and-cleanup-design.md §1，NWT红队GREEN·Bettor方向审GREEN #gj8kzn 系同批·#gjorob.2)。
 *
 *   桶 A(29 个市场，settled_partial_claims)根因: 无论市场是否已经 attest 过，_settleOneMarketAttempt
 *   和 settleMarketLive 都无条件调用 computeSettlePlan——内部 ctx.endBlockHash(deadline_daa) 无条件走
 *   getBlockAtDaa backward walk，老市场撞 MAX_WALK。但已 attest 的市场根本不需要重新 judge/选委员
 *   (settleMarketLive 自己的 resume 分支只用 plan.winners/payoutRoot/poolSompi，从不碰
 *   committeeMeta/expectedClosedAddr/committeePkHash —— 那些字段只有 fresh-close 分支用得到)。
 *
 *   本函数从 metadata.settle_evidence(已经链上 attest 落链时写入的记录)直接派生一份轻量 plan，
 *   零 judgeWinDir/committee VRF/getBlockAtDaa。**纵深防御(Bettor n1, #gjorob.2)**: 即使这份 DB
 *   evidence 被污染，claim tx 广播时仍必须过链上已 closed 的 PayoutShardV2 covenant 自己的
 *   payout_root merkle 验证(.sil require 条件)——链是终审，DB 只是"这次该算哪笔"的路由信息，不是
 *   授权信息。本函数的一致性比对(下方)是提前拦截的优化，不是唯一防线。
 *
 * @param {string} marketId
 * @param {object} ctx  同 computeSettlePlan 的 ctx 契约(只用到 ctx.db)
 * @returns {{ok:boolean, reason?:string, betCount?, poolSompi?, winDir?, payoutRoot?, winners?}}
 */
export function deriveResumePlanFromEvidence(marketId, ctx) {
  const { db } = ctx;
  const market = db.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
  if (!market) return { ok: false, reason: 'market 不存在' };
  let meta; try { meta = JSON.parse(market.metadata || '{}'); } catch { meta = {}; }
  const evidence = meta.settle_evidence;
  if (!evidence?.close_txid) return { ok: false, reason: 'no settle_evidence.close_txid — 非 resume 场景' };
  if (evidence.win_direction !== 0 && evidence.win_direction !== 1) {
    return { ok: false, reason: `settle_evidence.win_direction 无效(${evidence.win_direction}) — 拒绝 resume` };
  }

  // 独立重算(不透传 evidence 里的 winners/poolSompi 数字本身)——同源 getMarketBets/computePariMutuelPayout,
  // 跟 computeSettlePlan 完全一样的算法, 只是 winDir 用已经 attest 过的值(不重新 judge)。
  const { bets, betCount, poolSompi, isBshard } = getMarketBets(marketId, db, _shard9PhantomExcludeFor(marketId));
  if (!isBshard || betCount === 0) return { ok: false, reason: `resume 场景下 bets 异常(isBshard=${isBshard}, betCount=${betCount}) — 拒绝, 回退 computeSettlePlan 走原路径` };

  // B线落2: fee_rules 市场 resume 重算同样带 fee 叶(否则重算 root 必不吻合→永远 fail-closed 回退=fee 市场
  //   resume 结构性失效, 同桶A win_direction 缺失族)。committeePks 传 []——interim 规则委员叶 bps=0 不受影响;
  //   将来若有委员 bps>0 的规则, [] 会导致 root 不吻合→fail-closed 回退 computeSettlePlan(安全非静默错)。
  let resumeFeeLeaves = [];
  if (market.fee_rules) {
    try { ({ feeLeaves: resumeFeeLeaves } = deriveRoleFeeLeaves(JSON.parse(market.fee_rules), poolSompi, { committeePks: [] })); }
    catch (e) { return { ok: false, reason: `fee_rules 解析/派生失败(${e.message}) — 拒绝 resume, 回退 computeSettlePlan fail-loud` }; }
  }
  const pm = computePariMutuelPayout({ bettors: bets.map(b => ({ pk: b.pk, stake: b.stake, direction: b.direction })), winningDirection: evidence.win_direction, feeLeaves: resumeFeeLeaves });
  if (pm.degenerate) return { ok: false, reason: 'resume 场景下重算 degenerate — 与已落链的 close 状态矛盾, 拒绝' };
  const recomputedRootHex = buildPayoutRoot(pm.payoutLeaves).toString('hex');
  if (evidence.payout_root && recomputedRootHex !== evidence.payout_root) {
    return { ok: false, reason: `独立重算 payoutRoot(${recomputedRootHex}) != settle_evidence.payout_root(${evidence.payout_root}) — fail-closed 拒绝 resume, 回退 computeSettlePlan` };
  }

  return {
    ok: true, isBshard, betCount, poolSompi, winDir: evidence.win_direction,
    payoutRoot: recomputedRootHex, winners: pm.payoutLeaves.map(w => ({ pk: w.pk, amount: w.amount })),
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
  // resume-fix (2026-07-11, docs/2026-07-11-backlog-markets-resume-fix-and-cleanup-design.md §1,
  // NWT红队GREEN·Bettor方向审GREEN #gjorob.2): priorEvidence 提前到 plan 计算之前读一次(下面第217行
  // resume 分支本来就要读, 不重复查询)——若市场已经 attest 过(close_txid 存在), 优先用
  // deriveResumePlanFromEvidence(零 judgeWinDir/committee VRF/getBlockAtDaa)代替 computeSettlePlan,
  // 避免老市场 resume 时无谓撞 MAX_WALK。deriveResumePlanFromEvidence 内部 fail-closed(重算不一致就
  // {ok:false})时仍回退 computeSettlePlan——宁可撞一次 MAX_WALK 走到人工可见的失败, 也不用一个自己
  // 都不信任的 resume plan 继续往下 claim。
  const priorRow0 = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
  let priorMeta0 = {}; try { priorMeta0 = JSON.parse(priorRow0?.metadata || '{}'); } catch {}
  let plan = priorMeta0.settle_evidence?.close_txid ? deriveResumePlanFromEvidence(marketId, ctx) : { ok: false };
  if (!plan.ok) plan = await computeSettlePlan(marketId, ctx);
  if (!plan.ok) { ctx.alert?.(marketId, `plan: ${plan.reason}`); return { ok: false, skipped: true, reason: plan.reason, plan }; }
  if (ctx.dryRun) return { ok: true, dryRun: true, plan };

  // #task33-followup (2026-07-05, 世界杯首场 7rztt 卡死案例·NWT/Bettor co-verify 抓出):
  // RESUME-AWARE close: 之前每次调用 settleMarketLive 都无条件重跑 步骤0-6(build/sign/submit/verify
  // close_attest)——但 close_attest 是一次性 write-once 闩(closed 0→1), 第一次成功之后 ps.outpointTxid
  // (consolidate 输出) 已经被那笔 close_attest TX 花掉, 再用它当 input 必然 "UTXO not found"(重复花已花
  // UTXO)。之前只在"部分 claim 失败"时暴露(settled_partial_claims 后任何重跑都会撞这个), 大盘(171 winner,
  // 单笔 claim 走不完一次 tick)首次真实撞见。
  // 修法: 若 metadata.settle_evidence.close_txid 已存在(=上次已经成功 close_attest 落链), 直接复用它,
  // 跳过 0-6, 进 claim 循环(而非重新 build/submit close)。
  let closeTxid, priorWinnerDetails = [];
  const priorEvidence = priorMeta0.settle_evidence;
  if (priorEvidence?.close_txid) {
    closeTxid = priorEvidence.close_txid;
    priorWinnerDetails = Array.isArray(priorEvidence.winner_details) ? priorEvidence.winner_details : [];
  } else {
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
    // #G5-5a: reason 必须带上游真实错误签名(非只'build fail'泛化字符串)——daemon 层瞬态重试白名单
    // 靠这个字符串区分'UTXO not found'(瞬态·值得重试) vs 其它 build 失败(非瞬态·不重试)。
    if (buildRes?.error || !buildRes?.unSafeJson) { const detail = buildRes?.error || 'no unSafeJson'; ctx.alert?.(marketId, `build fail: ${detail}`); return { ok: false, reason: `build fail: ${detail}` }; }

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
    if (submitRes?.error || !submitRes?.txId) { const detail = submitRes?.error || 'no txId'; ctx.alert?.(marketId, `submit fail: ${detail}`); return { ok: false, reason: `submit fail: ${detail}` }; }
    closeTxid = submitRes.txId;

    // 6. NO TX NO STATE: verify close LANDED (closed PS @ 应锚地址·value==consolidatedPool)
    const landed = await verifyClosedLanded(ctx, plan.expectedClosedAddr, closeTxid, ps.consolidatedPool);
    if (!landed) { ctx.alert?.(marketId, `close ${closeTxid} 未 verify LANDED (NO TX NO STATE)`); return { ok: false, reason: 'close not landed', closeTxid }; }
  }

  // 7. CLAIM per winner (NO-SIG·merkle 授权·round-trip 验 addr)
  //   #15 fix (2026-06-30·多-winner threaded): 每笔 thread outpoint(closeTxid:0→claim_i:1)+consolidated_pool(-=payout)
  //   +w-bitmap(set merkle_index bit)·续约 input redeem 经 splicePayoutContinuation·每笔验 winner 实收 + my-splice==handler psContAddress 才 thread 下一笔。
  //   旧码复用 closeTxid:0 + closedState w=0 每 winner → 第2 winner 花已 spent 的 closeTxid:0 必失败 (单 winner 侥幸过)。
  const claimData = winnerClaimData(plan.winners);
  // psRow(poolMerkleRoot/predicateCommit) + consolidatedPool 独立于 ps(fresh-close 分支专属变量)重算——
  // resume 分支没有 ps, 且这两条本身就是 market 级不变量(跟是不是第一次 close 无关), 统一取一次更简单可靠。
  const psRow = ctx.db.prepare('SELECT pool_merkle_root, predicate_commit FROM payout_shards WHERE logical_market_id = ?').get(marketId);
  const consolidatedPool = (BigInt(plan.poolSompi) + BigInt(ctx.psSeedSompi ?? 20000000)).toString();
  let psOutTxid = closeTxid, psOutIdx = 0;
  let curPool = BigInt(consolidatedPool);
  let curState = { consolidated_pool: curPool.toString(), closed: 1, payoutRoot: plan.payoutRoot };
  for (let i = 0; i < 17; i++) curState['w' + i] = 0;
  let curRedeem = compilePayoutShardRedeem({ poolMerkleRoot: psRow.pool_merkle_root, predicateCommit: psRow.predicate_commit, consolidatedPool, closed: 1, payoutRoot: plan.payoutRoot });
  // #task33 (2026-07-03·NWT GREEN·docs/2026-07-03-bshard-claim-completeness-and-retry-design.md):
  //   丢单点①②(climb-fail/round-trip-fail, continue) = 数据/编码问题非时序问题, 独立标记 needsManualAttribution,
  //   不进 settled_partial_claims 重试队列(见 §4.2.1 🟡风险-1)。丢单点③④⑤(submit-fail/not-landed/splice-mismatch,
  //   break) = 可重试类, 走 settled_partial_claims。complete 谓词(§4.1 🟡风险-2): 全部 claims 条目
  //   received===true 且无 error 字段, 且 claims.length===claimData.length(无遗漏 attempt)。
  const claims = [];
  let needsManualAttribution = false;

  // #task33-followup (2026-07-05, 7rztt resume 修复的另一半): 之前已经成功落链的 claim(priorWinnerDetails,
  // 来自上一次跑到一半的 settle_evidence)必须原样保留在 claims 数组最前面 + 跳过重复 claim(claimData 里对应
  // 的条目)+ 把 psOutTxid/psOutIdx/curPool/curState/curRedeem thread 到"上次跑到哪"的续接点——否则每次
  // 重跑都会拿 claimData[0] 去 claim, 而 claimData[0] 若已经在上次跑成功过, 对应的 outpoint(closeTxid:0)
  // 早被那笔 claim TX 花掉, "UTXO not found" 复现(7rztt 撞的就是这个)。
  // 🔴 按【位置】匹配(claimData[i] ↔ priorWinnerDetails[i]), 不能按 pk 匹配——同一 pk 可能有多笔独立中奖
  // 下注(同一人押多次), pk 匹配用 Set/find 会把"这个 pk 已完成"误判成全部同 pk 条目都完成, 且 Array.find
  // 永远命中第一条 → 状态 thread 卡在第 1 笔的 txId 不动(7rztt 实测撞到: resume 后 psOutTxid 停在 claim#1
  // 而非 claim#4, 第 5 笔仍报 UTXO not found)。claimData 由 winnerClaimData(plan.winners) 确定性生成(同一
  // plan 内顺序稳定), 位置匹配是唯一正确对应关系; 加 pk+amount 双重校验, 任一不符立即拒绝 resume(fail-safe,
  // 宁可整体重跑失败也不能用错的 continuation 状态误 claim)。
  if (priorWinnerDetails.length) {
    if (priorWinnerDetails.length > claimData.length) {
      ctx.alert?.(marketId, `🔴 resume 校验失败: priorWinnerDetails(${priorWinnerDetails.length}) > claimData(${claimData.length}), plan 跟上次不一致 — 拒绝 resume`);
      return { ok: false, reason: 'resume mismatch: prior winner count exceeds current plan winner count' };
    }
    for (let i = 0; i < priorWinnerDetails.length; i++) {
      const w = priorWinnerDetails[i], cd = claimData[i];
      if (String(w.pk).toLowerCase() !== String(cd.pk).toLowerCase() || String(w.amount) !== String(cd.amount)) {
        ctx.alert?.(marketId, `🔴 resume 校验失败: claimData[${i}] pk/amount 跟 priorWinnerDetails[${i}] 不一致 — 拒绝 resume(plan 可能变了)`);
        return { ok: false, reason: `resume mismatch at index ${i}: plan winners changed since last partial run` };
      }
      claims.push({ pk: w.pk, amount: w.amount, txId: w.txId, received: true });
      // replay 状态转移(纯本地计算, 不碰链): 每个已完成 winner 都让 curPool/curState 往前走一步, 最后一步的
      // txId 变成新的 psOutTxid(index=1, 对应 claim TX 的 continuation output 位)。
      const newState = { consolidated_pool: (curPool - BigInt(cd.amount)).toString(), closed: 1, payoutRoot: plan.payoutRoot };
      for (let k = 0; k < 17; k++) newState['w' + k] = curState['w' + k];
      const word = Math.floor(Number(cd.merkle_index) / 63), bit = Number(cd.merkle_index) % 63;
      newState['w' + word] = (BigInt(newState['w' + word]) + (1n << BigInt(bit))).toString();
      curRedeem = splicePayoutContinuation(curRedeem, newState);
      psOutTxid = w.txId; psOutIdx = 1; curPool = curPool - BigInt(cd.amount); curState = newState;
    }
    ctx.alert?.(marketId, `resume: 跳过已完成 ${priorWinnerDetails.length} 个 claim, 从 ${psOutTxid.slice(0, 12)}:${psOutIdx} 续接剩余 ${claimData.length - priorWinnerDetails.length} 个`);

    // #DB-lag自愈(2026-07-06, lv3rz claim#22 起步·dyljb claim186+187 连续两笔假阴性收编升级, v2 修正):
    // 续接点(psOutTxid:psOutIdx)有可能已经过期——某笔 claim 的 verifyClaimLanded() 假阴性超时返回 false(TX
    // 其实几分钟后真的 confirm 了), 于是 settle_evidence.winner_details 没记上, 但链上真实已经推进了。
    // 🔴 v1 bug(dyljb 实测抓到): 用 getUtxos(nextAddr).length>0 判断"这步是否发生过"——但如果紧接着下一步
    // (claim187)也已经发生, nextAddr 的 UTXO 早被claim187 花掉, getUtxos 查到 0, v1 就误判"这步没发生"提前
    // 停手(实际两步都发生了, 只是当前 UTXO 集只反映最新tip, 反映不出"中间站是否存在过")。
    // 修法: 判断"这一步是否发生过"改查本地 kaspa_tx_log 的 to_address(有没有历史上任何 TX 给这个地址转过
    // 账, 不管现在是不是已经被后续 TX 花掉)——这是持久历史记录, 不会因为后续花费而消失。找到历史记录就
    // 纳入 replay 继续往下探, 找不到才停手(genuinely 没发生 或 本地索引没追上, 两种情况都 fail-closed 交
    // 给下面的正常 claim 循环, 不会瞎猜更远的状态)。
    const MAX_PROBE_STEPS = 10;
    if (ctx.getUtxos && ctx.p2shAddr && ctx.db && priorWinnerDetails.length < claimData.length) {
      try {
        for (let step = 0; step < MAX_PROBE_STEPS && priorWinnerDetails.length < claimData.length; step++) {
          const curAddr = ctx.p2shAddr(curRedeem);
          const curLive = (await ctx.getUtxos(curAddr)).length > 0;
          if (curLive) break;   // 找到真正当前 tip, 停止探测
          const nextCd = claimData[priorWinnerDetails.length];
          const nextState = { consolidated_pool: (curPool - BigInt(nextCd.amount)).toString(), closed: 1, payoutRoot: plan.payoutRoot };
          for (let k = 0; k < 17; k++) nextState['w' + k] = curState['w' + k];
          const word = Math.floor(Number(nextCd.merkle_index) / 63), bit = Number(nextCd.merkle_index) % 63;
          nextState['w' + word] = (BigInt(nextState['w' + word]) + (1n << BigInt(bit))).toString();
          const nextRedeem = splicePayoutContinuation(curRedeem, nextState);
          const nextAddr = ctx.p2shAddr(nextRedeem);
          // 历史记录查(不受"后续是否已花掉"影响) — kaspa_tx_log.to_address 只记第一个/主输出地址(通常是
          // 赢家收款地址, 非续约地址), 续约地址(output index 1)只出现在 outputs_json 里——必须搜 outputs_json
          // 而非 to_address(v2 首版漏了这个, dyljb 实测撞到: to_address 永远搜不到续约地址导致继续误判).
          const histRow = ctx.db.prepare(`SELECT tx_id FROM kaspa_tx_log WHERE outputs_json LIKE ? ORDER BY block_time ASC LIMIT 1`).get(`%${nextAddr}%`);
          let foundTxId = histRow?.tx_id;
          if (!foundTxId) {
            const nextEntries = (await ctx.getUtxos(nextAddr)).map(e => { const j = JSON.parse(JSON.stringify(e, (k, v) => typeof v === 'bigint' ? v.toString() : v)); return j.entry?.outpoint || j.outpoint; });
            foundTxId = nextEntries[0]?.transactionId;
          }
          if (!foundTxId) break;   // 历史索引 + 当前 UTXO 都查不到, 停止探测(genuinely 没发生 或本地索引没追上)
          ctx.alert?.(marketId, `DB-lag自愈: claim[${priorWinnerDetails.length}](${nextCd.pk.slice(0, 8)}) 续接点探测到已落链(${foundTxId.slice(0, 12)}) 但 DB 没记录 — 自动纳入 replay(第${step + 1}步)`);
          claims.push({ pk: nextCd.pk, amount: nextCd.amount, txId: foundTxId, received: true });
          priorWinnerDetails = [...priorWinnerDetails, { pk: nextCd.pk, amount: nextCd.amount, txId: foundTxId }];
          curRedeem = nextRedeem; psOutTxid = foundTxId; psOutIdx = 1; curPool = curPool - BigInt(nextCd.amount); curState = nextState;
        }
      } catch (e) { ctx.alert?.(marketId, `DB-lag自愈探测失败(非致命, 走原逻辑): ${e.message}`); }
    }
  }

  for (let idx = 0; idx < claimData.length; idx++) {
    const cd = claimData[idx];
    if (idx < priorWinnerDetails.length) continue;   // 已在上面按位置 replay 过, 跳过重复 claim
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
// #33 fix (2026-07-05, J2 设计+NWT review): 之前只查"当下有没有这个 UTXO"(浅确认), 跟 2026-06-30
// phantom-leaf 事故同源——TN12 高 reorg 率下, 浅确认判定"落地"的 TX 之后仍可能被踢出主链, 下一笔
// claim 依赖的 continuation outpoint 因此变成幽灵引用(昨晚 7rztt/i044k 案例)。复用 register_append
// land-gate 同款的 checkUtxoLanded(minDepth) 深度确认(kasia-relay/src/lib/p2sh.mjs, 已通过
// check_utxo_landed 命令暴露, REORG_SAFE_MIN_DEPTH=20 是当时 TN12 实测校准值, 不是新拍的数字)。
// fail-closed: depth 不足/查不到都不算 landed, 不提前放行。
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function verifyClosedLanded(ctx, expectedAddr, closeTxid, consolidatedPool) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const r = await ctx.relayPost(ctx.feeRelay.id, { type: 'check_utxo_landed', address: expectedAddr, txid: closeTxid, minDepth: REORG_SAFE_MIN_DEPTH });
      if (r?.landed) {
        // 深度确认通过后仍要验金额(合约不变量 out==consolidatedPool)——depth 只保证"这笔 TX 够深不会被 reorg 退",
        // 不代表金额对; 两个校验都过才真正判定 landed。
        const entries = await ctx.getUtxos(expectedAddr);
        const ok = entries.some(e => {
          const j = JSON.parse(JSON.stringify(e, (k, v) => typeof v === 'bigint' ? v.toString() : v));
          const op = j.entry?.outpoint || j.outpoint;
          const amt = j.entry?.amount ?? j.amount;
          return op?.transactionId === closeTxid && String(amt) === String(consolidatedPool);
        });
        if (ok) return true;
      }
    } catch (e) {
      // #33 followup (2026-07-05, NWT co-verify 抓到): 之前这里静默吞掉所有异常, 不区分"真的没落地"
      // (预期的瞬态情况, 会一直重试到 depth 够) vs "relayPost 本身抛出代码 bug"(比如签名变了/字段解构
      // 错误)——后者会白白烧完 20×3s=60s 全部重试预算才返回 false, 且外层拿不到任何线索。这里只加日志
      // (不改变控制流/不改变返回值), 留诊断痕迹, 出问题时能快速判断是链上真没落地还是代码本身坏了。
      console.warn(`[verifyClosedLanded] attempt ${attempt + 1}/20 threw (非落地判定失败, 诊断用): ${e?.message || e}`);
    }
    await _sleep(3000);
  }
  return false;
}

// #15 helper: claim 后 winner P2PK 实收链验 (NO TX NO STATE·thread 下一笔前确认)。
// #33 fix (2026-07-05): 同 verifyClosedLanded, 换深度确认(见上方注释), 不再是"当下存不存在"的浅确认。
async function verifyClaimLanded(ctx, winnerAddr, claimTx) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const r = await ctx.relayPost(ctx.feeRelay.id, { type: 'check_utxo_landed', address: winnerAddr, txid: claimTx, minDepth: REORG_SAFE_MIN_DEPTH });
      if (r?.landed) return true;
    } catch (e) {
      // 同 verifyClosedLanded 上方注释: 只加诊断日志, 不改变控制流/返回值。
      console.warn(`[verifyClaimLanded] attempt ${attempt + 1}/20 threw (非落地判定失败, 诊断用): ${e?.message || e}`);
    }
    await _sleep(3000);
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

// ═══════════════════════════════════════════════════════════════════════════════════
// ABSTAIN 退款路 (J2, 2026-07-04, Bettor 拍板"补漏·接通已有 covenant 能力"·非新造机制)。
//
// 背景: PayoutShard.sil 的 cancel_attest/refund_claim entry 早就存在(镜像 close_attest/claim,
//   committee 4-of-5 背书 refundRoot, closed 0→2 write-once, 之后 bettor 各自 refund_claim 拿回原始
//   stake) — relay 层 unlockBshardCancelAttest/unlockBshardRefundClaim(p2sh.mjs) 也早就实现好了,
//   只是 driver(bshard-settle-daemon.mjs) 从没调用过, ABSTAIN 目前只 re-judge 不退款。这里补上 driver
//   编排层(计算 + build/sign/submit + claim 循环), 结构完全镜像 computeSettlePlan/settleMarketLive,
//   唯一本质区别: 退款不需要 judgeWinDir(谁赢), 每个 bettor 拿回自己那笔的原始 stake, leaf 公式跟
//   payoutLeaf 相同(blake2b(pk‖ser(amount,8))), 因为 PayoutShard.sil 的 refund_claim 用同一个哈希式
//   (line 343: blake2b(bettorPk‖ser(refund,8))) —— 复用 pool-payout-root.mjs 的 payoutRoot/merkleProof/
//   climbProof 零改动, 只是喂 {pk, amount: stake} 而非 {pk, amount: payout}。
//
// ⚠ 触发条件是命门(Bettor 2026-07-04 强调): closed 是一次性 XOR 闩(0→1 或 0→2, 互斥, 不可逆)。一旦
//   cancel_attest 锁 closed=2, 这个市场永远不能再 close_attest 正常结算——哪怕之后 UMA/ESPN 出了真实
//   结果也晚了。所以调用 cancelMarketLive 前, caller(daemon)必须已确认"真·永久无解"(比如连续 N 次
//   judge 都 ABSTAIN 且已过 deadline+宽限期), 绝不能因为一次 ABSTAIN 就退款——这里只提供计算+执行原语,
//   何时调用的判断留给 daemon 层(未来若要接自动触发, 需要额外的 abstain 计数/宽限期逻辑, 本次先只给
//   人工/operator 可手动调用的安全原语, 触发时机判断本身可能需要更多讨论, 不在这次范围内)。

/**
 * computeRefundPlan — 纯计算 (镜像 computeSettlePlan, 无 judgeWinDir, 每个 bettor 拿回自己的 stake)。
 * @returns {ok, reason?, isBshard, betCount, refundRoot, refunds, committee, committeeMeta,
 *           committeePkHash, expectedCancelledAddr}
 */
export async function computeRefundPlan(marketId, ctx) {
  const { db } = ctx;
  const market = db.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
  if (!market) return { ok: false, reason: 'market 不存在' };

  const { bets, betCount, poolSompi, isBshard } = getMarketBets(marketId, db, _shard9PhantomExcludeFor(marketId));
  if (!isBshard) return { ok: false, reason: 'non-bshard (v06/v05)·此 settler 只 bshard', isBshard: false };
  if (betCount === 0) return { ok: false, reason: '真 0-bet, 无需退款', isBshard, betCount: 0, degenerate: true };

  const logicalBets = db.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(marketId).c;
  if (logicalBets > 0) {
    return { ok: false, reason: `commingled: logical 键有 ${logicalBets} bet·shard-only refund 会 strand·跳过挂 alert`, isBshard, commingled: true };
  }

  // 退款 leaf = 每笔 bet 原样退还自己的 stake (无需 winDir 判断, 每个 bettor 都退, 非只赢家)。
  //   一 bet 一 leaf (同一 pk 多笔各自独立退, 跟 computePariMutuelPayout 的 winner-per-bet 惯例一致)。
  const refundLeaves = bets.map(b => ({ pk: b.pk, amount: String(b.stake) }));
  const refundRootHex = buildPayoutRoot(refundLeaves).toString('hex');

  // committee VRF — 跟 computeSettlePlan 完全同款逻辑(确定性 seed, excludePks 含 bettor)。
  const poolMerkleRoot = market.pool_merkle_root;
  const endBlockHash = await ctx.endBlockHash(Number(market.deadline_daa));
  const members = await ctx.poolMembers(poolMerkleRoot, Number(market.deadline_daa));
  const bettorPks = [...new Set(bets.map(b => b.pk.toLowerCase()))];
  const excludePks = [String(market.maker_pk).toLowerCase(), String(market.broker_pk).toLowerCase(), ...bettorPks];
  const seed = deriveCommitteeSeed(marketId, endBlockHash, poolMerkleRoot);
  const sel = selectCommittee(members, seed, { excludePks });
  const asc = [...sel.selected].map(c => c.pk_hex).sort();
  const committeePkHash = Buffer.from(blake2b(Buffer.concat(asc.map(p => Buffer.from(p, 'hex'))), { dkLen: 32 })).toString('hex');
  const tree = buildPoolMerkleTree(members.map(m => m.pk_hex));
  const committeeMeta = asc.map(pk => {
    const idx = tree.sortedPks.indexOf(pk);
    return { pk_hex: pk, idx, siblings_hex: getPoolMerkleProof(tree, idx).map(b => b.toString('hex')) };
  });

  // predicted cancelled-PS 地址 (closed=2, payoutRoot 槽复用装 refundRoot·driver enforce 应锚地址)。
  const psRow = db.prepare('SELECT pool_merkle_root, predicate_commit FROM payout_shards WHERE logical_market_id = ?').get(marketId);
  let expectedCancelledAddr = null;
  if (psRow) {
    const consolidatedPool = (BigInt(poolSompi) + BigInt(ctx.psSeedSompi ?? 20000000)).toString();
    const cancelledRedeem = compilePayoutShardRedeem({ poolMerkleRoot: psRow.pool_merkle_root, predicateCommit: psRow.predicate_commit, consolidatedPool, closed: 2, payoutRoot: refundRootHex });
    expectedCancelledAddr = ctx.p2shAddr ? ctx.p2shAddr(cancelledRedeem) : null;
  }

  return {
    ok: true, isBshard, betCount, refundRoot: refundRootHex, refunds: refundLeaves,
    poolSompi, committee: asc, committeeMeta, committeePkHash, expectedCancelledAddr,
    _dbg: { seed: seed.toString('hex'), endBlockHash, poolMerkleRoot, memberCount: members.length, excludePks },
  };
}

/**
 * refundClaimData — 每个 refund 的 depth-10 merkle proof (refund_claim 用·climb 自核)。
 *   镜像 winnerClaimData 一字不动的逻辑(叶子公式相同, 只是语义是"退款"非"派彩")。
 */
export function refundClaimData(refunds) {
  const root = buildPayoutRoot(refunds).toString('hex');
  return refunds.map((r, idx) => {
    const leaf = payoutLeaf(r.pk, r.amount);
    const sibs = merkleProof(refunds, idx);
    const climbed = climbProof(leaf, idx, sibs).toString('hex');
    return { pk: r.pk, amount: r.amount, merkle_index: idx, siblings_hex: sibs.map(s => s.toString('hex')), climbOk: climbed === root };
  });
}

/**
 * cancelMarketLive — relay 驱动编排 (build cancel_attest→enforce→sign→assemble→submit→refund_claim 循环)。
 *   镜像 settleMarketLive 逐步骤, 换 bshard_close_attest→bshard_cancel_attest / bshard_payout_claim→
 *   bshard_refund_claim / new_payout_root→new_refund_root / closed:1→closed:2。
 *   ⚠ caller(daemon)必须已确认触发条件成立(见上方注释)才调用此函数——本函数自身不判断"该不该退款",
 *   只负责"确认要退时, 安全地把钱退回去"。
 */
export async function cancelMarketLive(marketId, ctx) {
  const plan = await computeRefundPlan(marketId, ctx);
  if (!plan.ok) { ctx.alert?.(marketId, `refund plan: ${plan.reason}`); return { ok: false, skipped: true, reason: plan.reason, plan }; }
  if (ctx.dryRun) return { ok: true, dryRun: true, plan };

  const ps = await ctx.psState(marketId);
  if (!ps?.outpointTxid || !ps?.redeem_hex) { ctx.alert?.(marketId, 'PS 未 consolidate / psState 缺'); return { ok: false, reason: 'no consolidated PS' }; }

  const state = { consolidated_pool: String(ps.consolidatedPool), closed: 0, payoutRoot: ZERO32 };
  for (let i = 0; i < 17; i++) state['w' + i] = 0;
  const fee = await ctx.feeUtxo();
  const baseInputs = { payoutshard: { redeem_hex: ps.redeem_hex, outpointTxid: ps.outpointTxid, index: ps.index ?? 0, state }, fee };
  const baseWitness = { self_out_idx: 0, new_refund_root: plan.refundRoot, committee_pk_hash: plan.committeePkHash };

  // 1. BUILD cancel_attest (committee:[] → preimage + unSafeJson)
  const buildRes = await ctx.relayPost(ctx.feeRelay.id, {
    type: 'bshard_cancel_attest', witness: { ...baseWitness, committee: [] },
    inputs: baseInputs, outputs: { change_address: ctx.feeRelay.address },
  });
  if (buildRes?.error || !buildRes?.unSafeJson) { const detail = buildRes?.error || 'no unSafeJson'; ctx.alert?.(marketId, `cancel build fail: ${detail}`); return { ok: false, reason: `build fail: ${detail}` }; }

  // 2. driver enforce 硬闸 (命门·同 close_attest 同款逻辑, 换成 cancelled 地址)
  if (buildRes.psContAddress !== plan.expectedCancelledAddr) {
    ctx.alert?.(marketId, `🔴 enforce FAIL (cancel): build psContAddress ${buildRes.psContAddress} != expected ${plan.expectedCancelledAddr} — NO submit`);
    return { ok: false, reason: 'enforce mismatch (driver-side 硬闸)' };
  }
  const unSafeJson = buildRes.unSafeJson;

  // 3. SIGN per committee (同 close_attest 同款: 4-of-5 各自签同一 unSafeJson)
  const sigs = {};
  for (const m of plan.committeeMeta) {
    const relayId = ctx.pkToRelay(m.pk_hex);
    if (!relayId) continue;
    try {
      const r = await ctx.relayPost(relayId, { type: 'sign_input_for_settle', tx_hex: unSafeJson, input_index: 0, safe_json: true });
      if (r?.signature && r.signature.length === 132) sigs[m.pk_hex] = r.signature;
    } catch { /* skip·下个 */ }
  }
  if (Object.keys(sigs).length < QUORUM) { ctx.alert?.(marketId, `< 4-of-5 sig (cancel, got ${Object.keys(sigs).length})`); return { ok: false, reason: '委员缺席 < 4-of-5' }; }

  // 4. ASSEMBLE + 自核 committee_pk_hash
  const committee5 = plan.committeeMeta.map(m => ({ pk_hex: m.pk_hex, sig_hex: sigs[m.pk_hex] || COMMITTEE_DUMMY_SIG, idx: m.idx, siblings_hex: m.siblings_hex }));
  const cph = Buffer.from(blake2b(Buffer.concat(committee5.map(c => Buffer.from(c.pk_hex, 'hex'))), { dkLen: 32 })).toString('hex');
  if (cph !== plan.committeePkHash) { ctx.alert?.(marketId, `🔴 assemble committee_pk_hash ${cph} != plan ${plan.committeePkHash} (cancel)`); return { ok: false, reason: 'committee_pk_hash 自核失败' }; }

  // 5. SUBMIT cancel_attest
  const submitRes = await ctx.relayPost(ctx.feeRelay.id, {
    type: 'bshard_cancel_attest', witness: { ...baseWitness, committee: committee5 },
    inputs: baseInputs, outputs: { change_address: ctx.feeRelay.address },
  });
  if (submitRes?.error || !submitRes?.txId) { const detail = submitRes?.error || 'no txId'; ctx.alert?.(marketId, `cancel submit fail: ${detail}`); return { ok: false, reason: `submit fail: ${detail}` }; }
  const cancelTxid = submitRes.txId;

  // 6. NO TX NO STATE: verify cancel LANDED (cancelled PS @ 应锚地址·value==consolidatedPool 不变)
  const landed = await verifyClosedLanded(ctx, plan.expectedCancelledAddr, cancelTxid, ps.consolidatedPool);
  if (!landed) { ctx.alert?.(marketId, `cancel ${cancelTxid} 未 verify LANDED (NO TX NO STATE)`); return { ok: false, reason: 'cancel not landed', cancelTxid }; }

  // 7. REFUND_CLAIM per bettor (镜像 claim 循环, closed==2, bshard_refund_claim, 同款 thread 逻辑)。
  const claimData = refundClaimData(plan.refunds);
  let psOutTxid = cancelTxid, psOutIdx = 0;
  let curPool = BigInt(ps.consolidatedPool);
  let curState = { consolidated_pool: curPool.toString(), closed: 2, payoutRoot: plan.refundRoot };
  for (let i = 0; i < 17; i++) curState['w' + i] = 0;
  let curRedeem = compilePayoutShardRedeem({ poolMerkleRoot: ps.poolMerkleRoot, predicateCommit: ps.predicateCommit, consolidatedPool: String(ps.consolidatedPool), closed: 2, payoutRoot: plan.refundRoot });
  const claims = [];
  let needsManualAttribution = false;
  for (const cd of claimData) {
    if (!cd.climbOk) { ctx.alert?.(marketId, `refund climb fail bettor ${cd.pk.slice(0, 8)}`); claims.push({ pk: cd.pk, amount: cd.amount, error: 'climb fail' }); needsManualAttribution = true; continue; }
    const bettorAddr = ctx.p2pkAddr(cd.pk);
    if (ctx.p2pkSpk && ctx.p2pkSpk(bettorAddr).toLowerCase() !== ('20' + cd.pk + 'ac').toLowerCase()) {
      ctx.alert?.(marketId, `refund P2PK round-trip fail ${cd.pk.slice(0, 8)}`); claims.push({ pk: cd.pk, amount: cd.amount, error: 'round-trip fail' }); needsManualAttribution = true; continue;
    }
    const claimRes = await ctx.relayPost(ctx.feeRelay.id, {
      type: 'bshard_refund_claim',
      witness: { self_out_idx: 1, refund_out_idx: 0, bettor_pk: cd.pk, refund: cd.amount, merkle_index: cd.merkle_index, siblings_hex: cd.siblings_hex },
      inputs: { payoutshard: { redeem_hex: curRedeem, outpointTxid: psOutTxid, index: psOutIdx, state: curState }, fee: await ctx.feeUtxo() },
      outputs: { refund: { address: bettorAddr }, change_address: ctx.feeRelay.address },
    });
    const claimTx = claimRes?.txId;
    if (!claimTx) { ctx.alert?.(marketId, `refund submit fail ${cd.pk.slice(0, 8)}: ${claimRes?.error}`); claims.push({ pk: cd.pk, amount: cd.amount, error: claimRes?.error || 'no txId' }); break; }
    const received = await verifyClaimLanded(ctx, bettorAddr, claimTx);
    if (!received) {
      ctx.alert?.(marketId, `refund not landed ${cd.pk.slice(0, 8)} — STOP threading (NO-TX-NO-STATE)`);
      claims.push({ pk: cd.pk, amount: cd.amount, txId: claimTx, received: false, error: 'not landed' }); break;
    }
    const newState = { consolidated_pool: (curPool - BigInt(cd.amount)).toString(), closed: 2, payoutRoot: plan.refundRoot };
    for (let i = 0; i < 17; i++) newState['w' + i] = curState['w' + i];
    const word = Math.floor(Number(cd.merkle_index) / 63), bit = Number(cd.merkle_index) % 63;
    newState['w' + word] = (BigInt(newState['w' + word]) + (1n << BigInt(bit))).toString();
    const contRedeem = splicePayoutContinuation(curRedeem, newState);
    if (ctx.p2shAddr && claimRes.psContAddress && ctx.p2shAddr(contRedeem) !== claimRes.psContAddress) {
      ctx.alert?.(marketId, `refund continuation splice mismatch ${cd.pk.slice(0, 8)} — STOP threading`);
      claims.push({ pk: cd.pk, amount: cd.amount, txId: claimTx, received, error: 'splice mismatch' }); break;
    }
    claims.push({ pk: cd.pk, amount: cd.amount, txId: claimTx, received });
    psOutTxid = claimTx; psOutIdx = 1; curPool = curPool - BigInt(cd.amount); curState = newState; curRedeem = contRedeem;
  }
  const complete = claims.length === claimData.length && claims.every(c => c.received === true && !c.error);
  if (!complete) ctx.alert?.(marketId, `refund 未完整: attempted=${claims.length}/${claimData.length}, received=${claims.filter(c => c.received === true && !c.error).length} — needs_manual_refund${needsManualAttribution ? ' + needs_manual_attribution' : ''}`);
  return { ok: true, cancelTxid, claims, plan, complete, needsManualAttribution };
}

export { COMMITTEE_DUMMY_SIG, QUORUM, ZERO32, splicePayoutContinuation, verifyClosedLanded, verifyClaimLanded };
