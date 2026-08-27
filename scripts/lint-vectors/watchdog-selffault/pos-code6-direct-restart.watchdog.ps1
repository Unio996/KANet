# 正向量(BAD): code 6(探针自坏)直接触发重启。规则须触发。
if ($r.Code -eq 6) {
  Restart-Service -Name kaspad
}
