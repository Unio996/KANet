# runbook：主网 kaspad + console 开机自启（Windows 计划任务）v0.1 草稿

> **Status**: CURRENT
>
> 起草 KANet-UI · 2026-09-19 · 依据账本 **(1531)**（死机复盘 P2）、**(1532)**（Bettor 补的四点硬要求、Owner 采纳 P1–P4 方向）、**(1533)**（console 启动期花钱面）、`docs/iteration/j1-inbox/2026-09-14T10-00Z-bettor-GO-unattended-reboot-verify-with-conditions.md`（9/14 无人登录重启验证的停/起与六项读数，本页沿用其读数口径）。
>
> **执行门（页首必读；"页写好了"≠"可以执行了"）**：**只写不执行**。① 本页 → Bettor 审 → NWT 审 →（新增脚本 `scripts/mainnet-boot-sequence.ps1` 是**代码**，铁律 0：**落码须 Bettor 批**，附录 A 只是草案）→ ② 提权注册计划任务 = **J1 EXECUTE 单**（本机 KANet-UI 会话非提权，`IsInRole(Administrator)=False`，2026-09-19 实核）→ ③ 预演 R0–R3 逐级过 → ④ 真重启验证 = **Bettor GO + 本机全部会话被切断的窗口**（同 9/14 先例）。任何一步未过，不进下一步。
>
> **写作依 D-021**：不写密钥值；不写任何余额、地址与持有人的对应。本页出现的路径、端口、`kaspad` 二进制 sha256（公开发布物的哈希）、进程名都是运维坐标，不是敏感信息。
>
> **本页没有动任何东西**：只读了进程表、计划任务定义、性能计数器、日志目录列表、探针一次（`ALIVE`）；没起没停任何进程，没注册任何任务。

## 0. 先给 Bettor 的结论与需要他定的点

**做法**：一个计划任务 `\KANet\KANet-Mainnet-Boot`，触发器"系统启动 + 延迟 2 分钟"，**不依赖任何人登录**，动作 = 一个编排脚本，按序：核 kaspad 二进制 → 轮转日志 → 起 kaspad → 等探针 `ALIVE` → 轮转 console 日志 → 起 console → 验证 → **常驻做"死亡哨兵"（只告警不重启）**。

**Bettor 四点硬要求 → 本页落点**：

| # | 硬要求 | 落点 |
|---|---|---|
| ① | kaspad 命令行逐字 = (1321) §0；二进制起前核 sha256 与 `--version` | 脚本 step 1–2：sha256 全值 + `--version == kaspad 2.0.1` **不符即拒起**（退出码 21/22）；四个参数逐字（附录 A `$kArgs`），已用**活进程命令行**做过匹配校验（§3 读数 3.4） |
| ② | 两个启动脚本的重定向都会覆盖旧日志 ⇒ 内置按时间戳轮转 | 脚本在**每次起进程前**把非空的 stdout/stderr 改名为 `<原名>.pre-boot-<yyyyMMdd-HHmmss><ext>`（沿用 `logs\mainnet` 里已有的 `pre-<标签>-<时间戳>` 命名）；**只改名不删**；改名失败（含目标已存在）⇒ **拒起**，不覆盖；已在跑的进程（adopt）**不轮转**（文件被占用） |
| ③ | console 前置门 = `kaspad-rpc-probe.mjs` 回 `ALIVE`，不是只看 17110 监听 | 脚本 step 3：轮询探针，**只有退出码 0（`ALIVE`）才起 console**；`7 SYNCING` 继续等；`8 STALLED` 告警一次继续等；`2` 错网 / `6` 探针坏 ⇒ 拒起。探针已对活节点实跑：`ALIVE:network=mainnet`（需设 3 个环境变量，见 §2.4） |
| ④ | 不依赖用户登录；失败不无限重试；写清重试次数与放弃后告警落点 | §2.2（S4U，无需登录）、§2.3（重试 = 计划任务 `RestartCount 3`、间隔 10 分钟，**只对"kaspad 就绪前"的失败**；就绪后脚本永不自行退出）、§2.5（告警落点：Windows 应用事件日志 + `boot-status.json` + `boot-history.log`） |

**Bettor 裁定记录（2026-09-19，对本页首版）**：D-A / D-B / D-C / D-D / D-E **全部采纳**。D-B 附加要求：分支不对时事件日志留明确原因——脚本 `Warn-Console 62` 已写事件 9062，message 含实际分支与期望分支。D-D 附：确定性失败多出 3 条事件可接受，**不为区分退出码加复杂度**。D-E 附："console 起来后灌 `events`"另批、不进本页。**D-F 改为下表新规则**。D-G 已在 Owner 手里，页首标法保留。**流程**：NWT 红队审本页（设计先行第②步）→ 通过才进 4.1 落码；**R1 等 NWT 审过脚本草案后再跑**（草案已出过一个真 bug，先审后跑）；R2 三条未证明面保留在 §7，不写成已证。下表保留首版默认值以便对照。

**（原表）需要 Bettor 定的点**（默认值已写进本页）：

| # | 点 | 默认 | 为什么要你定 |
|---|---|---|---|
| D-A | 任务身份 | 本机用户 `ADMIN`，登录类型 **S4U**（无需存密码、无需登录），权限 **Limited**（不提权） | 备选：存 Windows 密码（要 Owner 出密码）；SYSTEM（会让新建文件属主变 SYSTEM，agent 会话可能读不了/写不了）。S4U 有"无网络凭据、无 DPAPI/EFS"的限制，本机 console 与 kaspad 都只用本机回环与本地盘，理论上无碍——**§4 预演 R2 会实测**，不靠推理 |
| D-B | console 起前核分支 | 生产检出不在 `bshard-m3-deploy` ⇒ **不起 console**（kaspad 照起） | 防"检出被人切到侧分支后重启，钱路代码跑的是侧分支"。副作用：将来分支改名/目录改名时要同步改脚本常量（§6 待议项） |
| D-C | 等待上限 | 90 分钟仍未 `ALIVE` ⇒ 告警一次、**继续等**；24 小时 ⇒ 放弃（退出码 50） | 主网长时间离线后追块可能远超今晚的 2 分钟；kaspad 还在追块时把它杀掉重来没有意义 |
| D-D | 重试 | 计划任务重启 3 次、间隔 10 分钟 | 见 §2.3。**注意**：重试只发生在退出码非 0 的早期失败；确定性失败（二进制哈希不符、错网）重试也会同样失败，只是多 3 条 Error 事件 |
| D-E | 告警落点 | Windows 事件日志（Application / 源 `KANetBoot`）+ 状态文件 | 控制台没起来时 `events` 表根本写不了；事件日志与状态文件不依赖 console。是否再加"console 起来后把 boot-status 灌进 `events` 表"= 改 console 代码，**另批**（§6） |
| D-F | 停 kaspad 的正规方法 | **裁定（现阶段规则）：重启前只停 console 与 relay 子进程；kaspad 交给系统关机通知去停，不手动 `Stop-Process` 它** | 计划任务被"结束"或误 `Stop-Process` 都是 `TerminateProcess`；今晚死机时 kaspad 是被**系统关机通知**干净退出的（(1531)：`Kaspad has stopped`，今晚实证）。Bettor 也没有正规优雅停法，**不猜**。"Ctrl+C 事件能否送达隐藏窗口的进程"放 **R3 的隔离 simnet 节点**上实测，**证明后再改写 §4.5**；在那之前页内按上面的规则写 |
| **D-G** | 🔴 **自启会让"无人值守烧费"变成每次开机必发生** | **建议在自启上线前，先由 Owner 定是否给启动期 `autoSplitAll` 加主网默认关的开关** | (1533)：console **每次启动**都在主网真实花费（今晚 22:21:34 合计约 0.045 KAS，四账户来回拆合），与驱动开关无关。手动重启时这是"Bettor 知情的一次"；自启后是"**任何一次断电/更新重启都会在没人在场时发一批链上交易**"。金额很小，但这是**钱路行为的性质变化**，属 Owner 域，本页不替他定 |

