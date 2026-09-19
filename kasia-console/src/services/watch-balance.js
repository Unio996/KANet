/**
 * watch-balance.js — D-028 只读(冷存)账户的余额读取。设计 docs/2026-09-20-kanetui-d028-watch-only-accounts-design-v0.2.md §2.2。
 *
 * 零副作用: 不写库、不发交易、不起 relay。它【不复用】api/relay.js 的 getKasBalance——后者空/未同步时静默返回 0 且无条件回落公网 REST。
 * 本模块的铁律(NWT 设计审 60420ed4 / a74c7a6a):
 *   · 读不到 / 未同步 / 对照失败 ⇒ status='unavailable',balanceKas=null——【绝不】把它当 0 显示(IBD 期链读返回合法空值,
 *     渲染成 0 = "冷存余额清零"假警报)。
 *   · KASPA_RPC_LOCAL_ONLY==='1'(主网现状)⇒ 零 REST/公网请求。opt-in WATCH_PUBLIC_FALLBACK 只认字面 '1'、主网不写、须 Owner 另批;
 *     打开时才允许 REST 回落,状态标 ok_public,且冷存地址【逐个】单独外发,不与热地址同批。
 *   · 'ok' 的判据(缺一不 ok): getWorkingRpc().isLocal===true 且 url!=null;共享客户端上 getServerInfo() 在余额读取【前后各一次】
 *     isSynced===true(不用缓存)且 networkId 含 mainnet;同一次 getBalancesByAddresses 并入热地址作阳性对照——对照集合 = 同批读到的
 *     【全部】热地址,至少一个 >0 ⇒ 该批被认证;全部为 0 或缺项(或没有热地址可对照)⇒ 整批 unavailable,原因码 no_positive_control
 *     (区别于 node_not_synced)。"任一为 0 ⇒ 不可用"是陷阱: 热 relay 花光钱是正常事(NWT S4-1)。
 *   · 结果按 entry.address(规范化后)匹配,不依赖返回顺序;批里缺某冷存条目 ⇒ 该账户 unavailable(entry_missing),不是 0。
 *   · 只缓存已判 ok/ok_public 的结果(30 s,进程内),不缓存同步判据;不落库。
 * 依赖全部可注入(测试用桩): getWorkingRpc / getSharedRpc / AddressCtor / fetchFn / env / now / cache。
 */

export const WATCH_STATUS = Object.freeze({ OK: 'ok', OK_PUBLIC: 'ok_public', UNAVAILABLE: 'unavailable' });
const CACHE_TTL_MS = 30_000;
const RPC_TIMEOUT_MS = 5000;   // 每次 RPC 调用(getWorkingRpc / getSharedRpc / getServerInfo / getBalancesByAddresses)的上限:卡住 ⇒ unavailable,不挂住页面请求
const PUBLIC_REST_BASE = 'https://api.kaspa.org/addresses';
const PUBLIC_REST_TIMEOUT_MS = 5000;
const _cache = new Map();   // 规范化地址 -> { expiresAt, view: { status, balanceKas, source, readAt } }

/** 公网 REST 回落是否被允许: LOCAL_ONLY=1 永远关;否则只有 WATCH_PUBLIC_FALLBACK 恰为字面 '1'。 */
export function publicFallbackEnabled(env = process.env) {
  return env.KASPA_RPC_LOCAL_ONLY !== '1' && env.WATCH_PUBLIC_FALLBACK === '1';
}

/** sompi(bigint)→ KAS(number, 8 位小数精度)。 */
export function sompiToKas(sompi) {
  const b = BigInt(sompi);
  return Number(b / 100000000n) + Number(b % 100000000n) / 1e8;
}

const withTimeout = (p, ms, tag) => Promise.race([Promise.resolve(p), new Promise((_, rej) => setTimeout(() => rej(new Error(`${tag} timeout ${ms}ms`)), ms))]);
const unavailable = (reason) => ({ status: WATCH_STATUS.UNAVAILABLE, reason, balanceKas: null, source: null });

// kaspa-wasm 的 Address 构造对非法输入是 wasm panic("unreachable"),而不是干净的异常——所以【先 validate 再构造】(与 watch-account-register.mjs 同)。
// 实测(本机 kaspa-wasm): 只接受小写规范形式;大写 / 仅前缀大写 / 无前缀 / 带空白 一律 validate=false。
function canonicalOf(AddressCtor, a) {
  try {
    const str = typeof a === 'string' ? a : String(a);
    if (typeof AddressCtor.validate === 'function' && !AddressCtor.validate(str)) return null;
    return new AddressCtor(str).toString();
  } catch { return null; }
}

