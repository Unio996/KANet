// utxo-pin.test.mjs — 账本1855 A: pin_utxo/unpin_utxo 只排除不选择。Run: cd kasia-relay && node src/lib/utxo-pin.test.mjs
// 零 RPC 零 live。三条消费路径(sendKaspa / splitUtxosRelay / consolidateUtxosRelay)都经同一个 filterPendingUtxos 取候选——
// 功能层测过滤器本身, 结构层断言三处调用点真的在(防日后有人新增一条不过滤的取币路径而测试仍绿)。
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
process.env.KASPA_NETWORK ||= 'simnet';
const T = await import('./transaction.mjs');
const { validateCommandPayload } = await import('./commands.mjs');
const { authorizeCommand, READONLY_ALLOWLIST } = await import('./authorize.mjs');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const H = (c) => c.repeat(32);
const ent = (txid, index, amount = 50_000_000n) => ({ amount, outpoint: { transactionId: txid, index } });
const entNested = (txid, index) => ({ entry: { outpoint: { transactionId: txid, index } }, amount: 1n });
const here = dirname(fileURLToPath(import.meta.url));

await t('filterPendingUtxos 丢掉被 pin 的 outpoint, 其余原样', () => {
  T._clearPinsForTest();
  const a = ent(H('aa'), 0), b = ent(H('bb'), 1), c = entNested(H('cc'), 2);
  T.pinUtxo(H('aa'), 0); T.pinUtxo(H('cc'), 2);
  const out = T.filterPendingUtxos([a, b, c]);
  assert.deepStrictEqual(out, [b]);
});
await t('同 txid 不同 index 不受影响(pin 精确到 outpoint)', () => {
  T._clearPinsForTest();
  T.pinUtxo(H('aa'), 0);
  assert.strictEqual(T.filterPendingUtxos([ent(H('aa'), 1)]).length, 1);
});
await t('unpin 恢复', () => {
  T._clearPinsForTest();
  T.pinUtxo(H('aa'), 0);
  assert.strictEqual(T.filterPendingUtxos([ent(H('aa'), 0)]).length, 0);
  assert.strictEqual(T.unpinUtxo(H('aa'), 0).unpinned, true);
  assert.strictEqual(T.filterPendingUtxos([ent(H('aa'), 0)]).length, 1);
  assert.strictEqual(T.unpinUtxo(H('aa'), 0).unpinned, false);   // 幂等
});
await t('TTL 到期自动恢复(自愈)', async () => {
  T._clearPinsForTest();
  T.pinUtxo(H('aa'), 0, 1000);
  assert.strictEqual(T.filterPendingUtxos([ent(H('aa'), 0)]).length, 0);
  await new Promise((r) => setTimeout(r, 1150));
  assert.strictEqual(T.filterPendingUtxos([ent(H('aa'), 0)]).length, 1);
  assert.strictEqual(T.pinnedUtxoKeys().length, 0);
});
await t('畸形 pin 被拒且状态不变', () => {
  T._clearPinsForTest();
  const bad = [['zz', 0], [H('aa').toUpperCase(), 0], [H('aa').slice(2), 0], [H('aa'), -1], [H('aa'), 1.5], [H('aa'), 2 ** 32], [H('aa'), '0'], [null, 0]];
  for (const [txid, idx] of bad) assert.throws(() => T.pinUtxo(txid, idx), /pin:/);
  for (const ttl of [0, 999, -5, 1.5, T.PIN_MAX_TTL_MS + 1, '1000']) assert.throws(() => T.pinUtxo(H('aa'), 0, ttl), /ttlMs/);
  assert.throws(() => T.unpinUtxo('zz', 0), /pin:/);
  assert.strictEqual(T.pinnedUtxoKeys().length, 0);
});
await t('pin 数量上限(防 DoS): 满后拒新 pin, 已有的不动, 已有 key 可续期', () => {
  T._clearPinsForTest();
  for (let i = 0; i < T.PIN_MAX_ENTRIES; i++) T.pinUtxo(H('aa'), i);
  assert.throws(() => T.pinUtxo(H('bb'), 0), /上限/);
  assert.strictEqual(T.pinnedUtxoKeys().length, T.PIN_MAX_ENTRIES);
  T.pinUtxo(H('aa'), 0);   // 续期不算新增
  T._clearPinsForTest();
});
await t('pin 只排除: 过滤器永不产出输入里没有的条目(不选择/不凭空生成)', () => {
  T._clearPinsForTest();
  T.pinUtxo(H('aa'), 0);
  const input = [ent(H('aa'), 0), ent(H('bb'), 0)];
  const out = T.filterPendingUtxos(input);
  assert.ok(out.every((e) => input.includes(e)));
  assert.strictEqual(input.length, 2);   // 不改入参
});
await t('命令校验: 合法 pin/unpin 过, 缺字段/类型错被 validateCommandPayload 拒', () => {
  assert.strictEqual(validateCommandPayload({ type: 'pin_utxo', txid: H('aa'), index: 0 }).valid, true);
  assert.strictEqual(validateCommandPayload({ type: 'pin_utxo', txid: H('aa'), index: 0, ttl_ms: 5000 }).valid, true);
  assert.strictEqual(validateCommandPayload({ type: 'unpin_utxo', txid: H('aa'), index: 0 }).valid, true);
  assert.strictEqual(validateCommandPayload({ type: 'pin_utxo', index: 0 }).valid, false);
  assert.strictEqual(validateCommandPayload({ type: 'pin_utxo', txid: H('aa') }).valid, false);
  assert.strictEqual(validateCommandPayload({ type: 'pin_utxo', txid: 5, index: 0 }).valid, false);
});
await t('授权: pin/unpin 不在只读白名单(有状态命令, armed 时需 origin/信封)', () => {
  assert.ok(!READONLY_ALLOWLIST.has('pin_utxo') && !READONLY_ALLOWLIST.has('unpin_utxo'));
  assert.strictEqual(typeof authorizeCommand, 'function');
});
await t('结构: 三条取币路径都经 filterPendingUtxos(新增不过滤的取币路径会让本条红)', () => {
  const tx = readFileSync(join(here, 'transaction.mjs'), 'utf8');
  const sp = readFileSync(join(here, 'utxo-split.mjs'), 'utf8');
  assert.match(tx, /const entries = filterPendingUtxos\(rawEntries\)/);                       // sendKaspa
  const splitFn = sp.slice(sp.indexOf('export async function splitUtxosRelay'), sp.indexOf('export async function consolidateUtxosRelay'));
  const consFn = sp.slice(sp.indexOf('export async function consolidateUtxosRelay'));
  assert.match(splitFn, /filterPendingUtxos\(rawEntries\)/);                                  // splitUtxosRelay(含 broadcaster rebalance force)
  assert.match(consFn, /filterPendingUtxos\(rawEntries\)/);                                   // consolidateUtxosRelay
});
console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
