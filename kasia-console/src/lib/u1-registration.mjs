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
// 🔵 **挑战串的【签发】仍不在本模块**(同 u1-registration-pop.mjs 的边界) —— 但**读取它的权威在本模块**:
//    自 (359) 起, 本模块**不再接收调用方给的 `challengeRecord`**(该参数已删), record 一律从 bound store 现读。
//
// 🔴 **(343) MUST-FIX 之后, 上面那句的后半截【已经不成立, 别照旧版理解】** ——
//    旧版原话是"调用方必须把'用掉'真的持久化, 否则一次性就退化成可重放", 而它把保证**托付**给了调用方:
//    `consumeChallenge` 是 optional(不传照样注册成功、静默不消费), 且消费发生在 INSERT **提交之后、事务之外**
//    ⇒ 中途抛错/进程死 = 已注册但挑战仍 unused。Codex a89919a0 判: **冻结一个"一次性闸但实际非一次性"的契约
//    = 冻结一个假保证**。@Bettor (343) 裁 FIX 不 rescope。
//
// 🔴 **(354) 之后, 上面那版契约【又被收窄了一次】—— 收两个自由函数是不够的**:
//    Codex c0a1f50c 判 96b6121b NOT FULLY CLOSED。上一版我写"BEGIN IMMEDIATE + 前置读 + 消费 + 后置读
//    = 真 CAS, 且不要求调用方自己实现 CAS" —— **那句话的作用域是错的**:
//    `.immediate` 只序列化【身份表所在的那个连接】; 挑战存储若坐在**另一个连接 / 另一个库**上,
//    我持的锁**管不到它**, 那四步就不是原子的。⇒ 原子性不是写法能挣来的, **它只在同一事务域内成立**。
//    ⚠ 而我上一版的用例**没能让这句话变红**, 因为夹具用的就是同一个 handle 的表 —— 夹具替我满足了
//       我没写出来的前提(在册: 注入物/对照臂必须能让声明失败, 否则绿灯无信息)。
//
// 🔨 **现在的契约(结构绑定, 不是检查)**:
//    ① `challengeStore` **必传**, 缺 ⇒ 拒 `CHALLENGE_CONSUME_MISSING`, **不静默成功**;
//    ② 它必须由 `createChallengeStore(sqlite, table)` 用**与本次注册同一个 sqlite handle** 造出来,
//       否则拒 `CHALLENGE_STORE_UNBOUND` —— 判据是**模块私有 WeakMap 的成员资格**, 外部无法伪造
//       (鸭子类型/Symbol 都可伪造 = 还是靠调用方自觉, 正是被判不合格的那一档);
//    ③ 事务内: **前置读**(必须仍 unused, 防并发重放)→ 消费 → **后置读**(必须已 used, 防空消费);
//       任一不满足 ⇒ 抛出 ⇒ INSERT 一并回滚;
//    ④ 事务用 `.immediate`(BEGIN IMMEDIATE), 使写锁的取得**与语句顺序无关**。
//
// 🔴 **(359) 又收窄一层 —— 前面收的是【消费】的 authority, 这一层收的是【签发/过期】的**:
//    Codex 3c6fccf8 判 a79a856c 三项 CLOSED, 但 PoP 验的 `challengeRecord` 仍是**调用方直接递进来的**
//    ⇒ 他可以递一个【伪造的 / 未过期的】record 骗过 PoP, **即使 store 里那条早已过期或已用**。
//    ⇒ ⑤ `challengeRecord` 参数**删除**; record 由本模块从 bound store 现读(唯一来源, 不比对不兜底);
//      ⑥ 事务内**除 usedAt 外还查 expiresAt**(第二次、在写锁之内), 过期即 `CHALLENGE_EXPIRED` 回滚。
//
// 🔴 **(364) 第四级 —— 谁有权说"现在几点"**(@KANet-UI 抓, 我没想到; @Bettor 裁结构做掉不走书面要求):
//    过期链两处都直接信调用方传入的 `now` ⇒ 一个把 `now` 接成客户端请求体里时间戳的调用方,
//    能用同一个伪造值**同时**骗过 PoP 与事务内重检(两处都信它, 不是各自量一次)。
//    ⇒ ⑦ `now` 参数**删除**, 模块自取服务端时钟; 测试注入点是 `__testOnlyClock`
//      (带 `__testOnly` 前缀 = 生产调用方没有面可以喂时间)。
//    🔨 **四级同一主题**: 谁有权说"它被用掉了" / "它和身份表在同一事务里" / "它还没过期" / "现在几点"。
//    🔨 而四级里有三级的修法**都不是"在 spec 里要求调用方"**, 是把它在**结构上**做掉 ——
//       (343)(354) 两次证明"契约要求调用方提供 X" = 冻一个假保证; 第四级本来差点又走上那条路。
//    ⚠ 验签(async)留在事务**外**先跑: better-sqlite3 的事务是同步的, 里面不能 await。
//    ⚠ 表 schema 可 post-land; `createChallengeStore` 要求表**已存在**, 不自建、不碰 migrate.js。
import { rootFingerprint, verifyRegistrationBinding } from './u1-same-origin.mjs';
import { verifyRegistrationPop } from './u1-registration-pop.mjs';
import { isStoreBoundTo } from './u1-challenge-store.mjs';

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
  CHALLENGE_STORE_UNBOUND: 'CHALLENGE_STORE_UNBOUND',       // store 不是本进程用【同一 sqlite handle】造的 ⇒ 拒(事务域不同=原子性不成立)
  CHALLENGE_EXPIRED: 'CHALLENGE_EXPIRED',                   // (359) 事务内重读发现已过期 ⇒ 拒(签发/过期 authority 归 store)
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
 * @param {object} a.challengeStore     **必传**: 由 `createChallengeStore(【同一个】sqlite handle, table)` 造。
 *                                     未绑定同一事务域 ⇒ 拒 `CHALLENGE_STORE_UNBOUND`(理由见文件头 (354) 那段)。
 *                                     store 自己拥有 SQL(消费是 CAS), 调用方没有机会把它写成非 CAS。
 * @param {function} [a.verifyMessageFn]   仅测试注入
 */
