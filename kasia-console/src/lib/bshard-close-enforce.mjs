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
import { canonicalBetOrder, computeBetsRoot, payoutRoot as computeMerkleRoot } from './pool-payout-root.mjs';   // W2: committee 独立重算 betsRoot/refundRoot
const _PREDICATE_COMMIT_REDEEM_OFFSET = 518;
const _hex32 = (s) => Buffer.from(blake2b(Buffer.from(s), { dkLen: 32 })).toString('hex');
// canonical (A) 4-field ShardLeaf state splice (= pool-shard-register.spliceLeafState 单源, byte-equal to recompile, J2 已验)。
// ⚠ landmine 修正(NWT 2026-07-07 实测坐实+紧急抓漏): 真 silverc/rusty-kaspa byte[](int,size) 对负数用
// sign-magnitude(同 pool-payout-root.mjs serializeI64, 已 self-test 7/7 验证 -1→0100000000000080), 不是两补数。
// absorb 透传 attestedWinner(genesis 占位符 -1, 未 attest 前恒负) 是真实调用点——NWT 抓到"负数直接 throw"这个防御
// 反而会让 absorb 崩(3o6cs 现在正需要这个值), 必须真支持负数, 不能只 throw。固定 8B LE 从 magnitude 直接填充
// (跟 serializeI64 的 minimal-encode+pad 殊途同归, 对 fixed-8B 场景更直接, 无需 lastSaturated 特判): sign bit 落在
// byte[7](符合 magnitude < 2^63 时不会跟数值位冲突)。
const _i64LE = (n) => {
  const v = BigInt(n);
  const neg = v < 0n;
  let mag = neg ? -v : v;
  const MAX_MAG = 1n << 63n;
  if (mag >= MAX_MAG) throw new Error(`_i64LE: magnitude(${mag}) 超出 sign-magnitude 8B 可表示范围(需 < 2^63)`);
  const b = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) { b[i] = Number(mag & 0xffn); mag >>= 8n; }
  if (neg) b[7] |= 0x80;
  return b;
};
const _push8 = (buf) => Buffer.concat([Buffer.from([buf.length]), buf]);
function _spliceLeafState(baseRedeemHex, st) {
  const stateHex = Buffer.concat([_push8(_i64LE(st.local_yes)), _push8(_i64LE(st.local_no)), _push8(_i64LE(st.count)), _push8(_i64LE(st.pool_value))]);
  const redeem = Buffer.from(baseRedeemHex, 'hex');
  return Buffer.concat([redeem.slice(0, 1), stateHex, redeem.slice(1 + stateHex.length)]).toString('hex');
}

// ── D2 (NWT 红队最承重, verify-value-source): PayoutShard close continuation redeem splice (closed 0→1 + payoutRoot 写入) ──
//   state_start=1 (canonical PayoutShard; 确认 pool-shard-settle.mjs `state_start:1` + relay _POOL_STATE_START=1, 三处一致)。
//   state 布局 (序列同 relay _serializePayoutStateHex): consolidated_pool(PUSH8=9B) ‖ closed(PUSH8=9B) ‖ payoutRoot(PUSH32=33B) ‖ w0..w16。
//   只 splice closed+payoutRoot 进【input PS redeem】(consolidated_pool/17-word nullifier 从 redeem 透传) == relay
//   _continuationAddress(全 state 区替换)byte-equal —— _j2_A_close_attest 实证 recompile==splice==psContAddress。
const _PS_STATE_START = 1;
function _splicePayoutCloseRedeem(psRedeemHex, payoutRootHex) {
  const redeem = Buffer.from(String(psRedeemHex), 'hex');
  const root = Buffer.from(String(payoutRootHex).replace(/^0x/, ''), 'hex');
  if (root.length !== 32) throw new Error(`payoutRoot 非 32B (got ${root.length})`);
  const closedOff = _PS_STATE_START + 9;    // consolidated_pool(9) 之后
  const rootOff = _PS_STATE_START + 18;      // + closed(9)
  if (redeem.length < rootOff + 33) throw new Error(`psRedeem 太短 (${redeem.length}B, 需 ≥ ${rootOff + 33}) — 非 PayoutShard redeem?`);
  const closedField = Buffer.concat([Buffer.from([0x08]), _i64LE(1)]);   // closed=1 (PUSH8 + i64LE)
  const rootField = Buffer.concat([Buffer.from([0x20]), root]);          // payoutRoot (PUSH32 + 32B)
  return Buffer.concat([
    redeem.slice(0, closedOff), closedField,
    redeem.slice(closedOff + 9, rootOff), rootField,
    redeem.slice(rootOff + 33),
  ]).toString('hex');
}
// Kaspa P2SH scriptPublicKey hex = version(0000) ‖ OP_BLAKE2B(aa) PUSH32(20) ‖ blake2b256(redeem) ‖ OP_EQUAL(87)。
//   probe 实证 byte-equal kaspa-wasm createPayToScriptHashScript→serializeToSafeJSON 的 output.scriptPublicKey (plain blake2b-256, 无 key)。
function _p2shSpkHex(redeemHex) {
  const h = Buffer.from(blake2b(Buffer.from(String(redeemHex), 'hex'), { dkLen: 32 })).toString('hex');
  return ('0000aa20' + h + '87').toLowerCase();
}
// 读 PS continuation state 首字段 consolidated_pool (state_start=1, PUSH8 i64LE @ byte _PS_STATE_START+1)。
//   = consolidate 全片累积链上聚合 (PS_SEED + Σ all shard pool_value)。C1 PS-level complete-set 链锚用 (抓 omit-shard 变体①)。
function _readPsConsolidatedPool(psRedeemHex) {
  const b = Buffer.from(String(psRedeemHex || ''), 'hex');
  if (b.length < _PS_STATE_START + 9) return null;
  return b.readBigInt64LE(_PS_STATE_START + 1);   // skip PUSH8 len byte @ _PS_STATE_START
}

/**
 * D2 FIX (NWT 红队最承重 = verify-value-source 铁律): 验【被签 tx 实际 commit 的 payoutRoot】, 不是 caller 旁路标量。
 * close_attest 把 payoutRoot 烤进 PS continuation output 的 P2SH scriptPubKey (SIGHASH_ALL 覆盖 = 委员签名真绑的值)。
 * 攻击 (verdict D2): settler 给【匹配的 claimedPayoutRoot 标量】+【txSafeJson 的 continuation output commit 另一个根】
 *   → 旧码只验标量 → 漏过 → daemon 签了输出是恶意根的 tx。修 = 从被签 txSafeJson 反解 continuation output 的根验它。
 * continuation output 唯一识别 = `covenant.covenantId != null` (PS cov_id 续约 output; change output covenant=null) —— probe 实证。
 * ⚠ malleability-safe 前提 = tx.version>=1: rusty-kaspa hashing/sighash.rs hash_output 对 version>=1 把 covenant
 *   (is_some + authorizing_input + covenant_id) 折进 outputs_hash → covenant binding **被 sighash 覆盖** → settler
 *   收 sig 后不能把 binding 挪到 decoy output (= NWT 红队 'move-binding' 攻击被堵在共识层)。version 0 不折 covenant →
 *   identification 可被 malleate → 必 assert version>=1 (close_attest 本就 v1+compute_budget; v0 另会 9999-units BUST,
 *   但 verify-value-source 铁律: 别靠"它会在别处 BUST", 显式拒)。
 * @param {{txSafeJson:string, psRedeemHex:string, reDerivedRoot:string}} o
 * @returns {{ok:bool, reason?, expectedSpk?, matchedOutputs?:number}}
 */
