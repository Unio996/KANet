// proto-chain-parents-fixtures.mjs — 【仅测试用】各结算步骤 chainParents 的夹具(9-1 E 笔, 设计 v0.3.4 §19.4)。
//
// chainParents = { [role]: { value: bigint, spkLen: number, hasCovenant: boolean } }, 生产里由 C1(proto-settlement-c1.mjs)从经断言的链上事实产出。
// 这里的字面值【刻意不 import】builder 的 EXPECTED_INPUT_VALUE_SOMPI / *_INPUT_HAS_COVENANT: 夹具与被测的断言用同一份常量就成了自证。
// 值的来源: simnet 全链真实交易(docs/provenance/2026-09-19-j2-fullchain-simnet/)——covenant 输出与输入恒 20,000,000 sompi; 各 covenant / ticket 的 spk 都是
// P2SH(aa20 <32B> 87 = 35 字节); relay fee 输入的 spk 长度取自调用方给的 feeUtxo(P2PK 34 字节)。
// 生产代码不得 import 本文件(chainParents 必须来自链上事实, 不是常量)。
const CONT = 20_000_000n;
const GEN = 20_000_000n;
const P2SH_SPK_BYTES = 35;

// step → [[role, hasCovenant, value]…](不含 fee)
const TABLE = {
  seal: [['leaf', true, CONT], ['held', true, GEN]],
  close_commit: [['rootClose', true, CONT]],
  convert_to_claim: [['rootClose', true, CONT], ['held', true, GEN]],
  claim_draw: [['rootClaim', true, CONT], ['ticket', false, GEN], ['held', true, GEN]],
};

/** 该步"全部符合 builder 假设"的 chainParents; fee 项取自 feeUtxo(value 与 spk 字节长度), hasCovenant:false。 */
export function goodChainParents(step, feeUtxo) {
  const rows = TABLE[step];
  if (!rows) throw new Error(`goodChainParents: 未知步骤 ${step}`);
  const parents = {};
  for (const [role, hasCovenant, value] of rows) parents[role] = { value, spkLen: P2SH_SPK_BYTES, hasCovenant };
  parents.fee = { value: BigInt(feeUtxo.value), spkLen: String(feeUtxo.scriptPublicKeyHex).replace(/^0x/i, '').length / 2, hasCovenant: false };
  return parents;
}

/** 给 builder 入参对象补上 chainParents(调用方已显式给了就不覆盖; 测试里 `over` 改了 feeUtxo 时 fee 项自动跟着重算)。 */
export function withParents(step, args) {
  return { chainParents: goodChainParents(step, args.feeUtxo), ...args };
}