export async function registerIdentity(args = {}) {
  // 🔴 (366) 生产入口**不接收任何时钟**, 也不看 args 里有没有类时钟的字段 ——
  //    时钟由这里【钉死】成服务端 `Date.now()`, 调用方在这条路上没有任何面可以影响它。
  //    ⇒ 就算有人把 `req.body` 整个展开进来, 也影响不到时间判定。
  return _registerIdentityWithClock(args, () => Date.now());
}

/**
 * 🔴 **仅测试可用的时钟注入入口 —— 生产代码禁止 import 本导出**。
 * (366) @KANet-UI 抓: (364) 我把 `__testOnlyClock` 放在生产签名里, 那只是**命名约定**没有结构强制 ——
 * 任何调用方(含把 `req.body` 展开进 options 的粗心 handler)塞一个同名函数就能伪造时间,
 * **等于把 (364) 刚关掉的洞换个参数名重开了一次**。他判得对: 那和 (354) 被否掉的"鸭子类型检查"同一档。
 * ⇒ 修法取他建议里更强的那条: **把逃逸口整个搬出生产签名**。
 *   生产 `registerIdentity` 的签名里**不存在**这个参数, 测试改 import 本函数。
 *   两者走同一份实现, 但**生产路径上没有这个参数名可写**。
 * @param {object} args    同 registerIdentity
 * @param {function} clock 返回 ms 的时钟; 被调用两次(PoP 前 / 事务内)
 */
export async function __testOnlyRegisterIdentityWithClock(args, clock) {
  return _registerIdentityWithClock(args, clock);
}

