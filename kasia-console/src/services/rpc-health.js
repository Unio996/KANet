/**
 * RPC Health — 节点自检 + 自动发现 + 缓存
 *
 * 优先级：配置的URL → 本地节点 → Resolver发现 → 外部REST API
 * 缓存：找到可用节点后缓存5分钟，失败后立即重试
 * Scout守卫：isLocalNode() — Scout只在本地节点可用时运行
 *
 * 重要：TCP 可达 ≠ 节点可用。本地节点必须通过 UTXO 查询验证数据完整性，
 * 否则未同步的节点会返回 0 余额导致 Agent 自我瘫痪。
 */
import { getConfig } from '../data/settings/configs.js';
import net from 'net';
import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

// 5/26 根治: env single source, 0 hardcode. C 盘/D 盘同 code 跑两环境, 0 drift.
// fail-fast 暴 surface 错配, 不再 silent fallback mainnet 默认.
const LOCAL_RPC = process.env.KASPA_RPC_URL;
if (!LOCAL_RPC) throw new Error('KASPA_RPC_URL not set — check kanet.env propagation to Console child process');
const LOCAL_PORT = parseInt(new URL(LOCAL_RPC).port);
const LOCAL_NETWORK = process.env.KASPA_NETWORK;
if (!LOCAL_NETWORK) throw new Error('KASPA_NETWORK not set — check kanet.env propagation');
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let _cache = { url: null, isLocal: false, ts: 0 };
// ── G-2 模块级状态/常量（NWT NOTE: 声明集中在文件头, 不放使用点之后）──
const LOCAL_ONLY = process.env.KASPA_RPC_LOCAL_ONLY === '1';   // G2-1: TN12 生产 = 1 ⇒ 不做 Resolver 发现(fail-closed 到 null)
const CACHE_TTL_NONLOCAL = 30 * 1000;                           // G2-4: 非本机结果 30 s
const LOCAL_NEG_CACHE_MS = process.env.KASPA_RPC_LOCAL_NEG_CACHE_MS !== undefined ? Number(process.env.KASPA_RPC_LOCAL_NEG_CACHE_MS) : 10 * 1000;   // 本机数据核失败负缓存(测试可置 0)
const ALL_FAILED_NOTE_MS = 10 * 60 * 1000;                      // "全部失败" warn/events 限频
const DISCOVER_MAX_CANDIDATES = 3;                              // NWT NOTE: 非 LOCAL_ONLY 下 discover 每候选建一个共享实例, 上限 3
let _localNegUntil = 0;
let _notLocalSince = 0;       // ms; 0 = 当前就是本机(或从未离开)
let _notLocalReason = '';     // 离开本机时的原因(SHOULD-3: BACK-TO-LOCAL 行尾 `(was: …)`)
let _lastLocalReason = '';    // checkLocal 最近一次失败原因
let _lastAllFailedAt = 0;
let _localOnlyLogged = false;

/**
 * TCP ping — 检测主机:端口是否可达
 * @returns {Promise<boolean>}
 */
function tcpPing(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

/**
 * 解析 WebSocket URL 为 host:port
 */
function parseWsUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = parseInt(parsed.port) || (parsed.protocol === 'wss:' ? 443 : 80);
    return { host, port };
  } catch {
    return null;
  }
}

