> **Status**: CURRENT（草稿 v0.2，2026-09-19，J2；批9 接线设计 + 验收清单，**待 NWT 设计审，过审后才落码**；本文不含任何代码改动）

# 原型 v0 结算批9（驱动接线）设计与验收清单 v0.2

取代 `2026-09-19-j2-proto-v0-batch9-driver-wiring-acceptance-checklist-v0.1.md` 中关于批9范围与接线的部分（v0.1 保留作历史，其 C1/C2/C3、pmt、SLA、NO-TX-NO-STATE 各条本文继承并细化）。
依据：Bettor 账本 1494/1520/1523/1524 与本轮裁定 ③、Codex 对 C1 的接受条件、NWT 批3–7 审、代码现状盘点（§1，全部可 `grep` 复核）。D-021 合规：无真实地址/余额/私钥。

## 0. 范围与硬线

- **批9范围（Bettor 裁定 ③）：四步接线** —— `market_seal` / `close_commit`（意图 step 名 `resolve`）/ `convert_to_claim` / `claim_draw`。
- **排除**：`withdraw`（主网目的地允许清单 v0 为空，T-TOKEN-WALLET-COVENANT 未开）、`ticket_reclaim`（relay fee 估算器与节点最低费之间无可行 fee，即 T-FEE-PRICING；builder 与 simnet 证据保留，不接线）。驱动、HTTP、意图表都**不得出现**这两步的构造/广播路径（§11 审计项）。
- 硬线：不发起任何主网链上花费；不启用任何驱动开关（含 simnet 之外）；主网开闸走 D-022 另开闸、Owner 终端点 GO；合入主线不带运行时效果，主网 console 不为此重启；不动 relay 生产行为之前，relay 侧任何改动（§2 P1）先过 NWT 审 + Bettor 批（铁律 0）。
- 🟡 route A 边界：`pool_value=1000` 恰在 `payout >= 1000`（RootClaim.sil:103）边界上；`deriveCloseCommitInputs` 已拒 `<1000`。改 min_bet/stake 的运营变更前必须先核这条。

## 1. 现状盘点（代码事实，接线设计的地基）

| # | 事实 | 出处 |
|---|---|---|
| F1 | 现有驱动 `startProtoDriver`：默认关；`isProtoDriverEnabled()` = `PROTO_DRIVER_ENABLED==='1' && !!PROTO_RELAY_ID`；关闭时打 `[proto-driver] disabled`；启动打 `[proto-driver] started (tick …ms, cap …/tick)`；单飞 + 每 tick cap；`network = process.env.KASPA_NETWORK \|\| 'mainnet'` | `src/services/proto-driver.mjs` |
| F2 | 驱动只处理 market_genesis 与 bet append；**没有任何结算步骤的处理分支** | 同上 |
| F3 | 意图状态机 `proto-settlement-intent.mjs`（六 step、`settle:<subject_type>:<subject_id>:<step>`）已落且有测试；`driveSettlementIntent`/`checkSettlementIntentLanded`/`resumeStaleSettlementIntents` 可直接复用；`isDependencyLanded` 只查同 subject 的前置 step；**没有任何调用方** | `src/lib/proto-settlement-intent.mjs`；`ingest.js` 已有 `settle:` 前缀分派 |
| F4 | HTTP `/api/proto-markets/:id/resolve`、`/claim`、`/withdraw` **仍是 501 占位**（`buildAndBroadcast` 总是抛错）；`/resolve` 只校验 `status==='sealed'` 与 outcome∈{0,1}，**不写 `winning_side`**；这些路由无任何鉴权调用 | `src/api/proto.js` |
| F5 | `proto_markets.status` CHECK 含 `betting/sealed/resolved/cancelled` 与 `genesis_*`；**没有 `sealing` 之类中间态**；`markMarketStatus` 对 RANK 表内的 status 做单调保护、表外的值不保护（再由 CHECK 约束兜底） | `migrate.js` v206/v207、`proto-market-intent.mjs` |
| F6 | **没有任何代码创建 `proto_claims` 行**（只有读）；`proto_settlement_intents` 的 `claim` 主体 id = `proto_claims.id` | grep `INSERT INTO proto_claims` 零命中 |
| F7 | Console→relay 命令白名单只有 `covenant_broadcast`(write)、`get_address_utxos`/`get_mempool_entry`/`check_utxo_landed`(read)；加/改此表 = 安全边界变更，须 NWT 审 | `src/lib/proto-relay-ipc.mjs` |
| F8 | 🔴 relay `get_address_utxos` 只回每个 UTXO 的 `outpoint`+`amount`：**没有 `scriptPublicKey`，没有 `covenantId`**。现有 register_append 接线靠"按预期 spk 推的地址去查，RPC 只回该地址下的 UTXO"隐含 spk 匹配 | `kasia-relay/src/lib/p2sh.mjs getAddressUtxos`；`proto-broadcast-ops.mjs findUtxoValueAt` |
| F9 | 🔴 **没有任何 Console→relay 通路能读 `pastMedianTime`**（`proto-close-commit-gate.mjs` 的 `readPastMedianTimeMs(rpc)` 要一个 kaspa RpcClient；relay 白名单里没有 dag-info 类命令；`get_rpc_state` 只回连接状态） | `proto-relay-ipc.mjs`、`relay.mjs get_rpc_state` |
| F10 | 节点侧事实（simnet 实测，`docs/provenance/2026-09-19-j2-*`）：节点的 UTXO 条目带 `covenantId` 字段（covenant UTXO 有、普通 P2PK 无），即"输入是否 covenant"是**可查的链上事实**，但要经 relay 暴露（见 F8） | `getUtxosByAddresses` 条目结构 |
| F11 | 六个 builder 中 market_seal/convert_to_claim/claim_draw 返回 `genesisOutputIndices`；**close_commit 不返回 `continuationOutputIndices`**（其 RootClose 续约输出 0 因此没被 relay 的固定面值校验覆盖）；relay `validateFixedValueOutputs` 在两组索引都空时是 no-op | `proto-tx-assembly-settlement.mjs`、`covenant-broadcast-relay.mjs` |
| F12 | 「胜方由 DB 派生」：`deriveCloseCommitInputs` 要求 `proto_markets.winning_side` **已由操作员的 resolve 裁决写入**；现在无人写它（F4） | `proto-settlement-inputs.mjs` |
| F13 | 各步骤之间的链上指针（seal 的 RootClose outpoint/covenant_id、held 代币 outpoint 等）**没有落库列**；`proto_markets` 只有旧的 `rootclose_txid/vout`（无写入方） | schema |

