// diag-step.test.mjs — M10 v2 helper 离线测试(零 DB、零网络、零子进程). 跑: cd kasia-console && node src/lib/diag-step.test.mjs
// 判据: 透传(this/args/返回值/异常对象同一引用)、阈值门、thenable 分支、日志抛出不影响被包函数。
import assert from 'node:assert/strict';
import { stepSync, procStep, wrapTick, logStep } from './diag-step.mjs';

let n = 0, fail = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };

// 截获 console.log(helper 只走 console.log)
const lines = [];
const origLog = console.log;
function capture(fn) {
  lines.length = 0;
  console.log = (s) => { lines.push(String(s)); };
  try { return fn(); } finally { console.log = origLog; }
}
async function captureAsync(fn) {
  lines.length = 0;
  console.log = (s) => { lines.push(String(s)); };
  try { return await fn(); } finally { console.log = origLog; }
}
const LINE_RE = /^\[diag:step\] (\S+) ms=(\d+)(?: \S+=\S+)* at=\d{4}-\d{2}-\d{2}T\S+Z$/;
const busy = (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { /* spin */ } };

await t('S1 stepSync 透传返回值 + 每次打一行(threshold 0) + 行格式', () => {
  const obj = { a: 1 };
  const r = capture(() => stepSync('t.s1', () => obj, { fields: { rows: 3 } }));
  assert.equal(r, obj);
  assert.equal(lines.length, 1); assert.match(lines[0], LINE_RE);
  assert.match(lines[0], /^\[diag:step\] t\.s1 ms=\d+ rows=3 ok=1 at=/);
});
await t('S2 stepSync 异常对象同一引用透传, 行 ok=0', () => {
  const err = new Error('boom'); err.stderr = Buffer.from('x');
  let caught = null;
  capture(() => { try { stepSync('t.s2', () => { throw err; }); } catch (e) { caught = e; } });
  assert.equal(caught, err); assert.equal(caught.stderr.toString(), 'x');
  assert.equal(lines.length, 1); assert.match(lines[0], / ok=0 at=/);
});
await t('S3 stepSync 阈值门: 快于阈值不打, 慢于阈值打', () => {
  capture(() => stepSync('t.s3a', () => 1, { thresholdMs: 1000 }));
  assert.equal(lines.length, 0);
  capture(() => stepSync('t.s3b', () => busy(20), { thresholdMs: 10 }));
  assert.equal(lines.length, 1); assert.match(lines[0], /^\[diag:step\] t\.s3b ms=(1\d|[2-9]\d|\d{3,}) /);
});
await t('S4 procStep 带 cmd= 且每次打', () => {
  const r = capture(() => procStep('proc.t', 'silverc', () => 'out'));
  assert.equal(r, 'out'); assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[diag:step\] proc\.t ms=\d+ cmd=silverc ok=1 at=/);
});
await t('S5 日志自身 throw ⇒ 被包函数照常返回/照常抛', () => {
  console.log = () => { throw new Error('log boom'); };
  try {
    assert.equal(stepSync('t.s5', () => 42), 42);
    const err = new Error('e'); let caught;
    try { stepSync('t.s5b', () => { throw err; }); } catch (e) { caught = e; }
    assert.equal(caught, err);
  } finally { console.log = origLog; }
});
await t('W1 wrapTick 同步回调: 保留 this / args / 返回值, 阈下零行', () => {
  const ctx = { k: 7 };
  function f(a, b) { return [this && this.k, a, b]; }
  const w = wrapTick('t.w1', f, { thresholdMs: 1000 });
  const r = capture(() => w.call(ctx, 1, 2));
  assert.deepEqual(r, [7, 1, 2]); assert.equal(lines.length, 0);
});
await t('W2 wrapTick 同步慢回调 ⇒ 一行 sync=', () => {
  const w = wrapTick('t.w2', () => busy(20), { thresholdMs: 10 });
  capture(() => w());
  assert.equal(lines.length, 1); assert.match(lines[0], /^\[diag:step\] t\.w2 ms=\d+ sync=\d+ ok=1 at=/);
});
await t('W3 wrapTick 异步回调: 返回 thenable, 解析值透传, settle 后打 ms=总 sync=前缀', async () => {
  const w = wrapTick('t.w3', async () => { busy(15); await new Promise((r) => setTimeout(r, 30)); return 'v'; }, { thresholdMs: 10 });
  const v = await captureAsync(() => w());
  assert.equal(v, 'v');
  const main = lines.filter((l) => l.startsWith('[diag:step] t.w3 ms='));
  assert.equal(main.length, 1); assert.match(main[0], /^\[diag:step\] t\.w3 ms=(4\d|[5-9]\d|\d{3,}) sync=(1\d|[2-9]\d|\d{3,}) ok=1 at=/);
  const syncLine = lines.filter((l) => l.startsWith('[diag:step] t.w3.sync ms='));
  assert.equal(syncLine.length, 1);
});
await t('W4 wrapTick 异步 reject: 同一 reason 透传, 行 ok=0, 调用方 .catch 照常', async () => {
  const err = new Error('rej');
  const w = wrapTick('t.w4', () => Promise.reject(err), { thresholdMs: 0 });
  let caught = null;
  await captureAsync(() => w().catch((e) => { caught = e; }));
  assert.equal(caught, err);
  assert.equal(lines.filter((l) => / ok=0 at=/.test(l)).length, 1);
});
await t('W5 wrapTick 同步 throw: 异常原样抛出', () => {
  const err = new Error('sync');
  const w = wrapTick('t.w5', () => { throw err; }, { thresholdMs: 0 });
  let caught = null;
  capture(() => { try { w(); } catch (e) { caught = e; } });
  assert.equal(caught, err); assert.equal(lines.length, 1); assert.match(lines[0], / ok=0 at=/);
});
await t('W6 wrapTick 不改 setInterval 语义: 包后的函数可被 clearInterval 正常停', async () => {
  let calls = 0;
  const id = setInterval(wrapTick('t.w6', () => { calls++; }, { thresholdMs: 1000 }), 5);
  await new Promise((r) => setTimeout(r, 40));
  clearInterval(id);
  const c = calls; await new Promise((r) => setTimeout(r, 30));
  assert.ok(c >= 2); assert.equal(calls, c);
});
await t('L1 logStep 行格式', () => {
  capture(() => logStep('t.l1', 12, { pre: 3, post: 9 }));
  assert.equal(lines.length, 1); assert.match(lines[0], /^\[diag:step\] t\.l1 ms=12 pre=3 post=9 at=/);
});

console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
