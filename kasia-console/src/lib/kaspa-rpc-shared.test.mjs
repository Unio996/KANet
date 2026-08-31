// kaspa-rpc-shared.test.mjs — 共享 RpcClient 模块 + 批 1 站点 conformance（J2 2026-08-30, Bettor 批·NWT 方向 GREEN,
// docs/2026-08-30-j2-kaspa-rpc-client-singleton-design-v0.1.md）。离线: 假构造器注入, 不连 kaspad、不碰 DB。
// 守什么:
//   M1 同 key 多次 getSharedRpc ⇒ 构造 1 次(N 次调用/并发首调) ; 不同 key ⇒ 各 1 次
//   M2 站点永不 disconnect: 模块返回的实例 disconnect 计数 = 0 (除模块自己的断连分类)
//   M3 断连类错误 ⇒ noteSharedRpcError='reconnect' ⇒ 同实例 disconnect 1 次 ⇒ 下次 getSharedRpc 同实例 connect 再调(构造仍 1)
//   M4 业务错(cannot find header / not synced) ⇒ 'business', 不碰连接 ; wasm 毒化串 ⇒ 'poison', 不碰连接
//   M5 url/networkId 缺 ⇒ throw(不静默建错 key)
//   S1 批 1 十个站点源码 conformance: 站点文件里 captureSideLockDaa/faucet/rpc-health/preprune/scanner/relay×2/chain-data/tg-wallet
//      不再 `new RpcClient(` (除测试注入分支) 且引用 getSharedRpc; 突变(换回 new)⇒ 红
// Run: cd kasia-console && node src/lib/kaspa-rpc-shared.test.mjs
import fs from 'node:fs';
import { getSharedRpc as _get, noteSharedRpcError, sharedRpcStats } from './kaspa-rpc-shared.mjs';
// 无 reset 钩子(生产模块不放 *ForTests 符号): 每段用唯一 url 前缀隔离, 构造器经 DI 第二参注入。
let _Fake = null; let _seg = 0;
const getSharedRpc = (args) => _get(args, { Ctor: _Fake });
const _setSharedRpcCtorForTests = (F) => { _Fake = F; };
const _resetSharedRpcForTests = () => { _seg++; };
const U = (s) => `ws://seg${_seg}-${s}`;

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

function makeFakeCtor() {
  const st = { ctor: 0, connect: 0, disconnect: 0, calls: 0 };
  class Fake {
    constructor(opts) { st.ctor++; this.opts = opts; this.isConnected = false; }
    async connect() { st.connect++; this.isConnected = true; }
    async disconnect() { st.disconnect++; this.isConnected = false; }
    async getBlockDagInfo() { st.calls++; if (!this.isConnected) throw new Error('RPC Server (remote error) -> WebSocket -> WebSocket is not connected'); return { virtualDaaScore: 1n }; }
  }
  return { st, Fake };
}