// ── G-2 · 数据核（2026-09-07, 设计 docs/2026-09-07-j2-g1-g2-node-trust-gate-and-console-rpc-selfheal-design-v0.1.md v0.2 §4 G2-2 · NWT MUST-4 · Bettor GO）──
//   顺序固定: 网络过滤(G2-1) → 可达(tcpPing) → 数据核(getServerInfo(): networkId === KASPA_NETWORK 实串 ∧ isSynced === true) → 才缓存; 任一失败 ⇒ 不缓存 + REJECT 行。
//   local / configured / discovered 三类同一套核。原 checkLocal 只核 blockCount/headerCount > 0 (IBD 头部相位也过), discovered 只 tcpPing(2026-09-06 22:5x 把
//   wss://…/kaspa/mainnet/… 当可用节点缓存 5 min ⇒ ③ 门读到 mainnet 的 isSynced=true, ledger 967/974)。
//   本机 key 的失败计入 kaspa-rpc-shared 的 healthFail(G2-3: 连续 ≥3 ⇒ REBUILD 实例, 由本函数而非业务路径触发——NWT MUST-4)。
//   REJECT 行限频: 同一 url 60 s 一行(15 个调用方每 tick 都来, 不限会灌屏)。
let _sharedRpcCtorOverride = null;   // 测试注入: getSharedRpc 的 Ctor(同 market-seeder `_testInject*` 惯例); 生产 null
export function _testInjectSharedRpcCtor(Ctor) { _sharedRpcCtorOverride = Ctor; }
const REJECT_LOG_MS = 60_000;
const _rejectLogAt = new Map();      // url -> last REJECT log ms
const DATA_CHECK_TIMEOUT_MS = 3000;
// 限频键 = url|kind: REJECT 与 "local node not synced" 各自 60 s 一行(同 url 两种行互不压制)
function _logRateLimited(key, line) {
  const t = Date.now();
  if (t - (_rejectLogAt.get(key) || 0) >= REJECT_LOG_MS) { _rejectLogAt.set(key, t); console.warn(line); }
}
function _logReject(url, detail) { _logRateLimited(`${url}|reject`, `[rpc-health] REJECT ${url} ${detail}`); }
/**
 * 数据核: 返回 { ok: boolean, reason, networkId, isSynced }。不抛。
 * @param {string} url  已过 tcpPing 的候选
 * @param {boolean} isLocal  本机 key ⇒ 失败计入 healthFail(G2-3 重建触发)
 */
export async function dataCheck(url, isLocal) {
  const { getSharedRpc, noteSharedRpcError, noteSharedRpcHealthFailure, noteSharedRpcHealthOk } = await import('../lib/kaspa-rpc-shared.mjs');
  let rpc = null;
  try {
    rpc = await getSharedRpc({ url, networkId: LOCAL_NETWORK }, _sharedRpcCtorOverride ? { Ctor: _sharedRpcCtorOverride } : {});
    let info;
    try {
      info = await Promise.race([rpc.getServerInfo(), new Promise((_, rej) => setTimeout(() => rej(new Error('data check timeout')), DATA_CHECK_TIMEOUT_MS))]);
    } catch (e) {
      // 本机 key: 只走 health 计数(它自己会 disconnect 断连类); 非本机 key: 走业务分类(同实例重连)。同一错误不双计。
      if (!isLocal) await noteSharedRpcError(rpc, e);
      throw e;
    }
    const networkId = info?.networkId, isSynced = info?.isSynced;
    if (networkId !== LOCAL_NETWORK) {
      _logReject(url, `networkId=${networkId === undefined ? 'undefined' : String(networkId)} expected=${LOCAL_NETWORK} isSynced=${String(isSynced)}`);
      if (isLocal) noteSharedRpcHealthFailure({ url, networkId: LOCAL_NETWORK }, new Error('network-mismatch'));
      return { ok: false, reason: 'network-mismatch', networkId, isSynced };
    }
    if (isSynced !== true) {
      // SHOULD-2(NWT): 本机"活着但未同步"不是 REJECT(监控按 REJECT grep 会把 D-c 每轮追平窗误判成坏节点), 用自己的短语
      if (isLocal) _logRateLimited(`${url}|notsynced`, `[rpc-health] local node not synced (networkId=${networkId} isSynced=${String(isSynced)})`);
      else _logReject(url, `networkId=${networkId} expected=${LOCAL_NETWORK} isSynced=${String(isSynced)}`);
      if (isLocal) noteSharedRpcHealthOk({ url, networkId: LOCAL_NETWORK });   // 节点活着只是没同步 ⇒ 不是连接故障, 归零
      return { ok: false, reason: 'not-synced', networkId, isSynced };
    }
    if (isLocal) noteSharedRpcHealthOk({ url, networkId: LOCAL_NETWORK });
    return { ok: true, reason: 'ok', networkId, isSynced };
  } catch (err) {
    const r = isLocal ? noteSharedRpcHealthFailure({ url, networkId: LOCAL_NETWORK }, err) : 'n/a';
    console.warn(`[rpc-health] ${isLocal ? 'local node TCP ok but data check failed' : 'data check failed'}: ${err.message}${r === 'rebuild' ? ' (shared client REBUILT)' : ''}`);
    return { ok: false, reason: `rpc-fail: ${err.message}`, networkId: undefined, isSynced: undefined };
  }
}

