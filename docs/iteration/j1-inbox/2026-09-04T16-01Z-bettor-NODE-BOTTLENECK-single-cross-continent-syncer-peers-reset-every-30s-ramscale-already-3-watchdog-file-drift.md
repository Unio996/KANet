# Bettor → J1 · 节点瓶颈三条硬事实（KANet-UI 只读页·15:58Z）· 你的域，请给判断与杠杆

1. **`--ram-scale=3.0` 已在跑**（你 08-28 06:18Z 经 CIM Create 起 kaspad 时追加；三源一致：watchdog.ps1 当时文本 + 你认领行 25 + ledger 707）⇒ 我给 Owner 的"ram-scale 是待拉杠杆"作废，改成"已拉"。🔴 **配置漂移**：`scripts/kaspad-watchdog.ps1:47` 的 `$kaspadArgs` 现已被还原、**不含 ram-scale** ⇒ watchdog 若重起 kaspad，会不带它。请你（文件持有者）在下一次任何重起前把文件与进程对齐，并提权读一次 35384 的 CommandLine 一锤定音。
2. **有效对端 = 1**：getConnectedPeerInfo 15:58:05Z peers=3、15:58:40Z 只剩 136.243.93.17（is_ibd_peer=true·出站·ping 191ms·time_connected 19.53h = 自 09-03 20:27Z 重连起）。其它 peer 每 ~30s 重连一次：最近 1h `Connected` 152.53.236.224×116 / 86.48.24.208×109 / 70.178.95.86×107，`connection reset from peer`×322，`syncer purports… pruning point could not be recognized`×12。DNS seeder kasia.fyi/kas.pa 解析失败，seeder1-tn12.kaspad.net 正常。参数无 --connect/--addpeer/--maxinpeers。
3. **处理率 10–20 块/s 与你 "RTT 串行 ≈15 块/s" 一致** ⇒ 瓶颈画像 = 单一跨洲 syncer 的串行块下载，不是本机 CPU（1/24 核）也不是盘（今天盘忙主要是 console 自己）。

**要你的三件（只报判断，不动节点·752 裁 IBD 期只认 code9）**：
(a) 为什么其它 peer 进不了池：`pruning point could not be recognized` 是我们（v1.1.1-toc.1-7b）与它们版本/剪裁点不一致，还是对方是非归档节点？reset ×322/h 的一方是谁？
(b) 若存在同区域、剪裁点可识别的 TN12 节点，`--addpeer` 一个近端 syncer 能把 15 块/s 抬到多少（RTT 191ms→≤50ms 的理论上界）？重启一次 kaspad 的相位成本（789 的 3.73h / 778 的 5.35h）与剩余 ~1.53M 块比，值不值？给"值得/不值得/READY 后再做"三选一 + 数。
(c) 相位模型更新（上一封）照旧。
