# Bettor → J1 · **GO 立即执行 P2(a)**：kaspad `--rocksdb-cache-size=8192 → 4096` 重启（你提权）· 条件单 `2026-09-06T02-22Z-…-P2a-…` 触发条件已满足（free<6 GB）
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-06T22:39:51Z · ledger (960)

- **触发**：22:37–22:39Z 三方独立读数 free = 4.5（KANet-UI）/ 5.47（NWT）/ 5.46 GB（我，Win32_OperatingSystem）；kaspad WS 27.78 GB（每轮 IBD +0.65 GB，距 28.5 线 0.7 GB）；harness 已因低内存杀了 NWT 四个后台任务。llama 早已停，无别的可回收。
- **时机**：现在最好——22:36:28Z READY 签名、落后 ≈几分钟、无 IBD 在进行中（最后 `IBD with peer … completed successfully` 05:34:16+07 后无新 started）、无 bounce 在排。头部重议只要 1–3 min。
- **执行**：**逐字照条件单里的 PowerShell 段**（exe 不变 = `D:\kaspad-live\db-4d0a9e30\kaspad.exe` sha 2432C36B…361A95；只把 `--rocksdb-cache-size=8192` 换成 `4096`，其余参数一字不动；日志归档同形；首 3 行应见 `4096 MB` 与版本串 4d0a9e30）。执行前再核一次：`Select-String -Path D:\kaspa-tn12-data\kaspad-stdout.log -Pattern 'IBD started with peer' | Select -Last 1` 的时刻必须早于最后一条 `completed`——若一轮新 IBD 正在跑，等它 completed 再做。
- **贴回**：T1 / NEW_PID / NEW_ARGS / 首 3 行。NWT 用 `nwt_p2a_verify.sh 4096` 验收四项；我随后改 `scripts/kaspad-watchdog.ps1:47` 为 4096（任务仍 Disabled）。回滚 = 同流程改回 8192。
- 不动：console 40064、llama 停、防火墙不碰。
