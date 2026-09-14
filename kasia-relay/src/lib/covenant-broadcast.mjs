// covenant-broadcast.mjs — 原型 v0 `covenant_broadcast` relay 命令的核心库(J2 2026-09-14, 设计
// docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md §9, NWT 1352/1353 两轮打回后的安全约束)。
//
// 🔴 本文件只落核心签名+校验逻辑，不接线——不改 relay.mjs 的 `switch` 命令分发，不加 `PROTO_RELAY_ID`
// 执行权限门。这两处等 Owner 在 (B′)/(C) 之间拍板后再落——B′ 与 C 完全共用这一层，差别只在"注册在哪个
// 进程、谁能调"。
//
// 设计要点(§9.1/§9.2，NWT 1353 修正版；Bettor 1386 设计变更见下 ②③):
//   ① 只签 sign_input_indices 列出的索引，其余输入原样保留。
//   ② SIGNED_INPUT_CEILING = **1.0 KAS**(Bettor 1386②, 原 0.5 KAS——实测
//      `ShardLeaf_direct` genesis 这类大脚本 covenant 的 fee input 需要覆盖 net_loss+找零, 0.5 KAS
//      装不下, 见 docs/provenance/2026-09-14-j2-proto-v0-genesis-mass-fee-estimate/)——Σ(relay 签名
//      的 input.value) 硬上限，卡"一次性签名暴露的总价值"，与真实手续费无关，签名前就能算(不需要先
//      签名才知道 mass)。
//   ③ 🔴 required_fee 必须是**动态算出来的**，不能写死"几千 sompi"占位(NWT 1353 实测: bettor.js:1383
//      settle_consensual 需 789,800 sompi = 7898 mass × 100 sompi/mass，写死几千会把所有合法广播全部
//      自拒)——`required_fee = calculateTransactionMass(networkId, signedTx) × 100 sompi/mass`
//      (kasia-relay/src/lib/p2sh.mjs:135 主网已在用这个调用；**算不出 mass ⇒ fail-loud 拒签，不
//      fallback**——不像 p2sh.mjs 那条红线 7 observe 阶段的"wasm panic 就退本地上界"，这里没有"observe
//      阶段"，直接拒)。
//   🔴 ABS_FEE_CAP 设计变更(Bettor 1386①, 取代 NWT 1353 原"0.05 KAS 全局硬顶"): 实测
//      `ShardLeaf_direct` genesis 的 net_loss 理论最小值 ≈0.4 KAS(15687 字节巨型 covenant 脚本在
//      mainnet KIP-9 storage mass 规则下的物理约束，不是选错了金额——见上述 provenance)，是原 0.05 KAS
//      硬顶的 8 倍，说明"全局唯一硬顶"这个设计本身对不同大小的合约不成立。**改为按 kind 派生**：
//      每个 kind 各自离线跑一次 mass 实验(生产真实 genesis 形态 version:1+populateGenesisCovenants)
//      算出 `cap[kind] = measured_min_net_loss[kind] × 2`，写进
//      `kasia-console/scripts/proto-v0-template-anchors.json` 的 `feeProfile[kind].cap`——
//      `validateNetLoss` 的 `absFeeCapSompi` 参数因此**改为必填**(不再有默认值), 调用方必须显式传
//      对应 kind 的 cap，防止"忘记传就悄悄用了一个不适用的默认值"。另加 **GLOBAL_ABS_FEE_CAP_SOMPI
//      = 1.0 KAS**(任何 kind 都不得超的最终硬顶，三者取最小：`min(required_fee×2, absFeeCapSompi,
//      GLOBAL_ABS_FEE_CAP_SOMPI)`)——即使某个 kind 的 cap 因为疏忽被设得过大，全局硬顶仍然兜底。
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

