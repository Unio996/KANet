# Oracle 经济安全 v0.6 — 匿名质押池 spec (Owner ack 锁定)

> **作者**: Bettor-tn (架构主持) | **日期**: 2026-05-30 | **Track**: B (testnet-only / MIT / spec 用 "if deployed")
> **状态**: R1+R2 对抗轮收敛,**Owner final ack (锁)**。本文 = 锁定架构,implementor 据此分 sub。
> **来源**: Owner 钦定 Phase 2 oracle 匿名设计 → J2 r96 5 议题 → R1 (J1 r94/95, J2 r97, NWT r94) → Bettor r2 第一稿 → R2 (J2 r98, J1 r96, NWT r95/96, UI r291) → Owner "让他女巫 + 干"。

---

## 0. 一句话

oracle 不再是 maker 公开钉死的 5 个(可被定向贿赂),改成**一个公开、人人质押的 oracle 池**,每个市场**按 stake 权重(线性)随机抽**一个委员会出结果。安全不靠"管住身份",靠**经济**:作弊要砸够总 stake + 被 dispute 揪出来全罚没 = 得不偿失。

---

## 1. 锁定架构

| 维度 | 锁定结论 | 出处 |
|---|---|---|
| **池** | 公开质押 oracle 池,成员 stake + 声誉 + 历史罚没全透明可观察 | 共识 |
| **选拔** | 按 stake **线性**权重 **链下** VRF 随机抽委员会 (N=5–7);`VRF(seed=marketId+block_hash+pool_state)` + 公开 proof,任何人可验 | J2 r98/2 + Owner C |
| **上链签** | 委员会用 FROST DKG 凑 1 个 MuSig2 聚合 Schnorr 签 (BIP340) | J1 r95, J2 r97 |
| **SS 验 (J1 r99 时序纠)** | ctor 仅烤 `poolMerkleRoot` (创建时委员会未知);`aggPk` + `committeePkHash` + merkle proof = **settle TX 参数** (per-event)。SS 验 ① `checkSig(aggSig, aggPk)` ② committee ⊂ `poolMerkleRoot`。**不验 VRF**,**0 新 silverc 原语** | **J1 r96/r99** |
| **选拔正确性** | 不靠链上强制,靠 **stake-slash 经济兜底**:选错/签错 = forfeit。VRF 公开可重算 → 选错 committee 同样公开可 dispute (命门覆盖选拔正确性,非只 outcome) | J1 r96 |
| **罚的粒度** | **(iii) 平时聚合匿名 / dispute 才亮个体票罚**。**settle output 烤 `committeePkHash`** 绑死本笔 committee;dispute entrypoint require 揭晓个体 PKs (H = `committeePkHash`) + 个体 checkSig → forfeit 错判者。单绑省一笔 TX (Bettor r7,待 J1 判 silverc settle-output 可存,否则退双-TX commit-reveal) | 四方一致 + Bettor r7 |
| **pot 上限** | **不设**。总 bond ≥ pot × 1.5 守在**池层** | 共识 |
| **错判赔付** | 池 bond forfeit → 输方钱 + 错判 bond 共池 → 赢方按赔率分 (PoolSide:118 拆分模型可改) | J2 r97/5 |
| **兼容** | v0.6 新市场 opt-in,v0.5 老市场不动 (`protocol_version` 分支) | NWT, 全 |

---

## 2. 女巫 (Sybil) — Owner 钦定 "让他女巫" + 线性权重

**Owner 5/30 钦定**: 不在身份层防女巫 (KANet 无许可,import 私钥即新身份,NWT 实测现有女巫防护 = 0)。议题足够多 + 玩家足够多时,女巫出现本身就是生态活跃的信号;公平协议级游戏里,女巫作弊得不偿失。**让他女巫,经济层自调。**

**关键数学 (Bettor 抓,逼出一个修正)**:
- 抽中靠 **stake 权重** → 操纵力 = **总 stake**,与开几个身份**无关**。10 个身份各 1 KAS = 1 个身份 10 KAS,权重相同。女巫白拆。
- ∴ **必须用线性权重 (weight = stake)**。**砍掉 J2 r98 护栏 #2 (`stake^0.7` sub-linear)** —— sub-linear 下拆身份反而拿 `k^0.3` 倍权重 (10 身份 ≈ 2×),等于**奖励女巫**,与 "让他女巫" 自相矛盾。线性下拆身份不赚不亏,才一致。
- **砍掉护栏 #3 (必须 N 个不同实体 / 需 KYC)** —— 无许可链做不到,且线性权重下无必要。
- **保留**:#1 单 oracle 权重封顶 (defense-in-depth,逼女巫多拆 → 多份 7 天锁定,抬摩擦;非 load-bearing) + #4 解锁延迟 ≥ 7 天 (退场也罚得到)。

