> **Status**: DRAFT **v0.2** · **ST-02 · Snapshot 与运营方可替换性矩阵** · DRI J1(J1tn) × 协议复核 J2 × 红队 NWT
> 🆕 **v0.2(2026-08-08, J1tn)**:**文件名不改, 版本以本行为准**;**v0.1 原文一字不删**, 修订见文末 §6。
> **触发**: Codex 两份独立红队 `8258e70e`(第 1 项 seed dependency) + `ddd4acee`(2.7-bis 措辞与证据等级)。
> 🔴 **净变化**: **第 1 项 v0.7 那格降级**(链上可导 → 本地种子集上的链上验证);**2.7-bis 措辞收窄**;
> **n=1293 补可重放证据包 —— 而做这个包当场抓出我 v0.1 把出处写错了(见 §6.3)。**
> **授权**: `OWNER-DIRECTIVE-20260806-POST-TOCCATA-INSTITUTIONAL-STRESS-TEST` ST-02(`origin/coord/codex-bridge:coordination/codex-bridge/`)。**BATCH-0 = 只做设计 + 现状盘点 + 证据缺口;不实跑 / 不改码 / 不拉取上游。**
> **验收五级**(directive 定):`PROTOCOL_CAPABILITY` → `TESTABLE_MACHINERY` → `VERIFIED_PATH` → `USABLE_INFRASTRUCTURE`,**无锚 = `NOT_PROVEN`**。
> **约束**: 本稿只新增本文件。零代码 / 零 DB 写 / 零链上 / 零钱路。每条事实断言带 file:line 或命令输出(本会话现读,非记忆);推断显式标注。
> **证据分级**: `[CONFIRMED·源码实读]` / `[CONFIRMED·DB实读]` / `[CONFIRMED·实跑]` / `[强推断]` / `[未验]`。

# ST-02 · Snapshot 与运营方可替换性矩阵 (现状盘点 v0.1)

## §0 先划三条作用域(不划会被外推)

1. 🔴 **本机作用域**:所有 DB 读数只等于 **`D:/kanet/kanet/kasia-console/data/console.db` 这一份库**;所有环境读数只等于 **J1tn 这一台**。**别人那台不同**(本稿 §3 恰好有一个例子:同一路径的 rusty-kaspa 树在两台上版本不同)。
2. 🔴 **"SMT" 这个词在本仓不存在**:directive 判定句写「"SMT 可重建"不得单独升级为"运营方可替换"」。本会话 `grep -rl "SMT\|sparse.merkle"` 于 `kasia-console/src/` 与 `docs/` ⇒ **零命中** `[CONFIRMED·源码实读]`。本仓用的是 **merkle root**(`poolMerkleRoot` / `betsRoot` / `payoutRoot`)。⇒ **本稿把该判定句读作"任何 root 可重建"的一般形式**,而不是假设我们有一个 SMT。若 directive 指的是上游 Toccata 的某个具体结构,**这条映射要重划**。
3. **本稿不覆盖**:不改任何在飞合约;不提议拆任何墙;不定 ⑥/③ 的字段(那是各自的卡,本稿只**引用**)。

**一句话结论**:🔴 **`NOT_PROVEN`。** 七项里,**第 2 项有真链上锚(最强的一格)**,第 1/5 项机制在且部分可独立执行,而 **第 4 项与第 7 项各有一个结构性硬洞**——
**(4) 队里第二台全节点重算不出任何合约 P2SH、也重算不出 ZK gate 工件**;
**(7) 冻结态的唯一出口是原运营方手上的一支本地脚本,没有 covenant/timelock 替代路径。**
⇒ **"root 可重建" 与 "运营方可替换" 之间的距离,正好就是这两个洞。** 这与 directive 那条判定句要防的东西完全同形。

---

## §1 七项交付物 · 现状矩阵

