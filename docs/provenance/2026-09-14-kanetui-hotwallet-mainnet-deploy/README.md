# 主网热钱包准入门+驻留期监控 部署证据（2026-09-14 · KANet-UI · Bettor 1174/1175 派工执行）

> 执行范围：合入 `coord/kanetui-hotwallet-caps`（8 笔，NWT 全 GREEN，Codex HOLD 已解，Bettor `--no-ff` 合入主线 `60b2f026`，`b3606cc1` 确认已推）之后的部署验证——`kanet.mainnet.env` 写入三个准入门 env 键 + 重启主网 console + 重启后验证。**本次不导入任何账号**，账号迁移另派（迁移 runbook v0.6 第 4 批仍等 Owner/NWT 后续裁）。

## 时间线（UTC，`date -u` 实取，非手打）

- 停旧进程（PID `12404`，2026-09-13 22:54:02 UTC 起，主线合入前的旧构建）。
- 起新进程（PID `15396`，`scripts/start-console-mainnet.ps1`，用合入后的主线代码 `b3606cc1` + 新写入的三个 env 键）。
- 重启后 stderr 观察窗口 ≥65s（同 GO-D 系列验收惯例），`date -u` 核实执行时点 = `2026-09-13T20:23:22Z`（机器本地日历日期显示 09-14，UTC 仍是 09-13 —— 时区偏移，不是日志陈旧，本条特意记录避免下一个人按本地日期误判日志新旧）。

## ① git pull --ff-only

共享检出（`D:\kanet-tn12`，分支 `bshard-m3-deploy`）本地 HEAD 与 `origin/bshard-m3-deploy` 在执行前已经**逐字相同**（`b3606cc1a3b9fc983e53b94fb9c0f8cb273ffb9a`）——这是共享检出模型的直接结果：Bettor 的合入+推送发生在同一个本地 `.git`，本 session 不需要额外 `pull` 就已经在合入后的头上，`git fetch` 核实过 `HEAD..origin` 与 `origin..HEAD` 两个方向的日志都是空（无需 fast-forward）。

合入后全仓 `node scripts/lint-kanet.mjs`：**954 文件，0 error**（含 M0a manifest/baseline 相关检查）。

## ② `kanet.mainnet.env` 三键（本文件 gitignored，不进 git，这里只记键名+来源，不贴实际私钥/助记词类内容——三个键本身都是公开信息：地址、数字上限）

```
RELAY_HOTWALLET_COLD_ADDRESSES=kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l,kaspa:qqkulfjva2r20f3zj3hzs3hwh869zrezdz2rqm4nd9tfpdw2upsxqvkk6rhw4
RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800
RELAY_HOTWALLET_TOTAL_MAX_KAS=1000
# HOTWALLET_MONITOR_OFF 未设（驻留期监控默认启用）
```
第一个冷清单地址是 Trader-B，第二个是 MarketMaker-A（迁移 runbook §1.3/§5 独立核实过的地址）。800/1000 是 Owner 1168 未要求调整的定案值（NWT 2-1 v0.1 §3 建议值）。

## ③ 重启前探针基线

| 项目 | 读数 |
|---|---|
| 旧 PID | `12404`（`Get-Content logs\mainnet\console-mainnet.pid`，`Get-Process` 核实 StartTime=`2026-09-13 22:54:02`）|
| kaspad 探针 | `ALIVE:network=mainnet daa=539105907`（`kaspad-rpc-probe.mjs --timeout-ms=8000`）|
| `relay_nodes` mainnet 行数 | `0`（只读 `SELECT COUNT(*)`，`console.mainnet.db`）|
| `events.event_type='hotwallet_relay_killed'` 计数 | `0`（只读 `SELECT COUNT(*)`）|
| `C:\KANet` 下 node 进程 | 无（`Get-Process \| Where Path -like 'C:\KANet*'` 空结果）|
| `:3100`/`:3200` 监听 | 均未监听（`Get-NetTCPConnection` 空结果，旧系统确认关闭）|
| 当前 `:3202` 监听 | `127.0.0.1:3202 Listen OwningProcess=12404`（重启前确认）|

## ④ 重启动作

1. `Get-Process -Id 12404 | Stop-Process` → 立即回读确认 PID 12404 不存在。
2. `powershell -File scripts\start-console-mainnet.ps1` → 输出：
   ```
   [start-console-mainnet] 环境变量已注入，KASPA_NETWORK=mainnet PORT=3202 DB_PATH=D:/kanet-tn12/kasia-console/data/console.mainnet.db
   [start-console-mainnet] 已起，PID=15396，写进 D:\kanet-tn12\logs\mainnet\console-mainnet.pid
   ```

## ⑤ 重启后验证

| 检查项 | 结果 |
|---|---|
| 新 PID | `15396`（`console-mainnet.pid` 文件核实）|
| `:3202` 监听 | `127.0.0.1:3202 Listen OwningProcess=15396`（重启后重新核实）|
| 准入门 env 生效标志 | `startRelayHotwalletMonitorCron()` 只在至少一个 cap env 设置时才启动 tick——启动日志出现该行本身就是 env 生效的证据（见下） |
| 驻留期监控初始化行 | `stdout:72` `[relay-hotwallet-monitor] started — tick=30000ms grace=90000ms max_consecutive_failures=3` |
| `relayHealthMonitorTick`（第八笔 MUST-FIX 部署验证） | `stdout` 出现 `[diag:tick-duration] relayHealthMonitorTick ms=0 eligible=0 deadCount=0`——0 个候选是因为 relay_nodes 目前是空表（本次未导入账号），逻辑正常运行，还没有真实候选可以验证节流行为，节流本身的功能验证已经在侧分支单测里 7/7 覆盖过 |
| UNMET/MODULE_NOT_FOUND | 全文 `grep` 0 命中（`console-mainnet-stdout-PID15396.log`/`console-mainnet-stderr-PID15396.log`，本目录留档副本） |
| FATAL（65s+ 观察窗口） | stdout 124 行 + stderr 4 行，`grep -i FATAL` **0 命中** |
| stderr 全文（4 行，均为已知的保守起步/未配置提示，非错误） | 见本目录 `console-mainnet-stderr-PID15396.log`：`[migrate] v199` 索引未建提示（既有已知项，非本次引入）/ `[zk-prove-server]` 未配 token fail-closed / `[external-gateway]` 未配置 fail-closed / `[oracle-pool-scanner-cron] tick fail: pool empty`（空表环境下的正常提示，非崩溃） |
| kaspad 探针（重启后） | `ALIVE:network=mainnet daa=539106605`（比重启前基线只增不减，确认 console 重启没有影响 kaspad 本身）|
| `relay_nodes` mainnet 行数（重启后） | `0`（不变，确认本次没有导入任何账号）|
| `events.hotwallet_relay_killed` 计数（重启后） | `0`（不变，无任何 kill 事件，符合预期——没有账号就没有可 kill 的对象）|

## ⑥ 结论

合入 + 重启 + 验证全部按执行页 v0.3 六步走完，**没有导入任何账号**（迁移动作明确另派）。准入门三个 env 键与驻留期监控均已在生产的主网 console 实例里生效（有日志行为证），旧系统（`C:\KANet`）确认保持关闭状态未受影响，`kaspad` 节点确认未受重启动作影响。

原始日志全文留档：`console-mainnet-stdout-PID15396.log` / `console-mainnet-stderr-PID15396.log`（本目录内，`logs/mainnet/` 下的活动日志会在下次重启时被覆盖，这两份是独立副本）。
