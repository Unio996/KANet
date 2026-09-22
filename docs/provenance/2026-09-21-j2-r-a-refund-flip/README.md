# R-a 批说明 + 交件证据:驱动自己走 refund_flip(冻结市场的自然出口)(J2 · 2026-09-21)

> 设计:`docs/2026-09-21-j2-driver-refund-path-design-v0.2.md`(NWT 两轮 PASS `3e187bc2`,七条 MUST + Bettor 两条裁定)。范围:**只 R-a**(refund_flip 端到端 + probeRefundFlip + v214);R-b/R-c 不在本批。
> 🔴 **无预留、争用时 HOLD 非丢钱**:R-a 的 fee 输入沿用现有 `selectFeeUtxoByConstruction` + 结算路径 `filterFeeCandidates`(C1 现成路径),**不带 F4 预留**。多个 step 争同一 fee UTXO 时后到者 `inputs_spent`/`no_suitable_fee_utxo` ⇒ HOLD/重试,不是丢钱(A 臂同类)。**F4 落地后须把 refund_flip 的调用点迁到 `selectAndReserveFeeUtxo`。**
> 只合不部署;未碰主网 console / 库 / env / relay(主网库只做了**文件拷贝**验证,见 §3)。

## 0. 分支与提交
- 分支 `coord/j2-r-a-refund-flip-20260921`(主线 3691b19b 起),代码提交 `ce7b216d`(21 文件 +807/−35)+ 本 provenance 提交。

## 1. 改了什么
| 层 | 改动 |
|---|---|
| step 与常量 | `proto-settlement-intent.mjs`:SETTLEMENT_STEPS / STEP_SUBJECT_TYPE / STEP_DEPENDS_ON 加 `refund_flip`(+ `convert_to_refundclaim`、`refund_payout` 的 CHECK 位,**仅 CHECK/常量,不接线**);`driver-core.mjs`:SETTLEMENT_DRIVER_STEPS / STEP_INTENT;`chain-checks.mjs` STEP_INPUT_ROLES、`pointers.mjs` STEPS(rootClose 取格 3,同 close_commit) |
| 时间闸 | `proto-close-commit-gate.mjs` 新 `evaluateRefundFlipTiming`:`pmt ≥ deadline+2h+30s`;**不复用 close 的 30s 闸**(测试钉:deadline+60s close 放行、refund_flip 拒) |
| 驱动闸(core) | refund_flip 广播前:①只翻**已冻结**市场(与 close_commit 相反,严格 fail-closed:只有端口明确返回 `true` 才放行);②`checkPmtGate(evaluate: evaluateRefundFlipTiming)`;放行时 pmtEvidence(source=relay)交 builder |
| builder | `buildRefundFlipTxJson`(`proto-tx-assembly-settlement.mjs`):`buildCloseCommitTxJson` 同形,**删委员签名/私钥**;RootClose 输入 sigScript = witness+redeem(零签名);`lockTime = deadline+7,200,000`;输入 `sequence 0`(CLTV);输出 0 = closed:2 spk + 沿用 covenant id;`pmtEvidence` **必填 fail-closed**(无墙钟退路——不可逆);`signInputIndices:[1]`、`continuationOutputIndices:[0]` |
| ops | `FEE_PROFILE_KIND`/`prepare`/`build` 分支;fee profile `refund_flip` 初值 0.30 KAS(`proto-v0-template-anchors.json`,**终值以 simnet 节点侧实测定,见 §4**) |
| store | `listWork` 触发:`status='sealed' ∧ 已冻结 ∧ seal landed ∧ 无 submitted/landed/ambiguous 的 resolve ∧ 无 landed/ambiguous 的 refund_flip`(**M1:不看 cancelled**);`dependenciesLanded`;`effectsPending`(landed ∧ 仍 sealed);`markLanded(refund_flip)` 一个同步事务:**M3** 先 `deriveRefundClaims`(缺 ticket/重复/Σ≠pool_value ⇒ 抛 ⇒ 整体回滚 = HOLD)→ 建退款 claim(确定性 id)→ `UPDATE … status='cancelled' WHERE status='sealed'`(**M1 前态谓词**)→ 把未广播的 resolve(pending / F1 prepared HOLD)标 `ambiguous` |
| M3 | `refundClaimIdFor` = sha256(market ‖ ticket_txid ‖ ticket_vout ‖ 'refund')(不加列不加迁移);ticket 缺 ⇒ 抛,**不得空值入哈希** |
| M5 | `probeRefundFlip`(ops)三缺一:facts 形态 L 在 closed=2 地址读到 **covenantId==本市场 ∧ spk(version 0+scriptHex) ∧ 面值** 的后继 + 形态 O 证旧 outpoint 已花 + `check_utxo_landed(closed=2 地址, 后继 txid, minDepth)`;纯决策 `decideRefundFlipFromFacts` 可单测。`store.recordObservedRefundFlip` 一个事务:意图幂等记 landed(`submitted_txid` = 探针 facts 读回的后继 `outpoint.transactionId`)+ 自动冻结(reason `refund_flip_observed`)。core:refund_flip 与 close_commit 的 RootClose drift 分支都接续;后效经 effectsPending→markLanded |
| v214(M2) | `db/migrate.js`:意图表 step CHECK 一次放入三个退款 step;**同事务先 DROP 所有引用意图表的触发器(sqlite_master 枚举)→ 重建 → 索引 → 触发器原文重建**;核触发器/索引/行数/foreign_key_check/integrity_check;幂等。`DATABASE.md` 同步 |
| 出口闸 ⚠ | `proto-relay-ipc.mjs`(**M0a 受控文件**):S9 键正则与配对表加 `refund_flip`(否则真实 `covenant_broadcast` 在出口被拒——core 测试抓到);`scripts/m0a-exception-manifest.json` 的 `content_digest` 同笔更新(`91ff349b…` → `5d74b586…`,取 staged 内容)。**须 NWT 重审该受控文件** |
| 服务接线 | `services/proto-settlement-driver.mjs`:`probeRefundFlip` 传 `requestFacts`/`sendCmd`/`relayId`/`minDepth`;`recordObservedRefundFlip: store.recordObservedRefundFlip` |

