# runbook：主网 kaspad + console 开机自启（Windows 计划任务）v0.2 草稿

> **Status**: CURRENT
>
> 起草 KANet-UI · 2026-09-19 · 文件名沿用 `…-v0.1.md`（账本 (1535)/(1537)/(1539) 已按此路径引用），**正文即 v0.2**，v0.1→v0.2 的差异全部列在下面"v0.2 改动"，与更早的读者记忆冲突处以本页为准。依据账本 **(1531)**（死机复盘 P2）、**(1532)**、**(1533)**、**(1539)**（NWT 红队审全采纳）、**(1542)**；NWT 红队审原文 `docs/provenance/2026-09-19-nwt-p2-p3-redteam/README.md`（`ba660ae0`，下称"NWT 红队审"）；`docs/iteration/j1-inbox/2026-09-14T10-00Z-bettor-GO-unattended-reboot-verify-with-conditions.md`（9/14 无人登录重启验证读数口径）。
>
> **执行门（页首必读；"页写好了"≠"可以执行了"）**：**只写不执行**。① 本页 → NWT 再审本页与附录 A 脚本草案（**NWT 已裁：v0.1 草案不许落码**；v0.2 需重审）→ ② 新增脚本 `scripts/mainnet-boot-sequence.ps1` 是**代码**，铁律 0：**落码须 Bettor 批** → ③ **注册门（v0.2 收紧，见 §4.3）**：D-026 开关已合入、已部署、**运行中 console 自己的启动日志出现 `[utxo-splitter] disabled` 与 `[broadcaster-utxo] disabled`**（V6，不是"Owner 有决定"）→ ④ 提权注册计划任务 = **J1 EXECUTE 单**（本机 KANet-UI 会话非提权）→ ⑤ 预演 R0–R3 逐级过（R1 等 NWT 审过脚本后）→ ⑥ 真重启验证 = **Bettor GO + 本机全部会话被切断的窗口**。任何一步未过，不进下一步。
>
> **写作依 D-021**：不写密钥值；不写任何余额、地址与持有人的对应。本页出现的路径、端口、`kaspad` 二进制 sha256（公开发布物的哈希）、进程名、relay **名字**（不含地址）都是运维坐标。
>
> **本页没有动任何东西**：v0.2 期间只做了只读——进程表、计划任务定义、性能计数器、日志目录、探针一次（`ALIVE`）、主网 DB 只读计数（`readonly`）、对 18 个 relay 地址的 outpoint 快照（节点只读 RPC）；没起没停任何进程，没注册任何任务，没往生产检出写任何文件。脚本草案的 `-SelfTest` 与 `-WatchOnly` 都在**系统临时目录**跑（`-KanetRoot` 指向临时目录），不碰 `D:\kanet-tn12\logs`。

## v0.2 改动（对照 NWT 红队审逐条；未落的写明理由）

| NWT 条目 | 处置 | 落点 |
|---|---|---|
| **P2-M1** 起/认领 kaspad 后不得有任何 `exit`（含外层 catch→99）；D-D "多 3 条事件可接受"**作废** | **采纳**。脚本分 **Phase A（什么都没起，可 exit）** 与 **Phase B（kaspad 已知，永无 exit 路径）**；原 41(起后)/43/44/45/50 改为 `Warn-Kaspad`（告警 + 记状态 + 常驻，**不起 console**）；外层 catch 只包 Phase A；Phase B 各段各自 `try/catch`；哨兵循环每轮包 `try/catch`。R2 加"子进程能否在任务实例结束后存活"；R3 加"起后注入 44 ⇒ kaspad PID 不变且脚本仍常驻" | §2.1、§2.3、附录 A、§4.4 |
| **P2-M2** 认领判据过宽 | **采纳**。kaspad：只把命令行含**主网 appdir 或 `127.0.0.1:17110`** 的 `kaspad.exe` 算主网节点，simnet 节点（同一个 exe）**忽略、不计数、不报 42**；console：**精确生产路径 ∧ 拥有 :3202 监听 ∧ 与 `console-mainnet.pid` 一致**三者同时成立才认领。`-SelfTest` 加伪造进程记录夹具（多 worktree console、simnet+主网 kaspad 并存） | 附录 A `Select-MainnetKaspad`/`Select-ConsoleCandidates`/`Test-ConsoleClaim` |
| **P2-M3** 起 console 前连续 ≥3 次 ALIVE（≥45 s） | **采纳**（`$AliveStreakNeeded=3`，间隔 15 s）。非 0 的任何一次读数都把连续计数清零。**依据**：relay 侧 `split_utxo` 路径无 isSynced 检查（NWT 已核），而近同步窗内 `isSynced` 可闪断 | §2.1 step 3、附录 A `Wait-KaspadAlive` |
| S1 脚本自身来源 | **落**：① 脚本起手先评估"生产检出在允许分支且 `start-console-mainnet.ps1`/`kaspad-rpc-probe.mjs` 与 HEAD 一致"，否则**只阻断 console、kaspad 照起**并写事件 9062；② 注册的动作**建议指向树外部署副本**（目录待 Bettor 定，例 `C:\KANetBoot\`，sha256 记入 provenance）——脚本 `-KanetRoot` 参数化，副本内仍指向生产检出读探针与启动脚本 | 附录 A `Test-TreeClean`、附录 B |
| S2 前次停机是否干净 | **落**：起 kaspad 之前读**内部日志** `rusty-kaspa.log` 尾 8 KB，末行不含 `Kaspad has stopped` ⇒ Warning 事件 9205 `previous_stop_unclean`，并把软等待阈值翻倍；日志不存在 ⇒ 同事件标 unknown | 附录 A `Get-LogTail`/`Test-CleanStopMarker`、§0 D-F |
| S3 stdout 捕获自检 | **落**（**启发式**）：哨兵每轮比对 `kaspad-stdout.log` mtime，kaspad 活着而 stdout >10 分钟未写 ⇒ Warning 9206 一次 | 附录 A |
| S4 S4U 下跨会话可管理性 | **落**：R2 增一条：S4U 任务起 `ping -t`，再从**交互式非提权**会话读其 `CommandLine`、`Stop-Process` 它 | §4.4 R2 |
| S5 PID 文件陈旧 | **落**：读到的 PID 必须是 `node.exe` ∧ 命令行含精确生产路径 ∧ `CreationDate ≥ 脚本开始−5 s`，否则按 63 告警 | 附录 A `Start-ConsolePhase` |
| S6 哨兵 PID 复用 | **落**：判死 = PID 不在 ∨ **进程启动时间变了**；"只报一次 / 哨兵不知道人手动重起"写入已知边界 | 附录 A `Test-SameProcess`、§7 |
| ② 花钱路径 | **采纳全部四点**：注册门改 V6（§4.3）；新增"console 启动后无人干预即可能发链上交易的路径"枚举表（§2.6，**已只读核，填表**）；验收 #10 改链上侧（§4.5，方法与实测见 §2.6 与附录 C）；"保险丝"仅当保留启动拆分时需要——D-026 已定默认关，**不适用**（写明） | §2.6、§4.3、§4.5、附录 C |
| ③ D-F / H1–H5 | **采纳**：D-F 规则保留但**不再当作"已解决"**——依据 n=1、且换了环境（交互式会话 → S4U）；加零风险测量（S2）；R3 用**与真实路径相同的起法**测；预期结论"只有关机通知一条干净路径"；H3 证据来源纠错（重定向 stdout 自 9/14 16:02 静默停写 5 天，"轮转件内容=重启前那份"的验收改读内部日志） | §0 D-F、§1、§4.4 R3、§4.5、§7 |
| P3 | 见 `…-console-memory-alert-design-v0.1.md`（**正文即 v0.2**）：memory-alert **改宿主**到本页的常驻哨兵，脚本增 `-WatchOnly` 模式 | 附录 A、P3 页 |

## 0. 结论与需要 Bettor 定的点

**做法**：一个计划任务 `\KANet\KANet-Mainnet-Boot`，触发器"系统启动 + 延迟 2 分钟"，**不依赖任何人登录**，动作 = 一个编排脚本，按序：树检查 → 核 kaspad 二进制 → 前次停机检查 → 轮转日志 → 起/认领 kaspad → **连续 ≥3 次探针 ALIVE** → 轮转 console 日志 → 起/认领 console → 验证 → **常驻做哨兵（死亡哨兵 + 提交内存检测，只告警不重启）**。

**Bettor 四点硬要求 → 本页落点**（v0.1 已答，v0.2 补 NWT 收紧后的形状）：

| # | 硬要求 | 落点 |
|---|---|---|
| ① | kaspad 命令行逐字 = (1321) §0；起前核 sha256 与 `--version` | 附录 A Phase A：sha256 全值 + `--version == kaspad 2.0.1` **不符即拒起**（退出码 21/22，此时什么都没起，可 exit）；四个参数逐字（`$kArgs`），认领判定已对活进程命令行校验 |
| ② | 日志按时间戳轮转，不毁证据 | 每次**起进程前**把非空 stdout/stderr 改名为 `<原名>.pre-boot-<yyyyMMdd-HHmmss><ext>`；只改名不删；改名失败（含目标已存在）⇒ 拒起（kaspad 侧：Phase A 退出码 30；console 侧：告警 31，不退出）；认领（adopt）的进程**不轮转**。⚠ **验收口径纠错见 §1**：kaspad 重定向 stdout 会静默停写，权威是内部日志 |
| ③ | console 前置门 = 探针 `ALIVE` | **连续 ≥3 次** `ALIVE`（≥45 s）才起 console；`SYNCING(7)`/`STALLED(8)`/连不上等都把连续计数清零 |
| ④ | 不依赖登录；失败不无限重试；写清次数与放弃后告警落点 | §2.2、§2.3（**v0.2：只有"什么都还没起"的失败才 exit，才会被计划任务重试**）、§2.5 |

**Bettor 裁定记录**：D-A（S4U + Limited）、D-B（分支不对不起 console、kaspad 照起、事件日志留原因——事件 9062）、D-C（90 分钟告警继续等 / 24 小时放弃——**v0.2：24 小时后放弃 = 告警 + 不起 console + 继续常驻，不 exit**）、D-E（事件日志 + 状态文件；"console 起来后灌 `events`"另批）**保持采纳**。**D-D 修订**：v0.1 写的"确定性失败多出 3 条事件可接受"**作废**——那个代价被低估了：按脚本自己承认的最坏假设，每次 exit 都是硬杀正在追块的节点，3 次重试 = 3 次额外硬杀。v0.2 的答案不是"接受"，而是**让 kaspad 起后根本没有 exit 路径**（M1）。

**仍需 Bettor 定的点**：

| # | 点 | 默认 | 备注 |
|---|---|---|---|
| D-F | 停 kaspad | 现阶段规则不变：重启前只停 console 与 relay 子进程，kaspad 交系统关机通知，不手动 `Stop-Process` | **依据是 n=1（今晚一次干净退出，1.7 s，低负载、非追块、交互式会话起的进程）**；P2 把 kaspad 挪进 S4U 会话，**关机通知能否送达那个会话未证**。零风险测量：脚本每次起 kaspad 前读内部日志尾行（S2），第一次自启后的**第二次**关机—开机就是直接读数；在那之前一律按"可能不干净"对待（不要在第一次自启后立刻做依赖干净停机的操作）。**H4 缺口**：不手动杀 ⇒ **kaspad 单独重启（换二进制、只需重启节点的运维）没有已知干净路径**，只能整机重启；R3 用真实起法测 Ctrl+C，**预期"没有干净手动停法"**，若证实就把"只有关机通知一条干净路径"写进 runbook，不再继续找 |
| 脚本部署位置（S1） | 建议树外固定目录副本 | 目录与谁来部署待定；副本 sha256 记 provenance |
| 采样阈值等 | 见 P3 页（M-1…M-5 已采纳） | — |

## 1. 现状实核（只读，2026-09-19 22:3x–23:2x 本地时间；摘要）

| 项 | 读数 |
|---|---|
| kaspad | PID 16464，命令行 `"D:\rusty-kaspa-v201\kaspad.exe" --appdir=D:\kaspa-mainnet-data-v201 --utxoindex --rpclisten-borsh=127.0.0.1:17110 --rocksdb-cache-size=2048`；sha256 前缀 `8afe6a68`（全值见附录 A，本次实算，NWT 独立重算一致）；`--version` = `kaspad 2.0.1` |
| console | PID 9024（`src/index.js`），由 `scripts/start-console-mainnet.ps1` 起 |
| 已有计划任务 | `KANet-TranslateGen2` / `KANet-TranslateProto` / `KANet-VoiceService`（AI 推理侧）：**用户 ADMIN、Interactive（必须有人登录）、无触发器、运行时限 30 天**——不能当模板 |
| 已有的自启 | kaspad、console **都没有** |
| 当前会话 | `quser` 显示 `admin` 在 console 会话（ID 1）——"不依赖登录"必须靠**重启验证**证明 |
| 权限 | 本机 KANet-UI 会话 `IsInRole(Administrator)=False` ⇒ 注册启动触发器任务要**提权**（J1 EXECUTE 单） |
| PATH | `node.exe`、`git.exe` 都在**机器级** PATH |
| PowerShell | 只有 Windows PowerShell 5.1（无 `pwsh`）⇒ 脚本按 5.1 语法写 |
| **⚠ 日志证据纠错（NWT H3，Bettor 复核成立）** | `D:\kaspa-mainnet-data-v201-logs\kaspad-stdout.pre-reboot-20260919-221852.log`（10.7 MB）的**末行时间戳是 2026-09-14 16:02:06**，而该 kaspad 进程 9/13 21:12 起、跑到 9/19 21:12 才停——**重定向的 stdout 在中途静默停写了整整 5 天，成因未明**（NWT 排除了"启动器进程死则管道断"）。v0.1 把这份轮转件当作"重启前那份"是错的。**权威是 kaspad 自己的内部日志** `D:\kaspa-mainnet-data-v201\kaspa-mainnet\logs\rusty-kaspa.log`（84 MB，未轮转；今晚的关机序列 `21:12:19 P2P Server stopped … 21:12:21 Kaspad has stopped...` 就是从这里读到的） |
| 提交内存 | 22:3x 读 44–47%；**23:20 读 74.9%（已用 67.1 / 上限 89.6 GB）**——`llama-server` 16.6 GB、两个 `python.exe`（8.8 + 7.7 GB）、`vmmemWSL` 6.0 GB、kaspad 3.3 GB；(1531) 点名的进程又回来了，P1 风险仍在（不在本线范围，已只读报 Bettor） |

## 2. 设计

### 2.1 流程与退出码（v0.2：Phase A / Phase B）

```
开机 +2 min ──▶ [计划任务 \KANet\KANet-Mainnet-Boot] ──▶ mainnet-boot-sequence.ps1

