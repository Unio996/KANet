# J2 段2 交件：zk_handoff 代币化 + 委员会门误拒修复 + judge 中位时间缓冲（账本 1832 段2）

分支 `coord/j2-pm-settle-tokenize-20261004`（只追加提交：`16166ee1`、`c2281c6e` + 本交件提交）。证据 `docs/provenance/2026-10-04-j2-settle-tokenize-seg2/`（harness 沿用段1 目录）。
simnet = 官方 kaspad 2.0.1。**未碰主网 env/代码/钱、未重启任何主网进程**（主网 kaspad 4752、console 3436 全程未动；我的 simnet kaspad/console/4 个 miner 已停；relay `api.mjs` simnet 补丁已 `git checkout` 还原、未提交）。仅合并，不部署。

## 0. 结论

**段2 通过：用【干净提交的生产代码、零手工 DB 操作】在 simnet 上从零跑通 judge+propose → consolidate(段1) → 委员 V2 voter 签（含修好的 N3/C1 门）→ submit close_attest V2 落链 → zk_handoff 真共识**（run2，`seg2_handoff_run2.log.txt`）。zk_handoff 的 4 条负向在真共识被拒、cli-debugger 定位到 `PayoutShardV2.sil` 具体行；诚实 handoff 走【生产 admin 端点 `/api/admin/pool/zk-handoff-v2` → `buildZkHandoffRequestV2`】落链，读回按 UTXO + 按块。

**但范围比派工大：** 真跑生产自治链才暴露 4 个派工单里没列的「结算侧 + 委员门」陈旧点（§3），其中 2 个动了委员会验证路径，**需 NWT 一并审**（§5）。

## 1. zk_handoff（合约不改，builder/编排重写）

`PayoutShardV2.zk_handoff(zkOutIdx, tokenInIdx, tokenOutIdx, tok_prefix, tok_suffix, templateA..D)`：
- **relay `unlockBshardZkHandoff`**（`p2sh.mjs`）整体重写（旧版是 KAS 价值焊接 + 裸选择器 `'54'`，对 v1.0.0 合约必败）：
  - inputs `[0 PS(zk_handoff) | 1 PS 名下代币(KTT.transfer zero-out, owner idx [0]) | 2 fee P2PK(签名, 且是两个 genesis 组的授权输入)]`
  - outputs `[0 zkOut(新 CloseZkV2 genesis, 值=PS 面值 dust, genesis 组A) | 1 tokOut(新 KTT, amount=consolidated_pool, owner=新 CloseZkV2 的 covenant id, genesis 组B) | 2 找零]`
  - **zkCovId 循环依赖的解法**：tokOut 的 redeem 烤着 owner=zkCovId，而 zkCovId 由 genesis 组A 现算 ⇒ 两步：①probe（无 `outputs.tok_out` ⇒ relay 只返回 zkCovId，不签不广播）②console 用 zkCovId 编 tok_out 回传，relay 核对 `owner_cov_id_hex==zkCovId`（fail-loud）再签发。实测同一 fee 输入可授权两个 genesis 组，probe 与最终 covenant id 一致。
  - 保留：CloseZkV2 genesis redeem 重构公式、`dryRun`（现返回逐输入/输出真实字节 + prev outpoint，供 cli-debugger）。
  - 复用（第一原则）：段1 的 `populateGenesisCovenants` 组、`_encodeKttTransferZeroOutAction`、`_combineActionAndRedeem`、v1.0.0 `addI64/addData + dispatch tag` 编码、`computeKttTokenArtifact`、`get_address_utxos`；**不能复用**：旧版 `outputs[self]=consolidatedPool` 的 KAS 面值（输入只有 dust）、旧 fee 输入「精确==pool」。
