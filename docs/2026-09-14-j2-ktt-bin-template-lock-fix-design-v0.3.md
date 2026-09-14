> **Status**: CURRENT

# KTT (b-in) 模板锁修法设计 v0.3 — 方案 C：直接删除 H1(b)，不修它

票：**T-KTT-BIN-TEMPLATE-LOCK-FIX**。取代 `docs/2026-09-14-j2-ktt-bin-template-lock-fix-design-v0.2.md`（已标 SUPERSEDED-BY-REMOVAL）。出处：Owner 裁定（账本 1408，`docs/DECISIONS.md` D-017 注记）撤销 H1(b)（KTT 花费侧"接收方必须是市场模板"这条检查本身），"代币就是代币"；账本 1409 把范围扩大到 `KanetTokenClaim.sil` 的 `to_market_input` 分支同款检查（"同病同治"）。

**本文档只设计，不改任何生产 `.sil` 文件**——全部实测用 `docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b/` 下的实验性副本跑 `compileSilV100` + D-019 pin 的 v1.0.0 `cli-debugger` 真实验证。

## §0 为什么是"删除"不是"修复"

v0.1（State + `readInputStateWithTemplate`）被 NWT Decoy 攻击证伪，v0.2（依赖反转，ctor 烤市场 hash）虽然真实编译验证通过（a/b/c/d 全过），但产品代价太大（逐市场独立发币，代币不互通）。Owner 从更高层面裁定：**这条检查本身要解决的问题（"确保代币只流向真实市场"）根本不需要由代币合约来解决**——参考上游标准实现 `silverscript-lang/tests/examples/kcc20.sil`（56 行），一个正常的可替代代币合约只关心：谁能花（owner 在场）、花的时候有没有做旁的坏事（`minter` 标记不能被伪造）、有没有守恒（`sum_in==sum_out` 或本仓的 `>=` 变体）——**从不关心代币被转去了哪种类型的 covenant**。"这份代币是不是我这个市场认可的注额"完全是**接收方自己的问题**（`ShardLeaf_direct` 已经有独立的 `scanOwnedTokenInputs` 在做这件事，从代币合约的视角看，这个检查一直是重复的），代币合约做这个检查从一开始就是多管闲事，还顺带引入了 NWT 揪出来的攻击面。**删除比修复更安全、更简单、字节更省**。

## §1 改动 diff

### 1.1 `KanetTestToken.sil`

- 删除 ctor 字段 `byte[] market_tmpl_suffix, int market_tmpl_suffix_len`。
- 删除函数 `ownerIsMarketInput`（含 `tx.inputs[idx].sigScript` 尾部切片比较逻辑）。
- `transferPolicy` 签名删除 `int[] recv_idx` 参数。
- 删除两行 `require(recv_idx[j] >= 0); require(ownerIsMarketInput(recv_idx[j], next_states[j].owner));`。

### 1.2 `KanetTokenClaim.sil`（账本 1409 扩大范围，"同病同治"）

- 删除 ctor 字段 `byte[32] init_market_suffix_hash`（及 State 字段 `market_suffix_hash`）。
- `entry spend` 删除 `byte[] market_suffix_witness` 参数。
- `to_market_input` 分支删除 `require(blake3(market_suffix_witness) == market_suffix_hash)` + `destSig`/`destLen`/`msl` 三行切片比较 + 尾部匹配 `require`（共 6 行）。

### 1.3 两个文件都保留的不变量（未受本次删除影响）

| 不变量 | 位置 | 由谁保证 |
|---|---|---|
| `owner_scheme == SCHEME_COVENANT_ID` | KTT 花费侧+接收侧 | 代币侧 |
| 花费侧 owner covenant 在场（`OpInputCovenantId(owner_input_idx[i]) == prev_states[i].owner`） | KTT `transferPolicy` | 代币侧 |
| `transfer_delegator` 委托本地校验 | KTT | 代币侧 |
| `borrow_scheme == BORROW_DISABLED`（H3） | KTT | 代币侧 |
| `owner != ZERO32` | KTT `transferPolicy`；`KanetTokenClaim` ZERO32 目的地守卫（NWT 1176 MUST-FIX） | 代币侧（两个文件独立各自的守卫，防"owner=0 被任何裸输入恒真花掉"这个真实资金损失，跟市场识别无关） |
| `sum_in >= sum_out` | KTT | 代币侧 |
| `mint_issuer`/`clawback` 稳定币三入口骨架 | KTT | 代币侧（测试币构建下不可达，见既有 H2/P3 纪律，本次未动） |
| `checkSig(s, pubkey(winner_pk))` | `KanetTokenClaim` | 代币侧 |
| **"这份代币是不是我认可的真实注额"** | — | **市场侧**（`ShardLeaf_direct.scanOwnedTokenInputs`：`blake3(prefix‖suffix)==token_tmpl_hash` + `tk.owner==OpInputCovenantId(this.activeInputIndex)`），代币侧完全不管 |

