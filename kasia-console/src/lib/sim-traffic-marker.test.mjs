// sim-traffic-marker.test.mjs — checkTestHarnessToken regression (S1, 2026-07-17)。
// 文件原名 test-harness-marker.mjs, 撞 .gitignore 的 `test-*.mjs` 规则(挡临时测试脚本用, 本文件
// 名字凑巧撞上前缀约定但实际是要入库的生产代码), 改名避免每次 add 都要 -f 强制。
// 覆盖设计稿 §4 case5 三条独立分支(NWT 非阻塞建议折入 ee75914f): header缺失/env未配置/token值错误。
// Run: cd kasia-console && node src/lib/sim-traffic-marker.test.mjs
import { checkTestHarnessToken } from './sim-traffic-marker.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const fakeRequest = (headers) => ({ headers: headers || {} });

const savedEnv = process.env.TEST_HARNESS_TOKEN;

console.log('[test] ① header 缺失 → isSimulated:false(合法生产请求路径, 不报错):');
{
  delete process.env.TEST_HARNESS_TOKEN;
  const r = checkTestHarnessToken(fakeRequest({}));
  ok(r.isSimulated === false && r.ok === undefined, 'header 缺失时不校验 env, 直接放行为普通请求: ' + JSON.stringify(r));

  process.env.TEST_HARNESS_TOKEN = 'real-secret-value';
  const r2 = checkTestHarnessToken(fakeRequest({}));
  ok(r2.isSimulated === false, 'env 已配置但 header 仍缺失, 同样视为普通请求: ' + JSON.stringify(r2));
}

console.log('[test] ② env 未配置(空/undefined)、但 header 带了任意值 → 403:');
{
  delete process.env.TEST_HARNESS_TOKEN;
  const r = checkTestHarnessToken(fakeRequest({ 'x-test-harness-token': 'anything' }));
  ok(r.ok === false && r.code === 403, 'env 未配置时带 header = 403(fail-closed, 不静默放行): ' + JSON.stringify(r));
  ok(/未配置/.test(r.error), '错误信息指明是未配置(便于排查, 跟"值不匹配"区分)');
}

console.log('[test] ③ env 已配置、header 带了存在但不匹配的值 → 403(独立于②的代码路径):');
{
  process.env.TEST_HARNESS_TOKEN = 'real-secret-value';
  const r = checkTestHarnessToken(fakeRequest({ 'x-test-harness-token': 'wrong-value' }));
  ok(r.ok === false && r.code === 403, 'env 已配置但值不匹配 = 403: ' + JSON.stringify(r));
  ok(/不匹配/.test(r.error), '错误信息指明是不匹配(验证走到了 timingSafeEqual 分支而非提前 env 未配置短路)');

  // 长度不同的错误值(验证 length 前置比较不抛异常, Buffer.from 长度不等直接 false 不进 timingSafeEqual)
  const r2 = checkTestHarnessToken(fakeRequest({ 'x-test-harness-token': 'x' }));
  ok(r2.ok === false && r2.code === 403, '长度不同的错误值同样 403, 不抛异常: ' + JSON.stringify(r2));
}

console.log('[test] ④ env 已配置、header 值精确匹配 → isSimulated:true(唯一的正向放行路径):');
{
  process.env.TEST_HARNESS_TOKEN = 'real-secret-value';
  const r = checkTestHarnessToken(fakeRequest({ 'x-test-harness-token': 'real-secret-value' }));
  ok(r.isSimulated === true && r.ok === undefined, '值精确匹配 → isSimulated:true: ' + JSON.stringify(r));
}

if (savedEnv === undefined) delete process.env.TEST_HARNESS_TOKEN; else process.env.TEST_HARNESS_TOKEN = savedEnv;

const total = fails === 0 ? 'ALL GREEN' : `${fails} FAIL`;
console.log(`\n${total}`);
if (fails > 0) process.exitCode = 1;
