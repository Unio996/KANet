# RootClose.sil — convert_to_claim / convert_to_refundclaim ZERO32 目的地守卫（ledger 1186，批次④之一）

## 背景（Codex/NWT 点名最高风险）

`RootClose.sil` 是 seal 目标合约（cascade convert-split 架构，~825B 预算），4 个 entry 里
`convert_to_claim`（settled → 桥接新建 `RootClaim` 实例）和 `convert_to_refundclaim`（cancelled →
桥接新建 `RefundClaim` 实例）此前**只有 `validateOutputStateWithTemplate` 一层校验**，设计表对这两个
入口没有独立验证描述——这正是 Codex 与 NWT 点名的最高风险点：`RootClose.sil` 是**唯一**入口把资金从
seal 阶段推进到 claim/refund 阶段，若目的地能被劫持，整池资金可被引导到攻击者控制的伪装输出。

## 发现的缺口 + 修复

`validateOutputStateWithTemplate(idx, StateStruct{...}, prefix, suffix, tmpl_hash)` 只核对目标输出的
**脚本字节**是否逐位匹配一个用给定 `tmpl_hash` 编译出的真实 `RootClaim`/`RefundClaim` 实例（模板校验）。
但脚本字节匹配 ≠ covenant 绑定——这是 1173/1176/1181 三次在 `KanetTokenClaim.sil` 反复证过的两层独立
事实：一笔输出完全可以让脚本字节与真实编译产物逐位相同，同时**完全不声明 `covenant_id`**（或声明成别的
值），此时 `OpOutputCovenantId` 照样按协议原生语义回退到 `ZERO_HASH`。攻击者可以构造一笔"脚本字节合规
但没有真正绑定 covenant"的输出，蒙混过模板校验，之后再用另一笔交易把这个"裸"输出接管为任意合约实例。

修复：在两个 entry 里 `validateOutputStateWithTemplate` 调用**之后**，各加一条独立的
`require(OpOutputCovenantId(idx) != ZERO32)`——两条检查各自承重、缺一不可：

```
validateOutputStateWithTemplate(claimOutIdx, ClaimState {...}, claim_prefix, claim_suffix, claim_tmpl_hash);
require(OpOutputCovenantId(claimOutIdx) != byte[32](0x00...00));   // ★ 新增
require(tx.outputs[claimOutIdx].value == pool_value);
```

`convert_to_refundclaim` 同形（`rcOutIdx` / `State` / `refundclaim_tmpl_hash`）。

## ctor 字段跟进（RootClaim 10→13 / RefundClaim 9→12）

`RootClaim.sil`/`RefundClaim.sil` 在各自的 v0.3 代币化批次里（`6156e98d`/`0d8a61ee`，本 worktree
`ac9085c8`）ctor 分别加了 3 个字段：`token_tmpl_hash`、`claim_tmpl_hash`（KTC 的）、`market_suffix_hash`。
核实结果：**这三个新字段都是 ctor-only 常量，没有被重新声明为实例字段**——因此它们不进入
`validateOutputStateWithTemplate` 用来做 state 序列化的隐式 `State`/`ClaimState` struct 字面量。
`RootClaim` 的 State 仍是 8 字段（含 `claimed_bitmap`），`RefundClaim` 仍是 7 字段——`RootClose.sil` 自己
的 `ClaimState`/`State` struct 定义**形状不需要改**（本次未改）。

真正需要跟进的是：`RootClose` 的 `claim_tmpl_hash`/`refundclaim_tmpl_hash` 这两个 ctor 常量，其数值必须
是用 `RootClaim.sil`/`RefundClaim.sil` **当前（后代币化）**编译产物算出的 `template_hash`，而不是代币化
之前的旧值——`template_hash` 只对**结构性形状**（字段数/类型）敏感，跟具体 ctor 数值无关（本会话反复验证
过的模板不变性），但代币化没有改变这两份 State 的结构性形状，所以 `template_hash` 实际上**跟代币化前
完全一致**（本次向量里 `rootClaimAnchor`/`refundClaimAnchor` 用当前 13/12 参数 ctor 编译得到的
`template_hash`，与旧 10/9 参数编译值理应相同——这点不是本次要修的东西，只是构造向量时必须用当前真实
ctor 形状编译，不能凭旧记忆假设参数个数）。

