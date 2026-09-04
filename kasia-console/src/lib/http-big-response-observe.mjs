// http-big-response-observe.mjs — M10 observe-only (2026-09-04, docs/2026-09-04-bettor-console-stall-mitigation-design-v0.2.md §3 H3):
// 记 >阈值 的 HTTP 响应(路由 + 方法 + 字节 + 状态 + 耗时), 判"每 30s 244/186MB 交替出站脉冲"是不是 HTTP 响应、走哪条路由.
// v2 (2026-09-05, Bettor 批 ③ / NWT 条件): 行尾加 ip= ua= q=(调用方归属, 首窗 H3 只知路由不知谁调); 新增第二档
//   `http.slow`: 任何路由 onRequest→onSend 耗时 > slowMs(默认 500) 打一行(体积阈下也打), 让 122s 级停顿若发生在
//   HTTP handler/序列化里能显形。同一响应既 big 又 slow 只打 big 一行(big 行已含 ms)。
// 仓内首个全局响应路钩子, 纪律(NWT 审 v0.1 + C1):
//   - try/catch 全包: 钩子体、日志调用、sizeOf 任何一处抛出都吞掉, 响应不受影响;
//   - 只读 payload 长度(string / Buffer); stream / null / 其它类型 ⇒ 跳过(sizeOf 返回 null; slow 档仍可打, bytes=-);
//   - 永远原样返回 payload(fastify onSend 契约: 返回值即发出的 payload);
//   - 零状态、零 DB、不改 headers/status; ip/ua/q 只读 request 字段, 去空白截短, 不解码不落库。
// 行格式(可 grep, 与 [diag:tick-duration] / [diag:step] 同族; 新字段一律在 ms= 之后 at= 之前, 旧 readout 正则 `( \S+=\S+)*` 兼容):
//   [diag:step] http.onSend.big route=<url> method=<M> bytes=<n> status=<s> ms=<t> ip=<ip> ua=<ua40> q=<query48> at=<ISO>
//   [diag:step] http.slow route=<url> method=<M> bytes=<n|-> status=<s> ms=<t> ip=<ip> ua=<ua40> q=<query48> at=<ISO>

export const DEFAULT_THRESHOLD_BYTES = 1024 * 1024;
export const DEFAULT_SLOW_MS = 500;
const T0 = Symbol('m10.onRequest.t0');

export function defaultSizeOf(payload) {
  if (typeof payload === 'string') return Buffer.byteLength(payload);
  if (Buffer.isBuffer(payload)) return payload.length;
  return null;   // stream / null / undefined / 其它 ⇒ 跳过
}

// 去空白 + 截短, 保证一个字段就是一个 \S+ token(grep 契约); 空 ⇒ '-'
function _tok(v, max) {
  try {
    const s = String(v ?? '').replace(/\s+/g, '_').slice(0, max);
    return s || '-';
  } catch { return '-'; }
}

export function requestFields(request) {
  let ip = '-', ua = '-', q = '-';
  try { ip = _tok(request?.ip, 45); } catch { /* observe-only */ }
  try { ua = _tok(request?.headers?.['user-agent'], 40); } catch { /* observe-only */ }
  try {
    const url = request?.url;
    const i = typeof url === 'string' ? url.indexOf('?') : -1;
    q = i >= 0 ? _tok(url.slice(i + 1), 48) : '-';
  } catch { /* observe-only */ }
  return { ip, ua, q };
}

export function makeRequestT0Marker() {
  return async function onRequestT0(request) {
    try { request[T0] = Date.now(); } catch { /* observe-only */ }
  };
}

export function makeBigResponseObserver({ thresholdBytes = DEFAULT_THRESHOLD_BYTES, slowMs = DEFAULT_SLOW_MS, log = console.log, sizeOf = defaultSizeOf } = {}) {
  return async function onSendBigResponseObserve(request, reply, payload) {
    try {
      const n = sizeOf(payload);
      const t0 = request && request[T0] != null ? request[T0] : null;
      const ms = t0 != null ? Date.now() - t0 : null;
      const big = n != null && n > thresholdBytes;
      const slow = ms != null && ms > slowMs;
      if (big || slow) {
        const route = (request && (request.routeOptions?.url || request.url)) || '?';
        const method = (request && request.method) || '?';
        const status = (reply && reply.statusCode) || '?';
        const { ip, ua, q } = requestFields(request);
        const site = big ? 'http.onSend.big' : 'http.slow';
        log(`[diag:step] ${site} route=${route} method=${method} bytes=${n != null ? n : '-'} status=${status}${ms != null ? ` ms=${ms}` : ''} ip=${ip} ua=${ua} q=${q} at=${new Date().toISOString()}`);
      }
    } catch { /* observe-only: 吞掉, 响应不受影响 */ }
    return payload;   // 永远原样
  };
}

export function installBigResponseObserve(fastify, opts) {
  fastify.addHook('onRequest', makeRequestT0Marker());
  fastify.addHook('onSend', makeBigResponseObserver(opts));
}
