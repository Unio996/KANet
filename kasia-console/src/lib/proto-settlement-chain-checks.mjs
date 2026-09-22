// proto-settlement-chain-checks.mjs — C1(Bettor 2026-09-19, NWT): 各结算步骤的 covenant 输入的【链上真实面值】断言, 与 N-1 步骤①(assertLeafStateMatchesChain 的
// leaf 面值 == CONTINUATION_OUTPUT_SOMPI)同型。
//
// 为什么: 各 builder 按常量(CONT/GENESIS 各 20,000,000)算 leftover 与 mass, 输入面值取的是常量而不是链上真值。register_append 无签名可调, 合约只要求 leaf 续约
// 输出 value ≥ DUST_MIN; RootClose/RootClaim 的 convert_to_claim 与 refund_flip 同样无签名可调——任何人可改面值。builder 按常量算而链上面值不同 ⇒ 偏小卡死、偏大静默烧费
// 并低估 mass。批6/7 的输入会继承这个风险。这里是入口拦截(driver 层, 构造之前); 真修(builder 用链上真值算 leftover)并入 D-018 重评估另开票。
//
// 🔴 范围(Bettor 2026-09-19 转 Codex 新不变量): 每个 covenant 输入(RootClose / RootClaim / ticket / held KTT / leaf …)在构造前, 链上 UTXO 的【value 与 spk】都必须等于 builder 的假设值
// (value = 常量; spk = 调用方按当前状态现算的 artifact spk), 与 leaf 那条同型, 正反向量各一; 断言过后 mass 计算只能用这些经断言的值(builder 的输入 utxo 本就取自这些常量/现算 spk,
// 断言证明它们等于链上事实)。fee 输入不在此列(它有签名, 面值低估则签名不成立、节点拒收)。
//
// 纯函数, 调用方(驱动)传入从 relay UTXO 快照取到的链上 UTXO({value, spent?, scriptPublicKeyHex}) 与 builder 假设的 spk(expectedSpks), 不查链、不读 DB。

import { CONTINUATION_OUTPUT_SOMPI, GENESIS_OUTPUT_SOMPI } from './proto-tx-assembly.mjs';

/** 各角色 covenant/输入 UTXO 的期望链上面值(builder 所假定的常量)。 */
export const EXPECTED_INPUT_VALUE_SOMPI = Object.freeze({
  leaf: CONTINUATION_OUTPUT_SOMPI,      // ShardLeaf_direct 续约输出
  rootClose: CONTINUATION_OUTPUT_SOMPI, // market_seal 产出的 RootClose genesis / close_commit 续约输出
  rootClaim: CONTINUATION_OUTPUT_SOMPI, // convert_to_claim 产出的 RootClaim genesis
  held: GENESIS_OUTPUT_SOMPI,           // 合并 KTT(register_append/market_seal/convert_to_claim 产出的代币输出)
  ticket: GENESIS_OUTPUT_SOMPI,         // register_append 产出的 PoolSideTicket 输出
  claim: CONTINUATION_OUTPUT_SOMPI,     // claim_draw 产出的 KanetTokenClaim genesis 输出(批7 withdraw 的输入0)
});

/** 每个步骤需要核对的输入角色(与各 builder 的输入布局一一对应)。 */
export const STEP_INPUT_ROLES = Object.freeze({
  seal: ['leaf', 'held'],
  close_commit: ['rootClose'],
  refund_flip: ['rootClose'],           // R-a: 输入 0 = RootClose(closed:0), 输入 1 = fee(与 close_commit 同布局, 无委员签名)
  convert_to_claim: ['rootClose', 'held'],
  claim_draw: ['rootClaim', 'ticket', 'held'],
  // withdraw(批7 已按真实输入布局复核并由 proto-claim-draw.test.mjs ⑲ 钉死): 输入0=KanetTokenClaim(claim), 输入1=其持有的代币(held), 输入2=fee(不在表内);
  // ticket_reclaim(批8 落码时按其真实输入布局复核): 消费输家 ticket。
  withdraw: ['claim', 'held'],
  ticket_reclaim: ['ticket'],
});

/**
 * 类型化错误(9-1 设计 §19.3 步骤 4 / NWT §19.6 #2): `.code` 取【闭集】(见 chainCheckCodes()), `.message` **保留原标签文本**——
 * 现有调用方与测试靠正则匹配消息文本(`<role>_value_drift` / `<role>_spk_drift` …), 改文本会破坏它们, 所以文本不变,
 * 稳定的机器可读标识放在 `.code`。现有三类错误(value_drift / spk_drift / 缺失类)也带 `.code`, 不只是新增两类。
 */
export class SettlementChainCheckError extends Error {
  constructor(code, message, { step, role } = {}) {
    super(message);
    this.name = 'SettlementChainCheckError';
    this.code = code;
    this.step = step;
    this.role = role;
  }
}

