/**
 * NWT 2-1 v0.2 驻留期热钱包监控单测（docs/2026-09-14-nwt-mainnet-relay-hotwallet-cap-and-cold-hot-
 * separation-spec-v0.2.md，Bettor 1150 派工）。
 *
 * Run: DB_PATH=<temp> node --test kasia-console/test-framework/cases/system/relay-hotwallet-monitor.test.mjs
 *
 * 范围：只测 relayHotwalletMonitorTick() 判断逻辑本身——用第一参依赖注入（同 checkHotwalletAdmission
 * 那份既有 DI 约定）替换掉 getStatus()/relay_nodes 查询/getWorkingRpc()/真实余额查询/stopRelay+events
 * 写入，不连真实节点、不起真实 relay 子进程、不碰真实 DB。每个用例自带独立的 failureCounts/prevBalances
 * Map，互不污染（模块级单例只在生产路径用）。
 *
 * Live verify（真实并发+真实 kill+真实 events 落库）defer 到 operator hat 手动测。
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { relayHotwalletMonitorTick } from '../../../src/services/relay-hotwallet-monitor.js';

// 造一批"正在跑"的假 relay + 对应的余额查询函数。killed 数组记录被 kill 的调用顺序供断言。
function makeFixture({ relays, balances, cap = {} }) {
  const killed = [];
  const kill = async (relayNodeId, name, reason, detail) => {
    killed.push({ relayNodeId, name, reason, detail });
    return { ok: true };
  };
  const listRunning = () => relays.map((r) => ({ relayNodeId: r.id, name: r.name, pid: 1 }));
  const getRelayRows = (ids) => relays.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, address: r.address, network: 'mainnet' }));
  const queryBalanceKas = async (address) => {
    const entry = balances[address];
    if (entry instanceof Error) throw entry;
    return entry;
  };
  const deps = {
    listRunning, getRelayRows,
    resolveRpcUrl: async () => 'ws://127.0.0.1:17110',
    queryBalanceKas,
    kill,
    failureCounts: new Map(),
    prevBalances: new Map(),
    perRelayMaxCap: cap.perRelay,
    totalMaxCap: cap.total,
  };
  return { deps, killed };
}

test('未设两个 cap → skipped, 不查任何余额', async () => {
  let called = false;
  const { deps } = makeFixture({
    relays: [{ id: 'r1', name: 'R1', address: 'kaspa:r1' }],
    balances: { 'kaspa:r1': 100 },
    cap: {},
  });
  deps.queryBalanceKas = async () => { called = true; return 100; };
  const result = await relayHotwalletMonitorTick(deps);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_cap_configured');
  assert.equal(called, false);
});

test('没有正在跑的 relay → ok, checked=0, killed=0', async () => {
  const { deps } = makeFixture({ relays: [], balances: {}, cap: { perRelay: 800 } });
  const result = await relayHotwalletMonitorTick(deps);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 0);
  assert.equal(result.killed, 0);
});

test('per-relay 上限 · 正：单个余额超线 → 该 relay 被 kill', async () => {
  const { deps, killed } = makeFixture({
    relays: [{ id: 'r1', name: 'R1', address: 'kaspa:r1' }],
    balances: { 'kaspa:r1': 1005 },
    cap: { perRelay: 800 },
  });
  const result = await relayHotwalletMonitorTick(deps);
  assert.equal(result.killed, 1);
  assert.equal(killed.length, 1);
  assert.equal(killed[0].relayNodeId, 'r1');
  assert.equal(killed[0].reason, 'per_relay_cap_exceeded_while_running');
});

test('per-relay 上限 · 反：余额不超线 → 不 kill', async () => {
  const { deps, killed } = makeFixture({
    relays: [{ id: 'r1', name: 'R1', address: 'kaspa:r1' }],
    balances: { 'kaspa:r1': 540 },
    cap: { perRelay: 800 },
  });
  const result = await relayHotwalletMonitorTick(deps);
  assert.equal(result.killed, 0);
  assert.equal(killed.length, 0);
});

test('总额上限 · 正：total 超线，按 delta 归因，涨得最多的先被 kill', async () => {
  const { deps, killed } = makeFixture({
    relays: [
      { id: 'r1', name: 'R1', address: 'kaspa:r1' },
      { id: 'r2', name: 'R2', address: 'kaspa:r2' },
    ],
    balances: { 'kaspa:r1': 600, 'kaspa:r2': 500 }, // 合计 1100 > 1000
    cap: { total: 1000 },
  });
  // 预置上次余额: r1 上次500(这次600, delta=100), r2 上次100(这次500, delta=400) — r2 涨得多, 该先杀
  deps.prevBalances.set('r1', 500);
  deps.prevBalances.set('r2', 100);
  const result = await relayHotwalletMonitorTick(deps);
  assert.equal(killed.length, 1); // 杀掉 r2 后 600(r1) ≤ 1000, 不需要继续杀
  assert.equal(killed[0].relayNodeId, 'r2');
  assert.equal(killed[0].reason, 'hotwallet_total_cap_exceeded_attributed_by_delta');
});

test('总额上限 · 反：total 不超线 → 不 kill', async () => {
  const { deps, killed } = makeFixture({
    relays: [
      { id: 'r1', name: 'R1', address: 'kaspa:r1' },
      { id: 'r2', name: 'R2', address: 'kaspa:r2' },
    ],
    balances: { 'kaspa:r1': 400, 'kaspa:r2': 500 }, // 合计 900 ≤ 1000
    cap: { total: 1000 },
  });
  const result = await relayHotwalletMonitorTick(deps);
  assert.equal(result.killed, 0);
  assert.equal(killed.length, 0);
});

test('总额上限 · 无法归因(无正向 delta) → 保守全部当前活着的 relay 都被 kill', async () => {
  const { deps, killed } = makeFixture({
    relays: [
      { id: 'r1', name: 'R1', address: 'kaspa:r1' },
      { id: 'r2', name: 'R2', address: 'kaspa:r2' },
    ],
    balances: { 'kaspa:r1': 600, 'kaspa:r2': 500 }, // 合计 1100 > 1000
    cap: { total: 1000 },
  });
  // 两个的 delta 都是 0（跟上次一样）或没有上次记录（算0）——都不是正向增长。
  deps.prevBalances.set('r1', 600);
  deps.prevBalances.set('r2', 500);
  const result = await relayHotwalletMonitorTick(deps);
  assert.equal(result.killed, 2);
  const killedIds = killed.map((k) => k.relayNodeId).sort();
  assert.deepEqual(killedIds, ['r1', 'r2']);
  for (const k of killed) assert.equal(k.reason, 'hotwallet_total_cap_exceeded_unattributable_kill_all');
});

test('第一次被本监控看到的 relay 不会因为"没有上次记录"就被当成涨了全部余额去背锅', async () => {
  // r1 是老面孔(上次500, 这次600, delta=100)；r2 是这次tick第一次出现(没有prevBalances记录)。
  // 合计 500(不对, 见下方assert) — 关键是 r2 的 delta 算 0 不算 400, 所以不该被"归因"选中。
  const { deps, killed } = makeFixture({
    relays: [
      { id: 'r1', name: 'R1', address: 'kaspa:r1' },
      { id: 'r2', name: 'R2', address: 'kaspa:r2' }, // 全新出现, balance=400, 没有 prevBalances 记录
    ],
    balances: { 'kaspa:r1': 600, 'kaspa:r2': 400 }, // 合计 1000, 不超 1000 就不会触发本条件 — 调整成会超线
    cap: { total: 900 }, // 600+400=1000 > 900, 会触发
  });
  deps.prevBalances.set('r1', 500); // r1 有历史, delta=100
  // r2 没有 set prevBalances — 是"第一次见"
  const result = await relayHotwalletMonitorTick(deps);
  // r1 delta=100(正向) 存在 ⇒ 走归因分支(不是"无法归因全杀")，只有 r1 因为是唯一正向 delta 的被杀
  assert.equal(killed.length, 1);
  assert.equal(killed[0].relayNodeId, 'r1', 'r1(真的涨了)该被杀，不是r2(只是第一次被看到，delta算0)');
});

test('缺 env(查询失败) · 连续 3 次失败 → fail-closed 当超限处理，第 3 次触发 kill', async () => {
  const { deps, killed } = makeFixture({
    relays: [{ id: 'r1', name: 'R1', address: 'kaspa:r1' }],
    balances: { 'kaspa:r1': new Error('rpc down') },
    cap: { perRelay: 800 },
  });
  const r1 = await relayHotwalletMonitorTick(deps);
  assert.equal(r1.killed, 0, '第1次失败不杀');
  const r2 = await relayHotwalletMonitorTick(deps);
  assert.equal(r2.killed, 0, '第2次失败不杀');
  const r3 = await relayHotwalletMonitorTick(deps);
  assert.equal(r3.killed, 1, '第3次连续失败触发 fail-closed kill');
  assert.equal(killed[0].reason, 'balance_query_persistently_failed_fail_closed');
  assert.equal(killed[0].detail.consecutiveFailures, 3);
});

test('缺 env(查询失败) · 失败后又成功一次 → 连续计数清零，不会"攒"到 3 次', async () => {
  let shouldFail = true;
  const { deps, killed } = makeFixture({
    relays: [{ id: 'r1', name: 'R1', address: 'kaspa:r1' }],
    balances: {},
    cap: { perRelay: 800 },
  });
  deps.queryBalanceKas = async () => {
    if (shouldFail) throw new Error('rpc down');
    return 100;
  };
  await relayHotwalletMonitorTick(deps); // 失败1
  await relayHotwalletMonitorTick(deps); // 失败2
  shouldFail = false;
  await relayHotwalletMonitorTick(deps); // 成功 — 应该清零计数
  shouldFail = true;
  await relayHotwalletMonitorTick(deps); // 失败1(新一轮)
  await relayHotwalletMonitorTick(deps); // 失败2(新一轮)
  assert.equal(killed.length, 0, '中间成功过一次，连续失败计数应该被清零，不该在第4/5次就触发');
});

test('运行中(running互斥) · 并发调用第二个返回 skipped', async () => {
  const { deps } = makeFixture({
    relays: [{ id: 'r1', name: 'R1', address: 'kaspa:r1' }],
    balances: { 'kaspa:r1': 100 },
    cap: { perRelay: 800 },
  });
  let resolveBalance;
  deps.queryBalanceKas = () => new Promise((resolve) => { resolveBalance = () => resolve(100); });
  const p1 = relayHotwalletMonitorTick(deps);
  // p1 此刻应该已经把 running 置 true 并卡在 queryBalanceKas 里等
  const p2 = await relayHotwalletMonitorTick(deps);
  assert.equal(p2.skipped, true);
  resolveBalance();
  const r1 = await p1;
  assert.equal(r1.ok, true);
});

test('relayHotwalletMonitorTick 导出为异步函数', () => {
  assert.equal(typeof relayHotwalletMonitorTick, 'function');
});
