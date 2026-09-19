// proto-mass-ceiling.mjs — 构造期mass上限fail-closed断言(J2 2026-09-19, Bettor账本1497 MUST;
// 2026-09-19 按NWT红队审verdict D1-D5重写)。
//
// 背景: 同一个register_append#1逻辑步骤, 实测storageMass因UTXO形状不同浮动约1.2万(445,518→457,504)。"设计里
// 算过一次没超"不构成运行期保证, 必须在**每一次真实构造**完成后、任何IPC/广播之前, 用**本次这笔交易的真实
// 构造结果**重新核storage/compute两个维度, 都在阈值内才放行。
//
// 🔴 重写原因(v0.7对账, docs/provenance/2026-09-19-j2-mass-signal-reconciliation/): 旧版取"本地wasm
// calculateTransactionMass / 手算storage / 手算compute"三者最大值门控, 而本地wasm值是估算(对复杂covenant交易
// 在批3三个形状上分别偏高+9.5%/+40.4%/+51.2%, 且95M那行已高于500,000硬顶而节点实际接受), 把节点可接受的交易
// 挡在链外; 手算compute又漏了tx序列化大小项(传0)。现改为:
//   - 门控信号 = 按rusty-kaspa v2.0.1 consensus源码(cfafeb4c, consensus/core/src/mass/mod.rs)逐行移植的
//     精确storage mass(含relaxed分支)与精确compute mass, 两个维度各自与阈值比较;
//   - localMass(本地wasm估算)只作诊断项记录/返回, 不参与门控;
//   - 阈值不动: 500,000×0.95=475,000; relay侧SIGNED_INPUT_CEILING_SOMPI(1.0 KAS)硬顶不动。
// 精确性证据: NWT独立移植对4笔真实上链交易节点值8/8逐位吻合; 本文件另在proto-mass-ceiling.test.mjs里用节点取回的
// 4笔真实交易(父输出现算plurality/amount)再核一遍, 并与NWT的独立移植做随机形状对拍。
//
// 输入侧facts: amount与spk长度取自交易输入自带的utxo; "是否带covenant"这一位由builder显式传入inputHasCovenant——
// 🔴 如实说明: 这是【builder声明 + spk形状交叉核对】, 不是纯从UTXO事实推导(kaspa-wasm的utxo对象虽有covenantId
// 字段, 但设了会改变序列化字节、可能影响sighash, 故不写回tx)。缺失/长度不符/非boolean/声明带covenant却不是
// 35字节P2SH即fail-closed。
// 关于输入amount: 它与签名所用的是同一份UTXO数据(sighash承诺输入amount); 调用方给的amount若低于链上真值, 签名
// 即不成立、节点直接拒收, 不丢钱也绕不过守卫——所以本函数【不再独立核对】输入amount是否等于relay UTXO快照
// (Bettor 2026-09-19裁定撤回该条, 不为此改既有money-path函数签名)。

// ── consensus常量(rusty-kaspa v2.0.1 cfafeb4c) ──
const STORAGE_MASS_PARAMETER = 100_000_000n * 10_000n; // consensus/core/src/constants.rs: SOMPI_PER_KASPA × 10_000
const GRAMS_PER_COMPUTE_BUDGET_UNIT = 100n; // mass/mod.rs 经 mass::units
const MASS_PER_TX_BYTE = 1n; // 全网络配置一致值(params.rs)
const MASS_PER_SCRIPT_PUBKEY_BYTE = 10n;
const TRANSIENT_BYTE_TO_MASS_FACTOR = 4n; // constants.rs:36, 仅作诊断项
const HASH_SIZE = 32n;
const SUBNETWORK_ID_SIZE = 20n;
const U64_MAX = (1n << 64n) - 1n;
/** 签名后relay签名输入的sigScript长度: createInputSignature输出66字节(push-opcode 0x41 + 64字节签名 + 1字节sighash类型)。 */
export const SIGNED_INPUT_SIGSCRIPT_BYTES = 66;

export const MASS_CEILING_MAX = 500_000; // block mass上限(storage/compute两个维度各自的硬顶)
export const MASS_CEILING_FRACTION = 0.95; // Bettor账本1497: 不卡在100%, 留余量(同一逻辑步骤实测浮动过约1.2万)
export const MASS_CEILING_THRESHOLD = Math.floor(MASS_CEILING_MAX * MASS_CEILING_FRACTION); // 475,000

const scriptHexNoPrefix = (s) => String(s).replace(/^0x/, '');
const scriptByteLen = (scriptHex) => scriptHexNoPrefix(scriptHex).length / 2;

/** UTXO_CONST_STORAGE(63=32+4+8+8+1+2+8)+spk字节数+(有covenant?32:0), 向上取整到100字节单位(consensus utxo_plurality)。 */
export function utxoPlurality(spkByteLen, hasCovenant) {
  const base = 63n + BigInt(spkByteLen) + (hasCovenant ? HASH_SIZE : 0n);
  return (base + 99n) / 100n;
}

