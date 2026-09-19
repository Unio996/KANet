// proto-mass-ceiling.mjs — 构造期mass上限fail-closed断言(J2 2026-09-19, Bettor账本1497要求,
// 实现计划v0.4新增MUST)。
//
// 背景(账本1497 Bettor实例): 同一个register_append#1逻辑步骤, J2这次真实测得storageMass=457,504
// (约91.5%), NWT此前审计构造是445,518(89.10%)——同一步骤因UTXO形状不同就浮动了约1.2万。"设计里
// 算过一次没超"不构成运行期保证, 必须在**每一次真实构造**完成后、任何IPC/广播之前, 用**本次这笔
// 交易的真实构造结果**重新核一遍两个维度的mass, 都在阈值内才放行。
//
// 保守口径(设计文档§0.14b已确认的事实——kaspa-wasm本地calculateTransactionMass与节点真实值有
// 系统性偏差, 且方向不固定: 复杂covenant交易本地偏高, 极简单输入交易本地偏低约1/9.5): 不能只信
// 本地wasm数字。本模块取三个信号的较大值: ①本地kaspa.calculateTransactionMass(单一合并值,
// 用作粗筛); ②按D-019 pin consensus真实源码(consensus/core/src/mass/mod.rs::calc_storage_mass)
// 手算的storage mass(真实KIP-9公式, 精确到plurality); ③按同一份源码手算的compute mass(v1交易
// 用GRAMS_PER_COMPUTE_BUDGET_UNIT×Σcompute_budget, 不用sig_op_count)。任一信号超过阈值即拒绝。
//
// plurality判定(账本1497遗留的已知简化, 如实记录): OUTPUT侧从tx.outputs[i].covenant是否存在
// 精确判定(p=2 covenant / p=1普通, 直接读真实tx对象, 不猜)。INPUT侧的plurality这份kaspa-wasm
// 绑定的TransactionInput.utxo结构里**没有covenant标志字段可读**(只有scriptPublicKey/amount)——
// 调用方(各builder)构造每个输入时本来就知道"这是covenant续约输入还是普通fee输入", 因此INPUT侧
// plurality要求调用方显式传入(inputPluralities数组, 与tx.inputs顺序一一对应), 不在本模块内部
// 用脚本长度猜测(猜测在边界情况会算错, 显式传入更准确, 且调用方多写一个数组不是负担)。

const STORAGE_MASS_PARAMETER = 100_000_000n * 10_000n; // = SOMPI_PER_KASPA(1e8) × 10_000 = 1e12(consensus/core/src/constants.rs)
const GRAMS_PER_COMPUTE_BUDGET_UNIT = 100n; // consensus/core/src/mass/units.rs
const MASS_PER_TX_BYTE = 1n; // consensus/core/src/config/params.rs(全网络配置一致值)
const MASS_PER_SCRIPT_PUBKEY_BYTE = 10n;

export const MASS_CEILING_MAX = 500_000; // block mass上限(storage/compute两个维度各自的硬顶)
export const MASS_CEILING_FRACTION = 0.95; // Bettor账本1497要求: 不卡在100%, 留余量——同一逻辑
// 步骤实测浮动过约1.2万(445,518→457,504), 500,000×0.95=475,000, 留出的余量(25,000)覆盖了这次
// 实测浮动的2倍以上, 不是拍脑袋的数字。
export const MASS_CEILING_THRESHOLD = Math.floor(MASS_CEILING_MAX * MASS_CEILING_FRACTION);

function scriptByteLen(scriptHexNoPrefix) {
  // kaspa-wasm的ScriptPublicKey.script是hex字符串(无0x前缀, 账本1473已确认的既有坑), 字节数=hex长度/2。
  return Math.floor(String(scriptHexNoPrefix).length / 2);
}

/** UTXO_CONST_STORAGE(63)+spk字节数+(有covenant?32:0), 向上取整到100字节单位。 */
function utxoPlurality(scriptByteCount, hasCovenant) {
  const base = 63 + scriptByteCount + (hasCovenant ? 32 : 0);
  return BigInt(Math.ceil(base / 100));
}

/**
 * 手算storage mass(consensus/core/src/mass/mod.rs::calc_storage_mass真实公式的JS移植, 只做
 * "relaxed formula不成立时的一般情形"这一支的保守近似——用arithmetic mean for inputs, 与真实
 * consensus在|O|≠1且|I|≠1且不是|O|=|I|=2这个最常见情形下走的分支一致; 边界情形(|O|=1等)本函数
 * 不做relaxed分支特判, 会略微高估(harmonic对inputs的信用通常比arithmetic更慷慨)——高估是安全
 * 方向的偏差, 符合"保守口径"要求, 不会把真实会被拒的交易误判为安全, 顶多把某些真实安全的边界
 * case误判为需要换面值重试, 代价是可接受的。
 * @param {{plurality:bigint, amountSompi:bigint}[]} outputs
 * @param {{plurality:bigint, amountSompi:bigint}[]} inputs
 * @returns {bigint}
 */
