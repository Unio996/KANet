// preprune-capture-worker-ibd-gate.test.mjs — IBD 门 regression(J2 2026-08-30, Bettor 批,
// docs/2026-08-30-j2-console-ibd-memory-growth-diagnosis.md §8①)。离线: 不连 kaspad、不连 relay、不碰 live DB。
// Run: cd kasia-console && node src/services/preprune-capture-worker-ibd-gate.test.mjs
//
// 守什么:
//   正向  isSynced===true            ⇒ 门放行, tick 主体跑一次。
//   负向  isSynced===false / null / undefined / getServerInfo 抛 / connect 超时 / 无 RPC URL
//         ⇒ 门 skip(fail-closed), tick 主体【零】调用 ⇒ 不会有任何 getBlock walk; 且 RpcClient 必 disconnect(不留连接);
//         skip 时 heartbeat 仍写(scanned=0), 免 preprune-capture-monitor 误报挂死。
//   权威源 = getServerInfo(); getBlockDagInfo 不参与判定(实测其 isSynced 为 undefined)。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// db/client.js 非 console 入口无 DB_PATH 即 throw(规则 74 根治); 给它一个临时空库, 本用例不读不写任何表。
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'ppg-gate-')), 'empty.db');
const { _tick, _readNodeSynced } = await import('./preprune-capture-worker.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

// 假 RpcClient: 记录 connect/disconnect/getServerInfo/getBlock 调用次数, 可注入返回值或异常。
function fakeRpc({ serverInfo, connectDelayMs = 0, throwOnServerInfo = null } = {}) {
  const calls = { connect: 0, disconnect: 0, getServerInfo: 0, getBlockDagInfo: 0, getBlock: 0 };
  return {
    calls,
    async connect() { calls.connect++; if (connectDelayMs) await new Promise(r => setTimeout(r, connectDelayMs)); },
    async disconnect() { calls.disconnect++; },
    async getServerInfo() { calls.getServerInfo++; if (throwOnServerInfo) throw throwOnServerInfo; return serverInfo; },
    async getBlockDagInfo() { calls.getBlockDagInfo++; return { isSynced: undefined }; }, // 权威源不是它
    async getBlock() { calls.getBlock++; return {}; },
  };
}

async function runTick(gateResult) {
  let bodyCalls = 0, hb = [];
  const r = await _tick({ readNodeSynced: async () => gateResult, runBody: async () => { bodyCalls++; return { scanned: 0, recaptured: 0 }; }, writeHeartbeat: (s, c) => hb.push([s, c]) });
  return { r, bodyCalls, hb };
}

console.log('[test] ① _readNodeSynced: getServerInfo().isSynced === true ⇒ synced, 且 disconnect 必调:');
{
  const rpc = fakeRpc({ serverInfo: { isSynced: true, serverVersion: 'x' } });
  const g = await _readNodeSynced({ rpcFactory: async () => rpc });
  ok(g.synced === true && g.isSynced === true && g.reason === 'ok', `synced=true (${JSON.stringify(g)})`);
  ok(rpc.calls.connect === 1 && rpc.calls.getServerInfo === 1 && rpc.calls.disconnect === 1, 'connect/getServerInfo/disconnect 各 1 次');
  ok(rpc.calls.getBlockDagInfo === 0, '不读 getBlockDagInfo(权威源 = getServerInfo)');
}

console.log('[test] ② _readNodeSynced 负向四形 ⇒ 全部 synced=false(fail-closed), 且 disconnect 必调:');
{
  const cases = [
    ['isSynced=false', fakeRpc({ serverInfo: { isSynced: false } }), (g) => g.isSynced === false && g.reason === 'not-synced'],
    ['isSynced=null', fakeRpc({ serverInfo: { isSynced: null } }), (g) => g.isSynced === null && /unreadable/.test(g.reason)],
    ['isSynced 缺字段(undefined)', fakeRpc({ serverInfo: { serverVersion: 'x' } }), (g) => g.isSynced === null && /unreadable\(undefined\)/.test(g.reason)],
    ['getServerInfo 抛', fakeRpc({ serverInfo: null, throwOnServerInfo: new Error('boom') }), (g) => g.isSynced === null && /rpc-fail: boom/.test(g.reason)],
  ];
  for (const [label, rpc, check] of cases) {
    const g = await _readNodeSynced({ rpcFactory: async () => rpc });
    ok(g.synced === false && check(g), `${label} ⇒ synced=false (${g.reason})`);
    ok(rpc.calls.disconnect === 1, `${label}: disconnect 调了 1 次(不留连接)`);
  }
}

console.log('[test] ③ _readNodeSynced: connect 超时(> 4 s) ⇒ synced=false, disconnect 仍调:');
{
  const rpc = fakeRpc({ serverInfo: { isSynced: true }, connectDelayMs: 4600 });
  const t0 = Date.now();
  const g = await _readNodeSynced({ rpcFactory: async () => rpc });
  ok(g.synced === false && /rpc-fail: connect timeout/.test(g.reason), `超时 ⇒ fail-closed (${g.reason}, ${Date.now() - t0} ms)`);
  ok(rpc.calls.getServerInfo === 0 && rpc.calls.disconnect === 1, '未读 getServerInfo, disconnect 1 次');
}

console.log('[test] ④ _readNodeSynced: rpcFactory 抛(= 无 RPC URL / 建客户端失败) ⇒ synced=false:');
{
  const g = await _readNodeSynced({ rpcFactory: async () => { throw new Error('no working RPC endpoint'); } });
  ok(g.synced === false && g.isSynced === null && /rpc-fail/.test(g.reason), `fail-closed (${g.reason})`);
}

console.log('[test] ⑤ _tick 正向: 门 synced=true ⇒ 主体跑 1 次:');
{
  const { r, bodyCalls, hb } = await runTick({ synced: true, isSynced: true, reason: 'ok' });
  ok(bodyCalls === 1, 'runBody 调用 1 次');
  ok(r && r.scanned === 0 && r.skipped === undefined, `返回主体结果 (${JSON.stringify(r)})`);
  ok(hb.length === 0, '正向不由门写 heartbeat(主体自己写)');
}

console.log('[test] ⑥ _tick 负向: 门 false / null / rpc-fail ⇒ 主体【零】调用 = 零 getBlock walk; skip 时写 heartbeat(0,0):');
{
  for (const gate of [
    { synced: false, isSynced: false, reason: 'not-synced' },
    { synced: false, isSynced: null, reason: 'isSynced-unreadable(undefined)' },
    { synced: false, isSynced: null, reason: 'rpc-fail: connect timeout 4000ms' },
  ]) {
    const { r, bodyCalls, hb } = await runTick(gate);
    ok(bodyCalls === 0, `isSynced=${gate.isSynced} (${gate.reason}): runBody 0 次`);
    ok(r?.skipped === 'node-not-synced' && r.isSynced === gate.isSynced, `返回 skipped=node-not-synced (${JSON.stringify(r)})`);
    ok(hb.length === 1 && hb[0][0] === 0 && hb[0][1] === 0, 'heartbeat 写 (0,0) 一次');
  }
}

console.log('[test] ⑦ _tick 防重入不受门影响: 门 pending 时第二次调用 ⇒ skipped=reentrant:');
{
  let release; const pending = new Promise(r => { release = r; });
  const p1 = _tick({ readNodeSynced: async () => { await pending; return { synced: false, isSynced: false, reason: 'not-synced' }; }, writeHeartbeat: () => {} });
  const r2 = await _tick({ readNodeSynced: async () => ({ synced: true, isSynced: true, reason: 'ok' }), runBody: async () => ({ scanned: 0, recaptured: 0 }) });
  ok(r2?.skipped === 'reentrant', 'reentrant');
  release(); const r1 = await p1;
  ok(r1?.skipped === 'node-not-synced', '首个 tick 正常走完门');
}

console.log('[test] ⑧ 真 fake 客户端接进 _tick(端到端形): isSynced=false 的客户端 ⇒ getBlock 0 次:');
{
  const rpc = fakeRpc({ serverInfo: { isSynced: false } });
  let bodyCalls = 0;
  const r = await _tick({ readNodeSynced: () => _readNodeSynced({ rpcFactory: async () => rpc }), runBody: async () => { bodyCalls++; await rpc.getBlock({}); return {}; }, writeHeartbeat: () => {} });
  ok(r?.skipped === 'node-not-synced' && bodyCalls === 0 && rpc.calls.getBlock === 0 && rpc.calls.disconnect === 1, `skip, getBlock=0, disconnect=1 (${JSON.stringify(rpc.calls)})`);
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — preprune-capture-worker IBD 门: 正向放行 / 负向(false·null·undefined·抛·超时·无URL) fail-closed 零 walk / disconnect 必调 / skip 写 heartbeat / 防重入'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