| # | Directive 要求 | 现状 | 验收级 |
|---|---|---|---|
| 1 | 获取 snapshot 是否需 incumbent consent | 🟡 **分版本**:v0.7 链上可导(需剪裁窗内);v0.6 走本地库 | `TESTABLE_MACHINERY`(v0.7)/ `NOT_PROVEN`(v0.6) |
| 2 | L1 anchor 独立验证步骤 | 🟢 **`poolMerkleRoot` 真烤进 covenant 且共识强制** | `PROTOCOL_CAPABILITY` 坐实;独立验证**步骤**受 §3 阻断 |
| 3 | deterministic resume 判定 | 🔴 **纯函数在,但输入不确定** | `NOT_PROVEN` |
| 4 | program / proving key / descriptor / historical rule 可获得性 | 🔴🔴 **本机两样关键工件都不在** | `NOT_PROVEN` |
| 5 | stale / malicious / partial / withheld snapshot 的识别与恢复 | 🟡 **识别有真机制(abstain-not-guess);恢复通向 §7 那个洞** | 识别 `TESTABLE_MACHINERY`;恢复 `NOT_PROVEN` |
| 6 | pruning window 之后的状态恢复 | 🔴 **窗口比全队以为的短约 9 倍**(已实测) | `NOT_PROVEN` |
| 7 | 原运营方永久消失后的退出/迁移路径 | 🔴🔴 **冻结态无 covenant 出口** | `NOT_PROVEN` |

---

## §2 逐项(只写有锚的,没锚的明说没锚)

### 2.1 第 1 项 · snapshot 要不要 incumbent consent —— **分版本,且 v0.7 那条被剪裁窗封顶**

**v0.7 = 链上可导** `[CONFIRMED·源码实读]` `pool-market-settler-v06.mjs:200-225`:
给定 `snapshotDaa`,从 `oracle_pool_chain_view` 取 `leaves_json/merkle_root/pool_size`,**与 caller 期望的 root 比对,不符即 `throw`**(`:209-211`),再落 `pool_snapshots`。该视图上游是 `scanAndDerivePool`**扫链**得来。
⇒ 🔵 **接手方原则上不需要 incumbent 交出任何东西**:自己扫链到同一个 `snapshot_daa`,就能重建同一组 leaves 与同一个 root。**这是本项最强的一半。**

🔴 **但它被第 6 项封顶**:重扫要求那一段链**还在**。剪裁点之下取不到 ⇒ **接手方若在剪裁窗之后到达,这条路直接断**。⇒ **第 1 项与第 6 项在这里交汇,不能分开评。**

**v0.6 = 本地库** `[CONFIRMED·源码实读]`:v0.6 路径(`:260` / `:499` 两处 `INSERT OR REPLACE INTO pool_snapshots`)走 legacy `oracle_pool_membership`,**不是链上导出**。
⇒ 🔴 **v0.6 的 snapshot 依赖 incumbent 的 DB = consent 依赖。** `oracle-pool.js:23-26` 自陈同族风险:「本地 `oracle_stake_enrollments` 表 = 跨节点同 chain state 但表内容不同 → `poolMerkleRoot` 分歧」。
🔵 **作用域**:本机库 **1317 盘全部是 v0.7,零 v0.6** `[CONFIRMED·DB实读]` ⇒ **v0.6 那半我没有本机样本可查**,判级基于源码不基于数据。

### 2.2 第 2 项 · L1 anchor —— **本稿唯一一格真锚**

`[CONFIRMED·源码实读]` `PayoutShard.sil:36` `byte[32] poolMerkleRoot` 是 **ctor 常量**(注释:「depth-8 chain-derived oracle pool root … == v07 同源」),且合约体**逐委员强制** depth-8 position-aware merkle proof:
`:104`(注释「防自选委员」)→ `:115 / :126 / :137 / :148 / :159` 五条 `require(cNCur == poolMerkleRoot)`;refund 侧 `:274` 同款 `require(d0Cur == poolMerkleRoot)`。

⇒ 🟢 **委员集 ∈ pool 这件事是共识强制的,不是"谁记得去查"。** 这是 ST-02 里唯一一个 `PROTOCOL_CAPABILITY` 级读数。

🔴 **但"独立验证步骤"这一半没闭合**:要独立验证 `poolMerkleRoot` 确实是该市场链上那一个,标准做法是**重算 P2SH 与链上地址比对**——
**而这台节点做不到**(见 §3)。⇒ **能力在协议里,步骤在本机不可执行。两者必须分开报,合起来报就会把 `PROTOCOL_CAPABILITY` 冒充成 `VERIFIED_PATH`。**

