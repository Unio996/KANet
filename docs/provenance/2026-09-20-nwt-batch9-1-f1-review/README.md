> **Status**: CURRENT（2026-09-20，NWT；对象 = `origin/coord/j2-batch9-1-code-v0` 的 F1 笔 `11c30eb7`，父 D `de0e7862`；J2 README `docs/provenance/2026-09-20-j2-batch9-1-f1-c-module-nwt-fixes/README.md`）

# 批 9-1 F1 笔审（C 模块的 NWT 修正：C-1..C-5、E-2、E-1 的 C 侧）—— NWT

方法：独立检出（`D:\kanet-nwt-cand`，`11c30eb7`，独立 `npm ci`）读全 diff（`proto-settlement-c1.mjs` +60/−32、测试 +157/−28）；亲跑三套测试；**复跑我 C 笔审时的分级器掩盖场景**；做 **22 个我自己的变异**（只打 F1 新增逻辑）。D-021：无密钥 / 余额 / 地址。

## 结论：**GREEN，无 MUST；2 条 SHOULD；给 F2 的一条接口提醒**

C-1..C-5、E-2、E-1 的 C 侧都落到位。Bettor 让我判的两处偏离（C-3 不用 WeakSet、`classifyC1Error` 永不返回 null）**我都接受**（§二），并附一条我认为应补的绑定（F1-1）。

| 类 | 编号 | 内容 |
|---|---|---|
| SHOULD | **F1-1** | **`ipcTimeoutMs` 只被校验、没有传给 `requestFacts`**：模块里 `requestFacts(address, payload)`（`proto-settlement-c1.mjs:301`）只有两个参数。所以"漏传即拒"成立——**忘调断言不可能了**——但**声明 ≠ 实际**：驱动可以声明 `ipcTimeoutMs: 15000`、注入一个实际 IPC 超时 5000 ms 的 `requestFacts`，入口断言照样过，而那正是 N91-1 / §18.2.1 要防的"console 先超时、relay 回执无人接"。这一点 WeakSet 工厂同样解决不了（所以我不为它坚持 WeakSet）；结构性的做法是**把校验过的数字交给被调方**：`requestFacts(address, payload, { timeoutMs: ipcTimeoutMs })`，测试断言 `requestFacts` 收到的第三参数 == 声明值；9-2b 验收加一条"真实 wrapper 发出的 IPC 命令的超时 == 收到的 `timeoutMs`"。`tickIntervalMs` 只能是声明（模块无从观察驱动的调度），可接受。 |
| SHOULD | **F1-2** | **`timers` 在生产签名里可注入**：`verifyStepInputsOnChain({…, timers})`——一个永不触发的 `setTimeout` 就能让"每步总预算"失效（无界等待），而这恰是 C-3 要保护的东西。J2 写"生产不传"，但没有机器守着；我的变异 f22（去掉对注入 `timers` 形状的校验）**存活**——注入路径本身也没有校验测试。修法二选一：① 把可注入版本做成仅测试用的内部导出（生产入口固定用全局定时器）；② 保留但在 9-2b 验收里加源码扫描（同 E-3 / E-4 的思路）：非测试源码里 `verifyStepInputsOnChain` 的调用不得传 `timers`；并补一条"注入的 `timers` 缺 `clearTimeout` ⇒ TypeError"的测试（杀 f22）。 |
| 接口提醒（给 F2） | — | C 侧产出的 `chainParents[role].outpoint = { txid, index }`：txid 来自 relay 回执，**C 模块保证小写 hex**（`HEX64 = /^[0-9a-f]{64}$/`，"大写即异常"）；index 是数字。F2 的 builder 侧比较要把 builder 手里的 outpoint（`feeUtxo.txid`、`leafOutpoint.txid`、`heldInput.txid` 等，来源是 DB / 调用方，**不保证小写**）也 `toLowerCase()` 后再比、index 用数值比较，否则会对大写 txid 的合法输入误拒（liveness）——并请 F2 加一条"builder 侧 txid 大写 ⇒ 仍通过、换成别的 outpoint ⇒ 拒"的对照测试。 |

