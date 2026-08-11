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
import { serializeI64, merkleRootOfLeaves } from './pool-payout-root.mjs';

export const CIS_PROTOCOL = 'kanet-canonical-input-set';
export const CIS_DOMAIN = 'kanet.pool.canonical-input-set.v1';
export const CIS_SCHEMA_VERSION = 1;

// 🔴 S = 自引用排除集, **穷举**。今天 CIS 里没有签名字段, 所以只有 cis_digest 自己。
//    将来若新增任何签名/自摘要字段, 加进 S **必须与阴性对照同批加** —— 否则 S 会悄悄变大而没人知道。
const SELF_REFERENTIAL_KEYS = Object.freeze(['cis_digest']);

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
  return h32(Buffer.concat([
    LP(U('kanet.pool.cis.bet.v1')),
    hexBuf(b.txid, 'bets[].txid'), i32le(b.index),
    hexBuf(b.pk, 'bets[].pk'), hexBuf(b.addr_commit, 'bets[].addr_commit'),
    serializeI64(bigOf(b.stake, 'bets[].stake'), 8),
    serializeI64(BigInt(b.direction), 1),
    serializeI64(bigOf(b.lock_daa, 'bets[].lock_daa'), 8),
  ]));
}

export function otherInputLeaf(o) {
  return h32(Buffer.concat([
    LP(U('kanet.pool.cis.other-input.v1')),
    hexBuf(o.txid, 'other_inputs[].txid'), i32le(o.index),
    serializeI64(BigInt(o.role_code), 1),
    hexBuf(o.addr_commit, 'other_inputs[].addr_commit'),
    serializeI64(bigOf(o.value, 'other_inputs[].value'), 8),
  ]));
}

export function outputLeaf(o) {
  return h32(Buffer.concat([
    LP(U('kanet.pool.cis.output.v1')),
    i32le(o.index), serializeI64(BigInt(o.role_code), 1),
    hexBuf(o.addr_commit, 'outputs[].addr_commit'),
    serializeI64(bigOf(o.value, 'outputs[].value'), 8),
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