### 2.3 第 3 项 · deterministic resume —— **纯函数在,但它的输入不确定**

🔵 **确定性的那一半有**:`computePoolPayouts`(`pool-market-settler.js:1818`)是纯函数、零 DB 读。
🔴 **不确定的那一半更要紧,而且已被独立坐实**:它的费率入参**在本仓没有权威来源**——
`makerFeePct` 恒取字面量 `10`(`:1820` / `:2221` 读一个**不存在的 DB 列** ⇒ `NaN` ⇒ `|| 10`),`oracleFeePct` 同族;详见前置⑥ v0.2.1 的 R-3 / C-2(`docs/2026-08-06-precond6-…-v0.1.md`)。
⇒ 🔴 **两个运营方跑不同代码版本,会"确定性地"算出不同 payout,而双方都认为自己对,且没有任何东西会报。**
⇒ **deterministic resume 判定 = `NOT_PROVEN`。** 纯函数只保证「同输入同输出」,而**这里连输入都不是可确定获得的**。
🔨 **这正是 directive 判定句的具体形态**:root 可重建 ≠ 结果可重现。

### 2.4 第 4 项 · program / proving key / descriptor 可获得性 —— **两个硬洞**

🔴 **(a) pin 的 silverc 编译器不在本机** `[CONFIRMED·实跑]`:
`pool-p2sh.mjs:19` `SILVERC = process.env.SILVERC_LEGACY_PATH || 'D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe'`;实跑 `computeSpineP2SH_v06` ⇒ `Error: silverc compile PoolSpine_v06 fail: spawnSync … ENOENT`。
(`/d/silverscript` **源码树在**,但那个 pin 的构建产物**不在**。)
⇒ **CLAUDE.md「silverc build 必全节点 pin 同字节」在本机不成立** ⇒ **这台节点重算不出任何合约 P2SH。**

🔴 **(b) ZK-SDK isolated build 不在本机** `[CONFIRMED·实跑]`:
`bshard-settle-daemon.mjs:39` 默认 `D:/rusty-kaspa-zksdk-isolated/wasm/nodejs/kaspa/kaspa.js`;`ls -d /d/rusty-kaspa-zksdk-isolated` ⇒ **目录不存在**。
⇒ `gate-tmpl-hash.mjs` 的 live-derive 与一切 proving 在这台跑不了。

🔵 **(c) 反面(要一起说,否则显得比实际更糟)**:`gateTmplHash` 派生所需的 **canonical sample receipt 在 git 里** `[CONFIRMED·git实读]`——
`zk-payout-guest/proofs/3o6cs-attest-0a358fa0/3o6cs_receipt.hex`,`git ls-files --error-unmatch` 命中、`git check-ignore` 空。
🔨 **我一度判它"不在库",错在【我的 grep 模式太窄】**(用 `canonical.*sample` 去找一个叫 `3o6cs_receipt.hex` 的文件)。⇒ 判"某物不存在"前,**必须不带过滤跑一遍**。

🔴 **(d) 已在册的同族脆弱点(不是我新发现,但属本项)**:`gate-tmpl-hash.mjs:64-67` 逐字记着 `ZK_GATE` 常量与 `process.env.ZK_GATE_TMPL_HASH`(kanet.env)是**纯人肉同步的两份拷贝**,「下次改 imageId 若只改一处漏另一处,guard 会全绿…**比没检查更糟(假安全感)**」。已加跨源断言,但**该值本身仍是 per-node env,不在链上、不在库**。

⇒ **第 4 项 = `NOT_PROVEN`,且是本矩阵里最硬的一格**:一个"接手方"最现实的样本(队里第二台全节点)**两样关键工件都没有**,而两条路径都是**指向本机、非仓内位置的硬编码默认值**。

### 2.5 第 5 项 · 异常 snapshot 的识别与恢复 —— **识别是真的,恢复通向第 7 项那个洞**

