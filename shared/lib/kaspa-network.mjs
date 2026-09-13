/**
 * kaspa-network.mjs — 网络单一源 + 地址前缀一致性核（shared: kasia-console / kasia-relay / kaspa-scout 共用）
 *
 * 设计: docs/2026-09-13-j2-network-single-source-and-prefix-consistency-helper-design-v0.1.md v0.2（NWT 7149e3a5 PASS）
 * 不变量:
 *   I1 网络身份只从 env KASPA_NETWORK 来; 无默认值; 不认识的值 ⇒ throw。
 *   I2 任何进入钱路/身份路的地址, 其前缀必须等于 prefixForNetwork(KASPA_NETWORK), 否则拒; 绝不把不认识/不匹配的前缀映射成任何网络。
 *   I3 先 Address.validate()(校验和含前缀 ⇒ 伪造前缀在此就死), 再比前缀; 两步都不构造 Address 对象
 *      (实测 new Address(坏校验和) 抛 wasm `unreachable` = 毒化 kaspa-wasm 实例那族; validate() 对畸形输入返回 false 不抛, NWT V12 十一组对抗输入实证)。
 *   I4 DB 行自带 network 列不是第二真相源: 行值 ≠ env ⇒ 该行不进 live 路径, 不重映射。
 * 依赖: 零。kaspa-wasm 由调用方注入(NWT Q3 采纳: shared 目录不再长出第二个 wasm 加载点); console/relay 各有薄包装绑定各自的 kaspa 模块。
 * 明确不导出 networkOfAddress() 之类"从地址得网络"的函数——它就是今天 33 处 `startsWith('kaspatest:') ? 'testnet-12' : 'mainnet'` 的病。
 */

/** 网络 → 前缀（单向表；不提供反向表） */
export const NETWORKS = Object.freeze({
  'mainnet': 'kaspa',
  'testnet-12': 'kaspatest',
  'devnet': 'kaspadev',
  'simnet': 'kaspasim',
});

export class NetworkMismatchError extends Error {
  /** @param {{code:string, who?:string, network?:string, expectedPrefix?:string, actualPrefix?:string, addr?:string}} f */
  constructor(f) {
    super(`[kaspa-network] ${f.code}: who=${f.who || '?'} network=${f.network || '?'} expected=${f.expectedPrefix || '?'} actual=${f.actualPrefix || '?'} addr=${f.addr || ''}`);
    this.name = 'NetworkMismatchError';
    Object.assign(this, f);
  }
}

/**
 * I1: 配置网络单一源。未设 / 不在表 ⇒ throw（与 rpc-health.js:19-23 同形，无默认）。
 * @param {object} [env]
 * @returns {string}
 */
export function configuredNetwork(env = process.env) {
  const net = env.KASPA_NETWORK;
  if (!net || !Object.prototype.hasOwnProperty.call(NETWORKS, net)) {
    throw new Error(`KASPA_NETWORK not set or unknown: ${JSON.stringify(net)} (allowed: ${Object.keys(NETWORKS).join(', ')})`);
  }
  return net;
}

/** @param {string} net */
export function prefixForNetwork(net) {
  if (!Object.prototype.hasOwnProperty.call(NETWORKS, net)) throw new Error(`unknown network: ${JSON.stringify(net)}`);
  return NETWORKS[net];
}

/** 纯字符串: 冒号前的部分; 非 string / 无冒号 ⇒ ''。不碰 wasm。 */
export function addressPrefix(addr) {
  if (typeof addr !== 'string') return '';
  const i = addr.indexOf(':');
  return i < 0 ? '' : addr.slice(0, i);
}

const _short = (addr) => (typeof addr === 'string' ? addr.slice(0, 14) : String(addr).slice(0, 14));

/**
 * 核心判定（不抛）。
 * @param {*} addr
 * @param {{network?:string, who?:string, kaspa:{Address:{validate:(s:string)=>boolean}}, env?:object}} opts
 * @returns {{ok:true, network:string} | {ok:false, code:'empty'|'invalid-checksum'|'prefix-mismatch', network:string, expectedPrefix:string, actualPrefix:string, addr:string, who:string}}
 */
export function checkAddressOnNetwork(addr, { network, who = 'unknown', kaspa, env = process.env } = {}) {
  if (!kaspa || !kaspa.Address || typeof kaspa.Address.validate !== 'function') throw new Error('[kaspa-network] kaspa module required (inject { kaspa } or use the console/relay wrapper)');
  const net = network ?? configuredNetwork(env);
  const expectedPrefix = prefixForNetwork(net);
  const base = { network: net, expectedPrefix, who };
  if (typeof addr !== 'string' || addr.length === 0) return { ok: false, code: 'empty', actualPrefix: '', addr: _short(addr), ...base };
  let valid = false;
  try { valid = kaspa.Address.validate(addr) === true; } catch { valid = false; }   // validate() 实测不抛; 保险起见任何异常按无效处理
  const actualPrefix = addressPrefix(addr);
  if (!valid) return { ok: false, code: 'invalid-checksum', actualPrefix, addr: _short(addr), ...base };
  if (actualPrefix !== expectedPrefix) return { ok: false, code: 'prefix-mismatch', actualPrefix, addr: _short(addr), ...base };
  return { ok: true, network: net };
}

/**
 * I2/I3 拒绝形: 通过 ⇒ 返回 network（= 传入/配置的那个, 不是从地址算的; 让 33 处替换保持 `const network = …` 原形）; 否则 throw NetworkMismatchError。
 */
export function assertAddressOnNetwork(addr, opts = {}) {
  const r = checkAddressOnNetwork(addr, opts);
  if (!r.ok) throw new NetworkMismatchError(r);
  return r.network;
}

/** 过滤形（读路径 / 对手方可控字段）: boolean，不抛。 */
export function isAddressOnNetwork(addr, opts = {}) {
  return checkAddressOnNetwork(addr, opts).ok;
}

/**
 * I4: DB 行的 network 列必须等于配置网络才可进入 live 路径（不重映射）。
 * @returns {boolean}
 */
export function rowNetworkMatches(rowNetwork, { network, env = process.env } = {}) {
  const net = network ?? configuredNetwork(env);
  return rowNetwork === net;
}