## 1. 现状实核（只读，2026-09-19 22:3x 本地时间，全部为原始读数的摘要）

| 项 | 读数 |
|---|---|
| kaspad | PID 16464，命令行 `"D:\rusty-kaspa-v201\kaspad.exe" --appdir=D:\kaspa-mainnet-data-v201 --utxoindex --rpclisten-borsh=127.0.0.1:17110 --rocksdb-cache-size=2048`；sha256 前缀 `8afe6a68`（全值见附录 A `$KaspadSha256` 默认值，本次实算）；`--version` = `kaspad 2.0.1`；私有内存约 2.7 GB |
| console | PID 9024（`src/index.js`），由 `scripts/start-console-mainnet.ps1` 起 |
| 已有计划任务 | `KANet-TranslateGen2` / `KANet-TranslateProto` / `KANet-VoiceService`（都是 AI 推理侧的）。抽查其中两个：**用户 ADMIN、登录类型 Interactive（=必须有人登录）、无触发器、单次运行时限 30 天**——**不能当本任务的模板**（Interactive 恰是"依赖用户登录"） |
| 已有的自启 | kaspad、console **都没有**（(1531)；本次未发现名字含 kaspa/console 的计划任务） |
| 当前会话 | `quser` 显示 `admin` 在 console 会话（ID 1）——即"有人登录"，所以本页的"不依赖登录"必须靠**重启验证**证明，不能靠现在读到的状态 |
| 权限 | 本机 KANet-UI 会话：`IsInRole(Administrator)=False` ⇒ 注册启动触发器的任务要**提权**（J1 EXECUTE 单） |
| PATH | `node.exe`（`C:\Program Files\nodejs`，v24.14.1）与 `git.exe` 都在**机器级** PATH（不在用户级）⇒ 非交互任务里能找到 |
| PowerShell | 只有 Windows PowerShell 5.1（无 `pwsh`）⇒ 脚本按 5.1 语法写（无 `&&`、无三元） |
| 日志现状 | `logs\mainnet\`：console 日志已有 20 多份 `*.pre-<标签>-<时间戳>.log` 轮转件（最大 47 MB 的 `pre-crash-20260919-2041`）；kaspad 日志在 `D:\kaspa-mainnet-data-v201-logs\`（`kaspad-stdout.log`、`kaspad-stderr.log`、`kaspad.pid`，另有 `*.pre-reboot-20260919-221852.log` 10.7 MB 轮转件）。**命名约定就是 `<原名>.pre-<标签>-<时间戳><扩展名>`，本页照它** |
| 提交内存 | 已用约 44–47%（限额 89.6 GB = 61.6 GB RAM + 28 GB 固定页面文件）；`llama-server` 16 GB 私有、`vmmemWSL` 4.9 GB、kaspad 2.7 GB（(1531) P1 风险仍在，**不在本线范围**） |

## 2. 设计

### 2.1 流程与退出码

```
开机 +2 min ──▶ [计划任务 \KANet\KANet-Mainnet-Boot] ──▶ mainnet-boot-sequence.ps1
  0  单实例文件锁 boot.lock（拿不到 ⇒ 退出 10）
  1  核 kaspad 二进制：文件在？sha256 == 钉住值？--version == "kaspad 2.0.1"？        ⇒ 20 / 21 / 22
  2  kaspad 进程：恰 1 个且命令行逐 token 相同 ⇒ 认领（不轮转、不重起）
                  多于 1 个 ⇒ 41；有 1 个但命令行不同 ⇒ 42（绝不碰它）
                  没有 ⇒ 轮转 kaspad 日志（失败 ⇒ 30）→ 起 → 写 kaspad.pid（起不来 ⇒ 40）
  3  门：每 15 s 跑探针（环境变量只给子进程）
        0 ALIVE ⇒ 过门 │ 7 SYNCING ⇒ 等 │ 8 STALLED ⇒ 告警一次继续等 │ 3/4/5/9 ⇒ 等
        2 错网 ⇒ 43 │ 6 探针坏 ⇒ 44 │ 其它连续 5 次 ⇒ 45 │ kaspad 进程没了 ⇒ 41
        90 min 未过 ⇒ 告警一次（事件 9250）继续等；24 h 未过 ⇒ 50
  4  console（以下失败只"告警 + 不起 console"，**不退出**，kaspad 与哨兵继续活）
        console 进程：恰 1 个 ⇒ 认领；多于 1 个 ⇒ 告警 61
        没有 ⇒ 核生产检出分支（≠ bshard-m3-deploy ⇒ 告警 62、不起）→ 轮转 console 日志（失败 ⇒ 告警 31）
              → 调 start-console-mainnet.ps1（退出码≠0 ⇒ 告警 63）→ 读 console-mainnet.pid
        验证：进程活 + :3202 在听 + GET /api/system/rpc-overview 应答，最长 300 s ⇒ BOOT_OK（事件 9101）
              300 s 内不健康 ⇒ 告警 64，**不杀不重起**
  5  常驻哨兵：每 30 s 看 kaspad / console 进程还在不在；掉了 ⇒ 记状态 + Error 事件（9203 / 9204），**一次**，不重起
```

**为什么"就绪后永不自行退出"**：微软文档与社区说法对"计划任务的动作进程退出后，它用 `Start-Process` 起的子进程会不会被一并结束"**不一致，我没有实测过**（§4 R2 会实测）。按最坏情形设计：脚本一旦退出，可能把刚起的 kaspad 一并带走。所以：只有"kaspad 还没就绪"的致命错误才退出；console 相关的失败只告警；之后常驻。**代价**：这个任务永远显示"正在运行"，谁在任务计划程序里点"结束"= 一次性杀掉 kaspad + console（非干净退出）。§4.5 的停机顺序与 §6 的回滚都写明了这一点。

**为什么不做运行期自动重启**：(a) console 的共享 RpcClient 在 kaspad 重启后**不自愈**（既有实证），kaspad 重启必须跟 console 重启；(b) console 重启有花钱面（重启前要 quiesce 入口，见 (1533) 启动期拆分烧费）。这两条都需要人判断，不能在无人时自动连锁。**本任务只保证"开机拉起来"**，运行期崩溃的处置是另一件事（§6 待议项）。

### 2.2 任务定义（"不依赖用户登录"的具体含义）

| 项 | 值 | 理由 |
|---|---|---|
| 名字 | `\KANet\KANet-Mainnet-Boot` | 与 AI 推理侧的 `KANet-*` 任务分开放 `\KANet\` 文件夹 |
| 触发器 | **系统启动**，延迟 `PT2M` | 开机即触发，不等登录；2 分钟让网络栈、OpenSSH、Tailscale 先起 |
| 主体 | 用户 `ADMIN`，`LogonType=S4U`，`RunLevel=Limited` | S4U = "不管用户是否登录都运行"且**不存密码**；Limited = 不提权（kaspad/console 都不需要提权）。见 D-A |
| 动作 | `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "D:\kanet-tn12\scripts\mainnet-boot-sequence.ps1"`，起始目录 `D:\kanet-tn12` | `-ExecutionPolicy Bypass` 仅对这一次调用生效 |
| **运行时限** | **`0`（无限）** | 🔴 计划任务默认单次运行 **72 小时**后强杀；本任务常驻，默认值会在开机 3 天后把 kaspad 与 console 一起杀掉（现有 KANet-* 任务是 30 天）。**这一项漏设 = 定时炸弹** |
| 多实例策略 | `IgnoreNew` | 与脚本的文件锁双保险 |
| 失败重启 | 3 次，间隔 10 分钟 | 见 2.3 |
| 电源 | 允许在电池上启动/不因转电池停止 | 台式机，无害 |
| 不设 | "仅在网络可用时运行" | 该判断在开机早期不稳定；脚本自己等 |

### 2.3 重试与放弃

- **谁重试**：计划任务的"失败后重启"，**只对脚本以非 0 退出的情形**（退出码见 2.1：10/20/21/22/30/40/41/42/43/44/45/50/99）。就绪之后脚本不退出，所以**运行期不会被计划任务"重启"**。
- **次数与间隔**：最多 3 次、间隔 10 分钟 ⇒ 总共最多 4 次尝试（首次 + 3 次）。
- **放弃后**：任务状态停在"失败"，**不再自动尝试**；每次失败都已写一条 Error 事件（事件 ID = 9000 + 退出码），最后一条即"放弃"的告警。
- **要在 R2 里实测的假设**：非 0 退出码是否触发"失败后重启"（不同 Windows 版本对"失败"的判定有差异），以及"3 次后停"。不靠推理。

### 2.4 探针的环境变量（探针默认是 TN12 的）

`scripts/kaspad-rpc-probe.mjs` 默认连 `ws://127.0.0.1:17210`、期望网络 `testnet-12`、状态文件写 `D:/kaspa-tn12-data/...`。**对主网必须设三个环境变量**（脚本只给探针子进程设、用完即删，避免 console 继承）：

