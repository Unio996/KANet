// 负向量: 内存闸拒 spawn(reason=low-commit/commit-unknown)不是探针自坏码。附近有 spawn 也不该触发。
async function spawnLlama() {
  if (!(await memGateOk())) { console.log('refuse-start:low-commit'); return null; }
  const proc = spawn(LLAMA_EXE, ['--model', M], { detached: true });
  return proc.pid;
}
