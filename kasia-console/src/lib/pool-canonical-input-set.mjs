// CanonicalInputSet (CIS) —— D-012 §6-1 冻结前置⑥ 的落码。
// 设计单源: docs/2026-08-06-precond6-candidate-a-canonical-input-set-binding-design-v0.1.md (v0.2.1)
//
// 本模块回答一个问题: **签名者据以决定"签不签"的那堆输入, 能不能被一个承诺钉死、
// 并被每个签名者独立重算出来。**
//
// ── 三条把设计钉死的判据(都不是我现编的, 各有出处) ───────────────────────────
// 🔴 ① **授权承诺是 `cis_digest`(全 body 摘要), 不是 `input_set_root`。**
//    Codex 主 RED(v0.2 R-1): 旧的 input_set_root 只 hash 了 domain/policy/order_rule/prior_state
//    与三棵树根, **漏了 bets_excluded[] / network / genesis_hash / market_id / schema_version /
//    output_layout_version / payout_root / accounting / 防重放信封**。最清楚的利用:
//    **两个 CIS 带【不同的排除集】却算出同一个 root** ⇒ 正好击穿"让隐藏排除可见且被绑"这个设计目的。
//    ⇒ 改用全 body 摘要, 于是「新加的字段默认被绑」是**默认行为**, 而不是"需要有人记得改公式"。
//      (旧公式本身就是那张手工清单的失败形态 —— 它漏了九项而没有任何东西会报。)
// 🔴 ② **`input_set_root` 保留但降级为派生索引**, 且靠两条钉死、不许变成"两个模糊重叠的承诺":
//    (i) 它是 CIS_BODY 的一个字段 ⇒ 被 cis_digest 传递性绑定 ⇒ 改它必改 cis_digest, **换不掉**;
//    (ii) 验证方**必须**从 bets/other_inputs/outputs 重算它并要求逐字节相等 ⇒ **撒不了谎**。
//    留着它是因为 cis_digest 是扁平摘要、**做不了成员证明**, 而"第三方只拿一笔注就能证明它在集合里"
//    是候选 A 假阳性诊断与跨节点争议定位要用的。
// 🔴 ③ **先 strict-reject 验结构, 后 canonicalize** —— 顺序是硬约束, 不是风格
//    (活实例 fee-split.mjs:146-147: canonicalizeFeeRules 第一行就是 validateFeeRules)。
//
// 🔵 复用而非重造(设计 §2.0 写死: 重造 canonicalJson / 第二套摘要 / 第二种排序, 按缺陷提):
//    canonicalJson ← shared/lib/app-envelope-canonical.mjs
//    serializeI64 / depth-10 merkle ← pool-payout-root.mjs(本次把 merkle 抽成叶子泛型, 零漂移已证)
import { blake2b } from '@noble/hashes/blake2b';
import { canonicalJson } from '../../../shared/lib/app-envelope-canonical.mjs';
import { serializeI64, merkleRootOfLeaves, computeBetsRoot } from './pool-payout-root.mjs';

export const CIS_PROTOCOL = 'kanet-canonical-input-set';
export const CIS_DOMAIN = 'kanet.pool.canonical-input-set.v1';
export const CIS_SCHEMA_VERSION = 1;

// 🔴 S = 自引用排除集, **穷举**。今天 CIS 里没有签名字段, 所以只有 cis_digest 自己。
//    将来若新增任何签名/自摘要字段, 加进 S **必须与阴性对照同批加** —— 否则 S 会悄悄变大而没人知道。
const SELF_REFERENTIAL_KEYS = Object.freeze(['cis_digest']);


