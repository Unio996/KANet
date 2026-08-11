// u1 · A2 同源判定 —— 规范单源: docs/2026-08-12-u1-a2-same-origin-spec-v1.0.md (v1.0-rc · NWT PASS 20:06Z)
//
// 本模块回答一个问题, 而且**只回答它的一半**:
//   「两个委员身份是不是同一份 mnemonic 派生的?」
//   ✅ **正向可证**(同源) —— 登记根相等 + 派生证明, 密码学地成立。
//   🔴 **反向【不可】证**(不同源) —— 造钥方可以私下用同一 seed 派生到**另一个硬化账户**,
//      只出示两个互不关联的根(硬化兄弟不可关联, 实测见证据稿 §3)。
//   ⇒ 所以本模块**永远不输出"不同源"**, 只输出 `NOT_DECIDABLE`。把"我看不出来"写成"它们不同源"
//     = 把无知报成安全(spec V4 明令 fail-closed)。
//
// ── 三条承重的, 都不是我现编的 ────────────────────────────────────────────────
// 🔴 ① **登记根 = 账户层 xpub `m/44'/111111'/0'`**(spec N1)。不是 master xpub —— 它跨不过硬化级,
//    推不出子 pubkey(实测 `Bip32 -> Invalid child number`, 带非硬化对照臂); 也不是 seed 指纹 ——
//    它与 relay pubkey 之间没有可验链接 = 裁定要防的"换皮的自陈登记"。
// 🔴 ② **`identities-per-account` 锁死 = 1**(spec N3 · @Bettor 19:57Z 裁)。
//    ⇒ **同一登记根下出现第二个注册身份 = 构造性违规, 直接拒**, 不需要任何仪式性判定。
//    它同时把形态 A 的兄弟泄露放大面**归零**(无兄弟可沦陷)。
// 🔴 ③ **委员必须 mnemonic 型**(spec N4 · ledger (159) §8.3)。privkey-only 身份落在 R1
//    ("分配单位 = 一份 mnemonic")之外 ⇒ 登记时 fail-closed 拒。
//
// ── 🔴 本实现填的设计缺口, **要被复审, 别读成"spec 已规定"** ───────────────────
// 🔴 **(a) 根的比较不能比字符串。** 同一把账户 xpub 可以序列化成 `kpub…` 或 `xpub…`(实测两种
//    `new XPub()` 都收、都能派生)⇒ **比字符串会把同一个根读成两个根, 于是 N3 那道构造性违规闸
//    整个失效, 而且失效方向是【放行】。** 本模块改比 `rootFingerprint()` =
//    blake2b256(账户层压缩公钥 ‖ chainCode) —— 两种序列化同指纹。
//    (spec 只写了"登记根 = 账户层 xpub", 没写"怎么判两个根相等"。这一格是我补的。)
// 🔴 **(b) 校验顺序: 先结构 strict-reject, 后比较。** 与 fee-split / CIS 同纪律 —— 任何一格
//    结构不合法 ⇒ `INVALID`, **不进入同源比较**, 免得拿半个合法对象去比出一个"看起来是结论"的东西。
//
// 🔵 复用而非重造: blake2b ← @noble/hashes(同 CIS/payout-root); XPub ← kaspa-wasm(同 wallet 路径)。
import { blake2b } from '@noble/hashes/blake2b';
import { XPub } from 'kaspa-wasm';

/** 账户层路径(登记根就长在这一层)。身份沿【非硬化】叶展开, 所以验证方推得到。 */
export const U1_ACCOUNT_PATH = "m/44'/111111'/0'";
/** 身份链(非硬化)。 */
export const U1_IDENTITY_CHAIN = 0;
/** 🔴 N3: 锁死 1。改这个常量 = 改安全前提, 不是调参数。 */
export const U1_IDENTITIES_PER_ACCOUNT = 1;
/** N4: 允许进委员的托管形态。 */
export const U1_ALLOWED_CUSTODY = Object.freeze(['mnemonic']);

export const VERDICT = Object.freeze({
  SAME_ORIGIN: 'SAME_ORIGIN',
  NOT_DECIDABLE: 'NOT_DECIDABLE',
  INVALID: 'INVALID',
});

export const VIOLATION = Object.freeze({
  SECOND_IDENTITY_UNDER_ONE_ROOT: 'SECOND_IDENTITY_UNDER_ONE_ROOT',
  IDENTITY_INDEX_OUT_OF_RANGE: 'IDENTITY_INDEX_OUT_OF_RANGE',
  CUSTODY_NOT_MNEMONIC: 'CUSTODY_NOT_MNEMONIC',
  BINDING_INVALID: 'BINDING_INVALID',
});