## 2. 前置阻塞与需要先裁定的设计点（不裁定，后面的接线就无法成立）

- **P1（relay 只读扩展，须 NWT 审 + Bettor 批）**：F8 + F9 决定了 C1 的"spk/covenant 分类是链上事实"与"pmt 同节点门"在现有 relay 接口下**做不到**。最小方案：
  - **R1** `get_address_utxos` 每项**追加** `scriptPublicKey`（hex）与 `covenantId`（无则 null）——纯加字段、只读，现有调用方只读 `outpoint/amount`，不受影响（需 grep 复核全部消费者）。
  - **R2** 新增只读命令 `get_past_median_time`（返回 relay 自己 RpcClient 的 `getBlockDagInfo().pastMedianTime`）——**同一个 relay 既读 pmt 又提交交易，天然满足 Bettor/NWT 的"同节点"要求**；同时在 `PROTO_COMMAND_ALLOWLIST` 加 `'read'` 一行。
  - 被否决的替代：console 用自己的共享 RpcClient 读 pmt——它与 relay 提交所用节点不保证同一个（console 共享 RpcClient 有回退公网的既往），违背"同节点"；不能只靠 `getMempoolEntry` 之类现有命令间接推断。
  - **诚实边界**：R1/R2 不引入新的 write 面，但**改了 relay 的对外输出/白名单**（F7 说这本身是安全边界变更）；是否采纳、是否分成独立小批先落，需 Bettor 裁定。**若不采纳 R1/R2，批9 的 C1 covenant 分类与 pmt 同节点两条无法按 Codex/NWT 的要求证明，接线不得继续。**
