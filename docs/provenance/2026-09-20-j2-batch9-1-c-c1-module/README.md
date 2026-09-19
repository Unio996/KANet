> **Status**: CURRENT（2026-09-20，J2；9-1 首批 **C 笔**：C1 调用点模块 `proto-settlement-c1.mjs`；设计依据 v0.3.4 §19.1 / §19.3 / §18.2 / §19.5 E·C 两组；基线 = 本分支 B 笔 `cef3f6f5`，主线 `c8089747`）

# 9-1 首批 C 笔：`proto-settlement-c1.mjs`（新文件 391 行）

## 做了什么
纯模块，**零副作用、9-1 仍无任何生产调用方**：不 import relay 通道 / DB / `kaspa-wasm`（`requestFacts` 与 `kaspa` 由驱动**注入**；只 import `proto-settlement-chain-checks.mjs` 与 `proto-tx-assembly.mjs`，测试有源码扫描钉死）；不发报警，只**返回**该发什么报警。
- `assertFactsResponse(res, {form, requested})` + `FactsResponseError`：§19.1 表 8 条判定**固定顺序**；`requested` 自身有问题（重复/非法/超 8 项）⇒ `facts_requested_invalid`，先于任何回执判定。
- `verifyStepInputsOnChain({...})`：按地址分组 ⇒ 每地址 1 次形态 O + fee 的 1 次形态 L，**并发**；每次 `requestFacts` 包 try/catch（reject ⇒ `facts_transport_error`）；总预算超出 ⇒ 放弃；组装 `chainUtxos` ⇒ 调 B 笔的 M6 断言 ⇒ 产出 `chainParents`；fee 候选过滤。**任一失败都抛错、不返回半成品**。
- `filterFeeCandidates` / `withFeeParent`：跳过 `covenantId !== null` 与 spk ≠ relay P2PK 的候选、排除我方在途产出；fee 角色的 `chainParents` 项取自形态 L 条目的事实（`hasCovenant` 由条目 `covenantId` 得出，不是常量）。
- `classifyC1Error` / `createTransportAlertGrader`：报警映射与分级（瞬时类首次 warn、连续 3 个**不同 tick** 升 error、成功清零；版本错位类首次即 error）。
- `assertStepBudget` / `assertFactsIpcTimeout`：预算 ≥ 15 s 且 < tick 间隔；IPC 超时 ≥ 15000。

## 测试（`test-outputs/proto-settlement-c1.test.txt`，仅把本机临时目录前缀替换为 `%TEMP%`，D-021）
`proto-settlement-c1.test.mjs` **32 项全绿**（exit 0）。同笔复跑 `proto-settlement-chain-checks.test.mjs` 51/0（B 笔文件未动）。lint：3 个文件 0 errors。
**夹具不手写**（S91-2）：条目是真实 kaspa-wasm `UtxoEntryReference`，回执由**真实 9-0 handler**（`handleGetAddressUtxos → parseFactsRequest → buildFactsResponse`）现场产出；错误回执取自该 handler 抛出的 `FactsError` 经 relay 外层 catch 的形状 `{error, phase:'execution'}`。**E1b** 把 9-0 验收 `facts-vs-node.json` 里 4 条真实节点观察值重放进 handler，经消费方规整后与当时记录的 `S1_relay` **逐字段相等**——这是对"设计 §20 偏差说明"的兑现（"与 `facts-vs-node.json` 字段逐项对齐"）。
🟡 **诚实边界**：这是"真实 relay 代码对合成 UTXO 集的真实输出"，**不是**从真实节点录制的回执（那需要再起 simnet，放 9-4）。测试里的假 relay **不做按地址过滤**（真实 RPC 会），所以"spk 错"这一类用例是**注入**的。

用例对照：E1/E1b/E2–E13、闭集；C1（6 步正向 + **8 个 S10 格 × 6～7 类负向 ≥ 32**）、C2（250 个更高面值 dust 仍取到目标）、C3、E10、C4、C5、C8（claim_draw 的 4 个请求各失败一次）、C9、C10、C11。C6/C7 在 B 笔。

## 变异对照（`mutation-c-raw.txt`，脚本 `mutate-c.mjs`，每次 finally 还原并核 sha256）
基线 32/0；**50 个变异全部至少一条 FAIL，0 个存活，0 个锚点失配**；还原后 sha256 一致。覆盖：#2 判错误回执方式 / #3 严格 ok / #4 回声与版本 / #5 form / #6 truncated / #7 covenantId·scriptHex 键与各范围与大小写 / **#8 匹配键去 index（N-T1 同族）**·重复·遗漏 / requested 校验；去掉传输 try/catch；预算定时器失效；**请求串行**；**角色输入改走形态 L**；请求失败被吞（O 与 L 各一）；**不调 M6**；chainUtxos 的 spk 取自预期；chainParents 写死；fee 请求缺 min/max；不跳毒化 / 不排在途 / 不分 saturated·none / 不写两个事件 / 饱和不抛 / code 串位；分级四种漏洞；预算常量三处；模块边界（引入 `process.env`）。
- **单独核过 M-22（串行）确实被 C11 自己抓到**（总耗时 1021 ms > 600 ms），不只是被 C8 连带（批跑里首条显示为 C8 是因为 C8 排在前面）。
- 已知**等价变异**（没写成变异、不算存活）：`foundByKey` 只按 txid 键控——形态 O 由服务端按 outpoint 精确过滤，同一响应里不会出现同 txid 的诱饵，行为等价；诱饵防线在 relay 侧与 `assertFactsResponse` 的 #8。
- "全被抓"只覆盖我选的这 50 个变异（9-0 三次同类教训）。

