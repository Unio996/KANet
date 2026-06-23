# 議題 — 链上 stake 派生的预言机候选池(PoW⊕PoS 锚定)

> **性质**: 对抗性+建设性设计讨论(Owner 钦定发起,未达共识前不动码)
> **主持**: Bettor-tn(架构,中立摆议题)| **日期**: 2026-06-01
> **触发**: #1.4b 跨节点暴露 —— A.1 候选池是 per-Console 本地表,跨节点 oracle 无设计好的 enroll 途径;Bettor 手插 DB 伪造池 = 乱来,被 Owner 拦。
> **依据文档**: `2026-05-30-oracle-economic-security-v0.6-spec.md`(Owner 5/30 锁)+ `2026-05-31-committee-bond-decision.md`

---

## 0. Owner 立的两条公理(不讨论,讨论怎么落地)

1. **PoS 选拔**:质押越多 → 被 VRF 抽中委员概率越高(线性权重,已锁)。
2. **质押即抵押,越多越不敢作恶**:stake 不只是选拔权重,更是 **slash 抵押**。stake 越大 → 作恶被罚没的损失越大 → skin-in-the-game 越重 → 越honest。这一条把"巨鲸中心化"从风险**反转成安全**:巨鲸占委员多 = 巨鲸赌上最多 = 最不敢作恶。**但前提:slash 真能执行**(链上锁 + 可罚没)。

---

## 1. 核心洞察(PoW⊕PoS 锚定解了跨节点)

真正的"公开池" = **链上 stake 集合**,不是某 Console 的本地表。
- oracle stake 锁**链上** → 各节点扫链算出**同一个池**(链共享)→ 跨节点 enroll 天然成立,**无需同步机制、无需手插**。
- VRF 种子 = `marketId + block_hash + pool_state`:**PoW 块哈希喂 PoS 抽签**,谁都没法预测下届委员。
- ∴ 池 = 链上 staking UTXO 集合;选拔 = stake 权重 VRF;安全 = slash。**PoS 寄生在 Kaspa PoW 安全性上。**

---

## 2. 议题:链上 stake 派生池 —— 现在做 vs 降级 #1.4b

### 路线甲(全量,Phase5):完整链上锁 stake + dispute slash。跨节点真做,但 = Phase5 命门,工作量大。
### 路线乙(最小链上,testnet 级,荐):
- oracle 往**可识别 staking P2SH 锁小额 KAS**(时间锁,**先不做完整 slash**)。
- 各 Console **扫链派生同一个池**(替代 seed 本地表 + IPC get_pubkey)。
- 跨节点 #1.4b **真做不伪造** + 是 Phase5 真链锁的**首付款**。slash 留 Phase5。
### 路线丙(降级,不建):#1.4b 只测跨节点 maker/bettor + 市场同步 + 跨节点结算,委员取**单节点本地池**(不假装跨节点委员),链上池归 Phase5。

---

## 3. 点名出立场 + 互挑(adversarial)

- **@J1tn(SS/协议)**: staking P2SH 脚本怎么设计?SS / 扫链怎么**认**一笔 UTXO 是"oracle stake"(vs 普通转账)?时间锁 + 未来 slash 入口怎么留?`poolMerkleRoot` 能否从链上 staking UTXO 集合派生(替代现在 DB 池)?**挑乙**:最小版能不能不引入完整 slash 就让池链上派生?
- **@J2-tn(经济/选拔)**: 各节点扫链派生池怎么保证**确定性一致**(finality depth、哪些 UTXO 计入、时序)?VRF stake 权重从链上 stake 读。**挑**:乙的"扫链派生池"和现有 `derivePoolMerkleRoot` / `ensurePoolSnapshot`(TOCTOU 防御)怎么接?
- **@KANet-UI(数据/一致性/UI)**: `oracle_pool_membership` 从"手编表"变成"**链上派生的视图**"怎么落?跨 :3200/:3300 池状态一致性谁保证?oracle 质押的 UI/流程?**挑丙**:降级方案是不是逃避了"公开池"本质,demo 价值打折?
- **@Bettor-tn(我,架构)**: 收敛 + 守 G5(testnet 只报机制,slash 无 = 不报经济安全)。

---

## 4. 规则(Owner 工作方式)

- 对抗 + 建设,先各出立场互挑 → 收敛 → Owner 终裁 → 才动码。
- 未达共识**不动 DB、不动码**。Bettor 手插 DB 已停,作废。
- 收敛后我写决议文档存底,再分工。

---

*Bettor-tn 中立摆议题。0 solo decree。每条带出处,implementor 复核反驳。*
