/**
 * relay-health-monitor.js 节流单测（NWT 2-1 v0.3 MUST-FIX, Bettor 1169 派工）。
 *
 * Run: DB_PATH=<temp> node --test kasia-console/test-framework/cases/system/relay-health-monitor.test.mjs
 *
 * 范围：只测 relayHealthMonitorTick() 的节流/记账逻辑——用第一参依赖注入（同 checkHotwalletAdmission/
 * relayHotwalletMonitorTick 既有 DI 约定）替换掉 relay_nodes 查询/isRelayAlive/startRelay，不连真实
 * DB、不起真实 relay 子进程。每个用例自带独立的 restartHistory/stormLogState Map，互不污染。
 *
 * 背景：修复前 _recordRestart() 只在 startRelay 成功时记账——对 cold_address_denied 这类永远被拒的
 * 候选，"最近一小时重启次数"永远是 0，MAX_RESTART_PER_HOUR 节流从未生效，每 30s tick 无限重试。
 *
 * Live verify（真实并发+真实 startRelay+真实日志频率）defer 到 operator hat 手动测。
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { relayHealthMonitorTick } from '../../../src/services/relay-health-monitor.js';

function makeFixture({ relays, startRelayResult }) {
  const startRelayCalls = [];
  const doStartRelay = async (id) => {
    startRelayCalls.push({ id, at: Date.now() });
    const r = typeof startRelayResult === 'function' ? startRelayResult(id) : startRelayResult;
    if (r instanceof Error) throw r;
    return r;
  };
  const listEligible = () => relays.map((r) => ({ id: r.id, name: r.name }));
  const checkAlive = () => ({ alive: false, reason: 'no relay process (= not started)' }); // 全部视为"死"，进入重启判断
  const deps = {
    listEligible,
    checkAlive,
    doStartRelay,
    restartHistory: new Map(),
    stormLogState: new Map(),
  };
  return { deps, startRelayCalls };
}

test('被拒候选（cold_address_denied）：连续调用 3 次后，本小时内不再调用 startRelay', async () => {
  const { deps, startRelayCalls } = makeFixture({
    relays: [{ id: 'r1', name: 'Trader-B' }],
    startRelayResult: { ok: false, reason: 'cold_address_denied' },
  });

  const t1 = await relayHealthMonitorTick(deps);
  assert.equal(t1.restarted, 0);
  assert.equal(t1.restart_stormed, 0, '第1次不该被节流(还没到阈值)');
  assert.equal(startRelayCalls.length, 1);

  const t2 = await relayHealthMonitorTick(deps);
  assert.equal(t2.restart_stormed, 0);
  assert.equal(startRelayCalls.length, 2);

  const t3 = await relayHealthMonitorTick(deps);
  assert.equal(t3.restart_stormed, 0);
  assert.equal(startRelayCalls.length, 3);

  // 第4次：此刻"最近一小时重启次数"应该已经是3(每次调用无论成功失败都记账) ≥ MAX_RESTART_PER_HOUR(3)，
  // 该被节流，不再真的调用 startRelay——这是本次 MUST-FIX 要修的核心行为。
  const t4 = await relayHealthMonitorTick(deps);
  assert.equal(t4.restart_stormed, 1, '第4次应该被节流跳过');
  assert.equal(startRelayCalls.length, 3, '节流后 startRelay 调用次数不应该再增加');

  // 再跑几次，确认持续保持节流状态，不会"节流一次又恢复"。
  await relayHealthMonitorTick(deps);
  await relayHealthMonitorTick(deps);
  assert.equal(startRelayCalls.length, 3, '持续节流期间 startRelay 调用次数保持不变');
});

test('attempt 编号从真实调用次数取，不会永远停在 #1', async () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  try {
    const { deps } = makeFixture({
      relays: [{ id: 'r1', name: 'R1' }],
      startRelayResult: { ok: false, reason: 'per_relay_cap_exceeded' },
    });
    await relayHealthMonitorTick(deps); // attempt #1（recent=0 时）
    await relayHealthMonitorTick(deps); // attempt #2（recent=1）
    await relayHealthMonitorTick(deps); // attempt #3（recent=2）
  } finally {
    console.log = origLog;
  }
  const attemptLines = logs.filter((l) => l.includes('auto-restart attempt'));
  assert.equal(attemptLines.length, 3);
  assert.ok(attemptLines[0].includes('attempt #1'), `第1条应为 #1: ${attemptLines[0]}`);
  assert.ok(attemptLines[1].includes('attempt #2'), `第2条应为 #2（修复前会一直是#1）: ${attemptLines[1]}`);
  assert.ok(attemptLines[2].includes('attempt #3'), `第3条应为 #3: ${attemptLines[2]}`);
});

test('成功路径行为不变：startRelay 成功时正常计入 restarted，且同样受节流保护', async () => {
  const { deps, startRelayCalls } = makeFixture({
    relays: [{ id: 'r1', name: 'R1' }],
    startRelayResult: { ok: true, pid: 12345 },
  });

  const t1 = await relayHealthMonitorTick(deps);
  assert.equal(t1.restarted, 1);
  assert.equal(t1.restart_stormed, 0);
  assert.equal(startRelayCalls.length, 1);
});

test('启动异常(抛错)同样计入节流分母——不是只有 fail-closed 拒绝才算', async () => {
  const { deps, startRelayCalls } = makeFixture({
    relays: [{ id: 'r1', name: 'R1' }],
    startRelayResult: new Error('spawn ENOENT'),
  });

  await relayHealthMonitorTick(deps);
  await relayHealthMonitorTick(deps);
  await relayHealthMonitorTick(deps);
  const t4 = await relayHealthMonitorTick(deps);
  assert.equal(t4.restart_stormed, 1, '抛异常也该在第4次触发节流');
  assert.equal(startRelayCalls.length, 3);
});

test('节流摘要日志：第一次进入节流状态立即提示一条，之后同一小时窗口内静默累计不重复打行', async () => {
  const warnLogs = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnLogs.push(args.join(' ')); };
  try {
    const { deps } = makeFixture({
      relays: [{ id: 'r1', name: 'R1' }],
      startRelayResult: { ok: false, reason: 'cold_address_denied' },
    });
    await relayHealthMonitorTick(deps);
    await relayHealthMonitorTick(deps);
    await relayHealthMonitorTick(deps);
    // 到这里已经触发节流条件的三次真实调用；接下来连续 5 次 tick 都应该被节流跳过。
    // 设计：第一次进入节流状态就立即提示("最近一次窗口起点"是0, 视为该马上通知)，之后在同一个
    // STORM_LOG_INTERVAL_MS(1小时)窗口内的后续跳过静默累计计数, 不重复打行(不是"每tick都打",
    // 也不是"攒够N次才第一次通知")——这两点分开测：这里测"5次跳过只出1条摘要"这个不刷屏的行为,
    // 不测"计数最终报多少"(那要真等一小时窗口滚动才能观察到, 不在本文件覆盖范围)。
    for (let i = 0; i < 5; i++) await relayHealthMonitorTick(deps);
  } finally {
    console.warn = origWarn;
  }
  const stormSummaryLines = warnLogs.filter((l) => l.includes('节流摘要'));
  assert.equal(stormSummaryLines.length, 1, '第4~8次共5次被节流的 tick 应该总共只打 1 条摘要日志（第4次那条），不是5条刷屏');
  assert.ok(stormSummaryLines[0].includes('跳过 1 次'), `第一条摘要是第4次tick触发的, 当时只跳过了这一次: ${stormSummaryLines[0]}`);
});

test('多个候选互不干扰：一个被节流不影响另一个正常重启', async () => {
  // r2 一旦成功重启一次就视为"活了"(真实场景里 isRelayAlive 会看到真的还在跑的子进程)，
  // 不会再进入"死→尝试重启"这个分支，所以 r2 的重启计数不该跟着 tick 数持续涨——用一个
  // 状态位模拟这一点，跟 r1(每次都判死、每次都被拒)的行为区分开，否则用同一个"全员恒判死"
  // 的简化 checkAlive 会让 r2 也跟着 r1 一起在第4次撞上节流阈值(这是当初这条测试写错的地方,
  // 不是真的"互相干扰"，是 fixture 的 checkAlive 太简化了)。
  const r2Alive = { value: false };
  const startRelayCalls = [];
  const doStartRelay = async (id) => {
    startRelayCalls.push({ id, at: Date.now() });
    if (id === 'r1') return { ok: false, reason: 'cold_address_denied' };
    r2Alive.value = true; // r2 这次成功启动, 视为之后真的活着了
    return { ok: true, pid: 999 };
  };
  const deps = {
    listEligible: () => [{ id: 'r1', name: 'AlwaysRejected' }, { id: 'r2', name: 'Healthy' }],
    checkAlive: (id) => (id === 'r2' && r2Alive.value ? { alive: true } : { alive: false, reason: 'not started' }),
    doStartRelay,
    restartHistory: new Map(),
    stormLogState: new Map(),
  };

  const t1 = await relayHealthMonitorTick(deps);
  assert.equal(t1.restarted, 1, 'r2 第1次真实重启成功');
  const t2 = await relayHealthMonitorTick(deps);
  assert.equal(t2.healthy, 1, 'r2 第2次开始被判定为活着, 不再进入重启分支');
  await relayHealthMonitorTick(deps);
  const t4 = await relayHealthMonitorTick(deps);
  assert.equal(t4.restart_stormed, 1, '只有 r1 该被节流, r2 早就"活着"不再计入 restart_stormed/restarted');
  const r1Calls = startRelayCalls.filter((c) => c.id === 'r1').length;
  const r2Calls = startRelayCalls.filter((c) => c.id === 'r2').length;
  assert.equal(r1Calls, 3, 'r1 停在3次');
  assert.equal(r2Calls, 1, 'r2 只在第1次真的调用过 startRelay, 之后一直是健康状态不再调用');
});

test('relayHealthMonitorTick 导出为异步函数', () => {
  assert.equal(typeof relayHealthMonitorTick, 'function');
});

// ── 2026-09-26 (账本1672/1674, Owner 亲批修 relay 健康检查误判) 追加 ──────────────────────────
// 背景：isRelayAlive() 原来把"lastLogAt 距今>60s"当死亡信号，主网 18 个空闲(但活着)的 relay 全被
// 判死，relay-health-monitor 每 30s 对着全部活 relay 调 startRelay()，结果全部落空 already_running
// （relay-manager.js:159 一发现 `_relays[id]?.child` 已存在就直接拒绝）——零真实重启，但这次"尝试"
// 之前会被无差别计入重启配额，跟 cold_address_denied 这类【真实、会一直失败】的拒绝混在一个桶里，
// 配额被空耗，真故障发生时可能已经被误判攒满。这里只测 relay-health-monitor.js 这一半（配额记账不
// 该数 already_running）；isRelayAlive() 本身的判活逻辑修复见 relay-manager-alive.test.mjs。

test('already_running：连续调用多次不耗尽重启配额（不是真实尝试，不计节流分母）', async () => {
  const { deps, startRelayCalls } = makeFixture({
    relays: [{ id: 'r1', name: 'IdleButAlive' }],
    startRelayResult: { ok: false, reason: 'already_running', pid: 12345 },
  });

  // 跑 6 次(远超 MAX_RESTART_PER_HOUR=3)——若 already_running 被错误计入配额，第4次起就该被节流；
  // 修复后应该【每次都真的调用 doStartRelay】，因为节流分母从未真的涨过。
  for (let i = 0; i < 6; i++) {
    const t = await relayHealthMonitorTick(deps);
    assert.equal(t.restart_stormed, 0, `第${i + 1}次不该被节流（already_running 不占配额）`);
  }
  assert.equal(startRelayCalls.length, 6, '6 次 tick 都该真的调用 startRelay，没有一次被节流拦下');
});

test('cold_address_denied 仍照旧耗配额（2026-09-14 那条 MUST-FIX 没被本次改动动到）', async () => {
  const { deps, startRelayCalls } = makeFixture({
    relays: [{ id: 'r1', name: 'ColdDenied' }],
    startRelayResult: { ok: false, reason: 'cold_address_denied' },
  });
  await relayHealthMonitorTick(deps);
  await relayHealthMonitorTick(deps);
  await relayHealthMonitorTick(deps);
  const t4 = await relayHealthMonitorTick(deps);
  assert.equal(t4.restart_stormed, 1, 'cold_address_denied 第4次仍应被节流——回归旧行为，防止这次改动误伤');
  assert.equal(startRelayCalls.length, 3, '节流后不应再继续真调用 startRelay');
});

test('already_running 与 cold_address_denied 混合场景：前者不占配额、后者占，互不干扰', async () => {
  const startRelayCalls = [];
  const doStartRelay = async (id) => {
    startRelayCalls.push({ id, at: Date.now() });
    if (id === 'idle') return { ok: false, reason: 'already_running', pid: 1 };
    return { ok: false, reason: 'cold_address_denied' };
  };
  const deps = {
    listEligible: () => [{ id: 'idle', name: 'Idle' }, { id: 'denied', name: 'Denied' }],
    checkAlive: () => ({ alive: false, reason: 'no relay process (= not started)' }),
    doStartRelay,
    restartHistory: new Map(),
    stormLogState: new Map(),
  };

  for (let i = 0; i < 5; i++) await relayHealthMonitorTick(deps);

  const idleCalls = startRelayCalls.filter((c) => c.id === 'idle').length;
  const deniedCalls = startRelayCalls.filter((c) => c.id === 'denied').length;
  assert.equal(idleCalls, 5, 'already_running 一直不占配额，5次 tick 都真的调用了');
  assert.equal(deniedCalls, 3, 'cold_address_denied 在第4次起被节流，停在3次（回归旧行为）');
});