async function _registerIdentityWithClock({ sqlite, submission, challengeStore, verifyMessageFn } = {}, clock) {
  const s = submission || {};

  // ① N4-bis —— 注意: **完全不看 s.custody**
  const custody = deriveCustody(sqlite, s.relayId);
  if (!custody.ok) return { ok: false, code: custody.code, reason: custody.reason };

  // ②-a 派生证明(便宜, 且不依赖签名) —— 先拒明显不成立的, 再做验签
  const bind = verifyRegistrationBinding({
    rootXpub: s.rootXpub, identityIndex: s.identityIndex, identityPubkeyXOnly: s.identityPubkeyXOnly,
  });
  if (!bind.ok) return { ok: false, code: REG_REJECT.BINDING_INVALID, reason: bind.reason };

  // ②-c 🔴 (343)+(354): 挑战存储**必须在落库之前就具备, 且必须与身份表同一事务域**, 否则拒。
  //      放在这里(验签之后、写库之前)是有意的: 拒的时候**一个字节都还没写**。
  if (!challengeStore) {
    return {
      ok: false, code: REG_REJECT.CHALLENGE_CONSUME_MISSING,
      reason: '注册要求一次性挑战存储: challengeStore 必传(fail-closed, 不静默跳过消费)',
    };
  }
  // 🔴 (354) Codex c0a1f50c: 上一版收两个自由函数并声称"真 CAS", **作用域错了** ——
  //    `.immediate` 只序列化【身份表所在那个连接】; 存储若在别的连接/别的库, 我持的锁管不到它。
  //    ⇒ 这里不是"检查它长得像不像 store"(鸭子类型可伪造), 而是问
  //      **它是不是本进程用【同一个 sqlite handle】造出来的** —— 外部无法伪造 WeakMap 成员资格。
  if (!isStoreBoundTo(challengeStore, sqlite)) {
    return {
      ok: false, code: REG_REJECT.CHALLENGE_STORE_UNBOUND,
      reason: 'challengeStore 未绑定到本次注册所用的 sqlite 事务域(必须由 createChallengeStore(同一 handle) 构造)⇒ 原子 CAS 不成立, 拒',
    };
  }

  // ②-d 🔴 (359) Codex 3c6fccf8: **challenge record 只能从 bound store 取, 不收调用方给的**。
  //    上一版 PoP 验的是调用方直接递进来的 challengeRecord ⇒ 他可以递一个【伪造/未过期】的,
  //    即使 store 里那条早已过期或已用 —— 签发/过期的 authority 还在调用方手上, 消费的 authority 才被我收回。
  //    ⇒ 这里【不比对、不兜底】, 直接以 store 为唯一来源: 调用方连递的机会都没有(参数已删)。
  const storeRecord = challengeStore.read(s.challenge);

  // ②-b N8 PoP —— 用 store 取出来的 record 验(含 usedAt / expiresAt 两项)
  const pop = await verifyRegistrationPop({ submission: s, challengeRecord: storeRecord, now: clock(), verifyMessageFn });
  if (!pop.ok) return { ok: false, code: REG_REJECT.POP_FAILED, reason: `${pop.code}: ${pop.reason}` };
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
    //    为什么必需: PoP 那步是在事务【外】用 store 现读的 record 判的 ⇒ 两个并发请求
    //    可以【都】拿着 usedAt=null 通过验证。若消费实现写成无条件 `SET used_at=?`(而非 CAS),
    //    两笔都会把它置上、后置条件也都满足 ⇒ **同一挑战注册两次**。
    //    🔴 它成立的【前提】必须写出来(上一版漏写, 被 Codex c0a1f50c 抓下):
    //       store 与身份表**同一事务域**(由 ②-c 的 `isStoreBoundTo` 结构保证)+ `.immediate` 已持写锁。
    //       **离开这个前提, 这一读就不是 CAS** —— 跨连接时我的锁根本管不到对面那个库。
    const before = challengeStore.read(s.challenge);
    if (!before || before.usedAt) {
      throw new _RegTxError(REG_REJECT.CHALLENGE_ALREADY_USED,
        `事务内重读: 挑战已被并发请求用掉(或已不存在) ⇒ 拒, 整笔回滚(usedAt=${before?.usedAt ?? 'record-missing'})`);
    }
    // 🔴 (359): 事务内**同样要查过期**, 不只查 usedAt。
    //    ②-d 的 PoP 已经用 store record 验过一次过期, 这里是**第二次、在写锁之内**再验一次 ——
    //    因为那两次之间 store 里的 expiresAt 仍可能被改(它是一张普通表)。
    //    🔵 **(364) 之后这里【重取一次时钟】** —— 上一版我在这写过一条诚实边界:
    //       "用的是同一个 now, 挡不住真实时间在本次请求内跨过 expiresAt", 并说明"重取会破坏注入 now 的确定性"。
    //       **把 now 改成内部时钟之后, 那个代价没了**: 注入的是一个【函数】, 测试可以让它两次返回不同值,
    //       既能重取、又仍然确定。⇒ 那条残留一并闭掉, 不再是残留。
    //    🔨 记一句: 我当时把"做不到"写得太笃定了 —— 真正挡路的不是"重取"这件事,
    //       而是我当时的**参数形状**(收一个标量 now)。**换了形状, 限制就不存在了。**
    const expMs = before.expiresAt instanceof Date ? before.expiresAt.getTime() : Number(before.expiresAt);
    const nowTx = clock();
    const nowMs = nowTx instanceof Date ? nowTx.getTime() : Number(nowTx);
    if (!Number.isFinite(expMs) || !Number.isFinite(nowMs) || expMs <= nowMs) {
      throw new _RegTxError(REG_REJECT.CHALLENGE_EXPIRED,
        `事务内重读: 挑战已过期或 expiresAt 不可读 ⇒ 拒, 整笔回滚(expiresAt=${before.expiresAt}, now=${nowMs})`);
    }

    // 消费: 抛错即回滚(连同上面那条 INSERT)
    try { challengeStore.consume(s.challenge); }
    catch (e) { throw new _RegTxError(REG_REJECT.CHALLENGE_CONSUME_FAILED, `挑战消费失败, 整笔回滚: ${e?.message || e}`); }

    // 🔴 后置条件: 事务内重读, 必须真的变成 used。
    //    没有这一条, 一个【什么也不做】的 consume 会读成成功 —— 那正是 (343) 被抓的形状
    //    (谓词对, 但没有东西让它的前提成立)。
    const after = challengeStore.read(s.challenge);
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