// 🔴 ABS_FEE_CAP_SOMPI(旧 0.05 KAS 全局常量, NWT 1353)已废弃(Bettor 1386①)——不再导出、不再是
// validateNetLoss 的默认值来源。cap 现在按 kind 从 proto-v0-template-anchors.json 的 feeProfile[kind]
// 取, 由调用方显式传入 validateNetLoss({absFeeCapSompi})。
export const GLOBAL_ABS_FEE_CAP_SOMPI = 100_000_000n; // 1.0 KAS——任何 kind 都不得超的最终硬顶(Bettor 1386①)
export const SIGNED_INPUT_CEILING_SOMPI = 100_000_000n; // 1.0 KAS(Bettor 1386②, 原 0.5 KAS 装不下 genesis)
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
  // 🔴 NWT 1376(非阻断建议, 显式拒绝而非依赖"方向安全"的隐性性质): 重复索引现在只会让
  // signedInputTotalSompi 被重复加总、更容易触发 SIGNED_INPUT_CEILING 拒绝(方向安全, 不是漏洞)，
  // 但依赖"刚好方向安全"不如直接拒绝清楚——调用方传重复索引本身就是构造错误(不可能有意义地对
  // 同一个 input 签两次), 显式拒绝能在问题源头就报错, 不必等到 ceiling 判定这一步才间接暴露。
  {
    const seen = new Set();
    for (const idx of signInputIndices) {
      if (seen.has(idx)) return { ok: false, reason: `signInputIndices contains duplicate index ${idx}` };
      seen.add(idx);
    }
  }
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
 * require(net_loss ≤ min(requiredFeeSompi × 2, absFeeCapSompi, GLOBAL_ABS_FEE_CAP_SOMPI))。
 * requiredFeeSompi 由调用方传入(见 computeRequiredFeeSompi，必须是签名后算出来的真实值，本函数不
 * 负责算、不碰 wasm)。
 * @param {object} o
 * @param {PlainInput[]} o.inputs
 * @param {PlainOutput[]} o.outputs
 * @param {number[]} o.signInputIndices
 * @param {*} o.relayScriptPubKey  relay 自己地址的 scriptPubKey——wasm 对象 / `.toString()` JSON 字符串 /
 *   纯 hex 字符串三种都行，内部过 canonicalScriptHex() 统一(不要求调用方自己先转好, 也不要求"是 hex"——
 *   这个参数以前叫 relayScriptPubKeyHex, 那个名字里的"Hex"是错误承诺, 已订正)。
 * @param {bigint} o.requiredFeeSompi  computeRequiredFeeSompi() 的结果(签名后算出的真实 mass×费率)
 * @param {bigint} o.absFeeCapSompi  🔴 Bettor 1386①: 必填, 不再有默认值——按 kind 从
 *   proto-v0-template-anchors.json 的 feeProfile[kind].cap 传入(每个 kind 各自离线跑一次 mass 实验
 *   算出的 cap = measured_min_net_loss × 2)。忘记传会被下面的显式校验拒, 不会静默落到一个不适用
 *   于当前 kind 的旧全局默认值上。
 * @returns {{ok:true, netLossSompi:bigint, feeCeilingSompi:bigint} | {ok:false, reason:string, netLossSompi?:bigint, feeCeilingSompi?:bigint}}
 */
