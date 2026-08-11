// N8 proof-of-possession 用例 —— 判据 = spec v1.1-rc §4 的 **V14 / V15 / V16**(预登记, @Bettor 20:23Z 指定)。
// 规范: docs/2026-08-12-u1-a2-same-origin-spec-v1.0.md
//
// ⚠ 全程当场随机生成密钥, **不碰任何在库真实密钥**。
//
// 🔴 **V15 那格必须带一条对照臂, 否则它证不了它要证的东西**:
//    "X 用自己私钥签、被拒" —— 光看这一条, 分不出是【验签钥选对了】还是【签名本来就是坏的】。
//    ⇒ 必须同时证明: **同一个签名用 X 自己的 pubkey 验是【通过】的**。
//    这样"被拒"的唯一解释才是: 我们用【申报的那个 pubkey】验了它。
//    (在册同族: 坏时输出不能等于已知答案 / 对照臂要能把第二种解释排掉。)
import assert from 'node:assert';
import { Mnemonic, XPrv, PrivateKey, signMessage, verifyMessage } from 'kaspa-wasm';
import { rootFingerprint, deriveIdentityPubkey } from './u1-same-origin.mjs';
import {
  buildPopPayload, popMessageHashHex, verifyRegistrationPop, POP_REJECT,
} from './u1-registration-pop.mjs';

let pass = 0; let fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); }
};

// ── 夹具 ─────────────────────────────────────────────────────────────────────
function makeIdentity(relayId) {
  const acct = new XPrv(new Mnemonic(Mnemonic.random().phrase).toSeed())
    .deriveChild(44, true).deriveChild(111111, true).deriveChild(0, true);
  const rootXpub = acct.toXPub().intoString('kpub');
  const leafPrv = acct.deriveChild(0, false).deriveChild(0, false);
  const privHex = (typeof leafPrv.toPrivateKey === 'function' ? leafPrv.toPrivateKey() : PrivateKey.fromXPrv(leafPrv)).toString();
  return { relayId, rootXpub, privHex, pubkey: deriveIdentityPubkey(rootXpub, 0) };
}
const sign = (privHex, payload) => signMessage({ message: popMessageHashHex(payload), privateKey: new PrivateKey(privHex) });
const okChallenge = (challenge) => ({ challenge, usedAt: null, expiresAt: Date.now() + 60_000 });
const submissionFor = (id, challenge) => ({
  relayId: id.relayId, rootXpub: id.rootXpub, identityIndex: 0,
  identityPubkeyXOnly: id.pubkey, challenge,
});
const payloadFor = (id, challenge) => buildPopPayload({
  rootFingerprint: rootFingerprint(id.rootXpub), identityIndex: 0, relayId: id.relayId, challenge,
});

const Y = makeIdentity('relay-Y');
const X = makeIdentity('relay-X');

// ── 前置: 合法路径必须先能过, 否则下面所有"被拒"都可能是恒拒 ─────────────────
await t('前置 · 合法提交(自己的钥签自己的 payload) ⇒ 通过', async () => {
  const ch = 'chal-ok-1';
  const sig = sign(Y.privHex, payloadFor(Y, ch));
  const r = await verifyRegistrationPop({
    submission: { ...submissionFor(Y, ch), signature: sig },
    challengeRecord: okChallenge(ch), now: Date.now(),
  });
  assert.strictEqual(r.ok, true, `合法路径必须通过, 实际被拒: ${r.code} ${r.reason}`);
  assert.strictEqual(r.verifiedWith, Y.pubkey, '必须是用【申报的 pubkey】验的');
});

// ── V14 · 抄来的根 + 正确派生 pubkey, 签名缺失/伪造 ⇒ 拒 ──────────────────────
await t('V14 · 抄 Y 的 root+pubkey 但【不带签名】 ⇒ 拒', async () => {
  const ch = 'chal-v14-a';
  const stolen = { ...submissionFor(Y, ch), relayId: X.relayId };   // X 用自己的 relay_id 提交 Y 的根
  const r = await verifyRegistrationPop({ submission: stolen, challengeRecord: okChallenge(ch), now: Date.now() });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, POP_REJECT.MALFORMED, `期望 MALFORMED, 实际 ${r.code}`);
});

await t('V14-bis · 抄 Y 的 root+pubkey, 带【伪造】签名 ⇒ 拒', async () => {
  const ch = 'chal-v14-b';
  const stolen = { ...submissionFor(Y, ch), relayId: X.relayId, signature: 'ab'.repeat(32) };
  const r = await verifyRegistrationPop({ submission: stolen, challengeRecord: okChallenge(ch), now: Date.now() });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, POP_REJECT.SIGNATURE_INVALID, `期望 SIGNATURE_INVALID, 实际 ${r.code} (${r.reason})`);
});