PHASE A —— 什么都还没起。exit 合法；外层 try/catch 只包这一段（catch ⇒ 99）
  0  单实例文件锁 boot.lock（拿不到 ⇒ 退出 10，仅写 boot-history.log，无事件）
  1  树检查（S1）：分支 == bshard-m3-deploy ∧ start-console-mainnet.ps1 / kaspad-rpc-probe.mjs 与 HEAD 一致；
        否则 ⇒ 事件 9062，**只阻断 console，kaspad 照起**
  2  核 kaspad 二进制：文件在？sha256 == 钉住值？--version == "kaspad 2.0.1"？        ⇒ 20 / 21 / 22
  3  主网 kaspad 进程 = 命令行含 --appdir=<主网appdir> 或 --rpclisten-borsh=127.0.0.1:17110 的 kaspad.exe（simnet 节点忽略）
        多于 1 个 ⇒ 41；恰 1 个且命令行逐 token 相同 ⇒ **认领**；恰 1 个但命令行不同 ⇒ 42（绝不碰它）
        没有 ⇒ 读内部日志尾（S2：末行非 "Kaspad has stopped" ⇒ 事件 9205，软阈值×2）→ 轮转 kaspad 日志（失败 ⇒ 30）
              → 起 → 写 kaspad.pid（起不来 ⇒ 40）
  ── 至此 kaspad 已起或已认领 ──

PHASE B —— 永无 exit 路径。每段自己 try/catch；失败 = 告警 + 继续
  4  门：每 15 s 跑探针（环境变量只给子进程），**连续 ≥3 次 ALIVE** 才过
        0 ⇒ 计数+1 │ 7/8/3/4/5/9/其它 ⇒ 计数清零（8：事件 9201 一次；其它连续 5 次 ⇒ 告警 45）
        2 错网 ⇒ 告警 43 │ 6 探针依赖坏 ⇒ 告警 44 │ kaspad 进程没了 ⇒ 告警 46 │ 24 h 仍未稳定 ALIVE ⇒ 告警 50
        以上告警 = 记状态 + Warning 事件 + **不起 console，kaspad 与哨兵继续活**
        软阈值 90 min（前次停机不干净则 180 min）未过 ⇒ 事件 9250 一次，继续等
  5  console（失败只告警，不退出）
        树检查未过 ⇒ 告警 62、不起
        console 进程 = 命令行含**精确生产路径**的 node.exe：多于 1 个 ⇒ 告警 61；恰 1 个 ⇒ 须 **拥有 :3202 ∧ 与 console-mainnet.pid 一致** 才认领，否则告警 61、不起第二个
        没有 ⇒ 轮转 console 日志（失败 ⇒ 告警 31）→ 调 start-console-mainnet.ps1（退出码≠0 ⇒ 告警 63）
              → 读 console-mainnet.pid，须是 **新起的 node.exe 且命令行含生产路径**（S5）
        验证：进程活 + :3202 在听 + GET /api/system/rpc-overview 应答，最长 300 s ⇒ BOOT_OK（事件 9101）；否则告警 64，**不杀不重起**
  6  常驻哨兵，每 30 s，各项独立 try/catch：
        · kaspad / console 判死 = PID 不在 ∨ 启动时间变了（S6）⇒ 记状态 + Error 事件 9203 / 9204，一次，不重起
        · S3：kaspad 活着而 stdout >10 min 未写 ⇒ 事件 9206 一次（启发式）
        · **提交内存检测（P3 v0.2）**：≥85% 判定 + 文件日志（第一落点）+ 事件日志，见 P3 页
```

**为什么 Phase B 永无 exit**：Task Scheduler 对"动作进程退出后它 `Start-Process` 起的子进程会不会被一并结束"**我没有实测**（R2 测）；按最坏情形设计——只要脚本退出，刚起的 kaspad 可能被一并带走；配合计划任务的失败重启，就成了"每 10 分钟在 kaspad 追块窗口里硬杀一次"（NWT P2-M1）。所以：kaspad 一旦起了/认领了，脚本**只常驻不退出**。**代价**：任务永远显示"正在运行"，在任务计划程序里"结束"它 = 硬杀 kaspad + console。**若 R2 证明子进程能在任务实例结束后存活**，常驻包装不再承重，这条约束可放宽（NWT 建议的 WMI `Win32_Process.Create` 起法也可一并评估）。

**为什么不做运行期自动重启**：(a) console 共享 RpcClient 在 kaspad 重启后**不自愈**；(b) console 重启有花钱面（见 §2.6）。两条都需要人判断。**本任务只保证"开机拉起来"**。

### 2.2 任务定义

| 项 | 值 | 理由 |
|---|---|---|
| 名字 | `\KANet\KANet-Mainnet-Boot` | 与 AI 推理侧 `KANet-*` 分开放 |
| 触发器 | **系统启动**，延迟 `PT2M` | 不等登录 |
| 主体 | 用户 `ADMIN`，`LogonType=S4U`，`RunLevel=Limited` | D-A 已采纳；**S4U 跨会话可管理性未证，R2 测（S4）** |
| 动作 | `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<脚本路径>"`，起始目录 `D:\kanet-tn12` | **脚本路径建议指向树外部署副本**（S1）；`-ExecutionPolicy Bypass` 仅对这一次调用生效 |
| **运行时限** | **`0`（无限）** | 🔴 默认 72 小时强杀；常驻任务不设 = 开机 3 天后连 kaspad 一起杀 |
| 多实例策略 | `IgnoreNew` | 与脚本文件锁双保险 |
| 失败重启 | 3 次，间隔 10 分钟 | **v0.2：只会因 Phase A 的"什么都没起"失败触发**，见 2.3 |
| 不设 | "仅在网络可用时运行" | 开机早期不稳定；脚本自己等 |

### 2.3 重试与放弃（v0.2 收紧）

- **谁重试**：计划任务"失败后重启"，**只对脚本以非 0 退出**的情形——现在只有 Phase A：10 / 20 / 21 / 22 / 30 / 40 / 41(进程数>1) / 42 / 99。这些发生时**什么都还没起**，重试无副作用（确定性失败多几次重复而已，多几条 Error 事件，**不再有额外硬杀**）。
- **次数与间隔**：最多 3 次、间隔 10 分钟。**放弃后**任务停在"失败"，最后一条 Error 事件即放弃告警。
- **Phase B 的一切失败**（含探针/console/哨兵异常）**不触发计划任务重试**，只告警 + 常驻。
- **R2 要实测的假设**：非 0 退出码是否触发重启、是否精确 3 次后停。

### 2.4 探针环境变量（探针默认是 TN12 的）

`scripts/kaspad-rpc-probe.mjs` 默认连 `ws://127.0.0.1:17210`、期望 `testnet-12`、状态文件写 `D:/kaspa-tn12-data/…`。对主网必须设三个环境变量（脚本只给探针子进程设、`finally` 清掉，避免 console 继承——NWT 已核对）：`KASPAD_PROBE_URL=ws://127.0.0.1:17110`、`KASPAD_PROBE_NETWORK=mainnet`（**实测**：对活节点回 `ALIVE:network=mainnet daa=…`，退出码 0）、`KASPAD_PROBE_STATE=<可写路径>`（不设则写到已退役的 TN12 目录，写失败被静默吞掉 ⇒ 卡死判定永不触发）。探针未改动；退出码语义照其头注释（NWT 已逐分支核）。

### 2.5 告警落点（"放弃后告警落在哪"）

console 没起来时 `events` 表写不了，所以三处都**不依赖 console**：

| 落点 | 内容 | 读法 |
|---|---|---|
| Windows 事件日志 · Application · 源 `KANetBoot` | 9100 开始 / 9101 正常；**9000+退出码**（Phase A 失败 Error；Phase B 的 43/44/45/46/50/97/98 是 Warning）；console 告警 9031/9061/9062/9063/9064；9201 kaspad 卡同步；9205 前次停机不干净/未知；9206 stdout 停写；9250 90 分钟未稳定；9203/9204 运行期死亡；**内存 9301–9305、9310–9313（见 P3 页）** | `Get-WinEvent -FilterHashtable @{LogName='Application';ProviderName='KANetBoot'} -MaxEvents 30`。**源要先由提权会话注册一次**（§4.2）；**没注册时脚本只写文件日志，不报错**（`-WatchOnly` 在普通用户会话里就是这种情形，已实测：事件写失败被记进 `boot-history.log`，文件日志照常） |
| `logs\mainnet\boot\boot-status.json` | 最新阶段 + 时间 + 细节 | `Get-Content` |
| `logs\mainnet\boot\boot-history.log`、`memory-watch.log` | 阶段序列；内存采样与状态跳变（**第一落点，先于事件日志**） | 追加文本 |

不含密钥、余额、地址。不通知 Owner 手机（D-E）。

### 2.6 "console 启动后无人干预即可能发链上交易的路径"枚举表（NWT ②-2；只读核，2026-09-19 23:xx）

**证据来源**：① 主网 console **当前进程的启动日志**（`logs\mainnet\console-mainnet-stdout.log`：每个 cron 的 `started` / `disabled` / `NOT started` 行）；② 主网库**只读**计数（`better-sqlite3 readonly`）；③ 代码坐标；④ `kanet.mainnet.env` **只核键是否存在与布尔值，不读任何密钥**。**判定口径**：花不花钱取决于**库里的数据**的路径，标"数据依赖"——它们"今天为零"由**表为空**保证，不由代码或开关保证；"明天为零"没有保证。

| # | 路径 | 触发条件 | 主网现状（证据） | 会在无人干预时发链上交易吗 |
|---|---|---|---|---|
| 1 | **启动期 `autoSplitAll()`**（`index.js:870-871`） | 每次 console 启动，对全部有钥、非 proto、非 UNREADABLE 的 relay 发 `split_utxo targetCount=8`（relay 日志里的 `UTXO SPLIT: skipped/…` 是同一 IPC 的回包，**不是第二条路径**，`relay.mjs:591-595`） | 22:21:34 **实发 4 笔**（KANet-UI 5 出 / Trader-A 7 出 / Trader-M 3 出 / Bettor 2 出，`kaspa_tx_log` 有这 4 行）；其余 14 个 skipped | **是（每次启动）**。D-026 已定默认关：实现 `9c86a049` 已推、待 NWT 审/合入，**上线随下一次 console 重启，V6 才是证据** |
| 2 | **`broadcaster-utxo` cron**（`index.js:814-815`） | 启动 90 s 后首 tick、之后每 180 s，对 `is_oracle=1` ∪ `POOL_SEEDER_MAKER_RELAY` ∪ `BROADCASTER_RELAY_IDS` 发 `split_utxo target=30 force:true` | `is_oracle=1 且有地址` = **0 行**；`POOL_SEEDER_MAKER_RELAY`、`BROADCASTER_RELAY_IDS` 在 `kanet.mainnet.env` 里**键不存在**；日志只有 `started` 无 `rebalanced` | **数据依赖**：任何流程把某 relay 置 `is_oracle=1`，下一个 tick 起每 3 分钟强制重平衡。D-026 M1 加 `BROADCASTER_UTXO_MAINTAIN` 默认关（同一分支 `9c86a049`） |
| 3 | `bettor-refund-claim-auto`（`index.js:734`） | 每 5 分钟，为**已取消市场**上未领取的 `pool_bettor_sides` 发 `pool_side_refund_cancelled_tx` | 日志 `[claim-auto] started`；`pool_bettor_sides` **0 行** | **数据依赖**（表空 ⇒ 今天为零） |
| 4 | `house-agent`（`index.js:748-749`；`DEMO_HOUSE_OFF` 未设） | 每 5 分钟，对 `pool_markets` 里的世界杯盘、用名为 `HouseAgent` 的 relay 真押 20 KAS（经 console 自己的 `/api/pool/...` HTTP） | 日志 `started`；主网 18 个 relay **没有名叫 `HouseAgent` 的**；`pool_markets` **0 行** | **数据依赖**：需要"存在 HouseAgent relay ∧ 存在世界杯盘"两个条件同时成立 |
| 5 | 预言机/池子族：`prediction-settler`、`prediction-voter`、`pool-settler`、`oracle-renewal`（**含自动续期转账**）、`oracle-pool-scanner-cron`、`oracle-voter-health` | 各自 1–60 分钟 tick，处理 offers/pool/oracle 登记行 | 日志均 `started`；`exchange_offers`、`pool_markets`、`oracle_registry`、`oracle_stake_enrollments`、`oracle_pool_membership` 等**全部 0 行**，`is_oracle=1` 0 行 | **数据依赖**（表空）。`oracle-renewal` 一旦有到期登记就会自动转账 |
| 6 | market seeder（`market-seeder.js`）+ deposit watcher + **refund worker**（发 USDT 退款） | 5 min / 30 s tick | 日志 `Market seeder started`；`market_seeder_config.enabled = 0`（tick 里 `if (!config?.enabled) continue`）；`retail_dex_buy_publications` **0 行**（refund worker 无对象） | 今天为零（**开关关 ∧ 表空**双保险）；refund 是 EVM 链 USDT，不是 KAS |
| 7 | 结算守护/ZK 族：`settle-daemon` 及 4 个 ZK tick、`zk-prove-worker`、`bshard-close-voter`/`-v2`、`bshard-close-submit-v2` | env 开关 | 日志逐行 `disabled (…!=1)` / `NOT started`；`[proto-driver] disabled` | **否（开关关，日志阳性证据）** |
| 8 | `mining-consolidate`、`faucet-health`、`bot-autofund` | env 开关 / relay id 配置 | `MINING_CONSOLIDATE_ENABLED=false — cron not started`；后两者 `… not set — cron not started` | **否** |
| 9 | broker（含 5 分钟补零钱拆分）、tg-bot | `BROKER_ENABLED=1` / bot token | `[broker] disabled`；`BROKER_ENABLED` 键不存在；`[tg-bot-manager] TELEGRAM_BOT_TOKEN not set … not auto-started`；`[broker-utxo-split]` 0 行 | **否** |
| 10 | **入口触发型**（收到链上消息后：自动付 / 自动交割 / autoTaker / market-seeder 响应 / 预测 agent 下注） | 由外部事件驱动，不是定时 | **只核了数据面与开关，没有逐个读 handler 代码**：`adapter-launcher 0/0 adapters started`、`agent_connections` **0 行**、`trading_config_json` 非空的 relay **0 个**（无 Mind 大脑可下决定）；`mm_orders` 0、`exchange_offers` 0、`pending_actions` 0；`PREDICTION_AGENT_ENABLED=0`、`AUTO_BET_TICK_MS=0`；`bettor_real_config.enabled=0`、`bettor_real_positions` 0 | **标"未核到代码级"**：数据面上没有可被触发的对象；但**不能据此断言"任何入站消息都不会触发花费"**。这一行的完整结论需要有人逐个读 ingest 触发路径 |
| 11 | relay 自身的自主行为（relay-health 自动重启 relay ≤3 次/小时、`relay-hotwallet-monitor` 超额时杀 relay 进程） | 定时监控 | 日志 `started` | 不花钱（重启/杀进程），列出仅为完整 |

