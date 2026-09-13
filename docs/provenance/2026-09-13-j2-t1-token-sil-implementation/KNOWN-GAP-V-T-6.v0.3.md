# V-T-6 v0.3 — 根因定位完成(Bettor 2h 派单退路②)：binding=cov 无法对"非本 covenant 输出"做输出内省

**Status**: ROOT CAUSE LOCATED（工具链限制, 非协议层问题）。建议走 Bettor 退路①(接收方证明责任挪到市场合约)。

## 退路②(kaspa-wasm 复现)的可行性结论

**kaspa-wasm 不导出任何脚本执行/验证引擎**——逐条核对 `kaspa.d.ts` 全部导出的 class/function，
`verify*` 只有 `verifyMessage`(签名消息验证，与 tx 脚本无关)；grep `Script|Covenant|VM|Engine|TxScript`
零命中任何执行类。**kaspa-wasm 只能构造/签名/序列化交易，不能拿它跑一遍 covenant 脚本看 pass/fail**——
退路②按原字面"用真实 kaspa-wasm 复现同一场景, 直接判问题在哪层"这条路径**做不到**（没有可以拿来跑的执行器）。

**但 kaspa-wasm 确实导出了一个决定性的东西**：`export function covenantId(genesis_outpoint, auth_outputs): Hash`
——这就是 v0.2 里我手工复刻的那个 consensus 层 `hashing::covenant_id::covenant_id()` 哈希函数的**真实编译产物**。
用它对同一组入参重算，与我 v0.2 的 JS 复刻（`genesis_covid.mjs`）逐字节比对：

```
REAL kaspa-wasm covenantId(): ffbbd1cacc2595f78b48eaea6d461107f4060811eb6f0c286be918075419c24a
MY v0.2 JS 复刻结果         : ffbbd1cacc2595f78b48eaea6d461107f4060811eb6f0c286be918075419c24a
```

**完全一致**——v0.2 的哈希复刻是对的，不是我算错了；也确认 debugger 链接的 kaspa-txscript/consensus-core 与真实生产
kaspa-wasm 的哈希语义一致（协议层没有分裂成两套实现）。

## 根因定位：4 个递进隔离探针

用比 KanetTestToken.sil 简单得多的最小合约，逐步剥离变量，钉死到底是哪一层坏：

| 探针 | 内容 | 结果 |
|---|---|---|
| `ProbeOutCovId.sil`（v0.2 已有） | 纯 `entry`（非 `binding=cov`）+ `OpOutputCovenantId` + continuation-case | **PASS** |
| `ProbeBoutCombo.sil` / `ProbeBoutLoop.sil`（v0.2 已有） | 纯 `entry` + `OpOutputCovenantId` + `validateOutputStateWithTemplate` 组合（含数组下标形） | **PASS** |
| `ProbeBoutCov.sil`（v0.3 新增） | 改用 `#[covenant(binding=cov,...)]`，其余与 KanetTestToken.sil 的 transferPolicy 同构（含 for 循环、prev_states/next_states 真用） | **FAIL**（与 V-T-6 一模一样的报错） |
| `ProbeBoutCov2.sil`（v0.3） | 同上但去掉 for 循环，直接下标 0（排除"循环构造导致"这个假设） | **仍 FAIL** |
| `ProbeBoutCov3.sil`（v0.3） | 只留 `require(OpOutputCovenantId(out_k) == next_states[0].owner)`，**去掉** `validateOutputStateWithTemplate` | **仍 FAIL** |
| `ProbeBoutCov4.sil`（v0.3） | 反过来，只留 `validateOutputStateWithTemplate(...)`，**去掉** `OpOutputCovenantId` | **仍 FAIL** |

**结论**：`OpOutputCovenantId` 和 `validateOutputStateWithTemplate` **各自单独**在 `binding=cov` 函数里对一个
**不属于本 covenant 的输出**（即 b-out：新建/指向另一个 covenant 的输出）做内省，**都会失败**——这两个原语单独测
（`entry` 形态）都是好的，问题只在套进 `#[covenant(binding=cov,...)]` 之后才出现。**范围已经比 v0.2 报告的更宽**：
不是"这两个原语组合时才坏"，是"`binding=cov` 框架本身无法正确对非本 covenant 输出做任何输出内省"。

