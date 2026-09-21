> **Status**: DRAFT v0.1 (2026-09-21 · J2 · 待 NWT 设计审 · 只读码写稿,未改任何代码;设计第一条=复用,见 §1)

# 驱动自己走退款路(N5b 收口)设计稿:refund_flip → convert_to_refundclaim → refund_payout 三步进驱动

- 依据:Owner 2026-09-21 聚焦令(唯一目标 D-029 主网结算自动跑起来)、账本 1617、1614(D 臂口径:harness 手拼 refund_flip 只证合约允许,不证 driver 会走;逐票退款归 N5b)。
- 现状一句话:**冻结市场(oracle 异常路的唯一出口)现在只能人手拼 tx**——`proto-oracle-policy.mjs:3` 的 N5b 谓词正是因此禁止"有价值市场带判定题上主网"。本稿 = 把这条出口接进 driver,使 N5b 谓词可以放宽。
- 坐标为 `origin/bshard-m3-deploy` @ cef953c1 读数(行号会漂,配 grep 词)。

---

## 1. 已有什么(设计第一条)

### 1.1 D-031 复用核查:你点名的两处
| 点名 | 结论 | 依据 |
|---|---|---|
| `pool-seal-builder.mjs:93` `buildConvertToRefundClaimCommand`(J1 6/20 bshard) | **不能直接复用,可复用的是"形状"** | 它是 **bshard(PoolLeaf/PoolRoot)** 家族的 **relay 命令**组装器(`buildSealToRootCommand` 产出 `bshard_*` relay action 的 witness 命令,头注 `pool-seal-builder.mjs:1-18`),不产出 txJson,走的是另一条 relay 命令而非 `covenant_broadcast`。它的内容只有一行有用信息:**convert_to_refundclaim = convert_to_claim 的同形兄弟,selector OP_3、目标 RefundClaim、携带完整 7-field state**(:108-115)。 |
| `proto.js:331` `refund_payout` 约定 | **只是注释 + 一个未实现桩** | :331 是块注释("RefundClaim.refund_payout 落地新建 KanetTokenClaim");`claim` 路由把 cancelled 市场映射到 `kind='claim_refund'`(:354)后走 `buildAndBroadcast(kind…)`,而**该函数整个就是一个抛"未实现"的桩**(`api/proto.js:38-40`,对 market_resolve/claim_draw/claim_refund/withdraw 一视同仁;生产的 resolve/claim 走的是 driver,不是这条路由)。**没有可复用的代码**;它给出的**约定**有用:cancelled ⇒ 每张 confirmed 票一笔退款、退 `stake`(1:1)、单操作员假设(候选须恰 1 条,否则 fail-loud)。 |