// 🔴🔴 **设计缺口, 由本实现填, 必须被复审 —— 不要读成"设计已规定"**:
//    precond6 v0.2.1 的叶子公式用 `role_code`(§2.3), 而字段表里对象携带的是 `role`(字符串),
//    **全稿没有任何一处定义 role → role_code 的映射**; outputs 的 role 枚举也只在正文里以
//    "broker→5 委员→winners→makerFee→makerExtra" 的散文形式出现, 没有列成枚举。
//    ⇒ 两个独立实现会算出【不同的字节】, 而这恰恰是 CIS 存在要消灭的那件事。
//    ⇒ 本表是我填的定值。**在有人裁定之前, 不得据它上任何签名路径。**
//       (裁定后请把它搬回设计稿, 让设计而不是实现成为单源。)
const INPUT_ROLE_CODE = Object.freeze({ maker_stake: 1, oracle_bond: 2, fee_funding: 3 });
const OUTPUT_ROLE_CODE = Object.freeze({ broker_fee: 1, committee: 2, winner: 3, maker_fee: 4, maker_extra: 5 });
const roleCode = (table, role, where) => {
  if (!Object.prototype.hasOwnProperty.call(table, role)) {
    throw new Error(`CIS: ${where} 的 role 不认识: ${JSON.stringify(role)}(合法: ${Object.keys(table).join('/')})`);
  }
  return table[role];
};
// outpoint 恰好 {txid,index} —— 设计写死"地址是类型, outpoint 才是那一个"(commingled-spine 攻击族)
const outpointOf = (o, where) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`CIS: ${where}.outpoint 必须是对象`);
  const k = Object.keys(o).sort().join(',');
  if (k !== 'index,txid') throw new Error(`CIS: ${where}.outpoint 键必须恰好 {txid,index}, 收到 {${k}}`);
  if (!Number.isInteger(o.index) || o.index < 0) throw new Error(`CIS: ${where}.outpoint.index 必须是非负整数`);
  return { txid: hexBuf(o.txid, `${where}.outpoint.txid`), index: o.index };
};

const HEX32 = /^[0-9a-f]{64}$/;                 // 裸 hex: 全小写, 大小写混用视为非法【而非归一化】
const DIGEST = /^blake2b256:[0-9a-f]{64}$/;     // 带算法标识的摘要字段
const DECINT = /^(0|[1-9][0-9]*)$/;             // 一切大数走十进制字符串

const h32 = (b) => Buffer.from(blake2b(b, { dkLen: 32 }));
// LP(x) = 4 字节大端长度 ‖ x。**只在变长拼接时必需**(判据同 fact-receipt §1-bis-3);
// 反例在册: computeCommitteePkHash 是裸 concat 无 LP, 它今天安全只因输入恰好定宽、而函数里没有任何校验。
const LP = (buf) => { const n = Buffer.alloc(4); n.writeUInt32BE(buf.length, 0); return Buffer.concat([n, buf]); };
const U = (s) => Buffer.from(s, 'utf8');
const hexBuf = (hex, name) => {
  if (typeof hex !== 'string' || !HEX32.test(hex)) throw new Error(`CIS: ${name} 必须是 64 位全小写 hex, 收到 ${JSON.stringify(hex)}`);
  return Buffer.from(hex, 'hex');
};
const i32le = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n, 0); return b; };
const bigOf = (s, name) => {
  if (typeof s !== 'string' || !DECINT.test(s)) throw new Error(`CIS: ${name} 必须是十进制字符串(无前导零/无符号), 收到 ${JSON.stringify(s)}`);
  return BigInt(s);
};

// ── 叶子: 全定宽拼接 ⇒ 逐字段不需要 LP; 但**域标签是变长的, 必须 LP** ───────────
export function betLeaf(b) {
  const op = outpointOf(b.outpoint, 'bets[]');
  return h32(Buffer.concat([
    LP(U('kanet.pool.cis.bet.v1')),
    op.txid, i32le(op.index),
    hexBuf(b.bettor_pk, 'bets[].bettor_pk'),
    hexBuf(b.address_commitment, 'bets[].address_commitment'),
    serializeI64(bigOf(b.stake_sompi, 'bets[].stake_sompi'), 8),
    serializeI64(BigInt(b.direction), 1),
    serializeI64(bigOf(b.lock_daa, 'bets[].lock_daa'), 8),
  ]));
}

export function otherInputLeaf(o) {
  const op = outpointOf(o.outpoint, 'other_inputs[]');
  return h32(Buffer.concat([
    LP(U('kanet.pool.cis.other-input.v1')),
    op.txid, i32le(op.index),
    serializeI64(BigInt(roleCode(INPUT_ROLE_CODE, o.role, 'other_inputs[]')), 1),
    hexBuf(o.address_commitment, 'other_inputs[].address_commitment'),
    serializeI64(bigOf(o.value_sompi, 'other_inputs[].value_sompi'), 8),
  ]));
}

