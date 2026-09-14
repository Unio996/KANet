// proto-relay-guard.mjs — 原型 v0 PROTO_RELAY_ID 基础设施(接线笔③, 设计 §6(B′)/§9.2③,
// Bettor 1354/1365 三项纪律之一)。
//
// 铁律: 原型 v0 资金路径只信 process.env.PROTO_RELAY_ID 这一个硬编码来源。proto 模块内任何
// sendCommandAsync 调用一律传这个常量, 不接受请求体覆盖——静态层面由 lint R-PROTO-RELAY-ID-CONST
// 守("必须字面上是这个标识符"), 运行时层面本文件的 rejectRelayIdInBody() 守("请求体里出现这个字段
// 直接拒", 防止即使调用点写对了常量、握手参数里混进的字段被后续代码不小心读到别处去)。
//
// relay.mjs 侧(covenant-broadcast-relay.mjs)也有执行权限门兜底(只有 RELAY_NODE_ID===PROTO_RELAY_ID
// 才放行) —— 这是纵深防御的第三层, 三层各自独立失效都不足以让越权发生。

import { sqlite } from '../db/client.js';

export const PROTO_RELAY_ID = process.env.PROTO_RELAY_ID || null;

const PROTO_NAME_PREFIX = 'proto-';
export const PROTO_MAX_BALANCE_KAS = 5; // Bettor 1365: 启动断言硬顶——这个 relay 只该持有原型规模的资金

// 🔴 单一来源(账本1438①, J2 buildAndBroadcast 接线核对发现 proto-bet-intent.mjs 遗漏改用真实命令名
// 而 proto-market-intent.mjs 已经改过——两处各自手打字面量导致漂移)。两个 intent 状态机文件的
// resolvePrepared 同字节重播分支都从这里导入, 不再各自写字面量 'covenant_broadcast'。
export const PROTO_COVENANT_BROADCAST_TYPE = 'covenant_broadcast';

/**
 * 启动断言(index.js 启动流程调用一次, fail-closed): PROTO_RELAY_ID 必须已配置、relay_nodes 表
 * 里存在这一行、name 前缀 'proto-'、链上余额 < PROTO_MAX_BALANCE_KAS。任一不满足 ⇒ throw——
 * 调用方决定"整个 console 启动失败"还是"只让 proto 路由不注册", 本函数只判断不处置。
 * @returns {Promise<{ok:true, name:string, address:string, balanceKas:number}>}
 */
export async function assertProtoRelayHealthy({ getBalanceFn = getAddressBalanceKas } = {}) {
  if (!PROTO_RELAY_ID) {
    throw new Error('PROTO_RELAY_ID not configured — proto v0 money path refuses to start (fail-closed: unconfigured means no relay is authorized, not "any relay is allowed")');
  }
  // 显式列清单(同 proto.js 既有"永不 SELECT *"纪律)——这里只需要 name/address/network 三列, 不取
  // *_enc / *privkey* / *mnemonic* 列(此函数只做健康校验, 不该有机会碰到那些字段)。
  const row = sqlite.prepare('SELECT id, name, address, network FROM relay_nodes WHERE id = ?').get(PROTO_RELAY_ID);
  if (!row) {
    throw new Error(`PROTO_RELAY_ID=${PROTO_RELAY_ID} not found in relay_nodes table`);
  }
  if (!row.name || !row.name.startsWith(PROTO_NAME_PREFIX)) {
    throw new Error(`PROTO_RELAY_ID relay name '${row.name}' does not start with '${PROTO_NAME_PREFIX}' — refusing (name-prefix convention is the human-visible tripwire that this is the sacrificial proto relay, not a production one being accidentally wired in)`);
  }
  if (!row.address) {
    throw new Error(`PROTO_RELAY_ID relay has no address`);
  }
  const balanceKas = await getBalanceFn(row.address, row.network || 'mainnet');
  if (balanceKas === null) {
    throw new Error(`could not determine on-chain balance for PROTO_RELAY_ID relay address ${row.address} — fail-closed (cannot verify the <${PROTO_MAX_BALANCE_KAS} KAS invariant, so refusing rather than assuming it holds)`);
  }
  if (balanceKas >= PROTO_MAX_BALANCE_KAS) {
    throw new Error(`PROTO_RELAY_ID relay balance ${balanceKas} KAS >= ${PROTO_MAX_BALANCE_KAS} KAS ceiling — refusing (this relay is supposed to hold only prototype-scale funds; a large balance means either it is not the sacrificial relay it claims to be, or it needs to be drained back down before proto features may run)`);
  }
  return { ok: true, name: row.name, address: row.address, balanceKas };
}

// 复用既有 GET /api/relay/:id/balance 的查询模式(kasia-console/src/api/relay.js:383-414):
// 共享 RPC 单例(getSharedRpc, 防 kaspa-wasm RpcClient 构造器级内存泄漏)优先, REST 兜底。
async function getAddressBalanceKas(address, network) {
  try {
    const { getWorkingRpc } = await import('../services/rpc-health.js');
    const { url: rpcUrl } = await getWorkingRpc();
    if (rpcUrl) {
      const { Address } = await import('kaspa-wasm');
      const { getSharedRpc } = await import('./kaspa-rpc-shared.mjs');
      const rpc = await getSharedRpc({ url: rpcUrl, networkId: network });
      const { entries } = await rpc.getBalancesByAddresses([new Address(address)]);
      return Number(entries?.[0]?.balance || 0n) / 1e8;
    }
  } catch { /* fall through to REST fallback */ }
  try {
    const res = await fetch(`https://api.kaspa.org/addresses/${address}/balance`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return (data.balance || 0) / 1e8;
    }
  } catch { /* both paths failed */ }
  return null;
}

/**
 * 请求体不得传 relay_id(§9.2③ 三项纪律之一) —— 调用方(proto.js 各 POST handler)在参数解构后立即调用,
 * 命中就直接 400 拒绝、不进入任何业务逻辑。防止外部请求越权指定 relay(即使目前 buildAndBroadcast 内部
 * 从不读 request.body.relay_id、一律用 PROTO_RELAY_ID 常量, 这条检查是"请求体里携带这个字段本身就是
 * 一个信号, 说明调用方对协议的理解有问题或在探测边界", 拒绝比静默忽略更诚实)。
 * @param {object} body  request.body
 * @returns {string|null}  非 null = 拒绝理由(调用方直接 400 这个字符串), null = 放行
 */
export function rejectRelayIdInBody(body) {
  if (body && Object.prototype.hasOwnProperty.call(body, 'relay_id')) {
    return 'relay_id must not be provided in the request body — proto v0 money path only uses the server-side PROTO_RELAY_ID configuration';
  }
  return null;
}
