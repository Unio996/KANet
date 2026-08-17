// harness② 的**自验** —— 跑法: `node src/lib/mutation-runner.selfcheck.mjs`(在 kasia-console/ 下)
//
// 🔴 **它为什么在仓库里而不在 scratch/**: @Bettor 把"自验跑通"立成了改 mutation-runner.mjs 的**落地前置**。
//    前置条件放在 gitignored 的 scratch/ 里, 下一个改这个仪器的人**根本看不到它** ⇒ 那就不是前置条件, 是我一个人的习惯。
//
// 🔴 **验的不是"跑出好看的数", 是三件**:
//   ① **阳性臂**: 注入一个【已知必红】的变异 ⇒ 必须 detect(证明它会红, 不是恒绿)
//   ② **阴性臂**: 注入一个【等价改写】(只加注释, 不改行为) ⇒ **必须 MISSED**(证明它不是"什么都判红")
//   ③ **副作用面**: 跑完主树真源 sha256 与 node_modules 项数都不变
//
// 🔴🔴 **②不是补充, 它是唯一的分辨器**。本仓两套变异清单的正确答案**本来就是全 detected** ——
//    所以"读数和上次一样"**零判别力**: 一个恒红的坏仪器与一个好仪器产出**一模一样的数字**。
//    2026-08-17 实测: 上一版 harness 恒红(ESM 不认 NODE_PATH), 而"两套读数逐字不变"**通过了**。
//    阳性臂**单独也不够** —— 恒红装置照样过阳性臂。
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMutationsIsolated } from './mutation-runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');                    // kasia-console/src/lib → 仓库根
const SRC_REL = 'kasia-console/src/lib/u1-registration.mjs';
const TEST_REL = 'kasia-console/src/lib/u1-registration.test.mjs';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const nmDir = join(ROOT, 'kasia-console/node_modules');
const before = { src: sha(join(ROOT, SRC_REL)), nm: readdirSync(nmDir).length };

console.log('=== harness② 自验: 阳性臂 + 阴性臂 一起跑 ===\n');
const r = runMutationsIsolated({
  repoRoot: ROOT,
  srcRel: SRC_REL,
  testRel: TEST_REL,
  mutants: [
    // ① 阳性对照: 拆掉 N8 PoP 闸 —— 已知必红。
    //    ⚠ 它锚在生产代码的一行字面量上: **改了那行, 这一格会静默变 INERT**(什么都没测, 而计数仍体面)。
    //    执行器会把 INERT 单列出来, 别把它读成"过了"。
    ['[阳性对照] 拆掉 N8 PoP 闸(已知必红)',
      (s) => s.replace(
        'if (!pop.ok) return { ok: false, code: REG_REJECT.POP_FAILED, reason: `${pop.code}: ${pop.reason}` };',
        'if (false) return null;')],
    // ② 阴性对照: 等价改写 —— 只加一行注释, 不改任何行为 ⇒ **必须 MISSED**
    ['[阴性对照] 等价改写: 只加一行注释(不改行为, 必须 MISSED)',
      (s) => s.replace('export const REG_REJECT = Object.freeze({',
        '// harness② 自验用的等价改写\nexport const REG_REJECT = Object.freeze({')],
  ],
});

const after = { src: sha(join(ROOT, SRC_REL)), nm: readdirSync(nmDir).length };
const posOk = r.det === 1;
const negOk = r.miss === 1;
const srcOk = before.src === after.src;
const nmOk = before.nm === after.nm;
console.log('\n=== 判读 ===');
console.log(`① 阳性臂 detect=${r.det} (要 1) ⇒ ${posOk ? '✅ 会红' : '🔴 恒绿/或锚点失效(看上面有没有 INERT), 仪器无效'}`);
console.log(`② 阴性臂 MISSED=${r.miss} (要 1) ⇒ ${negOk ? '✅ 不是恒红' : '🔴 等价改写也判红 ⇒ 恒红装置, 所有读数无信息'}`);
console.log(`③ 主树真源 sha256 ${srcOk ? '✅ 未变' : '🔴 变了'}`);
console.log(`③ 主树 node_modules ${before.nm} → ${after.nm} ${nmOk ? '✅ 未变' : '🔴 变了'}`);
const allOk = posOk && negOk && srcOk && nmOk;
console.log(`\n自验结论: ${allOk ? '✅ 三项全过 —— 可以信 mutants 清单的读数' : '🔴 有项不过 —— 别把它当可信仪器, 也别拿它的读数下结论'}`);
process.exitCode = allOk ? 0 : 1;
