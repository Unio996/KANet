# J2 段1 交件：PayoutShardV2/CloseZkV2 自续约偏移合约修复 + 结算侧 consolidate/absorb 代币化（账本 1829 段1 / 1832）

分支 `coord/j2-pm-settle-tokenize-20261004`（只追加提交，无 amend/rebase）。证据 `docs/provenance/2026-10-04-j2-settle-tokenize-seg1/`。
simnet = 官方 kaspad 2.0.1（与主网同二进制 sha256 前缀 8afe6a68）；**未碰主网 env/代码/钱，未重启任何东西**（主网 kaspad 4752、console 3436 全程未动；我的 simnet kaspad/console/3 个 miner 已停；仅我自己的进程）。
**只合并，不部署。** 上一轮「受阻」报件 `2026-10-03T19-05Z-…BLOCKED…` 的缺陷现已修复并验收。

## 0. 结论（一句话）

段1 通过：`PayoutShardV2.absorb` 的自续约偏移缺陷已按 ShardLeaf(1469) 同款修好（ctor 加 `own_redeem_len`）；生产 builder + 生产编排在 simnet 官方 2.0.1 共识上**两片串行 consolidate+absorb 真上链**，4 条负向在真共识被拒且每条用 cli-debugger 定位到具体 `require` 行。**但「每个入口都有真共识证据」只做到了 absorb**——见 §6 未完成项（refund_claim/escape_claim/claim 的 builder 仍是旧 KAS 形，属段4，真共识只能随段4 builder 一起出）。

## 1. 合约改动（`.sil` 仅此三处，其余零改动）

| 文件 | 改动 |
|---|---|
| `PayoutShardV2.sil` | ctor 末尾加 `int own_redeem_len`（29→30 参数，不进 state）；**absorb**（:216 起）与 **refund_claim**（:574 起）两处自续约由 `ownSig.slice(0, …)` 改为 `ownRedeemStart = ownLen - own_redeem_len`，prefix/suffix 从 `ownRedeemStart` 起切（同 `ShardLeaf.sil:177-179`）。 |
| `CloseZkV2.sil` | ctor 末尾加 `int own_redeem_len`（27→28）；**escape_claim**（partial 分支）与 **claim**（partial 分支）两处同款修。 |
| 其余 | `close_attest`/`cancel_attest`/`zk_handoff`/`zk_close`/`escape_trigger` 没有读自己 sigScript 的自续约（用 `validateOutputState`/无续约），grep `activeInputIndex].sigScript` 全库只命中上面 4 处 + ShardLeaf(已修) + RootClaim(见 §6)。**Bettor 派工里点名的 close_attest/cancel_attest 不含此缺陷**（我读码+grep 核实，非猜测）。 |

数值：PayoutShardV2 编译长度 29288→**29314**（= own_redeem_len，不动点 1~2 轮收敛，`consolidated_pool` 等取值不变其长度——state 定宽）；CloseZkV2 **13328**（对所有市场恒定：state 定宽、bets/refund 各 32B、atMs 6B 定宽）。

### 连带 JS（29→30 / 27→28 参数的所有消费者，逐个 grep）
- `pool-shard-register.mjs`：`compilePayoutShardV2Redeem` 加可选 `ownRedeemLen`（不传=现场不动点收敛；传了=编译长度必须相等否则 **fail-closed**）；新 `convergePayoutShardV2OwnRedeemLen` / `convergeCloseZkV2OwnRedeemLen`（内存缓存）；`computeCloseZkTmplAnchor` ctor 补尾字段，**返回 `closeZkOwnRedeemLen`**（模板里内联了它，必须与 mint 同值）；`settleDispatchTags` 占位 ctor 补一位。
- `closezk-v2-mint.mjs`：`compileCloseZkV2Redeem` 带 own_redeem_len 并做长度 fail-closed。**连带暴露一个旧洞**：attestedAtMs ∈ [2^47, 2^48) 能过 `assertSixByteEncodable` 却因符号位编成 7 字节、redeem 长 1 字节；以前静默编出偏移错位的 redeem，现在被长度 fail-closed 拦（测试 `closezk-v2-mint-atms-width.test.mjs` 相应更新，业务门 [2^40,2^47) 本就拦它）。
- `committee-offset-derive.mjs`：V2 占位 ctor 补一位（**占位值必须与真实值同 minimal-push 宽度**，真实≈29.3K 为 2 字节数据，占位取 29300——因 own_redeem_len 被内联进 absorb/refund_claim，宽度不同会平移其后 close_attest/cancel_attest 的偏移）；V2 参考偏移 `16569/[17089,…]` → **`16582/[17102,17398,17694,17990,18286]`**（整体 +13，tripwire 测试以独立真编译核过）；N2 夹具行号 312→320。
- 无需改动：`p2sh.mjs` 里 PS/CloseZk 的 splice 偏移（state 区仍 offset 1 / 288B、213B 不变）、`bshard-payout-family-coherence`（重编走 `compilePayoutShardV2Redeem` 自动收敛，测试全绿）。