## §2 (1121) 守恒两半等价性在 v0.3(α) 下的分析

**仍然成立，论证不需要改变**。(1121) 原论证：代币侧 `sum_in>=sum_out`（不能凭空印钱）+ 市场/领取侧独立的 `require(scanOwnedTokenInputs()==本入口处理量)`（市场自己核实收到的量对不对），两半合起来等价旧的精确 `sum_in==sum_out`。这个论证**从未依赖** `ownerIsMarketInput`（被删除的检查）——它是代币合约里一层**额外的、被 NWT (1395/1399) 证明形同虚设**的检查，删除它不改变市场侧 `scanOwnedTokenInputs` 的独立验证能力，也不改变代币侧 `sum_in>=sum_out` 本身。真实编译验证（`docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b/`）里的 `V03-1` 向量直接证明：`next_states[j].owner` 现在可以是任意值（不需要对应任何真实在场输入），但花费侧的 owner-在场检查（:81，(1121) 论证真正依赖的那一半）完全没有被触及，`V03-2` 负向向量确认它仍然生效。

## §3 向量增删表

| 向量 | 状态 | 说明 |
|---|---|---|
| 旧 T1 `V-T-5_fail_market_sigscript_tail_one_byte_off` | **删除** | 测的是已删除的尾部匹配逻辑，机制本身不存在了 |
| 旧 v0.1/v0.2 各版本"市场识别"相关向量（Decoy 攻击、依赖反转 a/b/c/d） | **删除**（连同 v0.1/v0.2 一起归档，见 `docs/2026-09-14-j2-ktt-bin-template-lock-fix-design-v0.2.md` SUPERSEDED-BY-REMOVAL 注记） | 问题本身被移除，不需要继续为它维护向量 |
| **新增** `V03-1_pass_owner_field_is_arbitrary_value_no_presence_check` | ✅ 已跑通（真实 cli-debugger） | 收方 owner 字段为任意值（不对应任何真实在场输入）⇒ pass |
| **新增** `V03-2_fail_owner_not_present_at_claimed_index` | ✅ 已跑通（真实 cli-debugger） | 保留的花费侧 owner-在场检查仍然生效 ⇒ fail（对照组，证明删除是精确的，没有连带删掉不该删的检查） |
| `KanetTokenClaim` 对应正负向量 | **待补**（未做，见 §5 已知限制） | 落码前需要补一条完整端到端向量（真实签名+代币输入读取，比 KTT 的 `transfer` 复杂） |

## §4 T3 侧四份文件确认

**`ShardLeaf_direct.sil`/`RootClaim.sil`/`RefundClaim.sil`/`RootClose.sil` 四份文件不需要任何代码/逻辑改动**——`token_tmpl_hash` 按 Owner 1408 裁定继续留在 ctor（不挪 State，v0.2 那条"依赖反转"改动作废）。唯一需要的是**机械更新**：这四份文件 ctor 里烤的 `token_tmpl_hash` 常量值，从旧的 KTT 编译产物 hash 换成 v0.3（方案 C）新的编译产物 hash（`241e52069168e22d0bd92b6e705b99c641bf0424c90419ca16c847f014a618ac`，见 `docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b/run.log`）——这是**数值更新**，不是**结构性改动**，落码时体现在 `proto-v0-template-anchors.json` 或对应的协议常量计算脚本里，不需要改这四份 `.sil` 源码本身。

## §5 已知限制

- `KanetTokenClaim.sil` 未做完整 cli-debugger 端到端向量（该 `entry spend` 需要真实签名+代币输入读取等更多前置条件，工作量显著大于 `KanetTestToken.transfer`），落码前应补齐。
- 字节预算数字基于占位 ctor 值，真实市场参数下需要重新编译确认精确数值。
- `KanetTokenClaim.to_market_input=false` 分支（`OpOutputCovenantId` 路径）完全未改动，本次未重新测试。

## §6 真实编译数字

| 合约 | 旧设计脚本长度 | v0.3(方案C) 脚本长度 |
|---|---|---|
| `KanetTestToken` | 3471-5359 B（视版本） | **3191 B（全场最省，含此前所有候选）** |
| `KanetTokenClaim` | 1454 B | **1347 B** |
