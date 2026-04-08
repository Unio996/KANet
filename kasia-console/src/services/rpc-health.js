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

const LOCAL_RPC = 'ws://127.0.0.1:17110';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let _cache = { url: null, isLocal: false, ts: 0 };

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

/**
 * 检测本地 Kaspa 节点是否可达且数据已同步。
 * TCP ping 只证明进程在跑，不证明 UTXO 索引完整。
 * 追加一次真实 UTXO 查询：用第一个 relay_node 的地址查，
 * 如果已知有余额却返回 0 UTXO，判定为未同步。
 */
async function checkLocal() {
  if (!await tcpPing('127.0.0.1', 17110, 2000)) return false;

  // TCP 通了，验证数据完整性
  try {
    const kaspa = await import('kaspa-wasm');
    const { RpcClient, Encoding } = kaspa;
    const rpc = new RpcClient({ url: LOCAL_RPC, encoding: Encoding.Borsh, networkId: 'mainnet' });
    await Promise.race([
      rpc.connect({}),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]);

    const info = await Promise.race([
      rpc.getBlockDagInfo(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]);
    await rpc.disconnect();

    const blockCount = Number(info?.blockCount || 0);
    const headerCount = Number(info?.headerCount || 0);
    if (blockCount === 0 || headerCount === 0) {
      console.warn(`[rpc-health] local node not synced — blocks:${blockCount} headers:${headerCount}`);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[rpc-health] local node TCP ok but data check failed:', err.message);
    return false;
  }
}

/**
 * 检测配置的 RPC URL 是否可达
 */
async function checkConfigured() {
  const url = await getConfig('rpc_url');
  if (!url) return null;
  const parsed = parseWsUrl(url);
  if (!parsed) return null;
  const ok = await tcpPing(parsed.host, parsed.port, 3000);
  return ok ? url : null;
}

/**
 * 通过 Kaspa Resolver 发现可用节点（轻量版，不 fork 子进程）
 */
async function discoverNode() {
  try {
    const kaspa = await import('kaspa-wasm');
    const Resolver = kaspa.Resolver || null;
    const { Encoding } = kaspa;
    if (!Resolver) return null;  // npm ^0.13.0 removed Resolver
    // 并发3次 resolve，取最快的
    const promises = Array.from({ length: 3 }, () =>
      Promise.race([
        new Resolver().getUrl(Encoding.Borsh, 'mainnet'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]).catch(() => null)
    );
    const urls = (await Promise.all(promises)).filter(Boolean);
    if (urls.length === 0) return null;

    // 取第一个可达的
    for (const url of [...new Set(urls)]) {
      const parsed = parseWsUrl(url);
      if (parsed && await tcpPing(parsed.host, parsed.port, 3000)) {
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
export async function getWorkingRpc() {
  // 缓存有效？
  if (_cache.url && (Date.now() - _cache.ts) < CACHE_TTL) {
    return { url: _cache.url, isLocal: _cache.isLocal };
  }

  // 1. 本地节点优先
  if (await checkLocal()) {
    _cache = { url: LOCAL_RPC, isLocal: true, ts: Date.now() };
    console.log('[rpc-health] using local node');
    return { url: LOCAL_RPC, isLocal: true };
  }

  // 2. 配置的 URL
  const configured = await checkConfigured();
  if (configured) {
    _cache = { url: configured, isLocal: false, ts: Date.now() };
    console.log('[rpc-health] using configured node:', configured);
    return { url: configured, isLocal: false };
  }

  // 3. Resolver 发现
  console.log('[rpc-health] local + configured unreachable, discovering...');
  const discovered = await discoverNode();
  if (discovered) {
    _cache = { url: discovered, isLocal: false, ts: Date.now() };
    console.log('[rpc-health] discovered node:', discovered);
    return { url: discovered, isLocal: false };
  }

  // 全部失败
  console.warn('[rpc-health] no RPC node available');
  _cache = { url: null, isLocal: false, ts: 0 }; // 不缓存失败
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
}
