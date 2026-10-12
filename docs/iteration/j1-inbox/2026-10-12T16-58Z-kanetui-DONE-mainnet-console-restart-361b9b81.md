# 主网 console 重启完成（代码 = 361b9b81，HEAD = cfce552b）

> **Status**: CURRENT · KANet-UI · 2026-10-12 · 依据：账本 1896（Owner「批，重启」）· 流程照账本 1868
> 全部时间为 UTC，date -u 核过。重启窗口 16:55:04Z 停旧、16:55:08Z 起新。

## 结果摘要

- 旧 console 23808（及其 28 个子进程：25 个 relay、bot 28892、adapter 30388、conhost）已停；**kaspad 4752 未动**，env 未改。
- 新 console **PID 35720**（父进程已退出，已脱离；`scripts/start-console-mainnet.ps1` 原样启动，同一 env 文件、端口 3202）。新 bot **PID 34684**。
- 备份：`kasia-console/data/backups/console.mainnet.db.pre-restart-361b9b81-20261012T1653Z`，254,939,136 字节，sha256 `ba7fb9128365c79a02dbe58b968b166727f5794a95e5cee1090fd471748938fc`，PRAGMA integrity_check = ok。
- 钱包与 pm-settler：25 个钱包前后 JSON 逐字节一致，pm-settler 前后均为 14 个 UTXO、4,735,462,900 sompi；重启后没有任何 tick 花费。

## 前置闸（重启前）

- HEAD = cfce552b = origin/bshard-m3-deploy 当前头；361b9b81 是它的祖先，两者差异只有 `docs/iteration/COORD-LEDGER.md` 两行（账本 1896）；**代码 = 361b9b81**。Bettor 已确认按此口径。tracked 文件无改动。
- 有注的盘：只有 2xm7t（1 注，exhausted=true 终态）。8rq0c、852th、4y9f9 均 0 注。没有盘处于「有注、截止后、终态前」。
- 迁移版本：库里没有版本号表（user_version=0），按结构判重启前是 v221 状态，delivery 两张表不存在。

## a–g 逐项

| 项 | 结果 |
|---|---|
| a 祖先核 / 无模块缺失 | 通过。运行代码 = 361b9b81（HEAD cfce552b 为其仅加账本两行的后代，tracked 无改动）。stdout/stderr 的 ERR_MODULE_NOT_FOUND = 0 |
| b 迁移到 v223 | 通过。日志有 `[migrate] v222: delivery_orders / delivery_stock 已就绪` 和 `v223: delivery_orders.quote_json`；库里 delivery_orders（含 quote_json 列）、delivery_stock 存在；quick_check = ok。**注意：第二张表名是 `delivery_stock`，不是执行单里写的 `delivery_inventory`**，我按实际表名核的 |
| c 交付关闭 | 通过。日志 `[delivery-watcher] disabled (DELIVERY_WATCHER_ENABLED!=1)`；回环 `GET /api/delivery/orders` → 503 `admin endpoint disabled (ADMIN_SECRET_DELIVERY env 未设)`。（`/api/delivery/stock`、`/health` 是 404，没有这两条路由，我只当记录） |
| d 服务就绪 | 通过。25 个 relay 子进程在，日志里 25 个 relay 就绪；`[rpc-health] using local node: ws://127.0.0.1:17110`；zkCloseTickV2、claimAutonomousTick、zkHandoffAutonomousTick、zkJudgeProposeAutonomousTick 均 16:55:16 启动、tick=30000ms 并持续出 diag:step；`[pool-settler] started`（deadline-watcher 随其）；`[pool-seeder] started — target=3 interval=10min`。`[settle-daemon] disabled (SETTLE_DAEMON_ENABLED!=1)` 是旧式 daemon 关着，不影响上面几个 tick |
| e bot | 通过。`/api/tg-bot/status`：running=true，pid 34684，@KANET_Broker_bot，last_error=null；用验收地址跑 `/mybets`（走 bot 代码，预设绑定，不用 ingest secret）读到「China Open: Djokovic vs Medvedev · YES · 1 筹码 · 赢 · 已记账 0.98 筹码 ✅」 |
| f 余额 | 通过。25 钱包 before/after JSON 逐字节一致；pm-settler 14 / 4,735,462,900 前后不变；重启后无 tick 花费，所以没有要列的 txid |
| g 红线计数 | 通过。新日志里 DRIFT = 0、UTXO not found = 0、degenerate = 0、under required = 0、ERR_MODULE_NOT_FOUND = 0 |
| 已知项 | adapter :3010 `EADDRINUSE`（`[adapter:Avatar-Brain-ChatGPT] UNCAUGHT_EXCEPTION ... :::3010`，16:55:16Z）与历次一致，单列，不处理 |

stderr 四行均为 fail-closed 说明（proto-oracle 主网白名单策略、ZK_PROVE_SERVER_TOKEN 未设 prove-server 不启动、external-gateway 未配置、tg-bot 未配 broker），无错误。

## 过程中值得记的

1. 停旧 console 用的是 `taskkill /PID 23808 /T /F`（整棵树）。原因：relay.mjs 里没有监听父进程退出的逻辑，只杀 console 会留下孤儿 relay 与新 relay 并存。停后 23808 及全部 28 个子进程都已不在，kaspad 仍在。
2. 启动脚本调用在 120 秒时被工具转入后台（脚本窗口一直在输出日志），新 console 在后台任务里独立运行，父进程已退出，不依赖那个后台任务。
3. 本次没有任何失败、没有任何自行修补；唯一一次停下提问是 HEAD 哈希字面不符（已由 Bettor 确认口径）。

## 没做 / 待做

- 没碰 kaspad、env、钱包、任何链上花费。2xm7t 的 `zk_self_cov_id` 补写按 Bettor 说明由他做。
- 交付功能目前是关闭状态（watcher 未启用、ADMIN_SECRET_DELIVERY 未设），启用需单独派工。
