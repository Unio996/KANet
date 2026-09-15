> **Status**: CURRENT

# D-020 单笔 register_append(取消 stake 筹码) — 生产真实形状交易验证

出处：账本1446（NWT 实证 ZERO32-owner stake 筹码可被第三方连本带 0.2 KAS 一并偷走，推翻 1436 的
"无损失"判断）→ 账本1447（候选4：取消 stake 筹码、register_append 改单笔交易，NWT 核可行性）→
Owner 拍板 D-020（`docs/DECISIONS.md`，账本1448，commit `a4878d7d`）。

**范围**：只验证 `ShardLeaf_direct.register_append` 这一个 entry 在新签名（10 参数，去掉
`stakeInIdx`）下的执行正确性 + witness 编码正确性。`held` 输入相关逻辑（`scanOwnedTokenInputs`/
`require(owned_total==pool_value)`）**未改动**——D-020 只取消 stake 筹码，held 是从第二笔下注起
的必需输入，继续保留。

## ① 合约改动

`ShardLeaf_direct.sil` 的 `register_append` entry：

- 签名从 11 参数减到 10 个：`side, stake, leafOutIdx, psOutIdx, bettorPk, ps_prefix, ps_suffix, tok_out, tok_prefix, tok_suffix`（删除 `stakeInIdx`）。
- 删除：`TokenState stakeTk = readInputStateWithTemplate(stakeInIdx, ...); require(stakeTk.amount == stake);`（不再消费独立的 stake 筹码输入）。
- 合并 KTT 输出的校验从"输入锚定"改成"纯模板/witness 匹配"：
  `validateOutputStateWithInputTemplate(tok_out, TokenState{...}, stakeInIdx, tok_prefix.length, tok_suffix.length, token_tmpl_hash)`
  →
  `validateOutputStateWithTemplate(tok_out, TokenState{...}, tok_prefix, tok_suffix, token_tmpl_hash)`
  （`TokenState{amount: pool_value+stake, owner: OpInputCovenantId(this.activeInputIndex), ...}` 结构字面量本身不变，只是比对方式从"读某个输入的 state 字段"变成"纯 witness 值 + 模板哈希"，因为不再有 stake 输入可读）。
- 新 `dispatch_tag = 4449f5ac`（codegen 对签名变化的自然结果，非手工指定）。
- `held`（`scanOwnedTokenInputs`/`owned_total==pool_value`，ShardLeaf_direct.sil:154-156）**完全未动**。

编译器：D-019 pin `3ed973335b59269293564805cc2c58a14595ec03`（`origin/master`），检出
`scratch/_j2_silverc_v100`。

## ② 生产真实形状完整交易向量（6 条，`d020_vectors.test.json`，生成脚本见
`scratch/_j2_d020_vectors/mk_d020_vectors.mjs`，复用 2026-09-15-j2-stake-chip-owner-unbound-
verification 的构造手法，去掉 stake 筹码输入/参数）

**首笔下注**（无 held）：inputs=`[leaf, fee]`（2 输入），outputs=`[leaf续约, ticket, 合并KTT genesis(authorizing_input=1即fee), fee找零]`。

- `①a_leaf_first_bet_no_held_no_stake_pass` — 正向，PASS。
- `①b_leaf_fail_merged_amount_off_by_1` — 负向：合并输出 amount 少 1（`pool_value+stake-1`）。**精确失败行**（`expect:'pass'`临时翻转技术捕获的真实调试器 trace，方法见下④）：

  ```
  error: script ran, but verification failed
      --> 156:9
      |
  155 |         require(owned_total == pool_value);
  156 |         validateOutputStateWithTemplate(tok_out, TokenState {
      |         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ verification failed here
  ```

- `①c_leaf_fail_merged_owner_wrong` — 负向：合并输出 owner 换成任意值（非 leaf 自己的 covenant_id）。**同样精确失败在 156 行**（同一个 `validateOutputStateWithTemplate(tok_out, TokenState{...})` 调用——amount 和 owner 是同一个 struct 字面量里的字段，同一次比对失败，两次真实调试器 trace 逐字确认，非假设推断）。

**第二笔下注**（有 held）：inputs=`[leaf, held, fee]`（3 输入），outputs 同上（authorizing_input=2即fee）。

- `②a_leaf_second_bet_with_held_pass` — 正向，PASS。
- `②b_held_transfer_zero_out_pass` — held 输入自己的 `KanetTestToken.transfer` 分支（`next_states=[]`，即被完全销毁），PASS，验证 held 消费路径未受 D-020 影响。
- `②c_leaf_fail_held_missing_pool_value_positive` — 负向：把 held 输入换成一笔无关的普通 P2PK（`scanOwnedTokenInputs` 扫不到，`owned_total`算出来是 0），pool_value=100>0。**精确失败行**：

  ```
  error: script ran, but verification failed
      --> 155:9
      |
  154 |         int owned_total = scanOwnedTokenInputs(tok_prefix, tok_suffix);
  155 |         require(owned_total == pool_value);
      |         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ verification failed here
  ```

  先于 156 行的合并输出校验触发，符合逻辑预期（held 缺席 ⇒ owned_total 在这一步就已经不等于 pool_value，根本走不到合并输出那一步）。

