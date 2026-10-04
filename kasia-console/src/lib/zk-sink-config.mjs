// zk-sink-config.mjs — 账本 1850 严格零方案: 烤进 PoolSideTicket / KanetTokenClaim 模板的两个 ctor 常量的【单一读取点】。
//   ZK_SYSTEM_SINK_PK      系统 sink 公钥(64 hex, x-only)。ticket sweep / claim retire 的唯一去向。
//   ZK_CLAIM_RETIRE_DAA    票龄/领取龄门槛(DAA 数, 整数, [1, 2^32-1])。默认 25,920,000(≈30 天 @1 DAA/s)——仅非主网/非"不收 KAS"模式有默认。
// 失败即抛(fail-closed): 主网(或 KANET_NO_KAS_STAKE_MODE=1 / 网络未配未知)缺任一 env ⇒ throw, 不回落到任何默认; 非主网缺 sink ⇒ 也 throw
// (没有"合理默认"的 sink, 烤一个已知私钥/全零 sink 会静默造出可被花走/不可回收的票)。测试/脚本可显式传参覆盖, 不碰 env。
// 复用: 网络判断走 mainnet-no-kas-stake-gate.noKasStakeModeOn(单源, 已含 configuredNetwork), 不另写。
import { noKasStakeModeOn } from './mainnet-no-kas-stake-gate.mjs';

export const SINK_PK_ENV = 'ZK_SYSTEM_SINK_PK';
export const RETIRE_DAA_ENV = 'ZK_CLAIM_RETIRE_DAA';
export const DEFAULT_RETIRE_DAA = 25_920_000;
export const MAX_RETIRE_DAA = 0xFFFFFFFF;   // OpCheckSequenceVerify 的 N 上界(2^32)

/** @returns {{sinkPkHex:string, retireDaa:number}} */
export function resolveSinkConfig({ sinkPkHex, retireDaa } = {}, env = process.env) {
  const strict = noKasStakeModeOn(env);
  const rawSink = sinkPkHex ?? env[SINK_PK_ENV];
  if (!/^[0-9a-f]{64}$/.test(String(rawSink || ''))) {
    throw new Error(`zk-sink-config: ${SINK_PK_ENV} 必须是 64 位小写 hex(x-only 公钥)${strict ? '(主网/不收 KAS 模式 fail-closed, 无默认)' : '(无默认, fail-closed)'}; 现值=${rawSink ? String(rawSink).slice(0, 8) + '…' : '(未设)'}`);
  }
  if (/^0+$/.test(rawSink)) throw new Error(`zk-sink-config: ${SINK_PK_ENV} 不得为全零`);
  let rawDaa = retireDaa ?? env[RETIRE_DAA_ENV];
  if (rawDaa === undefined || rawDaa === null || rawDaa === '') {
    if (strict) throw new Error(`zk-sink-config: ${RETIRE_DAA_ENV} 未设(主网/不收 KAS 模式 fail-closed, 无默认)`);
    rawDaa = DEFAULT_RETIRE_DAA;
  }
  const n = typeof rawDaa === 'string' ? (/^[0-9]+$/.test(rawDaa) ? Number(rawDaa) : NaN) : rawDaa;
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_RETIRE_DAA) throw new Error(`zk-sink-config: ${RETIRE_DAA_ENV} 必须是 [1, ${MAX_RETIRE_DAA}] 的整数, got ${rawDaa}`);
  return { sinkPkHex: rawSink, retireDaa: n };
}
