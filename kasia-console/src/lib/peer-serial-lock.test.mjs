// 跑: cd kasia-console && node src/lib/peer-serial-lock.test.mjs
import assert from 'node:assert';
import { withPeerLock, _peerLockState } from './peer-serial-lock.mjs';
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const defer = () => { let res; const p = new Promise((r) => { res = r; }); return { p, res }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await t('L1 同 peer 串行: 第二条在第一条完成前不开始 (P11 双提向量: 第二条看到的是第一条借记后的世界)', async () => {
  const d = defer(); const order = [];
  const a = withPeerLock('p1', async () => { order.push('a-start'); await d.p; order.push('a-end'); return 'A'; });
  const b = withPeerLock('p1', async () => { order.push('b-start'); return 'B'; });
  await sleep(20); assert.deepStrictEqual(order, ['a-start'], '第二条不得先跑');
  d.res(); assert.strictEqual(await a, 'A'); assert.strictEqual(await b, 'B');
  assert.deepStrictEqual(order, ['a-start', 'a-end', 'b-start']);
});
await t('L2 不同 peer 并行', async () => {
  const d = defer(); const order = [];
  const a = withPeerLock('p2', async () => { await d.p; order.push('a'); });
  const b = withPeerLock('p3', async () => { order.push('b'); });
  await b; assert.deepStrictEqual(order, ['b']); d.res(); await a;
});
await t('L3 前一条抛错, 后一条照跑; 错误向外抛', async () => {
  await assert.rejects(withPeerLock('p4', async () => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(await withPeerLock('p4', async () => 42), 42);
});
await t('L4 排队超 warnAfterMs ⇒ onWait 一次(带 waitedMs), 不放弃排队', async () => {
  const d = defer(); const waits = [];
  const a = withPeerLock('p5', async () => { await d.p; });
  const b = withPeerLock('p5', async () => 'ok', { warnAfterMs: 30, onWait: (e) => waits.push(e) });
  await sleep(80); assert.strictEqual(waits.length, 1); assert.ok(waits[0].waitedMs >= 30); assert.strictEqual(waits[0].peer, 'p5');
  d.res(); await a; assert.strictEqual(await b, 'ok');
});
await t('L6 (NWT (c) rejectAfterMs) 挂死 handler 后第二条在 X 后被拒(PEER_LOCK_REJECTED)且其 fn 未执行; onReject 一次; 挂死的第一条完成后新消息照跑', async () => {
  const { PeerLockRejectedError } = await import('./peer-serial-lock.mjs');
  const d = defer(); let ran2 = false; const rejects = [];
  const hung = withPeerLock('p7', async () => { await d.p; return 'late'; });
  await assert.rejects(withPeerLock('p7', async () => { ran2 = true; }, { rejectAfterMs: 40, onReject: (e) => rejects.push(e) }), (e) => e instanceof PeerLockRejectedError && e.code === 'PEER_LOCK_REJECTED' && e.waitedMs >= 40);
  assert.strictEqual(ran2, false, '被拒的消息不得执行 (拒≠放行)'); assert.strictEqual(rejects.length, 1); assert.strictEqual(rejects[0].peer, 'p7');
  d.res(); assert.strictEqual(await hung, 'late');
  assert.strictEqual(await withPeerLock('p7', async () => 'ok', { rejectAfterMs: 40 }), 'ok');
});
await t('L7 rejectAfterMs=0 ⇒ 不拒 (只等)', async () => { const d = defer(); const a = withPeerLock('p8', async () => { await d.p; }); const b = withPeerLock('p8', async () => 'b', { rejectAfterMs: 0 }); await sleep(30); d.res(); await a; assert.strictEqual(await b, 'b'); });
await t('L5 队列清空后 Map 回收', async () => { await withPeerLock('p6', async () => 1); await sleep(5); assert.strictEqual(_peerLockState().pending, 0); });
console.log(`peer-serial-lock: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
