// L2 期 1 relay 侧: post() 永不 reject 契约 + allIngestOk 纯判定 (离线, 不连 console/节点). 跑法: cd kasia-relay && node src/rpc-listener.coverage.test.mjs
import assert from 'node:assert';
delete process.env.CONSOLE_URL; delete process.env.INGEST_SECRET;   // ingest_disabled 路
const { ingestKaspaTx, ingestCoverageAdvance } = await import('./ingest.mjs');
const { allIngestOk } = await import('./rpc-listener.mjs');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const ok = (v) => ({ status: 'fulfilled', value: v });
await t('P1 ingest 关闭 (无 CONSOLE_URL) ⇒ ingestKaspaTx 返 promise, resolve {ok:false, skipped:true}, 不 reject', async () => { const p = ingestKaspaTx({ txId: 'x', toAddress: 'a', amount: 1 }); assert.ok(p && typeof p.then === 'function'); const r = await p; assert.strictEqual(r.ok, false); assert.strictEqual(r.skipped, true); });
await t('P2 ingestCoverageAdvance 同契约 (返 promise, 不 reject)', async () => { const r = await ingestCoverageAdvance({ daaScore: 1, addresses: ['a'] }); assert.strictEqual(r.ok, false); });
await t('A1 全 ok ⇒ true', () => assert.strictEqual(allIngestOk([ok({ ok: true }), ok({ ok: true, status: 201 })]), true));
await t('A2 空数组 (块无命中 tx) ⇒ true (这块看过, 没有你的 tx = 覆盖)', () => assert.strictEqual(allIngestOk([]), true));
await t('A3 任一 skipped/ok=false ⇒ false (backoff 丢帖 ⇒ 不推进 = 洞)', () => { assert.strictEqual(allIngestOk([ok({ ok: true }), ok({ ok: false, skipped: true, reason: 'backoff' })]), false); assert.strictEqual(allIngestOk([ok({ ok: false, error: 'HTTP 500' })]), false); });
await t('A4 rejected 也 false (契约上不该出现, 出现也 fail-safe)', () => assert.strictEqual(allIngestOk([ok({ ok: true }), { status: 'rejected', reason: new Error('x') }]), false));
await t('A5 value 缺/非对象 ⇒ false', () => { assert.strictEqual(allIngestOk([ok(undefined)]), false); assert.strictEqual(allIngestOk([ok({})]), false); });
console.log(`rpc-listener coverage: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
