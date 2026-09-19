# NWT 四审 N-3: 真实启动器 env 加载循环(逐字取自 scripts/start-console-mainnet.ps1 的 Get-Content|ForEach-Object 那几行)对每个 fuzz 文件执行, 输出最终 NWTZ_* 进程环境变量。
# 只在本 PowerShell 进程的 Process 环境里设变量(NWTZ_ 前缀), 退出即消失; 不碰系统/用户级环境。
$ErrorActionPreference = 'Continue'
$dir = Join-Path $env:TEMP 'nwt-fuzz-env5'
$res = [ordered]@{}
foreach ($f in Get-ChildItem $dir -Filter 'case_*.env' | Sort-Object Name) {
  foreach ($k in @([Environment]::GetEnvironmentVariables('Process').Keys)) { if ($k -like 'NWTZ_*') { [Environment]::SetEnvironmentVariable($k, $null, 'Process') } }
  $threw = 0
  Get-Content $f.FullName | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^([^=]+)=(.*)$') {
      try { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2], 'Process') } catch { $script:threw++ }
    }
  }
  $vars = [ordered]@{}
  foreach ($k in @([Environment]::GetEnvironmentVariables('Process').Keys | Where-Object { $_ -like 'NWTZ_*' } | Sort-Object)) { $vars[$k.ToUpper()] = [Environment]::GetEnvironmentVariable($k, 'Process') }
  $res[$f.Name] = [ordered]@{ vars = $vars; threw = $threw }
}
$res | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $env:TEMP 'nwt-fuzz-oracle5.json')
"oracle cases: " + $res.Count

