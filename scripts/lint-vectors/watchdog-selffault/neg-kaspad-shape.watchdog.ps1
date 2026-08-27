# 负向量: 复刻 kaspad-watchdog.ps1 安全形状。code 6(探针自坏)映射到 Unknown(不重启)。
# restart 只在 Fail(code 2,3,4,5=探针探到真节点问题)分支, 且"只启不杀"。规则须【不】触发。
$code = $LASTEXITCODE
$verdict = if ($code -eq 0) { 'Alive' } elseif ($code -in 2,3,4,5) { 'Fail' } else { 'Unknown' }
if ($verdict -eq 'Unknown') {
  Log "probe UNKNOWN (probe itself failed, not counted) code=$code"
} elseif ($verdict -eq 'Fail') {
  $failCount++
  if ($failCount -ge $FAIL_THRESHOLD) {
    Start-Process -FilePath $kaspadExe -ArgumentList $kaspadArgs
  }
}