- **P2（`/resolve` 是"任意结果签名预言机"的入口）**：F4 + F12：`winning_side` 是 close_commit 5 个委员槽自动签名的输入。接线时 `/resolve` 必须：① **write-once**（`winning_side IS NULL` 才写，写后不可改；改需人工 SQL 且报警）；② 校验 `status==='sealed'` 且 market 的 seal intent 已 `landed`；③ **操作员鉴权**——现有 proto 路由无鉴权，主网暴露面上不能让任意请求决定结算结果。鉴权机制（沿用哪一套 operator 单点白名单/token）需 Bettor 指定；未指定前 `/resolve` 在主网 console 保持 501/禁用。
- **P3（seal 触发与下注上限）**：F5：无 `sealing` 中间态（加 status 值要重建表，代价大）。设计：seal 触发条件 = `status='betting'` ∧ 已确认下注数 == `seal_count` ∧ 该市场**无** pending/prepared/submitted 的 append 意图（`assertNoInFlightAppend` 同款）；**seal 意图 landed 后**才 `markMarketStatus('sealed')`。为防第 `seal_count+1` 笔下注在链上被合约拒（卡死 append 意图），`/bet` 须在 `已确认+在途 ≥ seal_count` 时 409（现状**未见此校验**，须核并补——属 proto.js 小改）。
- **P4（`proto_claims` 行创建时机）**：F6：`resolve` 意图 landed 后，驱动按 `deriveCloseCommitInputs` 的 payouts（v0 恰 1 条）**创建一行 `proto_claims`（side='win', amount=pool_value）**，其 id 作为 `convert_to_claim`/`claim_draw` 的 subject_id；创建走 `INSERT OR IGNORE`（按 market_id 唯一约束的等价查询保证只有一行），不引入迁移。
- **P5（链上指针的存放）**：F13：**不加列、不迁移**——新增纯函数模块 `proto-settlement-pointers.mjs`，从已 `landed` 的结算意图的 `prepared_tx_json` 反序列化取：txid（**必须**等于 `submitted_txid`，否则 fail-closed）、输出下标（用 builder 导出的具名常量）、covenant_id（输出的 `covenant.covenantId`）。所有指针**仅作"预期 outpoint"**，是否真实存在与未花费由 C1 用链上事实证明（§6）。
- **P6（builder 小改，接线批内做）**：close_commit 返回 `continuationOutputIndices:[0]`（F11）；四个 builder 新增**必填**入参 `chainParents`（§6.3），在 mass/fee 判定前交叉核对。

## 3. 开关与启动（默认关闭）

| # | 要求 | 证明 |
|---|---|---|
| 3.1 | 新开关 `PROTO_SETTLEMENT_DRIVER_ENABLED`，**独立于** `PROTO_DRIVER_ENABLED`；`isProtoSettlementDriverEnabled()` = 该开关==='1' ∧ `!!PROTO_RELAY_ID`（`startProtoSettlementDriver` 与 HTTP 共用同一判据，同 F1 形状） | 单测：两开关 × PROTO_RELAY_ID 的 2×2×2 共 8 态，仅"结算开关真 ∧ relay 已配置"启动，其余全不启动；两开关互不影响 |
| 3.2 | 关闭：打 `[proto-settlement-driver] disabled`；启动：打 `[proto-settlement-driver] started (tick …ms, cap …/tick, network=…)`（同 F1 日志风格，`network` 显式打印，simnet 时 LOUD） | 单测捕获 console：两种形状各一 |
| 3.3 | 关闭态**零 IPC**：不启动 interval，不发任何 `sendCmd`；HTTP 在关闭态只建 pending 行并回 409 `proto_settlement_driver_disabled`（同 bet 端点先例） | 单测：注入 spy sendCmd，关闭态调用次数 = 0 |
| 3.4 | 主网 `kanet.mainnet.env` **不含**新开关行；合入不带运行时效果 | `git grep PROTO_SETTLEMENT_DRIVER_ENABLED -- kanet*.env*` 零命中（新开关只出现在 `.env.example`/文档，默认 0） |
| 3.5 | 单飞（in-flight 标志）+ 每 tick cap；重入 tick 直接跳过（同 F1） | 单测：并发两个 `driveOnce` 只有一个进入 |
| 3.6 | 与现有驱动共用 `assertProtoRelayHealthy()`（余额硬顶、relay 存活）；unhealthy ⇒ 跳过整 tick，不发命令 | 单测：注入 unhealthy ⇒ 无 IPC |
| 3.7 | `network` 一致性断言（NWT 审计项 ②的启动侧）：`network` 取自 `KASPA_NETWORK`（默认 mainnet），**必须与 relay 收款地址前缀一致**（`kaspa:`↔mainnet，`kaspasim:`↔simnet …），不一致 ⇒ 拒绝启动并 LOUD | 单测：network=simnet 而 relay 地址为 mainnet 前缀 ⇒ 不启动 |

## 4. 意图与状态迁移

