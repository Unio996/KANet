// eventloop-lag-heartbeat.mjs — 诊断埋点(2026-07-13, Bettor 派工#iynqdt), observe-only, 零DB写.
//
// 目的: 把"event loop 饿死"从"事后从日志缺口推断"换成"一等公民事件, 有时间戳有时长"——今晚
// 调查(190s 缺口+14 次 settle-daemon tick 重叠+relay-health ~120 次误判 dead 级联)全靠事后翻
// log 拼时间线, 这个心跳直接量出 event loop 实际滞后多少, 是选刀(小刀补索引 vs 大刀分帧)的
// 决定性仪器。查完数据选完刀即可删, 纯观测不改变任何行为。
//
// 原理: setInterval 每 EXPECTED_MS 该触发一次；若两次触发之间实际间隔超出预期 > LAG_ALERT_MS，
// 说明这段时间 event loop 被别的同步/长任务占住了 EXPECTED_MS 之外的那部分时间。

const EXPECTED_MS = Number(process.env.EVENTLOOP_HEARTBEAT_MS) || 1000; // 1s 心跳
const LAG_ALERT_MS = Number(process.env.EVENTLOOP_LAG_ALERT_MS) || 1000; // 偏差 >1s 才打日志(不刷屏)

let _timer = null;
let _lastFireAt = 0;

export function startEventLoopLagHeartbeat() {
  if (_timer) return;
  _lastFireAt = Date.now();
  _timer = setInterval(() => {
    const now = Date.now();
    const actualGapMs = now - _lastFireAt;
    const lagMs = actualGapMs - EXPECTED_MS;
    if (lagMs > LAG_ALERT_MS) {
      console.warn(`[diag:eventloop-lag] gap=${actualGapMs}ms expected=${EXPECTED_MS}ms lag=${lagMs}ms at=${new Date(now).toISOString()}`);
    }
    _lastFireAt = now;
  }, EXPECTED_MS);
  console.log(`[diag:eventloop-lag] heartbeat started (expected=${EXPECTED_MS}ms, alert_threshold=${LAG_ALERT_MS}ms)`);
}

export function stopEventLoopLagHeartbeat() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
