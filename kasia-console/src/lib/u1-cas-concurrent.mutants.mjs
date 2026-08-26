// u1-cas-concurrent.test.mjs 的反向臂(Bettor 派工 (11) ②): 拆掉 CAS 的承重件, 用例必须变红 —— 证明它测到的是 CAS 而不是别的什么。
// 走 harness② 隔离执行器(mutation-runner.mjs): 只改 .mut-tmp-<pid>/ 里的副本, 真源零写入, 跑完复验 sha256。
// 🔴 首格 no-op 探针必须 MISSED(仪器阴性臂): 本套正确答案是全 detected, 恒红的坏仪器会给出一模一样的读数。
// 跑: cd kasia-console && node src/lib/u1-cas-concurrent.mutants.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMutationsIsolated } from './mutation-runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const nlOf = (t) => (t.includes('\r\n') ? '\r\n' : '\n');
const must = (s, from, to, label) => { if (!s.includes(from)) throw new Error(`变异锚点没找到(${label}): ${from.slice(0, 60)}`); return s.replace(from, to); };

const MUTANTS = [
  ['[阴性臂] no-op 探针: 只加一行注释(不改行为) ⇒ 必须 MISSED',
    (s) => s + nlOf(s) + '// no-op probe (mutation harness negative arm)'],
  // ① .immediate 拆成裸 BEGIN(DEFERRED): 单进程编排臂看不出(同一连接串行), 只有臂 C1 双进程锁层能抓 ——
  //    DEFERRED 下第二进程的 INSERT 撞 RESERVED ⇒ SQLITE_BUSY/CONSTRAINT 而非 :253 ⇒ C1 红
  ['① `.immediate` 拆成默认 DEFERRED 事务(锁在第一条写语句才取)',
    (s) => must(s, '  }).immediate;', '  });', '.immediate')],
  // ② 去掉 store 同事务域绑定检查 ⇒ 臂 D1 红(别的连接的 store 不再被拒)
  ['② 去掉 isStoreBoundTo 同事务域检查',
    (s) => must(s, '  if (!isStoreBoundTo(challengeStore, sqlite, expectedTable)) {', '  if (false) {', 'isStoreBoundTo')],
  // ③ 去掉事务内前置重读(usedAt)⇒ 臂 A2/C1 的第二笔不再被 :253 拒(会撞 CHALLENGE_NOT_CONSUMED 或双落库)⇒ 红
  ['③ 去掉事务内 usedAt 重读闸(:252-255)',
    (s) => must(s, '    if (!before || before.usedAt) {', '    if (false) {', 'in-tx usedAt')],
  // ④ 去掉事务内过期重读 ⇒ 臂 B1 红(不再 CHALLENGE_EXPIRED, 会落库)
  ['④ 去掉事务内 expiresAt 重读闸(:268-271)',
    (s) => must(s, '    if (!Number.isFinite(expMs) || !Number.isFinite(nowMs) || expMs <= nowMs) {', '    if (false) {', 'in-tx expiresAt')],
];

const r = runMutationsIsolated({
  expectMissedFirst: true,
  repoRoot: join(HERE, '..', '..', '..'),
  srcRel: 'kasia-console/src/lib/u1-registration.mjs',
  testRel: 'kasia-console/src/lib/u1-cas-concurrent.test.mjs',
  mutants: MUTANTS,
});
process.exit(r && r.probeOk && r.miss === 0 && r.inert === 0 && r.broken === 0 ? 0 : 1);