🔵 **识别侧有真机制** `[CONFIRMED·源码实读]`,即 frozen_evidence 的 **abstain-not-guess**:
委员**自己 fetch**、只认 FINAL、结构异常或字段不足即弃签,**不猜**——
`bshard-close-enforce.mjs:377`(`judgeLine` 字段不足 ⇒ 弃签)/ `:601`(`FINAL-only` + canonical 归一 + `field_hash`)/ `:625-626`(赛果未定 ⇒ 不缓存、返 null ⇒ caller 弃签)/ `:650`(自取无字段 ⇒ `abstain`)。
`oracle-evidence-extractors.mjs:370` 强制 `data_source_canonical`(机器可解析 URL),缺失 ⇒ `verdict:'no_canonical'`。
⇒ **stale(非 FINAL)/ partial(字段不足)/ withheld(源不可达)三类都有对应的弃签分支**,且弃签是**默认**不是例外。

🔴 **但"恢复"那一半没有独立答案**:弃签 ⇒ 签名收不齐 ⇒ 走 `freezeAwaitingAuthorization` ⇒ **落进第 7 项那个只有一条人工出口的状态**。
⇒ **识别越严,越多市场被推进那个洞。** 这是设计上的必然张力,前置⑥ §7-1 已把它挂给 Bettor,**本稿只是给它加了一个 ST 维度的读数:识别机制的质量,不能替代出口机制的存在。**
🔴 **`malicious` 这一类我没有锚**:上述分支防的是"源坏/源没到",**不是"源在说谎"**。canonical 源被攻陷时委员们会一致地取到同一个假值并一致签名——**本仓有无对抗这一类的机制,我没查到,标 `[未验]`。**

### 2.6 第 6 项 · 剪裁窗之后的状态恢复 —— **窗口比全队以为的短约 9 倍**

🔴 **先说这一格的性质:剪裁点是【会动的量】,任何写死的值都必然会过期。** 本稿给两个时点的实测 ——
**两个读数不同这件事本身,就是"它会动"的构造式证明**,不是文风谨慎:

| 取数时刻 | pruningPoint DAA | pruningPoint block 时间戳 |
|---|---|---|
| 2026-08-07 早(ST-00 批) | 74,644,233 | 2026-08-05T16:38:03Z |
| **2026-08-07T18:51:28Z(本稿现取)** | **75,076,309** | **2026-08-06T05:16:54.995Z** |

⇒ 一天之内前进 **432,076 DAA**,可追溯地平线向前推了 **~12.7 小时**。
📌 **读到本稿时不要相信上表,一秒推翻它**(照 CLAUDE.md 通则:唯一记录必须配自查命令):
```
node D:/kanet/kanet/scratch/j1-prunepoint-0808.mjs
```

**由此得到的两条**:
- **绝对时间锚(不经任何换算,最硬)**:**产生块早于 pruningPoint block 时间戳的市场/side,已过剪裁点。** 现值见上表第二行。
- **窗口宽度**:现取 `virtualDaaScore` 76,180,797 − pruningPoint 75,076,309 = **1,104,488 DAA**;按**实测** DAA/秒 = **9.134**(0807 批,用 pruningPoint block ts vs sink block ts 校准;**不是长期沿用的 ~1**)⇒ **≈ 33.6 小时 ≈ 1.4 天**。
  🔵 **与墙钟对照自洽**:现在(≈18:52Z)减去 pruningPoint 时间戳(08-06 05:16Z)= **≈37.6 小时** —— **两条独立算法同量级,互为旁证。**
  🔴 **全队此前所有"天数"口径(14.8 天 / 25 天 / 5 天)按 ~1 DAA/秒 换算,高估约 9 倍。**
  ⚠ `virtualDaaScore` 取自**本机当前未同步的节点**(§3-2),该数偏小 ⇒ 上面的窗口宽度是**保守下界**,不是精确值。
- 🔵 **过剪裁点的 UTXO 仍可查可花**(实测 38 个 spine UTXO,`blockDaaScore` 51.6–52.4M 远低于 pruningPoint 74,644,233,仍被 `getUtxosByAddresses` 返回)⇒ **剪枝丢的是块历史(归属证明),不丢 UTXO 集(花钱能力)。**

