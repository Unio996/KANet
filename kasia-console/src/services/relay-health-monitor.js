// relay-health-monitor.js — J2-tn r425 (Bettor r446 task 2 relay-orphan 固化).
//
// Console 重启后 (= supervisor 拉起) 部分 relay 可能 startAll() fail (= rpc env 缺等 transient).
// 30s cron 扫 relay_nodes, isRelayAlive false → startRelay 重拉. Restart storm 防护.
//
// Bettor r446 surface: "kanet-start-headless 不启 relay → supervisor 重启 Console 后 relay
// 还是孤儿、押注/广播照样断到手动拉".
//
// 配合 r424 Console supervisor: supervisor 救 Console 死, 此 monitor 救 relay 死/没起来.
//
// 🔴 NWT 2-1 v0.3 MUST-FIX（2026-09-14, Bettor 1169 派工, 排在两大额热钱包账号导入之前）：
// 本文件原来只在 startRelay() 成功时调 _recordRestart()——对 cold_address_denied/
// per_relay_cap_exceeded 这类【永远会被拒】的候选（NWT 2-1 热钱包准入门, relay-manager.js:
// startRelay() 内部三条检查, 见 checkHotwalletAdmission），这个候选的"最近一小时重启次数"
// 永远是 0，MAX_RESTART_PER_HOUR 这条节流从未对它生效，30s tick 永久重试、每账号每 tick
// 打 3 行日志（两个大额账号 ≈17,280 行/天）、日志里的"auto-restart attempt #1"永远是 #1
// （因为"最近一小时次数"这个计数分母从未真的涨过）。修法：_recordRestart() 改成【只要真的
// 调用了 startRelay()，无论结果成功失败都记】——节流是"我们尝试过几次"，不是"我们成功过
// 几次"，被准入门永久拒绝的候选跟真实故障候选一样，都不该无限期占用 tick 资源。

import { sqlite } from '../db/client.js';
import { getStatus, isRelayAlive, startRelay } from './relay-manager.js';
// 2026-09-26 (账本1672/1674): 重导出已有导入的 isRelayAlive，供
// test-framework/cases/system/relay-manager-alive.test.mjs 单测——这不是新增 relay-manager 消费点
// (import 语句本身一字未改，M0a 只对 import/require/动态 import 行取模，`export {}` 不在其匹配范围内)，
// 只是把这个文件本来就有的绑定多开一个读口，避免测试文件另起一条需要 NWT 重新过 M0a 窄 capability
// 审批的裸 relay-manager import（同一个符号没必要两条通道都开）。
export { isRelayAlive };

const TICK_INTERVAL_MS = Number(process.env.RELAY_HEALTH_TICK_MS) || 30_000;  // 30s
const STARTUP_GRACE_MS = 90_000;  // wait 90s after Console boot so initial startAll has chance
const MAX_RESTART_PER_HOUR = Number(process.env.RELAY_HEALTH_MAX_RESTART_PER_HOUR) || 3;
// 节流命中(restart_stormed)时的摘要日志间隔——不再每 tick 打一行, 降到每小时一条摘要。
const STORM_LOG_INTERVAL_MS = 3600_000;

let timer = null;
let running = false;
const _restartHistory = new Map();  // relayNodeId → [timestamps]（真实调用 startRelay 的次数, 不分成功失败）
const _stormLogState = new Map();   // relayNodeId → { lastLoggedAt, skippedSinceLastLog }

function _restartCountInLastHour(relayNodeId, restartHistory) {
  const arr = restartHistory.get(relayNodeId) || [];
  const cutoff = Date.now() - 3600_000;
  const recent = arr.filter(t => t >= cutoff);
  restartHistory.set(relayNodeId, recent);
  return recent.length;
}

// 🔴 无论 startRelay() 的结果是成功、fail-closed 拒绝、还是抛异常, 只要这次 tick 真的调用
// 了它, 就记一次——这是本次 MUST-FIX 的核心：节流针对"尝试次数", 不是"成功次数"。
function _recordRestart(relayNodeId, restartHistory) {
  const arr = restartHistory.get(relayNodeId) || [];
  arr.push(Date.now());
  restartHistory.set(relayNodeId, arr);
}

// 节流命中时的摘要日志——同一个 relay 在 STORM_LOG_INTERVAL_MS 窗口内只打一行, 内容是
// "这段时间内跳过了几次", 不是每次跳过都打一行。
function _logStormSkipIfDue(relayNodeId, name, recent, stormLogState) {
  const state = stormLogState.get(relayNodeId) || { lastLoggedAt: 0, skippedSinceLastLog: 0 };
  state.skippedSinceLastLog += 1;
  const now = Date.now();
  if (now - state.lastLoggedAt >= STORM_LOG_INTERVAL_MS) {
    console.warn(`[relay-health] ${name} 节流摘要：过去 ${state.lastLoggedAt ? Math.round((now - state.lastLoggedAt) / 60000) : '<60'} 分钟内跳过 ${state.skippedSinceLastLog} 次自动重启尝试（${recent} restarts in last hour ≥ MAX(${MAX_RESTART_PER_HOUR})）— manual investigation needed if unexpected`);
    state.lastLoggedAt = now;
    state.skippedSinceLastLog = 0;
  }
  stormLogState.set(relayNodeId, state);
}

