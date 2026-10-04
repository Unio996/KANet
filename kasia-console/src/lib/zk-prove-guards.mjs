// zk-prove-guards.mjs — 账本 1832 段4(主网阻断项 ledger 1835): zk-prove-worker 的三道运行时防线, 纯函数(无 DB/无副作用), 便于单测。
//   ① 内存门: 出证(RISC0 STARK→Docker Groth16)峰值 RSS≈4.8GB 且在 Groth16 阶段 ~6s 内可吃掉 4–5GB(simnet 实测: MemAvailable 从 ~6GB 掉到 ~1GB), 与 WSL 里的 vLLM/avatarforcing 同 VM。
//      开跑前读 WSL MemAvailable, 低于阈值(默认 6144MB, env ZK_PROVE_MIN_FREE_MB 可调)就【推迟】(job 留 pending), 不是失败。
//   ② 自动重试: 出证失败(被 OOM 看门狗杀/超时/host 退出非 0)不直接 failed——有上限(默认 3 次, ZK_PROVE_MAX_ATTEMPTS)+ 指数退避(默认 120s×2^(n−1), 封顶 1800s), 超限才 failed。
//   ③ host 预编译: 主网不得在 `cargo run` 里现场编译依赖(又慢又占内存, 与出证峰值叠加)。默认直接跑预编译二进制(target/release/host), 缺失/过期(源码比二进制新)⇒ 拒绝并给出预编译命令。

export const MIN_FREE_MB_DEFAULT = 6144;
export const MAX_ATTEMPTS_DEFAULT = 3;
export const BACKOFF_BASE_SEC_DEFAULT = 120;
export const BACKOFF_CAP_SEC = 1800;

/** 解析 /proc/meminfo 文本里的 MemAvailable(MB, 向下取整); 缺失/非法 ⇒ null(调用方 fail-closed 当作「不可核」)。 */
export function parseMemAvailableMb(meminfoText) {
  const m = /MemAvailable:\s*(\d+)\s*kB/i.exec(String(meminfoText || ''));
  if (!m) return null;
  const mb = Math.floor(Number(m[1]) / 1024);
  return Number.isFinite(mb) ? mb : null;
}

/** 内存门判定: availMb==null(读不到)⇒ 不放行(fail-closed); 门可显式关闭(gate:'off', 仅调试)。 */
export function memGateDecision({ availMb, minMb = MIN_FREE_MB_DEFAULT, gate = 'on' }) {
  if (gate === 'off') return { ok: true, reason: 'mem gate disabled (ZK_PROVE_MEM_GATE=off)' };
  if (availMb == null) return { ok: false, reason: 'WSL MemAvailable 读取失败 — 无法确认内存充足, 推迟出证(fail-closed)' };
  if (availMb < minMb) return { ok: false, reason: `WSL MemAvailable=${availMb}MB < 阈值 ${minMb}MB — 推迟出证(job 保持 pending, 下一 tick 重查)` };
  return { ok: true, reason: `MemAvailable=${availMb}MB >= ${minMb}MB` };
}

/** 第 attempt 次失败(从 1 起)之后的退避秒数: base×2^(attempt−1), 封顶 BACKOFF_CAP_SEC。 */
export function backoffSeconds(attempt, base = BACKOFF_BASE_SEC_DEFAULT) {
  const n = Math.max(1, Math.floor(Number(attempt) || 1));
  return Math.min(BACKOFF_CAP_SEC, Math.floor(base * 2 ** (n - 1)));
}

/** attempts = 含本次失败在内已尝试的次数。未达上限 ⇒ retry(带退避); 达到/超过上限 ⇒ fail。 */
export function retryDecision({ attempts, maxAttempts = MAX_ATTEMPTS_DEFAULT, base = BACKOFF_BASE_SEC_DEFAULT }) {
  if (attempts < maxAttempts) return { action: 'retry', delaySec: backoffSeconds(attempts, base) };
  return { action: 'fail' };
}

/** host 二进制状态: 缺失 ⇒ missing; 源码(host/src、methods、Cargo.lock/toml)比二进制新 ⇒ stale; 否则 ok。 */
export function hostBinaryStatus({ binExists, binMtimeMs, newestSrcMtimeMs }) {
  if (!binExists) return { ok: false, status: 'missing', reason: '预编译 host 二进制不存在' };
  if (newestSrcMtimeMs != null && binMtimeMs != null && newestSrcMtimeMs > binMtimeMs) return { ok: false, status: 'stale', reason: '源码比预编译 host 二进制新(二进制已过期, 不得用 cargo run 现场重编)' };
  return { ok: true, status: 'ok', reason: 'host 二进制存在且不旧于源码' };
}

export const PRECOMPILE_HINT = '在 WSL 里预编译(一次性, 非出证时): bash scripts/zk-precompile-host.sh  (内部: cd zk-payout-guest/host && CARGO_BUILD_JOBS=2 nice -n 19 cargo build --release)';

/** 递归取目录集合里最新的文件 mtime(ms); 跳过 target/node_modules/.git。fsApi 可注入(单测)。 */
export function newestMtimeMs(paths, fsApi) {
  let newest = null;
  const visit = (p) => {
    let st; try { st = fsApi.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      let names; try { names = fsApi.readdirSync(p); } catch { return; }
      for (const n of names) { if (n === 'target' || n === 'node_modules' || n === '.git') continue; visit(`${p}/${n}`); }
    } else if (newest == null || st.mtimeMs > newest) newest = st.mtimeMs;
  };
  for (const p of paths) visit(p);
  return newest;
}