export function verifyClosePayoutRootBinding({ txSafeJson, psRedeemHex, reDerivedRoot }) {
  let signedTx;
  try { signedTx = JSON.parse(String(txSafeJson || '')); } catch { return { ok: false, reason: 'D2: txSafeJson parse fail — 无法验被签 tx commit 的根 (弃签)' }; }
  // NWT 红队: covenant-output identification 仅在 version>=1 malleability-safe (sighash 覆盖 covenant binding)。
  //   ⚠ NWT NaN-旁路修 (2026-06-22): Number(undefined)=NaN, NaN<1=false → version 缺失/非数字会漏过 `<1` gate。
  //   settler 全控 txSafeJson 可省略 version 绕过。必显式 Number.isInteger + >=1 (fail-closed, 非数字/缺失/小数全拒)。
  //   ⚠ NWT type-coerce 修 (2026-06-22 续审): Number('1')=1 会让 string "1" 漏过 Number.isInteger gate, 但 relay
  //   deserializeFromSafeJSON 要【u16 native int】(probe 实证: string "1"/float 1.5/null 它都 throw) → 我 gate 接受的
  //   value 必 == relay 接受的 value (verify-value-source 一致). 故必 typeof==='number'(拒 string/null), 再 isInteger+>=1。
  const _ver = signedTx.version;
  if (typeof _ver !== 'number' || !Number.isInteger(_ver) || _ver < 1) return { ok: false, reason: `D2: tx.version=${JSON.stringify(_ver)} 非 native-int 或 <1 — relay deserializeFromSafeJSON 要 u16 int(string/float/null 它 throw); covenant binding 仅 v>=1 被 sighash 覆盖, fail-closed 弃签` };
  let expectedSpk;
  try { expectedSpk = _p2shSpkHex(_splicePayoutCloseRedeem(psRedeemHex, reDerivedRoot)); }
  catch (e) { return { ok: false, reason: `D2: continuation redeem splice fail (${e.message})` }; }
  const covOuts = (Array.isArray(signedTx.outputs) ? signedTx.outputs : []).filter(o => o && o.covenant && o.covenant.covenantId);
  if (covOuts.length === 0) return { ok: false, reason: 'D2: 被签 tx 无 covenant continuation output — 非合法 close_attest (弃签)' };
  // 每个 covenant continuation output 必 commit re-derived root (防 decoy: 真 continuation 必是 cov_id-bound 那个;
  //   settler 加假根 cov_id-output → 任一不符 → BUST; 全部都对 → 无论 final witness self_out_idx 指哪个都安全)。
  for (const o of covOuts) {
    if (String(o.scriptPublicKey || '').toLowerCase() !== expectedSpk) {
      return { ok: false, reason: `D2 REJECT: 被签 tx continuation output commit 的根 != re-derive — settler 旁路标量伪装 (spk ${String(o.scriptPublicKey).slice(0, 24)}.. != expected ${expectedSpk.slice(0, 24)}..)`, expectedSpk };
    }
  }
  return { ok: true, expectedSpk, matchedOutputs: covOuts.length };
}

// ── W2 (J2 2026-07-07): PayoutShardV2 close_attest continuation splice — 字节偏移坐实于实际 PayoutShardV2.sil
//   源码 (consolidated_pool/closed/payoutRoot/w0-w16/attestedWinner/attestedAtMs/betsRootBaked/refundRootBaked
//   顺序声明, state_start=1, int=PUSH8+i64LE=9B, byte32=PUSH32+32B=33B — 跟 V1 _splicePayoutCloseRedeem 同编码
//   约定)。NWT 独立按源码 derive 核实一致(2026-07-07 review), 但**这仍是源码级推导, 落码后必须再用真实编译的
//   PayoutShardV2 实例 + 真实 close_attest 测试 tx 做 byte-exact diff**(NWT/Bettor DoD 钉死, D2 铁律 = byte-exact
//   判据非 code review, 不能只信这次推导)。
const _PSV2_CLOSED_OFF = _PS_STATE_START + 9;     // consolidated_pool(9) 之后 = 10
const _PSV2_PAYOUTROOT_OFF = _PS_STATE_START + 18;  // + closed(9) = 19
const _PSV2_ATTESTEDWINNER_OFF = _PS_STATE_START + 204;  // + payoutRoot(33) + w0..w16(17×9=153) = 19+33+153 = 205
const _PSV2_ATTESTEDATMS_OFF = _PS_STATE_START + 213;    // + attestedWinner(9) = 214
const _PSV2_BETSROOT_OFF = _PS_STATE_START + 222;        // + attestedAtMs(9) = 223
const _PSV2_REFUNDROOT_OFF = _PS_STATE_START + 255;      // + betsRoot(33) = 256
const _PSV2_STATE_END_OFF = _PS_STATE_START + 288;       // + refundRoot(33) = 289

// test-only export (byte-exact diff 验收用, NWT/Bettor DoD): production 内部只经 verifyClosePayoutV2Binding 调用。
export function _splicePayoutV2CloseRedeem(psv2RedeemHex, { newPayoutRootHex, newAttestedWinner, newBetsRootHex, newRefundRootHex, newAttestedAtMs }) {
  const redeem = Buffer.from(String(psv2RedeemHex), 'hex');
  const root = Buffer.from(String(newPayoutRootHex).replace(/^0x/, ''), 'hex');
  const betsRoot = Buffer.from(String(newBetsRootHex).replace(/^0x/, ''), 'hex');
  const refundRoot = Buffer.from(String(newRefundRootHex).replace(/^0x/, ''), 'hex');
  if (root.length !== 32) throw new Error(`newPayoutRoot 非 32B (got ${root.length})`);
  if (betsRoot.length !== 32) throw new Error(`newBetsRoot 非 32B (got ${betsRoot.length})`);
  if (refundRoot.length !== 32) throw new Error(`newRefundRoot 非 32B (got ${refundRoot.length})`);
  if (redeem.length < _PSV2_STATE_END_OFF) throw new Error(`psv2Redeem 太短 (${redeem.length}B, 需 ≥ ${_PSV2_STATE_END_OFF}) — 非 PayoutShardV2 redeem?`);
  const closedField = Buffer.concat([Buffer.from([0x08]), _i64LE(1)]);
  const rootField = Buffer.concat([Buffer.from([0x20]), root]);
  const attestedWinnerField = Buffer.concat([Buffer.from([0x08]), _i64LE(newAttestedWinner)]);
  const attestedAtMsField = Buffer.concat([Buffer.from([0x08]), _i64LE(newAttestedAtMs)]);
  const betsRootField = Buffer.concat([Buffer.from([0x20]), betsRoot]);
  const refundRootField = Buffer.concat([Buffer.from([0x20]), refundRoot]);
  return Buffer.concat([
    redeem.slice(0, _PSV2_CLOSED_OFF), closedField,
    redeem.slice(_PSV2_CLOSED_OFF + 9, _PSV2_PAYOUTROOT_OFF), rootField,
    redeem.slice(_PSV2_PAYOUTROOT_OFF + 33, _PSV2_ATTESTEDWINNER_OFF), attestedWinnerField,
    redeem.slice(_PSV2_ATTESTEDWINNER_OFF + 9, _PSV2_ATTESTEDATMS_OFF), attestedAtMsField,
    redeem.slice(_PSV2_ATTESTEDATMS_OFF + 9, _PSV2_BETSROOT_OFF), betsRootField,
    redeem.slice(_PSV2_BETSROOT_OFF + 33, _PSV2_REFUNDROOT_OFF), refundRootField,
    redeem.slice(_PSV2_REFUNDROOT_OFF + 33),
  ]).toString('hex');
}

