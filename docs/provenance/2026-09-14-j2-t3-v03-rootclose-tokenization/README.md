# RootClose.sil — T3 v0.3/v0.4 §2 全 23 入口 A/B 落位表代币化（ledger 1188，批次④第二步）

## 背景（Bettor 纠正范围）

上一笔提交（`24aea3cc`）只加了 `Op*CovId != ZERO32` 目的地守卫，当时的 README 把 `pool_value` 描述为
"委员盖章后原样传递的记账字段"、把 RootClose 定位成"只是记账桥"，因此没有展开代币语义。**Bettor（1188）
纠正：这个定位不成立**——`docs/2026-09-14-j2-t3-market-set-token-rewrite-design-v0.3.md` §1 封闭集合表
明确把 `RootClose.sil` 列为**持币合约**（`ShardLeaf_direct.convert_to_rootclose` 把代币转进来），§2 全
23 入口 A/B 落位表把 RootClose 4 个入口精确落位：

| 入口 | 类 | RHS / noTokenInput | 输出侧派生绑定 |
|---|---|---|---|
| `close_commit` | B | `noTokenInput` | — |
| `refund_flip` | B | `noTokenInput` | — |
| `convert_to_claim` | A | `pool_value`（全池整体转出） | `tok_out` owner = `OpOutputCovenantId(claimOutIdx)`（本笔新建 RootClaim） |
| `convert_to_refundclaim` | A | `pool_value` | `tok_out` owner = `OpOutputCovenantId(rcOutIdx)`（本笔新建 RefundClaim） |

本次落码这四行，同 `PayoutShard.sil`/`PayoutShardV2.sil` 已验证的 `scanOwnedTokenInputs`/`noTokenInput`
两个 helper 形状，不重新发明。

## 改了什么

**ctor +1（11→12）**：新增 `byte[32] token_tmpl_hash`（Bettor 1151 裁：市场只嵌一个 32 字节 hash，不烤代币
模板字节本身；插在 `refundclaim_tmpl_hash` 之后，其余原有 11 个字段位置/顺序不变）。

**新增两个 helper 函数**（与 `PayoutShard.sil` 逐字节一致手法）：
- `scanOwnedTokenInputs(tok_prefix, tok_suffix) : int` — witness 供代币模板前后缀，现场 `blake3` 核对
  `token_tmpl_hash`，核过后用验过的 `tok_suffix` 做 P7 尾匹配预筛，命中的再 `readInputStateWithTemplate`
  读出真实 state，`owner == OpInputCovenantId(this.activeInputIndex)`（本合约自身）的全部累加，遍历深度受
  `MAX_INS_SCAN=8` 约束。
- `noTokenInput(tok_prefix, tok_suffix) : bool` — 同上核对模板字节，不分 owner 找有没有任何代币模板输入
  在场（比 owner-aware 更严）。

**B 类两入口**（`close_commit`/`refund_flip`）：签名各加 `byte[] tok_prefix, byte[] tok_suffix` witness 参数，
入口体首行加 `require(noTokenInput(tok_prefix, tok_suffix))`；原 R3 `require(tx.outputs[rootOutIdx].value ==
pool_value)` 改 `require(tx.outputs[rootOutIdx].value >= DUST_MIN)`（D-018/§6②：`pool_value` 现在是代币
amount 语义，不是 KAS sompi，B 类不动代币，KAS 侧只剩 dust）。

**A 类两入口**（`convert_to_claim`/`convert_to_refundclaim`）：签名各加 `int tokenInIdx, int tokenOutIdx,
byte[] tok_prefix, byte[] tok_suffix`；入口体开头加 `require(scanOwnedTokenInputs(tok_prefix, tok_suffix) ==
pool_value)`（输入侧：本合约当前持有的代币必须恰好等于全池 `pool_value`，无续约、全额转出）；原
`require(tx.outputs[...].value == pool_value)` 同样改 `>= DUST_MIN`；新增
`validateOutputStateWithInputTemplate(tokenOutIdx, TokenState{amount: pool_value, owner: claimCovId/rcCovId,
...}, tokenInIdx, ...)`——代币全额转给新建 `RootClaim`/`RefundClaim` 实例，`owner` 用上一步（第一次提交）
已核过非 `ZERO32` 的 `claimCovId`/`rcCovId`（派生表达式，不是裸 witness，v0.3 §4 双边对账纪律）。

**未触发 V-T-8**：两个 A 类入口都是"无续约"（本 entry 是 RootClose 生命周期终点，不调用
`validateOutputState` 续本合约自身）——同 `PayoutShardV2.zk_handoff` 同形，`readInputStateWithTemplate`（经
`scanOwnedTokenInputs`）与 `validateOutputState`（self-continuation）从未在同一函数内共存，不需要 AB11
绕路。B 类两入口虽然确实 self-continue（`validateOutputState(rootOutIdx, ...)`），但 `noTokenInput()` 内部
从不调用 `readInputStateWithTemplate`（只做 P7 尾字节切片比较，不读取代币 state），所以这个组合同样不触发
V-T-8——同 `PayoutShard.close_attest`/`cancel_attest` 已验证的结论一致。