- 每步一个 subject/step：seal=`market/<market_id>/seal`；close_commit=`market/<market_id>/resolve`；convert_to_claim=`claim/<claim_id>/convert_to_claim`；claim_draw=`claim/<claim_id>/claim_draw`。依赖：resolve←seal；claim_draw←convert_to_claim；**convert_to_claim 依赖 resolve（跨 subject_type）**——`STEP_DEPENDS_ON` 里 convert_to_claim 现为 null，须由驱动在推进前**额外**检查 market 的 resolve 意图 `landed`（不改 F3 的模块语义，调用方职责，写进单测）。
- 状态推进只由 relay 回执（prepared/submitted）与 `check_utxo_landed`（`minDepth=REORG_SAFE_MIN_DEPTH`）驱动，**NO TX NO STATE**：广播失败/超时/进程死 ≠ 已发生；只有 landed 才推进 `proto_markets.status`（seal→`sealed`、close_commit→`resolved`）与创建后续意图。
- `markMarketStatus('sealed'|'resolved')` 与 landed 记账放在同一个纯函数里（`markSettlementLanded`，仿 `markBetAppendLanded`：`WHERE status=<前态>` 幂等）。

## 5. 每步接线规格（构造前的固定顺序，**全部在签名之前**）

通用顺序（每步都一致，每一项都有单测的"反向必红"）：
1. 建 pending 意图行（`ensureSettlementIntent`，必须先于任何 IPC）。
2. 依赖已 landed（同 subject + 跨 subject 额外检查，§4）。
3. **取链上事实**：对该步每个输入角色，按"预期 spk 推地址"调 `get_address_utxos`，用**预期 outpoint**（来自 P5 指针，绝不取"第一个匹配面值的"）在结果里找；得到 `{value, scriptPublicKey, covenantId}`（依赖 R1）。
4. **C1**（§6）：值/spk/covenant 分类逐输入断言，不符 ⇒ 中止，不构造。
5. **DB 派生入参**（C2/B4-4）：close_commit 的 `newWinningSide/newPayoutRootHex` 由 `assertCloseCommitArgsFromDb(marketId, {…, expectedPoolValue})` 派生并核对（`expectedPoolValue` = 由 C1 的 RootClose spk 断言证明的链上 pool_value）；其余步骤的 state 由 DB 派生并与链上 spk 交叉。
6. **步骤专属闸**：close_commit 的 pmt 同节点门（§8）；claim_draw 的 full 分支闸/赢票闸（builder 已 fail-closed，驱动再核一次不冲突）。
7. 调 builder（签名前断言 `assertTicketSigningKey` 在 claim_draw builder 内；close_commit 的委员私钥解密即用即弃在 builder 内；**驱动层永不接触私钥**，§11）。
8. `covenant_broadcast`：`intent_key`、`tx_json`、`sign_input_indices`、`expected_txid`、`genesis_output_indices`、`continuation_output_indices`（P6 补全）——relay 侧 prepared 回执先落库、再广播（现有机制，不改）。
9. landed 检查（`check_utxo_landed(目标地址, submitted_txid, minDepth)`）→ landed 记账与后续意图创建。

| 步骤 | 触发 | 依赖 | 链上输入角色（C1） | 目标地址（landed 判据） | landed 后效果 |
|---|---|---|---|---|---|
| seal | P3 触发条件 | 无（要求全部下注 `confirmed`、无在途 append、held 存在(N2)） | leaf、held | seal 输出0 RootClose 的 P2SH 地址（预期 state 现算） | `status='sealed'` |
| close_commit(`resolve`) | 操作员 `/resolve` 已写 `winning_side`（P2）∧ pmt 门放行 | seal landed | rootClose | close_commit 输出0 RootClose(closed=1) 地址 | `status='resolved'`；创建 `proto_claims` 行与 convert_to_claim 意图（P4） |
| convert_to_claim | resolve landed 且 claim 行存在 | resolve landed（跨 subject） | rootClose、held | RootClaim 地址 | 创建 claim_draw 意图 |
| claim_draw | convert_to_claim landed | convert_to_claim landed | rootClaim、ticket、held | KanetTokenClaim 地址（winner_pk/amount 现算） | `proto_claims.claim_txid/vout/claimed_at` 记账；终态（withdraw 不接线） |

- fee 输入：从 `get_address_utxos(relayAddress)` 取，`selectFeeUtxoByConstruction`（沿用 F1 已有做法，按真实构造逐个试，过滤 `> SIGNED_INPUT_CEILING_SOMPI`）；cap 用 `feeProfile.<kind>.cap`（seal 52M / close_commit 30M / convert_to_claim 52M / claim_draw 50M，均已是 NWT 推数）。
- 🔴 relay 的 `validateNetLoss`/`validateImpliedMinerFee` 天花板 = 2×relay 本地 wasm 估算：这四步都是 storage 占优、本地估算高估，simnet 全链已证 fee 落在天花板内；**接线离线测试须用 relay 真代码跑这两个校验**（同批8 ㉖ 的做法）覆盖四步，防止将来 builder/fee 变化后静默被 relay 拒。