/**
 * D2-V2 (W2): 验【被签 tx 实际 commit 的全部 5 个新/改值】(payoutRoot + attestedWinner + betsRoot + refundRoot +
 * attestedAtMs), 不是 caller 旁路标量。跟 V1 verifyClosePayoutRootBinding 同一防线, 扩展到 V2 新增字段
 * (D2 草稿 §"D2-style tx-binding 扩展": 逐个反解比对, 任一不匹配 fail-closed)。
 * ⚠ version>=1 malleability gate 照抄 V1(NWT finding④: 不能丢) — covenant binding 仅 sighash 覆盖于 tx.version>=1。
 */
function verifyClosePayoutV2Binding({ txSafeJson, psv2RedeemHex, reDerivedRoot, attestedWinner, betsRootHex, refundRootHex, attestedAtMs }) {
  let signedTx;
  try { signedTx = JSON.parse(String(txSafeJson || '')); } catch { return { ok: false, reason: 'D2-V2: txSafeJson parse fail — 无法验被签 tx commit 的值 (弃签)' }; }
  const _ver = signedTx.version;
  if (typeof _ver !== 'number' || !Number.isInteger(_ver) || _ver < 1) return { ok: false, reason: `D2-V2: tx.version=${JSON.stringify(_ver)} 非 native-int 或 <1 — covenant binding 仅 v>=1 被 sighash 覆盖, fail-closed 弃签` };
  let expectedSpk;
  try {
    expectedSpk = _p2shSpkHex(_splicePayoutV2CloseRedeem(psv2RedeemHex, {
      newPayoutRootHex: reDerivedRoot, newAttestedWinner: attestedWinner,
      newBetsRootHex: betsRootHex, newRefundRootHex: refundRootHex, newAttestedAtMs: attestedAtMs,
    }));
  } catch (e) { return { ok: false, reason: `D2-V2: continuation redeem splice fail (${e.message})` }; }
  const covOuts = (Array.isArray(signedTx.outputs) ? signedTx.outputs : []).filter(o => o && o.covenant && o.covenant.covenantId);
  if (covOuts.length === 0) return { ok: false, reason: 'D2-V2: 被签 tx 无 covenant continuation output — 非合法 close_attest (弃签)' };
  for (const o of covOuts) {
    if (String(o.scriptPublicKey || '').toLowerCase() !== expectedSpk) {
      return { ok: false, reason: `D2-V2 REJECT: 被签 tx continuation output commit 的值 != re-derive (payoutRoot/attestedWinner/betsRoot/refundRoot/attestedAtMs 任一漂) — settler 旁路标量伪装 (spk ${String(o.scriptPublicKey).slice(0, 24)}.. != expected ${expectedSpk.slice(0, 24)}..)`, expectedSpk };
    }
  }
  return { ok: true, expectedSpk, matchedOutputs: covOuts.length };
}

/**
 * ⚠ 共享核心验证链 (V1/V2 分叉防护, W2 2026-07-07): 这段逻辑是 enforceCloseAttest(V1)/enforceCloseAttestV2 共用的
 * 委员归属→predicate hash-bind→frozen evidence→judgeLine→committee链锚→bettor集验证→payoutRoot重导出 全链。
 * **改这条验证链必须同步检查 V1(enforceCloseAttest)/V2(enforceCloseAttestV2) 两侧调用点是否都要跟着变**
 * (同 PayoutShard.sil↔PayoutShardV2.sil 现有的 REGRESSION-safe 关系标注手法)。V1/V2 各自只处理自己专属的最后一段
 * (V1 到 payoutRoot D2/C3 为止；V2 额外核 4 个新字段 + 扩展 D2, 见 enforceCloseAttestV2)。
 * 后续工单(非今天): 等 ZK-native 跑稳后再抽出更薄的 wrapper, 现阶段两个导出函数各自完整以防漂移。
 *
 * @returns {Promise<{pass:true, verdict, winningDirection, committee, bettors, reDerivedRoot}|{pass:false, reason}|{skip:true, reason}>}
 */
