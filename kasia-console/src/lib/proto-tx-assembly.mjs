// proto-tx-assembly.mjs — market_genesis/bet_mint tx 组装的构造层守卫(J2, 账本1425续, Bettor向量①③④)。
//
// 两条各自独立的构造层守卫, 都不是 relay 侧检查的"影子"(relay 拦的是签名前那一层, 这里拦的是"构造出
// 来的值/输入/费用本身对不对", 两者必须都存在——一条被绕过, 另一条仍能拦):
//   ① assertFixedOutputValue: genesis/续约输出值必须是协议常量, 不允许算出来的近似值糊弄过去。
//   ④ computeRequiredFeeSompiOrThrow: mass 算不出来就是硬失败, 不许退化成估算值。
// 🔴 D-020(账本1446/1448, a4878d7d): 原③ assertKttOutpointRecorded(守 bet_mint 步骤A铸出的独立
// stake筹码输入)已随步骤A一起删除——register_append 改单笔交易, 不再有独立 stake 筹码输入需要校验
// outpoint 来源。held 输入的 outpoint 来源仍由 proto-leaf-state.mjs 的 deriveHeldKttOutpoint/
// assertHeldKttOutpointMatchesChain 守, 不受影响。
//
// 常量与 kasia-relay/src/lib/covenant-broadcast.mjs 的 GENESIS_OUTPUT_SOMPI/CONTINUATION_OUTPUT_SOMPI
// 数值必须保持一致(KIP-9 storage mass U 形曲线全局最优点, 20,000,000 sompi)——console 侧独立持有一份
// 而不是跨包 import relay 代码("Console 传导不碰链"角色分工铁律), 改动任一侧必须同步改另一侧。

import { encodeRegisterAppendAction, combineActionAndRedeem as combineRegisterAppendActionAndRedeem } from './proto-register-append-witness.mjs';
import { encodeKttTransferZeroOutAction, combineKttActionAndRedeem } from './proto-ktt-transfer-witness.mjs';
import { encodeLeafStateBytes } from './proto-leaf-state.mjs';
import { assertMassWithinCeiling } from './proto-mass-ceiling.mjs';

export const GENESIS_OUTPUT_SOMPI = 20_000_000n;
export const CONTINUATION_OUTPUT_SOMPI = 20_000_000n;
export const SOMPI_PER_MASS = 100n;

// 🔴 账本1465(闸3重试再次中止, 主网RPC层拒收根因修复): rusty-kaspa v2.0.1(节点实跑版本, tag v2.0.1=
// commit cfafeb4c)的 rpc/core/src/convert/tx.rs:19-42(TryFrom<RpcInputWithVersion> for TransactionInput)
// + consensus/core/src/tx.rs:91-96(ComputeCommit::version_expects_compute_budget_field)钦定的规则:
// version>=1 的交易, 每个 input 必须 sig_op_count===0(否则 RpcError "sig_op_count is inconsistent with
// transaction version 1", 账本1465实测复现原文)、用 compute_budget(u16)字段代替表达该输入允许消耗的脚本
// 执行预算; version 0 反过来(compute_budget 必须是0, sig_op_count 才生效)。本文件两处 mkInput
// (buildMarketGenesisTxJson/buildRegisterAppendTxJson)构造的都是 version:1 交易, 之前误写成
// `sigOpCount: 1, computeBudget: 0`——恰好是这条规则的反面, 每次真广播到主网节点都会在 RPC 层被拒。
// 🔴 这不只是格式问题: consensus/src/processes/transaction_validator/tx_validation_in_utxo_context.rs:
// 198-209(check_scripts_sequential/check_scripts_par_iter) 显示 compute_budget 换算出的
// allowed_script_units(= compute_budget×10,000 + 9,999, 见 consensus/core/src/mass/units.rs 的
// SCRIPT_UNITS_PER_COMPUTE_BUDGET_UNIT=10,000 + free_script_units_per_input()=9,999)是真实喂给
// TxScriptEngine 的执行预算上限——覆盖的输入若脚本执行(hash/状态校验等)超过这个预算, 会在真实共识校验
// 这一层(而非仅仅 RPC 格式层)被拒, 不是"多花一点手续费"那么简单。选值必须真的够用。
// 🔴 已如实核实(账本1465③要求): rusty-kaspa v2.0.1 的 RPC API(rpc/core/src/api/rpc.rs)不存在任何
// dry-run/仅校验不入池的方法——唯一入口 submit_transaction 一旦通过校验就真的进 mempool; kaspa-wasm
// 也不导出任何本地脚本执行引擎(grep 全部导出符号, 无 TxScriptEngine/checkScripts 等)。因此**没有离线、
// 不广播的办法能针对我们这两个具体脚本(ShardLeaf_direct.register_append / KTT transfer-zero-out)精确
// 验证某个 compute_budget 数值是否真的够用**——这里选用的 70 是从 kasia-relay/src/lib/p2sh.mjs 的
// `_BSHARD_COMPUTE_BUDGET = 70` 原样借用(该值已被同一份代码库里更复杂的 close_attest 脚本(5 checkSig+
// 40 merkle blake2b+validateOutputState 4448B+10 pairwise !=, 实测需要 510,026 script units, 70 留出
// 709,999 units 的余量)真实验证过是够用的)——register_append 明确不含任何 checkSig(bettorPk 是无签名
// witness 值, 见文件头注), KTT transfer-zero-out 结构也更简单, 理论上所需 script units 应显著低于
// close_attest, 借用同一个数字是"用已验证过的更大预算兜住理论上更小的需求", 不是重新独立测过这两个
// 具体脚本——留痕明确, 不冒充"已验证"。若未来有能力真实测(比如 NWT/KANet-UI 拿到一个可安全试错的测试
// relay+测试网), 应该用真实测量值替换这个借用值。
export const PROTO_V0_COMPUTE_BUDGET = 70;