- **console `buildZkHandoffRequestV2`**：PS 名下代币由确定性地址探（`get_address_utxos`，必须恰 1 笔，否则 fail-closed）；取代旧「往 relay 转一笔 pool 数额 KAS 当 fee 输入」。`settleDispatchTags()` 增 `zk_handoff`/`close_attest`。
- **settler 资金需求重算（派工要求）**：旧 = 每盘需转入 `consolidated_pool` 数额的 KAS（可达数百 KAS）；**新 = 只付网络费**：consolidate 每片 0.3 KAS 自转 fee、close_attest 固定费 0.1 KAS（见 §3-③）+ propose 前 0.5 KAS 注资、handoff 0.3 KAS（`HANDOFF_FEE_SOMPI=30M`，找零回 settler）。池的价值全在代币里，KAS 侧只剩 dust（PS/CloseZkV2 各 0.2 KAS，tokOut 0.6 KAS 为输入面值之和）。
- 计算预算：handoff PS 输入取 200（未最小化，留余量）；其余 100。

## 2. 真共识证据（run2，市场 `ext-pool-v07-1791070773452-lxj1k`，2 片 3e9+5e8）

### 2.1 前置链全部由生产自治 tick 完成（无手工）
- 23:50:25 `zkJudgeProposeAutonomousTick` judge+propose；consolidate 两片**首轮即过**（**验证 §4 中位时间缓冲：deadline+300s 才进候选，没有再出现 `input #0 is not finalized`**）。
- 5 位 V2 voter 签（日志无 REFUSED）→ submit V2 → close_attest tx `52fbabf97665f2217cfc9fc5e27a4eed76f05dcffe37a8d4c576122002155f54` 落链（块 `e13a620c…`，DAA 32670；PS 输入 sigScript 34366B、预算 100；fee 输入预算 70；输出 0 = PS 续约 20000000 带 PS covenant）。
- `closed==1`、`pool=3500000000`、`winner=0`。

### 2.2 zk_handoff 负向（同一未动状态；每条 dry_run 真字节 → cli-debugger 行 + 真共识拒收；`dbg_H*.out.txt`）
共识拒收原文统一：`Rejected transaction <txid>: failed to verify the signature script: script ran, but verification failed`。

| 用例 | 篡改 | 共识 | debugger 失败行（`PayoutShardV2.sil`） |
|---|---|---|---|
| H1 代币少转 1 | tok_out amount = pool−1 | 拒 `6300f3fc…` | **:659** `validateOutputStateWithInputTemplate(tokenOutIdx, TokenState{amount: consolidated_pool, owner: zkCovId…})` |
| H2 owner 错 | tok_out owner = PS cov（绕过 relay 预检）| 拒 `e8d66714…` | **:659**（同 require：owner 字段）|
| H3 模板被改 | templateA 末字节翻转 | 拒 `d25fa276…` | **:625** `require(blake2b(templateA+B+C+D) == closeZkTmplAnchor)` |
| H4 state 被改 | betsRootBaked 翻转 | 拒 `51d87971…` | **:644** `require(tx.outputs[zkOutIdx].scriptPubKey == P2SH(expectedCloseZkRedeemHash))` |
负向后 PS/PS 名下代币 UTXO 仍各 1 笔（`negativesLeftStateUntouched:true`）。

### 2.3 诚实 handoff + 读回
- tx **`29dc2749c272c49dc8961315c842314ef2e562622b3c182d860d1337ba49486d`**（块 `93455cd2…`，DAA 32880；按块读 `seg2_handoff_tx_onchain.json`）：3 输入 [PS 45463B/预算200 | PS 名下代币 3215B | fee 66B]；输出 0 = 新 CloseZkV2 20000000 **covenant `298a6162…`（== probe/返回的 zkCovId）authInput 2**；输出 1 = 新 KTT 60000000 covenant `01cb4745…` authInput 2。
- **读回（按 UTXO）**：before = PS UTXO 1 笔(20000000) + PS 名下代币 UTXO 1 笔(60000000)；after = **二者皆 0**；新 CloseZkV2 UTXO 1 笔(20000000, `29dc2749…:0`)；新 KTT UTXO 1 笔(`29dc2749…:1`，amount 3500000000，owner=新 CloseZkV2 cov)。生产写入 `pool_markets.metadata.zk_continuation`（outpoint/redeemHex 同上）。
- run1（`run1_dbg_genesis_schema_miss/`）：同一流程的第一次真跑（含需手工重置的 3 个陈旧点，§3），4 负向共识拒 + 诚实 handoff `abd200b6…` 落链；debugger 当时因我 harness 没带 genesis 输出的 `authorizing_input`/prev outpoint 报 `WrongGenesisCovenantId` 无行号——run2 已修，保留作过程证据。