### 三个冻结 hash 变不变
**`ZK_GATE_TMPL_HASH` / `ZK_TOKEN_TMPL_HASH` / `ZK_CLAIM_TMPL_HASH` 都不变**（gate=独立合约；token/claim=KanetTestToken/KanetTokenClaim 源码未动；`ZK_MARKET_SUFFIX_HASH` 是常量串）。**变的是 `closeZkTmplAnchor`**——它不是 env 而是建市场时对当前 `CloseZkV2.sil` 现算、烤进 PS ctor 的值：同三 hash 下 `dd3382b7…`（旧 CloseZkV2）→ **`80bdceda33127430be2493cf6b2b12a7b1d70d9d3bb4da68ebbb8ca19719c5ec`**（新）。无人工动作；但**修复前已建的市场（旧合约）absorb 永远过不了**——「移植前不开放下注」使其不应存在，主网侧请 Bettor 自查有无遗留 PayoutShardV2 市场（我不碰主网）。

## 2. 结算侧（段1）

沿用上一轮 WIP（已在分支）：`unlockBshardConsolidateV2` 代币版、`consolidateAllShards({tokenized:true})`、PS 创世 `consolidatedPool` 0、`settleDispatchTags()`、`BSHARD_CONSOLIDATE_V2` 加 `witness` 字段。本轮增量：
- **计算预算**：合约修好后 absorb 要对 ~29KB 自身 redeem 重建+blake2b+切片，真共识实测 PS 输入 `used=1032394 > limit=1009999`（budget 100，第 2 片带 2 个代币输入时撞）⇒ ≥104；**PS 输入取 130，其余输入 100**（`cmd.compute_budget_ps` / `cmd.compute_budget` 可覆盖）。
- **复用声明**（第一原则）：复用 `unlockBshardRegister` 的 tok_out genesis 绑定（`populateGenesisCovenants` 授权=fee 输入）、`_encodeKttTransferZeroOutAction`、`_combineActionAndRedeem`、v1.0.0 `addI64+addData+4字节 dispatch_tag` action 编码、`_matchUtxo/_assertTxInvariants`、`computeKttTokenArtifact`、register 侧 `market_shards.current_token_outpoint`；**不能复用**：旧版 KAS 价值焊接（`psOutValue=in.value+poolValue`）与 2-int 裸选择器——叶子 KAS 侧只剩 dust，价值载体是代币。

## 3. simnet 真共识证据（run3 = 正式；`seg1_acceptance_run3.log(.txt)`，市场 `ext-pool-v07-1791066816493-6c06p`，2 片：3000000000 + 500000000）

### 3.1 正向：生产 `consolidateAllShards({tokenized:true})` → 生产 relay `bshard_consolidate_v2`
- 片0 consolidate tx `21cd7ef4eca45f4a32a84a2081fd4fa7f10525fa385bc31ac4a61dc7a8ec4311`（中途模拟崩溃，DB 未回写）→ 生产 `autoDetectConsolidateResume(tokenized)` 自愈续跑片1：tx **`df5a3d552597960d406b0426d7dda38ca56a6641d107b3a0a1e6f8ad271c4714`**（块 `da41cb75…`，DAA 13925）。
- 链上原文（`seg1_txevidence.json`，按块读）：5 输入 [0 PS sig 32413B budget 130 | 1 ShardLeaf 17327B | 2 shard 代币 3215B | 3 PS 已持有代币（片0 的 tok_out，`21cd7ef4…:1`）3215B | 4 fee P2PK 66B]；3 输出 [0 PS 续约 20000000 带 covenant `8cd8a817…`(=PS cov) authInput 0 | 1 tok_out 60000000 带**新 covenant** `11c83a07…` authInput 4 | 2 找零]。
- **读回 before/after（按 UTXO，非 mempool）**：before = PS 创世 UTXO `7af4dfa3…:0`（20000000 = dust，`consolidated_pool=0`）；after = PS UTXO `df5a3d55…:0`（20000000 dust）+ **PS 名下代币 UTXO `df5a3d55…:1`**（代币 amount 3500000000 = 3e9+5e8，owner=PS cov）；两片的 leaf UTXO 与 shard 代币 UTXO 全部为 0（已销毁/消费）。
- 节点原文：honest tx 被接受（入块，见上）；负向见 3.2。

