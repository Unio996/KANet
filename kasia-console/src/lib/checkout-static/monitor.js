// monitor.js — 浏览器直连节点只读监视(D-034 §8 后续票⑥ part(a), Bettor 派工 2026-09-27)。
// 付款是否到账/确认深度/PMT——全部走 kaspa-wasm RpcClient 直连 wss, 不经 resolver.mjs, 不需要任何
// 本机进程。确认深度公式逐字对应 kasia-relay/src/lib/p2sh.mjs checkUtxoLanded()(J1 2026-06-30
// phantom-leaf 根治·reorg-safe DAA-深度门, REORG_SAFE_MIN_DEPTH=20 既有惯用值), 不是另起一套判据。
//
// ⑤ NWT SHOULD②(2026-09-27): 付款状态动态提示(到账/不足/超付)并入本文件, 不单独另开一票。

// D-034 §8 后续票⑨(2026-09-27 实测确认, 无 CORS, 主网): 默认候选池, 比 resolver 自动发现快得多
// (resolver 发现 20-66 秒, 直连 400-600ms)。仅用于 network='mainnet'——simnet/testnet 测试环境必须
// 显式传 rpcUrl(本机没有这些网络的公开候选池, 也不应该假装有)。
const MAINNET_ENDPOINT_POOL = [
  'wss://sara.kaspa.red/kaspa/mainnet/wrpc/borsh',
  'wss://nina.kaspa.blue/kaspa/mainnet/wrpc/borsh',
  'wss://eva.kaspa.green/kaspa/mainnet/wrpc/borsh',
  'wss://vivi.kaspa.blue/kaspa/mainnet/wrpc/borsh',
  'wss://isla.kaspa.red/kaspa/mainnet/wrpc/borsh',
];

export const REORG_SAFE_MIN_DEPTH = 20; // 同 kasia-console/src/lib/pool-shard-register.mjs 既有具名常量数值(实测校准值)

/**
 * 连接一个可用节点——simnet/testnet 必须传 rpcUrl(本机直连地址); mainnet 不传 rpcUrl 时按⑨清单
 * 逐个尝试(不等 resolver 自动发现, 除非清单全部连不上才退回 Resolver 兜底)。
 * @param {object} kaspaWasm
 * @param {{network:string, rpcUrl?:string}} opts
 * @returns {Promise<{rpc:object, url:string}>}
 */
export async function connectMonitorRpc(kaspaWasm, opts) {
  const { network, rpcUrl } = opts;
  if (rpcUrl) {
    const rpc = new kaspaWasm.RpcClient({ url: rpcUrl, networkId: network });
    await rpc.connect();
    return { rpc, url: rpcUrl };
  }
  if (network !== 'mainnet') {
    throw new Error(`connectMonitorRpc: network='${network}' 没有内置端点池(⑨清单只验证过 mainnet)——必须显式传 rpcUrl(本机节点直连地址)`);
  }
  let lastErr = null;
  for (const url of MAINNET_ENDPOINT_POOL) {
    try {
      const rpc = new kaspaWasm.RpcClient({ url, networkId: network });
      await rpc.connect();
      return { rpc, url };
    } catch (e) { lastErr = e; }
  }
  // 清单全部连不上才退回 Resolver 自动发现(⑨结论: 保留作兜底, 不是默认路径)。
  const rpc = new kaspaWasm.RpcClient({ resolver: new kaspaWasm.Resolver(), networkId: network });
  try {
    await rpc.connect();
    return { rpc, url: '(resolver auto-discovered)' };
  } catch (e) {
    throw new Error(`connectMonitorRpc: 内置端点池全部连不上(最后一个错误: ${lastErr?.message}), Resolver 兜底也失败: ${e.message}`);
  }
}