## 编译验证

空 ctor → `expected 12, got 0`（确认新 ctor 形状）；真实 12 参数 ctor 完整编译 0 error（触达 entry body 类型
检查，不是只到 arg-count-mismatch 就停）。见 `RootClose.reference.ctor.json`/`RootClose.reference.compiled.json`。

**如实记录一个尚未解决的架构关切**：编译产物 `bytecode_length = 16802` 字节，`state_span = {offset:1,
len:87}`——远超本文件头部注释记录的"seal 目标 ~825B FITS"设计预算（那条预算约束的是 `FoldNode.seal_to_root`
用 `validateOutputStateWithTemplate` 揭示的模板前后缀总长，不是完整合约字节码，两者不是同一个量，但差距
如此之大值得点名）。原因：`scanOwnedTokenInputs`/`noTokenInput` 两个 helper 是 silverc 内联而非共享子程序
（同 `PayoutShard.sil` 已记录的观察——四个调用点各展开一份完整 blake3+P7+循环逻辑）。**本次未评估这个尺寸
增长是否击穿 FoldNode 侧的 double-blake2b 模板暴露预算**——这需要用 FoldNode.sil 的真实 `seal_to_root` 编译
链路重新量测 `prefix`/`suffix` 长度是否仍在其自身预算内，不是这次 RootClose 单文件编译能回答的问题，留给
Bettor/NWT 判断是否需要专门量测（如需要，可比照 `measure_*_state_span.mjs` 的既有量测手法另起一次）。

## 授权链表：代币输出绑定扩展（Bettor 1188 要求）

延续第一次提交（`24aea3cc`）README 的 5 步链条，新增第 6 步——代币侧的绑定如何建立：

| # | 环节 | 谁产生 / 谁核验 | 建立方式 |
|---|---|---|---|
| 1-5 | （同 `24aea3cc` README：covenant id 声明 → 创世/continuation 判定 → `OpOutputCovenantId` 读回 → 非零守卫 → 模板字节核验，两条独立承重） | — | 见上一份 README，本次未变 |
| 6 | **代币 owner 绑定**：新建 `RootClaim`/`RefundClaim` 实例的代币份额如何确权 | `validateOutputStateWithInputTemplate(tokenOutIdx, TokenState{owner: claimCovId/rcCovId, ...}, tokenInIdx, ...)` | `claimCovId`/`rcCovId` 不是 witness 任填的值，而是第 4 步已核过非 `ZERO32` 的 `OpOutputCovenantId(claimOutIdx/rcOutIdx)` 现场读数（派生表达式，v0.3 §4 纪律）——代币的新 owner **恒等于**同一笔交易里已经过独立结构校验（模板字节匹配 + covenant 非零）的那个新实例的真实 covenant id,不可能是另一个未经校验的旁路值 |
| 7 | **代币来源确权**（输入侧） | `scanOwnedTokenInputs(tok_prefix, tok_suffix) == pool_value` | 只累加 `owner == OpInputCovenantId(this.activeInputIndex)`（RootClose 自身当前 covenant id）的代币输入；任何不属于 RootClose 自己的同模板代币（陌生人持有、金额不同）合法在场但因 owner 不匹配天然被过滤，不误算入 `pool_value` |
| 8 | **闭环** | — | 第 6+7 步合起来：本合约确实拿得出 `pool_value` 份额的代币（第7步）、且这份代币确实全额转去了一个刚刚被独立验证过"是真实新建的 RootClaim/RefundClaim 实例"的目的地（第6步链接第1-5步）——链条上没有一环是裸 witness 值,每一环要么是协议原生读数,要么是同笔交易里已核验过的另一个值 |

**已知未覆盖点（延续第一份 README 的记法）**：同上一份 README 记录的一样，本表证明"协议层" +
"合约层"能各自证明的那部分，不试图证明"新声明的 covenant id 恰好等于协议按 `previous_outpoint` 算出的
创世 id"——那部分由 Kaspa 共识层强制,不是 `.sil` 合约逻辑的职责范围。

## §2 表"covenant 绑定"列打勾

`RootClose.convert_to_claim`/`convert_to_refundclaim` 的 `claimCovId`/`rcCovId != ZERO32`：✅（第一次提交
`24aea3cc` 已加，本次沿用不变，token 输出的 owner 派生绑定见上表第 6 行）。`close_commit`/`refund_flip` 的
`noTokenInput`：✅（本次新增）。

## 无 1122 边界向量的原判断已更新