### 1.2 真正可复用的现成件(proto-v0 自己的栈,已在主线且已被测/已跑)
| # | 已有件 | 它现在管什么 | 坐标 |
|---|---|---|---|
| R1 | **合约路径已证**:`RootClose.refund_flip(rootOutIdx, tok_prefix, tok_suffix)` | 无签名、`closed==0`、`noTokenInput`、`tx.time ≥ deadline+7,200,000`、输出 closed 0→2。**simnet 真共识已接受**(D 臂 harness,`38a05faf…` daa 51861,负对照"门未开 input #0 is not finalized"→门开接受;`docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/` + NWT 复核 b804c805) | `kasia-console/src/lib/RootClose.sil` entry 1(grep `entry refund_flip`) |
| R2 | 我的 D 臂 harness `refund-flip.mjs` 已经**只用仓库原语**拼出该 tx | `computeRootCloseGenesisArtifact`(cur / closed=2 两个 spk)+ `encodeCloseCommitAction`(按 entryAbi 通用编码,refund_flip 也走它)+ `combineActionAndRedeem` + `selectChangeShape` + `assertImpliedFeeMatches` + `assertKaspadInputVersionRule` + `assertMassWithinCeiling` + `deriveLeafState`;`lockTime = deadline+7,200,000`;RootClose 输入**零签名**,fee 输入由第三方签;out0 = 续约 RootClose(closed=2)+ 沿用 covenant id | 脚本副本 `docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/scripts/refund-flip.mjs`;原语在 `proto-covenant-builder.mjs:401`、`proto-close-commit-witness.mjs`、`proto-convert-to-rootclose-witness.mjs:94`、`proto-tx-assembly.mjs`(selectChangeShape 等)、`proto-mass-ceiling.mjs:139`、`proto-leaf-state.mjs:25` |
| R3 | `buildCloseCommitTxJson`(同形兄弟) | 同样"消费 RootClose 输入 + relay fee 输入 + 续约 RootClose 输出",带 `chainParents` 断言、`pmtEvidence`、relay 签 fee 输入的返回形状(`signInputIndices` / `continuationOutputIndices` / `expectedTxid`) | `proto-tx-assembly-settlement.mjs:377`(close_commit 需要委员签名,refund_flip 不要——**差别只在:少一个签名、lockTime、目标 state**) |
| R4 | `buildConvertToClaimTxJson`(convert_to_refundclaim 的同形兄弟) | RootClose(closed=1)+ 持有代币输入 → 新建 RootClaim + 代币转出 | `proto-tx-assembly-settlement.mjs:592`;`RootClose.sil` entry 3 `convert_to_refundclaim` 与 `convert_to_claim` 同形(目标 RefundClaim、要求 `closed==2`) |
| R5 | `buildClaimDrawTxJson` / `buildWithdrawTxJson`(refund_payout / 退款后提取的同形兄弟) | claim_draw:RootClaim + 票 + 持有代币 → 新建 KanetTokenClaim;**withdraw = `KanetTokenClaim.spend`,退款产生的 claim 与赢家 claim 是同一个 KanetTokenClaim 模板,withdraw builder 原样可用** | `:783`(claim_draw)、`:1005`(withdraw)、`:1132/:1164`(ticket reclaim,**对 closed==2 显式 fail-closed**,:1135) |
| R6 | RefundClaim 合约与产物 | `refund_payout`:`closed==2`、读 dust-ticket(spent-once nullifier)、退 `ticket.stake`;full/partial 两分支(partial = RefundClaim 自续约)。**debugger PASS(full/partial 均,§0.9),未做 simnet 验证**;artifact 现算 `computeRootClaimAndRefundClaimTmplHashes` | `RefundClaim.sil`;`proto-covenant-builder.mjs:127`;设计 `docs/2026-09-16-j2-proto-v0-settlement-design-v0.1.md` §0.9/§0.10 |
| R7 | 驱动的 pmt 闸与 SLA | `evaluateCloseCommitTiming` 已产出 `sla:'refund_flip_open'`(`pmt ≥ deadline+2h`),`REFUND_FLIP_GRACE_MS`;core 的 `checkPmtGate` 读 relay `get_past_median_time` 并 fail-closed;`settlement_close_commit_refund_flip_open` 报警已登记 | `proto-close-commit-gate.mjs:12-35`;`driver-core.mjs:78、:245-246、:32-33` |
| R8 | 冻结 = 走 refund_flip 的既定语义 | 冻结后 `winning_side` 永不可写,"唯一出口 = 自然 refund_flip"(注释与告警文案已这么写);F1/F1b 使冻结市场的 prepared close 不重播不首发 | `proto-settlement-freeze.mjs:4`;`driver-core.mjs:175`(gated 文案) |
| R9 | 驱动一步所需的**接线骨架** | 意图状态机(prepared→submitted→landed、同字节重播、F1/F1b)、C1 取证(`STEP_INPUT_ROLES`)、fee 选取(E1/E3,见 F3/F4 稿)、`checkLanded` + `markLanded` 后效、`listWork` 触发 SQL、报警闭集 | `proto-settlement-intent.mjs`、`-chain-checks.mjs:27`、`-driver-core.mjs`、`-store.mjs`、`-ops.mjs` |
| R10 | 半截接线:`probeRefundFlip` | core 已有"close_commit 输入 drift ⇒ 探测是否被 refund_flip ⇒ 意图置 ambiguous + `settlement_refund_flip_observed`"分支,**端口在 service 里写成 `ops.probeRefundFlip ? … : undefined`,而 `proto-settlement-ops.mjs` 根本没实现它**(grep 全仓非测试代码零实现)⇒ 该分支在生产**是死代码** | `driver-core.mjs:211-217`;`services/proto-settlement-driver.mjs:108` |
| R11 | 数据形状已预留 | `proto_claims.side IN ('win','refund')`(v206);`proto_markets.status IN ('betting','sealed','resolved','cancelled')`(:5981) | `db/migrate.js` ~6031、~5981 |

