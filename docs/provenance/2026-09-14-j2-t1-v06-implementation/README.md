# T1 v0.6/v0.7 落码留痕 — KanetTestToken.sil(退路① b-out 分支删除 + 守恒放宽 + ZERO32 铸币守卫)

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

## T1 v0.7 — NWT 1158 系统性扫查 MUST-FIX: 铸币侧 ZERO32 owner 守卫

**发现**：NWT 复核 `KanetTokenClaim.sil` ③(ii) 时确认 `OpInputCovenantId`/`OpOutputCovenantId` 对未声明
`covenant_id` 的输入/输出回退 `ZERO_HASH`（rusty-kaspa `opcodes/mod.rs unwrap_or(ZERO_HASH)`，用最小探针
`docs/provenance/2026-09-14-j2-t2-kanettokenclaim/ZeroHashProbe.sil` 在本调试器模型里直接实证复现）。系统性
扫查（1158）逐处检查所有把 `OpInputCovenantId`/`OpOutputCovenantId` 结果写入状态字段/用于在场比对的地方，
结论：引用 `this.activeInputIndex` 恒安全（T1 花费侧 `transfer_delegator`/`mint_issuer`/`clawback` 三处、
`PayoutShard.absorb` 的 owner 派生皆属此类，不用改）；引用**其它下标**且**没有独立验证**的，才是缺口——
`KanetTokenClaim.sil` 路径(ii) 是唯一命中的旧缺口（另开 commit 修，见同目录 `2026-09-14-j2-t2-kanettokenclaim/`）。

`KanetTestToken.transferPolicy` 的 `next_states` 循环本身**不直接调用** `OpInputCovenantId`/`OpOutputCovenantId`
写状态，但它把 `next_states[j].owner`（铸币方 witness 自由指定的值）喂给 `ownerIsMarketInput(recv_idx[j],
next_states[j].owner)`，而该函数内部正是 `OpInputCovenantId(idx) == want`——**若 `owner` 本身允许是 ZERO32，
攻击者只需让 `recv_idx[j]` 指向本 tx 里任意一个"裸"（未声明 `covenant_id`）输入，`OpInputCovenantId` 对它的
回退值恰好也是 ZERO32，两边就会凭空相等**，而"裸输入"根本不代表任何真实的市场覆盖——等于铸出一枚
`owner=全零`的代币，且这枚代币此后可以被任何愿意在自己的花费交易里塞一个不声明 covenant 的输入的人，通过同一
个 `ownerIsMarketInput`（花费侧 `transferPolicy` 自身的下一次调用）伪造"在场"而随意花掉。这是花费侧
（genesis 铸币）的入口漏洞，比留到领取/市场侧才被动接手更早、更根治。

**修**（`kasia-console/src/lib/sil-v1/KanetTestToken.sil` 第 90-100 行）：紧跟 `amount>0`/`owner_scheme`/
`borrow_scheme`/`borrow_guard`/`extension_commitment` 那几条结构性检查之后，加
`require(next_states[j].owner != byte[32](0x00...00));`。

**负向量 `V-T-12_fail_next_state_owner_zero32_rejected`**：复用 `V-T-1` 已验证过的 `prev_states`（两枚
60+40、owner=市场 covenant 的合法输入消费，`owner_input_idx=[2,2]` 指向同一个真实市场在场输入）——刻意
让第一段循环与 `V-T-1` 逐字节相同，只在第二段（`next_states`）替换攻击内容：`next_states=[{amount:100,
owner:ZERO32,...}]`，`recv_idx=[3]` 指向一个新增的第 4 个"裸"输入（无 `covenant_id`，但 `sigScript` 尾部仍
正确匹配 `market_tmpl_suffix`，模拟"外观像市场存在证明、实际没有真实覆盖背书"的攻击输入）。`-r` 确认
`expect: fail` 命中。**交互步进侧写对照**（非逐行钉死，见下"局限"）：用完全相同的步数（18 次 `n`）对
`V-T-1`（PASS）与 `V-T-12`（FAIL）分别步进，两者在第一段循环内的轨迹逐行相同（`78→79→80→81→82→78→79→80→
81→82→78`），说明两条向量在第一段循环里的行为没有差异；`V-T-1` 在此之后干净结束（wrap 到下一条用例的
源码头部，代表当前用例已正常完成），`V-T-12` 在此之后立即报 `error: script ran, but verification failed`——
分歧点被夹逼定位在"第一段循环结束之后"，即第二段循环（新守卫所在处），而不是第一段循环或其它无关检查。

**局限（如实记录，供 NWT 复核）**：本次未能像 `KanetTokenClaim.sil` 的 `V-CLAIM-8` 那样，用交互步进精确让
caret 落在新加的 `require` 那一行本身——`cli-debugger` 的 `n`(step-over) 对本文件里"数组长度短于 `max_ins`
的展开 `for` 循环跳过分支"这一类结构，步进显示存在已知的不透明区（同一 for 循环头 `78` 反复重绘、内部具体
跳到第几行不总是逐条可见），继续深挖需要排查是显示层问题还是这类"跳过分支"本身在展开循环里的既有已知限制，
不在本次 MUST-FIX 修复范围内（按铁律，未经 Bettor/NWT 同意不因排查方便去动 silverc 本身或臆测其内部机制）。
上面的"逐点对照+夹逼"是在这个已知工具限制下能拿到的最强证据；`-r` 权威判定 + 独立的最小 `ZeroHashProbe.sil`
（证明守卫条件本身的运算语义正确）合起来构成完整闭环。

**回归确认**：既有 14 条向量（13 PASS + 1 按设计 FAIL）全部重跑，结果逐条不变；新增 `V-T-12` 后共 15 条，
`14 passed, 1 failed`（同一条既有的谐波翻转臂），`run.log` 已更新。

## 踩坑记录(供后续参考, 避免重复排查)

`cli-debugger.exe --test-file` 的 `args` 数组语义: 对 `binding=cov` 的 `function transferPolicy(State[]
prev_states, State[] next_states, ...)`, **`prev_states` 从 `tx.inputs[].state` 自动派生, 不在 `args` 里；
`next_states` 相反 —— 必须显式作为 `args[0]` 给出**(不是从 `tx.outputs[].state` 自动派生, 那个字段只用于
codegen 内部的输出绑定检查, 不是测试参数本身)。首次构造 V-T-7b 时错误沿用了源 V-T-1 的 `args[0]`(next_states
声明 amount=100)但只改了 `tx.outputs[0].state.amount`(改成 60), 导致 `next_states[0].owner` 与预期不一致、
`ownerIsMarketInput` 内的隐式检查因不匹配而报"script ran but verification failed"且 inlining 把出错位置压缩到
`1:1`(与 V-T-6 根因症状表面相似但机制无关, 纯粹是测试构造错误)。用最小复刻探针
`scratch/_t1v06_check/MinBurnProbe.sil`(未入库, 一次性诊断)隔离并钉死该行为后修正。