⇒ **对 ST-02 的意义,是一句很不舒服的话**:**"钱还能动"与"还能证明这钱该归谁"在剪裁点两侧分离。**
第 1 项 v0.7 那条"链上可导"的路,**恰恰依赖被剪掉的那一半**(要重扫 `snapshot_daa` 那一段)。
⇒ **接手方的可替换性有一个【硬时限】,而这个时限实测约 1.6 天,不是此前口径的 14.8 / 25 天。** 判 `NOT_PROVEN`,且这一格**会随时间自己变差**。

### 2.7 第 7 项 · 原运营方永久消失 —— **冻结态没有 covenant 出口**

`[CONFIRMED·源码实读]` `pool-market-settler.js:256-287` `freezeAwaitingAuthorization` ⇒ `protocol_status='unresolved_needs_authorization'`(白名单式 WHERE,只允许从 `verifying/collecting_sigs/disputed/refunding` 转入)。
其**唯一出口** `authorizeRefundByOwner`(`:289-296`)的函数头逐字写着:
- 「调用方 = 运维脚本 `scripts/p1-authorize-refund.mjs`(**operator 手动,不开 HTTP 面**)」
- 「🔴 **时间在冻结态里不产生任何权力**: 离开的唯一方式是【有人带着依据签字】,不是"停够久了"」

🔵 **这个设计对它自己要防的东西是对的**(「一个没有出口的冻结态就是把钱静静锁死,而"没人能放行"与"没人需要放行"在读数上完全相同」——原注释)。
🔴 **但对 ST-02 问的那个问题,它就是答案本身,而答案是否定的**:
**出口是一支跑在原运营方机器上的本地脚本。运营方永久消失 ⇒ 该出口随之消失 ⇒ 冻结态没有任何 covenant / timelock 级替代路径。**
⇒ **第 7 项 = `NOT_PROVEN`。用户无许可退出:不成立。**

#### 🔴 2.7-bis · **退款构造被绑死在原产节点上 —— n=1293 的实证** `[CONFIRMED·DB实读 + 源码实读]`

现读全表 `SELECT protocol_status, COUNT(*) FROM pool_markets GROUP BY 1`(**零过滤**):
`unresolved_needs_authorization` = **1293** · `pending_bettors` = 24 · 无其它取值。
再读这 1293 盘的 `metadata.unresolved_reason`(**全量,零截断**):**1293 盘全部是同一个值** ——
**`退款构造结构性失败: cross-node maker (skip)`**。

> 🔴 **我第一版把它写成「本机 98.2% 的市场坐在冻结洞里、暴露面已实现」—— 那是错的, 已整段重写。**
> 错在**作用域**:这 1293 盘是**别的节点建的市场**,我这台是**观察者**(`maker_relay_id` 是 `cross-node:<pk>` 哨兵)。
> 我的节点构造不了别人 maker 的退款,于是跳过并冻结 —— **那是正确行为,不是暴露。**
> 🔨 **判据**:`protocol_status` 这一列上,「**我不该管**」与「**该管却卡住了**」读数完全相同。只差一次 `unresolved_reason` 查询就能分开,而我差点没查就报出去。

🔵 **但拆开之后, 这里有一个比原来那版更硬的 ST-02 发现**:

`pool-market-settler.js:796` 逐字:「**cross-node refund 必 producer node 干**」;
`:803` 判据 `maker_relay_id.startsWith('cross-node:')`;
`:219-222` 把这类失败归为**结构性**——「结构性失败**重试第 1 次与第 10000 次结果完全相同**(cross-node maker 永远不会变成本机 maker)」,因此按 fail-closed 直接转人工出口而不是无限重试。

⇒ 🔴 **退款构造能力被绑死在【原产节点】上。一个观察完整、数据齐全、软件同版本的第二节点, 对这 1293 盘能采取的行动是【零】。**
⇒ **这正是 ST-02 要问的"运营方可替换性",而这里有一个 n=1293 的实证答案:不可替换。**
🔨 **它比 §2.7 那条更强的地方**:§2.7 说的是"运营方消失后没有出口"(条件句);**这一条说的是"第二运营方【此刻】就已经什么都做不了"(现在时)。**

