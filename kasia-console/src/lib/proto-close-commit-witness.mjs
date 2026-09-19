// proto-close-commit-witness.mjs — RootClose.close_commit(结算批4)的真实 entry witness ABI 编码
// (J2 2026-09-19, 实现计划v0.5 §2.2批4)。
//
// 🔴 不重新实现编码逻辑: `proto-convert-to-rootclose-witness.mjs`里的编码器名字虽然叫
// "ConvertToRootclose"，但内部完全通用——按真实编译产物`entryAbi.params`声明顺序动态派发编码，
// 不依赖 entry 名字或固定参数顺序（同一段代码此前已用于`ShardLeaf_direct.convert_to_rootclose`，
// 批3simnet真实ACCEPT过）。close_commit的witness编码原样复用同一份实现，只在本文件里换个名字
// 导出，避免调用方读代码时以为两个不同entry对应两套独立实现（Bettor审实现计划v0.1"import复用
// 不复制粘贴"要求）。
export { encodeConvertToRootcloseAction as encodeCloseCommitAction, combineActionAndRedeem } from './proto-convert-to-rootclose-witness.mjs';