**读表结论（Owner 口径，照 NWT）**：D-026 合入并上线后，主网 console 启动后无人干预的链上花费 = **"今天为零，由两个默认关的开关（#1、#2）+ 若干张空表（#3、#4、#5、#6）+ 关着的开关（#7、#8、#9）保证"**；#10 是**未核到代码级**的一行。**不是**"启动期不再花钱"。表里的"数据依赖"行随库数据变化，**每次上线/自启验收都要重跑 §4.5 的链上侧比对**。

**关于"保险丝"（NWT ②-4）**：仅当 Owner 决定**保留**启动拆分时需要（拆分不收敛，5→4→5 来回摆，每次重启都烧）。D-026 已定默认关 ⇒ **不适用，不做**；若将来 Owner 打开 `UTXO_AUTOSPLIT_ON_START=1`，须先补"距上次拆分 <N 小时则跳过"的持久化间隔与单次启动费用上限（另开票）。

## 3. 前置检查（只读；任何时候都能跑）

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 3.1 | 生产检出分支 | `git -C D:\kanet-tn12 branch --show-current` | `bshard-m3-deploy` |
| 3.2 | 主网 kaspad 进程恰 1 个且命令行逐字（simnet 节点不计） | `Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'" \| Select ProcessId, CommandLine` | 命令行含主网 appdir 的恰 1 行 = 附录 A `$kArgs` 四个参数 |
| 3.3 | kaspad 二进制哈希与版本 | `(Get-FileHash D:\rusty-kaspa-v201\kaspad.exe -Algorithm SHA256).Hash` 与 `& D:\rusty-kaspa-v201\kaspad.exe --version` | 与附录 A 常量逐位相同；`kaspad 2.0.1` |
| 3.4 | 脚本"认领"判定对活进程成立 | 已跑：把脚本的判定函数对活 kaspad 命令行核（**抓到并修了"单个结果被展开成标量、`.Count` 为空、会去起第二个 kaspad"的真 bug**——调用处必须 `@(...)`）；v0.2 又加了 simnet/worktree 伪造记录夹具 | `True`；夹具全 PASS |
| 3.5 | 主网探针 | `$env:KASPAD_PROBE_URL='ws://127.0.0.1:17110'; $env:KASPAD_PROBE_NETWORK='mainnet'; $env:KASPAD_PROBE_STATE='<可写路径>'; node scripts\kaspad-rpc-probe.mjs; $LASTEXITCODE` | `ALIVE:network=mainnet …`、`0`（只读，一次连接） |
| 3.6 | 现有任务里没有同名任务 | `Get-ScheduledTask -TaskName KANet-Mainnet-Boot -ErrorAction SilentlyContinue` | 无输出 |
| 3.7 | 机器当前状态（记基线） | kaspad PID + `CreationDate` 完整值；console PID（命令行含**精确生产路径**）+ `CreationDate` | 记下；预演后核未变 |
| 3.8 | 前次停机是否干净（内部日志） | `Get-Content D:\kaspa-mainnet-data-v201\kaspa-mainnet\logs\rusty-kaspa.log -Tail 3` | 末行含 `Kaspad has stopped`（今晚重启前那次是；**当前运行期间的日志末行当然是运行中的行**——此项只在 kaspad 已停时有意义） |

## 4. 执行步骤（每步四段：前置 → 动作 → 验收读数 → 中止/回滚）

### 4.1 落码：`scripts/mainnet-boot-sequence.ps1`

**门**：NWT 再审本页（含附录 A）→ Bettor 批（铁律 0）。
**前置**：在 `scratch\_kanetui_wt_<name>` 独立 worktree 里做，**不动生产检出**；不 junction 活 node_modules（本脚本不需要 node_modules）。
**动作**：把附录 A 原样落为该文件（**仅 ASCII**）；`node scripts\lint-kanet.mjs scripts/mainnet-boot-sequence.ps1`；若采纳 S1，另出一份树外部署副本并记 sha256。
**验收读数**：① `[System.Management.Automation.Language.Parser]::ParseFile` 无错误；② `powershell.exe -NoProfile -File scripts\mainnet-boot-sequence.ps1 -SelfTest` ⇒ 全 `PASS`、`SELFTEST failures=0`、退出码 0（**v0.2 草案已跑：47 项全 PASS——含伪造进程夹具、15 条状态机向量 + 12 条变异（各针对一个转移方向）、采样失败路径、2026-09-19 23:20 真实读数向量**；`-SelfTest` 只跑辅助函数与向量，用临时目录，**不起任何进程、不碰生产路径**）；③ **NWT 指出 `-SelfTest` 覆盖不到 Phase B 的"起后失败不 exit"这一层——"PASS 的条数"不是证据**，该层只能由 R3 的注入向量证明。
**中止/回滚**：任一失败 ⇒ 不合入。回滚 = 不合入/`git revert`，无运行时效果。

### 4.2 一次性：注册事件源（提权，J1 EXECUTE）

**门**：4.1 已合入。**前置**：`[System.Diagnostics.EventLog]::SourceExists('KANetBoot')` 为 `False`。**动作**（提权）：`New-EventLog -LogName Application -Source KANetBoot`。**验收读数**：`SourceExists` ⇒ `True`；写一条测试事件（id 9199）并 `Get-WinEvent` 读回。**回滚**：`Remove-EventLog -Source KANetBoot`。

### 4.3 注册计划任务（提权，J1 EXECUTE）

**门（v0.2 收紧，NWT ②-1 / P2-M3）**：
1. 4.2 通过；**预演 R2 通过**；
2. **D-026 开关已合入主线、已部署，并且运行中的主网 console 自己的 stdout 出现**：`[utxo-splitter] disabled (UTXO_AUTOSPLIT_ON_START!=1, raw=undefined)` 恰 1 行、`[utxo-splitter] … → … UTXOs` 0 行、`accounts split` 0 行、`[broadcaster-utxo] disabled (BROADCASTER_UTXO_MAINTAIN!=1, raw=undefined)` 恰 1 行、无 `[broadcaster-utxo] … rebalanced`。**这是 V6，是权威；静态 grep env 文件（V5）只是辅助**——因为 console 子进程继承启动者 shell 的环境，`start-console-mainnet.ps1` 只往进程环境里加值、不清除继承变量；
3. Bettor 出 EXECUTE 单。
> 原门"D-G 已有 Owner 决定"**作废**：那句话无法区分"决定不加开关"与"开关还没做"，第一次无人值守开机就会烧。

**前置**：3.6 ⇒ 无同名任务；3.1 ⇒ 分支正确；脚本已落在生产检出（或树外副本）且哈希记录在案。
**动作**：附录 B 的注册命令（提权）。**注册后立刻**：`Get-ScheduledTask … | Select -Expand Triggers/Settings` 逐项对 §2.2 表。
**验收读数**：`ExecutionTimeLimit`=`PT0S`；`RestartCount`=3、`RestartInterval`=`PT10M`；`MultipleInstancesPolicy`=`IgnoreNew`；触发器 Boot、`Delay`=`PT2M`；主体 `S4U` + `Limited`。**注册本身不运行任务、不影响正在跑的 kaspad 与 console。**
**回滚**：见 §6。

### 4.4 预演（在真重启之前，逐级）

