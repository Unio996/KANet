# 主网只读节点启动 · J1 执行页 v0.1（2026-09-13 · KANet-UI · Bettor 派工·Owner 已拍：本轮只拉主网节点、与 TN12 并存、不先停 TN12）

> **Status: READY-FOR-EXECUTION**。权威：`docs/DECISIONS.md` D-017 + COORD-LEDGER Bettor 本次派工。范围收窄自 `docs/2026-09-13-kanetui-tn12-retire-mainnet-node-runbook-v0.1.md` §4（那份是"退役+起主网"的完整 runbook，GO-1 待 Session 0 触发源定位；**本页只做"起主网节点"这一件事，独立于那份 runbook 的 GO 门，不涉及停 TN12 任何一步**）。所有数字本页作者亲手实测于 2026-09-13，未核对的一律标 TBD。

## 1. 二进制（已验证，不需要下载）
- 路径：`D:\rusty-kaspa-v201\kaspad.exe`
- sha256（**这是 exe 文件本身的哈希，不是 release zip 的哈希**——本机 `sha256sum D:\rusty-kaspa-v201\kaspad.exe` 实测）：
  ```
  8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38
  ```
- `--version` 期望输出：`kaspad 2.0.1`（已核实一致）。
- 来源可追溯：该 exe 解压自官方 `kaspanet/rusty-kaspa` release `v2.0.1`（"Mainnet Toccata Release"）`rusty-kaspa-v2.0.1-win64.zip`，zip 本身 sha256（GitHub API digest，非本机算）= `bec0710079baa612fa0776af9460ae8106193b6458974eb2ebdb9e233383bce8`，本机该 zip 文件（`D:\rusty-kaspa-v201\rusty-kaspa-v2.0.1-win64.zip`）逐字节核对过与此一致（见 runbook v0.1.3 §4.1）。

## 2. datadir
- **新目录：`D:\kaspa-mainnet-data-v201`**（Bettor 裁，2026-09-13）。
- 本机核实：此目录**目前不存在**（`ls D:\kaspa-mainnet-data-v201` 报 No such file or directory）——干净新建，不涉及任何旧数据判断/清理决策。
- **不要用** `D:\kaspa-mainnet-data`（旧目录，04-09 遗留，≈37 GB 陈旧试验数据，Bettor 明确裁定**不动不复用**——见 runbook §4.2，那笔债留给另一次处置，本页不碰它）。

## 3. 启动命令

### 3.1 端口预检（启动前跑，确认无冲突）
本机 2026-09-13 实测全部空闲：
```powershell
foreach ($p in 16110,16111,17110,17111,18110) {
  $inUse = (Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue)
  if ($inUse) { "端口 $p : 占用中 (PID $($inUse[0].OwningProcess))" } else { "端口 $p : 空闲" }
}
```
🟡 **17111 说明**：`kaspad.exe --help` 里没有任何默认端口是 17111（confirmed 官方默认：gRPC 16110 / P2P 16111 / borsh RPC 17110 / JSON RPC 18110——**16111 是 P2P 端口，不是 17111**，17111 目前不对应本二进制任何已知默认监听）。Bettor 派工原话要求预检这个端口，本页照办列了，但如实标注：不确定它具体对应什么、为何要查——若只是想确认"17110 borsh 端口附近没有别的东西"这类保守预检，那就是它的意义；若期望它是某个具体服务的端口，需要 Bettor/J1 澄清，本页不代为编造理由。

### 3.2 启动命令
```powershell
& "D:\rusty-kaspa-v201\kaspad.exe" `
  --appdir=D:\kaspa-mainnet-data-v201 `
  --utxoindex `
  --rpclisten-borsh=127.0.0.1:17110 `
  --rocksdb-cache-size=2048 `
  *> "D:\kaspa-mainnet-data-v201-logs\kaspad.log"
```
（先 `New-Item -ItemType Directory -Force D:\kaspa-mainnet-data-v201-logs` 建日志目录，日志与链数据分开放，不与 datadir 混）。

- **不带** `--testnet` / `--netsuffix`（这就是不加任何网络覆盖 flag = 默认 mainnet，`kaspad.exe --help` 确认）。
- **不带** `--enable-unsynced-mining`（TN12 专用的 bootstrap 挖矿绕过，主网只读节点不挖矿，不需要）。
- **不带** `--unsaferpc`（会打开修改节点状态的 RPC 命令，只读节点不需要，也是暴露面）。
- `--rpclisten-borsh=127.0.0.1:17110`：**显式回环绑定**，不用裸 `--rpclisten-borsh`（那样默认可能绑 `0.0.0.0`，TN12 早期就吃过这个暴露面的亏，2026-07-28 才修成显式回环——主网从第一天就该这样，不要重蹈）。
- `--rocksdb-cache-size=2048`：**起点保守值，非最终值**。本机现空闲 RAM 只有 **33.1 GB**（比 Bettor 稍早引的 42.2 GB 又低了——见 §6，趋势下降，建议保守）；TN12 那边 kaspad 用 `4096` 实测工作集 15–28 GB。给主网节点起步用一半（2048）留更多余量，同步稳定后如需要再调大，不是本次必须一步到位。
- 建议加 `--log-level=info`（若嫌默认日志噪音大可选，非必须，本页不强制）。
- 若要放后台跑而不占终端：改用 `Start-Process`（见 §3.3）。

### 3.3 后台启动（推荐，终端可关）
```powershell
Start-Process -FilePath "D:\rusty-kaspa-v201\kaspad.exe" `
  -ArgumentList @("--appdir=D:\kaspa-mainnet-data-v201","--utxoindex","--rpclisten-borsh=127.0.0.1:17110","--rocksdb-cache-size=2048") `
  -RedirectStandardOutput "D:\kaspa-mainnet-data-v201-logs\kaspad-stdout.log" `
  -RedirectStandardError "D:\kaspa-mainnet-data-v201-logs\kaspad-stderr.log" `
  -WindowStyle Hidden -PassThru
