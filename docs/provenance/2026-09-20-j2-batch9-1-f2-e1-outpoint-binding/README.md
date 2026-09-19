> **Status**: CURRENT（2026-09-20，J2；9-1 **F2 笔**：NWT E 笔审（`73c2b79b`）的 E-1 MUST 的 builder 侧 + E-4 + NWT A 笔审的 NETWORKS SHOULD；基线 = 本分支 F1 `11c30eb7`）

# 9-1 F2 笔：chainParents 绑定 outpoint（builder 侧）

## 问题（NWT E-1，MUST）
`chainParents[role]={value, spkLen, hasCovenant}` 是**某个 outpoint 的属性**，没绑 outpoint 就只是三个数：证据按 outpoint A 取、builder 却被交给同面值同 spk 的 outpoint B，旧断言照样放行、构造出花 B 的交易（毒化 fee UTXO 恰是"同面值同 spk、只差 covenant 位"的另一个 outpoint）。
**我先在 `11c30eb7` 上复现了 NWT 的探针**（`nwt-e1-probe-BEFORE-fix-on-11c30eb7.txt`）：`PROBE-RESULT: builder ACCEPTED`（对照臂 value+1 ⇒ `chain_parents_mismatch role=fee`，说明断言本身是活的，缺的是身份绑定）。附注：该探针的"outpoint A / B 是否出现在交易里"检查按 txid 字符串判断，而它的 A、B 同 txid 只差 vout，所以那两个布尔值分不出 A 与 B——不影响"builder 接受了 B"这一结论；我的回归测试按 (txid, vout) 判。

## 改了什么
1. **`proto-tx-assembly-settlement.mjs`（+24/−17）**：`assertChainParentsMatchBuilder` 新增第⑤项——**`chainParents[role].outpoint {txid,index}` 必须等于 builder 这一输入实际要花的 outpoint**（txid 统一小写比较、index 数值比较；形状不合法——缺失/非对象/txid 非 64 位小写 hex/index 非非负整数——报"形状不合法"）。四个 builder 的 `used[role]` 都带 `outpoint`：seal `leafOutpoint` / `heldInput` / `feeUtxo`；close_commit `rootCloseOutpoint` / `feeUtxo`；convert_to_claim `rootCloseOutpoint` / `heldTokenOutpoint` / `feeUtxo`；claim_draw `rootClaimOutpoint` / `ticketOutpoint` / `heldTokenOutpoint` / `feeUtxo`（共 12 个输入角色，含各步 fee）。`used[role]` 缺 outpoint 是 builder 自己的 bug ⇒ 普通 `Error`（"内部错误"），不是 `ChainParentsError`。
2. **夹具 `proto-chain-parents-fixtures.mjs`（仅测试用）**：`goodChainParents(step, args)` 现取整个 builder 入参、各角色 outpoint 从入参里读；新增 `withSwappedOutpoint`（NWT 探针的通用形：把某个角色实际要花的 outpoint 换成另一个）、`inputRolesOf`。C 侧（F1）产出的 chainParents 已带 outpoint，两侧形状一致。
3. **E-4**：B6 源码扫描——非测试源码（`kasia-console/src`、`kasia-relay/src`、`shared`，去注释）里任何 import / require / 动态 import 夹具文件都算违规（扫描范围有下限断言，防扫描失效成空判据）。
4. **A 笔 SHOULD**：`kasia-relay/src/drain-finality-safe-blocks.test.mjs` 的网络名清单改为从 `shared/lib/kaspa-network.mjs` 的 `NETWORKS` 取（与 `rpc-listener` 顶层的 `configuredNetwork` 同一单一来源），不再手写副本。证据 `test-outputs/drain-finality-networks-prereq.txt`（simnet 通过 / 未设 / bogus 都 LOUD 拒且清单来自 shared）。

## 测试（`test-outputs/`，仅把本机临时目录前缀替换为 `%TEMP%`，D-021）
| 文件 | 结果 |
|---|---|
| `proto-claim-draw.test.mjs`（B 组扩充） | **57/0**（原 53） |
| `proto-tx-assembly-settlement.test.mjs` / `-golden.test.mjs` | 43/0 / 12/0（未动，**字节仍不变**） |
| `proto-settlement-c1.test.mjs` / `-chain-checks` / `-pointers` | 41/0 / 51/0 / 23/0（未动） |
lint：5 个文件 0 errors。
**B 组新增**：B1 每个输入角色多 9 类 outpoint 变异（缺失/非对象/txid 含大写/太短/index 负/字符串 ⇒ 形状不合法；txid 换成另一个/**只差最后一位**/index+1（同 txid 另一输出）⇒ outpoint 不符），用例数精确断言 236；**B1d ▲ NWT 探针回归**：四个 builder × 12 个输入角色（含 fee）× {换 txid, 同 txid 换 index}，证据 A、实花 B ⇒ `chain_parents_mismatch`（带角色名、报文指明 outpoint），**对照臂**：chainParents 也按 B 重算 ⇒ 构造成功（证明拒绝的是"身份不符"，换 outpoint 本身合法）；B1e 直接测导出的断言函数（txid 大写写法通过、同 txid 另一 index / 另一 txid 拒、`used` 缺 outpoint ⇒ 内部错误）；B1f builder 层面的大小写对照；B6 扫描。