## 判断：silverc/debugger 的 binding=cov 处理层，不是协议层

- 协议层语义已在 v0.2 用 7b1e18cc 源码逐行核对 + 本次用 kaspa-wasm 真实哈希函数交叉验证，**确认正确、确认与
  debugger 一致**——没有"debugger 语义跟共识不一样"这回事。
- `binding=cov` 是 silverc 的**编译期框架特性**（自动从 tx.inputs/tx.outputs 里按"跟 active covenant 同 id"
  筛出 prev_states/next_states，并维护 `cov_in_count`/`cov_out_count`/`OpCovOutputIdx` 等内部记账，探针错误
  dump 里能看到 `__cov_out_count = 0`）——**合理怀疑**：这套框架把"任何输出索引"隐式当成了"covenant 自己输出集
  合里的相对位置"去处理，而不是"tx.outputs 的绝对下标"，当目标输出根本不属于本 covenant（`cov_out_count=0`）时
  这个隐式假设失效，产生错误行为。**没有在剩余时间内继续下钻到具体的 codegen 代码行**（需要读
  `silverscript-lang/src/compiler/compile/covenant*.rs` 一类文件里 `binding=cov` 的 lowering 逻辑，超出本次
  2 小时的剩余预算），但四个探针的结果组合已经把"是不是这一层"钉死为**是**。

## 建议：走退路①（H5 原则，接收方证明责任挪到市场合约）

鉴于 `binding=cov` 框架结构性地不支持"对非本 covenant 输出做内省"，T1 token 合约自己的 `transferPolicy`
（`binding=cov`）**不应该**尝试直接验证 b-out 目标（外部领取 covenant）的输出内容——这与 P12 探针的既有设计
（`P12MarketA2.sil` 的 `payout_claim` 是**手写 `entry`，不是 `binding=cov`**，且它从不调用 `OpOutputCovenantId`，
只用 `validateOutputStateWithTemplate`）已经隐含走的是这条路：**证明责任放在接收方/market 合约的手写 entry 里，
不放在代币合约自己的 covenant-binding transferPolicy 里**。这与 Bettor 提的"退路①"完全一致方向。

具体到 T1/T2/T3 路由设计：代币合约的 `transferPolicy` 对 b-out 分支应该**只做能在 `binding=cov` 里安全做的事**
（比如 sum_in==sum_out 记账、owner_scheme/borrow_scheme 等状态字段校验），**不在这里跑
`validateOutputStateWithTemplate`/`OpOutputCovenantId`**；真正"这笔代币确实落进了正确的领取 covenant"这件事，
挪到**领取合约自己的 genesis 分支**（手写 `entry`，非 `binding=cov`）去做——即 P12 已经验证过的形状：
`ClaimState { market_cov_id: OpInputCovenantId(this.activeInputIndex), ... }`，让领取合约自己在创世时
**读取正在花费它的那个代币输入的 covenant_id**（而不是让代币合约去看一个它管不到的外部输出）。这需要 T1/T2/T3
的路由责任重新划分（一份路由变更稿），不是本次 2 小时能收口的范围。

## 本次产物
- `genesis_covid.mjs`（v0.2）+ 本次的 kaspa-wasm 交叉验证脚本（`kasia-relay/scratch_probe/probe_covid.mjs`，
  未入库——是 scratch 一次性验证脚本，按临时脚本铁律不进 git；结果已摘录进本文档）。
- 4 个新探针文件 `ProbeBoutCov.sil`/`ProbeBoutCov2.sil`/`ProbeBoutCov3.sil`/`ProbeBoutCov4.sil` + 各自
  `.compiled.json`/`.args.json`/`.test.json`，全部保留供下一步（若决定继续在 silverc 源码里修 `binding=cov`
  的 codegen）直接复用复现。
