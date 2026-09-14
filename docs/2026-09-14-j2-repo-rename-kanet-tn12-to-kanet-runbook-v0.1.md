> **Status**: DRAFT-FOR-REVIEW v0.1

# 仓库目录改名 runbook — `D:\kanet-tn12` → `D:\kanet` v0.1

**范围**：docs-only（Bettor 1307 派工）。Owner 要求不再出现旧网名。与 da9 无人登录重启验证同一运维
窗口执行，**Owner 定窗，本票不代为定执行时间**。

## 0. 原则（先说清楚，避免执行时"见 kanet-tn12 就替换"这种盲目 find-replace）

1. **功能性路径引用**（配置默认值、脚本硬编码根路径、启动逻辑里用来 `cd`/拼接子路径的字符串）——
   **必须更新**，不更新会导致对应功能在改名后直接失效。
2. **历史性注释**（描述"某年某月某个决定发生时"的记录，比如 `migrate.js:2026` 那条"5/24 Owner 钦定
   DISABLE auto re-create (= local edit D:/kanet-tn12 only,...)"）——**不应该更新**，那条注释描述的是
   "当时这台机器叫这个名字"这个历史事实，改名后把它悄悄改写成"D:/kanet"会让记录变得不准确（同本仓
   CLAUDE.md 自己的通则："Owner 钦定原话不改，紧贴其下补状态注记"——这里是同一条纪律的另一种体现：
   改的是"当前生效的路径"，不改"历史记录准不准"）。
3. 每一处"是否要改"不能只靠字符串匹配判断，必须**读一遍上下文**确认是"功能性"还是"历史性"——本票
   §2 已经逐条读过一遍并标注，但受时间预算限制**不是穷举全仓**（同 NWT 分档文档"如实交代方法局限"的
   同一纪律），执行时如果发现本票遗漏的匹配点，请按同样的两分法自行判断，不要不假思索批量替换。

## 1. 绝对路径清单（已逐条读过上下文，非仅字符串匹配）

### 1.1 必须更新（功能性，不改会真的坏）

| 文件 | 行 | 内容 | 备注 |
|---|---|---|---|
| `kanet.env` | 1 | `KANET_ROOT=D:/kanet-tn12` | |
| `kanet.env` | 2 | `ZK_CLOSEZK_SIL_PATH=D:/kanet-tn12/kasia-console/src/lib/CloseZkV2.sil` | |
| `kanet.mainnet.env` | `DB_PATH=D:/kanet-tn12/kasia-console/data/console.mainnet.db` | | |
| `kanet.mainnet.env` | `KANET_ROOT=D:/kanet-tn12` | | |
| `scripts/start-console-mainnet.ps1` | 39 | `$KanetRoot = "D:\kanet-tn12"` | **主网启动脚本**，最高优先级 |
| `scripts/kanet-boot-sequence.ps1` | 30/31/61/106/107/119/120 | `$KanetRoot`/日志路径多处硬编码 | **疑似 da9 无人登录重启时实际执行的开机脚本**——见 §4 与 da9 验证窗口协调 |
| `scripts/register-console-supervisor-task.ps1` | 21 | `[string]$RepoRoot = 'D:\kanet-tn12'`(参数默认值) | 见 §3.3：**当前机器上没有已注册的对应计划任务**（本票已现场用 `Get-ScheduledTask` 核实，见 §3.3），改这个默认值是面向"将来谁重新跑这个脚本注册任务"，不影响现状任何已激活的东西 |
| `kasia-console/src/api/chat.js` | 522 | `process.env.KANET_ROOT \|\| 'D:/kanet-tn12'`(fallback 默认值) | `KANET_ROOT` 在两份 env 文件里都设了，正常不会走到这个 fallback，但防御性更新，避免"env 万一没读到"时静默用错路径 |
| `kasia-relay/src/lib/p2sh.mjs` | 28 | `process.env.KANET_ROOT ? ... : 'D:/kanet-tn12/tmp'`(fallback 默认值) | 同上，防御性更新 |
| `scripts/lint-kanet.mjs`/`scripts/m0a-lib.mjs`/`scripts/p9-baseline.ps1`/`scripts/a5-verify.ps1`/`scripts/j1-*`(5个)/`scripts/check-deployed-drift.mjs`/`scripts/backfill-payout-ps-addr*.mjs`/`scripts/tn12-dag-health-probe.mjs`/`scripts/fee-mutation-test.mjs`/`scripts/pbs8-2-abstention-replay.mjs` | — | grep 命中但**本票未逐条读完上下文**（19 个 `scripts/` 命中文件里，本票只精读了 3 个高优先级的；`kasia-console/src`/`kasia-relay/src` 下的命中全部读过） | **执行时必须逐个按 §0 两分法读一遍再决定改不改**，不能假设"在这份清单里=直接改"；`tn12-dag-health-probe.mjs`这个文件名本身可能是"探测 TN12 网络健康"的工具，TN12 已 D-017 退役，这条命中甚至可能连带整个文件是否还有存在必要都值得一并问一句，不只是改路径 |

