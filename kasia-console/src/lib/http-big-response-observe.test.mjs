// http-big-response-observe.test.mjs — M10 observe-only 钩子离线测试 (fastify.inject, 不监听端口, 不碰 DB).
// 跑: cd kasia-console && node src/lib/http-big-response-observe.test.mjs   期望 8/8
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import Fastify from 'fastify';
import { installBigResponseObserve, makeBigResponseObserver, makeRequestT0Marker, defaultSizeOf } from './http-big-response-observe.mjs';

let n = 0, fail = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };

const BIG = 'x'.repeat(2 * 1024 * 1024);   // 2MB
const SMALL = 'ok';
const STEP_RE = /^\[diag:step\] http\.onSend\.big route=\S+ method=\S+ bytes=\d+ status=\d+ ms=\d+ at=\S+$/;

function addRoutes(app) {
  app.get('/big', async () => BIG);
  app.get('/small', async () => SMALL);
  app.get('/stream', async (req, reply) => { reply.type('application/octet-stream'); return Readable.from([Buffer.from('abc'), Buffer.from('def')]); });
  app.get('/buf', async (req, reply) => { reply.type('application/octet-stream'); return Buffer.alloc(1024 * 1024 + 1, 1); });
}

// 无钩子基线: 同样的路由, 记响应体/状态/content-length, 供负向量逐字节比对
async function baseline(path) {
  const app = Fastify({ logger: false }); addRoutes(app); await app.ready();
  const r = await app.inject({ method: 'GET', url: path }); await app.close();
  return { status: r.statusCode, body: r.body, len: r.headers['content-length'] };
}

async function withHook(path, opts, { routesFirst = false } = {}) {
  const lines = [];
  const app = Fastify({ logger: false });
  const o = { thresholdBytes: 1024 * 1024, log: (s) => lines.push(s), ...opts };
  if (routesFirst) { addRoutes(app); installBigResponseObserve(app, o); }
  else { installBigResponseObserve(app, o); addRoutes(app); }
  await app.ready();
  const r = await app.inject({ method: 'GET', url: path }); await app.close();
  return { status: r.statusCode, body: r.body, len: r.headers['content-length'], lines };
}

await t('V1 正向: 2MB 字符串响应 ⇒ 一行 big, 响应逐字节不变', async () => {
  const b = await baseline('/big'); const h = await withHook('/big');
  assert.equal(h.lines.length, 1); assert.match(h.lines[0], STEP_RE);
  assert.match(h.lines[0], /route=\/big method=GET bytes=2097152 status=200 ms=\d+ /);
  assert.equal(h.status, b.status); assert.equal(h.body, b.body); assert.equal(h.len, b.len);
});
await t('V2 阈下: 2B 响应 ⇒ 零行, 响应不变', async () => {
  const b = await baseline('/small'); const h = await withHook('/small');
  assert.equal(h.lines.length, 0); assert.equal(h.body, b.body); assert.equal(h.status, b.status);
});
await t('V3 流式: stream payload ⇒ sizeOf=null 跳过, 零行, 响应不变', async () => {
  assert.equal(defaultSizeOf(Readable.from(['a'])), null);
  const b = await baseline('/stream'); const h = await withHook('/stream');
  assert.equal(h.lines.length, 0); assert.equal(h.body, b.body); assert.equal(h.status, b.status);
});
await t('V4 负向量: sizeOf 内 throw ⇒ 零行, 响应体/状态/长度与无钩子逐字节相同', async () => {
  const b = await baseline('/big'); const h = await withHook('/big', { sizeOf: () => { throw new Error('boom'); } });
  assert.equal(h.lines.length, 0); assert.equal(h.status, b.status); assert.equal(h.body, b.body); assert.equal(h.len, b.len);
});
await t('V5 负向量: log 自身 throw ⇒ 响应不变', async () => {
  const b = await baseline('/big'); const h = await withHook('/big', { log: () => { throw new Error('log boom'); } });
  assert.equal(h.status, b.status); assert.equal(h.body, b.body); assert.equal(h.len, b.len);
});
await t('V6 grep 形: Buffer payload >1MB 一行且匹配正则; 直接调钩子函数返回值 === payload', async () => {
  const h = await withHook('/buf'); assert.equal(h.lines.length, 1); assert.match(h.lines[0], STEP_RE);
  const hook = makeBigResponseObserver({ thresholdBytes: 1, log: () => {} }); const p = Buffer.from('zz');
  const req = {}; await makeRequestT0Marker()(req);
  assert.equal(await hook(req, { statusCode: 200 }, p), p);
  assert.equal(await hook(null, null, 'str'), 'str');   // request/reply 缺失也原样返回
});
await t('V7 step 行形: 其它 7 个 site 的模板串与 grep 契约一致', () => {
  const at = new Date().toISOString();
  const lines = [
    `[diag:step] settle.selectRipeMarkets.all ms=12 rows=109 at=${at}`,
    `[diag:step] pool.selectMarkets.all ms=5 rows=127 at=${at}`,
    `[diag:step] zk.closeTickV2 ms=3 at=${at}`,
    `[diag:step] zk.claimAutonomousTick ms=3 at=${at}`,
    `[diag:step] zk.handoffAutonomousTick ms=3 at=${at}`,
    `[diag:step] zk.judgeProposeAutonomousTick ms=3 at=${at}`,
    `[diag:step] pair.scanAndIngestPairs ms=568 since_id=0 max_id=fffea2dc-b44 hits=2 at=${at}`,
  ];
  const re = /^\[diag:step\] (settle\.selectRipeMarkets\.all|pool\.selectMarkets\.all|zk\.closeTickV2|zk\.claimAutonomousTick|zk\.handoffAutonomousTick|zk\.judgeProposeAutonomousTick|pair\.scanAndIngestPairs) ms=\d+( \S+=\S+)* at=\S+$/;
  for (const l of lines) assert.match(l, re);
});
await t('V8 (NWT C3) 路由先注册、钩子后安装 ⇒ big 行仍打出、响应不变', async () => {
  const b = await baseline('/big'); const h = await withHook('/big', {}, { routesFirst: true });
  assert.equal(h.lines.length, 1); assert.match(h.lines[0], STEP_RE);
  assert.equal(h.status, b.status); assert.equal(h.body, b.body);
});

console.log(`\n${n - fail}/${n} PASS`);
process.exit(fail ? 1 : 0);
