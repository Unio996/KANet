# J2 段1 受阻报件：PayoutShardV2.absorb 存在 1468 同类「自续约从 sigScript 第 0 字节切片」缺陷——合约本身不可能被诚实交易满足（账本 1829 段1）

分支 `coord/j2-pm-settle-tokenize-20261004`（WIP，已推远端，**未完成，勿合**）。证据 `docs/provenance/2026-10-04-j2-settle-tokenize-seg1/`。
simnet = 官方 kaspad 2.0.1（与主网同二进制 sha256 前缀 8afe6a68）；未碰主网 env/代码/钱（主网 kaspad 4752、console 3436 全程在跑未动）。

## 0. 结论

1. **段1 的 builder 与编排已写完并推到真共识**：relay `unlockBshardConsolidateV2` 重写成代币版 + console `consolidateAllShards({tokenized:true})` + PS 创世初值 0 + dispatch_tag 助手；tx 能构造、签名、过预检，**共识阶段在 `PayoutShardV2.sil:216` 被拒**。
2. **根因在合约、不在 builder**。cli-debugger（D-019 pin 的 cli-debugger-v100-3ed9733）用我生产 builder 的 dry_run 导出的**真实 tx 字节**跑 `PayoutShardV2.absorb`：
   ```
   FAIL absorb_real_tx   error: script ran, but verification failed  --> 216:9
   216 |  require(tx.outputs[selfOutIdx].scriptPubKey == byte[](expectedSpk));
   ```
   该 require 之前的所有检查（`scanOwnedTokenInputs==consolidated_pool`、`readInputStateWithTemplate`、`shardTk.amount==shard_amount`、`owner!=self`、`countStray==0`、`validateOutputStateWithInputTemplate(tok_out…)`）**全部通过**（执行顺序在 216 之前）。
   **对照实验**：同一份 tx、仅把 PS 输入的 `signature_script_hex` 换成「裸 redeem」（29288 B，链上不可能出现），`absorb` **PASS**（`dbg_absorb_control.test.json`）。⇒ 唯一问题就是 sigScript 偏移。
3. **机理（与账本 (1469) 一字同族）**：absorb 的 V-T-8 绕路自续约写成
   `ownPrefix = ownSig.slice(0, OWN_PREFIX_LEN); ownSuffix = ownSig.slice(OWN_PREFIX_LEN + OWN_STATE_LEN, ownLen)`（`PayoutShardV2.sil:~205-212`），把 `ownSig = tx.inputs[active].sigScript` 当成**裸 redeem**。真实 sigScript = action 见证 ‖ push(redeem)（本 tx PS 输入 sigScript 32,388 B，其中 redeem 29,288 B），切片落在见证内部 ⇒ `expectedRedeem` 永远 ≠ 真续约 ⇒ require 必败。ShardLeaf 已在 1468/1469 修成 `ownRedeemStart = ownLen - own_redeem_len`（ctor 烤 `own_redeem_len`，不动点收敛）；**PayoutShardV2 没有同步修**。
4. **没有合约外的绕法**：P2SH 的 sigScript 必以 redeem 收尾、见证必在其前，`slice(0,1)` 永远落在见证内；不存在让 `ownSig` 等于裸 redeem 的诚实 tx。
5. **所以按「以合约为准、不改 .sil」的约束，段1 无法验收，我在此停手。** 需要 Owner/NWT 决定：修 `PayoutShardV2.sil`。

## 1. 需要的合约修法（我不做，列出范围供审）

