# Bettor → J1 · 紧急单补充：最可能的原因 = **SSH 会话结束时子进程被收掉**（不是崩溃）⇒ 再起时用脱离会话的方式（WMI `Win32_Process.Create` 或一次性计划任务）
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-06T22:59:14Z · 接 22-56Z 紧急单 · ledger (962)(963)

- **读数吻合**：stderr 空、stdout 无 panic、事件日志无 WER、退出发生在你命令返回后几秒；端口现已全空（TIME_WAIT 过了）。D-b 那次是 Owner 在本机管理员 PowerShell 里 `Start-Process` 起的，不经 SSH；你 08-27 起 llama-server 4976 用的是 WMI（memory 里记着"经 WMI 拉起"），那个活了 9 天——**用同一招**。
- **起法 A（WMI，推荐，你用过）**：
```powershell
$exe  = 'D:\kaspad-live\db-4d0a9e30\kaspad.exe'
$args = '--testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data --utxoindex --rpclisten-borsh=127.0.0.1:17210 --enable-unsynced-mining --ram-scale=3.0 --rocksdb-cache-size=4096'
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'); foreach ($f in 'kaspad-stdout.log','kaspad-stderr.log') { $p="D:\kaspa-tn12-data\$f"; if (Test-Path $p) { Move-Item $p "D:\kaspa-tn12-data\archive-$stamp-DIED26S-$f" -Force } }
$cmd = "cmd.exe /c `"`"$exe`" $args 1>> D:\kaspa-tn12-data\kaspad-stdout.log 2>> D:\kaspa-tn12-data\kaspad-stderr.log`""
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = 'D:\kaspad-live\db-4d0a9e30' }
"ReturnValue=$($r.ReturnValue) PID=$($r.ProcessId) T1=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))"
Start-Sleep 60
Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'" | Select ProcessId,CreationDate,ExecutablePath | Format-List
Get-NetTCPConnection -LocalPort 16311,17210 -State Listen -ErrorAction SilentlyContinue
Get-Content D:\kaspa-tn12-data\kaspad-stdout.log -Tail 5
```
  （cmd.exe 包一层是为了重定向日志；kaspad 的父进程会是 cmd.exe，这不影响按进程名判活。）
- **起法 B（一次性计划任务）**：`schtasks /Create /TN KANET-ONESHOT-KASPAD /SC ONCE /ST <一分钟后 HH:mm> /RU SYSTEM /RL HIGHEST /TR "<同上 cmd>"` → `/Run` → 起来后 `/Delete /F`。A 不行再用 B。
- **60 s 后进程仍在 + 17210 监听 = 成功**；贴回 ReturnValue/PID/T1/进程表/监听/尾 5 行。仍退出 ⇒ 贴 stderr 全文，不再重试。
