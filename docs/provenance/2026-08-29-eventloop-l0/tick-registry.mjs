// tick-registry.mjs — L0 归因仪器 (J2 2026-08-29, docs/2026-08-29-j2-console-eventloop-block-investigation.md §2)
// observe-only · 零 DB 写 · 零行为改动: 只把每个 setInterval 回调包一层, 量它的【同步前缀】(回调返回那一刻之前的墙钟),
// 记进环形缓冲, 供 eventloop-lag-heartbeat 在 lag 事件时按时间窗回捞 "刚才谁在同步跑".
//
// 为什么量"同步前缀"就够: 主线程阻塞只能由同步代码造成; async 函数在第一个 await 之前的那段就是它的同步贡献,
// 而 `fn()` 返回 promise 的那一刻正是同步前缀结束. 之后的 await 段不阻塞 loop, 不计.
//
// 用法 (index.js 顶部, 在所有 service import 之前):  import { installTickRegistry } from './lib/tick-registry.mjs'; installTickRegistry();
// 关闭: TICK_REGISTRY_OFF=1
import { performance } from 'node:perf_hooks';

const RING_MAX = Number(process.env.TICK_REGISTRY_RING) || 256;
const SYNC_WARN_MS = Number(process.env.TICK_REGISTRY_WARN_MS) || 500;

const _ring = [];                 // {name, startedAt(ms epoch), syncMs, kind}
let _installed = false;
let _origSetInterval = null;

function _push(rec) {
  _ring.push(rec);
  if (_ring.length > RING_MAX) _ring.splice(0, _ring.length - RING_MAX);
}

/** 注册处 file:line (跳过本模块自身帧). */
function _callerSite() {
  const lines = (new Error().stack || '').split('\n').slice(1);
  for (const l of lines) {
    if (l.includes('tick-registry.mjs')) continue;
    const m = l.match(/\((.*):(\d+):(\d+)\)\s*$/) || l.match(/at (.*):(\d+):(\d+)\s*$/);
    if (m) return `${m[1].replace(/\\/g, '/').split('/').slice(-2).join('/')}:${m[2]}`;
  }
  return 'unknown';
}

/** 包一个回调: 量同步前缀. 可手动用 (instrumentTick('name', fn)), 也被 installTickRegistry 自动用. */
export function instrumentTick(name, fn) {
  const wrapped = function (...args) {
    const startedAt = Date.now();
    const t0 = performance.now();
    try {
      return fn.apply(this, args);
    } finally {
      const syncMs = Math.round(performance.now() - t0);
      _push({ name, startedAt, syncMs, kind: 'tick' });
      if (syncMs >= SYNC_WARN_MS) console.warn(`[diag:tick-sync] name=${name} syncMs=${syncMs} at=${new Date(startedAt).toISOString()}`);
    }
  };
  wrapped.__tickName = name;
  return wrapped;
}

/** 从别处(如 sqlite-timing)推记录. */
export function recordSync(name, startedAt, syncMs, kind = 'other') {
  _push({ name, startedAt, syncMs, kind });
}

/** lag 事件回捞: 与 [fromMs, toMs] 有交集的记录, 按 syncMs 降序, 最多 n 条. */
export function culpritsBetween(fromMs, toMs, n = 5) {
  return _ring
    .filter((r) => r.startedAt <= toMs && r.startedAt + r.syncMs >= fromMs)
    .sort((a, b) => b.syncMs - a.syncMs)
    .slice(0, n);
}

export function formatCulprits(list) {
  return '[' + list.map((r) => `${r.kind === 'tick' ? '' : r.kind + ':'}${r.name}:${r.syncMs}`).join(',') + ']';
}

/** monkey-patch globalThis.setInterval: 之后注册的每个 interval 回调自动被 instrumentTick 包住, 名字 = fn.name 或 注册处 file:line. */
export function installTickRegistry() {
  if (_installed) return;
  if (process.env.TICK_REGISTRY_OFF === '1') { console.log('[tick-registry] OFF by env'); return; }
  _origSetInterval = globalThis.setInterval;
  globalThis.setInterval = function (fn, ms, ...rest) {
    if (typeof fn !== 'function') return _origSetInterval.call(globalThis, fn, ms, ...rest);
    const name = (fn.name && fn.name !== 'anonymous') ? fn.name : `interval@${_callerSite()}`;
    return _origSetInterval.call(globalThis, instrumentTick(name, fn), ms, ...rest);
  };
  _installed = true;
  console.log(`[tick-registry] installed (ring=${RING_MAX}, warn>=${SYNC_WARN_MS}ms)`);
}

export function _ringSnapshot() { return _ring.slice(); }   // test-only
export function _resetRing() { _ring.length = 0; }           // test-only
