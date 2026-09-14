> **Status**: CURRENT

# J2 审 — 跨树 junction 机械闸设计（`0f982150`）复核 v0.1

**范围**：审 KANet-UI 的设计 `docs/2026-09-14-kanetui-worktree-junction-gate-mechanical-design-v0.1.md`
（commit `0f982150`，Bettor 1281/1283 派工，NWT 因当事人回避走 J2 审）。**docs-only，不改 `check-worktree-
junctions.mjs`/`.githooks/pre-commit`/`_bettor_push.sh` 任何一个文件**——这些改动留给 KANet-UI 落码后
另审。

**结论：GREEN-with-notes**（Bettor 1287 已采纳，② ④ 落码必做，① ③ 记已知限制）。

## 方法论

不是只读设计文档——读了 `check-worktree-junctions.mjs` 全文源码、当前 `.githooks/pre-commit`/
`_bettor_push.sh` 现状，并做了三项实测验证（不是从文档描述直接采信）：
1. 在非 git 目录跑该脚本，捕获 `git worktree list` 失败时的真实退出码。
2. 在当前机器（41 worktree，比设计文档记录时的 39 又多了 2）重新计时 `--all` 扫描。
3. grep 全仓 `scripts/`/根目录 `.sh`/`.mjs`，确认 `git push` 的实际执行路径只有 `_bettor_push.sh` 一处。

## 审点逐条

### ① `--no-verify` 绕过 pre-commit 时推送闸是否仍能兜底

**结构上能兜底**：`_bettor_push.sh` 的检查在每次推送时**重新扫描当前状态**，不依赖任何 commit 时留下
的痕迹——某笔 commit 用 `--no-verify` 跳过 pre-commit，不影响下一次推送时 `_bettor_push.sh` 的检测（它
检查的是"现在这棵树的状态"，不是"这笔 commit 有没有被检查过"）。

**记为已知限制**：这个兜底成立的前提是"推送只走 `_bettor_push.sh`"——这是**约定**，不是**机制**。全仓
grep 确认 `git push` 的真实执行只有 `_bettor_push.sh` 一处，没有第二条路，但没有 server-side pre-receive
hook 或分支保护阻止有人手动敲 `git push` 绕过这个脚本本身。这跟现有 lint-kanet 闸依赖
`git config core.hooksPath` 才激活是同一类"机制建在约定之上"的既有限制（设计文档 §4 已经承认了 hook
未激活这一类问题的存在，本条是同一类的另一个例子，不是本次设计新增的洞）——**记账，不阻塞**。

### ② 误报处理（脚本自身出错 vs 真有链接）是否区分、都 fail-closed

**实测**：在一个非 git 目录跑该脚本，`git worktree list` 因 `execFileSync` 无 try/catch 直接抛出未捕获
异常，真实退出码（用 `$?` 直接测，不是读文档猜的）= **1**——跟脚本自己"找到坏链接"那条路径的
`process.exit(1)` **数值完全相同**，且这条路径打印的是原始 Node 异常堆栈（`fatal: not a git
repository...`），不是脚本自己那句清楚的中文提示（`[check-worktree-junctions] ✗ N cross-tree reparse
point(s)...`）。

**结论**：fail-closed 在两条路径上都成立（两处新增闸只认非零退出码，两种情况都会拦），**但目前不区分**
——从退出码和终端打印，操作者没法一眼分辨"这是真找到坏链"还是"脚本运行环境本身出了问题"（例如某个检出
`.git` 损坏，commit 时只会看到一坨 Node 堆栈，容易误判成"这道闸坏了"而不是"这个检出本身有问题"）。

**落码必做**（Bettor 1287 采纳）：顶层调用包一层 try/catch，"扫描本身出错"用独立退出码（避开脚本已用的
0/1，建议 2 或 3）+ 清楚文案区分，不改变两者都 block 这个安全性质，只是让操作者少猜一步、日志更好读。

### ③ 每次提交 1.8s 是否可接受、有无按 worktree 数量退化风险

**实测复现**：当前机器 worktree 数已从设计文档记录的 39 涨到 41（写这篇审查过程中新建了 2 个工作
worktree）。重新跑 `node scripts/check-worktree-junctions.mjs --all`：约 1.8-1.9s 区间，跟设计文档的
1.811s 基本吻合，确认扫描耗时随 worktree 数量近似线性增长（≈45-50ms/worktree），不是常数开销。

**结论**：1.8s 对 commit/push 这种低频、高价值动作现在完全可接受。**记为已知限制**：这个开销会随
worktree 数量单调增长，而这个仓库目前没有任何主动清理旧 worktree 的习惯（本次审查过程中就看到不少明显
已完工、长期未清理的侧分支 worktree 仍然存在）——不是本次设计要解决的问题，但值得记一句提醒：**如果哪
天扫描耗时明显变长，那本身是"该清 worktree 了"的信号，不该往"优化/跳过检查脚本"的方向去修**（削弱检查
本身来换速度，会正好抵消这道闸存在的意义）。

### ④ 若将来确需合法链接，豁免机制是显式白名单还是不允许

**通读设计文档 §3/§5，确认：当前设计里没有任何豁免/白名单机制**——原话"都堵，不单独放行 external"，
且 §5"不在本设计范围内的事"也没有提到豁免通道。这是合理的选择（比 M0a 那套 shrink-only manifest +
content-digest 钉住 + NWT/Owner 审的重量级白名单简单得多，且当前场景下"合法跨树链接"至今没有出现过真实
需求），但文档目前是**没提**这个问题，不是**明确回答"不允许"**——两者读起来不一样：前者留下"以后有人
临时手改脚本绕过、没人注意到"的空子，后者是一条可以被引用、可以被违反时追责的明确规则。

**落码必做**（Bettor 1287 采纳）：文档补一句明确表述——"当前无豁免机制；未来若真出现合法跨树链接需求，
走的是改这道闸本身（需 NWT+Owner 级别审查，同 M0a 先例），不是新增白名单条目"。

## 未发现的问题（核实过，没有需要额外指出的）

- 脚本本身（`check-worktree-junctions.mjs`）逻辑跟设计文档描述的三档分类（`internal`/`→LIVE`/
  `external`）、退出码语义（0=干净，1=有非 internal 链）逐行核对一致，文档跟脚本实际行为没有出入。
- 设计不改脚本本身、不新增自动拆链能力——两条都认同：拆链本身是有风险的破坏性操作，不该塞进一个"检查
  脚本"里顺手做，人读日志手动拆是正确的谨慎选择。
- 两处接入点（`.githooks/pre-commit` 第④项、`_bettor_push.sh` fetch 后 push 前）的位置设计（不影响
  既有②③两条 warn-only 检查的顺序/性质，`_bettor_push.sh` 独立于现有队列一致性检查短路）读下来没有
  副作用风险。

## 后续

KANet-UI 按本审见 + Bettor 1287 裁定落码（② ④ 必做，① ③ 记限制不阻塞）；落码后由 J2 审码（Bettor 1287
指定）。
