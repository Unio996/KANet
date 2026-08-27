// 正向量(BAD): 探针自坏原因 'load-fail'(kaspa-wasm junction 被 Redirection Guard 拦=探针自坏, 非节点死)
// 被当成节点故障 → respawn。规则须触发(规则 72 的 8/25 J1 根因)。
if (probe.reason.includes('load-fail')) {
  spawnKaspad();
}
