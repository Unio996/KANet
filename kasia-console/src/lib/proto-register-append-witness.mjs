// proto-register-append-witness.mjs — ShardLeaf_direct.register_append 的真实(v1.0.0)入口调用
// sigScript 编码(J2, 账本1425/1431, 关闭 T-PROTO-ENTRY-WITNESS-ABI-UNVERIFIED 中 register_append 的
// 那部分)。
//
// 🔴 铁律(Bettor 1431 明确指出): 不照抄 kasia-relay/src/lib/p2sh.mjs 的 _pushInt/_pushBytes 手写编码
// ——那是旧编译器(pre-v1.0.0, 8065184 那条从未推上游的本地分支)的 ABI。v1.0.0 的 codegen 整体改了
// (dispatch tag 前导从"裸 opcode 选择器"变成"4 字节 dispatch_tag 当 PUSH-DATA 推"、alt-stack、越界检查
// 等), 旧编码可能连"参数顺序对不对得上"都不成立。
//
// 官方编码出处(D-019 pin 3ed973335b59269293564805cc2c58a14595ec03, origin/master):
//   silverscript-abi/src/lib.rs:448-460 encode_contract_entry_sig_script
//   → :483-507 encode_entry_sig_script(按 entry.params 声明顺序逐个 push_sig_arg, 最后
//     `builder.add_data(entry.dispatch_tag.as_bytes())` 把 4 字节 dispatch_tag 当 PUSH-DATA 推)
//   → :904-946 push_sig_arg(Int/Temporal→push_i64即builder.add_i64; Bytes/Text→push_data即
//     builder.add_data; FixedBytes/Pubkey/Sig/Datasig→push_fixed_bytes, 也是 add_data 只是先查定长)
//   → :900-902 script_builder() = ScriptBuilder::with_flags(EngineFlags{covenants_enabled:true,..})
//     ——covenants_enabled 放开"post-Toccata script limits"(单次 push 上限从标准 520 字节放大),
//     不放开会在编 tok_suffix 这类几百到上万字节的模板 witness 时直接 throw(已实测踩过这个坑)。
//   → debugger/cli/src/main.rs:361-368 combine_action_and_redeem: action(上面builder.drain()的产物)
//     原样 add_ops 拼接(不再包一层 push), 随后 redeem 脚本整体 add_data 推(即 sigScript =
//     action_bytes ++ pushdata(redeem_bytes))。
//
// kaspa-wasm 的 ScriptBuilder.addI64/.addData 是同一个 rusty-kaspa 家族(silverscript-abi 的
// Cargo.toml 钉的 kaspa-txscript git rev a41a333b08848f41bf737b72592e463a6011b8ac)的真实绑定,
// 不是移植/猜测——用它编出来的字节, 已用真实 D-019 pin 的 cli-debugger(临时加一行 eprintln 转储
// active_sigscript 的调试版本, 未改任何编码逻辑, 见 docs/provenance/2026-09-15-j2-register-append-
// entry-witness-abi-verification/)验证过逐字节一致(vector①)。

/**
 * ShardLeaf_direct.register_append 的 10 个参数(声明顺序, 来自真实编译产物的 entries.register_append.
 * params, 不是抄源码——每次用都从 compileSilV100() 的 `_raw.contracts[contractName].entries[entryName]`
 * 现读, 防止合约签名变了但这里没跟着改)。
 * 🔴 D-020(账本1446/1448): stakeInIdx 参数已从合约签名里删除(不再消费 stake 筹码输入), 这里同步
 * 去掉——11 参数变 10 参数。
 */
export const REGISTER_APPEND_PARAM_ORDER = Object.freeze([
  'side', 'stake', 'leafOutIdx', 'psOutIdx', 'bettorPk', 'ps_prefix', 'ps_suffix',
  'tok_out', 'tok_prefix', 'tok_suffix',
]);

function hexToBytes(h) {
  if (Buffer.isBuffer(h)) return h;
  if (Array.isArray(h)) return Buffer.from(h);
  return Buffer.from(h.startsWith('0x') ? h.slice(2) : h, 'hex');
}

/**
 * @param {object} kaspa  kaspa-wasm 模块(注入)
 * @param {string} entryAbiJson  compileSilV100(...)._raw.contracts[contractName].entries['register_append']
 *   (含 dispatch_tag/params, 调用方保证是对应这份 redeem 脚本的真实编译产物, 不是硬编字面量)
 * @param {object} w  { side, stake, leafOutIdx, psOutIdx, bettorPk, ps_prefix, ps_suffix, tok_out, tok_prefix, tok_suffix }
 *   每个字段: int 用 number/bigint, bytes 用 hex 字符串('0x...')/Buffer/number[]
 * @returns {string} action 的 hex(仅 10 参数 push + dispatch_tag push, 不含 redeem——同
 *   debugger 的 active_sigscript 语义, combine 步骤见 combineActionAndRedeem)
 */
export function encodeRegisterAppendAction(kaspa, entryAbi, w) {
  if (!entryAbi?.dispatch_tag) throw new Error('encodeRegisterAppendAction: entryAbi.dispatch_tag missing(传入的是不是 compileSilV100 产物的 entries.register_append?)');
  const b = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
  b.addI64(BigInt(w.side));
  b.addI64(BigInt(w.stake));
  b.addI64(BigInt(w.leafOutIdx));
  b.addI64(BigInt(w.psOutIdx));
  b.addData(hexToBytes(w.bettorPk));
  b.addData(hexToBytes(w.ps_prefix));
  b.addData(hexToBytes(w.ps_suffix));
  b.addI64(BigInt(w.tok_out));
  b.addData(hexToBytes(w.tok_prefix));
  b.addData(hexToBytes(w.tok_suffix));
  b.addData(hexToBytes(entryAbi.dispatch_tag));
  return b.drain();
}

/** action ++ pushdata(redeem) — 同 debugger/cli/src/main.rs:363-368 combine_action_and_redeem。 */
export function combineActionAndRedeem(kaspa, actionHex, redeemScriptBytes) {
  const b = kaspa.ScriptBuilder.fromScript(actionHex, { flags: { covenantsEnabled: true } });
  b.addData(hexToBytes(redeemScriptBytes));
  return b.drain();
}

/** 一步到位: 10 参数 witness + redeem 揭示 → 完整 sigScript hex(真实广播用/真实 cli-debugger raw
 *  signature_script_hex 用同一个函数产出, 两处零分叉)。 */
export function buildRegisterAppendSigScriptHex(kaspa, entryAbi, w, redeemScriptBytes) {
  const action = encodeRegisterAppendAction(kaspa, entryAbi, w);
  return combineActionAndRedeem(kaspa, action, redeemScriptBytes);
}