export function outputLeaf(o) {
  if (!Number.isInteger(o.index) || o.index < 0) throw new Error('CIS: outputs[].index 必须是非负整数');
  return h32(Buffer.concat([
    LP(U('kanet.pool.cis.output.v1')),
    i32le(o.index),
    serializeI64(BigInt(roleCode(OUTPUT_ROLE_CODE, o.role, 'outputs[]')), 1),
    hexBuf(o.address_commitment, 'outputs[].address_commitment'),
    serializeI64(bigOf(o.value_sompi, 'outputs[].value_sompi'), 8),
  ]));
}

/**
 * 派生索引。**不是授权承诺** —— 见文件头 ②。
 * 三棵 depth-10 position-aware merkle 各自成根, 再一次域分隔归并。
 */
export function inputSetRoot(cis) {
  const betsRoot = merkleRootOfLeaves((cis.bets || []).map(betLeaf));
  const otherRoot = merkleRootOfLeaves((cis.other_inputs || []).map(otherInputLeaf));
  const outsRoot = merkleRootOfLeaves((cis.outputs || []).map(outputLeaf));
  const ctx = canonicalJson({
    policy: cis.policy, order_rule: cis.order_rule, prior_state: cis.prior_state,
  });
  return `blake2b256:${h32(Buffer.concat([
    LP(U(CIS_DOMAIN)), LP(U(ctx)),
    LP(betsRoot), LP(otherRoot), LP(outsRoot),
  ])).toString('hex')}`;
}

/**
 * 🔴 **唯一授权承诺。** 覆盖 CIS 的【全部】字段(去掉自引用集 S), 含 bets_excluded / nonce /
 * validity / producer_pk。⇒ 加字段默认被绑, 不需要有人记得改公式。
 *
 * 🔴 「被绑定」≠「被授权」: producer_pk 被绑(改它 digest 就变), 但验证方**不得**因为它是某个 pk
 *    就放宽任何检查。v0.2 两条同时成立, 不许把前者读成后者。
 */
export function cisDigest(cis) {
  const body = {};
  for (const k of Object.keys(cis)) if (!SELF_REFERENTIAL_KEYS.includes(k)) body[k] = cis[k];
  return `blake2b256:${h32(Buffer.concat([LP(U(CIS_DOMAIN)), LP(U(canonicalJson(body)))])).toString('hex')}`;
}

/**
 * 验证方入口。**两条都必须过**, 缺一即 inconclusive:
 *   (i) cis_digest 与全 body 重算相等 —— 授权承诺没被换;
 *   (ii) input_set_root 与三组数组重算逐字节相等 —— 派生索引没撒谎。
 * @returns {{ok: true} | {ok: false, reason: string, detail?: object}}
 */
export function verifyCis(cis) {
  try { assertCisStructure(cis); } catch (e) { return { ok: false, reason: `structure: ${e.message}` }; }

  const wantRoot = inputSetRoot(cis);
  if (cis.input_set_root !== wantRoot) {
    // 🔴 不给"差不多"的余地: 派生索引对不上 ⇒ inconclusive, 不是警告。
    return { ok: false, reason: 'input_set_root 与 bets/other_inputs/outputs 重算不符', detail: { claimed: cis.input_set_root, recomputed: wantRoot } };
  }
  // 🔴 `bets_root_legacy` —— 设计写死「CIS 验证方**必须两个都算、两个都比**」。
  //    它是 v0.7 链上已烤进 covenant 的那个 hash-chain(CloseZkV2.sil:18 betsRootBaked)。
  //    **并存不合并**: 链上那个改不了(改 = 换 covenant), CIS 这个答的是另一个问题
  //    (成员证明 / 带 outpoint 与政策的集合承诺)。⇒ 只比其中一个, 就等于放掉另一半。
  //    为 null 表示这份 CIS 不针对已烤 covenant 的市场; 非 null 就必须对上。
  if (cis.bets_root_legacy !== null) {
    if (typeof cis.bets_root_legacy !== 'string' || !HEX32.test(cis.bets_root_legacy)) {
      return { ok: false, reason: 'bets_root_legacy 必须是 64 位小写 hex 或 null' };
    }
    const legacy = computeBetsRoot(cis.bets.map((b) => ({
      pk: b.bettor_pk, stake: BigInt(b.stake_sompi), direction: b.direction,
    }))).toString('hex');
    if (legacy !== cis.bets_root_legacy) {
      return { ok: false, reason: 'bets_root_legacy 与链上口径重算不符', detail: { claimed: cis.bets_root_legacy, recomputed: legacy } };
    }
  }

  const wantDigest = cisDigest(cis);
  if (cis.cis_digest !== wantDigest) {
    return { ok: false, reason: 'cis_digest 与全 body 重算不符', detail: { claimed: cis.cis_digest, recomputed: wantDigest } };
  }
  return { ok: true };
}