### 1.2 明确不需要改（已核实）

| 项目 | 核实结论 |
|---|---|
| `SILVERC_V100_PATH=D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe` | 指向**完全独立**的 `D:/silverscript` 目录，跟本次改名的 `D:\kanet-tn12` 无关，不受影响 |
| `_bettor_push.sh` | 逐行读过：**零硬编码绝对路径**，只用 `cd "$(dirname "$0")"`(相对自身位置)+ 纯 git 命令，改名后无需任何改动，本身就是可移植的 |
| `kasia-console/src/api/health.js:22` | `const ROOT = getRepoRoot(dirname(fileURLToPath(import.meta.url)));`——**动态推导**，注释里的 `D:/kanet-tn12` 只是给读者看的当前值示例，不是硬编码常量，改名后自动跟着算出新值，代码不用改（注释可选择性顺手更新，不改也不影响功能） |
| `kasia-console/src/db/migrate.js:2026` | 历史注释("5/24 Owner 钦定...")——按 §0.2 原则**不应该改**，改了会让记录失真 |
| `kasia-console/src/db/slow-sql-observe.test.mjs:126/128` | 测试夹具里的**合成字符串**（模拟一份 Error stack trace，测的是从 stack trace 里解析出 `src/api/pool.js:3290` 这个相对路径的函数）——不是从真实运行时路径读出来的，函数本身按什么规则解析不依赖这个前缀具体是什么，改名后这条测试大概率原样能过；如果不放心，落码时可以顺手把测试夹具里的路径也改成新名字，但**不改也不会让测试挂**（不是本次改名的阻塞项） |

### 1.3 需要执行时人工判断的一处（不是路径问题，是逻辑问题）

`kanet-stop.sh:82`：

```powershell
(\$_.CommandLine -notmatch 'kanet-tn12')
```

这行代码用字面量字符串 `'kanet-tn12'` 来**排除**"testnet sandbox"的 node 进程，不让 mainnet 的
`kanet-stop.sh` 误杀 testnet 的进程（注释原话"5/20 patch: 排除 kanet-tn12 testnet sandbox 路径 (=
mainnet stop 不动 testnet, 之前撞 14h 14:43 5 J1tn-* + Qwen 全死)"）。

**这不是一处"改名字符串"就能安全解决的地方**——需要先回答一个本票没有把握回答的问题：**这条排除逻辑
现在还有意义吗？** D-017（2026-09-13，Owner 裁定）已经宣布 TN12 退役——如果 TN12 相关进程现在已经
不会再启动，这条排除逻辑本身可能已经是死代码（不影响正确性，但也不需要跟着改名字符串，因为它已经
不会命中任何东西）；但如果 TN12 相关进程或工具（比如上面提到的 `tn12-dag-health-probe.mjs`）**仍然
偶尔会跑**，那么：
- 如果 testnet sandbox 那棵树的路径**也**在这次一起改名（比如它也是 `D:\kanet-tn12` 下的子目录/子
  worktree），排除字符串需要跟着改成新名字对应的等价判据；
- 如果 testnet sandbox 是一棵**完全独立**、这次不改名的目录，这条排除逻辑可能根本不用动。

**建议**：这条不要在改名 runbook 里顺手改掉，单独问一句"TN12 sandbox 现在还存在/还会启动吗"，得到
答案后再决定这行怎么处理——这是一个需要 Bettor/NWT/Owner 判断的问题，不是本票能替他们拍的。

## 2. Git worktree（当前 46 棵，实时核实，非 Bettor 记的 43——两者之间的差是本 session 期间新建的几棵，
   执行时请以执行当下 `git worktree list | wc -l` 的实际数字为准，不要用本票或任何历史记录的数字）

**机制核实**（读了实际文件内容，不是猜测）：每个 linked worktree 的机制是双向绝对路径指针——

```
<worktree>/.git                          文件内容: "gitdir: D:/kanet-tn12/.git/worktrees/<name>"
<main>/.git/worktrees/<name>/gitdir      文件内容: "D:/kanet-tn12/scratch/<...>/<worktree>/.git"
```

改名后两个方向的指针都会指向不存在的旧路径，`git status`/`git worktree list` 等命令会在受影响的
worktree 里报错。

