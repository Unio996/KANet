// kaspa-network.test.mjs — 网络单一源 + 前缀一致性 helper 回归（J2 2026-09-13, 设计 v0.2 §4 V1–V12 + V3′; NWT 负测规格 184bf6f5 §B B-1..B-7; V12 = NWT 对抗输入 battery）
// 离线; 固定测试私钥 0x…01 派生四网地址(与设计稿 §4 表逐字同); 不连节点、不读生产库。
// Run: cd kasia-console && node src/lib/kaspa-network.test.mjs
import { PrivateKey, Address } from 'kaspa-wasm';
import { assertAddressOnNetwork, isAddressOnNetwork, checkAddressOnNetwork, configuredNetwork, prefixForNetwork, addressPrefix, rowNetworkMatches, NetworkMismatchError, NETWORKS } from './kaspa-network.mjs';
import * as core from '../../../shared/lib/kaspa-network.mjs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const code = (addr, network, who = 't') => { const r = checkAddressOnNetwork(addr, { network, who }); return r.ok ? 'OK' : r.code; };

const kp = new PrivateKey('0000000000000000000000000000000000000000000000000000000000000001').toKeypair();
const A = { mainnet: kp.toAddress('mainnet').toString(), 'testnet-12': kp.toAddress('testnet-12').toString(), devnet: kp.toAddress('devnet').toString(), simnet: kp.toAddress('simnet').toString() };
const TN = A['testnet-12'], MN = A.mainnet;
// 设计稿 §4 逐字向量(固定私钥 ⇒ 确定性); 变了 = kaspa-wasm 编码变了, 必须显形
ok(TN === 'kaspatest:qpumuen7l8wthtz45p3ftn58pvrs9xlumvkuu2xet8egzkcklqtes5z8rkmpd', `派生 TN 地址与设计稿逐字同 (${TN})`);
ok(MN === 'kaspa:qpumuen7l8wthtz45p3ftn58pvrs9xlumvkuu2xet8egzkcklqtes4ypce9sf', `派生 MN 地址与设计稿逐字同 (${MN})`);

console.log('[V1/V2 正向]');
ok(assertAddressOnNetwork(TN, { network: 'testnet-12' }) === 'testnet-12', 'V1 TN + testnet-12 ⇒ 返回 "testnet-12"(配置值, 非从地址算)');
ok(assertAddressOnNetwork(MN, { network: 'mainnet' }) === 'mainnet', 'V2 MN + mainnet ⇒ "mainnet"');

console.log('[V3/V3′/V5 前缀不匹配 · D-017 过渡态核心]');
ok(code(TN, 'mainnet') === 'prefix-mismatch', 'V3 TN 地址在主网进程 ⇒ prefix-mismatch (B-4)');
ok(code(MN, 'testnet-12') === 'prefix-mismatch', 'V3′ MN 地址在 TN12 进程 ⇒ prefix-mismatch (B-5)');
ok(code(A.devnet, 'mainnet') === 'prefix-mismatch' && code(A.simnet, 'mainnet') === 'prefix-mismatch', 'V5 kaspadev/kaspasim 在主网 ⇒ prefix-mismatch, 绝不映射 mainnet (B-3)');
{
  let thrown = null; try { assertAddressOnNetwork(TN, { network: 'mainnet', who: 'pool.js:744' }); } catch (e) { thrown = e; }
  ok(thrown instanceof NetworkMismatchError && thrown.code === 'prefix-mismatch' && thrown.expectedPrefix === 'kaspa' && thrown.actualPrefix === 'kaspatest' && thrown.who === 'pool.js:744' && thrown.addr.length <= 14, `assert 抛 NetworkMismatchError 带 who/expected/actual, 地址只截 14 字符 (${thrown && thrown.message})`);
}

console.log('[V4 前缀伪造死在校验和 + I3 wasm 不被毒化]');
{
  const spoof = 'kaspa:' + TN.split(':')[1];
  ok(code(spoof, 'mainnet') === 'invalid-checksum', 'V4 kaspa:+TN payload ⇒ invalid-checksum(不是 prefix-mismatch: 校验和先于前缀)');
  ok(Address.validate(MN) === true && code(MN, 'mainnet') === 'OK', 'V4′ 随后合法地址仍 validate=true ⇒ 实例未被毒化');
}

console.log('[V6 空/非串 ⇒ empty, 不抛 TypeError]');
for (const v of ['', undefined, null, 123, {}, []]) ok(code(v, 'mainnet') === 'empty', `V6 ${JSON.stringify(v)} ⇒ empty`);

console.log('[V7 大写 ⇒ invalid-checksum]');
ok(code(TN.toUpperCase(), 'testnet-12') === 'invalid-checksum', 'V7 全大写 ⇒ invalid-checksum(禁"顺手 toLowerCase")');