照 ShardLeaf 1469 的已验证修法：PayoutShardV2 ctor 加 `own_redeem_len`（int, ctor-baked, 按本市场 ctor 不动点收敛；PayoutShardV2 当前 29,288 B 且状态宽度固定 288B，收敛应当很快），`ownRedeemStart = ownLen - own_redeem_len`，prefix/suffix 从 `ownRedeemStart` 起切。受影响入口（凡「V-T-8 绕路手写自续约」）：**absorb**；我读码判断还有 `close_attest`/`cancel_attest`/`refund_claim` 若同样 `ownSig.slice(0, …)`（需 NWT 逐入口核——我只**实证**了 absorb）。同类还有 `CloseZkV2` 的 claim/escape_claim partial 分支（头注已写同一 V-T-8 绕路，OWN_PREFIX_LEN/OWN_STATE_LEN）与 `RootClaim`（账本 1477 已记）。连带：`compilePayoutShardV2Redeem` ctor 29→30 参数、所有读 ctor 的 JS（`committee-offset-derive.mjs` 占位 ctor、`pool-shard-register`、`bshard-payout-family-coherence` 重编比对、tmpl anchor）要跟着改——这是跨合约+跨消费者的资金路径改动，非本单范围。
这意味着：**账本 (1826) 彩排报件里「结算侧未移植」的清单要加一条——即使 relay 构造器全移植，PayoutShardV2 的自续约入口在合约层就不可用。**

## 2. 段1 已做且独立有效的部分（合约修好后可直接复用）

- `kasia-relay/src/lib/p2sh.mjs` `unlockBshardConsolidateV2`（代币版）：inputs=[PS(absorb), SL(consolidate_to_payout), shard 代币(owner=SL cov, KTT.transfer zero-out), PS 已持有代币?(owner=PS cov, zero-out), fee P2PK]，outputs=[PS 续约(带 CovenantBinding=PS cov, KAS 面值原样), tok_out(新 KTT 实例 amount=consolidated_pool+shard_amount, owner=PS cov, populateGenesisCovenants 授权=fee 输入), change]；`computeBudget` 100（实测 70 不够：`used=731959 > limit=709999`，≥74）；`owner_cov_id_hex` 预检（tok_out owner 必须等于 PS 输入真实 cov_id）；`dry_run` 返回逐输入真实字节供 cli-debugger。**复用**：`unlockBshardRegister` 的 tok_out genesis 绑定、`_encodeKttTransferZeroOutAction`、`_combineActionAndRedeem`、v1.0.0「addI64+addData+4 字节 dispatch_tag」action 编码、`_matchUtxo/_assertTxInvariants`；**不能复用**：旧版 KAS 价值焊接与 2-int 裸选择器。`commands.mjs` 把 `BSHARD_CONSOLIDATE_V2` 字段加上 `witness`。
- `kasia-console/src/lib/pool-shard-settle.mjs` `consolidateAllShards({tokenized:true})`：按 `market_shards.current_token_outpoint` 取 shard 代币、PS 名下代币 outpoint 沿链跟踪（resume 时按确定性地址探，恰 1 笔否则 fail-closed）、空片(pool_value=0)跳过；`autoDetectConsolidateResume({tokenized})` 的 KAS 金额校验改比 `PS_SEED`（PS 面值与 consolidated_pool 不再相等）。`pool-shard-register.mjs`：`PS_SEED` 导出、`settleDispatchTags()`（absorb / consolidate_to_payout 的 v1.0.0 dispatch_tag，编一次缓存）、**`ensurePayoutShardV2` 创世 `consolidatedPool` PS_SEED→0**（absorb 要求 `owned_total==consolidated_pool`，创世 PS 名下无代币，旧初值 20,000,000 会让第一次 absorb 必败）。`bshard-close-transport.mjs` V2 propose 调 `tokenized:true`。
- V1 committee 路径本轮未动：`unlockBshardConsolidate`、`consolidateAndBuildPsState`(bshard-settle-daemon)、`bshard_consolidate`(V1 cmd) 仍是 KAS 旧形。

## 3. 实验过程里顺带坐实的事实（对段2~4 和主网 env 有用）