| 变量 | 主网值 |
|---|---|
| `KASPAD_PROBE_URL` | `ws://127.0.0.1:17110` |
| `KASPAD_PROBE_NETWORK` | `mainnet`（**实测**：探针对活节点回 `ALIVE:network=mainnet daa=…`，退出码 0；同一个值既做 RpcClient 的 networkId 又做身份比对，两处对得上） |
| `KASPAD_PROBE_STATE` | 一个可写路径（本页用 `logs\mainnet\boot\probe-state.json`）。**不设的话**它写到 `D:/kaspa-tn12-data/`（TN12 退役后可能不存在），写失败被静默吞掉 ⇒ 卡死判定（退出码 8）永远不会触发 |

探针**没有改动**，`8`/`9` 等退出码含义照其头注释。探针依赖 `kasia-relay/node_modules/kaspa-wasm`（本次实跑通过）。

### 2.5 告警落点（"放弃后告警落在哪"）

console 没起来时，`events` 表（`disk-space-alert` 那一类的落点）**写不了**，所以不能把它当唯一落点。三处，都不依赖 console：

| 落点 | 内容 | 谁读、怎么读 |
|---|---|---|
| Windows 事件日志 · Application · 源 `KANetBoot` | 开始 9100、正常 9101、失败 9000+退出码（Error）、console 告警 9031/9061–9064（Warning）、kaspad 卡同步 9201、90 分钟未就绪 9250、运行期死亡 9203/9204 | 接位的会话：`Get-WinEvent -FilterHashtable @{LogName='Application';ProviderName='KANetBoot'} -MaxEvents 20`。**源要先由提权会话注册一次**（§4.2）；没注册时脚本只写状态文件，不报错 |
| `logs\mainnet\boot\boot-status.json` | 最新阶段 + 时间 + 细节（原子改名写入） | `Get-Content` 一条命令 |
| `logs\mainnet\boot\boot-history.log` | 每个阶段一行，追加 | 事后复盘 |

不含任何密钥、余额、地址。**不通知 Owner 手机**：那要动电报/推送，不在本页范围，也不是我能定的（D-E）。

## 3. 前置检查（只读；任何时候都能跑）

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 3.1 | 生产检出分支 | `git -C D:\kanet-tn12 branch --show-current` | `bshard-m3-deploy` |
| 3.2 | kaspad 进程恰 1 个且命令行逐字 | `Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'" \| Select ProcessId, CommandLine` | 1 行；命令行 = 附录 A `$kArgs` 四个参数 |
| 3.3 | kaspad 二进制哈希与版本 | `(Get-FileHash D:\rusty-kaspa-v201\kaspad.exe -Algorithm SHA256).Hash` 与 `& D:\rusty-kaspa-v201\kaspad.exe --version` | 与附录 A 常量逐位相同；`kaspad 2.0.1` |
| 3.4 | 脚本里的"认领"判定对活进程成立 | 2026-09-19 已跑：把脚本的 `Test-ArgsMatch` 对活 kaspad 命令行核 | `True`（**同时抓到一个真 bug**：`Get-CimInstance` 单个结果被 PowerShell 展开成标量，`.Count` 为空，调用处必须 `@(...)` 包住，否则"认领"分支永远走不进、会去**起第二个 kaspad**。草案已修并再测） |
| 3.5 | 主网探针 | `$env:KASPAD_PROBE_URL='ws://127.0.0.1:17110'; $env:KASPAD_PROBE_NETWORK='mainnet'; $env:KASPAD_PROBE_STATE='<可写路径>'; node scripts\kaspad-rpc-probe.mjs; $LASTEXITCODE` | `ALIVE:network=mainnet …`、`0`（**只读，一次连接，跑完进程即退**） |
| 3.6 | 现有任务里没有同名任务 | `Get-ScheduledTask -TaskName KANet-Mainnet-Boot -ErrorAction SilentlyContinue` | 无输出 |
| 3.7 | 机器当前状态（记基线） | `Get-Process kaspad`、`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` 里 `kasia-console\src\index.js` 的 PID 与 `CreationDate` 完整值 | 记下；预演后核未变 |

## 4. 执行步骤（每步四段：前置 → 动作 → 验收读数 → 中止/回滚）

### 4.1 落码：`scripts/mainnet-boot-sequence.ps1`

**门**：Bettor 批（铁律 0）→ NWT 审 diff。
**前置**：本页与附录 A 已过 Bettor 审；在 `scratch\_kanetui_wt_<name>` 独立 worktree 里做，**不动生产检出**。
**动作**：把附录 A 原样落为该文件（**仅 ASCII**——脚本注释和消息都是英文，避免 5.1 把无 BOM 文件按 ANSI 读坏）；`node scripts\lint-kanet.mjs scripts/mainnet-boot-sequence.ps1`。
**验收读数**：① `[System.Management.Automation.Language.Parser]::ParseFile` 无错误；② `powershell.exe -NoProfile -File scripts\mainnet-boot-sequence.ps1 -SelfTest` ⇒ 全部 `PASS`、`SELFTEST failures=0`、退出码 0（`-SelfTest` 只跑辅助函数、用临时目录、**不起任何进程、不碰生产路径**；2026-09-19 草案已跑过一遍 11 项全绿，其中一项测试夹具错误——用 `Set-Content ''` 造"空文件"其实写了 2 字节——是自测抓到的）。
**中止/回滚**：任一失败 ⇒ 不合入。回滚 = 不合入/`git revert`，无运行时效果（脚本没被任何东西调用）。

### 4.2 一次性：注册事件源（提权，J1 EXECUTE）