/**
 * 检测本地 Kaspa 节点是否可达且数据已同步（G-2: 可达 → 数据核 networkId ∧ isSynced）。
 */
async function checkLocal() {
  if (!await tcpPing('127.0.0.1', LOCAL_PORT, 2000)) { _lastLocalReason = 'tcp-unreachable'; return false; }
  const d = await dataCheck(LOCAL_RPC, true);
  _lastLocalReason = d.ok ? '' : String(d.reason).split(':')[0];   // rpc-fail / not-synced / network-mismatch
  return d.ok;
}

/**
 * 检测配置的 RPC URL 是否可达且数据核通过（G-2）
 */
async function checkConfigured() {
  const url = await getConfig('rpc_url');
  if (!url) return null;
  const parsed = parseWsUrl(url);
  if (!parsed) return null;
  const ok = await tcpPing(parsed.host, parsed.port, 3000);
  if (!ok) return null;
  return (await dataCheck(url, false)).ok ? url : null;
}

/**
 * 通过 Kaspa Resolver 发现可用节点（轻量版，不 fork 子进程）
 */
async function discoverNode() {
  if (LOCAL_ONLY) {
    if (!_localOnlyLogged) { _localOnlyLogged = true; console.log('[rpc-health] discovery disabled (KASPA_RPC_LOCAL_ONLY=1): no public fallback, fail-closed'); }
    return null;
  }
  try {
    const kaspa = await import('kaspa-wasm');
    const Resolver = kaspa.Resolver || null;
    const { Encoding } = kaspa;
    if (!Resolver) return null;  // npm ^0.13.0 removed Resolver
    // 并发3次 resolve，取最快的。G-2 G2-1: 按 KASPA_NETWORK 传参(原硬编码 'mainnet' ⇒ 2026-09-06 22:5x 把 mainnet 端点当 testnet-12 节点缓存)。
    const promises = Array.from({ length: 3 }, () =>
      Promise.race([
        new Resolver().getUrl(Encoding.Borsh, LOCAL_NETWORK),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]).catch(() => null)
    );
    const urls = (await Promise.all(promises)).filter(Boolean);
    if (urls.length === 0) return null;

    // 取第一个可达【且数据核通过】的(G2-2: networkId ∧ isSynced); 候选上限 DISCOVER_MAX_CANDIDATES(每候选会建一个共享实例, NWT NOTE)
    for (const url of [...new Set(urls)].slice(0, DISCOVER_MAX_CANDIDATES)) {
      const parsed = parseWsUrl(url);
      if (parsed && await tcpPing(parsed.host, parsed.port, 3000) && (await dataCheck(url, false)).ok) {
        return url;
      }
    }
    return null;
  } catch (err) {
    console.error('[rpc-health] discover failed:', err.message);
    return null;
  }
}

/**
 * 获取可用的 RPC URL（带缓存）
 *
 * 优先级：
 * 1. 本地节点 127.0.0.1:17110
 * 2. 配置的 URL（DB 里的 rpc_url）
 * 3. Resolver 发现
 * 4. null（调用方自行 fallback 到 REST API）
 *
 * @returns {Promise<{url: string|null, isLocal: boolean}>}
 */
