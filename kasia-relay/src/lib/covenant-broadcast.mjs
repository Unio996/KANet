// covenant-broadcast.mjs — 原型 v0 `covenant_broadcast` relay 命令的核心库(J2 2026-09-14, 设计
// docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md §9, NWT 1352/1353 两轮打回后的安全约束)。
//
// 🔴 本文件只落核心签名+校验逻辑，不接线——不改 relay.mjs 的 `switch` 命令分发，不加 `PROTO_RELAY_ID`
// 执行权限门。这两处等 Owner 在 (B′)/(C) 之间拍板后再落——B′ 与 C 完全共用这一层，差别只在"注册在哪个
// 进程、谁能调"。
//
// 设计要点(§9.1/§9.2，NWT 1353 修正版):
//   ① 只签 sign_input_indices 列出的索引，其余输入原样保留。
//   ② SIGNED_INPUT_CEILING(0.5 KAS)——Σ(relay 签名的 input.value) 硬上限，卡"一次性签名暴露的总
//      价值"，与真实手续费无关，签名前就能算(不需要先签名才知道 mass)。
//   ③ 🔴 required_fee 必须是**动态算出来的**，不能写死"几千 sompi"占位(NWT 1353 实测: bettor.js:1383
//      settle_consensual 需 789,800 sompi = 7898 mass × 100 sompi/mass，写死几千会把所有合法广播全部
//      自拒)——`required_fee = calculateTransactionMass(networkId, signedTx) × 100 sompi/mass`
//      (kasia-relay/src/lib/p2sh.mjs:135 主网已在用这个调用；**算不出 mass ⇒ fail-loud 拒签，不
//      fallback**——不像 p2sh.mjs 那条红线 7 observe 阶段的"wasm panic 就退本地上界"，这里没有"observe
//      阶段"，直接拒)。`require(net_loss ≤ min(required_fee × 2, ABS_FEE_CAP))`，`ABS_FEE_CAP` =
//      0.05 KAS(5,000,000 sompi)硬顶——两者取更严的那个。
//   ④ finalize 后 txid == expected_txid —— 同字节重播断言(同 TRANSFER 命令 prepared_txid 既有契约)。
//
// 职责分层(不变量): §9.2 的安全性质完全建立在纯函数(validateSignedInputCeiling / validateNetLoss)
// 上——它们不碰 kaspa-wasm、不碰私钥，输入输出都是普通 JS 值(sompi 用 BigInt)，100% 离线可测；
// `required_fee` 的计算(必须调 kaspa-wasm calculateTransactionMass，且必须在签名之后才能算，因为
// mass 依赖真实脚本大小)被拆成单独一步 computeRequiredFeeSompi()，validateNetLoss 接收算好的
// requiredFeeSompi 作为参数，不在内部调 wasm——这样"net_loss 判定逻辑本身"仍然可以完全离线单测
// (直接喂任意 requiredFeeSompi 值)，"mass 算得对不对"是另一层单独关心的问题，两者不混在一次测试里。
//
// 🔴 scriptPubKey 的表示(2026-09-14 订正，见 docs/provenance/2026-09-14-j2-covenant-broadcast-scriptpubkey-verification/):
// 早先文档写"scriptPubKey 用 hex 字符串"是错的——真实 kaspa-wasm `ScriptPublicKey.toString()` 吐出的
// 是 JSON 字符串 `{"script":"<hex>","version":n}`，不是纯 hex。PlainInput/PlainOutput 的
// `scriptPubKeyRaw` 字段就是这个未经处理的原始 toString() 输出，任何要比较"是不是同一个脚本"的地方
// 一律先过 `canonicalScriptHex()`(见下)取出真正的 hex 再比，不要直接字符串比较 raw 值(碰巧能比对是
// 因为两边都用同一条 toString() 路径产出同构 JSON，属于历史遗留的巧合，不是保证)。

/** @typedef {{index:number, amountSompi:bigint, scriptPubKeyRaw:string}} PlainInput */
/** @typedef {{valueSompi:bigint, scriptPubKeyRaw:string}} PlainOutput */

export const ABS_FEE_CAP_SOMPI = 5_000_000n;        // 0.05 KAS 绝对硬顶(NWT 1353)
export const SIGNED_INPUT_CEILING_SOMPI = 50_000_000n; // 0.5 KAS
export const SOMPI_PER_MASS = 100n;

