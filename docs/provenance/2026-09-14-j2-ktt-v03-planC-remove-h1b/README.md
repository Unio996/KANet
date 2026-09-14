> **Status**: CURRENT

# KTT/KanetTokenClaim v0.3（方案 C：删除 H1(b)）— 真实编译 + cli-debugger 向量

出处：Owner 裁定（账本 1408，`docs/DECISIONS.md` D-017 注记）撤销 H1(b)（KTT 花费侧"接收方必须是市场模板"这条检查），"代币就是代币"；账本 1409 扩大范围到 `KanetTokenClaim.sil` 的 `to_market_input` 分支同款检查（"同病同治"）。参考上游 `silverscript-lang/tests/examples/kcc20.sil`（56 行，无任何接收方类型检查，只管 owner 在场+守恒+minter 标记）。

**不改任何生产 `.sil` 文件**——全部实测用本目录下两份实验性副本。

## 改动 diff

### `KanetTestToken.sil`

- 删除 ctor 字段 `byte[] market_tmpl_suffix, int market_tmpl_suffix_len`。
- 删除函数 `ownerIsMarketInput`（连同其内部 `tx.inputs[idx].sigScript` 尾部切片比较逻辑）。
- `transferPolicy` 签名删除 `int[] recv_idx` 参数。
- 删除两行 `require(recv_idx[j] >= 0); require(ownerIsMarketInput(recv_idx[j], next_states[j].owner));`。
- **保留**：`owner_scheme == SCHEME_COVENANT_ID`（花费侧+接收侧）、`OpInputCovenantId(owner_input_idx[i]) == prev_states[i].owner`（花费侧 owner 在场，:81）、`transfer_delegator` 委托本地校验（不变）、`borrow_scheme == BORROW_DISABLED`（H3）、`next_states[j].owner != ZERO32`（:100 附近）、`sum_in >= sum_out`、`mint_issuer`/`clawback` 稳定币三入口骨架。

### `KanetTokenClaim.sil`

- 删除 ctor 字段 `byte[32] init_market_suffix_hash`（及对应 State 字段 `market_suffix_hash`）。
- 删除 `entry spend` 的 `byte[] market_suffix_witness` 参数。
- 删除 `to_market_input` 分支里 `require(blake3(market_suffix_witness) == market_suffix_hash)` + `destSig`/`destLen`/`msl` 三行切片比较 + 尾部匹配 `require`（共 6 行）。
- **保留**：`target_owner = OpInputCovenantId(dest_idx)`、`require(target_owner != ZERO32)`（NWT 1176 MUST-FIX 的 ZERO32 目的地守卫——这条防的是"owner=0 赢币被任何裸输入花掉"的真实资金损失，跟市场识别无关，不受本次撤销影响）、`else` 分支（`to_market_input=false`）完全不变、结尾 `checkSig(s, pubkey(winner_pk))` 不变。

## 真实编译结果

| 合约 | 旧设计脚本长度 | v0.3(方案C) 脚本长度 | 变化 |
|---|---|---|---|
| `KanetTestToken` | 3471-5359 B（视此前哪个版本） | **3191 B** | 更小——删除整个市场识别机制 |
| `KanetTokenClaim` | 1454 B | **1347 B** | 更小 |

`KanetTestToken` v0.3 的 `token_tmpl_hash`（`extractTemplateArtifact` 产物）：`241e52069168e22d0bd92b6e705b99c641bf0424c90419ca16c847f014a618ac`（真实编译产物，落码时 `ShardLeaf_direct`/`RootClaim`/`RefundClaim`/`RootClose` ctor 里引用的 `token_tmpl_hash` 需要换成这个新值，因为源码变了）。

## cli-debugger 向量（`ktt-v03-vectors.test.json`，`KanetTestToken` 侧，D-019 pin 的 v1.0.0 二进制跑通）

