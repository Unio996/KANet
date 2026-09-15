> **Status**: SUPERSEDED-BY D-020

> 📌 **状态注记（2026-09-15 · J2 · D-020 账本1446/1448/a4878d7d）**：本文档验证的是 bet_mint 两步设计（独立铸 stake 筹码 + register_append 消费它）下的构造/编码行为——NWT 用真实 cli-debugger 证明该设计存在更严重问题（ZERO32-owner 的筹码可被任意第三方连本带锁定的真实 KAS 一起偷走，见账本1446），Owner 裁定 D-020：取消步骤A，register_append 改单笔交易。本文档内容作为历史记录保留（不删除，不改原文），新的验证见 `docs/provenance/2026-09-15-j2-d020-register-append-single-tx-verification/`。

# register_append 真实(v1.0.0) entry-witness sigScript 编码验证

出处：Bettor 1431 明确否决"照抄 `p2sh.mjs` 的 `_pushInt`/`_pushBytes`"（那是旧编译器 8065184 从未推
上游的本地分支的 ABI），要求先查 v1.0.0 自己的编码来源、做决定性验证、关闭
T-PROTO-ENTRY-WITNESS-ABI-UNVERIFIED 中 `register_append` 的那部分。

## ① 官方编码来源(D-019 pin `3ed973335b59269293564805cc2c58a14595ec03`, `origin/master`)

- `silverscript-abi/src/lib.rs:448-460` `encode_contract_entry_sig_script`
- → `:483-507` `encode_entry_sig_script`——按 `entry.params` **声明顺序**逐个 `push_sig_arg`，最后
  `builder.add_data(entry.dispatch_tag.as_bytes())`——**4 字节 `dispatch_tag` 当 PUSH-DATA 推**，
  不是旧设计里的裸 `OP_0`/`OP_1` 选择器 opcode。这是 v1.0.0 与旧编译器最实质的编码差异。
- → `:904-946` `push_sig_arg`：`Int`/`Temporal` → `push_i64`(即 `builder.add_i64`)；
  `Bytes`/`Text` → `push_data`(即 `builder.add_data`)；`FixedBytes`/`Pubkey`/`Sig`/`Datasig` →
  `push_fixed_bytes`（先查定长，也是 `add_data`）。
- → `:900-902` `script_builder()` = `ScriptBuilder::with_flags(EngineFlags{covenants_enabled:
  true, ..})`——**`covenants_enabled` 放开"post-Toccata script limits"**（单次 push 上限从标准
  520 字节放大）。漏掉这个 flag，编 `tok_suffix` 这类几百到上万字节的模板 witness 会直接
  `panic: adding a data element of N bytes exceed the maximum allowed script element size of 520`
  （已实测踩过，见下"过程记录"）。
- `debugger/cli/src/main.rs:361-368` `combine_action_and_redeem`：`action`(上面 `drain()` 的产物)
  原样 `add_ops` 拼接（不再包一层 push），随后 redeem 脚本整体 `add_data` 推——即
  `sigScript = action_bytes ++ pushdata(redeem_bytes)`。

`dispatch_tag` 本身**不需要另外算**——`compileSilV100(...)._raw.contracts[contractName].entries[
entryName].dispatch_tag` 已经是编译产物自带的字段（本例 `register_append` = `381b064e`），每次用
都从当次编译产物现读，不硬编字面量。

## ② JS 侧实现: 复用 kaspa-wasm 的真实 `ScriptBuilder`，不是移植

`kasia-console/src/lib/proto-register-append-witness.mjs` 用 `kaspa.ScriptBuilder`（`.addI64`/
`.addData`/`.addOps` 等）直接实现——这不是把 Rust 逻辑"翻译"成 JS 猜测行为，是**同一个
rusty-kaspa 家族的真实绑定**：`silverscript-abi` 的 `Cargo.toml` 把 `kaspa-txscript` 钉在
`git rev a41a333b08848f41bf737b72592e463a6011b8ac`，kaspa-wasm 的 `ScriptBuilder` 是同一路
consensus 代码的 wasm 导出。构造时必须传 `{ flags: { covenantsEnabled: true } }`（对应上面的
`EngineFlags{covenants_enabled:true}`），否则撞 520 字节上限。

## ③ 决定性验证：与真实 cli-debugger 逐字节比对

**方法**：在 D-019 pin 的**干净检出**（`scratch/_j2_silverc_v100`，确认 `git rev-parse HEAD` ==
`3ed973335b59269293564805cc2c58a14595ec03` 且 `git status` 干净）里，临时给
`debugger/cli/src/main.rs` 加**一行** `eprintln`（补丁见 `debug-print.patch`，只在
`J2_DUMP_ACTIVE_SIGSCRIPT` 环境变量存在时转储 `active_sigscript` 的 hex，**不改任何编码/执行逻辑**），
只重编 `cli-debugger` 这一个 binary（不动 `silverc.exe`，D-019 的编译器 pin 不受影响），用它跑
`ShardLeafDirect.tokenization.test.json` 里已经真实验证过的 `V-register_append-1_pass_first_bet_
zero_existing_pool`（function/args 模式，让调试器自己按官方逻辑编码），转储真实 `active_sigscript`
（冻结在 `real_action_from_debugger.hex`），验证完成后 `git checkout` 还原源码、重编回原始
`cli-debugger.exe`（`git status` 确认无残留改动）。

