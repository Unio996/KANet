// mainnet-no-kas-stake-gate.mjs — 账本 1845 / 设计 docs/2026-10-04-bettor-pm-ktt-only-bet-create-design-v0.1.md §3.1 (S0)。
//
// D-017 §2「押注 ≠ KAS」硬约束 = 代码闸, 不靠 env / 纪律。主网上所有向开盘人 / 下注人 / 委员收 KAS 的
// console 路由, 第一条语句调本函数; 返回非 null ⇒ 路由原样 `return reply.code(g.http).send(g.body)`,
// 即在任何查库 / relay 命令 / 转账之前拒绝。
//
// 复用: 网络判断走现成单源 kaspa-network.mjs 的 configuredNetwork()(KASPA_NETWORK, 无默认, 不认识 ⇒ throw);
// 本文件不另写任何网络判断。
// 测试网 / simnet / devnet: 返回 null, 行为与改动前逐字节一致。
// 网络未配 / 不认识: fail-closed 拒绝(与其它钱路同样会在此处 throw, 这里把 throw 变成 403, 不放行)。
// S1(下注不收 KAS 的网关代付分支) / S2(ZK 原生盘不建 spine): 账本1846 起按分支【显式重开】——见 REOPENED_ROUTES / assertNoKasStakeUnlessReopened,
// 重开 = 路由第一条语句换成后者(带重开 id), 紧接着必须走本文件的分支守卫(主网上只放行无 KAS 的那条分支); 重开清单在测试里逐条断言。
import { configuredNetwork } from './kaspa-network.mjs';

export const NO_KAS_STAKE_ERROR = '主网押注与开盘不收 KAS（D-017 §2）';
export const NO_KAS_STAKE_CODE = 'mainnet_no_kas_stake';

/** S3 simnet 彩排用: 非主网网络设 KANET_NO_KAS_STAKE_MODE=1 ⇒ 与主网同样走"不收 KAS"语义(403 + 无 KAS 分支)。只会【加严】, 不会放宽任何东西。 */
export const NO_KAS_MODE_ENV = 'KANET_NO_KAS_STAKE_MODE';
/** 重开清单(单源): 路由名 → 重开 id。路由第一条语句必须带对应 id, 否则按未重开处理(fail-closed)。 */
export const REOPENED_ROUTES = Object.freeze({
  'create-v07': 'S2-zk-native-no-spine',
  'register-v07': 'S1-gateway-sponsor',
});

const _logged = new Set();   // 每个路由名只打一次日志(自动程序每个 tick 都会撞, 不刷屏)

/**
 * @param {string} routeName  日志/响应里带的路由名(如 'create-v07')
 * @param {object} [env]      默认 process.env(测试注入)
 * @returns {null | {http:403, body:{ok:false, error:string, code:string, route:string, network?:string}}}
 */
export function assertNoKasStakeOnMainnet(routeName, env = process.env) {
  let net;
  try {
    net = configuredNetwork(env);
  } catch (e) {
    return deny(routeName, 'unconfigured', `(网络未配置/未知, fail-closed: ${e.message})`);
  }
  if (net !== 'mainnet' && env[NO_KAS_MODE_ENV] !== '1') return null;
  return deny(routeName, net, '');
}

/**
 * 当前是否处于"不收 KAS"模式: 主网, 或显式设了 KANET_NO_KAS_STAKE_MODE=1。网络未配/未知 ⇒ true(fail-closed)。
 * 重开的分支据此决定走无 KAS 路径; 测试网/simnet 不设该 env ⇒ false ⇒ 老行为逐字节不变。
 */
export function noKasStakeModeOn(env = process.env) {
  let net;
  try { net = configuredNetwork(env); } catch { return true; }
  return net === 'mainnet' || env[NO_KAS_MODE_ENV] === '1';
}

/**
 * 重开版闸: 只用于 REOPENED_ROUTES 里登记的路由(且 id 必须对得上, 否则 fail-closed 403)。
 * 非"不收 KAS"模式 ⇒ null(老行为); 模式开 ⇒ 也返回 null 放行【进入分支守卫】, 路由随后必须调用对应分支守卫
 * (mainnetCreateV07Branch / parseStakeKtt)——KAS 路径不会在模式开时可达。
 */