**结果**：6/6 全部按预期 PASS（3 条正向真通过，3 条负向真在预期位置失败），见 `run.log`（用 D-019
pinned `cli-debugger.exe` 逐条单独跑，非 `--run-all` 混合合约批跑——`--run-all` 对含多合约的
测试文件会把错误的 positional sil 路径套到别的合约测试上，产生"constructor expects N arguments"
之类的假阳性，本次已踩过一次并核实为工具artifact而非真实bug，全部改成单条 `--test-name` 调用）。

## ③ 决定性验证：新 10 参数 witness 编码与真实 cli-debugger 逐字节比对

复用 `docs/provenance/2026-09-15-j2-register-append-entry-witness-abi-verification/` 已验证过的
方法（`debug-print.patch`，只在 `J2_DUMP_ACTIVE_SIGSCRIPT` 环境变量存在时转储 `active_sigscript`
的 hex，不改任何编码/执行逻辑）：

1. 在 D-019 pin 的干净检出（确认 `git rev-parse HEAD == 3ed973335b59269293564805cc2c58a14595ec03`
   且 `git status --short` 空）里临时打上该补丁（`debug-print.patch`，内容与旧 provenance 完全
   相同，插入点行号在 `main.rs` 里对得上，说明这段路径自 D-019 pin 以来没变过）。
2. 只重编 `cli-debugger` 这一个 binary（`cargo build --release -p cli-debugger`，不动 `silverc.exe`）。
3. `J2_DUMP_ACTIVE_SIGSCRIPT=1` 跑 `①a_leaf_first_bet_no_held_no_stake_pass`（function/args
   模式，让调试器自己按官方 `encode_contract_entry_sig_script` 编码），转储真实 `active_sigscript`
   （冻结 `real_action_from_debugger.hex`，6324 hex 字符）。
4. 用 `kasia-console/src/lib/proto-register-append-witness.mjs` 的 `encodeRegisterAppendAction`
   （D-020 后的 10 参数版本）+ 从**同一组** `constructor_args` 重新编译现读的 `entries.
   register_append`（`dispatch_tag=4449f5ac`，与调试器编出的产物一致），独立编码同一组 witness
   值——**不是抄一份产物比对自己，是两条独立代码路径各自从"contract source + ctor args"出发**：
   一条是 v1.0.0 官方 Rust 编码器（调试器内部调用），一条是 `proto-register-append-witness.mjs`
   的 JS 实现，两者只共享"同一份编译产物的 `entries.register_append` ABI 描述"这一个输入。
5. 逐字节比对（`verify-witness-encoding.mjs`）：

   ```
   mine length 6324 real length 6324
   EQUAL: true
   ```

6. 验证完成后 `git checkout -- debugger/cli/src/main.rs` 还原源码，重编回原始 `cli-debugger.exe`，
   `git status --short` 确认无残留改动，D-019 的编译器 pin 不受影响。

**结论**：`proto-register-append-witness.mjs` 对新 10 参数 ABI 的编码与官方编码器逐字节一致，
`REGISTER_APPEND_PARAM_ORDER`/`encodeRegisterAppendAction` 的 D-020 改动（去掉 `stakeInIdx`）
是正确的。

## 处置

- `T-PROTO-ENTRY-WITNESS-ABI-UNVERIFIED` 中 `register_append` 部分的结论对新 10 参数 ABI 依然
  成立（原验证在 11 参数 ABI 上做的，本笔是在签名变化后的重新决定性验证，不是重复劳动——ABI 形状
  变了就必须重验，不能援引旧签名的验证结果）。
- 本 provenance 的 6 条向量 + ③ 的逐字节验证 = D-020 合约改动与 witness 编码改动双双有真实数据
  验证支撑，未部署、`PROTO_DRIVER_ENABLED` 全程未开。

## 文件清单

- `ShardLeaf_direct.sil` / `KanetTestToken.sil` / `PoolSideTicket.sil` — 冻结的 `.sil` 源码快照
  （D-020 后的 `ShardLeaf_direct.sil`，其余两个合约本笔未改动，冻结只为可复现）。
- `d020_vectors.test.json` — 6 条真实构造完整交易向量。
- `run.log` — 6/6 PASS 记录 + 逐字节验证结果。
- `debug-print.patch` — 临时调试补丁（过程记录，未实际留在 silverscript 仓库里）。
- `real_action_from_debugger.hex` — 真实 cli-debugger 构造出的 `active_sigscript`（冻结证据）。
- `verify-witness-encoding.mjs` — ③ 的独立编码器 + 逐字节比对脚本（过程记录）。
- `README.md` — 本文件。
