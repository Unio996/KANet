// ibd-tick-gate.test.mjs — M2 门离线测试 + 结构性断言(门在 15 个 tick 入口: 重入锁与任何 DB 扫描之前)。跑: cd kasia-console && node src/lib/ibd-tick-gate.test.mjs
// 不碰 DB: 门的 read 注入; 结构性断言只读源码文本。
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// 门 helper import 链经 preprune-capture-worker.mjs → db/client.js(无 DB_PATH 即 throw) ⇒ 先指 mkdtemp 临时库(sanctioned 形, 从不开活库)
const tmp = mkdtempSync(join(tmpdir(), 'ibd-gate-'));
process.env.DB_PATH = join(tmp, 'gate.db');
const { ibdGateSkip, ibdGateEnabled, _resetIbdGateState } = await import(pathToFileURL(join(HERE, 'ibd-tick-gate.mjs')).href);
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ } });
let n = 0, fail = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
const mk = (gate) => async () => gate;

await t('G1 (C1) isSynced===false ⇒ 跳(true); 首次打一行 [site] skip: node not synced (isSynced=false, reason=…)', async () => {
  _resetIbdGateState(); const lines = [];
  const r = await ibdGateSkip('settle.tick', { read: mk({ synced: false, isSynced: false, reason: 'not-synced', cached: true }), log: (s) => lines.push(s), now: () => 1_000_000, env: {} });
  assert.equal(r, true); assert.deepEqual(lines, ['[settle.tick] skip: node not synced (isSynced=false, reason=not-synced)']);
});
await t('G2 (C1) 极性: isSynced===true / null / undefined / read 抛错 / gate 为 null|{} ⇒ 都不跳(fail-open), 零行', async () => {
  _resetIbdGateState(); const lines = []; const log = (s) => lines.push(s);
  for (const g of [{ isSynced: true }, { isSynced: null, reason: 'rpc-fail: x' }, { isSynced: undefined }, { synced: false, reason: 'no-rpc-url' }, null, {}]) assert.equal(await ibdGateSkip('x', { read: mk(g), log, env: {} }), false, JSON.stringify(g));
  assert.equal(await ibdGateSkip('x', { read: async () => { throw new Error('boom'); }, log, env: {} }), false);
  assert.equal(lines.length, 0);
});
await t('G3 (C3) 日志只在状态翻转 + 跳过态每 10 min 心跳; 判定不受日志影响; 不同站各自计', async () => {
  _resetIbdGateState(); const lines = []; let clock = 0; let g = { isSynced: false, reason: 'not-synced' };
  const deps = { read: async () => g, log: (s) => lines.push(s), now: () => clock, env: {} };
  for (const c of [0, 30_000, 60_000, 599_999]) { clock = c; assert.equal(await ibdGateSkip('a', deps), true); }
  assert.equal(lines.length, 1);                                  // 进入跳过态只一行, 60 s 内不再打
  clock = 600_000; assert.equal(await ibdGateSkip('a', deps), true); assert.equal(lines.length, 2); assert.match(lines[1], /heartbeat\)$/);
  clock = 900_000; assert.equal(await ibdGateSkip('a', deps), true); assert.equal(lines.length, 2);   // 未到下个 10 min
  g = { isSynced: true, reason: 'ok' }; clock = 901_000; assert.equal(await ibdGateSkip('a', deps), false); assert.equal(lines.length, 3); assert.equal(lines[2], '[a] resume: node synced (reason=ok)');
  assert.equal(await ibdGateSkip('a', deps), false); assert.equal(lines.length, 3);   // 已同步态不打
  g = { isSynced: false, reason: 'not-synced' }; assert.equal(await ibdGateSkip('a', deps), true); assert.equal(lines.length, 4);   // 再翻转再打
  assert.equal(await ibdGateSkip('b', deps), true); assert.equal(lines.length, 5); assert.match(lines[4], /^\[b\] skip/);
});
await t('G4 回滚开关: IBD_TICK_GATE=0 ⇒ 永不跳且不读门; 其它值/未设 ⇒ 启用', async () => {
  let reads = 0; const read = async () => { reads++; return { isSynced: false }; };
  assert.equal(await ibdGateSkip('x', { read, env: { IBD_TICK_GATE: '0' } }), false); assert.equal(reads, 0);
  assert.equal(ibdGateEnabled({}), true); assert.equal(ibdGateEnabled({ IBD_TICK_GATE: '1' }), true); assert.equal(ibdGateEnabled({ IBD_TICK_GATE: '0' }), false);
  assert.equal(await ibdGateSkip('x', { read, log: () => {}, env: {} }), true); assert.equal(reads, 1);
});
await t('G5 日志函数抛错 ⇒ 仍返回 true(判定不受日志影响)', async () => {
  _resetIbdGateState();
  assert.equal(await ibdGateSkip('y', { read: mk({ isSynced: false }), log: () => { throw new Error('log boom'); }, env: {} }), true);
});

