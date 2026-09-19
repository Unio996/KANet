> **Status**: CURRENT（2026-09-20，J2；9-1 首批 **E 笔**：chainParents + 四个 builder 的构造前断言 + 输入下标常量导出；设计依据 v0.3.4 §18.1 不变量 2 / §19.4 / §19.5 B 组；基线 = 本分支 C 笔 `7294aedd`）

# 9-1 首批 E 笔：`chainParents` 与 builder 侧断言

> 顺序说明：字母 E 先于 D 提交（D 的谱系核对要 import 本笔导出的 seal / close_commit 输入下标常量，Bettor 已同意对调；两笔内容与字母不变）。

## 改了什么
`kasia-console/src/lib/proto-tx-assembly-settlement.mjs`（+118/−17；设计 §18.3 预估 +110/−12，基本吻合）：
- **四个 builder（seal / close_commit / convert_to_claim / claim_draw）新增【必填】入参 `chainParents = {[role]:{value:bigint, spkLen, hasCovenant}}`**（生产里由 C 笔的 `verifyStepInputsOnChain` + `withFeeParent` 产出，即经断言的链上事实）。
- 新导出 `assertChainParentsMatchBuilder` 与类型化错误 `ChainParentsError`（`.code` 恒为 `chain_parents_mismatch`，带 `.step` / `.role`，消息带角色名）。在 **`selectChangeShape` / `assertMassWithinCeiling` 之前**、close_commit 与 claim_draw 还在**解出委员/赢家私钥之前**执行：① `hasCovenant` 与 `*_INPUT_HAS_COVENANT` 向量逐项相等；② `spkLen` 与 builder 现算 spk 字节长度相等；③ `value` 与 `EXPECTED_INPUT_VALUE_SOMPI[role]` 相等。
- **导出的具名常量**：`MARKET_SEAL_{LEAF,HELD,FEE}_IN_INDEX`、`CLOSE_COMMIT_{ROOTCLOSE,FEE}_IN_INDEX`、`MARKET_SEAL_INPUT_HAS_COVENANT` / `CLOSE_COMMIT_…` / `CONVERT_TO_CLAIM_…` / `CLAIM_DRAW_…`（向量含 fee 槽，与既有 `WITHDRAW_INPUT_HAS_COVENANT` 同型）。原先 builder 里的 `[true,false]` / `[true,true,false]` 等**字面量与 `inputs.map(...)` 改为引用这些常量**（值相同）。
- close_commit **返回 `continuationOutputIndices:[0]`**（P6，与 `buildRegisterAppendTxJson` 同型），`signInputIndices` 改为引用 `CLOSE_COMMIT_FEE_IN_INDEX`。
- 新文件 `proto-chain-parents-fixtures.mjs`（**仅测试用**，生产不得 import）：各步 `chainParents` 夹具，字面值**刻意不 import** builder 的常量（否则夹具与被测断言用同一份常量就成了自证）。
- **字节不变**：既有黄金回归（seal 与 simnet 链上字节逐字节比对）`proto-tx-assembly-settlement-golden` 12/0、`proto-tx-assembly-settlement` 43/0 仍全绿；改的只是"入口多一道断言 + 常量取名"。
- 没有任何生产调用方（9-1 仍无运行时效果）；withdraw / ticket_reclaim **未碰**。

## 测试（`test-outputs/`，仅把本机临时目录前缀替换为 `%TEMP%`，D-021）
| 文件 | 结果 |
|---|---|
| `proto-claim-draw.test.mjs`（新增 B 组 6 项） | **53/0**（原 47/0） |
| `proto-tx-assembly-settlement.test.mjs` | 43/0（调用点同笔更新） |
| `proto-tx-assembly-settlement-golden.test.mjs` | 12/0（调用点同笔更新） |
| `proto-settlement-chain-checks.test.mjs`（B 笔文件，未动） | 51/0 |
| `proto-settlement-c1.test.mjs`（C 笔文件，未动） | 32/0 |
lint：6 个文件 0 errors。
**调用点更新的实数**：既有测试里四个 builder 的**构造点共 11 处**（其中 5 个是入参工厂——`closeArgs` / `c3Args` / `c2cArgs` / `buildSeal` / `args`——被其余十余处调用复用；其余 6 处是直接调用），统一经 `withParents(step, args)` 补上必填 `chainParents`（fee 项由入参 `feeUtxo` 现算，所以测试里 `over` 覆盖 `feeUtxo` 的用例自动跟着变）。`proto-claim-draw.test.mjs` 里 seal / close_commit / convert_to_claim 三处内联构造顺带抽成入参工厂（`sealArgs` / `closeCommitArgs` / `convertArgs`），供 B 组复用。

