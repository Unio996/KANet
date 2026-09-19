// proto-claim-draw-witness.mjs — RootClaim.claim_draw(结算批6)的真实 entry witness ABI 编码(J2 2026-09-19)。
// 同 proto-close-commit-witness.mjs / proto-convert-to-claim-witness.mjs 的理由: 不重新实现——proto-convert-to-rootclose-witness.mjs 的编码器按真实
// 编译产物 entryAbi.params 声明顺序动态派发(int / bytes / byte[32][] 动态数组都已支持: dynamic_array 走 encodeArrayPayload, 空数组=空 push)。
export { encodeConvertToRootcloseAction as encodeClaimDrawAction, combineActionAndRedeem } from './proto-convert-to-rootclose-witness.mjs';