## 授权链表：期望的 claim/refund covenant id 如何建立

这是 ledger 1186 明确要求写清的部分。`RootClose` 本身**不生产** claim/refund 的 covenant id，它只是
**验证**调用者声称的目的地输出是否同时满足"脚本字节匹配"+"covenant 非零"两个独立条件；真正的 covenant id
数值由 Kaspa 协议原生的 covenant 语义决定，链条如下：

| # | 环节 | 谁产生 / 谁核验 | 建立方式 |
|---|---|---|---|
| 1 | 调用者构造新输出，声明一个具体 `covenant_id` 值 | 花费 `RootClose` UTXO 的交易构造者（链下） | 协议层：新建输出若无匹配 input 的 `covenant_id`，会触发**创世 covenant id** 重算（`hashing::covenant_id::covenant_id(previous_outpoint, output_indices)`，见 `kaspa-txscript` `covenants.rs`）；若声明的 `covenant_id` 与某个 input 的 `covenant_id` 一致，则走"continuation"路径，直接复用该值 |
| 2 | `RootClose.convert_to_claim`/`convert_to_refundclaim` 读回这个值 | `OpOutputCovenantId(claimOutIdx/rcOutIdx)` | 协议原生 opcode，从输出的 covenant 元数据字段读取；未声明时回退 `ZERO_HASH` |
| 3 | 新增守卫核验"非零" | `require(OpOutputCovenantId(...) != ZERO32)`（本次新增） | 独立于模板校验；只证明"这不是一个裸输出"，**不**证明这个 covenant id 具体等于哪个值 |
| 4 | 脚本字节核验"是真实合约" | `validateOutputStateWithTemplate(...)`（已有） | 证明输出脚本字节逐位等于用 `claim_tmpl_hash`/`refundclaim_tmpl_hash` 编译出的真实 `RootClaim`/`RefundClaim` 字节码，state 部分等于 self 委员盖章字段 |
| 5 | 两条独立证明合起来的含义 | — | "这笔输出**既**是脚本字节意义上真实的 `RootClaim`/`RefundClaim` 实例，**又**确实绑定了某个非零 covenant"——但**不**保证这个 covenant id 恰好是"为这个新实例应该建立的那个创世 id"，因为 `OpOutputCovenantId` 只读值，不比对来源 |

**已知未覆盖点（如实记录，同其余三份 claim 家族 README 的记法）**：本次修复只堵住"裸输出蒙混过模板校验"
这一种攻击面。它没有、也不打算证明"新声明的 covenant id 恰好等于协议按 `previous_outpoint` 算出的那个
创世 id"——这一点由 Kaspa 协议共识层在交易验证时强制执行（伪造的 `covenant_id` 若不匹配协议重算值，交易
本身在共识层就不合法，落不了链），不属于 `.sil` 合约逻辑需要（或能够）验证的范围；这与
`PayoutShardV2`/`RootClaim`/`CloseZkV2` 三份 README 里"`claim_tmpl_hash` 缺 ctor 端非零断言"记的未覆盖点
是同一性质——合约层证明能证明的，协议层证明协议层该证明的，两层各自独立、互不代偿。

## 为何没有 1122 边界向量

ledger 1186 提到"B 类入口带 1122 边界向量"，但该要求只适用于**扫描 `tx.inputs`/`tx.outputs` 数组、有
`MAX_INS_SCAN` 式循环上界**的 B 类入口。`RootClose.sil` 全部 4 个 entry（`close_commit`/`refund_flip`/
`convert_to_claim`/`convert_to_refundclaim`）都不含任何遍历循环——它们只做定点索引读取
（`tx.outputs[rootOutIdx]` 等单点访问，索引由调用者以 witness 形式传入，非合约内部扫描产生的动态上界）。
1122 边界向量在本文件不适用；该要求预期落在批次②/③（`ShardLeaf.sil`/`ShardLeaf_direct.sil`）里含扫描
逻辑的入口上。

