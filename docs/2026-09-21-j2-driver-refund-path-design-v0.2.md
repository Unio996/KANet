> **Status**: DRAFT v0.2 (2026-09-21 · J2 · 已并入 NWT 设计审 78efc347 的 7 条 MUST(M1–M7)+ Bettor 两条裁定;只文档,未改任何代码;设计第一条=复用,见 §1)

# 驱动自己走退款路(N5b 收口)设计稿:refund_flip → convert_to_refundclaim → refund_payout 三步进驱动

> **v0.2 变更(NWT `origin/nwt/refund-path-design-review-20260921` @78efc347)**:方向通过("不新造合约路径 / builder 骨架 / 驱动骨架"成立)。七条 MUST 全部并入:M1 触发谓词不得用 `status='cancelled'`(§2.1);M2 v214 迁移按 v207 手法**会失败**,改写(§2.2/§3.2);M3 退款票确定性身份 + 守恒断言(§3.3);M4 逐票 payout 线性链每市场至多一个在途(§3.4);M5 观察第三方翻牌 ⇒ 幂等记 landed + 自动冻结,判据不得地址级(§3.5);M6 终态写死、撤回"withdraw 沿用现有步骤"(§0/§3.1);M7 验收线可检查化(§3.7)。Bettor 裁定:① v1 只自动**翻**冻结市场;② 采 M5。另撤回 v0.1 一处夸大(R5 的"withdraw 沿用现有步骤"——withdraw **不是**驱动步骤,见 §1.2 R5)。

- 依据:Owner 2026-09-21 聚焦令(唯一目标 D-029 主网结算自动跑起来)、账本 1617、1614(D 臂口径:harness 手拼 refund_flip 只证合约允许,不证 driver 会走;逐票退款归 N5b)。
- 现状一句话:**冻结市场(oracle 异常路的唯一出口)现在只能人手拼 tx**——`proto-oracle-policy.mjs:3` 的 N5b 谓词正是因此禁止"有价值市场带判定题上主网"。本稿 = 把这条出口接进 driver。
- 坐标为 `origin/bshard-m3-deploy` @ cef953c1 读数(行号会漂,配 grep 词)。

## 0. 终态定义(M6:写死,并对 Owner 如实)
- **退款路的驱动可达终态 = 每张 confirmed 票对应一个链上 `KanetTokenClaim` UTXO,且其 `claim_txid` 已写库。** 与赢家路径 `claim_draw` 终于 KanetTokenClaim 对齐。
- **不含 withdraw**:`withdraw`(`KanetTokenClaim.spend`)**不是驱动步骤**(`SETTLEMENT_DRIVER_STEPS = ['seal','close_commit','convert_to_claim','claim_draw']`,`driver-core.mjs:13`;ops 头注明写"不含 withdraw / ticket_reclaim"),且需要持币方签名(逐用户身份未做,Bettor 1610:用户暂不能自助下注)。builder(`buildWithdrawTxJson`)存在,但不接线。
- **对 Owner 的请示口径**(将来"放宽 N5b 谓词"时必须如实写):"退款已自动到 KanetTokenClaim;**用户取回还需要 withdraw,尚未接线**。"不得写成"退款已自动 = 用户已拿回钱"。

---

## 1. 已有什么(设计第一条)

### 1.1 D-031 复用核查:点名的两处(NWT 已逐条核实)
| 点名 | 结论 | 依据 |
|---|---|---|
| `pool-seal-builder.mjs:93` `buildConvertToRefundClaimCommand`(J1 6/20 bshard) | **不能直接复用,可复用的是"形状"** | bshard(PoolLeaf/PoolRoot)家族的 **relay 命令**组装器(产出 `bshard_*` relay action 的 witness 命令,头注 `pool-seal-builder.mjs:1-18`),不产 txJson、不走 `covenant_broadcast`。可借的只有:convert_to_refundclaim = convert_to_claim 的同形兄弟(OP_3、目标 RefundClaim、带完整 7-field state,:108-115)。 |
| `proto.js:331` `refund_payout` 约定 | **只是注释 + 未实现桩** | :331 块注释;`claim` 路由把 cancelled 映射 `kind='claim_refund'`(:354)后走 `buildAndBroadcast`,该函数整个是抛"未实现"的桩(`api/proto.js:38-40`)。没有可复用代码;可参考的约定:每张 confirmed 票一笔、退 `stake` 1:1、单操作员候选须恰 1 条否则 fail-loud。 |

