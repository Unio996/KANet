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
import { findExtractor, extractStructuredFields } from './oracle-evidence-extractors.mjs';   // verifyFrozenEvidence canonical fetch (J1)
import { listShards } from './shard-allocator.mjs';                                          // C1 cross-shard iteration (单源, register/consolidate 同表)
import { compileSil, ctorBytes32, ctorInt } from './pool-bshard-artifacts.mjs';              // C1 per-ticket PoolSide ticket-addr re-derive (= register/relay 同 compile 路)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const _LIBDIR = dirname(fileURLToPath(import.meta.url));
const _PREDICATE_COMMIT_REDEEM_OFFSET = 518;
const _hex32 = (s) => Buffer.from(blake2b(Buffer.from(s), { dkLen: 32 })).toString('hex');
// canonical (A) 4-field ShardLeaf state splice (= pool-shard-register.spliceLeafState 单源, byte-equal to recompile, J2 已验)。
const _i64LE = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const _push8 = (buf) => Buffer.concat([Buffer.from([buf.length]), buf]);
function _spliceLeafState(baseRedeemHex, st) {
  const stateHex = Buffer.concat([_push8(_i64LE(st.local_yes)), _push8(_i64LE(st.local_no)), _push8(_i64LE(st.count)), _push8(_i64LE(st.pool_value))]);
  const redeem = Buffer.from(baseRedeemHex, 'hex');
  return Buffer.concat([redeem.slice(0, 1), stateHex, redeem.slice(1 + stateHex.length)]).toString('hex');
}

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
  //   级2: 跨全 rolling-shard 重建完整 bettor 集 (verifyBettorsCompleteFromChain)。自足: ctx 钩缺省回退本 lib 实现。
  const completeFn = (typeof ctx.verifyBettorsCompleteFromChain === 'function')
    ? ctx.verifyBettorsCompleteFromChain
    : verifyBettorsCompleteFromChain;
  const cs = await completeFn(market_id, bettors, ctx);
  if (!cs || cs.ok !== true) return { pass: false, reason: `C1: ${cs?.reason || 'bettor 集不完整 (链上 shard 重建 != loaded)'}` };
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

// ── per-URL FINAL-cache (crossnode-oracle-liveness 铁律: 防 voter 403 self-DoS / 限流风暴) ──
//   FINAL 赛果是 immutable (赛完数据稳) → 缓存安全。TTL 只用于 bound bad-cache 影响半径 (非 FINAL 不缓存→下次重取)。
const _finalEvidenceCache = new Map();   // canonical-url -> { fields, field_hash, cachedAtMs }
const _FINAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;   // 6h

/**
 * Canonical evidence 自取 (J1 lead, open-Q#1 落实). 委员【自己 fetch】canonical 源 → 结构化 5 字段, 非 settler 提议。
 * 单源复用 oracle-evidence-extractors (findExtractor host-anchored+https-only+SSRF block / extractStructuredFields
 * = extractEspnFields FINAL-only + normalizeAbbr canonical + field_hash). abstain-not-guess: 未 final / 源异常 → fields=null.
 * @param {{data_source_canonical:string}} predicate
 * @param {{fetchImpl?:Function, timeoutMs?:number, nowMs?:number}} [opts] (fetchImpl/nowMs 可注入 = offline 自测)
 * @returns {Promise<{fields:object|null, field_hash:string|null, cached?:boolean, reason?:string}>}
 */
export async function fetchCanonicalEvidence(predicate, opts = {}) {
  const url = predicate && predicate.data_source_canonical;
  if (!url || typeof url !== 'string') throw new Error('predicate.data_source_canonical 缺失 — 无 canonical 源 (弃签不猜)');
  // host-anchored + https-only + SSRF block (与 voter extract 同源 findExtractor; 防伪源/内网 SSRF 控判决)。
  if (!findExtractor(url)) throw new Error(`canonical 源无 extractor / 非 https / SSRF 拒: ${url.slice(0, 60)} (弃签)`);

  const nowMs = opts.nowMs ?? Date.now();
  const cached = _finalEvidenceCache.get(url);
  if (cached && (nowMs - cached.cachedAtMs) < _FINAL_CACHE_TTL_MS) {
    return { fields: cached.fields, field_hash: cached.field_hash, cached: true };
  }

  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(opts.timeoutMs || 8000) });
  if (!res.ok) throw new Error(`canonical fetch HTTP ${res.status} — 源不可达/限流 (弃签; 非-FINAL 不缓存)`);
  const rawText = await res.text();

  const sf = extractStructuredFields(url, rawText);   // {final, fields, field_hash} | null (= 未 final / 异常)
  if (!sf || !sf.final || !sf.fields) {
    // 赛果未定 → 不缓存 (下次重取, 待终态), 返 null → caller abstain-not-guess。
    return { fields: null, field_hash: null, reason: '源未 final / 结构异常 (abstain-not-guess)' };
  }
  _finalEvidenceCache.set(url, { fields: sf.fields, field_hash: sf.field_hash, cachedAtMs: nowMs });
  return { fields: sf.fields, field_hash: sf.field_hash, cached: false };
}