// 🔴 buildRegisterAppendTxJson 输出布局具名常量(账本1439, Bettor要求"vout在builder里定义为具名
// 常量, 推算函数引用同一个常量"——不在两处各自重复写字面量0/1/2, 防将来改布局漏改一处)。
export const REGISTER_APPEND_LEAF_CONT_OUT_INDEX = 0; // leaf续约输出
export const REGISTER_APPEND_TICKET_OUT_INDEX = 1;    // PoolSideTicket genesis 输出
export const REGISTER_APPEND_TOK_OUT_INDEX = 2;       // 合并KTT genesis 输出(下一次 register_append 的 held 输入指向这里)

/**
 * ① 构造层守卫: 输出值必须逐位等于协议常量, 不接受"减法算出来接近但不精确相等"的值。
 * 与 relay 侧 validateFixedValueOutputs 是两条独立防线——这条在构造阶段、送进 covenant_broadcast
 * 的 cmd 之前就拦, relay 那条拦的是签名前最后一步; 两者故意不共享实现。
 */
export function assertFixedOutputValue(valueSompi, expectedSompi, label) {
  if (typeof valueSompi !== 'bigint') throw new Error(`assertFixedOutputValue(${label}): value must be bigint, got ${typeof valueSompi}`);
  if (valueSompi !== expectedSompi) {
    throw new Error(`assertFixedOutputValue(${label}): 输出值 ${valueSompi} != 协议常量 ${expectedSompi}(v0 只允许固定值, 不接受算出来的近似值)`);
  }
}

/**
 * ④ 构造层守卫: console 侧调用 calculateTransactionMass 必须 fail-loud——算不出来就是硬失败,
 * 绝不退化成一个估算值糊弄过去(relay 侧 covenant-broadcast-relay.mjs 的 CRF-2 只覆盖 relay 自己
 * 那次调用, 不覆盖 console 侧这次独立调用, 两处必须各自守住)。
 */
export function computeRequiredFeeSompiOrThrow(kaspa, network, tx) {
  if (!kaspa || typeof kaspa.calculateTransactionMass !== 'function') {
    throw new Error('computeRequiredFeeSompiOrThrow: kaspa.calculateTransactionMass 不可用(fail-loud, 不回退到估算值)');
  }
  let mass;
  try {
    mass = kaspa.calculateTransactionMass(network, tx);
  } catch (e) {
    throw new Error(`computeRequiredFeeSompiOrThrow: calculateTransactionMass 抛错(fail-loud, 不回退到估算值): ${e.message}`);
  }
  if (mass === undefined || mass === null) {
    throw new Error('computeRequiredFeeSompiOrThrow: calculateTransactionMass 返回空值(fail-loud, 不回退到估算值)');
  }
  return BigInt(mass) * SOMPI_PER_MASS;
}

/**
 * §9.5 fee-UTXO 选择器: 只选"单个够用的 UTXO", v0 明确不做自动拆分/合并(不做的范围, Bettor 1425 条件⑥认可)。
 * 找零形状必须是 0(全部耗尽)或 >= CONTINUATION_OUTPUT_SOMPI(留下的找零本身要能再花, 不留 dust 找零)。
 * 🔴 账本1462(闸3金丝雀中止, Bettor/NWT诊断): 本函数用一个"保守下界"(minRequiredSompi, 调用方按
 * GENESIS_OUTPUT_SOMPI+cap 或 CONTINUATION×N+cap 这类字面量算出来的估计值)预筛 UTXO——这个估计值比
 * 真实构造需要的面值明显偏大(真实 requiredFee 约 0.41-0.44 KAS, 这里按 cap 上限抬到 ~0.6-1.0 KAS)，
 * 导致真实种子面值(0.5/0.5/0.95 KAS)全部被这道"保守但不准"的门槛拒之门外——市场从未真正尝试构造就
 * 直接 no_suitable_fee_utxo。本函数原样保留(仍是一个合法的、更简单的原语，proto-tx-assembly.test.mjs
 * 的既有单测继续覆盖它)，但 proto-broadcast-ops.mjs 的两个生产调用点已改用下面的
 * selectFeeUtxoByConstruction(按真实构造逐个尝试，不猜下界)。
 */
export function selectFeeUtxo(candidates, minRequiredSompi) {
  if (typeof minRequiredSompi !== 'bigint') throw new Error('selectFeeUtxo: minRequiredSompi must be bigint');
  const sufficient = (candidates || []).filter((u) => u.value >= minRequiredSompi);
  if (sufficient.length === 0) {
    throw new Error(`selectFeeUtxo: no_suitable_fee_utxo(没有单个 UTXO 够 ${minRequiredSompi} sompi, v0 不做自动拆分)`);
  }
  sufficient.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  return sufficient[0];
}

// 镜像 kasia-relay/src/lib/covenant-broadcast.mjs 的同名常量(relay 侧 validateSignedInputCeiling 的硬顶,
// Bettor 1386②)——console 侧独立持有一份而不是跨包 import relay 代码("Console 传导不碰链"角色分工铁律,
// 同 GLOBAL_ABS_FEE_CAP_SOMPI 已有的先例)。面值超过这个数的 UTXO 就算真能构造出交易, relay 侧签名前也
// 会被 validateSignedInputCeiling 拒签——预先滤掉, 不浪费一次真实构造+relay round-trip 才发现拒签。
export const SIGNED_INPUT_CEILING_SOMPI = 100_000_000n; // 1.0 KAS

/**
 * §9.5 fee-UTXO 选择器 v2(账本1462修复, 取代 selectFeeUtxo 在 proto-broadcast-ops.mjs 里的用法):
 * 不再用"保守下界"公式猜一个门槛去过滤候选——公式本身(GENESIS_OUTPUT_SOMPI+cap 这类)天然比真实
 * requiredFee 宽松得多(cap 是"发现异常时的上限"不是"预期值"), 用它做预筛选会把真正够用的小面值 UTXO
 * 错误排除掉。改为: 过滤掉面值超过 SIGNED_INPUT_CEILING_SOMPI 的候选(这些即使构造成功, relay 侧也会
 * 拒签, 尝试它们没有意义), 按面值升序逐个真实调用 tryBuild(feeUtxo) 尝试构造(buildMarketGenesisTxJson/
 * buildRegisterAppendTxJson 内部会真的走 calculateTransactionMass + selectChangeShape +
 * assertImpliedFeeMatches——不是估算, 是这笔交易真正需要多少 fee 的唯一权威答案), 第一个构造成功的
 * 立即返回(优先选面值最接近够用的, 减少找零/浪费)。全部失败(或没有一个候选面值 <= 上限)⇒ 抛
 * no_suitable_fee_utxo, 错误信息附上每个候选面值(sompi)+构造失败原因(不含地址——账本1462③要求)。
 * 构造本身是纯本地操作(不签名不广播), 逐个尝试没有副作用, 全部失败也不留任何状态改动。
 * @param {Array<{txid,vout,value:bigint,scriptPublicKeyHex}>} candidates
 * @param {(feeUtxo:object) => object} tryBuild  真实构造函数, 成功返回构造结果对象, 失败 throw
 * @returns {{feeUtxo:object, built:object}}
 */