### 1.3 由 §1 得出的结论
1. **不新造合约路径、不新造 builder 骨架**:refund_flip 是 R3(close_commit builder)删掉签名后的同形体,原语 R2 已在 simnet 证明;convert_to_refundclaim 是 R4 的同形兄弟;refund_payout 是 R5(claim_draw)的同形兄弟;退款后提取 = R5 现成 withdraw。
2. **"驱动加一个 step"的接线骨架 R9 已在,且 F1/F1b/F3/F4 的加固自动惠及新 step**。
3. **有一个死代码**(R10):现驱动"看见 RootClose 被翻"的探测端口无实现——加 refund_flip 落地判据时**正好把它实现掉**(同一个读回:RootClose 后继 UTXO 是否位于 closed=2 的 spk)。

---

## 2. 缺什么

### 2.1 三个新 step(按"驱动一步"的既定形状)
| 新 step | 主体 | 依赖 | 触发条件(建议) | 缺的东西 |
|---|---|---|---|---|
| **`refund_flip`** | market | seal landed | 市场 `status='sealed'` ∧ **已冻结** ∧ 无 submitted/landed/ambiguous 的 resolve 意图 ∧ pmt ≥ deadline+2h+30s(R7) | ① builder(R3 删签名);② `prepare`/`build` 端口分支;③ C1 角色(RootClose 一个输入);④ fee profile 键 `refund_flip`(需 simnet 实付数据定 cap);⑤ landed 判据 + `markLanded`(市场 → `cancelled`,并为每张 confirmed 票建一条 `proto_claims(side='refund', amount=stake)`——照抄 close_commit 的 markLanded 事务形状);⑥ 实现 R10 的 `probeRefundFlip` |
| **`convert_to_refundclaim`** | market | refund_flip landed | 市场 `cancelled` | builder(R4 同形:selector OP_3、目标 RefundClaim、`closed==2`)、目标地址 = RefundClaim genesis spk、fee profile 键、markLanded(记 RefundClaim outpoint) |
| **`refund_payout`**(逐票) | claim(side='refund') | convert_to_refundclaim landed | 每条 refund claim 一次 | builder(R5 claim_draw 同形:RefundClaim + dust ticket + 持有代币 → 新 KanetTokenClaim;full/partial 两分支;ticket 输入 = 该 bet 的 `proto_bets.ticket_txid/ticket_vout`(v206 已有列))、markLanded(写 `claim_txid`)。随后 **withdraw 沿用现有步骤**(R5) |

### 2.2 接线触点清单(加一个 step 要碰的地方——都已在册,无新机制)
`proto-settlement-intent.mjs:29`(SETTLEMENT_STEPS)、`STEP_SUBJECT_TYPE`/`STEP_DEPENDS_ON`(同文件);**`proto_settlement_intents.step` 的 CHECK 是硬编码枚举**(`db/migrate.js:6328-6330`)⇒ 需要一次**表重建迁移**(v214;SQLite 不能改 CHECK;同 v207 重建 proto_markets 的既有手法);`driver-core.mjs:13/15`(SETTLEMENT_DRIVER_STEPS / STEP_INTENT);`proto-settlement-store.mjs:12-14`(BATCH9_INTENT_PREDICATE / DRIVER_STEP_OF_INTENT)与 `listWork` 触发 SQL、`markLanded`、`effectsPending`;`proto-settlement-chain-checks.mjs:27`(STEP_INPUT_ROLES)与 pointers;`proto-settlement-ops.mjs:23`(FEE_PROFILE_KIND)+ `prepare`/`build`;`scripts/proto-v0-template-anchors.json` 的 fee profile;`SETTLEMENT_ALERTS` 闭集;`DATABASE.md`(改表必同步)。

