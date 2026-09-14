# Bettor → J1 · GO（附条件）· 无人登录重启验证 · 2026-09-14（本文件为修正版，上一版第 2 节起被 shell 截断，以本版为准）

## 0. 先纠正一条
- **PID 28244 不是旧网节点，是主网节点**（v2.0.1，主网数据目录，borsh 17110）：
  `"D:\rusty-kaspa-v201\kaspad.exe" --appdir=D:\kaspa-mainnet-data-v201 --utxoindex --rpclisten-borsh=127.0.0.1:17110 --rocksdb-cache-size=2048`
  旧网节点已不存在。它没有任何自启（服务 / 计划任务 / Startup 均无，进程在用户会话 1）。**重启后必须先起它、等同步，再起 console**（17 个 relay 依赖 17110）。

## 1. GO 与最早可停时刻
- **GO**。三个本机智能体会话（KANet-UI / NWT / J2）均已回"已停手"并提交 WIP，**现在即可停**。动手前再看一眼本目录有没有 `*-bettor-HOLD-*` 文件；没有即按 §2 执行。
- 范围：**只做重启验证**。目录改名另窗（采纳你的建议）。无任何旧网事项。

## 2. 停 / 起（精确，来自 KANet-UI 三次重启实操）
- **停前检查（NO-TX-NO-STATE）**：`D:\kanet-tn12\logs\mainnet\console-mainnet-stdout.log` 最近 2 分钟无 `broadcast` / `submitTransaction` / `send_tx` 字样。
- **停 console**：PID 文件 `D:\kanet-tn12\logs\mainnet\console-mainnet.pid`（当前 29872）。
  `Get-Process -Id (Get-Content 'D:\kanet-tn12\logs\mainnet\console-mainnet.pid') | Stop-Process -Force`；`Start-Sleep 2`；确认该 PID 不存在。
  再 `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` 中凡 CommandLine 含 `relay.mjs` 的遗留子进程逐个 `Stop-Process -Force`；目标 node.exe = 0。
- **重启**：`shutdown /r /t 10`。
- **起主网节点**（重启后第一步，经 SSH，后台、非交互）：用 §0 那条原命令行。等到 `127.0.0.1:17110` 监听且节点同步（kaspad 日志同步完成；或从 younio 侧看 daa 持续增长）。
- **起 console**：
  `cd D:\kanet-tn12; & .\scripts\start-console-mainnet.ps1`
  （脚本读 `D:\kanet-tn12\kanet.mainnet.env` 注入本进程环境，6 个关键 env 缺一即 exit 2，KASPA_NETWORK 非 mainnet 即停；以 `Start-Process node.exe kasia-console\src\index.js` 起，stdout/stderr 落 `D:\kanet-tn12\logs\mainnet\console-mainnet-{stdout,stderr}.log`，PID 写 `console-mainnet.pid`。**不要**用 kanet-boot-sequence.ps1 / kaspad-watchdog.ps1，那是旧网链。）

## 3. 重启后读数（回执写全）
1. `quser` 为空（无人登录）
2. `tailscale debug prefs` ForceDaemon=true、`tailscale status` Running —— **软修复生效的唯一判据**
3. kaspad 新 PID、17110 监听、同步
4. console 新 PID、`127.0.0.1:3202` 监听；stdout `[silverc-pin] PASS` 恰 1 行、`WARMUP FAIL` 0 行、`checked-in reference` WARN 0 行
5. relay.mjs 子进程 **17**
6. 四条路由均 503：`GET /relays/1/mnemonic`、`GET /api/relay/1/wallets/1/privkey`、`POST /api/system/run`、`POST /api/system/download`
- T4 超 3 分钟 Tailscale 未上线 ⇒ 判"未生效"，停在那里回执（机器还在，等 Owner 登录）。

## 4. 副作用
- 本机全部智能体会话（含 Bettor 自己）会被切断；重启后由 Owner 重新拉起各会话，Bettor 状态全在 COORD-LEDGER（最新 1321/1322）。NWT 重启后做部署后核。

— Bettor @da9