**门**：4.1 已合入且 Bettor 出 EXECUTE 单。
**前置**：`Get-EventLog -LogName Application -Source KANetBoot -Newest 1` 报"找不到源"（即尚未注册）。
**动作**（提权）：`New-EventLog -LogName Application -Source KANetBoot`。
**验收读数**：`[System.Diagnostics.EventLog]::SourceExists('KANetBoot')` ⇒ `True`；再写一条测试事件 `Write-EventLog -LogName Application -Source KANetBoot -EventId 9199 -EntryType Information -Message 'KANetBoot source registration test'`，`Get-WinEvent` 读回。
**中止/回滚**：`Remove-EventLog -Source KANetBoot`（提权）。无副作用。

### 4.3 注册计划任务（提权，J1 EXECUTE）

**门**：4.2 通过 + **预演 R2 通过**（§4.4——没在 R2 里实测过 S4U 与"失败重启"，不注册正式任务）+ Bettor 出 EXECUTE 单 + **D-G 已有 Owner 决定**（是否给启动期拆分加开关；不加也是一个决定，但要有）。
**前置**：3.6 ⇒ 无同名任务；3.1 ⇒ 分支正确；脚本已落在生产检出且哈希记录在案。
**动作**：附录 B 的注册命令（提权）。**注册后立刻**：`Get-ScheduledTask -TaskName KANet-Mainnet-Boot | Select -Expand Triggers` 与 `... | Select -Expand Settings` 逐项对 §2.2 表。
**验收读数**：`ExecutionTimeLimit` = `PT0S`；`RestartCount`=3、`RestartInterval`=`PT10M`；`MultipleInstancesPolicy`=`IgnoreNew`；触发器为 Boot、`Delay`=`PT2M`；主体 `LogonType`=`S4U`、`RunLevel`=`Limited`。**注册本身不运行任务、不影响正在跑的 kaspad 与 console。**
**中止/回滚**：`Disable-ScheduledTask` → `Unregister-ScheduledTask -Confirm:$false`（提权）。见 §6。

### 4.4 预演（在真重启之前，逐级；R0 起都不碰生产的 kaspad/console 进程）

| 级 | 做什么 | 验收 | 风险 |
|---|---|---|---|
| **R0** | 语法解析 + `-SelfTest`（4.1 已含） | 0 错误、11 项 PASS | 无 |
| **R1** | **认领演练（幂等）**：在 kaspad 与 console **都在跑**的现状下，手动运行一次 `mainnet-boot-sequence.ps1`（不带参数）。预期：`KASPAD_ADOPTED` → 探针 `ALIVE` → `CONSOLE_ADOPTED` → `BOOT_OK`，然后常驻；**不起任何进程、不轮转任何日志**。验完 `Get-Process -Name powershell` 里找到该脚本进程并结束它（文件锁随进程释放）。 | 进程表 kaspad / console 的 PID 与 `CreationDate` **不变**；`logs\mainnet\` 与 kaspad 日志目录**没有新增 `*.pre-boot-*` 文件**；`boot-status.json` 阶段序列如上 | 只写 `logs\mainnet\boot\` 下几个小文件。**这一步需要 Bettor 明说可以跑，且必须在 NWT 审过脚本草案之后**（在生产上跑了脚本，虽然是只读路径） |
| **R2** | **计划任务语义实测（无害动作）**：由 J1 注册一个**一次性的、临时的**演练任务 `\KANet\KANet-Boot-Rehearsal`，主体与 §2.2 完全相同（S4U、Limited），触发器改"手动"，动作是**无害脚本**：a) 用 `Start-Process` 起一个 `ping.exe -t 127.0.0.1` 子进程后**退出码 7 退出**（测：任务结束后子进程是否还活着；非 0 退出是否触发"失败重启"、重启几次后停）；b) 另一个变体：不退出、常驻 `Start-Sleep`（测：`node -v`、`git --version`、读一个非敏感的本地文件、写 `logs\mainnet\boot\` 下的文件在 S4U 令牌下是否都成功 = D-A 的实证）。演练完 `Unregister-ScheduledTask`。 | 记录：子进程存活与否（决定 §2.1 的"常驻"是必需还是可放宽）；重启次数 = 3；S4U 下 `node`/`git`/文件读写全部成功。**若 S4U 下有任何一项失败 ⇒ 回报 Bettor 换 D-A 备选，不硬上** | 只起 `ping`，不碰主网进程 |
| **R3** | **起动路径演练（隔离，不碰主网）**：用脚本的参数覆盖（`-KaspadExe`/`-AppDir`/`-KaspadLogDir`/`-RpcPort`/`-ExpectNetwork`/`-ExtraKaspadArgs '--simnet'`/`-SkipConsole`）对一个 **simnet kaspad + 全新临时数据目录**（放 `scratch\`，端口避开 J2 正在用的 simnet 节点与主网 17110）跑一遍"起 → 轮转 → 门 → ALIVE"。**需先由 J2/Bettor 确认端口与 simnet 二进制没人占用**。 | `KASPAD_STARTED` → `KASPAD_ALIVE`；再跑第二遍 ⇒ `KASPAD_ADOPTED`，**且**首遍产生的日志被轮转成 `pre-boot-<ts>` 文件、内容与原文件一致；**故意**把 `-KaspadSha256` 改错一位再跑 ⇒ 退出码 21、**没有起进程** | 起一个 simnet kaspad（临时目录），事后结束并清目录。**探针对 simnet 的 `network` 字符串是否等于 `simnet` 我未验证**——R3 第一步先读，不符则只测起/轮转/认领，不测门 |

### 4.5 真重启验证（需要 Bettor GO；本机全部会话会被切断）

**门**：4.3 已注册 + R0–R3 全过 + Bettor GO + Owner 知悉（同 9/14 先例：`docs/iteration/j1-inbox/2026-09-14T10-00Z-…` 的 §1–§4）。
**前置**：按 9/14 先例：NO-TX 检查（console stdout 近 2 分钟无 `broadcast`/`submitTransaction`/`send_tx`）→ 停 console（PID 文件）→ 清 `relay.mjs` 遗留子进程 → **不手动停 kaspad**（D-F 裁定：交给系统关机通知，今晚实证干净退出 `Kaspad has stopped`）→ 再 `shutdown /r /t 10`。**先停 console 与 relay 子进程，再关机**（(1531) P4）。Ctrl+C 类手动优雅停法待 R3 隔离 simnet 实测证明后再改写本步。
**动作**：`shutdown /r /t 10`。**此后没有人登录**；由 J1 经 SSH 读数（OpenSSH 是系统服务，开机即起；Tailscale 已 unattended）。
**验收读数**（沿用 9/14 §3，并加本任务自己的读数；每项给期望值）：

| # | 读数 | 期望 |
|---|---|---|
| 1 | `quser` | **空**（无人登录——这才证明"不依赖登录"） |
| 2 | 事件日志 `KANetBoot` | 9100（begin）→ … → 9101（OK），**没有 9000+ 的 Error** |
| 3 | `boot-status.json` | `phase=BOOT_OK`，含 kaspadPid/consolePid；`boot-history.log` 阶段序列合理 |
| 4 | kaspad | 新 PID、1 个、命令行逐字；`17110` 恰 1 个 Listen；探针 `ALIVE:network=mainnet` |
| 5 | 日志轮转 | 出现 `kaspad-stdout.pre-boot-<ts>.log` 与 `console-mainnet-stdout.pre-boot-<ts>.log`（若重启前它们非空），内容 = 重启前那份；新的 `*.log` 从头开始 |
| 6 | console | 新 PID、恰 1 个；`127.0.0.1:3202` 恰 1 个 Listen；stdout `[silverc-pin] PASS` 恰 1 行、`WARMUP FAIL` 0 行、`checked-in reference` 0 行 |
| 7 | `GET /api/system/rpc-overview` | `total=18 connected=18`（18 = 主网库 relay_nodes 行数，(1533) NWT 核；不要沿用 9/14 的 17） |
| 8 | 四条敏感路由 | 均 503（mnemonic / privkey / system/run / system/download，同 (1532)） |
| 9 | 时间 | 关机→`BOOT_OK` 的总时长（供 (1531) 的可用性评估） |
| 10 | 启动期花费 | `[utxo-splitter]` 日志行的账户/金额（(1533) 已知会发生；记录，不视为异常，除非 D-G 已决定关掉它） |

**中止/回滚**：
- `quser` 非空、或事件日志无 9100 ⇒ **任务没在无人登录时跑起来**：停在这里，机器还在，等 Owner 登录后按 §5 手动拉起（同 9/14 的 T4 判据），任务改 D-A 备选。
- 有 Error 事件 ⇒ 按 §5 的读数速查表处置，**不要手动重复起 kaspad**（先看 `boot-status.json` 与 kaspad 日志）。
- 手动拉起 = 9/14 GO §2 的 kaspad 原命令 + `scripts\start-console-mainnet.ps1`（本 runbook 上线前的现行做法，不变）。

## 5. 失败时读什么（速查表）

| 事件 ID / 退出码 | 含义 | 先读 | 处置 |
|---|---|---|---|
| 退出码 10（**无事件**，只写 `boot-history.log`） | 拿不到 `boot.lock`（另一实例在跑） | `boot-history.log` 末尾；`Get-Process powershell` | 通常是手动跑过（如 R1）没关；确认后结束旧实例 |
| 9020 / 9021 / 9022 | kaspad 二进制不存在 / sha256 不符 / `--version` 不符 | 状态文件里的 message（含实算哈希前 12 位） | **不要改脚本里的钉住值去"让它过"**：先问是谁换了二进制（升级要走 Bettor + 更新钉住值的提交） |
| 9030 / 9031 | 日志改名失败（kaspad / console） | message；目标文件是否已存在、是否被占用 | 不覆盖证据：手动改名后重试；console 侧只告警 |
| 9040 / 9041 / 9042 | kaspad 起不来 / 进程数≠1 / 已有个命令行不同的 kaspad | `kaspad-stderr.log`、`Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'"` | 42：有人手动起了参数不同的 kaspad（如带 `--unsaferpc`）——**脚本不碰它**，由 Bettor 定 |
| 9043 / 9044 / 9045 | 17110 上不是主网 / 探针依赖坏了 / 探针连续 5 次异常 | 状态文件里的 lastProbe 行 | 43 极严重（RPC 端口被别的网络占了）；44 看 `kasia-relay\node_modules\kaspa-wasm` 是否还在 |
| 9201 | kaspad 卡同步（探针 8） | `kaspad-stdout.log` 尾部 | 只告警；脚本继续等 |
| 9250 | 90 分钟仍未 ALIVE | 同上 + `Get-Process kaspad` 的内存/CPU | 追块慢；脚本继续等到 24 小时 |
| 9050 | 24 小时未 ALIVE，放弃 | 同上 | 人处理 |
| 9061 / 9062 / 9063 / 9064 | console：进程数>1 / 分支不对 / 起动脚本失败 / 300 s 内不健康 | `console-mainnet-stderr.log`；`git branch --show-current` | **kaspad 已起且活着**；console 由人手动起，不要重复触发本任务 |
| 9203 / 9204 | 运行期 kaspad / console 消失 | 事件日志前后文、系统事件日志（内存耗尽 2004？） | **nothing restarts it automatically**：kaspad 重启后 console 必须一起重启（RpcClient 不自愈）；先 quiesce 再重启 |
| 9099 | 脚本自己抛了未预期异常 | 状态文件 message | 报 Bettor |

