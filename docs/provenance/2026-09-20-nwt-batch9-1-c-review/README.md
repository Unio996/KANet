# 批 9-1 C 笔审（`7294aedd`，`proto-settlement-c1.mjs` 391 行 + 测试 465 行）—— NWT

2026-09-20。对象：`origin/coord/j2-batch9-1-code-v0` 的 `7294aedd`（父 B `cef3f6f5`）。对照：设计 v0.3.4（`bdf799a1`）与我的 `680b8bb8`。方法：在我的独立检出 `D:\kanet-nwt-cand`（切到 `7294aedd`）读全文、亲跑、做我自己的变异（`nwt-mutate-c1.cjs`）并对一个疑点做了实测（`nwt-grader-masking-probe.mjs`）。范围：C 只**新增**文件（7 个，含证据目录），**既有代码零改动**；无生产调用方，仍无运行时效果。D-021：无密钥 / 余额 / 地址。

## 结论：**GREEN，附 2 条小 MUST（都是几行 + 一条测试）与 3 条 SHOULD；13 条超出设计文字的取舍逐条判定见 §三，全部接受（其中两条带条件）。**

| 类 | 编号 | 内容 |
|---|---|---|
| **MUST（小）** | **C-1** | **`scriptPublicKey.version` 没有核**（J2 取舍 10）。`verifyStepInputsOnChain` 组装 `chainUtxos` 时只取 `scriptPublicKey.scriptHex`，`version` 被丢弃（`readItem` 校验了范围，但 M6 与 `chainParents` 都不用它）。J2 自述"认为不可达但没有证据"——**不能拿"没有证据"当理由跳过一个身份字段**：spk 的身份是 (version, script)，我们的 builder 只造 version 0。修法一行：每个角色条目与每个 fee 候选断言 `scriptPublicKey.version === 0`，否则按 `<role>_spk_drift`（fee 候选按毒化跳过）；加一条测试（同脚本 version=1 的条目 ⇒ 拒）。 |
| **MUST（小）** | **C-2** | **`createTransportAlertGrader` 是全局单计数，会被同 tick 里别的步骤的成功清零，从而永远不升级**——我实测（`nwt-grader-masking-probe.mjs`）：步骤 A 每个 tick 都瞬时失败、步骤 B 每个 tick 成功，6 个 tick 全程 `level=warn consecutiveTicks=1`，**永不升 error**。J2 的说明"每个驱动一个实例"意味着驱动里所有市场 / 步骤共用一个计数——多市场并行时一个持续失败的步骤会被其它成功步骤永久掩盖在 warn。修法：`onFailure(err, tickId, key)` / `onSuccess(key)` 按 key（建议 = 意图 key `settle:<subject>:<id>:<step>`）分别计数，`key` 必填；测试加"A 持续失败 + B 每 tick 成功 ⇒ A 在第 3 个 tick 升 error"。 |
| SHOULD | C-3 | 预算 / IPC 超时约束靠"9-2b 必须调 `assertStepBudget` / `assertFactsIpcTimeout`"——把它变成**结构性**：`verifyStepInputsOnChain` 要求一个只能由工厂造出的**已校验配置对象**（工厂内部调这两个断言，返回值登记进模块私有 `WeakSet`，`verify` 收到未登记的对象就拒）。注意别用 `Object.isFrozen` 当凭证（它是状态不是出处——团队既往教训）。 |
| SHOULD | C-4 | fee 候选**消费方复核区间**：relay 已按 `[minAmount, maxAmount]` 过滤，但消费方不该"信服务端过滤"——`filterFeeCandidates` 里对 `value` 加 `feeMinAmount ≤ value ≤ SIGNED_INPUT_CEILING` 复核，越界者按"可疑"跳过并计入事件（防一个行为异常的 relay 把超过签名输入上限的候选交给 builder）。 |
| SHOULD | C-5 | `evidence` 对象（found/missing/listed/truncated 计数）没有任何测试守着（我的变异 c19 存活）；它进 provenance，请加一条断言。 |

## 一、我亲跑与变异
- 亲跑 `proto-settlement-c1.test.mjs` **32/0**（与 J2 一致）。
- 我另做 **19 个变异**（毒化过滤删任一条件、在途 key 不小写、saturated 判据去掉任一半、分级器同 tick 重复计数 / onSuccess 不清零 / 阈值差一、预算下界与相等边界、重复 outpoint 容忍、瞬时码归类改动、fee 的 `hasCovenant` 写死、`readItem` 的 version / amount 范围、`requested` 上限）：**17 被抓，2 存活，均无害**：c11（`assertFactsIpcTimeout` 的 `<=` 边界）是**等价变异**——前一个条件 `timeoutMs < 15000` 已经先拒掉 ≤13000 的取值，后一个条件冗余；c19 见 C-5。（另 c20 的补丁模式没匹配上，未运行。）
- J2 的 50 个变异 + 我的 19 个，合起来对该模块的判定分支覆盖是够的；"全被抓只覆盖选定的变异"这句自陈我认同。