## 6. C1 完整角色表与调用点覆盖（Codex 条件①③）

### 6.1 角色表（"输入种类逐一断言"）

| 步骤 | 输入下标 | 角色 | 期望面值(sompi) | spk 来源（现算） | 链上分类（R1 的 `covenantId`） | `inputHasCovenant` |
|---|---|---|---|---|---|---|
| seal | 0 | leaf | 20,000,000 | `computeShardLeafRedeemScript(deriveLeafState)` | covenant | true |
|  | 1 | held | 20,000,000 | `computeKttGenesisArtifact(pool_value, owner=leafCovId)` | covenant | true |
|  | 2 | fee | 变量（≤1 KAS，relay 签） | relay 地址 | 普通 | false |
| close_commit | 0 | rootClose | 20,000,000 | `computeRootCloseGenesisArtifact(sealedState)` | covenant | true |
|  | 1 | fee | 变量 | relay | 普通 | false |
| convert_to_claim | 0 | rootClose | 20,000,000 | `computeRootCloseGenesisArtifact(closedState)` | covenant | true |
|  | 1 | held | 20,000,000 | `computeKttGenesisArtifact(pool_value, owner=rootCloseCovId)` | covenant | true |
|  | 2 | fee | 变量 | relay | 普通 | false |
| claim_draw | 0 | rootClaim | 20,000,000 | `computeRootClaimGenesisArtifact(claimState)` | covenant | true |
|  | 1 | ticket | 20,000,000 | `computeTicketGenesisArtifact(bettorPk,side,stake,marketId)` | **普通 P2SH（无 covenant）** | false |
|  | 2 | held | 20,000,000 | `computeKttGenesisArtifact(pool_value, owner=rootClaimCovId)` | covenant | true |
|  | 3 | fee | 变量 | relay | 普通 | false |

（下标以各 builder 的具名常量为准；本表在落码时由测试逐项对着 builder 常量与 `STEP_INPUT_ROLES` 比对。fee 输入不在 C1 的固定面值表内——其面值是变量，但**必须**取自节点回报的 UTXO 而非本地库，并参与 relay 的 `validateSignedInputCeiling`。）

### 6.2 调用点覆盖清单

每个"链上固定面值输入 × 调用点"各一处 C1 调用，共 **8 处**（seal 2：leaf/held；close_commit 1：rootClose；convert_to_claim 2：rootClose/held；claim_draw 3：rootClaim/ticket/held，其中 ticket 是普通 P2SH 但同样断言值/spk/分类）；另加 4 处 fee 输入检查（每步一处：取自节点回报的 UTXO、面值 ≤ SIGNED_INPUT_CEILING）。落码验收：测试枚举 `STEP_INPUT_ROLES` 与本表，任何角色没有对应的调用点断言 ⇒ 红。C1 必须在**签名之前**、**mass/fee 判定之前**执行（见 §6.3）。

### 6.3 `chainParents`：由父 UTXO 事实交叉核对 `inputHasCovenant`（Codex 条件③）

- C1 通过后产出 `chainParents: { [role]: { value, spkLen, hasCovenant } }`（`hasCovenant = covenantId != null`，全部来自节点回报）。
- 四个 builder 新增必填入参 `chainParents`；builder 在**调用 `assertMassWithinCeiling`/`selectChangeShape` 之前**断言：各步导出的具名常量向量（落码时新增，与已有的 `WITHDRAW_INPUT_HAS_COVENANT`/`TICKET_RECLAIM_INPUT_HAS_COVENANT` 同型，如 `CLAIM_DRAW_INPUT_HAS_COVENANT=[true,false,true,false]`，四步现为 builder 内的字面量向量）与 `roles.map(r => chainParents[r]?.hasCovenant ?? false)` 逐项相等，且 `spkLen` 与现算 spk 长度相等。不符 ⇒ fail-closed，**在任何 mass/fee 计算前中止**。
- 目的：mass 的 plurality 取决于"该输入的父 UTXO 是不是 covenant/spk 多长"，这必须是**链上事实**，不能是 builder 里自己声明的常量（常量只是被交叉核对的一方）。

## 7. 每个调用点的负向回归（Codex 条件②）

对 seal / close_commit / convert_to_claim / claim_draw 每一步、对其**每个 covenant/ticket 输入角色**，都要有下列四类反向用例，**变异对照必红**（拆掉对应闸 ⇒ 测试变红）：