console.log('[V8 env 单一源无默认 (I1)]');
{
  let t1 = null; try { configuredNetwork({}); } catch (e) { t1 = e; }
  let t2 = null; try { configuredNetwork({ KASPA_NETWORK: 'testnet-11' }); } catch (e) { t2 = e; }
  ok(t1 && /KASPA_NETWORK not set or unknown/.test(t1.message), 'V8 未设 ⇒ throw');
  ok(t2 && /unknown/.test(t2.message), 'V8′ testnet-11 不在表 ⇒ throw (NWT Q2)');
  ok(configuredNetwork({ KASPA_NETWORK: 'mainnet' }) === 'mainnet' && prefixForNetwork('mainnet') === 'kaspa', 'mainnet ⇒ kaspa');
  ok(Object.isFrozen(NETWORKS) && Object.keys(NETWORKS).length === 4, 'NETWORKS 冻结 · 4 网');
  ok(!('networkOfAddress' in core), '不导出 networkOfAddress(反向推断)');
}

console.log('[V9 P2SH 版本地址(真实 spine_p2sh 形)]');
ok(code('kaspatest:pq800ddgy4264utx2mecuwgk06wlj7vrx6klkrkrd74uk4yt9g52wa06zcj7e', 'testnet-12') === 'OK', 'V9 kaspatest:p… (pool_markets 实取 2026-09-13) ⇒ OK');

console.log('[V10 弱注入臂: V1 全部设置只翻 env]');
ok(checkAddressOnNetwork(TN, { env: { KASPA_NETWORK: 'testnet-12' } }).ok === true && checkAddressOnNetwork(TN, { env: { KASPA_NETWORK: 'mainnet' } }).ok === false, 'V10 同地址, env testnet-12 ⇒ 绿 / env mainnet ⇒ 红(断言读的是 env 不是地址)');

console.log('[V12 对抗输入 (NWT _nwt_address_validate_hostile_probe.mjs 十一组, 照抄断言: 全 false 不抛不崩)]');
{
  const hostile = [
    ['empty string', ''],
    ['null byte embedded', 'kaspa:qp\0umuen7l8wthtz45p3ftn'],
    ['very long string 1MB', 'kaspa:' + 'q'.repeat(1_000_000)],
    ['non-ascii/unicode confusable', 'kaspa：qpumuen7l8wthtz45p3ftn58pvrs9xlumvkuu2xet8egzkcklqtes4ypce9sf'],
    ['no colon', 'kaspaqpumuen7l8wthtz45p3ftn58pvrs9xlumvkuu2xet8egzkcklqtes4ypce9sf'],
    ['only colon', ':'],
    ['emoji', 'kaspa:\u{1F600}\u{1F600}\u{1F600}'],
    ['control chars', 'kaspa:\x01\x02\x03\x04'],
    ['surrogate pair broken', 'kaspa:\uD800'],
    ['numeric', '12345'],
    ['object-like string', '[object Object]'],
  ];
  for (const [label, input] of hostile) {
    let r = null, threw = null; try { r = checkAddressOnNetwork(input, { network: 'mainnet' }); } catch (e) { threw = e; }
    ok(!threw && r && r.ok === false && (r.code === 'empty' || r.code === 'invalid-checksum'), `V12 [${label}] ⇒ ${r && r.code} 不抛`);
  }
  ok(Address.validate(MN) === true, 'V12′ battery 之后实例仍健康');
}

console.log('[isAddressOnNetwork 过滤形 + rowNetworkMatches (I4)]');
ok(isAddressOnNetwork(TN, { network: 'testnet-12' }) === true && isAddressOnNetwork(TN, { network: 'mainnet' }) === false && isAddressOnNetwork('garbage', { network: 'mainnet' }) === false, 'isAddressOnNetwork 三态');
ok(rowNetworkMatches('testnet-12', { network: 'mainnet' }) === false && rowNetworkMatches('mainnet', { network: 'mainnet' }) === true, 'I4 DB 行 network ≠ env ⇒ false(不重映射)');
{ let t = null; try { core.checkAddressOnNetwork(TN, { network: 'testnet-12' }); } catch (e) { t = e; } ok(t && /kaspa module required/.test(t.message), 'shared 核心未注入 kaspa ⇒ throw(零依赖契约)'); }

// 向量表落盘核对(NWT 审用; 与本文件断言同源)
{
  const p = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kaspa-network.vectors.json');
  const v = JSON.parse(fs.readFileSync(p, 'utf8'));
  let n = 0;
  for (const row of v.vectors) { if (row.address === '<hostile-battery>') continue; const got = code(row.address, row.network); ok(got === row.expect, `vectors.json ${row.id}: ${got} == ${row.expect}`); n++; }
  ok(n >= 10, `vectors.json 覆盖 ${n} 条`);
}

console.log(fails === 0 ? '\n✅✅ ALL PASS — kaspa-network: I1 无默认 · I2 前缀对照不推断 · I3 validate-only 不构造 · I4 行网络不重映射 · V12 对抗输入不抛' : `\n❌ ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
