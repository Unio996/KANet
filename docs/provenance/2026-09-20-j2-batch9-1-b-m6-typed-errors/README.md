> **Status**: CURRENT（2026-09-20，J2；9-1 首批 **B 笔**：M6 必填参数 + 类型化错误；设计依据 v0.3.4 §19.3 步骤 4 / §19.6 #1 #2；基线主线 `c8089747`）

# 9-1 首批 B 笔：`assertSettlementInputValuesOnChain` 的 M6 与类型化错误

## 改了什么
`kasia-console/src/lib/proto-settlement-chain-checks.mjs`（+90/−17）与它的测试：
- **M6 两个必填参数、没有默认值**：`expectedOutpoints[role]`（txid **与 index** 都相等）与 `expectedCovenantIds[role]`（64 位 hex 或 `null`=必须无 covenant，**相等而不只是有/无**）。缺参 ⇒ `chain_check_params_missing`。
- **类型化错误 `SettlementChainCheckError`**，`.code` 取**闭集**（`chainCheckCodes()`：6 个角色 × {`value_drift`,`spk_drift`,`outpoint_drift`,`covenant_class_mismatch`} + `chain_check_params_missing` + `chain_check_unknown_step` = 26 个），`.message` **保留原标签文本**（既有消息正则一字未改），另带 `.step` / `.role`。**现有三类错误**（value_drift / spk_drift / 缺失类）也带 `.code`。
- 该函数**没有任何生产调用方**（只有它自己的模块与本测试），所以加必填参数不破坏生产路径。

## 测试（`test-outputs/`，仅把本机临时目录前缀替换为 `%TEMP%`，D-021）
`proto-settlement-chain-checks.test.mjs` **21 → 51 项**（新增每个 步骤×角色 的 outpoint / covenant 用例，以及 C6/C6b/C6c/C7 与闭集用例）；相关回归：`proto-claim-draw` 47/0（它只 import 未变的 `STEP_INPUT_ROLES`）、`proto-tx-assembly-settlement` 43/0、`proto-settlement-inputs` 15/0。lint：3 个文件 0 errors。
**调用点更新的实数**：既有测试里对该函数的调用是 **15 处**（Bettor 转述的"16 处"含 import 那一行），已统一经辅助函数 `A()` 补上两个必填参数；测"缺参"的新用例直接调用、不经 `A()`。既有用例的 `throws` 辅助现在**额外**断言抛出的是类型化错误且 `.code` 在闭集内——所以既有的每个 throw 断言都顺带验证了 `.code`。

## 变异对照（`mutation-b-raw.txt`，脚本 `mutate-b.mjs`，每次 finally 还原并核 sha256）
基线 51/0；**20 个变异全部至少一条 FAIL**：outpoint 比较整个拆掉 / **只比 txid（漏 index，N-T1 同族）** / 只比 index / 区分大小写；covenant 只比有无 / 整个拆掉 / 期望无 covenant 时不查 / 缺键当无 covenant；两个 M6 参数变可选；预期 outpoint 形状校验拆掉；链上缺 outpoint 不再 fail-closed；类型化错误退化成普通 Error；outpoint 漂移的 `.code` 串位；**消息原标签被改**（破坏调用方正则，C7）；不再带 step/role；闭集缺一类；缺 spk 与未知步骤的 `.code` 串位；**`BigInt` 解析异常逃出闭集**。

## 超出设计文字的取舍（请 NWT 审时判）
1. **缺 builder 假设 spk（`expectedSpks[role]`）** 的 `.code` 取 `chain_check_params_missing`，而**消息仍是原来的 `<role>_value_drift …` 标签**（C7 要求文本不变）。所以这一处 code 与消息标签**不同名**——是有意的：code 说"调用方参数缺失"，消息保持向后兼容。
2. **`BigInt(u.value)` 解析失败**（面值不是整数）现在抛类型化的 `<role>_value_drift`（消息含"不是整数"）；设计文字没写这一种，但不处理它会让裸 `SyntaxError` 逃出闭集、违反"抛出的每个错误都带闭集内的 code"。空串 `''` 不算解析失败（JS 里 `BigInt('') === 0n`），走普通的"面值不等"分支。
3. **预期值形状校验**（预期 outpoint 须 `{64 位 hex txid, 非负整数 index}`、预期 covenant id 须 64 位 hex 或 `null`）不合法 ⇒ `chain_check_params_missing`（调用方 bug 不当成"链上漂移"）。
4. **链上条目缺 `outpoint` ⇒ `<role>_outpoint_drift`；缺 `covenantId` 键 ⇒ `<role>_covenant_class_mismatch`**：缺键**不能当成"无 covenant"**（否则 §19.1 #7 的"条目级键齐全"在这一层被悄悄放宽）。
5. txid / covenant id 的 hex 比较**大小写不敏感**（relay 输出恒小写，这里对调用方传入宽容、对相等语义严格）。
6. 检查顺序：值 → spk → outpoint → covenant。同一角色有多处不符时，先报排在前面的那一类。
