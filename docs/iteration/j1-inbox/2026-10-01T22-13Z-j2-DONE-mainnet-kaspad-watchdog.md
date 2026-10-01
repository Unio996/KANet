# J2 交件：主网 kaspad 看门狗（Bettor 派工，Owner「主网节点也配个看门狗」，账本 (1789) 背景）

分支 `coord/j2-mainnet-kaspad-watchdog-20261002`（worktree `scratch/_j2_wt_mn_watchdog`，未用 junction，kasia-relay 在 worktree 内自己 npm install）。**未注册任何计划任务、未碰主网节点与主网端口/目录、未改生产检出。** 安装说明：`docs/2026-10-02-j2-mainnet-kaspad-watchdog-install-v0.1.md`；证据：`docs/provenance/2026-10-02-j2-mainnet-kaspad-watchdog/`。

## 做了什么（只复用现成）
- `scripts/kaspad-watchdog.ps1` 加 `-Profile mainnet`（默认 tn12，原行为不变）：exe/参数/appdir/RPC 端口/日志目录/状态文件/事件日志全部参数化，主网默认值 = (1065) 原命令与 `D:\kaspa-mainnet-data-v201-logs\`；env 可覆盖（验收用）。
- `scripts/kaspad-rpc-probe.mjs`：新增 `KASPAD_PROBE_APPDIR`——"有无本节点进程"按 CommandLine 含 `--appdir=` 判，不再按进程名（未设时行为不变）。
- 新 `scripts/register-kaspad-mainnet-watchdog-task.ps1`（写法照 register-console-supervisor-task.ps1）：开机+登录自启、隐藏、失败自动重启，`-DryRun` 预演 / `-Unregister` 卸载；默认当前用户 S4U。
- 新 `scripts/kaspad-watchdog-mainnet.test.ps1`：simnet 验收。

## 四个必改的坑
1. 判活 = "监听 17110 的 PID 且其 CommandLine 含 --appdir=D:\kaspa-mainnet-data-v201"（整词匹配，`…-logs` 不误中）；口主人 CommandLine 读不到 ⇒ Unknown（不重启、不冤判）。
2. 拒起守卫：17110 已被占 / 同 appdir 进程已在 / 进程或端口枚举失败（fail-closed）⇒ 拒起，只写日志。
3. 频道告警下线：mainnet 只写 watchdog 日志 + 事件日志 `D:\kanet-tn12\logs\kaspad-mainnet-watchdog.log`（起停/拒起/刹车一行制）。
4. Hidden 启动 + 带时间戳归档 stdout/stderr（沿用原机制）；另加单实例互斥量（开机+登录两触发器不双开）。

## 验收（simnet 同款 2.0.1 二进制、独立 appdir/端口，22/22）
S1 节点不在 ⇒ 48s 拉起；S2 活着 100s 不重起；S3 杀节点 ⇒ 54s 拉起（同名诱饵 kaspad.exe 在场不影响判死）；S4 端口被占 ⇒ 拒起；S5 同 appdir 进程已在 ⇒ 拒起；S6 连续崩溃 ⇒ 恰好 5 次后刹车；测试前后主网 17110 口主人不变。
TN12 回归：原版 HEAD 与改后逐项对照结果完全一致（va 25/25、probe 4/4、enable-va 6 过 2 败）；TN12 数据目录已退役，回归用临时目录代替，真实目录未碰。

## 🔴 需要 Bettor 裁的一件事：内存闸
看门狗沿用 TN12 版 memgate（空闲提交量 < 8GB 拒起）。本机 2026-10-02 实测空闲提交量在 0–4GB 与 19–20GB 间来回跳，所以 TN12 版 enable-va 测试在本机 2 项败（阈值设 0 后 8/8）。用默认 8GB 时，提交量吃紧的时候主网 kaspad 崩了会被拒起（有日志，但等于又没人拉）。**安装脚本默认 `-MinFreeCommitGb 2`**，脚本本体默认 8 未改；主网 kaspad 的真实提交量需求我没测，阈值取多少请你/KANet-UI 定。

## 如实的局限
- 探针对"节点进程没起"报 code 4（连接超时）而非 code 9，二者都计入 Fail，不影响拉起。
- 验收中 `Get-CimInstance` 偶发瞬时失败一次，守卫 fail-closed（那轮不拉、下轮重判）；另在验收中发现并修了我测试夹具的缺陷（堵口进程被探针 RST 打崩）与端口查询失败误当"没人监听"的 fail-open 风险（已改为失败 ⇒ 拒起）。
- 看门狗只验"节点在答"，不验数据是否健康；节点恢复后 console 需重启（账本 (1789)）不在本脚本内。
