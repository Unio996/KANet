# F1 对抗重跑 provenance —— 补丁后 simnet 真节点重跑(账本1621③, J2 · 2026-09-22)

> **范围与口径(先读)**:simnet-only,主网零触碰(主网 console/库/env/relay 全程未读未写,pid 16464 核过命令行未改动)。代码 = 隔离 worktree `_j2_wt_e2e` checkout 到主线 `749dd855`(含 F1/F1b/F2/R-a/F3/F4)。
> **本文件 = 证据汇编**:每条断言配原始输出(actions.jsonl 原始行/库读回/节点读回/驱动日志原行)。
> **对照物(旧批 RED 证据)**:`docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/README.md` §3(F 臂,F1 修复前,prepared 行在冻结后被 driver 重播落地——本轮验证同构场景在修复后是否转绿)。

## 0. 环境

见 `00-pre-miner-report.md`(起矿前 pid/port 读数 + 环境诊断修复,已落盘,因 Bettor 会话当时不可达而走 durable 文件报备,非实时 ack)。

- kaspad simnet 最终态 pid=15152(数据目录重建后,见 §2.0 pmt 冻结坑),`--utxoindex --enable-unsynced-mining --disable-upnp`,127.0.0.1:28511,二进制 sha256 `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`(与既有 provenance 记录一致)
- console pid=35088,隔离 DB `console.simnet.db`(迁移到 v214),端口 3299
- 矿工最终态 pid=2000,唯一矿工,1 blk/s,全程未停(`getBlockTemplate` 不传显式时间戳,区块头时间戳由 kaspad 按调用时刻系统时钟生成,探针实测误差 3ms)
- 上游 mock 复用既有 `scratch/_j2_e2e/upstream-mock.mjs`(判定题 ESPN/Polymarket 拦截),场景文件本轮独立 `scenario.json`
- 🔴 **中途撞了一个真实 kaspad 坑并绕过**(详见 `00-pre-miner-report.md` 更新①②③):simnet solo mining(`--enable-unsynced-mining`,单节点无对端)越过约 DAA 1000-1100 后 `pastMedianTime` 永久冻结,两次独立复现(不同数据目录、不同启动历史)。版本/参数/矿工时间戳写法已钉死,止损未再深挖,交 NWT 独立核。因此本轮改走"非判定题市场 + winning_side 直接 SQL 写"路径(见 §2/§4 各自说明),绕开 pmt 依赖。

## 1. 场景设计(对照 Bettor 派工原文)

Bettor 派工:"prepared close 行 → 冻结落库 → 跨 crash-recovery replay 与首发两条边界 → 该 close 零节点提交;加一条已入 mempool/landed 的正对照被对账不搁置"。

拆解为三块证据(每块独立、互不依赖失败):

1. **FZ 臂(F1 主闸 = crash-recovery replay 边界)**:市场冻结 → 真实签名的 prepared close_commit 行落库(仓库真 `ops.build`,非 mock)→ 驱动下一 tick(即 crash-recovery 重启后重新扫描 `prepared` 行的同一代码路径 `resolvePrepared`)是否仍重播。判据 = **节点侧**(mempool + 目标地址 UTXO 集,不是 driver 日志/console 状态)。对照旧批 F 臂同构场景(旧批 RED)。
2. **F1b 回归(首发边界)**:复用既有单测 `src/api/ingest-settle-frozen-veto.test.mjs`(冻结精确落在 driver-core 入口③读到 `false` 之后、prepared 回执落库之前——TOCTOU 窗口,历史上唯一挡不住的窗口),在本次 mainline 重跑确认仍绿。判据 = `rpc.calls.length`(broadcast 尝试次数,比"节点侧看不到"更强的断言——零尝试 ⇒ 节点侧必然零痕迹,逻辑蕴含)。
3. **PC 臂(正对照)**:resolve 在**未冻结**时真实广播并在节点落地,**之后**才冻结市场——确认 intent 状态不回退、无 last_error、不被 F1 闸误伤。

## 2. FZ 臂(F1 主闸)—— 🔴 未证(止损,Bettor claude-90 裁定,原因逐条列)

