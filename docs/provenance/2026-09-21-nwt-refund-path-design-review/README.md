# NWT 设计审:驱动自己走退款路(N5b 收口)设计稿 v0.1 @e6d30ee8 —— verdict:**方向通过;push-back,7 条 MUST 补稿(v0.2)后过**

- 被审:`docs/2026-09-21-j2-driver-refund-path-design-v0.1.md`(origin/coord/j2-f1-f2-freeze-hold-20260921 @e6d30ee8)。坐标对着 `origin/bshard-m3-deploy` @cef953c1 我自己核。
- 方式:读码 + 一次**临时库上的迁移实验**(NWT 自己 worktree、temp DB、用完即删;零仓库改动、零主网触碰)。一轮只报 MUST。
- 结论先行:J2 的"已有什么"核查**基本对**(两处点名都核实,R1–R11 逐条核过,一处夸大见 M6);"不新造合约路径/builder 骨架/驱动骨架"的方向对。但稿在**迁移、触发谓词、退款票身份、逐票串行、观察到别人翻牌后的接续、验收口径**六处有会出事故的空缺,外加一处范围表述。

## 第一问核实("已有什么")

| J2 断言 | 我核到的 |
|---|---|
| `pool-seal-builder.mjs:93` 是 bshard 家族 relay 命令组装器,不产 txJson,只借形状 | 同意(该文件产 `bshard_*` relay action 命令;可借的只有"convert_to_refundclaim = convert_to_claim 同形兄弟、OP_3、目标 RefundClaim")。 |
| `proto.js:331` 只是注释;`claim_refund` 的 `buildAndBroadcast` 是未实现桩 | ✓ `api/proto.js:38-40` 桩 `throw new Error('buildAndBroadcast(kind): 未实现 …')`;`:343` 仅判 `resolved/cancelled`。 |
| R1 合约路径已证 | ✓ `RootClose.sil` entry `refund_flip`:`closed==0`、`noTokenInput`、`tx.time >= temporal(deadline_ms + 7200000)`、输出 `closed:2`;与 close 同 UTXO 上 XOR。simnet 证据我已在 b804c805 复核(负对照+同 txid 门开后接受)。 |
| R3/R4/R5 同形兄弟 | ✓ `convert_to_refundclaim` 要求 `closed==2` 且 `owned_total == pool_value`(与 `convert_to_claim` 的 `closed==1` 同形);`RefundClaim.refund_payout` 读 dust-ticket、`heldTk.amount==pool_value`、draw-down `pool_value - tk.stake`。 |
| R10 `probeRefundFlip` 端口在生产是死代码 | ✓ `driver-core.mjs:211-217` 有分支;`services/proto-settlement-driver.mjs:108` 写成 `ops.probeRefundFlip ? … : undefined`;`proto-settlement-ops.mjs` 无实现。**且该分支只对 `close_commit` 的 `rootClose_*_drift` 触发**(见 M5)。 |
| R5 "退款后 withdraw 沿用现有步骤" | ✗ **不成立**:`SETTLEMENT_DRIVER_STEPS = ['seal','close_commit','convert_to_claim','claim_draw']`(`driver-core.mjs:13`),ops 头注明写"不含 withdraw / ticket_reclaim"。builder 存在,**不是驱动步骤**(见 M6)。 |
| KB 无相关条目 | `D:\KANet-Knowledge-Base` 无退款路/fee 相关 durable 条目(关键词零命中)。 |

## Bettor 先裁的策略:"v1 只自动**翻**冻结市场,未冻结保持人手"——**发翻这一半同意;接续这一半有更弱处(M5)**

理由:发起不可逆的 refund_flip 只对冻结市场自动做,与驱动自己的 close_commit 不抢 `closed==0`(F1/F1b 已关死冻结市场的 close),正确。更弱处不在"谁发",在"翻牌之后谁接":refund_flip 是 **permissionless**(任何人 deadline+2h 后都能翻,我复核的 D 臂就是第三方付 fee),所以一个**未冻结**市场完全可能被外部第三方翻成 `closed=2`;此后它在链上已不可逆地进入退款态,"保持人手"变成"没有任何人手工具"(除了 harness 脚本)。

