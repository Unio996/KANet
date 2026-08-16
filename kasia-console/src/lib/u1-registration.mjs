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
//    已查出来的 `challengeRecord`。
//
// 🔴 **(343) MUST-FIX 之后, 上面那句的后半截【已经不成立, 别照旧版理解】** ——
//    旧版原话是"调用方必须把'用掉'真的持久化, 否则一次性就退化成可重放", 而它把保证**托付**给了调用方:
//    `consumeChallenge` 是 optional(不传照样注册成功、静默不消费), 且消费发生在 INSERT **提交之后、事务之外**
//    ⇒ 中途抛错/进程死 = 已注册但挑战仍 unused。Codex a89919a0 判: **冻结一个"一次性闸但实际非一次性"的契约
//    = 冻结一个假保证**。@Bettor (343) 裁 FIX 不 rescope。
//
// 🔨 **现在的契约(本模块【自己】强制, 不再托付)**:
//    ① `consumeChallenge` / `readChallenge` **都必传**, 缺一 ⇒ 直接拒(`CHALLENGE_CONSUME_MISSING`), **不静默成功**;
//    ② 两者必须**同步**, 与 INSERT 跑在**同一个 better-sqlite3 事务**里 ⇒ 要么都提交要么都不提交;
//    ③ 消费后在**同一事务内**用 `readChallenge` 重读并要求 `usedAt` 已置 —— 这条是为了让
//       **"消费函数其实什么都没做"读不成成功**(否则又是一个恒真闸, 正是本次被抓的那个形状)。
//    ⚠ 验签(async)留在事务**外**先跑: better-sqlite3 的事务是同步的, 里面不能 await。
import { rootFingerprint, verifyRegistrationBinding } from './u1-same-origin.mjs';
import { verifyRegistrationPop } from './u1-registration-pop.mjs';

export const REG_REJECT = Object.freeze({
  RELAY_UNKNOWN: 'RELAY_UNKNOWN',
  CUSTODY_NOT_MNEMONIC: 'CUSTODY_NOT_MNEMONIC',
  CUSTODY_AMBIGUOUS: 'CUSTODY_AMBIGUOUS',
  BINDING_INVALID: 'BINDING_INVALID',
  POP_FAILED: 'POP_FAILED',
  CONSTRAINT: 'CONSTRAINT',
  // ── (343) MUST-FIX: 一次性挑战消费的三种拒因, 三种都【不落库】 ──
  CHALLENGE_CONSUME_MISSING: 'CHALLENGE_CONSUME_MISSING',   // 没给消费/重读能力 ⇒ 拒(不静默成功)
  CHALLENGE_CONSUME_FAILED: 'CHALLENGE_CONSUME_FAILED',     // 消费本身抛了 ⇒ 整笔回滚
  CHALLENGE_NOT_CONSUMED: 'CHALLENGE_NOT_CONSUMED',         // 消费"成功"但重读仍非 used ⇒ 整笔回滚(防空消费)
  CHALLENGE_ALREADY_USED: 'CHALLENGE_ALREADY_USED',         // 事务内前置重读发现已被并发用掉 ⇒ 拒(防并发重放)
});

// 事务内用的内部错误标记: better-sqlite3 事务靠抛异常回滚, 抛出后在外层按 code 分流。
class _RegTxError extends Error {
  constructor(code, reason) { super(reason); this.regCode = code; this.regReason = reason; }
}

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
 * @param {function} a.consumeChallenge  **必传·同步**: (challenge) => void, 把 unused→consumed 持久化。
 *                                       与落库同事务; 抛错 ⇒ 整笔回滚。
 * @param {function} a.readChallenge     **必传·同步**: (challenge) => {usedAt}|null, 供事务内后置条件重读。
 *                                       缺它就无法分辨"真消费"与"空消费" ⇒ 同样 fail-closed。
 * @param {function} [a.verifyMessageFn]   仅测试注入
 */
