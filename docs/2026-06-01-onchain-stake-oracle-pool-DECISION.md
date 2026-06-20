# 决议 — 链上 stake 派生预言机候选池(乙路线 / PoW⊕PoS 锚定)

> **性质**: 5-agent 对抗共识决议(待 KANet-UI 立场 + Owner 终裁后锁)
> **主持**: Bettor-tn(架构)| **日期**: 2026-06-01
> **議題源**: `2026-06-01-onchain-stake-oracle-pool-discussion.md`
> **状态**: 🔒 **锁定(2026-06-01)** — Bettor 自决依据:5-agent 共识(J1/J2/NWT/KANet-UI/Bettor 全背乙,无一挑丙)AND 与已锁文档对齐(测试网公开范式 + v0.6 公开池 spec 初衷)。按 Owner 工作方式「共识+文档对齐即自决,禁逐项求批」。Owner 仅例外干涉(freeze/差评)。

---

## 0. 一句话

预言机候选池从 **per-Console 本地表** 改为 **链上 staking UTXO 集合派生**:oracle 把 KAS 锁进 `OracleStake_v1.sil` P2SH,各节点扫链按统一公式派生**同一个 poolMerkleRoot** → 跨节点 oracle enroll 天然成立、无需手插。**testnet 走最小版(乙):只 e0 自助 unlock,slash 槽 baked-disabled 留 Phase5**。

---

## 1. Owner 两公理(议题前提)

1. **PoS 选拔**:stake 越多 → VRF 抽中委员概率越高(线性权重,已锁)。
2. **质押即抵押,越多越不敢作恶**:stake = slash 抵押,押越多作恶损失越大 → 巨鲸中心化反转成安全。**前提:slash 真能执行**(= Phase5,testnet 不成立,守 G5)。

PoW⊕PoS 锚定:VRF 种子 = `endBlockHash(PoW 锚) ⊕ poolMerkleRoot(链上 stake 派生 PoS 锚)`。PoW 块哈希的不可预测性给 PoS 选拔做防操纵随机。

---

## 2. 决议(待锁)

### 2.1 Staking SS(J1 r254)
- `OracleStake_v1.sil`,ctor(`stakerPkX`, `lockUntilDaa`, `slashQuorumPk`),每 staker 独立 P2SH(stakerPk 因人异)。
- **e0 timeout_unlock**: `require(daa>=lockUntilDaa) + require(sig(stakerPk))` — 自助取回。
- **e1 slash_by_proof**: **v1 不实现**(见下,Option C 锁定)。
  - ✅ **RESOLVED(Owner catch → J1 r255 → 锁 Option C,2026-06-01)**:
    - **B 已证伪(J1 r255/1)**: silverc tx context 仅 `tx.inputs[] / tx.outputs[] / tx.time / this.activeInputIndex`(PoolSpine_v07 实证),**无 getUtxo()/任意链查询 primitive** → 读不了"他 UTXO" → governance UTXO 验证做不到。
    - **锁 C(J1 r255/2 + Bettor)**: **v1 drop e1**,ctor 缩 `(stakerPkX, lockUntilDaa, minerFee)`,仅 **e0 timeout_unlock**。Phase5 = silverc 重写 **OracleStake_v2** 加 e1(真 quorumPk ctor)→ 新 P2SH = **显式版本号迁移,透明重 enroll**。
    - **诚实定性**: **不是"零迁移"**。v1→v2 是**显式版本迁移**(地址变,stake 到期 lockUntilDaa + 重 enroll 吸收)。砍掉"烤 disabled 占位再翻 ctor"的伪零迁移(翻 ctor 必换地址,占位零收益)。会变的值(quorumPk)**绝不进 v1 ctor**。
- **e2(后)**: rotate/relock。
- **识别 UTXO(B-class,不信广播信链)**:`oracle_stake_enroll_v1` 广播 envelope{stakerPk, lockUntilDaa, outpoint} 仅作 hint → scanner 本地 silverc 重编派生预期 P2SH → RPC `getUtxosByAddresses` 验 UTXO 实在 unspent + amount≥minStake。普通转账 spk 不算。

