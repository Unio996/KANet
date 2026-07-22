# M0a lint 实现批 — NWT diff 审 verdict

> **Status**: DRAFT（2026-07-22 · NWT）
> **审对象**：commit `417e29b0`（KANet-UI）——`scripts/m0a-lib.mjs`(314) + `gen-m0a-baseline.mjs` + `lint-kanet.mjs`(+15) + baseline 243 条 + 空 manifest + `m0a-lint.test.mjs`(19 断言)。
> **依据**：设计稿 v0.2（NWT GREEN `8c7870bb`）+ 本人 v0.2 verdict 的 MUST-FIX 与三裁定 + 实现批注记。
> **立场**：diff 审 = 审**实际代码**非设计稿（memory: diff-verdict-must-precede-deploy）。默认 refute——门是用来被绕的，逐条构造绕过。
> **verdict**：**GREEN-with-1-MUST-FIX**。实现忠实落地 v0.2 设计，我两条设计 MUST-FIX 的闭合在代码里核实成立；但**匹配正则有空白变体覆盖缺口**（实测坐实），一个新裸 import 可用非标准空白绕过整道门——落码前修。

---

## 已核实成立（挣来的 PASS，逐条追代码）

- **设计 MUST-FIX 闭合 1（删真+加假→ERROR）**：`diffAgainstBaseline`（m0a-lib.mjs:126-141）判据 `allow = allowed.get(fp+SEP+family+SEP+form)`，新文件 path 不在 baseline → allow=0 → count≥1 > 0 → ERROR。**path 键根治，与全局 count 无关**。测试 #5（删真加假净 count 不变）实跑 PASS。✅
- **设计 MUST-FIX 闭合 2（headroom 银行）**：反向镜像检查（:143-150）——baseline 条目现实 count 减少且无同 commit prune → ERROR。**baseline 是精确镜像非额度，燃尽必须落账，无 headroom 可积**。测试 #6 PASS。✅
- **我的实现批注记（计算 opts fail-closed）已实现**：`checkReadonlyConstraint`（:246-256）对 `new Database(...)` 三行窗口正则找 `readonly:true`，找不到（字面缺失**或 opts 为计算值**）= ERROR，注释明写"计算 opts 不豁免, NWT 注记"。测试 #12 PASS。✅
- **编辑守卫抗 rename 伪造**（`baselineEditGuard` :167-184）：新 baseline 键只在 `git diff --cached -M` 报 R 对且 form/count 不变时放行；否则硬拒。工具滥用（全 regen 加新条目、伪造 path 改写）闭合。✅
- **单源铁律**：gen 与 check 共用 `enumerateOccurrences`/`normalizeForm`（:41-79），两侧一致偏。✅
- **SEP=NUL 收敛**：`String.fromCharCode(0)`（:10）替代不可见字面字节，KANet-UI 自曝的维护雷已收敛，注释留证。✅
- **specifier 归 basename 堵相对前缀改写**（:74 `path.posix.basename`）——设计最见功力处，代码正确落地。✅
- 三裁定全落地：自助只读测试道（:228-240，`self-serve:readonly-test` 仅 test-fixture+静态限制全过时放行，db-readonly 用此 ref 反被拒 :237）、shadow-module 首批带（:265-278）、已知残留入档。✅

## MUST-FIX：匹配正则空白变体覆盖缺口（实测坐实）

**攻击（打穿了，命令行实测）**：
`FAMILIES` 的 grep（m0a-lib.mjs:15,19）把关键字与 specifier 引号间的空白**硬编码为单一形态**：
- sqlite：`(require\(|from |import\()['"]better-sqlite3` — `from ` = from+**恰一个空格**+引号；`require\(`/`import\(` = 括号**紧跟**引号。
- relay-manager 同构。

实测（fresh git repo，同 `git grep --cached` 路径）：

| 写法 | 命中？ |
|---|---|
| `import Database from 'better-sqlite3'`（单空格） | ✅ 命中 |
| `import Database from  'better-sqlite3'`（**双空格**） | 🔴 **MISS** |
| `require( 'better-sqlite3')`（括号后空格） | 🔴 MISS（同类，`require\(['"]` 要求括号紧跟引号） |

**后果**：一个**新文件**写 `from  'better-sqlite3'`（或 `require( '...')`）→ grep 不命中 → 不进 occurrence 枚举 → `diffAgainstBaseline` 看不到它 → **零 ERROR，带着一个可运行的裸 import 通过整道门**。因 gen 与 check 同源，baseline 也一致漏收 = 这是**门的覆盖缺口**（非差分噪音）——恰好击穿 M0a 的立身之本"新增裸 import 即败"。

**为什么算 MUST-FIX 而非已知残留**：设计 §8 已声明"动态/拼接 require（`require(变量)`/字符串拼接）"是不承诺覆盖的残留——**但本缺口不是动态 require**，是一个**纯静态字面 import**，只是空白排版非标准。门对静态字面 import 的覆盖是它明示的核心职责，不在残留豁免范围。虽然 (a) 是 tripwire 非唯一门（M0c 运行时才是终局）(b) prettier 类格式化器会把双空格归一成单空格从而被抓（意外情况自愈），但**蓄意绕过成本 = 敲一个多余空格**，一道 fail-closed 安全门不能被这个绕过。

**修法（trivial）**：两族 grep 的关键字—引号间空白改弹性匹配——`from ` → `from\s+`、`require\(` → `require\(\s*`、`import\(` → `import\(\s*`。`normalizeForm` 已做 `\s+`→单空格折叠（:78），form 稳定性不受影响，baseline 不需重大变动（重生成时新弹性正则会收进此前漏掉的真实 occurrence，属正确扩大覆盖）。**加负向测试**：`from  'x'`（双空格）/`require( 'x'`（括号后空格）/`from\t'x'`（tab）→ 必 ERROR（现 19 断言零覆盖空白变体，实测坐实）。

## 交付后

- **本 verdict = 装载门**：MUST-FIX 修（弹性空白正则 + 空白变体负向测试）+ 重生成 baseline（覆盖扩大后条目数会略增，属正确收编非漏报）→ 我复核修订 diff → 方可随装载窗生效。pre-commit hook 已含新规则（commit 信息声明），但**生效前该缺口在门内**，修掉再上。
- 非空白缺口的其余实现我已逐条核，无其它 must/should——实现质量高，这一条是唯一拦截项。

**关联**：`docs/2026-07-22-m0a-bare-import-differential-lint-design.md`（v0.2 设计）、`docs/2026-07-22-NWT-redteam-m0a-lint-design.md`（设计稿 verdict）、commit `417e29b0`。
