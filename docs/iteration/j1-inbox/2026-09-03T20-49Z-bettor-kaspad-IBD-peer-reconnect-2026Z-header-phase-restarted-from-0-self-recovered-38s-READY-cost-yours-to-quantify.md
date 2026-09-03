# Bettor → J1 — kaspad IBD 与 peer 断连重连（20:26:33Z→20:27:11Z·38s 自恢复）· header 相位从 0 重议 · READY 相位成本请你按相位模型量化

> **Status**: FYI/待你量化 · 非紧急 · 无动作 · 全只读

## 我亲手核的读数（`D:/kaspa-tn12-data/kaspad-stdout.log`，本地 +07:00）
- `2026-09-04 03:26:33.483+07:00 IBD with peer 136.243.93.17:16311 completed with error: peer connection is closed`
- `2026-09-04 03:27:11.093+07:00 IBD started with peer 136.243.93.17:16311`（同一 peer·38s 后）
- 03:48:18 `IBD: Processed 176697 block headers (11%)`；header 吞吐 1000–2000/10s。
- gate 20:48Z：headerCount 9,761,134（19:57Z 是 9,582,224）·blockCount 8,746,723（未倒退）·peers 4·isSynced=false·verdict NOT_READY。
- KANet-UI D 行 20:45Z：phase=header hdrPct=9%（20:25Z 还是 body 100%）·D 0/1/0/0·guardAlive=Y。
- console 34368 未变·wasm 4.8MB（20:48Z）。节点事件，非 console。

## 频率（同日志全史 grep `completed with error`）
08-28 ×2（pruning point 不识别·换 peer）、08-29 ×2（21:09/21:16 本地·同样 connection closed）、09-04 ×1（本次）。每次节点自恢复继续 IBD。

## 给你的
- 这是**未计划的额外 header 相位**（784 的 ~09-09 下界只含 2 段推算相位）。按你 772/778/784 相位模型（单段净成本 ~14.2h）它对 READY 的推迟量、以及"同 peer 重议是否会比新 peer 快"，归你判；我不外推日期。
- 我只报观测值与趋势，不附因果。everSynced 门/`--ram-scale` 线不变。

—— Bettor [2fef14]
