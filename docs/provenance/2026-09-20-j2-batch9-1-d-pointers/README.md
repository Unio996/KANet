> **Status**: CURRENT（2026-09-20，J2；9-1 首批 **D 笔**：结算各步预期输入指针模块 + `deriveWinnerBet` 抽取 + leaf-state 的 rowid tiebreak；设计依据 v0.3.4 §18.1 S10 八格表 / §19.2 / §19.5 P 组；基线 = 本分支 E 笔 `a57db3d5`）

# 9-1 首批 D 笔：`proto-settlement-pointers.mjs`

## 改了什么
1. **新文件 `kasia-console/src/lib/proto-settlement-pointers.mjs`（214 行；设计 §18.3 预估 ~220）**：`resolveStepPointers({step, marketId, db, kaspa})` → `{roles:{[role]:{outpoint, expectedCovenantId, source, producedBy}}}`，支持 seal / close_commit / convert_to_claim / claim_draw 四步，角色键与 `STEP_INPUT_ROLES` 一致，产出正好喂给 C 笔的 `verifyStepInputsOnChain`。失败抛 `PointerError`（`.code` 取设计 §19.2 的 9 个闭集码，另带 `.step` / `.role` / `.detail`）。
   - 八格来源与 S10 表逐格一致：格 1/2 = 最新 landed append 的输出 0 / 2；格 3 = seal 意图输出 0；格 4 = close_commit（intent step=`resolve`）输出 0；格 5 = seal 输出 1；格 6/7 = convert_to_claim 输出 0 / 1；格 8 = **赢家那一条下注**的 landed append 意图输出 1（v0.3.4 N91-3：不直接信 `proto_bets.ticket_txid/vout`，只拿它们与意图、现算 spk 做交叉核对）。
   - **读取纪律（NWT N91-2 实测）**：`deserializeFromSafeJSON` 不重算 id ⇒ **必须 `finalize()` 后再比 `submitted_txid`**；只从 finalize 之后的对象读**被 txid 覆盖**的字段（输出面值/spk/covenantId/authorizingInput、输入 previousOutpoint），不读 `utxo` / `signatureScript` / `computeBudget` / `sigOpCount`（测试 P9c 钉死，并有源码扫描）。读完立刻 `tx.free()`。
   - **genesis 组输出**（append 的 KTT、seal 的 RootClose 与代币、convert_to_claim 的 RootClaim 与代币）另用 `kaspa.covenantId(authorizing 输入 outpoint, [该输出])` 独立重算并要求相等——校验 **builder 的 genesis 派生**，不是防 DB 篡改。
   - **谱系**：seal 的输入 leaf/held 必须花掉最新 append 的输出 0/2；close_commit 的输入 0 花掉 seal 输出 0；convert_to_claim 的输入 0/1 花掉 close_commit 输出 0 / seal 输出 1；covenantId 双重一致（close_commit 续约输出 = seal 输出 0；append leaf 输出 = `proto_markets.shardleaf_cov_id`）。输入下标用 **E 笔导出的常量**。
   - 纯读：不 import kaspa-wasm / relay 通道 / DB 客户端（db、kaspa 注入），不写任何东西。9-1 仍无生产调用方。
2. **`proto-settlement-inputs.mjs`（+28/−10）：抽出 `deriveWinnerBet(marketId,{db,who})`**（Bettor 已同意，见下）。`deriveCloseCommitInputs` 改为先做自己的 status 闸再调它；**检查顺序与报文逐字不变**（新增测试断言两处报文正文一致）。新函数**不含 status 闸**（claim_draw 取票时市场是 `resolved`，resolve 接口要求 `sealed`、claim 接口要求 `resolved`，已核 `api/proto.js`），每个 fail-closed 错误带 `.code`（`winner_market_missing` / `winner_side_unset` / `winner_pool_empty` / `winner_count`）。
3. **`proto-leaf-state.mjs`（+2/−2）**：`deriveLeafOutpoint` / `deriveHeldKttOutpoint` 的 `ORDER BY` 加 `, pbi.rowid DESC`（`landed_at` 是毫秒精度、无 tiebreak；append 严格串行 ⇒ 创建顺序 == 落链顺序；这是**活性**修复不是安全修复：选错指针只会让 C1 fail-closed 卡住）。指针模块自己的最新-append 查询用同一排序，测试 P1c / P14 断言两处取同一笔。