**`git worktree repair`**（git 官方为"仓库或 worktree 被移动"设计的机制，`--help` 只给了
`git worktree repair [<path>...]` 这行 usage，本机没有完整 man page 可查——**本票不假装知道两个方向
的确切修复时序细节**，按 §3 步骤 4 的方式先在一棵一次性建的临时 worktree 上演练一遍，用真实结果确认
具体调用方式，而不是照抄一份没有本地验证过的命令序列）。

## 3. 执行步骤

### 3.1 停 console

- 主网：`bash kanet-stop.sh`（先确认 §1.3 那条排除逻辑当下的处置结论，如果结论是"testnet sandbox
  跟主网一起改名"，需要同一批一起停）。
- 确认停干净：`Get-NetTCPConnection -LocalPort 3200`（或 `kanet.mainnet.env` 里实际配置的端口）应
  为空，`Get-Process node` 里不应该再有 console/relay/scout 相关的残留（同 `kanet-stop.sh` 阶段 4
  自己的判据）。

### 3.2 改名目录

```powershell
Rename-Item -Path 'D:\kanet-tn12' -NewName 'kanet'
```

（`Rename-Item` 而不是"新建 D:\kanet 再复制"——保留原有的 NTFS 元数据/junction 结构，只改路径前缀，
副作用面更小；复制会导致所有内部 junction 在复制过程中被展开成真实文件或需要额外处理，没有必要冒
这个险。）

### 3.3 修复 git 层面

