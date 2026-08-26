# §6-3 gate (c)-1 · cov_id 派生 / 续链 / terminal 的 rusty-kaspa 源码坐标（为 J1 接手钉的）

> **Status**: SOURCE-PIN v0.1 · J2 2026-08-27 · Bettor 派工 (16) · **只钉坐标，不裁 SS 语义，不下"满足/不满足"**。
> **读法纪律**：全部坐标取自 `/d/rusty-kaspa` 的 **live 二进制 commit `7b1e18cc`**（`git show 7b1e18cc:<path>`，同 (5) 稿那次纪律）。🔴 **该检出的工作树 HEAD 是 `90dbf074`（2026-06-05），不是 7b1e18cc**——两者在 `params.rs` 上已不同（工作树**没有** `TESTNET12_PARAMS` 块，7b1e18cc 有）。**凡引 file:line 必以 `git show 7b1e18cc:` 为准，别用编辑器打开工作树读。**
> 对应门：Codex MSG-267 (c) 六条（精确派生规则 pinned / 两 genesis outpoint → 两不同非零 cov_id / 只收 baked cid / reveal 续链恰一 / terminal 零续出 / 四类变异按正确理由失败）+ (a) 五条（LOCKED_F→O_AUTHORIZED 续链身份稳定 + 阴性对照 + 钉 runtime 版本）。**本稿只覆盖 (c)-1"派生规则 pinned"这一条的坐标部分，其余五条是 J1 在链上要做的事。**

---

## §0 一图：cov_id 在 7b1e18cc 里的生命周期（每格给坐标，§1 逐条展开）

```
[genesis]   tx 输出带 CovenantBinding{covenant_id, authorizing_input}      ← core tx.rs:172,185-197
            ├─ 构造侧: Transaction::populate_genesis_covenants()             ← core tx.rs:310-367（计算并写入 binding）
            └─ 共识侧: CovenantsContext::from_tx() 重算 covenant_id(outpoint, group) 比对   ← txscript covenants.rs:147-160
                        派生函数 covenant_id(genesis outpoint, auth outputs)  ← core hashing/covenant_id.rs:16-30
[入 UTXO]   UtxoEntry.covenant_id = output.covenant.map(|x| x.covenant_id)  ← core utxo/utxo_diff.rs:232-242
[continuation] 输出 binding 的 covenant_id == authorizing_input 的 UtxoEntry.covenant_id ⇒ 记入 input_ctxs / shared_ctxs
                                                                             ← txscript covenants.rs:124-136
[脚本可见]  OpInputCovenantId 0xcf / OpOutputCovenantId 0xd5 / OpCovOutputCount 0xd2 / OpCovInputCount 0xd0 / OpAuthOutputCount 0xcb …
                                                                             ← txscript opcodes/mod.rs:1436-1644（含 OpCheckSigFromStack 0xd7 @1633）
[激活]      covenants_activation: TN12 = ForkActivation::always()            ← core config/params.rs:669-696
[进入校验]  check_covenant_info → check_scripts(covenants_ctx, flags)        ← consensus tx_validation_in_utxo_context.rs:58-62,165-183
[签名承诺]  sighash 把 output.covenant(authorizing_input + covenant_id) 写进摘要  ← core hashing/sighash.rs:233-235
```

---

## §1 坐标表（file:line @7b1e18cc · 原文片段 · 对应 v0.15 哪条 require）

### 1. 派生规则（(c)-1 本体）

