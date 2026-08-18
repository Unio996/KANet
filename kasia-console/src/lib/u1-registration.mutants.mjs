// u1-registration.mjs 的变异测试 —— 补的是 (333)(334) 指名的洞①:
// 这个文件组装 N4-bis(custody 自查)+ 绑定 + N8(PoP)+ 落库四件, 且明写"完全不看 s.custody",
// 是同族三模块(same-origin/registration-pop/registration)里此前唯一没有变异测试兜底的一个,
// 也是未来最可能被"顺手清理"改坏的地方(Bettor 20:09Z 点名: custody.custody → s.custody 这类回改)。
// 🔴 三类计数缺一不可: MISSED(拆了没红) / INERT(没改到文件) / BROKEN(改成语法坏的, 必然"检出")。
// 🔴 收尾验还原逐字节相同 —— 变异体留在库里比不跑变异更糟。
// ✅ **本套走隔离执行器**(harness② · mutation-runner.mjs): 变异只改 `kasia-console/.mut-tmp-<pid>/` 里的**副本**,
//    共享工作树零写入(每次跑都实测复验: 真源 sha256 + node_modules 项数)。
// 🔴 **而"零写入自证是绿的"救不了这个仪器 —— 实测两次**(细节见 mutation-runner.mjs 抬头):
//    一次自证全绿却毁了 node_modules(量错了范围), 一次**恒红**却读数完全正常(ESM 不认 NODE_PATH)。
//    ⇒ **能给这些数字撑腰的只有【阴性对照臂】**(等价改写必须 MISSED), 不是"读数和上次一样"——
//    本套的正确答案本来就是全 detected, **恒红装置产出一模一样的数字**。
//    改了 mutation-runner.mjs ⇒ 先跑 `scratch/_j2_harness2_selfverify.mjs` 三臂全过, 再信下面的读数。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMutationsIsolated } from './mutation-runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const nlOf = (t) => (t.includes('\r\n') ? '\r\n' : '\n');
const MUTANTS = [
  // 🔴🔴 首格必须是 no-op 探针(设计报告 §6.6 采纳): 只加一行注释, 不改任何行为 ⇒ 必须 MISSED。
  //    它若被 detect, 说明本装置对任何改动都变红 ⇒ 整轮读数作废。
  //    🔨 为什么非要不可: 本套的【正确答案本来就是全 detected】,
  //    所以一个恒红的坏仪器会产出与好仪器【逐字相同】的读数 ——
  //    这个坑 2026-08-17 真发生过(ESM 不认 NODE_PATH, 恒红而读数完全正常)。
  //    阴性臂是唯一能分辨这两者的东西。
  ['[阴性臂] no-op 探针: 只加一行注释(不改行为) ⇒ 必须 MISSED',
    (s) => s + nlOf(s) + '// no-op probe (mutation harness negative arm)'],
  // 🔴 头一条是 Bettor 20:09Z 点名那个具体回改: 落库读提交值而不是服务端派生值
  ['落库用提交方 custody 而非服务端派生值(整层承重点失守)',
    (s) => s.replace(
      "        custody2.custody);   // 🔴 服务端派生值, 且是【事务内】那次 —— 不是 s.custody, 也不是事务外那次",
      "        s.custody);")],
  // 🔴 ②/①-10b (2026-08-18): TOCTOU 修完后新增两格。
  //    这两格盯的是【未来有人顺手清理】: 事务内重派生看上去像冗余
  //    (上面刚算过一次), 而它正是 ② 的全部内容。
  ['② 事务内重派生闸拆掉(重派生不 ok 也继续写)',
    (s) => s.replace('    if (!custody2.ok) {', '    if (false) {')],
  // N4-bis 三道子闸(deriveCustody 内部)
  ['deriveCustody: relay 查无此 id 也放行',
    (s) => s.replace("if (!row) return { ok: false, code: REG_REJECT.RELAY_UNKNOWN, reason: `relay_nodes 里没有 id=${relayId}` };", '')],
  ['deriveCustody: 混合态(mnemonic+privkey 皆非空)也放行',
    (s) => s.replace('if (hasMnemonic && hasPrivkey) {', 'if (false) {')],
  ['deriveCustody: privkey-only(无 mnemonic)也放行',
    (s) => s.replace('if (!hasMnemonic) {', 'if (false) {')],
  // registerIdentity 主流程三道闸
  ['①N4-bis 闸拆掉(custody 不合格也继续走)',
    (s) => s.replace('if (!custodyPre.ok) return { ok: false, code: custodyPre.code, reason: custodyPre.reason };', 'if (false) return null;')],
  ['②绑定闸拆掉(派生证明不合格也继续走)',
    (s) => s.replace('if (!bind.ok) return { ok: false, code: REG_REJECT.BINDING_INVALID, reason: bind.reason };', 'if (false) return null;')],
  ['③N8 PoP 闸拆掉(签名/挑战不合格也继续走)',
    (s) => s.replace('if (!pop.ok) return { ok: false, code: REG_REJECT.POP_FAILED, reason: `${pop.code}: ${pop.reason}` };', 'if (false) return null;')],
  // ── (372): expectedTable 必填(缺参 fail-closed 而非静默只验 handle) ──
  ['🔴 调用点退回两参 isStoreBoundTo(退回 (372) 原病: 少传一个静默只验 handle)',
    (s) => s.replace('  if (!isStoreBoundTo(challengeStore, sqlite, expectedTable)) {', '  if (!isStoreBoundTo(challengeStore, sqlite)) {')],
  // ── (370): store 绑定必须含【表身份】维 ──
  ['🔴 绑定只验 handle 不验表(退回 (370) 原病: 指向调用方自建表的 store 照过)',
    (s) => s.replace('  if (!isStoreBoundTo(challengeStore, sqlite, expectedTable)) {', '  if (!isStoreBoundTo(challengeStore, sqlite)) {')],
  ['生产入口不再钉规范表(expectedTable 传 undefined ⇒ 表维失效)',
    (s) => s.replace('verifyMessageFn: undefined, expectedTable: CANONICAL_CHALLENGE_TABLE });', 'verifyMessageFn: undefined, expectedTable: undefined });')],
  // ── (368): verifier 面必须在生产签名之外 ──
  ['🔴 把 verifier 逃逸口搬回生产签名(恒真验证器可关掉整个 N8)',
    (s) => s.replace('verifyMessageFn: undefined, expectedTable:', 'verifyMessageFn: args?.verifyMessageFn, expectedTable:')],
  // ── (366): 逃逸口必须在生产签名【之外】 ──
  //    ⚠ 这三格的锚点随 (366) 改签名一起换过 —— 旧锚点已不在文件里, 留着会变 INERT(等于什么都没测)。
  ['🔴 把时钟逃逸口搬回生产签名(退回 (364) 的命名约定档: 调用方塞同名字段即可伪造时间)',
    (s) => s.replace(
      '  return _registerIdentityImpl(args, { clock: () => Date.now(), verifyMessageFn: undefined, expectedTable: CANONICAL_CHALLENGE_TABLE });',
      "  return _registerIdentityImpl(args, { clock: typeof args?.__testOnlyClock === 'function' ? args.__testOnlyClock : () => Date.now(), verifyMessageFn: undefined, expectedTable: CANONICAL_CHALLENGE_TABLE });")],
  // ── (364): 时钟 authority ──
  ['🔴 生产入口改收调用方的 now(退回 (364) 原病: 伪造 now 骗过过期检查)',
    (s) => s.replace(
      '  return _registerIdentityImpl(args, { clock: () => Date.now(), verifyMessageFn: undefined, expectedTable: CANONICAL_CHALLENGE_TABLE });',
      '  return _registerIdentityImpl(args, { clock: () => (args?.now ?? Date.now()), verifyMessageFn: undefined, expectedTable: CANONICAL_CHALLENGE_TABLE });')],
  ['事务内不再重取时钟(退回用 PoP 那一刻的时间)',
    (s) => s
      .replace('now: clock(), verifyMessageFn });', 'now: (globalThis.__popSnap = clock()), verifyMessageFn });')
      .replace('    const nowTx = clock();', '    const nowTx = globalThis.__popSnap;')],
  // ── (359): 签发/过期 authority ──
  ['🔴 record 改回收调用方给的(退回 (359) 原病: 伪造/未过期 record 骗过 PoP)',
    (s) => s.replace('  const storeRecord = readBoundChallenge(challengeStore, sqlite, expectedTable, s.challenge);', '  const storeRecord = arguments[0]?.challengeRecord ?? readBoundChallenge(challengeStore, sqlite, expectedTable, s.challenge);')],
  ['事务内 expiry 重检拆掉(过期发生在 PoP 之后就没人管)',
    (s) => s.replace('    if (!Number.isFinite(expMs) || !Number.isFinite(nowMs) || expMs <= nowMs) {', '    if (false) {')],
  // ── (343)+(354): 一次性挑战 + 事务域绑定, 每一段都要被咬 ──
  ['fail-closed 闸拆掉: 不给 challengeStore 也放行(退回 optional, 即 (343) 原病)',
    (s) => s.replace('  if (!challengeStore) {', '  if (false) {')],
  ['🔴 事务域绑定检查拆掉: 任何长得像 store 的对象都放行((354) 原病)',
    (s) => s.replace('  if (!isStoreBoundTo(challengeStore, sqlite, expectedTable)) {', '  if (false) {')],
  ['前置重读拆掉(并发重放闸)⇒ 另一连接已用掉也照样注册',
    (s) => s.replace('    if (!before || before.usedAt) {', '    if (false) {')],
];

