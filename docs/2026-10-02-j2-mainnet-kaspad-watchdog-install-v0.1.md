# 主网 kaspad 看门狗 · 安装与验收说明 v0.1

> **Status**: CURRENT · 2026-10-02 · J2 · Bettor 派工（Owner「好，主网节点也配个看门狗」；背景账本 (1789)：主网 kaspad 10-01T19:11Z 崩溃，无人拉起空转约 2 小时）。**本分支只交脚本与说明，未注册任何计划任务、未碰主网节点；安装由 KANet-UI 在主网恢复后执行。**

## 1. 是什么（只复用现成，TN12 版行为不变）

不是新写看门狗，而是给现成的 `scripts/kaspad-watchdog.ps1`（TN12 版：只启不杀、60s 一轮、连续 3 次失败才判死、crash-loop 刹车 5 次/300s + 冷却 1800s、日志归档、TESTMODE 钩子）加一个 **`-Profile mainnet`**：

| 项 | TN12（默认，一字未改） | mainnet |
|---|---|---|
| 切换 | 不带参数 | `-Profile mainnet`（或 env `KASPAD_WATCHDOG_PROFILE=mainnet`） |
| exe / 参数 | D-b exe + `--testnet --netsuffix=12 …` | `D:\rusty-kaspa-v201\kaspad.exe --appdir=D:\kaspa-mainnet-data-v201 --utxoindex --rpclisten-borsh=127.0.0.1:17110 --rocksdb-cache-size=2048`（账本 (1065) 原命令） |
| 日志 | `D:\kaspa-tn12-data\` | `D:\kaspa-mainnet-data-v201-logs\`（stdout/stderr 重启前带时间戳归档，不覆盖） |
| 状态文件 | `D:\kaspa-tn12-data\kaspad-watchdog-state.json` | `D:\kaspa-mainnet-data-v201-logs\kaspad-watchdog-state.json` |
| RPC / 网络身份 | 17210 / `testnet-12` | 17110 / `mainnet`（探针核 `getBlockDagInfo().network`） |
| 告警 | 可经 :3200 频道 | **频道已失效，改为只写日志**：详细写 watchdog 日志；起停/拒起/刹车事件另写一行到 `D:\kanet-tn12\logs\kaspad-mainnet-watchdog.log` |

mainnet 的所有值都可用 env 覆盖（`KASPAD_WATCHDOG_EXE / _ARGS / _APPDIR / _RPC_PORT / _NETWORK / _LOGDIR / _EVENT_LOG / _STATE / _TICK_SEC`），验收就是这样用 simnet 跑的。

## 2. 四个必改的坑（Bettor 派工单）怎么落的

1. **判活不按进程名**：本机常驻多个测试 `kaspad.exe`（现有 3040/35848/42360 + 验收诱饵）。mainnet 判活 = **"监听 17110 的 PID 且其 CommandLine 含 `--appdir=D:\kaspa-mainnet-data-v201`"**（`Get-MainnetNodeProc`；appdir 匹配按整词，`…-v201-logs` 不会误中，斜杠方向不敏感）。探针里"有无本节点进程"（code 9 的依据）同样改按 appdir，不再 `tasklist /IM kaspad.exe`（环境变量 `KASPAD_PROBE_APPDIR`，未设时探针行为不变）。RPC 在答但口主人不是我们的进程 ⇒ 记 Fail（不算活）；**口主人 CommandLine 读不到**（别的权限上下文起的进程，本机已见 3 个常驻节点 CommandLine 长度为 0）⇒ 记 Unknown（不重启、不累计、LOUD 一行），不冤判。
2. **启动前拒起守卫**（防双开踩库）：17110 已被任何进程占用 ⇒ 拒起；同 appdir 的 kaspad.exe 已在（哪怕还没监听）⇒ 拒起；进程枚举失败 ⇒ 拒起（fail-closed）。拒起只写日志，不杀任何东西，failCount 不清零，下一轮再判。
3. **告警走频道那段已失效** ⇒ mainnet 下 `Try-BroadcastChannel` 直接返回，改写事件日志。
4. **隐藏窗口 + 带时间戳的崩溃日志归档**：`Start-Process -WindowStyle Hidden`（原脚本即如此）；`Archive-IfExists` 每次重启前把上一轮 stdout/stderr 改名加 `.yyyyMMdd-HHmmss`（原脚本即如此，主网沿用）。另加：**单实例互斥量**（开机 + 登录两个触发器各拉一份时第二份直接退出）。

## 3. 安装（一行；由 KANet-UI 在主网恢复后执行）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\kanet-tn12\scripts\register-kaspad-mainnet-watchdog-task.ps1
Start-ScheduledTask -TaskName 'KANet-Kaspad-Mainnet-Watchdog'
```

- 先预演（什么都不注册，只打印将注册的内容）：加 `-DryRun`。卸载：加 `-Unregister`。
- 任务：开机(AtStartup) + 登录(AtLogOn) 两个触发器，`Hidden`，失败自动重启（999 次/1 分钟间隔），`MultipleInstances IgnoreNew`，无执行时限。
- 默认以**当前用户 + S4U** 运行（开机即启、不存密码、为自己注册不需要管理员）。`-RunAsUser SYSTEM` 更耐久但需管理员注册，且 SYSTEM 起的 kaspad 其 CommandLine 对普通用户不可读（看门狗对此记 Unknown 不冤判，但不如同用户省心），**默认不选**。
- 注意：**接管前先确认 17110 上要么没有节点、要么是用同一条 `--appdir=D:\kaspa-mainnet-data-v201` 命令起的节点**。看门狗只启不杀：节点活着时它什么都不做；如果现有节点的 CommandLine 读不到，它会 LOUD 记 Unknown 并且不动它。
- 验证安装：`Get-ScheduledTask -TaskName 'KANet-Kaspad-Mainnet-Watchdog' | Select State,LastRunTime,LastTaskResult`，然后看 `D:\kanet-tn12\logs\kaspad-mainnet-watchdog.log` 首行 `mainnet watchdog started (port=17110 …)`。