1. 从新路径 `D:\kanet\`（原 main 检出）跑：
   ```
   git worktree list
   ```
   预期：报出全部 46(+) 棵 worktree，**路径应该已经自动显示为新路径**（git 内部维护的 worktree 列表
   来自 `.git/worktrees/*` 目录本身的存在，不是靠这个 gitdir 文件内容——但这个假设本票没有本地验证过，
   **执行时如果这一步报错或路径不对，先停下来，不要往下继续瞎试**）。
2. **先在一棵可丢弃的临时 worktree 上演练**：
   ```
   git worktree add D:\kanet\scratch\_rename-drill -b _rename-drill-throwaway
   git status   # 应该正常工作
   git worktree remove D:\kanet\scratch\_rename-drill
   ```
   如果这个新建的 worktree 本身工作正常（因为它是改名**之后**才建的，天然带正确路径），不能验证"修复
   一棵改名前就存在的旧 worktree"这个真正要解决的问题——**演练对象应该是改名前就存在的某一棵低风险
   worktree**（比如挑一棵已经完工、内容不重要的），先跑：
   ```
   cd D:\kanet\scratch\<挑一棵>
   git status   # 大概率报错，指向旧路径
   git worktree repair
   git status   # 验证是否修好
   ```
   确认这个具体命令序列真的有效之后，再对剩余全部 worktree 批量执行同一序列。
3. **计划任务**：本票现场用 `Get-ScheduledTask`（含遍历全部 Action 的 Execute/Arguments/
   WorkingDirectory 字段，不只是 TaskName）核实过——**当前机器上没有任何计划任务的名字或参数命中
   "kanet"/"kaspad"/"console"/"supervisor"**，`register-console-supervisor-task.ps1` 这个脚本存在
   但看起来**没有被实际注册运行过**（或者已经被移除）。**结论：这一步在当前机器上不需要执行任何计划
   任务层面的修复动作**——但请在执行 runbook 时重新跑一遍同款查询确认现状没变（本票核实的是"写这份
   文档那一刻"的状态，不是保证"执行那一刻"还一样）：
   ```powershell
   Get-ScheduledTask | ForEach-Object { $t=$_; foreach($a in $t.Actions){ $c=[string]$a.Execute+' '+[string]$a.Arguments+' '+[string]$a.WorkingDirectory; if($c -match 'kanet' -or $c -match 'kaspad'){ Write-Output ($t.TaskName+' | '+$a.Execute+' '+$a.Arguments) } } }
   ```

### 3.4 修复内部 junction（`node_modules/kaspa-wasm` → `shared/vendor/kaspa-wasm`）

**已核实**：这类 junction 存的是**绝对路径**（Windows junction 不支持相对路径，跟 symlink 不同），
改名后每一棵 worktree（含主树）里这条 junction 都会指向一个不存在的旧路径。两个选项：

- **选项 A（慢但确定对）**：对每一棵 worktree 的 `kasia-console`/`kasia-relay` 重新跑一次
  `npm install`——npm 会按当前真实目录结构重新建 junction，天然指向新路径。46+ 棵按每棵 ~15-20s 估算，
  预计总耗时 15-20 分钟量级，是这一步最大的时间开销。
- **选项 B（快，但需要先验证脚本本身逻辑对）**：写一个小脚本，对每一棵 worktree 直接
  `rmdir <旧junction>` + 重新 `New-Item -ItemType Junction` 指向按同一相对结构算出的新绝对路径——
  本票只给思路，不落码（docs-only 范围），落码时按 `check-worktree-junctions.mjs` 已有的扫描逻辑
  （它已经知道怎么找到每一条 junction 极其目标）改造成"发现即重建"，不要重新发明一遍扫描逻辑。
- **收尾**：无论选哪个选项，改完后**必跑** `node scripts/check-worktree-junctions.mjs --all`，确认
  0 条 `→LIVE`/`external`（内部链接的绝对路径前缀已经变成新的 `D:\kanet\...`，但仍然是 internal，
  该脚本的分类逻辑是"目标是否在链接自己所在的树内"，这是相对判断，不受路径前缀改变本身影响，只要
  target 真的指向了正确的新路径）。

### 3.5 起 console + 验证

1. `bash kanet-start.sh`（或 `scripts/start-console-mainnet.ps1`，取决于主网启动惯例——本票没有
   重新核实这两者当前的实际使用关系，执行时按现行惯例）。
2. 验证清单：
   - console 进程正常监听端口（`kanet.mainnet.env` 里配的那个）。
   - 日志 `[db] path=` 行显示的是**新路径**下的 `console.mainnet.db`。
   - `checkSilvercPinAtStartup`（若启用）打出 PASS，路径正确解析。
   - 前端页面（`.eta` 渲染）能正常加载，抽查一两个只读接口（不要用会花钱的接口做验证）。
   - `git status`（在新路径的 main 检出下）干净，不报 worktree 相关错误。
   - `node scripts/check-worktree-junctions.mjs --all` 干净。

## 4. 与 da9 无人登录重启验证的协调

`scripts/kanet-boot-sequence.ps1` 疑似是无人登录重启时实际被触发执行的开机序列脚本（文件名 + 内容
风格符合，本票**没有独立核实"这个脚本真的被 Windows 开机任务调用"这件事**，只核实了脚本内容本身
有硬编码路径）——**这意味着改名跟 da9 无人登录重启验证很可能不是两件独立的事，而是同一件事的两个
验证维度**：如果改名没有同步更新这个脚本，da9 的无人登录重启验证会在开机序列这一步就失败（脚本试图
`cd` 到不存在的旧路径）。**建议**：改名步骤（§3）与 da9 重启验证在**同一个操作窗口**内**顺序执行**
（先完成改名+全部验证 §3.5 通过，再触发/等待 da9 的下一次无人登录重启，用那次真实重启结果作为"开机
序列脚本也已正确更新"的最终验证），不要并行做，避免"改名做到一半，reboot 验证撞上一个中间态"这种
时序竞争。窗口本身由 Owner 定。

## 5. 回滚

- **改名步骤本身**（`Rename-Item`）是可逆操作——如果 §3.5 验证失败，`Rename-Item -Path 'D:\kanet'
  -NewName 'kanet-tn12'` 改回去，配合把 §1 表格里已经改动的文件用 git 还原（`git checkout --
  <files>`，仅限本次改名涉及的文件，不要动其它未提交的改动）。
- **git worktree repair 之后如果发现某棵 worktree 状态异常**：优先用 `git worktree list` 核对该
  worktree 是否仍在列表里、`git worktree repair <该worktree路径>` 针对性重跑，**不要**用
  `git worktree remove --force` 强删后重建（那会丢失该 worktree 里任何未提交的本地改动——回滚阶段
  的首要原则是不造成数据丢失，宁可暂时留着一个状态异常的 worktree 不用，也不要为了"看起来干净"而
  删除可能还有未提交工作的东西）。
- 若 console 起不来且短时间内查不出原因：先回滚目录名，恢复到已知工作的 `D:\kanet-tn12` 状态，改名
  这件事本身不阻塞其它工作，可以等排查清楚再重试，不需要在问题现场硬着头皮往前推。

## 6. 不在本票范围内的事

- `kanet-stop.sh:82` 那条 testnet/mainnet 进程排除逻辑的最终处置——需要 Bettor/NWT/Owner 判断"TN12
  sandbox 现在还存不存在"这个前提问题，见 §1.3。
- `scripts/` 目录下本票未逐条精读的 16 个命中文件（见 §1.1 表格最后一行）——执行时按 §0 两分法逐一
  确认。
- 内部 junction 重建脚本（§3.4 选项 B）的具体实现——本票只给设计思路，不落码。