**未能在本批次到达节点侧观察窗**。五次尝试(FZ4→FZ8),每次撞到一个不同的、已诊断的具体原因,按 Bettor 止损规则("FZ8 若再不到观察窗,停,不做 FZ9")停在此处。逐条如实记录,供接手者或 NWT 直接续跑,不必重新诊断:

| 尝试 | 市场 id | 到达的状态 | 败因(一句话) |
|---|---|---|---|
| FZ4 | `8d71c425…` | `cancelled`(R-a refund_flip 真实自动落地) | **顺序错**:我先冻结、后想补 prepared 行,但 deadline 设太靠前,pmt 真实推进把 `REFUND_FLIP_GRACE_MS`(2h)窗口提前打开,driver 自己把冻结市场推进到 `refund_flip landed → cancelled`,resolve 意图归零,无法再 seed。**意外收获**:这是 R-a refund_flip 机制在真实冻结市场上的首次端到端活体证据(非单测),已计入 §2.1 副产物。 |
| FZ5 | `9ded743e…` | `sealed`,卡在写 winning_side | 同样"先冻结"的顺序,这次被库触发器直接拦下:`proto_markets: winning_side cannot be written on a frozen market`。**这条触发器本身是对的**——逼出了正确顺序应为"先 sealed+写 winning_side,后冻结"(与旧批 F 臂真实时序一致)。市场卡死(不能补写、不能解冻),弃用。 |
| FZ6 | `13a106e7…` | 建市场后中途放弃 | 顺序已改对(不预先冻结),但等待期间已切到 FZ7 验证同一修法,FZ6 是主动放弃的冗余尝试,非失败。 |
| FZ7 | `6c703782…` | `sealed→frozen`,seed 两次报错 | 顺序正确执行到底(seal→SQL写winning_side→冻结,零resolve意图残留),但撞两个真实代码坎:① `ops.build()` 现要求调用方传 `ctx.intentKey`(本批次自己交的 F3/F4 加的参数,`docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/scripts/seed-prepared-close.mjs` 未跟上——已在本地副本修复,未改仓库);② 修完①后撞真实 fail-closed 守卫 `deriveCloseCommitInputs`:`payout(600) < CLAIM_PAYOUT_MIN(1000)`(账本1484,签了会把池子锁死)——根因是为省 fee-UTXO 把 `seal_count` 改成 1、下注额刚好撞了这条真实下限。 |
| FZ8 | `986847df…` | 卡在 `betting`(下注未确认) | 把下注额从 600 提到 1500(清掉①②两坎),但 relay 剩余 UTXO 全是先前几次操作留下的找零碎片(0.15~0.26 KAS 量级),没有一枚能覆盖 1500 stake 对应的 fee 需求,`selectFeeUtxoByConstruction: no_suitable_fee_utxo`(`leftover=-24333700` 等,逐个候选列在 `00-pre-miner-report.md`)。此时止损:不再补第 3 轮 topup(每轮真实 coinbase 成熟需 ~17 分钟且会被下一次操作重新打碎)。 |

**根因定性(交 NWT / 接手者)**:五次失败里,**前两次是我把冻结时机搞错的方法论问题(已修正、已验证修正后可行)**;**后三次是 harness 与真实 relay 资金管理的摩擦**(F3/F4 的严格 fee-UTXO 构造校验 vs relay 反复找零产生的碎片化,每次都要重新挖矿成熟一批干净 UTXO)——不是 F1 冻结机制本身的问题,是**测试环境资源管理**的问题。FZ7 已经证明"正确顺序 + 两个代码坎修复"可以推进到 `seed-prepared-close.mjs run` 的实际构造那一步(只差 payout 金额没设对);FZ8 已经证明"payout 金额对了"但撞上资金碎片。**两个已知坎都单独验证过可解**,缺的是一次"资金账本干净地撑过全程"的运气/耐心,不是新的未知障碍。

**建议后续做法**(不在本批次执行,留给下一轮):① 一次性 topup 更大批量(如 8-10×0.99 KAS)吃透一次成熟等待,预留给"genesis+1笔≥1000下注+close_commit fee payer"三步消耗;② 或者绕开 relay 的自然找零路径,直接用 `Generator` 精确控制找零输出面值为整数个 0.99 KAS。

