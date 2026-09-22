// proto-oracle-policy.test.mjs — oracle 整合批 B / B5(N5b): judgedMarketAllowedHere 唯一谓词 + 开关 / 白名单解析 + "三处强制同一谓词"的源码钉。
// 纯逻辑(无 DB / 无 IO)+ 读源码。Run: cd kasia-console && node src/lib/proto-oracle-policy.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgedMarketAllowedHere, nonJudgedMarketAllowedHere, parseValuelessTokenIds, resolveOraclePolicy, logOraclePolicy, ENV_ADAPTER_ENABLED, ENV_VALUELESS_TOKEN_IDS } from './proto-oracle-policy.mjs';

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const HERE = path.dirname(fileURLToPath(import.meta.url)), SRC = path.resolve(HERE, '..');
const W = (ids) => ({ [ENV_VALUELESS_TOKEN_IDS]: ids });

await t('P1 ▲ 唯一谓词: 非主网一律允许(simnet / testnet-12 / devnet, 有无白名单都行); 主网仅白名单内的 tokenDefId 允许; 主网白名单空 / 不在名单 / tokenDefId 缺失或非字符串 ⇒ 拒', () => {
  for (const net of ['simnet', 'testnet-12', 'testnet-10', 'devnet']) for (const env of [{}, W('a,b')]) assert.deepEqual(judgedMarketAllowedHere({ network: net, tokenDefId: 'x', env }), { allowed: true, reason: 'non_mainnet' }, net);
  assert.equal(judgedMarketAllowedHere({ network: 'mainnet', tokenDefId: 'tok-1', env: W('tok-1') }).allowed, true);
  assert.equal(judgedMarketAllowedHere({ network: 'mainnet', tokenDefId: 'tok-2', env: W('tok-1, tok-2 ,tok-3') }).allowed, true, '空白容忍');
  for (const [tok, env] of [['tok-1', {}], ['tok-1', W('')], ['tok-1', W('tok-2')], ['TOK-1', W('tok-1')], ['tok-1 ', W('tok-1x')], [undefined, W('tok-1')], [null, W('tok-1')], ['', W('tok-1')], [5, W('5')], [['tok-1'], W('tok-1')]]) {
    const r = judgedMarketAllowedHere({ network: 'mainnet', tokenDefId: tok, env }); assert.equal(r.allowed, false, JSON.stringify([tok, env])); assert.ok(r.reason.length > 0);
  }
  for (const net of [undefined, null, '', '  ', 5, {}]) assert.deepEqual(judgedMarketAllowedHere({ network: net, tokenDefId: 'tok-1', env: W('tok-1') }), { allowed: false, reason: 'network_unknown_fail_closed' }, String(net));
  for (const net of ['Mainnet', 'MAINNET', ' mainnet ', 'mainnet\n']) { assert.equal(judgedMarketAllowedHere({ network: net, tokenDefId: 'tok-1', env: {} }).allowed, false, JSON.stringify(net) + ': 大小写 / 空白变体仍按主网处理(闸不假设上游规范化)'); assert.equal(judgedMarketAllowedHere({ network: net, tokenDefId: 'tok-1', env: W('tok-1') }).allowed, true, net); }
  assert.equal(judgedMarketAllowedHere({ network: 'mainnet', tokenDefId: 'tok-1' }).allowed, false, '不传 env 取 process.env(此处未设白名单)');
});
await t('P2 白名单解析: 逗号分隔 / 去空白 / 去重 / 非法项(含空格内部 / 特殊字符 / 过长)进 rejected 不进白名单; 空 / undefined / null ⇒ 空', () => {
  assert.deepEqual(parseValuelessTokenIds(' a , b,, a ,c-1_2:3.4 '), { ids: ['a', 'b', 'c-1_2:3.4'], rejected: [] });
  const r = parseValuelessTokenIds('ok,bad id,x;y,' + 'z'.repeat(81) + ',$(rm)'); assert.deepEqual(r.ids, ['ok']); assert.equal(r.rejected.length, 4);
  for (const v of [undefined, null, '', '   ', ',,,']) assert.deepEqual(parseValuelessTokenIds(v), { ids: [], rejected: [] }, String(v));
});
await t('P3 开关默认关且只认字面 "1"; 生效策略含 network / 白名单 / 警告; LOUD 日志带生效值(主网另加 N5b 提示), 非法白名单项 LOUD', () => {
  for (const v of [undefined, '', '0', 'true', 'yes', '2', ' 1']) assert.equal(resolveOraclePolicy({ env: { [ENV_ADAPTER_ENABLED]: v }, network: 'simnet' }).adapterEnabled, false, String(v));
  assert.equal(resolveOraclePolicy({ env: { [ENV_ADAPTER_ENABLED]: '1' }, network: 'simnet' }).adapterEnabled, true);
  const p = resolveOraclePolicy({ env: { [ENV_ADAPTER_ENABLED]: '1', ...W('a,bad id') }, network: 'mainnet' }); assert.deepEqual(p.valuelessTokenIds, ['a']); assert.equal(p.warnings.length, 1);
  const lines = []; logOraclePolicy({ log: (l) => lines.push(['log', l]), warn: (l) => lines.push(['warn', l]), error: (l) => lines.push(['error', l]) }, p);
  assert.ok(lines.some(([lv, l]) => lv === 'warn' && /network=mainnet/.test(l) && /valueless_token_ids=\[a\]/.test(l) && /adapter=ENABLED/.test(l) && /N5b/.test(l)), JSON.stringify(lines)); assert.ok(lines.some(([lv, l]) => lv === 'error' && /POLICY WARNING/.test(l)));
  const l2 = []; logOraclePolicy({ log: (l) => l2.push(l) }, resolveOraclePolicy({ env: {}, network: 'simnet' })); assert.ok(/adapter=disabled\(default\)/.test(l2[0]) && !/N5b/.test(l2[0]));
});
await t('P4 ▲ 三处强制同一谓词(源码钉): 创建路由 / 受理门装配 / adapter core 都 import 并调用 judgedMarketAllowedHere(来自 proto-oracle-policy.mjs), adapter 里扫描与 promote 前各一次; 全仓只有一份定义, 没有第二份"主网 + 白名单"判断', () => {
  const rd = (f) => fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\/[^\n]*/g, '');
  const sites = { 'api/proto.js': 1, 'lib/proto-bet-intake.mjs': 1, 'lib/proto-oracle-adapter-core.mjs': 2 };
  for (const [f, minCalls] of Object.entries(sites)) {
    const s = rd(f); assert.ok(/proto-oracle-policy\.mjs/.test(s), f + ' 应 import proto-oracle-policy.mjs');
    const calls = (s.match(/judgedMarketAllowedHere\(/g) || []).length; assert.ok(calls >= minCalls, `${f}: judgedMarketAllowedHere( 调用 ${calls} < ${minCalls}`);
  }
  // 全仓(src/)扫: 定义只有一份; 不得出现绕过谓词的第二份判断(直接读 PROTO_ORACLE_VALUELESS_TOKEN_IDS 的地方只能是 policy 模块本身)
  const all = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.(m?js)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) all.push(p); } }; walk(SRC);
  const defs = all.filter((p) => /function\s+judgedMarketAllowedHere\b/.test(fs.readFileSync(p, 'utf8'))); assert.equal(defs.length, 1, '定义文件: ' + defs.join(','));
  const readers = all.filter((p) => /PROTO_ORACLE_VALUELESS_TOKEN_IDS/.test(fs.readFileSync(p, 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''))).map((p) => path.relative(SRC, p).replace(/\\/g, '/'));
  assert.deepEqual(readers.sort(), ['lib/proto-oracle-policy.mjs'], '只有 policy 模块读白名单 env: ' + readers.join(','));
});
await t('P5 三处的行为(不只是 import): 主网 + 非白名单 ⇒ 创建 403 / 受理 403 / adapter 跳过——各自在专属测试里断言(proto-oracle-create-route / proto-bet-intake / proto-oracle-adapter-core); 这里只钉它们都存在', () => {
  for (const f of ['lib/proto-oracle-adapter-core.test.mjs', 'api/proto-oracle-create-route.test.mjs', 'lib/proto-bet-intake.test.mjs']) assert.ok(fs.existsSync(path.join(SRC, f)), f + ' 应存在');
});
await t('P6 ▲ D-032 §2.7 唯一谓词 nonJudgedMarketAllowedHere: 非主网一律允许; 主网一律拒(没有白名单例外, 不同 judgedMarketAllowedHere——非判定题在主网没有任何出口); network 缺失/非字符串/大小写空白变体 ⇒ fail-closed 拒', () => {
  for (const net of ['simnet', 'testnet-12', 'testnet-10', 'devnet']) assert.deepEqual(nonJudgedMarketAllowedHere({ network: net }), { allowed: true, reason: 'non_mainnet' }, net);
  for (const net of ['mainnet', 'Mainnet', 'MAINNET', ' mainnet ', 'mainnet\n']) { const r = nonJudgedMarketAllowedHere({ network: net }); assert.equal(r.allowed, false, JSON.stringify(net)); assert.ok(r.reason.length > 0); }
  for (const net of [undefined, null, '', '  ', 5, {}, []]) assert.deepEqual(nonJudgedMarketAllowedHere({ network: net }), { allowed: false, reason: 'network_unknown_fail_closed' }, String(net));
  assert.deepEqual(nonJudgedMarketAllowedHere({}), { allowed: false, reason: 'network_unknown_fail_closed' }, '不传 network 同样 fail-closed(这个谓词没有 process.env 兜底——network 必须由调用方显式传入)');
});
await t('P7 ▲ D-032 §2.7 源码钉: 创建路由 import 并调用 nonJudgedMarketAllowedHere(仅非判定题分支); 全仓只有一份定义', () => {
  const rd = (f) => fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\/[^\n]*/g, '');
  const s = rd('api/proto.js'); assert.ok(/nonJudgedMarketAllowedHere\(/.test(s), 'api/proto.js 应调用 nonJudgedMarketAllowedHere(');
  const all = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.(m?js)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) all.push(p); } }; walk(SRC);
  const defs = all.filter((p) => /function\s+nonJudgedMarketAllowedHere\b/.test(fs.readFileSync(p, 'utf8'))); assert.equal(defs.length, 1, '定义文件: ' + defs.join(','));
});

console.log(`\nproto-oracle-policy.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
