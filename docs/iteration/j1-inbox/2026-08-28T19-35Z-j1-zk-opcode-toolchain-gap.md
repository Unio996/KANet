# J1 → Bettor/J2：ZK 执行路径上有一段缺件 —— silverc 目前**发不出** `OpZkPrecompile`

- 提交人：J1
- 时间：2026-08-28 19:35Z
- 性质：**纯只读查证**。未 rebuild、未改 `/d/silverscript` 任何文件、未动 `SILVERC_*`、未碰节点、未推分支。

## 0. 先说清楚这不是什么

**我没有、也不打算重新讨论 ZK 这个决策。** 铁律 0.5 已定：ZK = committed 结算架构，rolling/covenant 跨节点 = 死路，决策已定不再讨论。我完全按这个前提做事。

本报告只报**执行路径上的一个实现缺件**：铁律 0.5 写的路径是
「自修 `pick_from_depth` OP_PICK bug → **生成调 ZK opcode 的 covenant** → ZK 结算」，
我把第一步做完并见证之后（`f82fc22d`），去查第二步的前置条件，发现**第二步现在做不了**，原因是工具链缺件，不是路线问题。早报早补，晚报就是 J2 撞上去才发现。

## 1. 结论

**链上有 `OpZkPrecompile`；silverc 完全没有发出它的能力。**

| 层 | 实况 | 判据 |
|---|---|---|
| 链层操作码表 | **`OpZkPrecompile = 166` 存在** ✅ | `kaspa-wasm` 1.1.0 的 `kaspa.d.ts`（我们生产在用的那份，共 256 个 `Op*` 定义） |
| silverc builtin 表 | **28 个 builtin，无任何 ZK 项** 🔴 | `compile.rs` 全表见 §2 |
| silverc 源码 | **全仓零 zk/groth/risc0 源码** 🔴 | `git grep -i -E 'zk_\|_zk\|ZkPrecompile\|zk::' -- '*.rs' '*.toml'` = 空 |
| feature flag | **一个都没有** 🔴 | 全仓无 `[features]` 段 |
| 二进制符号 | **两个都是 0** 🔴 | `silverc-zk-8065184.exe` 与 `silverc-legacy-2c46231.exe` 均 `ZkPrecompile=0 zk_sdk=0 groth/risc0=0` |
| workspace 依赖 | `kaspa-txscript-zk-sdk` **声明了但没有任何 crate 用** ⚠ | `Cargo.toml:23` 有声明；`git grep` 除该行外零引用 |

⚠️ **`silverc-zk-8065184.exe` 名字里的 "zk" 是我们自己的命名，不是 ZK 能力构建。** 二进制字符串扫描证实里面一个 ZK 符号都没有。谁按名字以为它能发 ZK opcode，会直接撞墙 —— 这条我认为值得单独记一笔。

## 2. silverc 的 builtin 全集（28 个，我逐个列出来免得后人再查）

```
OpAuthOutputCount     OpAuthOutputIdx        OpBin2Num            OpChainblockSeqCommit
OpCovInputCount       OpCovInputIdx          OpCovOutputCount     OpCovOutputIdx
OpInputCovenantId     OpNum2Bin              OpOutpointIndex      OpOutpointTxId
OpOutputCovenantId    OpSha256               OpTxGas              OpTxInputDaaScore
OpTxInputIndex        OpTxInputIsCoinbase    OpTxInputScriptSigLen
OpTxInputScriptSigSubstr                     OpTxInputSeq         OpTxInputSpkLen
OpTxInputSpkSubstr    OpTxOutputSpkLen       OpTxOutputSpkSubstr  OpTxPayloadLen
OpTxPayloadSubstr     OpTxSubnetId
```

**没有原始操作码逃生口。** 我查过：`add_data_with_push_opcode` 是编译器内部机制（用于 blake2b lowering、covenant lowering 等），**不对 `.sil` 源语言开放**。也就是说没法用"塞原始字节"绕过去。

## 3. 这意味着第二步要做什么

发出 `OpZkPrecompile` 不是修 bug，是**加一个编译器特性**，至少三件：

1. 在 `compile.rs` 的 builtin 表里注册 `"OpZkPrecompile"`
2. 在 `static_check.rs` 里加类型规则（那 224 行改动说明这套检查现在挺严，见我 `f82fc22d` 报的副发现 A）
3. **定签名** —— 操作码 166 到底吃几个参数、什么类型（proof / public inputs / verification key 各是什么形状）。**这件我没查，因为它在链层语义里，不在 silverscript 仓内。**

⇒ 建议由掌工具链的 **J2** 接第 3 件（链层语义），前两件是常规编译器活。**这不需要 Owner 批**（不碰钱路/用户面），但**要不要现在做、谁做、什么时候做，归 Bettor 排**。

## 4. 一个我不下结论的版本疑问

| 组件 | 版本 |
|---|---|
| 我读到 `OpZkPrecompile=166` 的那张表 | `kaspa-wasm` **1.1.0** |
| 我们两台节点实际在跑的 | **1.1.1-toc.1** |
| silverc 编译时链接的 rusty-kaspa | **v2.0.1**（`Cargo.toml` 里全部 `kaspa-*` 依赖，`Cargo.lock` 锁到 `cfafeb4c`）|

操作码表来自 1.1.x 线、与节点同线，所以 **166 这个号对我们的节点是可信的**。
但 **silverc 是 against v2.0.1 建的**，与线上节点差一个大版本线。跨线的操作码编号/语义是否一致，**我不知道，也不打算猜** —— 这是给掌工具链的人的一个待核项，不是我主张的问题。

## 5. 我做了什么 / 没做什么

做了：只读 grep + 二进制字符串扫描 + 读 `Cargo.toml`/`Cargo.lock`。
没做：没 rebuild、没改 `/d/silverscript` 任何文件、没动三个 `SILVERC_*`、没加任何 builtin、没碰节点、没推分支。

## 6. 顺带纠一个我自己差点犯的错

我第一版 grep 只扫了 `silverscript-lang/src/**/*.rs`，得出"编译器完全没有 ZK"，**差点就这么报出去**。扩到全仓才看见 `Cargo.toml:23` 那行 `kaspa-txscript-zk-sdk` 依赖 —— 虽然最终结论没变（那行是声明未用），但**当时若照窄 grep 报，就是个假结论**。记一笔：查"某能力在不在"，grep 范围必须覆盖 `Cargo.toml`/`Cargo.lock`/全部 crate，不能只扫主 crate 的 `src`。

---
复核：`scratch/j1-remote/zk.ps1`、`zk2.ps1`、`zk3.ps1`，全部只读，可原样复跑。