### 3.2 负向（同一未动状态上，共识拒收 + cli-debugger 定位 `PayoutShardV2.sil` 行）
共识拒收原文统一：`Rejected transaction <txid>: failed to verify the signature script: script ran, but verification failed`（`seg1_acceptance_run3.log`，每条另有 `dbg_<N>.out.txt` 全文）。

| 用例 | 篡改 | 共识 | cli-debugger 失败行（真实 tx 字节） |
|---|---|---|---|
| **N1 多铸 1** | tok_out amount = pool_value+1 | 拒 `165aec5e…` | **:178** `validateOutputStateWithInputTemplate(tok_out, TokenState{amount: consolidated_pool+shard_amount, …})` |
| **N2 owner 错** | tok_out owner = leaf cov（≠PS cov）| 拒 `9c0ca64d…` | **:178**（同一 require：owner 字段） |
| **N3 自续约输出被改** | PS 续约 state.closed 0→1 | 拒 `e01bca09…` | **:224** `require(tx.outputs[selfOutIdx].scriptPubKey == byte[](expectedSpk))`（**正是本次修的那行**：修前对诚实 tx 也会在此失败，修后诚实过、篡改拒） |
| **N4 shard_amount 谎报** | 见证 shard_amount+1 | 拒 `74be9e0a…` | **:173** `require(shardTk.amount == shard_amount)` |
N1/N2 绕过了 relay 的 `owner_cov_id_hex` 预检（不带该字段），让共识/合约自己拒——证明防线在合约层而不是 builder 层。负向后 shard0 leaf UTXO 仍在（`still present: true`），链上状态未动。
> run1（`run1_budget100/`）是同样 4 条在另一份同状态市场上的结果（行号 178/178/224/173 一致），因当时 reqLine 提取正则有误只在 `.out.txt` 里可信；run2（`run2_state_already_partially_consumed/`）**作废**：console 重启后 shard0 已被 run1 的 P1 先 consolidate，负向命中 :171（`owned_total==consolidated_pool`）是状态不对而非本意——保留作过程证据，不作验收依据。

### 3.3 代币模型与「不超铸、只铸给 PS cov」的 require（file:line，修后行号）
模型：**shard 代币**走 KTT `transfer` zero-out 销毁（`next_states=[]`，`sum_in>=sum_out=0`，owner 输入=ShardLeaf cov）；**`tok_out`** 是新 genesis 实例（`populateGenesisCovenants` 授权=fee P2PK 输入——KTT 本身免费可铸，所以防线不在「谁能铸」而在「铸出来归谁、多少」）。
- `PayoutShardV2.sil:108`（scanOwnedTokenInputs）/`:130`/`:152`：`blake3(tok_prefix‖tok_suffix…) == token_tmpl_hash`——模板由 witness 供、现场核 hash，不信 witness 本身。
- `PayoutShardV2.sil:171` `require(owned_total == consolidated_pool)`：PS 名下既有代币数 = 账本数（防凭空多算）。
- `PayoutShardV2.sil:173` `require(shardTk.amount == shard_amount)`（N4）。
- `PayoutShardV2.sil:176` `require(shardTk.owner != OpInputCovenantId(this.activeInputIndex))`；`:177` `require(countStrayNonOwnedTokenInputs(…) == 0)`（账本 1208：本笔无任何未被点名的陌生同模板代币输入——防「一笔销毁两片只铸一份/多片混入」）。
- **`PayoutShardV2.sil:178-186` `validateOutputStateWithInputTemplate(tok_out, TokenState{ amount: consolidated_pool + shard_amount, owner: OpInputCovenantId(this.activeInputIndex) /* = PS cov */, owner_scheme: 0x04, borrow_scheme: 0x00, borrow_guard/extension_commitment: 0 }, shardInIdx, …, token_tmpl_hash)`** ——**金额上限与 owner==PS cov 的承重行**（N1 多铸 1、N2 owner 错都死在这里；模板取自 shard 输入自带 redeem，故输出必是同一 KTT 模板）。
- `PayoutShardV2.sil:224` 自续约 spk 重建（本次修复）；`:225` `value >= DUST_MIN`。
- `ShardLeaf.sil:207` `require(ps_cov == payout_cov_id)`（`OpInputCovenantId(psInIdx)`：输入必是真 PS 实例，防假 PS 抢归集）；`:208` `OpCovOutputCount(ps_cov) >= 1`；`:211` `OpOutputCovenantId(psOutIdx) == payout_cov_id`；`:212` `value>=DUST_MIN`；`:228` `require(owned_total == pool_value)`（leaf 手上代币恰好等于其全部持仓）。
- 说明：`tok_prefix/tok_suffix` 模板校验 = 上面 `:108/:130/:152` 的 `token_tmpl_hash` 现场核；「owner==OpInputCovenantId」= `:180`。

