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
import { blake2b } from '@noble/hashes/blake2b';
import { deriveCommitteeSeed, selectCommittee } from '../services/pool-committee-sampler.mjs';
import { deriveRoleFeeLeaves, FEE_RULES_SCHEMA_V, computeFeeRulesCommit } from './fee-split.mjs';

// 价值分成 fee 协议常量 (单源 = 真相源; UI 收口 + deriveFeeLeaves + create-v07 都读此, 防硬编漂移). bps = basis points (1% = 100).
//   押注侧: winners 9700bps (97%) / fee 300bps (3%) = broker 160 + oracle 100 + introducer 20 + node 20.
//   determinism: 协议常量 (非 maker 可调) → 委员 re-derive byte-identical (maker 可调需 create-烤 per-market, Owner 经济决策).
//   oracle+node (120bps) → selectCommittee 派生的 5 委员均分 (各 24bps); broker/introducer 各 1 leaf (create-committed pk).
export const FEE_CONFIG = Object.freeze({ brokerBps: 160, oracleBps: 100, introBps: 20, nodeBps: 20, winnersBps: 9700, totalFeeBps: 300 });

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
export function computePariMutuelPayout({ bettors, winningDirection, poolTotalSompi = null, feeBps = 0, feeLeaves = [] }) {
  if (winningDirection !== 0 && winningDirection !== 1) throw new Error(`winningDirection must be 0|1, got ${winningDirection}`);
  const pool = poolTotalSompi != null ? BigInt(poolTotalSompi) : bettors.reduce((s, b) => s + BigInt(b.stake), 0n);
  // 价值分成 fee (J1 边界②整数): fee total = Σ feeLeaves.amount (单源 deriveFeeLeaves 已 BigInt floor + canonical). 兼容旧
  //   feeBps path (无 feeLeaves 时 skim feeBps 但不分配, 机制测保留). fee-recipient leaves 进 payoutRoot (与 winner 同 climb).
  const feeFromLeaves = feeLeaves.reduce((s, l) => s + BigInt(l.amount), 0n);
  const feeSompi = feeFromLeaves > 0n ? feeFromLeaves : (pool * BigInt(feeBps) / 10000n);
  const distributable = pool - feeSompi;
  const winners = bettors.filter(b => Number(b.direction) === winningDirection);
  const totalWinStake = winners.reduce((s, b) => s + BigInt(b.stake), 0n);

  // degenerate: no winning side (single-sided pool / all-loser) → settler can't pay winners → refund (cancel_attest path).
  if (winners.length === 0 || totalWinStake === 0n) {
    return { degenerate: true, reason: 'no winning-side bettors → refund', winners: [], payoutLeaves: [], poolTotal: pool.toString(), distributable: distributable.toString(), feeSompi: feeSompi.toString() };
  }
  const payouts = winners.map(b => ({ pk: b.pk, amount: BigInt(b.stake) * distributable / totalWinStake }));
  const assigned = payouts.reduce((s, p) => s + p.amount, 0n);
  payouts[0].amount += (distributable - assigned);   // dust → winners[0] (Σ == distributable exact)
  const winnerLeaves = payouts.map(p => ({ pk: p.pk, amount: p.amount.toString() }));
  // payoutRoot leaf 集 = winner leaves ‖ fee-recipient leaves (J1 边界: fee leaf append 在 winner 后, deriveFeeLeaves 已 canonical
  //   排序 → 顺序确定 → 跨节点 byte-identical). winners 字段保留 (旧 caller 兼容); payoutLeaves 是 root 真集 (含 fee).
  const payoutLeaves = [...winnerLeaves, ...feeLeaves.map(l => ({ pk: l.pk, amount: BigInt(l.amount).toString() }))];
  return { degenerate: false, winners: winnerLeaves, payoutLeaves, poolTotal: pool.toString(), distributable: distributable.toString(), feeSompi: feeSompi.toString() };
}