// ── V15 · 本层最承重的一格 ───────────────────────────────────────────────────
await t('V15 · X 用【自己私钥】对含 Y pubkey 的 payload 签出【合法】签名 ⇒ 仍必须拒', async () => {
  const ch = 'chal-v15';
  // X 声称自己是 Y 那个身份(root=Y 的, pubkey=Y 的), 但只能用自己的私钥去签
  const claimed = { ...submissionFor(Y, ch), relayId: X.relayId };
  const payload = payloadFor({ ...Y, relayId: X.relayId }, ch);
  const sigByX = sign(X.privHex, payload);

  // 🔴 对照臂: 这个签名【本身是合法的】—— 用 X 自己的 pubkey 验得过。
  //    没有这一步, "被拒"可能只是因为签名坏了, 那样本格什么也没证明。
  const validUnderX = verifyMessage({ message: popMessageHashHex(payload), signature: sigByX, publicKey: X.pubkey });
  assert.strictEqual(validUnderX, true, '对照臂: 该签名必须在 X 自己的 pubkey 下验得过, 否则本格无意义');

  const r = await verifyRegistrationPop({
    submission: { ...claimed, signature: sigByX },
    challengeRecord: okChallenge(ch), now: Date.now(),
  });
  assert.strictEqual(r.ok, false, '一个【合法】签名, 只要不是申报 pubkey 签的, 就必须被拒');
  assert.strictEqual(r.code, POP_REJECT.SIGNATURE_INVALID);
  assert.strictEqual(r.verifiedWith, Y.pubkey, '拒的原因必须是"用申报的 pubkey 验的", 不是用提交者的钥');
});

// ── V16 · 挑战串三种坏法 ─────────────────────────────────────────────────────
await t('V16-a · 挑战串不是服务端签发的(查不到记录) ⇒ 拒', async () => {
  const ch = 'chal-not-issued';
  const sig = sign(Y.privHex, payloadFor(Y, ch));
  const r = await verifyRegistrationPop({
    submission: { ...submissionFor(Y, ch), signature: sig }, challengeRecord: null, now: Date.now(),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, POP_REJECT.CHALLENGE_UNKNOWN);
});

await t('V16-b · 挑战串已用过 ⇒ 拒', async () => {
  const ch = 'chal-used';
  const sig = sign(Y.privHex, payloadFor(Y, ch));
  const r = await verifyRegistrationPop({
    submission: { ...submissionFor(Y, ch), signature: sig },
    challengeRecord: { challenge: ch, usedAt: '2026-08-12T00:00:00Z', expiresAt: Date.now() + 60_000 },
    now: Date.now(),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, POP_REJECT.CHALLENGE_USED);
});

await t('V16-c · 挑战串已过期 ⇒ 拒', async () => {
  const ch = 'chal-expired';
  const sig = sign(Y.privHex, payloadFor(Y, ch));
  const r = await verifyRegistrationPop({
    submission: { ...submissionFor(Y, ch), signature: sig },
    challengeRecord: { challenge: ch, usedAt: null, expiresAt: Date.now() - 1 },
    now: Date.now(),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, POP_REJECT.CHALLENGE_EXPIRED);
});

await t('V16-d · 挑战串与记录对不上(拿 A 的记录配 B 的提交) ⇒ 拒', async () => {
  const ch = 'chal-mismatch';
  const sig = sign(Y.privHex, payloadFor(Y, ch));
  const r = await verifyRegistrationPop({
    submission: { ...submissionFor(Y, ch), signature: sig },
    challengeRecord: okChallenge('some-other-challenge'), now: Date.now(),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, POP_REJECT.CHALLENGE_MISMATCH);
});

// ── fail-closed 补格: 读不出来的东西一律拒, 不许当"没限制" ────────────────────
await t('fail-closed · expiresAt 读不出来 ⇒ 拒(不许当成"永不过期")', async () => {
  const ch = 'chal-bad-exp';
  const sig = sign(Y.privHex, payloadFor(Y, ch));
  const r = await verifyRegistrationPop({
    submission: { ...submissionFor(Y, ch), signature: sig },
    challengeRecord: { challenge: ch, usedAt: null, expiresAt: 'not-a-date' }, now: Date.now(),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, POP_REJECT.MALFORMED);
});

await t('fail-closed · 验签原语抛错 ⇒ 拒(不许当成通过)', async () => {
  const ch = 'chal-throw';
  const sig = sign(Y.privHex, payloadFor(Y, ch));
  const r = await verifyRegistrationPop({
    submission: { ...submissionFor(Y, ch), signature: sig },
    challengeRecord: okChallenge(ch), now: Date.now(),
    verifyMessageFn: async () => { throw new Error('boom'); },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, POP_REJECT.SIGNATURE_INVALID);
});

// ── payload 绑定: 四个字段都真的进了签名覆盖面 ───────────────────────────────
await t('payload · 改 relay_id / identity_index / challenge / root 任一 ⇒ 签名失配(四个字段都被绑)', async () => {
  const ch = 'chal-bind';
  const base = payloadFor(Y, ch);
  const sig = sign(Y.privHex, base);
  const variants = [
    ['relay_id', { ...submissionFor(Y, ch), relayId: 'relay-OTHER', signature: sig }],
    ['identity_index', { ...submissionFor(Y, ch), identityIndex: 7, signature: sig }],
    ['challenge', { ...submissionFor(Y, ch), challenge: 'chal-bind-2', signature: sig }],
    ['root', { ...submissionFor(Y, ch), rootXpub: X.rootXpub, signature: sig }],
  ];
  for (const [field, sub] of variants) {
    const rec = okChallenge(sub.challenge);
    const r = await verifyRegistrationPop({ submission: sub, challengeRecord: rec, now: Date.now() });
    assert.strictEqual(r.ok, false, `改了 ${field} 还能过 ⇒ 该字段没被绑进签名`);
  }
});

console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-registration-pop: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
