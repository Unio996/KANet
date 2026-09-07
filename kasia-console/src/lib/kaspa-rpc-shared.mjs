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
//   G-2(2026-09-07): 注入的 Ctor 按 key 记住, REBUILD 后同 key 继续用同一 Ctor(用例要能数到第 2 个实例)。
//
// 故障域(设计稿 §6): 共享连接一断 ⇒ 所有站点同时报 not-connected ⇒ 模块统一重连(≤5 s 一轮); 批 1 站点全是 cron/探针/只读展示, 可容忍;
// 钱路站点(批 2)每站点须核自己的 timeout/retry 能吸收这一轮。wasm 毒化(RuntimeError/oob)无法进程内修 ⇒ 只打点, 交 supervisor GAP-1。
//
// ── G-2 · 本机实例重建（2026-09-07, 设计 docs/2026-09-07-j2-g1-g2-node-trust-gate-and-console-rpc-selfheal-design-v0.1.md v0.2 §4 G2-3 · NWT MUST-4 · Bettor GO）──
//   事实: kaspad 22:55Z / 23:11Z / 03:00Z / 06:20Z 四次重启后, 本机 key 的实例"同实例 disconnect → connect"再没连回来
//   (`local node TCP ok but data check failed: rpc-shared connect timeout 5000ms` ×N), 唯一修复是 console 重启(23:46Z/03:02Z/06:21Z 三次实证)。
//   修法: 对【本机 key】(url 主机 127.0.0.1/localhost/::1) 连续失败 ≥ REBUILD_AFTER 次 ⇒ 丢弃实例、下次 getSharedRpc 新建(接受一次 ~11–18 KB wasm 线性内存代价)。
//   🔴 触发点必须含 rpc-health 自己的数据核失败路径(NWT MUST-4): 故障形状是 rpc-health.checkLocal 一直超时而业务不再碰本机 key ⇒
//      若只在业务侧 noteSharedRpcError 计数, errCount 不涨、永不重建。所以两路同一函数: noteSharedRpcError(业务) 与 noteSharedRpcHealthFailure(rpc-health)。
//   限频 REBUILD_MIN_INTERVAL_MS(默认 60 s/key) + 进程累计硬上限 NODE_TRUST_REBUILD_MAX(默认 1,440 = 60 s 限频下一天上界 ≈ 26 MB;
//   30 天 ≈ 0.8 GB 进 4 GiB 顶不可接受 ⇒ 超限后不再重建, LOUD 一次交 supervisor GAP-1)。
//   非本机 key 不重建(公网端点本来就在 G2-1 后不再出现)。
const _pool = new Map();             // key -> { rpc, url, networkId, connecting, errCount, healthFail, builtAt, rebuilds, lastRebuildAt }
const _ctors = new Map();            // key -> injected Ctor (tests), survives REBUILD
const CONNECT_TIMEOUT_MS = Number(process.env.KASPA_RPC_SHARED_CONNECT_TIMEOUT_MS) || 5000;
const NOT_CONNECTED_RE = /WebSocket is not connected|not connected|connect timeout|ECONNREFUSED|ECONNRESET/i;   // 通用 'timeout'(调用方超时)仍是 business(既有 M4 用例)
const POISON_RE = /RuntimeError|unreachable executed|memory access out of bounds|outside the bounds of the DataView|could not allocate/i;
let _poisonLogged = false;

const REBUILD_AFTER = Number(process.env.NODE_TRUST_REBUILD_AFTER) || 3;
const REBUILD_MIN_INTERVAL_MS = process.env.NODE_TRUST_REBUILD_MIN_INTERVAL_MS !== undefined ? Number(process.env.NODE_TRUST_REBUILD_MIN_INTERVAL_MS) : 60_000;
const REBUILD_MAX = process.env.NODE_TRUST_REBUILD_MAX !== undefined ? Number(process.env.NODE_TRUST_REBUILD_MAX) : 1440;
let _totalRebuilds = 0;
let _capLogged = false;