/**
 * 价值分成 fee-leaf 单源派生 (J1 co-verify 边界①单源②整数③provenance). claim builder + enforceCommitteeSign re-derive 两处
 * 【必调此一个函数】否则 bind 永假. 所有 fee-recipient pk 必【链锚派生】(broker/introducer = market create-committed,
 * oracle+node = pool_merkle_root 派生委员集) — caller 绑 provenance, 本 fn 纯算 (BigInt floor, fee-dust→committee[0] 确定性).
 *
 * 🔴 旁路封死(P4·D-008, 2026-07-09)：**本函数是 V1(PayoutShard/committee-settle)专属**——ZK 线(V2/
 * PayoutShardV2/CloseZkV2)禁止直调本函数，一律走 `deriveSettlementFeeLeaves`（pool 基数=consolidatedPool
 * 含seed、费率=市场级 broker_fee_pct，非本函数的 FEE_CONFIG 协议常量口径）。V1 语义不受 P4 影响，本函数
 * 及其 `FEE_CONFIG` 一字不动。
 * @param {object} o {
 *   poolSompi, feeConfig:{ brokerBps, oracleBps, introBps, nodeBps }, brokerPk(hex32), introducerPk(hex32|null),
 *   committeePks(hex32[] 签 close 的链上派生委员, oracle+node reward 均分)
 * }
 * @returns {{ feeLeaves:[{pk, amount, type}], feeSompi:string }} — amount BigInt-string, leaves canonical 序 (broker, introducer, committee-by-pk-sorted)
 */
export function deriveFeeLeaves({ poolSompi, feeConfig, brokerPk, introducerPk = null, committeePks = [] }) {
  const pool = BigInt(poolSompi);
  const bpsAmt = (bps) => pool * BigInt(bps || 0) / 10000n;   // BigInt floor (J1 边界②零浮点)
  const leaves = [];
  // broker (create-committed): 总在, market host
  if (feeConfig.brokerBps > 0 && brokerPk) leaves.push({ pk: brokerPk.toLowerCase(), amount: bpsAmt(feeConfig.brokerBps), type: 'broker' });
  // introducer (create-committed snapshot): fallback = 无 introducer → 不收 introBps (winner 保, broker 中立不抢 — 假设(b))
  if (feeConfig.introBps > 0 && introducerPk) leaves.push({ pk: introducerPk.toLowerCase(), amount: bpsAmt(feeConfig.introBps), type: 'introducer' });
  // oracle + node → 签 close 的链上派生委员均分 (假设(a): determinism + health-proven + 反碎片 + 劳动报酬). canonical: 委员按 pk 排序.
  const commBps = (feeConfig.oracleBps || 0) + (feeConfig.nodeBps || 0);
  if (commBps > 0 && committeePks.length) {
    const total = bpsAmt(commBps);
    const sorted = [...committeePks].map(p => p.toLowerCase()).sort();
    const each = total / BigInt(sorted.length);
    sorted.forEach((pk, i) => leaves.push({ pk, amount: each + (i === 0 ? total - each * BigInt(sorted.length) : 0n), type: 'committee' }));   // fee-dust → committee[0] 确定性
  }
  const feeSompi = leaves.reduce((s, l) => s + l.amount, 0n);
  return { feeLeaves: leaves.map(l => ({ pk: l.pk, amount: l.amount.toString(), type: l.type })), feeSompi: feeSompi.toString() };
}

/**
 * deriveSettlementFeeLeaves — ZK 线单源 fee-leaf 派生函数(P4·D-008 BLOCKING 收敛卡, J2 2026-07-09)。
 * 设计文档 docs/2026-07-09-fee-single-source-leaf-derivation-design.md(Bettor 方向审 GREEN-with-notes +
 * NWT 红队)。取代 propose/enqueue/enforceCloseAttestV2 三个调用点各自手搓的 `deriveFeeLeaves({poolSompi:
 * Σ注(漏seed), feeConfig: FEE_CONFIG})` 旧口径(7/8 门②同一市场三处三说法的病根)。
 *
 * 🔴 反 vacuous 铁律（每个 caller 必读，不是可选建议）：本函数只单源"派生算法"，**不单源"值源"**——
 * `consolidatedPoolSompi` 形参必须由每个 caller 各自独立链读，禁止任何一侧把自己算好的值转发/透传给另一侧
 * "图省事保持一致"。当前三个合法读取路径（互不共享代码，互不透传数值）：
 *   - propose 侧（bshard-close-transport.mjs）：zk_handoff 之前，continuation 还不存在——读
 *     `payout_shards.payout_redeem_hex` 当前活 UTXO 现读的 consolidated_pool（= realConsolidatedPool，
 *     既有 verify-value-source 现读逻辑，含 seed）。
 *   - enqueue 侧（zk-prove-enqueue.mjs）：zk_handoff 已完成——`readPayoutShardV2AttestedState` 对
 *     `zk_continuation.redeemHex` 现读的 consolidatedPool。
 *   - 委员 voter 侧（bshard-close-enforce.mjs enforceCloseAttestV2）：对被签 tx 的 PS input redeem
 *     （`psRedeemHex`，链锚、非 caller 喂）现读的 `_readPsConsolidatedPool`——委员本来就是独立验证人，
 *     这一读天然构成第三条独立值链（Bettor #dcndfw 裁定：比 propose 转发强）。
 * 若两个 caller 传入同一个已经算好的数字（哪怕形参名相同），§3 三侧 byte-exact 验收会全绿，但只证明了
 * "传递链路没打错字"，证明不了"每一侧真的独立读对了源头"——同 7/8 门①"同 env 同源三处一致=vacuous"同一个坑
 * （规则56）。
 *
 * @param {{brokerPk:string, brokerFeePctBps:number}} market  create-committed 市场级字段（D-007 口径）。
 *   brokerFeePctBps = market.broker_fee_pct 列原值（已是 bps 单位，非百分比），无 broker_pk/pct<=0 → 无 broker leaf。
 * @param {string|number|bigint} consolidatedPoolSompi  caller 独立链读的 pool 实额（含 seed），函数内断言 >0。
 * @returns {{feeLeaves:[{pk,amount,type}], feeSompi:string}}
 */