// 逐字段 fallback 对应 checkUtxoLanded() 里 Bettor 实测纠正过的那条(kaspa-wasm entry 字段多路径,
// 不自创单路径赌 wasm 序列化形态)。
function readBlockDaaScore(entry) {
  return entry.blockDaaScore ?? entry.utxoEntry?.blockDaaScore ?? entry.entry?.blockDaaScore ?? entry.entry?.utxoEntry?.blockDaaScore ?? null;
}
function readAmount(entry) {
  return entry.amount ?? entry.utxoEntry?.amount ?? entry.entry?.amount ?? entry.entry?.utxoEntry?.amount ?? null;
}
function readOutpoint(entry) {
  return entry.outpoint ?? entry.entry?.outpoint ?? null;
}

/**
 * 查订单地址的付款状态——⑤ NWT SHOULD②要求的"到账/不足/超付"动态提示在这里判定。
 * @param {object} rpc 已连接的 RpcClient
 * @param {string} address 订单收款地址
 * @param {bigint} expectedTotalSompi 期望总额(= Σ payoutLeaves.amountSompi, 与 checkout.js 显示的
 *   "应付总额"同一个值——买家可能只付了部分/付多了, 这里如实判断三态而不是只判"有没有钱")
 * @returns {Promise<{state:'unfunded'|'underfunded'|'funded'|'overfunded', utxos:object[], totalSompi:bigint, depth:number|null}>}
 */
export async function getOrderPaymentStatus(rpc, address, expectedTotalSompi) {
  const { entries } = await rpc.getUtxosByAddresses([address]);
  const utxos = entries || [];
  if (utxos.length === 0) return { state: 'unfunded', utxos: [], totalSompi: 0n, depth: null };

  const totalSompi = utxos.reduce((a, e) => a + BigInt(readAmount(e) ?? 0), 0n);

  // 确认深度: 取所有 UTXO 里最浅的一个(最保守——只要有一笔还没到 minDepth, 整体就还不算"深确认到账",
  // 与 checkUtxoLanded 单笔判据的保守方向一致)。
  let dag = null, minDepthAmongUtxos = null;
  try {
    dag = await rpc.getBlockDagInfo();
    const virtualDaaScore = Number(dag.virtualDaaScore);
    for (const e of utxos) {
      const bds = readBlockDaaScore(e);
      if (bds == null) { minDepthAmongUtxos = null; break; }
      const d = virtualDaaScore - Number(bds);
      minDepthAmongUtxos = minDepthAmongUtxos == null ? d : Math.min(minDepthAmongUtxos, d);
    }
  } catch { /* getBlockDagInfo 失败不影响到账判定, 只是深度未知 */ }

  const state = totalSompi < expectedTotalSompi ? 'underfunded' : (totalSompi > expectedTotalSompi ? 'overfunded' : 'funded');
  return {
    state, totalSompi, depth: minDepthAmongUtxos,
    utxos: utxos.map(e => ({ outpoint: readOutpoint(e), amountSompi: BigInt(readAmount(e) ?? 0), blockDaaScore: readBlockDaaScore(e) })),
  };
}

/** 节点当前 pastMedianTime(毫秒)——refund 到期判据唯一正确时间源(同 instant-split-sdk.mjs/
 * commission-plan-sdk.mjs 既有 MUST 纪律, 不用 Date.now() 或 tip 时间戳)。 */
export async function getCurrentPmtMs(rpc) {
  const dag = await rpc.getBlockDagInfo();
  return Number(dag.pastMedianTime);
}

/** 节点当前 DAA 分数——ServiceEscrow.timeout_default 到期判据唯一正确时间源(D-034 §9 建议-4: 用
 * tx.daa 不用 tx.time/PMT, 同 commission-plan-sdk.mjs createServiceEscrowProtocol 既有纪律: 现查
 * 节点, 不接受本地算的近似值)。 */
export async function getCurrentDaaScore(rpc) {
  const dag = await rpc.getBlockDagInfo();
  return Number(dag.virtualDaaScore);
}