/**
 * 纯函数(签名前即可算，不需要真实 mass): Σ(relay 签名的 input.value) ≤ SIGNED_INPUT_CEILING。
 * @param {object} o
 * @param {PlainInput[]} o.inputs
 * @param {number[]} o.signInputIndices
 * @param {bigint} [o.signedInputCeilingSompi]
 * @returns {{ok:true, signedInputTotalSompi:bigint} | {ok:false, reason:string, signedInputTotalSompi?:bigint}}
 */
export function validateSignedInputCeiling({ inputs, signInputIndices, signedInputCeilingSompi = SIGNED_INPUT_CEILING_SOMPI }) {
  if (!Array.isArray(inputs) || !inputs.length) return { ok: false, reason: 'inputs must be a non-empty array' };
  if (!Array.isArray(signInputIndices) || !signInputIndices.length) return { ok: false, reason: 'signInputIndices must be a non-empty array' };
  for (const idx of signInputIndices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= inputs.length) {
      return { ok: false, reason: `signInputIndices contains out-of-range index ${idx} (inputs.length=${inputs.length})` };
    }
  }
  let signedInputTotalSompi = 0n;
  for (const idx of signInputIndices) {
    const amt = BigInt(inputs[idx].amountSompi);
    if (amt < 0n) return { ok: false, reason: `input[${idx}].amountSompi is negative` };
    signedInputTotalSompi += amt;
  }
  if (signedInputTotalSompi > signedInputCeilingSompi) {
    return { ok: false, reason: `signed input total ${signedInputTotalSompi} exceeds SIGNED_INPUT_CEILING ${signedInputCeilingSompi}`, signedInputTotalSompi };
  }
  return { ok: true, signedInputTotalSompi };
}

/**
 * kaspa-wasm calculateTransactionMass × SOMPI_PER_MASS —— **必须在签名后调用**(mass 依赖真实脚本
 * 大小)。算不出 ⇒ fail-loud throw，不 fallback 到任何本地估算(区别于 p2sh.mjs 红线 7 那条 observe
 * 阶段的"wasm panic 退本地上界"——covenant_broadcast 没有 observe 阶段，直接拒)。
 * @param {object} o
 * @param {*} o.kaspa  kaspa-wasm 模块(注入，供测试用假实现替换)
 * @param {string} o.networkId
 * @param {*} o.signedTx  已签名的 Transaction 对象
 * @returns {bigint} requiredFeeSompi
 */
export function computeRequiredFeeSompi({ kaspa, networkId, signedTx }) {
  if (!networkId) throw new Error('computeRequiredFeeSompi: networkId required');
  if (typeof kaspa?.calculateTransactionMass !== 'function') {
    throw new Error('computeRequiredFeeSompi: kaspa.calculateTransactionMass not available — fail-loud, no fallback (this is covenant_broadcast, not the red-line-7 observe path)');
  }
  let mass;
  try {
    mass = kaspa.calculateTransactionMass(networkId, signedTx);
  } catch (e) {
    throw new Error(`computeRequiredFeeSompi: calculateTransactionMass threw (${e?.message || e}) — fail-loud, refusing to sign/broadcast`);
  }
  return BigInt(mass) * SOMPI_PER_MASS;
}

/**
 * 把"任意形式的 scriptPubKey 表示"统一成小写 hex，供相等比较用。三种输入形式都接受(2026-09-14
 * 订正 NWT 1355 的"转 hex"假设错误，见文件头注 + provenance 目录):
 *   ① 真实 kaspa-wasm ScriptPublicKey 对象 —— 有 `.toString()`，产出 JSON 字符串 `{"script":"<hex>","version":n}`。
 *   ② 已经是这个 JSON 字符串本身(比如从别处 `.toString()` 完存过一遍) —— 同样解析取 `.script`。
 *   ③ 已经是纯 hex 字符串(比如手写测试向量、或未来换了别的取法) —— JSON.parse 会失败，原样当 hex 用。
 * 不认识的输入(null/undefined) → 空字符串(不 throw——调用方靠"两边比不出相等"自然拒绝，不需要在
 * 这一层就报错，保持 validateNetLoss 的 fail-closed 语义不变)。
 * @param {*} spk
 * @returns {string} 小写 hex(可能是空字符串)
 */