// ── 结构性断言(Bettor 硬要求 1 / NWT C2): 15 个 tick 函数体里 `await ibdGateSkip('<site>')` 在【重入锁赋值】与首个 sqlite.prepare( / _scan*( / 其它 await 之前 ──
const SITES = [
  ['services/bshard-settle-daemon.mjs', 'settleDaemonTick', 'settle.tick', '_running = true'],
  ['services/pool-market-settler.js', 'poolSettlerTick', 'pool.tick', 'running = true'],
  ['services/bshard-close-voter.js', 'bshardCloseVoterTick', 'bshard-close-voter.tick', 'running = true'],
  ['services/bshard-close-voter.js', 'bshardCloseVoterV2Tick', 'bshard-close-voter.v2Tick', null],
  ['services/bshard-close-voter.js', 'bshardCloseSubmitV2Tick', 'bshard-close-voter.submitV2Tick', 'submitRunning = true'],
  ['services/bettor-refund-claim-auto.mjs', 'claimAutoDispatcherTick', 'refund-claim-auto.tick', 'running = true'],
  ['services/bettor-prediction-voter.js', 'voterTick', 'prediction-voter.tick', 'running = true'],
  ['services/bettor-prediction-settler.js', 'settlePredictionOutcomes', 'prediction-settler.tick', 'running = true'],
  ['services/oracle-pool-chain-scanner-cron.mjs', 'oraclePoolScannerTick', 'oracle-pool-scanner.tick', 'running = true'],
  ['services/oracle-pool-renewal-cron.mjs', 'oraclePoolRenewalTick', 'oracle-renewal.tick', 'running = true'],
  ['services/zk-prove-worker.mjs', 'zkProveWorkerTick', 'zk-prove-worker.tick', 'running = true'],
  ['lib/zk-autonomy-ticks.mjs', 'zkCloseTickV2', 'zk.closeTickV2', '_zkCloseV2Running = true'],
  ['lib/zk-autonomy-ticks.mjs', 'claimAutonomousTick', 'zk.claimAutonomousTick', '_claimTickRunning = true'],
  ['lib/zk-autonomy-ticks.mjs', 'zkHandoffAutonomousTick', 'zk.handoffAutonomousTick', '_zkHandoffTickRunning = true'],
  ['lib/zk-autonomy-ticks.mjs', 'zkJudgeProposeAutonomousTick', 'zk.judgeProposeAutonomousTick', '_zkJudgeProposeTickRunning = true'],
];
function fnBody(src, name) {
  const i = src.indexOf(`export async function ${name}(`); if (i < 0) return null;
  const j = src.indexOf('\nexport ', i + 1); return src.slice(i, j < 0 ? src.length : j);
}
await t(`S1 结构: ${SITES.length} 站每站 ibdGateSkip('<site>') 在重入锁赋值与首个 sqlite.prepare/_scan*/其它 await 之前, 且文件有 import`, () => {
  const bad = [];
  for (const [f, fn, site, lock] of SITES) {
    const src = readFileSync(join(HERE, '..', f), 'utf8'); const body = fnBody(src, fn);
    if (!body) { bad.push(`${f}:${fn} 找不到函数`); continue; }
    const g = body.indexOf(`await ibdGateSkip('${site}')`);
    if (g < 0) { bad.push(`${f}:${fn} 无门`); continue; }
    const after = body.slice(g + 10);
    const cands = [body.indexOf('sqlite.prepare('), body.indexOf('_scan'), after.indexOf('await ') >= 0 ? g + 10 + after.indexOf('await ') : -1, lock ? body.indexOf(lock) : -1].filter((x) => x >= 0);
    const firstWork = Math.min(...cands);
    if (!(g < firstWork)) bad.push(`${f}:${fn} 门(${g})不在首个工作/锁(${firstWork})之前`);
    if (lock && !(g < body.indexOf(lock))) bad.push(`${f}:${fn} 门在重入锁之后(C2)`);
    if (!/import \{[^}]*\bibdGateSkip\b[^}]*\} from '(\.\.\/lib|\.)\/ibd-tick-gate\.mjs'/.test(src)) bad.push(`${f} 无 import`);
  }
  assert.deepEqual(bad, []);
  const total = SITES.reduce((s, [f, , site]) => s + (readFileSync(join(HERE, '..', f), 'utf8').split(`ibdGateSkip('${site}')`).length - 1), 0);
  assert.equal(total, SITES.length, '每站恰一处门(无漏无多)');
});

console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