| # | 坐标 | 原文片段（逐字） | 它说明什么（只述不裁） | v0.15 对应 |
|---|---|---|---|---|
| 1.1 | `consensus/core/src/hashing/covenant_id.rs:16-30` | `pub fn covenant_id<'a>(outpoint: TransactionOutpoint, auth_outputs: impl ExactSizeIterator<Item = (u32, &'a TransactionOutput)>) -> Hash { let mut hasher = kaspa_hashes::CovenantID::new(); hasher.update(outpoint.transaction_id).write_u32(outpoint.index).write_len(auth_outputs.len()); for (index, output) in auth_outputs { hasher.write_u32(index).write_u64(output.value).write_u16(output.script_public_key.version()).write_var_bytes(output.script_public_key.script()); } hasher.finalize() }` | cov_id = H(genesis outpoint.txid ‖ outpoint.index ‖ n ‖ ∀授权输出: index ‖ value ‖ spk.version ‖ spk.script)。**输入进摘要的是 genesis outpoint 与授权输出的 (index,value,spk)，不含 covenant 字段本身**（:13-14 注释 "excluding the covenant binding itself to avoid self-reference"） | §4-a @L224 `cid = covenant_id(funding.outpoint,[C_out])`；§3 闸① @L198-199 |
| 1.2 | `consensus/core/src/hashing/covenant_id.rs:8-15` | `/// Computes the covenant identifier from the genesis outpoint and its authorized outputs. /// The genesis outpoint serves as a globally unique anchor; … any change to these yields a distinct covenant identifier.` | 作者意图注释：outpoint 是全局唯一锚 | 闸① "不是创建者可填字段" @L199；(c)-2 "两个不同 genesis outpoint → 不同 cov_id" 的**规则出处**（**是否成立由 J1 上链证**）|
| 1.3 | `consensus/core/src/tx.rs:185-197` | `/// Binds a transaction output to the covenant and input authorizing its creation. pub struct CovenantBinding { … pub covenant_id: Hash, … } impl CovenantBinding { pub fn new(authorizing_input: u16, covenant_id: Hash) -> Self` | 输出上的绑定 = (authorizing_input: u16, covenant_id) | §3 @L211 "cov_id 续链靠 output 上的 CovenantBinding" |
| 1.4 | `consensus/core/src/tx.rs:172,180-181` | `pub covenant: Option<CovenantBinding>,` / `pub fn with_covenant(value, script_public_key, covenant: Option<CovenantBinding>)` | `TransactionOutput.covenant` 可选字段 | — |
| 1.5 | `consensus/core/src/tx.rs:310-367`（`populate_genesis_covenants`）| `:312 /// For each group, this computes covenant_id(authorizing_input.outpoint, group.outputs)`；`:320 /// - targeted outputs must not already contain a covenant binding`；`:363-367 let covenant_id = hashing::covenant_id::covenant_id(input_outpoint, group.outputs.iter().map(|&out| (out, &self.outputs[out as usize]))); let binding = CovenantBinding::new(group.authorizing_input, covenant_id); … self.outputs[out as usize].covenant = Some(binding);` | **构造侧** helper：按 `GenesisCovenantGroup{authorizing_input, outputs}` 计算并写 binding；错误集 `NoSuchInput/EmptyOutputs/OutputsNotOrdered/NoSuchOutput/OutputsNotDisjoint/CovenantAlreadyPopulated`（:328-354）| relay `p2sh.mjs:1758-1763` 注释 "populateGenesisCovenants → consensus 重算赋 cov_id"（Codex：**supporting only**）|
| 1.6 | `consensus/core/src/tx.rs:805-811`（测试注释）| `// v0 inputs carry a flat sig_op_count: u8 … and v0 outputs have no covenant field at all.` | **v0 tx 无 covenant 字段** ⇒ 带 binding 的 tx 须 v1（relay 注释 `TX_VERSION_TOCCATA` @`p2sh.mjs:1762`）| (a)-5 "钉到精确 runtime/feature revision" 的一部分 |

### 2. 共识侧重算 / genesis 与 continuation 判定