### 2.2 池派生(J2 r272/r273)
- `poolMerkleRoot`:leaves = `sort(stakerPkX asc)` → `sha256(pkX || amount_be64)` → merkleRoot。
- **确定性一致**:`snapshotDaa = createDaa − N`(**非 last-finalized**,各节点同公式同结果,屏蔽 polling jitter);**N=600 blocks≈60s**(testnet reorg/jitter 余量)。
- **约束**:market 寿命 > N+margin ≈ **>90s** 才能 reach finality 内 frozen stake set。
- `derivePoolMerkleRoot` **只改读源**(DB 表 → 扫链),接口签名不变;`ensurePoolSnapshot` TOCTOU + F-S3 anti-grinding 仍 valid(snapshot 锁 @ create 时链态)。

### 2.3 抽样资格门(Bettor,解 J1 反挑"逃 slash")
- 锁期嵌"最远市场"有鸡生蛋(enroll 时不知未来被抽哪些市场)。
- **解法移到抽样端**:一个 market 只从 `lockUntilDaa ≥ market.resolutionDaa + cooldown` 的 oracle 抽。→ oracle 被抽中时锁期已覆盖该市场结算+冷却,**不可能 unstake 逃**。silverc 不改,纯 sampler eligibility filter。

### 2.4 Verifier 守卫(NWT r143)
- **lint: `oracle_pool_membership` 禁手插/禁 /seed,强制链上派生**(= 焊死 Bettor 手插 KI,防复刻)。
- 跨节点 pool root 一致性回归(两 host derive → assert ==)。
- cross-node settle-audit:settle TX outputs 任节点链 RPC verify 不查本地 DB。
- SS forensic:`PoolSpine_v07` ctor poolMerkleRoot 链上派生 = 真 source-of-truth。

### 2.5 数据迁移 / 一致性 / UI(KANet-UI r484,站乙反丙)
- **迁移**:新表 `oracle_pool_chain_view`(snapshot_daa / leaves_json / merkle_root / derived_at)= **单一读源**;`derivePoolMerkleRoot` 读 chain_view,不读旧 `oracle_pool_membership`。
- **旧 5 行(qoyqv 委员)不清**:mark `legacy_origin=manual` + **7 天 grace**,期间各 oracle 必经 §2.1 chain enroll envelope 上链 → cache view 重 derive 才能续当委员;本机 maker-1/tester-2 enroll 后自动 reflow,**0 手插**。grace 后 `oracle_pool_membership` 转 read-only legacy,新写全闸 chain_view。
- **跨节点一致**:`kanet.env` 加 `ORACLE_POOL_FINALITY_N`,Console boot 跨节点校验 mismatch→WARN;新 endpoint `GET /api/oracle/pool-snapshot?daa=X` 返 derive(daa=X),NWT verifier 跨 :3200/:3300 fetch+diff(= NWT r143#2)。
- **协议不变量(承重)**:settle TX ctor `poolMerkleRoot` 必 `== derive(snapshotDaa)`,**mismatch → relay broadcast 前 reject**。这把"池一致性"从软校验升成硬门。
- **UI 公开可验**:bot `/publish`+`/bet` 显式 "oracle pool snapshot daa + merkleRoot" + 链浏览器深链;audit page 渲 sorted leaves+amounts(NWT verifier 平面 + 公众可看)→ bettor 独立验。

---

## 3. 守 G5(红线,诚实边界)

- testnet 最小版**无 slash** → 只证**选拔 + 跨节点池一致性**,**公理② "押越多越不敢作恶" testnet 不成立**(无 slash 无损失)。
- 报告只称"链上派生池 + 跨节点 VRF 一致性机制 PASS",**不报"经济安全"**。slash + 真锁经济命门 = Phase5 gate。

---

## 4. 范围 / 分工(待锁后细化)

- **J1**: `OracleStake_v1.sil` 实现 + silverc compile + byte verify + e1 槽 baked-disabled。
- **J2**: scanner 扫链派生池 + `derivePoolMerkleRoot` 改读源 + snapshotDaa=createDaa−600 + 抽样资格门 filter。
- **KANet-UI**: cache view 迁移 + 池一致性 + enroll UI/流程。
- **NWT**: 4 verifier 守卫 baked(lint 优先)。
- **Bettor(我)**: 收敛主持 + 审 + DB/链实证 + 守 G5。
- **#1.4b 跨节点**: 链上派生池 ship 后用真 enroll 重做(替代手插作废方案)。

---

*草案 — 4 方(J1/J2/NWT/Bettor)共识乙路线,KANet-UI 立场 + Owner 终裁待补。未锁不动码。*
