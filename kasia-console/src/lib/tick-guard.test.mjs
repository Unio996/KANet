// 跑: cd kasia-console && node src/lib/tick-guard.test.mjs
import assert from 'node:assert';
import { createTickGuard } from './tick-guard.mjs';
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const defer = () => { let res; const p = new Promise((r) => { res = r; }); return { p, res }; };
await t('G1 顺序两次都跑', async () => { const g = createTickGuard({ name: 'x' }); let n = 0; await g.run(async () => n++); await g.run(async () => n++); assert.strictEqual(n, 2); assert.strictEqual(g.state().runs, 2); });
await t('G2 重叠: 第二次 skipped=true, fn 不跑, onOverrun 恰一次(第三次重叠不再报); 首次完成后再跑正常且告警复位', async () => {
  let clock = 1000; const overruns = [];
  const g = createTickGuard({ name: 'refund', now: () => clock, onOverrun: (e) => overruns.push(e) });
  const d = defer(); let ran = 0;
  const first = g.run(async () => { await d.p; ran++; });
  clock += 5000;
  const r2 = await g.run(async () => { ran++; }); assert.strictEqual(r2.skipped, true); assert.strictEqual(r2.ageMs, 5000);
  const r3 = await g.run(async () => { ran++; }); assert.strictEqual(r3.skipped, true);
  assert.strictEqual(ran, 0); assert.strictEqual(overruns.length, 1); assert.strictEqual(overruns[0].name, 'refund');
  d.res(); await first; assert.strictEqual(ran, 1);
  const r4 = await g.run(async () => { ran++; }); assert.strictEqual(r4.skipped, false); assert.strictEqual(ran, 2);
  const d2 = defer(); const p5 = g.run(async () => { await d2.p; }); await g.run(async () => {}); assert.strictEqual(overruns.length, 2, '新 overrun 段再报一次'); d2.res(); await p5;
});
await t('G3 stale: 上次跑超 staleMs ⇒ onStale 一次; 仍不叠跑', async () => {
  let clock = 0; const stale = [];
  const g = createTickGuard({ name: 'r', staleMs: 10_000, now: () => clock, onStale: (e) => stale.push(e) });
  const d = defer(); const p = g.run(async () => { await d.p; });
  clock = 5000; await g.run(async () => {}); assert.strictEqual(stale.length, 0);
  clock = 20_000; const r = await g.run(async () => {}); assert.strictEqual(r.skipped, true); assert.strictEqual(stale.length, 1); assert.strictEqual(stale[0].ageMs, 20_000);
  clock = 30_000; await g.run(async () => {}); assert.strictEqual(stale.length, 1, 'stale 只报一次');
  d.res(); await p; assert.strictEqual(g.state().running, false);
});
await t('G4 fn 抛错: running 复位, 错误向外抛, 下次照跑', async () => {
  const g = createTickGuard(); await assert.rejects(() => g.run(async () => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(g.state().running, false); const r = await g.run(async () => 7); assert.strictEqual(r.result, 7);
});
await t('G5 onOverrun 自己抛不影响闸', async () => { const g = createTickGuard({ onOverrun: () => { throw new Error('x'); } }); const d = defer(); const p = g.run(async () => { await d.p; }); const r = await g.run(async () => {}); assert.strictEqual(r.skipped, true); d.res(); await p; });
console.log(`tick-guard: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
