// preprune-capture-worker-disable-env.test.mjs — 紧急开关 PREPRUNE_CAPTURE_WORKER=0 regression(J2 2026-09-06, Bettor ledger 943)。
// 离线: 不连 kaspad、不碰 live DB。Run: cd kasia-console && node src/services/preprune-capture-worker-disable-env.test.mjs
// 守什么:
//   =0        ⇒ _tick 入口即 return {skipped:'disabled-by-env'}; 门(readNodeSynced)与 body 都【零】调用; heartbeat 仍写 (0,0); 10 min 内只打一行 disabled 日志, 过 10 min 再打。
//   未设/'1'/'' ⇒ 原路径: 门被调; 门放行 ⇒ body 跑; 门 skip ⇒ body 不跑(与 ibd-gate 用例同判)。
//   _workerDisabledByEnv 只认字符串 '0'(去空白); '00'/'false'/'off' 不算关(明确: 只有 0 关)。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'ppg-dis-')), 'empty.db');
const { _tick, _workerDisabledByEnv } = await import('./preprune-capture-worker.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const logs = []; const origLog = console.log; console.log = (...a) => { logs.push(a.join(' ')); origLog(...a); };
const disabledLogs = () => logs.filter((l) => l.includes('[preprune-capture-worker] disabled by env')).length;

async function run({ disabled, gate = { synced: true, isSynced: true }, now = 0 }) {
  let gateCalls = 0, bodyCalls = 0; const hb = [];
  const r = await _tick({ disabledByEnv: () => disabled, now: () => now, readNodeSynced: async () => { gateCalls++; return gate; }, runBody: async () => { bodyCalls++; return { scanned: 0, recaptured: 0 }; }, writeHeartbeat: (s, c) => hb.push([s, c]) });
  return { r, gateCalls, bodyCalls, hb };
}

// V1 =0 ⇒ 入口 return, 门/body 零调用, heartbeat (0,0)
{ const t = await run({ disabled: true, now: 1_000_000 });
  ok(t.r.skipped === 'disabled-by-env', 'V1 =0 ⇒ skipped=disabled-by-env');
  ok(t.gateCalls === 0 && t.bodyCalls === 0, 'V1 =0 ⇒ 门 0 调用、body 0 调用(不读链、不扫 events)');
  ok(t.hb.length === 1 && t.hb[0][0] === 0 && t.hb[0][1] === 0, 'V1 =0 ⇒ heartbeat 仍写 (0,0)(monitor 不误报挂死)');
  ok(disabledLogs() === 1, 'V1 首次打一行 disabled 日志'); }
// V2 10 min 内再 tick 不再打; 过 10 min 再打
{ await run({ disabled: true, now: 1_000_000 + 5 * 60 * 1000 }); ok(disabledLogs() === 1, 'V2 5 min 后再 tick: 不再打(仍 1 行)');
  await run({ disabled: true, now: 1_000_000 + 10 * 60 * 1000 }); ok(disabledLogs() === 2, 'V2 满 10 min 再 tick: 再打一行(共 2 行)'); }
// V3 未设 ⇒ 原路径: 门被调, 放行 ⇒ body 跑
{ const t = await run({ disabled: false });
  ok(t.gateCalls === 1 && t.bodyCalls === 1 && t.r.scanned === 0, 'V3 未设 ⇒ 门被调 1 次, 放行 ⇒ body 跑 1 次(原行为)'); }
// V4 未设 + 门 skip ⇒ body 不跑(与 ibd-gate 用例同判), heartbeat (0,0)
{ const t = await run({ disabled: false, gate: { synced: false, isSynced: false, reason: 'not-synced' } });
  ok(t.gateCalls === 1 && t.bodyCalls === 0 && t.r.skipped === 'node-not-synced' && t.hb.length === 1, 'V4 未设 + 门 skip ⇒ body 0 次, skipped=node-not-synced, heartbeat (0,0)'); }
// V5 env 解析: 只认 '0'
{ ok(_workerDisabledByEnv({ PREPRUNE_CAPTURE_WORKER: '0' }) === true && _workerDisabledByEnv({ PREPRUNE_CAPTURE_WORKER: ' 0 ' }) === true, "V5 '0' / ' 0 ' ⇒ 关");
  ok(_workerDisabledByEnv({}) === false && _workerDisabledByEnv({ PREPRUNE_CAPTURE_WORKER: '' }) === false && _workerDisabledByEnv({ PREPRUNE_CAPTURE_WORKER: '1' }) === false, "V5 未设 / '' / '1' ⇒ 不关");
  ok(_workerDisabledByEnv({ PREPRUNE_CAPTURE_WORKER: 'false' }) === false && _workerDisabledByEnv({ PREPRUNE_CAPTURE_WORKER: '00' }) === false, "V5 'false' / '00' ⇒ 不关(只有 0 关, 不猜)"); }
// V6 真实 env 路径(不注 disabledByEnv): 设 process.env 后 _tick 默认读它
{ process.env.PREPRUNE_CAPTURE_WORKER = '0';
  let gateCalls = 0; const r = await _tick({ readNodeSynced: async () => { gateCalls++; return { synced: true, isSynced: true }; }, runBody: async () => ({ scanned: 1, recaptured: 0 }), writeHeartbeat: () => {} });
  ok(r.skipped === 'disabled-by-env' && gateCalls === 0, 'V6 process.env.PREPRUNE_CAPTURE_WORKER=0 ⇒ 默认读 env 即关');
  delete process.env.PREPRUNE_CAPTURE_WORKER;
  const r2 = await _tick({ readNodeSynced: async () => ({ synced: false, isSynced: false }), runBody: async () => ({ scanned: 1, recaptured: 0 }), writeHeartbeat: () => {} });
  ok(r2.skipped === 'node-not-synced', 'V6 删掉 env ⇒ 回原路径(门被调)'); }

console.log = origLog;
console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAIL'}`);
process.exit(fails ? 1 : 0);
