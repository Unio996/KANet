// custodial-network.mjs — 托管钱包网络判据(纯函数, 无 I/O)。S4(NWT 审 S3): api/capability.js 的 deriveCustodialExecFields 对网络≠托管钱包所属网络时拒绝,
// 防"将来主网 console 上出现托管行, 能力网关旁路 tg-wallet.js 的 CR-2 守卫"。
// 🔴 与 api/tg-wallet.js 的 `const NETWORK = 'testnet-12'`(CR-2 守卫, 已合入/GREEN, 本笔不重开)是同一个事实的两处拷贝——不改已合入的钱路文件, 改用
//    测试 custodial-network.test.mjs 钉住两处字面量必须相等(漂移即测试失败)。将来"启用主网托管钱包"(须 Owner 批)时两处一起改。
export const CUSTODIAL_NETWORK = 'testnet-12';

/** console 当前网络(严格相等; 未设 ⇒ 不允许, fail-closed)是否是托管钱包所属网络。 */
export function custodialNetworkAllowed(env = process.env) {
  return !!env && env.KASPA_NETWORK === CUSTODIAL_NETWORK;
}

/** tg_custodial_wallets 行自带的 network 列是否属于托管网络(行值 ≠ 常量 ⇒ 该行不进钱路, 不重映射)。 */
export function custodialRowAllowed(row) {
  return !!row && row.network === CUSTODIAL_NETWORK;
}

/** 与 tg-wallet.js CR-2 守卫同文案(未设显示 (未设))。 */
export function custodialNetworkError(env = process.env) {
  const actual = env && env.KASPA_NETWORK;
  return `托管钱包暂不可用：本模块仅支持 ${CUSTODIAL_NETWORK}，当前 KASPA_NETWORK=${actual || '(未设)'}`;
}