export function selectFeeUtxoByConstruction(candidates, tryBuild) {
  const eligible = (candidates || []).filter((u) => u.value <= SIGNED_INPUT_CEILING_SOMPI);
  const sorted = [...eligible].sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  const failures = [];
  for (const feeUtxo of sorted) {
    try {
      const built = tryBuild(feeUtxo);
      return { feeUtxo, built };
    } catch (e) {
      failures.push(`value=${feeUtxo.value}: ${e.message}`);
    }
  }
  const excludedCount = (candidates || []).length - eligible.length;
  const detail = failures.length
    ? `逐个真实构造全部失败 — ${failures.join(' | ')}`
    : `没有候选 UTXO 面值 <= SIGNED_INPUT_CEILING_SOMPI(${SIGNED_INPUT_CEILING_SOMPI})(候选总数=${(candidates || []).length}, 超过上限被排除=${excludedCount})`;
  throw new Error(`selectFeeUtxoByConstruction: no_suitable_fee_utxo(${detail})`);
}

// 🔴 找零形状选择(账本1427 Bettor 复核订正——原来的"必须 0 或 >=20M dust 门槛"与 (1404) 已定案的
// 0.95 KAS 步骤B种子面值冲突, 真实迭代出来的找零≈15M 会被那条硬门槛拒到构造不出来)。20M 只是 KIP-9
// U 形曲线上"比较省"的经验点, 不是节点规则——不该当成人为门槛写死。改成按真实成本二选一:
//   (a) 带找零输出: net_loss = 那次真实 mass 算出来的 requiredFee(找零吸收了剩下的全部)。
//   (b) 不留找零, 全部并入手续费: net_loss = 全部剩余(留在合约里的输出 + fee, 没有找零)。
// 在"requiredFee(该形状自己的真实 mass) <= 实际支付的 fee"且"net_loss <= 动态上限
// min(requiredFee×2, absFeeCapSompi, GLOBAL_ABS_FEE_CAP_SOMPI)"都成立的形状里选 net_loss 更小的那个；
// 两个都不成立 ⇒ throw no_viable_change_shape, 报文带两种形状各自的数字。
export const GLOBAL_ABS_FEE_CAP_SOMPI = 100_000_000n; // 1.0 KAS——镜像 kasia-relay/src/lib/covenant-broadcast.mjs 的同名常量, 两侧必须保持一致

export function dynamicNetLossCeiling(requiredFeeSompi, absFeeCapSompi) {
  let ceiling = requiredFeeSompi * 2n;
  if (absFeeCapSompi < ceiling) ceiling = absFeeCapSompi;
  if (GLOBAL_ABS_FEE_CAP_SOMPI < ceiling) ceiling = GLOBAL_ABS_FEE_CAP_SOMPI;
  return ceiling;
}

/**
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.network
 * @param {bigint} o.leftoverSompi  Σin − 保留在合约里的输出总额(找零+fee 两者合计的"剩余额度", 未知谁占多少)
 * @param {Function} o.buildTxWithChange  (changeSompi:bigint) => Transaction(未 finalize, 含找零输出)
 * @param {Function} o.buildTxNoChange  () => Transaction(未 finalize, 无找零输出——剩余全部并入 fee)
 * @param {bigint} o.absFeeCapSompi  该 kind 的 per-kind cap(来自 proto-v0-template-anchors.json 的 feeProfile[kind].cap)
 * @returns {{includeChange:boolean, changeSompi:bigint, requiredFee:bigint, netLoss:bigint, ceiling:bigint, tx:*}}
 */
export function selectChangeShape({ kaspa, network, leftoverSompi, buildTxWithChange, buildTxNoChange, absFeeCapSompi }) {
  if (leftoverSompi < 0n) throw new Error(`selectChangeShape: insufficient inputs(leftover=${leftoverSompi} < 0)`);

  if (leftoverSompi === 0n) {
    const tx = buildTxNoChange();
    tx.finalize();
    const requiredFee = computeRequiredFeeSompiOrThrow(kaspa, network, tx);
    const netLoss = 0n;
    const ceiling = dynamicNetLossCeiling(requiredFee, absFeeCapSompi);
    if (requiredFee > netLoss || netLoss > ceiling) {
      throw new Error(`selectChangeShape: no_viable_change_shape(zero-leftover) requiredFee=${requiredFee} netLoss=${netLoss} ceiling=${ceiling}`);
    }
    return { includeChange: false, changeSompi: 0n, requiredFee, netLoss, ceiling, tx };
  }

  // 形状(a): 带找零。先占位建一次量 mass(与找零【值】无关, 只与结构有关), 再拿真实找零重建。
  let shapeA = null;
  const draftA = buildTxWithChange(leftoverSompi);
  draftA.finalize();
  const requiredFeeA = computeRequiredFeeSompiOrThrow(kaspa, network, draftA);
  const changeA = leftoverSompi - requiredFeeA;
  if (changeA >= 0n) {
    const txA = buildTxWithChange(changeA);
    txA.finalize();
    const netLossA = leftoverSompi - changeA; // = requiredFeeA(找零吸收了剩下的一切)
    const ceilingA = dynamicNetLossCeiling(requiredFeeA, absFeeCapSompi);
    const okA = requiredFeeA <= netLossA && netLossA <= ceilingA;
    shapeA = { includeChange: true, changeSompi: changeA, requiredFee: requiredFeeA, netLoss: netLossA, ceiling: ceilingA, tx: txA, ok: okA };
  }

  // 形状(b): 不留找零, 剩余全部并入 fee。
  const txB = buildTxNoChange();
  txB.finalize();
  const requiredFeeB = computeRequiredFeeSompiOrThrow(kaspa, network, txB);
  const netLossB = leftoverSompi; // 没有找零输出, 剩余全部计入 net_loss
  const ceilingB = dynamicNetLossCeiling(requiredFeeB, absFeeCapSompi);
  const okB = requiredFeeB <= netLossB && netLossB <= ceilingB;
  const shapeB = { includeChange: false, changeSompi: 0n, requiredFee: requiredFeeB, netLoss: netLossB, ceiling: ceilingB, tx: txB, ok: okB };

  const candidates = [shapeA, shapeB].filter((s) => s && s.ok);
  if (!candidates.length) {
    throw new Error(`selectChangeShape: no_viable_change_shape — withChange(requiredFee=${shapeA?.requiredFee ?? 'n/a(insufficient)'}, netLoss=${shapeA?.netLoss ?? 'n/a'}, ceiling=${shapeA?.ceiling ?? 'n/a'}) noChange(requiredFee=${requiredFeeB}, netLoss=${netLossB}, ceiling=${ceilingB})`);
  }
  candidates.sort((x, y) => (x.netLoss < y.netLoss ? -1 : x.netLoss > y.netLoss ? 1 : 0));
  return candidates[0];
}

