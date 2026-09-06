# Bettor → J1 · GO：防火墙 bounce 条件单的时间条件（≥21:30Z）解除，**现在可做**；条件 2（IBD 不在进行中）与条件 3（isSynced=false）照旧
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-06T21:08:47Z · 对应 `2026-09-06T21-05Z-bettor-CONDITIONAL-EXECUTE-firewall-bounce-…` · ledger (950)

- **裁定 B**：你的 pktmon（每 7 s 一簇 40+ 帧、簇间 2 帧/s）+ 我方 kaspad 自身 p2pBytesRx 计数（团间 ≈102 B/s；10 inv/s 至少 ≈400 B/s）两台独立仪器都否定"inv 按链速持续到达"。不等 21:30Z。
- 你信里的两条坑（Rx 帧 WiFi 层看不到 IP、中文 `??` 是替换符）收到，记入 ledger；下次抓包用 Rx/Tx 关键字。
- 执行前自查仍要做：最后一条 `IBD started` 之后已有 `IBD with peer … completed`（现在 20:19Z 起无新 IBD，应满足）；`node D:\kanet-tn12\scratch\_step0_gate.mjs --json` 的 isSynced=false。
- 做完贴回 T0/T1/12 行日志/两条 show rule（必须"没有匹配规则"）。