### 1.2 真正可复用的现成件(proto-v0 自己的栈)
| # | 已有件 | 它现在管什么 | 坐标 |
|---|---|---|---|
| R1 | **合约路径已证**:`RootClose.refund_flip(rootOutIdx, tok_prefix, tok_suffix)` | 无签名、`closed==0`、`noTokenInput`、`tx.time ≥ deadline+7,200,000`、输出 closed 0→2;与 close 在同一 UTXO 上 XOR。**simnet 真共识已接受**(D 臂 harness `38a05faf…` daa 51861;负对照→门开接受;NWT 复核 b804c805) | `RootClose.sil` entry `refund_flip` |
| R2 | D 臂 harness `refund-flip.mjs` 只用仓库原语 | `computeRootCloseGenesisArtifact`(cur / closed=2 两个 spk)+ `encodeCloseCommitAction`(通用 ABI 编码)+ `combineActionAndRedeem` + `selectChangeShape` + `assertImpliedFeeMatches` + `assertKaspadInputVersionRule` + `assertMassWithinCeiling` + `deriveLeafState`;`lockTime = deadline+7,200,000`;RootClose 输入零签名 | `docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/scripts/refund-flip.mjs`;原语 `proto-covenant-builder.mjs:401`、`proto-close-commit-witness.mjs`、`proto-convert-to-rootclose-witness.mjs:94`、`proto-tx-assembly.mjs`、`proto-mass-ceiling.mjs:139`、`proto-leaf-state.mjs:25` |
| R3 | `buildCloseCommitTxJson`(refund_flip 的同形兄弟) | "RootClose 输入 + relay fee 输入 + 续约 RootClose 输出",`chainParents` 断言、`pmtEvidence`、返回 `signInputIndices` / `continuationOutputIndices` / `expectedTxid` | `proto-tx-assembly-settlement.mjs:377`(差别只在:少一个委员签名、lockTime、目标 state) |
| R4 | `buildConvertToClaimTxJson`(convert_to_refundclaim 的同形兄弟) | RootClose(closed=1)+ 持有代币 → 新建 RootClaim | `:592`;`RootClose.sil` entry 3 `convert_to_refundclaim`(要求 `closed==2` 且 `owned_total==pool_value`) |
| R5 | `buildClaimDrawTxJson`(refund_payout 的同形兄弟);`buildWithdrawTxJson`(**存在但不是驱动步骤**,见 §0) | claim_draw:RootClaim + 票 + 持有代币 → 新建 KanetTokenClaim。**v0.1 写的"withdraw 沿用现有步骤"已撤回**:builder 在,驱动步骤不在 | `:783`(claim_draw)、`:1005`(withdraw builder)、`:1132/:1164`(ticket reclaim,对 closed==2 显式 fail-closed,:1135) |
| R6 | RefundClaim 合约与产物 | `refund_payout`:`closed==2`、读 dust-ticket(spent-once)、退 `ticket.stake`、`heldTk.amount==pool_value`、draw-down `pool_value - stake`;full/partial 两分支。**debugger PASS(§0.9),未做 simnet 验证**;文件头仍标 "⚠ DRAFT … 待 NWT R1-XOR 终审"(见 §3.7) | `RefundClaim.sil`;`proto-covenant-builder.mjs:127` |
| R7 | pmt 闸与 SLA | `evaluateCloseCommitTiming` 产出 `sla:'refund_flip_open'`;`REFUND_FLIP_GRACE_MS`;core `checkPmtGate` 读 relay `get_past_median_time` fail-closed;`settlement_close_commit_refund_flip_open` 报警已登记 | `proto-close-commit-gate.mjs:12-35`;`driver-core.mjs:78、:245-246、:32-33` |
| R8 | 冻结 = 走 refund_flip 的既定语义 | 冻结后 `winning_side` 永不可写,"唯一出口 = 自然 refund_flip";F1/F1b 使冻结市场的 prepared close 不重播不首发 | `proto-settlement-freeze.mjs:4` |
| R9 | 驱动一步所需的接线骨架 | 意图状态机、C1 取证(`STEP_INPUT_ROLES`)、fee 选取(F3/F4 稿)、`checkLanded`+`markLanded`、`listWork`、报警闭集 | `proto-settlement-intent.mjs`、`-chain-checks.mjs:27`、`-driver-core.mjs`、`-store.mjs`、`-ops.mjs` |
| R10 | 半截接线 `probeRefundFlip` | core 有"close_commit 输入 drift ⇒ 探测是否被翻 ⇒ resolve 意图 `ambiguous/refund_flip_observed` + 报警"分支;端口在 service 写成 `ops.probeRefundFlip ? … : undefined`,`proto-settlement-ops.mjs` **无实现**⇒ 生产是死代码。**且该分支只对 `close_commit` 的 `rootClose_*_drift` 触发**(NWT 补充) | `driver-core.mjs:211-217`;`services/proto-settlement-driver.mjs:108` |
| R11 | 数据形状 | `proto_claims.side IN ('win','refund')`(v206);`proto_markets.status IN ('betting','sealed','resolved','cancelled')`(:5981);**主网库现有 3 市场 = 2 个手工置的 `cancelled` + a59c resolved**(账本 1473/1613/1615)——`cancelled` 在主网**已有一种与本稿不同的含义**("运营者放弃",见 M1);`kasia-console/src` 没有任何代码写 `cancelled` | `db/migrate.js` ~6031、~5981 |