**命门 (整套安全的唯一支点)**: 经济威慑成立 ⟺ **作弊能被 dispute 揪出来罚**。∴ 团队主力投在**让 dispute 检测可靠** (系统层自动审计高概率触发亮票),不投在防身份。dispute 检测弱 = 整个模型塌。

---

## 3. NWT R2 3 挑处理 (写进 scope)

- **挑1 (bond 模型撞车)**: 0.3/0.5/0.7 tier (J2 r72) 现有代码**未落地** (grep pool.js/bettor.js 0 命中)。oracle bond (本 spec) 与 maker/broker bond 是**不同角色的钱**。**v0.6 scope = 仅 oracle bond**;maker/broker bond 另案,不在本 spec。
- **挑2 (oracle 白干没动力)**: oracle 跑链下 FROST 协调有时间成本却无额外链上收益 → **oracle 必拿 fee** (`oracle_fee_pct` 现存,确认覆盖 hybrid 协调工作量)。激励 = 跑 hybrid 的动力。
- **挑3 (女巫)**: 见 §2,Owner "让他女巫" + 线性权重已解;NWT 实测数据 (固定地址链上不可区分) 反证 identity-gating 走不通,支持经济路线。

---

## 4. 5 议题最终答案

① **选拔**: 公开池 + stake 线性权重链下 VRF 抽 N=5–7 + 公开 proof。
② **匿名 vs 问责**: 池公开 (成员可问责),本笔选中谁隐藏至 settle (防贿赂);dispute 才亮个体 (按需问责)。匿名 ≠ 不透明 (UI r291)。
③ **攻击模型**: 攻击者只知池不知本笔委员会 → 必 broad bribery,成本 ∝ pool stake 总量,不 ∝ pot;且需砸真 stake + 被罚没。
④ **pot 上限**: 不设。总 bond ≥ pot×1.5 守池层。
⑤ **错判赔付**: 池 bond forfeit → 输方钱 + 错判 bond 共池 → 赢方按赔率分。

---

## 5. 待实现子问题 (sub 内解,非架构 blocker)

- **dispute 摩擦** (UI r291 #2): dispute 发起需押 bond,防恶意 doxx 诚实 oracle。
- **MuSig2 nonce 安全** (J1 r95): nonce 重用 = 私钥泄露 → stateful nonce store + 1-time-use,oracle 端基建。
- **FROST DKG 成本** (J1 r96): O(N²) msg,N=5–7 控成本 + 控 merkle proof 长度。
- **onboarding UX** (UI r291 #3): 教用户从"信任公司"转到"信任激励结构"。
- **池更新透明** (J2 r98/2): 新 oracle 加入 / 旧退出周期 commit 到 chain_events。
- **storage mass**: settle TX payload + 输出集受 Kaspa KIP-9 storage mass ≤ 100k 限;committee 小 + merkle 短控住 (并入 §1 N=5–7 理由)。

---

## 6. Sub 分配

| Implementor | Sub | Scope |
|---|---|---|
| **J1tn** | SS v0.6 | PredictionEscrow/Pool .sil 改: ctor 烤 pool merkle root + aggPk; `checkSig×1`; merkle 验 committee⊂pool; dispute reveal entrypoint (bake `H(committee_PKs)` + 个体 checkSig forfeit)。silverc compile + byte verify |
| **J2-tn** | 经济 + 选拔 | stake 线性权重无放回采样 + 链下 VRF + proof verify;护栏 #1/#4;oracle_fee 覆盖 FROST 工作量;pool bond ≥ pot×1.5 落地;**复核 Bettor 砍 stake^0.7 的推导** |
| **KANet-UI-tn** | 信任 UI | 5 面板 (池透明 / 每笔信任读数 / 罚没日志 / bond-pot 比状态条 / 巨鲸 badge) + onboarding 教学 |
| **NWT-tn** | regression-runner (Plan A) | 现 unblock — `scripts/regression-runner.mjs` 自跑 6 历史 settle + dispatcher + fee floor + **匿名 backward-compat verify**;autobet daemon 改 hybrid 当 stress framework |

---

## 7. 流程纪律

- v0.6 = `protocol_version` 新分支,ADDITIVE,v0.5 老市场零影响。
- 每 sub commit 立 broadcast;reviewer (Bettor 三层 + 安全) 审后 ship;真链 regression PASS 才 close。
- testnet-only:本 spec 描述任何 mainnet 部署用 "if deployed"。

---

*Bettor-tn 架构主持 — R1+R2 对抗收敛 + Owner ack 锁。0 solo decree:本 spec 每条带出处,implementor 复核反驳走链上。*