export function validateNetLoss({ inputs, outputs, signInputIndices, relayScriptPubKey, requiredFeeSompi, absFeeCapSompi }) {
  if (!Array.isArray(inputs) || !inputs.length) return { ok: false, reason: 'inputs must be a non-empty array' };
  if (!Array.isArray(outputs)) return { ok: false, reason: 'outputs must be an array' };
  if (!Array.isArray(signInputIndices) || !signInputIndices.length) return { ok: false, reason: 'signInputIndices must be a non-empty array' };
  if (!relayScriptPubKey) return { ok: false, reason: 'relayScriptPubKey required' };
  if (typeof requiredFeeSompi !== 'bigint' || requiredFeeSompi < 0n) return { ok: false, reason: 'requiredFeeSompi must be a non-negative bigint (computed via computeRequiredFeeSompi, post-signing)' };
  if (typeof absFeeCapSompi !== 'bigint' || absFeeCapSompi < 0n) return { ok: false, reason: 'absFeeCapSompi must be a non-negative bigint (Bettor 1386: per-kind cap from proto-v0-template-anchors.json feeProfile[kind].cap — no global default, caller must pass it explicitly)' };

  // 🔴 NWT 1376(非阻断建议, 同 validateSignedInputCeiling 一致): 显式拒绝重复索引, 不依赖"重复只会
  // 让 net_loss 算大更易拒"这条方向安全的隐性性质——构造错误在源头就报错。
  {
    const seen = new Set();
    for (const idx of signInputIndices) {
      if (seen.has(idx)) return { ok: false, reason: `signInputIndices contains duplicate index ${idx}` };
      seen.add(idx);
    }
  }

  let signedInputTotalSompi = 0n;
  for (const idx of signInputIndices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= inputs.length) {
      return { ok: false, reason: `signInputIndices contains out-of-range index ${idx} (inputs.length=${inputs.length})` };
    }
    signedInputTotalSompi += BigInt(inputs[idx].amountSompi);
  }

  const relayKeyNorm = canonicalScriptHex(relayScriptPubKey);
  // 🔴 Bettor 1364(自查项): relayScriptPubKey 本身非空(过了上面的 `!relayScriptPubKey` 闸)，但如果它
  // 经 canonicalScriptHex 归一后变成空字符串(比如传进来一个 `{"script":"","version":0}` 这种畸形值)，
  // 就会跟"outputs 里某个同样缺 scriptPubKeyRaw / 畸形到归一成空串"的输出错误配成一对——两个空值互相
  // 匹配上，把一笔本不该算"付回自己"的输出算进 returnedToRelaySompi，net_loss 被静默做小，可能放行本该拒
  // 的广播。空归一值不是一个合法脚本，不能参与匹配——fail-closed 直接拒，不进比较循环。
  if (!relayKeyNorm) {
    return { ok: false, reason: 'relayScriptPubKey canonicalized to an empty hex string — refusing to match (would spuriously equal any output with a missing/malformed scriptPubKeyRaw)' };
  }
  let returnedToRelaySompi = 0n;
  for (const out of outputs) {
    if (canonicalScriptHex(out.scriptPubKeyRaw) === relayKeyNorm) {
      returnedToRelaySompi += BigInt(out.valueSompi);
    }
  }
  const netLossSompi = signedInputTotalSompi - returnedToRelaySompi;
  const dynamicCeiling = requiredFeeSompi * 2n;
  // 🔴 Bettor 1386①: 三者取最小——kind 专属 cap(absFeeCapSompi)之外, 再叠一层
  // GLOBAL_ABS_FEE_CAP_SOMPI(1.0 KAS)兜底, 防止某个 kind 的 cap 因疏忽被设得过大。
  let feeCeilingSompi = dynamicCeiling < absFeeCapSompi ? dynamicCeiling : absFeeCapSompi; // min(dynamic, kind cap)
  if (GLOBAL_ABS_FEE_CAP_SOMPI < feeCeilingSompi) feeCeilingSompi = GLOBAL_ABS_FEE_CAP_SOMPI; // 全局硬顶再钳一次
  if (netLossSompi > feeCeilingSompi) {
    return { ok: false, reason: `net_loss ${netLossSompi} exceeds fee ceiling ${feeCeilingSompi} (= min(required_fee×2=${dynamicCeiling}, absFeeCapSompi=${absFeeCapSompi}, GLOBAL_ABS_FEE_CAP_SOMPI=${GLOBAL_ABS_FEE_CAP_SOMPI}); signed_input_total=${signedInputTotalSompi}, returned_to_relay=${returnedToRelaySompi})`, netLossSompi, feeCeilingSompi };
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
 * 只签 signInputIndices 列出的索引，其余输入原样保留——防止调用方哄骗 relay 签一个它没被要求签的、
 * 意料之外的输入(§9.2 约束①)。
 *
 * 🔴 假设声明(NWT 1376 非阻断建议): 本函数不判断"某个索引是否真的该由 relay 签"——这是调用方的
 * 职责。sign_input_indices 由可信调用方(console 后端, 经 PROTO_RELAY_ID 执行权限门)构造, 本函数
 * 信任这个输入。若调用方签错了索引(比如误把一个 covenant 输入也塞进 sign_input_indices), 后果是
 * 那个输入的 witness 被 relay 的签名覆盖掉, 不再满足它自己的 covenant 脚本要求 ⇒ 广播后共识层拒绝
 * ——失败方向是安全的(交易上不了链, 不是资金泄露), 但不是本函数负责拦的那一层。
 *
 * ✅ 真实实现(2026-09-14, Owner §6=B′ 拍板后接线笔②, 见
 * docs/provenance/2026-09-14-j2-sign-only-declared-inputs-verification/): 用离线一次性 throwaway
 * 密钥 + 真实 kaspa-wasm 核验过——顶层导出的 `createInputSignature(tx, idx, privateKey, sighashType)`
 * (kaspa.d.ts:279，专为普通 `Transaction` 对象设计，区别于 `PendingTransaction` 专用的
 * `signInput`/`fillInput`——那是 Generator 高层 API 专属，我们这里拿到的是从 tx_json 反序列化出的
 * 普通 Transaction，不是 PendingTransaction，两者的 sign 系方法不能混用) + 原地赋值
 * `tx.inputs[idx].signatureScript = sigHex` 就是正确路径，**不需要重新构造整个 Transaction 对象**。
 * 已验证: 原地赋值在真实 wasm 下完全生效(序列化/反序列化往返一致)，covenant 侧其他输入的 witness
 * 全程不受影响，依次对多个索引签名互不干扰(与 wasm 自带的 `signTransaction(tx,[priv],verify_sig=true)`
 * 官方"自动签名+验证"路径同构，产出的 txid 完全一致)。
 *
 * 先校验全部 signInputIndices 合法(fail-fast)，再统一签名——不允许"签到一半发现某个索引越界"这种
 * 半成品状态(校验失败时 tx 一个字节都没被动过)。
 * @param {object} o
 * @param {import('kaspa-wasm').Transaction} o.tx  未 finalize 的 Transaction(签名后调用方负责 finalize)
 * @param {number[]} o.signInputIndices
 * @param {*} o.privateKey  kaspa-wasm PrivateKey 对象(relay 自己的私钥, 通过 getWallet().getPrivateKey() 取得——本函数不碰私钥的存取, 只用调用方已经拿到的对象)
 * @param {*} o.kaspa  kaspa-wasm 模块(注入，供测试用假实现替换，同 computeRequiredFeeSompi 的既有模式)
 * @returns {void}  同步函数(内部全是同步操作, 不像 computeRequiredFeeSompi 那样需要等 RPC/wasm 异步调用；
 *   原设计文档签名写的 Promise<void> 是占位期的预留, 真实实现后改回同步, 与文件里其余纯函数风格一致)
 */
export function signOnlyDeclaredInputs({ tx, signInputIndices, privateKey, kaspa }) {
  if (!Array.isArray(signInputIndices) || !signInputIndices.length) {
    throw new Error('signOnlyDeclaredInputs: signInputIndices must be a non-empty array');
  }
  if (typeof kaspa?.createInputSignature !== 'function') {
    throw new Error('signOnlyDeclaredInputs: kaspa.createInputSignature not available — fail-loud, no fallback');
  }
  const inputsLen = tx?.inputs?.length ?? 0;
  for (const idx of signInputIndices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= inputsLen) {
      throw new Error(`signOnlyDeclaredInputs: signInputIndices contains out-of-range index ${idx} (inputs.length=${inputsLen}) — refusing before signing any input`);
    }
  }
  const sighashAll = kaspa.SighashType?.All;
  for (const idx of signInputIndices) {
    const sigHex = kaspa.createInputSignature(tx, idx, privateKey, sighashAll);
    tx.inputs[idx].signatureScript = sigHex;
  }
}