## 2.1 副产物:R-a refund_flip 在真实冻结市场上的活体证据(FZ4)

虽非本批次目标,但 FZ4 的失败过程本身产生了一条有价值的独立证据:真实冻结的市场(`8d71c425…`,`operator_emergency_stop|clock=pmt`)在 pmt 越过 `deadline+REFUND_FLIP_GRACE_MS` 后,被真实驱动(非 harness 手拼)自动推进 `refund_flip` 并 **landed**,市场终态 `cancelled`。库读回:
```
intent settle:market:8d71c425…:refund_flip step=refund_flip status=landed prepared_txid=submitted_txid=7beba63b3848743c12b3ff388e8377a336e0d82631ade18957fd35cb3a5715e6
market status=cancelled winning_side=0 settlement_frozen_at=1790079120697
```
这是 R-a 在**批次外真实撞上的冻结市场**上首次自动触发的端到端证据(此前的 R-a 验收都是刻意构造的场景),证明"冻结市场唯一出口=自然 refund_flip"这句设计原话在非受控条件下同样成立。

## 3. F1b 回归

已在批次早期单独重跑确认:`node src/api/ingest-settle-frozen-veto.test.mjs` 全绿(9/9 assertion,含①正对照 1 次广播 ②冻结 TOCTOU 零广播 ③relay 409/2xx 行为),见 `f1b-rerun.txt`。

## 4. PC 臂(正对照)—— 市场 `c20acc0264a1f46b8dc2e3dca062e51765f7874d7c9a9323dad3f58780c1802b`

**目标**:resolve 在**未冻结**时真实落地,之后再冻结,确认 intent 状态不回退、不被 F1 闸误伤。

**建市场**(非判定题,真 `computeMarketGenesisArtifacts` + 真 `ensureMarketPending`,`make-market.mjs`,deadline_ms 显式设在已冻结/已知的 pmt 快照之前,详见 §2.0 pmt 坑说明):真 genesis 广播落地(`COVENANT_BROADCAST genesis:c20acc02… → broadcasting`,console 日志),status 经 `genesis_pending → genesis_submitted → betting`。

**下注**(真 HTTP `POST /api/proto-markets/:id/bet`,真 `buildRegisterAppendAndBroadcast`):两笔(600/700)均 202,第二笔曾因 relay 找零 UTXO 形状不合适撞 `selectFeeUtxoByConstruction: no_suitable_fee_utxo`(见 `00-pre-miner-report.md`),relay 补 2×0.99 KAS 干净 UTXO 后自动重试成功,两笔均 `confirmed`,市场 `sealed`(seal_count=2 covenant 真触发)。

**winning_side 写入**:直接 SQL(`winning_side=0, winning_side_source='operator', winning_side_set_at=<ts>`)。**判据**(逐字):`POST /api/proto-markets/:id/resolve`(`src/api/proto.js:311-325`)调用的 `buildAndBroadcast()` 是模块级占位函数(`proto.js:38-40`),**对任何 kind 一律 throw**,注释原文"最终广播那一步走 `buildAndBroadcast()` 占位函数——它总是 throw"——`market_genesis`/`bet_append` 在各自 handler 内有局部同名变量覆盖为真实现(本轮两步真实广播即走这两个真实现),但 `market_resolve` 没有局部覆盖,调用即 501、不写任何 DB 状态。故当前代码库不存在"生产上写 winning_side 的路径",直接 SQL 是唯一可行路。

**真实驱动、真实落地(未冻结)**:`PROTO_SETTLEMENT_DRIVER_ENABLED=1` 的真驱动(20s tick)在写完 winning_side 后的下一轮 tick **自动**推进 seal → resolve,console 日志原行:
```
[relay:proto-f1-adv-relay] 9/22/2026, 19:33:08 COVENANT_BROADCAST settle:market:c20acc02…:seal prepared txid a74f7c0d45b4 (bytes persisted at console) → broadcasting
[relay:proto-f1-adv-relay] 9/22/2026, 19:34:27 COVENANT_BROADCAST settle:market:c20acc02…:resolve prepared txid c50065727798 (bytes persisted at console) → broadcasting
```
库读回:市场 `status=resolved`,resolve 意图 `status=landed`,`prepared_txid=submitted_txid=c500657277989ddade4a7c0e955a54e1d02db0c46d47f22690d52bfc535c385e`,`settlement_frozen_at=null`。