1. **时间锁终局需要等「过去中位时间」追上**：`consolidate_to_payout` 对 partial 片要 `tx.time >= deadline*1000`（lock_time = deadline×1000 ms）。节点用 sampled past-median-time 校验终局（`tx_validation_in_header_context.rs check_tx_is_finalized`: `lock_time < pov_median_time`，否则 `input #0 is not finalized`），中位时间落后 tip 约 2~4 分钟量级（simnet 本机实测：deadline+100 s 仍被拒，+270 s 过）。⇒ **生产上 deadline 到了立刻 consolidate 会被拒、要等几分钟**——ZK_JUDGE_PROPOSE 的 `deadline_daa + 60` 门（60 DAA≈6 s）远小于此，首轮必败、靠 5 分钟冷却重试。建议把门放宽或把失败归为可重试（目前归为 propose_error 并进 5 分钟冷却，是自愈但会多等一轮）。
2. 代币模型（回应 Bettor 追加问题②）：**shard 代币走 KTT.transfer zero-out（`next_states=[]`，`sum_in>=sum_out=0` 销毁）+ `tok_out` 是新 genesis 实例**；「不多铸、只铸给 PS cov」由这几行把关——`PayoutShardV2.sil` absorb：`owned_total==consolidated_pool`（PS 名下既有）、`shardTk.amount==shard_amount`、`shardTk.owner != PS cov`、`countStrayNonOwnedTokenInputs==0`（本笔无未说明的陌生同模板代币输入）、`validateOutputStateWithInputTemplate(tok_out, TokenState{amount: consolidated_pool+shard_amount, owner: OpInputCovenantId(active)=PS cov, scheme=4, borrow=0…}, shardInIdx, …, token_tmpl_hash)`（模板来自 shard 输入自带 redeem，blake3 核 `token_tmpl_hash`）；`ShardLeaf.sil consolidate_to_payout`：`ps_cov==payout_cov_id`、`OpOutputCovenantId(psOutIdx)==payout_cov_id`、`scanOwnedTokenInputs==pool_value`。**多铸 1 / owner 错两条负向用例我写好了（`seg1_consolidate.mjs` N1/N2）但没能在共识层跑到这些 require**（被 216 行先拒，且要等中位时间）；cli-debugger 层可在合约修好后补跑。
3. 其它读 `consolidated_pool` / `PS_SEED` 的位置审计（回应 Bettor 追加问题①）——**未完成**，因段1 在合约层受阻，我没有往下铺；已知：`autoDetectConsolidateResume`（已改）、`consolidateAllShards` 初值取自 redeem 的 [2..9] 字节（创世改 0 后自然为 0）、`bshard-close-transport.mjs` absorb 后的 splice（同一偏移，不受影响）。`zk_handoff` 的 settler 流动需求（`buildZkHandoffRequestV2` 要 fee 输入 == consolidated_pool KAS）、`bshard-payout-family-coherence` 重编比对、zk_close、claim 的「KAS 面值==state」假设属段2~4，待合约问题定后逐个写。

## 4. 复现

`docs/provenance/2026-10-04-j2-settle-tokenize-seg1/`：`setup.mjs`/`fund.mjs`/`start_console.sh`/`s1~s4*.mjs`（建池/建盘/三注/第二片）→ `dbg_absorb.mjs`（dry_run 取真实字节 + 生成 `dbg_absorb.test.json` 并跑 cli-debugger）→ 对照 `dbg_absorb_control.test.json`（裸 redeem 作 ownSig ⇒ PASS）；`dbg_absorb_out_head.txt`（真实 FAIL 原文，行 216）；`seg1_run1..3_*.log`（not finalized，等待时长实验）、`seg1_run4.log`（过终局后 script 失败）、`abi_probe.mjs`（各入口 dispatch_tag/ABI）。simnet 的 relay 补丁 `harness-relay-api-simnet.patch` 未提交（仅本地应用）。

## 5. 需要拍板

1. 修 `PayoutShardV2.sil` 自续约偏移（范围见 §1）——谁做、是否并入段1~4 同一合约批；合约改完我继续段1 验收（含两条负向）。
2. 在合约修好前，zk_native 主网市场**结算侧完全不可用**（含 absorb）——与彩排报件结论叠加，开放新盘前请 Owner 知悉。