## 4. `consolidated_pool` / `PS_SEED` 全仓读取方审计（Bettor 追加问题①）
Explore 子 agent 读码出表（~55 行，我对关键 2 项人工复核了源码）。**结论：段1 已写的 consolidate 路径内无任何 `value==state` 残留判断**（`autoDetectConsolidateResume` 已改比 `PS_SEED`；`pool-shard-register.mjs` V2 创世解耦；`pool-shard-settle.mjs` 其余只读 state 字段/代币单位）。仍带 `value==state` 假设、**按段归属**：

| 段 | 位置 | 问题 |
|---|---|---|
| **段2 之前（⚠新发现，影响 close_attest 委员签字）** | `bshard-close-enforce.mjs:305-318`（D2-V2 N3） | 要求续约输出 `value == consolidated_pool`；V2 链上改为 `>= DUST_MIN`，PS 面值是 dust 而池是代币单位 ⇒ **委员会会拒签 close_attest**（人工复核成立）。 |
| 同上 | `bshard-close-enforce.mjs:929-940`（C1 PS-pool 链锚） | `psPool == PS_SEED + Σloaded`；V2 池是 Σstake 无 seed ⇒ 若 V2 校验路径喂 `psConsolidatedPool` 会误拒（**是否被 V2 喂入我只确认了喂入点读 redeem，需段2 实测**）。 |
| 段2 | `p2sh.mjs unlockBshardZkHandoff`、`bshard-close-transport.mjs:591-636`、`zk-autonomy-ticks.mjs:342` | 融资需求 `feeSompi=consolidatedPool`、KAS 输出值=pool、`zkCont.valueSompi=consolidatedPool` 把代币量当 KAS；合约 `zk_handoff` 要 `zkOut.value>=DUST_MIN`+token 腿，builder 缺 token 输入/`tokenOutIdx`。 |
| 段3 | `unlockBshardZkClose`、`zk-close-dispatch.mjs:104`、`rehearsal-pre-broadcast-gate.mjs:83-102/171` | 输出值=pool（输入只有 dust ⇒ 不成立）。 |
| 段4 | `unlockCloseZkV2Claim/EscapeTrigger/EscapeClaim`、`unlockBshardRefundClaim`（V1 形）、`rehearsal-pre-broadcast-gate.mjs:189-258`、`zk-autonomy-ticks.mjs:214-216` | 全是 KAS 腿，合约是代币腿。 |
| V1 范围外 | `bshard-auto-settler.mjs`、`bshard-settle-daemon.mjs`、`unlockBshardConsolidate/PayoutClaim/CloseAttest`(V1)、`pool-shard-register.mjs:106/293` 的 V1 PS_SEED | 保持旧形。 |
**顺带发现（审计）**：`rehearsal-pre-broadcast-gate.mjs` 与 `CloseZkV2.test.json` 夹具是 25 参数旧 ctor（T3 前），与当前合约（28）早已脱节，其 selftest 绿灯验证的是旧形；且 cli-debugger 默认路径指向非 pin 的 release exe。**这些「已知良好」夹具用裸 redeem 当 sigScript，所以掩盖了本缺陷**（同我上一轮的对照实验）。

