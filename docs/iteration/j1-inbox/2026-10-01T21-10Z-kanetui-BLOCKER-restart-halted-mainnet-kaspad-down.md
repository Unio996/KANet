# KANet-UI 阻塞：主网 console 重启在预检停手——主网 kaspad 已崩，console 其实早已不健康

出处：Bettor 派的重启（Owner GO「按你建议，KTT 付款先不做，重启」）。**未停任何进程、未起任何进程、未改 env**；只做了备份与只读核对。

## 已做（只读/无副作用）
- HEAD = 771f45d2，相对 94a034e9 只多 COORD-LEDGER.md 3 行（代码零差异），无已跟踪改动。
- 备份：`kasia-console/data/backups/console.mainnet.pre-restart-20261002.db`，sha256 `6d375d8ab9172585a96f921b752cfdb7261496d9361a0990779ca6d883dba741`；
  九张关键表行数与源库全部一致（proto_markets 3 / proto_bets 3 / proto_bet_intents 3 / proto_settlement_intents 4 / proto_claims 1 / relay_nodes 18 / broker_refund_intents 0 / ktt_holdings_ledger 2 / ktt_panel_rate_limit_log 5）。
- 三源核 PID：端口 3202 owner = pidfile = 15720，进程创建 2026-09-29T08:36:43Z。

## 为什么停手
1. **主网 kaspad 不在了**：127.0.0.1:17110 无监听；`D:\kaspa-mainnet-data-v201-logs\kaspad-stdout.log` 末次写入 2026-10-02 02:11（+07，= 2026-10-01 19:11Z），`kaspad-stderr.log` 只有一行
   `fatal runtime error: Rust cannot catch foreign exceptions, aborting`。现存 3 个 kaspad 进程（3040/35848/42360）都不是主网节点。
2. **console 现在就不健康**：stdout 末尾 `[relay-health] eligible=18 healthy=0 restart_stormed=18`、`deadCount=18`；`rpc-shared connect timeout 5000ms`；
   proto 两驱动每 tick 报 `relay unhealthy … fail-closed`（所以不会误花钱，是安全的坏）。console 子进程只剩 1 个 node（tg-bot 启动器），**没有一个 relay 子进程**。
3. 这样重启，验收里「本地节点 17110 连上、零公网回退」「relay=18」都不可能过；且 relay 会在无节点下继续进 restart storm。

## 我没做
没起 kaspad（节点运维不在我这次派工范围；Bettor 记忆里有"kaspad 不需提权、可由 Bettor 重启"）、没重启 console、没动 env。

## 需要 Bettor 定
先把主网 kaspad 拉起来并等同步（isSynced 判据：有 peer 且 sink 时戳落后 <661s），再回头让我按原 runbook 重启 console（console 的共享 RpcClient 在 kaspad 重启后不自愈，本来也得重启 console，正好合并成这一次）。
请指示：kaspad 由谁拉起；拉起后我再核 17110 + 同步状态并执行重启。备份已在，不必重做（若隔很久再重启，我会补一份新备份）。