### 1.3 由 §1 得出的结论
1. 不新造合约路径、builder 骨架、驱动骨架:refund_flip = R3 删签名;convert_to_refundclaim = R4 同形;refund_payout = R5 同形。
2. R9 骨架已在,F1/F1b(及将来 F3/F4)的加固自动惠及新 step。
3. R10 死代码在 refund_flip 落地判据处一并实现——**但判据强度受 M5 约束**(§3.5)。

---

## 2. 缺什么

### 2.1 三个新 step 与触发谓词(**M1:不看 `status`**)
| 新 step | 主体 | 依赖 | 触发条件 | 缺的东西 |
|---|---|---|---|---|
| **`refund_flip`** | market | seal landed | `status='sealed'` ∧ **已冻结** ∧ 无 submitted/landed/ambiguous 的 resolve 意图 ∧ pmt ≥ deadline+2h+30s(R7) | builder(R3 删签名);ops/store/core 分支;C1 角色(RootClose 一个输入);fee profile 键;landed 判据 + markLanded(见下);`probeRefundFlip`(§3.5) |
| **`convert_to_refundclaim`** | market | **该市场存在 `refund_flip` 意图 `landed`**(依赖行)∧ 链上事实 | 不看 `status` | builder(R4 同形);目标 = RefundClaim genesis spk;fee profile 键;markLanded(记 RefundClaim outpoint) |
| **`refund_payout`**(逐票) | claim(side='refund') | convert_to_refundclaim landed ∧ **上一笔 payout landed**(§3.4) | 每条 refund claim 一次,严格串行 | builder(R5 claim_draw 同形);RefundClaim 状态读取;markLanded(写 `claim_txid`) |

**M1 规格**:
- 三个退款步的触发一律以"**该市场存在 `refund_flip` 意图 `landed` ∧ 链上事实**"为准,**不看 `status`**。理由:主网库里已有 2 个手工置 `cancelled` 的遗留市场(其中 a0c4d628 genesis 已上链、leaf 永久不可花、**从未有过 RootClose/refund_flip**);R-a 的 markLanded 将开始写 `cancelled` 表示"已翻牌、待退款"——**同一个值两种含义**。若 `listWork` 用 status 选行,新驱动首个 tick 就会对这两个遗留市场尝试 convert_to_refundclaim(C1 取证失败 ⇒ 每 tick 报警噪声;更糟是某个取证缺口被放过)。
- **markLanded(refund_flip)** 对"前态 `status='sealed'`"加谓词(照抄 close_commit 的 `WHERE status='sealed'`),**不得对已 `cancelled` 的遗留行写入**。
- **测试(主网形状夹具)**:`cancelled` 但**无任何意图行**、有 pending bet 的市场 ⇒ 驱动**零动作、零报警**。