## 4. 🔴 内存闸（必须知道）

沿用 TN12 版的 memgate：拉起前读 `FreeVirtualMemory`，**低于阈值就拒起（fail-closed）**，看门狗脚本默认阈值 **8 GB**。2026-10-02 在这台机器上实测空闲提交量在 **0–4 GB 与 19–20 GB 之间来回跳**（整机 Total Virtual ≈ 111 GB，被其它进程吃满时掉到接近 0）。⇒ 用 8 GB 默认值时，提交量吃紧的那一刻主网 kaspad 崩了，看门狗会拒起并写 `kaspad refuse-start:low-commit free=…`，**效果与 10-01 的"无人拉起"相同（至少有日志）**。同一原因也让 TN12 版的 `kaspad-watchdog-enable-va.test.ps1` 在本机 2 项 FAIL（改成 `KASPAD_MIN_FREE_COMMIT_GB=0` 后 8/8 全过，见 §6）。

- **安装脚本默认 `-MinFreeCommitGb 2`**（写进任务参数；`-MinFreeCommitGb 0` = 用看门狗默认 8）。2 GB 只挡"空闲提交量几乎为 0 的极端情形"。
- **阈值取多少是 Bettor/KANet-UI 的裁定**：主网 kaspad（`--rocksdb-cache-size=2048`）实际提交量需求我没有实测；脚本本体的默认 8 未改（保持与 TN12 版一致）。

## 5. 行为一览

- 每 60s 一轮（`KASPAD_WATCHDOG_TICK_SEC` 可调，仅 mainnet）；探针 = `kaspad-rpc-probe.mjs`（连 17110、核 `network==mainnet`、`virtualDaaScore>0`、`isSynced`）。
- Alive/Syncing/Stalled：不重启（Stalled 只告警）。Fail/Dead：计数；**连续 3 轮**（≈3 分钟）才判死。Unknown（探针自坏/CommandLine 读不到）：不计数、不重启。
- 判死后：刹车闸（5 次/300s，之后冷却 1800s，日志 `CRASH-LOOP DETECTED … OPERATOR ACTION NEEDED`）→ 内存闸 → **拒起守卫** → 归档上一轮日志 → 隐藏窗口起 kaspad → 记 PID 与创建时间 → 8s 后补一次探针。
- 只启不杀：看门狗不 kill 任何进程。

## 6. 验收（simnet，同款 2.0.1 二进制、独立 appdir 与端口；不碰主网节点）

`scripts\kaspad-watchdog-mainnet.test.ps1`（真起真杀，约 10 分钟）。结果见 `docs/provenance/2026-10-02-j2-mainnet-kaspad-watchdog/accept.log`：

- S1 节点不在 ⇒ ≤180s 被拉起（命令行含 appdir、事件日志有 START、日志重定向文件生成、诱饵节点未被碰）
- S2 节点活着 ⇒ 观察 100s PID 不变、无额外 START
- S3 杀节点（诱饵同名 kaspad.exe 仍在）⇒ ≤180s 重新拉起，事件日志有 DEAD→START
- S4 端口被别的进程占 ⇒ 拒起（`refuse-start:port-busy`），不双开
- S5 同 appdir 的 kaspad.exe 已在但没监听 ⇒ 拒起（`refuse-start:same-appdir-running`）
- S6 连续崩溃（EXE 换成秒退桩）⇒ 恰好 5 次启动后触发 `CRASH-LOOP DETECTED`，不再第 6 次
- 测试前后主网口 17110 的主人不变（只读对照）

TN12 版回归（`tn12-regression.log`，**原版 HEAD 与改后逐项对照，结果完全一致**，TN12 数据目录因 TN12 已退役而用临时目录代替，真实目录未碰）：`kaspad-watchdog-va.test.ps1` 25/25；`kaspad-rpc-probe.test.mjs` 4/4；`kaspad-watchdog-enable-va.test.ps1` 原版与改后同为 6 过 2 败——2 败是本机空闲提交量低于 8GB 内存闸所致（`KASPAD_MIN_FREE_COMMIT_GB=0` 复跑改后版 8/8，见该日志末段）。

## 7. 已知局限（如实）

- 内存闸见 §4：阈值太高会让它在提交量吃紧时拒起（安装默认 2GB）。
- 探针对"节点进程根本没起"报 code 4（连接超时）而不是 code 9：因为 kaspa-wasm 的 connect 会先超时；两者在看门狗里同样计入 Fail，不影响拉起，只是原有 code 9 路径在此环境不易触发。
- `Get-CimInstance` 偶发瞬时失败（验收中出现过 1 次）：拒起守卫 fail-closed（那一轮不拉，下一轮重判）。
- 看门狗只验"节点在答"，不验"节点数据是否健康"（IBD 重启后的恢复由 console 重启流程另管）。
- 本说明未涉及 console/relay 的联动（节点恢复后 console 需重启，见账本 (1789)）。