// test-only export (blockhash_parity 分支单测用, NWT/Bettor DoD): production 内部只经 enforceCloseAttest/V2 调用。
export async function _enforceCloseAttestCore(signRequest, ctx) {
  const {
    market_id, predicate, proposed_evidence, psRedeemHex,
    committee_pk, broker_pk, introducer_pk = null, data_source_canonical = null,
  } = signRequest;

  // 1. am I a committee member for this market? (else not-my-business)
  const myPk = String(committee_pk || '').toLowerCase();
  if (!ctx.myOracleKeys?.map(k => k.toLowerCase()).includes(myPk)) {
    return { skip: true, reason: 'committee_pk not one of my oracle keys' };
  }

  // 2. 命门① predicate hash-bind — verify against ON-CHAIN commit (PS redeem offset-518), NOT a caller param.
  //    fee markets bake computeMarketCommit(predicate, fee_recipients); predicate-only markets computePredicateCommit;
  //    🔴 predicate-null 市场(blockhash_parity/zk_native 首证 3o6cs 坐实, W2 2026-07-07·Bettor 批第3处窄修): 创建侧
  //    (pool.js:1517) `predicateCommit = _predicate ? computeMarketCommit(...) : market.market_metadata_hash` ——
  //    predicate 为 null 时根本不走 computeMarketCommit/computePredicateCommit, 而是直接烤 market_metadata_hash。
  //    这条既有的两分支判定(feeMarket?computeMarketCommit:computePredicateCommit)从设计起没覆盖这个第三种情况——
  //    3o6cs 是第一个真正走到这里的 predicate-null 市场, 之前没人撞过。
  //    比对基准 = ctx.marketMetadataHash(daemon 本地 market 行, buildEnforceCtx 注入, 同 deadlineDaa/resolutionRuleSpec
  //    一样的信任边界——委员自己查的本地 DB, 绝不从 signRequest/proposal 读)。HTTP/feeMarket 两条既有分支逐字不动。
  const onChainCommit = String(psRedeemHex).slice(_PREDICATE_COMMIT_REDEEM_OFFSET * 2, (_PREDICATE_COMMIT_REDEEM_OFFSET + 32) * 2);
  const feeMarket = !!broker_pk;
  let expectedCommit;
  if (predicate == null) {
    if (!ctx.marketMetadataHash) return { pass: false, reason: '命门①: predicate=null 但 ctx.marketMetadataHash 缺 (daemon 未注入本地 market_metadata_hash, 拒签)' };
    expectedCommit = String(ctx.marketMetadataHash).toLowerCase();
  } else {
    expectedCommit = feeMarket
      ? computeMarketCommit(predicate, { brokerPk: broker_pk, introducerPk: introducer_pk })
      : computePredicateCommit(predicate);
  }
  if (expectedCommit !== onChainCommit) {
    return { pass: false, reason: `命门① hash-bind FAIL: ${expectedCommit.slice(0, 14)} != on-chain redeem[518] ${onChainCommit.slice(0, 14)} (假 predicate/fee 地址/market_metadata_hash)` };
  }
  // chain-bound check (redeem 不可伪): daemon should also verify p2sh(psRedeemHex) == the signed PS input's
  //   on-chain address via ctx.rcOn check_utxo_landed (= 命门① 的链锚, 同今天手动流). [daemon ctx hook]

  // 3-4. winningSide 判定 — 按 judge_type 分两条路径 (W2 blockhash_parity 分支, J2 2026-07-07, Bettor 批):
  //   ⚠ 这不是新判定权——bshard-settle-daemon.mjs judgeWinDir 的 driver-side 旧路径早就有 blockhash_parity 分支,
  //   本次只是把它接进【自治委员验证链】(V1 从设计起从未覆盖这个 judge_type, 3o6cs 是第一个走到这里的市场)。
  let verdict, winningDirection;
  const judgeType = ctx.resolutionRuleSpec?.judge_type;
  if (judgeType === 'blockhash_parity') {
    // 纯链上区块哈希奇偶——委员各自读自己链, 零外部信任面(比 HTTP evidence 路径更干净的 verify-value-source)。
    // 🔴 钉①(Bettor 2026-07-07): target_daa 只从 ctx.resolutionRuleSpec 读(daemon 自己本地 market 行, 非 signRequest/
    //   proposal 字段)——否则 settler 换 target_daa 就能换判定结果, 3o6cs 的 predicate 本身是 null(resolution_predicate
    //   未设置, 命门①已核对匹配链上烤值), target_daa 天然没有 hash-bind 载体, daemon 自己的可信本地读是唯一防线。
    const targetDaa = Number(ctx.resolutionRuleSpec.target_daa);
    if (!Number.isFinite(targetDaa) || targetDaa <= 0) {
      return { pass: false, reason: `blockhash_parity: 非法 target_daa (来自本地 market.resolution_rule_spec, 弃签)` };
    }
    if (typeof ctx.chainReader?.getCurrentDaaScore !== 'function' || typeof ctx.chainReader?.getBlockAtDaa !== 'function') {
      return { pass: false, reason: 'blockhash_parity: ctx.chainReader 缺 getCurrentDaaScore/getBlockAtDaa (弃签)' };
    }
    const curDaa = await ctx.chainReader.getCurrentDaaScore();
    // 🔴 钉②(Bettor 2026-07-07): 未到期(cur_daa < target_daa) 必须拒签, 镜像 judgeWinDir 的 ABSTAIN throw——
    //   不是默认放行, 任何人在市场到期前发起 close_request, 委员都必须拒(防抢跑判定)。
    if (curDaa < targetDaa) {
      return { pass: false, reason: `blockhash_parity 命门③: target DAA ${targetDaa} 未到 (当前 ${curDaa}) — 未到期拒签 (镜像 judgeWinDir ABSTAIN)` };
    }
    const { hash } = await ctx.chainReader.getBlockAtDaa(targetDaa);
    const lastByte = parseInt(String(hash).slice(-2), 16);
    if (!Number.isFinite(lastByte)) {
      return { pass: false, reason: `blockhash_parity: 无法解析区块哈希末字节 ${String(hash).slice(0, 12)} (弃签)` };
    }
    winningDirection = lastByte % 2 === 0 ? 0 : 1;   // 偶→YES(0)/奇→NO(1), 跟 judgeWinDir/ESPN/polymarket 同一 value-mapping
    verdict = winningDirection === 0 ? 'YES' : 'NO';
  } else {
    // 既有 HTTP evidence 路径(一字不改) — frozen_evidence 同源 (J1 lead) + judgeLine。
    //    ⚠ 载重一致性 (NWT inner-一致性的 fetch-面延伸, J1 12:59 实测): 命门① computeMarketCommit/judgeLine 用的是
    //      【inner predicate {metric,op,operand}】(create-v07 pool.js:1183 烤的, 无 data_source_canonical), 但
    //      verifyFrozenEvidence→fetchCanonicalEvidence 需 data_source_canonical 取源(它在 wrapper resolution_rule_spec
    //      不在 inner)。∴ data_source_canonical 必【单独传】(daemon 从 market wrapper 取); commit/judge 用纯 inner
    //      (匹配链上烤), fetch 用 inner+data_source 合并。否则: predicate 含 data_source 烤 commit→不符链上; 缺则 fetch 弃签。
    const evidencePredicate = (data_source_canonical && !predicate?.data_source_canonical)
      ? { ...predicate, data_source_canonical }
      : predicate;   // 向后兼容: predicate 已含 data_source(旧/合并测试) 直接用
    const ev = await verifyFrozenEvidence(evidencePredicate, proposed_evidence, ctx);
    if (!ev.match) return { pass: false, reason: `frozen_evidence: ${ev.reason}` };

    const v = judgeLine(predicate, ev.ownFetch);
    if (v !== 'YES' && v !== 'NO') {
      return { pass: false, reason: `judgeLine=${v} (abstain-not-guess: 字段不足/无法判, 弃签)` };
    }
    winningDirection = v === 'YES' ? 0 : 1;
    verdict = v;
  }

  // 5. fix① committee chain-anchored re-derive (ZERO caller/DB trust) — DON'T trust signRequest.committeePks.
  //    seed = deriveCommitteeSeed(market_id, endBlockHash[自算], pool_merkle_root[链上读]); members verified ∈ root.
  let committee;
  try {
    committee = await reDeriveCommittee(market_id, ctx, psRedeemHex);   // C2-anchor: psRedeemHex 供链锚 poolMerkleRoot 读
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
  // PS-level complete-set 链锚: 从被签 tx 的 PS input redeem(命门①已验 p2sh==landed 链锚)读 consolidated_pool 喂 C1。
  //   (ctx 已带则不覆盖; cross-node daemon 也可自传。)
  const completeCtx = (ctx.psConsolidatedPool == null)
    ? { ...ctx, psConsolidatedPool: _readPsConsolidatedPool(psRedeemHex) }
    : ctx;
  const cs = await completeFn(market_id, bettors, completeCtx);
  if (!cs || cs.ok !== true) return { pass: false, reason: `C1: ${cs?.reason || 'bettor 集不完整 (链上 shard 重建 != loaded)'}` };
  const poolSompi = bettors.reduce((s, b) => s + BigInt(b.stake), 0n).toString();
  const { feeLeaves } = deriveFeeLeaves({
    poolSompi, feeConfig: FEE_CONFIG, brokerPk: broker_pk, introducerPk: introducer_pk, committeePks: committee,
  });
  const pm = computePariMutuelPayout({ bettors, winningDirection, feeLeaves });
  if (pm.degenerate) return { pass: false, reason: `degenerate (${pm.reason}) — 单边池需 refund 路` };
  const reDerivedRoot = settlePayoutRoot(pm.payoutLeaves && pm.payoutLeaves.length ? pm.payoutLeaves : pm.winners);

  return { pass: true, verdict, winningDirection, committee, bettors, reDerivedRoot };
}

/**
 * Autonomous close_attest enforce (V1 / PayoutShard). Returns {pass, reason?, verdict?, skip?}.
 *  - skip:true  → this node isn't a committee member for this market (daemon: not-my-business, no sig, not a fail).
 *  - pass:false → enforce rejected (daemon: 弃签, don't broadcast sig — the load-bearing defense).
 *  - pass:true  → daemon proceeds to sign_input_for_settle on the local relay.
 *
 * ⚠ V1/V2 分叉防护: 委员归属→...→payoutRoot 重导出这段逻辑现在活在 _enforceCloseAttestCore (见上)。改这段
 * 必须同步检查 enforceCloseAttestV2 是否也要跟着变。本函数只处理 V1 专属的最后一段 (D2/C3 payoutRoot binding)。
 *
 * @param {object} signRequest {market_id, predicate, proposed_evidence, claimedPayoutRoot, psRedeemHex,
 *                              committee_pk, broker_pk, introducer_pk?}  (from metadata.bshard_close_request)
 * @param {object} ctx {myOracleKeys:string[](lowercase x-only), chainReader, db, fetchEndBlockHashCanonical,
 *                       loadPoolSnapshot, loadBettors, deadlineDaa}  (daemon-injected)
 */
export async function enforceCloseAttest(signRequest, ctx) {
  const core = await _enforceCloseAttestCore(signRequest, ctx);
  if (core.skip || core.pass === false) return core;
  const { verdict, reDerivedRoot } = core;
  const { claimedPayoutRoot, psRedeemHex } = signRequest;

  // ── D2 FIX (NWT 红队最承重 = verify-value-source): 验【被签 txSafeJson 实际 commit 的根】, 不是 caller 旁路标量 ──
  //   旧码只 `reDerivedRoot != claimedPayoutRoot` (标量) → settler 给匹配标量 + 输出含恶意根的 tx 即可绕过。
  //   D2 = 从被签 tx 的 covenant continuation output 反解 P2SH-embedded payoutRoot 验它 == re-derive (sighash 覆盖)。
  const d2 = verifyClosePayoutRootBinding({ txSafeJson: signRequest.txSafeJson, psRedeemHex, reDerivedRoot });
  if (!d2.ok) return { pass: false, reason: d2.reason };
  // defense-in-depth (非 load-bearing, D2 上面已绑被签 tx): caller 标量也须一致 → 早报错配。
  if (String(claimedPayoutRoot) !== reDerivedRoot) {
    return { pass: false, reason: `命门③/④ payoutRoot REJECT: re-derive ${reDerivedRoot.slice(0, 14)} != claimed scalar ${String(claimedPayoutRoot).slice(0, 14)} (假 winningSide/委员/fee)` };
  }

  // ── C3 FIX (NWT 红队 TOCTOU): 返【我 D2-验过的那个 tx 的 hash】。daemon 必验它 sign_input_for_settle 的 tx hash == 此值,
  //    否则 enforce 验了 tx-A 却签了 tx-B = enforce 被绕。daemon 签前 assert signedTxHash === verifiedTxHash。
  //    (D2+C3 合: verifiedTxHash 绑的正是 D2 验过 continuation-root 的同一 txSafeJson 串。)
  const verifiedTxHash = Buffer.from(blake2b(Buffer.from(String(signRequest.txSafeJson || '')), { dkLen: 32 })).toString('hex');
  return { pass: true, verdict, verifiedTxHash };
}

// attestedAtMs 值域下限/上限 (zk_handoff 同款 bounds guard, PayoutShardV2.sil `require(attestedAtMs>=2^40); require(<2^47)`)。
const _ATTESTED_AT_MS_MIN = 1099511627776;      // 2^40 (~2004)
const _ATTESTED_AT_MS_MAX = 140737488355328;    // 2^47 (~4453) — 上限极宽, 只防位宽溢出, 非合理性判据
// wall-clock sanity 容差 (NWT finding② + Bettor 裁定 10min, 配 5-委员签名流程时长, 可调)。
const _ATTESTED_AT_MS_CLOCK_TOLERANCE_MS = 10 * 60 * 1000;

/**
 * Autonomous close_attest enforce (V2 / PayoutShardV2, ZK-native, W2 2026-07-07). Returns {pass, reason?, verdict?, skip?}.
 * 同 enforceCloseAttest(V1) 的 skip/pass 语义, 但对 4 个新增 witness 字段 (new_attestedWinner/new_betsRoot/
 * new_refundRoot/new_attestedAtMs) 做委员独立重算/范围核对 (NWT 2026-07-07 review GREEN-with-2-findings,
 * 已折进本实现: gatherOrderedBets 本地 id 序改用链锚 canonicalBetOrder + attestedAtMs 加 wall-clock sanity)。
 *
 * ⚠ V1/V2 分叉防护: 共用验证链在 _enforceCloseAttestCore (见上), 改那段必须同步检查 V1 是否也要跟着变。
 *
 * @param {object} signRequest {market_id, predicate, proposed_evidence, claimedPayoutRoot, psRedeemHex(=V2 redeem),
 *                              committee_pk, broker_pk, introducer_pk?, txSafeJson,
 *                              new_attestedWinner, new_betsRoot, new_refundRoot, new_attestedAtMs}
 * @param {object} ctx 同 enforceCloseAttest ctx
 */
export async function enforceCloseAttestV2(signRequest, ctx) {
  const core = await _enforceCloseAttestCore(signRequest, ctx);
  if (core.skip || core.pass === false) return core;
  const { verdict, winningDirection, bettors, reDerivedRoot } = core;
  const {
    claimedPayoutRoot, psRedeemHex, new_attestedWinner, new_betsRoot, new_refundRoot, new_attestedAtMs,
  } = signRequest;

  // ── new_attestedWinner: 已经算出来了(core.winningDirection), 直接复用, 非新逻辑, 只核一致 ──
  const attestedWinner = Number(new_attestedWinner);
  if (attestedWinner !== winningDirection) {
    return { pass: false, reason: `W2: new_attestedWinner=${attestedWinner} != 委员自判 winningDirection=${winningDirection} (假赢家)` };
  }

  // ── new_attestedAtMs: (a) bounds check [2^40,2^47) 同 zk_handoff 链上 guard 值域 (b) wall-clock sanity ──
  //   (a)(b) 都是"独立核对", 不止位宽 check (NWT finding②: 光位宽通过不代表值合理, 必核跟委员自己 wall-clock 的偏差)。
  const attestedAtMs = Number(new_attestedAtMs);
  if (!Number.isFinite(attestedAtMs) || attestedAtMs < _ATTESTED_AT_MS_MIN || attestedAtMs >= _ATTESTED_AT_MS_MAX) {
    return { pass: false, reason: `W2: new_attestedAtMs=${new_attestedAtMs} 越界 [${_ATTESTED_AT_MS_MIN},${_ATTESTED_AT_MS_MAX}) (非法值域/位宽溢出风险)` };
  }
  const nowMs = ctx.nowMs != null ? Number(ctx.nowMs) : Date.now();   // ctx.nowMs 可注入(offline 自测), 缺省真实时钟
  const clockDeltaMs = Math.abs(attestedAtMs - nowMs);
  if (clockDeltaMs > _ATTESTED_AT_MS_CLOCK_TOLERANCE_MS) {
    return { pass: false, reason: `W2: new_attestedAtMs 跟委员自己 wall-clock 偏差 ${clockDeltaMs}ms > 容差 ${_ATTESTED_AT_MS_CLOCK_TOLERANCE_MS}ms (driver 可能喂了远离真实 attest 时刻的值, escapeRefund GRACE 锚点被扭曲风险, 弃签)` };
  }

  // ── new_betsRoot: 委员自己按 canonical 链锚序(side_lock_daa+side_lock_tx tiebreak)重算, 非 driver 喂的本地 id 序 ──
  //   (NWT finding①: gatherOrderedBets 本地 id 序在多节点独立重算场景会跨节点分叉, 必须用链锚可收敛序)。
  let betsRootHex;
  try {
    const ordered = canonicalBetOrder(bettors);
    const bets = ordered.map(b => ({ pk: b.pk, stake: b.stake, direction: b.direction }));
    betsRootHex = computeBetsRoot(bets).toString('hex');
  } catch (e) {
    return { pass: false, reason: `W2: betsRoot 重算 fail (${e.message}) — 弃签(不猜)` };
  }
  if (betsRootHex !== String(new_betsRoot).replace(/^0x/, '').toLowerCase()) {
    return { pass: false, reason: `W2 REJECT: betsRoot re-derive ${betsRootHex.slice(0, 14)} != claimed ${String(new_betsRoot).slice(0, 14)} (假 bets 集/序)` };
  }

  // ── new_refundRoot: 同批 bettor 数据(pk+stake=自己的全额退款), 复用 payoutRoot 的 depth-10 merkle 公式(refund=100%退) ──
  //   ⚠ 自查补(J2, 同 betsRoot 一样的跨节点分叉风险): payoutRoot 是 position-aware merkle(叶子落哪个 index 由数组序决定),
  //   非 hash-chain,但序依然影响结果——必须用同一份 canonicalBetOrder(链锚序), 不能用 ctx.loadBettors 的本地/DB 返回序
  //   (差点在这里重蹈 betsRoot 已修过的同一个坑, 落码时自己抓到, 复用上面已算好的 `ordered`)。
  let refundRootHex;
  try {
    const winners = ordered.map(b => ({ pk: b.pk, amount: b.stake }));
    refundRootHex = computeMerkleRoot(winners).toString('hex');
  } catch (e) {
    return { pass: false, reason: `W2: refundRoot 重算 fail (${e.message}) — 弃签(不猜)` };
  }
  if (refundRootHex !== String(new_refundRoot).replace(/^0x/, '').toLowerCase()) {
    return { pass: false, reason: `W2 REJECT: refundRoot re-derive ${refundRootHex.slice(0, 14)} != claimed ${String(new_refundRoot).slice(0, 14)} (假 bettor 集/stake)` };
  }

  // ── D2-V2: 验被签 tx 实际 commit 的全部 5 个值(payoutRoot+attestedWinner+betsRoot+refundRoot+attestedAtMs) ──
  const d2 = verifyClosePayoutV2Binding({
    txSafeJson: signRequest.txSafeJson, psv2RedeemHex: psRedeemHex, reDerivedRoot,
    attestedWinner, betsRootHex, refundRootHex, attestedAtMs,
  });
  if (!d2.ok) return { pass: false, reason: d2.reason };
  // defense-in-depth (非 load-bearing, D2 上面已绑被签 tx): caller 标量也须一致。
  if (String(claimedPayoutRoot) !== reDerivedRoot) {
    return { pass: false, reason: `命门③/④ payoutRoot REJECT: re-derive ${reDerivedRoot.slice(0, 14)} != claimed scalar ${String(claimedPayoutRoot).slice(0, 14)} (假 winningSide/委员/fee)` };
  }

  // ── C3 (同 V1): 返【我 D2-验过的那个 tx 的 hash】, daemon 签前必核 == 此值 ──
  const verifiedTxHash = Buffer.from(blake2b(Buffer.from(String(signRequest.txSafeJson || '')), { dkLen: 32 })).toString('hex');
  return { pass: true, verdict, verifiedTxHash, betsRootHex, refundRootHex };
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

// ── C2-anchor: 从链锚 PS redeem 读 genesis-烤 poolMerkleRoot ──
//   poolMerkleRoot 是 PayoutShard ctor byte[32] 常量, silverc inline 在每个 require(cXCur == poolMerkleRoot) 站点 (probe: 共 10×)。
//   close_attest 5 委员 merkle 校验 = 5 个 inlined 副本 @ offsets 1002/1266/1530/1794/2058 (264B 等距, PUSH32 前缀)。
//   读这 5 个并 cross-check 必全相等 (任一不符 = 非-canonical .sil / silverc build-drift → throw fail-loud, 永不 wrong-pass)。
//   ⚠ .sil-pinned (= offset-518 predicate_commit 同款 fragility): PayoutShard 22-arg shape。 .sil 变则 offsets 变 → cross-check
//     自动 fail-loud (安全降级, 非静默错读)。J2 daemon 应优先用 ctx.onChainPoolMerkleRoot (scout 链读 PS state) 绕过 offset 依赖。
const _PMR_COMMITTEE_CHECK_OFFSETS = [1002, 1266, 1530, 1794, 2058];
export function extractOnChainPoolMerkleRoot(psRedeemHex) {
  const redeem = Buffer.from(String(psRedeemHex), 'hex');
  const reads = [];
  for (const o of _PMR_COMMITTEE_CHECK_OFFSETS) {
    if (redeem.length < o + 32 || redeem[o - 1] !== 0x20) {
      throw new Error(`poolMerkleRoot offset ${o} 非 PUSH32 / redeem 太短 (${redeem.length}B) — 非 canonical PayoutShard redeem (.sil drift?)`);
    }
    reads.push(redeem.slice(o, o + 32).toString('hex').toLowerCase());
  }
  if (!reads.every(r => r === reads[0])) {
    throw new Error(`poolMerkleRoot inlined 副本不一致 [${reads.map(r => r.slice(0, 8)).join(',')}] — 非 canonical / build-drift (fail-loud)`);
  }
  return reads[0];
}

/**
 * fix① committee chain-anchored re-derive (ZERO caller). seed = deriveCommitteeSeed(marketId, endBlockHash, poolMerkleRoot).
 *  - endBlockHash: ctx.fetchEndBlockHashCanonical(chainReader, deadline_daa) — 自算, anti-grinding, NOT passed.
 *  - poolMerkleRoot: read from on-chain PS/spine ctor (chain-anchored). [hardening: read from redeem, not DB]
 *  - poolMembers: ctx.loadPoolSnapshot(marketId) → verify buildPoolMerkleTree(members) == on-chain poolMerkleRoot.
 *  - excludePks: maker_pk + broker_pk (same-PK 双角色防), chain-anchored.
 */
export async function reDeriveCommittee(marketId, ctx, psRedeemHex = null) {
  const snap = await ctx.loadPoolSnapshot(marketId);    // {pool_merkle_root, members:[{pk_hex, stake_sompi}], maker_pk, broker_pk}
  if (!Array.isArray(snap.members) || snap.members.length === 0) throw new Error('C2: empty/invalid pool members');

  // ── C2-anchor FIX (NWT 红队 'poolMerkleRoot 锚软'): poolMerkleRoot 必【链锚】, 不静默信 DB ──
  //   旧码用 snap.pool_merkle_root (DB/snapshot) 当种子 + wantRoot → settler 中继假 root → 自选他控委员会。
  //   修 = 从【链上 PS redeem】(chain-anchored, daemon p2sh-verified, 同命门① offset-518 锚) 读 genesis-烤 poolMerkleRoot,
  //   DB root 必 == 它 (否则 fail-loud)。onChain 优先 ctx.onChainPoolMerkleRoot (daemon scout 链读注入); 缺则从 psRedeemHex 抽。
  const redeemForRoot = psRedeemHex || ctx.psRedeemHex || null;
  let onChainRoot = ctx.onChainPoolMerkleRoot != null ? String(ctx.onChainPoolMerkleRoot).toLowerCase() : null;
  if (!onChainRoot && redeemForRoot) {
    try { onChainRoot = extractOnChainPoolMerkleRoot(redeemForRoot); } catch (e) { throw new Error(`C2-anchor: poolMerkleRoot 链读失败 (${e.message})`); }
  }
  if (!onChainRoot) throw new Error('C2-anchor: 无 chain-anchored poolMerkleRoot (ctx.onChainPoolMerkleRoot / psRedeemHex 都缺) — 拒静默信 DB root (fail-loud)');
  const dbRoot = String(snap.pool_merkle_root || '').toLowerCase();
  if (dbRoot && dbRoot !== onChainRoot) throw new Error(`C2-anchor: DB poolMerkleRoot ${dbRoot.slice(0, 16)} != 链上 ${onChainRoot.slice(0, 16)} (DB 篡改/settler 中继, fail-loud)`);

  // ── C2 完整有序成员集 (子集攻击防): buildPoolMerkleTree(全集 pks) == 链锚 poolMerkleRoot ──
  //   attacker 供子集(漏诚实成员)→ selectCommittee 种子从子集选他控委员会; 子集 → 建出 root ≠ 链锚 → reject。
  const built = buildPoolMerkleTree(snap.members.map(m => m.pk_hex));
  const builtRoot = (built.root?.toString ? built.root.toString('hex') : String(built.root)).toLowerCase();
  if (builtRoot !== onChainRoot) {
    throw new Error(`C2: 成员集非完整 — buildPoolMerkleTree ${builtRoot.slice(0, 16)} != 链锚 poolMerkleRoot ${onChainRoot.slice(0, 16)} (子集攻击防, NWT)`);
  }
  const deadlineDaa = Number(ctx.deadlineDaa ?? snap.deadline_daa);
  const endBlockHash = await ctx.fetchEndBlockHashCanonical(ctx.chainReader, deadlineDaa);
  const seed = deriveCommitteeSeed(marketId, endBlockHash, onChainRoot);   // 种子用【链锚 root】(非 DB) → 委员选择 settler 不可 grind
  const exclude = [snap.maker_pk, snap.broker_pk].filter(Boolean).map(p => String(p).toLowerCase());
  // committee-exclude 必完整匹配 production sampleAndStoreCommittee(v06 L333-362): maker+broker+【BETTORS】(同市场投注 oracle
  //   不判自己下注的市场, #27a)。原只排 maker/broker 漏 bettor → bettor∈oracle pool 时委员集 != sampling = enforce 误拒/误判
  //   (J1 2026-06-23 reconcile 抓; ozzeu fresh-key bettor∉pool 被 mask)。chain-anchored: side_lock_daa<=deadline_daa
  //   (跨节点确定, 同 sample 单源); NULL=fail-loud throw (镜像 sample L359-361 防 cross-node fork)。NWT verify-value-source 钉。
  // bettor-exclude MANDATORY (sample 总排 bettors): loadBettors 缺失/deadline 非法 = 无法应用必需 exclude → fail-loud
  //   (NWT C2 review: 静默 skip 掩盖 wiring misconfig → 委员集发散 != sample → settle 风险)。loadBettors 返 [] = 真无 bettor = graceful。
  if (typeof ctx.loadBettors !== 'function') throw new Error('committee-exclude: ctx.loadBettors 缺 — 无法应用 sample 同款 bettor-exclude, fail-loud 防静默委员集发散 (NWT)');
  if (!Number.isFinite(deadlineDaa) || deadlineDaa <= 0) throw new Error(`committee-exclude: deadlineDaa 非法 (${deadlineDaa}) — 无法 chain-anchor bettor-exclude, fail-loud (镜像 sample #27a)`);
  const bettors = await ctx.loadBettors(marketId);
  for (const b of (bettors || [])) {
    if (b.side_lock_daa == null) throw new Error(`committee-exclude: bettor ${String(b.pk).slice(0, 10)} 无 side_lock_daa (fail-loud 防 cross-node fork, 镜像 sample L359-361)`);
    if (Number(b.side_lock_daa) <= deadlineDaa) exclude.push(String(b.pk).toLowerCase());
  }
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
  // shard 来源: cross-node = ctx.shards (sign-request snapshot, 只 hint 指路; 每 {shard_index, shard_redeem_hex,
  //   current_leaf_state, current_leaf_outpoint, shard_pool_id, bettors?}); local = listShards(ctx.db)。
  //   NWT 铁律: snapshot 只指路, state/Σ/ticket 全靠【链锚验】(p2sh(spliceLeafState)==landed) 非信 snapshot 值。
  let shards = Array.isArray(ctx.shards) ? ctx.shards : null;
  if (!shards) {
    if (!ctx.db) return { ok: false, reason: 'C1: ctx.shards(snapshot) 与 ctx.db 都缺 — 无 shard 来源 (fail-loud)' };
    shards = listShards(ctx.db, logicalMarketId);
  }
  // (A)-model 判定: 无 shard → 非 rolling-shard (fee-only/旧) → 级2 N/A; 但有 PayoutShard 却 shard 空 → 篡改 fail-loud。
  if (!shards.length) {
    let hasPS = false;
    try { hasPS = ctx.db ? !!ctx.db.prepare(`SELECT 1 FROM payout_shards WHERE logical_market_id = ? LIMIT 1`).get(logicalMarketId) : false; } catch { /* 非 (A) 环境 */ }
    if (hasPS) return { ok: false, reason: 'C1: payout_shards 存在但 shards 空 — (A)-model shard 数据缺失/篡改 (fail-loud, 堵绕 C1)' };
    return { ok: true, applicable: false, reason: 'no shards + no PayoutShard — 非 (A)-model rolling-shard 市场, 级2 N/A' };
  }
  if (typeof ctx.p2sh !== 'function' || typeof ctx.checkUtxoLanded !== 'function') {
    // 链锚 primitive 缺 → 只能信 snapshot/DB = 不 trustless → fail-loud (拒静默降级, fix² 教训)。
    return { ok: false, reason: 'C1: ctx.p2sh/checkUtxoLanded 缺 — leaf state 无法链锚 (拒 DB-only/snapshot-only 信任)' };
  }

  // ── 级2-A: 跨片聚合链锚 ──
  let chainCount = 0; let chainYes = 0n; let chainNo = 0n; let chainPool = 0n;
  for (const sh of shards) {
    let st = null;
    // snapshot 可传 obj 或 JSON string (DB 是 string); 兼容两者。
    try { st = typeof sh.current_leaf_state === 'string' ? JSON.parse(sh.current_leaf_state || 'null') : (sh.current_leaf_state || null); } catch { st = null; }
    if (!st || st.count == null || st.pool_value == null) return { ok: false, reason: `C1: shard ${sh.shard_index} 无 current_leaf_state — fail-loud` };
    if (!sh.shard_redeem_hex || !sh.current_leaf_outpoint) return { ok: false, reason: `C1: shard ${sh.shard_index} 缺 shard_redeem_hex/current_leaf_outpoint — 无法链锚` };
    // chain-anchor (landed-in-history): per-state leaf 地址 == current_leaf_outpoint 创建-tx output 地址。
    // ⚠ level2-A 时序 fix (ozzeu live catch 2026-06-23): (A)-model close 流程先 consolidate (spend ShardLeaf→PS),
    //   enforce 时 leaf UTXO 已 spent → checkUtxoLanded(unspent) 必 false → 委员诚实拒签 (pipeline 卡 0/4)。
    //   改 landed-in-history: 验 leaf outpoint 的【创建-tx output 地址】== p2sh(spliceLeafState) (与 spent 无关)。
    //   provenance+full-state 绑不丢 (Bettor forge-leaf 铁律): 假 state / swap yes-no → spliced 地址变 → 不符 → BUST。
    //   '链上存在但没 consolidate 进本 PS' 的 forge → 由下方 PS-pool 聚合锚抓 (Σloaded != consolidated_pool)。
    //   与 J1 level2-B (ticket landed-in-history) 同 pattern; chainReader hook = ctx.readOutpointCreatedAddr。
    const leafAddr = ctx.p2sh(_spliceLeafState(sh.shard_redeem_hex, st));
    let anchored = false; let anchorMode = '';
    if (typeof ctx.readOutpointCreatedAddr === 'function') {
      // landed-in-history: 读 outpoint 创建-tx output 地址 (spent/unspent 均可), 解 consolidate-spend 时序冲突。
      const createdAddr = await ctx.readOutpointCreatedAddr(sh.current_leaf_outpoint);
      anchored = !!createdAddr && String(createdAddr).toLowerCase() === String(leafAddr).toLowerCase();
      anchorMode = 'landed-in-history';
    } else {
      // 无 landed-in-history hook → 回退 checkUtxoLanded(unspent), 仅 pre-consolidate 有效。
      // consolidate 后 leaf 已 spent → 此回退 false → fail-loud (不静默过, 显式提示需 hook)。
      const [leafTxid] = String(sh.current_leaf_outpoint).split(':');
      anchored = await ctx.checkUtxoLanded(leafAddr, leafTxid);
      anchorMode = 'unspent-fallback';
    }
    if (!anchored) return { ok: false, reason: `C1: shard ${sh.shard_index} leaf state 非链锚 (${anchorMode}: 创建-tx/落地址 != p2sh(spliced) — DB state 篡改? 或 consolidate 后需 ctx.readOutpointCreatedAddr landed-in-history hook)` };
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

  // ── PS-level complete-set 链锚 (J1 提, NWT/Bettor 强化) ── consolidated_pool = consolidate 全片累积链上聚合
  //    (= PS_SEED + Σ all shard pool_value)。验 == PS_SEED + loadPool → 抓 omit-shard 变体①(漏【已 consolidate】片:
  //    consolidated_pool 含它但 loadPool 不含 → BUST) + 片内漏/加/换(Σ 不符)。
  //    ⚠ 残留 [follow-up, NWT/Bettor 13:25 校准, 诚实标]: 变体②(settler 提前 close 子集, 漏的片【未 consolidate】→
  //    consolidated_pool 与 loadPool 都不含 = 自洽 → PASS) 本锚【不抓】— 真硬锚需片集从链上【PS cov_id 单例 lineage
  //    (auto-roll 血缘)】枚举非信 snapshot 片列表。今晚 honest-settler e2e 不触发, 口径标'变体①闭/变体②开'。
  if (ctx.psConsolidatedPool != null) {
    const psPool = BigInt(ctx.psConsolidatedPool);
    const seed = BigInt(ctx.psSeed ?? 20000000);   // register PS_SEED=20M 固定; ctx.psSeed 可覆盖
    if (psPool !== seed + loadPool) {
      return { ok: false, reason: `C1 PS-pool 链锚 BUST: consolidated_pool ${psPool} != PS_SEED(${seed})+Σloaded ${loadPool} (omit-shard 变体①/已-consolidate 片不一致 或 漏/加 bettor)` };
    }
  }

  // ── 级2-B: per-ticket 链锚 (anti-swap) ── 逐 shard 的 loaded bettor recompute ticket 地址 + landed。
  let perTicketChecked = 0;
  let perTicketVerified = false;
  // 级2-B 只认 ctx.deriveTicketAddr 单源 (NWT footgun 修: 删 (silverc && p2sh) compileSil 分支)。
  //   compileSil 路【实测 byte-equal】(Bettor fy1yk-s0 链上 15 dust UTXO 坐实, 非 divergent), 但依赖 canonical
  //   silverc-pin (跨节点 build drift→false-BUST, silverc-build-determinism-pin) → 不作隐式缺省。
  //   ⚠ 口径校正 (J2 verify-not-echo, 防 over-claim): ctx.deriveTicketAddr(relay-IPC) 是【单源避跨节点 drift】,
  //     非【零 silverc】—— ticket 派生需 ps_prefix/suffix 模板 = computePoolSideArtifact(silverc 编译抽), silverc 依赖
  //     在【模板】不在位置, 搬 relay 是搬 silverc 非消 silverc。真 zero-silverc = register 持久化 prefix/suffix 进
  //     market_shards + daemon kaspa-wasm splice (J2 production 硬化, fy1yk 无 backfill); 现 silverc-pin 单源 = working interim。
  const canTicket = typeof ctx.deriveTicketAddr === 'function';
  if (canTicket) {
    for (const sh of shards) {
      const shardPoolId = sh.shard_pool_id || _hex32(`${logicalMarketId}-shard-${sh.shard_index}`);
      // rows 来源: cross-node = sh.bettors (snapshot per-shard, 只 hint 指路); local = ctx.db pool_bettor_sides。
      //   字段兼容 snapshot {pk,direction,stake} 与 DB {bettor_pk,direction,stake_amount}。链锚: addr 必 landed (不信 snapshot)。
      const rows = Array.isArray(sh.bettors)
        ? sh.bettors
        : (ctx.db ? ctx.db.prepare(`SELECT bettor_pk, direction, stake_amount FROM pool_bettor_sides WHERE market_id = ?`).all(sh.shard_market_id) : []);
      for (const r of rows) {
        const rpk = String(r.bettor_pk ?? r.pk ?? '');
        const rdir = Number(r.direction);
        const rstake = BigInt(r.stake_amount ?? r.stake ?? 0);
        const addr = await _deriveTicketAddr(rpk, rdir, rstake, shardPoolId, ctx);
        const landed = await ctx.checkUtxoLanded(addr, null);
        if (!landed) return { ok: false, reason: `C1 anti-swap: bettor ${rpk.slice(0, 10)} (shard ${sh.shard_index}) PoolSide ticket 链上不存在 (pk/dir/stake 被换/伪造?)` };
        perTicketChecked++;
      }
    }
    perTicketVerified = true;
    // 防御: per-shard DB ticket 行总数必 == 链上 Σcount (否则 DB shard 行与链上注册数不符 = 漏/加)。
    if (perTicketChecked !== chainCount) return { ok: false, reason: `C1: per-ticket 行数 ${perTicketChecked} != 链上 Σcount ${chainCount} (DB shard 行与链上不符)` };
  } else {
    // ── 级2-B fail-loud (Bettor A1 红队 / J2 point2①; 修我 8f633291 引入的 silent-skip 洞) ──
    //   到此 shards 非空 = 已确认 (A)-model 市场, 但缺 ctx.deriveTicketAddr (relay-IPC 单源)
    //   → 无法验 anti-identity-swap (settler 换等额 sybil bettor: 聚合 Σ 不变但 per-ticket 地址变) → 命门未闭。
    //   fail-closed 拒签, 绝不静默返 ok:true。配 daemon 默认 OFF (391ed502): 待 J2 wire relay
    //   derive_poolside_ticket_addr (relay-IPC) 才解锁真自治签。
    return {
      ok: false,
      reason: 'C1 级2-B: ctx.deriveTicketAddr (relay-IPC 单源) 缺 — 无法验 anti-identity-swap, fail-closed 拒签 (命门未闭; 待 J2 wire relay derive_poolside_ticket_addr)',
      perTicketVerified: false,
      aggregate: { count: chainCount, pool: chainPool.toString(), yes: chainYes.toString(), no: chainNo.toString() },
    };
  }

  return {
    ok: true,
    aggregate: { count: chainCount, pool: chainPool.toString(), yes: chainYes.toString(), no: chainNo.toString() },
    perTicketChecked, perTicketVerified,
  };
}

/**
 * Re-derive a bettor's PoolSide dust-ticket per-state P2SH via relay-IPC 单源 (J2 relay derive_poolside_ticket_addr)。
 * relay 用【铸 ticket 那套同码】算 (= ps_prefix ‖ [PUSH32 pk + PUSH8 i64LE dir + PUSH8 i64LE stake + PUSH32 shardPoolId] ‖
 *   ps_suffix → p2sh, J2 实证 relay p2sh.mjs _ticketAddress) → 单源 byte-equal (一处算, 避跨节点重算 drift)。
 * ⚠ 口径 (J2 verify-not-echo 校正, 防 over-claim): relay-IPC 是【单源避 drift】非【零 silverc】—— 模板 ps_prefix/suffix
 *   仍 = computePoolSideArtifact(silverc 编译抽), silverc 依赖在模板, 搬 relay = 搬 silverc 非消 silverc。真 zero-silverc
 *   = register 持久化 prefix/suffix 进 market_shards + daemon 纯 kaspa-wasm splice (J2 production 硬化, fy1yk 无 backfill)。
 * 注: console compileSil(PoolSide,[pk,dir,stake,shardPoolId])→p2sh 路【实测 byte-equal】(Bettor fy1yk-s0 链上 15 dust
 *   UTXO 坐实, 非 divergent), 但依赖 canonical silverc-pin (跨节点 build drift 风险) → lib 不内建 compileSil 缺省,
 *   改 ctx.deriveTicketAddr 单源; compileSil 路保留作【显式异源交叉核】(Bettor _bettor_ticket_byteeq.mjs / NWT D:/rusty-kaspa wasm)。
 */
async function _deriveTicketAddr(bettorPk, direction, stake, shardPoolId, ctx) {
  if (typeof ctx.deriveTicketAddr !== 'function') {
    throw new Error('级2-B: ctx.deriveTicketAddr (relay-IPC 单源) 必需 — console compileSil 重造依赖 silverc-pin, 不作内建缺省');
  }
  return await ctx.deriveTicketAddr({ bettorPk, direction, stake: stake.toString(), shardPoolId });
}

export default enforceCloseAttest;