/** 本机节点路径。返回 Map(规范化地址 -> view)。任何异常都变成 unavailable,不外抛。 */
async function readLocal(canons, hotCanons, deps) {
  const { env, getWorkingRpc, getSharedRpc, AddressCtor, networkId, timeoutMs } = deps;
  const all = (reason) => new Map(canons.map((c) => [c, unavailable(reason)]));
  try {
    let wr;
    try { wr = await withTimeout(getWorkingRpc(), timeoutMs, 'getWorkingRpc'); } catch (e) { return all('rpc_lookup_failed'); }
    if (!wr || !wr.url) return all(env.KASPA_RPC_LOCAL_ONLY === '1' ? 'local_node_unavailable' : 'no_local_node');
    if (wr.isLocal !== true) return all('rpc_not_local');
    const rpc = await withTimeout(getSharedRpc({ url: wr.url, networkId }), timeoutMs, 'getSharedRpc');
    const synced = async () => { const info = await withTimeout(rpc.getServerInfo(), timeoutMs, 'getServerInfo'); return info?.isSynced === true && String(info?.networkId || '').includes(networkId) ? true : (info?.isSynced === true ? 'network_mismatch' : false); };
    const s1 = await synced();
    if (s1 !== true) return all(s1 === 'network_mismatch' ? 'network_mismatch' : 'node_not_synced');
    const hot = [...new Set(hotCanons)].filter((h) => !canons.includes(h));
    if (hot.length === 0) return all('no_positive_control');   // nothing to certify the batch with: fail closed
    const res = await withTimeout(rpc.getBalancesByAddresses([...canons, ...hot].map((a) => new AddressCtor(a))), timeoutMs, 'getBalancesByAddresses');
    const s2 = await synced();
    if (s2 !== true) return all(s2 === 'network_mismatch' ? 'network_mismatch' : 'node_not_synced');
    const got = new Map();
    for (const e of res?.entries || []) { const a = canonicalOf(AddressCtor, e?.address); if (a && e.balance !== undefined && e.balance !== null) { try { got.set(a, BigInt(e.balance)); } catch { /* unusable entry: treated as missing */ } } }
    if (!hot.some((h) => (got.get(h) ?? 0n) > 0n)) return all('no_positive_control');   // at least ONE positive hot balance certifies the batch (S4-1)
    return new Map(canons.map((c) => [c, got.has(c) ? { status: WATCH_STATUS.OK, reason: null, balanceKas: sompiToKas(got.get(c)), source: 'local_node' } : unavailable('entry_missing')]));
  } catch (e) {
    return all(`read_failed:${String(e?.message || e).slice(0, 60)}`);
  }
}

/** 公网 REST 路径(仅 WATCH_PUBLIC_FALLBACK=1 且 LOCAL_ONLY≠1)。逐个单独外发;不需要阳性对照(独立来源,不受本机 IBD 空值影响),但有自己的失败处理。 */
async function readPublic(canon, deps) {
  const { fetchFn } = deps;
  try {
    const res = await fetchFn(`${PUBLIC_REST_BASE}/${encodeURIComponent(canon)}/balance`, { signal: AbortSignal.timeout(PUBLIC_REST_TIMEOUT_MS) });
    if (!res || res.ok !== true) return unavailable(`http_${res ? res.status : 'none'}`);
    let j; try { j = await res.json(); } catch { return unavailable('bad_response'); }
    const b = j?.balance;
    if (typeof b !== 'number' || !Number.isFinite(b) || b < 0 || !Number.isInteger(b)) return unavailable('bad_response');
    return { status: WATCH_STATUS.OK_PUBLIC, reason: null, balanceKas: sompiToKas(BigInt(b)), source: 'public_rest' };
  } catch (e) {
    return unavailable(`public_failed:${String(e?.name || e?.message || e).slice(0, 40)}`);
  }
}

/**
 * @param {Array<{id:string,name:string,address:string,chain?:string,network?:string,custody?:string,note?:string}>} rows  watch_accounts 行
 * @param {object} deps { getWorkingRpc, getSharedRpc, AddressCtor, hotAddresses?:string[], env?, fetchFn?, now?, cache?, networkId? }
 * @returns {Promise<Array<{id,name,address,custody,status,reason,balanceKas,source,readAt}>>} 与 rows 同序,永不抛
 */
export async function readWatchBalances(rows, deps = {}) {
  const d = { env: process.env, hotAddresses: [], fetchFn: globalThis.fetch, now: () => Date.now(), cache: _cache, networkId: 'mainnet', timeoutMs: RPC_TIMEOUT_MS, ...deps };
  const readAt = new Date(d.now()).toISOString();
  const views = new Map();   // row.id -> view
  const pending = [];        // { row, canon }
  for (const row of rows) {
    const canon = d.AddressCtor ? canonicalOf(d.AddressCtor, row.address) : null;
    if (!canon) { views.set(row.id, { ...unavailable(d.AddressCtor ? 'invalid_address' : 'no_address_parser'), readAt }); continue; }
    const c = d.cache.get(canon);
    if (c && c.expiresAt > d.now()) { views.set(row.id, { ...c.view }); continue; }
    pending.push({ row, canon });
  }
  if (pending.length) {
    const canons = pending.map((p) => p.canon);
    const hotCanons = (d.hotAddresses || []).map((h) => (d.AddressCtor ? canonicalOf(d.AddressCtor, h) : null)).filter(Boolean);
    const local = await readLocal(canons, hotCanons, d);
    for (const { row, canon } of pending) {
      let v = local.get(canon) || unavailable('no_result');
      if (v.status === WATCH_STATUS.UNAVAILABLE && publicFallbackEnabled(d.env)) {
        const pub = await readPublic(canon, d);   // each cold address alone, never batched with a hot one
        v = pub.status === WATCH_STATUS.OK_PUBLIC ? pub : { ...v, reason: `${v.reason}; public:${pub.reason}` };
      }
      const view = { ...v, readAt };
      if (view.status !== WATCH_STATUS.UNAVAILABLE) d.cache.set(canon, { expiresAt: d.now() + CACHE_TTL_MS, view });   // only settled-ok results are cached
      views.set(row.id, view);
    }
  }
  return rows.map((row) => ({ id: row.id, name: row.name, address: row.address, chain: row.chain || 'kaspa', custody: row.custody || 'cold_no_key', ...views.get(row.id) }));
}

/** 汇总: watchKas 只累加 ok / ok_public;watchUnreadable = 读不到的账户数(总计不完整的标记)。 */
export function sumWatchKas(results) {
  let watchKas = 0, watchUnreadable = 0;
  for (const r of results) {
    if (r.status === WATCH_STATUS.OK || r.status === WATCH_STATUS.OK_PUBLIC) watchKas += r.balanceKas; else watchUnreadable++;
  }
  return { watchKas: Math.round(watchKas * 1e8) / 1e8, watchUnreadable };
}