// G-2 G2-4/G2-7: 非本机结果 TTL 30 s(本机回来后不再被 5 min 缓存拖住); 本机数据核失败的负缓存 10 s(15 个调用方每 tick 都来, 免每次 tcpPing+RPC);
//   从"非本机/无节点"切回本机时打一行 `[rpc-health] BACK-TO-LOCAL after <s>s (was: <reason>)`(runbook ⑤-①b 的撤销判据看 was=rpc-fail 的那条;
//   SHOULD-3: was=not-synced 是 D-c 追平窗的正常来回, 不算)。常量/状态声明在文件头。
export async function getWorkingRpc() {
  // 缓存有效？
  if (_cache.url && (Date.now() - _cache.ts) < (_cache.isLocal ? CACHE_TTL : CACHE_TTL_NONLOCAL)) {
    return { url: _cache.url, isLocal: _cache.isLocal };
  }

  // 1. 本地节点优先 (= env 驱动 LOCAL_RPC)
  // 5/26 根治: 删除 silent setConfig 自动写 DB — env 是 source of truth, DB 不该 silent drift.
  const localOk = Date.now() < _localNegUntil ? false : await checkLocal();
  if (localOk) {
    _cache = { url: LOCAL_RPC, isLocal: true, ts: Date.now() };
    if (_notLocalSince) { console.log(`[rpc-health] BACK-TO-LOCAL after ${Math.round((Date.now() - _notLocalSince) / 1000)}s (was: ${_notLocalReason || 'unknown'})`); _notLocalSince = 0; _notLocalReason = ''; }
    console.log('[rpc-health] using local node:', LOCAL_RPC);
    return { url: LOCAL_RPC, isLocal: true };
  }
  if (Date.now() >= _localNegUntil) _localNegUntil = Date.now() + LOCAL_NEG_CACHE_MS;
  if (!_notLocalSince) { _notLocalSince = Date.now(); _notLocalReason = _lastLocalReason || 'unknown'; }

  // 2. 配置的 URL
  const configured = await checkConfigured();
  if (configured) {
    // 局域网节点（私有 IP）视同本地节点 — Scout 可用全量 RPC 模式
    const isLan = /^wss?:\/\/(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|localhost|127\.)/.test(configured);
    _cache = { url: configured, isLocal: isLan, ts: Date.now() };
    console.log(`[rpc-health] using configured node: ${configured}${isLan ? ' (LAN — treated as local)' : ''}`);
    return { url: configured, isLocal: isLan };
  }

  // 3. Resolver 发现
  // 5/26 根治: 删除 silent setConfig 自动写 DB — env 是 source of truth.
  console.log('[rpc-health] local + configured unreachable, discovering...');
  const discovered = await discoverNode();
  if (discovered) {
    _cache = { url: discovered, isLocal: false, ts: Date.now() };
    console.log('[rpc-health] discovered node:', discovered);
    return { url: discovered, isLocal: false };
  }

  // 全部失败
  _cache = { url: null, isLocal: false, ts: 0 }; // 不缓存失败
  // 2026-07-21(Bettor #utf9ze①, KANet-UI): 单纯留痕原始失败信号, 不在这里做计数/告警判断
  // (阈值/去重/播频道逻辑在 rpc-health-observability-monitor.mjs 里, 同 K-18 gate 写事件 vs
  // coherence-observability-monitor 判断分层的既有约定, 这里出错也不能影响调用方拿到的返回值)。
  // G-2: "本机未同步"在 D-c 下是每 ≈9 min 一次、每次 ≈4 min 的常态(不再是罕见的全不可达), 15 个调用方每 tick 都会落到这里 ⇒
  //   warn 行与 events 行都限频 10 min 一次(events 表刚在 P2-6 治过 LIKE 全扫, 不能再灌)。
  const _nowMs = Date.now();
  if (_nowMs - _lastAllFailedAt >= ALL_FAILED_NOTE_MS) {
    _lastAllFailedAt = _nowMs;
    console.warn('[rpc-health] no RPC node available (local data check failed or not synced; configured/discovery none) — next note in 10 min');
    try {
      sqlite.prepare(`
        INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
        VALUES (?, 'system', 'rpc_health_check_failed', 'rpc-health', 'warn', 'getWorkingRpc() 全部候选(local/configured/discover)均不可用(G-2 后含本机未同步; 10 min 限频)', '{}', datetime('now'))
      `).run(randomUUID());
    } catch (e) {
      console.warn(`[rpc-health] event write failed (non-fatal): ${e.message}`);
    }
  }
  return { url: null, isLocal: false };
}

/**
 * 本地节点是否可用？Scout 启动守卫用。
 */
export async function isLocalNode() {
  const { isLocal } = await getWorkingRpc();
  return isLocal;
}

/**
 * 清除缓存（节点切换时调用）
 */
export function invalidateCache() {
  _cache = { url: null, isLocal: false, ts: 0 };
  _localNegUntil = 0;   // G-2: 负缓存一并清
}
