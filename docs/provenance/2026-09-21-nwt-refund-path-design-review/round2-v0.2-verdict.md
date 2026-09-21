# NWT 第二轮(最后一轮):驱动退款路设计稿 v0.2 @a546a517 —— 只核 M1–M7 与 Bettor 两条裁定

**结论:PASS。M1–M7 逐条落实,Bettor 两条裁定落实,无未落实项。** 通过后派 R-a 实现;simnet 真共识准入需重起矿工,先报 Bettor。

| 项 | 状态 | v0.2 依据 |
|---|---|---|
| M1 触发不看 `status` | 落实 | §2.1:三步以"该市场存在 `refund_flip` 意图 landed(依赖行)∧ 链上事实"触发,不看 status;markLanded(refund_flip) 加前态 `status='sealed'` 谓词、不写已 `cancelled` 的遗留行;主网形状夹具(cancelled 无意图行、有 pending bet ⇒ 零动作零报警);§3.8 突变"触发改回 status='cancelled' ⇒ 夹具红";§1.2-R11 如实记 `cancelled` 现有两种含义 |
| M2 v214 迁移 | 落实 | §3.2:同事务内用 `sqlite_master` 枚举 `sql LIKE '%proto_settlement_intents%'` 的触发器(不手写清单)→ DROP → 建新表(CHECK 含三个新 step)→ INSERT SELECT → DROP 旧 → RENAME → 按原文重建触发器与索引;foreign_keys 开关在事务外;前后核对触发器集合(名+sql)/索引集合/行数/`foreign_key_check`/`integrity_check`,不一致⇒回滚并 LOUD 拒启动;主网库 `.backup` 副本上验;部署前备份 + 失败回退动作;单测覆盖"库里已有意图行"与"已有 v212 触发器"两种前置。与我实测的失败原因(`trg_pm_ws_r1_delete_guard` 引用意图表)逐点对上 |
| M3 退款票身份 + 守恒 | 落实 | §3.3:id = `sha256(market_id ‖ ticket_txid ‖ ticket_vout ‖ 'refund')`(`proto_claims.id` 本为 TEXT PK ⇒ `INSERT OR IGNORE` 自然幂等,不加列不加迁移),同 pk 两票得不同 id,映射可由 `proto_bets` 复算;守恒断言 Σ(refund amount)==RootClose `pool_value`==held token amount,不等 HOLD+报警;测试(重跑行数不变/同 pk 两票各一笔/Σ 不等 HOLD);突变"id 改随机⇒重跑测试红" |
| M4 逐票串行 | 落实 | §3.4:每市场至多一个在途 payout(依赖=上一笔 landed),输入取上笔已 landed 后继输出(首笔取 convert 输出)而非静态角色,新增 RefundClaim 状态读取,full/partial 由链上剩余 `pool_value` 决定;测 3 票同 tick 严格串行、末张 full;突变"去串行⇒红" |
| M5 观察接续 + 判据强度 | 落实 | §3.5:后续三步启动条件=链上事实 closed=2,与谁翻无关;观察第三方翻牌⇒幂等记 landed + 自动冻结(`refund_flip_observed`,走既有 `freezeMarket`,单向);判据 `covenantId==该市场 RootClose covenant id ∧ spk==closed=2 ∧ 旧 RootClose outpoint 已花`,三者缺一不可、不得地址级;自发翻牌用 `check_utxo_landed(txid)`;测试含撒无 covenant dust 判未翻、弱注入臂(只改 covenantId)、旧 outpoint 未花但后继位置有带 covenant UTXO 判未翻;新增"翻牌后扫 prepared 的 close HOLD 行"入口;突变"降为地址级⇒红" |
| M6 终态 | 落实 | §0:终态=每张 confirmed 票一个链上 KanetTokenClaim 且 claim_txid 已写,不含 withdraw(非驱动步骤、需逐用户身份);Owner 请示口径写死"用户取回还需 withdraw,尚未接线";R5 的"withdraw 沿用现有步骤"已撤回 |
| M7 验收线 | 落实 | §3.7:通用=生产 builder 字节;R-a 六条(真实 fee UTXO/节点侧 storageMass+computeMass 两维/负对照+同 txid 门开落地/冻结市场有 prepared close 时驱动翻牌且该行不重播/fee cap 与 feeMin 由节点侧实测定/迁移在主网库副本通过);R-b/R-c=真实 register_append 票(ticket 模板与 state 布局逐位对应列为 R-b 首检)、full 与 partial 两分支各真跑(≥2 票)、RefundClaim.sil DRAFT 终审在 R-c 开工前关掉 |
| Bettor 裁定① 只自动翻冻结市场 | 落实 | §2.3/§3.6:发翻触发 SQL 要求 `settlement_frozen_at IS NOT NULL`;未冻结保持人手,兜底靠 M5 |
| Bettor 裁定② 采 M5 | 落实 | §3.5 |
| R-a 排在 F3/F4 之前 | 落实(稿的措辞是"由 Bettor 定,若之前……") | §3.1:若之前,R-a 沿用现有选择器无预留,批说明须写"争用时 HOLD 非丢钱",F4 落地后迁调用点——与你的裁定一致;R-a 批说明照写即可 |

## R-a 实现审时我会查的两个落点(不是新 MUST,只是 v0.2 留给实现的细节,避免到时争议)
1. **M5 的"幂等记 landed"需要一个 txid 来源**:`markLanded(refund_flip)` 要求 `intent.submitted_txid`(NO TX NO STATE);第三方翻牌没有我方 txid——应取自 facts 读回的 closed=2 后继 UTXO 的 outpoint.transactionId,并与"旧 RootClose outpoint 已花"的花费交易核对同一 txid(血缘的一部分)。
2. **M3 的前提**:创建退款 claim 时 `ticket_txid/ticket_vout` 须非空;任一 confirmed 票缺票据 outpoint ⇒ 按守恒断言同一路径 HOLD,不得用空值参与 id 哈希。

不再开新面。
