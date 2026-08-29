// peer-serial-lock.mjs — 同一 peer 的消息处理串行化 (J2 2026-08-29, race 盘点 P11: v2 withdraw 余额读→链转账→借记, 无 per-peer 锁 ⇒ 快速两条 DM 都读到足额余额 ⇒ 双提)
// 语义: withPeerLock(peer, fn) — 同 peer 排队 (FIFO), 不同 peer 并行; 排队等待超 warnAfterMs 调 onWait 一次 (告警, 不放弃排队);
//       fn 抛错不影响后续排队者; 不设硬超时 (硬超时 = 把并发放回来, 正是要防的事; 挂死交给 supervisor/人)。
const _tails = new Map();   // peer -> Promise (队尾)
export function withPeerLock(peer, fn, { warnAfterMs = 30_000, onWait = null, now = () => Date.now() } = {}) {
  const key = String(peer || '');
  const prev = _tails.get(key) || Promise.resolve();
  const queuedAt = now();
  let release;
  const gate = new Promise((r) => { release = r; });
  const tail = prev.then(() => gate);   // 本次的队尾 = 等前一个完成 + 等本次 release
  _tails.set(key, tail);
  let timer = null;
  const run = (async () => {
    if (warnAfterMs > 0 && onWait) timer = setTimeout(() => { try { onWait({ peer: key, waitedMs: now() - queuedAt }); } catch {} }, warnAfterMs);
    await prev.catch(() => {});   // 前一个失败也轮到我
    if (timer) clearTimeout(timer);
    try { return await fn(); }
    finally { release(); if (_tails.get(key) === tail) _tails.delete(key); }
  })();
  return run;
}
export const _peerLockState = () => ({ pending: _tails.size });