| # | 坐标 | 原文片段 | 说明 | v0.15 对应 |
|---|---|---|---|---|
| 2.1 | `crypto/txscript/src/covenants.rs:101-111` | `pub fn from_tx(tx: &impl VerifiableTransaction) -> Result<Self, CovenantsError> { … for (i, (_, entry)) in tx.populated_inputs().enumerate() { if let Some(covenant_id) = entry.covenant_id { ctx.shared_ctxs.entry(covenant_id).or_default().input_indices.push(i); } }` | 第一遍：每个**输入**若其 UtxoEntry 带 cov_id ⇒ 记入该 cov_id 的 `input_indices` | `OpCovInputCount` 数的就是这个集合 |
| 2.2 | `covenants.rs:113-136` | `for (i, output) in tx.outputs().iter().enumerate() { let Some(CovenantBinding { covenant_id, authorizing_input }) = output.covenant else { continue }; … match utxo_entry.covenant_id { Some(input_covenant_id) if input_covenant_id == covenant_id => { // Continuation case: the authorizing input already carries the same covenant id. … ctx.input_ctxs.entry(auth_input_idx)….auth_outputs.push(i); ctx.shared_ctxs.get_mut(&covenant_id)….output_indices.push(i); }` | **continuation 判定** = 输出 binding 的 cov_id **等于** 其 `authorizing_input` 所花 UTXO 的 cov_id；命中则该输出进 `output_indices`（= `OpCovOutputCount` 的分母）与该输入的 `auth_outputs` | §4-b @L233-234 `OpCovOutputCount(cid)==1` ∧ `OpOutputCovenantId(O_out)==cid`；§4-d @L265 焊接③ `OpOutputCovenantId(oauth_out_idx)==oauth_cid` |
| 2.3 | `covenants.rs:137-143` | `Some(_) | None => { // Genesis case: the authorizing input does not carry this covenant id (either absent or different). … genesis_ctxs.entry((auth_input_idx, covenant_id)).or_default().push(i); }` | **genesis 判定** = authorizing_input 的 UTXO **没有**该 cov_id（无 cov_id，或是**别的** cov_id）；按 (authorizing_input, cov_id) 分组 | 🔵 注意：同一输入可同时 continuation 一个 cov_id 又 genesis 别的（测试 `test_continuation_with_genesis` @:358-389）|
| 2.4 | `covenants.rs:147-160` | `for ((auth_input_idx, covenant_id), output_indices) in genesis_ctxs { let input = tx.inputs().get(auth_input_idx)…; let expected_id = hashing::covenant_id::covenant_id(input.previous_outpoint, output_indices.into_iter().map(|i| (i as u32, tx.outputs().get(i)…))); if expected_id != covenant_id { return Err(CovenantsError::WrongGenesisCovenantId(auth_input_idx, covenant_id)); } }` | **genesis 重算比对**：用 authorizing_input 的 `previous_outpoint` + 该组输出重算，不等 ⇒ `WrongGenesisCovenantId` ⇒ 整笔 tx 无效 | 闸① @L201 "假 cov_id≠baked→BUST" 的**共识层出处**（比脚本层更早拒）|
| 2.5 | `covenants.rs:96-100` | `/// … validating covenant bindings and handling both continuation and genesis cases. Genesis outputs are validated but do not populate covenant contexts.` | 🔴 **genesis 输出不进脚本上下文**：在 genesis 那笔 tx 里，`OpCovOutputCount(new_cid)` 读到的是 **0**（`shared_ctxs` 无该 key，`:87-89 map_or(0, …)`）| 与 §4-a genesis-mint 相关：C 的 cov_id 在**下一笔**（消费 C）才在脚本里可数 |
| 2.6 | `covenants.rs:63-94` | `auth_output_index / num_auth_outputs / num_covenant_inputs / covenant_input_index / num_covenant_outputs / covenant_output_index`，缺 context 一律 `unwrap_or_default()` / `map_or(0, …)` | 计数类查询对**不存在的 cov_id 返回 0 而非错**；索引类越界返回 `InvalidCovInIndex/InvalidCovOutIndex/InvalidAuthCovOutIndex` | ShardLeaf.sil:101 "0==0 防呆" 那条 `>=1` 的机制依据；v0.15 §4-b @L233 用 `==1` |
| 2.7 | `crypto/txscript/errors/src/lib.rs:113-124` | `pub enum CovenantsError { WrongGenesisCovenantId(usize, Hash), AuthInputOutOfBounds(usize, u16), InvalidCovInIndex(Hash, usize), InvalidCovOutIndex(Hash, usize), InvalidAuthCovOutIndex(usize, usize, usize) }`（各带 `#[error]` 文案）| 拒因全集——**(c)-6 "按正确理由失败"** 时对拒因串的锚 | (h) 矩阵每条 attack trace 的 expected-reason 可指到这里 |

### 3. UTXO 侧：cov_id 怎么进 UtxoEntry、怎么被后续 tx 读到

