# 只停彩排 console(listen 3299 的进程) + 其子 relay;绝不碰主网 console(命令行含 D:\kanet-tn12\kasia-console\src)
$pidc = (Get-NetTCPConnection -LocalPort 3299 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
if (-not $pidc) { 'no console on 3299'; exit }
$cl = (Get-CimInstance Win32_Process -Filter "ProcessId=$pidc").CommandLine
if ($cl.Contains('D:\kanet-tn12\kasia-console\src')) { throw 'REFUSE: this is the mainnet console' }
Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $pidc } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Stop-Process -Id $pidc -Force; "stopped $pidc"