第一次提交的 README 曾以"RootClose 4 个 entry 都不含扫描循环"为由说明无需 1122 边界向量——**该判断在本次
代币化后不再成立**：`noTokenInput`/`scanOwnedTokenInputs` 本身就是 `MAX_INS_SCAN` 约束的扫描循环，四个入口
现在全部间接持有一条扫描路径。本次已补齐全部 6 条 1122 边界向量（`close_commit`/`refund_flip` 各 3 条：
恰好=界 / 界+1 / victim 在末位可达下标），见下方向量表。

## 向量（`run.log`，24/24 PASS，全部 flip-expect 复核真实失败行）

### B 类：`close_commit` / `refund_flip`（各 6 条）

| 向量 | 验证点 | 真实失败行（flip-expect 复核） |
|---|---|---|
| `V-close_commit-1_fail_no_token_reaches_deadline_gate` | 无代币输入 → `noTokenInput()` 放行 → 落到 `deadline_ms` 时间闸才拒（不是被 `noTokenInput` 误挡） | `RootClose.sil:141`（`tx.time >= temporal(deadline_ms)`，非 `noTokenInput` 调用点） |
| `V-close_commit-2_fail_token_input_present_rejected_by_noTokenInput` | 代币模板输入在场 → 在时间闸**之前**被 `noTokenInput()` 结构性拒绝 | `RootClose.sil:140`（`noTokenInput` 调用点） |
| `V-close_commit-3_fail_at_bound_8_inputs_no_token_reaches_deadline_gate` | 恰好=界(8 输入，无代币) | `RootClose.sil:141`（时间闸，证明界处仍是"干净放行"） |
| `V-close_commit-4_fail_bound_plus_one_9_inputs_rejected_by_length_guard` | 界+1(9 输入，无代币) | `RootClose.sil:117`（`noTokenInput` 内部 `require(tx.inputs.length<=MAX_INS_SCAN)`） |
| `V-close_commit-5_fail_victim_token_at_last_reachable_index_7` | victim 代币在下标 7(8 输入内最后可达位置) | `RootClose.sil:140`（`noTokenInput` 调用点，证明循环真展开到那里） |
| `V-close_commit-6_fail_witness_wrong_tok_prefix_blake3_mismatch` | witness 供错 `tok_prefix` | `RootClose.sil:116`（`noTokenInput` 内 `blake3` 现场核那行） |
| `V-refund_flip-1..6` | 镜像 `close_commit` 六条（无签名门限，下一闸是 `deadline_ms+7200000`） | `166`(deadline)/`165`(noTokenInput,token present)/`166`(bound,deadline)/`117`(length guard)/`165`(victim,noTokenInput)/`116`(witness) |

### A 类：`convert_to_claim` / `convert_to_refundclaim`（各 6 条）

| 向量 | 验证点 | 真实失败行（flip-expect 复核） |
|---|---|---|
| `V-convert_to_claim-1_pass_real_bridge_full_pool_token_out` | pass：真实 `RootClaim` 桥接 + 全池代币转出 | — |
| `V-convert_to_claim-2_fail_bare_output_no_covenant_id_zero32` | fail：脚本字节匹配真实 `RootClaim`，输出无 `covenant_id` | `RootClose.sil:199`（ZERO32 守卫，非模板校验行） |
| `V-convert_to_claim-3_fail_fake_template_shell` | fail：目标脚本字节是 `RefundClaim` 的（错的合约） | `RootClose.sil:193`（`validateOutputStateWithTemplate`） |
| `V-convert_to_claim-4_fail_outbind_token_diverted_to_stranger` | fail：代币输出 owner 被导向陌生 covenant，而非新建 RootClaim 的 covenant | `RootClose.sil:203`（`validateOutputStateWithInputTemplate`） |
| `V-convert_to_claim-5_fail_witness_wrong_tok_prefix` | fail：代币模板 witness 供错 | `RootClose.sil:95`（`scanOwnedTokenInputs` 内 `blake3` 现场核） |
| `V-convert_to_claim-6_fail_smuggled_second_owned_token_uncounted` | fail：额外一笔归己代币未被账本反映（1123-b3/V-absorb-2 同族"第二笔归己代币"负向量） | `RootClose.sil:190`（`scanOwnedTokenInputs() == pool_value`） |
| `V-convert_to_refundclaim-1..6` | 镜像 `convert_to_claim` 六条 | `—`/`231`(ZERO32)/`226`(模板)/`234`(outbind)/`95`(witness)/`224`(scan==pool_value) |

## 文件清单

- `RootClose.sil` — 本次修改后的完整合约源码（ctor 11→12，新增两 helper，四入口全部落码）
- `mk_rootclose_tokenization_vectors.mjs` — 24 条向量生成脚本
- `RootClose.tokenization.test.json` — 生成的 24 条测试向量
- `RootClose.reference.ctor.json` / `RootClose.reference.compiled.json` — 用 `V-convert_to_claim-1` 场景的
  ctor 值编译出的参考产物（12 参数 ctor）
- `run.log` — `cli-debugger --run-all` 完整输出，24/24 PASS
- `README.md` — 本文件
- `MANIFEST.sha256` — 文件计数校验
