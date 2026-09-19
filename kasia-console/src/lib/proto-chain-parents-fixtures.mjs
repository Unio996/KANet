// proto-chain-parents-fixtures.mjs — 【仅测试用】各结算步骤 chainParents 的夹具(9-1 E 笔, 设计 v0.3.4 §19.4; F2 笔加 outpoint 绑定)。
//
// chainParents = { [role]: { value: bigint, spkLen: number, hasCovenant: boolean, outpoint:{txid,index} } }, 生产里由 C1(proto-settlement-c1.mjs)从经断言的链上事实产出。
// 这里的字面值【刻意不 import】builder 的 EXPECTED_INPUT_VALUE_SOMPI / *_INPUT_HAS_COVENANT: 夹具与被测的断言用同一份常量就成了自证。
// 值的来源: simnet 全链真实交易(docs/provenance/2026-09-19-j2-fullchain-simnet/)——covenant 输出与输入恒 20,000,000 sompi; 各 covenant / ticket 的 spk 都是
// P2SH(aa20 <32B> 87 = 35 字节); relay fee 输入的 spk 长度取自调用方给的 feeUtxo(P2PK 34 字节)。
// 生产代码不得 import 本文件(chainParents 必须来自链上事实, 不是常量)——由 proto-claim-draw.test.mjs 的 B6 源码扫描守着(NWT E-4)。
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

// step → role → builder 入参里承载该角色 outpoint 的字段名(各 builder 的入参形状不同: seal 的 leafOutpoint / heldInput, claim_draw 的 rootClaimOutpoint / ticketOutpoint …; fee 恒为 feeUtxo)。
// 这是 F2(NWT E-1)的夹具侧: chainParents 的 outpoint 必须取自"builder 实际要花的输入", 所以夹具从入参里读, 而不是另造一份。
const OUTPOINT_FIELD = {
  seal: { leaf: 'leafOutpoint', held: 'heldInput', fee: 'feeUtxo' },
  close_commit: { rootClose: 'rootCloseOutpoint', fee: 'feeUtxo' },
  convert_to_claim: { rootClose: 'rootCloseOutpoint', held: 'heldTokenOutpoint', fee: 'feeUtxo' },
  claim_draw: { rootClaim: 'rootClaimOutpoint', ticket: 'ticketOutpoint', held: 'heldTokenOutpoint', fee: 'feeUtxo' },
};

/** builder 入参里该角色的 outpoint {txid, index}(txid 小写); 入参里没有该字段(测试故意传 null 来触发 builder 自己的前置校验)⇒ null, 不在夹具里抛——让 builder 的前置错误先出。 */
export function roleOutpointOf(step, role, args) {
  const f = OUTPOINT_FIELD[step] && OUTPOINT_FIELD[step][role];
  if (!f || !args[f]) return null;
  return { txid: String(args[f].txid).toLowerCase(), index: Number(args[f].vout) };
}

/** 该步"全部符合 builder 假设"的 chainParents; fee 项取自 feeUtxo(value 与 spk 字节长度), hasCovenant:false; 每项的 outpoint 取自 builder 入参(args)。 */
export function goodChainParents(step, args) {
  const rows = TABLE[step];
  if (!rows) throw new Error(`goodChainParents: 未知步骤 ${step}`);
  const parents = {};
  for (const [role, hasCovenant, value] of rows) parents[role] = { value, spkLen: P2SH_SPK_BYTES, hasCovenant, outpoint: roleOutpointOf(step, role, args) };
  const feeUtxo = args.feeUtxo;
  parents.fee = { value: BigInt(feeUtxo.value), spkLen: String(feeUtxo.scriptPublicKeyHex).replace(/^0x/i, '').length / 2, hasCovenant: false, outpoint: roleOutpointOf(step, 'fee', args) };
  return parents;
}

/** 给 builder 入参对象补上 chainParents(调用方已显式给了就不覆盖; 测试里 `over` 改了 feeUtxo / 某个 outpoint 时, 各项自动跟着重算)。 */
export function withParents(step, args) {
  return { chainParents: goodChainParents(step, args), ...args };
}

/** 该步的输入角色(含 fee)。 */
export function inputRolesOf(step) {
  if (!OUTPOINT_FIELD[step]) throw new Error(`inputRolesOf: 未知步骤 ${step}`);
  return Object.keys(OUTPOINT_FIELD[step]);
}

/**
 * NWT E-1 探针的通用形: 返回一份 builder 入参的拷贝, 其中【某个角色实际要花的 outpoint】被换成另一个(同面值、同 spk——builder 的其它入参一概不动)。
 * 换法随入参形状: leafOutpoint/rootCloseOutpoint/... 是 {txid,vout}; heldInput/feeUtxo 是带 txid/vout 的对象(其余字段保留)。
 */
export function withSwappedOutpoint(step, args, role, { txid, vout }) {
  const f = OUTPOINT_FIELD[step] && OUTPOINT_FIELD[step][role];
  if (!f || !args[f]) throw new Error(`withSwappedOutpoint: ${step}/${role} 在入参里找不到 ${f}`);
  return { ...args, [f]: { ...args[f], txid, vout } };
}