## 5. 单测 / lint（全部实跑）
- 新增 `own-redeem-len.test.mjs`（源码 tripwire：凡读自身 sigScript 的 .sil 必须用 own_redeem_len，已知未修清单 `PayoutShard.sil`/`RootClaim.sil` 显式列出；PayoutShardV2/CloseZkV2 收敛+fail-closed）、`pool-shard-settle-tokenized.test.mjs`（编排：两片命令形状/ps_token 跟踪/tok_out 金额/空片跳过/缺字段 fail-closed/resume 探 PS 名下代币恰 1 笔）：**ALL PASS**。
- 既有回归（受 ctor 变动影响的）：`committee-offset-derive`、`payoutshardv2-offset-tripwire`、`bshard-payout-family-coherence`、`closezk-v2-anchor-crosscheck`、`closezk-v2-mint-atms-width`（已更新）、`closezk-v2-mint.ctor-position`、`closezk-v2-mint.e2e`、`bshard-close-transport-zk-tmpl-coherent`、`rehearsal-pre-broadcast-gate(.claim).selftest`：全绿。`zk-prove-enqueue.test.mjs` 在我的空库上报 `no such column: id`（需迁移后的库，非本改动相关，未跑通）。
- `lint-kanet`：0 errors（均为既有 538 条 doc 警告）。

## 6. 未完成 / 需要拍板
1. **每入口真共识证据只做到 absorb。** `PayoutShardV2.refund_claim`、`CloseZkV2.escape_claim`/`claim` 的修复已落合约并过编译/收敛/偏移回归，但**它们的 relay builder（`unlockBshardRefundClaim`/`unlockCloseZkV2Claim`/`unlockCloseZkV2EscapeClaim`）仍是旧 KAS 形+裸选择器**，造不出可上链的诚实 tx，所以「诚实过+篡改拒」的真共识证据**只能随段4 builder 一起出**；我没有用 cli-debugger 凭合成夹具冒充（上述夹具本身就是旧形）。段4 验收会逐入口补。
2. **`RootClaim.sil` 同缺陷（:192-195）我没修。** 理由：它属 proto-v0 线，不在 zk_native 结算路径，修它要联动 RootClose/ShardLeaf_direct 的逐市场模板 hash 链 + 17 个 proto 文件/黄金样本；上面说明且 tripwire 测试已把它列为「已知未修」。**需 Bettor 定：本轮不修 / 单开一票。**
3. **`bshard-close-enforce.mjs` D2-V2 N3 与 C1（§4 表首两行）是段2 的前置**——这是委员会验证门（攻击面），按规矩需 NWT 审；我建议段2 一并改：N3 改为 `>= DUST_MIN`（或 `== in.value`），C1 对 V2 去掉 `PS_SEED` 项。**等 Bettor/NWT 点头再动。**
4. 顺带的两条小发现：计算预算已折进（见 §2）；**终局中位时间滞后**（`ZK_JUDGE_PROPOSE` 只等 `deadline_daa+60`，实测 partial 片需 deadline 后 ~270s 才过 `not finalized`）不是小改（要定「放宽门」还是「把 not-finalized 归为可重试」），**留段2**。
5. **费用观察**：relay `mass-floor:observe` 对 consolidate 报 `mass_ub=227304 minFee=22730400 > actualFee=20000000 would_reject=true`，但节点实收（上界估计保守，wasm 对 v1 covenant 的 mass 计算 panic）；固定 fee 20M 在 simnet 2.0.1 实测可行，精算留后续。
6. 段2~4 未动；本段**不含** apiTransfer admin 头 / p2pk 网络 / 检查单 #4-#7（归各自段）。V1 委员会路径仍旧形的函数清单：`unlockBshardConsolidate`、`unlockBshardPayoutClaim`、`unlockBshardCloseAttest`(V1)、`consolidateAndBuildPsState`(bshard-settle-daemon)、`bshard-auto-settler.mjs` 全部、`PayoutShard.sil`。

## 7. 复现
`docs/provenance/2026-10-04-j2-settle-tokenize-seg1/`：`setup.mjs/fund.mjs/start_console.sh POOL_DEADLINE_MIN_OVERRIDE=2`（simnet harness，relay `api.mjs` simnet 补丁仅本地应用，**已 `git checkout` 还原、未提交**）→ `s1_committee`/`s2_create`/`s3_bets`/`s4_bet_c` → `seg1_acceptance.mjs`（等 deadline+270s；负向 + 崩溃/续跑 + 读回）→ `seg1_txevidence.mjs <txid> <blockHash>`。
