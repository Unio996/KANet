# KANet-UI 交件：主网 kaspad 恢复 + console 重启已完成；看门狗注册被拒（待有权限者）；空闲提交仅 ~1–2 GB 需处置

## 第 1–2 步：kaspad 恢复
- 起前核：空闲提交 35.2 GB / kaspad 2.0.1 / sha256 前缀 `8afe6a68` / 17110、16111 空闲 / 无他进程占 appdir。
- 旧日志改名 `kaspad-{stdout,stderr}.crash-20261001T2111Z.log`（只改名）。2026-10-02T14:29:54Z 按 (1065) 原命令起（参数一字未改），**PID 39056**，CommandLine 逐字一致，kaspad.pid 已写。
- 监控日志：`logs/mainnet/kaspad-restart-20261002-monitor.log`（每分钟：空闲提交 / 工作集 / 提交量 / IBD 进度，共约 62 行）。IBD 全程未崩；15:15Z 起 Accepted via relay；15:16Z RPC：isSynced=true、isUtxoIndexed=true、peers=9、virtual DAA 555338857（公共浏览器 555338858）。
- 注：kaspad 自身 15:30Z 工作集 5.75 GB / 提交 6.86 GB；16:3xZ 工作集 6.46 GB / 提交 7.55 GB（缓慢增长，仍在追块/缓存预热阶段）。

## 第 3–4 步：console 重启（Owner 提权停了旧 15720）
- 备份 `data/backups/console.mainnet.pre-restart-20261002b.db`，sha256 `d5d2de9b4f2a2535eb55ad0b3bba08e955314b83f4f2edb1326e66ad57f846c5`；九表行数全一致（proto_markets 3 / proto_bets 3 / proto_bet_intents 3 / proto_settlement_intents 4 / proto_claims 1 / relay_nodes 18 / broker_refund_intents 0 / ktt_holdings_ledger 2 / ktt_panel_rate_limit_log 5）。
- 起前核：旧进程不在、3202 无监听、父为 15720 的子进程 0、relay.mjs 0。`scripts/start-console-mainnet.ps1` 原样启动 → **新 PID 36828（2026-10-02T16:09:32Z）**；env 一字未动；HEAD be8f7c46（相对 94a034e9 非 docs 变化仅 scripts/ 下四个看门狗文件，console 代码零差异）。
- 六项验收：① `DB migrations complete.`，零 error/fatal ✓ ② 无新表；九表对备份一致，仅 ktt_panel_rate_limit_log 5→7（我两次专项探针各计一次限流，预期）✓ ③ `[rpc-health] using local node: ws://127.0.0.1:17110`，relay 同连，零公网回退 ✓ ④ relay.mjs 子进程（CommandLine 过滤）= 18 ✓ ⑤ stderr 5+ 分钟共 6 行，皆既有非致命提示，致命关键词命中 0 ✓ ⑥ proto 两驱动 `started (tick 20000ms)`，无 skipped/actioned，proto_* 五表行数不变 ⇒ actioned=0 ✓
- 专项：`GET /merchant/quote` → 200 ✓。`POST /api/ktt/mint` 先发 `{}` 得 400 但那是 owner_scheme 校验（先于 amount），证明不了新代码；读码确认 `tokens.js:181` 的 amount 校验在任何 relay/UTXO 动作之前，再发"合法 owner（scheme 0 + 32 字节零）无 amount"→ 400 `amount 必须是整数字符串…` ✓（新代码在跑，未花钱）。

## 第 5 步：看门狗 —— 未完成
- `register-kaspad-mainnet-watchdog-task.ps1 -MinFreeCommitGb 8 -DryRun`：正常，显示 RunAs=DESKTOP-DA9QQ46\ADMIN、action = `powershell … -File D:\kanet-tn12\scripts\kaspad-watchdog.ps1 -Profile mainnet -MinFreeCommitGb 8`、**AtStartup + AtLogOn 两个触发器**、Hidden、失败自动重启 999 次/1 分钟、MultipleInstances IgnoreNew、无时限。
- 真注册：`Register-ScheduledTask : Access is denied`（HRESULT 0x80070005）；`Get-ScheduledTask` 核实任务**不存在**。按派工停手，未绕权限。
- 需有权限者执行：`powershell -NoProfile -ExecutionPolicy Bypass -File D:\kanet-tn12\scripts\register-kaspad-mainnet-watchdog-task.ps1 -MinFreeCommitGb 8` 然后 `Start-ScheduledTask -TaskName 'KANet-Kaspad-Mainnet-Watchdog'`；再核任务存在与 `logs\kaspad-mainnet-watchdog.log` 首拍 Alive。
- ⚠ `-MinFreeCommitGb 8` 在当前提交额度下会让看门狗**拒起**（只写日志，效果等同无人拉起）。

## 🔴 空闲提交额度（按派工"跌破 5 GB 报"）
- console 起来后：7.7 GB → 稳在 8 GB 左右；15 分钟后核 **0.9 GB**，随后 2.4 GB（总 94.7 GB）。
- 只读 Top 提交量（PagedMemorySize64）：vmmemWSL 28.1 GB / llama-server 17.0 GB（被数字人守护脚本拉回）/ python 7.8 GB / kaspad 7.6 GB（工作集 6.5 GB）/ 其余 <1 GB。console 与 18 个 relay 合计另占数 GB。
- 这与 10-01 崩溃时的低提交情形一致；kaspad 若再遇额度耗尽会同样 abort。我没杀任何进程。

## 整机重启后的手动步骤（Bettor 问）
- kaspad：看门狗装好（开机触发）才自动起；否则手动用 (1065) 命令。
- console：**不在看门狗里**，需手动 `powershell -File D:\kanet-tn12\scripts\start-console-mainnet.ps1`（原样，env 不碰）；起后按 runbook 六项验收。
- llama-server：由数字人守护脚本自动拉回。
- 先起 kaspad、等 isSynced，再起 console（console 的共享 RpcClient 在 kaspad 重启后不自愈）。