// 🔴 **结构上测不到的三格 —— 不是漏测, 是 (354) 之后它们【进不去】了; 明列出来, 不删也不算进 MISSED**
//    为什么不静默删: 一个永远 MISSED 的变异会训练人忽略 MISSED; 而静默删掉又会让下一个人以为这三处有覆盖。
const UNREACHABLE = [
  ['①-10b 落库改回用 custodyPre(事务外那次的旧结论)', '🔴 它在今天是【等价改写】, 不是缺陷: deriveCustody 的 ok 分支全文件只有一个取值(:138 return { ok: true, custody: 「mnemonic」 }, 已 grep 实核) ⇒ 两次都 ok 时 custodyPre.custody 与 custody2.custody 必然相等; 而一旦重派生不 ok, 上面那条 throw 已经整笔回滚、INSERT 根本不执行 ⇒ 【写哪个变量】在外部观察不到。 🔨 而这正是我删掉值比对那条死分支的同一个理由 —— §8 预注册 ①-10b 时没看出它得了同一种病, 我删比对时也没回头看这格。 🔵 ② 的承重点因此是【重新派生 + 不 ok 就回滚】, 不是【写哪个变量】; 那一格由另一条变异「② 事务内重派生闸拆掉」正面覆盖, 实测 detect。 🔴 保留 custody2 而不回改成 custodyPre: 它是 correct-by-construction, 将来 deriveCustody 多出第二个取值时不需要任何人想起来回来改这里。'],
  ['消费抛错被吞', '前置读已保证 unused + store 的 CAS UPDATE 在同一事务/同一连接内必然 changes=1 ⇒ consume 在前置读通过后【不可能失败】。catch 是给将来存储不再同域留的纵深, 现在无法从外部触发。'],
  ['后置条件拆掉', 'SQL 归 store 拥有且是 CAS, 调用方【构造不出】空消费 ⇒ 后置读永远为真。这是 (354) 用结构替掉运行时检查的直接后果。'],
  ['(374) 改回解引用调用方 store 的方法', "(374) 之后生产路径拿不到「带方法的绑定对象」: token 是冻结的、且本来就没有 read/consume(H-2 直接断言)。 所以「若 challengeStore.read 存在就用它」这一支永远走不到 —— 不是闸漏了, 是攻击摆不出来。 🔵 (376) 更新: 该攻击现已被 u1-challenge-store.mutants.mjs 【正面覆盖】(那边直接把方法挂回 token, 实测 detect)。 ⇒ 它在【本文件】仍测不到, 但在整体上不再是缺口 —— 这一条留着是为了说清「为什么本文件测不到它」, 不是说没人测。"],
  ['摘掉 .immediate', 'DEFERRED 与 IMMEDIATE 的差别只在【并发取锁时刻】; 本用例是单进程顺序执行, 观察不到。要测它需要两个进程真争锁, 超出本 harness。'],
];

const REPO_ROOT = join(HERE, '..', '..', '..');
const r = runMutationsIsolated({
  expectMissedFirst: true,
  repoRoot: REPO_ROOT,
  srcRel: "kasia-console/src/lib/u1-registration.mjs",
  testRel: "kasia-console/src/lib/u1-registration.test.mjs",
  mutants: MUTANTS,
  unreachable: typeof UNREACHABLE !== 'undefined' ? UNREACHABLE : [],
});
// 🔴 probeOk 也是退出条件: 探针不对 ⇒ 整轮读数作废, 不得当它通过。
if (r.miss || r.inert || r.broken || !r.probeOk) process.exit(1);
