// bshard-close-enforce.mjs — Track B autonomous-enforce (J1 co-design, 2026-06-22).
//
// Each oracle node's bshard-close-voter daemon (J2, 65d2c0e9) calls enforceCloseAttest BEFORE signing a
// close_attest sign-request. This is the bshard equivalent of bettor-prediction-voter.js's PB-S8-1 byzantine
// defense: the committee member INDEPENDENTLY re-derives the verdict + committee + payoutRoot from
// chain-anchored inputs (zero caller/DB trust on the load-bearing axes) and only PASSes if everything matches.
//
// proof-of-concept: today (x4kpq) J1 :3300 ran this flow MANUALLY (verify-then-sign 3/3) → close LANDED.
// Track B = this, automated + run by EVERY committee node before its relay signs (replaces relay blind-sign).
//
// ⚠ no-bypass invariant (Bettor/NWT red-team, design doc §3): this enforce only matters if (a) the relay
//   sign_input_for_settle endpoint is locally-reachable-only and (b) the daemon is the ONLY caller of it for
//   close_attest, enforcing EVERY request. Those are daemon/relay-side properties (J2); this lib is the enforce.
//
// 单源: reuses today's proven functions (judgeLine / computeMarketCommit / computePredicateCommit /
//   computePariMutuelPayout / deriveFeeLeaves / settlePayoutRoot / deriveCommitteeSeed / selectCommittee).
//   fix② vacuous 教训: NEVER trust caller-passed committeePks — re-derive from chain (step 5).

import { blake2b } from '@noble/hashes/blake2b';
import { judgeLine } from './judgeline.mjs';
import {
  canonicalPredicate, computePredicateCommit, computeMarketCommit,
  computePariMutuelPayout, deriveFeeLeaves, settlePayoutRoot, FEE_CONFIG,
} from './pool-shard-settle.mjs';
import { deriveCommitteeSeed, selectCommittee } from '../services/pool-committee-sampler.mjs';
import { buildPoolMerkleTree } from '../services/pool-merkle-v06.mjs';   // C2: complete-set verify

const _PREDICATE_COMMIT_REDEEM_OFFSET = 518;

/**
 * Autonomous close_attest enforce. Returns {pass, reason?, verdict?, skip?}.
 *  - skip:true  → this node isn't a committee member for this market (daemon: not-my-business, no sig, not a fail).
 *  - pass:false → enforce rejected (daemon: 弃签, don't broadcast sig — the load-bearing defense).
 *  - pass:true  → daemon proceeds to sign_input_for_settle on the local relay.
 *
 * @param {object} signRequest {market_id, predicate, proposed_evidence, claimedPayoutRoot, psRedeemHex,
 *                              committee_pk, broker_pk, introducer_pk?}  (from metadata.bshard_close_request)
 * @param {object} ctx {myOracleKeys:string[](lowercase x-only), chainReader, db, fetchEndBlockHashCanonical,
 *                       loadPoolSnapshot, loadBettors, deadlineDaa}  (daemon-injected)
 */