export async function registerIdentity({ sqlite, submission, challengeRecord, now, consumeChallenge, readChallenge, verifyMessageFn } = {}) {
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

  // ②-c 🔴 (343): 消费能力**必须在落库之前就具备**, 否则拒。
  //      放在这里(验签之后、写库之前)是有意的: 拒的时候**一个字节都还没写**。
  if (typeof consumeChallenge !== 'function' || typeof readChallenge !== 'function') {
    return {
      ok: false, code: REG_REJECT.CHALLENGE_CONSUME_MISSING,
      reason: '注册要求一次性挑战消费能力: consumeChallenge 与 readChallenge 必须都是函数(fail-closed, 不静默跳过消费)',
    };
  }

  // ③ 落库 + 消费 —— **同一事务**。N3/N4 由 v196 的 UNIQUE/CHECK 在写入那一刻兜底。
  const fp = rootFingerprint(s.rootXpub);
  const runTx = sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO u1_identity_registration
      (relay_id, root_fingerprint, root_xpub, identity_index, identity_pubkey_xonly, custody)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(s.relayId, fp, String(s.rootXpub).trim(), s.identityIndex,
        String(s.identityPubkeyXOnly).trim().toLowerCase(),
        custody.custody);   // 🔴 服务端派生值, 不是 s.custody

    // 🔴 **前置条件(并发重放闸, J2 自查补)**: 在【持有写锁的事务内】重读一次, 必须仍是 unused。
    //    为什么必需: PoP 那步是在事务【外】用调用方递进来的 challengeRecord 判的 ⇒ 两个并发请求
    //    可以【都】拿着 usedAt=null 通过验证。若消费实现写成无条件 `SET used_at=?`(而非 CAS),
    //    两笔都会把它置上、后置条件也都满足 ⇒ **同一挑战注册两次**。
    //    上面那条 INSERT 已经取了写锁, 所以这里读到的是序列化之后的值 —— 这一读把它变成真正的 CAS,
    //    而且**不要求调用方自己实现 CAS**(要求了也无法验证, 契约不该依赖对面的自觉)。
    const before = readChallenge(s.challenge);
    if (!before || before.usedAt) {
      throw new _RegTxError(REG_REJECT.CHALLENGE_ALREADY_USED,
        `事务内重读: 挑战已被并发请求用掉(或已不存在) ⇒ 拒, 整笔回滚(usedAt=${before?.usedAt ?? 'record-missing'})`);
    }

    // 消费: 抛错即回滚(连同上面那条 INSERT)
    try { consumeChallenge(s.challenge); }
    catch (e) { throw new _RegTxError(REG_REJECT.CHALLENGE_CONSUME_FAILED, `挑战消费失败, 整笔回滚: ${e?.message || e}`); }

    // 🔴 后置条件: 事务内重读, 必须真的变成 used。
    //    没有这一条, 一个【什么也不做】的 consumeChallenge 会读成成功 —— 那正是本次被抓的形状
    //    (谓词对, 但没有东西让它的前提成立)。
    const after = readChallenge(s.challenge);
    if (!after || !after.usedAt) {
      throw new _RegTxError(REG_REJECT.CHALLENGE_NOT_CONSUMED,
        '消费后重读挑战仍非 used ⇒ 消费未真正持久化, 整笔回滚(空消费不算成功)');
    }
  }).immediate;
  // 🔴 **`.immediate` 不是可有可无的修饰** (三方 2026-08-17 收敛, @Bettor 裁"契约要冻就冻真的"):
  //    `sqlite.transaction(fn)` 直接调用走的是 `default` = 裸 `BEGIN`(better-sqlite3
  //    `lib/methods/transaction.js:42`), 而 SQLite 里裸 BEGIN 即 **DEFERRED** ——
  //    DEFERRED 事务要到【第一条写语句】才取 RESERVED 锁。
  //    ⇒ 上面那段 CAS 在 default 下**只是碰巧成立**: 因为 INSERT 恰好排在前置重读之前。
  //    🔴 谁把前置重读挪到 INSERT **之前**(而"先检查再写"看起来更自然、更像好代码),
  //       锁就还没取, CAS **静默**退化成 TOCTOU —— 而**测试全绿、变异全咬**(单线程测不出并发),
  //       没有任何东西会告诉他。在册: `correct by accident 依赖对面不变`。
  //    ⇒ `BEGIN IMMEDIATE` 在 BEGIN 那一刻就取写锁 ⇒ 保证与**语句顺序无关**, 拆掉这颗雷。
  //    ⚠ 语义不变: 只提前 RESERVED 锁的取得时点, 不改事务/回滚/后置条件行为。

  try { runTx(); }
  catch (e) {
    if (e instanceof _RegTxError) return { ok: false, code: e.regCode, reason: e.regReason };
    return { ok: false, code: REG_REJECT.CONSTRAINT, reason: `落库被约束拒: ${e?.message || e}` };
  }

  return { ok: true, rootFingerprint: fp, custody: custody.custody, verifiedWith: pop.verifiedWith };
}