| 级 | 做什么 | 验收 | 风险 |
|---|---|---|---|
| **R0** | 语法解析 + `-SelfTest`（4.1 已含）；另可在**普通用户会话**跑 `-WatchOnly`（**只做内存检测、不起任何进程**）：先用**临时 `-KanetRoot`** 与调低的阈值验证告警路径（v0.2 草案已这样跑过：写出 `STATE enter-warn`、第二个实例被文件锁拒绝退出码 10、未起任何进程），再以真实阈值挂在生产上 | 见 P3 页验收 | `-WatchOnly` 在生产上跑会往 `logs\mainnet\boot\` 写日志与锁文件——**需 Bettor 明说** |
| **R1** | **认领演练（幂等）**：在 kaspad 与 console 都在跑的现状下，手动运行一次脚本（不带参数）。预期：`KASPAD_ADOPTED` → 连续 3 次 ALIVE → `CONSOLE_ADOPTED` → `BOOT_OK`，然后常驻；**不起任何进程、不轮转任何日志**。验完结束该脚本进程 | 进程表 kaspad/console 的 PID 与 `CreationDate` **不变**；没有新增 `*.pre-boot-*`；`boot-status.json` 阶段序列如上。**注意（NWT M2）**：若此刻有 simnet 验证节点或隔离 console 在跑，v0.2 的判据**应当**不受影响——这也是 R1 要顺带验证的一条 | **需 Bettor 明说，且必须在 NWT 审过脚本草案之后** |
| **R2** | **计划任务语义实测（无害动作）**，由 J1 注册一个一次性演练任务 `\KANet\KANet-Boot-Rehearsal`，主体与 §2.2 相同（S4U、Limited）、触发器"手动"：<br>**a) 子进程存活性（NWT M1）**：脚本用 `Start-Process` 起 `ping.exe -t 127.0.0.1` 后**退出码 7 退出**——测：任务实例结束后子进程是否还活着；非 0 退出是否触发"失败重启"、重启几次后停。**并测 NWT 建议的另一种起法**（WMI `Win32_Process.Create`）下子进程是否不随任务实例结束<br>**b) 常驻变体**：`Start-Sleep` 常驻——测 S4U 令牌下 `node -v`、`git --version`、读非敏感本地文件、写 `logs\mainnet\boot\` 下文件都成功（D-A 实证）<br>**c) 跨会话可管理性（NWT S4）**：任务起的 `ping -t`，从**交互式非提权会话**读其 `CommandLine`、`Stop-Process` 它 | 记录 a) 子进程存活与否（决定 §2.1"Phase B 永无 exit"是必需还是可放宽）、重启次数 = 3；b) 全部成功；**c) 读得到命令行且停得掉；若不成立 ⇒ 回报 Bettor 换 D-A 备选，不硬上**。演练完 `Unregister-ScheduledTask` | 只起 `ping`，不碰主网进程 |
| **R3** | **起动路径演练（隔离，不碰主网）**：用脚本参数覆盖对一个 **simnet kaspad + 全新临时数据目录**（`scratch\`，端口避开 J2 的 simnet 与主网 17110，先确认没人占用）跑"起→轮转→门→ALIVE"。**必须用与真实路径相同的起法**（S4U 任务 → `Start-Process -WindowStyle Hidden` → 重定向）。向量：<br>① `KASPAD_STARTED` → 连续 3 次 `ALIVE` → `KASPAD_ALIVE`；再跑一遍 ⇒ `KASPAD_ADOPTED`，且首遍日志被轮转成 `pre-boot-<ts>`；<br>② 故意把 `-KaspadSha256` 改错一位 ⇒ 退出码 21、**没有起进程**；<br>③ **（NWT M1 新增）起后注入 44**——把探针依赖路径改坏（探针 `require` 失败 ⇒ 探针退出码 6）⇒ **kaspad PID 不变、脚本仍在常驻、`boot-status.json` 有 Warning、事件 9044（若源已注册）**；<br>④ **Ctrl+C / 关机通知（NWT H1/H4）**：测"`GenerateConsoleCtrlEvent` 能否送达该真实起法的隐藏进程"（预期：`-WindowStyle Hidden` 有隐藏控制台可能可达，`CREATE_NO_WINDOW` 无控制台不可达）；**这测的是 Ctrl+C，不是系统关机通知，两条路径不同、不能互相代替**；<br>⑤ 前次停机检查：起前读内部日志尾，构造"末行非 `Kaspad has stopped`"的夹具 ⇒ 事件 9205、软阈值×2 | 逐向量记录；**探针对 simnet 的 `network` 字符串未验证**——先读，不符则只测起/轮转/认领，不测门 | 起一个 simnet kaspad（临时目录），事后结束并清目录 |

### 4.5 真重启验证（需要 Bettor GO；本机全部会话会被切断）

**门**：4.3 已注册 + R0–R3 全过 + Bettor GO + Owner 知悉（同 9/14 先例）。
**前置**：NO-TX 检查（console stdout 近 2 分钟无 `broadcast`/`submitTransaction`/`send_tx`）→ 停 console（PID 文件）→ 清 `relay.mjs` 遗留子进程 → **不手动停 kaspad**（D-F：交给系统关机通知）→ 记 t0 快照（附录 C `snap`，**在 console 停之前、系统稳定时**）→ `shutdown /r /t 10`。**先停 console 与 relay 子进程，再关机**（(1531) P4）。
**动作**：`shutdown /r /t 10`。此后没有人登录；由 J1 经 SSH 读数。
**验收读数**：

| # | 读数 | 期望 |
|---|---|---|
| 1 | `quser` | **空**（无人登录——这才证明"不依赖登录"） |
| 2 | 事件日志 `KANetBoot` | 9100 → … → 9101，**没有 9000+ 的 Error**；若有 9205 记下（"前次停机不干净"，**这正是 D-F 的直接读数**） |
| 3 | `boot-status.json` / `boot-history.log` | `phase=BOOT_OK`，阶段序列合理 |
| 4 | kaspad | 新 PID、恰 1 个主网 kaspad、命令行逐字；`17110` 恰 1 个 Listen；探针 `ALIVE:network=mainnet` |
| 5 | **日志证据（v0.2 改，NWT H3）** | ① kaspad **内部日志** `rusty-kaspa.log` 上一段以 `Kaspad has stopped` 收尾（= 关机通知送达 S4U 会话的直接证据）；② 出现 `kaspad-stdout.pre-boot-<ts>.log` 与 `console-mainnet-stdout.pre-boot-<ts>.log`，**但不以"内容 = 重启前那份"作为验收**（重定向 stdout 可能早已停写）；新 `*.log` 从头开始；③ 记 `kaspad-stdout.log` 在开机 30 分钟内是否持续增长（S3 的实测样本） |
| 6 | console | 新 PID、恰 1 个（命令行含精确生产路径）；`127.0.0.1:3202` 恰 1 个 Listen；stdout `[silverc-pin] PASS` 恰 1 行、`WARMUP FAIL` 0 行 |
| 7 | `GET /api/system/rpc-overview` | `total=18 connected=18` |
| 8 | 四条敏感路由 | 均 503 |
| 9 | 时间 | 关机 → `BOOT_OK` 的总时长 |
| **10（v0.2 改：链上侧，不是日志侧）** | 开机后 **30 分钟内**，对 18 个 relay 地址做**出站交易比对**：附录 C 的 `snap`（t0，在 console 稳定后立刻）与 `diff`（t0+30 min）+ 附录 C 的 `kaspa_tx_log` 窗口列表；**与 §2.6 枚举表的"预期集"逐笔比对**。D-026 已上线时预期集 = **空**；**多出任何一笔 = 验收失败**，逐笔解释后回报 | `diff` 输出 `spent_outpoints=0 new_outpoints=0`；`kaspa_tx_log` 窗口内无 `external_outs=0` 的自转行；**不可读（UNREADABLE）的 relay 单列，不算"无变化"** |
| 11 | 内存哨兵在岗 | `memory-watch.log` 有 `started in boot sentinel` 行与周期 `SAMPLE` 行 |

**中止/回滚**：
- `quser` 非空、或事件日志无 9100 ⇒ 任务没在无人登录时跑起来：停在这里，等 Owner 登录后按 §6 手动拉起（同 9/14 T4），任务改 D-A 备选。
- 有 Error 事件 ⇒ 按 §5 处置；**不要手动重复起 kaspad**（先看 `boot-status.json` 与 kaspad 内部日志）。
- 手动拉起 = 9/14 GO §2 的 kaspad 原命令 + `scripts\start-console-mainnet.ps1`（本 runbook 上线前的现行做法）。

## 5. 失败时读什么（速查表）

| 事件 ID / 退出码 | 含义 | 先读 | 处置 |
|---|---|---|---|
| 退出码 10（**无事件**，只写 `boot-history.log`） | 拿不到 `boot.lock` | `boot-history.log`；`Get-Process powershell` | 通常是手动跑过（如 R1）没关；确认后结束旧实例 |
| 9020 / 9021 / 9022 | kaspad 二进制不存在 / sha256 不符 / `--version` 不符（Phase A，什么都没起） | 状态文件 message | **不要改钉住值去"让它过"**：先问是谁换了二进制 |
| 9030 / 9031 | 日志改名失败（kaspad，Phase A / console，Phase B 告警） | message | 不覆盖证据：手动改名后重试 |
| 9040 / 9041 / 9042 | kaspad 起不来 / 主网 kaspad 进程数>1 / 主网 kaspad 命令行不同（Phase A） | `kaspad-stderr.log`、进程表 | 42：有人手动起了参数不同的**主网** kaspad——脚本不碰它，由 Bettor 定 |
| 9043 / 9044 / 9045 / 9046 / 9050 | **Phase B Warning**：17110 上不是主网 / 探针依赖坏 / 探针连续 5 次异常 / 等待中 kaspad 消失 / 24 h 未稳定 ALIVE | 状态文件 lastProbe | **kaspad 未被动，console 未起**，脚本仍常驻；由人判断 |
| 9201 / 9250 | kaspad 卡同步 / 90 分钟（或 180）未稳定 | kaspad **内部日志**尾部 | 只告警；脚本继续等到 24 小时 |
| 9205 | 前次停机不干净或未知（内部日志末行非 `Kaspad has stopped`） | 状态文件 message（含末行前 120 字符） | 预期 RocksDB 恢复更久；这是 D-F 的直接测量，记账 |
| 9206 | kaspad 活着而 `kaspad-stdout.log` >10 分钟未写 | 内部日志 | **启发式**；内部日志才是权威 |
| 9061 / 9062 / 9063 / 9064 / 9097 | console：进程数>1 或认领不成立 / 树检查不过（含分支不对，message 含实际与期望分支）/ 起动脚本失败或 PID 陈旧 / 300 s 内不健康 / 段内意外异常 | `console-mainnet-stderr.log`；`git branch --show-current` | kaspad 已起且活着；console 由人手动起，不要重复触发本任务 |
| 9203 / 9204 | 运行期 kaspad / console 消失（PID 不在或启动时间变了） | 事件日志前后文、系统事件日志（内存耗尽 2004？） | **nothing restarts it automatically**：kaspad 重启后 console 必须一起重启；先 quiesce 再重启 |
| 9098 / 9099 | Phase B 段内意外异常 / Phase A 未预期异常 | 状态文件 message | 报 Bettor |
| 9301–9305、9310–9313 | 内存检测（见 P3 页） | `memory-watch.log` | 见 P3 页 |

## 6. 回滚与待议项

**回滚**（最坏情形也只影响"开机自启"这一件新东西）：
1. 禁用：`Disable-ScheduledTask -TaskPath '\KANet\' -TaskName KANet-Mainnet-Boot`（提权）——下次开机不再触发。
2. 若任务正在"运行"（常驻）而要撤：**不要在任务计划程序里"结束"它**（= `TerminateProcess` 杀掉全部子进程，含 kaspad，非干净退出）。先按 §4.5 前置停 console 与 relay 子进程，让 kaspad 随**系统关机通知**干净退出（即重启机器）；`Disable`/`Unregister` 会不会顺带结束运行中的实例**未实测**（R2 一并测），测清之前不要指望它"温和"。
3. 注销：`Unregister-ScheduledTask -TaskPath '\KANet\' -TaskName KANet-Mainnet-Boot -Confirm:$false`（提权）。事件源与 `logs\mainnet\boot\` 可留。
4. 手动起法 = 9/14 GO §2。

**待议项（不在本页范围）**：
- **运行期崩溃**没有任何自动处置；本任务只覆盖开机。`scripts\kaspad-watchdog.ps1` 是 TN12 链，不可复用。
- console 起来后把 `boot-status.json` 灌进 `events` 表 = 改 console 代码，另批（D-E）。
- **kaspad 单独重启没有已知干净路径**（H4）；R3 ④ 只测 Ctrl+C；预期结论"只有关机通知一条干净路径"。
- **目录改名 `D:\kanet-tn12 → D:\kanet`**：脚本、`start-console-mainnet.ps1`、计划任务动作里的路径全是硬编码，**改名与本任务必须同窗同步**。
- **kaspad 升级**：钉住值（sha256 + 版本串）要跟着换，走 Bettor。
- **休眠/快速启动**：`shutdown /s` 后上电（快速启动）与 `shutdown /r` 是否都触发"系统启动"触发器，未证明；4.5 用 `/r`，冷启动（今晚这种硬复位后上电）建议再补一次。
- **T-SPLIT-UTXOS-API-AUTHZ**（NWT 顺带发现）：`POST /api/relay/:id/split-utxos` 无鉴权，任何本机进程可触发烧费重平衡——与 §2.6 无关（不是无人值守路径），已另开票。

## 7. 已知未证明面（诚实口径）

1. **S4U 主体在本机 console/kaspad 上是否无碍**：推理上无碍，**未实测**——R2。
2. **任务实例结束后子进程是否存活**：未实测——R2（当前设计按"会被杀"的最坏情形做）。
3. **非 0 退出码是否触发"失败重启"、次数是否精确为 3**：未实测——R2。
4. **S4U 起的进程能否被交互式非提权会话读命令行/停掉**：未证——R2 c)。
5. **系统关机通知能否送达 S4U 会话里的隐藏控制台进程（H1）**：**未证，且无法在不真关机的情况下证明**；R3 ④ 测的是 Ctrl+C，不是它；直接读数来自第一次自启后第二次关机—开机时的 9205/内部日志。
6. **追块中关机的落盘时间（H5）**：未知；今晚 1.7 s 是低负载。RocksDB 有 WAL，最坏是恢复而非丢账，S2 告警为此。
7. **Windows"快速启动"下启动触发器是否触发**：未实测。
8. **探针对 simnet 的 `network` 字符串**：未验证。
9. **脚本主体（起进程、探针门、console 阶段）没有在真环境跑过**：只有辅助函数/向量的 `-SelfTest`、`-WatchOnly` 在临时根目录的一次运行、认领判定对活进程的一次校验。R1、R3、4.5 逐级补证。**`-SelfTest` 不覆盖 Phase B 的"起后失败不 exit"这一层**（NWT）。
10. **哨兵边界（S6）**：只报一次；运行期 console 死后若被人手动重起，哨兵不知道——可接受。
11. **§2.6 第 10 行（入口触发型）没有代码级核**。
12. **`kaspa_tx_log` 的覆盖范围**：见附录 C——只登记"输出里含我们某个地址"的交易，**不登记纯外付且无找零回自己的出站交易**（那种交易靠 outpoint 快照差分才看得见）。
13. 提交内存字段口径以本机实测为准（en-US；脚本用 `Win32_OperatingSystem` 属性，不受区域影响）。

## 附录 A. `scripts/mainnet-boot-sequence.ps1` v0.2 草案全文（**未落码、未在真启动上运行**；ASCII-only；落码须 Bettor 批 + NWT 再审）

```powershell
# mainnet-boot-sequence.ps1 v0.2 -- DRAFT, not landed, not run on a real boot. KANet-UI 2026-09-19.
# Boot-time orchestration for the mainnet node + console, plus a resident sentinel that also watches system commit memory.
# BOOT-ONLY: it never restarts anything that died after boot (a console restart after a kaspad restart has money-path
# side effects and must be a human decision). Order: tree check -> verify kaspad binary -> previous-stop check -> rotate logs ->
# start/adopt kaspad -> wait for >=3 consecutive probe ALIVE -> rotate console logs -> start/adopt console -> verify ->
# resident sentinel (alerts only).
# HARD RULE (NWT P2-M1): once this script has started or adopted kaspad it has NO exit path. Every later failure is
# "warn + keep the sentinel alive", because (unproven) Task Scheduler may kill processes started by a task when the
# task instance ends, and a retry loop would then hard-kill a node that is still catching up.
# Modes: default = boot + sentinel;  -WatchOnly = memory watch only, starts nothing (safe in an ordinary user session);
#        -SelfTest = helper/vector checks only, starts nothing.
# ASCII-only on purpose (Windows PowerShell 5.1 reads a BOM-less file as ANSI).
[CmdletBinding()]
param(
  [string]  $KanetRoot       = 'D:\kanet-tn12',
  [string]  $KaspadExe       = 'D:\rusty-kaspa-v201\kaspad.exe',
  [string]  $KaspadSha256    = '8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38',
  [string]  $KaspadVersion   = 'kaspad 2.0.1',
  [string]  $AppDir          = 'D:\kaspa-mainnet-data-v201',
  [string]  $KaspadLogDir    = 'D:\kaspa-mainnet-data-v201-logs',
  [string]  $KaspadInternalLog = 'D:\kaspa-mainnet-data-v201\kaspa-mainnet\logs\rusty-kaspa.log',
  [int]     $RpcPort         = 17110,
  [string]  $ExpectNetwork   = 'mainnet',
  [int]     $ConsolePort     = 3202,
  [int]     $GateSoftSec     = 5400,    # not ALIVE after this: alert once, keep waiting (doubled if the previous stop was unclean)
  [int]     $GateHardSec     = 86400,   # not ALIVE after this: warn, do NOT start console, stay resident
  [int]     $ProbeEverySec   = 15,
  [int]     $AliveStreakNeeded = 3,     # consecutive ALIVE probes before console may start (3 x 15 s = 45 s of stability)
  [string]  $AllowedBranch   = 'bshard-m3-deploy',
  [double]  $MemWarnPct      = 85,
  [double]  $MemCritPct      = 92,
  [double]  $MemClearPct     = 80,
  [double]  $MemCritClearPct = 88,
  [int]     $MemRepeatSec    = 1800,
  [double]  $MemEscalatePp   = 5,
  [int]     $SentinelTickSec = 30,
  [string[]]$ExtraKaspadArgs = @(),
  [switch]  $SkipConsole,
  [switch]  $WatchOnly,
  [switch]  $SelfTest
)
$ErrorActionPreference = 'Stop'
$BootDir = Join-Path $KanetRoot 'logs\mainnet\boot'
$StatusFile = Join-Path $BootDir 'boot-status.json'
$HistoryFile = Join-Path $BootDir 'boot-history.log'
$MemLogFile = Join-Path $BootDir 'memory-watch.log'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$ScriptStart = Get-Date
$ExpectedConsoleScript = Join-Path $KanetRoot 'kasia-console\src\index.js'
$Script:Mono = [System.Diagnostics.Stopwatch]::StartNew()   # monotonic clock for all interval logic (wall clock can be stepped)

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
  # Without it the event is skipped and only the file logs carry the alert (Write-History records the failure).
  try { Write-EventLog -LogName Application -Source 'KANetBoot' -EventId $Id -EntryType $Type -Message $Msg -ErrorAction Stop }
  catch { Write-History ("eventlog-write-failed id={0}: {1}" -f $Id, $_.Exception.Message) }
}

