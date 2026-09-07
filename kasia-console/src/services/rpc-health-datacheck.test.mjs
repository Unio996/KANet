// rpc-health-datacheck.test.mjs — G-2 G2-1/G2-2/G2-3/G2-4/G2-7 rpc-health regression（J2 2026-09-07,
// 设计 docs/2026-09-07-j2-g1-g2-node-trust-gate-and-console-rpc-selfheal-design-v0.1.md v0.2 §4, NWT MUST-4 顺序, Bettor GO）。
// 真 migration 临时库(rpc-health 经 db/client.js + getConfig) + 本机随机端口 TCP listener(让 tcpPing 通) + 假 RpcClient Ctor 注入; 离线。
// 守什么:
//   H1 顺序: 可达(tcpPing) → 数据核 getServerInfo(); networkId='mainnet' ⇒ REJECT 行 + 不缓存 + getWorkingRpc()={url:null}(LOCAL_ONLY=1 ⇒ 不发现)
//   H2 networkId='testnet-12' ∧ isSynced=false ⇒ REJECT + 不缓存(第二次调用再核一次)
//   H3 synced ⇒ using local node, 缓存(第二次调用不再核)
//   H4 kaspad 重启仿真: 实例 #1 getServerInfo 一直超时 ×3 ⇒ [rpc-shared] REBUILD ⇒ 实例 #2 synced ⇒ getWorkingRpc 回本机 + `[rpc-health] BACK-TO-LOCAL after Ns`
//   H5 全失败 warn/events 限频(10 min 内只一行、events 只一行)
//   H6 KASPA_RPC_LOCAL_ONLY=1 ⇒ `discovery disabled` 行一次
// Run: cd kasia-console && node src/services/rpc-health-datacheck.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';