// ── 结构闸: 恰好这些键、恰好这些类型, 未知键即拒 ─────────────────────────────
// 🔴 **本表不写"键数"字面量** —— 承 fact-receipt §2 那条自踩教训: 数字会与表对不上,
//    而照数字实现的人会拒掉每一份合法对象。判据永远对着键集本身, 不对着它的计数。
const TOP_KEYS = Object.freeze([
  'protocol', 'domain', 'schema_version', 'network', 'genesis_hash', 'market_id',
  'market_state_version', 'bets_root_legacy',
  'prior_state', 'bets', 'bets_excluded', 'other_inputs', 'outputs', 'output_layout_version',
  'order_rule', 'policy', 'payout_root', 'accounting', 'producer_pk', 'nonce', 'validity',
  'input_set_root', 'cis_digest',
]);

export function assertCisStructure(cis) {
  if (!cis || typeof cis !== 'object' || Array.isArray(cis)) throw new Error('CIS 必须是对象');
  const got = Object.keys(cis).sort();
  const want = [...TOP_KEYS].sort();
  const missing = want.filter((k) => !got.includes(k));
  const extra = got.filter((k) => !want.includes(k));
  if (missing.length || extra.length) {
    throw new Error(`顶层键集不符 — 缺 [${missing.join(',')}] 多 [${extra.join(',')}]`);
  }
  if (cis.protocol !== CIS_PROTOCOL) throw new Error(`protocol 必须是 ${CIS_PROTOCOL}`);
  if (cis.domain !== CIS_DOMAIN) throw new Error(`domain 必须是 ${CIS_DOMAIN}`);
  // 🔴 版本不匹配即拒, **不做兼容降级**(fee-split.mjs:79-85 已用同一条规则关掉过一次):
  //    加字段不 bump ⇒ 两份语义不同的对象同承诺。
  if (cis.schema_version !== CIS_SCHEMA_VERSION) throw new Error(`schema_version 必须是 ${CIS_SCHEMA_VERSION}(不做兼容降级)`);
  if (typeof cis.network !== 'string' || !cis.network) throw new Error('network 必须非空字符串');
  hexBuf(cis.genesis_hash, 'genesis_hash');   // 网络名可重名, genesis 不会
  if (typeof cis.market_id !== 'string' || !cis.market_id) throw new Error('market_id 必须非空字符串');
  for (const k of ['input_set_root', 'cis_digest', 'payout_root']) {
    if (typeof cis[k] !== 'string' || !DIGEST.test(cis[k])) throw new Error(`${k} 必须是 blake2b256:<64 位小写 hex>`);
  }
  for (const k of ['bets', 'bets_excluded', 'other_inputs', 'outputs']) {
    if (!Array.isArray(cis[k])) throw new Error(`${k} 必须是数组`);
  }
  // 数组序即语义序, 由 order_rule / output_layout_version 承诺; canonicalJson 不对数组重排。
  cis.bets.forEach((b, i) => { try { betLeaf(b); } catch (e) { throw new Error(`bets[${i}]: ${e.message}`); } });
  cis.other_inputs.forEach((o, i) => { try { otherInputLeaf(o); } catch (e) { throw new Error(`other_inputs[${i}]: ${e.message}`); } });
  cis.outputs.forEach((o, i) => { try { outputLeaf(o); } catch (e) { throw new Error(`outputs[${i}]: ${e.message}`); } });
  return true;
}

/** 生产者侧: 填好 body 其余部分后由本函数补上两个派生字段。顺序: 先 root, 再 digest(digest 覆盖 root)。 */
export function sealCis(bodyWithoutDerived) {
  const withRoot = { ...bodyWithoutDerived, input_set_root: 'blake2b256:' + '0'.repeat(64), cis_digest: 'blake2b256:' + '0'.repeat(64) };
  withRoot.input_set_root = inputSetRoot(withRoot);
  assertCisStructure(withRoot);
  withRoot.cis_digest = cisDigest(withRoot);
  return withRoot;
}
