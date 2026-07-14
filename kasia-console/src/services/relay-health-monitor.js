// relay-health-monitor.js — J2-tn r425 (Bettor r446 task 2 relay-orphan 固化).
//
// Console 重启后 (= supervisor 拉起) 部分 relay 可能 startAll() fail (= rpc env 缺等 transient).
// 30s cron 扫 relay_nodes, isRelayAlive false → startRelay 重拉. Restart storm 防护.
//
// Bettor r446 surface: "kanet-start-headless 不启 relay → supervisor 重启 Console 后 relay
// 还是孤儿、押注/广播照样断到手动拉".
//
// 配合 r424 Console supervisor: supervisor 救 Console 死, 此 monitor 救 relay 死/没起来.

import { sqlite } from '../db/client.js';
import { getStatus, isRelayAlive, startRelay } from './relay-manager.js';

const TICK_INTERVAL_MS = Number(process.env.RELAY_HEALTH_TICK_MS) || 30_000;  // 30s
const STARTUP_GRACE_MS = 90_000;  // wait 90s after Console boot so initial startAll has chance
const MAX_RESTART_PER_HOUR = Number(process.env.RELAY_HEALTH_MAX_RESTART_PER_HOUR) || 3;

let timer = null;
let running = false;
const _restartHistory = new Map();  // relayNodeId → [timestamps]

function _restartCountInLastHour(relayNodeId) {
  const arr = _restartHistory.get(relayNodeId) || [];
  const cutoff = Date.now() - 3600_000;
  const recent = arr.filter(t => t >= cutoff);
  _restartHistory.set(relayNodeId, recent);
  return recent.length;
}

function _recordRestart(relayNodeId) {
  const arr = _restartHistory.get(relayNodeId) || [];
  arr.push(Date.now());
  _restartHistory.set(relayNodeId, arr);
}

export async function relayHealthMonitorTick() {
  if (running) return { skipped: true };
  running = true;
  // 2026-07-14 J2/Bettor 双轨定罪轨道1(Owner直令#kul7j3, 头号嫌疑relayHealthMonitorTick 31个relay
  // 串行await startRelay理论): observe-only 计时探针, 零行为改动, 照抄今天settle-daemon同款
  // [diag:tick-duration]模式。装载后直接看数值定罪(单轮=264秒量级=铁证)。
  const _tickStart = Date.now();
  try {
    // 2026-07-04 (查漏补缺·qzdh7nar/KANet-UI): 原 INNER JOIN adapter_nodes 把没绑 adapter 的 relay
    // 排除在健康监控外——但 startRelay()(relay-manager.js) 本身用 LEFT JOIN，压根不需要 adapter 才能跑。
    // 这条件比实际需求严，导致无 adapter 的 relay 被孤儿化(挂了没人重启)。#34 挖矿 relay today 撞过这个坑
    // (临时靠手动绑 adapter 绕过，根没修)。改成不要求 adapter，跟 startRelay() 的资格条件对齐。
    const eligible = sqlite.prepare(`
      SELECT r.id, r.name
      FROM relay_nodes r
      WHERE r.address IS NOT NULL
        AND (r.mnemonic_encrypted IS NOT NULL OR r.privkey_encrypted IS NOT NULL)
    `).all();
    let healthy = 0, restarted = 0, restart_stormed = 0, errored = 0, deadCount = 0;
    for (const r of eligible) {
      const aliveCheck = isRelayAlive(r.id);
      if (aliveCheck?.alive) { healthy++; continue; }
      deadCount++;

      const recent = _restartCountInLastHour(r.id);
      if (recent >= MAX_RESTART_PER_HOUR) {
        restart_stormed++;
        console.warn(`[relay-health] ${r.name} died but ${recent} restarts in last hour ≥ MAX(${MAX_RESTART_PER_HOUR}) — skip (manual investigation needed)`);
        continue;
      }
      console.log(`[relay-health] ${r.name} dead (reason=${aliveCheck?.reason || 'unknown'}) — auto-restart attempt #${recent + 1}`);
      const _srStart = Date.now();
      try {
        const result = await startRelay(r.id);
        console.log(`[diag:relay-health-per-relay] ${r.name} startRelay ms=${Date.now() - _srStart}`);
        if (result?.ok) {
          _recordRestart(r.id);
          restarted++;
          console.log(`[relay-health] ${r.name} auto-restarted pid=${result.pid}`);
        } else {
          errored++;
          console.warn(`[relay-health] ${r.name} startRelay fail: ${result?.reason || 'unknown'}`);
        }
      } catch (e) {
        console.log(`[diag:relay-health-per-relay] ${r.name} startRelay ms=${Date.now() - _srStart} (threw)`);
        errored++;
        console.warn(`[relay-health] ${r.name} startRelay exception: ${e.message}`);
      }
    }
    if (restarted > 0 || restart_stormed > 0) {
      console.log(`[relay-health] tick eligible=${eligible.length} healthy=${healthy} restarted=${restarted} restart_stormed=${restart_stormed} errored=${errored}`);
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