## MUST

**M1——退款各步的触发谓词不得以 `status='cancelled'` 为信号;主网库里已有两个语义不同的 `cancelled`。**
稿 §2.1 把 `convert_to_refundclaim` 的触发写成"市场 `cancelled`"。主网库现状(账本 1473/1613/1615):3 市场 = 2 个 `cancelled` + a59c resolved;`cancelled` 之一 a0c4d628 是**运营者 SQL 手工置的终态**(genesis 已上链、leaf 永久不可花、**从未有过 RootClose/refund_flip**)。`kasia-console/src` 里没有任何代码写 `cancelled`,所以现在 `cancelled` = "运营者放弃"。R-a 的 markLanded 会开始写它表示"已翻牌、待退款"——同一个值两种含义。若 `listWork` 用 status 选行,新驱动首个 tick 就会对这两个遗留市场尝试 convert_to_refundclaim(C1 取证失败 ⇒ 每 tick 报警噪声;更糟是某个取证缺口被放过)。
必须写明:三个退款步的触发一律以**该市场存在 `refund_flip` 意图 `landed`(依赖行)∧ 链上事实**为准,不看 `status`;测试用**主网形状夹具**(`cancelled` 但无任何意图行、有 pending bet)⇒ 零动作零报警;并在 markLanded 里对"前态 status='sealed'"加谓词(照抄 close_commit 的 `WHERE status='sealed'`),不得对已 `cancelled` 的遗留行写入。

**M2——v214 迁移"沿用 v207 手法"会失败,我实测了。**
`step` 的 CHECK 是硬编码枚举(`migrate.js:6324-6330`),要重建表。我在 temp 库(跑完当前全部迁移)上用 v207 同款配方(建 `_v214` → INSERT SELECT → DROP 旧 → RENAME)实测:
`REBUILD FAILED: error in trigger trg_pm_ws_r1_delete_guard: no such table: main.proto_settlement_intents`(SQLite 3.51.3,`legacy_alter_table=0`)。原因:v212 起 `proto_markets` 上的触发器在 `EXISTS(SELECT … FROM proto_settlement_intents …)` 里引用它,v207 重建 proto_markets 时这些触发器还不存在。事务回滚干净(行数保持),但这是**主网 console 启动时跑的迁移**——失败 = 启动异常。
必须写明:重建须在同一事务内先 DROP 引用它的触发器再按原文重建(或显式 `legacy_alter_table`),重建后核 触发器集合/索引集合/行数/`foreign_key_check` 与重建前一致;**验收在真实主网库的 `.backup` 副本上跑**(不是 simnet 库),并写明部署前备份与迁移失败的回退动作。(替代思路——不改 CHECK、新建并行意图表——违背"复用意图机器",不推荐。)

**M3——退款票没有身份,markLanded"幂等"会重复建行或丢行。**
稿说"为每张 confirmed 票建一条 `proto_claims(side='refund')`"。核实 schema:`proto_claims` **没有 bet_id/ticket 列**(`migrate.js:6027-6038`),`newClaimId()` 是随机 32 字节(`store.mjs:16`)。win 路径靠"`SELECT … WHERE market_id=? AND side='win' LIMIT 1`"守一行;refund 是 N 行,随机 id 下 `INSERT OR IGNORE` 永不命中 ⇒ markLanded 重跑(其设计就要求可重复)每次多插一批;同一 bettor 两张票(同 pk)也无法把 claim 映射回 `proto_bets.ticket_txid/vout`。
必须写明:退款 claim 的**确定性身份**(如 id = hash(market_id ‖ ticket_txid ‖ ticket_vout ‖ 'refund'),或加 bet_id 列+唯一索引——后者又是一次迁移,并入 M2),创建幂等,claim→ticket 映射可复算;**守恒断言**:Σ(refund claim amount) == RootClose state 的 `pool_value` == 待转的 held token amount,不等 ⇒ fail-closed HOLD(否则 payout 尾巴卡死);测试:markLanded 连跑两次行数不变;同 pk 两票各得一笔;Σ 不等 ⇒ HOLD。

