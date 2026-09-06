# 条件执行单（提权·一次性实验）：防火墙封 136.243.93.17 30 s 再放开 ⇒ 强制重连 ⇒ 对端发 sink inv ⇒ 起小轮 IBD
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-06T21:05Z · 权威 ledger (948)(949) · NWT 21:05Z 红队 (a) 方案·替代 (i)

## 触发条件（全部满足才做；任一不满足 = 不动、贴回"未触发+原因"）
1. **时间 ≥ 2026-09-06T21:30Z**，且 `D:\kaspa-tn12-data\kaspad-stdout.log` 里 **2026-09-07 03:19（本地）之后没有 `IBD started with peer`**（= 预测 B 成立：中继模式永不自起 IBD）。自查：
   ```powershell
   Select-String -Path D:\kaspa-tn12-data\kaspad-stdout.log -Pattern 'IBD started with peer' | Select -Last 3 | % Line
   ```
   若最后一条晚于 `2026-09-07 03:19` ⇒ **A 成立，本单作废**。
2. **IBD 不在进行中**：最后一条 `IBD started` 之后必须已有 `IBD with peer … completed`（成功或 error 都算结束）。IBD 中途断它 = 头部从零重议（NWT ⑤）。
3. isSynced 仍 false（`node D:\kanet-tn12\scratch\_step0_gate.mjs --json` 看 `isSynced`）。

## 做什么（管理员 PowerShell）
```powershell
$T0 = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); "T0=$T0"
netsh advfirewall firewall add rule name="KANET-TMP-BOUNCE-SYNCER" dir=out action=block remoteip=136.243.93.17
netsh advfirewall firewall add rule name="KANET-TMP-BOUNCE-SYNCER-IN" dir=in action=block remoteip=136.243.93.17
Start-Sleep 30
netsh advfirewall firewall delete rule name="KANET-TMP-BOUNCE-SYNCER"
netsh advfirewall firewall delete rule name="KANET-TMP-BOUNCE-SYNCER-IN"
$T1 = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); "T1=$T1"
netsh advfirewall firewall show rule name="KANET-TMP-BOUNCE-SYNCER"      # 期望: 没有与指定条件相匹配的规则
netsh advfirewall firewall show rule name="KANET-TMP-BOUNCE-SYNCER-IN"   # 同上
Start-Sleep 90
Select-String -Path D:\kaspa-tn12-data\kaspad-stdout.log -Pattern 'connection (closed|reset)|Disconnected|P2P Connected to outgoing peer 136\.243|IBD started|IBD with peer' | Select -Last 12 | % Line
```
🔴 两条 delete 必须执行成功——**规则留下 = 唯一 syncer 永久封死**。贴回前用两条 `show rule` 确认已删。

## 贴回收件箱
T0 / T1 / 上面最后一条命令的 12 行原样 / `netsh … show rule` 两条的输出。我的监控盯 `IBD started`/`completed`；预期（NWT 曲线）：回连 ≤30 s → `IBD started` ≤60 s → 落后 ~45 min ⇒ IBD ≈ 头 3 min + 体 27,000 块/30 bps ≈ 15 min → isSynced=true 窗 ≈11 min（顺便给 J2 的 6b 验证一窗）。

## 不做
不重启 kaspad、不加 `--unsaferpc`（那是 Owner 拍的安全面变更，另案）、不动 console 40064、llama 保持停。做完不留任何防火墙规则。
