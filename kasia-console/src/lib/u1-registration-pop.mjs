// u1 · A2 注册的 proof-of-possession 层 —— 规范: docs/2026-08-12-u1-a2-same-origin-spec-v1.0.md **N8**
// (v1.1-rc · @Bettor 20:23Z 裁 · 方向 @NWT · N8 复审 PASS 20:28Z)
//
// 本模块存在的理由, 一句话: **派生证明是纯公钥算术, 任何读得到根的人都算得出"正确"的派生 pubkey。**
// 非硬化派生只要根的 xpub, 不需要任何私钥; 而 N6 要求根对验证方可读、各域为了互相核对同源
// 本来就得读到别人的根 ⇒ **根与派生 pubkey 都是可抄的值** ⇒ 没有这一层, 登记表每一行只是
// 【声称】不是【证据】: 域 X 抄域 Y 的根、算出正确 pubkey、用自己的 relay_id 提交, 会通过
// u1-same-origin.mjs 的全部校验(因为它断言的绑定本来就是真的)。
//
// ── 整层的承重点(spec N8-2), 只有一句, 但它就是全部 ───────────────────────────
// 🔴 **验签用的公钥 = 【申报的那个 identity pubkey】本身** —— 不是提交者的任意钥, 不是
//    relay_nodes 里那行的地址。域 X 从未持有 R_Y 之下任何身份的私钥 ⇒ 他签不出能被该 pubkey
//    验过的签名。**spec V15 就是钉这一句的**: X 用自己的私钥对含 Y pubkey 的 payload 签出一个
//    【完全合法】的签名 ⇒ **仍必须拒**。「签名有效」与「控制成立」差的就是【用谁的公钥验】。
//
// 🔵 零新造密码学: `verifyMessage` 走 kaspa-wasm, 与 coord-status-sign.mjs:91-93 同一条路;
//    签名侧 relay 已有 signMessage(relay.mjs:642/647)。**没有第二套签名体系。**
//
// 🔴 本实现填的设计缺口(要被复审, 别读成 spec 已规定):
//    **(a) payload 的规范化形态 spec 没写死** —— 我用 `LF 连接的 key=value 定长字段`,
//    每个字段都出现、顺序固定、不做 JSON(避免键序/空白/转义带来的第二种字节)。
//    验签双方必须逐字节重建同一段, 同 coord-status-sign 的教训(一处 trim 一处不 trim ⇒ 合法签名验不过)。
//    **(b) 挑战串的存储/签发不在本模块** —— 本模块只接受一个【已查出来的 challengeRecord】并按
//    spec N8-3 判它, 把"谁签发的、存哪"留给调用方(A-2 存储设计仍待审)。
import { blake2b } from '@noble/hashes/blake2b';
import { rootFingerprint } from './u1-same-origin.mjs';

export const POP_DOMAIN = 'kanet.u1.registration.pop.v1';

export const POP_REJECT = Object.freeze({
  MALFORMED: 'MALFORMED',
  CHALLENGE_UNKNOWN: 'CHALLENGE_UNKNOWN',
  CHALLENGE_USED: 'CHALLENGE_USED',
  CHALLENGE_EXPIRED: 'CHALLENGE_EXPIRED',
  CHALLENGE_MISMATCH: 'CHALLENGE_MISMATCH',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
});

const isHex64 = (s) => typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s.trim());
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';

/**
 * 规范 payload —— 见头部缺口 (a)。**双方必须用这一个函数**, 不许各自拼。
 * 字段全绑(spec N8-1): root_fingerprint ∧ identity_index ∧ relay_id ∧ challenge。
 */
export function buildPopPayload({ rootFingerprint: fp, identityIndex, relayId, challenge }) {
  if (!nonEmpty(fp)) throw new Error('rootFingerprint required');
  if (!Number.isInteger(identityIndex)) throw new Error('identityIndex must be an integer');
  if (!nonEmpty(relayId)) throw new Error('relayId required');
  if (!nonEmpty(challenge)) throw new Error('challenge required');
  return [
    `domain=${POP_DOMAIN}`,
    `root_fingerprint=${fp.trim()}`,
    `identity_index=${identityIndex}`,
    `relay_id=${relayId.trim()}`,
    `challenge=${challenge.trim()}`,
  ].join('\n');
}

/** 被签的是 payload 的 blake2b256 hex(同 coord-status-sign 的 message=hashHex 惯例)。 */
export function popMessageHashHex(payload) {
  return Buffer.from(blake2b(Buffer.from(payload, 'utf8'), { dkLen: 32 })).toString('hex');
}