## 3. 真跑暴露的 4 个陈旧点（均已修，单测/真共识覆盖）
1. **命门①（propose 前核对）**：`bshard-close-transport.mjs` 硬编码 `redeem[642]` 并拿 `market_metadata_hash` 比——① 642 是 v1.0.0 之前的布局；② B线落2 后 genesis 烤的是 `deriveMarketPredicateCommit(market)`（含 fee_rules），早已不等于 metadata hash。**对任何真实 V2 市场必 mismatch，此前卡在 consolidate 从没跑到这里。** 改：期望 = 单源 `deriveMarketPredicateCommit`，偏移 = `committee-offset-derive` 现算（新 `assertPredicateCommitBakedInPsRedeem` + 单测 `propose-predicate-commit-anchor.test.mjs`）。
2. **voter C1 级2-B `deriveTicketAddr`**：用 legacy `PoolSide_v08_shard.sil` + legacy 编译器，而 register 铸 ticket 已是 v1.0.0 `PoolSideTicket`（`computePoolSideTicketArtifact`）⇒ 字节不同 ⇒ **5 位委员对任何新市场全部拒签**（`REFUSED: C1 anti-swap: … PoolSide ticket 链上不存在`）。改走同一个 artifact 函数（单源，与 register 同码）。⚠ 这是委员会验证门，超出 Bettor 批的 N3/C1-seed 两项，**请 NWT 审**。
3. **close_attest V2 的 relay 提交端未移植 v1.0.0**（`unlockBshardCloseAttestV2` submit 模式仍是裸 `'51'` 选择器、无 tok_prefix/suffix、费用固定 2M）：节点实测依次报 `script returned early` → `script units exceeded (used 710177 > 709999)` → `fees 2000000 under required 6954600 (mass 69546)`。改：v1.0.0 形（`addI64/addData` + `tok_prefix/tok_suffix` + dispatch tag；缺席委员槽 `'00'`→空 sig `OP_0`，与旧语义一致）、PS 输入预算 70→100、**固定费 10M（preimage 与 submit 共用同一行，保证委员签的 outputs 与最终 tx 一致；已实测 compute_budget 不进 sighash，改预算不致委员签名失效，但费用/找零会）**。console 侧 `submitCloseAttestV2` 补传 KTT 模板与 tag。
4. **`bshard-close-enforce` 两处误拒**（Bettor 批 d，已列）：V2 N3 `value==consolidated_pool` → `>= DUST_MIN`；C1 PS-pool 链锚 V2 入口强制 `psSeed=0`（V1 仍 20M）。

## 4. judge 中位时间缓冲（Bettor 批 c）
`zk-autonomy-ticks.mjs`：候选加【墙钟】门 `deadline(秒)+300s`（`ZK_JUDGE_PROPOSE_MEDIAN_LAG_MS` 可调，默认 300000；与原 DAA 门同时满足），`not finalized` 错误归为静默冷却重试（不再写 critical 噪音事件）。依据：段1 实测 +100s 仍拒、+270s 才过。run2 首轮 consolidate 即过。单测 `zk-judge-propose-median-lag.test.mjs`。**注意：simnet 的 DAA/中位时间比与主网不同，300s 是 simnet 实测下界+余量，主网 10bps 下的滞后需 Bettor 在主网 env 里按实测校；可用 env 调。**