### 2.3 需要决定的策略(不是代码缺口)
- **谁触发 refund_flip**:只对**冻结市场**自动翻?还是也包括"**未冻结但 deadline+2h 仍无 close landed**"的市场(委员失联的兜底)?后者与 driver 自己的 close_commit **竞争同一个 `closed==0`**(R1 XOR),且 refund_flip 不可逆。**建议 v1 只做冻结市场**(oracle 异常路,N5b 的字面缺口);未冻结市场保持人手(如主网 a59c 形)。
- **N5b 谓词放宽的条件**(`proto-oracle-policy.mjs`):三步都在 simnet 走通 + NWT 审过之前**不放宽**;放宽本身须 Owner。

---

## 3. 改法与测试

### 3.1 分批(每批独立可回滚、只合不部署;钱路/covenant ⇒ 须 Owner 批,铁律 0)
| 批 | 内容 | 依据 / 风险 |
|---|---|---|
| **R-a**(先做) | `refund_flip` 一个 step 端到端:迁移(step CHECK 重建)+ `buildRefundFlipTxJson`(R3 删签名 + lockTime + closed=2 目标 spk,**函数体的每个 fail-closed 守卫照抄 close_commit 的对应项**)+ ops/store/core 接线 + `probeRefundFlip` + markLanded(cancelled + refund claims) | 合约路径 R1 **已证**;唯一新面 = builder 与 fee UTXO 面值下的 storage mass(见 §4-2) |
| **R-b** | `convert_to_refundclaim` | 合约 debugger PASS,**未 simnet 验证**——本批含 simnet 验证 |
| **R-c** | `refund_payout` 逐票(full + partial)+ 退款后 withdraw 串联 | 合约 debugger PASS(full/partial),**未 simnet 验证**;partial 分支是 RefundClaim 自续约(V-T-8 已审为安全,§0.9);单操作员场景通常只有 1–2 张票,partial 要在 simnet 真跑一次 |

### 3.2 builder 设计要点(R-a)
- `buildRefundFlipTxJson(...)` **与 `buildCloseCommitTxJson` 并列、共享同一批断言**:`assertChainParentsMatchBuilder`(RootClose 输入 + fee 输入的 chainParents 逐项核对)、`selectChangeShape` / `assertImpliedFeeMatches` / `assertKaspadInputVersionRule` / `assertMassWithinCeiling`(全是 harness 已在用的原语,R2)。
- 输入 0 = RootClose(**无签名**,witness = `encodeCloseCommitAction(refund_flip entryAbi)` + redeem);输入 1 = relay fee UTXO(relay 签,`signInputIndices:[1]`);输出 0 = 续约 RootClose(closed=2,沿用 covenant id,`continuationOutputIndices:[0]`,面值 `CONTINUATION_OUTPUT_SOMPI`)+ 找零。`lockTime = deadline_ms + 7,200,000`。
- **时间闸**:复用 core 的 `checkPmtGate`(R7)读 pmt,`pmt ≥ lockTime + 30s` 才放行(harness 同值);`sla` 不再只是报警而是这一步的触发条件之一。pmt 读不到 ⇒ fail-closed(与 close_commit 同)。
- **触发 SQL**(`listWork`):`status='sealed' ∧ settlement_frozen_at IS NOT NULL ∧ NOT EXISTS(resolve 意图 ∈ submitted/landed/ambiguous) ∧ NOT EXISTS(refund_flip 意图 ∈ landed/ambiguous)`。**prepared 的 resolve 行(F1 的 HOLD)不阻止翻**——翻后其输入被花,F1 的 HOLD 语义(永不重播)与之一致;并应把该 HOLD 行标 `ambiguous/refund_flip_observed`(R10 的现成分支)。
- **XOR 竞态**:翻与 close 抢 `closed==0`,后到者 `inputs_spent`。冻结市场的 close 路径已被 F1/F1b 关死,故冻结市场上不存在自竞争;外部第三方任何人也可翻(permissionless)——落地判据看**链上事实**(后继 spk),不看"是不是我发的",所以别人先翻也走同一 markLanded(幂等)。