function checkedU64(v, what) {
  if (v > U64_MAX) throw new Error(`mass中间值溢出u64(${what}=${v}) — consensus对此返回None(不可计算, 视为过高), 按fail-closed处理`);
  return v;
}

/**
 * consensus/core/src/mass/mod.rs::calc_storage_mass 的逐行移植(含relaxed分支)。
 * @param {{plurality:bigint, amountSompi:bigint}[]} ins
 * @param {{plurality:bigint, amountSompi:bigint}[]} outs
 * @returns {{mass:bigint, path:'relaxed'|'arithmetic'}}
 */
export function calcStorageMassExact(ins, outs) {
  if (!ins.length) throw new Error('calcStorageMassExact: 至少需要一个输入');
  let outsPlurality = 0n, harmonicOuts = 0n;
  for (const o of outs) {
    if (o.amountSompi <= 0n) throw new Error('calcStorageMassExact: output amount必须>0(consensus前置假设)');
    outsPlurality += o.plurality;
    const cp = checkedU64(STORAGE_MASS_PARAMETER * o.plurality, 'C×p');
    const cpp = checkedU64(cp * o.plurality, 'C×p×p');
    harmonicOuts = checkedU64(harmonicOuts + cpp / o.amountSompi, 'harmonic_outs');
  }
  // |O|=1 或 |I|=1 或 |O|=|I|=2 走relaxed(harmonic对harmonic); |I|=1时harmonic与arithmetic重合。
  let relaxed;
  if (outsPlurality === 1n) relaxed = true;
  else if (ins.length > 2) relaxed = false; // 元素plurality恒>=1 ⇒ ins_plurality>2
  else {
    const insPlurality = ins.reduce((s, c) => s + c.plurality, 0n);
    relaxed = insPlurality === 1n || (outsPlurality === 2n && insPlurality === 2n);
  }
  const sat = (x, y) => (x > y ? x - y : 0n);
  if (relaxed) {
    let harmonicIns = 0n;
    for (const i of ins) {
      if (i.amountSompi <= 0n) throw new Error('calcStorageMassExact: input amount必须>0');
      harmonicIns += STORAGE_MASS_PARAMETER * i.plurality * i.plurality / i.amountSompi;
    }
    return { mass: sat(harmonicOuts, harmonicIns), path: 'relaxed' };
  }
  let insPlurality = 0n, sumIns = 0n;
  for (const i of ins) {
    if (i.amountSompi <= 0n) throw new Error('calcStorageMassExact: input amount必须>0');
    insPlurality += i.plurality; sumIns += i.amountSompi;
  }
  let meanIns = sumIns / insPlurality; if (meanIns < 1n) meanIns = 1n;
  const arithmeticIns = insPlurality * (STORAGE_MASS_PARAMETER / meanIns);
  return { mass: sat(harmonicOuts, arithmeticIns), path: 'arithmetic' };
}

/**
 * consensus mass/mod.rs::transaction_estimated_serialized_size 的逐行移植。
 * @param {{version:number, inputs:{sigScriptBytes:number}[], outputs:{spkByteLen:number, hasCovenant:boolean}[], payloadBytes:number}} f
 */
export function estimatedSerializedSize(f) {
  let size = 2n + 8n; // version(u16) + 输入个数(u64)
  for (const i of f.inputs) size += HASH_SIZE + 4n + 8n + BigInt(i.sigScriptBytes) + 8n + (f.version >= 1 ? 2n : 0n);
  size += 8n; // 输出个数
  for (const o of f.outputs) size += 8n + 2n + 8n + BigInt(o.spkByteLen) + (o.hasCovenant ? 2n + HASH_SIZE : 0n);
  size += 8n + SUBNETWORK_ID_SIZE + 8n + HASH_SIZE + 8n + BigInt(f.payloadBytes); // lock_time + subnetwork + gas + payload hash + payload长度 + payload
  return size;
}

/**
 * consensus calc_non_contextual_masses(v1交易分支)的逐行移植: compute = size×1 + Σ(2+spkLen)×10 + 100×Σcompute_budget。
 * @param {{version:number, inputs:{sigScriptBytes:number, computeBudget:number}[], outputs:{spkByteLen:number, hasCovenant:boolean}[], payloadBytes:number}} f
 * @returns {{compute:bigint, transient:bigint, size:bigint}}
 */
export function calcComputeMassExact(f) {
  if (f.version < 1) throw new Error(`calcComputeMassExact: 只实现v1交易分支(本仓结算交易全部version=1), 实际version=${f.version}`);
  const size = estimatedSerializedSize(f);
  let spkTotal = 0n; for (const o of f.outputs) spkTotal += 2n + BigInt(o.spkByteLen);
  let budget = 0n; for (const i of f.inputs) budget += BigInt(i.computeBudget);
  return { compute: size * MASS_PER_TX_BYTE + spkTotal * MASS_PER_SCRIPT_PUBKEY_BYTE + GRAMS_PER_COMPUTE_BUDGET_UNIT * budget, transient: size * TRANSIENT_BYTE_TO_MASS_FACTOR, size };
}