/**
 * N8 验证。**fail-closed**: 任何一格不合格 ⇒ 拒, 不落库。
 *
 * @param {object} a
 * @param {object} a.submission  { relayId, rootXpub, identityIndex, identityPubkeyXOnly, challenge, signature }
 * @param {object|null} a.challengeRecord  服务端查出来的: { challenge, usedAt, expiresAt } —— null = 不是我们签发的
 * @param {Date|number} a.now
 * @param {function} [a.verifyMessageFn]  仅供测试注入; 默认走 kaspa-wasm
 * @returns {{ok: boolean, reason?: string, code?: string, verifiedWith?: string}}
 */
export async function verifyRegistrationPop({ submission, challengeRecord, now, verifyMessageFn } = {}) {
  const s = submission || {};

  // ① 结构(先 strict-reject, 后一切) —— 同 fee-split / CIS 的顺序纪律
  if (!nonEmpty(s.relayId)) return { ok: false, code: POP_REJECT.MALFORMED, reason: 'relayId missing' };
  if (!nonEmpty(s.rootXpub)) return { ok: false, code: POP_REJECT.MALFORMED, reason: 'rootXpub missing' };
  if (!Number.isInteger(s.identityIndex)) return { ok: false, code: POP_REJECT.MALFORMED, reason: 'identityIndex must be an integer' };
  if (!isHex64(s.identityPubkeyXOnly)) return { ok: false, code: POP_REJECT.MALFORMED, reason: 'identityPubkeyXOnly must be 64 hex chars' };
  if (!nonEmpty(s.challenge)) return { ok: false, code: POP_REJECT.MALFORMED, reason: 'challenge missing' };
  if (!nonEmpty(s.signature)) return { ok: false, code: POP_REJECT.MALFORMED, reason: 'signature missing' };

  // ② 挑战串(spec N8-3): 必须是服务端签发的、没用过、没过期
  //    🔴 null record = 【不是我们签发的】⇒ 拒。不许"查不到就当没设过期"这类放行。
  if (!challengeRecord || !nonEmpty(challengeRecord.challenge)) {
    return { ok: false, code: POP_REJECT.CHALLENGE_UNKNOWN, reason: 'challenge was not issued by this server' };
  }
  if (String(challengeRecord.challenge).trim() !== String(s.challenge).trim()) {
    return { ok: false, code: POP_REJECT.CHALLENGE_MISMATCH, reason: 'challenge record does not match submitted challenge' };
  }
  if (challengeRecord.usedAt) {
    return { ok: false, code: POP_REJECT.CHALLENGE_USED, reason: `challenge already used at ${challengeRecord.usedAt}` };
  }
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return { ok: false, code: POP_REJECT.MALFORMED, reason: 'now must be a Date or epoch ms' };
  const expMs = challengeRecord.expiresAt instanceof Date
    ? challengeRecord.expiresAt.getTime() : Number(challengeRecord.expiresAt);
  // 🔴 过期时间读不出来 ⇒ 拒(而不是当成"永不过期")。fail-closed。
  if (!Number.isFinite(expMs)) return { ok: false, code: POP_REJECT.MALFORMED, reason: 'challengeRecord.expiresAt unreadable' };
  if (nowMs > expMs) return { ok: false, code: POP_REJECT.CHALLENGE_EXPIRED, reason: 'challenge expired' };

  // ③ 重建 payload 并验签
  let payload;
  try {
    payload = buildPopPayload({
      rootFingerprint: rootFingerprint(s.rootXpub),
      identityIndex: s.identityIndex,
      relayId: s.relayId,
      challenge: s.challenge,
    });
  } catch (e) {
    return { ok: false, code: POP_REJECT.MALFORMED, reason: `payload build failed: ${e?.message || e}` };
  }
  const messageHashHex = popMessageHashHex(payload);

  // 🔴🔴 承重点: 验签公钥 = **申报的 identity pubkey 本身**。
  //    这里【绝不】允许改成"提交者的钥"/"relay_nodes 里那行的地址" —— 那样 V15 会直接失守:
  //    一个用自己私钥签出来的【合法】签名就会被读成"控制成立"。
  const verifiedWith = s.identityPubkeyXOnly.trim().toLowerCase();
  const verify = verifyMessageFn || (async (args) => {
    const { verifyMessage } = await import('kaspa-wasm');
    return verifyMessage(args);
  });
  let valid = false;
  try {
    valid = await verify({ message: messageHashHex, signature: String(s.signature).trim(), publicKey: verifiedWith });
  } catch (e) {
    // 验签抛错 = 拒(不是"当作通过"), 且把原因带出来
    return { ok: false, code: POP_REJECT.SIGNATURE_INVALID, reason: `verifyMessage threw: ${e?.message || e}`, verifiedWith };
  }
  if (!valid) {
    return { ok: false, code: POP_REJECT.SIGNATURE_INVALID, reason: 'signature does not verify under the claimed identity pubkey', verifiedWith };
  }
  return { ok: true, verifiedWith, messageHashHex };
}