if (!process.env._RPCHEALTH_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_rpchealth_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  // 端口在子进程里定(先起 listener 再 import), 这里只传 DB 与网络名
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _RPCHEALTH_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: 'testnet-12', KASPA_RPC_LOCAL_ONLY: '1', KASPA_RPC_LOCAL_NEG_CACHE_MS: '0', NODE_TRUST_REBUILD_MIN_INTERVAL_MS: '0', NODE_TRUST_REBUILD_AFTER: '3', NODE_TRUST_REBUILD_MAX: '1440' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

// 1) 本机 TCP listener(随机端口) ⇒ tcpPing 通; 2) env 定 KASPA_RPC_URL; 3) 再 import rpc-health(模块顶层读 env)
const server = net.createServer((s) => s.destroy());
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
process.env.KASPA_RPC_URL = `ws://127.0.0.1:${PORT}`;
const { getWorkingRpc, invalidateCache, dataCheck, _testInjectSharedRpcCtor } = await import('./rpc-health.js');
const { sharedRpcStats, sharedRpcRebuildStats } = await import('../lib/kaspa-rpc-shared.mjs');
const { sqlite } = await import('../db/client.js');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const logs = [];
const origLog = console.log, origWarn = console.warn;
const cap = (...a) => { logs.push(a.join(' ')); };
console.log = (...a) => { cap(...a); origLog(...a); };
console.warn = (...a) => { cap(...a); origLog('[warn]', ...a); };

// 假 Ctor: 每个实例的 getServerInfo 行为由 plan[instanceIndex] 决定
const st = { ctor: 0, calls: 0 };
let plan = [];
class Fake {
  constructor() { st.ctor++; this.id = st.ctor; this.isConnected = false; }
  async connect() { this.isConnected = true; }
  async disconnect() { this.isConnected = false; }
  async getServerInfo() { st.calls++; const p = plan[this.id - 1] || plan[plan.length - 1]; if (typeof p === 'function') return p(); return p; }
}
_testInjectSharedRpcCtor(Fake);
const url = process.env.KASPA_RPC_URL;
const since = (n) => logs.slice(n);

origLog('[H6] KASPA_RPC_LOCAL_ONLY=1 ⇒ discovery disabled 一行; [H1] networkId=mainnet ⇒ REJECT + null + 不缓存:');
{
  plan = [{ networkId: 'mainnet', isSynced: true }];
  const n = logs.length;
  const r = await getWorkingRpc();
  ok(r.url === null && r.isLocal === false, `getWorkingRpc ⇒ null (${JSON.stringify(r)})`);
  ok(since(n).some(l => new RegExp(`\\[rpc-health\\] REJECT ${url.replace(/[.:/]/g, '\\$&')} networkId=mainnet expected=testnet-12 isSynced=true`).test(l)), 'REJECT 行逐字(networkId=mainnet expected=testnet-12)');
  ok(since(n).some(l => /discovery disabled \(KASPA_RPC_LOCAL_ONLY=1\)/.test(l)), 'discovery disabled 行');
  ok(st.ctor === 1 && st.calls === 1, `实例 1, getServerInfo 1 次 (ctor=${st.ctor}, calls=${st.calls})`);
  const c0 = st.calls;
  const r2 = await getWorkingRpc();
  ok(r2.url === null && st.calls === c0 + 1, '不缓存: 第二次再核一次');
  ok(since(n).filter(l => /^\[rpc-health\] REJECT /.test(l)).length === 1, 'REJECT 行限频(60 s 内同 url 只一行)');
}

origLog('[H2] networkId=testnet-12 ∧ isSynced=false ⇒ REJECT(not synced) + null + 不缓存 + healthFail 不涨(节点活着):');
{
  plan = [{ networkId: 'testnet-12', isSynced: false }];
  invalidateCache();
  const c0 = st.calls;
  const r = await getWorkingRpc();
  ok(r.url === null, 'null');
  ok(st.calls === c0 + 1, '核了一次');
  const s = sharedRpcStats().find(x => x.key === `${url}|testnet-12`);
  ok(s && s.healthFail === 0, `not-synced 不计 healthFail (${JSON.stringify(s)})`);
  ok(logs.some(l => /^\[rpc-health\] local node not synced \(networkId=testnet-12 isSynced=false\)$/.test(l)) && !logs.slice(-6).some(l => /^\[rpc-health\] REJECT .*isSynced=false/.test(l)), 'SHOULD-2: 本机未同步打 `local node not synced (…)` 不打 REJECT');
}

origLog('[H3] synced ⇒ using local node + 缓存:');
{
  plan = [{ networkId: 'testnet-12', isSynced: true }];
  invalidateCache();
  const n = logs.length; const c0 = st.calls;
  const r = await getWorkingRpc();
  ok(r.url === url && r.isLocal === true, `local (${JSON.stringify(r)})`);
  ok(since(n).some(l => /\[rpc-health\] using local node:/.test(l)), 'using local node 行');
  const r2 = await getWorkingRpc();
  ok(r2.url === url && st.calls === c0 + 1, '缓存命中: 第二次不核');
}

origLog('[H4] kaspad 重启仿真: 实例 #1 getServerInfo 超时 ×3 ⇒ REBUILD ⇒ 实例 #2 synced ⇒ 回本机 + BACK-TO-LOCAL 行:');
{
  const slow = () => new Promise((_, rej) => setTimeout(() => rej(new Error('data check timeout')), 20));
  plan = [slow, { networkId: 'testnet-12', isSynced: true }];   // 实例 #1 永远超时; 实例 #2 正常
  invalidateCache();
  const n = logs.length;
  const a = await getWorkingRpc(); const b = await getWorkingRpc(); const c = await getWorkingRpc();
  ok(a.url === null && b.url === null && c.url === null, '三次都 null(实例 #1 超时)');
  ok(since(n).some(l => /\[rpc-shared\] REBUILD ws:\/\/127\.0\.0\.1:\d+\|testnet-12 after 3 failures \(source=rpc-health/.test(l)), 'REBUILD 行(source=rpc-health)');
  ok(since(n).some(l => /data check failed: data check timeout \(shared client REBUILT\)/.test(l)), 'rpc-health 行标 REBUILT');
  const d = await getWorkingRpc();
  ok(d.url === url && d.isLocal === true && st.ctor === 2, `第 4 次: 实例 #2 回本机 (ctor=${st.ctor}, ${JSON.stringify(d)})`);
  ok(since(n).some(l => /^\[rpc-health\] BACK-TO-LOCAL after \d+s \(was: rpc-fail\)$/.test(l)), `BACK-TO-LOCAL 行含 (was: rpc-fail) (SHOULD-3) [${since(n).filter(l => /BACK-TO-LOCAL/.test(l)).join(' | ')}]`);
  ok(sharedRpcRebuildStats().totalRebuilds === 1, `totalRebuilds=1 (${sharedRpcRebuildStats().totalRebuilds})`);
}

origLog('[H5] 全失败 warn/events 限频: 本进程内多次全失败只一行 warn、events 只一行:');
{
  plan = [slowNever(), slowNever()];
  function slowNever() { return () => Promise.reject(new Error('data check timeout')); }
  invalidateCache();
  const n = logs.length;
  const before = sqlite.prepare("SELECT COUNT(*) c FROM events WHERE event_type='rpc_health_check_failed'").get().c;
  for (let i = 0; i < 5; i++) await getWorkingRpc();
  const after = sqlite.prepare("SELECT COUNT(*) c FROM events WHERE event_type='rpc_health_check_failed'").get().c;
  ok(since(n).filter(l => /no RPC node available/.test(l)).length <= 1, `no RPC node available 行 ≤ 1 (got ${since(n).filter(l => /no RPC node available/.test(l)).length})`);
  ok(after - before <= 1, `events 行增量 ≤ 1 (got ${after - before}; 本进程首次全失败已在 H1 记过 ⇒ 可能为 0)`);
}

origLog('[H0] dataCheck 直接调用形: 返回 {ok,reason,networkId,isSynced}:');
{
  plan = [{ networkId: 'testnet-12', isSynced: true }];
  const d = await dataCheck(url, true);
  ok(d.ok === true && d.reason === 'ok' && d.networkId === 'testnet-12' && d.isSynced === true, JSON.stringify(d));
}

console.log = origLog; console.warn = origWarn;
server.close();
console.log(fails === 0 ? '\n✅✅ ALL PASS — rpc-health G-2: 顺序(可达→数据核→缓存) · networkId/isSynced REJECT 不缓存 · LOCAL_ONLY 不发现 · 重启仿真 REBUILD→BACK-TO-LOCAL · 全失败限频' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
