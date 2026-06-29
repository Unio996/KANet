# J2 执行设计 — broker DM 真结算点火 + 8B node-accept live 验(gap③)

**作者**: J2 · **日期**: 2026-06-28 · **状态**: 设计待 Bettor/NWT 审 → 审过才执行(建盘/花币/上链)
**触发**: Owner 终裁(2026-06-28) ① broker DM 先上 Phase 1 ② 首页赛事聚合卡。本文档是 ① 的"产生一笔真结算去点火 DM"那一棒(J2 域),非 DM 投递(KANet-UI 已 ship+NWT 过)。
**铁律遵循**: 符合主线(Owner 终裁)✓ + 设计(本文)+ 审核(待 Bettor/NWT GO)。xzztw 失败教训:不凭推断、不手术 metadata、不手注票。

---

## 目标(一笔盘同时达成三件)
1. broker fee 真上链 LAND → `broker_fee_landed` emit → poller DM 弹 Owner 手机 = Owner① 真闭环。
2. 8B spine 盘真 settle node-accept(无 NUM2BIN)+ settle_txid landed = gap③ 真闭(NUM2BIN fix live 证)。
3. 全自然(委员自动投票+自动签+自动 settle),零手注、零手术。

## 资产查证(Owner 闸 — 查了哪些既有·确认非重造)
- `broker-fee-emit.mjs`(b8bb2532·NWT 7 项全 PASS)— emit 复用,不改。
- `create-v07`(pool.js L796+)— broker_address 支持 L921-936(assertBrokerP2PK)、8B spine(NWT 验 xzztw=58cd 编译层生效)、`POOL_DEADLINE_MIN_OVERRIDE`。复用不改。
- `deriveVote` 路由(bettor-prediction-voter.js L725/735/747)+ **tick 预过滤 L355-363**。
- `brokerFeeLandedEmitTick` 已 wire settler L1179(NWT 确认)。
- Owner tg 映射:`tg_user_id=1437320734 ↔ kaspatest:qzhet8m2...gzgdl`(NWT 在 DB 确认)。
→ 全复用,无新建。

## 🔑 关键设计决策(code-grounded·非推断)

### D1. 预言机源 = ESPN-final(**不是 test-oracle**)— 更正 COORD-LEDGER L358
**理由(字节验)**: voter tick 预过滤 bettor-prediction-voter.js **L355-363**:非 polymarket 盘,若 `!findExtractor(spec.data_source_canonical)` → **skip(弃票)**。`findExtractor` 仅认 espn/coingecko/polymarket(oracle-evidence-extractors.mjs KNOWN_EXTRACTORS),**不认 localhost test-oracle** → test-oracle 盘被预过滤 skip → 委员永不投票 → 不自然 settle。
∴ **必用 findExtractor 认得的源**。选 **ESPN summary URL·一场已结束的比赛**(extractor 产 home/away_score→winner) → 过预过滤 → deriveVote Branch3(L747-751) → deriveKanetNativeVote 读真结果投票 → 共识 → settle。
> 这正是 design-first 兜住的坑:照 L358 用 test-oracle 会执行到一半发现委员全弃票。

### D2. 委员 = 全本地 5 个(无 cross-node)
**理由**: xzztw 卡在第5委员(index2 qpcp8u)跨节点 :3200 签不了 + unanimous-5。**全本地 5 委员 → 5/5 都能在 :3200 签 → 无 sig 卡 → 零手术**。
**待执行前查**:确认 :3200 有 ≥5 个本地可用 oracle 进 committee(查 pool_committee 取样源 / 本地 relay oracle 数)。

### D3. broker_address = Owner 托管地址
`broker_address = kaspatest:qzhet8m2...gzgdl`(Owner 自当 broker)→ settle 出 broker fee 落该址 → emit to_address=该址 → poller JOIN tg_custodial_wallets → DM 到 tg 1437320734(Owner 手机)。

### D4. 8B spine + 可快到期 deadline
create-v07 现编 8B(NWT 验)。deadline 用 `POOL_DEADLINE_MIN_OVERRIDE` 设短(分钟级)→ 快速进 settle,ESPN event 选已 final 的(结果可判)。

## 流程(全自动·零手注零手术)
```
create-v07(8B + broker_address=Owner托管 + ESPN-final源 + 全本地委员)
 → 最小种子注(maker stake + 可选双边小注·测试币)
 → deadline 到 → settler deadline-watcher → verifying
 → 委员自然投票(ESPN extractor 读已结束比赛·deriveKanetNativeVote)→ 共识
 → dispatchPhase2 建 settle TX(含 broker fee output)
 → 全本地 5 委员自治签(无 cross-node 卡)→ submit
 → settle_txid LANDED(check_utxo_landed=true)  ← NO TX NO STATE·gap③ 闭
 → broker fee output LAND → brokerFeeLandedEmitTick → broker_fee_landed
 → poller(24da268b 修后)→ DM 弹 Owner 手机
```

## 验收分工(ROLES.md 固化)
- **J2(我)**: settler driver·建盘/驱动结算·自测。
- **J1**: 跨节点同证 settle_txid + broker fee 双节点 landed。
- **Bettor**: 链验 broker fee 金额(predict-then-verify)+ DM 到达。
- **NWT**: 端到端/攻击测复核。

## 风险 + 兜底
- **NO TX NO STATE**:settle 必 `check_utxo_landed=true` 才算闭,广播没上链不推状态。
- **测试币**:Bettor 全权·不纠结金额(faucet 供足)。
- **不手注票**:ESPN-final 源委员自然投(D1)。
- **不手术 metadata**:全本地委员从根上避免 sig 卡(D2),无需任何 unanimous/silent 手改。
- **8B 已验编译层**:但 live node-accept 仍以本盘 settle_txid landed 为准(gap③ 真闭信号)。
- **ESPN extractor 边界(Bettor 真对抗审 #2)**:tie / postponed / suspended / 改期 → judgeLine 可能误判 winner → settle 错 → broker fee 落错址。**兜底**:demo 必选**已正常完赛、决出明确 winner**的比赛(排除 tie/平局可能的项·NHL/NBA 常规无平·MLB 无平·足球可平→避免或选已分胜负的);且**建盘前 predict-then-verify**:手动 fetch 该 ESPN URL + 跑 extractor(findExtractor→extract)确认产出 winner==我预期且 state=final,**对死了再建盘**。判 winner 的边界完整性(495/495 tie/postponed 覆盖)= judgeLine/extractor 域(J1/NWT)的独立硬化问题,本 demo 用"选干净比赛+predict-then-verify"规避,不依赖边界完美。

## 待审 + 执行前查(GO 后我先确认再建盘)
1. **委员本地性**(D2):查 :3200 是否 ≥5 本地 oracle 可组全本地 committee。
2. **ESPN-final event**(D1·纳 J1 08:10 refinement):选一场**昨天/今天已 final** 的 ESPN 赛事(MLB/NBA/NHL 查哪个 final 了),建**单 winner 盘**(moneyline·sport-agnostic·extractor 读 home/away_score→winner·避 spread/total 的 sport-aware 半线复杂度)。J1 指出此路比 test-oracle 强:①源 recognized 委员自然投 ②judgeLine 真判非 mock _yes ③一条龙顺带 live 验 8B + judgeLine + broker fee + DM。
3. **金额/种子**:maker stake + 是否需双边注(Bettor 拍测试币量)。

**请 Bettor/NWT 审:D1(源路由)/D2(委员locality)/D3(broker 映射)/流程/兜底。GO 后我先做"执行前查"3 项,再建盘,不擅自动手。**
