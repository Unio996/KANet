// peer-serial-lock.mjs — 同一 peer 的消息处理串行化 (J2 2026-08-29, race 盘点 P11: v2 withdraw 余额读→链转账→借记, 无 per-peer 锁 ⇒ 快速两条 DM 都读到足额余额 ⇒ 双提)
// 语义: withPeerLock(peer, fn) — 同 peer 排队 (FIFO), 不同 peer 并行; 排队等待超 warnAfterMs 调 onWait 一次 (告警, 不放弃排队);
//       fn 抛错不影响后续排队者; 不设硬超时 (硬超时 = 把并发放回来, 正是要防的事; 挂死交给 supervisor/人)。
// rejectAfterMs (NWT 8/29 (c) YES): 等锁超 X ⇒ 【拒】新消息 (抛 PeerLockRejectedError, fn 不跑 ⇒ 不双花), 不是"超时放行"。
//   X 须 > handler 正常最大耗时 (withdraw transferUsdt 120 s 上限 / LLM 60-120 s) —— 与各 handler 的 per-call timeout 组合: handler 超时释锁 ⇒ 排队消息正常跑;
//   rejectAfterMs 只是最后手段的用户面 bound (前一条真挂死时, 让用户得到"稍后再说"而不是无限等)。默认 180 s, 0 = 不拒 (只告警)。
export class PeerLockRejectedError extends Error {
  constructor(peer, waitedMs) { super(`peer ${String(peer).slice(-12)} 前一条消息处理超 ${Math.round(waitedMs / 1000)}s 未完, 本条拒绝 (未执行)`); this.code = 'PEER_LOCK_REJECTED'; this.waitedMs = waitedMs; }
}
const _tails = new Map();   // peer -> Promise (队尾)
export function withPeerLock(peer, fn, { warnAfterMs = 30_000, rejectAfterMs = 180_000, onWait = null, onReject = null, now = () => Date.now() } = {}) {
  const key = String(peer || '');
  const prev = _tails.get(key) || Promise.resolve();
  const queuedAt = now();
  let release;
  const gate = new Promise((r) => { release = r; });
  const tail = prev.then(() => gate);   // 本次的队尾 = 等前一个完成 + 等本次 release
  _tails.set(key, tail);
  let timer = null, rejectTimer = null;
  const run = (async () => {
    if (warnAfterMs > 0 && onWait) timer = setTimeout(() => { try { onWait({ peer: key, waitedMs: now() - queuedAt }); } catch {} }, warnAfterMs);
    let rejected = false;
    const rejectGate = new Promise((_, rej) => { if (rejectAfterMs > 0) rejectTimer = setTimeout(() => { rejected = true; rej(new PeerLockRejectedError(key, now() - queuedAt)); }, rejectAfterMs); });
    try {
      await Promise.race([prev.catch(() => {}), rejectGate]);   // 前一个失败也轮到我; 等太久 ⇒ 拒 (fn 不跑)
    } catch (e) {
      if (rejected) { release(); if (_tails.get(key) === tail) _tails.delete(key); try { onReject && onReject({ peer: key, waitedMs: e.waitedMs }); } catch {} throw e; }
      throw e;
    } finally { if (timer) clearTimeout(timer); if (rejectTimer) clearTimeout(rejectTimer); }
    try { return await fn(); }
    finally { release(); if (_tails.get(key) === tail) _tails.delete(key); }
  })();
  return run;
}
export const _peerLockState = () => ({ pending: _tails.size });