export function deriveSettlementFeeLeaves(market, consolidatedPoolSompi) {
  const pool = BigInt(consolidatedPoolSompi);
  if (pool <= 0n) throw new Error(`deriveSettlementFeeLeaves: consolidatedPoolSompi=${consolidatedPoolSompi} 必须 >0(caller 链读值可疑, 拒绝派生)`);
  // B线落1(2026-07-12, spec v1.1-A): 内部实现替换为 fee-split 组件——本函数收窄为"V2 市场字段 → feeRules 映射"
  //   的薄壳, 分配数学单源在组件里。产出 byte-equal 既有实现(fee-single-source.test.mjs ①-⑥ 守), 四侧接线
  //   与 lint R-FEE-LEAVES-BYPASS 门自动继承。
  // committeeShare: 'pending-D-008-owner-policy' — FEE_CONFIG 120bps(oracle+node)委员分成暂不并入。
  //   D-008(docs/DECISIONS.md)明确挂起待 Owner 确认份额表；确认后在【feeRules 映射内】加 derive:'committee'
  //   角色, 不接受调用方自行追加委员 leaf(旁路封死同一铁律: 单源是唯一权威, 不是"调用方可以自己补几条"的模板)。
  const bps = Number(market?.brokerFeePctBps || 0);
  const hasBroker = bps > 0 && !!market?.brokerPk;
  const feeRules = {
    schema_v: FEE_RULES_SCHEMA_V,
    preset: 'prediction-v2-market',   // 市场级 broker_fee_pct 口径(D-008), 非 FEE_PRESETS.prediction 协议常量口径
    roles: hasBroker
      ? [{ name: 'provider', bps: 10000 - bps }, { name: 'broker', address: String(market.brokerPk).toLowerCase(), bps }]
      : [{ name: 'provider', bps: 10000 }],
  };
  return deriveRoleFeeLeaves(feeRules, pool);
}

/**
 * 单源 fee-leaf 派生 (claim builder + enforceCommitteeSign re-derive 两处【必调此一个】). 委员【确定性派生零 driver/settler 输入】:
 *   committee = selectCommittee(poolMembers, deriveCommitteeSeed(marketId, endBlockHash, poolMerkleRoot)) — reuse Bettor r42
 *   anti-bribery sampler (stake-weighted N=5, 链锚 3-因子 seed 防 grinding, excludePks 排 maker/broker pk 防双角色). 解耦:
 *   committee=fee-set 确定性独立于实签的 M-of-N (J1/Bettor 收敛, liveness 只影响签名 quorum 不影响 fee 集 → re-derive byte-identical).
 *   ⚠ provenance(命门④): marketId/poolMerkleRoot/endBlockHash/poolMembers/brokerPk/introducerPk/feeConfig 必【链锚】(create-committed
 *   + pool_committee pinned endBlockHash + oracle_pool_chain_view poolMembers + 协议常量 feeConfig), 非 settler 供 — caller 绑 provenance.
 * @param {object} o { marketId, poolMerkleRoot, endBlockHash, poolMembers:[{pk_hex,stake_sompi}], feeConfig, brokerPk, introducerPk, excludePks?, poolSompi }
 * @returns {{ feeLeaves, feeSompi, committeePks }}
 */
