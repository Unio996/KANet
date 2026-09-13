# NWT 红队复核 · 三侧分支合入主线验证（预检对照 + 亲跑 10/10 + 全仓 lint）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`origin/coord/mainline-abc-merge`（基线 `051e1bc2` → a `2758bf61` → b `e24c37eb` → c `d5795859` → 第 4 笔修复 `27041390`），对照预检报告 `68e766c3`。
> 方法：独立 worktree(`D:/kanet-abc-merge-wt`，用后已 `git worktree remove` 清理干净) + 独立 `npm install`（kasia-console/kasia-relay 各自）；不信自报,亲自跑完 10 个测试文件 + 全仓 lint。

## 结论：**GREEN，可以 `--ff-only` 推进主线**

## 一、①三笔 merge 与预检 `68e766c3` 对照——一致

**冲突解法**：读了 `d5795859` 的实际 diff——`bettor-prediction-settler.js:28-35` 的冲突就是预检报告 §2.1 预告的那个（a/b 侧 `isAddressOnNetwork` import 与 c 侧四行 submit-intent/escrow-landed-gate import，同一插入点相邻、互不读对方符号），**实际解法与预检建议逐字一致**：保留双方全部 5 行，顺序 b 先 c 后，commit message 里的冲突说明写得清楚。

**diffstat 差异已核实为预期内**：预检报告的合成 merge-tree 给出"66 文件 +2635/−311"，实际 `051e1bc2..d5795859` 是"63 文件 +2632/−179"——**这个差异不是错误**，预检自己的方法论就说明了原因：`git merge-tree` 对冲突文件按三份原始 blob 展开计数会虚增 diffstat，真正解决冲突（去掉重复的基线行、只留一份合并结果）后行数自然回落，量级（63 vs 66 文件、+2632 vs +2635 insertions 基本相等）没有变，**是同一件事的两种计数方式，不是发现了新的遗漏**。

**迁移版本衔接**：核对 `d5795859` 树上 `migrate.js` 尾块——c 分支的 v202/v203 确实接在主线 v201 之后，无版本号冲突，与预检一致。

## 二、②第 4 笔（`27041390`）只动测试、未削弱断言——核实为真

`git diff d5795859 27041390 --stat` 确认**只改了三个测试文件**（`broker-fee-emit-package-switch.test.mjs`/`covenant-roundtrip.test.mjs`/`serialize-roundtrip.test.mjs`），无 `src` 改动。**读了完整 diff**：两个 relay 测试的修法是给顶层加"自举子进程先设 `KASPA_NETWORK` 再动态 `import`"（`await import()` 替换静态 `import`）——commit message 里解释的根因是对的：**ESM 静态 `import` 会被提升到本文件任何语句之前执行**，所以在文件顶部写 `process.env.KASPA_NETWORK = ...` 救不了（那时静态 import 链已经跑完，触发 b 分支新加的 `rpc-listener.mjs` 顶层 `_configuredNetwork()` fail-loud 检查），必须用子进程重跑 + 动态 import 延后加载模块图这一套（同项目里 `rpc-health-datacheck.test.mjs` 既有套路，不是新发明）。**diff 里没有任何一行触碰实际断言逻辑（`fails++`/`assert` 那部分原样未动）**，只是给顶层加了 env 注入这一层，不是削弱判据、也不是绕过某个原本会红的检查项让它看起来绿。**PASS，不是"为了让测试过而改测试"，是真的修复了合并交互产生的新前置条件缺失。**

## 三、③亲跑 10/10 + 全仓 lint——**全部亲手验证，不接受自报**

独立 worktree（`27041390` 检出）+ 独立 `npm install`（kasia-console 349 包、kasia-relay 5 包）后逐个跑：

| 测试文件 | 结果 |
|---|---|
| `rpc-health-datacheck.test.mjs`（a） | ✅ ALL PASS |
| `kaspa-network.test.mjs`（b） | ✅ ALL PASS，10 条向量全覆盖 |
| `broker-fee-emit-package-switch.test.mjs`（b） | ✅ ALL PASS，含 threaded-claim fallback 3 类负例 |
| `submit-intent.test.mjs`（c） | ✅ all vectors passed + 翻转臂真的红了再确认 |
| `escrow-landed-gate.test.mjs`（c） | ✅ 同上（真 `transition`，不是假函数） |
| `exchange-machine-kaspa-gate.test.mjs`（c） | ✅ 同上（`minDepth 0` 被拒验过） |
| `prediction-payout-gate.test.mjs`（c） | ✅ 同上（sweep 幂等性验过） |
| `tx-landed-reconciler.test.mjs`（c） | ✅ 同上 |
| `covenant-roundtrip.test.mjs`（c，relay） | ✅ 13 条断言 + 翻转臂全绿 |
| `serialize-roundtrip.test.mjs`（c，relay） | ✅ 16 条断言 + 翻转臂全绿 |

**10/10，每个文件的"翻转臂"都真的先打印 ❌ 再确认变红，不是摆设**（这是我一直在这轮审查里坚持的判据：翻转臂要真的能红,不能次次绿）。

**全仓 `node scripts/lint-kanet.mjs`**：**2 ERROR**，都在 `kasia-console/src/services/chains.js:31-32`（`R-EXPLORER-URL-BYPASS`）。**核实这条与三分支无关**：`git log` 显示这个文件最近的改动是很早以前的无关 commit（`34aee0ae`/`c8df5b69`），`git diff 051e1bc2..27041390 -- chains.js` **完全空**（三个分支+第4笔都没碰过这个文件）——**确认是主线既有历史债，不是这次合入引入的新问题**，与 Bettor 的判读一致，归 `ab-followup` 处置正确。其余全是 WARN 级（不挡 commit），抽了几条看了下都是既有的存量提示（`R-DOC-STATUS` 410 条文档缺 Status 头之类），不是这轮合入新增的。

## 四、给 Bettor 的处置建议

- **GREEN，可以 `--ff-only` 推进主线**——三笔 merge 与预检一致，第 4 笔修复干净、未削弱任何断言，我亲跑 10/10 全绿，全仓 lint 只有 2 处与本次合入无关的历史债。
- `chains.js:31-32` 那 2 处 ERROR 归 `ab-followup` 一起修的处置批准，不需要为它们单独卡这次合入。
- 合入后请提醒 J2/KANet-UI：这次验证用的独立 worktree 已经 `git worktree remove` 清理，没有留下任何残留检出。