### 2.2 接线触点清单(加 step 要碰的地方,均已在册,无新机制)
`proto-settlement-intent.mjs:29`(SETTLEMENT_STEPS)、`STEP_SUBJECT_TYPE`/`STEP_DEPENDS_ON`;`driver-core.mjs:13/15`;`proto-settlement-store.mjs:12-14`(BATCH9_INTENT_PREDICATE / DRIVER_STEP_OF_INTENT)、`listWork`、`markLanded`、`effectsPending`;`chain-checks.mjs:27`(STEP_INPUT_ROLES)与 pointers;`settlement-ops.mjs:23`(FEE_PROFILE_KIND)+ prepare/build;`scripts/proto-v0-template-anchors.json` fee profile;`SETTLEMENT_ALERTS` 闭集;`DATABASE.md`(改表必同步);**以及 `proto_settlement_intents.step` 的 CHECK(硬编码枚举,`db/migrate.js:6328-6330`)⇒ v214 表重建迁移,见 M2(§3.2)**。

### 2.3 策略(已裁)
- **发翻只对冻结市场**(Bettor 裁定 ①)。未冻结但委员失联、deadline+2h 仍无 close 的市场:**发翻保持人手**;但它随时可能被第三方翻牌——由 M5 的"观察→自动冻结→接续"兜底,不需要另立"自动翻未冻结"。
- **N5b 谓词放宽**:三步 simnet 走通 + NWT 审过之前不放宽;放宽须 Owner,请示口径见 §0。

---

## 3. 改法与测试

### 3.1 分批(每批独立可回滚、只合不部署;钱路/covenant ⇒ 须 Owner 批,铁律 0)
| 批 | 内容 | 依据 / 风险 |
|---|---|---|
| **R-a**(先做) | `refund_flip` 一个 step:**v214 迁移(M2)** + `buildRefundFlipTxJson`(R3 删签名 + lockTime + closed=2 目标 spk,fail-closed 守卫照抄 close_commit)+ ops/store/core 接线 + `probeRefundFlip`(M5 强判据)+ markLanded(M1 前态谓词;**建退款 claim 行,M3 身份**) | 合约路径已证;新面 = builder、迁移、小面值 fee 的 mass |
| **R-b** | `convert_to_refundclaim` | 合约仅 debugger 证据,**simnet 真跑是准入**(§3.7) |
| **R-c** | `refund_payout` 逐票(full + partial),**M4 线性链**;**完成定义 = 每张 confirmed 票一个链上 KanetTokenClaim、claim_txid 已写(M6),不含 withdraw** | 同 R-b;RefundClaim.sil 头 DRAFT 终审须先关(§3.7) |
- **与 F3/F4 的依赖(NWT 非 MUST)**:refund_flip 的 fee 输入应走 F3/F4 的共享资格 + 预留函数(`selectAndReserveFeeUtxo`)。**R-a 排在 F3-b/F4 之前还是之后由 Bettor 定**;若之前,R-a 沿用现有 `selectFeeUtxoByConstruction` + 结算路径的 `filterFeeCandidates`(无预留),风险 = 与其它步骤争 fee UTXO 时 HOLD 而非丢钱(A 臂同类),须在 R-a 批说明里写明,并在 F4 落地后把 R-a 的调用点迁到包装函数。