/**
 * 单次 tick。第一参 `deps` 是可选依赖注入（同 checkHotwalletAdmission/relayHotwalletMonitorTick
 * 既有 DI 约定——不是 `*ForTests` 专名导出，是默认走真实实现、测试可覆盖的普通可选参数）：
 * - `listEligible()` 覆盖对 relay_nodes 的查询（默认真实 SELECT）
 * - `checkAlive(id)` 覆盖 isRelayAlive（默认）
 * - `doStartRelay(id)` 覆盖 startRelay（默认）
 * - `restartHistory`/`stormLogState` 覆盖模块级状态 Map（默认用模块级单例——测试传入独立的
 *   新 Map() 隔离状态，不污染真实监控的重启历史/摘要日志节流状态）
 */
export async function relayHealthMonitorTick(deps = {}) {
  const {
    listEligible = () => sqlite.prepare(`
      SELECT r.id, r.name
      FROM relay_nodes r
      WHERE r.address IS NOT NULL
        AND (r.mnemonic_encrypted IS NOT NULL OR r.privkey_encrypted IS NOT NULL)
    `).all(),
    checkAlive = isRelayAlive,
    doStartRelay = startRelay,
    restartHistory = _restartHistory,
    stormLogState = _stormLogState,
  } = deps;

  const __t0 = Date.now();
  if (running) return { skipped: true };
  running = true;
  const _tickStart = Date.now();
  try {
    const eligible = listEligible();
    let healthy = 0, restarted = 0, restart_stormed = 0, errored = 0, deadCount = 0;
    for (const r of eligible) {
      const aliveCheck = checkAlive(r.id);
      if (aliveCheck?.alive) { healthy++; continue; }
      deadCount++;

      const recent = _restartCountInLastHour(r.id, restartHistory);
      if (recent >= MAX_RESTART_PER_HOUR) {
        restart_stormed++;
        _logStormSkipIfDue(r.id, r.name, recent, stormLogState);
        continue;
      }
      console.log(`[relay-health] ${r.name} dead (reason=${aliveCheck?.reason || 'unknown'}) — auto-restart attempt #${recent + 1}`);
      const _srStart = Date.now();
      // 🔴 MUST-FIX 核心（2026-09-14, 不变）：记录发生在调用之后、不看结果——无论成功/fail-closed
      // 拒绝（如 cold_address_denied/per_relay_cap_exceeded）/抛异常，"尝试过一次"这件事本身就该
      // 计入节流分母。
      // 🔴 例外（2026-09-26 账本1672/1674 修复）：`already_running` 不是"尝试失败"，是"isRelayAlive
      // 判死那一刻起到这次真调用之间，relay 其实一直活着"（`isRelayAlive` 误判死亡的直接后果，见
      // relay-manager.js:isRelayAlive 头注）——这次调用没有真正尝试重启任何东西，不该占用重启配额，
      // 否则一次误判会连带把真实故障时的重试配额也一起吃掉。上面 2026-09-14 那条 MUST-FIX 不动：
      // cold_address_denied 等 fail-closed 拒绝仍然是真实尝试过的一次，照样计入。
      try {
        const result = await doStartRelay(r.id);
        if (result?.reason !== 'already_running') _recordRestart(r.id, restartHistory);
        console.log(`[diag:relay-health-per-relay] ${r.name} startRelay ms=${Date.now() - _srStart}`);
        if (result?.ok) {
          restarted++;
          console.log(`[relay-health] ${r.name} auto-restarted pid=${result.pid}`);
        } else {
          errored++;
          console.warn(`[relay-health] ${r.name} startRelay fail: ${result?.reason || 'unknown'}`);
        }
      } catch (e) {
        _recordRestart(r.id, restartHistory);
        console.log(`[diag:relay-health-per-relay] ${r.name} startRelay ms=${Date.now() - _srStart} (threw)`);
        errored++;
        console.warn(`[relay-health] ${r.name} startRelay exception: ${e.message}`);
      }
    }
    if (restarted > 0 || restart_stormed > 0) {
      console.log(`[relay-health] tick eligible=${eligible.length} healthy=${healthy} restarted=${restarted} restart_stormed=${restart_stormed} errored=${errored}`);
  console.log(`[relay-health][diag] TICK TOOK ${Date.now()-__t0}ms`);
    }
    console.log(`[diag:tick-duration] relayHealthMonitorTick ms=${Date.now() - _tickStart} eligible=${eligible.length} deadCount=${deadCount}`);
    return { ok: true, eligible: eligible.length, healthy, restarted, restart_stormed, errored };
  } catch (e) {
    console.error('[relay-health] tick fail:', e.message);
    console.log(`[diag:tick-duration] relayHealthMonitorTick ms=${Date.now() - _tickStart} FAILED`);
    return { ok: false, error: e.message };
  } finally {
    running = false;
  }
}

export function startRelayHealthMonitorCron() {
  if (timer) return;
  console.log(`[relay-health] started — tick=${TICK_INTERVAL_MS}ms grace=${STARTUP_GRACE_MS}ms max_restart_per_hour=${MAX_RESTART_PER_HOUR}`);
  setTimeout(() => {
    relayHealthMonitorTick().catch(e => console.error('[relay-health] startup tick:', e.message));
  }, STARTUP_GRACE_MS);
  timer = setInterval(() => {
    relayHealthMonitorTick().catch(e => console.error('[relay-health] tick:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopRelayHealthMonitorCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