export async function enforceCloseAttest(signRequest, ctx) {
  const {
    market_id, predicate, proposed_evidence, claimedPayoutRoot, psRedeemHex,
    committee_pk, broker_pk, introducer_pk = null,
  } = signRequest;

  // 1. am I a committee member for this market? (else not-my-business)
  const myPk = String(committee_pk || '').toLowerCase();
  if (!ctx.myOracleKeys?.map(k => k.toLowerCase()).includes(myPk)) {
    return { skip: true, reason: 'committee_pk not one of my oracle keys' };
  }

  // 2. 命门① predicate hash-bind — verify against ON-CHAIN commit (PS redeem offset-518), NOT a caller param.
  //    fee markets bake computeMarketCommit(predicate, fee_recipients); predicate-only markets computePredicateCommit.
  const onChainCommit = String(psRedeemHex).slice(_PREDICATE_COMMIT_REDEEM_OFFSET * 2, (_PREDICATE_COMMIT_REDEEM_OFFSET + 32) * 2);
  const feeMarket = !!broker_pk;
  const expectedCommit = feeMarket
    ? computeMarketCommit(predicate, { brokerPk: broker_pk, introducerPk: introducer_pk })
    : computePredicateCommit(predicate);
  if (expectedCommit !== onChainCommit) {
    return { pass: false, reason: `命门① hash-bind FAIL: ${expectedCommit.slice(0, 14)} != on-chain redeem[518] ${onChainCommit.slice(0, 14)} (假 predicate/fee 地址)` };
  }
  // chain-bound check (redeem 不可伪): daemon should also verify p2sh(psRedeemHex) == the signed PS input's
  //   on-chain address via ctx.rcOn check_utxo_landed (= 命门① 的链锚, 同今天手动流). [daemon ctx hook]

  // 3. frozen_evidence 同源 (J1 lead) — verify the proposed snapshot against MY OWN canonical fetch.
  const ev = await verifyFrozenEvidence(predicate, proposed_evidence, ctx);
  if (!ev.match) return { pass: false, reason: `frozen_evidence: ${ev.reason}` };

  // 4. 命门③ winningSide — judgeLine on MY OWN fetched evidence (not the proposed; defense against poison).
  const verdict = judgeLine(predicate, ev.ownFetch);
  if (verdict !== 'YES' && verdict !== 'NO') {
    return { pass: false, reason: `judgeLine=${verdict} (abstain-not-guess: 字段不足/无法判, 弃签)` };
  }
  const winningDirection = verdict === 'YES' ? 0 : 1;

  // 5. fix① committee chain-anchored re-derive (ZERO caller/DB trust) — DON'T trust signRequest.committeePks.
  //    seed = deriveCommitteeSeed(market_id, endBlockHash[自算], pool_merkle_root[链上读]); members verified ∈ root.
  let committee;
  try {
    committee = await reDeriveCommittee(market_id, ctx);
  } catch (e) {
    return { pass: false, reason: `fix① committee re-derive fail: ${e.message}` };
  }
  if (!committee.map(p => p.toLowerCase()).includes(myPk)) {
    return { pass: false, reason: `fix①: 我的 committee_pk 不在链锚 re-derive 的委员集 (假 sign-request 或我不该被问)` };
  }

  // 6. payoutRoot re-derive == claimed (pari-mutuel winners + fee leaves on the re-derived committee).
  const bettors = await ctx.loadBettors(market_id);
  // ── C1 FIX (NWT 红队, 最深 = fix② 重演): bettors 必【链锚】不能盲信 DB/caller (settler 增删 bettor 改 pari-mutuel) ──
  //   (i) per-bettor 链锚: 每 bettor 必有 side_lock_daa (= 接受块 daa, 链共识 fact, 见 [[silverscript-tx-time-...]]/#27a)
  //       且 <= deadline_daa (越界 bet 不算)。NULL = fail-loud, 不盲信。
  if (!Array.isArray(bettors) || bettors.length === 0) return { pass: false, reason: 'C1: no bettors loaded (fail-loud)' };
  for (const b of bettors) {
    if (b.side_lock_daa == null) return { pass: false, reason: `C1: bettor ${String(b.pk).slice(0, 10)} 无 side_lock_daa (未链锚, fail-loud 不盲信 DB)` };
    if (Number(b.side_lock_daa) > Number(ctx.deadlineDaa ?? Infinity)) return { pass: false, reason: `C1: bettor side_lock_daa > deadline_daa (越界 bet)` };
  }
  //   (ii) ⚠ 完整-集 链锚 [PARTIAL — w/ J2 钉]: 上面 guard 每 bettor 链锚, 但【不防 settler 漏掉一个 bettor】(改 pari-mutuel)。
  //       完整闭 = 从【链上 bshard shard 状态】(ShardLeaf pool_value/count/tickets, 非 v06 sides_merkle_root) 重建完整 bettor 集
  //       == loaded。这是 bshard shard-commit 依赖, 我和 J2 钉链上 shard→bettor 重建 (诚实: C1 现 PARTIAL, 非全闭)。
  if (typeof ctx.verifyBettorsCompleteFromChain === 'function') {
    const ok = await ctx.verifyBettorsCompleteFromChain(market_id, bettors);
    if (!ok) return { pass: false, reason: 'C1: bettor 集不完整 (链上 shard 重建 != loaded)' };
  }
  const poolSompi = bettors.reduce((s, b) => s + BigInt(b.stake), 0n).toString();
  const { feeLeaves } = deriveFeeLeaves({
    poolSompi, feeConfig: FEE_CONFIG, brokerPk: broker_pk, introducerPk: introducer_pk, committeePks: committee,
  });
  const pm = computePariMutuelPayout({ bettors, winningDirection, feeLeaves });
  if (pm.degenerate) return { pass: false, reason: `degenerate (${pm.reason}) — 单边池需 refund 路` };
  const reDerivedRoot = settlePayoutRoot(pm.payoutLeaves && pm.payoutLeaves.length ? pm.payoutLeaves : pm.winners);
  if (reDerivedRoot !== String(claimedPayoutRoot)) {
    return { pass: false, reason: `命门③/④ payoutRoot REJECT: re-derive ${reDerivedRoot.slice(0, 14)} != claimed ${String(claimedPayoutRoot).slice(0, 14)} (假 winningSide/委员/fee)` };
  }

  // ── C3 FIX (NWT 红队 TOCTOU): 返【我验的 tx 的 hash】。daemon 必验它 sign_input_for_settle 的 tx hash == 此值,
  //    否则 enforce 验了 tx-A 却签了 tx-B = enforce 被绕。daemon 签前 assert signedTxHash === verifiedTxHash。
  const verifiedTxHash = Buffer.from(blake2b(Buffer.from(String(signRequest.txSafeJson || '')), { dkLen: 32 })).toString('hex');
  return { pass: true, verdict, verifiedTxHash };
}

