// u1-challenge-store.mjs 的变异测试 —— (376) Codex 80b34870 明确要求, 不再是可选基建。
//
// 🔴 **为什么它必须存在**: 这个文件现在是整条链路里**权威最密**的一处 ——
//    WeakMap 两维绑定 / CAS SQL / 不透明 token / 动词式导出(不交能力)。
//    在它有自己的变异之前, 我在 u1-registration.mutants.mjs 里有两格只能标 UNREACHABLE:
//    "把方法挂回 token" 与 "改回解引用调用方对象" —— 因为那两个攻击**必须在 store 模块里才摆得出来**。
//    ⇒ 本文件把那两格从"结构上测不到"变回真覆盖。
//
// 🔴 三类计数缺一不可: MISSED(拆了没红) / INERT(没改到文件, 计数体面但什么都没测) / BROKEN(语法坏, 必然"检出")。
// 🔴 收尾验还原逐字节相同 —— 变异体留在库里比不跑变异更糟(今晚已咬过两位审查者)。
// ⚠ 与既有 harness 同一形状: **它会原地改生产文件** ⇒ 跑之前请在隔离 worktree, 或至少跑前跑后各查一次 git status。
//    根治(变异跑临时副本)= 已排期的 harness②, 本文件不先行改形状(避免同时 churn 两个仪器)。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'u1-challenge-store.mjs');
const TEST = join(HERE, 'u1-registration.test.mjs');   // 沿用现套: 它已端到端覆盖 store 行为
const CWD = join(HERE, '..', '..');
const original = readFileSync(SRC, 'utf8');
const originalSha = createHash('sha256').update(original).digest('hex');

const MUTANTS = [
  // ── (376) 能力泄漏: 把 ops 重新导出 / 交出去 ──
  ['🔴 重新导出 getBoundOps(交出 registration 正在用的那个可变 ops 对象)',
    (s) => s + '\nexport function getBoundOps(store, sq, tb) { return BOUND.get(store).ops; }\n'],
  ['动词式导出改成返回 ops(读动作退化成交能力)',
    (s) => s.replace('  return BOUND.get(store).ops.read(challenge);', '  return BOUND.get(store).ops;')],
  // ── (374) 不透明 token: 把方法挂回 token(这一格此前在 registration 侧只能标 UNREACHABLE) ──
  ['🔴 把 read/consume 挂回 token(退回 (374) 原病: 调用方能替换权威方法)',
    (s) => s.replace(
      "  const store = Object.freeze({ __u1ChallengeStoreToken: true });",
      "  const store = { __u1ChallengeStoreToken: true, read: ops.read, consume: ops.consume };")],
  ['去掉 token 的 Object.freeze(弱兜底被拆)',
    (s) => s.replace('Object.freeze({ __u1ChallengeStoreToken: true })', '({ __u1ChallengeStoreToken: true })')],
  // ── (370)(372) 两维绑定 ──
  ['🔴 绑定不记表身份(退回 (370): 指向调用方自建表的 store 照过)',
    (s) => s.replace('  BOUND.set(store, { sqlite, table, ops });', '  BOUND.set(store, { sqlite, table: undefined, ops });')],
  ['isStoreBoundTo 不比表',
    (s) => s.replace('  return b.sqlite === expectedSqlite && b.table === expectedTable;', '  return b.sqlite === expectedSqlite;')],
  ['isStoreBoundTo 不比 handle',
    (s) => s.replace('  return b.sqlite === expectedSqlite && b.table === expectedTable;', '  return b.table === expectedTable;')],
  ['expectedTable 缺参不再 throw(退回 (372): 两参调用静默降级)',
    (s) => s.replace("  if (expectedTable === undefined) {", '  if (false) {')],
  // ── (354) WeakMap 结构绑定本身 ──
  ['🔴 WeakMap 绑定拆掉(任何长得像的对象都算绑定)',
    (s) => s.replace('  const b = BOUND.get(store);\n  if (!b) return false;', '  const b = BOUND.get(store) || { sqlite: expectedSqlite, table: expectedTable };')],
  // ── 消费的 CAS 语义 ──
  ['🔴 CAS 去掉 WHERE used_at IS NULL(已用掉的也能"消费成功")',
    (s) => s.replace('UPDATE ${table} SET used_at = ? WHERE challenge = ? AND used_at IS NULL', 'UPDATE ${table} SET used_at = ? WHERE challenge = ?')],
  ['消费不检查 affected-rows(空转读成成功)',
    (s) => s.replace('      if (info.changes !== 1) {', '      if (false) {')],
  // ── 工厂的 fail-closed ──
  ['表不存在也照造 store(造一个每次都查空的假 store)',
    (s) => s.replace('  if (!exists) {', '  if (false) {')],
];


// 🔴 结构上观察不到的格 —— 不是漏测, 明列并附理由(不删, 也不让它长期挂 MISSED)
const UNREACHABLE = [
  ['去掉内部 ops 的 Object.freeze', '(376) 之后【没有任何导出会交出 ops 对象】(I-1 逐个导出扫过) ⇒ 外部拿不到它, 也就无从观察它冻没冻。' +
    ' 冻结是留给将来某处不慎泄漏引用的纵深, 现在从模块外测不出差别。要能测它, 得先存在一条泄漏路径 —— 而那条路径本身就是缺陷。'],
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
console.log('\n[结构上观察不到 · 明列, 不计入 MISSED]');
for (const [n, why] of UNREACHABLE) console.log(`  · ${n} — ${why}`);
console.log(`\ndetected=${det}  MISSED=${miss}  INERT=${inert}  BROKEN=${broken}  UNREACHABLE=${UNREACHABLE.length}`);
if (miss || inert || broken) process.exit(1);
