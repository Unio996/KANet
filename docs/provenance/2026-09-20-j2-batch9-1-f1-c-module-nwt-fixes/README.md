> **Status**: CURRENT（2026-09-20，J2；9-1 **F1 笔**：NWT 对 C 笔审（`307590e0`）的 C-1..C-5、对 E 笔审（`73c2b79b`）的 E-2 与 E-1 的 C 侧；基线 = 本分支 D 笔 `de0e7862`；只动 `proto-settlement-c1.mjs` 与它的测试）

# 9-1 F1 笔：C 模块的 NWT 修正

> F 拆成三笔（Bettor 同意 F1/F2）：**F1（本笔）**= C 模块侧；**F2** = E-1 的 builder 侧（`assertChainParentsMatchBuilder` 核 outpoint，先复现 NWT 探针为红灯）+ E-4 夹具 import 扫描 + A 笔 NETWORKS SHOULD；**F3** = NWT 对 D 笔审的 D-1（`tx.free()` 有测试守着）/ D-2（`deriveWinnerBet` 移到不 import DB 客户端的新文件）——它们属 D 笔文件，单独一笔便于审。

## 逐条落实
| NWT 项 | 改动 | 守它的测试 |
|---|---|---|
| **C-1 MUST** `scriptPublicKey.version` 没核 | 角色条目 `version !== 0` ⇒ `<role>_spk_drift`（M6 只比 script hex，所以在 M6 之前拒；消息指明 version）；fee 候选 `version !== 0` ⇒ 按毒化跳过（计数 + 事件） | C-1（每个 S10 格 × version=1，含 version=0 对照臂）、C-1 fee |
| **C-2 MUST** 分级器全局单计数被别的步骤的成功掩盖 | `onFailure(err, tickId, key)` / `onSuccess(key)` / `consecutiveTicks(key)`，**按意图 key 分计数，key 必填**（TypeError） | C-2：A 每 tick 失败 + B 每 tick 成功 ⇒ A 第 3 个 tick 升 error（并两 key 独立、只清自己） |
| **C-3 SHOULD** 预算/IPC 超时靠约定 | **结构性**：`verifyStepInputsOnChain` **必填** `tickIntervalMs` / `ipcTimeoutMs`，入口每次调用 `assertStepBudget` / `assertFactsIpcTimeout`（漏传即拒、发请求之前）；**定时器可注入**（`timers`，默认全局） | C-3（缺失 TypeError、6 种越界 RangeError、恰在边界通过、校验先于请求）、C4（缩放定时器，不再真等） |
| **C-4 SHOULD** fee 区间不该信 relay 的过滤 | `filterFeeCandidates` 新增必填 `feeMinAmount`，复核 `feeMinAmount ≤ value ≤ SIGNED_INPUT_CEILING`；越界者跳过、计入 `skippedOutOfRange` 与事件 `fee_candidate_out_of_range_skipped`，且计入 saturated 判据 | C-4（行为异常的 relay 无视区间：低于下限 1 / 高于上限 1 被跳过，**恰等于下限 / 上限放行**；全越界 ⇒ saturated；纯函数层 feeMinAmount 必填） |
| **C-5 SHOULD** evidence 与"定时器被清"无测试 | 各加断言 | C-5 evidence（O 的 requested/found/missing、L 的 listed/truncated 由真实 handler 回执得出）、C-5 定时器（成功/快速失败/超预算三条路径都**恰设一次且都被清除**；真实定时器下成功后无遗留 `Timeout`） |
| **E-2 SHOULD** `classifyC1Error` 对 `ChainParentsError` 返回 null | `chain_parents_mismatch` 按 `err.code` 识别（**不 import builder**）归 `settlement_c1_programming_error`；**并且【永不返回 null】**——一切无法识别的错误（TypeError/RangeError/wasm 异常/非 Error）都归该类（error 级、非瞬时） | E-2（8 种输入，含 `code` 保留；grader 对它们首次即 error） |
| **E-1 的 C 侧 MUST** chainParents 没绑 outpoint | `verifyStepInputsOnChain` 的角色条目与 `withFeeParent` 的 fee 项都带 `outpoint:{txid,index}`（角色条目取自经 M6 断言的链上条目，fee 项取自所选候选）；`withFeeParent` 的候选缺/坏 `txid`/`vout` ⇒ TypeError | E-1(C 侧)（每步每角色 outpoint == 指针；fee 候选各自不同的 outpoint；坏候选 6 种） |
builder 侧（`used[role].outpoint` 与各输入逐项相等）是 **F2**。