// 🔴 V6(spec N7): 残余边界必须出现在**运行时输出**里, 不能只活在设计稿。
//    读记分板的人不会翻到 spec §5 —— 他只会看到这行。
export const RESIDUAL_BOUNDARY_NOTICE = [
  '[u1-a2] 本判定不具反向保证: "同源"可证, "不同源"【证不了】——',
  '造钥方可用同一 seed 派生到另一个硬化账户, 只出示两个不可关联的根。反向保证只能来自生成仪式。',
  '[u1-a2] 形态A 下单点私钥泄露(尤其非整机级窄通道)的爆炸半径 = 该 seed 下全部身份;',
  '其可控性依赖 R1 合规, 而 R1 合规正是本检查在检验的对象。',
].join('\n');

const hex = (buf) => Buffer.from(buf).toString('hex');
const isHex64 = (s) => typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s.trim());

/**
 * 登记根的规范指纹 —— 见头部缺口 (a)。
 * 输入: 账户层 xpub 的序列化串(kpub/xpub 皆可)。
 * 输出: `blake2b256:<hex>`; 解析不了则抛(fail-closed, 调用方不许把它当"根不同")。
 */
export function rootFingerprint(rootXpub) {
  if (typeof rootXpub !== 'string' || rootXpub.trim() === '') {
    throw new Error('rootXpub must be a non-empty string');
  }
  let xpub;
  try { xpub = new XPub(rootXpub.trim()); }
  catch (e) { throw new Error(`rootXpub not parseable as XPub: ${e?.message || e}`); }
  const pk = xpub.toPublicKey().toString();          // 33B 压缩公钥 hex
  const cc = String(xpub.chainCode);                  // 32B chain code hex
  return 'blake2b256:' + hex(blake2b(Buffer.from(pk + cc, 'hex'), { dkLen: 32 }));
}

/**
 * 从登记根推导出第 i 个身份的 x-only pubkey(spec N2: 全程非硬化 ⇒ 验证方推得到)。
 * 抛 = 结构问题, 不是"不匹配"。
 */
export function deriveIdentityPubkey(rootXpub, identityIndex) {
  if (!Number.isInteger(identityIndex) || identityIndex < 0) {
    throw new Error(`identityIndex must be a non-negative integer (got ${identityIndex})`);
  }
  const xpub = new XPub(String(rootXpub).trim());
  const leaf = xpub.deriveChild(U1_IDENTITY_CHAIN, false).deriveChild(identityIndex, false);
  return leaf.toPublicKey().toXOnlyPublicKey().toString().toLowerCase();
}

/**
 * N1+N2 派生证明: 登记根 → 声称的身份 pubkey, 必须逐字节相等。
 * 🔴 顺序照头部 (b): 结构不合法一律 INVALID, 不进比较。
 */
export function verifyRegistrationBinding(reg) {
  const r = reg || {};
  if (typeof r.rootXpub !== 'string' || r.rootXpub.trim() === '') {
    return { ok: false, reason: 'rootXpub missing' };
  }
  if (!Number.isInteger(r.identityIndex)) {
    return { ok: false, reason: `identityIndex must be an integer (got ${r.identityIndex})` };
  }
  // 🔴 N3 锁 1: 合法身份索引只有 0。索引越界在这里就拒, 不留到聚合阶段。
  if (r.identityIndex < 0 || r.identityIndex >= U1_IDENTITIES_PER_ACCOUNT) {
    return { ok: false, reason: `identityIndex out of range: ${r.identityIndex} (identities-per-account=${U1_IDENTITIES_PER_ACCOUNT})` };
  }
  if (!isHex64(r.identityPubkeyXOnly)) {
    return { ok: false, reason: 'identityPubkeyXOnly must be 64 hex chars' };
  }
  let derived;
  try { derived = deriveIdentityPubkey(r.rootXpub, r.identityIndex); }
  catch (e) { return { ok: false, reason: `derivation failed: ${e?.message || e}` }; }
  const claimed = r.identityPubkeyXOnly.trim().toLowerCase();
  if (derived !== claimed) {
    return { ok: false, reason: 'derived pubkey != claimed identity pubkey', derived, claimed };
  }
  return { ok: true, derived };
}

/**
 * A2 主功能。**永远不输出"不同源"** —— 见头部说明与 spec V4。
 * 返回 { verdict, reverseGuarantee:false, reason, notice }
 */