export function assertNoKasStakeUnlessReopened(routeName, reopenId, env = process.env) {
  if (REOPENED_ROUTES[routeName] !== reopenId) return deny(routeName, 'reopen-id-mismatch', `(重开 id 不匹配: ${reopenId})`);
  const g = assertNoKasStakeOnMainnet(routeName, env);   // 网络未配 ⇒ 403(fail-closed); 其余情况(含模式开)走下面
  if (g && g.body.network === 'unconfigured') return g;
  return null;
}

/** create-v07 重开分支守卫(S2): 不收 KAS 模式下只允许 zk_native 盘。spec 非法 JSON ⇒ 403(fail-closed); zk_native===false ⇒ 403; 缺省/true ⇒ null。 */
export function mainnetCreateV07Branch(resolutionRuleSpec, routeName = 'create-v07') {
  let spec;
  try { spec = typeof resolutionRuleSpec === 'string' ? JSON.parse(resolutionRuleSpec || '{}') : (resolutionRuleSpec || {}); } catch { spec = null; }
  if (!spec || typeof spec !== 'object') return deny(routeName + ':spec', 'no-kas-mode', '(resolution_rule_spec 非法 JSON, fail-closed)');
  if (spec.zk_native === false) return deny(routeName + ':non-zk', 'no-kas-mode', '(不收 KAS 模式下 create-v07 只开 ZK 原生盘, zk_native=false 的旧 V1 盘需 spine 押金)');
  return null;
}

/**
 * register-v07 重开分支(S1)的下注量解析: 不收 KAS 模式下只认 stake_ktt(代币单位整数, ≥ minUnits); stake_kas 一律不读。
 * @returns {{ok:true, stakeUnits:number} | {ok:false, http:400, body:object}}
 */
export function parseStakeKtt(body, minUnits) {
  const b = body || {};
  const fail = (error) => ({ ok: false, http: 400, body: { ok: false, error, code: 'stake_ktt_required' } });
  if (b.stake_ktt === undefined || b.stake_ktt === null || b.stake_ktt === '') {
    return fail('不收 KAS 模式: 下注量字段是 stake_ktt(筹码/代币单位整数); stake_kas 不再被读取');
  }
  const n = typeof b.stake_ktt === 'string' && /^[0-9]+$/.test(b.stake_ktt) ? Number(b.stake_ktt) : b.stake_ktt;
  if (!Number.isSafeInteger(n) || n < minUnits) return fail(`stake_ktt 必须是整数且 >= ${minUnits}`);
  return { ok: true, stakeUnits: n };
}

function deny(routeName, net, extra) {
  if (!_logged.has(routeName)) {
    _logged.add(routeName);
    console.warn(`[mainnet-no-kas-stake] 403 route=${routeName} network=${net} ${NO_KAS_STAKE_ERROR}${extra ? ' ' + extra : ''}`);
  }
  return { http: 403, body: { ok: false, error: extra ? `${NO_KAS_STAKE_ERROR} ${extra}` : NO_KAS_STAKE_ERROR, code: NO_KAS_STAKE_CODE, route: routeName, network: net } };
}

/** 仅测试用: 清日志去重集。 */
export function _resetNoKasStakeLogForTest() { _logged.clear(); }

/**
 * register-v07 重开分支(S1)的目标盘检查(Bettor 账本1846 评审 SHOULD): 不收 KAS 模式下, 网关代付分支只许喂【ZK 原生且无 spine】的盘——
 * 旧 V1 盘(zk_native≠true)或带 spine 的盘(旧 KAS 模型)一律 403, 保证 legacy 行永远进不了代付分支。spec 非法 JSON ⇒ 403(fail-closed)。
 * @param {{spine_p2sh?:string|null, resolution_rule_spec?:string}} market  pool_markets 行
 * @returns {null | {http:403, body:object}}
 */
