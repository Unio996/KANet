// 跑: cd kasia-console && node src/lib/with-timeout.test.mjs
import assert from 'node:assert';
import { withTimeout, LocalTimeoutError } from './with-timeout.mjs';
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const sleep = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
await t('T1 先返回 ⇒ 原值; 定时器清掉', async () => { assert.strictEqual(await withTimeout(sleep(5, 'ok'), 100, 'x'), 'ok'); });
await t('T2 超时 ⇒ LocalTimeoutError code ETIMEDOUT_LOCAL, 带 label/ms; 底层 promise 继续跑完(不取消)', async () => {
  let done = false; const p = sleep(60).then(() => { done = true; return 'late'; });
  await assert.rejects(withTimeout(p, 10, 'transferUsdt'), (e) => e instanceof LocalTimeoutError && e.code === 'ETIMEDOUT_LOCAL' && e.label === 'transferUsdt' && e.ms === 10);
  assert.strictEqual(done, false); await p; assert.strictEqual(done, true, '底层未取消');
});
await t('T3 底层 reject ⇒ 原错误透传 (不是超时)', async () => { await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 100), /boom/); });
await t('T4 ms 非法 ⇒ throw', async () => { assert.throws(() => withTimeout(Promise.resolve(1), 0), /ms 须 > 0/); });
console.log(`with-timeout: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