## 测试（`test-outputs/`，仅把本机临时目录前缀替换为 `%TEMP%`，D-021）
| 文件 | 结果 |
|---|---|
| `proto-settlement-pointers.test.mjs`（新，341 行） | **23/0** |
| `proto-settlement-inputs.test.mjs`（既有 15 条一字未改 + 新增 6 条） | **21/0** |
| `proto-leaf-state.test.mjs`（既有，消费 leaf-state） | 33/0 |
| `proto-broadcast-ops.test.mjs`（既有，消费 leaf-state） | 16/0 |
| `proto-claim-draw.test.mjs`（E 笔文件，未动） | 53/0 |
| `proto-settlement-c1.test.mjs`（C 笔文件，未动） | 32/0 |
lint：6 个文件 0 errors。
**P 组用例**（设计 §19.5）：P1–P8 八格各一个正向（含"held 的 covenantId 每笔 append 不同，取的是最新那笔"与"赢家票 = `winnerBetId` 那一行、胜方改 side=0 则取 bet1 的 append"）；P9 ▲（改输出面值、JSON 自带 id 不动 ⇒ `pointer_txid_mismatch`）/ P9b ▲（改 covenant id）/ P9c（改**不被覆盖**的 computeBudget、sigOpCount、signatureScript、utxo.amount ⇒ 四步结果逐字段不变；**对照臂**：改被覆盖的 sequence ⇒ 拒，证明篡改手段有效）/ P9d（非法 JSON、非交易）/ P9e（NULL/空/空白 ⇒ tx_missing；submitted_txid 空/非法 ⇒ 报文指明它自己）；P10 ▲ 谱系 8 个断点（含"同 txid 另一 index"）且更早的步骤不受影响；P11 ▲ covenantId 不一致；P12 胜方 0/2 条/`winning_side` 未写；P13 前置未 landed（四种非 landed 状态 × 三个意图、缺行、赢家那笔 append 未 landed、最新 append 未 landed 时回落到上一笔）；P14 同毫秒平局取 rowid 大者；P15 ▲ 票四类不一致；P16 ▲ genesis 独立重算不等（六种）；P17 输出下标越界；闭集（9 个码**每个都被触发过**，没有死码）；调用方错误 TypeError；模块边界源码扫描。

## 变异对照（`mutation-d-raw.txt`，脚本 `mutate-d.mjs`，每次 finally 还原三个目标文件并核 sha256）
**44 个变异全部至少一条 FAIL，0 存活，0 锚点失配**，还原后三份 sha256 一致。含 Bettor 条件③：**M-35「`deriveCloseCommitInputs` 不再调 `deriveWinnerBet`、自己重写一份」必红**（另 M-36 "winnerBetId 取错"）；M-28/M-29 分别去掉 leaf-state 两处的 rowid tiebreak；M-37/38/39/41/42 覆盖 `deriveWinnerBet` 各检查与"status 闸漏进来/被拆掉"。
- **第一轮有 2 个存活，已处理并整套重跑（旧输出改名留存为 `mutation-d-raw-round1.txt`）**：
  - M-05（不再要求意图是 landed）：根因是**死代码**——各查询已只取 `status='landed'` 的行，`loadProducedTx` 里对 status 的二次比较不可达。我**删了死代码**，并把变异改为"去掉 SQL 里的 `status='landed'` 过滤"三个（seal/resolve/convert、最新 append、赢家 append），补了"最新 append 未 landed ⇒ 回落到上一笔"的用例后全部变红。
  - M-06（submitted_txid 缺失/非法不再拒）：那条专门校验与后面的 id 比对**同码**，测试只比了 code；补了"报文须指明 submitted_txid 本身有问题"的断言。