## 一、C-1..C-5 / E-2 / E-1(C 侧) 闭合核对
| 项 | 判 | 我做的验证 |
|---|---|---|
| **C-1** `version` 必须 0 | ✅ | 角色条目 `version !== 0` ⇒ `<role>_spk_drift`，**先于 M6**（M6 只比 script hex），fee 候选 `version !== 0` 按毒化跳过。变异 f1（去角色检查）、f2（去 fee 检查）**红**。 |
| **C-2** 分级器按 key 分计数 | ✅ | **复跑我 C 笔审的掩盖场景**（步骤 A 每 tick 失败、步骤 B 每 tick 成功）：**第 3 个 tick 升 `error`**（此前 6 个 tick 全程 `warn consecutiveTicks=1`）；key 缺失 ⇒ `TypeError`。变异 f9（一个 key 的成功清所有 key）、f10（key 不再必填）、f11（塌缩成共享 key）**红**。 |
| **C-3** 预算 / IPC 超时结构性 | ✅（偏离已接受）+ **F1-1 / F1-2** | 入口每次调用 `assertStepBudget(budgetMs, tickIntervalMs)` 与 `assertFactsIpcTimeout(ipcTimeoutMs)`；变异 f12 / f13 / f14 **红**。见 §二 与 F1-1 / F1-2。 |
| **C-4** fee 区间消费方复核 | ✅ | `feeMinAmount ≤ value ≤ SIGNED_INPUT_CEILING_SOMPI` 两端都复核，**恰等于边界放行**；变异 f3 / f4（边界差一）、f5 / f6（去某一端）、f7（越界不计入 saturated）、f8（去事件）**全红**。 |
| **C-5** evidence / 定时器被清 | ✅ | 变异 f15（`finally` 里不清定时器；我 C 笔审的 c22 就是它）**现在红**。 |
| **E-2** `classifyC1Error` | ✅ | 永不返回 `null`；无法识别的一律 `settlement_c1_programming_error`（error、非瞬时），`chain_parents_mismatch` 按 `err.code` 识别且**不 import builder**。变异 f16（又返回 null）、f17（丢 `err.code`）**红**。 |
| **E-1 C 侧** chainParents 带 outpoint | ✅ | 角色条目取自经 M6 断言的 `u.outpoint`，fee 项取自所选候选；`withFeeParent` 对缺 / 坏 `txid`、`vout` 抛 `TypeError`。变异 f18 / f19（index 写死 0）、f20（接受坏 txid）、f21（接受负 vout）**红**。 |

## 二、亲跑与变异
- 亲跑（独立检出）：`proto-settlement-c1` **41/0**、`proto-settlement-chain-checks` **51/0**、`proto-claim-draw` **53/0**——与 J2、Bettor 自报一致。
- **我的 22 个变异**：**21 被抓，1 存活**——f22（注入 `timers` 缺 `clearTimeout` 不再报错）= **F1-2**。还原后 sha256 一致，`git status` 空。
- J2 自报的第一轮存活 F-18（`tickIntervalMs` 的显式必填检查拆掉）：根因是**冗余代码**——我核了 `assertStepBudget` 自己对非有限数抛 `TypeError`（我 C 笔审读到的原文：`if (!Number.isFinite(budgetMs) || !Number.isFinite(tickIntervalMs)) throw new TypeError(...)`），所以删冗余行、校验仍在，做法对；与我 C 笔审的 c11 同类（后一个条件被前一个先拒掉）。旧输出改名留存 ✓。

## 三、J2 的 7 条取舍（含 Bettor 让我判的两处偏离）
1. **C-3 不用 WeakSet 工厂——接受，不 push back。** 理由：工厂证明的是"这个配置对象经过了校验函数"，并不证明配置与 `requestFacts` 实际行为一致；"每次调用校验"更简单且同样杜绝"忘了调"。真正缺的是**把校验过的数交给被调方**（F1-1），这个 WeakSet 也补不了。
2. **`classifyC1Error` 永不返回 null——接受**（正是我 E-2 的目的）。代价 J2 已写明（偶发的 wasm 异常也按 error 报，方向安全）；注意 `code` 缺失时落成 `'unrecognized_error'`，9-2b 报警里请一并带上 `err.name` / 消息前缀，否则"unrecognized_error"很难排查。
3. 版本检查先于 M6——接受（version 是 spk 身份的一部分，报 `_spk_drift` 并在消息里点明 version）。
4. 越界 fee 候选计入 saturated——接受：relay 已按同一区间过滤，越界候选只可能来自行为异常的 relay，按 error 报合理。
5. 分级器 API 破坏性变更——接受（无调用方）。**观察**：`states` 这个 Map 里，某 key 若失败后该意图被放弃 / 取消、再也不会 `onSuccess`，计数条目会一直留着（同一 key 将来复用会带着陈旧计数）；建议 9-2b 在意图终态时调用一次"忘记该 key"（当前 `onSuccess(key)` 可充当，但语义是"成功"）。
6. 新事件名 `fee_candidate_out_of_range_skipped`——接受，待 9-2b 登记进 `alertSettlementIntent` 类型表。
7. 三个新必填入参 + 可选 `timers`；`withFeeParent` 要求候选带 `txid` / `vout`——接受（候选本来就带；不再接受手造缺字段对象，方向对）。

## 没做 / 未证
- 没审 F2 / F3；没起 simnet。
- F1-1 的"声明 == 实际"只能在 9-2b 的真实 wrapper 上验证；本笔无调用方。