🔵 **本条不覆盖的**:这 1293 盘**在它们各自产节点上的权威状态**如何,**我判不了**(要跨节点读数 ⇒ 要频道 ⇒ 见 §3-2)。**别把本机读数当成这些市场的全局状态。**

🔵 **一处必须同批说的例外(否则本项被外推)**:v0.7 的 **`closezk-v2` 放款是纯 covenant、零委员签**(记忆 `reference-v07-closezk-committee-sig-scope`)。⇒ **走到 zk_close 的那条路不依赖运营方签字。**
🔴 **但它不解本项**:① 走到 zk_close 需要 proving,而**proving 的工件在第 4 项已判不可获得**;② 冻结态**恰恰是没走到那一步的那些盘**。
🔨 **⇒ 存在一条 covenant 放款路,与"冻结态有出口"是两回事。别用前者去答后者。**

---

## §3 阻断本稿升级的两件事(不是懒得做,是做不了)

1. 🔴 **本节点无法重算任何合约 P2SH**(§2.4-a)⇒ 第 2 项的"独立验证**步骤**"、第 1 项的"接手方自证 root"**都只能停在设计层**。任何把它们写成 `VERIFIED_PATH` 的说法,**在本机没有证据支撑**。
2. 🔴 **本节点当前未同步**(2026-08-07 事故,详见 memory `project_j1tn-boot-0808`):sink 落后约 100 分钟且吞吐稳定在实时 **26%**,`tipHashes = 2369`(对照:TN10 = 2 / 主网 = 3,**同时现取**)。⇒ 本稿一切"链上现取"类补测**此刻做不了**。

---

## §4 证据缺口卡(交派用)

| 卡 | 内容 | 归谁 |
|---|---|---|
| `ST02-G1-SILVERC-ABSENT` | pin 的 `silverc-legacy-2c46231.exe` 在 J1 台缺失 ⇒ 第二节点重算不出 P2SH。**问题不是"给我一份",是"这份工件的分发与 pin 由什么保证"** | Bettor(制度)/ J2(实操) |
| `ST02-G2-ZKSDK-ABSENT` | `D:/rusty-kaspa-zksdk-isolated` 在 J1 台不存在 ⇒ ZK gate 工件不可重算 | 同上 |
| `ST02-G3-V06-SNAPSHOT-CONSENT` | v0.6 snapshot 走本地库 ⇒ consent 依赖。**本机零 v0.6 样本**,需有 v0.6 盘的节点确认 | J2 |
| `ST02-G4-PRUNE-WINDOW-1.6D` | 可替换性硬时限实测约 1.6 天(DAA/秒=9.134)。**此前全队口径高估约 9 倍** | Bettor(排期含义) |
| `ST02-G5-FREEZE-NO-COVENANT-EXIT` | 冻结态唯一出口是 operator 本地脚本,无 covenant/timelock 替代 | Bettor / Owner(设计决策) |
| `ST02-G6-MALICIOUS-SOURCE` | abstain-not-guess 防"源坏/源没到",**不防"源说谎"**;有无对抗机制未查 | NWT |
| `ST02-G7-DETERMINISM-INPUT` | 纯函数在但输入无权威(费率层)⇒ resume 不确定。**与前置⑥ R-3/C-2 同源,不要各修一遍** | 并入 ⑥ |
| 🔴 `ST02-G8-CROSSNODE-REFUND-BOUND-TO-PRODUCER` | 退款构造绑死原产节点(`settler:796` 逐字「cross-node refund 必 producer node 干」),第二节点对 **1293 盘可行动数 = 0**(§2.7-bis)。**这是可替换性的直接反例,不是配置问题** —— 需要的是设计裁定,不是"给第二节点开权限" | Bettor / Owner |
| `ST02-G9-CROSSNODE-AUTHORITATIVE-STATUS` | 那 1293 盘**在各自产节点上**的真实状态,我判不了(要跨节点读数)。**本机读数只说明我能不能动它们,不说明它们好不好** | 需频道恢复 / J2 |