## 6. 回滚与待议项

**回滚**（任何一步，最坏情形也只影响"开机自启"这一件新东西；kaspad 与 console 的手动起停做法不变）：
1. 禁用：`Disable-ScheduledTask -TaskPath '\KANet\' -TaskName KANet-Mainnet-Boot`（提权）——下次开机不再触发。
2. 若任务正在"运行"（常驻）而要撤：**不要在任务计划程序里"结束"它**（结束任务 = `TerminateProcess` 杀掉全部子进程，含 kaspad，非干净退出）。做法：先按 **§4.5 前置**停 console 与 relay 子进程，让 kaspad 随**系统关机通知**干净退出（即重启机器）；`Disable`/`Unregister` 本身会不会顺带结束正在运行的实例**未实测**（R2 一并测），测清之前不要指望它"温和"。
3. 注销：`Unregister-ScheduledTask -TaskPath '\KANet\' -TaskName KANet-Mainnet-Boot -Confirm:$false`（提权）。事件源与 `logs\mainnet\boot\` 文件可留，无害。
4. 手动起法 = 9/14 GO §2（本页上线前的现行做法）。

**待议项（不在本页范围，列出以免被误以为已覆盖）**：
- **运行期崩溃**没有任何自动处置；本任务只覆盖开机。`scripts\kaspad-watchdog.ps1` 是 TN12 链，**不可复用**。
- console 起来后把 `boot-status.json` 灌进 `events` 表（让 UI/巡检能看到）= 改 console 代码，另批。
- **停 kaspad 的优雅方法（D-F）**：现行规则 = 不手动停、交系统关机通知（§0 D-F 裁定）。**待测**：在 R3 的隔离 simnet 节点上试"Ctrl+C 事件"能否送达一个隐藏窗口的进程；证明后才能把 §4.5 前置改写成手动优雅停的命令。
- **目录改名 `D:\kanet-tn12 → D:\kanet`**（改名 runbook 已过 NWT、未执行）：脚本、`start-console-mainnet.ps1`、计划任务动作里的路径全是硬编码，**改名与本任务必须同窗同步**，否则开机后 console 起不来（脚本会以 `62`/`63` 告警，kaspad 仍起）。
- **kaspad 升级**：钉住值（sha256 + 版本串）要跟着换，走 Bettor；脚本按设计拒起未知二进制。
- **休眠/快速启动**：`shutdown /s` 后按电源键（快速启动）与 `shutdown /r` 是否都会触发"系统启动"触发器，本页**未证明**；4.5 用 `/r`，冷启动（今晚这种硬复位后上电）是否等价，建议再补一次 `shutdown /s` + 上电验证。

## 7. 已知未证明面（诚实口径）

1. **S4U 主体在本机 console/kaspad 上是否无碍**：推理上无碍（本地盘、本地回环、无 DPAPI），**未实测**——R2 实测。
2. **任务结束后子进程是否存活**：未实测——R2 实测；当前设计按"会被杀"的最坏情形做。
3. **非 0 退出码是否触发"失败重启"、次数是否精确为 3**：未实测——R2 实测。
4. **Windows"快速启动"下启动触发器是否触发**：未实测。
5. **探针对 simnet 的 `network` 字符串**：未验证（只对主网验证了 `mainnet`）。
6. **脚本主体（起进程、门、console 阶段）没有在真环境跑过**：只有辅助函数的 `-SelfTest` 与"认领判定对活进程"两项实测。R1（认领）、R3（起动）、4.5（真重启）是逐级补证。
7. 提交内存/事件日志字段口径以本机实测为准（EN-US 区域；非英语区域的性能计数器名会不同，脚本用 `Win32_OperatingSystem` 属性，不受区域影响）。

## 附录 A. `scripts/mainnet-boot-sequence.ps1` 草案全文（**未落码、未在真启动上运行**；ASCII-only；落码须 Bettor 批）

```powershell
# mainnet-boot-sequence.ps1 -- DRAFT, not landed, not run on a real boot. KANet-UI 2026-09-19.
# Boot-time orchestration for the mainnet node + console. BOOT-ONLY: it is not a runtime supervisor and never
# restarts anything that died after boot (a console restart after a kaspad restart has money-path side effects and
# must be a human decision). Order: verify kaspad binary -> rotate logs -> start kaspad -> wait for probe ALIVE ->
# rotate console logs -> start console -> verify -> stay resident as a dead-man watcher (alerts only).
# Design rule: the script exits non-zero ONLY for failures that happen before kaspad is proven ALIVE. After that it
# never exits on its own, because (unproven) Task Scheduler may kill processes started by a task when the task ends.
# ASCII-only on purpose (Windows PowerShell 5.1 reads a BOM-less file as ANSI).
# Rehearsal: -SelfTest runs helper functions only and starts nothing.
[CmdletBinding()]
param(
  [string]  $KanetRoot       = 'D:\kanet-tn12',
  [string]  $KaspadExe       = 'D:\rusty-kaspa-v201\kaspad.exe',
  [string]  $KaspadSha256    = '8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38',
  [string]  $KaspadVersion   = 'kaspad 2.0.1',
  [string]  $AppDir          = 'D:\kaspa-mainnet-data-v201',
  [string]  $KaspadLogDir    = 'D:\kaspa-mainnet-data-v201-logs',
  [int]     $RpcPort         = 17110,
  [string]  $ExpectNetwork   = 'mainnet',
  [int]     $ConsolePort     = 3202,
  [int]     $GateSoftSec     = 5400,    # not ALIVE after this: alert once, keep waiting
  [int]     $GateHardSec     = 86400,   # not ALIVE after this: give up (exit 50)
  [int]     $ProbeEverySec   = 15,
  [string]  $AllowedBranch   = 'bshard-m3-deploy',
  [string[]]$ExtraKaspadArgs = @(),
  [switch]  $SkipConsole,
  [switch]  $SelfTest
)
$ErrorActionPreference = 'Stop'
$BootDir = Join-Path $KanetRoot 'logs\mainnet\boot'
$StatusFile = Join-Path $BootDir 'boot-status.json'
$HistoryFile = Join-Path $BootDir 'boot-history.log'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Write-History([string]$Msg) {
  try { Add-Content -LiteralPath $HistoryFile -Value ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg) -Encoding ASCII } catch { }
}