const _withTimeout = (p, ms, tag) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${tag} timeout ${ms}ms`)), ms))]);
const _key = (url, networkId) => `${url}|${networkId}`;
export function isLocalRpcUrl(url) {
  try { const h = new URL(String(url)).hostname; return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]'; } catch { return false; }
}

export async function getSharedRpc({ url, networkId }, { Ctor: CtorInjected = null } = {}) {
  if (!url) throw new Error('getSharedRpc: url required');
  if (!networkId) throw new Error('getSharedRpc: networkId required');
  const key = _key(url, networkId);
  if (CtorInjected) _ctors.set(key, CtorInjected);
  let e = _pool.get(key);
  if (!e) {
    let Ctor = _ctors.get(key) || null, Encoding = null;
    if (!Ctor) { const kaspa = await import('kaspa-wasm'); Ctor = kaspa.RpcClient; Encoding = kaspa.Encoding; }
    const rpc = new Ctor({ url, encoding: Encoding ? Encoding.Borsh : 'borsh', networkId });
    e = { rpc, url, networkId, connecting: null, errCount: 0, healthFail: 0, builtAt: Date.now(), rebuilds: 0, lastRebuildAt: 0 };
    const prev = _rebuildMeta.get(key);
    if (prev) { e.rebuilds = prev.rebuilds; e.lastRebuildAt = prev.lastRebuildAt; }
    _pool.set(key, e);
    console.log(`[rpc-shared] build ${key} (pool size ${_pool.size}) — one instance per key, never per-call${e.rebuilds ? ` (rebuild #${e.rebuilds})` : ''}`);
  }
  if (!e.rpc.isConnected) {
    if (!e.connecting) {
      e.connecting = _withTimeout(e.rpc.connect({}), CONNECT_TIMEOUT_MS, 'rpc-shared connect').finally(() => { e.connecting = null; });
    }
    await e.connecting;   // 并发首调共享同一 connecting Promise
  }
  return e.rpc;
}

const _rebuildMeta = new Map();      // key -> { rebuilds, lastRebuildAt } (survives _pool.delete)

// G-2: 丢弃本机 key 的实例。返回 'rebuilt' | 'rate-limited' | 'capped' | 'not-local' | 'absent'。
function _rebuild(e, source, reason) {
  const key = _key(e.url, e.networkId);
  if (!isLocalRpcUrl(e.url)) return 'not-local';
  const now = Date.now();
  if (e.lastRebuildAt && now - e.lastRebuildAt < REBUILD_MIN_INTERVAL_MS) return 'rate-limited';
  if (_totalRebuilds >= REBUILD_MAX) {
    if (!_capLogged) { _capLogged = true; console.error(`[rpc-shared] REBUILD CAP reached (${REBUILD_MAX}) — no more rebuilds this process, supervisor GAP-1 owns the restart (last key ${key}, source=${source})`); }
    return 'capped';
  }
  try { e.rpc.disconnect?.(); } catch { /* idempotent */ }
  _pool.delete(key);
  _totalRebuilds++;
  const meta = { rebuilds: (e.rebuilds || 0) + 1, lastRebuildAt: now };
  _rebuildMeta.set(key, meta);
  console.warn(`[rpc-shared] REBUILD ${key} after ${e.healthFail + e.errCount} failures (source=${source}, reason=${String(reason || '').slice(0, 80)}) rebuilds=${meta.rebuilds} total=${_totalRebuilds}/${REBUILD_MAX}`);
  return 'rebuilt';
}

// 错误分类(设计稿 §3): 只有"连接断了"类才动连接(同实例 disconnect, 下次 getSharedRpc 重连); 业务错/调用方超时不碰; wasm 毒化只打点。
// G-2: 本机 key 连续 not-connected ≥ REBUILD_AFTER ⇒ 丢弃实例(返回 'rebuild')。
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
      if (e.errCount + e.healthFail >= REBUILD_AFTER && _rebuild(e, 'business', msg) === 'rebuilt') return 'rebuild';
    }
    return 'reconnect';
  }
  return 'business';
}

// G-2 (NWT MUST-4): rpc-health 数据核失败 —— 与业务路径同一台阶(healthFail + errCount ≥ REBUILD_AFTER ⇒ 重建)。
// 返回 'rebuild' | 'noted' | 'unknown-key'。成功时调 noteSharedRpcHealthOk 归零。
export function noteSharedRpcHealthFailure({ url, networkId }, err) {
  const e = _pool.get(_key(url, networkId));
  if (!e) return 'unknown-key';
  e.healthFail++;
  // 数据核超时/断连也让同实例先断开(与业务路径同形: 下次 getSharedRpc 同实例重连), 但【只计 healthFail 一次】——
  // 调用方不要再对同一错误调 noteSharedRpcError, 否则一次失败计两次、重建提前(rpc-health-datacheck.test H4 钉)。
  const msg = String(err?.message || err || '');
  if (NOT_CONNECTED_RE.test(msg) || /timeout/i.test(msg)) { try { e.rpc.disconnect?.(); } catch { /* idempotent */ } }
  if (e.healthFail + e.errCount >= REBUILD_AFTER && _rebuild(e, 'rpc-health', msg) === 'rebuilt') return 'rebuild';
  return 'noted';
}
export function noteSharedRpcHealthOk({ url, networkId }) {
  const e = _pool.get(_key(url, networkId));
  if (e) { e.healthFail = 0; e.errCount = 0; }
}

// 形状不变(数组, 既有消费者 kaspa-rpc-shared.test.mjs:43 `.filter`), 每项多 healthFail/rebuilds/lastRebuildAt。
export function sharedRpcStats() {
  return [..._pool.entries()].map(([key, e]) => ({ key, connected: !!e.rpc.isConnected, errCount: e.errCount, healthFail: e.healthFail, builtAt: e.builtAt, rebuilds: e.rebuilds, lastRebuildAt: e.lastRebuildAt }));
}
// G-2: 进程级重建计数(设计 §7 Q5: 硬上限要可见)。
export function sharedRpcRebuildStats() {
  return { totalRebuilds: _totalRebuilds, rebuildMax: REBUILD_MAX, rebuildAfter: REBUILD_AFTER, minIntervalMs: REBUILD_MIN_INTERVAL_MS, capped: _totalRebuilds >= REBUILD_MAX };
}
