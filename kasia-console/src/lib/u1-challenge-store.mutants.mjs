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
const TEST = join(HERE, 'u1-registration.test.mjs');   // 沿用现套: 它已端到端覆盖 store 行为

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
const REPO_ROOT = join(HERE, '..', '..', '..');
const r = runMutationsIsolated({
  repoRoot: REPO_ROOT,
  srcRel: "kasia-console/src/lib/u1-challenge-store.mjs",
  testRel: "kasia-console/src/lib/u1-registration.test.mjs",
  mutants: MUTANTS,
  unreachable: typeof UNREACHABLE !== 'undefined' ? UNREACHABLE : [],
});
if (r.miss || r.inert || r.broken) process.exit(1);