export function canonicalScriptHex(spk) {
  if (spk == null) return '';
  const raw = typeof spk === 'string' ? spk : String(spk);
  let hex = raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.script === 'string') {
      hex = parsed.script;
    }
  } catch { /* 不是 JSON ⇒ 假设 raw 本身就是 hex，原样用 */ }
  return hex.toLowerCase();
}

/**
 * 纯函数: net_loss = Σ(relay 签名的 input.value) − Σ(outputs 中 scriptPubKey == relay 自身地址 的 value)。
 * require(net_loss ≤ min(requiredFeeSompi × 2, ABS_FEE_CAP))。requiredFeeSompi 由调用方传入(见
 * computeRequiredFeeSompi，必须是签名后算出来的真实值，本函数不负责算、不碰 wasm)。
 * @param {object} o
 * @param {PlainInput[]} o.inputs
 * @param {PlainOutput[]} o.outputs
 * @param {number[]} o.signInputIndices
 * @param {*} o.relayScriptPubKey  relay 自己地址的 scriptPubKey——wasm 对象 / `.toString()` JSON 字符串 /
 *   纯 hex 字符串三种都行，内部过 canonicalScriptHex() 统一(不要求调用方自己先转好, 也不要求"是 hex"——
 *   这个参数以前叫 relayScriptPubKeyHex, 那个名字里的"Hex"是错误承诺, 已订正)。
 * @param {bigint} o.requiredFeeSompi  computeRequiredFeeSompi() 的结果(签名后算出的真实 mass×费率)
 * @param {bigint} [o.absFeeCapSompi]
 * @returns {{ok:true, netLossSompi:bigint, feeCeilingSompi:bigint} | {ok:false, reason:string, netLossSompi?:bigint, feeCeilingSompi?:bigint}}
 */
export function validateNetLoss({ inputs, outputs, signInputIndices, relayScriptPubKey, requiredFeeSompi, absFeeCapSompi = ABS_FEE_CAP_SOMPI }) {
  if (!Array.isArray(inputs) || !inputs.length) return { ok: false, reason: 'inputs must be a non-empty array' };
  if (!Array.isArray(outputs)) return { ok: false, reason: 'outputs must be an array' };
  if (!Array.isArray(signInputIndices) || !signInputIndices.length) return { ok: false, reason: 'signInputIndices must be a non-empty array' };
  if (!relayScriptPubKey) return { ok: false, reason: 'relayScriptPubKey required' };
  if (typeof requiredFeeSompi !== 'bigint' || requiredFeeSompi < 0n) return { ok: false, reason: 'requiredFeeSompi must be a non-negative bigint (computed via computeRequiredFeeSompi, post-signing)' };

  let signedInputTotalSompi = 0n;
  for (const idx of signInputIndices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= inputs.length) {
      return { ok: false, reason: `signInputIndices contains out-of-range index ${idx} (inputs.length=${inputs.length})` };
    }
    signedInputTotalSompi += BigInt(inputs[idx].amountSompi);
  }

  const relayKeyNorm = canonicalScriptHex(relayScriptPubKey);
  let returnedToRelaySompi = 0n;
  for (const out of outputs) {
    if (canonicalScriptHex(out.scriptPubKeyRaw) === relayKeyNorm) {
      returnedToRelaySompi += BigInt(out.valueSompi);
    }
  }
  const netLossSompi = signedInputTotalSompi - returnedToRelaySompi;
  const dynamicCeiling = requiredFeeSompi * 2n;
  const feeCeilingSompi = dynamicCeiling < absFeeCapSompi ? dynamicCeiling : absFeeCapSompi; // min(...)
  if (netLossSompi > feeCeilingSompi) {
    return { ok: false, reason: `net_loss ${netLossSompi} exceeds fee ceiling ${feeCeilingSompi} (= min(required_fee×2=${dynamicCeiling}, ABS_FEE_CAP=${absFeeCapSompi}); signed_input_total=${signedInputTotalSompi}, returned_to_relay=${returnedToRelaySompi})`, netLossSompi, feeCeilingSompi };
  }
  return { ok: true, netLossSompi, feeCeilingSompi };
}

