# 主网账号迁移 · 第 3 批（NWT，540.15 KAS）执行证据（2026-09-14 · KANet-UI · Bettor 1294 派工 · Owner 常设批准）

> 执行依据：执行页 v0.1（`docs/2026-09-14-kanetui-mainnet-migration-batch3-nwt-exec-v0.1.md`，commit `53d7eb7e`）。**本页不含任何密文/明文密钥材料**——地址是公开链上信息，余额是只读查链结果。

## 结论

| 项目 | 结果 |
|---|---|
| 导入行数 | **1 / 1**，一次通过（无 mismatch、无 denied） |
| 启动数 | **1 / 1**（health-monitor 下一次 tick 即拉起，`eligible 16→17 deadCount=0`） |
| 驻留余额（本批） | **540.152 KAS**（与迁移 runbook §5 基线 540.15205663 一致） |
| 累计驻留余额（批1+2+3） | **≈584.04 KAS**，仍远低于 total cap 1000；本批单行离 per-relay 上限 800 仅剩约 260 余量——**本会话首次在有意义量级下考验 per-relay 上限，通过** |
| 驻留期监控 tick 摘要 | 观察窗口内 2 次 tick，`checked=17 killed=0`，零杀 |
| `events.hotwallet_relay_killed` | 导入前后均 `0` |
| stderr FATAL/error | 观察窗口内 `0` |

## §1 执行前检查（全部通过）

- `C:\KANet` 下无 node 进程，`:3100`/`:3200` 均未监听。
- 当前 mainnet console：PID `18320`（偏移派生线重启后的 PID，本次执行当天重新核实未漂移），`127.0.0.1:3202` 监听中。
- `kanet.mainnet.env` 三个准入门键核实未变：`RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800`、`RELAY_HOTWALLET_TOTAL_MAX_KAS=1000`、`RELAY_HOTWALLET_COLD_ADDRESSES` 含两个地址；当前进程 stdout 命中 `[relay-hotwallet-monitor] started` 1 次。
- 批1+批2 累计 16 行仍健康：目标库只读核得 16/16，`relayHealthMonitorTick` 最近几次 tick 均 `eligible=16 deadCount=0`，`events.hotwallet_relay_killed` 仍为 `0`。
- 源库（`C:\KANet\kasia-console\data\console.db`）只读查得 1 行（`NWT`），逐字匹配名单。
- 目标库（`console.mainnet.db`）执行前 `NWT` 这个名字 `COUNT=0`，确认非重复导入。

## §2 拒绝场景验证（复用 Trader-B 冷地址，一次通过，无需清理）

- 探针：`POST /relays`，`name=zzz-admission-probe-1789374229501`、`address=<Trader-B 冷清单地址>`、无 `mnemonic`。
- 响应：`302`，`Location: /relays?hotwallet_denied=cold_address_denied`。
- 复核：`relay_nodes` 里 `name LIKE 'zzz-admission-probe-%'` 计数 `0`。

## §3 导入结果（1/1）

| name | address | 派生比对 | 导入结果 | 链上余额（本人只读核实） |
|---|---|---|---|---|
| NWT | `kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm` | match | 302 `/relays`（未拒） | 540.152 KAS |

导入后新库逐行 `SELECT` 复核：`address`/`network='mainnet'` 与源库逐字一致（新库 id `83c9be27-6c2e-4388-a690-560dc1b0c24d`）。明文助记词在 `POST` 调用返回后立即从变量中丢弃，脚本全程只 `console.log` 过 `name`/`step`/`status`/`location`/比对结果，从未打印助记词或旧密钥（脚本源码 `kasia-console/scratch/_kanetui_batch3_migrate.mjs`，复用批1/批2方法，`scratch/` 目录 gitignored，不会进 git）。

## §4/§5 观察（≥90s 窗口）

- `relayHealthMonitorTick`：连续 2 次 tick 均 `eligible=17 deadCount=0`。
- `relayHotwalletMonitorTick`：连续 2 次 tick 均 `checked=17 killed=0`——540.15 KAS 远低于 per-relay 800 上限（仍有约 260 余量），累计 584.04 KAS 远低于 total 1000。
- 子进程核实：`Get-CimInstance Win32_Process -Filter "ParentProcessId=18320 AND Name='node.exe'"` 查得 **17 个**（批1批2的16+本批1）。
- `events` 表：`event_type='hotwallet_relay_killed'` 计数，导入前 `0`，观察窗口结束后仍 `0`。
- stderr：观察窗口内无新增 `FATAL`/`error` 行。

## §6 回滚

本批未触发任何回滚条件，§6 四步流程本次未使用。

## 结论

1/1 全部按执行页 v0.1 流程一次通过，无需任何回滚/清理分支。本批首次在有意义量级（540.15 KAS，离 800 上限约 260 余量）下考验 per-relay 上限，通过——两层准入门（拒绝场景探针 §2 + 实际导入观察 §4/§5）均确认按设计工作。批1+2+3累计17个relay子进程在跑，合计约584.04 KAS。

原始日志留档：`console-mainnet-stdout-PID18320.log` / `console-mainnet-stderr-PID18320.log`（本目录内独立副本，已核实 zero 64-hex 序列）。