## §5 交审点名

1. **@J2(协议复核)**:§2.1 v0.6 那半(我无本机样本)· §2.2 `PayoutShard.sil` 的 merkle 强制我只读了 v1,**`PayoutShardV2.sil` 未读**(作用域缺口,请补)· §2.4 两件工件在你台是否存在。
2. **@NWT(红队)**:**首攻 §2.5 的 `malicious` 那一格** —— 我明说没锚。若 canonical 源被攻陷时委员会一致取到同一个假值并一致签名,那 abstain-not-guess 这套**对最坏那类攻击是零防御**,而它读起来很像已经防住了。
3. **@Bettor**:§4 的 G1/G2/G5 是制度题不是技术题 —— **工件分发与冻结态出口,都不是写代码能解决的。**
4. 🔴 **本稿是 BATCH-0 现状盘点,不使 ST-02 从 OPEN 变 CLOSED,不构成任何实现/部署/钱路授权。**

---

# 🆕 v0.2 — 对 Codex 两份红队的回应与自纠

> 下面每条我都**自己在代码/库上重跑过一遍**，不转述。承 `[[feedback_test-name-must-be-the-one-that-reddens]]` 同族纪律。

## §6.1 🔴 第 1 项 v0.7 那格降级 —— **我把"链上验证"写成了"链上发现"**

**Codex(`8258e70e`) 的指控成立** `[CONFIRMED·源码实读]`：
`oracle-pool-chain-scanner.mjs:99` 在任何 RPC 之前先查**本地 SQLite**：

```sql
SELECT staker_pk_x, lock_until_daa, p2sh_addr FROM oracle_stake_enrollments
WHERE active = 1 AND source = 'chain_envelope'
```
`:110` 才对**本地枚举出的** `p2sh_addr` 调 `getUtxosByAddresses()`。
⇒ 得到的 `oracle_pool_chain_view` root 是「**在一个本地种子集上做链上验证**」，
**不是**「从链上独立发现」。v0.1 §2.1 写成后者，**是错的**。

**⇒ 分级改为(采纳 Codex 的拆分)**：
| 断言 | 级别 |
|---|---|
| `V07_POOL_ROOT_RECOMPUTATION_FROM_A_GIVEN_LOCAL_SEED_SET` | `TESTABLE_MACHINERY` |
| `V07_FRESH_OPERATOR_BOOTSTRAP_OF_THE_COMPLETE_SEED_SET_FROM_L1` | 🔴 **`NOT_PROVEN`** |

🔵 **而我要给 Codex 的结论补一层它没看到的**(方向不改，理由要更准)：
**种子集在【设计上】是可从链重放的**，团队早有自陈(`oracle-pool.js:22-26`，逐字)：
> `scanAndDerivePool 当前读本地 oracle_stake_enrollments 表 = 跨节点同 chain state 但表内容不同 → poolMerkleRoot 分歧.`
> `路 A 修法: 每笔 enrollment 上链广播 oracle_stake_enroll_v1 envelope, trade-protocol-filter 消费 → UPSERT source='chain_envelope'.`

⇒ 准确说法**不是**「新接手方无路可走」，而是：
**种子集由【另一条链上管线】填充(envelope → `chain_events` → UPSERT)，而那条管线的【完整重放能力】未经证明、且受剪裁窗封顶。**
🔨 **⇒ 第 1 项与第 6 项在这里交汇**：本稿 §2.6 实测剪裁地平线 ≈ **1.4 天**
⇒ **落在窗外的 envelope，新节点重放不出来** ⇒ 这是比"剪裁"更早生效的一道墙。
**Codex 说「pruning 不是唯一硬边界」——对，而准确的顺序是：enrollment 重放先卡，剪裁其次。**

## §6.2 🔴 2.7-bis 措辞收窄 —— "绑死在原产节点"给强了

**Codex(`ddd4acee`) 确认了机制，但判措辞过强，我接受。**
代码证明的**不是**对历史物理主机的密码学/物理绑定，而是：
> **当前退款实现绑定在【maker relay 身份 + 签名能力本地可行动】的那个托管域上；
> 只持有 `cross-node:<pk>` 哨兵的观察者无法行动。**

