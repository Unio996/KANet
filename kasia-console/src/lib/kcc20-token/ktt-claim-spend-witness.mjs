// proto-ktt-claim-spend-witness.mjs — KanetTokenClaim.spend(结算批7 withdraw)的真实 entry witness ABI 编码(J2 2026-09-19)。
// 同 proto-claim-draw-witness.mjs 的理由: 不重新实现——通用动态 ABI 编码器已支持 sig(65B)/int/bool/bytes 类型。
export { encodeConvertToRootcloseAction as encodeKtcSpendAction, combineActionAndRedeem } from '../proto-convert-to-rootclose-witness.mjs';
