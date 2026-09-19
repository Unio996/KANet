// proto-convert-to-claim-witness.mjs — RootClose.convert_to_claim(结算批5)的真实 entry witness ABI 编码
// (J2 2026-09-19, 实现计划v0.6 §2.3批5)。
//
// 同 proto-close-commit-witness.mjs 的理由: 不重新实现编码逻辑——`proto-convert-to-rootclose-witness.mjs`
// 的编码器按真实编译产物 `entryAbi.params` 声明顺序动态派发, 不依赖 entry 名字或固定参数顺序(批3 simnet
// 真实 ACCEPT、NWT 三个独立来源逐字节验证过)。convert_to_claim 的参数(claimOutIdx/claim_prefix/claim_suffix/
// tokenInIdx/tokenOutIdx/tok_prefix/tok_suffix)全部落在它已支持的类型里(int / bytes), 原样复用。
export { encodeConvertToRootcloseAction as encodeConvertToClaimAction, combineActionAndRedeem } from './proto-convert-to-rootclose-witness.mjs';