/**
 * 🔴 账本1455(金丝雀成本核算暴露的真实bug, NWT/Bettor诊断): 构造层唯一的余额不变量断言——finalize
 * 后的真实交易, Σ(inputs.utxo.amount) − Σ(outputs.value) 必须【恰好】等于所选找零形状本该实付的手续费
 * (selectChangeShape 返回的 netLoss——带找零形状=requiredFee, 并入形状=leftoverSompi 全部, 两种情况下
 * netLoss 字段本身已经是这个值, 不需要调用方另外判断 includeChange 再挑一个)。
 * 根因(register_append 曾经的真实bug, 已修复): leftoverSompi 计算公式如果漏计某个非fee输入的真实
 * 面值(比如 leaf/held 这类 covenant 输入自带的、本该抵扣掉的续约价值), 构造出来的交易会比 mass 计算出的
 * requiredFee 多付出那部分差额——这部分差额不会被拒绝广播(kaspad 只要求"至少付够最低费", 不要求"恰好"),
 * 而是静默烧给矿工, 每笔都发生, 且不会在任何地方报错。这条断言把"构造出的真实交易"与"我们以为构造出的
 * 交易"之间的隐性偏差, 从"永远不会被发现的静默财务泄漏"变成"fail-closed 立即拒绝, 绝不返回一笔可能
 * 多付/少付真实矿工费的交易"。
 * @param {*} tx  已 finalize() 的真实 kaspa-wasm Transaction 对象
 * @param {bigint} expectedFeeSompi  期望的真实实付手续费(= selectChangeShape 返回的 netLoss)
 * @param {string} label  报错信息里标注是哪个 kind(market_genesis/register_append)
 */
export function assertImpliedFeeMatches(tx, expectedFeeSompi, label) {
  let sumIn = 0n;
  for (const inp of tx.inputs) sumIn += BigInt(inp.utxo.amount);
  let sumOut = 0n;
  for (const out of tx.outputs) sumOut += BigInt(out.value);
  const impliedFeeSompi = sumIn - sumOut;
  if (impliedFeeSompi !== expectedFeeSompi) {
    throw new Error(`assertImpliedFeeMatches(${label}): implied_fee_mismatch — Σinputs(${sumIn}) - Σoutputs(${sumOut}) = ${impliedFeeSompi} sompi, 与预期实付手续费 ${expectedFeeSompi} sompi 不符(构造层余额公式算错, fail-closed 拒绝返回这笔交易——真实原因见账本1455)`);
  }
}

/**
 * 账本1465修复: 构造层唯一的节点RPC层输入版本一致性断言——镜像 rusty-kaspa v2.0.1(tag v2.0.1=commit
 * cfafeb4c, 主网节点实跑版本)的两条规则:
 *   consensus/core/src/tx.rs:91-96 (ComputeCommit::version_expects_compute_budget_field: version>=1)
 *   rpc/core/src/convert/tx.rs:19-42 (TryFrom<RpcInputWithVersion> for TransactionInput 的实际校验/报错点)
 * version>=1 的交易每个 input 必须 sigOpCount===0(用 computeBudget 代替); version 0 反过来必须
 * computeBudget===0(用 sigOpCount 代替)。这条规则只在 RPC 提交这一层用 Rust 代码校验, kaspa-wasm 的
 * Transaction 构造器/calculateTransactionMass 都不会本地拦下违反它的交易(账本1465闸3金丝雀两次中止都是
 * 在真实广播这一步才被节点拒收, 本地构造+签名+txid核对全部通过——这条断言把"要广播到真实节点才会发现"的
 * 错误挪到"每次构造完成就地拒绝", fail-closed, 不依赖记得手动核对这条规则)。
 * @param {*} tx  已 finalize() 的真实 kaspa-wasm Transaction 对象
 * @param {string} label  报错信息里标注是哪个 kind(market_genesis/register_append)
 */
export function assertKaspadInputVersionRule(tx, label) {
  const expectsComputeBudget = Number(tx.version) >= 1;
  for (let i = 0; i < tx.inputs.length; i++) {
    const input = tx.inputs[i];
    if (expectsComputeBudget) {
      if (Number(input.sigOpCount) !== 0) {
        throw new Error(`assertKaspadInputVersionRule(${label}): input[${i}].sigOpCount=${input.sigOpCount} != 0 — tx.version=${tx.version}(>=1)的交易每个input的sigOpCount必须恒为0(用computeBudget代替), 否则主网节点RPC层会拒收(实测原文: "RpcTransactionInput.sig_op_count is inconsistent with transaction version ${tx.version}", 账本1465)`);
      }
    } else if (Number(input.computeBudget) !== 0) {
      throw new Error(`assertKaspadInputVersionRule(${label}): input[${i}].computeBudget=${input.computeBudget} != 0 — tx.version=${tx.version}(0)的交易每个input的computeBudget必须恒为0(用sigOpCount代替), 否则主网节点RPC层会拒收`);
    }
  }
}