| # | 坐标 | 原文片段 | 说明 |
|---|---|---|---|
| 3.1 | `consensus/core/src/utxo/utxo_diff.rs:232-242` | `for (i, output) in transaction.outputs().iter().enumerate() { let outpoint = TransactionOutpoint::new(tx_id, i as u32); let entry = UtxoEntry::new(output.value, output.script_public_key.clone(), block_daa_score, is_coinbase, output.covenant.map(|x| x.covenant_id)); self.add_entry(outpoint, entry)?; }` | 输出的 binding.cov_id 原样落进 UtxoEntry（`authorizing_input` 不落 UTXO，只在 tx 内有意义）；同时 `block_daa_score` 就在这里写入 ⇒ `OpTxInputDaaScore` 读的那个值 |
| 3.2 | `consensus/core/src/utxo/utxo_entry.rs:20-30` | `pub struct UtxoEntry { pub amount: u64, pub script_public_key, pub block_daa_score: u64, pub is_coinbase: bool, #[wasm_bindgen(js_name = covenantId)] pub covenant_id: Option<Hash>, }` | wasm 对外名 `covenantId`（relay `p2sh.mjs:1758` 注释 "UtxoEntry.covenantId" 指此）|
| 3.3 | `consensus/src/pipeline/virtual_processor/utxo_inquirer.rs:148,188,254` | `output.covenant.map(|x| x.covenant_id),` | 三处 RPC/inquirer 路径同样从 output binding 取 cov_id（供 `getUtxosByAddresses` 等回读）|

### 4. 脚本可见面（opcode）——v0.15 每条 require 用到的原语

| # | 坐标 | 原文片段 | 语义要点（只述） | v0.15 require |
|---|---|---|---|---|
| 4.1 | `crypto/txscript/src/opcodes/mod.rs:1499-1514` `OpInputCovenantId<0xcf>` | `let utxo = tx.utxo(idx).ok_or_else(…InvalidInputIndex…)?; let covenant_id = utxo.covenant_id.unwrap_or(ZERO_HASH); push_data(covenant_id.as_bytes().into(), vm)` | 读**任意索引**输入的 UtxoEntry.cov_id；**无 cov_id ⇒ 压 32 字节零**（不是错）；只能在 `ScriptSource::TxInput` 下用 | @L232 `OpInputCovenantId(C_in_idx)==cid`；@L245 `(O_in_idx)==cid`；@L263-264 焊接①②；§4-c @L252 "读非 active 输入 = 已证" |
| 4.2 | `opcodes/mod.rs:1597-1612` `OpOutputCovenantId<0xd5>` | `let output = tx.outputs().get(idx).ok_or_else(…InvalidOutputIndex…)?; let covenant_id = output.covenant.map(|c| c.covenant_id).unwrap_or(ZERO_HASH); push_data(…)` | 读输出 binding 的 cov_id；**无 binding ⇒ 零**。🔵 注意它读的是**输出上声明的** cov_id——声明是否合法（genesis 重算 / continuation 等值）由 §2.2/2.4 在脚本跑之前保证 | @L234 `OpOutputCovenantId(O_out_idx)==cid`；@L265 焊接③ |
| 4.3 | `opcodes/mod.rs:1548-1561` `OpCovOutputCount<0xd2>` | `let [covenant_id]: [Hash; 1] = vm.dstack.pop_items()?; let count = vm.covenants_ctx.num_covenant_outputs(covenant_id); push_number(count as i64, vm)` | 数本 tx 里**continuation 判定通过**的、带该 cov_id 的输出个数（§2.2 的 `output_indices`）；不存在 ⇒ 0 | @L233 `==1`（reveal 恰一续继）；@L248/@L269/@L273 terminal 支 `==0`（闸③）；§3 @L185 EXCL |
| 4.4 | `opcodes/mod.rs:1516-1529` `OpCovInputCount<0xd0>`；`:1531-1546` `OpCovInputIdx<0xd1>`；`:1563-1578` `OpCovOutputIdx<0xd3>` | 同族：数/取带该 cov_id 的输入与输出索引 | 供 (h) 变异臂用（v0.15 正文未用 InputCount）| — |
| 4.5 | `opcodes/mod.rs:1436-1471` `OpAuthOutputCount<0xcb>` / `OpAuthOutputIdx<0xcc>` | `let count = vm.covenants_ctx.num_auth_outputs(input_idx)` / `auth_output_index(input_idx, k)` | 按**授权输入**（非 cov_id）数其 children；与 4.3 是两个不同分母 | v0.15 未用；J1 若要"恰一续出且由本输入授权"可对照 |
| 4.6 | `opcodes/mod.rs:1614-1631` `OpOutputAuthorizingInput<0xd6>` | `output.covenant.as_ref().map(|c| c.authorizing_input as i64).unwrap_or(-1i64)` | 读输出的 authorizing_input；无 binding ⇒ −1 | — |
| 4.7 | `opcodes/mod.rs:1633-1642` `OpCheckSigFromStack<0xd7>` | `let [signature, msg_hash, pubkey] = vm.dstack.pop_raw()?; … check_schnorr_signature_for_msg_hash(msg_hash, &pubkey, &signature, true)` | 8/20 (g) 上链腿证过的那颗 | §4-b/§4-d `checkSigFromStack(A, sig_A)` |
| 4.8 | 全部 covenant opcode 共同前提 | 每条 `if vm.flags.covenants_enabled { … } else { Err(TxScriptError::InvalidOpcode(…)) }` | 未激活 ⇒ 这些 opcode 一律 `InvalidOpcode` | 见 §5 激活 |