/** `.code` 的闭集: 每个角色 4 类 + 2 个与角色无关的码。测试断言"抛出的每个错误都带闭集内的 code"。 */
export function chainCheckCodes() {
  const kinds = ['value_drift', 'spk_drift', 'outpoint_drift', 'covenant_class_mismatch'];
  const roleCodes = Object.keys(EXPECTED_INPUT_VALUE_SOMPI).flatMap((r) => kinds.map((k) => `${r}_${k}`));
  return Object.freeze([...roleCodes, 'chain_check_params_missing', 'chain_check_unknown_step']);
}

const HEX64 = /^[0-9a-f]{64}$/;
const normHex = (h) => String(h ?? '').replace(/^0x/i, '').toLowerCase();

/**
 * @param {{
 *   step: string,
 *   chainUtxos: Record<string,{value:bigint|string|number, spent?:boolean, scriptPublicKeyHex:string, outpoint:{transactionId:string,index:number}, covenantId:string|null}|null|undefined>,
 *   expectedSpks: Record<string,string>,
 *   expectedOutpoints: Record<string,{transactionId:string,index:number}>,
 *   expectedCovenantIds: Record<string,string|null>,
 * }} o
 *   expectedSpks[role] = builder 假设的该输入 spk(调用方按当前状态现算的 artifact scriptPubKey, 带不带 0x 均可; 缺失即 fail-closed)
 *   expectedOutpoints[role] = 该输入的【预期 outpoint】(§18.1 的 S10 来源表, 由 proto-settlement-pointers 产出)——**必填(M6)**: 断言 chainUtxos[role].outpoint 与它
 *     相等(txid 与 index 都相等)。没有它, "同 spk、同面值、不同 outpoint"只能靠调用方自觉按 outpoint 取, 任何调用点写错就静默通过。
 *   expectedCovenantIds[role] = 该输入的【预期 covenant id】(64 位 hex), 或 `null` = 必须无 covenant(如 ticket)——**必填(M6)**: 相等断言, 不只是"有/无"。
 *   两个 M6 参数都【没有默认值】: 缺失一律 fail-closed(chain_check_params_missing)。
 * @returns {{ok:true, checked:string[]}}
 * @throws {SettlementChainCheckError} `.code` ∈ chainCheckCodes():
 *   缺失/已花费/面值缺失/面值不等/面值非整数 ⇒ `<role>_value_drift`; spk 不符/链上 spk 缺失 ⇒ `<role>_spk_drift`;
 *   outpoint 不等/链上 outpoint 缺失 ⇒ `<role>_outpoint_drift`; covenant 分类或 id 不符/链上 covenantId 缺失 ⇒ `<role>_covenant_class_mismatch`;
 *   任何必填入参缺失或形状不合法 ⇒ `chain_check_params_missing`; 未知步骤 ⇒ `chain_check_unknown_step`。
 */