export function handComputeStorageMass(outputs, inputs) {
  let harmonicOuts = 0n;
  for (const o of outputs) {
    if (o.amountSompi <= 0n) throw new Error('handComputeStorageMass: output amount必须>0');
    harmonicOuts += (STORAGE_MASS_PARAMETER * o.plurality * o.plurality) / o.amountSompi;
  }
  let sumInsAmount = 0n, sumInsPlurality = 0n;
  for (const i of inputs) {
    if (i.amountSompi <= 0n) throw new Error('handComputeStorageMass: input amount必须>0');
    sumInsAmount += i.amountSompi; sumInsPlurality += i.plurality;
  }
  const meanIns = sumInsPlurality > 0n ? (sumInsAmount / sumInsPlurality) : 1n;
  const arithmeticIns = sumInsPlurality * (STORAGE_MASS_PARAMETER / (meanIns > 0n ? meanIns : 1n));
  const diff = harmonicOuts - arithmeticIns;
  return diff > 0n ? diff : 0n;
}

/**
 * 手算compute mass(v1交易分支, consensus/core/src/mass/mod.rs::calc_non_contextual_masses真实
 * 公式的JS移植——只算v1用的compute_budget项+按字节的size/scriptPubKey项, 不算v0的sig_op_count项
 * 因为本仓结算交易全部是version=1, 见MUST-1)。
 * @param {number} txByteSize  真实序列化字节数估算(粗略即可, 这一项在covenant交易里通常不是瓶颈,
 *   传0也不影响"是否超阈值"这个判定的保守性——本函数主要目的是把compute_budget项算准)
 * @param {number} totalScriptPubKeyBytes  全部output的scriptPublicKey字节数之和
 * @param {number[]} computeBudgets  每个input的compute_budget值(如PROTO_V0_COMPUTE_BUDGET)
 * @returns {bigint}
 */
export function handComputeComputeMass(txByteSize, totalScriptPubKeyBytes, computeBudgets) {
  const sizeMass = BigInt(txByteSize) * MASS_PER_TX_BYTE;
  const spkMass = BigInt(totalScriptPubKeyBytes) * MASS_PER_SCRIPT_PUBKEY_BYTE;
  const budgetMass = computeBudgets.reduce((acc, b) => acc + GRAMS_PER_COMPUTE_BUDGET_UNIT * BigInt(b), 0n);
  return sizeMass + spkMass + budgetMass;
}

/**
 * 构造完成后、任何IPC/广播之前调用——三个信号(本地wasm/手算storage/手算compute)任一超过阈值即throw。
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.network
 * @param {*} o.tx  已finalize的kaspa.Transaction(或至少outputs/inputs已确定, calculateTransactionMass可调)
 * @param {bigint[]} o.inputPluralities  与tx.inputs顺序一一对应, 每个input的plurality(调用方
 *   显式给出——covenant续约/genesis input传2n, 普通fee input传1n)
 * @param {bigint} o.feeUtxoValueSompi  本次选中的fee UTXO面值(仅用于错误文案, 方便换面值重试)
 * @param {string} [o.label]  错误文案标注是哪个builder(如'market_seal')
 */
export function assertMassWithinCeiling({ kaspa, network, tx, inputPluralities, feeUtxoValueSompi, label = 'unknown' }) {
  if (!Array.isArray(inputPluralities) || inputPluralities.length !== tx.inputs.length) {
    throw new Error(`assertMassWithinCeiling(${label}): inputPluralities长度(${inputPluralities?.length})必须等于tx.inputs.length(${tx.inputs.length})`);
  }
  const localMass = Number(kaspa.calculateTransactionMass(network, tx));

  const outputs = [];
  let totalScriptPubKeyBytes = 0;
  for (const out of tx.outputs) {
    const scriptHex = out.scriptPublicKey.script;
    const byteLen = scriptByteLen(scriptHex);
    totalScriptPubKeyBytes += byteLen + 2; // +2 = script_public_key version(u16), 同consensus源码
    const hasCovenant = !!out.covenant;
    outputs.push({ plurality: utxoPlurality(byteLen, hasCovenant), amountSompi: BigInt(out.value) });
  }
  const inputs = [];
  const computeBudgets = [];
  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    inputs.push({ plurality: inputPluralities[i], amountSompi: BigInt(inp.utxo.amount) });
    computeBudgets.push(Number(inp.computeBudget ?? 0));
  }
  const handStorage = handComputeStorageMass(outputs, inputs);
  const handCompute = handComputeComputeMass(0, totalScriptPubKeyBytes, computeBudgets);

  const signals = { localMass, handStorage: Number(handStorage), handCompute: Number(handCompute) };
  const worst = Math.max(signals.localMass, signals.handStorage, signals.handCompute);
  if (worst >= MASS_CEILING_THRESHOLD) {
    throw new Error(
      `assertMassWithinCeiling(${label}): 构造出的交易mass超过安全阈值(${MASS_CEILING_THRESHOLD}=` +
      `${MASS_CEILING_MAX}×${MASS_CEILING_FRACTION}) — 本地wasm=${signals.localMass}, ` +
      `手算storage=${signals.handStorage}, 手算compute=${signals.handCompute}(三者取较大值=${worst})。` +
      `所选fee UTXO面值=${feeUtxoValueSompi} sompi——请换一枚不同面值的fee UTXO重试(不同面值会改变` +
      `storage mass的harmonic/arithmetic项, 换一枚通常足以脱离超限区间)。`,
    );
  }
  return signals;
}