### 3.3 测试清单
1. **离线向量**(每批,同 c1/ops 既有向量风格):builder 的 fail-closed 守卫逐条(closed≠0、pmt 未到、spk 漂移、chainParents 不符、fee 输入为 covenant 绑定 ⇒ 拒);`listWork` 触发 SQL 的真值表(冻结/未冻结/有无 resolve 意图/已翻);markLanded 事务性(派生失败整体回滚,同 close_commit 的既有测试);intent 表重建迁移前后行保真。
2. **F1/F1b 互动**:冻结市场有 prepared 的 close(HOLD)+ pmt 越线 ⇒ 驱动翻 ⇒ 该 close 行被标 `ambiguous/refund_flip_observed`、不重播;别人先翻(外部第三方)⇒ 驱动的 refund_flip 意图走"链上已翻"→ landed 幂等。
3. **突变**:去掉"冻结"触发谓词 ⇒ 未冻结市场被翻(红);去掉 pmt 闸 ⇒ 开门前广播(红,节点 NotFinalized 对照);去掉 `probeRefundFlip` ⇒ close 行不被标 ambiguous(红)。
4. **simnet 真共识(每批,主网前置)**:R-a:D 臂形状(冻结 → 驱动**自己**翻,不再是 harness)——含负对照(门未开驱动不广播)与用**relay fee UTXO**(而非 harness 的 50 KAS 第三方 UTXO)落地;R-b/R-c:走通 convert → 逐票 payout(含 partial)→ withdraw,读回每一步链上状态。全部 simnet-only,主网 env 不碰;起矿工须先报。
5. **N5b 谓词**:三步 simnet 全绿 + NWT 审后,才提"放宽 `judgedMarketAllowedHere`"给 Owner。

---

## 4. 未证 / 请 NWT 设计审重点看
1. **§2.3 策略**:v1 只翻冻结市场——是否同意?未冻结但委员失联的市场(deadline+2h 仍无 close)如何兜底(人手?另立票?)。
2. **fee 输入面值下的 storage mass(UNVERIFIED)**:harness 用 50 KAS coinbase 带找零形状通过 `assertMassWithinCeiling`;driver 用的是 relay 的 0.7–0.9 KAS fee UTXO(≤ `SIGNED_INPUT_CEILING` 1 KAS)。close_commit 同形(2 输入 2 输出)在该面值下已 simnet 落地,**推断** refund_flip 同,但 refund_flip 的 fee 较高(harness 实付 19,940,400 sompi ≈ 0.199 KAS,含 covenant 输出的 storage mass 项)需要在 R-a 的 simnet 里用真 relay UTXO 实测,并据此定 fee profile cap。
3. **`closed=2` 读回口径**:D 臂"closed=2"是**仓库自算 spk 的 P2SH 等值**(NWT 复核已记为"两侧都是仓库自算,非独立来源")。`probeRefundFlip`/landed 判据沿用同法——独立来源(如对链上 RootClose 后继的 redeem 反解 state)是否需要?
4. R-b/R-c 的合约只有 debugger 证据(§0.9 已写明"debugger PASS ≠ 真共识"的教训),**simnet 真跑是这两批的准入条件**,不是可选项。
5. 每张退款票 = 一笔 tx + 一笔 withdraw:单操作员 v0 下票数个位,吞吐可忽略;若日后多票,`refund_payout` 串行(同一 RefundClaim UTXO 逐票 draw-down),需按 tick cap(默认 5)分摊——**未测量**。
6. 本稿未查 KB `D:\KANet-Knowledge-Base` 是否另有退款路设计;仓库内已 grep `docs/2026-09-16-j2-proto-v0-settlement-design-v0.1.md`(§0.9/§0.10/MUST-1/MUST-3)——**KB 未读,如 NWT 知道有请指**。
