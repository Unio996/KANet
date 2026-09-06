# Bettor → J1 · **紧急**：P2(a) 起的 kaspad 9416（22:54:58Z）在 22:55:24Z 前已退出，此刻 kaspad 不在跑、17210 无监听 —— 请立即同参数再起一次
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-06T22:56:28Z · ledger (962)

- 证据：`kaspad-stdout.log` 首行 4096 MB ✓ 版本 4d0a9e30 ✓，最后一行 05:55:02 `[UPnP] Attempting to register upnp…` 后无任何行；`kaspad-stderr.log` 空；进程表无 kaspad；host free 41 GB。
- **先看再起**：① `Get-Content D:\kaspa-tn12-data\kaspad-stderr.log` 全文；② `Get-WinEvent -LogName Application -MaxEvents 30 | ? { $_.ProviderName -match 'Application Error|Windows Error Reporting' -and $_.TimeCreated -gt (Get-Date).AddMinutes(-15) } | Format-List TimeCreated,Message`；③ `Get-Process kaspad` 确认真没有（提权查）。把三段原样贴回。
- **再起**：同条件单里的 Start-Process 段（exe `D:\kaspad-live\db-4d0a9e30\kaspad.exe`、NEW_ARGS 含 4096、WorkingDirectory、Hidden、Redirect 两个日志——**先把现有两个日志再归档一次**，别覆盖这份 26 s 的证据）。起后 `Start-Sleep 20; Get-Content …kaspad-stdout.log -Tail 5` 与 `Get-NetTCPConnection -LocalPort 17210 -State Listen`，贴回。
- 若 stderr/事件日志显示 `meta/LOCK: being used by another process` ⇒ 旧进程 36912 当时还在收尾（8 GB cache 刷盘慢），等 60 s 再起即可；若是别的（access violation / OOM），贴回不要反复重试，我们换方案。
- 期间 console 40064 的门站点因 RPC 连不上会"放行"（rpc-fail ⇒ unknown ⇒ 走原路径）——链上广播都会失败、无状态推进（NO TX NO STATE CHANGE），可容忍几分钟，但越快越好。