**B 组**（设计 §19.5）：B1（4 个 builder × 每个输入角色含 fee × 10 类变异 + 缺参 + 多余角色，≥100 个断言，每个都要求 `ChainParentsError` 且 `.role` 正确；畸形形状还要求报文为"形状不合法"）；B1b（seal 的 held：④ 与 ③ 两道独立核对）；B1c（**断言先于 mass/fee 与私钥**：`absFeeCapSompi=1n` 会让构造失败，坏 chainParents 仍必须报 `chain_parents_mismatch`，且 close_commit / claim_draw 没有 new 过任何 `PrivateKey`；对照臂：好 chainParents 同上限下抛的不是 `ChainParentsError`）；B2（向量与 `STEP_INPUT_ROLES` 及夹具字面值一致）；B3（close_commit 的 `continuationOutputIndices` 过 relay 真代码 `validateFixedValueOutputs`）；B4（导出的输入下标常量与产出交易的**真实**输入布局逐项对，且 `STEP_INPUT_ROLES` 角色顺序 == 下标顺序）。

## 变异对照（`mutation-e-raw.txt`，脚本 `mutate-e.mjs`，每次 finally 还原并核 sha256）
**28 个变异全部至少一条 FAIL / 进程异常，0 存活，0 锚点失配**，还原后 sha256 一致。覆盖：断言函数内 hasCovenant / spkLen / ③ / ④ / 缺条目静默跳过 / 形状 / 多余角色 / 入参缺失 / fee 槽 / `.code` / `.role` / spk 字节 vs 字符；**四个 builder 各自"忽略入参、自证"**；**四个 builder 各自"断言挪到 selectChangeShape 之后"**；四个向量常量、两个下标常量、`continuationOutputIndices`、seal 的 ④。
- **第一轮有 1 个存活（M-06：形状校验拆掉）**：后面的严格相等比较碰巧也会拒畸形值，只是报文不同——那是"测试没区分报文"而非"校验无效"；我补了"畸形形状必须报形状不合法"的断言后**整套重跑**，旧输出改名留存为 `mutation-e-raw-round1.txt`（证据目录只增不删）。
- 🟡 **6 个变异是靠"模块加载期整条链构造就崩"变红的**（M-09、M-12、M-21、M-22、M-23、M-26：进程 exit=1、0 条 `[FAIL]`）——它们确实被抓到，但**不是被点名的那条测试抓到的**（因为测试文件顶层就要先造 seal→close_commit→convert→claim_draw 整条链）。这类"改常量 ⇒ 整套崩"是强信号但归因粗；B2 / B4 是否单独抓到它们，本轮**没有**单独验证。
- "全被抓"只覆盖我选的 28 个变异。

## 超出设计文字的取舍（请 NWT 审时判）
1. **多加一道 ④**：`chainParents[role].value` 另须等于 **builder 实际用于该输入的面值**（seal 的 `heldInput.value`、各步 `feeUtxo.value`）。设计 §19.4 只写了 ①②③；③ 单独查不出"builder 按 A 面值算 leftover、chainParents 却证明了 B 面值"。
2. **fee 角色也核**（hasCovenant 必须 false、value == `feeUtxo.value`、spkLen == fee spk 字节长度）：设计 §19.4 的"fee 角色项（NWT 补，B1）"写了来源必须是形态 L 条目的事实，没明写 builder 要核；我按同一信任模型核了。
3. **`chainParents` 里出现该步输入角色之外的键 ⇒ 拒**（防调用方把别的步骤的 chainParents 传错）。
4. **缺条目不当 false**：设计原文写 `roles.map(r => chainParents[r]?.hasCovenant ?? false)`——照字面写会让缺失的非 covenant 角色（fee / ticket）静默通过；我改为**先要求每个输入角色都有条目**，缺任一 ⇒ 拒。
5. **新增 `ChainParentsError` 类型**（不复用 B 笔的 `SettlementChainCheckError`：后者的 `.code` 闭集是 26 个链上漂移类码，`chain_parents_mismatch` 不是链上漂移而是调用方/C1 与 builder 假设不符）。
6. **close_commit / claim_draw 的断言在私钥解密之前**：claim_draw 的 `heldArtifact`（纯函数）从私钥解密之后**上移**到断言之前（供断言取 spk 长度），值不变。
7. **既有 close_commit 里两处字面量下标 `0` / `1`**（`createInputSignature(presignTx, 0, …)`、`signInputIndices: [1]`）改为引用新常量；seal 加内部一致性检查（`heldIdx/feeIdx` 必须等于导出常量，否则大声失败）。
8. 新文件 `proto-chain-parents-fixtures.mjs`（设计 §18.3 文件表里没有）：为让 11 个既有构造点补参数时不各自手写夹具。

## 不在本笔 / 留给后续
D 笔（pointers + `proto-leaf-state.mjs` 的 rowid tiebreak；谱系核对引用本笔导出的常量）、F 笔（NWT 审 C 的 C-1..C-5 与 A 笔的 NETWORKS SHOULD）、驱动接线（9-2b：`verifyStepInputsOnChain → withFeeParent → builder` 的串接）。
