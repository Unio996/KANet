// 变异测试的**隔离执行器** —— harness②(@Bettor 批 · (376) 收口后 #1 包 · 本文件是**第二版**)。
//
// 🔴 **它解决的是什么**: 旧 harness **在共享工作树里原地改生产文件**。跑的那几分钟内, 任何人读到那个文件都是错的,
//    而且错得**很像"有人手改"**。今晚它咬到审查者**两次**(@KANet-UI 撞见 clock 逃逸口"被重开" / @NWT 撞见 `if(false)` 残留),
//    两次都只因审查者各自守了"别从脏树下结论"才没酿成误判 —— **那是人的习惯, 不是机制**。
//    🔨 判据: **共享树里一个会【原地改文件】的工具, 它的错误不落在使用者身上, 落在【下一个读文件的人】身上**
//       ⇒ "跑的人记得还原"这类修法方向本身就错(它约束的是不受害的那一方)。
//
// ══════ 🔴🔴 本文件已经栽过两次, 两次都是"看起来完全正确"的状态。写在最前面, 因为它们比机制本身重要 ══════
//
// **第一次(毁了 node_modules)**: 我用 Windows junction 把主树 `node_modules` 挂进隔离树,
//    收尾的 `git worktree remove --force` **顺着 junction 删穿**, 清空了主树那份真的依赖。
//    ⚠ 而我当时**已经加了"共享树零写入"的正向自证, 它全程是绿的** —— 因为我量的是**那一个源文件的 sha256**,
//    而破坏发生在 **node_modules**。
//    🔨 **自证只覆盖到你想到的那一类写入。声称"零写入"必须说清是【哪个范围】。**
//    ⇒ 本版**不建任何链接**(junction/symlink 一律不用), 并把副作用面复验扩到依赖目录。
//
// **第二次(恒红装置)**: 我改用 `NODE_PATH` 接依赖 —— 而 **ESM 根本不认 NODE_PATH**(只对 CommonJS 生效)。
//    隔离树里测试 `ERR_MODULE_NOT_FOUND` **永远失败** ⇒ **每一格变异都被判 detected**。
//    ⚠ 而我当时的验收判据是"两套读数逐字不变" —— **它通过了**。因为那两套的正确答案**本来就是"全部 detected"**,
//    **一个恒红的坏仪器与一个好仪器产出一模一样的数字**。
//    🔨 **"读数没变"只在【预期读数里存在非全绿/非全红的格】时才有判别力。**
//    ⇒ 真正的分辨器是**阴性对照臂**: 注入一个**等价改写(no-op)**, 它**必须存活(MISSED)**。
//       阳性臂单独不够 —— 恒红装置照样通过阳性臂。
//
// 🔨 **⇒ 落地硬前置(@Bettor 立)**: 改动本文件后, **自验(阳性必 detect ∧ 阴性必 MISSED ∧ 副作用面不变)跑通才算落地**,
//    不是事后补的一步。见 `scratch/_j2_harness2_selfverify.mjs`。
//
// ══════ 做法(第二版) ══════
// 把 `kasia-console/src` 整棵拷进 `kasia-console/.mut-tmp-<pid>/`(gitignored) → 变异只改副本 → 测试跑副本 → finally 删目录。
//   · 为什么拷**整个 src**: 测试要 `../db/migrate.js`、`../db/client.js`, 只拷 `src/lib` 解析不到。实测 9MB / 0.5s。
//   · 为什么放在 `kasia-console/` **里面**: node 的模块解析**向上走**, 在 `kasia-console/` 找到 `node_modules`
//     ⇒ **ESM 正常解析, 且零链接** —— 这同时避开了上面两次事故的两个根因。
//   · 清理只 `rm -rf` 那个临时目录(其中**不含任何链接**, 所以删不穿)。
import { rmSync, cpSync, existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * 在 kasia-console/.mut-tmp-<pid>/ 的副本上跑一轮变异。
 * @param {object} a
 * @param {string} a.repoRoot    仓库根(共享树)
 * @param {string} a.srcRel      被变异文件, 相对仓库根(必须在 kasia-console/src 下)
 * @param {string} a.testRel     测试文件, 相对仓库根(必须在 kasia-console/src 下)
 * @param {Array}  a.mutants     [[name, fn(srcText)->mutatedText], ...]
 * @param {Array}  a.unreachable [[name, why], ...] —— ⚠ **只打印, 不执行**: 它是静态预声明,
 *                               **不能拿"输出里有 UNREACHABLE"当'仪器非恒红'的证据**(恒红装置照样打印它)。
 */
export function runMutationsIsolated({ repoRoot, srcRel, testRel, mutants, unreachable = [] }) {
  const consoleDir = join(repoRoot, 'kasia-console');
  const tmpDir = join(consoleDir, `.mut-tmp-${process.pid}`);
  const nodeModules = join(consoleDir, 'node_modules');
  const SRC_PREFIX = 'kasia-console/src/';
  for (const rel of [srcRel, testRel]) {
    if (!rel.startsWith(SRC_PREFIX)) {
      throw new Error(`mutation-runner: ${rel} 不在 ${SRC_PREFIX} 下 — 本执行器只搬 src 树, 拒绝继续`);
    }
  }
  if (!existsSync(nodeModules)) throw new Error(`mutation-runner: 主树 node_modules 不存在: ${nodeModules}`);

  // ── 副作用面基线(两条: 真源文件 + 真依赖目录。第一次事故就毁在第二条上) ──
  const realSrc = join(repoRoot, srcRel);
  const shaBefore = createHash('sha256').update(readFileSync(realSrc)).digest('hex');
  const nmBefore = readdirSync(nodeModules).length;

  try {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    cpSync(join(consoleDir, 'src'), join(tmpDir, 'src'), { recursive: true });

    // 🔴 ① 用【工作树当前版本】覆盖副本 —— 不是 HEAD。
    //    否则变异测的是【已提交的旧码】, 正在改的东西根本没被测到, **而读数照样漂亮**。
    const sub = (rel) => join(tmpDir, rel.slice('kasia-console/'.length));
    for (const rel of [srcRel, testRel]) cpSync(join(repoRoot, rel), sub(rel));
    const srcAbs = sub(srcRel);
    const testAbs = sub(testRel);

    // 🔴🔴 隔离自证(@Bettor 重定义, 比我原来那版准):
    //    要守的**不是**"待变异路径在不在仓库内"(本版就在仓库内), 而是
    //    **"我写的不是真源文件, 也不是真依赖"**。
    if (resolve(srcAbs) === resolve(realSrc)) {
      throw new Error(`mutation-runner: 🔴 自证失败 — 待变异路径就是真源文件 ${realSrc}, 拒绝继续`);
    }
    if (resolve(srcAbs).toLowerCase().startsWith(resolve(nodeModules).toLowerCase())) {
      throw new Error('mutation-runner: 🔴 自证失败 — 待变异路径落在共享 node_modules 内, 拒绝继续');
    }
    console.log(`[isolate] 变异副本 = ${srcAbs}`);
    console.log(`[isolate] 真源文件 = ${realSrc}  (sha256 ${shaBefore.slice(0, 12)}… 跑完复验)`);
    console.log(`[isolate] 真依赖   = ${nodeModules}  (${nmBefore} 项, 跑完复验; 第一次事故就毁在这)`);

    const original = readFileSync(srcAbs, 'utf8');
    let det = 0; let miss = 0; let inert = 0; let broken = 0;
    for (const [name, fn] of mutants) {
      const mutated = fn(original);
      if (mutated === original) { inert += 1; console.log(`[INERT ] ${name} — 变异没改动文件, 这条什么也没测`); continue; }
      writeFileSync(srcAbs, mutated, 'utf8');
      let syntaxOk = true;
      try { execFileSync(process.execPath, ['--check', srcAbs], { stdio: 'ignore' }); } catch { syntaxOk = false; }
      if (!syntaxOk) { broken += 1; console.log(`[BROKEN] ${name} — 变异体语法坏, 必然"检出", 什么也没证`); writeFileSync(srcAbs, original, 'utf8'); continue; }
      let green = true;
      try { execFileSync(process.execPath, [testAbs], { stdio: 'ignore', cwd: tmpDir }); } catch { green = false; }
      if (green) { miss += 1; console.log(`[MISSED] ${name} — 闸被拆掉而用例【全绿】`); }
      else { det += 1; console.log(`[detect] ${name}`); }
      writeFileSync(srcAbs, original, 'utf8');
    }

    if (unreachable.length) {
      console.log('\n[结构上测不到 · 明列, 不计入 MISSED —— ⚠ 只打印不执行, 不是"非恒红"的证据]');
      for (const [n, why] of unreachable) console.log(`  · ${n} — ${why}`);
    }
    console.log(`\ndetected=${det}  MISSED=${miss}  INERT=${inert}  BROKEN=${broken}`
      + (unreachable.length ? `  UNREACHABLE=${unreachable.length}` : ''));

    // ── 副作用面复验(两条都要, 这是第一次事故换来的) ──
    const shaAfter = createHash('sha256').update(readFileSync(realSrc)).digest('hex');
    if (shaAfter !== shaBefore) {
      throw new Error(`mutation-runner: 🔴🔴 真源文件 ${srcRel} 被本次运行改动了 — 隔离没成立, 别拿读数下结论`);
    }
    const nmAfter = readdirSync(nodeModules).length;
    if (nmAfter !== nmBefore) {
      throw new Error(`mutation-runner: 🔴🔴 主树 node_modules 项数变了(${nmBefore} → ${nmAfter}) — 正是第一次事故的形态, 立刻停手`);
    }
    console.log(`[isolate] ✅ 真源文件 sha256 未变 ⇒ 源零写入(实测)`);
    console.log(`[isolate] ✅ 真依赖仍 ${nmAfter} 项 ⇒ 依赖零改动(实测)`);
    console.log(`[isolate] 临时副本 ${basename(tmpDir)} 已在 finally 中删除`);
    return { det, miss, inert, broken };
  } finally {
    // 目录内**不含任何链接** ⇒ 删不穿(这正是第一次事故的修法)
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 已不在 */ }
  }
}