export function deriveFeeLeavesForMarket({ marketId, poolMerkleRoot, endBlockHash, poolMembers, feeConfig, brokerPk, introducerPk = null, excludePks = [], poolSompi }) {
  const seed = deriveCommitteeSeed(marketId, endBlockHash, poolMerkleRoot);
  const exclude = [...excludePks, brokerPk].filter(Boolean).map(p => String(p).toLowerCase());   // broker 拿 broker-fee 单独, 不进 oracle/node 委员集 (防双领)
  const sel = selectCommittee(poolMembers, seed, { excludePks: exclude });
  const committeePks = sel.selected.map(c => c.pk_hex);
  const r = deriveFeeLeaves({ poolSompi, feeConfig, brokerPk, introducerPk, committeePks });
  return { ...r, committeePks };
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
// canonical(predicate): deterministic 跨节点 byte-identical 序列化 (递归 sorted-key JSON). genesis 烤 predicate_commit 与
//   enforce 验必用【同一函数 = 单源】(否则 bind 永假/永真). ⚠ NWT 命门① spec 域: 此格式三方对死.
export function canonicalPredicate(p) {
  if (p === null || typeof p !== 'object') return JSON.stringify(p);
  if (Array.isArray(p)) return '[' + p.map(canonicalPredicate).join(',') + ']';
  return '{' + Object.keys(p).sort().map(k => JSON.stringify(k) + ':' + canonicalPredicate(p[k])).join(',') + '}';
}

/**
 * predicate_commit = blake2b(canonicalPredicate(predicate)). 单源: genesis (ensurePayoutShard 烤) + enforce (验) 必用此函数,
 * 否则 hash 不一致 → bind 永假(legit predicate 也拒). ⚠ NWT 命门① spec 域确认格式.
 */
export function computeMarketCommit(predicate, feeRecipients) {
  // v1 fee provenance (NWT hard line: fee 地址必链上 committed 不可伪, 非 DB-only). 折 fee_recipients 进 PS redeem
  //   offset-518 commit slot (= 原 predicate_commit 同一 32B; .sil 不变, 只换 preimage = 零 re-compile/re-deploy).
  //   genesis 烤 + enforce 验【同一函数 = 单源】(NWT 命门④ flag: 两边不同源 → 永假). determinism 铁律 (NWT/Bettor):
  //   reuse canonicalPredicate (递归 sorted-key byte-确定) on 组合 obj; pk lowercase; introducer 缺失 → null (一致跨节点).
  //   fee-市场烤此; predicate-only (旧/无 fee 市场) 用 computePredicateCommit (向后兼容).
  const obj = {
    fee_recipients: {
      broker: feeRecipients?.brokerPk ? String(feeRecipients.brokerPk).toLowerCase() : null,
      introducer: feeRecipients?.introducerPk ? String(feeRecipients.introducerPk).toLowerCase() : null,
    },
    predicate: predicate ?? null,
  };
  return Buffer.from(blake2b(Buffer.from(canonicalPredicate(obj)), { dkLen: 32 })).toString('hex');
}

export function computePredicateCommit(predicate) {
  return Buffer.from(blake2b(Buffer.from(canonicalPredicate(predicate)), { dkLen: 32 })).toString('hex');
}

/**
 * computeMarketCommitV2 — B线落2(设计 docs/2026-07-12-fee-split-phase2-commit-anchor-design.md v1.2,
 * Bettor 注1-4 + NWT P1-P3 折入): fee_rules 市场的 commit 槽公式。两级 hash——fee_rules_commit(组件单源
 * computeFeeRulesCommit, 32B)折进 preimage, 保持 offset-518 槽机制零变(.sil 不变零 re-deploy)。
 *
 * 🔴 P1(NWT 红队): fee_rules 市场【一律】烤本公式——predicate-null(如 blockhash_parity)市场不再走裸
 * market_metadata_hash(那条第三分支对 feeRules 零绑定 = settler 可喂任意假规则重定向 fee 零 BUST),
 * preimage 折入原 identity 锚 {fee_rules_commit, market_metadata_hash}。
 * 🔴 类型 pin(NWT 注4c): fee_rules_commit / market_metadata_hash 均以 lowercase hex string 进 preimage,
 * 禁 Buffer(canonicalPredicate(Buffer) 会序列化成 {"data":[…],"type":"Buffer"} 形状 = 两侧一 string 一
 * Buffer commit 永假)。preimage key 名钉死: `fee_rules_commit` / `predicate` / `market_metadata_hash`。
 * 双向 BUST(论证表, 设计 §2.2): 篡改规则→fee_rules_commit 不符; 隐瞒规则(委员按无 feeRules 走 legacy
 * 分支)→legacy commit ≠ 链上 v2; predicate-null 两方向同理。
 *
 * @param {object} feeRules 全文规则(内部 computeFeeRulesCommit 会跑 validateFeeRules 双验)
 * @param {{predicate?:object|null, marketMetadataHash?:string|null}} anchors predicate 优先; null 时必须给 marketMetadataHash
 */
export function computeMarketCommitV2(feeRules, { predicate = null, marketMetadataHash = null } = {}) {
  const feeRulesCommit = computeFeeRulesCommit(feeRules);   // lowercase hex string(组件产出即 hex string)
  let obj;
  if (predicate != null) {
    obj = { fee_rules_commit: feeRulesCommit, predicate };
  } else {
    if (!marketMetadataHash) throw new Error('computeMarketCommitV2: predicate-null 市场必须提供 marketMetadataHash(P1 identity 锚, 缺失拒烤)');
    obj = { fee_rules_commit: feeRulesCommit, market_metadata_hash: String(marketMetadataHash).toLowerCase() };
  }
  return Buffer.from(blake2b(Buffer.from(canonicalPredicate(obj)), { dkLen: 32 })).toString('hex');
}

/**
 * deriveMarketPredicateCommit — 市场行 → commit 槽值的唯一派生函数(B线落2)。取代 pool.js 三处烤点各自
 * 手搓的同型四行(1333/1585/1755——"两套并行实现"家族病, 同 _resolveZkNativeCtorExtras 收敛先例)。
 * 分支(与 enforce 侧 _enforceCloseAttestCore 命门① 判别严格镜像):
 *   fee_rules 非空 → computeMarketCommitV2(一律, 含 predicate-null, P1)
 *   fee_rules NULL + predicate → 既有 computeMarketCommit(predicate, fee_recipients)【字节不动】
 *   fee_rules NULL + predicate-null → 既有裸 market_metadata_hash【字节不动】
 * @param {object} market pool_markets 行(需 resolution_rule_spec/fee_rules/broker_pk/introducer_pk/market_metadata_hash)
 */
export function deriveMarketPredicateCommit(market) {
  let predicate = null;
  try { predicate = JSON.parse(market.resolution_rule_spec || '{}')?.resolution_predicate || null; } catch {}
  if (market.fee_rules) {
    const feeRules = JSON.parse(market.fee_rules);   // 坏 JSON = fail-loud throw(committed 规则不可解析绝不静默降级)
    return computeMarketCommitV2(feeRules, { predicate, marketMetadataHash: market.market_metadata_hash });
  }
  if (!predicate) return market.market_metadata_hash;
  return computeMarketCommit(predicate, { brokerPk: market.broker_pk || null, introducerPk: market.introducer_pk || null });
}

// PayoutShard.sil (canonical 873e799e) ctor-baked predicate_commit 在 redeem 的 byte offset (J2 probe: 两 predicate_commit
//   compile diff → first occurrence @518). ⚠ .sil 变则 offset 变 — provenance-pinned 873e799e 下稳定. NWT 命门① 审.
const _PREDICATE_COMMIT_REDEEM_OFFSET = 518;

export async function enforceCommitteeSign({ rcOn, committeeRelayId, txSafeJson, claimedPayoutRoot, predicate, psRedeemHex, p2sh, frozenFields, bettors, feeBps = 0, feeParams = null }) {
  // 🔑 命门① predicate hash-bind (NWT/Bettor load-bearing catch): 委员【不信 caller】. 不取 caller 的 predicateCommit param
  //   (= vacuous, caller 可填假) — 而是【从被签 close_attest tx 的 PS input redeem 抽 ON-CHAIN ctor-baked predicate_commit】+
  //   chain-bound(check_utxo_landed 验 p2sh(redeem)==被签 PS input 的链上地址 → redeem 不可伪). 然后验 blake2b(canonical(predicate))
  //   == on-chain predicate_commit. 假 predicate(自洽假 payoutRoot)→ hash 不符 → 拒签.
  //   genesis 必烤 predicate_commit=blake2b(canonical(predicate))(orchestrator 改; 现烤 market_metadata_hash 则永假).
  if (!psRedeemHex || !p2sh) return { ok: false, reason: `命门①: psRedeemHex + p2sh 必传(链上读 predicate_commit, 不信 caller param)` };
  let psInputTxid;
  try { psInputTxid = JSON.parse(txSafeJson).inputs[0].transactionId; } catch { return { ok: false, reason: 'txSafeJson parse fail (no PS input)' }; }
  const psAddr = p2sh(psRedeemHex);
  const landedRes = await rcOn(committeeRelayId, { type: 'check_utxo_landed', address: psAddr, txid: psInputTxid });
  if (!(landedRes?.landed || landedRes?.found)) {
    return { ok: false, reason: `命门①: p2sh(psRedeem)=${psAddr.slice(0, 16)} 不是被签 PS input(txid ${psInputTxid.slice(0, 12)})的链上地址 — redeem 假/不绑链, 委员拒签` };
  }
  const onChainPredicateCommit = Buffer.from(psRedeemHex, 'hex').slice(_PREDICATE_COMMIT_REDEEM_OFFSET, _PREDICATE_COMMIT_REDEEM_OFFSET + 32).toString('hex');
  // 命门①+④: fee-市场烤 computeMarketCommit({predicate, fee_recipients}) 进 offset-518; predicate-only 市场烤 computePredicateCommit.
  //   委员从【被花 PS UTXO redeem】(p2sh-verified above)读 commit + 单源验. fee-市场: brokerPk/introducerPk 经此 hash-绑链上 →
  //   settler 改 fee 地址 → computeMarketCommit 不符 → BUST (NWT 底线: fee 地址链上 committed 不可伪). genesis 与此【同函数=单源】.
  const predHash = feeParams ? computeMarketCommit(predicate, feeParams) : computePredicateCommit(predicate);
  if (predHash !== onChainPredicateCommit) {
    return { ok: false, reason: `命门①${feeParams ? '+④' : ''} hash-bind FAIL: ${feeParams ? 'computeMarketCommit(predicate+fee_recipients)' : 'predicate_commit'} ${predHash.slice(0, 14)} != ON-CHAIN ${onChainPredicateCommit.slice(0, 14)} (假 predicate/fee 地址, 委员拒签)` };
  }
  const { judgeLine } = await import('./judgeline.mjs');
  const verdict = judgeLine(predicate, frozenFields);                 // 'YES' | 'NO' | 'ABSTAIN' (byte-identical 跨节点)
  if (verdict !== 'YES' && verdict !== 'NO') {
    return { ok: false, reason: `judgeLine ${verdict} (字段不足/无法判, abstain-not-guess) — 委员拒签` };
  }
  const winningDirection = verdict === 'YES' ? 0 : 1;
  // 价值分成 fee (J1/Bettor 收敛: 委员【不信 caller 的 fee-leaf/committee】, 自己从链锚确定性派生 = 单源 deriveFeeLeavesForMarket).
  //   feeParams 不传 = 无 fee (机制测/旧 teeth 向后兼容). 传则委员 re-derive 含 fee → 假 fee 地址/bps/committee → re-derive≠claimed → BUST.
  let feeLeaves = [];
  if (feeParams) {
    // J1 footgun-close (cross-layer-consistency): 只接【pinned committeePks】(= loadCommittee = sampleAndStoreCommittee 写,
    //   已 maker/broker/bettor-excluded) → fee集==签名集 by construction. 【不 re-sample】(deriveFeeLeavesForMarket 的 excludePks
    //   ≠ sampler → fee委员≠签名委员 gap, NWT/Bettor BREAKER). committeePks 必传, 缺则拒签 (不 silent fallback 到错路).
    if (!feeParams.committeePks || !feeParams.committeePks.length) {
      return { ok: false, reason: `命门④: feeParams.committeePks (pinned pool_committee) 必传 — 不 re-sample (fee集必==签名集 by construction)` };
    }
    const poolSompi = bettors.reduce((s, b) => s + BigInt(b.stake), 0n);
    try {
      feeLeaves = deriveFeeLeaves({ poolSompi: poolSompi.toString(), feeConfig: feeParams.feeConfig, brokerPk: feeParams.brokerPk, introducerPk: feeParams.introducerPk, committeePks: feeParams.committeePks }).feeLeaves;
    } catch (e) { return { ok: false, reason: `命门④ fee-leaf 派生 FAIL: ${String(e.message).slice(0, 120)}` }; }
  }
  const pm = computePariMutuelPayout({ bettors, winningDirection, feeBps, feeLeaves });
  if (pm.degenerate) return { ok: false, reason: `degenerate (${pm.reason}) — 单边池需 refund 路` };
  const reDerivedRoot = settlePayoutRoot(pm.payoutLeaves && pm.payoutLeaves.length ? pm.payoutLeaves : pm.winners);
  if (reDerivedRoot !== String(claimedPayoutRoot)) {
    return { ok: false, reason: `命门③ REJECT: re-derive payoutRoot ${reDerivedRoot.slice(0, 14)} != claimed ${String(claimedPayoutRoot).slice(0, 14)} (假 winningSide/payoutRoot/fee)` };
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
 * #DB-lag自愈 (2026-07-06, lv3rz/dyljb 公测首两场结算实战暴露: consolidate 每一步落链后只在【全部
 * shard 循环成功完成】才把最终 payout_ps_outpoint 写回 payout_shards 表——如果中途任何一步失败
 * (常见: 某个 shard 自身撞了不相关的 tip-lag/phantom), 已经【真实链上完成】的前面几步全部白白
 * 不被记录, 下次重试还是从 DB 记的 genesis/旧值开始, 立刻在 shard0 撞"UTXO not found"(因为那个
 * outpoint早被这次没记上账的中途进度花掉了)。J2 今晚手动做的诊断(逐步splice consolidated_pool
 * 重算每一跳地址查UTXO)证明为可靠、纯计算(不需要区块扫描)、可自动化——这里收编成通用探测函数。
 *
 * 探测方法: 从 DB 记录的 genesis payout_redeem_hex 出发, 按 shard_index 升序逐个尝试 splice 新的
 * consolidated_pool 算出对应地址查 UTXO, 找到第一个"有 UTXO"的即为当前真实 tip。找不到(genesis 本身
 * 就有 UTXO)说明还没开始consolidate过, 走原逻辑(resume=null 从零开始)。
 *
 * @param {object} o { db, getUtxos(addr)→[{outpoint,amount}], p2sh, logicalMarketId, payoutShard }
 * @returns {null | { fromShardIdx, psTx, psIdx, pool }} null = 不需要 resume(from genesis 正常走或已探测不到任何进度)
 */
export async function autoDetectConsolidateResume({ db, getUtxos, p2sh, logicalMarketId, payoutShard }) {
  const allShards = db.prepare(`SELECT * FROM market_shards WHERE logical_market_id = ? AND status != 'manual_recovery_refunded' ORDER BY shard_index ASC`).all(logicalMarketId);
  let psRedeem = Buffer.from(payoutShard.payout_redeem_hex, 'hex');
  let consolidatedPool = psRedeem.readBigInt64LE(2);
  // genesis 本身有没有 UTXO(=从没 consolidate 过, 不需要 resume)先探一次, 省一轮不必要的 shard0 尝试.
  const genesisAddr = p2sh(psRedeem.toString('hex'));
  const genesisUtxos = await getUtxos(genesisAddr);
  if (genesisUtxos.length > 0) return null;   // genesis 完好未花, 从零开始正常走(不是这次要修的场景)

  let found = null;
  for (const shard of allShards) {
    let st = {}; try { st = JSON.parse(shard.current_leaf_state || '{}'); } catch { break; }   // 数据缺失 fail-closed, 别猜
    consolidatedPool += BigInt(st.pool_value || 0);
    const rbuf = Buffer.from(psRedeem);
    rbuf.writeBigInt64LE(consolidatedPool, 2);
    psRedeem = rbuf;
    const addr = p2sh(psRedeem.toString('hex'));
    const utxos = await getUtxos(addr);
    if (utxos.length > 0) {
      const op = utxos[0].outpoint;
      // redeemHex(K-18 §3.4, 2026-07-21 J1 代笔 J2 域): 这里已经是 splice 出的真实字节(与
      // consolidateAllShards 同一权威), 不是从 consolidatedPool 数值重新 compilePayoutShardRedeem——
      // 之前只 return 了 pool 数值, 调用方(consolidateAndBuildPsState)再用这个数值去重编译, 是
      // Codex/K-18 §3.4 指出的"recompile 当花费权威"违规根源之一。现在把这份已经算好的 splice 字节
      // 一并交出, 调用方直接用, 不必再过一次 silverc。
      found = { fromShardIdx: shard.shard_index + 1, psTx: op.transactionId, psIdx: Number(op.index || 0), pool: consolidatedPool.toString(), redeemHex: psRedeem.toString('hex') };
      break;
    }
  }
  // 探测完所有 shard 都没找到活着的 UTXO = 探测失败(比 genesis 更深的问题, 比如真 phantom 或数据缺失),
  // fail-closed 返回 null 让调用方走原逻辑照常报错, 不能编造一个假 resume 点。
  return found;
}

/**
 * Consolidate all shards of a logical market into its PayoutShard, then return the final PS outpoint + consolidated_pool.
 * Iterative: each shard's CURRENT ShardLeaf (spliced from shard_redeem_hex + current_leaf_state) → bshard_consolidate.
 * @param {object} o { db, rc, landed, p2sh, logicalMarketId, payoutShard:{payout_redeem_hex, payout_ps_outpoint, payout_cov_id}, relayAddr, transfer,
 *   getUtxos(addr)→[{outpoint,amount}] (optional — enables DB-lag 自愈自动 resume, 见 autoDetectConsolidateResume) }
 * @returns {{ psOutpoint, consolidatedPool, consolidatedShards }}
 */
export async function consolidateAllShards({ db, rc, landed, p2sh, logicalMarketId, payoutShard, relayAddr, transfer, deadline, resume = null, getUtxos = null }) {
  // DB-lag 自愈: 没传显式 resume 且调用方给了 getUtxos, 先探测一次"DB 记的 payout_ps_outpoint 是不是
  // 已经过期(链上真实进度比它超前)"——探到了自动用探测结果当 resume, 不用每次卡住都手动介入。
  if (!resume && getUtxos) {
    resume = await autoDetectConsolidateResume({ db, getUtxos, p2sh, logicalMarketId, payoutShard });
  }
  // 件1(J1 deadline-gate, J2 ms-unit fix b98e0112): partial 片(count<seal_count)consolidate 触发 ShardLeaf
  //   `require(tx.time >= deadline * 1000)` → consolidate tx 必须 set lockTime = deadline*1000(ms, ≥ Kaspa
  //   LOCK_TIME_THRESHOLD 5e11 → ms-epoch 模式, tx.time=lockTime literal=ms 比对). 否则默认 lockTime=0 →
  //   tx.time(0) < deadline*1000 → 合法 partial consolidate 被 BUST. settle 在 deadline 后跑 → lockTime<now → tx final.
  //   sealed 片跳闸(满片随时 LAND), lock_time 无害. 单位三处一致: register 烤秒 / 合约 *1000 / 此处 *1000ms.
  if (!Number.isFinite(Number(deadline)) || Number(deadline) <= 0) throw new Error(`consolidateAllShards: deadline (Unix s, partial-sweep gate) required, got ${deadline}`);
  const consolidateLockTimeMs = Math.floor(Number(deadline)) * 1000;
  // manual_recovery_refunded(2026-07-06, lv3rz shard6 phantom-leaf 事故·Bettor 拍板①经济完整性):
  //   shard 自身 leaf 因为更早的 tip-lag 事故变 phantom(链上真花过, 但溯源代价太高), 团队走手动 runbook
  //   直接从 gateway 原路退款给对应 bettor(见 dev-coord-testnet #7/6凌晨), 这个 shard 不再参与
  //   consolidate(它的 stake 已经不在池子里, 退给 bettor 了不是赢家池的一部分)。exclude 掉, 否则
  //   会重新尝试 consolidate 它已经 phantom 的 leaf outpoint 撞同一个 UTXO-not-found 卡住整条链。
  const allShards = db.prepare(`SELECT * FROM market_shards WHERE logical_market_id = ? AND status != 'manual_recovery_refunded' ORDER BY shard_index ASC`).all(logicalMarketId);
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
      lock_time: consolidateLockTimeMs,                 // 件1: ms-epoch lockTime so ShardLeaf `tx.time >= deadline*1000` passes (partial 片闸); sealed 片跳闸无害
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
  // redeemHex(K-18 §3.4, 2026-07-21 J1 代笔 J2 域): psRedeem 在整个循环里都是 splice(writeBigInt64LE
  // 直改 state 字段字节), 从未过 silverc recompile——这本来就是"对"的权威(§1 事故表格里的 splice 权威一栏)。
  // 之前只 return consolidatedPool 数值, 调用方要用这个数值再单独重编译建 redeem, 那趟重编译才是
  // Codex/K-18 指出的风险来源。改成直接把这份已经是权威字节的 psRedeem 交出去, 调用方不必再算一次。
  return { psOutpoint: `${psTx}:${psIdx}`, consolidatedPool: consolidatedPool.toString(), consolidatedShards: count, redeemHex: psRedeem };
}