/**
 * 从真实 kaspa-wasm Transaction 对象抽取 validateSignedInputCeiling/validateNetLoss 需要的 plain
 * shape。薄适配层——不含安全判断，读错字段只会导致下游校验用错误的值算出错误结论(会被断言拦下)，
 * 不会绕过校验本身(校验逻辑与本函数完全解耦，见文件头分层说明)。字段来源核实:
 * kasia-console/src/lib/bshard-close-transport.mjs:422-423 —— input.utxo.amount(BigInt) /
 * output.value(BigInt) / output.scriptPublicKey，是本仓既有 covenant 构造代码已经在用的真实字段名。
 *
 * ✅ 接线 TODO(NWT 1355)已核验解决(2026-09-14，见
 * docs/provenance/2026-09-14-j2-covenant-broadcast-scriptpubkey-verification/): 用离线一次性
 * throwaway 密钥构造真实 kaspa-wasm Transaction 对象核实——`.scriptPublicKey.toString()` 吐出的不是
 * 纯 hex，是 JSON 字符串 `{"script":"<hex>","version":n}`；`scriptPubKeyRaw` 字段存的就是这个原始未
 * 处理输出。`validateNetLoss` 内部经 `canonicalScriptHex()` 统一取出真正的 hex 再比较，不依赖"两边
 * 恰好是同一种格式"这个巧合。
 * @param {import('kaspa-wasm').Transaction} tx
 * @returns {{inputs: PlainInput[], outputs: PlainOutput[]}}
 */
export function extractTxShape(tx) {
  const inputs = tx.inputs.map((inp, index) => ({
    index,
    amountSompi: BigInt(inp.utxo.amount),
    scriptPubKeyRaw: inp.utxo.scriptPublicKey.toString(),
  }));
  const outputs = tx.outputs.map((out) => ({
    valueSompi: BigInt(out.value),
    scriptPubKeyRaw: out.scriptPublicKey.toString(),
  }));
  return { inputs, outputs };
}

/**
 * finalize 后核对 txid 与调用方期望值一致——同字节重播断言(TRANSFER 命令 prepared_txid 既有契约)。
 * 不在这里 throw：交给调用方决定"txid 不符"是拒绝广播(首次构造场景)还是走 replay_txid_mismatch
 * 错误码(重播场景，同 submit-intent.mjs resolvePrepared 既有分支)。
 * @param {import('kaspa-wasm').Transaction} tx  已 finalize 的交易
 * @param {string} expectedTxid
 * @returns {{ok:true}|{ok:false, actualTxid:string}}
 */
export function assertFinalTxid(tx, expectedTxid) {
  const actualTxid = tx.id;
  if (actualTxid !== expectedTxid) return { ok: false, actualTxid };
  return { ok: true };
}

/**
 * 只签 signInputIndices 列出的索引——kaspa-wasm 的 sign 系 API 通常是"对整笔交易签、按脚本类型自动
 * 匹配能签的输入"，这里显式只对声明的索引调用签名(而不是让 wasm 自己扫全部输入去猜), 防止调用方
 * 声明的 signInputIndices 与 wasm 实际签的集合不一致而产生"以为只签了 A，其实 wasm 顺手也签了 B"
 * 这种静默扩大授权范围的情况。真正的 wasm 签名 API 调用方式由接线那笔(等 Owner 选 B′/C)时对齐,
 * 这里先占位声明契约形状, 不假装已经跑通真实签名(NO-TX-NO-STATE 同一条纪律的落码期延伸: 没有真的
 * 调通 wasm 签名 API 之前, 不写看起来能跑但实际没跑过的实现)。
 * @param {object} o
 * @param {import('kaspa-wasm').Transaction} o.tx
 * @param {number[]} o.signInputIndices
 * @param {*} o.privateKey
 * @returns {Promise<void>}
 */
export async function signOnlyDeclaredInputs({ tx, signInputIndices, privateKey }) {
  throw new Error('signOnlyDeclaredInputs: 未实现 —— 等 Owner 在 (B′)/(C) 定案、接线那笔落码时对齐真实 kaspa-wasm 签名 API 调用方式(见 covenant-broadcast.mjs 头注)。validateSignedInputCeiling/validateNetLoss 的安全校验逻辑已完成且可独立于本函数测试。');
}
