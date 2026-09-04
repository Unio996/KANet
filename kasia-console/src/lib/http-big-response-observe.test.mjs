// http-big-response-observe.test.mjs — M10 observe-only 钩子离线测试 (fastify.inject, 不监听端口, 不碰 DB).
// 跑: cd kasia-console && node src/lib/http-big-response-observe.test.mjs   期望 12/12 (v2: +V9..V12 slow 档与 ip/ua/q 字段)
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import Fastify from 'fastify';
import { installBigResponseObserve, makeBigResponseObserver, makeRequestT0Marker, defaultSizeOf, requestFields } from './http-big-response-observe.mjs';

let n = 0, fail = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };

const BIG = 'x'.repeat(2 * 1024 * 1024);   // 2MB
const SMALL = 'ok';
// v2: ms= 之后 at= 之前允许任意 k=v token(ip/ua/q), 与 readout 正则同契约
const STEP_RE = /^\[diag:step\] http\.onSend\.big route=\S+ method=\S+ bytes=\d+ status=\d+ ms=\d+( \S+=\S+)* at=\S+$/;
const SLOW_RE = /^\[diag:step\] http\.slow route=\S+ method=\S+ bytes=(\d+|-) status=\d+ ms=\d+( \S+=\S+)* at=\S+$/;
const SLOW_MS_TEST = 120;   // 测试用 slow 阈值(生产默认 500)

function addRoutes(app) {
  app.get('/big', async () => BIG);
  app.get('/small', async () => SMALL);
  app.get('/stream', async (req, reply) => { reply.type('application/octet-stream'); return Readable.from([Buffer.from('abc'), Buffer.from('def')]); });
  app.get('/buf', async (req, reply) => { reply.type('application/octet-stream'); return Buffer.alloc(1024 * 1024 + 1, 1); });
  app.get('/slow', async () => { await new Promise((r) => setTimeout(r, SLOW_MS_TEST * 2)); return SMALL; });
  app.get('/slowbig', async () => { await new Promise((r) => setTimeout(r, SLOW_MS_TEST * 2)); return BIG; });
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
  const o = { thresholdBytes: 1024 * 1024, slowMs: SLOW_MS_TEST, log: (s) => lines.push(s), ...opts };
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
await t('V7 step 行形: 其它 8 个 site 的模板串与 grep 契约一致', () => {
  const at = new Date().toISOString();
  const lines = [
    `[diag:step] settle.selectRipeMarkets.all ms=12 rows=109 at=${at}`,
    `[diag:step] pool.selectMarkets.all ms=5 rows=127 at=${at}`,
    `[diag:step] zk.closeTickV2 ms=3 at=${at}`,
    `[diag:step] zk.claimAutonomousTick ms=3 at=${at}`,
    `[diag:step] zk.handoffAutonomousTick ms=3 at=${at}`,
    `[diag:step] zk.judgeProposeAutonomousTick ms=3 at=${at}`,
    `[diag:step] pair.scanAndIngestPairs ms=568 since_id=0 max_id=fffea2dc-b44 hits=2 at=${at}`,
    `[diag:step] http.discovery.activity ms=1200 profiles_ms=900 handshakes_ms=250 stats_ms=50 limit=200 profiles=200 handshakes=1234 at=${at}`,   // 第 9 站 (Bettor 14:3xZ 裁进, H5)
  ];
  const re = /^\[diag:step\] (settle\.selectRipeMarkets\.all|pool\.selectMarkets\.all|zk\.closeTickV2|zk\.claimAutonomousTick|zk\.handoffAutonomousTick|zk\.judgeProposeAutonomousTick|pair\.scanAndIngestPairs|http\.discovery\.activity) ms=\d+( \S+=\S+)* at=\S+$/;
  for (const l of lines) assert.match(l, re);
});
await t('V8 (NWT C3) 路由先注册、钩子后安装 ⇒ big 行仍打出、响应不变', async () => {
  const b = await baseline('/big'); const h = await withHook('/big', {}, { routesFirst: true });
  assert.equal(h.lines.length, 1); assert.match(h.lines[0], STEP_RE);
  assert.equal(h.status, b.status); assert.equal(h.body, b.body);
});
await t('V9 (v2) slow 档: 小响应但 handler > slowMs ⇒ 一行 http.slow, bytes=2, 响应不变', async () => {
  const b = await baseline('/slow'); const h = await withHook('/slow');
  assert.equal(h.lines.length, 1); assert.match(h.lines[0], SLOW_RE);
  assert.match(h.lines[0], /route=\/slow method=GET bytes=2 status=200 ms=\d+ ip=\S+ ua=\S+ q=- at=/);
  const ms = Number(h.lines[0].match(/ ms=(\d+)/)[1]); assert.ok(ms >= SLOW_MS_TEST, `ms=${ms}`);
  assert.equal(h.body, b.body); assert.equal(h.status, b.status);
});
await t('V10 (v2) 快且小 ⇒ 零行(slow 档不误报); slowMs 阈内', async () => {
  const h = await withHook('/small', { slowMs: 5000 }); assert.equal(h.lines.length, 0);
});
await t('V11 (v2) big 行带 ip= ua= q=: query 原样截 48、空白换 _、无 query ⇒ q=-', async () => {
  const h = await withHook('/big?linked_addr=kaspatest:qr6mkexx&x=1');
  assert.equal(h.lines.length, 1); assert.match(h.lines[0], STEP_RE);
  assert.match(h.lines[0], / ip=\S+ ua=\S+ q=linked_addr=kaspatest:qr6mkexx&x=1 at=/);
  const f = requestFields({ ip: '127.0.0.1', headers: { 'user-agent': 'node fetch/1.0 (x)' }, url: '/a?' + 'k'.repeat(100) });
  assert.equal(f.ip, '127.0.0.1'); assert.equal(f.ua, 'node_fetch/1.0_(x)'); assert.equal(f.q.length, 48);
  assert.deepEqual(requestFields(null), { ip: '-', ua: '-', q: '-' });
  assert.deepEqual(requestFields({ url: '/nothing' }), { ip: '-', ua: '-', q: '-' });
});
await t('V12 (v2) 既 big 又 slow ⇒ 只打一行 big(含 ms), 不重复打 slow', async () => {
  const h = await withHook('/slowbig');
  assert.equal(h.lines.length, 1); assert.match(h.lines[0], STEP_RE);
  const ms = Number(h.lines[0].match(/ ms=(\d+)/)[1]); assert.ok(ms >= SLOW_MS_TEST, `ms=${ms}`);
});

console.log(`\n${n - fail}/${n} PASS`);
process.exit(fail ? 1 : 0);
