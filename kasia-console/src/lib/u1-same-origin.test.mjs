// u1 · A2 同源判定用例 —— 判据是 **spec v1.0-rc §4 的 V1-V8 预登记表**, 不是我事后编的。
// 规范: docs/2026-08-12-u1-a2-same-origin-spec-v1.0.md
//
// ⚠ 全程用**当场随机生成**的助记词。**不解密、不读取、不打印任何在库真实密钥。**
//
// 🔴 两条这套用例自己要守的纪律(都是本仓吃过亏的形状):
//  ① **V2 的注入物必须是【另一个合法根】, 不是乱码** —— 乱码会被格式校验拦下, 于是"红了"
//     却没有证明派生比对在跑(在册: 注入物须取自断言实读的字段集)。
//  ② **断言要先证明自己读得到东西** —— 每格都对具体 verdict/violation code 断言, 不写
//     "没抛异常就算过"那种恒真式。
import assert from 'node:assert';
import { Mnemonic, XPrv } from 'kaspa-wasm';
import {
  VERDICT, VIOLATION, RESIDUAL_BOUNDARY_NOTICE,
  U1_IDENTITIES_PER_ACCOUNT,
  rootFingerprint, deriveIdentityPubkey, verifyRegistrationBinding,
  classifySameOrigin, checkRegistryInvariants, findDuplicateAddresses,
} from './u1-same-origin.mjs';

let pass = 0; let fail = 0;
const t = (name, fn) => {
  try { fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); }
};

// ── 夹具: 随机 seed → 账户层 xpub(= 登记根) ────────────────────────────────────
// 与 kasia-relay/src/lib/wallet.mjs:39-50 同前缀, 账户层即登记根(spec N1)。
function makeAccount(accountIndex = 0) {
  const phrase = Mnemonic.random().phrase;
  const acct = new XPrv(new Mnemonic(phrase).toSeed())
    .deriveChild(44, true).deriveChild(111111, true).deriveChild(accountIndex, true);
  return { phrase, acct, rootXpub: acct.toXPub().intoString('kpub') };
}
// 同一份 seed 的【另一个硬化账户】—— V4 要用的那种"同源但看不出同源"
function siblingAccountOf(phrase, accountIndex) {
  const acct = new XPrv(new Mnemonic(phrase).toSeed())
    .deriveChild(44, true).deriveChild(111111, true).deriveChild(accountIndex, true);
  return { acct, rootXpub: acct.toXPub().intoString('kpub') };
}
const regOf = (rootXpub, relayId, identityIndex = 0, custody = 'mnemonic') => ({
  relayId, rootXpub, identityIndex, custody,
  identityPubkeyXOnly: deriveIdentityPubkey(rootXpub, identityIndex),
});

const A = makeAccount(0);
const B = makeAccount(0);          // 另一份 seed

// ── 前置: 断言原语先证明它读得到东西(否则下面每一格都可能是恒真) ─────────────
t('前置 · 派生原语真的产出 x-only pubkey, 且同输入同输出', () => {
  const p1 = deriveIdentityPubkey(A.rootXpub, 0);
  const p2 = deriveIdentityPubkey(A.rootXpub, 0);
  assert.match(p1, /^[0-9a-f]{64}$/, `期望 64 hex, 实际 ${p1}`);
  assert.strictEqual(p1, p2, '同输入两次派生必须相同');
  assert.notStrictEqual(p1, deriveIdentityPubkey(B.rootXpub, 0), '不同根必须派生出不同 pubkey');
});

// ── V1 · 同源正向可判 ────────────────────────────────────────────────────────
t('V1 · 同一登记根下的两个身份 ⇒ SAME_ORIGIN(密码学正向)', () => {
  const r = classifySameOrigin(regOf(A.rootXpub, 'relay-1'), regOf(A.rootXpub, 'relay-2'));
  assert.strictEqual(r.verdict, VERDICT.SAME_ORIGIN, `期望 SAME_ORIGIN, 实际 ${r.verdict} (${r.reason})`);
  assert.strictEqual(r.reverseGuarantee, false, 'reverseGuarantee 永远是 false');
});

// ── V2 · 弱注入臂: 只换【另一个合法根】, 必须红 ───────────────────────────────
t('V2 · 把登记根换成另一个【合法】根 ⇒ 绑定必须失败(证明派生比对真在跑)', () => {
  const good = regOf(A.rootXpub, 'relay-1');
  assert.strictEqual(verifyRegistrationBinding(good).ok, true, '原件必须先是绿的, 否则本格无意义');
  const injected = { ...good, rootXpub: B.rootXpub };           // ← 合法 xpub, 不是乱码
  const v = verifyRegistrationBinding(injected);
  assert.strictEqual(v.ok, false, '换了根还绿 = 派生比对没在跑');
  assert.match(v.reason, /derived pubkey != claimed/, `失败原因必须是比对不上, 实际: ${v.reason}`);
});