## 2. 离线验证(`green/*.txt`,18 个相关套件 exit=0)与突变
- **新增**:`proto-refund-flip-store`(触发/依赖/markLanded/M3/M5,真迁移库)、`proto-refund-flip-probe`(纯决策 + **7 条弱注入臂:只改一个字段必翻成"未翻"** + 时间闸边界)、`proto-settlement-intents-v214`(旧形库重建 + **朴素 v207 配方失败对照**)、`proto-tx-assembly-settlement` ⑥a–g(真 wasm + relay 真代码:验签 finalize、closed:2 spk 独立现算、lockTime、sequence、pmtEvidence 缺/过期/来源不明/差 1ms)、`proto-settlement-driver-core` 新增 5 组。既有套件同步(步骤计划、出口 S9 漂移测试等)。
- **突变 12 条全部检出**(`mutation-results.json` + `scripts/mutate-ra.mjs`):M1 三条(去冻结谓词 / 放宽到 cancelled / 去前态谓词)、M3 随机 id、M5 三条(去 covenantId / 去旧 outpoint 已花 / 观察不冻结)、闸两条(复用 close 闸 / 去冻结闸)、builder 两条(pmtEvidence 可选 / lockTime 用 deadline)、v214(不先 DROP 触发器)。

## 3. 主网形状实测(**只读拷贝**,主网库本体未打开未写)
- 方法:`cp` 主网库 db+wal+shm 到 `scratch/_j2_ra_mainnet_backup/`,sha256 见 `mainnet-copy-SHA256.txt`;所有验证只在拷贝上跑。
- **v214 在主网库拷贝上通过**(`mainnet-copy-v214-verify.txt`):4 行意图保真、1 个引用触发器 / 2 个索引按原文重建、`integrity_check ok`、`foreign_key_check` 0;3 市场(2 cancelled + a59c resolved)、26 触发器、194 索引逐字一致。
- **M1 零动作(真实数据)**:新 store 的 `listWork` 对该拷贝 `advances=[] effectsPending=[]`;三个市场 `dependenciesLanded('refund_flip')` 均 `market_not_sealed`(`scripts/mainnet-copy-zeroaction.mjs`)。
- 部署前必须 `.backup` 主网库并在副本上先跑;迁移失败回退 = 还原备份 + 回退部署提交。

