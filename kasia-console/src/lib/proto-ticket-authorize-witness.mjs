// proto-ticket-authorize-witness.mjs — PoolSideTicket.authorize_spend(sig bettorSig) 的真实 entry witness ABI 编码(J2 2026-09-19)。
// claim_draw(批6)消费 ticket 输入与输家 ticket 自我回收(批8)是同一个入口, 共用本文件(计划 §1.1 原列 proto-ticket-reclaim-witness.mjs 仅批8用,
// 这里按"import 复用不复制"改名为两批共用)。'sig' 类型要求 65 字节(64B schnorr + 1B sighash 类型)。
export { encodeConvertToRootcloseAction as encodeAuthorizeSpendAction, combineActionAndRedeem } from './proto-convert-to-rootclose-witness.mjs';
