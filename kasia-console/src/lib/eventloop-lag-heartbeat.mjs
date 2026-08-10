// eventloop-lag-heartbeat.mjs — 诊断埋点(2026-07-13, Bettor 派工#iynqdt/#j4kzsj), observe-only, 零DB写.
//
// 目的: 把"event loop 饿死"从"事后从日志缺口推断"换成"一等公民事件, 有时间戳有时长"——今晚
// 调查(190s 缺口+14 次 settle-daemon tick 重叠+relay-health ~120 次误判 dead 级联)全靠事后翻
// log 拼时间线, 这个心跳直接量出 event loop 实际滞后多少, 是选刀(小刀补索引 vs 大刀分帧)的
// 决定性仪器。查完数据选完刀即可删, 纯观测不改变任何行为。
//
// 原理: setInterval 每 EXPECTED_MS 该触发一次；若两次触发之间实际间隔超出预期 > LAG_ALERT_MS，
// 说明这段时间 event loop 被别的同步/长任务占住了 EXPECTED_MS 之外的那部分时间。
//
// #j4kzsj(Bettor, 2026-07-13 11:14): GC 长停顿假说——console PID 921MB(远超所有 relay 子进程
// 60-130MB)+"纯 await 不该卡 110s 但确实卡了"的机制谜团, 堆膨胀→full GC 数十秒停顿能同时解释
// 两个现象(泄漏渐涨=为什么上午持续恶化)。加 heapUsed 采样: ①每次 lag 告警行附带当时堆大小
// (量出"lag 时刻堆多大") ②独立低频心跳(每 HEAP_SAMPLE_EVERY_N tick, 默认 60s)无条件打一行堆
// 大小(不管有没有 lag, 量出堆本身的增长曲线)——两条线对齐时间轴, 堆持续爬升 + lag 事件与堆峰值
// 重合 = GC 假说坐实; 堆平稳则排除, 转查别的候选(relay stdout 缓冲/sqlite 语句句柄/大查询结果滞留)。

// TEMPORARY (2026-08-10, Bettor approval #ntlj8t): wasmBytes field added alongside the existing
// heapUsed/heapTotal/rss/external/arrayBuffers fields — the only direct read of the wasm module's
// own linear memory (external/rss are aggregates that cannot isolate it). Remove alongside
// utxo-fetch-allocation-probe.mjs (same removal card) once the multi-GB spike investigation closes.
import { wasmBufferBytesMB, utxoFetchCallCount } from './utxo-fetch-allocation-probe.mjs';

const EXPECTED_MS = Number(process.env.EVENTLOOP_HEARTBEAT_MS) || 1000; // 1s 心跳
const LAG_ALERT_MS = Number(process.env.EVENTLOOP_LAG_ALERT_MS) || 1000; // 偏差 >1s 才打日志(不刷屏)
const HEAP_SAMPLE_EVERY_N = Number(process.env.EVENTLOOP_HEAP_SAMPLE_EVERY_N) || 60; // 每 60 个心跳(≈60s)无条件打一行堆大小

let _timer = null;
let _lastFireAt = 0;
let _tickCount = 0;

const _mb = (bytes) => Math.round(bytes / 1024 / 1024);

export function startEventLoopLagHeartbeat() {
  if (_timer) return;
  _lastFireAt = Date.now();
  _timer = setInterval(() => {
    const now = Date.now();
    const actualGapMs = now - _lastFireAt;
    const lagMs = actualGapMs - EXPECTED_MS;
    _tickCount++;
    if (lagMs > LAG_ALERT_MS) {
      const mem = process.memoryUsage();
      console.warn(`[diag:eventloop-lag] gap=${actualGapMs}ms expected=${EXPECTED_MS}ms lag=${lagMs}ms at=${new Date(now).toISOString()} heapUsed=${_mb(mem.heapUsed)}MB heapTotal=${_mb(mem.heapTotal)}MB rss=${_mb(mem.rss)}MB external=${_mb(mem.external)}MB arrayBuffers=${_mb(mem.arrayBuffers)}MB wasmBytes=${wasmBufferBytesMB()} utxoFetchCalls=${utxoFetchCallCount()}`);
    } else if (_tickCount % HEAP_SAMPLE_EVERY_N === 0) {
      // 独立低频心跳(observe-only): 不管有没有 lag，量出堆本身的增长曲线，跟上面 lag 事件的
      // heapUsed 数值对齐时间轴，才能判断"堆持续爬升"还是"lag 时刻恰好撞见一次瞬时波峰"。
      //
      // 2026-08-07(J2 提, Bettor 审 PASS): 加 external / arrayBuffers 两个字段。
      // 🔴 为什么: 既有三字段已足以【排除】堆 —— 08-06/08-07 三次发作(含一次劣化窗口内部现取)
      //    heapUsed 54/81/最高 121MB、heapTotal ≤204MB, 对 --max-old-space-size=4096 的天花板只有
      //    约 1.3–3%; 而同期 rss 从 606MB 涨到 4.5GB, 之后又【两次阶跃掉回 840MB】(-1.63GB/-2.06GB)
      //    而失败次数反而从 3568 涨到 10706。⇒ 涨落的那 3.7GB 全在堆之外, 且与故障不同向。
      // 🔴 但三字段【不能指认】非堆里的哪一块; wasm 线性内存与外部缓冲正计在这两个字段。
      //    ⇒ 这两个字段把"排除法"变成"指认"。
      // ⚠ 作用域(Bettor 提醒, 别被读歪): 它回答的是"下一次劣化时涨/掉的是哪一块内存",
      //    **不回答"为什么会劣化"** —— 内存与该故障的因果已被四条独立证据否掉。
      const mem = process.memoryUsage();
      console.log(`[diag:heap-sample] at=${new Date(now).toISOString()} heapUsed=${_mb(mem.heapUsed)}MB heapTotal=${_mb(mem.heapTotal)}MB rss=${_mb(mem.rss)}MB external=${_mb(mem.external)}MB arrayBuffers=${_mb(mem.arrayBuffers)}MB wasmBytes=${wasmBufferBytesMB()} utxoFetchCalls=${utxoFetchCallCount()}`);
    }
    _lastFireAt = now;
  }, EXPECTED_MS);
  console.log(`[diag:eventloop-lag] heartbeat started (expected=${EXPECTED_MS}ms, alert_threshold=${LAG_ALERT_MS}ms, heap_sample_every=${HEAP_SAMPLE_EVERY_N}s)`);
}

export function stopEventLoopLagHeartbeat() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
