// u1-registration.mjs 的变异测试 —— 补的是 (333)(334) 指名的洞①:
// 这个文件组装 N4-bis(custody 自查)+ 绑定 + N8(PoP)+ 落库四件, 且明写"完全不看 s.custody",
// 是同族三模块(same-origin/registration-pop/registration)里此前唯一没有变异测试兜底的一个,
// 也是未来最可能被"顺手清理"改坏的地方(Bettor 20:09Z 点名: custody.custody → s.custody 这类回改)。
// 🔴 三类计数缺一不可: MISSED(拆了没红) / INERT(没改到文件) / BROKEN(改成语法坏的, 必然"检出")。
// 🔴 收尾验还原逐字节相同 —— 变异体留在库里比不跑变异更糟。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'u1-registration.mjs');
const TEST = join(HERE, 'u1-registration.test.mjs');
const CWD = join(HERE, '..', '..');
const original = readFileSync(SRC, 'utf8');
const originalSha = createHash('sha256').update(original).digest('hex');

const MUTANTS = [
  // 🔴 头一条是 Bettor 20:09Z 点名那个具体回改: 落库读提交值而不是服务端派生值
  ['落库用提交方 custody 而非服务端派生值(整层承重点失守)',
    (s) => s.replace(
      "        custody.custody);   // 🔴 服务端派生值, 不是 s.custody",
      "        s.custody);")],
  // N4-bis 三道子闸(deriveCustody 内部)
  ['deriveCustody: relay 查无此 id 也放行',
    (s) => s.replace("if (!row) return { ok: false, code: REG_REJECT.RELAY_UNKNOWN, reason: `relay_nodes 里没有 id=${relayId}` };", '')],
  ['deriveCustody: 混合态(mnemonic+privkey 皆非空)也放行',
    (s) => s.replace('if (hasMnemonic && hasPrivkey) {', 'if (false) {')],
  ['deriveCustody: privkey-only(无 mnemonic)也放行',
    (s) => s.replace('if (!hasMnemonic) {', 'if (false) {')],
  // registerIdentity 主流程三道闸
  ['①N4-bis 闸拆掉(custody 不合格也继续走)',
    (s) => s.replace('if (!custody.ok) return { ok: false, code: custody.code, reason: custody.reason };', 'if (false) return null;')],
  ['②绑定闸拆掉(派生证明不合格也继续走)',
    (s) => s.replace('if (!bind.ok) return { ok: false, code: REG_REJECT.BINDING_INVALID, reason: bind.reason };', 'if (false) return null;')],
  ['③N8 PoP 闸拆掉(签名/挑战不合格也继续走)',
    (s) => s.replace('if (!pop.ok) return { ok: false, code: REG_REJECT.POP_FAILED, reason: `${pop.code}: ${pop.reason}` };', 'if (false) return null;')],
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
    (s) => s.replace('  const storeRecord = challengeStore.read(s.challenge);', '  const storeRecord = arguments[0]?.challengeRecord ?? challengeStore.read(s.challenge);')],
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
  ['消费抛错被吞', '前置读已保证 unused + store 的 CAS UPDATE 在同一事务/同一连接内必然 changes=1 ⇒ consume 在前置读通过后【不可能失败】。catch 是给将来存储不再同域留的纵深, 现在无法从外部触发。'],
  ['后置条件拆掉', 'SQL 归 store 拥有且是 CAS, 调用方【构造不出】空消费 ⇒ 后置读永远为真。这是 (354) 用结构替掉运行时检查的直接后果。'],
  ['摘掉 .immediate', 'DEFERRED 与 IMMEDIATE 的差别只在【并发取锁时刻】; 本用例是单进程顺序执行, 观察不到。要测它需要两个进程真争锁, 超出本 harness。'],
];

let det = 0; let miss = 0; let inert = 0; let broken = 0;
try {
  for (const [name, fn] of MUTANTS) {
    const mutated = fn(original);
    if (mutated === original) { inert += 1; console.log(`[INERT ] ${name} — 变异没改动文件, 这条什么也没测`); continue; }
    writeFileSync(SRC, mutated, 'utf8');
    let syntaxOk = true;
    try { execFileSync(process.execPath, ['--check', SRC], { stdio: 'ignore' }); } catch { syntaxOk = false; }
    if (!syntaxOk) { broken += 1; console.log(`[BROKEN] ${name} — 变异体语法坏, 必然"检出", 什么也没证`); continue; }
    let green = true;
    try { execFileSync(process.execPath, [TEST], { stdio: 'ignore', cwd: CWD }); } catch { green = false; }
    if (green) { miss += 1; console.log(`[MISSED] ${name} — 闸被拆掉而用例【全绿】`); }
    else { det += 1; console.log(`[detect] ${name}`); }
  }
} finally {
  writeFileSync(SRC, original, 'utf8');
  const back = createHash('sha256').update(readFileSync(SRC, 'utf8')).digest('hex');
  console.log(back === originalSha ? '\n[restore] 逐字节还原已验(sha256 相同)' : `\n🔴🔴 [restore] 还原【对不上】! 手工检查 ${SRC}`);
  if (back !== originalSha) process.exit(2);
}
console.log('\n[结构上测不到 · 明列, 不计入 MISSED]');
for (const [n, why] of UNREACHABLE) console.log(`  · ${n} — ${why}`);
console.log(`\ndetected=${det}  MISSED=${miss}  INERT=${inert}  BROKEN=${broken}  UNREACHABLE=${UNREACHABLE.length}`);
if (miss || inert || broken) process.exit(1);