### 3.2 v214 迁移(**M2:v207 手法会失败,已由 NWT 实测**)
- **事实**:`step` 的 CHECK 是硬编码枚举(`migrate.js:6324-6330`),须重建表。NWT 在 temp 库(跑完全部迁移)上用 v207 配方(建 `_v214` → INSERT SELECT → DROP 旧 → RENAME)实测:`REBUILD FAILED: error in trigger trg_pm_ws_r1_delete_guard: no such table: main.proto_settlement_intents`(SQLite 3.51.3,`legacy_alter_table=0`)。**原因**:v212 起 `proto_markets` 上的触发器在 `EXISTS(SELECT … FROM proto_settlement_intents …)` 里引用它(如 `trg_pm_ws_r1_delete_guard`,`migrate.js:6440-6441`),v207 重建 proto_markets 时这些触发器还不存在。事务回滚干净,但这是**主网 console 启动时跑的迁移**——失败 = 启动异常。
- **规格**:
  1. 重建在**同一事务内**:先 **DROP 所有引用 `proto_settlement_intents` 的触发器**(实施时用 `sqlite_master` 枚举 `sql LIKE '%proto_settlement_intents%'` 的 trigger,**不手写清单**),再建新表(CHECK 含三个新 step)→ `INSERT … SELECT` → DROP 旧 → RENAME → **按原文重建**被 DROP 的触发器与索引(索引 `idx_proto_settlement_intents_subject` / `_status_updated`)。`PRAGMA foreign_keys` 的开关在事务外(v207 既有注释,`migrate.js:6092`)。
  2. **重建前后核对**:触发器集合(名+sql)、索引集合、**行数**、`PRAGMA foreign_key_check`、`integrity_check` 与重建前一致;不一致 ⇒ 回滚并 LOUD 拒启动。
  3. **验收在真实主网库的 `.backup` 副本上跑**(不是 simnet 库)——并写明:**部署前备份**(`.backup`,与既有上线纪律同)+ **迁移失败的回退动作**(还原备份、回退部署提交)。
  4. 不推荐替代思路(不改 CHECK、另建并行意图表):违背"复用意图机器"。
- **测试**:迁移单测在"跑完全部既有迁移的库"上重建,断言上述四项核对;含"库里已有意图行"(行保真)与"已有 v212 触发器"两种前置。

### 3.3 退款票身份与守恒(**M3**)
- **问题**:`proto_claims` 无 bet_id/ticket 列(`migrate.js:6027-6038`),`newClaimId()` 是随机 32 字节(`store.mjs:16`)。win 路径靠 `SELECT … WHERE market_id=? AND side='win' LIMIT 1` 守一行;refund 是 N 行,随机 id 下 `INSERT OR IGNORE` 永不命中 ⇒ markLanded 重跑(设计就要求可重复)每次多插一批;同一 bettor 两张票(同 pk)也无法把 claim 映射回 `proto_bets.ticket_txid/vout`。
- **规格**:退款 claim 的 **确定性 id = `sha256(market_id ‖ ticket_txid ‖ ticket_vout ‖ 'refund')`**(`proto_claims.id` 本就是 TEXT PRIMARY KEY ⇒ `INSERT OR IGNORE` 自然幂等;**不加列、不加第二次迁移**)。claim→ticket 映射可由 `proto_bets` 复算(同 pk 两票得两个不同 id)。
- **守恒断言(fail-closed)**:创建退款 claim 前断言 `Σ(refund claim amount = 各 confirmed 票 stake) == RootClose state 的 pool_value == 待转 held token amount`;不等 ⇒ **HOLD + 报警**(否则 payout 尾巴卡死)。
- **测试**:markLanded 连跑两次行数不变;同 pk 两票各得一笔;Σ 不等 ⇒ HOLD。⚠ "单操作员下 Σ 票 stake 与 pool_value 是否恒等"NWT 读 close_commit 路径未见现成对账——**UNVERIFIED**,守恒断言即为其兜底。

### 3.4 refund_payout 线性链(**M4**)
- `RefundClaim.refund_payout` 每次花掉当前 RefundClaim、产出 `pool_value − stake` 的后继(full 分支最后一张才不续)——**同一 UTXO 上的线性 draw-down 链**。一个 tick 内 core 可推进多个 advance(cap 默认 3),若各按"convert landed"这一个依赖各自 prepare,会选同一个 RefundClaim 输入 ⇒ 第二笔 `inputs_spent` ⇒ ambiguous HOLD(A 臂同类;F4 的 fee 预留管不到这个输入)。
- **规格**:**每个市场同一时刻至多一个在途 refund_payout**(下一笔的依赖 = 上一笔 `landed`);每一笔的 RefundClaim 输入 outpoint 取自**上一笔已 landed 的后继输出**(第一笔取自 convert 的输出),**不是** `resolveStepPointers` 的静态角色;full/partial 由**链上剩余 `pool_value`** 与票 `stake` 决定(需新增一个 **RefundClaim 状态读取**,现仓库只有 RootClose 的 `deriveLeafState`)。
- **测试**:3 张票同一 tick 触发 ⇒ 严格串行、无双花、最后一张走 full。

