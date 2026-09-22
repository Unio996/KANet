// proto-close-commit-gate.mjs — B4-2 根治(Bettor 2026-09-19): 驱动层判"能否提交 close_commit"【不用墙钟】, 读节点
// getBlockDagInfo 的 pastMedianTime: pmt > deadline(+30s 小余量)即可提交。builder 里的 300s 墙钟守卫保留为第二层。
// 这样本机时钟没做 NTP 也不影响判断(节点 finality 本来比较的就是 lock_time < 区块头 past-median-time)。
//
// 同一个 pmt 也用来判 refund_flip SLA(B4-3): RootClose.refund_flip 要求 tx.time >= deadline+7,200,000ms, 同样按 pmt 判定 finality,
// 所以"deadline+1h 报警 / deadline+2h 之后任何人可把 closed 0→2"也以 pmt 为准。
//
// 纯函数 + 一个注入 rpc 的读取器; 本文件不接线(驱动接线是批9), 只提供可测的判据。

import { REFUND_GRACE_SEC } from './pool-refund-grace.mjs';

/** 节点 finality 是 lock_time < pmt(严格小于); 再留 30s 小余量。 */
export const CLOSE_COMMIT_PMT_MARGIN_MS = 30_000;
/** refund_flip 的合约常量: deadline_ms + 7,200,000(RootClose.sil refund_flip, NWT 批4 B4-3)。
 *  🔴 D-031 漏项(Owner 追问后核出, 账本1624): 老自动退款路(services/bettor-refund-claim-auto.mjs 等)
 *  的 REFUND_GRACE_SEC(pool-refund-grace.mjs, PoolSpine/PoolSide 系 SS 用)同样是 7200 秒——不留两份
 *  "2 小时"各自维护, 从那个单一真相源导入乘 1000(该常量本身是【秒】, RootClose.sil 侧要的是【毫秒】)。
 *  两边合约家族不同(老 SS 用 REFUND_GRACE_SEC 直接乘 1000 做 tx.time 下界; RootClose.sil 的
 *  refund_flip 走同款 pmt 门 + CLOSE_COMMIT_PMT_MARGIN_MS 余量), 数值上没有理由不同——若日后两者需要
 *  分叉出不同的宽限期, 在这里显式拆开, 不要悄悄各自改各自的字面量。 */
export const REFUND_FLIP_GRACE_MS = REFUND_GRACE_SEC * 1000;
/** deadline+1h 起报警。 */
export const CLOSE_COMMIT_SLA_WARN_MS = 3_600_000;

/** 从 rpc(kaspa-wasm RpcClient 形状)读 pastMedianTime(毫秒 number); 读不到/非法 ⇒ throw(调用方按"不能提交"处理, fail-closed)。 */
export async function readPastMedianTimeMs(rpc) {
  const info = await rpc.getBlockDagInfo();
  const pmt = Number(info?.pastMedianTime);
  if (!Number.isFinite(pmt) || pmt <= 0) throw new Error(`readPastMedianTimeMs: getBlockDagInfo.pastMedianTime 不可用(${info?.pastMedianTime}), 无法判定 close_commit 能否提交`);
  return pmt;
}

/**
 * @param {{pastMedianTimeMs:number, deadlineMs:number}} o
 * @returns {{canSubmit:boolean, reason:string, pmtLeadMs:number, sla:'ok'|'warn'|'refund_flip_open'}}
 *   pmtLeadMs = pmt − deadline(负数 = pmt 还没追上 deadline)。
 *   sla: 以 pmt 计, deadline+1h ≤ pmt ⇒ 'warn'(应报警); pmt ≥ deadline+2h ⇒ 'refund_flip_open'(任何人可翻 closed 0→2, close_commit 有被抢先风险)。
 */