```
返回的 `.Id` 就是 PID，记下来用于 §4 核查。**不需要提权**——TN12 那台 kaspad 本身也不需要提权起（见记忆 `reference-kaspad-needs-no-elevation`），只是它现在跑在 Session 0 里（另一个问题，见 runbook §1.2），不代表启动这个动作本身需要管理员。

## 4. 起后核查

1. **进程存在**：`Get-Process -Id <上面记的PID>` 或 `Get-Process kaspad` 应看到新增一个（**这台机现在会有两个 kaspad.exe 同时在跑，TN12 那个 PID 不变，主网这个是新的**，别搞混）。
2. **日志 banner**：`Get-Content "D:\kaspa-mainnet-data-v201-logs\kaspad-stdout.log" -Tail 30`（或 `-stderr.log`，kaspad 有些版本把启动 banner 打在 stderr），应看到版本号含 `2.0.1`；**不应看到任何 `testnet`/`tn-12` 字样**（TN12 那边日志会有这些，主网这边不该有——这是最快的"没手滑连成 TN12"检查）。
3. **`kaspad.exe --version`**：独立于运行中进程，随时可单独跑核对二进制本身，期望 `kaspad 2.0.1`（§1 已核，这里是给 J1 自己再核一次的命令）。
4. **RPC 层核查（推荐复用本仓现成探针，不用新写）**：
   ```powershell
   $env:KASPAD_PROBE_URL = "ws://127.0.0.1:17110"
   $env:KASPAD_PROBE_NETWORK = "mainnet"
   node scripts/kaspad-rpc-probe.mjs --timeout-ms=8000
   ```
   这支脚本（`scripts/kaspad-rpc-probe.mjs`）注释里写的是给 TN12 watchdog 用的，但连接参数走环境变量覆盖，**功能上对任何网络都适用**，不用为主网另写一份。**退出码含义**（脚本头注释里全套）：`0=ALIVE`（已同步且数据正常）、`7=SYNCING`（IBD 中，这是刚起步时的**正常**状态，不是故障）、`8=STALLED`（同步中但长时间零进度，才是真正该关注的）、`2=wrong-network`（连上了但不是 mainnet，立刻停下核参数）、`5=connect-fail`（RPC 没起来/端口错）。**刚起步大概率会看到 7=SYNCING，这是预期，不用慌。**
5. **IBD 进度读法**：`getBlockDagInfo()` 里的 `virtualDaaScore` 会持续增长即为在推进；日志里 `Processed N blocks and M headers in the last 10.00s` 这行（TN12 那边现在就在稳定打这行）出现即说明进入正常处理节奏。没有现成的"到 100% 还剩多久"倒计时命令，人工看 daaScore 增长速率自行估。

## 5. 禁止项（本次执行边界，越界的都不在 Owner 这次拍板范围内）
- **不接入** `kaspad-watchdog.ps1` / `kanet-boot-sequence.ps1`——这次是独立手动起，不进任何自动重启/开机自启链路。若要接入，是另一次独立决定（且要先解决那两个脚本现在管的是 TN12、需要另开一套主网专属 watchdog，不是改现有的）。
- **不改** console 的 env / `KASPA_NETWORK` 配置——console 目前只服务 TN12，本次只是让主网节点物理上跑起来，不涉及接入 console。
- **不碰**：`/d/rusty-kaspa`（源码树，跟这个预编译二进制无关）、`D:\kaspa-tn12-data`（TN12 数据）、任何 TN12 相关进程（kaspad 16644、两个 kaspad-watchdog 实例、mining-watchdog-v2、stratum-bridge——这些都不受本次操作影响，也不该被本次操作影响）。
- **不需要管理员权限**（§3.3 已说明）。

## 6. 并存期资源核（一行，本机现值，2026-09-13 实测）
- RAM：总量 61.6 GB / **现空闲 33.1 GB**（比 Bettor 10:07:36Z 引用的 42.2 GB 低——中间发生过 node_modules 事故修复+两次 worktree 相关操作，趋势往下，起节点前建议再看一眼当时空闲值，别机械套用本页这个数字）。
- 磁盘：D: 总 1.5T，现空闲 **758 GB**（官方最低 640 GB，余量仍充足）；TN12 datadir 现用 **157 GB**（较此前 158 GB 基本持平）。

## 7. 未完成事项（本页故意留白）
- 预计同步时长：**TBD**，官方文档与本仓都没有可引用的主网 IBD 实测坐标，起来之后拿真实 daaScore 增长速率自己估，本页不编数字。
- `--rocksdb-cache-size=2048` 是否够/该不该调：起步保守值，同步几小时后看内存曲线再定，非本页范围。
- §3.1 的 17111 端口澄清：如上，待 Bettor/J1 说明其用意。