## 二、Bettor 六点
1. **第 11 个错误码 `facts_step_budget_exceeded`**：**接受**。C4 要求"超预算 ⇒ 放弃本 tick"，需要一个码；归入瞬时类（首次 warn、连续 3 个不同 tick 升 error）合理。
2. **`verifyStepInputsOnChain` 缺 fee 时自抛 `FeeWindowError`；saturated / none 判据**：**接受**。先 M6 后 fee 的顺序对（固定输入漂移优先于 fee 错误）；判据"无干净候选且（有毒化被跳过 **或** 窗口被截断）⇒ saturated，否则 none"比设计更细，方向安全（宁可多报 error）；"只有我方在途产出被排除 ⇒ none"合理（不是攻击信号）。一个边缘：relay 真的没钱（无候选、无毒化、未截断）走 `none` = `settlement_no_suitable_fee_utxo`，J2 写"驱动可选择不发"——**relay fee 资金耗尽是需要人知道的运维事件**，建议 9-2b 至少发 warn，不要沉默。
3. **新报警类型 `settlement_c1_programming_error` / `settlement_no_suitable_fee_utxo`**：**接受**；请 9-2b 落码时把所有事件名登记进 `alertSettlementIntent` 的类型表 / 文档，避免"字符串散落"。`chain_check_params_missing` 被指针模块的 DB 脏数据触发时也会归成"programming_error"——语义上是"输入不合法"，可接受。
4. **非瞬时协议违例首次即 error**：**接受**（与我 S91-5 一致：`facts_echo_missing` / `facts_version_mismatch` 是版本错位，不是瞬时）。
5. **`budgetMs` / `feeMinAmount` 必填无默认；`assertStepBudget` 由驱动配置期调用**：必填无默认**接受**；但"9-2b 必须调"不够稳——见 C-3（结构性强制）。J2 记为 9-2b 硬要求我同意，同时要求 C-3。
6. **未核 `scriptPublicKey.version`**：见 **C-1（MUST 小）**。

## 三、13 条取舍逐条判
1 ✓ 接受。2 ✓ 接受（附 §二-2 的运维事件提醒）。3 ✓ 接受。4 ✓ 接受（§二-3）。5 ✓ 接受。6 `Promise.all` 快速失败、哪个错误先到取决于先到者 ✓ 接受（已订阅其余 promise，无 unhandledRejection；诊断上先到者即可）。7 ✓ 接受 + C-3。8 两个角色预期 outpoint 相同 ⇒ `facts_requested_invalid` ✓ 接受（好的编程错误检测，我变异 c12 证实有测试守着）。9 常量镜像 + 测试与 relay 源码逐项断言相等 ✓ 接受（漂移即红，方向对）。10 → **C-1**。11 分级器"非瞬时失败不清零、只 `onSuccess` 清零" ✓ 接受语义，但**必须按 key 分计数（C-2）**，否则整个分级形同虚设。12 391 行超预估 +50% ✓ 接受（多出的是错误类型、闭集、镜像常量与注释，我读过没有冗余逻辑）。13 fee 候选形状与 `toFeeUtxoCandidates` 一致并多两个字段 ✓ 接受。

## 四、其余读码结论（无问题）
- `assertFactsResponse` 8 项判定顺序与失败码与 §19.1 / 我的 680b8bb8 一致；`requested` 编程错误先于一切；`ask()` 里 `.catch` 只包 `requestFacts` 的 reject，`assertFactsResponse` 抛的 `FactsResponseError` 不被误映射成 `facts_transport_error`（顺序对）。
- 并发 + 总预算：`Promise.race([Promise.all(tasks), deadline])`，`finally` 清定时器；某请求先失败时其余已被 `Promise.all` 订阅，不会 unhandledRejection；超预算后晚到结果丢弃。
- M6 断言在 fee 之前；`chainParents` 全部来自经断言的链上事实（值 / spkLen / hasCovenant），fee 角色项来自形态 L 条目（不是常量）。
- 形态 O 的请求按地址分组、每地址一次；同一 outpoint 跨角色重复拒绝。

## 没做 / 未证
- 没起 simnet（毒化 fee 向量按计划在 9-1 全部落完后补）；没审 D / E 笔；没在真实节点录制回执上验证（放 9-4，J2 已标）。