export function sponsorMarketGuard(market, routeName = 'register-v07') {
  let spec; try { spec = JSON.parse(market?.resolution_rule_spec || '{}'); } catch { spec = null; }
  if (!spec || typeof spec !== 'object') return deny(routeName + ':market-spec', 'no-kas-mode', '(目标盘 resolution_rule_spec 非法 JSON, fail-closed)');
  if (spec.zk_native !== true) return deny(routeName + ':market-not-zk', 'no-kas-mode', '(不收 KAS 模式: 网关代付只许 ZK 原生盘, 目标盘 zk_native≠true)');
  if (market.spine_p2sh) return deny(routeName + ':market-has-spine', 'no-kas-mode', '(不收 KAS 模式: 目标盘带 spine, 属旧 KAS 模型, 不进网关代付分支)');
  return null;
}

/**
 * 在跑(未完结)的 ZK 原生盘清单/上限(账本1850 一次一盘 → 账本1855 可配 ZK_MAX_LIVE_MARKETS, 默认 1): 不收 KAS 模式下, create-v07 在达上限时回 409。
 * 理由: 并发盘会抢 close 提交费 UTXO(bshard-close-transport 的 0.5 KAS 自转账, 被别的 tx/整理吃掉 ⇒ "UTXO not found" 卡死; S3 run1 btduw 实证)。
 * 未完结 = 非 shard_internal 行 ∧ resolution_rule_spec.zk_native===true ∧ protocol_status 不在终态集 ∧ zk_continuation.exhausted≠true。
 * (ZK 原生盘走完 close 后 protocol_status 停在 'attested_v2', 真正的"领完"标记是 metadata.zk_continuation.exhausted=true, 故两者都认。)
 * @param {{prepare:Function}} db  better-sqlite3 句柄(调用方注入, 本文件不 import DB 客户端)
 * @returns {null | {id:string, protocol_status:string}} 第一个未完结盘; 无 ⇒ null
 */
export const FINISHED_PROTOCOL_STATUSES = Object.freeze(['completed', 'refunded', 'cancelled', 'expired', 'shard_internal']);
export function listUnfinishedZkNativeMarkets(db) {
  const ph = FINISHED_PROTOCOL_STATUSES.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, protocol_status, metadata FROM pool_markets WHERE protocol_status NOT IN (${ph}) AND json_valid(resolution_rule_spec) AND json_extract(resolution_rule_spec, '$.zk_native') = 1 ORDER BY created_at ASC`).all(...FINISHED_PROTOCOL_STATUSES);
  const out = [];
  for (const r of rows) {
    let exhausted = false;
    try { exhausted = JSON.parse(r.metadata || '{}')?.zk_continuation?.exhausted === true; } catch { /* 坏 metadata ⇒ 按未完结(fail-closed) */ }
    if (!exhausted) out.push({ id: r.id, protocol_status: r.protocol_status });
  }
  return out;
}
export function findUnfinishedZkNativeMarket(db) {
  return listUnfinishedZkNativeMarkets(db)[0] || null;
}

/**
 * 账本1855 A: 一次一盘 ⇒ 可配上限。env ZK_MAX_LIVE_MARKETS = 同时在跑(未完结)的 ZK 原生盘数上限; 未设/非法/<1 ⇒ 1(即原"一次一盘"行为, fail-closed); 上限 100。
 * 并发盘靠 relay 侧 fee UTXO 钉住(pin_utxo, fee-pins.mjs)才安全, 故默认不放开——由部署方显式设值。
 */
export function resolveMaxLiveMarkets(env = process.env) {
  const raw = env.ZK_MAX_LIVE_MARKETS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 1;
}
/** @returns {null | {cap:number, live:number, ids:string[]}} 已达/超上限 ⇒ 详情; 未满 ⇒ null。同步无 await: 调用方在 INSERT 前同一同步段内调用即与插入原子(better-sqlite3)。 */
export function liveMarketCapReached(db, env = process.env) {
  const cap = resolveMaxLiveMarkets(env);
  const live = listUnfinishedZkNativeMarkets(db);
  return live.length >= cap ? { cap, live: live.length, ids: live.map((m) => m.id) } : null;
}
