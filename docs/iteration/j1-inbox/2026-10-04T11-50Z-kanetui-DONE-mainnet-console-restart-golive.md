# KANet-UI 交件：主网 console 重启（Owner GO，账本 1841）

作者自报；请 Bettor 独立核。未碰 kaspad 4752，未改 env，脚本原样。

## 步骤
1. 前置：生产检出在 `bshard-m3-deploy`，HEAD 1e510d16（含 b96cf52c，其后只有账本 1841 一笔），无已跟踪文件改动。
2. 备份：better-sqlite3 在线 `.backup`，`kasia-console/data/backups/console.mainnet.pre-restart-20261004.db`，sha256 `3ba5230ae2b519737903a67967284e9fc68bb59b378f687c65fd108b327ef605`，integrity ok，129 表行数源=备份全 match。关键表：relay_nodes 25 / proto_markets 3 / proto_bets 3 / zk_prove_jobs 0 / oracle_stake_enrollments 6 / config_entries 20 / chain_events 98。旧 stderr/stdout 另存为 `logs/mainnet/console-mainnet-{stderr,stdout}.pre-restart-20261004.log`。
3. 三源核 PID：端口 3202 = pidfile = 3436，创建时间 10/03 01:54:03 与 pidfile 一致。`Stop-Process -Force` 后：console 已退、relay.mjs 进程 0、端口释放；原子进程（25 relay、tg-bot、scout）全部退出。kaspad 4752 未动。
4. 起：`scripts/start-console-mainnet.ps1` 原样，新 PID **31436**（pidfile、端口一致）。

## 验收
1. 迁移：v220 `zk_prove_jobs.attempts/next_attempt_at 列已就绪`，`DB migrations complete`；活库直读 zk_prove_jobs 末四列 = fee_leaves_json,pool_total_sompi,attempts,next_attempt_at，0 行。✔
2. RPC：`[rpc-health] using local node: ws://127.0.0.1:17110`，relay 全连本地节点，无公网回退行。✔
3. relay.mjs 子进程 25 = relay_nodes 25（重启前 25）。✔
4. 5 分钟（每 30 s）：监听 PID 恒 31436，stderr 新增 0 字节，FATAL 类命中 0。stderr 共 496 B 全是启动提示（proto-oracle adapter=disabled、ZK_PROVE_SERVER_TOKEN 未设→server 不启动（fail-closed）、external-gateway 未配置、tg-bot 无 broker）。✔
5. proto 驱动：`proto-driver`、`proto-settlement-driver` started；空闲 tick 不打日志，故用库核：proto_markets/bets/settlement_intents/claims、chain_events 与备份一致（3/3/4/1/98），无动作。✔（口径：库不变，非日志读数）
6. 7 个环：
   - prove-worker `cron started (30s tick)` hostMode=binary memGate min=6144MB
   - voter-v2 / submit-v2 `cron started (30s tick)`
   - claim-auto `started`
   - zkCloseTickV2 / claimAutonomousTick / zkHandoffAutonomousTick / zkJudgeProposeAutonomousTick 各 `starting`
   - 🟡 **偏差**：有一行 `[settle-daemon] disabled (SETTLE_DAEMON_ENABLED!=1)·not starting`。即旧 settle-daemon 本体未启，但它名下 4 个 tick（close_v2/claim/handoff/judge）都起来了。按你清单字面「无 NOT starting 行」不满足，是否要开 SETTLE_DAEMON_ENABLED 请你判；我没动 env。
   - 无 "skip: node not synced"。
7. 广播：日志无任何这些环的广播/提交行；库无新行。✔
8. scout：重启把旧 scout（35040）带走，`[scanner] auto-starting (was enabled before restart)` 自起 scout PID 35088（rpc 模式）；`config_entries.scanner_enabled=true`；status running。无需手动 start。✔

## 另需你知道
- 🟡 `[adapter:Avatar-Brain-ChatGPT] UNCAUGHT_EXCEPTION EADDRINUSE :::3010`（stdout，一次）。3010 被一个昨天 10/03 18:59 由 cmd.exe 起的 node（PID 36728）占着，不是本次 console 的子进程；console 没因此挂。上一轮 stdout 无此行。我没动该进程。
- 🟡 `ZK_PROVE_SERVER_TOKEN` 未设 → zk-prove-server 不启动；prove-worker 的 memGate 要 ≥6144MB，而 WSL 出证时余量曾低到 1315MB，实际是否放行取决于它读哪个内存。
- is_oracle=1 共 6 行已确认在新库；`/api/oracle-pool/state` 返回 6 成员/6.00 KAS。
- 监控日志：docs/provenance/2026-10-04-kanetui-mainnet-restart/monitor.log