function Stop-Boot([int]$Code, [string]$Phase, [string]$Msg) {
  # Fatal. ONLY legal while nothing has been started or adopted yet (Phase A). Never call after kaspad is known.
  Set-BootStatus $Phase @{ exitCode = $Code; message = $Msg }
  Send-BootEvent (9000 + $Code) 'Error' ("KANet mainnet boot FAILED phase={0} code={1}: {2}" -f $Phase, $Code, $Msg)
  exit $Code
}

function Warn-Kaspad([int]$Code, [string]$Phase, [string]$Msg) {
  # Post-start kaspad-side failure: alert, record, keep the (possibly still syncing) kaspad and this sentinel alive.
  Set-BootStatus $Phase @{ code = $Code; message = $Msg }
  Send-BootEvent (9000 + $Code) 'Warning' ("KANet mainnet kaspad phase={0} code={1}: {2}. Console will NOT be started by the boot sequence; kaspad left running." -f $Phase, $Code, $Msg)
}

function Warn-Console([int]$Code, [string]$Phase, [string]$Msg) {
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

# ---- process identity (NWT P2-M2): claim by exact path / appdir / port, never by process name or path fragment ----
function Select-MainnetKaspad([object[]]$Procs, [string]$AppDirName, [int]$Port) {
  # A kaspad.exe is "the mainnet node" only if its command line names the mainnet appdir or the mainnet RPC port.
  # simnet validation nodes use the SAME kaspad.exe; they are ignored (not counted, not reported).
  @($Procs | Where-Object { $_.CommandLine -and ($_.CommandLine -like "*--appdir=$AppDirName*" -or $_.CommandLine -like "*--rpclisten-borsh=127.0.0.1:$Port*") })
}
function Select-ConsoleCandidates([object[]]$Procs, [string]$ExpectedScript) {
  # Only node.exe whose command line contains the EXACT production script path. Worktree copies (scratch\..\kasia-console\src\index.js)
  # and isolated test consoles have a different full path and are ignored.
  @($Procs | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/', '\').ToLower().Contains($ExpectedScript.ToLower()) })
}
function Test-ConsoleClaim([object]$Proc, [int[]]$ListenerPids, [string]$PidFileValue) {
  # All three must hold: exact production path (already selected) AND owns the console port AND matches console-mainnet.pid.
  if (-not $Proc) { return $false }
  $pidOk = ($PidFileValue -as [int]) -eq [int]$Proc.ProcessId
  return (($ListenerPids -contains [int]$Proc.ProcessId) -and $pidOk)
}

function Get-KaspadProcs { @(Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'") }
function Get-NodeProcs { @(Get-CimInstance Win32_Process -Filter "Name='node.exe'") }
function Get-ListenerPids([int]$Port) { @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.OwningProcess }) }
function Test-Listening([int]$Port) { (Get-ListenerPids $Port).Count -gt 0 }

function Get-NativeText([scriptblock]$Block) {
  $ErrorActionPreference = 'Continue'   # native stderr merged with 2>&1 must not become a terminating error
  (& $Block 2>&1 | Out-String).Trim()
}

function Test-TreeClean {
  # NWT S1: the tree the console runs from must be on the allowed branch and the two scripts we depend on must equal HEAD.
  $branch = Get-NativeText { & git -C $KanetRoot branch --show-current }
  if ($branch -ne $AllowedBranch) { return @{ ok = $false; reason = "production checkout is on '$branch', expected '$AllowedBranch'" } }
  foreach ($f in 'scripts/start-console-mainnet.ps1', 'scripts/kaspad-rpc-probe.mjs') {
    & git -C $KanetRoot diff --quiet HEAD -- $f
    if ($LASTEXITCODE -ne 0) { return @{ ok = $false; reason = "$f differs from HEAD (or git failed)" } }
  }
  @{ ok = $true; reason = '' }
}

function Test-CleanStopMarker([string]$TailText) {
  # last non-empty line of the kaspad INTERNAL log must contain 'Kaspad has stopped' (NWT S2 / H2). The redirected stdout is
  # NOT authoritative: it went silent for 5 days on 2026-09-14 for an unknown reason.
  $lines = @($TailText -split "`r?`n" | Where-Object { $_.Trim() })
  if ($lines.Count -eq 0) { return @{ known = $false; clean = $false; last = '' } }
  $last = $lines[-1]
  @{ known = $true; clean = [bool]($last -match 'Kaspad has stopped'); last = $last.Substring(0, [Math]::Min(120, $last.Length)) }
}
function Get-LogTail([string]$Path, [int]$Bytes = 8192) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
  try {
    $n = [Math]::Min([long]$Bytes, $fs.Length); [void]$fs.Seek(-$n, 'End')
    $buf = New-Object byte[] $n; [void]$fs.Read($buf, 0, $n); [System.Text.Encoding]::UTF8.GetString($buf)
  } finally { $fs.Dispose() }
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

# ---------------------------------------------------------------- memory watch (P3 v0.2: hosted here, not in console)
# Detection + forensics only. No spawn, no DB, no console dependency. First landing = memory-watch.log (+ host), then the
# Application event log. Interval logic uses the monotonic stopwatch, never the wall clock.
function Get-MemoryConfig {
  @{ Warn = $MemWarnPct; Crit = $MemCritPct; Clear = $MemClearPct; CritClear = $MemCritClearPct; RepeatMs = ($MemRepeatSec * 1000); EscalatePp = $MemEscalatePp }
}
function Test-MemoryConfig($Cfg) {
  # required ordering: 0 < Clear < Warn < CritClear < Crit < 100. Returns $null when valid, else the reason.
  if (-not ($Cfg.Clear -gt 0)) { return 'clear must be > 0' }
  if (-not ($Cfg.Clear -lt $Cfg.Warn)) { return 'clear must be < warn' }
  if (-not ($Cfg.Warn -lt $Cfg.CritClear)) { return 'warn must be < critClear' }
  if (-not ($Cfg.CritClear -lt $Cfg.Crit)) { return 'critClear must be < crit (crit <= warn is invalid)' }
  if (-not ($Cfg.Crit -lt 100)) { return 'crit must be < 100' }
  if (-not ($Cfg.RepeatMs -gt 0 -and $Cfg.EscalatePp -gt 0)) { return 'repeat and escalate must be > 0' }
  return $null
}
function Get-MemoryTransition($State, [double]$Pct, [double]$NowMs, $Cfg) {
  # Pure state machine. Returns @{ Action; State }. Actions: none | enter-warn | enter-crit | escalate | repeat | downgrade | cleared
  # Silent bands: in WARN, [Clear, Warn) never alerts; in CRIT, [CritClear, Crit) never alerts. Repeats only while the reading is
  # at/above the level's own entry threshold. One tagged line per transition so the mutation checks in -SelfTest can target it.
  $lvl = $State.Level
  if ($lvl -eq 'OK') {
    if ($Pct -ge $Cfg.Crit) { return @{ Action = 'enter-crit'; State = @{ Level = 'CRIT'; LastMs = $NowMs; LastPct = $Pct } } }   #T-OKCRIT
    if ($Pct -ge $Cfg.Warn) { return @{ Action = 'enter-warn'; State = @{ Level = 'WARN'; LastMs = $NowMs; LastPct = $Pct } } }   #T-OKWARN
    return @{ Action = 'none'; State = $State }
  }
  if ($lvl -eq 'WARN') {
    if ($Pct -ge $Cfg.Crit) { return @{ Action = 'escalate'; State = @{ Level = 'CRIT'; LastMs = $NowMs; LastPct = $Pct } } }   #T-WARNCRIT
    if ($Pct -lt $Cfg.Clear) { return @{ Action = 'cleared'; State = @{ Level = 'OK'; LastMs = $NowMs; LastPct = $Pct } } }   #T-WARNCLEAR
    if ($Pct -ge $Cfg.Warn -and ($NowMs - $State.LastMs) -ge $Cfg.RepeatMs) { return @{ Action = 'repeat'; State = @{ Level = 'WARN'; LastMs = $NowMs; LastPct = $Pct } } }   #T-WARNREP_T
    if ($Pct -ge $Cfg.Warn -and $Pct -ge ($State.LastPct + $Cfg.EscalatePp)) { return @{ Action = 'repeat'; State = @{ Level = 'WARN'; LastMs = $NowMs; LastPct = $Pct } } }   #T-WARNREP_PP
    return @{ Action = 'none'; State = $State }
  }
  # CRIT
  if ($Pct -lt $Cfg.Clear) { return @{ Action = 'cleared'; State = @{ Level = 'OK'; LastMs = $NowMs; LastPct = $Pct } } }   #T-CRITCLEAR
  if ($Pct -lt $Cfg.CritClear) { return @{ Action = 'downgrade'; State = @{ Level = 'WARN'; LastMs = $NowMs; LastPct = $Pct } } }   #T-CRITDOWN
  if ($Pct -ge $Cfg.Crit -and ($NowMs - $State.LastMs) -ge $Cfg.RepeatMs) { return @{ Action = 'repeat'; State = @{ Level = 'CRIT'; LastMs = $NowMs; LastPct = $Pct } } }   #T-CRITREP_T
  if ($Pct -ge $Cfg.Crit -and $Pct -ge ($State.LastPct + $Cfg.EscalatePp)) { return @{ Action = 'repeat'; State = @{ Level = 'CRIT'; LastMs = $NowMs; LastPct = $Pct } } }   #T-CRITREP_PP
  return @{ Action = 'none'; State = $State }
}

function Write-MemLine([string]$Msg) {
  $line = '{0} [memory-watch] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg
  try { Add-Content -LiteralPath $MemLogFile -Value $line -Encoding ASCII } catch { }
  Write-Host $line
}

function Get-MemorySample {
  # in-process only (CIM query + Get-Process): no child process is spawned, so this cannot fail for lack of memory to start one.
  $os = Get-CimInstance Win32_OperatingSystem
  $lim = [double]$os.TotalVirtualMemorySize; $free = [double]$os.FreeVirtualMemory
  if (-not ($lim -gt 0)) { throw 'TotalVirtualMemorySize not > 0' }
  $pct = [math]::Round(100 * ($lim - $free) / $lim, 1)
  if (-not ($pct -gt 0 -and $pct -le 100)) { throw "commit pct out of range: $pct" }
  # names, PIDs and private GB only -- never command lines
  $top = @(Get-Process | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 5 | ForEach-Object { '{0}:{1}:{2}' -f $_.Name, $_.Id, [math]::Round($_.PrivateMemorySize64 / 1GB, 1) })
  @{ pct = $pct; usedGB = [math]::Round(($lim - $free) / 1MB, 1); limitGB = [math]::Round($lim / 1MB, 1); physFreeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1); top = ($top -join ',') }
}

$Script:MemState = @{ Level = 'OK'; LastMs = 0; LastPct = 0 }
$Script:MemFails = 0; $Script:MemFailStartMs = 0; $Script:MemFailAlerted = $false; $Script:MemExhaustAlerted = $false; $Script:MemTicks = 0
function Invoke-MemoryWatchTick {
  $cfg = Get-MemoryConfig; $now = [double]$Script:Mono.ElapsedMilliseconds
  try { $s = Get-MemorySample }
  catch {
    $err = $_.Exception.Message
    if ($Script:MemFails -eq 0) { $Script:MemFailStartMs = $now }
    $Script:MemFails++
    Write-MemLine ("SAMPLE-FAILED n={0}: {1}" -f $Script:MemFails, $err)
    # memory-exhaustion-class failures are pressure evidence on the FIRST occurrence (do not wait for 3 misses)
    if ($err -match 'OutOfMemory|1455|not enough memory|not enough storage|insufficient system resources' -and -not $Script:MemExhaustAlerted) {
      $Script:MemExhaustAlerted = $true
      Send-BootEvent 9310 'Error' ("memory watch: sample failed with a memory-exhaustion-class error (treat as CRIT): {0}" -f $err)
    }
    if ($Script:MemFails -ge 3 -and -not $Script:MemFailAlerted) {
      $Script:MemFailAlerted = $true
      Send-BootEvent 9311 'Warning' ("memory watch: {0} consecutive sample failures; state held at {1}. last error: {2}" -f $Script:MemFails, $Script:MemState.Level, $err)
    }
    return   # state is HELD (not reset) across failures
  }
  if ($Script:MemFails -gt 0) {
    $blind = [int]($now - $Script:MemFailStartMs)
    Write-MemLine ("SAMPLE-RECOVERED after {0} failures, blindMs={1}" -f $Script:MemFails, $blind)
    if ($Script:MemFailAlerted) { Send-BootEvent 9312 'Information' ("memory watch: sampling recovered after {0} ms blind" -f $blind) }
    $Script:MemFails = 0; $Script:MemFailAlerted = $false; $Script:MemExhaustAlerted = $false
  }
  $Script:MemTicks++
  if ($Script:MemTicks % 10 -eq 1) { Write-MemLine ("SAMPLE commit={0}% used={1}GB limit={2}GB physFree={3}GB top={4}" -f $s.pct, $s.usedGB, $s.limitGB, $s.physFreeGB, $s.top) }
  $t = Get-MemoryTransition $Script:MemState $s.pct $now $cfg
  $Script:MemState = $t.State
  if ($t.Action -eq 'none') { return }
  $txt = 'STATE {0} commit={1}% used={2}/{3}GB physFree={4}GB top={5}' -f $t.Action, $s.pct, $s.usedGB, $s.limitGB, $s.physFreeGB, $s.top
  Write-MemLine $txt   # first landing: file/host BEFORE the event log
  $ev = switch ($t.Action) {
    'enter-warn' { 9301, 'Warning' } 'enter-crit' { 9302, 'Error' } 'escalate' { 9302, 'Error' }
    'repeat' { $(if ($t.State.Level -eq 'CRIT') { 9303, 'Error' } else { 9303, 'Warning' }) }
    'downgrade' { 9304, 'Warning' } 'cleared' { 9305, 'Information' }
  }
  Send-BootEvent $ev[0] $ev[1] ("memory: {0}. Detection only; this watcher takes no action." -f $txt)
}

if ($SelfTest) {
  # Helper/vector checks only. Uses a temp dir; starts no process, touches no production path.
  $tmp = Join-Path $env:TEMP ('boot-selftest-' + $Stamp); New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $BootDir = $tmp; $StatusFile = Join-Path $tmp 'boot-status.json'; $HistoryFile = Join-Path $tmp 'boot-history.log'; $MemLogFile = Join-Path $tmp 'memory-watch.log'
  $fail = 0
  function Check([string]$Name, [bool]$Ok) { if ($Ok) { "PASS $Name" } else { "FAIL $Name"; $Script:fail++ } }
  # --- log rotation
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
  # --- command-line matching
  $exe = 'D:\x\kaspad.exe'; $a = @('--appdir=D:\d', '--utxoindex')
  Check 'args-match-quoted-exe' (Test-ArgsMatch '"D:\x\kaspad.exe" --appdir=D:\d --utxoindex' $exe $a)
  Check 'args-match-rejects-extra' (-not (Test-ArgsMatch 'D:\x\kaspad.exe --appdir=D:\d --utxoindex --unsaferpc' $exe $a))
  Check 'args-match-rejects-missing' (-not (Test-ArgsMatch 'D:\x\kaspad.exe --appdir=D:\d' $exe $a))
  Check 'args-match-rejects-different-value' (-not (Test-ArgsMatch 'D:\x\kaspad.exe --appdir=D:\other --utxoindex' $exe $a))
  # --- NWT M2 fixtures: fabricated process records (no live process is touched)
  $mainK = [pscustomobject]@{ ProcessId = 100; CommandLine = '"D:\rusty-kaspa-v201\kaspad.exe" --appdir=D:\kaspa-mainnet-data-v201 --utxoindex --rpclisten-borsh=127.0.0.1:17110 --rocksdb-cache-size=2048' }
  $simK = [pscustomobject]@{ ProcessId = 200; CommandLine = '"D:\rusty-kaspa-v201\kaspad.exe" --simnet --appdir=D:\kanet-tn12\scratch\simnet-data --rpclisten-borsh=127.0.0.1:17510' }
  $oddK = [pscustomobject]@{ ProcessId = 300; CommandLine = 'D:\rusty-kaspa-v201\kaspad.exe --appdir=D:\kaspa-mainnet-data-v201 --unsaferpc' }
  Check 'kaspad-select-mainnet-and-simnet-together' ((@(Select-MainnetKaspad @($mainK, $simK) 'D:\kaspa-mainnet-data-v201' 17110)).Count -eq 1)
  Check 'kaspad-select-only-simnet-is-zero-not-42' ((@(Select-MainnetKaspad @($simK) 'D:\kaspa-mainnet-data-v201' 17110)).Count -eq 0)
  Check 'kaspad-select-mainnet-appdir-with-odd-args-still-selected' ((@(Select-MainnetKaspad @($oddK) 'D:\kaspa-mainnet-data-v201' 17110)).Count -eq 1)
  $prodJs = 'D:\kanet-tn12\kasia-console\src\index.js'
  $cProd = [pscustomobject]@{ ProcessId = 500; CommandLine = '"C:\Program Files\nodejs\node.exe" D:\kanet-tn12\kasia-console\src\index.js' }
  $cWt1 = [pscustomobject]@{ ProcessId = 501; CommandLine = 'node.exe D:\kanet-tn12\scratch\_j2_wt_a_branch\kasia-console\src\index.js' }
  $cWt2 = [pscustomobject]@{ ProcessId = 502; CommandLine = 'node.exe D:\kanet-tn12\scratch\_nwt_wt_b9v03\kasia-console\src\index.js' }
  Check 'console-select-ignores-worktree-copies' ((@(Select-ConsoleCandidates @($cWt1, $cWt2) $prodJs)).Count -eq 0)
  Check 'console-select-picks-only-production-path' ((@(Select-ConsoleCandidates @($cProd, $cWt1, $cWt2) $prodJs)).Count -eq 1)
  Check 'console-claim-needs-all-three' ((Test-ConsoleClaim $cProd @(500) '500') -and -not (Test-ConsoleClaim $cProd @(999) '500') -and -not (Test-ConsoleClaim $cProd @(500) '501') -and -not (Test-ConsoleClaim $cProd @(500) '') -and -not (Test-ConsoleClaim $null @(500) '500'))
  # --- NWT S2: previous-stop marker
  Check 'stop-marker-clean' ((Test-CleanStopMarker "x`r`n2026-09-19 21:12:21 [INFO ] Kaspad has stopped...`r`n`r`n").clean)
  Check 'stop-marker-unclean-when-last-line-is-other' (-not (Test-CleanStopMarker "Kaspad has stopped...`r`n2026-09-19 22:00:00 [INFO ] Accepted 100 blocks`r`n").clean)
  Check 'stop-marker-empty-is-unknown' (-not (Test-CleanStopMarker "`r`n`r`n").known)
  # --- status file + commit sample
  Set-BootStatus 'SELFTEST' @{ ok = $true }
  Check 'status-json-roundtrip' ((Get-Content $StatusFile -Raw | ConvertFrom-Json).phase -eq 'SELFTEST')
  $ms = Get-MemorySample
  Check 'memory-sample-sane' (($ms.pct -gt 0) -and ($ms.limitGB -gt 0) -and ($ms.top -notmatch '[\\/ ]--'))
  # --- memory config validation (NWT: crit <= warn must be rejected)
  $cfg = @{ Warn = 85; Crit = 92; Clear = 80; CritClear = 88; RepeatMs = 1800000; EscalatePp = 5 }
  Check 'memcfg-valid' ($null -eq (Test-MemoryConfig $cfg))
  Check 'memcfg-rejects-crit-le-warn' ($null -ne (Test-MemoryConfig @{ Warn = 85; Crit = 85; Clear = 80; CritClear = 88; RepeatMs = 1; EscalatePp = 1 }))
  Check 'memcfg-rejects-clear-ge-warn' ($null -ne (Test-MemoryConfig @{ Warn = 85; Crit = 92; Clear = 85; CritClear = 88; RepeatMs = 1; EscalatePp = 1 }))
  Check 'memcfg-rejects-critclear-le-warn' ($null -ne (Test-MemoryConfig @{ Warn = 85; Crit = 92; Clear = 80; CritClear = 85; RepeatMs = 1; EscalatePp = 1 }))
  Check 'memcfg-rejects-crit-ge-100' ($null -ne (Test-MemoryConfig @{ Warn = 85; Crit = 100; Clear = 80; CritClear = 88; RepeatMs = 1; EscalatePp = 1 }))
  # --- state-machine vectors: each vector = @(name, @(@(pct, tSec), ...), expected actions). Runs against ANY transition function.
  $vectors = @(
    @('V1-below-warn-silent',            @(@(50, 0), @(84.9, 30)),                       @('none', 'none')),
    @('V2-enter-warn-at-85',             @(@(84.9, 0), @(85, 30)),                       @('none', 'enter-warn')),
    @('V3-no-repeat-inside-30min',       @(@(85, 0), @(86, 60), @(87, 120)),             @('enter-warn', 'none', 'none')),
    @('V4-warn-repeat-on-plus-5pp',      @(@(85, 0), @(91, 60)),                         @('enter-warn', 'repeat')),
    @('V5-warn-escalates-to-crit',       @(@(85, 0), @(92, 60)),                         @('enter-warn', 'escalate')),
    @('V6-crit-downgrades-to-warn',      @(@(92, 0), @(87.9, 60)),                       @('enter-crit', 'downgrade')),
    @('V7-hysteresis-then-clear',        @(@(85, 0), @(82, 60), @(79.9, 120)),           @('enter-warn', 'none', 'cleared')),
    @('V8-warn-repeat-after-30min',      @(@(85, 0), @(86, 1800)),                       @('enter-warn', 'repeat')),
    @('V9-rearm-after-clear',            @(@(85, 0), @(70, 60), @(85, 120)),             @('enter-warn', 'cleared', 'enter-warn')),
    @('V10-ok-to-crit-direct',           @(@(50, 0), @(95, 30)),                         @('none', 'enter-crit')),
    @('V11-crit-to-ok-direct',           @(@(93, 0), @(70, 30)),                         @('enter-crit', 'cleared')),
    @('V12-crit-repeat-on-plus-5pp',     @(@(92, 0), @(97, 30)),                         @('enter-crit', 'repeat')),
    @('V13-crit-repeat-after-30min',     @(@(92, 0), @(93, 1800)),                       @('enter-crit', 'repeat')),
    @('V14-warn-band-never-repeats',     @(@(85, 0), @(82, 1900)),                       @('enter-warn', 'none')),
    @('V15-crit-band-never-repeats',     @(@(93, 0), @(90, 1900)),                       @('enter-crit', 'none'))
  )
  function Get-VectorFailures([scriptblock]$Fn) {
    $bad = @()
    foreach ($v in $vectors) {
      $st = @{ Level = 'OK'; LastMs = 0; LastPct = 0 }; $got = @()
      foreach ($step in $v[1]) { $t = & $Fn $st $step[0] ($step[1] * 1000.0) $cfg; $st = $t.State; $got += $t.Action }
      if (($got -join ',') -ne ($v[2] -join ',')) { $bad += $v[0] }
    }
    $bad
  }
  $real = (Get-Command Get-MemoryTransition).ScriptBlock
  $bad = @(Get-VectorFailures $real)
  Check 'state-machine-all-15-vectors-pass' ($bad.Count -eq 0)
  if ($bad.Count) { "  failing vectors: $($bad -join ', ')" }
  # --- mutation checks: each mutant edits ONE tagged line; at least one vector must go red (else the vectors guard nothing)
  $body = $real.ToString()
  function New-Mutant([string]$Tag, [string]$Old, [string]$New) {
    $out = @(); $hit = 0
    foreach ($l in ($body -split "`r?`n")) { if ($l.Contains("#T-$Tag") -and $l.Contains($Old)) { $l = $l.Replace($Old, $New); $hit++ }; $out += $l }
    if ($hit -ne 1) { return $null }
    [scriptblock]::Create($out -join "`n")
  }
  $mutants = @(
    @('OKWARN',       '$Pct -ge $Cfg.Warn',                          '$Pct -gt $Cfg.Warn'),
    @('OKCRIT',       '$Pct -ge $Cfg.Crit',                          '$Pct -gt 1000'),
    @('WARNCRIT',     '$Pct -ge $Cfg.Crit',                          '$Pct -gt 1000'),
    @('WARNCLEAR',    '$Pct -lt $Cfg.Clear',                         '$Pct -lt 0'),
    @('CRITCLEAR',    '$Pct -lt $Cfg.Clear',                         '$Pct -lt 0'),
    @('CRITDOWN',     '$Pct -lt $Cfg.CritClear',                     '$Pct -lt $Cfg.Clear'),
    @('WARNREP_T',    '($NowMs - $State.LastMs) -ge $Cfg.RepeatMs',  '($NowMs - $State.LastMs) -ge 1e15'),
    @('WARNREP_PP',   '$Pct -ge ($State.LastPct + $Cfg.EscalatePp)', '$Pct -ge 1000'),
    @('CRITREP_T',    '($NowMs - $State.LastMs) -ge $Cfg.RepeatMs',  '($NowMs - $State.LastMs) -ge 1e15'),
    @('CRITREP_PP',   '$Pct -ge ($State.LastPct + $Cfg.EscalatePp)', '$Pct -ge 1000'),
    @('WARNREP_T',    '$Pct -ge $Cfg.Warn -and',                     ''),
    @('CRITREP_T',    '$Pct -ge $Cfg.Crit -and',                     '')
  )
  foreach ($m in $mutants) {
    $sb = New-Mutant $m[0] $m[1] $m[2]
    if (-not $sb) { Check ("mutant-{0}-applied-exactly-once" -f $m[0]) $false; continue }
    $red = @(Get-VectorFailures $sb)
    Check ("mutant-{0} '{1}'->'{2}' turns >=1 vector red" -f $m[0], $m[1], $m[2]) ($red.Count -ge 1)
  }
  # --- real reading (2026-09-19 23:20, commit 74.9% of 89.6 GB; llama-server + two python.exe back): silent at the default thresholds, enter-warn if warn were 70
  $st0 = @{ Level = 'OK'; LastMs = 0; LastPct = 0 }
  Check 'real-reading-74.9-default-thresholds-is-silent' ((Get-MemoryTransition $st0 74.9 0 $cfg).Action -eq 'none')
  $cfg70 = @{ Warn = 70; Crit = 92; Clear = 60; CritClear = 88; RepeatMs = 1800000; EscalatePp = 5 }
  Check 'real-reading-74.9-with-warn-70-enters-warn' ((Get-MemoryTransition $st0 74.9 0 $cfg70).Action -eq 'enter-warn')
  # --- watch tick smoke (real sample, temp log): must write nothing dangerous and must not throw
  $Script:MemState = @{ Level = 'OK'; LastMs = 0; LastPct = 0 }; $Script:MemTicks = 0
  $ok = $true; try { Invoke-MemoryWatchTick } catch { $ok = $false }
  Check 'memory-tick-smoke-no-throw-and-logs-first-sample' ($ok -and (Test-Path $MemLogFile) -and ((Get-Content $MemLogFile -Raw) -match 'SAMPLE commit='))
  # --- sampling-failure path (NWT P3): fabricated sampler + recorded events; no real event log is touched
  $Script:EvIds = @()
  function Send-BootEvent([int]$Id, [string]$Type, [string]$Msg) { $Script:EvIds += $Id }
  $Script:Fake = $null
  function Get-MemorySample { if ($Script:Fake -is [string]) { throw $Script:Fake }; $Script:Fake }
  $good = @{ pct = 60.0; usedGB = 50.0; limitGB = 89.6; physFreeGB = 30.0; top = 'x:1:1' }
  $Script:MemState = @{ Level = 'WARN'; LastMs = 0; LastPct = 86 }; $Script:MemFails = 0; $Script:MemFailAlerted = $false; $Script:MemExhaustAlerted = $false; $Script:MemTicks = 0
  $Script:Fake = 'Exception of type System.OutOfMemoryException was thrown'; Invoke-MemoryWatchTick
  Check 'sample-fail-exhaustion-class-alerts-9310-on-FIRST-occurrence' (($Script:EvIds -contains 9310) -and ($Script:EvIds -notcontains 9311))
  $Script:EvIds = @(); $Script:MemFails = 0; $Script:MemFailAlerted = $false; $Script:MemExhaustAlerted = $false
  $Script:Fake = 'some generic wmi failure'; 1..2 | ForEach-Object { Invoke-MemoryWatchTick }
  Check 'sample-fail-two-generic-failures-do-not-alert' ($Script:EvIds.Count -eq 0)
  Invoke-MemoryWatchTick; Invoke-MemoryWatchTick
  Check 'sample-fail-third-failure-alerts-9311-exactly-once' ((@($Script:EvIds | Where-Object { $_ -eq 9311 })).Count -eq 1)
  Check 'sample-fail-state-is-HELD-not-reset' ($Script:MemState.Level -eq 'WARN')
  $Script:Fake = $good; Invoke-MemoryWatchTick
  Check 'sample-recovery-alerts-9312-and-logs-blindMs' (($Script:EvIds -contains 9312) -and ((Get-Content $MemLogFile -Raw) -match 'blindMs='))
  Check 'sample-recovery-below-clear-then-clears-held-state' ($Script:MemState.Level -eq 'OK' -and ($Script:EvIds -contains 9305))
  Remove-Item -Recurse -Force $tmp
  "SELFTEST failures=$fail"; exit ([int]($fail -gt 0))
}

# ---------------------------------------------------------------- real run
New-Item -ItemType Directory -Force -Path $BootDir | Out-Null
$memCfgErr = Test-MemoryConfig (Get-MemoryConfig)

function Enter-MemoryLock {
  # exclusive file lock: only one memory watcher (boot sentinel OR a -WatchOnly session) at a time; released at process exit
  try { $Script:MemLock = [System.IO.File]::Open((Join-Path $BootDir 'memory-watch.lock'), 'OpenOrCreate', 'ReadWrite', 'None'); return $true } catch { return $false }
}

function Start-MemoryWatchLoop {
  # never returns; every iteration is wrapped so one bad sample can never end the loop
  while ($true) {
    try { Invoke-MemoryWatchTick } catch { Write-History ("memory tick exception: {0}" -f $_.Exception.Message) }
    Start-Sleep -Seconds $SentinelTickSec
  }
}

if ($WatchOnly) {
  if ($memCfgErr) { Write-Host "memory config invalid: $memCfgErr"; exit 2 }
  if (-not (Enter-MemoryLock)) { Write-Host 'another memory watcher holds memory-watch.lock; exiting'; exit 10 }
  Write-MemLine ("WATCH-ONLY started warn={0} crit={1} clear={2} critClear={3} tick={4}s (detection only; starts nothing)" -f $MemWarnPct, $MemCritPct, $MemClearPct, $MemCritClearPct, $SentinelTickSec)
  Start-MemoryWatchLoop
}

# Single boot instance via an exclusive file lock held for the life of the process (a Global\ mutex needs a privilege a
# limited task token may lack; the lock also works across sessions). Task Scheduler is set to IgnoreNew as well.
try { $Script:LockStream = [System.IO.File]::Open((Join-Path $BootDir 'boot.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { Write-History 'another boot sequence instance holds boot.lock; exiting'; exit 10 }

function Invoke-PhaseA {
  # PHASE A: nothing started yet -- exit is legal here. Returns the kaspad context.
  Set-BootStatus 'BOOT_BEGIN' @{ memoryConfigError = $memCfgErr }
  Send-BootEvent 9100 'Information' 'KANet mainnet boot sequence begin'
  $tree = Test-TreeClean   # S1: evaluated FIRST; a dirty/wrong tree blocks the console only, never kaspad
  if (-not $tree.ok) { Send-BootEvent 9062 'Warning' ("boot: {0}; console will NOT be started" -f $tree.reason) }
  if (-not (Test-Path -LiteralPath $KaspadExe)) { Stop-Boot 20 'KASPAD_BINARY' "missing $KaspadExe" }
  $sha = (Get-FileHash -LiteralPath $KaspadExe -Algorithm SHA256).Hash.ToLower()
  if ($sha -ne $KaspadSha256.ToLower()) { Stop-Boot 21 'KASPAD_BINARY' ("sha256 mismatch: got {0}" -f $sha.Substring(0, 12)) }
  $ver = Get-NativeText { & $KaspadExe --version }
  if ($ver -ne $KaspadVersion) { Stop-Boot 22 'KASPAD_BINARY' "--version mismatch: '$ver'" }

  $kArgs = @("--appdir=$AppDir", '--utxoindex', "--rpclisten-borsh=127.0.0.1:$RpcPort", '--rocksdb-cache-size=2048') + $ExtraKaspadArgs
  $kProcs = @(Select-MainnetKaspad (Get-KaspadProcs) $AppDir $RpcPort)
  if ($kProcs.Count -gt 1) { Stop-Boot 41 'KASPAD_START' "$($kProcs.Count) mainnet kaspad processes present; refusing to pick one" }
  $prevUnclean = $false
  if ($kProcs.Count -eq 1) {
    if (-not (Test-ArgsMatch $kProcs[0].CommandLine $KaspadExe $kArgs)) { Stop-Boot 42 'KASPAD_START' 'the mainnet kaspad is running with a different command line; not touching it' }
    $kPid = [int]$kProcs[0].ProcessId
    Set-BootStatus 'KASPAD_ADOPTED' @{ kaspadPid = $kPid }
  } else {
    # S2: was the previous stop clean? (internal log, not the redirected stdout). Zero-risk measurement, evidence for the shutdown-notice question.
    $tail = Get-LogTail $KaspadInternalLog
    if ($null -eq $tail) { $prevUnclean = $true; Send-BootEvent 9205 'Warning' 'previous_stop_unknown: kaspad internal log not found' }
    else {
      $mk = Test-CleanStopMarker $tail
      if (-not ($mk.known -and $mk.clean)) { $prevUnclean = $true; Send-BootEvent 9205 'Warning' ("previous_stop_unclean: last internal-log line = '{0}'. Expect RocksDB recovery; soft gate doubled." -f $mk.last) }
      else { Set-BootStatus 'PREVIOUS_STOP_CLEAN' @{ } }
    }
    New-Item -ItemType Directory -Force -Path $KaspadLogDir | Out-Null
    $kOut = Join-Path $KaspadLogDir 'kaspad-stdout.log'; $kErr = Join-Path $KaspadLogDir 'kaspad-stderr.log'
    try { $r1 = Rotate-LogIfPresent $kOut $Stamp; $r2 = Rotate-LogIfPresent $kErr $Stamp } catch { Stop-Boot 30 'KASPAD_LOG_ROTATE' $_.Exception.Message }
    $kp = Start-Process -FilePath $KaspadExe -ArgumentList $kArgs -RedirectStandardOutput $kOut -RedirectStandardError $kErr -WindowStyle Hidden -PassThru
    if (-not $kp -or -not $kp.Id) { Stop-Boot 40 'KASPAD_START' 'Start-Process returned no process' }
    $kPid = $kp.Id
    Set-Content -LiteralPath (Join-Path $KaspadLogDir 'kaspad.pid') -Value $kPid -Encoding ASCII
    Set-BootStatus 'KASPAD_STARTED' @{ kaspadPid = $kPid; rotated = @($r1, $r2) | Where-Object { $_ } }
  }
  $kStart = $null; try { $kStart = (Get-Process -Id $kPid -ErrorAction Stop).StartTime.Ticks } catch { }
  @{ Pid = $kPid; StartTicks = $kStart; Tree = $tree; PrevUnclean = $prevUnclean; StdoutPath = (Join-Path $KaspadLogDir 'kaspad-stdout.log') }
}

function Wait-KaspadAlive($Ctx) {
  # PHASE B (no exit paths). Returns $true after $AliveStreakNeeded CONSECUTIVE probe ALIVEs, else warns and returns $false.
  $soft = if ($Ctx.PrevUnclean) { $GateSoftSec * 2 } else { $GateSoftSec }
  $t0 = $Script:Mono.Elapsed.TotalSeconds; $streak = 0; $consecErr = 0; $stalledAlerted = $false; $softAlerted = $false; $lastNote = $t0
  while ($true) {
    if (-not (Get-Process -Id $Ctx.Pid -ErrorAction SilentlyContinue)) { Warn-Kaspad 46 'KASPAD_GATE' "kaspad pid $($Ctx.Pid) exited while waiting for ALIVE"; return $false }
    $p = Invoke-Probe
    switch ($p.Code) {
      0 { $streak++; $consecErr = 0 }
      7 { $streak = 0; $consecErr = 0 }
      8 { $streak = 0; $consecErr = 0; if (-not $stalledAlerted) { $stalledAlerted = $true; Send-BootEvent 9201 'Warning' ("kaspad sync STALLED: {0}" -f $p.Line) } }
      { $_ -in 3, 4, 5, 9 } { $streak = 0 }
      2 { Warn-Kaspad 43 'KASPAD_GATE' ("wrong network on rpc port: {0}" -f $p.Line); return $false }
      6 { Warn-Kaspad 44 'KASPAD_GATE' ("probe dependency broken: {0}" -f $p.Line); return $false }
      default { $streak = 0; $consecErr++; if ($consecErr -ge 5) { Warn-Kaspad 45 'KASPAD_GATE' ("probe error x5: {0}" -f $p.Line); return $false } }
    }
    if ($streak -ge $AliveStreakNeeded) { Set-BootStatus 'KASPAD_ALIVE' @{ kaspadPid = $Ctx.Pid; consecutiveAlive = $streak; probe = $p.Line }; return $true }
    $el = $Script:Mono.Elapsed.TotalSeconds - $t0
    if ($el -ge $GateHardSec) { Warn-Kaspad 50 'KASPAD_GATE' ("not stably ALIVE after {0}s; last probe: {1}" -f $GateHardSec, $p.Line); return $false }
    if ($el -ge $soft -and -not $softAlerted) { $softAlerted = $true; Send-BootEvent 9250 'Warning' ("kaspad not stably ALIVE after {0}s; console NOT started; still waiting. last probe: {1}" -f $soft, $p.Line) }
    if (($Script:Mono.Elapsed.TotalSeconds - $lastNote) -ge 300) { $lastNote = $Script:Mono.Elapsed.TotalSeconds; Set-BootStatus 'KASPAD_WAITING' @{ kaspadPid = $Ctx.Pid; alivestreak = $streak; lastProbe = $p.Line } }
    Start-Sleep -Seconds $ProbeEverySec
  }
}

function Start-ConsolePhase($Ctx) {
  # returns @{ Pid; StartTicks } or $null after a Warn-Console (kaspad stays up either way)
  if (-not $Ctx.Tree.ok) { Warn-Console 62 'CONSOLE_TREE_GUARD' ("{0}; console NOT started" -f $Ctx.Tree.reason); return $null }
  $logDir = Join-Path $KanetRoot 'logs\mainnet'; $pidFile = Join-Path $logDir 'console-mainnet.pid'
  $cand = @(Select-ConsoleCandidates (Get-NodeProcs) $ExpectedConsoleScript)
  $cPid = $null
  if ($cand.Count -gt 1) { Warn-Console 61 'CONSOLE_START' "$($cand.Count) node.exe processes run the production console script; refusing to pick one"; return $null }
  if ($cand.Count -eq 1) {
    $pf = ''; if (Test-Path -LiteralPath $pidFile) { $pf = (Get-Content -LiteralPath $pidFile -Raw).Trim() }
    if (-not (Test-ConsoleClaim $cand[0] (Get-ListenerPids $ConsolePort) $pf)) { Warn-Console 61 'CONSOLE_START' 'a process runs the production console script but is not (yet) the claimed console (port/pid-file mismatch); not starting a second one'; return $null }
    $cPid = [int]$cand[0].ProcessId; Set-BootStatus 'CONSOLE_ADOPTED' @{ consolePid = $cPid }
  } else {
    try { $c1 = Rotate-LogIfPresent (Join-Path $logDir 'console-mainnet-stdout.log') $Stamp; $c2 = Rotate-LogIfPresent (Join-Path $logDir 'console-mainnet-stderr.log') $Stamp }
    catch { Warn-Console 31 'CONSOLE_LOG_ROTATE' $_.Exception.Message; return $null }
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $KanetRoot 'scripts\start-console-mainnet.ps1') | Out-Null   # child stdout must not leak into the return value
    if ($LASTEXITCODE -ne 0) { Warn-Console 63 'CONSOLE_START' "start-console-mainnet.ps1 exit code $LASTEXITCODE"; return $null }
    # S5: the PID file may be a stale leftover; accept it only if it names a fresh node.exe running the production script
    $cPid = $null; try { $cPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim() } catch { }
    $proc = $null; if ($cPid) { $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$cPid" -ErrorAction SilentlyContinue }
    $fresh = $proc -and $proc.Name -eq 'node.exe' -and (Select-ConsoleCandidates @($proc) $ExpectedConsoleScript).Count -eq 1 -and ($proc.CreationDate -ge $ScriptStart.AddSeconds(-5))
    if (-not $fresh) { Warn-Console 63 'CONSOLE_START' 'console-mainnet.pid does not name a fresh node.exe running the production console script (stale pid file?)'; return $null }
    Set-BootStatus 'CONSOLE_STARTED' @{ consolePid = $cPid; rotated = @($c1, $c2) | Where-Object { $_ } }
  }
  # verify: process alive, port listening, HTTP answering. A failure here warns; it never kills or restarts the console.
  $t0 = $Script:Mono.Elapsed.TotalSeconds; $ok = $false
  while (($Script:Mono.Elapsed.TotalSeconds - $t0) -lt 300) {
    if ((Get-Process -Id $cPid -ErrorAction SilentlyContinue) -and (Test-Listening $ConsolePort)) {
      try {
        $sum = (Invoke-RestMethod -Uri "http://127.0.0.1:$ConsolePort/api/system/rpc-overview" -TimeoutSec 10).summary
        Set-BootStatus 'BOOT_OK' @{ consolePid = $cPid; rpcSummary = $sum }; Send-BootEvent 9101 'Information' 'KANet mainnet boot OK'; $ok = $true; break
      } catch { }
    }
    Start-Sleep -Seconds 10
  }
  if (-not $ok) { Warn-Console 64 'CONSOLE_UNHEALTHY' 'console process/port/HTTP not healthy within 300s; NOT restarted by the boot sequence' }
  $st = $null; try { $st = (Get-Process -Id $cPid -ErrorAction Stop).StartTime.Ticks } catch { }
  @{ Pid = $cPid; StartTicks = $st }
}

function Test-SameProcess($ProcId, $StartTicks) {
  # S6: PID reuse safe -- alive AND same start time
  try { $p = Get-Process -Id $ProcId -ErrorAction Stop; return ($null -eq $StartTicks -or $p.StartTime.Ticks -eq $StartTicks) } catch { return $false }
}

function Invoke-PhaseB($Ctx) {
  # PHASE B: kaspad is running. NO exit path below this line -- everything is warn + keep going.
  $gateOk = $false
  try { $gateOk = Wait-KaspadAlive $Ctx } catch { Warn-Kaspad 98 'KASPAD_GATE' ("unexpected: {0}" -f $_.Exception.Message) }
  $con = $null
  if ($SkipConsole) { Set-BootStatus 'CONSOLE_SKIPPED' @{ reason = 'rehearsal switch' } }
  elseif ($gateOk) { try { $con = Start-ConsolePhase $Ctx } catch { Warn-Console 97 'CONSOLE_START' ("unexpected: {0}" -f $_.Exception.Message) } }
  # resident sentinel: dead-man watcher + memory watch. Alerts only; never restarts anything; every duty is individually wrapped.
  $haveMem = $false; if ($memCfgErr) { Send-BootEvent 9313 'Error' ("memory watch DISABLED: invalid config: {0}" -f $memCfgErr) } elseif (Enter-MemoryLock) { $haveMem = $true; Write-MemLine ("started in boot sentinel warn={0} crit={1} clear={2} critClear={3} tick={4}s (detection only)" -f $MemWarnPct, $MemCritPct, $MemClearPct, $MemCritClearPct, $SentinelTickSec) } else { Write-History 'memory-watch.lock held by a -WatchOnly session; boot sentinel will not duplicate memory alerts' }
  $kSeenDead = $false; $cSeenDead = $false; $staleAlerted = $false
  while ($true) {
    try {
      if (-not $kSeenDead -and -not (Test-SameProcess $Ctx.Pid $Ctx.StartTicks)) { $kSeenDead = $true; Set-BootStatus 'KASPAD_DIED_AFTER_BOOT' @{ kaspadPid = $Ctx.Pid }; Send-BootEvent 9203 'Error' "kaspad pid $($Ctx.Pid) is gone after boot; nothing restarts it automatically" }
      if ($con -and -not $cSeenDead -and -not (Test-SameProcess $con.Pid $con.StartTicks)) { $cSeenDead = $true; Set-BootStatus 'CONSOLE_DIED_AFTER_BOOT' @{ consolePid = $con.Pid }; Send-BootEvent 9204 'Error' "console pid $($con.Pid) is gone after boot; nothing restarts it automatically" }
      # S3 (heuristic): kaspad alive but its redirected stdout has not been written for >10 min
      if (-not $kSeenDead -and -not $staleAlerted -and (Test-Path -LiteralPath $Ctx.StdoutPath)) {
        if (((Get-Date) - (Get-Item -LiteralPath $Ctx.StdoutPath).LastWriteTime).TotalMinutes -gt 10) { $staleAlerted = $true; Send-BootEvent 9206 'Warning' 'stdout_capture_stale: kaspad is alive but kaspad-stdout.log has not been written for >10 min; the internal log is the authority' }
      }
    } catch { Write-History ("sentinel exception: {0}" -f $_.Exception.Message) }
    if ($haveMem) { try { Invoke-MemoryWatchTick } catch { Write-History ("memory tick exception: {0}" -f $_.Exception.Message) } }
    Start-Sleep -Seconds $SentinelTickSec
  }
}

$ctx = $null
try { $ctx = Invoke-PhaseA } catch { Stop-Boot 99 'UNEXPECTED_PRE_START' $_.Exception.Message }
Invoke-PhaseB $ctx
while ($true) { Start-Sleep -Seconds 3600 }   # unreachable safety net: the script never ends by itself once kaspad exists
```

## 附录 B. 计划任务注册命令草案（**提权，J1 EXECUTE 单；KANet-UI 不执行**；4.3 才用）

```powershell
# 前置: 4.1 脚本已落码; 4.2 事件源已注册; R2 已过; D-026 开关已合入并被运行中 console 的启动日志证明 (V6)
$user   = "$env:COMPUTERNAME\ADMIN"
$script = 'D:\kanet-tn12\scripts\mainnet-boot-sequence.ps1'   # 建议(S1)改为树外部署副本路径, 例 C:\KANetBoot\mainnet-boot-sequence.ps1 (目录待 Bettor 定), sha256 记 provenance
$act  = New-ScheduledTaskAction -Execute 'powershell.exe' `
          -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $script) `
          -WorkingDirectory 'D:\kanet-tn12'
$trg  = New-ScheduledTaskTrigger -AtStartup
$trg.Delay = 'PT2M'
$prn  = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$set  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
          -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10) `
          -MultipleInstances IgnoreNew -StartWhenAvailable `
          -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskPath '\KANet\' -TaskName 'KANet-Mainnet-Boot' -Action $act -Trigger $trg -Principal $prn -Settings $set `
  -Description 'Mainnet boot: verify kaspad, start/adopt, wait for 3 consecutive probe ALIVE, start/adopt console; resident sentinel + memory watch (alerts only). Runbook: docs/2026-09-19-kanetui-mainnet-boot-autostart-scheduled-task-runbook-v0.1.md (v0.2 body)'
# 立即核 (只读):
Get-ScheduledTask -TaskPath '\KANet\' -TaskName KANet-Mainnet-Boot | ForEach-Object { $_.Settings | Select-Object ExecutionTimeLimit,RestartCount,RestartInterval,MultipleInstances; $_.Principal | Select-Object UserId,LogonType,RunLevel; $_.Triggers | Select-Object CimClass,Delay }
```

## 附录 C. 验收读数 #10 的链上侧比对工具与实测（**只读**；scratch 脚本，不入库；定稿时交 NWT 审）

**关键事实（NWT 会核，命令附后）**：主网库表 `kaspa_tx_log`（v60，relay 嵌入式 indexer 从 `block-added` 写入）**只登记"输出里含我们某个 relay 地址"的交易，且 `from_address` 列全为空**——所以它**不能直接列出"出站交易"**：它看得见"进到我们地址的交易"（含"自己拆给自己"的自转与找零），看不见"纯外付、无找零回自己"的出站。据此 #10 用**两个独立信号**：
1. **outpoint 快照差分**（节点只读 RPC，18 个地址各一次）：被花掉的 outpoint = 出站/自转的直接证据；新增 outpoint 的 txid 是链上事实。
2. **新增 txid 对 `kaspa_tx_log`**：核这些新增 txid 是否都被 indexer 登记（登记覆盖度自检），并列出窗口内的行。

**只读实测（2026-09-19，本机）**：
```
kaspa_tx_log: 74 行, from_address 为空/NULL = 74 行, distinct from_address = 0;
              其中 to_address 属于我们 18 个地址 = 74, 不属于 = 0
console 启动（15:21:34Z）之后的行: 4 行 —— 逐行 outputs 全部落在我们自己的地址上(external_outs=0, 输出数 2/3/5/7),
              正是 (1533) 记录的 22:21:34 启动拆分那 4 笔(Bettor 2 出 / Trader-M 3 出 / KANet-UI 5 出 / Trader-A 7 出)
工具 t0 快照后立刻 diff（同一系统状态）: relays=18 unreadable=0 spent_outpoints=0 new_outpoints=0
合成变异（把 t0 文件里 Bettor 的一个真实 outpoint 删掉、加一个假的）: 工具正确报出
              "Bettor spent=1 new=1 new_txids=44347266 not_in_kaspa_tx_log=0"
              —— 既证明变异能检出，也证明它点名的正是 22:21:34 那笔启动拆分
```
（`kaspa_tx_log` 窗口列表的等价 SQL：`SELECT tx_id, observed_at, to_address, outputs_json FROM kaspa_tx_log WHERE observed_at >= '<开机时刻>'`，再用 relay 名映射 `to_address`、按 `outputs_json` 是否全落在我们地址上区分"自转"与"含外部输出"。**不要把金额贴进 provenance**：D-021。）

```js
// _bootwatch_read.mjs -- READ-ONLY chain-side outbound check for the 18 mainnet relay addresses (runbook 4.5 reading #10).
// Usage (from D:\kanet-tn12, PowerShell):
//   node scratch\_bootwatch_read.mjs snap <outfile>            # t0: write per-relay outpoint sets (txid:index only; no addresses, no amounts)
//   node scratch\_bootwatch_read.mjs diff <t0file>             # t1: per relay -> spent / new outpoints, new txids, and whether kaspa_tx_log saw them
// A relay whose UTXO set cannot be read is reported as UNREADABLE (never counted as "no change").
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('D:/kanet-tn12/kasia-console/package.json');
const Database = require('better-sqlite3');
const { Address } = await import('file:///D:/kanet-tn12/kasia-console/node_modules/kaspa-wasm/kaspa.js').catch(async () => await import('kaspa-wasm'));
const { getSharedRpc } = await import('file:///D:/kanet-tn12/kasia-console/src/lib/kaspa-rpc-shared.mjs');
const [cmd, file] = process.argv.slice(2);
const db = new Database('D:/kanet-tn12/kasia-console/data/console.mainnet.db', { readonly: true, fileMustExist: true });
const relays = db.prepare("SELECT name, address FROM relay_nodes WHERE address IS NOT NULL ORDER BY name").all();
const rpc = await getSharedRpc({ url: 'ws://127.0.0.1:17110', networkId: 'mainnet' });
const tx = (e) => e.outpoint?.transactionId ?? e.entry?.outpoint?.transactionId;
const idx = (e) => e.outpoint?.index ?? e.entry?.outpoint?.index ?? 0;
async function readAll() {
  const out = {};
  for (const r of relays) {
    try { const { entries } = await rpc.getUtxosByAddresses([new Address(r.address)]); out[r.name] = entries.map((e) => `${tx(e)}:${idx(e)}`); }
    catch (e) { out[r.name] = { error: String(e.message || e).slice(0, 80) }; }
  }
  return out;
}
if (cmd === 'snap') {
  const now = await readAll(); fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), relays: now }));
  console.log('snap_written relays=', relays.length, ' unreadable=', Object.values(now).filter((v) => v.error).length);
} else if (cmd === 'diff') {
  /* tolerate a BOM (PowerShell 5.1 Set-Content -Encoding UTF8 adds one) */ const t0 = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); const now = await readAll();
  const seen = new Set(db.prepare('SELECT tx_id FROM kaspa_tx_log').all().map((r) => r.tx_id));
  let spent = 0, fresh = 0, unread = 0, unlogged = 0;
  for (const r of relays) {
    const a = t0.relays[r.name], b = now[r.name];
    if (!Array.isArray(a) || !Array.isArray(b)) { unread++; console.log(r.name.padEnd(18), 'UNREADABLE'); continue; }
    const sa = new Set(a), sb = new Set(b);
    const gone = a.filter((x) => !sb.has(x)), add = b.filter((x) => !sa.has(x));
    const txids = [...new Set(add.map((x) => x.split(':')[0]))];
    const miss = txids.filter((t) => !seen.has(t));
    spent += gone.length; fresh += add.length; unlogged += miss.length;
    if (gone.length || add.length) console.log(r.name.padEnd(18), 'spent=', gone.length, 'new=', add.length, 'new_txids=', txids.map((t) => t.slice(0, 8)).join(','), 'not_in_kaspa_tx_log=', miss.length);
  }
  console.log(`since ${t0.at}: relays=${relays.length} unreadable=${unread} spent_outpoints=${spent} new_outpoints=${fresh} new_txids_not_in_kaspa_tx_log=${unlogged}`);
}
db.close(); setTimeout(() => process.exit(0), 300);
```