/**
 * frozen_evidence 同源 (J1 lead, open-Q#1). Trust anchor = THIS node's own canonical fetch, NOT the settler's
 * proposed snapshot. The proposed snapshot gives determinism (all members judgeLine the same bytes); each member
 * verifies it == its own canonical fetch before accepting. Poison snapshot ≠ honest fetch → reject.
 */
export async function verifyFrozenEvidence(predicate, proposedSnapshot, ctx) {
  // canonical fetch: predicate.data_source_canonical fixed URL, FINAL fields after finality (game over → stable).
  //   per-URL FINAL-cache (crossnode-oracle-liveness 铁律: 防 voter 403 self-DoS). extractEspnFields canonical抽取.
  let ownFetch;
  try {
    ownFetch = await ctx.fetchCanonicalEvidence(predicate);   // {fields} canonical extract [daemon ctx hook: ESPN FINAL + cache]
  } catch (e) {
    return { match: false, reason: `canonical fetch fail (${e.message}) — 弃签 (不猜)` };
  }
  if (!ownFetch || !ownFetch.fields) return { match: false, reason: 'own fetch no fields (FINAL 未到/源不可达) — abstain' };
  // deep-equal the proposed snapshot against my own canonical extract (byte-identical → match).
  const propKey = canonicalPredicate(proposedSnapshot || null);
  const ownKey = canonicalPredicate(ownFetch.fields);
  if (propKey !== ownKey) {
    return { match: false, ownFetch: ownFetch.fields, reason: `proposed evidence != 我观测的 canonical 赛果 (poison? stale?) — 拒` };
  }
  return { match: true, ownFetch: ownFetch.fields };
}

/**
 * fix① committee chain-anchored re-derive (ZERO caller). seed = deriveCommitteeSeed(marketId, endBlockHash, poolMerkleRoot).
 *  - endBlockHash: ctx.fetchEndBlockHashCanonical(chainReader, deadline_daa) — 自算, anti-grinding, NOT passed.
 *  - poolMerkleRoot: read from on-chain PS/spine ctor (chain-anchored). [hardening: read from redeem, not DB]
 *  - poolMembers: ctx.loadPoolSnapshot(marketId) → verify buildPoolMerkleTree(members) == on-chain poolMerkleRoot.
 *  - excludePks: maker_pk + broker_pk (same-PK 双角色防), chain-anchored.
 */
export async function reDeriveCommittee(marketId, ctx) {
  const snap = await ctx.loadPoolSnapshot(marketId);    // {pool_merkle_root, members:[{pk_hex, stake_sompi}], maker_pk, broker_pk}
  // ── C2 FIX (NWT 红队 转 J1 fix① 域): 验【完整有序成员集】, 非逐个 inclusion ──
  //   attacker 供子集(漏诚实成员)→ selectCommittee 种子从子集选他控委员会。
  //   修 = buildPoolMerkleTree(全集 pks) == poolMerkleRoot。子集 → 建出的 root ≠ → reject。
  if (!Array.isArray(snap.members) || snap.members.length === 0) throw new Error('C2: empty/invalid pool members');
  const built = buildPoolMerkleTree(snap.members.map(m => m.pk_hex));
  const builtRoot = (built.root?.toString ? built.root.toString('hex') : String(built.root)).toLowerCase();
  const wantRoot = String(snap.pool_merkle_root || '').toLowerCase();
  if (builtRoot !== wantRoot) {
    throw new Error(`C2: 成员集非完整 — buildPoolMerkleTree ${builtRoot.slice(0, 16)} != poolMerkleRoot ${wantRoot.slice(0, 16)} (子集攻击防, NWT)`);
  }
  // [C2-companion hardening: snap.pool_merkle_root 本身应从【链上 PS/spine ctor】读 (= ctx.onChainPoolMerkleRoot),
  //  非 DB; DB root 是本节点自观测。stakes 不进 root(只 commit pks)= determinism-edge, 链上 oracle bond 各节点同观测.]
  const endBlockHash = await ctx.fetchEndBlockHashCanonical(ctx.chainReader, ctx.deadlineDaa ?? snap.deadline_daa);
  const seed = deriveCommitteeSeed(marketId, endBlockHash, snap.pool_merkle_root);
  const exclude = [snap.maker_pk, snap.broker_pk].filter(Boolean).map(p => String(p).toLowerCase());
  const sel = selectCommittee(snap.members, seed, { excludePks: exclude });
  return sel.selected.map(c => c.pk_hex);
}

export default enforceCloseAttest;