/**
 * 续约输出的唯一构造入口: 强制带 CovenantBinding 声明, 结构上不存在"忘记声明"这条代码路径
 * (省得下一个人手写 new TransactionOutput(...) 漏掉第三个参数——那会让 calculateTransactionMass
 * 把续约输出当成未声明用途的巨型脚本 P2SH, 实测量级可达 >10 倍真实 mass, 见 provenance 向量②)。
 */
export function buildContinuationOutput({ TransactionOutput, CovenantBinding, Hash }, valueSompi, scriptPublicKey, authInputIdx, covenantIdHex) {
  if (!covenantIdHex) throw new Error('buildContinuationOutput: covenantIdHex required(续约输出必须声明 CovenantBinding)');
  return new TransactionOutput(valueSompi, scriptPublicKey, new CovenantBinding(authInputIdx, new Hash(covenantIdHex)));
}

/** 把 '0x...' P2SH scriptPubKey hex(computeMarketGenesisArtifacts/computeKttGenesisArtifact 的返回形状)
 *  转成 kaspa-wasm ScriptPublicKey 对象(version=0, 标准脚本版本)。 */
export function scriptPublicKeyFromHex({ ScriptPublicKey }, hexStr) {
  const clean = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
  return new ScriptPublicKey(0, clean);
}

/**
 * market_genesis 的 tx_json 组装(不签名——relay 侧签 fee 输入): 1 个 relay fee 输入 + 2 个输出
 * [genesis ShardLeaf_direct(固定 GENESIS_OUTPUT_SOMPI) , 找零回 relay]。
 * mass 与输出【值】无关只与【结构】有关, 所以先拿一个占位找零值算一次 mass 拿到 requiredFee, 再拿真实
 * 找零值重建一次拿到最终 tx/txid(两遍构造, 标准做法——第一遍不能直接当成品广播, 找零值是错的)。
 * @param {object} o
 * @param {*} o.kaspa  kaspa-wasm 模块(注入, 供测试用假实现替换)
 * @param {string} o.network
 * @param {{txid:string, vout:number, value:bigint, scriptPublicKeyHex:string}} o.feeUtxo
 * @param {string} o.relayChangeScriptPublicKeyHex  relay 自己地址的 scriptPublicKey(找零去向)
 * @param {string} o.shardLeafScriptPubKeyHex  computeMarketGenesisArtifacts().shardLeafDirect.scriptPubKeyHex
 * @returns {{txJson:string, expectedTxid:string, signInputIndices:number[], genesisOutputIndices:number[], continuationOutputIndices:number[]}}
 */