## 大小写（Bettor 转达）与一个既有现象
断言侧比较是**大小写不敏感**的（builder 手里的 outpoint 来自 DB/调用方，不保证小写）。B1e 在断言函数上直接证明；B1f 在 builder 层面证明"大写 txid 时本断言**绝不误拒**"。
🟡 **顺带发现（既有行为，非本笔引入，方向安全）**：大写 txid 经 builder 完整构造成功的只有 **7/12 个输入角色**（含全部 4 个 fee）；其余 5 个——seal/held、convert_to_claim/held、claim_draw/rootClaim、claim_draw/ticket、claim_draw/held——被**既有的**布局校验（`assertWitnessIndexLayout` / `assertClaimDrawLayout`，对 txid 大小写敏感地比较 `String(previousOutpoint.transactionId)` 与入参 txid）以 fail-closed 拒绝。也就是说这 5 个角色的 builder 入参本来就必须是小写 txid；DB 里若存了大写 txid，这些步骤会大声失败而不是错花。本笔不改它（改既有布局校验会扩大范围）；9-2b 接线时**指针模块（D 笔）产出的 txid 恒为小写**，所以不会触发。

## 变异对照（`mutation-f2-raw.txt`，脚本 `mutate-f2.mjs`，每次 finally 还原并核 sha256）
**39 个变异全部至少一条 FAIL，0 存活，0 锚点失配**，还原后 sha256 一致：E 笔的 28 个（因 F2 改了 `used` 形状，自证变异现在连 outpoint 一起自证；M-28 锚点更新）+ F2 新增 11 个 `F-xx`：outpoint 形状校验拆掉、**逐项相等整个拆掉（= 回到 E 笔的行为，NWT 探针被放行）**、只比 txid（N-T1 同族）、只比 index、txid 比较区分大小写、内部守卫拆掉、四个 builder 各一处 `used[role].outpoint` 接线错位、**生产代码 import 夹具（B6 必抓）**。
- **第一轮有 1 个存活（F-06：内部守卫 `!u.outpoint` 拆掉）**：该守卫在 builder 公开路径上不可达（builder 恒给 outpoint），但断言函数是导出的——我**没删守卫**，而是在 B1e 补了"`used` 缺 outpoint ⇒ 普通内部错误、不是 ChainParentsError"的直接单测，整套重跑；旧输出改名留存 `mutation-f2-raw-round1.txt`。
- "全被抓"只覆盖我选的 39 个变异。

## 超出 NWT 原文的取舍（请 NWT 审时判）
1. **outpoint 的 `index` 字段名**：C 侧 chainParents 用 `{txid, index}`（NWT 原文），builder 入参用 `{txid, vout}`（既有）——断言里 `index` 对 `vout` 做数值比较，没有统一改名（改既有入参形状会扩大范围）。
2. **形状校验要求 txid 为小写**（chainParents 侧恒由 C 产出小写）；builder 侧 txid 不要求小写（比较时统一小写）。
3. **fee 角色的绑定**：fee 的 `used.outpoint` 取 `feeUtxo`，所以 9-2b 的串接必须是"同一个 `feeUtxo` 既进 `withFeeParent` 又进 builder"——这正是 E-1 想强制的；选取缓存陈旧 / 重试换候选而 chainParents 没跟着换时现在会大声失败。
4. NETWORKS：测试用 `Object.keys(NETWORKS)` 与 `hasOwnProperty` 语义一致（与 `configuredNetwork` 同）。

## 不在本笔 / 留给后续
F3（NWT D 笔审的 D-1 `tx.free()` 守测试 / D-2 `deriveWinnerBet` 移到不 import DB 客户端的文件）；F4（NWT F1 审的 F1-1 `requestFacts` 第三参传 `ipcTimeoutMs`、F1-2 `timers` 不进生产签名）；E-3（四个 builder 调用点的 `chainParents` 只能来自 `verifyStepInputsOnChain` / `withFeeParent`）记 9-2b 验收。