t('V2-bis · 乱码根走的是【另一条】失败路径(所以 V2 不能用乱码当注入物)', () => {
  const good = regOf(A.rootXpub, 'relay-1');
  const v = verifyRegistrationBinding({ ...good, rootXpub: 'deadbeef-not-an-xpub' });
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /derivation failed/, `乱码应当在解析处就死, 实际: ${v.reason}`);
});

// ── V3 · 反向不谎报 ──────────────────────────────────────────────────────────
t('V3 · 两份不同 seed ⇒ NOT_DECIDABLE, 且【绝不】出现"不同源"字样', () => {
  const r = classifySameOrigin(regOf(A.rootXpub, 'relay-1'), regOf(B.rootXpub, 'relay-2'));
  assert.strictEqual(r.verdict, VERDICT.NOT_DECIDABLE, `期望 NOT_DECIDABLE, 实际 ${r.verdict}`);
  assert.strictEqual(r.reverseGuarantee, false);
  assert.ok(!Object.values(VERDICT).includes('DIFFERENT_ORIGIN'), 'verdict 词表里不许有"不同源"这个结论');
});

// ── V4 · 同 seed 异硬化账户 ⇒ 必须"无法判定", 不许报"不同源" ──────────────────
t('V4 · 同一 seed 的两个硬化账户 ⇒ NOT_DECIDABLE(把无知报成安全是本格要挡的)', () => {
  const sib = siblingAccountOf(A.phrase, 1);                    // 同 seed, account 1
  const r = classifySameOrigin(regOf(A.rootXpub, 'relay-1'), regOf(sib.rootXpub, 'relay-2'));
  assert.strictEqual(r.verdict, VERDICT.NOT_DECIDABLE,
    `同源却不可关联 ⇒ 必须 NOT_DECIDABLE, 实际 ${r.verdict}`);
  assert.match(r.reason, /unlinkable|cannot be excluded/, `原因要说清"排除不了", 实际: ${r.reason}`);
});

// ── V5 · 存量 address 重复(旧布局下同 mnemonic 的表现形态) ────────────────────
t('V5 · findDuplicateAddresses: 有重复要抓到, 没重复要报 0(两向都测)', () => {
  const dup = findDuplicateAddresses([
    { name: 'r1', address: 'kaspatest:qqq111' },
    { name: 'r2', address: 'qqq111' },                          // 同址, 带不带前缀都算同一个
    { name: 'r3', address: 'kaspatest:qqq222' },
  ]);
  assert.strictEqual(dup.length, 1, `期望 1 组重复, 实际 ${dup.length}`);
  assert.deepStrictEqual(dup[0].who.sort(), ['r1', 'r2']);
  assert.strictEqual(findDuplicateAddresses([{ name: 'r1', address: 'a' }, { name: 'r2', address: 'b' }]).length, 0);
});

// ── V6 · 残余边界必须进运行时输出 ────────────────────────────────────────────
t('V6 · 残余边界出现在【运行时输出】里, 不是只在文档', () => {
  const r = classifySameOrigin(regOf(A.rootXpub, 'relay-1'), regOf(B.rootXpub, 'relay-2'));
  assert.ok(r.notice && r.notice.length > 0, 'classify 输出必须带 notice');
  assert.match(r.notice, /不具反向保证/, 'notice 必须明说反向不可证');
  assert.match(r.notice, /R1 合规正是本检查在检验的对象/, 'notice 必须明说循环那一层');
  const inv = checkRegistryInvariants([]);
  assert.strictEqual(inv.notice, RESIDUAL_BOUNDARY_NOTICE, '不变式检查输出同样要带 notice');
});

// ── V7 · privkey-only 不入委员(fail-closed) ─────────────────────────────────
t('V7 · custody=privkey ⇒ 拒; custody 缺失也拒(不默认放行)', () => {
  const priv = { ...regOf(A.rootXpub, 'relay-priv'), custody: 'privkey' };
  const v1 = checkRegistryInvariants([priv]);
  assert.strictEqual(v1.ok, false);
  assert.ok(v1.violations.some((x) => x.code === VIOLATION.CUSTODY_NOT_MNEMONIC),
    `期望 CUSTODY_NOT_MNEMONIC, 实际 ${JSON.stringify(v1.violations)}`);
  const missing = { ...regOf(B.rootXpub, 'relay-nocustody') }; delete missing.custody;
  assert.ok(checkRegistryInvariants([missing]).violations.some((x) => x.code === VIOLATION.CUSTODY_NOT_MNEMONIC),
    'custody 缺失必须也算不合格(fail-closed)');
});

// ── V8 · 同根第二身份 = 构造性违规 ───────────────────────────────────────────
t('V8 · 同一登记根下两个注册身份 ⇒ SECOND_IDENTITY_UNDER_ONE_ROOT', () => {
  const r = checkRegistryInvariants([regOf(A.rootXpub, 'relay-1'), regOf(A.rootXpub, 'relay-2')]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.violations.some((x) => x.code === VIOLATION.SECOND_IDENTITY_UNDER_ONE_ROOT),
    `期望构造性违规, 实际 ${JSON.stringify(r.violations)}`);
});