// test-only: 清 FINAL-cache (offline 自测隔离用例; production 无需调)。
export function _clearFinalEvidenceCache() { _finalEvidenceCache.clear(); }

/**
 * frozen_evidence 同源 (J1 lead, open-Q#1). Trust anchor = THIS node's own canonical fetch, NOT the settler's
 * proposed snapshot. The proposed snapshot gives determinism (all members judgeLine the same bytes); each member
 * verifies it == its own canonical fetch before accepting. Poison snapshot ≠ honest fetch → reject.
 * 自足: ctx.fetchCanonicalEvidence 缺省回退到本 lib fetchCanonicalEvidence (daemon 无需 wire; ctx 仅供注入/测)。
 */
export async function verifyFrozenEvidence(predicate, proposedSnapshot, ctx = {}) {
  let ownFetch;
  try {
    ownFetch = (typeof ctx.fetchCanonicalEvidence === 'function')
      ? await ctx.fetchCanonicalEvidence(predicate)
      : await fetchCanonicalEvidence(predicate);
  } catch (e) {
    return { match: false, reason: `canonical fetch fail (${e.message}) — 弃签 (不猜)` };
  }
  if (!ownFetch || !ownFetch.fields) return { match: false, reason: (ownFetch && ownFetch.reason) || 'own fetch no fields (FINAL 未到/源不可达) — abstain' };
  // deep-equal the proposed snapshot against my own canonical extract (canonical sorted-key → byte-确定 比对).
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

/**
 * C1 complete-set 链锚 (J1, NWT 红队最深洞 = fix² 重演 bettors 轴). bshard (A) rolling-shard 市场: ShardLeaf state 是
 * 聚合 {local_yes,local_no,count,pool_value} 不枚举单 bettor, 但 register 每 bettor mint 一个 dust PoolSide ticket
 * (per-state P2SH 烤 bettorPk+direction+stake+shardPoolId)。一 logical market auto-roll 多 shard → 必【跨全片】重建。
 *
 *  级2-A 聚合链锚 (anti-omission + anti-aggregate-direction-tamper):
 *    跨 listShards 全片求和 on-chain leaf state, 每片 state 必【链锚】(p2sh(spliceLeafState(genesis_redeem, state))
 *    == current_leaf_outpoint 落地址), 否则 state 是 DB-only = 不可信 (同 fix² leaf-vacuous 教训)。
 *    断言 Σcount==loaded.len / Σpool_value==Σstake / Σlocal_yes==Σ(dir0) / Σlocal_no==Σ(dir1)。
 *  级2-B per-ticket 链锚 (anti-swap: 等额 YES↔NO 对调 → Σ不变但 ticket 地址变):
 *    逐 loaded bettor recompute PoolSide ticket per-state P2SH (= register/relay 同 compileSil 路, real ctor) →
 *    check_utxo_landed。任一缺 → 该 bettor 被换/伪造 → reject。
 *    (级2-A count 闭 + 级2-B 逐 ticket 存在 ⟹ loaded == 链上注册集 ⟹ 无漏/无伪/无换 = complete-set 全闭。)
 *
 * ⚠ 诚实分级 (verify-ship-before-report 铁律, 别 over-claim): 本会话【未 live 自测链路】—— 本节点 market_shards 空
 *   (无 (A)-model 链上数据) + relay 离线。纯逻辑 (聚合算术 + 漏/换分支) 已 mock-test; 链锚 (p2sh/check_utxo_landed)
 *   + per-ticket compileSil-recompute==relay-splice 的 byte-equal (silverc-determinism pin, 记忆 silverc-build-determinism-pin)
 *   待 live (A)-model e2e (J2 域) + 对真 on-chain ticket 的 side_p2sh byte-equal 确认才能宣称【级2-B 闭】。
 *
 * @param {string} logicalMarketId  PayoutShard 的 logical market id (daemon 必传 logical 非 shard id)
 * @param {Array} bettors           loaded bettors (每 {pk|bettor_pk, direction, stake|stake_amount})
 * @param {object} ctx {db(sqlite), p2sh(redeemHex)->addr, checkUtxoLanded(addr,txid?)->bool,
 *                       silverc?, poolSideSilPath?, deriveTicketAddr?({bettorPk,direction,stake,shardPoolId})->addr}
 * @returns {Promise<{ok:bool, reason?, applicable?:bool, aggregate?, perTicketChecked?:number, perTicketVerified?:bool}>}
 */
export async function verifyBettorsCompleteFromChain(logicalMarketId, bettors, ctx = {}) {
  if (!ctx.db) return { ok: false, reason: 'C1: ctx.db 缺 — 无法 iterate market_shards (fail-loud)' };
  const shards = listShards(ctx.db, logicalMarketId);

  // (A)-model 判定: 无 shard 行 → 非 rolling-shard 市场 (e.g. fee-only / 旧模型) → 级2 N/A。
  //   但若存在 PayoutShard (= (A)-model PS 已 genesis) 却 shard 空 → 数据缺失/篡改 → fail-loud (堵"擦掉 shard 绕 C1")。
  if (!shards.length) {
    let hasPS = false;
    try { hasPS = !!ctx.db.prepare(`SELECT 1 FROM payout_shards WHERE logical_market_id = ? LIMIT 1`).get(logicalMarketId); } catch { /* table 不存在 = 非 (A) 环境 */ }
    if (hasPS) return { ok: false, reason: 'C1: payout_shards 存在但 market_shards 空 — (A)-model shard 数据缺失/篡改 (fail-loud, 堵绕 C1)' };
    return { ok: true, applicable: false, reason: 'no market_shards + no PayoutShard — 非 (A)-model rolling-shard 市场, 级2 N/A' };
  }

  if (typeof ctx.p2sh !== 'function' || typeof ctx.checkUtxoLanded !== 'function') {
    // 链锚 primitive 缺 → 聚合只能 DB-only = 不 trustless → fail-loud (拒静默 DB-only 降级, fix² 教训)。
    return { ok: false, reason: 'C1: ctx.p2sh/checkUtxoLanded 缺 — leaf state 无法链锚 (拒 DB-only 聚合)' };
  }

  // ── 级2-A: 跨片聚合链锚 ──
  let chainCount = 0; let chainYes = 0n; let chainNo = 0n; let chainPool = 0n;
  for (const sh of shards) {
    let st = null;
    try { st = JSON.parse(sh.current_leaf_state || 'null'); } catch { st = null; }
    if (!st || st.count == null || st.pool_value == null) return { ok: false, reason: `C1: shard ${sh.shard_index} 无 current_leaf_state — fail-loud` };
    if (!sh.shard_redeem_hex || !sh.current_leaf_outpoint) return { ok: false, reason: `C1: shard ${sh.shard_index} 缺 shard_redeem_hex/current_leaf_outpoint — 无法链锚` };
    // chain-anchor: per-state leaf 地址 == current_leaf_outpoint 落地址 (state 篡改 → 地址变 → 落地址不符)。
    const leafAddr = ctx.p2sh(_spliceLeafState(sh.shard_redeem_hex, st));
    const [leafTxid] = String(sh.current_leaf_outpoint).split(':');
    const landed = await ctx.checkUtxoLanded(leafAddr, leafTxid);
    if (!landed) return { ok: false, reason: `C1: shard ${sh.shard_index} leaf state 非链锚 (p2sh(spliced)!=落地址 — DB state 篡改?)` };
    chainCount += Number(st.count);
    chainYes += BigInt(st.local_yes);
    chainNo += BigInt(st.local_no);
    chainPool += BigInt(st.pool_value);
  }

  // loaded aggregate
  if (!Array.isArray(bettors)) return { ok: false, reason: 'C1: bettors 非数组' };
  let loadYes = 0n; let loadNo = 0n; let loadPool = 0n;
  const norm = [];
  for (const b of bettors) {
    const pk = String(b.pk ?? b.bettor_pk ?? '').toLowerCase();
    const dir = Number(b.direction);
    const stake = BigInt(b.stake ?? b.stake_amount ?? 0);
    if (!pk) return { ok: false, reason: 'C1: bettor 无 pk' };
    if (dir !== 0 && dir !== 1) return { ok: false, reason: `C1: bettor ${pk.slice(0, 10)} direction 非 0|1` };
    if (!(stake > 0n)) return { ok: false, reason: `C1: bettor ${pk.slice(0, 10)} stake<=0` };
    if (dir === 0) loadYes += stake; else loadNo += stake;
    loadPool += stake;
    norm.push({ pk, dir, stake });
  }
  if (norm.length !== chainCount) return { ok: false, reason: `C1 anti-omission: loaded count ${norm.length} != 链上 Σcount ${chainCount} (settler 漏/加 bettor)` };
  if (loadPool !== chainPool) return { ok: false, reason: `C1: loaded Σstake ${loadPool} != 链上 Σpool_value ${chainPool}` };
  if (loadYes !== chainYes) return { ok: false, reason: `C1 anti-dir-tamper: loaded YES ${loadYes} != 链上 Σlocal_yes ${chainYes}` };
  if (loadNo !== chainNo) return { ok: false, reason: `C1 anti-dir-tamper: loaded NO ${loadNo} != 链上 Σlocal_no ${chainNo}` };

  // ── 级2-B: per-ticket 链锚 (anti-swap) ── 逐 shard 的 loaded bettor recompute ticket 地址 + landed。
  let perTicketChecked = 0;
  let perTicketVerified = false;
  const canTicket = typeof ctx.deriveTicketAddr === 'function' || (ctx.silverc && typeof ctx.p2sh === 'function');
  if (canTicket) {
    for (const sh of shards) {
      const shardPoolId = _hex32(`${logicalMarketId}-shard-${sh.shard_index}`);
      const rows = ctx.db.prepare(`SELECT bettor_pk, direction, stake_amount FROM pool_bettor_sides WHERE market_id = ?`).all(sh.shard_market_id);
      for (const r of rows) {
        const addr = await _deriveTicketAddr(String(r.bettor_pk), Number(r.direction), BigInt(r.stake_amount), shardPoolId, ctx);
        const landed = await ctx.checkUtxoLanded(addr, null);
        if (!landed) return { ok: false, reason: `C1 anti-swap: bettor ${String(r.bettor_pk).slice(0, 10)} (shard ${sh.shard_index}) PoolSide ticket 链上不存在 (pk/dir/stake 被换/伪造?)` };
        perTicketChecked++;
      }
    }
    perTicketVerified = true;
    // 防御: per-shard DB ticket 行总数必 == 链上 Σcount (否则 DB shard 行与链上注册数不符 = 漏/加)。
    if (perTicketChecked !== chainCount) return { ok: false, reason: `C1: per-ticket 行数 ${perTicketChecked} != 链上 Σcount ${chainCount} (DB shard 行与链上不符)` };
  }

  return {
    ok: true,
    aggregate: { count: chainCount, pool: chainPool.toString(), yes: chainYes.toString(), no: chainNo.toString() },
    perTicketChecked, perTicketVerified,
  };
}

/**
 * Re-derive a bettor's PoolSide dust-ticket per-state P2SH (= register/relay 同 compileSil 路, real ctor).
 * 优先 ctx.deriveTicketAddr (relay-canonical 单源, 零 drift); 缺省 compileSil-recompute (real ctor [pk,dir,stake,shardPoolId])。
 * ⚠ compileSil-recompute 依赖 canonical silverc pin (记忆 silverc-build-determinism-pin) — byte-equal to relay-splice 待 live 确认。
 */
async function _deriveTicketAddr(bettorPk, direction, stake, shardPoolId, ctx) {
  if (typeof ctx.deriveTicketAddr === 'function') {
    return await ctx.deriveTicketAddr({ bettorPk, direction, stake: stake.toString(), shardPoolId });
  }
  const silPath = ctx.poolSideSilPath || join(_LIBDIR, 'PoolSide_v08_shard.sil');
  const redeem = Buffer.from(compileSil(silPath, [ctorBytes32(bettorPk), ctorInt(Number(direction)), ctorInt(Number(stake)), ctorBytes32(shardPoolId)], ctx.silverc).script).toString('hex');
  return ctx.p2sh(redeem);
}

export default enforceCloseAttest;
