# 条件执行单：kaspad WS ≥ 28.5 GB 时执行 P2(a) —— `--rocksdb-cache-size=8192 → 4096` 重启（你提权）
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-06T02:22:47Z · 权威 ledger (929)(930)(931) · 预案 NWT 精检 §12

- **触发条件（任一满足即执行，不另等我）**：KANet-UI/NWT 报 kaspad WS **≥ 28.5 GB**；或 free < 6 GB。未触发 = 不动。
- **最佳时机**：紧接一次断连自恢复之后（tip 刚同步到 ⇒ header 重议只剩几分钟，成本 ~15 min）；但若 28.5 先到就直接做（成本 ~45 min）。
- **执行（管理员 PowerShell·同 D-b 段 1/3 形·exe 不变）**：
```powershell
$k = Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'"; $k | Select ProcessId,CreationDate,ExecutablePath | Format-List   # 期望恰 1 个 = 36912, 路径 D:\kaspad-live\db-4d0a9e30\kaspad.exe
$args47 = (Select-String -Path D:\kanet-tn12\scripts\kaspad-watchdog.ps1 -Pattern '^\ = "(.+)"$').Matches[0].Groups[1].Value
$NEW_ARGS = $args47 -replace '--rocksdb-cache-size=8192','--rocksdb-cache-size=4096'; "NEW_ARGS=$NEW_ARGS"   # 必须含 4096, 其余不变
$OLD_PID = $k.ProcessId; Stop-Process -Id $OLD_PID -Force; $t=0; while ((Get-Process -Id $OLD_PID -ErrorAction SilentlyContinue) -and $t -lt 60) { Start-Sleep 1; $t++ }; "exited after ${t}s"
Get-NetTCPConnection -LocalPort 16311,17210 -State Listen -ErrorAction SilentlyContinue   # 期望空
$NEW_EXE = 'D:\kaspad-live\db-4d0a9e30\kaspad.exe'; (Get-FileHash $NEW_EXE -Algorithm SHA256).Hash   # 2432C36B…361A95
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'); foreach ($f in 'kaspad-stdout.log','kaspad-stderr.log') { $p="D:\kaspa-tn12-data\"; if (Test-Path $p) { Move-Item $p "D:\kaspa-tn12-data\archive-$stamp-$f" -Force } }
$spArgs = @{ FilePath = $NEW_EXE; ArgumentList = $NEW_ARGS; WorkingDirectory = 'D:\kaspad-live\db-4d0a9e30'; WindowStyle = 'Hidden'; PassThru = $true; RedirectStandardOutput = 'D:\kaspa-tn12-data\kaspad-stdout.log'; RedirectStandardError = 'D:\kaspa-tn12-data\kaspad-stderr.log' }
$proc = Start-Process @spArgs; "T1=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')) NEW_PID=$($proc.Id)"
Start-Sleep 10; Get-Content D:\kaspa-tn12-data\kaspad-stdout.log -TotalCount 3   # 首行应为 "Custom RocksDB cache size … 4096 MB", 版本串 4d0a9e30
```
- 回显贴回收件箱（T1 / NEW_PID / NEW_ARGS / 首 3 行）。**执行后我改 watchdog :47 为 4096**（任务仍 Disabled）。回滚 = 同流程把 4096 改回 8192。
- 不动：console 19184、llama 保持停。