| 类 | 构造 | 期望 |
|---|---|---|
| ① 链上事实缺失 | 预期 outpoint 不在节点回报里（含：已被花掉、地址查询空、`get_address_utxos` 失败/超时） | 中止，不构造，不发 IPC；错误可区分"未落链/已花/查询失败" |
| ② 金额偏低 / 偏高 | 该 outpoint 面值 = 20M−1 与 20M+1（及 0、超大） | 中止（`<role>_value_drift`），不构造 |
| ③ 元数据相同、outpoint 不同 | 节点回报里存在**同 spk、同面值但 outpoint 不同**的 UTXO，而预期 outpoint 缺失 | 中止——**不得**退化成"取第一个面值匹配的"；并有正向对照：预期 outpoint 存在时放行 |
| ④ spk 或 covenant 分类错 | 预期 outpoint 存在且面值对，但 `scriptPublicKey` 不等于现算 spk，或 `covenantId` 有/无与角色表不符（如 ticket 被回报成 covenant、held 被回报成普通） | 中止（spk 不符 / `covenant_class_mismatch`），在 mass/fee 判定之前 |

另加：⑤ `chainParents` 与 builder 常量向量不符 ⇒ 在 mass/fee 前中止（§6.3）；⑥ 指针 `prepared_tx_json` 重算 txid ≠ `submitted_txid` ⇒ 中止（P5）。

## 8. close_commit 的同节点 pmt 门（条件⑤）与 SLA

- **同节点**：pmt 由 **R2 的 `get_past_median_time`（relay 自己的 RpcClient）**读出；提交交易的也是同一个 relay ⇒ 判据与 finality 检查同源。读不到/非法一律 `canSubmit=false`（fail-closed）。
- 判据沿用 `evaluateCloseCommitTiming({pastMedianTimeMs, deadlineMs})`（pmt 领先 deadline ≥ 30s 才放行）；驱动把**放行时读到的 pmt** 作为 `pmtEvidence` 传给 builder（builder 复核同一判据并免除 300s 墙钟余量，C3）；不传则 300s 墙钟守卫作第二层。
- **不用本地墙钟**判断能否提交（B4-2 根治）；墙钟只出现在 builder 的第二层守卫。
- SLA（以 pmt 计）：`≥ deadline+1h` ⇒ `warn` 报警；`≥ deadline+2h` ⇒ `refund_flip_open`（任何人可无签名把 `closed 0→2`，此后 close_commit 永不可入）。
- **`refund_flip_open` 时驱动行为**（Bettor 2026-09-19，本文落细）：仍尽力提交 close_commit（抢先）；若 C1 发现 RootClose 输入已不在预期 outpoint，则**额外**探测 `closed=2` 形态的 RootClose 地址（按同 state 现算 spk）是否有 UTXO：有 ⇒ 已被翻——意图置 `ambiguous`（`last_error='refund_flip_observed'`）+ 报警 `error`，**不重试、不重建**；取消/退款路径 v0 未实现（Bettor 裁定④），转人工。重复检测幂等（不重复报警）。
- **NotFinalized**（节点因 lock_time ≥ pmt 拒）：属"可重试、无状态变更"——走现有 prepared 行的**同字节重播**路径（`resolvePrepared` 的 replay），**不得**进 `ambiguous`（`ambiguous` 只留给 `inputs_spent` 且无正向证据）。需单测：注入 NotFinalized 拒绝 ⇒ 意图仍 `prepared`、下一 tick 重播同一字节。

## 9. 失败策略：不盲重试，先读链

- 构造前失败（C1/DB 派生/闸拒绝）：nothing broadcast，意图保持 `pending`，`last_error` 记原因，下一 tick 重评估；连续 N 次同因报警。
- 已 `prepared`（字节已落库）：**只允许同字节重播**（`resolvePrepared`：先 `get_mempool_entry`、再 `check_utxo_landed`、最后 replay）；**永不重建/重签**。
- 广播返回不明（超时/进程死/孤儿化 relay 子进程日志丢失）：视为"未知"，先链读（mempool → landed），不因"没有日志"就重发（既往教训：console 重启会孤儿化在飞的 relay 子，`没日志≠没发`）。
- `inputs_spent` 无正向证据 ⇒ `ambiguous`，人工，不自动放弃、不重建。
- 每 tick cap；同一 intent 单飞；`maxAttempts=1`（重试交给下一 tick，避免单 tick 被 sleep 阻塞）。
- 重启恢复：启动时跑 `resumeStaleSettlementIntents`（F3 已有）；`targetAddressFor(row)` 与 `relayIdFor(row)` 由驱动提供（本模块不碰业务表）。

