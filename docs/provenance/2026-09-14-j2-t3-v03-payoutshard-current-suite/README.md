# PayoutShard.sil — 完整现行向量套件（ledger 1209）

## 背景

Bettor（1209）指出：`e0ae924a`/`adc37c0a`（sole-source MUST-FIX）落码时，我如实报告了
`absorb-ab11-and-batest`/`drawdown-mustfix`/`payoutshardv2-zkhandoff-tokenization` 三份历史向量集因
ctor 演进（claim-family 代币化 `0d8a61ee` 把 ctor 从 23→25 参数）"不适用重跑"——但这意味着 **`absorb`/
`close_attest`/`cancel_attest` 在当前 ctor 下没有现行通过的向量**，"全部向量通过"这个合入前提并不成立。
本目录补齐这个缺口：按**当前** 25 参数 ctor，重新生成一份覆盖 `absorb`（含 sole-source 6 条、1122 边界
3 条、V-outbind、witness 错）/`close_attest`/`cancel_attest`/`claim`/`refund_claim`（含 draw-down 恰好为
0）的**完整现行向量套件**。

## 套件构成（43 条，全部在当前 25 参数 ctor 下真实编译+运行验证）

| 分组 | 条数 | 来源 |
|---|---|---|
| `absorb` 既有 10 条（V-absorb-3 停用，见下） | 10 | 移植自 `payoutshard-absorb-ab11-and-batest`（ctor 23→25，逻辑不变） |
| `absorb` 新增 1122 边界 3 条 | 3 | **全新**——`scanOwnedTokenInputs`/`countStrayNonOwnedTokenInputs` 侧此前从未单独证过边界，只在 `noTokenInput` 侧补过 |
| `absorb` sole-source 6 条 | 6 | 移植自 `payoutshard-absorb-sole-source-fix`（ctor 已是当前 25 参数，逐字复用） |
| `close_attest`/`cancel_attest` 各 6 条 | 12 | 移植自 `payoutshard-absorb-ab11-and-batest`（ctor 23→25，逻辑不变） |
| `claim`/`refund_claim` 各 6 条 | 12 | 移植自 `payoutshard-claim-family-tokenization`（ctor 已是当前 25 参数，逐字复用） |
| **合计** | **43** | |

## `V-absorb-3` 停用说明（不是遗漏，是 sole-source MUST-FIX 之后的结构性失效）

历史版本的 `V-absorb-3_pass_stranger_same_template_present_not_counted`（一笔无关陌生人的同模板代币合法
在场、不计入 `owned_total`，期望 `pass`）在 ledger 1208 sole-source MUST-FIX 之后**结构性不再成立**：修复
要求"排除 `shardInIdx` 后不得存在第二个同模板非自持输入"——一笔无关陌生人的代币和"另一个被静默销毁的合法
`ShardLeaf`"在链上**无法区分**（两者看起来完全一样：同模板、非自持、未被 `shardInIdx` 说明），新设计**故意**
把两者同等对待、一律拒绝（这是安全默认收紧，不是回归）。这个场景现在的**正确**行为（拒绝）已经是
sole-source 套件里的 `V-SSF-4_fail_unrelated_stray_same_template_input_unaccounted`，不重造一份重复的
"停用后新造一条 fail 版本"——`V-SSF-4` 本来就是同一个场景的正确版本。

## 编译验证

空 ctor → `expected 25, got 0`。真实 25 参数 ctor 完整编译 0 error。

## 向量构造问题记录（本次装配时发现并修正，如实记录）

新增的 1122 边界三条向量（`V-absorb-12/13/14`）第一次构造时有两处疏漏，均已定位修正并用 flip-expect
复核：
- `V-absorb-12`（恰好=界，期望 pass）最初漏放 `PS` 自己既有持仓的代币输入，导致 `owned_total=0≠
  consolidated_pool=100`，在错误的位置（也是错误的方向——`expect:pass` 却真的 fail 了）报告失败——已补上
  `psOwn100` 作为合法基线。
- `V-absorb-14`（victim 藏在下标 7）最初用的"victim"代币被写成 `owner=PS_COV`（自持），导致它被
  `scanOwnedTokenInputs` 计入 `owned_total`（而不是被 `countStrayNonOwnedTokenInputs` 当作 stray 抓到），
  在错误的检查行（177 而非 187）巧合失败——已改成 `owner=STRANGER_COV`（真正的"非自持"），flip-expect
  复核确认现在精确失败在 `countStrayNonOwnedTokenInputs(...)==0` 那一行（`:187`）。

## 运行结果（`run.log`，43/43 PASS）+ flip-expect 抽样复核

全部 43 条 PASS。新增的三条 1122 边界向量、以及 `V-absorb-2`（既有 smuggled 向量，用于确认它仍然精确失败
在 `owned_total==consolidated_pool` 那行、不是被新加的 sole-source 检查提前或错误地拦截）逐一 flip-expect
复核：

| 向量 | 真实失败行 |
|---|---|
| `V-absorb-13_fail_bound_plus_one_9_inputs_rejected_by_length_guard` | `PayoutShard.sil:106`（`scanOwnedTokenInputs` 内 `require(tx.inputs.length<=MAX_INS_SCAN)`） |
| `V-absorb-14_fail_victim_stray_token_at_last_reachable_index_7` | `PayoutShard.sil:187`（`countStrayNonOwnedTokenInputs(...)==0`） |
| `V-absorb-2_fail_smuggled_second_owned_token_uncounted` | `PayoutShard.sil:177`（`owned_total==consolidated_pool`，既有检查，未被新代码抢先/错误拦截） |

另抽样复核三条移植向量（确认移植后仍精确失败在原意图的行，ctor 变更没有引入偏移）：`V-close_attest-5`
（`noTokenInput` 调用点）、`V-PSCF-CLM-3`（`validateOutputStateWithTemplate`）、`V-absorb-4`
（`validateOutputStateWithInputTemplate`）——三条均命中预期行。

## 文件清单

- `PayoutShard.sil` — 当前合约源码快照（与仓库当前状态一致，未改动，仅存档）
- `mk_payoutshard_current_suite.mjs` — 43 条向量生成脚本
- `PayoutShard.current-suite.test.json` — 生成的 43 条测试向量
- `PayoutShard.reference.ctor.json` / `PayoutShard.reference.compiled.json` — 参考编译产物（25 参数 ctor）
- `run.log` — `cli-debugger --run-all` 完整输出，43/43 PASS
- `README.md` — 本文件
- `MANIFEST.sha256` — 文件计数校验
