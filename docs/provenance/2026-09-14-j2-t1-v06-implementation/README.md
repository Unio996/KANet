# T1 v0.6 落码留痕 — KanetTestToken.sil(退路① b-out 分支删除 + 守恒放宽)

对应 `docs/2026-09-13-j2-t1-t2-t3-routing-change-remove-bout-design-v0.2.md` §1/§4, Bettor ledger 1121 GREEN。

- 删 `ClaimState` struct + `claim_tmpl_prefix/suffix/hash` 三个 ctor 参数(不再需要, 花费侧不再构造任何"全新领取
  covenant"的输出状态)。
- (b) 路由只剩 b-in 一条: `recv_idx[j]` 必须 `>= 0` 且指向本 tx 一个已在场的市场模板输入。
- 守恒式 `sum_in == sum_out` → `sum_in >= sum_out`(精确守恒的另一半由市场/领取侧 T3 v0.3 的
  `scanOwnedTokenInputs()`/`noTokenInput()` 兑现, 见 T3 v0.3 落位表)。

## 向量结果: `run.log` — 14 条 13 PASS + 1 按设计 FAIL(谐波翻转臂, 同 v0.5 既有约定, 见
`docs/provenance/2026-09-13-j2-t1-v0.2-market-scan-probe/` 的相同做法)

沿用 v0.5 既有 12 条(V-T-1/2/3a/4/5/9a/9b/10/11a/11b/H2-1/harness-flip), 逐字机械改写 constructor_args(删 3 个
b-out 相关字段)+ args(删 new_claims), 内容不变(不是新证据, 只是形状适配)。**删除**原 V-T-6(pass_bout)/
V-T-7(fail_bout_template_mismatch)/V-T-8(fail_nwt_self_built_trivial_covenant) 三条 — 它们测的正是被删掉的
b-out 分支本身, 已随分支一起失去意义(NWT §1"自建 covenant"攻击面已转移到市场/领取侧, 见 T3 v0.3)。**新增**两条:

- `V-T-6b_fail_bout_route_removed_negative_recv_idx_now_rejected` — `recv_idx=[-1]`(旧 b-out 形)现在必须被
  `require(recv_idx[j] >= 0)` 直接拒绝。PASS。
- `V-T-7b_pass_burn_allowed_sum_in_greater_than_sum_out` — 单笔 100 amount 消费, 只往回给 60(隐含 40 "离场"
  到市场/领取侧, 由市场那边的 `scanOwnedTokenInputs()` 负责核实), 代币侧 `sum_in(100) >= sum_out(60)` 必须放行。
  PASS。

## 踩坑记录(供后续参考, 避免重复排查)

`cli-debugger.exe --test-file` 的 `args` 数组语义: 对 `binding=cov` 的 `function transferPolicy(State[]
prev_states, State[] next_states, ...)`, **`prev_states` 从 `tx.inputs[].state` 自动派生, 不在 `args` 里；
`next_states` 相反 —— 必须显式作为 `args[0]` 给出**(不是从 `tx.outputs[].state` 自动派生, 那个字段只用于
codegen 内部的输出绑定检查, 不是测试参数本身)。首次构造 V-T-7b 时错误沿用了源 V-T-1 的 `args[0]`(next_states
声明 amount=100)但只改了 `tx.outputs[0].state.amount`(改成 60), 导致 `next_states[0].owner` 与预期不一致、
`ownerIsMarketInput` 内的隐式检查因不匹配而报"script ran but verification failed"且 inlining 把出错位置压缩到
`1:1`(与 V-T-6 根因症状表面相似但机制无关, 纯粹是测试构造错误)。用最小复刻探针
`scratch/_t1v06_check/MinBurnProbe.sil`(未入库, 一次性诊断)隔离并钉死该行为后修正。