## 超出设计文字的取舍（请 NWT 审时判）
1. **第 11 个错误码 `facts_step_budget_exceeded`**：C4 要求"超预算 ⇒ 放弃本 tick"，设计 §19.1 的 10 个码里没有它。归入瞬时类（与 transport/relay 同级，首次 warn）。
2. **`verifyStepInputsOnChain` 自己抛 `FeeWindowError`**（`fee_window_saturated` / `no_suitable_fee_utxo`，带 `.events`/`.fee`）；设计没说 verify 是否因缺 fee 而抛。理由：没有干净 fee 就无法构造，返回"半成品"违反 NO TX NO STATE；M6 漂移优先于 fee 错误（先断言固定输入）。
3. **saturated / none 的判据**：无干净候选且（有毒化被跳过 **或** 窗口被截断）⇒ saturated；否则 none。"只有我方在途产出被排除"⇒ none（不是攻击信号）。设计只写了"无干净候选（含全被跳过）⇒ saturated"。
4. **事件/报警类型名新增**：`settlement_c1_programming_error`（缺参 / 未知步骤 / requested 非法，设计只定义了漂移与传输两类）与 `settlement_no_suitable_fee_utxo`（设计只有"普通 no_suitable_fee_utxo"，未给报警名；驱动可选择不发）。
5. **分级归类**：设计写"瞬时类 = 超时 / relay 忙（`facts_transport_error`、`facts_relay_error`）"，我把 `facts_step_budget_exceeded` 并入；`facts_not_ok`、`facts_shape_invalid`、`form_mismatch`、`item_key_missing`、`set_mismatch` 等其它协议违例都按"**首次即 error**"处理（比"瞬时"更响，方向安全）。
6. **`Promise.all` 快速失败**：多个请求同时失败时，抛出哪一个取决于先到者；其余的晚到结果被丢弃（已订阅、无 unhandledRejection，C4 与末尾用例断言）。
7. **`budgetMs` / `feeMinAmount` 必填、无默认值**（漏传 = 无界等待 / 无下界窗口）。`verifyStepInputsOnChain` 只要求 `budgetMs` 为正有限数；"≥15 s 且 < tick 间隔"由 **`assertStepBudget` 在驱动配置期调用**——**9-2b 必须调它**，本笔无法替驱动保证。同理 `assertFactsIpcTimeout`。
8. **两个角色的预期 outpoint 相同** ⇒ `facts_requested_invalid`（同一输入不能被同一笔交易花两次；否则去重会掩盖调用方 bug）。
9. **常量镜像**：console 侧复制 `FACTS_VERSION` / `FACTS_OUTPOINTS_MAX` / `FACTS_RPC_WAIT_MS` / `FACTS_RPC_CALL_MS`（不 import relay 包），测试与 relay 源码逐项断言相等；`SIGNED_INPUT_CEILING_SOMPI` 用 console 自己的常量（`proto-tx-assembly.mjs`），测试用正则核 relay 侧同名常量也是 `100_000_000n`。
10. **未核 `scriptPublicKey.version`**：M6 与本模块只比 spk 的 hex；地址查询是否可能返回 version≠0 的同脚本条目，**未验证**（我认为不可达，但没有证据）。
11. 分级器只有 `onSuccess()` 清零；两个 tick 之间夹一次"非瞬时"失败**不**清零。
12. **规模**：新文件 391 行，设计 §18.3 预估 ~260（±30% 外，+50%）——多出来的是错误类型、闭集、常量镜像与注释；测试 465 行。
13. fee 候选形状 `{txid, vout, value:bigint, scriptPublicKeyHex:'0x'+hex, spkLen, covenantId:null}` 与 `proto-broadcast-ops.mjs` 的 `toFeeUtxoCandidates` 一致并多带两个字段（供 `withFeeParent`）。

## 不在本笔 / 留给后续
`proto-settlement-pointers.mjs`（D 笔）、chainParents 的 builder 侧断言（E 笔）、驱动接线与预算数值（9-2b）、真实节点录制回执（9-4）、毒化 fee 输入在含其它 covenant 输出的结算交易里的共识行为（NWT 审 9-1 diff 时起 simnet 补）。