function Set-BootStatus([string]$Phase, [hashtable]$Detail = @{}) {
  $o = [ordered]@{ phase = $Phase; at = (Get-Date).ToString('o'); pid = $PID; stamp = $Stamp; detail = $Detail }
  $tmp = "$StatusFile.tmp"
  try {
    New-Item -ItemType Directory -Force -Path $BootDir | Out-Null
    ($o | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $tmp -Encoding ASCII
    Move-Item -LiteralPath $tmp -Destination $StatusFile -Force
  } catch { }
  Write-History ("{0} {1}" -f $Phase, ($Detail | ConvertTo-Json -Compress -Depth 3))
}

function Send-BootEvent([int]$Id, [string]$Type, [string]$Msg) {
  # Application log, source KANetBoot. The source must be registered once by an elevated session (runbook 4.2).
  try { Write-EventLog -LogName Application -Source 'KANetBoot' -EventId $Id -EntryType $Type -Message $Msg -ErrorAction Stop }
  catch { Write-History ("eventlog-write-failed id={0}: {1}" -f $Id, $_.Exception.Message) }
}

function Stop-Boot([int]$Code, [string]$Phase, [string]$Msg) {
  # Fatal, pre-ALIVE only. Task Scheduler may retry (RestartCount) -- bounded, and every attempt leaves an Error event.
  Set-BootStatus $Phase @{ exitCode = $Code; message = $Msg }
  Send-BootEvent (9000 + $Code) 'Error' ("KANet mainnet boot FAILED phase={0} code={1}: {2}" -f $Phase, $Code, $Msg)
  exit $Code
}

function Warn-Console([int]$Code, [string]$Phase, [string]$Msg) {
  # Console-phase failure: alert and keep the (healthy) kaspad and this watcher alive; never exit here.
  Set-BootStatus $Phase @{ code = $Code; message = $Msg }
  Send-BootEvent (9000 + $Code) 'Warning' ("KANet mainnet console NOT started/healthy phase={0} code={1}: {2}" -f $Phase, $Code, $Msg)
}

function Rotate-LogIfPresent([string]$Path, [string]$StampStr) {
  # Same naming convention already in logs\mainnet: <base>.pre-<label>-<yyyyMMdd-HHmmss><ext>. Rename only; never delete.
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $fi = Get-Item -LiteralPath $Path
  if ($fi.Length -eq 0) { return $null }
  $dest = Join-Path $fi.DirectoryName ('{0}.pre-boot-{1}{2}' -f $fi.BaseName, $StampStr, $fi.Extension)
  if (Test-Path -LiteralPath $dest) { throw "rotation target already exists: $dest" }
  Move-Item -LiteralPath $Path -Destination $dest -ErrorAction Stop
  return $dest
}

function Test-ArgsMatch([string]$CommandLine, [string]$Exe, [string[]]$WantArgs) {
  if (-not $CommandLine) { return $false }
  $have = @(($CommandLine -replace '"', '') -split '\s+' | Where-Object { $_ })
  $want = @($Exe) + $WantArgs
  if ($have.Count -ne $want.Count) { return $false }
  for ($i = 0; $i -lt $want.Count; $i++) { if ($have[$i] -ne $want[$i]) { return $false } }
  return $true
}

function Get-KaspadProcs { @(Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'") }
function Get-ConsoleProcs { @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'kasia-console[\\/]src[\\/]index\.js' }) }
function Test-Listening([int]$Port) { [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) }

function Get-CommitSnapshot {
  $os = Get-CimInstance Win32_OperatingSystem
  $lim = [double]$os.TotalVirtualMemorySize; $free = [double]$os.FreeVirtualMemory
  @{ commitUsedPct = [math]::Round(100 * ($lim - $free) / $lim, 1); physFreeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1) }
}

function Get-NativeText([scriptblock]$Block) {
  $ErrorActionPreference = 'Continue'   # native stderr merged with 2>&1 must not become a terminating error
  (& $Block 2>&1 | Out-String).Trim()
}

function Invoke-Probe {
  # Runs the existing probe (exit 0 = ALIVE, 7 = SYNCING, 8 = STALLED, 5/9 = not up yet, 2 = wrong network, 6 = probe broken).
  # The three KASPAD_PROBE_* variables are set for the child only and removed afterwards so the console never inherits them.
  $ErrorActionPreference = 'Continue'
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $env:KASPAD_PROBE_URL = "ws://127.0.0.1:$RpcPort"; $env:KASPAD_PROBE_NETWORK = $ExpectNetwork
  $env:KASPAD_PROBE_STATE = Join-Path $BootDir 'probe-state.json'
  try { $out = (& $node (Join-Path $KanetRoot 'scripts\kaspad-rpc-probe.mjs') '--timeout-ms=8000' 2>&1 | Out-String).Trim(); $code = $LASTEXITCODE }
  finally { Remove-Item Env:KASPAD_PROBE_URL, Env:KASPAD_PROBE_NETWORK, Env:KASPAD_PROBE_STATE -ErrorAction SilentlyContinue }
  [pscustomobject]@{ Code = $code; Line = $out }
}