### 3.5 观察第三方翻牌与 `probeRefundFlip`(**M5**)
- **接续**:`refund_flip` 是 permissionless,**未冻结**市场也可能被第三方翻成 `closed=2`。后续三步的启动条件是**链上事实"该 RootClose 已进入 closed=2"**,与谁翻的无关:观察到第三方翻牌 ⇒ 该市场落 `refund_flip` 意图为 **landed(幂等路径)**并**自动冻结**(reason `refund_flip_observed`,单向,走既有 `freezeMarket`)——使 v1"只处理冻结市场"天然覆盖它。**发翻仍只限冻结市场**(Bettor 裁定保持)。
- **入口**:现有 `ambiguous/refund_flip_observed` 分支只在 close_commit build 失败(`rootClose_*_drift`)路径触发(R10);需要**新增"翻牌后扫 prepared 的 close HOLD 行并标记"的入口**(NWT 非 MUST),不指望旧分支自己触发。
- **🔴 判据强度**:`closed=2` 的 P2SH 地址**公开可算,任何人可向它撒 dust**(relay facts 头注 N1)。若探针/landed 判据只看"该地址有没有 UTXO",攻击者对任意活市场向其 closed=2 地址付 dust ⇒ 驱动认定"已被翻" ⇒(配自动冻结)**把一个活市场打成冻结**。**必须**用 facts 形态同时核:**`covenantId == 该市场 RootClose 的 covenant id` ∧ spk == closed=2 的 spk ∧ 旧 RootClose outpoint 已被花(血缘)**,**三者缺一不可**,**不得地址级**。
- **自己发的翻牌**落地判据:`check_utxo_landed(target, txid)`(txid 锚定)即可(合约的 `validateOutputState` 已在共识层强制输出状态,tx 被接受即输出正确)。
- **测试**:向 closed=2 地址撒**无 covenant 的 dust** ⇒ 探针必须判"未翻"(**弱注入臂**:只改 `covenantId` 一个字段,其余三条件保持满足 ⇒ 仍判"未翻");旧 outpoint 未花但后继位置有带 covenant 的 UTXO ⇒ 判"未翻";三条件全满足 ⇒ 判"已翻" ⇒ 幂等记 landed + 冻结(reason 正确、单向)。

### 3.6 builder 与触发要点(R-a)
- `buildRefundFlipTxJson` 与 `buildCloseCommitTxJson` 并列,共享同一批断言:`assertChainParentsMatchBuilder`、`selectChangeShape` / `assertImpliedFeeMatches` / `assertKaspadInputVersionRule` / `assertMassWithinCeiling`。输入 0 = RootClose(**无签名**,witness=`encodeCloseCommitAction(refund_flip)`+redeem),输入 1 = relay fee UTXO(relay 签,`signInputIndices:[1]`),输出 0 = 续约 RootClose(closed=2,沿用 covenant id,`continuationOutputIndices:[0]`)+ 找零;`lockTime = deadline_ms + 7,200,000`。
- **时间闸**:复用 `checkPmtGate`,`pmt ≥ lockTime + 30s` 才放行;pmt 读不到 ⇒ fail-closed。
- **触发 SQL**(`listWork`):`status='sealed' ∧ settlement_frozen_at IS NOT NULL ∧ NOT EXISTS(resolve 意图 ∈ submitted/landed/ambiguous) ∧ NOT EXISTS(refund_flip 意图 ∈ landed/ambiguous)`。prepared 的 resolve 行(F1 HOLD)**不阻止翻**(同意);翻后其输入被花,F1 的 HOLD 语义与之一致,并按 §3.5 新入口标记该行。
- **XOR 竞态**:翻与 close 抢 `closed==0`,后到者 `inputs_spent`;冻结市场上驱动自己无自竞争;外部第三方先翻 ⇒ §3.5 幂等路径。

