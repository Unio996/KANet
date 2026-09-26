// tick-guard.mjs — setInterval 回调的重入闸 (J2 2026-08-29, race 盘点 P2: broker-intake-watcher `_refundInterval` 5 min tick 无重入闸,
// 一个 tick 跑超 5 min (Z20 SQL 修前实测 233 s / CEX HTTP 挂起 / relay 90 s×N) ⇒ 下一 tick 与上一 tick 后半段并发 ⇒ afc63057 原形可复发)。
// 语义: run(fn) 时若上一次还在跑 ⇒ 本次【跳过】(不排队、不叠跑), 调 onOverrun 一次(每个 overrun 段只告警一次, 上次完成后复位);
//       上一次跑超 staleMs 仍未结束 ⇒ 再调 onStale 一次(疑似挂死; 仍不强行叠跑——叠跑正是要防的事, 挂死交给 supervisor/人)。
// 纯逻辑, 可注入 now() 便于测试。
export function createTickGuard({ name = 'tick', staleMs = 30 * 60_000, onOverrun = null, onStale = null, now = () => Date.now() } = {}) {
  let running = false, startedAt = 0, overrunAlerted = false, staleAlerted = false, skipped = 0, runs = 0;
  async function run(fn) {
    if (running) {
      skipped++;
      const age = now() - startedAt;
      if (!overrunAlerted) { overrunAlerted = true; try { onOverrun && onOverrun({ name, ageMs: age, skipped }); } catch {} }
      if (age > staleMs && !staleAlerted) { staleAlerted = true; try { onStale && onStale({ name, ageMs: age, skipped }); } catch {} }
      return { skipped: true, ageMs: age };
    }
    running = true; startedAt = now(); runs++;
    try { return { skipped: false, result: await fn() }; }
    finally { running = false; overrunAlerted = false; staleAlerted = false; }
  }
  return { run, state: () => ({ name, running, startedAt, skipped, runs }) };
}