## 4. simnet 真共识准入(R 臂,`flip-watch.mjs`,证据 `evidence/ra-flip-watch.jsonl` + `evidence/ra-mempool-entry-0593434a561f.json`)
- 市场 `36ee2021…`(R 臂,`inconsistent_verdicts` 已冻结),`deadline_ms` 对应的门槛 `lockMs = deadline+7,200,000 = 2026-09-21T17:56:58.559Z`。
- **接管前后进程/端口**(`takeover-before.txt` / `takeover-after.txt`):旧 console(pid 23416, port 3298)已停并核端口空,新 console(**R-a 代码**,pid 11760, port 3298)起于隔离 simnet env(`KASPA_RPC_URL=ws://127.0.0.1:28510`,`KANET_ROOT=…/_j2_wt_ra`)。
- **矿工纪律**:接管后 simnet 上**唯一矿工是 `flip-watch.mjs` 自身**(负责阶段 A/B/C 的出块);此前一度并存两个矿工的失误已按 PID 清理并记入 provenance,不影响本次取证(取证期间无重复矿工)。
- **阶段 A(负对照,门未开)**:出块推进到 `pmt = lock+10,862ms`(< +30,000ms 余量)后停止出块,观察 45s(≥2 个 driver tick):`refund_flip` 意图**无 prepared/submitted 行,zero broadcast**——PASS。**独立交叉证据**:console 日志(`logs/console-ra-stdout.log:2125-2214`)显示驱动自己的 20s tick 从差 7,140,703ms 一路缩到差 3,189ms,**每一 tick 都被 `evaluateRefundFlipTiming` 拒**(`refund_flip_pmt_not_ready` / "lock_time 尚未 finalized, 节点会以 NotFinalized 拒绝"),直到门开前最后一刻——闸不是 harness 单方面认定,是驱动生产 tick 路径本身逐次证实的。
- **阶段 B(门开)**:出块推进到 `pmt = lock+42,760ms`(≥+30,000ms)后停止出块,驱动**下一个 tick 内**自己构造并广播 `refund_flip`:`prepared_txid == submitted_txid == 0593434a561f7defa71633e120aa8e0be62dd6ef7c1a1e1d974cc9085a42b407`(同笔,console 日志 `COVENANT_BROADCAST` 行确认真实 IPC 广播)。
  - **relay 真实小面值 fee UTXO**:输入 1 取自 tx `57a9a2ad…` 的 output[3],面值 **36,934,975 sompi(≈0.369 KAS)**——`filterFeeCandidates`/`selectFeeUtxoByConstruction` 现成路径自动选中的真实候选(非手工指定),证明 fee 输入侧不需要 F4 预留也能在争用外的独立场景走通。
  - **节点侧 `getMempoolEntry` 为准的 mass/fee**(账本 1467 口径,非本地 wasm 估算):`fee = 15,682,000 sompi`;`storageMass = mass = 88,979`;`computeMass = 35,031`(plurality = storageMass,同 KIP-9 惯例,`memory reference-kip9-storage-mass-plurality-is-not-one`)。本地 wasm `calculateTransactionMass` 估算 176,798,与节点读数不同口径,仅并列对照不作依据。
  - **fee-profile cap 终值**:`refund_flip.cap` 沿用 30,000,000(0.30 KAS,同 `close_commit` 档),覆盖本次实测 ~1.9x 余量;未独立在 0.7–0.9 KAS 档复测(anchor 注记里 close_commit 的"fee 随 UTXO 面值单调增"结论未对 refund_flip 重新验证),故保守不下调。见 `scripts/proto-v0-template-anchors.json` refund_flip `_source`(2026-09-21 M7-R-a⑤ 更新)。
- **阶段 C(落链)**:恢复出块后同一 tick 周期内 `status` 翻 `landed`,**落链 txid 与 prepared/submitted/节点 mempool txid 完全同一笔**(`0593434a561f…`),无二次构造。
- **`markLanded` 后效(真库读回)**:市场 `status: sealed → cancelled`(`settlement_frozen_at` 不变);`resolve` 意图空(R 臂未曾进入 resolve——闭合路径直接冻结转 refund_flip,符合冻结语义:close_commit 三入口 fail-closed、refund_flip 是唯一自然出口);**两条退款 claim** 按 M3 确定性 id 生成(`side: 'refund'`,amount 600 / 700,`market_id` 一致),Σ = 1300 = 该市场两笔 `confirmed` 下注面值之和(pool_value 守恒);`claim_txid`/`claimed_at` 均为 null(退款 claim 的花费在本批 R-a 范围外,不属于 R-a 验收项)。
- **结论**:R-a 在 simnet 上以生产 builder 字节、relay 真实 fee UTXO、节点真实共识(`getMempoolEntry` 权威读数)完成负对照 + 同 txid 落链 + `markLanded` 效应全链验收,达设计 v0.2 acceptance 线。

## 5. 已知限制(NWT/Bettor 审阅前必读)
- **F1-HOLD 行标记未在真链演示**:本轮未构造出"resolve 已 prepared 后市场才被冻结"的活体场景(relay ≤4.9 KAS 流动余额上限挡住了第二个 F 型市场的资金),该分支仅有 store 单测覆盖(突变 12 条含 `M1c`)。
- **spender-txid 走 covenant 连续性,非直查**:M5 探针(`probeRefundFlip`)靠 closed=2 地址上 `covenantId ∧ spk ∧ 面值` 的后继匹配 + 旧 outpoint 已花来判定"已翻",白名单读集不含直接"谁花了这个 outpoint"的查询——这是既有只读白名单集的限制,不是本批引入的新限制。
- **观察式落地(observed refund_flip)只走 drift 分支,非主动扫描**:`recordObservedRefundFlip` 挂在 close_commit/refund_flip 广播前的漂移探测上,不是独立轮询;本轮已在 D 臂验证(见批说明附带的既有 provenance),R-a 新增改动未改变这条路径的触发方式。
- **R-b / R-c 不在本批**:refund claim 的兑付(withdraw)与相关 UI/查询面不在 R-a 范围。
- **M0a 受控文件改动待 NWT 重审**:`proto-relay-ipc.mjs` 的 S9 白名单加 `refund_flip` 键,`m0a-exception-manifest.json` 的 `content_digest` 同笔更新(`91ff349b…` → `5d74b586…`),是本批唯一触碰 M0a 受控面的改动。