### 3.7 验收线(**M7:可检查条款**,每批准入)
**通用**:simnet 验收必须用**驱动的生产 builder 字节**(不是 harness 拼的);harness 的 D 臂只证合约允许,**不顶替**生产字节验收。
**R-a**:
1. **fee 输入用 relay 的真实 fee UTXO**(0.7–0.9 KAS 量级),不是 50 KAS coinbase。
2. **mass 以节点 `getMempoolEntry` 的 `storageMass` 与 `computeMass` 两个维度为准**(各 500,000 上限),**不信** kaspa-wasm 本地 `assertMassWithinCeiling`——账本 1467 已记本地 mass 不计 compute_budget,且 NWT 实测单输入极简形状本地偏低 9.5 倍。
3. 门未开时**驱动零广播**的负对照 + 同 txid 门开后落地。
4. 冻结市场上存在 prepared 的 close(F1 HOLD)时:驱动翻牌、该 close 行被标记不重播。
5. **fee profile cap 由节点侧实测的 required fee 定**(harness 实付 19,940,400 sompi ≈ 0.199 KAS;relay 动态净损上限 = min(2×required, 1 KAS) ≈ 0.4 KAS,所以 fee UTXO 选择的 `feeMinAmount` 要为该 step 单独定,与 F3-b 取舍 A 同源)。
6. **v214 迁移在主网库 `.backup` 副本上通过**(§3.2 四项核对)。
**R-b/R-c**(合约仅 debugger 证据 ⇒ simnet 真跑是**准入**):
1. **tickets 必须是真实 `register_append` 下注产生的**,不得 harness 伪造(RefundClaim 的 `ps_tmpl_hash` / `Tk{bettorPk,direction,stake,shardPoolId}` 必须与 proto-v0 ticket 的模板和 state 布局逐位对得上,伪造的票会让该绑定空判通过)。**该"逐位对应"本身 UNVERIFIED(NWT 未运行)**——列为 R-b 的首个检查项。
2. **full 与 partial 两分支都真跑(≥ 2 张票)**。
3. `RefundClaim.sil` 文件头仍标 "⚠ DRAFT … 待 NWT R1-XOR 终审"——**R-c 开工前须把这条终审关掉**(NWT 按需另出,不并入本轮)。
4. R-c 完成定义见 §0(每票一个 KanetTokenClaim,不含 withdraw)。

### 3.8 其余测试
- **离线向量**:builder fail-closed 守卫逐条;`listWork` 触发 SQL 真值表(冻结/未冻结/有无 resolve 意图/已翻/**主网形状 cancelled 夹具**);markLanded 事务性(派生失败整体回滚);intent 表重建前后行保真。
- **突变**:去掉"冻结"触发谓词 ⇒ 未冻结市场被翻(红);去掉 pmt 闸 ⇒ 开门前广播(红);把 M1 触发改回 `status='cancelled'` ⇒ 主网形状夹具红;把 M5 判据降为地址级 ⇒ 撒 dust 测试红;去掉 M4 串行 ⇒ 3 票测试红;M3 id 改随机 ⇒ 重跑行数测试红。

---

## 4. 未证 / 状态
- **已由 NWT 核实**:两处点名的复用结论;R1–R11(除 R5 夸大已撤回);KB 无相关条目;`closed=2` 读回口径——自己发的翻牌不需要独立来源,**观察别人翻牌需要 covenantId + 血缘**(M5)。
- **仍 UNVERIFIED**:RefundClaim 与 proto-v0 ticket 模板/state 布局逐位对应(§3.7 R-b 首检);单操作员下 Σ 票 stake 与 `pool_value` 恒等(M3 守恒断言兜底);relay 小面值 fee UTXO 下 refund_flip 的两维 mass(§3.7 R-a 2);逐票串行 × tick cap 吞吐(未测量)。
- **状态**:本稿 v0.2 = NWT 第二轮(最后一轮)审的对象;通过后派 R-a 实现。simnet 真共识准入需重起矿工——**先报 Bettor 再起**。