if ($SelfTest) {
  # Helper-function checks only. Uses a temp dir; starts no process, touches no production path.
  $tmp = Join-Path $env:TEMP ('boot-selftest-' + $Stamp); New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $BootDir = $tmp; $StatusFile = Join-Path $tmp 'boot-status.json'; $HistoryFile = Join-Path $tmp 'boot-history.log'
  $fail = 0
  function Check([string]$Name, [bool]$Ok) { if ($Ok) { "PASS $Name" } else { "FAIL $Name"; $Script:fail++ } }
  Set-Content (Join-Path $tmp 'a-stdout.log') 'evidence' -Encoding ASCII
  New-Item -ItemType File -Force -Path (Join-Path $tmp 'a-stderr.log') | Out-Null   # truly 0 bytes (Set-Content '' writes CRLF)
  $d = Rotate-LogIfPresent (Join-Path $tmp 'a-stdout.log') $Stamp
  Check 'rotate-nonempty-renames' ($d -and (Test-Path $d) -and -not (Test-Path (Join-Path $tmp 'a-stdout.log')) -and ((Get-Content $d) -eq 'evidence'))
  Check 'rotate-name-convention' ($d -like "*a-stdout.pre-boot-$Stamp.log")
  Check 'rotate-empty-skipped' ($null -eq (Rotate-LogIfPresent (Join-Path $tmp 'a-stderr.log') $Stamp))
  Check 'rotate-missing-skipped' ($null -eq (Rotate-LogIfPresent (Join-Path $tmp 'nope.log') $Stamp))
  Set-Content (Join-Path $tmp 'a-stdout.log') 'second' -Encoding ASCII
  $threw = $false; try { Rotate-LogIfPresent (Join-Path $tmp 'a-stdout.log') $Stamp | Out-Null } catch { $threw = $true }
  Check 'rotate-collision-throws-and-keeps-source' ($threw -and (Test-Path (Join-Path $tmp 'a-stdout.log')) -and ((Get-Content (Join-Path $tmp 'a-stdout.log')) -eq 'second'))
  $exe = 'D:\x\kaspad.exe'; $a = @('--appdir=D:\d', '--utxoindex')
  Check 'args-match-quoted-exe' (Test-ArgsMatch '"D:\x\kaspad.exe" --appdir=D:\d --utxoindex' $exe $a)
  Check 'args-match-rejects-extra' (-not (Test-ArgsMatch 'D:\x\kaspad.exe --appdir=D:\d --utxoindex --unsaferpc' $exe $a))
  Check 'args-match-rejects-missing' (-not (Test-ArgsMatch 'D:\x\kaspad.exe --appdir=D:\d' $exe $a))
  Check 'args-match-rejects-different-value' (-not (Test-ArgsMatch 'D:\x\kaspad.exe --appdir=D:\other --utxoindex' $exe $a))
  Set-BootStatus 'SELFTEST' @{ ok = $true }
  Check 'status-json-roundtrip' ((Get-Content $StatusFile -Raw | ConvertFrom-Json).phase -eq 'SELFTEST')
  Check 'commit-snapshot-sane' ((Get-CommitSnapshot).commitUsedPct -gt 0)
  Remove-Item -Recurse -Force $tmp
  "SELFTEST failures=$fail"; exit ([int]($fail -gt 0))
}