export function evaluateCloseCommitTiming({ pastMedianTimeMs, deadlineMs }) {
  const pmt = Number(pastMedianTimeMs), dl = Number(deadlineMs);
  if (!Number.isFinite(pmt) || !Number.isFinite(dl) || pmt <= 0 || dl <= 0) throw new Error(`evaluateCloseCommitTiming: pastMedianTimeMs(${pastMedianTimeMs})/deadlineMs(${deadlineMs}) 必须是正数`);
  const lead = pmt - dl;
  const sla = lead >= REFUND_FLIP_GRACE_MS ? 'refund_flip_open' : lead >= CLOSE_COMMIT_SLA_WARN_MS ? 'warn' : 'ok';
  if (lead < CLOSE_COMMIT_PMT_MARGIN_MS) {
    return { canSubmit: false, reason: `pmt(${pmt}) 尚未超过 deadline(${dl}) + ${CLOSE_COMMIT_PMT_MARGIN_MS}ms(领先 ${lead}ms): 节点会以 NotFinalized 拒绝(lock_time < pmt 严格小于), 稍后重试(无状态变更)`, pmtLeadMs: lead, sla };
  }
  return { canSubmit: true, reason: 'pmt 已超过 deadline + 余量', pmtLeadMs: lead, sla };
}

/** 读 pmt 并评估——rpc 读取失败 ⇒ canSubmit=false(fail-closed, 不因读不到就放行)。 */
export async function checkCloseCommitTiming({ rpc, deadlineMs }) {
  let pmt;
  try { pmt = await readPastMedianTimeMs(rpc); } catch (e) { return { canSubmit: false, reason: `读 pastMedianTime 失败: ${e.message}`, pmtLeadMs: null, sla: 'ok' }; }
  return { ...evaluateCloseCommitTiming({ pastMedianTimeMs: pmt, deadlineMs }), pastMedianTimeMs: pmt };
}

/**
 * R-a: refund_flip 的提交闸(pmt 域)。RootClose.refund_flip 要求 tx.time ≥ deadline+7,200,000(lockTime = deadline+REFUND_FLIP_GRACE_MS),
 * 节点 finality 是 lock_time < pmt(严格小于) ⇒ 需要 pmt > lockTime; 再留同一个 30s 余量(与 close_commit 的闸同值、同理由)。
 * 🔴 不复用 evaluateCloseCommitTiming: 它 lead ≥ 30s 就 canSubmit(那是 close 的闸), 拿来判 refund_flip 会在 deadline+30s 就构造广播、被节点 NotFinalized 拒。
 * @param {{pastMedianTimeMs:number, deadlineMs:number}} o
 * @returns {{canSubmit:boolean, reason:string, pmtLeadMs:number, lockTimeMs:number}}
 */
export function evaluateRefundFlipTiming({ pastMedianTimeMs, deadlineMs }) {
  const pmt = Number(pastMedianTimeMs), dl = Number(deadlineMs);
  if (!Number.isFinite(pmt) || !Number.isFinite(dl) || pmt <= 0 || dl <= 0) throw new Error(`evaluateRefundFlipTiming: pastMedianTimeMs(${pastMedianTimeMs})/deadlineMs(${deadlineMs}) 必须是正数`);
  const lockTimeMs = dl + REFUND_FLIP_GRACE_MS, lead = pmt - dl;
  if (pmt < lockTimeMs + CLOSE_COMMIT_PMT_MARGIN_MS) {
    return { canSubmit: false, reason: `pmt(${pmt}) 尚未超过 deadline(${dl}) + ${REFUND_FLIP_GRACE_MS}ms + ${CLOSE_COMMIT_PMT_MARGIN_MS}ms 余量(差 ${lockTimeMs + CLOSE_COMMIT_PMT_MARGIN_MS - pmt}ms): refund_flip 的 lock_time 尚未 finalized, 节点会以 NotFinalized 拒绝`, pmtLeadMs: lead, lockTimeMs };
  }
  return { canSubmit: true, reason: 'pmt 已超过 deadline + 2h + 余量', pmtLeadMs: lead, lockTimeMs };
}
