// diag-step.mjs — M10 v2 observe-only 计时 helper (2026-09-05, Bettor 批 / NWT 条件; 设计 docs/2026-09-04-bettor-console-stall-mitigation-design-v0.2.md §3).
// 目的: 给同步子进程站(execSync/execFileSync/spawnSync)、tick 分步、setInterval 回调各打一行可 grep 的
//   `[diag:step] <site> ms=<n> ... at=<ISO>`, 跟 [diag:tick-duration] / 现有九站同族, 让 readout 脚本按 site 名聚合。
// 纪律(全部 observe-only, 零业务语义):
//   - 纯透传: 被包函数的 this / 参数 / 返回值 / 抛出的异常对象**原样**(不 new Error, 不吞, 不改 stack);
//   - 日志自身全 try/catch: console.log 抛出也不影响被包函数;
//   - 零状态、零 DB、零 import(只有本文件, 不引入循环依赖);
//   - 阈值: thresholdMs 以下不打(A 类 setInterval 站默认 50ms, Bettor ④); 子进程站 / tick 分步默认 0 = 每次打;
//   - 异步: 返回值是 thenable 时另打一行 ms=<settle 总时长>(sync=<同步前缀>), 否则只打同步时长。
//     同步前缀(第一个 await 之前)正是"堵 event loop"的量; settle 总时长是墙钟。两者分开记, 不混。

function _log(line) {
  try { console.log(line); } catch { /* observe-only */ }
}

function _isThenable(v) {
  return v != null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
}

function _fmt(site, ms, fields) {
  let s = `[diag:step] ${site} ms=${ms}`;
  if (fields) for (const k of Object.keys(fields)) { if (fields[k] !== undefined) s += ` ${k}=${fields[k]}`; }
  return `${s} at=${new Date().toISOString()}`;
}

/**
 * stepSync(site, fn, opts) — 量一段同步代码。fn 的返回值/异常原样透传。
 * @param {string} site   站名, 如 'settle.selectRipeMarkets.pregate'
 * @param {() => any} fn
 * @param {{thresholdMs?:number, fields?:object}} [opts]  fields 附加到行尾(如 rows=)
 */
export function stepSync(site, fn, opts) {
  const thresholdMs = opts?.thresholdMs ?? 0;
  const t0 = Date.now();
  let ok = 1;
  try {
    return fn();
  } catch (e) {
    ok = 0;
    throw e;
  } finally {
    const ms = Date.now() - t0;
    if (ms >= thresholdMs) _log(_fmt(site, ms, { ...(opts?.fields || {}), ok }));
  }
}

/**
 * procStep(site, cmd, fn) — 同步子进程站专用: 每次打, 行内带 cmd=<名>。fn 里放 execSync/execFileSync/spawnSync 调用。
 *   抛出的异常对象原样透传(调用方的 catch 仍拿得到 e.stderr / e.code / e.signal)。
 */
export function procStep(site, cmd, fn) {
  return stepSync(site, fn, { thresholdMs: 0, fields: { cmd } });
}

/**
 * wrapTick(site, fn, opts) — 包 setInterval / cron 回调。返回的函数保留 this / arguments / 返回值。
 *   同步部分 sync=<ms> 每次量; 若返回 thenable, settle 后再打 ms=<总墙钟>。两者都受 thresholdMs 门(默认 50ms, Bettor ④)。
 *   若 fn 同步抛出, 异常原样抛出(setInterval 场景 = 与不包时一致的未捕获行为)。
 *   若返回的 promise reject, 我们返回一个**同样 reject 同一个 reason** 的新 promise(不吞、不改), 调用方链上的 .catch 照常生效。
 */
export function wrapTick(site, fn, opts) {
  const thresholdMs = opts?.thresholdMs ?? 50;
  const wrapped = function (...args) {
    const t0 = Date.now();
    let r;
    try {
      r = fn.apply(this, args);
    } catch (e) {
      const ms = Date.now() - t0;
      if (ms >= thresholdMs) _log(_fmt(site, ms, { sync: ms, ok: 0 }));
      throw e;
    }
    const syncMs = Date.now() - t0;
    if (!_isThenable(r)) {
      if (syncMs >= thresholdMs) _log(_fmt(site, syncMs, { sync: syncMs, ok: 1 }));
      return r;
    }
    if (syncMs >= thresholdMs) _log(_fmt(`${site}.sync`, syncMs, { ok: 1 }));
    return r.then(
      (v) => { const ms = Date.now() - t0; if (ms >= thresholdMs) _log(_fmt(site, ms, { sync: syncMs, ok: 1 })); return v; },
      (e) => { const ms = Date.now() - t0; if (ms >= thresholdMs) _log(_fmt(site, ms, { sync: syncMs, ok: 0 })); throw e; },
    );
  };
  try { Object.defineProperty(wrapped, 'name', { value: fn && fn.name ? `diag(${fn.name})` : `diag(${site})` }); } catch { /* observe-only */ }
  return wrapped;
}

/** 供 tick 内分步手工打点(已有 t0 的场合), 与上面同行格式。 */
export function logStep(site, ms, fields) {
  _log(_fmt(site, ms, fields));
}