- **已知等价、没写成变异**：`landedSettlement` 与赢家 append 查询的 `ORDER BY`（同一步骤/同一下注只可能有一行 landed，排序无从起作用）。
- "全被抓"只覆盖我选的 44 个变异。

## 超出设计文字的取舍（请 NWT 审时判）
1. **`deriveWinnerBet` 抽取**（对既有文件 `proto-settlement-inputs.mjs` 的小重构）：设计 §19.2 要求"复用 `deriveCloseCommitInputs` 的语义与 `winnerBetId`，不另写一份"，但该函数开头硬要求 `status==='sealed'`，claim_draw 时必抛。Bettor 同意抽取并给三条条件，均满足：① 既有 15 条原样通过、非 sealed 仍拒（既有"反向4"+新增用例保留）；② `deriveWinnerBet` 自带用例（0/2 条 ⇒ `winner_count` 与 close_commit 一侧报文正文一致，1 条 ⇒ 返回赢家）；③ M-35 必红。
2. **函数签名**：设计写 `resolveStepPointers({step, marketId, db})`，我加了必填 `kaspa`（`finalize()` 与 `kaspa.covenantId` 需要）；未加 `claimId`（赢家由 `deriveWinnerBet` 从库里定）。
3. **码的复用**：`pointer_covenant_inconsistent` 除设计写的"格 3/4 不等"外还用于 (a) genesis 组输出独立重算不等、(b) append leaf 续约输出 ≠ `shardleaf_cov_id`——没有新增码，`.detail` 区分；`pointer_winner_ambiguous` 用于 `deriveWinnerBet` 的**全部**失败（含 `winning_side` 未写、池子为空、市场不存在），`.detail` 带原报文。
4. **谱系每步全链复核**：每一步都重新核对此前所有已落链交易之间的边（seal↔append、close_commit↔seal、convert↔close_commit/seal），不只核"本步产出交易"的那一条；close_commit 步也会装载并校验 seal 的**代币输出**（格 5），所以 seal 的代币输出畸形时 close_commit 步就失败（更严）。
5. **genesis 回退**（无任何 landed append）时 leaf 指针直接取 `proto_markets.shardleaf_txid/vout/cov_id`，**没有** tx 字节可验（source=`genesis`）；而此时 seal 步因无 held 必抛 `pointer_dependency_not_landed`，所以该回退产出目前没有实际用处，仅按 S10 表第 1 格写出。
6. **P9c 没测"非法值"**：设计写"含设成非法值"；实测把 `signatureScript` 设成非法 hex 会让反序列化直接失败（⇒ `pointer_tx_malformed` 而不是"不变"），所以只用"合法但不同的值"，并用被覆盖字段（sequence）做对照臂。
7. **导入图副作用**：本模块 import `proto-settlement-inputs.mjs`（为复用 `deriveWinnerBet`），后者 import `db/client.js`——所以 import 本模块会打开默认库（M0a 拒绝无 `DB_PATH` 的默认库）；查询本身走注入的 `db`，测试用 `DB_PATH` 临时库。
8. **夹具不是 builder 真实产物**：测试里的交易用与 builder 同一组 wasm API 按 builder 的输出布局造出来（spk 除 ticket 外为占位；ticket spk 来自真实 `computeTicketGenesisArtifact`）；真实 builder 链由 claim-draw / golden 测试覆盖，真链证据在 9-4 simnet。

## 不在本笔 / 留给后续
F 笔（NWT 审 C 的 C-1/C-2/C-4/C-5、审 E 的 E-1/E-2/E-4、A 笔的 NETWORKS SHOULD、C-3 由我判）；驱动接线（9-2b：`resolveStepPointers → verifyStepInputsOnChain → withFeeParent → builder` 的串接）。