export function buildMarketGenesisTxJson({ kaspa, network, feeUtxo, relayChangeScriptPublicKeyHex, shardLeafScriptPubKeyHex, absFeeCapSompi }) {
  const { Transaction, TransactionOutput, GenesisCovenantGroup } = kaspa;
  assertFixedOutputValue(GENESIS_OUTPUT_SOMPI, GENESIS_OUTPUT_SOMPI, 'market_genesis'); // 防未来重构悄悄换成算出来的值
  if (typeof absFeeCapSompi !== 'bigint') throw new Error('buildMarketGenesisTxJson: absFeeCapSompi(bigint, feeProfile.market_genesis.cap) required');

  const feeUtxoSpk = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);
  const genesisSpk = scriptPublicKeyFromHex(kaspa, shardLeafScriptPubKeyHex);
  const changeSpk = scriptPublicKeyFromHex(kaspa, relayChangeScriptPublicKeyHex);
  const outpoint = { transactionId: feeUtxo.txid, index: feeUtxo.vout };

  // 账本1465修复: version:1交易sig_op_count必须恒为0, 用compute_budget代替(见文件头PROTO_V0_COMPUTE_BUDGET注释)。
  const mkInput = (sigScript) => ({
    previousOutpoint: outpoint, signatureScript: sigScript, sequence: 0n, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET,
    utxo: { outpoint, amount: feeUtxo.value, scriptPublicKey: feeUtxoSpk, blockDaaScore: 0n },
  });
  // 🔴 genesis 输出(第一次创建 covenant 实例, 不是续约)不用 CovenantBinding——那是"延续既有 covenant_id"
  // 的声明方式。genesis 用 populateGenesisCovenants([new GenesisCovenantGroup(authInputIdx, [outIdx,...])])
  // 声明"output[outIdx] 的 covenant_id 由 input[authInputIdx] 的 outpoint 派生", 同 kasia-relay/src/lib/
  // p2sh.mjs:1878-1885 unlockBshardGenesisMintPayout 既有生产手法逐字一致(Bettor 1427 复核点名)。必须在
  // finalize()/签名之前调用——v1 sighash 把 covenant 字段焊进去, 顺序错了 sighash 就不对。
  const mkOutputs = (changeSompi) => changeSompi === undefined
    ? [new TransactionOutput(GENESIS_OUTPUT_SOMPI, genesisSpk)]
    : [new TransactionOutput(GENESIS_OUTPUT_SOMPI, genesisSpk), new TransactionOutput(changeSompi, changeSpk)];
  const mkTx = (changeSompi) => {
    const t = new Transaction({
      version: 1,
      inputs: [mkInput(new Uint8Array(0))],
      outputs: mkOutputs(changeSompi),
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    t.populateGenesisCovenants([new GenesisCovenantGroup(0, [0])]);
    return t;
  };

  const leftover = feeUtxo.value - GENESIS_OUTPUT_SOMPI;
  const shape = selectChangeShape({
    kaspa, network, leftoverSompi: leftover,
    buildTxWithChange: (changeSompi) => mkTx(changeSompi),
    buildTxNoChange: () => mkTx(undefined),
    absFeeCapSompi,
  });
  assertImpliedFeeMatches(shape.tx, shape.netLoss, 'market_genesis'); // 账本1455: market_genesis 只有
  // 1 个输入(fee 自己), leftover 公式本身没有"漏计其它输入"这个 bug 的作用面, 这里加断言是纵深防御
  // (万一未来改动引入新输入种类), 不是修复本函数自身的问题。
  assertKaspadInputVersionRule(shape.tx, 'market_genesis'); // 账本1465: 主网节点RPC层输入版本一致性规则
  assertMassWithinCeiling({
    kaspa, network, tx: shape.tx, inputHasCovenant: [false], // 唯一输入是普通P2PK fee UTXO, 无covenant
    feeUtxoValueSompi: feeUtxo.value, label: 'market_genesis',
  }); // 账本1497 Bettor MUST: 构造期mass上限fail-closed断言

  // shardLeafCovId: consensus 的 covenant_id(funding.outpoint, [outputIndices]) 是纯函数, 不需要上链
  // 确认——本地就能算出、且不受后续找零值影响(与哪个形状/找零值无关, 同一 outpoint+outIdx 恒定)。
  // 🔴 订正(账本1435→1436, 撤销早前错误说法): covenant_id(outpoint,[index,output]) 的真实公式吃的
  // 是输出的完整脚本字节(含 State), "某代币的 owner=它自己的covenant_id"是自指不动点方程, 无解
  // (rusty-kaspa consensus/core/src/hashing/covenant_id.rs:13-14 doc 原话+真实kaspa-wasm实测确认)。
  // 🔴 D-020(账本1446/1448): 原来这条注释还提到"这个值不能用作 bet_mint 步骤A stake 筹码的
  // ownerCovIdHex, 那个用 STAKE_CHIP_OWNER_UNBOUND"——步骤A(独立 stake 筹码)已随 D-020 取消,
  // STAKE_CHIP_OWNER_UNBOUND 连同该问题一并消失, 不再是这里需要提醒的坑。
  const shardLeafCovId = String(shape.tx.outputs[0].covenant.covenantId);

  return {
    txJson: shape.tx.serializeToSafeJSON(),
    expectedTxid: shape.tx.id,
    shardLeafCovId,
    includeChange: shape.includeChange,
    changeSompi: shape.changeSompi,
    requiredFee: shape.requiredFee,
    netLoss: shape.netLoss,
    signInputIndices: [0],
    genesisOutputIndices: [0],
    continuationOutputIndices: [],
  };
}

/**
 * 落链校验(账本1429/1431 要求的 fail-closed 重算比对): genesis 交易一旦落链, 从**实际落链交易**的
 * input[0] outpoint + genesis 输出本身, 用同一个 consensus 纯函数(kaspa.covenantId)重新算一遍
 * covenant_id, 必须与 prepared 阶段存的 shardleaf_cov_id 完全一致——防"库里存的值与链上实际情况不符"
 * (无论是构造 bug、还是——理论上不该发生但要防——广播过程中输入被替换)。
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.expectedCovId  proto_markets.shardleaf_cov_id(prepared 阶段存的值)
 * @param {{transactionId:string, index:number}} o.landedFundingOutpoint  落链交易实际的 input[0].previousOutpoint
 * @param {{value:bigint, scriptPublicKeyHex:string}} o.landedGenesisOutput  落链交易实际的 genesis 输出(output[genesisOutputIndex])
 * @param {number} o.genesisOutputIndex
 * @returns {{ok:true}|{ok:false, actualCovId:string, reason:string}}
 */
export function verifyShardLeafCovIdAgainstLandedTx({ kaspa, expectedCovId, landedFundingOutpoint, landedGenesisOutput, genesisOutputIndex }) {
  if (!expectedCovId) throw new Error('verifyShardLeafCovIdAgainstLandedTx: expectedCovId required(proto_markets.shardleaf_cov_id 为空——genesis_prepared 阶段没写上这一列)');
  const genesisSpk = scriptPublicKeyFromHex(kaspa, landedGenesisOutput.scriptPublicKeyHex);
  const output = new kaspa.TransactionOutput(landedGenesisOutput.value, genesisSpk);
  const actualCovId = String(kaspa.covenantId(landedFundingOutpoint, [{ index: genesisOutputIndex, output }]));
  if (actualCovId.toLowerCase() !== String(expectedCovId).toLowerCase()) {
    return { ok: false, actualCovId, reason: `落链交易实际算出的 covenant_id(${actualCovId}) 与 prepared 阶段存的 shardleaf_cov_id(${expectedCovId}) 不一致` };
  }
  return { ok: true, actualCovId };
}

/**
 * bet_mint(register_append)的完整 tx_json 组装——不签名(relay 侧只签 fee 输入)。
 * 🔴 D-020(账本1446/1448, a4878d7d)单笔交易形状(取消独立 stake 筹码, 原方案是两步:
 * 步骤A铸stake筹码→步骤B花它, 见 docs/provenance/2026-09-15-j2-d020-register-append-single-tx-
 * verification/): 输入=[leaf, (held 可选), fee], 输出=[leaf续约(CovenantBinding到leaf自己),
 * PoolSideTicket genesis, 合并KTT genesis(owner=leaf的covenant_id, 真实kaspa.covenantId算出,
 * authorizing_input=fee输入, amount=pool_value+stake 纯 witness 值——不再从任何输入 state 读取
 * stake 数量), fee找零]。leaf/held 两个 covenant 输入的 sigScript 全部本地确定性算出(不需要私钥,
 * 同 AB11/binding=cov 声明宏的既有性质), 只有 fee 输入留空待 relay 签。
 *
 * @param {object} o
 * @param {*} o.kaspa
 * @param {string} o.network
 * @param {Buffer} o.leafRedeemScript  computeShardLeafRedeemScript(当前 state)的产物
 * @param {{start:number,len:number}} o.leafStateLayout
 * @param {{txid:string, vout:number}} o.leafOutpoint  proto_markets.shardleaf_txid/vout
 * @param {string} o.leafCovId  proto_markets.shardleaf_cov_id(32字节hex, 无0x)
 * @param {{local_yes:number,local_no:number,count:number,pool_value:number}} o.currentState  下注前的 state(deriveLeafState)
 * @param {{local_yes:number,local_no:number,count:number,pool_value:number}} o.newState  下注后的 state
 * @param {object|null} o.heldInput  首次下注为 null; 否则 {txid,vout,value,scriptPublicKeyHex,redeemScript(Buffer),covId,entryAbi,stateFieldCount}
 * @param {object} o.feeUtxo  {txid,vout,value,scriptPublicKeyHex}
 * @param {string} o.relayChangeScriptPublicKeyHex
 * @param {object} o.registerAppendEntryAbi  compileSilV100(...)._raw.contracts.ShardLeaf_direct.entries.register_append(当前ctor下重新编译现读, 不跨市场复用)
 * @param {object} o.registerAppendArgs  {side, stake, bettorPk(32字节hex), psPrefix, psSuffix, tokPrefix, tokSuffix}
 * @param {string} o.ticketScriptPubKeyHex  PoolSideTicket genesis 的 scriptPubKeyHex(computeGeneric 产物)
 * @param {string} o.mergedKttScriptPubKeyHex  合并KTT genesis(computeKttGenesisArtifact({amount:pool_value+stake, ownerCovIdHex:leafCovId}))的 scriptPubKeyHex(不含0x的裸脚本hex, 用于起算covenant_id)
 * @param {Buffer} o.mergedKttScript  同上, 完整脚本字节(Buffer)
 * @param {bigint} o.absFeeCapSompi  feeProfile.register_append.cap(账本1462改名，原 bet_mint_step_b)
 */
export function buildRegisterAppendTxJson({
  kaspa, network, leafRedeemScript, leafStateLayout, leafOutpoint, leafCovId, currentState, newState,
  heldInput, feeUtxo, relayChangeScriptPublicKeyHex,
  registerAppendEntryAbi, registerAppendArgs, ticketScriptPubKeyHex, mergedKttScript, absFeeCapSompi,
}) {
  const { Transaction, TransactionOutput, GenesisCovenantGroup } = kaspa;
  const mergedAmount = newState.pool_value; // = currentState.pool_value + registerAppendArgs.stake, 调用方已算好放进 newState

  // ── 输入 index 布局(D-020后): [0]leaf [1]held?(可选) [最后]fee ──
  const inputs = [];
  const leafOutpointObj = { transactionId: leafOutpoint.txid, index: leafOutpoint.vout };
  inputs.push({ kind: 'leaf' });
  let heldIdx = -1, feeIdx;
  if (heldInput) {
    heldIdx = inputs.length; inputs.push({ kind: 'held' });
  }
  feeIdx = inputs.length; inputs.push({ kind: 'fee' });

  const leafSpk = scriptPublicKeyFromHex(kaspa, '0x' + p2shHexFromScript(kaspa, leafRedeemScript));
  const feeUtxoSpk = scriptPublicKeyFromHex(kaspa, feeUtxo.scriptPublicKeyHex);
  const heldSpk = heldInput ? scriptPublicKeyFromHex(kaspa, heldInput.scriptPublicKeyHex) : null;

  // leaf 自己的 register_append witness(不需要私钥, AB11 声明宏性质——见 proto-register-append-witness.mjs)。
  // D-020: 10 参数, 不再有 stakeInIdx(无独立 stake 筹码输入)。
  const leafAction = encodeRegisterAppendAction(kaspa, registerAppendEntryAbi, {
    side: registerAppendArgs.side, stake: registerAppendArgs.stake, leafOutIdx: REGISTER_APPEND_LEAF_CONT_OUT_INDEX, psOutIdx: REGISTER_APPEND_TICKET_OUT_INDEX,
    bettorPk: registerAppendArgs.bettorPk, ps_prefix: registerAppendArgs.psPrefix, ps_suffix: registerAppendArgs.psSuffix,
    tok_out: REGISTER_APPEND_TOK_OUT_INDEX, tok_prefix: registerAppendArgs.tokPrefix, tok_suffix: registerAppendArgs.tokSuffix,
  });
  const leafSigScriptHex = combineRegisterAppendActionAndRedeem(kaspa, leafAction, leafRedeemScript);
  const heldSigScriptHex = heldInput
    ? combineKttActionAndRedeem(kaspa, encodeKttTransferZeroOutAction(kaspa, heldInput.entryAbi, heldInput.stateFieldCount, [0]), heldInput.redeemScript)
    : null;

  // 账本1465修复: version:1交易sig_op_count必须恒为0, 用compute_budget代替(见文件头PROTO_V0_COMPUTE_BUDGET注释)。
  const mkInput = (outpoint, value, spk, sigScriptHex) => ({
    previousOutpoint: outpoint, signatureScript: sigScriptHex ?? new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET,
    utxo: { outpoint, amount: value, scriptPublicKey: spk, blockDaaScore: 0n },
  });

  // 新 leaf 续约的 AB11 手写 state 字节(与合约自己内部算的完全同一套编码, 已用真实编译独立交叉验证过, 见 proto-leaf-state.mjs)。
  const newStateBytes = encodeLeafStateBytes(newState);
  const leafPrefix = leafRedeemScript.subarray(0, leafStateLayout.start);
  const leafSuffix = leafRedeemScript.subarray(leafStateLayout.start + leafStateLayout.len);
  const leafContRedeem = Buffer.concat([leafPrefix, newStateBytes, leafSuffix]);
  const leafContSpk = scriptPublicKeyFromHex(kaspa, '0x' + p2shHexFromScript(kaspa, leafContRedeem));
  const mergedKttSpk = scriptPublicKeyFromHex(kaspa, '0x' + p2shHexFromScript(kaspa, mergedKttScript));
  const ticketSpk = scriptPublicKeyFromHex(kaspa, ticketScriptPubKeyHex);

  const mkTx = (feeChangeSompi) => {
    const feeInputSigScript = new Uint8Array(0); // relay 待签
    const txInputs = [];
    txInputs[0] = mkInput(leafOutpointObj, currentStateUtxoValueOf(leafOutpoint), leafSpk, leafSigScriptHex);
    if (heldInput) txInputs[heldIdx] = mkInput({ transactionId: heldInput.txid, index: heldInput.vout }, heldInput.value, heldSpk, heldSigScriptHex);
    txInputs[feeIdx] = mkInput({ transactionId: feeUtxo.txid, index: feeUtxo.vout }, feeUtxo.value, feeUtxoSpk, feeInputSigScript);

    const t = new Transaction({
      version: 1,
      inputs: txInputs,
      outputs: [
        new TransactionOutput(CONTINUATION_OUTPUT_SOMPI, leafContSpk), // [0] leaf续约, CovenantBinding 后面 populateGenesisCovenants/CovenantBinding 声明
        new TransactionOutput(GENESIS_OUTPUT_SOMPI, ticketSpk), // [1] ticket genesis(无covenant声明)
        new TransactionOutput(GENESIS_OUTPUT_SOMPI, mergedKttSpk), // [2] 合并KTT genesis
        new TransactionOutput(feeChangeSompi === undefined ? 0n : feeChangeSompi, feeUtxoSpk), // [3] fee找零(占位spk复用fee自己的, 调用方可在真正广播前替换成真实找零地址; 本函数不决定找零去向, 只决定形状)
      ].filter((_, i) => !(feeChangeSompi === undefined && i === 3)),
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    // leaf续约: CovenantBinding到leaf自己(authorizing_input=0, covenant_id=leafCovId)
    t.outputs[REGISTER_APPEND_LEAF_CONT_OUT_INDEX].covenant = new kaspa.CovenantBinding(0, new kaspa.Hash(leafCovId));
    // 合并KTT genesis: authorizing_input=fee输入(账本1434③要求, 规避authorizing input本身是covenant的未知项)
    t.populateGenesisCovenants([new GenesisCovenantGroup(feeIdx, [REGISTER_APPEND_TOK_OUT_INDEX])]);
    return t;
  };

  // 🔴 账本1455修复(真实bug, 金丝雀成本核算暴露·NWT/Bettor诊断): 原公式
  // `feeUtxo.value - CONTINUATION_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI`
  // 只计入 fee 输入的面值, 但真实交易的 txInputs(见上面 mkTx)还包含 leaf 输入(其真实面值
  // currentStateUtxoValueOf(leafOutpoint) = CONTINUATION_OUTPUT_SOMPI, 每笔恒有)以及——第二笔起——
  // held 输入(heldInput.value = CONTINUATION_OUTPUT_SOMPI)。这两个输入各自的真实面值本该被记入
  // "总可用余额"(它们各自 1:1 抵扣掉 leaf续约/合并KTT 这两个输出里对应的那一份, 是这两个 covenant
  // 输入"自带"的续约价值, 不是凭空冒出来的), 漏计的后果是: 每次构造出的真实交易, Σ真实inputs −
  // Σ真实outputs(= 真实矿工费)会比这里算出来的 requiredFee 恰好多出 leafValue(+heldValue, 若有)——
  // 这部分差额不会被 kaspad 拒绝广播(节点只要求"至少付够最低费", 不要求"恰好"), 而是每笔都静默烧给
  // 矿工, 从不在任何地方报错。leaf/held 各自的真实输入面值取自同一个来源(currentStateUtxoValueOf/
  // heldInput.value), 与上面 mkTx 实际塞进 txInputs 的值完全同源, 不另写一份可能漂移的常量。
  const leafInputValue = currentStateUtxoValueOf(leafOutpoint);
  const heldInputValue = heldInput ? heldInput.value : 0n;
  const leftover = feeUtxo.value + leafInputValue + heldInputValue - CONTINUATION_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI;
  const shape = selectChangeShape({
    kaspa, network, leftoverSompi: leftover,
    buildTxWithChange: (changeSompi) => mkTx(changeSompi),
    buildTxNoChange: () => mkTx(undefined),
    absFeeCapSompi,
  });
  assertImpliedFeeMatches(shape.tx, shape.netLoss, 'register_append');
  assertKaspadInputVersionRule(shape.tx, 'register_append'); // 账本1465: 主网节点RPC层输入版本一致性规则
  {
    // 账本1497 Bettor MUST: 构造期mass上限fail-closed断言。inputHasCovenant与上面mkTx真实塞入
    // txInputs的顺序(inputs数组标记的kind)一一对应——leaf/held是covenant续约输入(带covenant), fee是
    // 普通输入, 与tx.inputs.length严格一致(plurality由断言按输入utxo的spk长度+此位现算, 不再传槽位常量)。
    const inputHasCovenant = inputs.map((slot) => slot.kind !== 'fee');
    assertMassWithinCeiling({
      kaspa, network, tx: shape.tx, inputHasCovenant, feeUtxoValueSompi: feeUtxo.value, label: 'register_append',
    });
  }

  const mergedKttCovId = String(shape.tx.outputs[REGISTER_APPEND_TOK_OUT_INDEX].covenant.covenantId);

  return {
    txJson: shape.tx.serializeToSafeJSON(),
    expectedTxid: shape.tx.id,
    mergedKttCovId,
    includeChange: shape.includeChange,
    changeSompi: shape.changeSompi,
    requiredFee: shape.requiredFee,
    netLoss: shape.netLoss,
    signInputIndices: [feeIdx],
    genesisOutputIndices: [REGISTER_APPEND_TOK_OUT_INDEX],
    continuationOutputIndices: [REGISTER_APPEND_LEAF_CONT_OUT_INDEX],
  };
}

function p2shHexFromScript(kaspa, scriptBytes) {
  // 复用 ScriptBuilder 的 createPayToScriptHashScript 更省事, 但要用真实脚本先建 builder;
  // 这里直接用 kaspa.payToScriptHashScript(若存在)否则退回本地 blake2b 拼接(与 proto-covenant-builder.mjs 的 p2sh 一致公式)。
  if (typeof kaspa.payToScriptHashScript === 'function') {
    const spk = kaspa.payToScriptHashScript(new Uint8Array(scriptBytes));
    return spk.script;
  }
  throw new Error('p2shHexFromScript: kaspa.payToScriptHashScript not available');
}

function currentStateUtxoValueOf() {
  // leaf 自己的 UTXO 面值恒为 CONTINUATION_OUTPUT_SOMPI(每次续约都固定在这个 KIP-9 最优点, 见
  // kasia-relay/src/lib/covenant-broadcast.mjs 同名常量)。独立成一个具名函数只是为了将来若这个假设
  // 需要改成"从链上查真实值"时, 只有一处要改。
  return CONTINUATION_OUTPUT_SOMPI;
}
