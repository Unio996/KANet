// zk-sink-config.mjs — 账本 1850 严格零方案: 烤进 PoolSideTicket / KanetTokenClaim 模板的两个 ctor 常量的【单一读取点】。
//   ZK_SYSTEM_SINK_PK      系统 sink 公钥(64 hex, x-only)。ticket sweep / claim retire 的唯一去向。
//   ZK_CLAIM_RETIRE_DAA    claim 领取龄门槛(DAA 数, 整数, [1, 2^32-1])。默认 25,920,000(= 30 天 @10 DAA/s, Kaspa 10 BPS)——仅非主网/非"不收 KAS"模式有默认。
//   ZK_TICKET_SWEEP_DAA    票龄门槛(DAA 数)。默认 315,360,000(= 365 天); 所有网络都有默认(只意味着 dust 在票里多锁一阵, 只有 sink 能取)。
//                          与 RETIRE_DAA 分离(Bettor 2026-10-05): claim 龄从【结算后】起算, 票龄从【首注铸票】起算, 市场寿命 ≤ 票龄 - 60 天由 create-v07 守(assertDeadlineWithinTicketAge)。
// 失败即抛(fail-closed): 主网(或 KANET_NO_KAS_STAKE_MODE=1 / 网络未配未知)缺任一 env ⇒ throw, 不回落到任何默认; 非主网缺 sink ⇒ 也 throw
// (没有"合理默认"的 sink, 烤一个已知私钥/全零 sink 会静默造出可被花走/不可回收的票)。测试/脚本可显式传参覆盖, 不碰 env。
// 复用: 网络判断走 mainnet-no-kas-stake-gate.noKasStakeModeOn(单源, 已含 configuredNetwork), 不另写。
import { noKasStakeModeOn } from './mainnet-no-kas-stake-gate.mjs';

export const SINK_PK_ENV = 'ZK_SYSTEM_SINK_PK';
export const RETIRE_DAA_ENV = 'ZK_CLAIM_RETIRE_DAA';
export const DEFAULT_RETIRE_DAA = 25_920_000;       // 30 天 × 86400 × 10 BPS
export const SWEEP_DAA_ENV = 'ZK_TICKET_SWEEP_DAA';
export const DEFAULT_TICKET_SWEEP_DAA = 315_360_000;   // 365 天
export const DAA_PER_SECOND = 10;                       // Kaspa 主网 10 BPS(simnet 视矿工节奏, 彩排用 env 覆盖)
export const SETTLEMENT_MARGIN_SEC = 60 * 86400;        // 结算余量 60 天
export const MAX_RETIRE_DAA = 0xFFFFFFFF;   // OpCheckSequenceVerify 的 N 上界(2^32)

/** @returns {{sinkPkHex:string, retireDaa:number, sweepDaa:number}} */
export function resolveSinkConfig({ sinkPkHex, retireDaa, sweepDaa } = {}, env = process.env) {
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
  const rawSweep = sweepDaa ?? (env[SWEEP_DAA_ENV] === undefined || env[SWEEP_DAA_ENV] === '' ? DEFAULT_TICKET_SWEEP_DAA : env[SWEEP_DAA_ENV]);
  const sw = typeof rawSweep === 'string' ? (/^[0-9]+$/.test(rawSweep) ? Number(rawSweep) : NaN) : rawSweep;
  if (!Number.isSafeInteger(sw) || sw < 1 || sw > MAX_RETIRE_DAA) throw new Error(`zk-sink-config: ${SWEEP_DAA_ENV} 必须是 [1, ${MAX_RETIRE_DAA}] 的整数, got ${rawSweep}`);
  return { sinkPkHex: rawSink, retireDaa: n, sweepDaa: sw };
}

/**
 * create-v07 守卫(Bettor 2026-10-05): 市场不得比它的票活得久。deadline(Unix 秒) ≤ now + sweepDaa/DAA_PER_SECOND - 60 天, 否则 ⇒ 返回错误串(调用方回 400)。
 * 通过 ⇒ null。参数全显式(纯函数), env 解析由调用方做(resolveSinkConfig)。
 */
export function assertDeadlineWithinTicketAge({ deadlineSec, nowSec, sweepDaa, daaPerSecond = DAA_PER_SECOND, marginSec = SETTLEMENT_MARGIN_SEC }) {
  const maxSec = nowSec + Math.floor(sweepDaa / daaPerSecond) - marginSec;
  if (!Number.isFinite(deadlineSec) || deadlineSec > maxSec) {
    return `deadline 晚于 票龄 - 结算余量: 市场不得比其 dust 票(ZK_TICKET_SWEEP_DAA=${sweepDaa} DAA ≈ ${Math.floor(sweepDaa / daaPerSecond / 86400)} 天)活得久; 最晚允许 ${new Date(maxSec * 1000).toISOString()}`;
  }
  return null;
}