| 向量 | 内容 | 预期 | 实测 |
|---|---|---|---|
| `V03-1` 正向 | `next_states[0].owner` 是一个任意值（`0x9999...`），在本 tx 里找不到任何对应的真实在场 covenant 输入——旧设计下 `ownerIsMarketInput` 会因为找不到匹配而拒绝 | **pass** | ✅ pass |
| `V03-2` 负向（对照，验证**保留**的检查仍生效） | `prev_states[0].owner` 声称是 `0x1111...`，但实际 `tx.inputs[0].covenant_id` 是 `0x9999...`（不匹配）——这是 :81 那条**没有被删除**的"owner 在场"检查 | **fail** | ✅ fail |

**实测过程中的一次真实语义订正**：第一次尝试用"给输出指定一个全新 covenant_id"来模拟"收方是任意市场"时撞上 `WrongGenesisCovenantId`——debugger 报错让我们发现 `#[covenant(binding=cov,...)]` 声明式转账的 `next_states` 全部是**同一个 KTT 覆盖组的续约实例**（covenant id 由 consensus/调试器按 leader 的 covenant 组自动派生，不能在测试里手工指定成别的值）。`ownerIsMarketInput` 真正检查的从来不是"这个输出属于哪个 covenant 组"（那是宏自动保证的结构性质），而是"`next_states[j].owner` 这个 byte32 值是否对应本 tx 里某个真实在场的 covenant 输入"——这是被删掉的检查，修正后的 `V03-1` 向量准确反映了这一点。另有一个更早的理解错误：`args[0]` 曾被误当成 `prev_states`，实际按 `DECL.md`"Generated entrypoint args are new_states plus optional extra call args"是 `next_states`（调用方声明的目标状态），`prev_states` 反而是从 `tx.inputs[]` 里带 `state` 字段的输入自动读回——两次错误都是在实测中被 debugger 的真实行为纠正的，不是凭空猜对的。

`KanetTokenClaim` 侧只做了真实编译验证（1347 B，成功），未构造完整 cli-debugger 向量（该 `entry spend` 需要真实 `checkSig` 签名 + `readInputStateWithTemplate` 读代币输入等更多前置条件，工作量显著大于 `KanetTestToken` 的 `transfer`）——这是本 provenance 明确标注的范围限制，落码前应补一条完整向量。

## (1121) 守恒两半等价性在 v0.3(α) 下是否仍成立

**仍然成立，且论证不需要改变**：(1121) 的原论证是"代币侧 `sum_in >= sum_out`（不能凭空印钱）+ 市场/领取侧自己的 `require(scanOwnedTokenInputs() == 本入口处理量)`（市场自己核实收到的量对不对）两半合起来等价旧的精确 `sum_in == sum_out`"。这个论证**从未依赖** `ownerIsMarketInput`（被删除的检查）——市场侧的 `scanOwnedTokenInputs` 独立验证不受代币合约删不删这个检查影响，代币合约那一半的 `sum_in>=sum_out` 也完全不受影响。`ownerIsMarketInput` 是一层**额外的、被证明是重言式/形同虚设**的检查（NWT (1395/1399) 已证明它比"什么都不检查"强不了多少），删除它不改变 (1121) 论证依赖的任何一个前提。

## 已知限制

- `KanetTokenClaim` 未做完整 cli-debugger 端到端向量（见上）。
- 字节预算基于占位 ctor 值，真实市场参数下需要重新编译确认精确数值（不预期显著变化，同此前"逐字段隔离"系列 provenance 的既有结论）。
- `to_market_input=false` 分支（`OpOutputCovenantId` 路径）完全未改动，未重新测试，风险较低（本次改动没有触碰这条路径的任何一行）。

## 文件清单

- `KanetTestToken.v0.3-planC.sil`
- `KanetTokenClaim.v0.3-planC.sil`
- `build-and-vectors.mjs`
- `ktt-v03-vectors.test.json`
- `run.log`
- `README.md`
- `MANIFEST.sha256`