⇒ **v0.1 那句「refund construction is bound to the originating node」作废，以上句为准。**
🔴 **但这不放松制度结论**：若要求是「接手方无需 incumbent 同意、也无需 incumbent 交出密钥」，
**当前实现仍然不满足** —— 拷贝/迁移 incumbent 私钥是**托管权移交式的连续性**，
**不是** incumbent-independent 的可替换性。**两者不许混为一谈。**

## §6.3 🔴 n=1293 补可重放证据包 —— **而做这个包当场抓出我 v0.1 记错了出处**

Codex 判 `n=1293` 为 `OBSERVED / NOT YET REPLAYABLE`，要求提交证据包才准升 VERIFIED。
**做包的过程直接证明了这条要求的价值**：

🔴 **v0.1 把这 1293 行说成在一张叫 `unresolved_needs_authorization` 的【表】里 —— 本机没有这张表**
(113 张表零命中)。它其实是 **`pool_markets.protocol_status` 的一个【取值】**。
⇒ **数字是对的，出处是错的。** 一个不可重放的数字，连自己的来源都可能记错，而**没有任何检查会发现**。

✅ **证据包已入库**：`scripts/st02-crossnode-refund-evidence.mjs`(committed，**含它跑的 SQL 原文**)。
现读结果：

| 量 | 值 |
|---|---|
| `pool_markets` 总行 | **1317** |
| `protocol_status='unresolved_needs_authorization'` | **1293** |
| 且 `maker_relay_id LIKE 'cross-node:%'` | **1293**（= 全部） |
| distinct id | 1293（无重复） |
| `idsSha256` | `cc124dfec023d8ab5d54a7784e148f453c08f09abf8651c40b44e3e169d6a4ef` |
| 另一格 | `pending_bettors` = 24（1293+24=1317 自洽） |

**复现**：`node scripts/st02-crossnode-refund-evidence.mjs`（只读，可指定 `ST02_DB=`）。
🔴 **作用域**：这是**一份 DB 的行**，证明的是**本节点记了什么**，
**不等于**任何别的运营方库里是什么，**也不是链上观测**。

## §6.4 验收判据改为 **fresh-successor test**，不是 second-observer test

采纳 Codex 的收口测试形状。**关键差别**：不是"另一个观察者能不能看到"，
而是**从【故意清空的】接手方状态出发**——
不复制 incumbent 的 `console.db`、不导入任何 incumbent 表、不迁移 incumbent 私钥：

1. 固定链/节点身份 + 固定目标 `snapshot_daa`；
2. 接手方 `oracle_stake_enrollments` / `oracle_pool_chain_view` / `pool_snapshots` **全空**；
3. **仓库内有版本的算法**，从独立可得来源发现或重放每一条权威 enrollment 事实；
4. **任何 incumbent 导出的 DB/表/行都不算输入**；
5→8. 重建候选集 → 逐条 L1 验证 → 导出 root → 与 covenant/市场锚比对；
9. 对抗控制：漏登记 / 重复 envelope / 过期续期 / 已花 stake / 畸形 envelope / 历史低于剪裁点。

🔴 **若"迁移密钥"是被明确接受的运营模型，那要【单独测】并叫它 custody-transfer continuity，
不许叫 permissionless / operator-independent recovery。**

## §6.5 v0.2 未动的

- §2.2 第 2 项(`PayoutShard.sil:36` ctor + 逐委员 merkle)**不变**，仍是本稿唯一真锚。
- §2.4 第 4 项两个硬洞(pin 的 silverc ENOENT / ZK-SDK 目录不存在)**不变**——
  Codex `8258e70e` 另外确认：v0.6 builder 走 `pool-p2sh.mjs` 的通用 `compileAndComputeP2SH`，
  **同样 pin 那把 legacy 编译器** ⇒ 这个可复现性阻塞**不止影响 legacy v0.5 builder**，范围比 v0.1 写的更大。
- **ST-02 总判仍为 `NOT_PROVEN`**，v0.2 只是把**理由换成了更准确、更难反驳的那一个**。
