// admin-secret-tier-key-export.test.mjs — T-KEY-EXPORT 准入闸负向测试(2026-09-14，设计
// docs/2026-09-14-kanetui-relay-key-export-route-lockdown-design-v0.1.md §4，NWT GREEN 80d0d62a)。
// Run: cd kasia-console && node src/lib/admin-secret-tier-key-export.test.mjs
//
// 只测 checkKeyExportWindow() 本身(纯函数，读两个 env 变量+一次 header 比对，不碰 DB/HTTP)，
// 不测两条路由的完整 HTTP 路径(那需要起服务，属于集成测试范围，另派)。

import { checkKeyExportWindow } from './admin-secret-tier.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name} ${detail}`); }
};
const fakeReq = (headers = {}) => ({ headers });
const clearEnv = () => {
  delete process.env.RELAY_KEY_EXPORT_ENABLED_UNTIL;
  delete process.env.ADMIN_SECRET_KEY_EXPORT;
};

console.log('[test] 两个 env 都未设 → 503（默认关闭）:');
{
  clearEnv();
  const r = checkKeyExportWindow(fakeReq());
  ok('both unset → 503', r.ok === false && r.code === 503, JSON.stringify(r));
}

console.log('[test] 只设时间窗、密钥未设 → 503（缺一不可，第①点）:');
{
  clearEnv();
  process.env.RELAY_KEY_EXPORT_ENABLED_UNTIL = String(Math.floor(Date.now() / 1000) + 300);
  const r = checkKeyExportWindow(fakeReq());
  ok('window set, secret unset → 503', r.ok === false && r.code === 503, JSON.stringify(r));
}

console.log('[test] 只设密钥、时间窗未设 → 503（缺一不可，第②点，不能只靠密钥永久生效）:');
{
  clearEnv();
  process.env.ADMIN_SECRET_KEY_EXPORT = 'test-secret-123';
  const r = checkKeyExportWindow(fakeReq({ 'x-kanet-admin-secret': 'test-secret-123' }));
  ok('secret set, window unset → 503', r.ok === false && r.code === 503, JSON.stringify(r));
}

console.log('[test] 时间窗已过期、密钥对 → 503（自动超时生效，不需要额外定时器清理）:');
{
  clearEnv();
  process.env.RELAY_KEY_EXPORT_ENABLED_UNTIL = String(Math.floor(Date.now() / 1000) - 10);
  process.env.ADMIN_SECRET_KEY_EXPORT = 'test-secret-123';
  const r = checkKeyExportWindow(fakeReq({ 'x-kanet-admin-secret': 'test-secret-123' }));
  ok('window expired → 503', r.ok === false && r.code === 503, JSON.stringify(r));
}

console.log('[test] 时间窗有效、密钥错误 → 403（区分 503 disabled vs 403 auth fail）:');
{
  clearEnv();
  process.env.RELAY_KEY_EXPORT_ENABLED_UNTIL = String(Math.floor(Date.now() / 1000) + 300);
  process.env.ADMIN_SECRET_KEY_EXPORT = 'test-secret-123';
  const r = checkKeyExportWindow(fakeReq({ 'x-kanet-admin-secret': 'wrong-secret' }));
  ok('window valid, wrong secret → 403', r.ok === false && r.code === 403, JSON.stringify(r));
}

console.log('[test] 时间窗有效、密钥缺失(未带 header) → 403:');
{
  const r = checkKeyExportWindow(fakeReq());
  ok('window valid, no header → 403', r.ok === false && r.code === 403, JSON.stringify(r));
}

console.log('[test] 时间窗未过期(边界: 未来 1 秒) + 密钥正确 → 通过:');
{
  clearEnv();
  process.env.RELAY_KEY_EXPORT_ENABLED_UNTIL = String(Math.floor(Date.now() / 1000) + 1);
  process.env.ADMIN_SECRET_KEY_EXPORT = 'test-secret-123';
  const r = checkKeyExportWindow(fakeReq({ 'x-kanet-admin-secret': 'test-secret-123' }));
  ok('boundary: 1s in future + correct secret → ok', r.ok === true, JSON.stringify(r));
}

console.log('[test] 正向：时间窗有效 + 密钥正确 → 通过:');
{
  clearEnv();
  process.env.RELAY_KEY_EXPORT_ENABLED_UNTIL = String(Math.floor(Date.now() / 1000) + 300);
  process.env.ADMIN_SECRET_KEY_EXPORT = 'test-secret-123';
  const r = checkKeyExportWindow(fakeReq({ 'x-kanet-admin-secret': 'test-secret-123' }));
  ok('window valid + correct secret → ok', r.ok === true, JSON.stringify(r));
}

console.log('[test] 时间窗值非法(非数字字符串) → 503（不当成"未设"或崩溃，明确拒绝）:');
{
  clearEnv();
  process.env.RELAY_KEY_EXPORT_ENABLED_UNTIL = 'not-a-unix-timestamp';
  process.env.ADMIN_SECRET_KEY_EXPORT = 'test-secret-123';
  const r = checkKeyExportWindow(fakeReq({ 'x-kanet-admin-secret': 'test-secret-123' }));
  ok('malformed timestamp → 503', r.ok === false && r.code === 503, JSON.stringify(r));
}

clearEnv(); // 测试结束还原, 不留污染给同进程内后续可能的其它 import

console.log(pass && !fail
  ? `\n✅✅ ALL PASS (${pass}/${pass}) — T-KEY-EXPORT: 两env缺一不可/自动超时/403vs503分层/边界值/正向通过`
  : `\n❌ ${fail} assertions failed (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
