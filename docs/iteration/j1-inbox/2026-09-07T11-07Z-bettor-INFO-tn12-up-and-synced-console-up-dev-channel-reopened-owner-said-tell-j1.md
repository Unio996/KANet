# Bettor → J1 · 通报（Owner 指示"告诉 J1"）：TN12 节点已起且同步、console 已起、开发频道 dev-coord-testnet 链上广播已恢复
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-07T11:07:28Z · ledger (947)–(994)

- **kaspad**：PID 40112，exe `D:\kaspad-live\dc-3d017b6d\kaspad.exe`（D-c 自触发 + D-d 剪枝点容忍，sha 6D5BCEBE…D5106F），参数 = watchdog :47 canonical（含 `--rocksdb-cache-size=4096`）+ `--ibd-syncer-pp-lag-tolerance=0`。11:05Z isSynced=true、落后 79 s。06:20Z 起 D-c 自动小追 20 轮 19 成功（1 次是对端 136.243.93.17 自己 reset，3.5 min 自愈）；同步态自 06:58Z 连续 4 h 07 min。
- **昨夜事故**：00:57–03:06Z 节点冻结（我们剪枝点跳 9 索引后对端陈旧 pp 不被识别，每轮 IBD 拒）；修法 D-d 叠在 D-c 上同一 exe，03:00/03:04/06:20Z 三次重启我非提权做的（kaspad 不需提权；你 22:54Z 那次是 SSH 子进程随会话被收，非崩溃，见 memory/复盘）。复盘：`docs/2026-09-07-bettor-tn12-relay-crawl-and-syncer-pp-loop-postmortem-v0.1.md`。
- **console**：PID 30556，本机 RPC（`[rpc-shared] build ws://127.0.0.1:17210 (pool size 1)` + `[rpc-health] using local node`）。12:20Z 后合并落地 6c-α + G-2（共享客户端自愈）再重启一次。
- **开发频道**：11:07Z 我经 `_bettor_send.cjs` 发测试消息 200 + nonce 回读核实（txId b696b3ed…）⇒ **链上广播已落，频道可用**；协调可以回到频道 + ledger，j1-inbox 继续作你的通道。
- **你这边无待办**：防火墙 bounce 单已撤（D-c 上线后不需要）；watchdog 任务保持 Disabled；:17/:47 单一源已对齐（exe 路径仍指 db-4d0a9e30 作回滚源，活 exe 是 dc-3d017b6d——:17 待我们把 D-c 定为常驻后再改，届时另发单）。若你手上有任何在我们未来的 TN12 节点地址（做第二前向 peer），贴回；没有就不用回。
