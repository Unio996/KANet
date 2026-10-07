// delivery-read-kaspa-api.test.mjs — 账本1877 步3: api.kaspa.org 读后端适配器(注入 fetch, 零网络)。字段形状取自 spike #1 的真实返回。
// Run: node src/lib/delivery-read-kaspa-api.test.mjs
import assert from 'node:assert';
const { makeKaspaApiReader } = await import('./delivery-read-kaspa-api.mjs');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + String(e?.stack || e?.message || e).split('\n').slice(0, 3).join(' | ')); } };
const ADDR = 'kaspa:q' + 'a'.repeat(61), T1 = '11'.repeat(32), T2 = '22'.repeat(32), PREV = '33'.repeat(32);
const tx = (o = {}) => ({ transaction_id: T1, payload: 'AB' + 'cd'.repeat(10), block_time: 1791364196515, is_accepted: true, accepting_block_blue_score: 557417108, inputs: [{ previous_outpoint_hash: PREV, previous_outpoint_index: '0' }], outputs: [{ index: 0, amount: 112307973856, script_public_key_address: ADDR }, { index: 1, amount: '5', script_public_key_address: 'kaspa:qother' }], ...o });
const mkFetch = (routes, log = []) => async (url) => { log.push(url); for (const [re, resp] of routes) if (re.test(url)) { const r = typeof resp === 'function' ? resp(url) : resp; return { ok: r.ok !== false, status: r.status || 200, json: async () => { if (r.badJson) throw new Error('bad'); return r.body; } }; } return { ok: false, status: 404, json: async () => ({}) }; };

await t('listAddressTxs: 规整字段(txid/isAccepted/acceptingBlueScore/blockTimeMs/outputs/spentOutpoints/payloadHex 小写) + currentBlueScore', async () => {
  const log = []; const r = makeKaspaApiReader({ fetchImpl: mkFetch([[/full-transactions/, { body: [tx()] }], [/virtual-chain-blue-score/, { body: { blueScore: 557417200 } }]], log) });
  const { txs, currentBlueScore } = await r.listAddressTxs(ADDR);
  assert.strictEqual(currentBlueScore, 557417200); assert.strictEqual(txs.length, 1);
  assert.deepStrictEqual(txs[0], { txid: T1, isAccepted: true, acceptingBlueScore: 557417108, blockTimeMs: 1791364196515, outputs: [{ index: 0, valueSompi: '112307973856', address: ADDR }, { index: 1, valueSompi: '5', address: 'kaspa:qother' }], spentOutpoints: [{ txid: PREV, index: 0 }], payloadHex: 'ab' + 'cd'.repeat(10) });
  assert.ok(log[0].includes('resolve_previous_outpoints=no') && log.every((u) => !u.includes('#')), '只发 GET, 地址之外不带任何额外标识');
});
await t('未被接受的交易: acceptingBlueScore = NaN(上层深度判定必须 fail-closed); 无 payload ⇒ undefined', async () => {
  const r = makeKaspaApiReader({ fetchImpl: mkFetch([[/full-transactions/, { body: [tx({ is_accepted: false, accepting_block_blue_score: null, payload: '' })] }], [/blue-score/, { body: { blueScore: 5 } }]]) });
  const { txs } = await r.listAddressTxs(ADDR); assert.ok(Number.isNaN(txs[0].acceptingBlueScore)); assert.strictEqual(txs[0].payloadHex, undefined);
});
await t('分页: 满页继续翻到不足一页为止; 不超过 maxPages', async () => {
  const log = []; const page = (n) => Array.from({ length: n }, (_, i) => tx({ transaction_id: String(i + 10).padStart(2, '0').repeat(32) }));
  const r = makeKaspaApiReader({ pageLimit: 3, maxPages: 5, fetchImpl: mkFetch([[/offset=0/, { body: page(3) }], [/offset=3/, { body: page(3) }], [/offset=6/, { body: page(1) }], [/blue-score/, { body: { blueScore: 9 } }]], log) });
  assert.strictEqual((await r.listAddressTxs(ADDR)).txs.length, 7);
  const r2 = makeKaspaApiReader({ pageLimit: 1, maxPages: 2, fetchImpl: mkFetch([[/full-transactions/, { body: page(1) }], [/blue-score/, { body: { blueScore: 9 } }]]) });
  assert.strictEqual((await r2.listAddressTxs(ADDR)).txs.length, 2, 'maxPages 封顶');
});
await t('fail-closed: 非 200 / 非 JSON / 非数组 / 缺字段 / blueScore 非法 / 地址非法 ⇒ 抛(绝不当成"没有交易")', async () => {
  const blue = [/blue-score/, { body: { blueScore: 9 } }];
  const rej = async (routes, addr = ADDR) => assert.rejects(makeKaspaApiReader({ fetchImpl: mkFetch(routes) }).listAddressTxs(addr));
  await rej([[/full-transactions/, { status: 503, ok: false }], blue]);
  await rej([[/full-transactions/, { badJson: true }], blue]);
  await rej([[/full-transactions/, { body: { detail: 'x' } }], blue]);
  await rej([[/full-transactions/, { body: [tx({ transaction_id: 'zz' })] }], blue]);
  await rej([[/full-transactions/, { body: [tx({ outputs: undefined })] }], blue]);
  await rej([[/full-transactions/, { body: [tx({ is_accepted: undefined })] }], blue]);
  await rej([[/full-transactions/, { body: [tx({ inputs: [{ previous_outpoint_hash: 'x' }] })] }], blue]);
  await rej([[/full-transactions/, { body: [tx({ outputs: [{ index: 0, amount: -1.5, script_public_key_address: ADDR }] })] }], blue]);
  await rej([[/full-transactions/, { body: [tx()] }], [/blue-score/, { body: { blueScore: 0 } }]]);
  await rej([[/full-transactions/, { body: [tx()] }], blue], 'not an address');
  await rej([[/full-transactions/, { body: [tx()] }], blue], 'kaspa:q../../etc');
});
await t('超时: fetch 挂起 ⇒ 到 timeoutMs 抛(AbortController)', async () => {
  const hang = (url, opts) => new Promise((_, rej) => { opts?.signal?.addEventListener('abort', () => rej(new Error('aborted'))); });
  await assert.rejects(makeKaspaApiReader({ fetchImpl: hang, timeoutMs: 30 }).listAddressTxs(ADDR), /aborted/);
});
await t('静态: 只发 GET(无 method/body/自定义头 ⇒ 浏览器 simple request, 无预检); 无 console.* ', async () => {
  const { readFileSync } = await import('node:fs'); const src = readFileSync(new URL('./delivery-read-kaspa-api.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/method\s*:|body\s*:|headers\s*:|console\./.test(src));
});
console.log(`\n${pass} pass, ${fail} fail`); process.exitCode = fail ? 1 : 0;
