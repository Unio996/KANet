> **Status**: CURRENT

# KTT 双血统合并的 binding=cov 基数检查(账本1433)——形状Y可行, 形状X真实失败

## 背景

Bettor 1433 指出 register_append 要花的两个 KTT 输入(held 持仓 + stake 新铸)是**两条不同的
covenant 血统**(不同 genesis ⇒ 不同 covenant_id)。`binding=cov` 按 covenant_id 分组各自独立执行
`transferPolicy`(各自 `require(sum_in >= sum_out)`)。如果合并输出(`held+stake`)用
`CovenantBinding` 绑到其中一条血统(形状X)，该血统组 `sum_out=held+stake > sum_in=held`，KTT 脚本
自己会拒绝。候选形状Y：合并输出不续约任何一条血统，做成全新 genesis 输出；两条血统各自 0 个
continuation 输出(next_states=[])。风险点：`binding=cov` 的 N:M 基数检查在某组 0 个输出时是否
通过——这条在 2026-09-14/15 已有的 14 条 ShardLeaf_direct 向量里从未测过(active input 全是 leaf,
两个 KTT 输入自己的脚本从未真的被执行)。

## 方法

用真实 `KanetTestToken.sil`(D-019 pin v1.0.0 编译)构造一笔 2 输入 1 输出的交易, 两个输入分别标注
不同 `covenant_id`(`0x11...`=held 血统, `0x22...`=stake 血统, 模拟"两条不同 genesis"), 真实 3 次
cli-debugger 执行(active_input_index 分别设为 held / stake, 各自独立验证):

- **shapeY-held**：`transfer(next_states=[], witness=[], owner_input_idx=[0])`, active=held(idx0)。
- **shapeY-stake**：`transfer(next_states=[], witness=[], owner_input_idx=[1])`, active=stake(idx1)。
- **shapeX(负对照)**：`transfer(next_states=[{amount:200,...}], ...)`, active=held(idx0), 输出
  `covenant_id=held的id, authorizing_input=0, state.amount=200` —— 故意构造"该组 sum_out(200) >
  sum_in(100)"的违规, 验证测试方法本身有鉴别力(不是随便传什么都 PASS)。

## 结果(真实执行, 非推断)

| 场景 | 结果 |
|---|---|
| shapeY: held 组声明 0 个续约输出(`next_states=[]`) | ✅ **PASS** |
| shapeY: stake 组声明 0 个续约输出(`next_states=[]`) | ✅ **PASS** |
| shapeX(负对照): 合并输出绑到 held, sum_out(200)>sum_in(100) | ❌ **FAIL**（`require(sum_in >= sum_out)` 精确失败, trace 确认在 `KanetTestToken.sil:109`）|

负对照证明测试方法本身有鉴别力——不是"随便传什么都通过"，`binding=cov` 的守恒检查真的在起作用。
在此前提下，shapeY 两组都 PASS 是有意义的真实结果，不是测试没测到东西。

## 结论

**候选形状Y在 KTT 合约层面可行**：`binding=cov`(`from=max_ins, to=max_outs`, N:M transition 模式)
的基数检查允许某个 covenant 组在这笔交易里声明 **0 个** continuation 输出——这与
`docs/DECL.md` 关于 N:M transition 的描述一致（`out_count == new_states.length` 是**相等**判据，
不是"至少 1 个"；`DECL.md:71` 的 `termination` 限定只适用于 `singleton`(`from=1,to=1`)那条独立机制，
不适用于本合约这种 N:M 声明——N:M 本身原生支持 0 输出，不需要额外的 opt-in）。

**这意味着"下注把筹码并进奖池"这一步在当前 KTT 设计下有路可走**：held/stake 两条血统各自作为
covenant 组声明 0 个续约输出(相当于终结自己)，合并后的池代币做成一笔全新的 genesis 输出（KTT
本身不检查 genesis，任何人可任意金额免费构造）。不需要回到设计层面重新处理。

## 尚未验证(下一步)

本笔只在 **KTT 合约自身** 的层面孤立验证了基数问题（Bettor 1433 点名的最根本风险点）。还没做的：

1. **ShardLeaf_direct 侧的对应改动**：`register_append` 现在的 `validateOutputStateWithInputTemplate
   (tok_out, TokenState{...}, stakeInIdx, ...)` 用的是"从某个输入模板续约"的语义（`WithInputTemplate`
   后缀），如果新池代币改成 genesis 而不是从 `stakeInIdx` 续约，这个校验原语本身可能需要换成
   `validateOutputStateWithTemplate`（不带 `WithInputTemplate`，纯粹按模板+状态核对，不要求"这是某个
   特定输入的续约"）——这是新的、还没读过源码确认的技术点，不是本轮范围。
2. **三执行完整 tx 验证**(Bettor 原方案要求的①leaf②heldKTT③stakeKTT 同一笔交易): 本笔只做了②③
   (KTT 自身两条血统), 没有把 leaf 摆进同一笔交易一起测——leaf 的 `scanOwnedTokenInputs`/AB11
   续约逻辑要在"新设计"（池代币是 genesis 不是续约）下重新过一遍, 需要新的 test 向量, 尚未做。

## 文件清单

- `KanetTestToken.sil`（D-019 pin 真实编译源, 从 `kasia-console/src/lib/sil-v1/` 复制冻结）
- `ktt_zero_out_shapeY.test.json`（shapeY 两条向量）
- `ktt_shapeX_merge_fail.test.json`（shapeX 负对照向量）
- `run.log`（三次真实 cli-debugger 执行的完整输出）
- `README.md`（本文件）
