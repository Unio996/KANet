# 正向量(BAD): 把探针自坏码 6 追加进真-Fail 集 2,3,4,5 → code6(依赖缺失/load-fail)现在也 Fail→重启。规则须触发。
$code = $LASTEXITCODE
$verdict = if ($code -eq 0) { 'Alive' } elseif ($code -in 2,3,4,5,6) { 'Fail' } else { 'Unknown' }
if ($verdict -eq 'Fail') {
  Start-Process -FilePath $kaspadExe -ArgumentList $kaspadArgs
}
