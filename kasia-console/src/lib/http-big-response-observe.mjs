// http-big-response-observe.mjs — M10 observe-only (2026-09-04, docs/2026-09-04-bettor-console-stall-mitigation-design-v0.2.md §3 H3):
// 记 >阈值 的 HTTP 响应(路由 + 方法 + 字节 + 状态 + 耗时), 判"每 30s 244/186MB 交替出站脉冲"是不是 HTTP 响应、走哪条路由.
// 仓内首个全局响应路钩子, 纪律(NWT 审 v0.1 + C1):
//   - try/catch 全包: 钩子体、日志调用、sizeOf 任何一处抛出都吞掉, 响应不受影响;
//   - 只读 payload 长度(string / Buffer); stream / null / 其它类型 ⇒ 跳过(sizeOf 返回 null);
//   - 永远原样返回 payload(fastify onSend 契约: 返回值即发出的 payload);
//   - 零状态、零 DB、不改 headers/status.
// 行格式(可 grep, 与 [diag:tick-duration] / [diag:step] 同族):
//   [diag:step] http.onSend.big route=<url> method=<M> bytes=<n> status=<s> ms=<t> at=<ISO>

export const DEFAULT_THRESHOLD_BYTES = 1024 * 1024;
const T0 = Symbol('m10.onRequest.t0');

export function defaultSizeOf(payload) {
  if (typeof payload === 'string') return Buffer.byteLength(payload);
  if (Buffer.isBuffer(payload)) return payload.length;
  return null;   // stream / null / undefined / 其它 ⇒ 跳过
}

export function makeRequestT0Marker() {
  return async function onRequestT0(request) {
    try { request[T0] = Date.now(); } catch { /* observe-only */ }
  };
}

export function makeBigResponseObserver({ thresholdBytes = DEFAULT_THRESHOLD_BYTES, log = console.log, sizeOf = defaultSizeOf } = {}) {
  return async function onSendBigResponseObserve(request, reply, payload) {
    try {
      const n = sizeOf(payload);
      if (n != null && n > thresholdBytes) {
        const t0 = request && request[T0] != null ? request[T0] : null;
        const route = (request && (request.routeOptions?.url || request.url)) || '?';
        const method = (request && request.method) || '?';
        const status = (reply && reply.statusCode) || '?';
        log(`[diag:step] http.onSend.big route=${route} method=${method} bytes=${n} status=${status}${t0 != null ? ` ms=${Date.now() - t0}` : ''} at=${new Date().toISOString()}`);
      }
    } catch { /* observe-only: 吞掉, 响应不受影响 */ }
    return payload;   // 永远原样
  };
}

export function installBigResponseObserve(fastify, opts) {
  fastify.addHook('onRequest', makeRequestT0Marker());
  fastify.addHook('onSend', makeBigResponseObserver(opts));
}
