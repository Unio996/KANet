// custodial-network.test.mjs — S4(NWT 审 S3): 能力网关 deriveCustodialExecFields 的网络守卫。
// Run: cd kasia-console && node src/lib/custodial-network.test.mjs
// ① 纯函数判据(严格相等, 未设 fail-closed, 行 network 列必须等); ② 静态: capability.js 里守卫【在任何 DB 读之前】、行检查【在解密之前】; ③ 防漂移: 本模块常量 == tg-wallet.js(CR-2 守卫)的 NETWORK 字面量, 文案一致;
// ④ g4 E2E harness 显式设 KASPA_NETWORK=testnet-12(否则新守卫会把它的 LAND 用例挡成 401)。
// 说明: 不 import capability.js 本体(它静态 import relay-manager, M0a 门禁止测试裸 import; 也没有 DB/relay 依赖可隔离)——行为由纯函数测试 + 源码结构断言 + 变异体钉住。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUSTODIAL_NETWORK, custodialNetworkAllowed, custodialRowAllowed, custodialNetworkError } from './custodial-network.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.error(`  ❌ ${name} ${detail}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');

console.log('[test] ① 纯函数判据:');
ok('常量是 testnet-12', CUSTODIAL_NETWORK === 'testnet-12');
ok('KASPA_NETWORK=testnet-12 ⇒ 允许(正向对照臂)', custodialNetworkAllowed({ KASPA_NETWORK: 'testnet-12' }) === true);
for (const v of ['mainnet', 'simnet', 'devnet', 'testnet-10', 'testnet-11', 'testnet-12 ', ' testnet-12', 'Testnet-12', 'TESTNET-12', 'testnet-120', 'testnet-1', '', undefined, null, 0]) {
  ok(`KASPA_NETWORK=${JSON.stringify(v)} ⇒ 不允许(严格相等, 未设 fail-closed)`, custodialNetworkAllowed({ KASPA_NETWORK: v }) === false);
}
ok('env 缺失 ⇒ 不允许(不抛)', custodialNetworkAllowed(undefined) === false && custodialNetworkAllowed(null) === false && custodialNetworkAllowed({}) === false);
ok('默认读 process.env', (() => { const old = process.env.KASPA_NETWORK; process.env.KASPA_NETWORK = 'testnet-12'; const a = custodialNetworkAllowed(); process.env.KASPA_NETWORK = 'mainnet'; const b = custodialNetworkAllowed(); if (old === undefined) delete process.env.KASPA_NETWORK; else process.env.KASPA_NETWORK = old; return a === true && b === false; })());
ok('行 network=testnet-12 ⇒ 允许(正向对照臂)', custodialRowAllowed({ network: 'testnet-12' }) === true);
for (const row of [{ network: 'mainnet' }, { network: 'testnet-12 ' }, { network: '' }, { network: undefined }, {}, null, undefined]) ok(`行 ${JSON.stringify(row)} ⇒ 不允许`, custodialRowAllowed(row) === false);
ok('错误文案: 含守卫前缀与当前网络; 未设显示 (未设)', custodialNetworkError({ KASPA_NETWORK: 'mainnet' }).includes('托管钱包暂不可用') && custodialNetworkError({ KASPA_NETWORK: 'mainnet' }).includes('KASPA_NETWORK=mainnet') && custodialNetworkError({}).includes('KASPA_NETWORK=(未设)'));

console.log('[test] ② capability.js 结构: 守卫在任何 DB 读之前、行检查在解密之前:');
{
  const src = read('../api/capability.js');
  const start = src.indexOf('function deriveCustodialExecFields(fromAddress) {');
  ok('找到 deriveCustodialExecFields', start > 0);
  const body = src.slice(start, src.indexOf('\n}\n', start) + 3);
  const iGuard = body.indexOf('custodialNetworkAllowed()'), iSql = body.indexOf('sqlite.prepare'), iRow = body.indexOf('custodialRowAllowed(w)'), iDec = body.indexOf('decrypt(');
  ok('函数体内调用了 custodialNetworkAllowed() 且返回 ok:false', iGuard > 0 && /if \(!custodialNetworkAllowed\(\)\) return \{ ok: false, error: custodialNetworkError\(\) \};/.test(body));
  ok('网络守卫在 sqlite.prepare(DB 读)之前', iGuard > 0 && iSql > 0 && iGuard < iSql, `guard@${iGuard} sql@${iSql}`);
  ok('行 network 检查在解密之前', iRow > 0 && iDec > 0 && iRow < iDec && /if \(!custodialRowAllowed\(w\)\) return \{ ok: false,/.test(body), `row@${iRow} decrypt@${iDec}`);
  ok('行检查在取行之后(w 已定义)', iSql > 0 && iRow > iSql);
  ok('文件顶部 import 了三个判据函数', /import \{ custodialNetworkAllowed, custodialRowAllowed, custodialNetworkError \} from '\.\.\/lib\/custodial-network\.mjs';/.test(src));
  ok('deriveCustodialExecFields 仍只有一个调用点且在 armed 检查之后(顺序未被改动)', (src.match(/deriveCustodialExecFields\(/g) || []).length === 2);
}

console.log('[test] ③ 防漂移: 与 tg-wallet.js(CR-2 守卫)同常量、同文案:');
{
  const tgw = read('../api/tg-wallet.js');
  const m = /const NETWORK = '([^']+)';/.exec(tgw);
  ok('tg-wallet.js 的 NETWORK 字面量存在', !!m);
  ok('== custodial-network.mjs 的 CUSTODIAL_NETWORK(漂移即失败; 将来启用主网托管钱包须两处一起改)', !!m && m[1] === CUSTODIAL_NETWORK, m && m[1]);
  ok('文案模板一致: tg-wallet.js 守卫的错误串 == custodialNetworkError 的模板', tgw.includes('`托管钱包暂不可用：本模块仅支持 ${NETWORK}，当前 KASPA_NETWORK=${actual || \'(未设)\'}`') && custodialNetworkError({ KASPA_NETWORK: 'x' }) === '托管钱包暂不可用：本模块仅支持 testnet-12，当前 KASPA_NETWORK=x');
}

console.log('[test] ④ g4 E2E harness 显式设 KASPA_NETWORK=testnet-12:');
{
  const g4 = readFileSync(path.join(HERE, '../../test-framework/cases/m0c1-gate/g4-pilot-custodial-e2e.mjs'), 'utf8');
  ok("g4 在 import 内部模块之前 process.env.KASPA_NETWORK = 'testnet-12'", /process\.env\.KASPA_NETWORK = 'testnet-12';/.test(g4) && g4.indexOf("process.env.KASPA_NETWORK = 'testnet-12'") < g4.indexOf('await import('));
}

console.log(`\n[custodial-network.test] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