**结果**：用 `kaspa.ScriptBuilder` 按 `V-register_append-1` 的 11 个真实参数（`V-register_append-1.
args.json`）+ 真实编译产物的 `dispatch_tag` 独立编码出的 `action` 字节，与真实 cli-debugger 自己构造
的 `real_action_from_debugger.hex` **逐字节完全一致**（见 `proto-register-append-witness.test.mjs`
向量①，PASS）。这是"我的编码器 == 官方编码器，用真实数据验证过，不是读了源码就假设自己写对了"的
直接证据。

## ④ 一个真实的工具架构发现：test-file 的 `signature_script_hex` 对**活跃输入**不生效

Bettor 原始方案第②步要求"把完整 sigScript 字节原样填进 `signature_script_hex`，不要用 function/args
让调试器替你编码"，对 `ShardLeaf_direct.register_append` 跑 PASS/FAIL 对照。**实测这条路径在当前
cli-debugger 架构下走不通**——不是我的编码有问题，是工具本身的设计：

- `main.rs:914` 的 `tx_inputs` 组装确实优先取 `explicit_input_sigs[input_idx]`（即 JSON 的
  `signature_script_hex`），**但那份 `tx_inputs`/`kas_tx` 只用于最终的 mass 计算/`_assertTxInvariants`
  之类的外围校验**。
- **实际驱动 `--run` 判定 PASS/FAIL 的交互式调试会话**在 `main.rs:976`：
  `DebugSession::full(&active_sigscript, &active_lockscript, ...)`——这里的 `active_sigscript`
  是**函数调用之前就已经算好**的那个变量（永远来自 `encode_contract_entry_sig_script`
  或 covenant 分支的构造，**完全不读 `explicit_input_sigs`**）。
- 实测证据：把 `signature_script_hex` 换成我手拼的完整字节（`raw_sigscript_vectors.test.json`，
  未随本笔提交，过程性产物），无论内容对不对，交互执行结果**都跟改动前一样**（因为
  `active_sigscript` 根本没变），唯一观察到的差异来自其它无关因素，不构成"debugger 读了我的原始
  字节并验证"的证据。

**结论**：这条工具能力（"喂原始 sigScript 给活跃输入测试"）在当前 cli-debugger 里**不存在**，不是
我没找对参数。真正等价、且已经做到的决定性证据是 ③ 的逐字节比对——证明我的编码器与官方编码器在
真实参数下产出完全相同的字节，而官方编码器本身的 PASS/FAIL 正确性已经由 2026-09-14 的既有工作
（`docs/provenance/2026-09-14-j2-t3-v03-shardleafdirect-tokenization/`，14/14 pass）反复验证过。
两条证据拼起来 == "我的编码器产出的字节，就是那个已经被证明对 register_append 正确工作的字节"，
逻辑上等价于 Bettor 要的"决定性验证"，只是走的路线不同（她设想的路线在这个工具版本上不可行）。

## ⑤ 用官方(function/args)路径确认精确失败行(替代原计划的"改动1字节喂raw sigScript" )

`fnargs_wrongstake.test.json`：把 `V-register_append-1` 的 witness 里 `stake` 从 20 改成 21
（其余不动，包括对应输出没有跟着改），真实 cli-debugger 报：

```
error: script ran, but verification failed
    --> 131:9
    |
130 |         // mint dust ticket (spent-once claim/refund 凭证)
131 |         validateOutputStateWithTemplate(psOutIdx, Tk {
```

精确失败在 `register_append` 的 `psOutIdx` 输出校验（票据 State 里烤的 `stake` 字段与 witness 声明
的 `stake` 不一致，先于 `stakeInIdx` 那条 `stakeTk.amount == stake` 检查触发）——是一个真实、可解释
的 `require` 失败，不是随手断言了一个不存在的输出/崩溃退出，证明这套编码在"给错值"场景下也如预期
运作。

## 处置

- `T-PROTO-ENTRY-WITNESS-ABI-UNVERIFIED` 中 **`register_append` 部分关闭**，出处：本 provenance
  ③④⑤。`resolve`/`claim` 入口仍未验证，票继续开着（不属于本笔范围）。
- 生产代码：`kasia-console/src/lib/proto-register-append-witness.mjs` +
  `proto-register-append-witness.test.mjs`（5/5 pass，向量①即③的可重复冻结版本，不需要每次都重编
  调试版 cli-debugger.exe）。
- `debug-print.patch` 只是**过程记录**，从未提交进 silverscript 仓库、临时构建已还原（`git status`
  确认无残留），D-019 的 `silverc.exe`/`cli-debugger.exe` pin 不受影响。

## 文件清单

- `debug-print.patch`——临时调试补丁(过程记录，未实际留在 silverscript 仓库里)
- `real_action_from_debugger.hex`——真实 cli-debugger 构造出的 `active_sigscript`(冻结证据)
- `V-register_append-1.args.json` / `ShardLeaf_direct.reference.ctor.json` / `ShardLeaf_direct.sil`
  ——复现①③所需的固定输入(从既有 2026-09-14 provenance 复制冻结，不重新生成随机值)
- `fnargs_wrongstake.test.json`——⑤ 的真实失败向量
- `README.md`——本文件
