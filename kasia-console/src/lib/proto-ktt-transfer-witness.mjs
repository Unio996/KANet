// proto-ktt-transfer-witness.mjs — KanetTestToken.transfer(binding=cov 声明宏生成的 leader 入口)真实
// v1.0.0 sigScript 编码, 专为 bet_mint 步骤B 的 held/stake 消费场景(next_states=[], witness=[] 空,
// owner_input_idx=[单个index]——见 docs/provenance/2026-09-15-j2-ktt-dual-lineage-merge-cardinality-
// check/ 与 2026-09-15-j2-stake-chip-owner-unbound-verification/ 已验证的 shapeY: 每个 KTT 输入各自
// 独立的 covenant 组, 组内只有它自己一个成员, 因此永远是 leader, 从不需要 transfer_delegator)。
//
// 官方编码来源(D-019 pin 3ed973335b59269293564805cc2c58a14595ec03): `encode_contract_covenant_decl_
// sig_script`(silverscript-abi/src/lib.rs:462-480)按声明名解析出真实 entry(这里是"transfer"), 转call
// `encode_entry_sig_script`——和普通 entry 走的是同一个函数, 区别只在"怎么找到 entry_name", 编码逻辑
// 完全一样。`transfer` 的三个 witness 参数(声明顺序, 来自真实编译产物 entries.transfer.params, 每次
// 用都现读不硬编): `next_states: State[]`(dynamic_array<struct>)/`witness: bytes`/`owner_input_idx:
// int[]`(dynamic_array<int>)。
//
// 🔴 State[] 数组的编码不是"每个元素单独push"——push_sig_arg 对 DynamicArray<Struct> 特殊处理
// (push_struct_array_fields, silverscript-abi/src/lib.rs:967-1000): 按 struct 的每个字段转置成"这个
// 字段在所有元素上的值"组成一个新的 DynamicArray<字段类型>, 分别 push(SoA 布局, 不是 AoS)。
// next_states=[](0元素)时, 每个字段的转置数组也是空数组, encode_array_payload 对空数组产出空 payload
// ⇒ push_data(空) = OP_0——State 有几个字段就有几个 OP_0, 和"State 里有几个元素"无关。
// 本模块只覆盖 next_states=[] 这一种情况(已验证, 见下)——若未来需要传非空 next_states, 必须先补上
// 非空场景的决定性验证(读到的字段顺序不同会直接编错), 不能凭这份代码里的字段顺序猜测套用。
//
// int[] 数组(owner_input_idx)的编码: encode_array_payload 把每个元素 serialize_fixed_i64(v,8)
// (8字节小端)拼接成一个 payload, 整体当【一个】push_data(不是每个元素单独 push)。
//
// 决定性验证: 用这份编码器对 owner_input_idx=[3] 编出的字节, 与真实 D-019 pin 的 cli-debugger 跑
// docs/provenance/2026-09-15-j2-stake-chip-owner-unbound-verification/ 的
// "①c_stake_transfer_owner_unbound_via_fee_input_pass"(真实 PASS 向量)内部构造出的 active_sigscript
// 逐字节完全一致(临时调试打印手法同 proto-register-append-witness.mjs, 验证后已还原)。
// State struct 字段数(KanetTestToken 的 State: amount/owner/owner_scheme/borrow_scheme/borrow_guard/
// extension_commitment, 共6个)从真实编译产物读取校验, 不硬编"6"这个数字本身的含义(硬编的是"读几个
// OP_0", 但读取来源是 abi.structs.State.fields.length, 防止合约改字段后这里悄悄编错还不报错)。

function hexToBytes(h) {
  if (Buffer.isBuffer(h)) return h;
  if (Array.isArray(h)) return Buffer.from(h);
  return Buffer.from(h.startsWith('0x') ? h.slice(2) : h, 'hex');
}

/**
 * @param {object} kaspa
 * @param {object} entryAbi  compileSilV100(...)._raw.contracts.KanetTestToken.entries.transfer
 * @param {number} stateFieldCount  compileSilV100(...)._raw.contracts.KanetTestToken.runtime_state.
 *   fields.length(🔴 不是 `_raw.structs.State`——KanetTestToken 没有用 `struct` 关键字声明一个叫
 *   State 的具名结构体, 顶层 `structs` 注册表是空的; State 字段来自内建的 `runtime_state.fields`,
 *   每次用都从真实编译产物现读, 不硬编"6"这个数字)
 * @param {number[]} ownerInputIdx  单个元素数组(本模块只覆盖 leader-of-one 场景), 如 [3]
 * @returns {string} action 的 hex(不含 redeem, 同 proto-register-append-witness.mjs 的 action 语义)
 */
export function encodeKttTransferZeroOutAction(kaspa, entryAbi, stateFieldCount, ownerInputIdx) {
  if (!entryAbi?.dispatch_tag) throw new Error('encodeKttTransferZeroOutAction: entryAbi.dispatch_tag missing');
  if (!(Number.isInteger(stateFieldCount) && stateFieldCount > 0)) {
    throw new Error('encodeKttTransferZeroOutAction: stateFieldCount must be a positive integer(传入的是不是真实编译产物的 runtime_state.fields.length?)');
  }
  if (!Array.isArray(ownerInputIdx) || !ownerInputIdx.length) throw new Error('encodeKttTransferZeroOutAction: ownerInputIdx must be a non-empty array');

  const b = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
  // next_states=[](0元素): 每个 State 字段的转置数组都是空数组 ⇒ 每个字段一个空 push(OP_0)。
  for (let i = 0; i < stateFieldCount; i++) b.addData(new Uint8Array(0));
  // witness=[](空 bytes)
  b.addData(new Uint8Array(0));
  // owner_input_idx: int[] ⇒ 拼接每个元素的 8 字节小端, 整体当一个 push。
  const idxBuf = Buffer.alloc(ownerInputIdx.length * 8);
  ownerInputIdx.forEach((v, i) => idxBuf.writeBigInt64LE(BigInt(v), i * 8));
  b.addData(idxBuf);
  b.addData(hexToBytes(entryAbi.dispatch_tag));
  return b.drain();
}

/** action ++ pushdata(redeem) —— 与 proto-register-append-witness.mjs 的 combineActionAndRedeem 同逻辑。 */
export function combineKttActionAndRedeem(kaspa, actionHex, redeemScriptBytes) {
  const b = kaspa.ScriptBuilder.fromScript(actionHex, { flags: { covenantsEnabled: true } });
  b.addData(hexToBytes(redeemScriptBytes));
  return b.drain();
}

export function buildKttTransferZeroOutSigScriptHex(kaspa, entryAbi, stateStructAbi, ownerInputIdx, redeemScriptBytes) {
  const action = encodeKttTransferZeroOutAction(kaspa, entryAbi, stateStructAbi, ownerInputIdx);
  return combineKttActionAndRedeem(kaspa, action, redeemScriptBytes);
}
