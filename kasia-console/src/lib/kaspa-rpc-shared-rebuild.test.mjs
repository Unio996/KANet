// kaspa-rpc-shared-rebuild.test.mjs — G-2 G2-3 共享客户端【本机实例重建】regression（J2 2026-09-07,
// 设计 docs/2026-09-07-j2-g1-g2-node-trust-gate-and-console-rpc-selfheal-design-v0.1.md v0.2 §4 G2-3, NWT MUST-4, Bettor GO）。
// 离线: 假 Ctor 计构造次数; 不连 kaspad、不碰 DB(本模块不 import db)。
// 守什么:
//   R1 本机 key: rpc-health 数据核连续 3 次失败 ⇒ REBUILD(实例 #2), 计数/stats 对; 成功归零
//   R2 业务侧 noteSharedRpcError 的 not-connected 同台阶(errCount+healthFail ≥ 3)也重建; 两路同一函数
//   R3 限频: 距上次重建 < NODE_TRUST_REBUILD_MIN_INTERVAL_MS 不重建(rate-limited)
//   R4 硬上限 NODE_TRUST_REBUILD_MAX: 达到后不再重建 + LOUD 一次
//   R5 非本机 key 永不重建(errCount 涨、同实例 disconnect/reconnect 照旧)
//   R6 注入的 Ctor 在 REBUILD 后同 key 继续用(用例能数到实例 #2); sharedRpcStats() 仍是数组(既有消费者)
// Run: cd kasia-console && NODE_TRUST_REBUILD_MIN_INTERVAL_MS=0 NODE_TRUST_REBUILD_MAX=3 node src/lib/kaspa-rpc-shared-rebuild.test.mjs
import { spawnSync } from 'node:child_process';
if (!process.env._RPC_REBUILD_TEST_CHILD) {
  const r = spawnSync(process.execPath, [process.argv[1]], { stdio: 'inherit', env: { ...process.env, _RPC_REBUILD_TEST_CHILD: '1', NODE_TRUST_REBUILD_MIN_INTERVAL_MS: '0', NODE_TRUST_REBUILD_MAX: '3', NODE_TRUST_REBUILD_AFTER: '3' } });
  process.exit(r.status ?? 1);
}
const { getSharedRpc, noteSharedRpcError, noteSharedRpcHealthFailure, noteSharedRpcHealthOk, sharedRpcStats, sharedRpcRebuildStats, isLocalRpcUrl } = await import('./kaspa-rpc-shared.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const warns = [];
const origWarn = console.warn, origErr = console.error;
console.warn = (...a) => { warns.push(a.join(' ')); };
console.error = (...a) => { warns.push(a.join(' ')); };

function mkCtor() {
  const st = { ctor: 0, instances: [] };
  class Fake {
    constructor(opts) { st.ctor++; this.opts = opts; this.isConnected = false; this.id = st.ctor; st.instances.push(this); }
    async connect() { this.isConnected = true; }
    async disconnect() { this.isConnected = false; }
  }
  return { st, Fake };
}
const NET = 'testnet-12';

console.log('[R1] 本机 key: rpc-health 数据核连续 3 次失败 ⇒ REBUILD 实例 #2; 成功归零:');
{
  const { st, Fake } = mkCtor();
  const url = 'ws://127.0.0.1:17999';
  const r1 = await getSharedRpc({ url, networkId: NET }, { Ctor: Fake });
  ok(st.ctor === 1 && r1.id === 1, 'first build = instance #1');
  ok(noteSharedRpcHealthFailure({ url, networkId: NET }, new Error('data check timeout')) === 'noted', 'fail #1 noted');
  ok(noteSharedRpcHealthFailure({ url, networkId: NET }, new Error('data check timeout')) === 'noted', 'fail #2 noted');
  const r3 = noteSharedRpcHealthFailure({ url, networkId: NET }, new Error('data check timeout'));
  ok(r3 === 'rebuild', `fail #3 ⇒ rebuild (got ${r3})`);
  ok(warns.some(w => /\[rpc-shared\] REBUILD ws:\/\/127\.0\.0\.1:17999\|testnet-12 after 3 failures \(source=rpc-health/.test(w)), 'REBUILD 行逐字(source=rpc-health)');
  ok(r1.isConnected === false, '旧实例已 disconnect');
  const r2 = await getSharedRpc({ url, networkId: NET });
  ok(st.ctor === 2 && r2.id === 2 && r2 !== r1 && r2.isConnected === true, `next getSharedRpc = instance #2, connected (ctor=${st.ctor})`);
  const s = sharedRpcStats().find(x => x.key === `${url}|${NET}`);
  ok(Array.isArray(sharedRpcStats()) && s && s.rebuilds === 1 && s.healthFail === 0, `stats 数组形 + rebuilds=1 healthFail=0 (${JSON.stringify(s)})`);
  noteSharedRpcHealthFailure({ url, networkId: NET }, new Error('x'));
  noteSharedRpcHealthOk({ url, networkId: NET });
  ok(sharedRpcStats().find(x => x.key === `${url}|${NET}`).healthFail === 0, 'HealthOk 归零');
  ok(noteSharedRpcHealthFailure({ url: 'ws://127.0.0.1:1', networkId: NET }, new Error('x')) === 'unknown-key', '未建 key ⇒ unknown-key');
}

console.log('[R2] 业务侧 not-connected 与 health 失败同台阶(合计 ≥ 3)⇒ 重建:');
{
  const { st, Fake } = mkCtor();
  const url = 'ws://localhost:17998';
  const r1 = await getSharedRpc({ url, networkId: NET }, { Ctor: Fake });
  ok(await noteSharedRpcError(r1, new Error('WebSocket is not connected')) === 'reconnect', 'business #1 ⇒ reconnect');
  ok(noteSharedRpcHealthFailure({ url, networkId: NET }, new Error('rpc-shared connect timeout 5000ms')) === 'noted', 'health #2 ⇒ noted');
  const r = await noteSharedRpcError(r1, new Error('ECONNREFUSED'));
  ok(r === 'rebuild', `business #3 ⇒ rebuild (got ${r})`);
  ok(warns.some(w => /REBUILD ws:\/\/localhost:17998\|testnet-12 after 3 failures \(source=business/.test(w)), 'REBUILD 行 source=business');
  const r2 = await getSharedRpc({ url, networkId: NET });
  ok(st.ctor === 2 && r2.id === 2, 'instance #2');
}

console.log('[R3] 限频 + [R4] 硬上限(NODE_TRUST_REBUILD_MAX=3, 本子进程已重建 2 次):');
{
  const { st, Fake } = mkCtor();
  const url = 'ws://127.0.0.1:17997';
  await getSharedRpc({ url, networkId: NET }, { Ctor: Fake });
  for (let i = 0; i < 3; i++) noteSharedRpcHealthFailure({ url, networkId: NET }, new Error('t'));
  ok(sharedRpcRebuildStats().totalRebuilds === 3, `third rebuild done (total=${sharedRpcRebuildStats().totalRebuilds})`);
  await getSharedRpc({ url, networkId: NET });
  ok(st.ctor === 2, 'instance #2 built');
  // 现在总数 = MAX ⇒ 再失败 3 次不重建, LOUD 一次
  const before = warns.length;
  for (let i = 0; i < 3; i++) noteSharedRpcHealthFailure({ url, networkId: NET }, new Error('t'));
  await getSharedRpc({ url, networkId: NET });
  ok(st.ctor === 2 && sharedRpcRebuildStats().capped === true, `capped: no instance #3 (ctor=${st.ctor}), capped=${sharedRpcRebuildStats().capped}`);
  ok(warns.slice(before).filter(w => /REBUILD CAP reached \(3\)/.test(w)).length === 1, 'CAP LOUD 恰一次');
  for (let i = 0; i < 3; i++) noteSharedRpcHealthFailure({ url, networkId: NET }, new Error('t'));
  ok(warns.filter(w => /REBUILD CAP reached/.test(w)).length === 1, '再失败不再刷 CAP 行');
}

console.log('[R5] 非本机 key 永不重建:');
{
  const { st, Fake } = mkCtor();
  const url = 'wss://kate.kaspa.red/kaspa/mainnet/wrpc/borsh';
  ok(isLocalRpcUrl(url) === false && isLocalRpcUrl('ws://127.0.0.1:17210') === true && isLocalRpcUrl('ws://[::1]:1') === true, 'isLocalRpcUrl');
  const r1 = await getSharedRpc({ url, networkId: NET }, { Ctor: Fake });
  for (let i = 0; i < 5; i++) noteSharedRpcHealthFailure({ url, networkId: NET }, new Error('t'));
  for (let i = 0; i < 5; i++) await noteSharedRpcError(r1, new Error('not connected'));
  const r2 = await getSharedRpc({ url, networkId: NET });
  ok(st.ctor === 1 && r2 === r1, '同实例(不重建), 10 次失败后仍 ctor=1');
}

console.warn = origWarn; console.error = origErr;
console.log(fails === 0 ? '\n✅✅ ALL PASS — kaspa-rpc-shared G-2 REBUILD: health/business 同台阶 · 限频 · 硬上限 LOUD 一次 · 非本机不重建 · stats 数组形' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
