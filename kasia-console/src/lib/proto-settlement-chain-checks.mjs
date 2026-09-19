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
  convert_to_claim: ['rootClose', 'held'],
  claim_draw: ['rootClaim', 'ticket', 'held'],
  // withdraw(批7 已按真实输入布局复核并由 proto-claim-draw.test.mjs ⑲ 钉死): 输入0=KanetTokenClaim(claim), 输入1=其持有的代币(held), 输入2=fee(不在表内);
  // ticket_reclaim(批8 落码时按其真实输入布局复核): 消费输家 ticket。
  withdraw: ['claim', 'held'],
  ticket_reclaim: ['ticket'],
});

/**
 * @param {{step:string, chainUtxos:Record<string,{value:bigint|string|number, spent?:boolean, scriptPublicKeyHex:string}|null|undefined>, expectedSpks:Record<string,string>}} o
 *   expectedSpks[role] = builder 假设的该输入 spk(调用方按当前状态现算的 artifact scriptPubKey, 带不带 0x 均可; 缺失即 fail-closed)
 * @returns {{ok:true, checked:string[]}}
 * @throws 缺失/已花费/面值缺失/面值不等 ⇒ `<role>_value_drift` fail-closed
 */
export function assertSettlementInputValuesOnChain({ step, chainUtxos, expectedSpks }) {
  const roles = STEP_INPUT_ROLES[step];
  if (!roles) throw new Error(`assertSettlementInputValuesOnChain: 未知步骤 ${step}(已知: ${Object.keys(STEP_INPUT_ROLES).join(',')})`);
  if (!chainUtxos || typeof chainUtxos !== 'object') throw new Error(`assertSettlementInputValuesOnChain(${step}): fail-closed — chainUtxos 缺失`);
  if (!expectedSpks || typeof expectedSpks !== 'object') throw new Error(`assertSettlementInputValuesOnChain(${step}): fail-closed — expectedSpks 缺失(必须给出 builder 假设的各输入 spk)`);
  const norm = (h) => String(h ?? '').replace(/^0x/i, '').toLowerCase();
  for (const role of roles) {
    const u = chainUtxos[role];
    const tag = `assertSettlementInputValuesOnChain(${step}): ${role}_value_drift — fail-closed`;
    if (!u) throw new Error(`${tag}: ${role} 的链上 UTXO 查不到(指针错误或已被花费到未追踪的输出)`);
    if (u.spent) throw new Error(`${tag}: ${role} 的链上 UTXO 已被花费, 拒绝在一个不存在的 UTXO 上构造交易`);
    if (u.value === undefined || u.value === null) throw new Error(`${tag}: ${role} 的链上面值缺失(调用方必须传真实面值)`);
    const want = EXPECTED_INPUT_VALUE_SOMPI[role];
    if (BigInt(u.value) !== want) {
      throw new Error(`${tag}: ${role} 的链上面值(${u.value}) != builder 假定的常量(${want}); 面值不等会导致构造卡死或静默烧费并低估 mass(该 UTXO 无签名可调, 任何人可改面值)`);
    }
    const wantSpk = norm(expectedSpks[role]);
    if (!wantSpk) throw new Error(`${tag}: ${role} 缺少 builder 假设的 spk(expectedSpks.${role})`);
    const gotSpk = norm(u.scriptPublicKeyHex);
    if (!gotSpk) throw new Error(`${tag}: ${role} 的链上 spk 缺失(调用方必须传 scriptPublicKeyHex)`);
    if (gotSpk !== wantSpk) {
      throw new Error(`${role}_spk_drift — fail-closed: assertSettlementInputValuesOnChain(${step}): ${role} 的链上 spk(${gotSpk.slice(0, 12)}…) != builder 假设的 spk(${wantSpk.slice(0, 12)}…): 状态/参数与链上已不自洽`);
    }
  }
  return { ok: true, checked: [...roles] };
}