const isP2shScriptHex = (hex) => { const h = scriptHexNoPrefix(hex); return h.length === 70 && h.startsWith('aa20') && h.endsWith('87'); };

/**
 * 构造完成后、任何IPC/广播之前调用: storage与compute两个维度各自≥阈值即throw; localMass只作诊断返回。
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.network
 * @param {*} o.tx  已构造的kaspa.Transaction(inputs带utxo; 允许relay签名输入的signatureScript为空)
 * @param {boolean[]} o.inputHasCovenant  与tx.inputs顺序一一对应: 该输入所花UTXO是否带covenant(必填)
 * @param {bigint} o.feeUtxoValueSompi  仅用于错误文案
 * @param {string} [o.label]
 * @returns {{storageMass:number, storagePath:string, computeMass:number, transientMass:number, sizeBytes:number, localMassDiagnostic:number|null}}
 */
export function assertMassWithinCeiling({ kaspa, network, tx, inputHasCovenant, feeUtxoValueSompi, label = 'unknown' }) {
  const who = `assertMassWithinCeiling(${label})`;
  if (!Array.isArray(inputHasCovenant) || inputHasCovenant.length !== tx.inputs.length || inputHasCovenant.some((b) => typeof b !== 'boolean')) {
    throw new Error(`${who}: fail-closed — inputHasCovenant必须是与tx.inputs(${tx.inputs.length})等长的boolean数组, 实际=${JSON.stringify(inputHasCovenant)}`);
  }

  const insStorage = [];
  const computeIns = [];
  for (let i = 0; i < tx.inputs.length; i++) {
    const inp = tx.inputs[i];
    const amount = BigInt(inp.utxo.amount);
    const spkHex = inp.utxo.scriptPublicKey.script;
    if (inputHasCovenant[i] && !isP2shScriptHex(spkHex)) {
      throw new Error(`${who}: fail-closed — 输入#${i}声明带covenant但其spk不是35字节P2SH形状(实际${scriptByteLen(spkHex)}字节), 无法可信推导plurality`);
    }
    insStorage.push({ plurality: utxoPlurality(scriptByteLen(spkHex), inputHasCovenant[i]), amountSompi: amount });
    const sigHex = scriptHexNoPrefix(inp.signatureScript ?? '');
    // 断言在relay签名之前执行: sigScript为空的输入将由relay签名, 签名后sigScript恰为66字节, 计入留量。
    computeIns.push({ sigScriptBytes: sigHex.length === 0 ? SIGNED_INPUT_SIGSCRIPT_BYTES : sigHex.length / 2, computeBudget: Number(inp.computeBudget ?? 0) });
  }
  const outsStorage = [];
  const computeOuts = [];
  for (const out of tx.outputs) {
    const spkLen = scriptByteLen(out.scriptPublicKey.script);
    const hasCovenant = !!out.covenant;
    outsStorage.push({ plurality: utxoPlurality(spkLen, hasCovenant), amountSompi: BigInt(out.value) });
    computeOuts.push({ spkByteLen: spkLen, hasCovenant });
  }

  const storage = calcStorageMassExact(insStorage, outsStorage);
  const compute = calcComputeMassExact({ version: Number(tx.version), inputs: computeIns, outputs: computeOuts, payloadBytes: scriptHexNoPrefix(tx.payload ?? '').length / 2 });

  // localMass(本地wasm估算)只作诊断项, 不门控(v0.7对账: 三个形状上偏高+9.5%~+51%, 曾把节点可接受的交易挡在链外)。
  let localMassDiagnostic = null;
  try { localMassDiagnostic = Number(kaspa.calculateTransactionMass(network, tx)); } catch { /* wasm对部分v1 covenant交易会panic, 诊断项取不到不影响门控 */ }

  const signals = {
    storageMass: Number(storage.mass), storagePath: storage.path,
    computeMass: Number(compute.compute), transientMass: Number(compute.transient), sizeBytes: Number(compute.size),
    localMassDiagnostic,
  };
  if (signals.storageMass >= MASS_CEILING_THRESHOLD || signals.computeMass >= MASS_CEILING_THRESHOLD) {
    throw new Error(
      `${who}: 构造出的交易mass超过安全阈值(${MASS_CEILING_THRESHOLD}=${MASS_CEILING_MAX}×${MASS_CEILING_FRACTION}) — ` +
      `storage=${signals.storageMass}(${storage.path}), compute=${signals.computeMass}(含未签名输入的${SIGNED_INPUT_SIGSCRIPT_BYTES}B签名留量); ` +
      `[诊断,不门控]本地wasm估算=${localMassDiagnostic}。所选fee UTXO面值=${feeUtxoValueSompi} sompi——` +
      `storage超限请换一枚不同面值的fee UTXO(不同面值改变找零值, storage mass的调和项∝C/找零)。`,
    );
  }
  return signals;
}