console.log('[M1] 同 key 只构造一次, 并发首调共享 connecting:');
{
  _resetSharedRpcForTests(); const { st, Fake } = makeFakeCtor(); _setSharedRpcCtorForTests(Fake);
  const a = await Promise.all(Array.from({ length: 20 }, () => getSharedRpc({ url: U('x:1'), networkId: 'testnet-12' })));
  ok(st.ctor === 1 && st.connect === 1 && a.every(r => r === a[0]), `20 路并发首调: 构造=${st.ctor} connect=${st.connect} 同实例=${a.every(r => r === a[0])}`);
  for (let i = 0; i < 50; i++) await getSharedRpc({ url: U('x:1'), networkId: 'testnet-12' });
  ok(st.ctor === 1 && st.connect === 1, `再 50 次串行: 构造仍 ${st.ctor}, connect 仍 ${st.connect}`);
  await getSharedRpc({ url: U('x:2'), networkId: 'testnet-12' }); await getSharedRpc({ url: U('x:1'), networkId: 'mainnet' });
  ok(st.ctor === 3 && sharedRpcStats().filter(s => s.key.startsWith(`ws://seg${_seg}-`)).length === 3, `不同 url / networkId ⇒ 各 1 个 (构造=${st.ctor}, 本段 pool=${sharedRpcStats().filter(s => s.key.startsWith(`ws://seg${_seg}-`)).length})`);
  ok(st.disconnect === 0, `M2 站点路径零 disconnect (disconnect=${st.disconnect})`);
}

console.log('[M3] 断连类错误 ⇒ 同实例 disconnect+重连, 不重建:');
{
  _resetSharedRpcForTests(); const { st, Fake } = makeFakeCtor(); _setSharedRpcCtorForTests(Fake);
  const rpc = await getSharedRpc({ url: U('x:1'), networkId: 'testnet-12' });
  rpc.isConnected = false;   // 模拟对端断开
  let err; try { await rpc.getBlockDagInfo(); } catch (e) { err = e; }
  const cls = await noteSharedRpcError(rpc, err);
  ok(cls === 'reconnect' && st.disconnect === 1, `分类=${cls}, 模块 disconnect 1 次`);
  const rpc2 = await getSharedRpc({ url: U('x:1'), networkId: 'testnet-12' });
  ok(rpc2 === rpc && st.ctor === 1 && st.connect === 2 && rpc2.isConnected, `下次取用: 同实例(构造仍 ${st.ctor}), connect 第 ${st.connect} 次, 已连`);
  ok((await rpc2.getBlockDagInfo()).virtualDaaScore === 1n, '重连后调用 ok');
}

console.log('[M4] 业务错 / 毒化 不碰连接:');
{
  _resetSharedRpcForTests(); const { st, Fake } = makeFakeCtor(); _setSharedRpcCtorForTests(Fake);
  const rpc = await getSharedRpc({ url: U('x:1'), networkId: 'testnet-12' });
  ok(await noteSharedRpcError(rpc, new Error('RPC Server (remote error) -> cannot find header abc')) === 'business' && st.disconnect === 0, '"cannot find header" ⇒ business, disconnect 0');
  ok(await noteSharedRpcError(rpc, new Error('RPC node is not synced')) === 'business' && st.disconnect === 0, '"not synced" ⇒ business');
  ok(await noteSharedRpcError(rpc, new Error('RuntimeError: unreachable')) === 'poison' && st.disconnect === 0 && rpc.isConnected, '"RuntimeError: unreachable" ⇒ poison, 不碰连接');
  ok(await noteSharedRpcError(rpc, new Error('getUtxos timeout 12000ms')) === 'business', '调用方超时(非 connect timeout) ⇒ business, 不碰连接');
}

console.log('[M5] 参数缺失 ⇒ throw:');
{
  _resetSharedRpcForTests(); const { Fake } = makeFakeCtor(); _setSharedRpcCtorForTests(Fake);
  let e1, e2; try { await getSharedRpc({ url: '', networkId: 'testnet-12' }); } catch (e) { e1 = e; } try { await getSharedRpc({ url: U('x'), networkId: undefined }); } catch (e) { e2 = e; }
  ok(/url required/.test(e1?.message) && /networkId required/.test(e2?.message), '空 url / 空 networkId 均 throw');
}

console.log('[S1] 批 1 站点 conformance(源码级):');
{
  const sites = [
    ['src/services/trade-protocol-filter.js', 'captureSideLockDaa', /export async function captureSideLockDaa[\s\S]*?\n  let daa = null;/],
    ['src/lib/faucet-utxo-health.mjs', '_readFaucetUtxoState', /async function _readFaucetUtxoState[\s\S]*?\n}/],
    ['src/services/rpc-health.js', 'checkLocal', /async function checkLocal[\s\S]*?\n}/],
    ['src/services/preprune-capture-worker.mjs', '_readNodeSynced', /export async function _readNodeSynced[\s\S]*?\n}/],
    ['src/services/oracle-pool-chain-scanner-cron.mjs', '_getCurrentDaa+tick', /async function _getCurrentDaa[\s\S]*?running = false;/],
    ['src/api/relay.js', 'balance x2', /getBalancesByAddresses/],
    ['src/api/chain-data.js', 'tx lookup', /getMempoolEntry/],
    ['src/api/tg-wallet.js', 'balanceKasForAddress', /async function balanceKasForAddress[\s\S]*?\n}/],
  ];
  for (const [file, name, re] of sites) {
    const src = fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');   // 只数代码, 不数注释(注释里会写 "new RpcClient(")
    const seg = name === 'balance x2' || name === 'tx lookup' ? src : (src.match(re)?.[0] || '');
    const news = (seg.match(/new (?:RpcClient|k\.RpcClient|kaspa\.RpcClient)\(/g) || []).length;
    const testOnly = (seg.match(/new RpcClientCtor\(/g) || []).length;
    const shared = (seg.match(/getSharedRpc\(/g) || []).length;
    ok(seg.length > 0 && news === 0 && shared >= 1, `${file} ${name}: new RpcClient=${news} (测试注入 new RpcClientCtor=${testOnly}) getSharedRpc=${shared}`);
  }
  const relaySrc = fs.readFileSync('src/api/relay.js', 'utf8');
  ok((relaySrc.match(/getSharedRpc\(/g) || []).length === 2 && (relaySrc.match(/new RpcClient\(/g) || []).length === 0, `relay.js: 两处余额都走 getSharedRpc, 无 new RpcClient`);
}

console.log(fails === 0 ? '\n✅✅ ALL PASS — kaspa-rpc-shared: 单实例/并发首调/零 disconnect/断连同实例重连/业务错与毒化不碰连接/参数校验 + 批 1 十站点 conformance'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