## 10. 报警（沿用 `alertSettlementIntent` → `events` 表）

| 事件 | 级别 | 触发 |
|---|---|---|
| `settlement_close_commit_sla_warn` | warn | pmt ≥ deadline+1h 且 close_commit 未提交 |
| `settlement_close_commit_refund_flip_open` | error | pmt ≥ deadline+2h 且未 landed |
| `settlement_refund_flip_observed` | error | §8 探测到 closed=2 |
| `settlement_intent_ambiguous_*` | error | 沿用现有三个（inputs_spent / replay_txid_mismatch / prepared_without_bytes） |
| `settlement_signing_key_mismatch` | error | builder 的 `signing_key_mismatch`（claim_draw）；close_commit 的委员槽私钥/公钥不符同理 |
| `settlement_close_commit_args_not_from_db` | error | `assertCloseCommitArgsFromDb` 拒绝 |
| `settlement_chain_fact_drift` | error | C1 的 `<role>_value_drift` / `covenant_class_mismatch` / spk 不符 |
| `settlement_pmt_read_failed` | warn | 连续 3 次读 pmt 失败 |
| `settlement_relay_fee_rejected` | error | relay 返回 `net_loss_exceeded`/`implied_fee_exceeded`（fee 与 relay 天花板背离的早期信号） |
- `committeeMode='single_operator_5x_same_key'` **必须**写入意图记录/响应（B4-6，放 `last_error` 之外的位置：`proto_settlement_intents` 现无该列，**待裁定**：加列走迁移，或放 `prepared_tx_json` 旁的 events payload/响应体），不得把 close_commit 成功读成 4-of-5 门限安全。

## 11. 审计项（无绕过）

1. **withdraw/ticket_reclaim 不接线**：驱动模块、意图创建入口、HTTP 处理器**均不得 import** `buildWithdrawTxJson`/`buildTicketReclaimTxJson`；`/api/proto-markets/:id/withdraw` 保持 501 并在报文里写明"批9排除（目的地允许清单空 / T-FEE-PRICING）"。测试：扫描驱动/HTTP 源文件，出现这两个标识符 ⇒ 红。
2. **目的地闸**：任何将来接入 withdraw 的调用点**不得绕过** `assertWithdrawDestinationAllowed`，不得传 `destinationAllowlistSpkHex` 造出主网可用目的地（本批不接，此条防后人）。
3. **network 闸**：`network` 只取自配置（`KASPA_NETWORK`），**不得取自请求体/意图行/调用方**；`allowUnlistedTestDestination` 只在 `network !== 'mainnet'` 时生效，驱动**永不传**该标志。启动侧断言见 §3.7。测试：`git grep allowUnlistedTestDestination -- src/services src/api` 零命中。
4. **签名闸**：驱动层**永不接触私钥**（只传 `committeePrivkeyEnvelope`/让 builder 自取信封）；私钥值不出现在日志/events/响应/`prepared_tx_json`/意图列；`PrivateKey.free()` 在 builder 内（已测）。测试：以哨兵私钥跑全流程，扫描 stdout/events/DB 全文不含该值。
5. **DB 派生不可被入参覆盖**：close_commit 的 `newWinningSide/newPayoutRootHex` 不接受调用方传入，`/resolve` 只写 `winning_side`（write-once，P2），`payout_root` 由现算写入并与库内值交叉（`db_payout_root_drift`）。
6. **relay 边界不放宽**：驱动不新增 write 命令；R1/R2 只读；`covenant_broadcast` 仍要求非空 `signInputIndices`（四步都有 relay 签的 fee 输入，成立）。
7. **M0a 门**：驱动新文件不 bare-import `relay-manager`，只经 `protoSendCmd`（`lint-kanet` 的 M0a 差分门在 staged diff 上会验）。

## 12. 验收测试清单（落码时逐条要有，反向必红）