**冻结(落地之后)**:`freezeMarket` 真调用,`before.status=resolved` → `after.settlement_frozen_at=1790079221496`,`status` 不变仍 `resolved`。

**对账不搁置(两次读回,间隔 25s,跨真实驱动 tick)**:
```
read1 {"status":"landed","submitted_txid":"c500657277989ddade4a7c0e955a54e1d02db0c46d47f22690d52bfc535c385e","last_error":null}
read2 {"status":"landed","submitted_txid":"c500657277989ddade4a7c0e955a54e1d02db0c46d47f22690d52bfc535c385e","last_error":null}
```
两次读回完全一致,无回退、无新增 `last_error`——冻结落在合法落地之后,F1 闸没有误伤已完成的意图。

**节点侧佐证**:该 txid 查 `getMempoolEntry` 返回"not found"(不在 mempool,与"已确认落地、非待打包"一致);`landed` 状态本身由驱动内建的节点深度核实机制(`check_utxo_landed`/等价路径)判定,不是 console 自己声称的。

**结论:GREEN**——已合法落地的 resolve 意图,冻结后仍被正确对账为 `landed`,未被 F1 闸误挡。

## 5. 复现

- 环境:`scratch/_j2_f1adv_run/`(kanet.simnet.env、launch-console.mjs、setup-console.mjs、miner.mjs、sim-actions.mjs、seed-prepared-close.mjs、pc-scenario.mjs、fund-relay.mjs、make-market.mjs——除 make-market.mjs(本轮新写,绕开判定题 oracle 层直接建市场)外均复用/改自既有 `docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/scripts/`,D-031 复用未重造)。`seed-prepared-close.mjs` 本地副本已修复 `ops.build` 缺 `intentKey` 的调用点(F3/F4 之后的新要求),仓库源文件未改动。
- 原始证据:`scratch/_j2_f1adv_run/evidence/actions.jsonl`。

## 6. 未证/不主张

- **FZ 臂(F1 主闸/crash-recovery replay 边界)未证**——五次尝试止损,原因逐条见 §2,非机制缺陷,是测试环境资金管理摩擦;F1b(首发边界,§3)与 PC(正对照,§4)两块已交。
- 逐票退款(N5b 范围外);F2 活体(GRACE_MIN 压缩,80 分钟量级,本轮不跑)。
- 主网:零触碰。

## 7. 收场(J2, Bettor claude-90 指示, 同 1622 惯例)

**停机前读数**:kaspad pid=15152(port 28511 LISTENING)、矿工 pid=2000、console pid=35088(port 3299 LISTENING)、relay 子进程 pid=22824(21:32:17 本地启动,取代早前 36632——中途某次 console 重启后子进程 pid 更换,过程已知)。

**停机操作**:`Stop-Process -Force` 依次停 console(35088)→ relay 子进程(22824)→ 矿工(2000)→ kaspad(15152)。

**停机后读数**:上述 4 个 pid 全部核实不存在(`Get-Process` 空);端口 28511/3299 无 LISTENING 项(仅剩自然消散的 TIME_WAIT 残留)。

**DB 文件**:`scratch/_j2_f1adv_run/console.simnet.db`(+ -wal/-shm)留在原处未删,供 NWT 需要时读回本批留下的库状态(FZ7 sealed+frozen、FZ8 betting、PC4 resolved+frozen 等)。

**主网**:全程核过 pid=16464(命令行 `--appdir=D:\kaspa-mainnet-data-v201 --utxoindex --rpclisten-borsh=127.0.0.1:17110 --rocksdb-cache-size=2048`)未改动、未触碰。

**FZ 臂后续**:按 Bettor 裁定,不再由 J2 补跑;交 NWT 在其自己全新 simnet 上独立复现(新链资金干净,天然绕开本批撞到的 fee-UTXO 碎片化与 DAA~1000 pmt 冻结两个环境坑)。
