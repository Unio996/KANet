// 变异测试的**隔离执行器** —— harness②(@Bettor 批, (376) 收口后 #1 包)。
//
// 🔴 **它解决的是什么**: 旧的两套 harness **在共享工作树里原地改生产文件**。
//    跑的那几分钟内, 任何人读到那个文件都是错的 —— 而且错得**很像"有人手改"**。
//    今晚它咬到审查者**两次**(00:19 @KANet-UI 撞见 clock 逃逸口"被重开" / 01:32 @NWT 撞见 `if(false)` 残留),
//    两次都只是因为审查者各自独立守了"别从脏树下结论"才没酿成误判 —— **而那是人的习惯, 不是机制**。
//    🔨 判据(入册): **共享工作树里, 一个会【原地改文件】的工具, 它的错误不落在使用者身上,
//       落在【下一个读文件的人】身上** ⇒ 所以"跑的人记得还原"这类修法方向本身就是错的(它约束的是不受害的那一方)。
//
// 🔨 **做法**: 每次跑 → 建一个 detached git worktree → **用 NODE_PATH 指向主树 node_modules(不建任何链接)** →
//    **把【工作树当前版本】的源与测试拷进去** → 变异只在树内发生 → 测试在树内跑 → finally 删树。
//    ⇒ **共享树全程零写入。**
//
// 🔴 **三处"做错了会很静"的地方(前两条 @Bettor 逐条认可; 第三条是我自己栽出来的)**:
//   ① **必须拷工作树当前版本, 不能直接用 HEAD** —— 否则变异测的是【已提交的旧码】,
//      而正在改的东西根本没被测到, **而读数照样漂亮**。
//   ② **依赖接不上时不许静默退回原地变异** —— 那等于把"污染共享树"这个行为偷偷开回来。**fail-closed**。
//   ③ 🔴🔴 **绝不用 junction/symlink 挂 node_modules**(见下方事故记录) —— 收尾的递归删除会**删穿链接**,
//      毁掉主树那份真的依赖。这一条我是**造成了事故之后**才写下的, 不是设计时想到的。
//
// 🔨 **而这次事故最该带走的一条**(比修法本身重要):
//    我给这个仪器加了"共享树零写入"的**正向自证**, 而它**当时确实通过了** —— 因为我量的是
//    **那一个源文件的 sha256**, 而被毁掉的是 **node_modules**。
//    ⇒ **自证只覆盖到我想到的那一类写入。** 声称"零写入"时, 必须说清是**哪个范围**的零写入。
import { mkdtempSync, rmSync, copyFileSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * 在隔离 worktree 里跑一轮变异。
 * @param {object} a
 * @param {string} a.repoRoot   仓库根(共享树)
 * @param {string} a.srcRel     被变异文件, 相对仓库根
 * @param {string} a.testRel    测试文件, 相对仓库根
 * @param {Array}  a.mutants    [[name, fn(srcText)->mutatedText], ...]
 * @param {Array}  a.unreachable [[name, why], ...] 结构上测不到的格(明列, 不计 MISSED)
 */
export function runMutationsIsolated({ repoRoot, srcRel, testRel, mutants, unreachable = [] }) {
  const wt = mkdtempSync(join(tmpdir(), 'u1-mut-wt-'));
  let created = false;
  try {
    execFileSync('git', ['worktree', 'add', '--detach', '-q', wt, 'HEAD'], { cwd: repoRoot, stdio: 'pipe' });
    created = true;

    // ── node_modules: 用 NODE_PATH, **绝不建 junction** ──
    // 🔴🔴 **这里曾经酿成本会话最严重的一次共享树破坏(2026-08-17 05:2xZ, 我干的)**:
    //    上一版用 junction 把主树 node_modules 挂进隔离树, 而收尾的 `git worktree remove --force`
    //    **顺着 junction 删穿, 删的是主树那份的内容** —— @noble / kaspa-wasm 等被清空,
    //    全队在这棵树上跑什么都 ERR_MODULE_NOT_FOUND。better-sqlite3/fastify 只因被运行中进程占用才幸存。
    //    🔨 判据: **Windows junction 会被递归删穿** —— 删的是目标不是链接。
    //       ⇒ 含 junction 的目录**永不可以** rm -rf / worktree remove --force。
    //    ⇒ 本版**不做任何文件级链接**: 走 NODE_PATH(env 级, 零文件操作, 结构上不存在可删穿的东西)。
    const nodePath = join(repoRoot, 'kasia-console', 'node_modules');
    if (!existsSync(nodePath)) {
      throw new Error(`mutation-runner: 主树 node_modules 不存在: ${nodePath} — 隔离树没有依赖可用, 拒绝继续`);
    }

    // 🔴 ① 拷【工作树当前版本】, 不是 HEAD
    for (const rel of [srcRel, testRel]) {
      const from = join(repoRoot, rel);
      if (!existsSync(from)) throw new Error(`mutation-runner: 源文件不存在: ${from}`);
      copyFileSync(from, join(wt, rel));
    }
    const srcAbs = join(wt, srcRel);
    const testAbs = join(wt, testRel);
    const cwd = join(wt, 'kasia-console');
    const original = readFileSync(srcAbs, 'utf8');

    // 🔴🔴 **隔离自证(@Bettor 精化: 仪器必须【正向】证明隔离发生, 不能只靠"没退回原地"的沉默)**
    //    在册: 没打印的非负证据不算证据 —— 而**只打印一句"我隔离了"同样不算**, 那是声明不是检查。
    //    ⇒ 这里做两件真事: ① 断言被变异路径确实【不在】仓库工作树下 ② 记下共享树那份文件的 sha256,
    //      跑完再比一次 —— **"共享树零写入"因此是【量出来的】, 不是我说的。**
    const sharedSrc = join(repoRoot, srcRel);
    const sharedShaBefore = createHash('sha256').update(readFileSync(sharedSrc)).digest('hex');
    if (resolve(srcAbs).toLowerCase().startsWith(resolve(repoRoot).toLowerCase())) {
      throw new Error(
        `mutation-runner: 🔴 隔离自证失败 —— 待变异路径 ${srcAbs} 落在仓库工作树 ${repoRoot} 之内。`
        + ' 拒绝继续(继续=在共享树里原地变异, 正是本文件要消灭的行为)。',
      );
    }
    // 🔴 **把自证范围扩到依赖目录 —— 这正是上一版漏掉的那一格(它毁的就是 node_modules)**。
    //    只补修法不补判据, 等于下次换个别的写入面照样静默。
    const nmCountBefore = readdirSync(nodePath).length;
    console.log(`[isolate] 变异目标 = ${srcAbs}`);
    console.log(`[isolate] 共享工作树 = ${sharedSrc}  (sha256 ${sharedShaBefore.slice(0, 12)}… 跑完复验)`);
    console.log(`[isolate] 主树 node_modules = ${nmCountBefore} 项 (跑完复验; 上一版就是在这里删穿的)`);

    let det = 0; let miss = 0; let inert = 0; let broken = 0;
    for (const [name, fn] of mutants) {
      const mutated = fn(original);
      if (mutated === original) { inert += 1; console.log(`[INERT ] ${name} — 变异没改动文件, 这条什么也没测`); continue; }
      writeFileSync(srcAbs, mutated, 'utf8');
      let syntaxOk = true;
      try { execFileSync(process.execPath, ['--check', srcAbs], { stdio: 'ignore' }); } catch { syntaxOk = false; }
      if (!syntaxOk) { broken += 1; console.log(`[BROKEN] ${name} — 变异体语法坏, 必然"检出", 什么也没证`); continue; }
      let green = true;
      try {
        execFileSync(process.execPath, [testAbs], {
          stdio: 'ignore', cwd,
          env: { ...process.env, NODE_PATH: nodePath },
        });
      } catch { green = false; }
      if (green) { miss += 1; console.log(`[MISSED] ${name} — 闸被拆掉而用例【全绿】`); }
      else { det += 1; console.log(`[detect] ${name}`); }
      writeFileSync(srcAbs, original, 'utf8');   // 树内还原(树马上就删, 这一步只为下一格干净)
    }

    if (unreachable.length) {
      console.log('\n[结构上测不到 · 明列, 不计入 MISSED]');
      for (const [n, why] of unreachable) console.log(`  · ${n} — ${why}`);
    }
    console.log(`\ndetected=${det}  MISSED=${miss}  INERT=${inert}  BROKEN=${broken}`
      + (unreachable.length ? `  UNREACHABLE=${unreachable.length}` : ''));
    // 🔴 正向复验: 共享树那份文件必须逐字节没动过。**这一条是量出来的, 不是声明。**
    const sharedShaAfter = createHash('sha256').update(readFileSync(sharedSrc)).digest('hex');
    if (sharedShaAfter !== sharedShaBefore) {
      throw new Error(
        `mutation-runner: 🔴🔴 共享工作树的 ${srcRel} 在本次运行中【被改动了】`
        + `(sha256 ${sharedShaBefore.slice(0, 12)}… → ${sharedShaAfter.slice(0, 12)}…)。`
        + ' 隔离没有真正成立 —— 立刻停手并手工核对, 别拿本次读数下任何结论。',
      );
    }
    const nmCountAfter = readdirSync(nodePath).length;
    if (nmCountAfter !== nmCountBefore) {
      throw new Error(
        `mutation-runner: 🔴🔴 主树 node_modules 项数变了(${nmCountBefore} → ${nmCountAfter}) —— `
        + '依赖目录被本次运行动过。这正是上一版 junction 删穿事故的形态, 立刻停手核查。',
      );
    }
    console.log(`[isolate] ✅ 共享树 ${srcRel} sha256 跑前跑后一致 ⇒ 源文件零写入(实测)`);
    console.log(`[isolate] ✅ 主树 node_modules 仍 ${nmCountAfter} 项 ⇒ 依赖零改动(实测)`);
    console.log(`[isolate] 临时 worktree ${basename(wt)} 已在 finally 中删除`);
    return { det, miss, inert, broken };
  } finally {
    if (created) {
      try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoRoot, stdio: 'pipe' }); }
      catch { /* 下面兜底删目录 */ }
    }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* 已被 worktree remove 删掉 */ }
  }
}