t('V8-bis · identityIndex 越界(锁 1 ⇒ 只有 0 合法) ⇒ 拒', () => {
  const bad = { relayId: 'relay-x', rootXpub: A.rootXpub, identityIndex: 1, custody: 'mnemonic',
    identityPubkeyXOnly: deriveIdentityPubkey(A.rootXpub, 1) };
  const v = verifyRegistrationBinding(bad);
  assert.strictEqual(v.ok, false, `锁 ${U1_IDENTITIES_PER_ACCOUNT} ⇒ index 1 必须被拒`);
  assert.match(v.reason, /out of range/);
  assert.ok(checkRegistryInvariants([bad]).violations.some((x) => x.code === VIOLATION.IDENTITY_INDEX_OUT_OF_RANGE));
});

// ── 我自己补的那格缺口(头部 (a)): 根比较不能比字符串 ─────────────────────────
t('缺口(a) · 同一把根的两种序列化(kpub/xpub) ⇒ 指纹相同, 且仍判 SAME_ORIGIN', () => {
  const asKpub = A.acct.toXPub().intoString('kpub');
  const asXpub = A.acct.toXPub().intoString('xpub');
  assert.notStrictEqual(asKpub, asXpub, '前提: 两种序列化的【字符串】确实不同, 否则本格无意义');
  assert.strictEqual(rootFingerprint(asKpub), rootFingerprint(asXpub), '同一把根必须同指纹');
  const r = classifySameOrigin(regOf(asKpub, 'relay-1'), regOf(asXpub, 'relay-2'));
  assert.strictEqual(r.verdict, VERDICT.SAME_ORIGIN,
    '比字符串会漏掉这一对 ⇒ N3 那道闸会【放行】一个真实的同根违规');
});

t('缺口(a)-bis · 同根两种序列化在不变式检查里同样算【一个根】', () => {
  const r = checkRegistryInvariants([
    regOf(A.acct.toXPub().intoString('kpub'), 'relay-1'),
    regOf(A.acct.toXPub().intoString('xpub'), 'relay-2'),
  ]);
  assert.ok(r.violations.some((x) => x.code === VIOLATION.SECOND_IDENTITY_UNDER_ONE_ROOT),
    '换个序列化就绕过构造性违规 = 闸失效');
});

// ── classify 必须先验绑定 ────────────────────────────────────────────────────
// 🔴 本格是【变异测试抓出来的洞】, 不是我想到的: 变异体"classify 跳过绑定校验(直接比根)"
//    被拆掉后 14 格用例全绿 ⇒ 当时没有任何一格守着 classify 的 INVALID 那条路。
//    危害具体: 拿一个【根是别人的、pubkey 对不上】的登记去比, 会只凭根相等就判 SAME_ORIGIN ——
//    等于让一个自陈的根冒充密码学结论, 正是 spec 要防的"换皮的自陈登记"。
t('classify · 绑定不成立 ⇒ INVALID(不许只凭根相等就下结论)', () => {
  const good = regOf(A.rootXpub, 'relay-ok');
  const bogus = { ...regOf(A.rootXpub, 'relay-bogus'), identityPubkeyXOnly: 'a'.repeat(64) };
  const r = classifySameOrigin(good, bogus);
  assert.strictEqual(r.verdict, VERDICT.INVALID,
    `绑定对不上就必须 INVALID, 实际 ${r.verdict} (${r.reason})`);
  assert.match(r.reason, /binding invalid/, `原因要指明是绑定问题, 实际: ${r.reason}`);
});

t('classify · 两边【都】坏也必须 INVALID(不许因为"根一样"就放行)', () => {
  const b1 = { ...regOf(A.rootXpub, 'r1'), identityPubkeyXOnly: 'a'.repeat(64) };
  const b2 = { ...regOf(A.rootXpub, 'r2'), identityPubkeyXOnly: 'b'.repeat(64) };
  assert.strictEqual(classifySameOrigin(b1, b2).verdict, VERDICT.INVALID);
});

// ── fail-closed: 绑定不成立的行不许参与同根聚合 ──────────────────────────────
t('fail-closed · 绑定不成立的行不进聚合(不拿垃圾根算出假干净/假违规)', () => {
  const broken = { relayId: 'relay-broken', rootXpub: A.rootXpub, identityIndex: 0, custody: 'mnemonic',
    identityPubkeyXOnly: 'f'.repeat(64) };                       // 合法形状, 但对不上
  const r = checkRegistryInvariants([broken, regOf(A.rootXpub, 'relay-ok')]);
  assert.ok(r.violations.some((x) => x.code === VIOLATION.BINDING_INVALID), '坏绑定要被单独报出来');
  assert.ok(!r.violations.some((x) => x.code === VIOLATION.SECOND_IDENTITY_UNDER_ONE_ROOT),
    '坏绑定不该被算成"同根第二身份"——那会把一个绑定错误谎报成构造性违规');
});

console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-same-origin: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