export function classifySameOrigin(regA, regB) {
  const a = verifyRegistrationBinding(regA);
  const b = verifyRegistrationBinding(regB);
  if (!a.ok || !b.ok) {
    return {
      verdict: VERDICT.INVALID,
      reverseGuarantee: false,
      reason: `binding invalid (a: ${a.ok ? 'ok' : a.reason}; b: ${b.ok ? 'ok' : b.reason})`,
      notice: RESIDUAL_BOUNDARY_NOTICE,
    };
  }
  let fpA; let fpB;
  try { fpA = rootFingerprint(regA.rootXpub); fpB = rootFingerprint(regB.rootXpub); }
  catch (e) {
    return { verdict: VERDICT.INVALID, reverseGuarantee: false, reason: `root fingerprint failed: ${e?.message || e}`, notice: RESIDUAL_BOUNDARY_NOTICE };
  }
  if (fpA === fpB) {
    return {
      verdict: VERDICT.SAME_ORIGIN,
      reverseGuarantee: false,
      reason: 'identical registration root (cryptographic)',
      rootFingerprint: fpA,
      notice: RESIDUAL_BOUNDARY_NOTICE,
    };
  }
  // 🔴 这里【不是】"不同源"。两个不同的根可能是同一份 seed 的两个硬化账户 —— 不可关联。
  return {
    verdict: VERDICT.NOT_DECIDABLE,
    reverseGuarantee: false,
    reason: 'different registration roots; hardened siblings are unlinkable ⇒ same-origin cannot be excluded',
    notice: RESIDUAL_BOUNDARY_NOTICE,
  };
}

/**
 * 登记表不变式(spec N3/N4 + 绑定有效性)。
 * 入参: [{ relayId, rootXpub, identityIndex, identityPubkeyXOnly, custody }]
 * 出参: { ok, violations:[{ code, relayId, detail }], notice }
 */
export function checkRegistryInvariants(registrations) {
  if (!Array.isArray(registrations)) throw new Error('registrations must be an array');
  const violations = [];
  const byRoot = new Map();

  for (const reg of registrations) {
    const relayId = reg?.relayId ?? '(no relayId)';

    // N4: 委员必须 mnemonic 型(fail-closed: 缺字段也算不合格, 不默认放行)
    if (!U1_ALLOWED_CUSTODY.includes(reg?.custody)) {
      violations.push({ code: VIOLATION.CUSTODY_NOT_MNEMONIC, relayId, detail: `custody=${JSON.stringify(reg?.custody)} (allowed: ${U1_ALLOWED_CUSTODY.join(',')})` });
    }

    const bind = verifyRegistrationBinding(reg);
    if (!bind.ok) {
      const outOfRange = /identityIndex out of range/.test(bind.reason || '');
      violations.push({
        code: outOfRange ? VIOLATION.IDENTITY_INDEX_OUT_OF_RANGE : VIOLATION.BINDING_INVALID,
        relayId,
        detail: bind.reason,
      });
      continue;   // 绑定不成立的行不参与"同根聚合", 否则会拿垃圾根算出假的违规/假的干净
    }

    let fp;
    try { fp = rootFingerprint(reg.rootXpub); }
    catch (e) { violations.push({ code: VIOLATION.BINDING_INVALID, relayId, detail: `root fingerprint failed: ${e?.message || e}` }); continue; }
    if (!byRoot.has(fp)) byRoot.set(fp, []);
    byRoot.get(fp).push(relayId);
  }

  // 🔴 N3: 同一登记根下第二个身份 = 构造性违规(@Bettor 19:57Z: 不需要任何仪式性判定)
  for (const [fp, ids] of byRoot.entries()) {
    if (ids.length > U1_IDENTITIES_PER_ACCOUNT) {
      violations.push({
        code: VIOLATION.SECOND_IDENTITY_UNDER_ONE_ROOT,
        relayId: ids.join(','),
        detail: `${ids.length} identities under one root ${fp} (max ${U1_IDENTITIES_PER_ACCOUNT})`,
      });
    }
  }

  return { ok: violations.length === 0, violations, notice: RESIDUAL_BOUNDARY_NOTICE };
}

/**
 * spec V5 的纯函数半边: 存量身份里有没有两行共享同一个 address。
 * (旧布局下"两 relay 同 mnemonic"必然表现为同一个 address —— 见证据稿 §2(a)。)
 * ⚠ 它**只**覆盖旧布局那一类, 不替代 checkRegistryInvariants。
 */
export function findDuplicateAddresses(rows) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  const seen = new Map();
  for (const r of rows) {
    const addr = String(r?.address ?? '').trim().replace(/^kaspatest:/, '').toLowerCase();
    if (!addr) continue;
    if (!seen.has(addr)) seen.set(addr, []);
    seen.get(addr).push(r?.name ?? r?.id ?? '(unnamed)');
  }
  return [...seen.entries()].filter(([, who]) => who.length > 1).map(([address, who]) => ({ address, who }));
}