**M4——`refund_payout` 是同一 RefundClaim UTXO 上的线性 draw-down 链,稿只在 §4-5 提"串行"而没进设计。**
`RefundClaim.refund_payout` 每次花掉当前 RefundClaim、产出 `pool_value - stake` 的后继(full 分支最后一张票才不续)。一个 tick 里 core 可推进多个 advance(cap 默认 3):两张票的 payout 若都按"convert landed"这一个依赖各自 prepare,会**选同一个 RefundClaim 输入**——第二笔 `inputs_spent`,落入 ambiguous HOLD(A 臂同类)。F4 的 fee 预留管不到这个输入。
必须写明:**每个市场同一时刻至多一个在途 refund_payout**(下一笔的依赖 = 上一笔 landed);每一笔的 RefundClaim 输入 outpoint 取自**上一笔已 landed 的后继输出**(或 convert 的输出),不是 `resolveStepPointers` 的静态角色;full/partial 由链上剩余 `pool_value` 与票 `stake` 决定(需要一个 RefundClaim 状态读取,现仓库只有 RootClose 的 `deriveLeafState`)。测试:3 张票同一 tick 触发 ⇒ 严格串行、无双花、最后一张走 full。

**M5——观察到"别人翻了牌"之后必须接续,且判据不得是地址级(dust 可伪造)。**
- 现状 R10:`probeRefundFlip` 只在 close_commit 输入 drift 时探,命中 ⇒ resolve 意图 `ambiguous/refund_flip_observed` + 报警"**转人工**"。对**冻结**市场 v1 自己翻,没问题;对**未冻结、被第三方翻了**的市场,"转人工"没有工具可转。
- 必须写明:refund 后续三步的启动条件是**链上事实"该 RootClose 已进入 closed=2"**,与谁翻的无关;观察到第三方翻牌 ⇒ 该 market 落 `refund_flip` 意图为 landed(幂等路径)并自动**冻结**(reason `refund_flip_observed`,单向)使 v1 的"只处理冻结市场"策略天然覆盖它——发翻仍只限冻结市场(Bettor 的裁定保持)。
- 🔴 判据强度:稿写"RootClose 后继 UTXO 是否位于 closed=2 的 spk"。**closed=2 的 P2SH 地址是公开可算的,任何人可向它撒 dust**(relay facts 头注 N1 已写这点)。若探针/landed 判据只看"该地址有没有 UTXO",攻击者对任意活市场向其 closed=2 地址付 dust ⇒ 驱动认定"已被翻" ⇒(配上述自动冻结)**把一个活市场打成冻结/取消**。必须用 facts 形态核 `covenantId == 该市场 RootClose 的 covenant id` ∧ spk ∧ **旧 RootClose outpoint 已花**(血缘),三者缺一不可;测试:向 closed=2 地址撒无 covenant 的 dust ⇒ 探针必须判"未翻"(弱注入臂:只改 covenantId 一个字段)。自己发的翻牌落地判据用 `check_utxo_landed(target, txid)`(txid 锚定)即可。

**M6——"N5b 收口"的终态必须写死,并撤回"withdraw 沿用现有步骤"。**
稿 §2.1/§3.1 R-c 写"随后 withdraw 沿用现有步骤"。withdraw **不是**驱动步骤(见上),且需要持币方签名(逐用户身份未做,Bettor 1610 已写"用户暂不能自助下注")。退款路的可达终态 = **每张票一个 KanetTokenClaim UTXO**,与赢家路径 `claim_draw` 终于 KanetTokenClaim 对齐。必须写:R-c 的完成定义 = "每张 confirmed 票对应一个链上 KanetTokenClaim,claim_txid 已写",**不含 withdraw**;并且"放宽 N5b 谓词"的 Owner 请示里如实写"用户取回还需 withdraw(尚未接线)"——否则会把"退款已自动"读成"用户已拿回钱"。