1. 开关 8 态 + 两种启动日志形状 + 关闭态零 IPC + 单飞 + unhealthy 跳过 + network/地址前缀一致（§3）。
2. 每步"通用顺序 1–9"的每一环各一个正/反向量；变异对照：拆掉任一闸（C1、DB 派生、pmt 门、chainParents 核对、依赖检查、指针 txid 校验）⇒ 对应测试变红。
3. §6/§7：角色表×调用点覆盖枚举测试 + 四类负向回归 × 每个调用点。
4. §8：pmt 同节点门（注入 rpc 假实现：读失败/非法/未到 deadline+30s/刚好到/跨 1h/跨 2h）、`pmtEvidence` 传递、NotFinalized 不进 ambiguous、refund_flip_observed 幂等。
5. §9：prepared 同字节重播、孤儿化不重发、`inputs_spent` 有/无正向证据两分支、重启恢复。
6. §11 各条审计测试（源文件扫描 + 哨兵私钥扫描）。
7. **relay 真代码校验**：四步的成品交易全部通过 `validateFixedValueOutputs`/`validateSignedInputCeiling`/`validateNetLoss`/`validateImpliedMinerFee`（同批8 ㉖ 做法）。
8. **端到端集成验证**：driver 开关在**隔离 simnet console**（KASPA_NETWORK=simnet，非主网 console）上开启，走一次完整 genesis→…→claim_draw（withdraw/reclaim 不走），每步记录：交易 version、编码器 commit、节点 sha256+`--version`、断言信号 vs 节点值（不等即停）、区块记录节点原始字段；证据入 `docs/provenance/<日期>-…`。
9. 合入前全套 proto 测试 + lint 0 error；迁移编号接主线末块（本设计**默认不加迁移**；committeeMode 列若要加则单列）。
10. 夹具真实性：所有 UTXO mock 的面值/spk/covenant 分类必须能追溯到一笔真实链上交易（ANTI-PATTERNS 候选：夹具与生产路径不一致族）。

## 13. 落码分批建议（每批先审后动）

| 批 | 内容 | 门 |
|---|---|---|
| 9-0 | **R1/R2**（relay 只读扩展 + 白名单一行）+ 测试 | NWT 审 + Bettor 批（P1 的裁定先行） |
| 9-1 | `proto-settlement-pointers.mjs`（P5）+ C1 调用点模块（含 `chainParents`）+ builder 小改（P6）+ 全部负向回归 | NWT 审 |
| 9-2 | 驱动分支 + 开关 + 启动日志 + `markSettlementLanded` + pmt 门接线 + SLA 报警 + 重启恢复 | NWT 审 |
| 9-3 | HTTP：`/resolve`（write-once + 鉴权，P2）、`/claim`（建 claim 行 + 意图）、`/bet` 上限校验（P3）、`/withdraw` 仍 501 | Bettor 批（用户面/鉴权） |
| 9-4 | 隔离 simnet console 端到端 + provenance | NWT 复核证据 |
| 主网开闸 | D-022 另开闸，Owner 终端点 GO | 不在批9内 |

## 14. 待裁定（不裁定则对应批不能开）

| # | 问题 | 我的倾向 |
|---|---|---|
| D1 | 采纳 R1（`get_address_utxos` 加 `scriptPublicKey`/`covenantId`）与 R2（`get_past_median_time`）？是否作为独立小批 9-0 先落？ | 采纳，独立先落；否则 C1 分类/pmt 同节点两条无法证明 |
| D2 | `/resolve` 的操作员鉴权用哪一套机制？未指定前主网 console 是否直接禁用该路由？ | 未指定前禁用（501），write-once 在任何环境都强制 |
| D3 | `committeeMode` 记在哪（加列迁移 / events payload / 响应体）？ | 不加迁移：写入 events payload + 响应体，意图表不动 |
| D4 | refund_flip 已翻后的终态：意图置 `ambiguous` 转人工（本文方案）是否可接受，还是要新增终态值（需迁移）？ | ambiguous + 专用报警，不加终态 |
| D5 | P3 的 `/bet` 上限校验（`已确认+在途 ≥ seal_count` ⇒ 409）是否由本批做？ | 做（防卡死 append） |
| D6 | fee 输入是否要求"取自 relay 节点回报的 UTXO 且面值 ≤ 1 KAS"之外再加上限/下限断言？ | 沿用现有 `selectFeeUtxoByConstruction` 与 relay 侧 `SIGNED_INPUT_CEILING`，不新增 |

## 15. 与 v0.1 清单的关系

v0.1 的 §1–§7 各条本文均继承；差异：① 范围收窄为四步；② C1 从"面值+spk"升级为"面值+spk+covenant 分类（链上事实）"并要求 `chainParents` 在 mass/fee 前核对；③ 明确 P1（R1/R2）为前置阻塞；④ pmt 同节点由"提醒"变成有具体通路（R2）；⑤ withdraw/ticket_reclaim 从"待补"改为"排除并有审计项"；⑥ 新增 P2–P5 的设计点（原 v0.1 未发现 F4/F6/F9/F13 这些现状缺口）。