## 5. 委员会验证门改动 + 「真坏的 close_attest 仍被拒」负向（Bettor 要求；`bshard-close-enforce-v2-tokenized.test.mjs`，ALL PASS）
改动最小化，每项一句话：
- **N3**：`gotValue !== consolidated_pool` → `gotValue < 1000`（镜像链上 `value >= DUST_MIN`）。
- **C1 seed**：V2 入口 `{...ctx, psSeed: 0}`（按家族强制，不接受 ctx 覆盖）；锚强度不变（池==Σstake）。
- **ticket 派生**（§3-2）：legacy → v1.0.0 artifact。
负向（全部拒）：N3 value 999 / 非整数；续约 spk 烤了别的 payoutRoot（settler 篡改）；两个 covenant continuation；tx.version<1；无 covenant 绑定输出；声称 attestedWinner 与被签 spk 不符；C1：池比 Σstake 多 1、池少一片（漏片变体①）；对照：V1 口径 seed=20M 会误拒 V2 池（证明强制 seed=0 的必要）。正向：诚实 V2 close_attest（续约值=PS dust）通过；边界 value==1000 通过。
**未覆盖/诚实标注**：C1 级2-B 的 ticket 派生修复我只用真跑的 voter 通过来证（simnet 5 位委员签成），没有单独的单测（该函数是 voter 内闭包，未导出）；变体②（settler 提前 close 子集）本就是已知开口，未动。

## 6. 单测 / lint（实跑）
新增并 ALL PASS：`bshard-close-enforce-v2-tokenized`、`zk-judge-propose-median-lag`、`propose-predicate-commit-anchor`（+段1 的 `own-redeem-len`、`pool-shard-settle-tokenized`）。回归：`fee-single-source`、`bshard-close-transport-zk-tmpl-coherent`、`bshard-close-enforce.psv2-read` 全绿。lint 0 errors。

## 7. 未做 / 给段3 的交接 / 需拍板
1. **zk_handoff 自治 tick（`ZK_HANDOFF_TICK_ENABLED`）未在 simnet 开**——本段用的是同一函数 `buildZkHandoffRequestV2` 的 admin 端点（生产入口，非脚本拼装），tick 只是调度；`zk-autonomy-ticks.mjs:342` 把 `valueSompi=consolidatedPool`（token 量）当 KAS 值持久化，**段3 zk_close 前必须拆开「KAS 面值」与「token 池」两个字段**（审计表段3 项）。
2. **ZK prove 入队对多片市场拒绝**（`enqueueZkProveJob: … 有 2 个 shard — ZK-native 目前只服务单片`，既有限定）：**段3 的 simnet 市场必须单片**（我段1/段2 的 s4 为覆盖「PS 持有代币」造了 2 片，段3 改回单片）。
3. handoff 的 PS 输入预算 200、fee 30M 未精算；close_attest 费用 10M 为实测下界(≈6.95M)+余量，未按 mass 动态算。
4. 仍旧形（未动）：zk_close/claim/escape 全部 builder（段3/4）、V1 委员会路径、`bshard-auto-settler`/`bshard-settle-daemon`。
5. **需 Bettor/NWT**：§3-2（voter ticket 派生）与 §3-3（close_attest 费用/预算，money-path）按资金路径审；§4 的 300s 主网值。

## 8. 复现
`docs/provenance/2026-10-04-j2-settle-tokenize-seg1/`（setup/fund/set_oracle/start_console + `s1~s4`）→ console 额外 env：`ZK_JUDGE_PROPOSE_TICK_ENABLED=1 BSHARD_CLOSE_VOTER_V2_ENABLED=1 BSHARD_CLOSE_SUBMIT_V2_ENABLED=1 BSHARD_SETTLER_RELAY_ID=<settler> SETTLE_DAEMON_FEE_RELAY_ID=<同> ADMIN_ZK_HANDOFF_V2_ENABLED=1 ADMIN_SECRET_ZK_STATE_PREP=…`（**不开** `ZK_HANDOFF_TICK_ENABLED`）→ `docs/provenance/2026-10-04-j2-settle-tokenize-seg2/seg2_handoff.mjs`（等 close_attest 落链，跑负向+诚实+读回）→ `seg2_findtx.mjs <lowBlock> <txid>`。