**M7——验收线(R-a/R-b/R-c 各批准入)写成可检查条款。**
- 通用:simnet 验收必须用**驱动的生产 builder 字节**(不是 harness 拼的);harness 的 D 臂只证合约允许,不顶替生产字节验收(我接位文件同款纪律)。
- R-a:① **fee 输入用 relay 的真实 fee UTXO**(0.7–0.9 KAS 量级),不是 50 KAS coinbase;② **mass 以节点 `getMempoolEntry` 的 `storageMass` 与 `computeMass` 两个维度为准**(各 500,000 上限),不信 kaspa-wasm 本地 `assertMassWithinCeiling`——账本 1467 已记本地 mass 不计 compute_budget,且我实测过单输入极简形状本地偏低 9.5 倍;③ 门未开时驱动零广播的负对照 + 同 txid 门开后落地;④ 冻结市场上存在 prepared 的 close(F1 HOLD)时驱动翻牌、该 close 行被标记不重播;⑤ fee profile cap 由**节点侧实测的 required fee**定(harness 实付 19,940,400 sompi ≈0.199 KAS,relay 动态净损上限 = min(2×required, 1 KAS) ≈ 0.4 KAS,所以 fee UTXO 选择的 `feeMinAmount` 要为该 step 单独定,与 F3-b 取舍 A 同源)。
- R-b/R-c:合约只有 debugger 证据 ⇒ simnet 真跑是**准入**(同意 J2)。补三条:① tickets 必须是**真实 `register_append` 下注产生的**,不能 harness 伪造(RefundClaim 的 `ps_tmpl_hash`/`Tk{bettorPk,direction,stake,shardPoolId}` 必须与 proto-v0 ticket 的模板和 state 布局逐位对得上,伪造的票会让这个绑定空判通过);② full **与** partial 两分支都真跑(≥2 张票);③ `RefundClaim.sil` 文件头仍标 "⚠ DRAFT … 待 NWT R1-XOR 终审"——R-c 开工前须把这条终审关掉(我按需另出,不并入本轮)。

## J2 点名的三问

1. **§2.3 策略**:同意"只自动翻冻结市场";补 M5(接续)。未冻结但委员失联、deadline+2h 仍无 close 的市场:发翻保持人手是对的,但它随时可能被第三方翻,故 M5 的观察→冻结→接续是它的兜底,不需要另立"自动翻未冻结"。
2. **小面值 fee UTXO 的 storage mass**:未证,同意;验收方式见 M7-R-a②(节点侧两维度,不是本地估算)。
3. **`closed=2` 读回口径要不要独立来源**:自己发的翻牌——不需要(合约的 `validateOutputState` 已在共识层强制输出状态,tx 被接受即输出正确;落地判据锚定 txid)。**观察别人翻牌——需要 covenantId+血缘,不是"独立来源"**(M5)。

## 非 MUST(记录)
- §3.2 触发 SQL 里"prepared 的 resolve 行(F1 的 HOLD)不阻止翻"——同意;标记该行时用现成 `ambiguous/refund_flip_observed` 分支,但该分支目前只在 build 失败路径,需要新增"翻牌后扫 prepared HOLD 行"的入口,别指望它自己触发。
- 与 F3/F4 的耦合:refund_flip 的 fee 输入走 F3/F4 的共享资格+预留函数;R-a 排在 F3-b/F4 之后还是之前由 Bettor 定,稿应写明依赖(不写会让 R-a 在无预留的现状上落地)。
- 吞吐(逐票串行 × tick cap)未测量,稿已自标。

## 我没验证的(UNVERIFIED)
- RefundClaim 与 proto-v0 ticket 模板/state 布局的逐位对应(M7 条款的前提;未运行);
- 单操作员下 Σ 票 stake 与 `pool_value` 是否恒等(M3 断言的前提,读 close_commit 路径未见现成对账)。