### 5. 激活与校验入口（(a)-5 / (c)-1 "钉到精确 runtime 版本" 用）

| # | 坐标 | 原文片段 | 说明 |
|---|---|---|---|
| 5.1 | `consensus/core/src/config/params.rs:669-696` `TESTNET12_PARAMS` | `:680 net: NetworkId::with_suffix(NetworkType::Testnet, 12),` `:684 max_signature_script_len: 300_000,` `:687 block_mass_limits: BlockMassLimits { compute: 500_000, storage: 500_000, transient: 1_000_000 },` `:689-691 …TenBps…` `:693 crescendo_activation: ForkActivation::always(), :694 covenants_activation: ForkActivation::always(), :695 ..TESTNET_PARAMS` | **TN12 covenants 始终激活**（`always()`）；TenBps 族；其余继承 TESTNET_PARAMS（`:610-667`，其自身 `:666 covenants_activation: never()`——即 **TN10 未激活**）。选择映射 `:528-532 NetworkType::Testnet => match value.suffix { Some(10) => TESTNET_PARAMS, Some(12) => TESTNET12_PARAMS, Some(x) => panic!(…) }` |
| 5.2 | `consensus/src/processes/transaction_validator/tx_validation_in_utxo_context.rs:58-62` | `let covenants_ctx = self.check_covenant_info(tx, block_daa_score)?; match flags { TxValidationFlags::Full | TxValidationFlags::SkipMassCheck => { self.check_scripts(tx, covenants_ctx, block_daa_score, seq_commit_accessor)?; } TxValidationFlags::SkipScriptChecks => {} }` | 顺序：**先 `check_covenant_info`（§2 的 from_tx，含 genesis 重算）再跑脚本**；`SkipScriptChecks` 时仍做 covenant info 校验 |
| 5.3 | 同文件 `:177-183` | `fn check_covenant_info(…) { if !self.covenants_activation.is_active(block_daa_score) { return Ok(Default::default()); } Ok(CovenantsContext::from_tx(tx)?) }` | 未激活 ⇒ 空 context（TN12 恒激活，此分支不走）|
| 5.4 | 同文件 `:165-175` | `let ctx = EngineCtx::new(&self.sig_cache).with_covenants_ctx(&covenants_ctx)…; let covenants_enabled = self.covenants_activation.is_active(block_daa_score); let flags: EngineFlags = EngineFlags { covenants_enabled, sigop_script_units: Gram(self.mass_per_sig_op).into() };` | 脚本引擎拿到的就是 §2 算出的 context + 激活 flag |
| 5.5 | `consensus/core/src/hashing/sighash.rs:233-235` | `hasher.write_bool(output.covenant.is_some()); if let Some(covenant) = &output.covenant { hasher.write_u16(covenant.authorizing_input).update(covenant.covenant_id); }` | 输出的 binding（含 authorizing_input）**进签名摘要** ⇒ 签后不可改绑定 |
| 5.6 | `crypto/txscript/src/lib.rs:107-113` | `pub covenants_enabled: bool, … Self { covenants_enabled: false, sigop_script_units: Gram(1000).into() }` | `EngineFlags` 默认 **false**——离线自测/脚本测试若忘了置 true，covenant opcode 全 `InvalidOpcode`（`:1040-1065 test_push_units_enforced_only_when_covenants_enabled` 同理）|