## 范围纪律（未展开的部分，如实记录）

本次没有把 `pool_value` 重新解释为 KCC-20 代币量（即没有给 `close_commit`/`refund_flip` 加
`noTokenInput()`、没有给 `convert_to_claim`/`convert_to_refundclaim` 加 `scanOwnedTokenInputs()` 式真实
代币转移逻辑，跟其余四处 claim 家族文件的 D-017 代币化改造不同）。原因：ledger 1186 的措辞明确限定在
"目标输出必须模板校验 + `Op*CovId != ZERO32` + 跟进 ctor 字段 + README 授权链表"这四项，未提及代币语义
扩展；`RootClose` 本身不持有、不转移代币（它只是 seal→claim/refund 之间的状态桥，`pool_value` 是委员盖
章后原样传递的记账字段，真正的代币转移发生在下游 `RootClaim`/`RefundClaim`/`PayoutShard(V2)` 里，那几处
已经代币化完毕）。若后续需要在 `RootClose` 层也做代币语义校验，需 Bettor 另行确认范围，不在本次自行展开。

## 向量（`run.log`，6/6 PASS，含 flip-expect 交互步进复核）

| 向量 | 验证点 | 真实失败行（flip-expect 步进确认） |
|---|---|---|
| `V-RCLZ-1_pass_convert_to_claim_real_bridge` | pass：真实 `RootClaim` 桥接，output 声明非零 covenant_id（continuation-case） | — |
| `V-RCLZ-2_fail_convert_to_claim_bare_output_no_covenant_id_zero32` | fail：脚本字节完全匹配真实 `RootClaim`，但输出不声明任何 `covenant_id` | `RootClose.sil:118`（新增的 `require(OpOutputCovenantId != ZERO32)`），非模板校验行 |
| `V-RCLZ-3_fail_convert_to_claim_fake_template_shell` | fail：目标脚本字节根本不是 `RootClaim`（是 `RefundClaim` 的字节） | `RootClose.sil:113`（`validateOutputStateWithTemplate` 起始行），非索引越界 |
| `V-RCLZ-4_pass_convert_to_refundclaim_real_bridge` | pass：真实 `RefundClaim` 桥接，output 声明非零 covenant_id | — |
| `V-RCLZ-5_fail_convert_to_refundclaim_bare_output_no_covenant_id_zero32` | fail：脚本字节匹配真实 `RefundClaim`，但输出不声明 covenant_id | `RootClose.sil:130`（新增守卫） |
| `V-RCLZ-6_fail_convert_to_refundclaim_fake_template_shell` | fail：目标脚本字节是 `RootClaim` 的（错的合约） | `RootClose.sil:126`（模板校验行） |

`V-RCLZ-1`/`V-RCLZ-4` 曾在首次构造时因为 output `value` 字段误写成 `1`（而 `pool_value` ctor 值是
`100`，触发已有的 R3 `require(tx.outputs[idx].value == pool_value)`）而错误 FAIL——已定位并改成
`value: 100` 后复核 6/6 PASS；这是测试向量构造错误，不是 `.sil` 代码缺陷。`V-RCLZ-3`/`V-RCLZ-6`
两个"假模板 shell"负向量额外做了 flip-expect 交互步进复核，确认失败发生在 `validateOutputStateWithTemplate`
调用行本身（模板字节不匹配），而不是巧合性地撞在别的越界/无关错误上。

## 文件清单

- `RootClose.sil` — 本次修改后的完整合约源码
- `mk_rootclose_zero32_vectors.mjs` — 向量生成脚本（真实编译 `RootClaim.sil`/`RefundClaim.sil` 当前
  13/12 参数 ctor 形状）
- `RootClose.zero32guard.test.json` — 生成的 6 条测试向量
- `RootClose.reference.ctor.json` / `RootClose.reference.compiled.json` — 用 `V-RCLZ-1` 场景的 ctor
  值编译出的 `RootClose` 参考产物（11 参数 ctor，形状未变）
- `run.log` — `cli-debugger --run-all` 完整输出，6/6 PASS
- `README.md` — 本文件
- `MANIFEST.sha256` — 文件计数校验（见文件本身）
