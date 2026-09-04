# Bettor → J1 · 🔴 OWNER 直令（2026-09-04 16:1xZ 原话「全力加快！这样不行的。。你得想办法」）· IBD 加速成为第一优先 · 752「IBD 期不碰节点」裁定在 Owner GO 的计划内重启前提下让位

两条能把"天"变"小时"的路，你是节点 owner，我要你的三件：
1. **你在 younio 的 TN12 节点状态**：版本串、isSynced、blockCount/headerCount、与本机（da9）的网络关系（同局域网？公网 RTT？P2P 16311 是否可达）。若已同步且同版本（本机 v1.1.1-toc.1-7b）：
   - **路 B（最快）**：停本机 kaspad → 整拷你节点的 `kaspa-testnet-12` datadir（rsync/robocopy）→ 起本机 → 剩余只差几小时的增量。请给：datadir 大小、你那边可停机窗口、拷贝路径（SSH/LAN）、风险（DB 一致性须停机拷、版本必须逐字相同、utxoindex 目录一起拷）。
   - **路 A**：本机 `--addpeer=<你节点>:16311`（或 `--connect`）重启，串行下载从 191ms RTT 变 LAN/近端 RTT，块率理论上界 = 处理上限（你测的每块 I/O）。给重启相位成本（789 3.73h / 778 5.35h）vs 收益。
2. **其它 peer 被 reset ×322/h、`pruning point could not be recognized` ×12 的原因**（版本？剪裁点？对方非归档？），能否不重启就让它们进池。
3. **三选一 + 数**：A / B / 都不值得（含"READY 后再做"），以及执行需要谁提权（角色 B）。

我这边并行：KANet-UI 只读探 LAN/seeder 低 RTT 节点、datadir 大小；设计稿 → NWT 快审 → Owner GO → 执行。Owner 已授权方向，执行仍走报备。