# ---------------------------------------------------------------- real run
# Single instance via an exclusive file lock held for the life of the process (a Global\ mutex needs a privilege a
# limited task token may lack; the lock also works across sessions). Task Scheduler is set to IgnoreNew as well.
New-Item -ItemType Directory -Force -Path $BootDir | Out-Null
try { $Script:LockStream = [System.IO.File]::Open((Join-Path $BootDir 'boot.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { Write-History 'another boot sequence instance holds boot.lock; exiting'; exit 10 }

function Start-ConsolePhase {
  # returns the console PID, or $null after a Warn-Console (kaspad stays up either way)
  $cProcs = @(Get-ConsoleProcs)
  if ($cProcs.Count -gt 1) { Warn-Console 61 'CONSOLE_START' "$($cProcs.Count) console processes present; refusing to pick one"; return $null }
  if ($cProcs.Count -eq 1) { $cPid = [int]$cProcs[0].ProcessId; Set-BootStatus 'CONSOLE_ADOPTED' @{ consolePid = $cPid } }
  else {
    $branch = Get-NativeText { & git -C $KanetRoot branch --show-current }
    if ($branch -ne $AllowedBranch) { Warn-Console 62 'CONSOLE_BRANCH_GUARD' "production checkout is on '$branch', expected '$AllowedBranch'; console NOT started"; return $null }
    $logDir = Join-Path $KanetRoot 'logs\mainnet'
    try { $c1 = Rotate-LogIfPresent (Join-Path $logDir 'console-mainnet-stdout.log') $Stamp; $c2 = Rotate-LogIfPresent (Join-Path $logDir 'console-mainnet-stderr.log') $Stamp }
    catch { Warn-Console 31 'CONSOLE_LOG_ROTATE' $_.Exception.Message; return $null }
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $KanetRoot 'scripts\start-console-mainnet.ps1') | Out-Null   # child stdout must not leak into this function's return value
    if ($LASTEXITCODE -ne 0) { Warn-Console 63 'CONSOLE_START' "start-console-mainnet.ps1 exit code $LASTEXITCODE"; return $null }
    $cPid = [int](Get-Content (Join-Path $logDir 'console-mainnet.pid') -Raw).Trim()
    Set-BootStatus 'CONSOLE_STARTED' @{ consolePid = $cPid; rotated = @($c1, $c2) | Where-Object { $_ } }
  }
  # verify: process alive, port listening, HTTP answering. A failure here warns; it never kills or restarts the console.
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt 300) {
    if ((Get-Process -Id $cPid -ErrorAction SilentlyContinue) -and (Test-Listening $ConsolePort)) {
      try {
        $sum = (Invoke-RestMethod -Uri "http://127.0.0.1:$ConsolePort/api/system/rpc-overview" -TimeoutSec 10).summary
        Set-BootStatus 'BOOT_OK' @{ consolePid = $cPid; rpcSummary = $sum }
        Send-BootEvent 9101 'Information' 'KANet mainnet boot OK'
        return $cPid
      } catch { }
    }
    Start-Sleep -Seconds 10
  }
  Warn-Console 64 'CONSOLE_UNHEALTHY' 'console process/port/HTTP not healthy within 300s; NOT restarted by the boot sequence'
  return $cPid
}

function Invoke-BootSequence {
  Set-BootStatus 'BOOT_BEGIN' (Get-CommitSnapshot)
  Send-BootEvent 9100 'Information' 'KANet mainnet boot sequence begin'

  # 1. kaspad binary identity (sha256 + --version) BEFORE anything is started
  if (-not (Test-Path -LiteralPath $KaspadExe)) { Stop-Boot 20 'KASPAD_BINARY' "missing $KaspadExe" }
  $sha = (Get-FileHash -LiteralPath $KaspadExe -Algorithm SHA256).Hash.ToLower()
  if ($sha -ne $KaspadSha256.ToLower()) { Stop-Boot 21 'KASPAD_BINARY' ("sha256 mismatch: got {0}" -f $sha.Substring(0, 12)) }
  $ver = Get-NativeText { & $KaspadExe --version }
  if ($ver -ne $KaspadVersion) { Stop-Boot 22 'KASPAD_BINARY' "--version mismatch: '$ver'" }

  # 2. kaspad: adopt if already running with the exact command line, refuse anything else, otherwise start
  $kArgs = @("--appdir=$AppDir", '--utxoindex', "--rpclisten-borsh=127.0.0.1:$RpcPort", '--rocksdb-cache-size=2048') + $ExtraKaspadArgs
  $kProcs = @(Get-KaspadProcs)
  if ($kProcs.Count -gt 1) { Stop-Boot 41 'KASPAD_START' "$($kProcs.Count) kaspad.exe processes present; refusing to pick one" }
  if ($kProcs.Count -eq 1) {
    if (-not (Test-ArgsMatch $kProcs[0].CommandLine $KaspadExe $kArgs)) { Stop-Boot 42 'KASPAD_START' 'a kaspad.exe is running with a different command line; not touching it' }
    $kPid = [int]$kProcs[0].ProcessId
    Set-BootStatus 'KASPAD_ADOPTED' @{ kaspadPid = $kPid }
  } else {
    New-Item -ItemType Directory -Force -Path $KaspadLogDir | Out-Null
    $kOut = Join-Path $KaspadLogDir 'kaspad-stdout.log'; $kErr = Join-Path $KaspadLogDir 'kaspad-stderr.log'
    try { $r1 = Rotate-LogIfPresent $kOut $Stamp; $r2 = Rotate-LogIfPresent $kErr $Stamp } catch { Stop-Boot 30 'KASPAD_LOG_ROTATE' $_.Exception.Message }
    $kp = Start-Process -FilePath $KaspadExe -ArgumentList $kArgs -RedirectStandardOutput $kOut -RedirectStandardError $kErr -WindowStyle Hidden -PassThru
    if (-not $kp -or -not $kp.Id) { Stop-Boot 40 'KASPAD_START' 'Start-Process returned no process' }
    $kPid = $kp.Id
    Set-Content -LiteralPath (Join-Path $KaspadLogDir 'kaspad.pid') -Value $kPid -Encoding ASCII
    Set-BootStatus 'KASPAD_STARTED' @{ kaspadPid = $kPid; rotated = @($r1, $r2) | Where-Object { $_ } }
  }

  # 3. Gate: console is not started until the existing probe says ALIVE (listening on 17110 is NOT enough: sync can lag it by minutes)
  $t0 = Get-Date; $alive = $false; $consecErr = 0; $stalledAlerted = $false; $softAlerted = $false; $lastNote = Get-Date
  while (-not $alive) {
    if (-not (Get-Process -Id $kPid -ErrorAction SilentlyContinue)) { Stop-Boot 41 'KASPAD_GATE' "kaspad pid $kPid exited while waiting for ALIVE" }
    $p = Invoke-Probe
    switch ($p.Code) {
      0 { $alive = $true; $consecErr = 0 }
      7 { $consecErr = 0 }
      8 { $consecErr = 0; if (-not $stalledAlerted) { $stalledAlerted = $true; Send-BootEvent 9201 'Warning' ("kaspad sync STALLED: {0}" -f $p.Line) } }
      { $_ -in 3, 4, 5, 9 } { }
      2 { Stop-Boot 43 'KASPAD_GATE' ("wrong network on rpc port: {0}" -f $p.Line) }
      6 { Stop-Boot 44 'KASPAD_GATE' ("probe dependency broken: {0}" -f $p.Line) }
      default { $consecErr++; if ($consecErr -ge 5) { Stop-Boot 45 'KASPAD_GATE' ("probe error x5: {0}" -f $p.Line) } }
    }
    if ($alive) { break }
    $el = ((Get-Date) - $t0).TotalSeconds
    if ($el -ge $GateHardSec) { Stop-Boot 50 'KASPAD_GATE' ("not ALIVE after {0}s; last probe: {1}" -f $GateHardSec, $p.Line) }
    if ($el -ge $GateSoftSec -and -not $softAlerted) { $softAlerted = $true; Send-BootEvent 9250 'Warning' ("kaspad not ALIVE after {0}s; console NOT started; still waiting. last probe: {1}" -f $GateSoftSec, $p.Line) }
    if (((Get-Date) - $lastNote).TotalSeconds -ge 300) { $lastNote = Get-Date; Set-BootStatus 'KASPAD_WAITING' @{ kaspadPid = $kPid; lastProbe = $p.Line } }
    Start-Sleep -Seconds $ProbeEverySec
  }
  Set-BootStatus 'KASPAD_ALIVE' @{ kaspadPid = $kPid; probe = $p.Line }

  # 4. console (failures below warn; they never exit, so a healthy kaspad is never taken down with the wrapper)
  $cPid = $null
  if ($SkipConsole) { Set-BootStatus 'CONSOLE_SKIPPED' @{ reason = 'rehearsal switch' } } else { $cPid = Start-ConsolePhase }

  # 5. stay resident: dead-man watcher. Records a runtime death once per process. Never restarts anything.
  $kSeenDead = $false; $cSeenDead = $false
  while ($true) {
    Start-Sleep -Seconds 30
    if (-not $kSeenDead -and -not (Get-Process -Id $kPid -ErrorAction SilentlyContinue)) { $kSeenDead = $true; Set-BootStatus 'KASPAD_DIED_AFTER_BOOT' @{ kaspadPid = $kPid }; Send-BootEvent 9203 'Error' "kaspad pid $kPid is gone after boot; nothing restarts it automatically" }
    if ($cPid -and -not $cSeenDead -and -not (Get-Process -Id $cPid -ErrorAction SilentlyContinue)) { $cSeenDead = $true; Set-BootStatus 'CONSOLE_DIED_AFTER_BOOT' @{ consolePid = $cPid }; Send-BootEvent 9204 'Error' "console pid $cPid is gone after boot; nothing restarts it automatically" }
  }
}

try { Invoke-BootSequence } catch { Stop-Boot 99 'UNEXPECTED' $_.Exception.Message }
```

## 附录 B. 计划任务注册命令草案（**提权，J1 EXECUTE 单；KANet-UI 不执行**；4.3 才用）

```powershell
# 前置: 4.1 脚本已落码并合入生产检出; 4.2 事件源已注册; R2 已过; D-G 已有 Owner 决定
$user = "$env:COMPUTERNAME\ADMIN"
$act  = New-ScheduledTaskAction -Execute 'powershell.exe' `
          -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "D:\kanet-tn12\scripts\mainnet-boot-sequence.ps1"' `
          -WorkingDirectory 'D:\kanet-tn12'
$trg  = New-ScheduledTaskTrigger -AtStartup
$trg.Delay = 'PT2M'
$prn  = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$set  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
          -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10) `
          -MultipleInstances IgnoreNew -StartWhenAvailable `
          -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskPath '\KANet\' -TaskName 'KANet-Mainnet-Boot' -Action $act -Trigger $trg -Principal $prn -Settings $set `
  -Description 'Mainnet boot: verify kaspad, start, wait for probe ALIVE, start console. Boot-only; alerts via Application log source KANetBoot. Runbook: docs/2026-09-19-kanetui-mainnet-boot-autostart-scheduled-task-runbook-v0.1.md'
# 立即核 (只读):
Get-ScheduledTask -TaskPath '\KANet\' -TaskName KANet-Mainnet-Boot | ForEach-Object { $_.Settings | Select-Object ExecutionTimeLimit,RestartCount,RestartInterval,MultipleInstances; $_.Principal | Select-Object UserId,LogonType,RunLevel; $_.Triggers | Select-Object CimClass,Delay }
```