export function assertSettlementInputValuesOnChain({ step, chainUtxos, expectedSpks, expectedOutpoints, expectedCovenantIds }) {
  const roles = STEP_INPUT_ROLES[step];
  const E = (code, message, role) => new SettlementChainCheckError(code, message, { step, role });
  if (!roles) throw E('chain_check_unknown_step', `assertSettlementInputValuesOnChain: 未知步骤 ${step}(已知: ${Object.keys(STEP_INPUT_ROLES).join(',')})`);
  if (!chainUtxos || typeof chainUtxos !== 'object') throw E('chain_check_params_missing', `assertSettlementInputValuesOnChain(${step}): fail-closed — chainUtxos 缺失`);
  if (!expectedSpks || typeof expectedSpks !== 'object') throw E('chain_check_params_missing', `assertSettlementInputValuesOnChain(${step}): fail-closed — expectedSpks 缺失(必须给出 builder 假设的各输入 spk)`);
  if (!expectedOutpoints || typeof expectedOutpoints !== 'object') throw E('chain_check_params_missing', `assertSettlementInputValuesOnChain(${step}): fail-closed — expectedOutpoints 缺失(M6 必填: 必须给出每个输入的预期 outpoint, 没有默认值)`);
  if (!expectedCovenantIds || typeof expectedCovenantIds !== 'object') throw E('chain_check_params_missing', `assertSettlementInputValuesOnChain(${step}): fail-closed — expectedCovenantIds 缺失(M6 必填: 每个输入的预期 covenant id 或 null, 没有默认值)`);
  for (const role of roles) {
    const u = chainUtxos[role];
    const tag = `assertSettlementInputValuesOnChain(${step}): ${role}_value_drift — fail-closed`;
    if (!u) throw E(`${role}_value_drift`, `${tag}: ${role} 的链上 UTXO 查不到(指针错误或已被花费到未追踪的输出)`, role);
    if (u.spent) throw E(`${role}_value_drift`, `${tag}: ${role} 的链上 UTXO 已被花费, 拒绝在一个不存在的 UTXO 上构造交易`, role);
    if (u.value === undefined || u.value === null) throw E(`${role}_value_drift`, `${tag}: ${role} 的链上面值缺失(调用方必须传真实面值)`, role);
    const want = EXPECTED_INPUT_VALUE_SOMPI[role];
    let got;
    try { got = BigInt(u.value); } catch { throw E(`${role}_value_drift`, `${tag}: ${role} 的链上面值(${String(u.value).slice(0, 40)})不是整数——BigInt 无法解析(调用方必须传真实面值)`, role); }
    if (got !== want) {
      throw E(`${role}_value_drift`, `${tag}: ${role} 的链上面值(${u.value}) != builder 假定的常量(${want}); 面值不等会导致构造卡死或静默烧费并低估 mass(该 UTXO 无签名可调, 任何人可改面值)`, role);
    }
    const wantSpk = normHex(expectedSpks[role]);
    if (!wantSpk) throw E('chain_check_params_missing', `${tag}: ${role} 缺少 builder 假设的 spk(expectedSpks.${role})`, role);
    const gotSpk = normHex(u.scriptPublicKeyHex);
    if (!gotSpk) throw E(`${role}_spk_drift`, `${tag}: ${role} 的链上 spk 缺失(调用方必须传 scriptPublicKeyHex)`, role);
    if (gotSpk !== wantSpk) {
      throw E(`${role}_spk_drift`, `${role}_spk_drift — fail-closed: assertSettlementInputValuesOnChain(${step}): ${role} 的链上 spk(${gotSpk.slice(0, 12)}…) != builder 假设的 spk(${wantSpk.slice(0, 12)}…): 状态/参数与链上已不自洽`, role);
    }

    // ── M6(v0.3.4 §19.3 步骤 4): outpoint 相等 + covenantId 相等(不只有/无) ──
    const wantOp = expectedOutpoints[role];
    if (!wantOp || typeof wantOp !== 'object' || !HEX64.test(String(wantOp.transactionId ?? '').toLowerCase()) || !Number.isInteger(wantOp.index) || wantOp.index < 0) {
      throw E('chain_check_params_missing', `assertSettlementInputValuesOnChain(${step}): ${role} 缺少或格式不合法的预期 outpoint(expectedOutpoints.${role} 须为 {transactionId:64位hex, index:非负整数}, 没有默认值)`, role);
    }
    const gotOp = u.outpoint;
    if (!gotOp || typeof gotOp !== 'object' || gotOp.transactionId === undefined || gotOp.index === undefined) {
      throw E(`${role}_outpoint_drift`, `${role}_outpoint_drift — fail-closed: assertSettlementInputValuesOnChain(${step}): ${role} 的链上条目缺 outpoint(调用方必须传链上事实里的 outpoint)`, role);
    }
    if (String(gotOp.transactionId).toLowerCase() !== String(wantOp.transactionId).toLowerCase() || Number(gotOp.index) !== wantOp.index) {
      throw E(`${role}_outpoint_drift`, `${role}_outpoint_drift — fail-closed: assertSettlementInputValuesOnChain(${step}): ${role} 的链上 outpoint(${String(gotOp.transactionId).slice(0, 12)}…:${gotOp.index}) != 预期指针(${String(wantOp.transactionId).slice(0, 12)}…:${wantOp.index}): 同 spk 同面值也不得当成目标(不得退化成取第一个匹配的)`, role);
    }
    if (!Object.prototype.hasOwnProperty.call(expectedCovenantIds, role)) {
      throw E('chain_check_params_missing', `assertSettlementInputValuesOnChain(${step}): ${role} 缺少预期 covenant id(expectedCovenantIds.${role} 须为 64 位 hex 或 null, 没有默认值)`, role);
    }
    const wantCov = expectedCovenantIds[role];
    if (wantCov !== null && !(typeof wantCov === 'string' && HEX64.test(wantCov.toLowerCase()))) {
      throw E('chain_check_params_missing', `assertSettlementInputValuesOnChain(${step}): ${role} 的预期 covenant id 格式不合法(须为 64 位 hex 或 null)`, role);
    }
    if (!Object.prototype.hasOwnProperty.call(u, 'covenantId')) {
      throw E(`${role}_covenant_class_mismatch`, `${role}_covenant_class_mismatch — fail-closed: assertSettlementInputValuesOnChain(${step}): ${role} 的链上条目缺 covenantId 键(调用方必须传链上事实, 缺键不能当成"无 covenant")`, role);
    }
    const gotCov = u.covenantId;
    if (gotCov !== null && !(typeof gotCov === 'string' && HEX64.test(gotCov.toLowerCase()))) {
      throw E(`${role}_covenant_class_mismatch`, `${role}_covenant_class_mismatch — fail-closed: assertSettlementInputValuesOnChain(${step}): ${role} 的链上 covenantId 格式不合法(须为 64 位 hex 或 null)`, role);
    }
    const covOk = wantCov === null ? gotCov === null : (gotCov !== null && gotCov.toLowerCase() === wantCov.toLowerCase());
    if (!covOk) {
      throw E(`${role}_covenant_class_mismatch`, `${role}_covenant_class_mismatch — fail-closed: assertSettlementInputValuesOnChain(${step}): ${role} 的链上 covenant(${gotCov === null ? '无' : String(gotCov).slice(0, 12) + '…'}) != 预期(${wantCov === null ? '必须无 covenant' : wantCov.slice(0, 12) + '…'}): 输入种类与链上事实不符, mass 的 plurality 会算错`, role);
    }
  }
  return { ok: true, checked: [...roles] };
}
