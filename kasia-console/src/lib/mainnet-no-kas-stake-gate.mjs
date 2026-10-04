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
// S1(下注不收 KAS 的网关代付分支) / S2(ZK 原生盘不建 spine)落地时, 由它们按分支重开, 不在本段。
import { configuredNetwork } from './kaspa-network.mjs';

export const NO_KAS_STAKE_ERROR = '主网押注与开盘不收 KAS（D-017 §2）';
export const NO_KAS_STAKE_CODE = 'mainnet_no_kas_stake';

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
  if (net !== 'mainnet') return null;
  return deny(routeName, net, '');
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
