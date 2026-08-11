// u1 · A2 注册入口(判定与落库) —— 规范: docs/2026-08-12-u1-a2-same-origin-spec-v1.0.md
// (v1.2-rc · N1-N8 + N4-bis · NWT 逐段 PASS: 20:06Z / 20:28Z / 21:02Z)
//
// 一次注册要过三道, 顺序是硬约束(先便宜且能独立成立的, 后贵的):
//   ① **N4-bis**: `custody` **由服务端自己从 `relay_nodes` 查**, **绝不读提交方给的值**。
//      🔴 v196 的 `CHECK(custody='mnemonic')` 只能核字面值等不等于 'mnemonic', **核不了它是不是真的**;
//         而这一列**没有任何密码学能护它**(不像 root/pubkey 有 N8+派生证明) ⇒ 只能靠服务端自查。
//         (@NWT 20:59Z MUST-FIX; 他原话是"不能信任提交值", 本实现取更严的一档: **根本不读**。)
//   ② **N8 proof-of-possession**: 验签公钥 = **申报的那个 identity pubkey 本身**。
//      根与派生 pubkey 都是可抄的值 ⇒ 没有这一层, 每行只是"声称"。
//   ③ **落库**: N3(锁 1)与 N4 由 v196 的 `UNIQUE(root_fingerprint)` / `CHECK` 在**写入那一刻**兜底
//      —— 即使上面两道将来被谁改松, 数据库这一层仍然拒。
//
// 🔵 **挑战串的签发与持久化【不在本模块】**(同 u1-registration-pop.mjs 的边界): 本模块收一个
//    已查出来的 `challengeRecord`, 并在成功时调用 `consumeChallenge()` —— **调用方必须把"用掉"
//    真的持久化**, 否则一次性就退化成可重放。这条写在这里, 因为它是本模块**管不到**的那一半。
import { rootFingerprint, verifyRegistrationBinding } from './u1-same-origin.mjs';
import { verifyRegistrationPop } from './u1-registration-pop.mjs';

export const REG_REJECT = Object.freeze({
  RELAY_UNKNOWN: 'RELAY_UNKNOWN',
  CUSTODY_NOT_MNEMONIC: 'CUSTODY_NOT_MNEMONIC',
  CUSTODY_AMBIGUOUS: 'CUSTODY_AMBIGUOUS',
  BINDING_INVALID: 'BINDING_INVALID',
  POP_FAILED: 'POP_FAILED',
  CONSTRAINT: 'CONSTRAINT',
});

const nonEmptyCol = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * N4-bis: 服务端自查托管形态。**不接受任何提交方输入。**
 * @returns {{ok:true, custody:'mnemonic'} | {ok:false, code:string, reason:string}}
 */
export function deriveCustody(sqlite, relayId) {
  const row = sqlite.prepare('SELECT mnemonic_encrypted, privkey_encrypted FROM relay_nodes WHERE id = ?').get(relayId);
  if (!row) return { ok: false, code: REG_REJECT.RELAY_UNKNOWN, reason: `relay_nodes 里没有 id=${relayId}` };
  const hasMnemonic = nonEmptyCol(row.mnemonic_encrypted);
  const hasPrivkey = nonEmptyCol(row.privkey_encrypted);
  // 🔴 混合态(两者皆有)**拒**, 不是"挑一个" —— 规则的分配单位是一份 mnemonic,
  //    而一个同时挂着裸私钥的身份, 它的签名权来源不止那份助记词。
  if (hasMnemonic && hasPrivkey) {
    return { ok: false, code: REG_REJECT.CUSTODY_AMBIGUOUS, reason: 'mnemonic_encrypted 与 privkey_encrypted 同时非空(混合态) ⇒ 不入委员' };
  }
  if (!hasMnemonic) {
    return { ok: false, code: REG_REJECT.CUSTODY_NOT_MNEMONIC, reason: 'privkey-only 或无密钥 ⇒ 不入委员(N4)' };
  }
  return { ok: true, custody: 'mnemonic' };
}

/**
 * 注册一条委员身份登记。
 * @param {object} a
 * @param {object} a.sqlite            better-sqlite3 句柄
 * @param {object} a.submission        { relayId, rootXpub, identityIndex, identityPubkeyXOnly, challenge, signature, ...(custody 若有, 一律忽略) }
 * @param {object|null} a.challengeRecord
 * @param {Date|number} a.now
 * @param {function} [a.consumeChallenge]  成功后调用; 调用方负责把"已用"持久化
 * @param {function} [a.verifyMessageFn]   仅测试注入
 */
export async function registerIdentity({ sqlite, submission, challengeRecord, now, consumeChallenge, verifyMessageFn } = {}) {
  const s = submission || {};

  // ① N4-bis —— 注意: **完全不看 s.custody**
  const custody = deriveCustody(sqlite, s.relayId);
  if (!custody.ok) return { ok: false, code: custody.code, reason: custody.reason };

  // ②-a 派生证明(便宜, 且不依赖签名) —— 先拒明显不成立的, 再做验签
  const bind = verifyRegistrationBinding({
    rootXpub: s.rootXpub, identityIndex: s.identityIndex, identityPubkeyXOnly: s.identityPubkeyXOnly,
  });
  if (!bind.ok) return { ok: false, code: REG_REJECT.BINDING_INVALID, reason: bind.reason };

  // ②-b N8 PoP
  const pop = await verifyRegistrationPop({ submission: s, challengeRecord, now, verifyMessageFn });
  if (!pop.ok) return { ok: false, code: REG_REJECT.POP_FAILED, reason: `${pop.code}: ${pop.reason}` };

  // ③ 落库 —— N3/N4 由 v196 的 UNIQUE/CHECK 在写入那一刻兜底
  const fp = rootFingerprint(s.rootXpub);
  try {
    sqlite.prepare(`INSERT INTO u1_identity_registration
      (relay_id, root_fingerprint, root_xpub, identity_index, identity_pubkey_xonly, custody)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(s.relayId, fp, String(s.rootXpub).trim(), s.identityIndex,
        String(s.identityPubkeyXOnly).trim().toLowerCase(),
        custody.custody);   // 🔴 服务端派生值, 不是 s.custody
  } catch (e) {
    return { ok: false, code: REG_REJECT.CONSTRAINT, reason: `落库被约束拒: ${e?.message || e}` };
  }

  if (typeof consumeChallenge === 'function') await consumeChallenge(s.challenge);
  return { ok: true, rootFingerprint: fp, custody: custody.custody, verifiedWith: pop.verifiedWith };
}