### 6. 本仓活先例（cross-ref，**不是**共识权威）

| 坐标 | 内容 | 与上表 |
|---|---|---|
| `kasia-console/src/lib/ShardLeaf.sil:99-104` | `byte[32] ps_cov = OpInputCovenantId(psInIdx); require(ps_cov == payout_cov_id); require(OpCovOutputCount(ps_cov) >= 1); byte[32] out_cov = OpOutputCovenantId(psOutIdx); require(out_cov == payout_cov_id);` | 4.1 / 4.3 / 4.2 已上链跑通（v0.15 @L116 "可建性锚定纪律"）|
| `kasia-relay/src/lib/p2sh.mjs:1758-1763` | "带 CovenantBinding(genesis case, populateGenesisCovenants)→ consensus 重算赋 cov_id = covenant_id(funding.outpoint,[psOut])… 机制链上验: d7c0bacc(genesis)+ bf389372(continuation 保持)。v1 tx(TX_VERSION_TOCCATA, covenant output 必需)" | 1.5 / 2.4 / 1.6 的 relay 侧复述；Codex 267 原句 *"supporting evidence only; it is not the authority for deployed consensus semantics"* |

---

## §2 给 J1 的"读完坐标后还要做什么"（(c) 六条 → 对应坐标，J1 裁）

| (c) 条 | 坐标能给的 | J1 仍要做的（链上/SS 域）|
|---|---|---|
| 1 精确派生规则 pinned | 1.1 + 2.4 + 5.1（`7b1e18cc`）| 把 `7b1e18cc` 与 live kaspad 二进制的对应（build 坐标）写进证据；工作树 `90dbf074` 不算 |
| 2 两 genesis outpoint → 两不同非零 cov_id | 1.1（outpoint 进摘要）| 上链两笔 genesis-mint，回读 `covenantId` 比对（历史先例 relay 注释 d7c0bacc，需重做成 durable）|
| 3 只收 baked cid | 4.1 + 2.4（假 cid 在共识层先拒；脚本层 `==baked` 再拒）| 阴性：错 cid 的输入 / 伪造 binding 各一笔，记拒因串（2.7）|
| 4 reveal 续链恰一 | 4.3（`OpCovOutputCount==1`）+ 2.2（分母定义）| 变异 `==1 → >=1` 的两笔对照 |
| 5 terminal 零续出 | 4.3（`==0`）+ 2.5（genesis 输出不计入）| 每条 terminal 支各一笔；注意 2.5：若 terminal 支意外**genesis** 一个新 cov_id 的输出，`OpCovOutputCount(old_cid)` 仍为 0——**这是否算"续链"由 J1/设计裁**，本稿只指出它在计数外 |
| 6 变异按正确理由失败 | 2.7 拒因全集 + 4.8 未激活拒因 | 每格拒因串落盘，零 inconclusive |

**(a) 额外**：LOCKED_F → O_AUTHORIZED 续链 = 2.2 的 continuation 判定（输出 binding.cov_id == LOCKED_F 输入的 cov_id）+ 4.2 读后继 + 1.6 v1 tx；"脚本/状态可变、身份稳"= 2.2 只比 cov_id 不比 spk（spk 只在 genesis 摘要 1.1 里出现一次）。**这一句是坐标推论，不是裁定**——J1 上链证。

---

## §3 本稿没做 / 不裁
- 不裁"相等 == 唯一"、不裁 2.5 那格算不算续链、不裁 SS 编译出的字节是否调对 opcode。
- 未读 `consensus/client/src/covenant.rs`（wasm/JS 客户端封装）与 `rothschild`/integration tests——J1 若要 JS 侧构造坐标可从 `git grep -n covenant 7b1e18cc -- consensus/client/src/covenant.rs` 起。
- 复核命令（只读）：
  ```bash
  cd /d/rusty-kaspa && git show 7b1e18cc:consensus/core/src/hashing/covenant_id.rs | sed -n '16,30p'
  git show 7b1e18cc:crypto/txscript/src/covenants.rs | sed -n '101,163p'
  git show 7b1e18cc:crypto/txscript/src/opcodes/mod.rs | sed -n '1499,1514p;1548,1561p;1597,1612p'
  git show 7b1e18cc:consensus/core/src/config/params.rs | sed -n '528,532p;669,696p'
  ```
