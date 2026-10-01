// tokens-ktt-mint-amount.test.mjs — KTT 指定数量铸币(Bettor 2026-10-02 派工 第一步)的请求体校验单测:
// amount 必填、整数字符串、BigInt 全程、> 0、≤ 2^53-1(顺带关 Codex R11 ②: 超 MAX_SAFE_INTEGER 一律拒, 不失精度)。
// 链上行为(铸 1,000,000 KTT 只锁最小 KAS、mint→transfer→再花数量守恒、2^53-1 边界、多 1 被共识拒)
// 见 docs/provenance/2026-10-02-j2-ktt-mint-amount/sim_mint_amount.log(真 simnet 广播)。
// Run: cd kasia-console && node src/api/tokens-ktt-mint-amount.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._KTT_MINT_AMOUNT_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_ktt_mint_amount_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _KTT_MINT_AMOUNT_TEST_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
process.env.KASPA_NETWORK = 'simnet';
process.env.KTT_PANEL_ENABLED = '1';
process.env.KTT_PANEL_RELAY_ID = 'relay-not-in-db'; // 校验发生在查 relay 之前; 合法请求会在下游 500(relay 不存在), 本测试只看 400 vs 非 400
delete process.env.KTT_PANEL_RATE_LIMIT_PER_MIN; delete process.env.KTT_PANEL_RATE_LIMIT_PER_DAY;

import Fastify from 'fastify';
const { registerTokenRoutes, parseKttAmount, KTT_V2_MIN_LOCK_SOMPI } = await import('./tokens.js');
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };

console.log('[test] parseKttAmount:');
const MAXS = String(Number.MAX_SAFE_INTEGER);
ok(parseKttAmount('1').amount === 1n, '"1" → 1n');
ok(parseKttAmount('1000000').amount === 1000000n, '"1000000" → 1000000n');
ok(parseKttAmount(MAXS).amount === 9007199254740991n, `边界 2^53-1 "${MAXS}" 接受, 且 BigInt 原样`);
ok(!!parseKttAmount('9007199254740992').error, '边界 2^53 拒绝');
ok(!!parseKttAmount('9007199254740993').error, '边界 2^53+1 拒绝(Number 会把它读成 2^53, 必须按字符串/BigInt 判)');
ok(!!parseKttAmount('99999999999999999999999').error, '远超上限拒绝');
ok(!!parseKttAmount('0').error, '0 拒绝');
ok(!!parseKttAmount('-5').error, '负数拒绝');
ok(!!parseKttAmount('1.5').error, '小数拒绝');
ok(!!parseKttAmount('1e6').error, '科学计数法拒绝');
ok(!!parseKttAmount('0x10').error, '十六进制拒绝');
ok(!!parseKttAmount('').error, '空串拒绝');
ok(!!parseKttAmount('12 3').error, '含空格拒绝');
ok(!!parseKttAmount(undefined).error && !!parseKttAmount(null).error && !!parseKttAmount({}).error, 'undefined/null/对象 拒绝');
ok(parseKttAmount(1000).amount === 1000n, 'JS 安全整数 number 也接受(1000)');
ok(!!parseKttAmount(9007199254740993).error, '超安全整数的 number 拒绝(字面量已失精度)');
ok(!!parseKttAmount(1.5).error, 'number 小数拒绝');
ok(KTT_V2_MIN_LOCK_SOMPI === 70_000_000n, '最小锁量常量 = 70,000,000 sompi(0.7 KAS, 实测依据见 tokens.js 注释)');

console.log('[test] POST /api/ktt/mint 请求体(过闸后、触达 relay 之前):');
const app = Fastify(); await registerTokenRoutes(app); await app.ready();
const post = (payload) => app.inject({ method: 'POST', url: '/api/ktt/mint', payload });
const body = (r) => { try { return JSON.parse(r.body); } catch { return {}; } };
const base = { owner_scheme: 0, owner_hex: 'a'.repeat(64) };
{ const r = await post({ ...base }); ok(r.statusCode === 400 && /amount/.test(body(r).error), `缺 amount ⇒ 400(实际 ${r.statusCode} ${body(r).error})`); }
{ const r = await post({ ...base, amount: '0' }); ok(r.statusCode === 400, `amount=0 ⇒ 400(${r.statusCode})`); }
{ const r = await post({ ...base, amount: '9007199254740992' }); ok(r.statusCode === 400 && /上限/.test(body(r).error), `amount=2^53 ⇒ 400(${r.statusCode} ${body(r).error})`); }
{ const r = await post({ ...base, amount: '9007199254740993' }); ok(r.statusCode === 400, `amount=2^53+1 ⇒ 400(${r.statusCode})`); }
{ const r = await app.inject({ method: 'POST', url: '/api/ktt/mint', headers: { 'content-type': 'application/json' }, payload: '{"owner_scheme":0,"owner_hex":"' + 'a'.repeat(64) + '","amount":9007199254740993}' });
  ok(r.statusCode === 400, `JSON 数字字面量 2^53+1(已失精度)⇒ 400(${r.statusCode})`); }
{ const r = await post({ ...base, amount: '1.5' }); ok(r.statusCode === 400, `amount=1.5 ⇒ 400(${r.statusCode})`); }
{ const r = await post({ ...base, amount: MAXS }); ok(r.statusCode !== 400, `amount=2^53-1 ⇒ 过校验(下游因 relay 不在库非 400, 实际 ${r.statusCode} ${body(r).error || ''})`); }
{ const r = await post({ ...base, amount: '1000000' }); ok(r.statusCode !== 400, `amount=1000000 ⇒ 过校验(实际 ${r.statusCode})`); }

await app.close();
console.log(fails ? `\n${fails} 失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
