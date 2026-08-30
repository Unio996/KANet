// kaspa-rpc-shared.mjs — console 进程内共享 kaspa-wasm RpcClient（2026-08-30 J2, Bettor 批设计层·NWT 方向 GREEN,
// docs/2026-08-30-j2-kaspa-rpc-client-singleton-design-v0.1.md）。
//
// 为什么: kaspa-wasm 1.1.0 `new RpcClient()` 每实例永久占 wasm 线性内存 ~11–18 KB, `disconnect()`/`free()`/GC 都收不回
// (隔离四臂实测, docs/provenance/2026-08-30-console-wasm-growth/wasm_rpcclient_free.mjs); console 23 处"每调一次 new"⇒
// wasm 只增不减、4 GiB 撞顶毒化(8/30 04:27Z 实录)。本模块 = 按 {url, networkId} 键一个实例, 懒建懒连, 出错同实例重连
// (实测 disconnect 后同实例 connect({}) 可用), 永不 per-call 构造/断连。并发安全: 同一 client 50 路并发 ok=50 响应有序(rpc_concurrency.mjs)。
//
// 用法(站点): const rpc = await getSharedRpc({ url, networkId }); ... 调用 ... 不要 disconnect。
//   出错时(可选): noteSharedRpcError(rpc, err) —— 只对"连接断了"类做 disconnect, 下次 getSharedRpc 同实例重连; 业务错不碰连接。
// 依赖注入: getSharedRpc({url, networkId}, { Ctor }) 第二参可给构造器(默认 kaspa-wasm RpcClient); 只在该 key 首次建实例时生效——
// 用例用假构造器计构造次数、用唯一 url 隔离各段(不提供 reset: 生产模块不放 *ForTests 符号, lint R-TESTONLY-EXPORT-IN-PROD)。
//
// 故障域(设计稿 §6): 共享连接一断 ⇒ 所有站点同时报 not-connected ⇒ 模块统一重连(≤5 s 一轮); 批 1 站点全是 cron/探针/只读展示, 可容忍;
// 钱路站点(批 2)每站点须核自己的 timeout/retry 能吸收这一轮。wasm 毒化(RuntimeError/oob)无法进程内修 ⇒ 只打点, 交 supervisor GAP-1。
const _pool = new Map();             // key -> { rpc, url, networkId, connecting, errCount, builtAt }
const CONNECT_TIMEOUT_MS = Number(process.env.KASPA_RPC_SHARED_CONNECT_TIMEOUT_MS) || 5000;
const NOT_CONNECTED_RE = /WebSocket is not connected|not connected|connect timeout|ECONNREFUSED|ECONNRESET/i;
const POISON_RE = /RuntimeError|unreachable executed|memory access out of bounds|outside the bounds of the DataView|could not allocate/i;
let _poisonLogged = false;

const _withTimeout = (p, ms, tag) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${tag} timeout ${ms}ms`)), ms))]);
const _key = (url, networkId) => `${url}|${networkId}`;

export async function getSharedRpc({ url, networkId }, { Ctor: CtorInjected = null } = {}) {
  if (!url) throw new Error('getSharedRpc: url required');
  if (!networkId) throw new Error('getSharedRpc: networkId required');
  const key = _key(url, networkId);
  let e = _pool.get(key);
  if (!e) {
    let Ctor = CtorInjected, Encoding = null;
    if (!Ctor) { const kaspa = await import('kaspa-wasm'); Ctor = kaspa.RpcClient; Encoding = kaspa.Encoding; }
    const rpc = new Ctor({ url, encoding: Encoding ? Encoding.Borsh : 'borsh', networkId });
    e = { rpc, url, networkId, connecting: null, errCount: 0, builtAt: Date.now() };
    _pool.set(key, e);
    console.log(`[rpc-shared] build ${key} (pool size ${_pool.size}) — one instance per key, never per-call`);
  }
  if (!e.rpc.isConnected) {
    if (!e.connecting) {
      e.connecting = _withTimeout(e.rpc.connect({}), CONNECT_TIMEOUT_MS, 'rpc-shared connect').finally(() => { e.connecting = null; });
    }
    await e.connecting;   // 并发首调共享同一 connecting Promise
  }
  return e.rpc;
}

// 错误分类(设计稿 §3): 只有"连接断了"类才动连接(同实例 disconnect, 下次 getSharedRpc 重连); 业务错/调用方超时不碰; wasm 毒化只打点。
export async function noteSharedRpcError(rpc, err) {
  const msg = String(err?.message || err || '');
  const e = [..._pool.values()].find(x => x.rpc === rpc);
  if (POISON_RE.test(msg)) {
    if (!_poisonLogged) { _poisonLogged = true; console.error(`[rpc-shared] POISON: wasm runtime error on shared client — cannot rebuild wasm in-process, supervisor GAP-1 owns the restart: ${msg.slice(0, 160)}`); }
    return 'poison';
  }
  if (NOT_CONNECTED_RE.test(msg)) {
    if (e) {
      e.errCount++;
      try { await e.rpc.disconnect(); } catch { /* idempotent */ }
      if (e.errCount >= 3) console.warn(`[rpc-shared] LOUD: ${_key(e.url, e.networkId)} not-connected ${e.errCount}x in a row — will reconnect same instance on next use`);
    }
    return 'reconnect';
  }
  return 'business';
}

export function sharedRpcStats() {
  return [..._pool.entries()].map(([key, e]) => ({ key, connected: !!e.rpc.isConnected, errCount: e.errCount, builtAt: e.builtAt }));
}
