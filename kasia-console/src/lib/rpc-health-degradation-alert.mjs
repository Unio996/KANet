// rpc-health-degradation-alert.mjs — 连续 RPC 失败告警(KANet-UI, 2026-07-21, Bettor #utf9ze①派工)
//
// 背景: RpcClient 状态劣化今天复发两次(07:35Z/14:48Z), 第二次冻结 settle-daemon tick 44 分钟才被
// 人肉巡检发现——no-RPC 期间 console HTTP/心跳仍 fresh, 纯靠人盯日志才抓到。本模块补一个自动信号,
// 不再靠"谁记得去查console.log"。
//
// 架构模式照抄同文件夹 settle-failed-alert.mjs(edge-trigger + events 表留痕 + 直接播频道三件套,
// 已验证过的成熟先例, 不另造轮子)——边沿触发(只在"跨过阈值进入劣化态"那一刻报一次, 不是持续
// 劣化期间每 tick 都刷屏), 恢复后自动重新武装(下次再劣化会再报一次)。
//
// 只做检测告警, 不做自动重启(Bettor 明确: 告警先行, 自动化动作等告警本身跑稳后再议, 防止把
// 短暂网络抖动误判成需要重启的场景)。
//
// 自指风险说明(NWT #utf9ze note①要求写明): 本模块检测的是 getWorkingRpc() 这条 console 内部
// RPC 连接链路(rpc-health.js), 播报走的是 /api/chat/send → relay-manager 子进程独立的链上广播
// 通道(架构上不共享同一个 RPC 连接, 见 chat.js 全文零处引用 getWorkingRpc/rpc-health)——今天
// 07:34/14:48 两次实况也验证了这条: RPC 降级期间频道消息照常发得出去, 不会出现"看门狗自己也
// 哑火"的自指死锁。
import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const TICK_INTERVAL_MS = Number(process.env.RPC_HEALTH_ALERT_TICK_MS) || 60_000; // 1min
const STARTUP_GRACE_MS = 30_000;
const WINDOW_MINUTES = Number(process.env.RPC_HEALTH_ALERT_WINDOW_MIN) || 3; // 统计过去几分钟内的失败次数
const FAIL_THRESHOLD = Number(process.env.RPC_HEALTH_ALERT_THRESHOLD) || 5; // 窗口内达到几次判定"真劣化"非瞬时抖动
const ALERT_RELAY_ID = process.env.RPC_HEALTH_ALERT_RELAY_ID || 'f5cf6d85-58f4-4991-9cd5-7c6779f6822b'; // KANet-UI-tn
const ALERT_CHANNEL = process.env.RPC_HEALTH_ALERT_CHANNEL || 'dev-coord-testnet';
const CONSOLE_BASE = process.env.RPC_HEALTH_ALERT_CONSOLE_BASE || 'http://127.0.0.1:3200';
const FETCH_TIMEOUT_MS = 15_000;

let timer = null;
let running = false;
let _alerting = false; // edge-trigger 状态: 当前是否已经为这一轮劣化报过警(恢复后复位)

function _writeAlertEvent(summary, count) {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'rpc_health_degraded_onset', 'rpc-health-degradation-alert', 'error', ?, ?, datetime('now'))
    `).run(randomUUID(), summary, JSON.stringify({ windowMinutes: WINDOW_MINUTES, failCount: count, threshold: FAIL_THRESHOLD }));
  } catch (e) { console.warn(`[rpc-health-degradation-alert] events insert fail (non-fatal): ${e.message}`); }
}

async function _postToChannel(text) {
  try {
    const ctrl = new AbortController();
    const timer2 = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    await fetch(`${CONSOLE_BASE}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId: ALERT_RELAY_ID, channel: ALERT_CHANNEL, message: text }),
      signal: ctrl.signal,
    }).catch((e) => console.warn(`[rpc-health-degradation-alert] channel post fail (non-fatal): ${e.message}`));
    clearTimeout(timer2);
  } catch (e) { console.warn(`[rpc-health-degradation-alert] channel post fail (non-fatal): ${e.message}`); }
}

export async function rpcHealthAlertTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const row = sqlite.prepare(`
      SELECT COUNT(*) AS n FROM events
       WHERE event_type = 'rpc_health_check_failed' AND created_at > datetime('now', ?)
    `).get(`-${WINDOW_MINUTES} minutes`);
    const count = row?.n || 0;

    if (count >= FAIL_THRESHOLD) {
      if (_alerting) return { ok: true, degraded: true, alreadyAlerted: true, count };
      _alerting = true;
      const summary = `过去${WINDOW_MINUTES}分钟内 getWorkingRpc() 连续失败 ${count} 次(阈值${FAIL_THRESHOLD})— RpcClient 疑似进入劣化态, 结算/下注等所有需要RPC的路径可能受影响。已知修法(今天两次复发均验证过): 重启console。`;
      console.warn(`[rpc-health-degradation-alert] DEGRADED: ${count} failures in ${WINDOW_MINUTES}min`);
      _writeAlertEvent(summary, count);
      await _postToChannel(`🔴【rpc-health-degradation-alert·自动监控】RPC疑似劣化\n${summary}`);
      return { ok: true, degraded: true, count };
    }

    // 恢复(低于阈值)— 复位边沿触发状态, 下次再劣化会重新报警
    if (_alerting && count === 0) _alerting = false;
    return { ok: true, degraded: false, count };
  } catch (e) {
    console.warn(`[rpc-health-degradation-alert] tick fail (non-fatal, retry next cycle): ${e.message}`);
    return { ok: false, reason: e.message };
  } finally {
    running = false;
  }
}

export function startRpcHealthDegradationAlertCron() {
  if (timer) return;
  console.log(`[rpc-health-degradation-alert] started — tick=${TICK_INTERVAL_MS}ms, window=${WINDOW_MINUTES}min, threshold=${FAIL_THRESHOLD} (只读监控, 不自动重启, 只写events+播${ALERT_CHANNEL}频道)`);
  setTimeout(() => { rpcHealthAlertTick().catch((e) => console.error('[rpc-health-degradation-alert] startup tick:', e.message)); }, STARTUP_GRACE_MS);
  timer = setInterval(() => { rpcHealthAlertTick().catch((e) => console.error('[rpc-health-degradation-alert] tick:', e.message)); }, TICK_INTERVAL_MS);
}

export function stopRpcHealthDegradationAlertCron() {
  if (timer) { clearInterval(timer); timer = null; }
  _alerting = false;
}

// 测试专用: 重置 module-level 边沿触发状态(离线回归测试需要在同一进程内模拟"劣化→恢复→再劣化"
// 多轮场景, 不重置状态会导致第二轮测试被第一轮的 _alerting=true 挡住)。
export function _resetAlertStateForTest() { _alerting = false; }