## 测试与变异（`test-outputs/`、`mutation-f1-raw-part{1,2}.txt`；仅把本机临时目录前缀替换为 `%TEMP%`，D-021）
- `proto-settlement-c1.test.mjs` **41/0**（原 32，新增 9 条；既有用例随新必填入参与新 API 更新）；同笔复跑 chain-checks 51/0、claim-draw 53/0（E 笔文件，未动）；lint 0 errors。
- **变异 80 个全部至少一条 FAIL，0 存活，0 锚点失配**（脚本 `mutate-f1.mjs`：C 笔 50 个旧变异中因 API 变化而失配的锚点已更新、F1 新增 30 个 `F-xx`；分 `--part=1/2` 两批，每批各自还原并核 sha256，两批还原后 sha256 相同 `c99ce441…`）。新变异含：version 检查拆掉/放宽、fee 候选不按 version 跳过、区间下限/上限不复核、两个边界差一、越界不计入 saturated、verify 不把 feeMinAmount 传给过滤、**一个 key 的成功清掉所有 key 的计数（NWT 实测的掩盖）**、key 不再必填、退回全局单计数、入口不调 `assertStepBudget` / `assertFactsIpcTimeout`、`ipcTimeoutMs` 不再必填、定时器不清除/用错时长、evidence 三个计数、classify 又返回 null / 丢 code、chainParents 的两处 outpoint 缺失或错位、`withFeeParent` 不校验 txid 形状。
- **第一轮有 1 个存活（F-18：`tickIntervalMs` 的显式必填检查拆掉）**：根因是**冗余代码**——`assertStepBudget` 自己已对非有限数抛 `TypeError`。我**删了那行冗余检查**（校验仍在，由 `assertStepBudget` 抛），去掉该变异，整套重跑；旧输出改名留存为 `mutation-f1-raw-round1-part{1,2}.txt`。
- 已知等价、没写成变异：`evidence.missing`（`verifyStepInputsOnChain` 成功返回时任何 role 缺失都已在 M6 抛错，所以成功路径上 `missing` 恒为 0）。
- "全被抓"只覆盖我选的 80 个变异。

## 超出 NWT 原文 / 设计文字的取舍（请 NWT 审时判）
1. **C-3 没用 WeakSet 工厂**（NWT 原建议）：预算与 IPC 超时是驱动**声明**的两个数，工厂并不比"每次调用校验"多证明什么；改为 `verifyStepInputsOnChain` 自己必填两个参数并每次校验——漏传即拒，不可能忘调。Bettor 已接受此替代，NWT 若坚持 WeakSet 再议。副作用：定时器做成可注入（`timers`，默认全局，生产不传）。
2. **`classifyC1Error` 永不返回 null**（超出 E-2 清单的收紧）：NWT E-2 担心 `null` 被 9-2b 当"不是 C1 错误、照常重试"；我把无法识别的一律归 `settlement_c1_programming_error`（error、非瞬时）。代价：真正的偶发异常（如 wasm 异常）也会按 error 报——方向安全。
3. **版本检查先于 M6**：同一条目既 version≠0 又面值漂移时，报的是 `<role>_spk_drift`（M6 的检查顺序是值 → spk → …，而 version 是 spk 身份的一部分）。
4. **越界 fee 候选计入 saturated 判据**（NWT C-4 只说"跳过并计入事件"）：全是越界候选 ⇒ 我按 saturated（error）而不是 none，因为这只可能来自行为异常的 relay。
5. **分级器 API 破坏性变更**（`onFailure` / `onSuccess` 多必填 key、`consecutiveTicks` 由属性变为按 key 的方法）：本仓无任何调用方，9-2b 直接用新形状。
6. **新事件名** `fee_candidate_out_of_range_skipped`（warn）——请 9-2b 登记进 `alertSettlementIntent` 的类型表（与 NWT 已要求登记的其它事件名一起）。
7. **`verifyStepInputsOnChain` 新增两个必填入参 + 一个可选 `timers`；`filterFeeCandidates` 新增必填 `feeMinAmount`；`withFeeParent` 现在要求候选带 `txid` / `vout`**（候选来自 `fee.candidates`，本来就带；只是不再接受手造的缺字段对象）。

## 记入 9-2b 清单的（NWT / Bettor 已提，本笔不做）
relay 的 fee UTXO 真耗尽走 `none` 时至少发 warn；所有新报警类型名登记进 `alertSettlementIntent` 的类型表；四个 builder 调用点的 `chainParents` 只能来自 `verifyStepInputsOnChain` / `withFeeParent` 的结果（源码扫描，NWT E-3）；`pointer_covenant_inconsistent` 三种语义靠 `.detail` 区分（NWT D-3）。
