// 跑: cd agent-adapter && node test/listen-host.test.mjs
// 向量: 默认绑 loopback; 显式 ADAPTER_HOST=0.0.0.0 才全接口; 空串/空白 = 未设 ⇒ loopback; 真 bind 一次核 server.address().address。
import assert from 'node:assert';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveListenHost, DEFAULT_ADAPTER_HOST } from '../src/listen-host.mjs';
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
await t('H1 未设 ⇒ 127.0.0.1', () => assert.strictEqual(resolveListenHost({}), '127.0.0.1'));
await t('H2 空串 / 空白 ⇒ 127.0.0.1 (fail-closed)', () => { assert.strictEqual(resolveListenHost({ ADAPTER_HOST: '' }), '127.0.0.1'); assert.strictEqual(resolveListenHost({ ADAPTER_HOST: '   ' }), '127.0.0.1'); });
await t('H3 显式 0.0.0.0 ⇒ 0.0.0.0 (全接口, 须批); 带空白被 trim', () => { assert.strictEqual(resolveListenHost({ ADAPTER_HOST: '0.0.0.0' }), '0.0.0.0'); assert.strictEqual(resolveListenHost({ ADAPTER_HOST: ' 0.0.0.0 ' }), '0.0.0.0'); });
await t('H4 DEFAULT_ADAPTER_HOST 常量 = 127.0.0.1', () => assert.strictEqual(DEFAULT_ADAPTER_HOST, '127.0.0.1'));
await t('H5 真 bind: listen(0, resolveListenHost({})) ⇒ address().address === 127.0.0.1 (不是 :: / 0.0.0.0)', async () => {
  const s = http.createServer((_, r) => r.end());
  await new Promise((res, rej) => s.listen(0, resolveListenHost({}), (e) => (e ? rej(e) : res())));
  const a = s.address(); s.close();
  assert.strictEqual(a.address, '127.0.0.1', JSON.stringify(a));
});
await t('H6 源级: index.mjs 的 server.listen 带 HOST 参数且日志打 host:port; 不再有裸 listen(PORT, cb)', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.mjs'), 'utf8');
  assert.ok(/server\.listen\(PORT,\s*HOST,/.test(src), 'listen 缺 HOST');
  assert.ok(!/server\.listen\(PORT,\s*\(\)/.test(src), '残留裸 listen(PORT, cb)');
  assert.ok(/listening on \$\{HOST\}:\$\{PORT\}/.test(src), '启动日志缺 host');
  assert.ok(/const HOST = resolveListenHost\(\)/.test(src), 'HOST 未经 resolveListenHost');
});
console.log(`listen-host: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
