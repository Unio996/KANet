> **Status**: CURRENT · **v0.3.1**（2026-08-10 · 并入 Codex 二轮 §4 六条验收；§5 把「谁触发退款」从边界升为【闸②·正在挡 canary#1·无人负责】）
> **性质**: 设计稿 · **零改码** · Bettor 2026-08-09 20:15 指派（「V2 `cancelMarketLive` 缺口 = J1 域的并行 design 活，**先出设计不动手**，与双边 canary 并行、不 gate 它」）
> **作者**: J1tn · **已审**: NWT 二轮红队 GREEN（v0.3）+ Codex 独立第四证（bridge `09ad5d01`）· **v0.3.1 的两处增补待 NWT 过目**
> · 🔴 **落码要 Owner 批**（Bettor 21:02：改的是 cancelMarketLive/refund = 钱路，设计+红队只完成铁律 0 的前两步）
> **波及**: 5 个单边盘 / ~3,509 KAS（J2 20:13 实测，其中 3,500 是 `9ez2u` 一家）。**9jaty 是双边，不走这条路。**
>
> **版本史（不删，因为这稿错的方式本身要传下去）**
> - v0.1 判「缺口两处」，称 `for(i<17)` 是 V1 特征 —— **17 槽两版本共用，误判**（NWT 抓）。
> - v0.2 承 NWT 补到「四处」，称 V2 有专属 `refundRoot@256` 构成语义差 —— **又一处误判**（J2 的 splice 线索引出）。
> - v0.3 实读合约 + splice 实现 + relay 侧后：**真实缺陷 2 处，同一根因**。三条顶层结论自始至终未变。

# V2 `cancelMarketLive` —— 单边池退款路对 PayoutShardV2 走不通，怎么修

## §0 一句话

链上入口在、JS 编排在、闸是对的、**splice 与 relay 侧早就是 V2 安全的**。
**真正坏的只有两处，而且不是"状态形状不对"——是【编译了另一个合约】。**

---

## §1 现状

```
✅ 链上入口   PayoutShardV2.sil :187 cancel_attest（委员 4-of-5，closed 0→2）+ :287 refund_claim
✅ JS 编排    bshard-auto-settler.mjs:811 cancelMarketLive   build→enforce→签→submit→refund_claim 循环
✅ 驱动侧硬闸  :833  psContAddress !== plan.expectedCancelledAddr ⇒ 不广播
✅ splice     splicePayoutContinuation 只覆盖 [1,205)，V2 尾字段（@205 起）逐字节保留
✅ relay 侧   unlockBshardCancelAttest / unlockBshardRefundClaim 同款边界安全 splice
              （_PAYOUTSHARD_STATE_LEN = 204，NWT 20:53 实读；J2 20:56 补证 cancel_attest 亦不需改）
🔴 缺陷 ①    :874                curRedeem = compilePayoutShardRedeem(…)
🔴 缺陷 ②    computeRefundPlan   expectedCancelledAddr = compilePayoutShardRedeem(…)
```

🔵 **`:833` 那道闸不许为放行去松它。** 目标是让它比对的两侧都算对，不是让它别响。

---

## §2 为什么只有这两处

### 2.1 splice 已经是 V2 安全的（J2 20:49 发现，我实读复核）

```js
_serializePayoutStateHex ⇒ pool(9) + closed(9) + payoutRoot(33) + 17×9(153) = 204 字节
splicePayoutContinuation ⇒ [redeem[0], sb(204), redeem.slice(205)…]   // 205 之后逐字节保留
```

V2 布局：`consolidated_pool@1 · closed@10 · payoutRoot@19 · w0..w16@52` → **到 205 为止**；
`attestedWinner@205 · attestedAtMs@214 · betsRoot@223 · refundRootBaked@256 · end@289`。

⇒ **splice 写的正好是两版本共用的那一段，V2 专属尾字段一个都不碰。**
⇒ **凡是"构造 V1 字段集然后喂 splice"的地方，全都不是缺陷。** relay 侧同理（`_continuationAddress` 同款切法）。

### 2.2 cancel 路径在 V2 里与 V1 完全同构（v0.2 在这里判错了）

`PayoutShardV2.sil:187-281` / `:287-342`：

```
cancel_attest(… byte[32] new_refundRoot …)
    payoutRoot:       new_refundRoot      ← refundRoot 就是写进 payoutRoot 槽
    refundRootBaked:  refundRootBaked     ← @256 原样透传，cancel 不动它
refund_claim   payoutRoot: payoutRoot · refundRootBaked: refundRootBaked   ← 同样只透传
```
文件头 `:12` 逐字：「④ cancel_attest 逻辑**一字不动**；validateOutputState 补齐新增 4 字段透传（**不变，cancel 路径跟 ZK 无关**）」。

⇒ 🔴 **`refundRootBaked@256` 是 ZK 路径的字段，不是 cancel 路径的 refundRoot。**
⇒ **「payoutRoot 槽装 refundRoot」这个 V1 写法对 V2 也是对的。** v0.2 那句「语义差」**撤**。

### 2.3 先前点名的三处，全部降级为「不是缺陷」——而且【不许改】

```
:819 state      → 喂 relay build（relay 侧同款 serialize + splice）        不是缺陷
:872 curState   → 喂 splice                                                不是缺陷
:897 newState   → 喂 splice(:901，且 :902-904 带 mismatch 检查)            不是缺陷
```

🔵 **保留这一节而不是删掉，因为它们【看起来】仍然像缺陷**：字段集写死 17 槽、没有任何 V2 字样。
下一个读它的人会和我一样想"补齐 V2 字段"——**而那会把 204 字节撑长，反而把 V2 尾字段整体挪位、真正弄坏它。**
🔨 **⇒ 这三处不但不用改，而且不许改。这一节的作用就是拦住下一个"修"它们的人。**

### 2.4 真正坏的两处 —— 性质比"形状不对"更硬（J2 20:56 点准）

```
compilePayoutShardRedeem  →  compileSil(PayoutShard.sil, …)     ← 【另一个合约】
```

⇒ 它产出的不是"少了 85 字节的 V2 脚本"，**是另一个程序的字节**。
地址对不上不是因为某个字段缺失，而是因为**编译的根本是另一份 .sil**。

| | 位置 | 后果 |
|---|---|---|
| ① | `cancelMarketLive:874` | 它是**穿线链的种子** ⇒ 种子是另一个合约的字节，后面每次 splice 再对也全错 |
| ② | `computeRefundPlan` 内 | `:833` 闸比对的**另一侧**也用它 ⇒ 闸两侧都拿到 V1 合约的地址 |

🔴 **两处都必须改，且必须【各自独立】地改**：

```
只修①  ⇒ build 侧对了、plan 侧还是 V1 ⇒ 闸继续拦（表现不变）
只修②  ⇒ 同上，反向
共用一个新 helper 去算  ⇒ 🔴 最坏：两侧因【共享同一个假设】而相等 ⇒ 闸放行一笔错的钱路交易
```
🔨 **判据：这道闸的保护力来自两侧【独立】算出同一个值。同源的一致不是一致，是共谋。**

---

## §3 修法：两处都是「别 compile，用链上那份」

### 3.0 为什么不是"换个 V2 编译器"

`compilePayoutShardV2Redeem`（`pool-shard-register.mjs:265`）ctor 尾部写死 `-1 / 0 / z32 / z32` 四个"待 attest"哨兵
⇒ **只能产 genesis 形状**（`bshard-payout-family-coherence.mjs:165` 已记）。拿它算 cancelled 态会把链上已有的 attest 字段抹成占位符。
**编译这条路两个版本都不通。**

🔵 **仓内先例**：`bshard-close-transport.mjs:305-316` 记着 NWT 2026-07-08 抓的同族事故——V1 编译器打 V2 市场，
「会把 attestedWinner/attestedAtMs/betsRootBaked/refundRootBaked 全部按 V1 genesis 占位符清零重置，抹掉已有 attest 状态」，
当时修法就是 **不重编译、原位 splice**。**本稿两处是这个洞的第二、第三个实例。**

### 3.1 修法①：`:874` 的种子改用链上活字节

```
现在   curRedeem = compilePayoutShardRedeem({… closed:2, payoutRoot: plan.refundRoot})
改成   curRedeem = 【cancel_attest 实际落链的那份 redeem 字节】
```
🔵 **它此刻手上就有**：`verifyClosedLanded`（`:865`）刚确认过它落在 `plan.expectedCancelledAddr`。
⇒ **穿线起点不需要"再算一次"，只需要"接着用"。少一次重算 = 少一个能算错的地方。**
🔴 验收要钉 **同源**（`curRedeem === 落链那份`），**不是"重算出来相等"** —— 相等可以是巧合，同源才是保证。
🔵 NWT 20:54 的前提正是这一条：relay 侧不用改，**条件是传进去的 `redeem_hex` 本身带着正确的 V2 尾字节**。

### 3.2 修法②：`expectedCancelledAddr` 改用 splice

```
现在   compilePayoutShardRedeem({poolMerkleRoot, predicateCommit, consolidatedPool, closed:2, payoutRoot: refundRootHex})
改成   splicePayoutContinuation(ps.payout_redeem_hex, {consolidated_pool, closed:2, payoutRoot: refundRootHex, w0..w16})
       然后 p2sh
```
🔵 字段集**照旧用 V1 那一套**（§2.1/§2.2）。
🔴 **独立于 §3.1 实现**（§2.4）。二者唯一允许共享的是 `splicePayoutContinuation` 本身。
🔴 **w0..w16 起始值必须从链上 redeem 现读，不许默认填 0** —— 「未有人 claim 过所以全 0」是个假设，
而这条路径的全部教训就是**别用假设代替读**。

### 3.3 仍需分派的只剩一处

🔵 按 §2 的结论，这条路上**几乎不需要 V1/V2 分派** —— splice 与字段集两版本通用。
🔴 **唯一要分的**：换成 splice 之后，**V1 盘行为必须逐字不变**。
⇒ **落码第一件事**：对一个 V1 盘断言 `splice(ps.payout_redeem_hex, state)` == `compilePayoutShardRedeem(state)`。
**若不等，说明 compile 与 splice 对 V1 也不等价，本稿修法要重新评估。这一格我没验，标着。**

---

## §4 验收

```
① V1 等价性（前置，§3.3）  V1 盘: splice 产出 == 现行 compile 产出，逐字节
                            🔴 不等 ⇒ 本稿修法作废重议，不要往下做
② 两侧独立                  build 侧 psContAddress == plan 侧 expectedCancelledAddr，
                            且两者【不共用算地址的 helper】—— 需一条断言点名这条
③ 保真                      splice 前后逐字节 diff: 只有 [1,205) 内该变的变，
                            🔴 特别断言 @205 之后（attestedWinner/attestedAtMs/betsRoot/refundRootBaked）逐字节未动
④ 缺陷重注入                (a) 把 :874 改回 compilePayoutShardRedeem ⇒ 端到端必须红
                            (b) 两侧共用同一个算地址 helper ⇒ ② 必须红
                            (c) 🔴 把 §2.3 那三处"补齐 V2 字段" ⇒ ③ 必须红（证明它们不许改）
⑤ 端到端                    cancel_attest 落链后，【第一笔 refund_claim 真落链】才算通。
                            🔴 只验到 cancel 落链不够 —— 闸绿 ≠ 钱走了
⑥ V1 不回归                 既有 V1 盘走 cancelMarketLive 行为逐字不变
```

⚠ **lint 帮不上忙**（J2 20:50）：`R-PS-FAMILY-DISPATCH` 白名单是**文件级**，而 `bshard-auto-settler.mjs` 整个在白名单里
⇒ **在这个文件里新增第 N 个 compile 调用点，lint 不会响。别把"lint 绿"当成"没漏下一处"。**

### §4bis Codex 二轮（bridge `09ad5d01` §4）六条实现验收，原样并入

Bettor 21:17 指派并入。**这六条是「动钱之前必须证到」的下限，不是可选项**：

```
1. expectedCancelledAddr 必须由【当前真实 V2 redeem 经一次有界状态转移】导出，
   不得由 V1 重编译得来
2. cancel 落链后的 refund 穿线，必须从【那一份落链的 V2 continuation redeem 字节谱系】起步，
   不得独立重建一个"等价"合约
3. 每一次 refund continuation 必须保留 >=205 的字节，除非该字段是 V2 covenant 规定要变的；
   对 refund_claim 而言，V2 尾字段应【逐字节不变】
4. 🔴 必须有一条 byte-exact 测试，对着【真正编译出来的 V2 合约 / 交易产物】比对预期 continuation，
   **不能只对着一个复刻的 parser 比** —— 这一条是 Codex 对本稿 §2/§3 全部结论的权威验收层，
   两个读取器互相一致【不构成】部署布局的证明（他对 `readPsConsolidatedPool` 那条也是这么限定的）
5. 驱动侧闸保持 fail-closed。**任何"修法"都不得以绕过 `psContAddress === expectedCancelledAddr` 的形式出现**
6. 本 review 不授权任何生产退款 / 结算 / signer-broadcaster 改动 / 密钥移动
```
🔵 第 4 条的执行体 = 「乙」（J2 的 build-only 稿，Bettor 21:00 拍为 §4 验收装置，排在本稿落码之后）。

---

## §5 明确不在范围

- 不动 `:833` 那道闸（它是对的）。
- **不动 §2.3 那三处**（不是缺陷，改了会坏）。
- **不动 relay 侧**（NWT 20:53 + J2 20:56 双人实读：cancel/refund 两支都不需改）。
- 🔴 **不解决「谁来触发退款」—— 而这一格现在【正在挡 canary#1】，必须单独立项，不许并进本稿**：
  ```
  grep 'cancelMarketLive(' 全仓（去注释去测试）⇒ 唯一命中 = 它自己的定义行 :811
  ⇒ 【零调用方】。没有任何 daemon / tick / api 在调它。
  ```
  ⇒ **本稿两处修完、退款路完全正确之后，tha3l 仍然不会被退款**，因为没有东西会走那条路。
  🔴 **它现在的实际卡点比本稿更靠前**：`bshard-close-transport.mjs:384` 的 `throw`（close/propose 路，
  由 `zkJudgeProposeTick` 驱动，每 8 分钟一次），**根本没走到退款路**。
  ```
  闸① K-18 coherence        ✅ 回填已拆（1207→0，有天然对照组）
  闸② degenerate → 无路可走  🔴 close 路 throw + 退款路零调用方   ← tha3l 现在在这
  闸③ 退款路对 V2 坏         🔴 本稿要修的
  ```
  **闸② 在闸③ 前面。只修③，tha3l 仍卡在②。**
  🙋 我 20:10 就查到过"没有自动 caller"，**但把它当边界写进范围外就放过了**，没标成独立一格。
  🔨 **判据：写「不在范围内」时要分清是【别人负责的一格】还是【没有人负责的一格】。**
  后者写进范围外，等于把它变成没人看的洞 —— **而它读起来跟前者一模一样。**
  📌 ② 怎么修（自动触发 / 人工 operator / 其他）**不是技术题是政策题**：`closed` 是一次性 XOR 闩，
  锁 2 之后这个市场永远不能再正常结算（`bshard-auto-settler.mjs:726-729`）。**归属与做法等 Bettor 拍。**

  ---
  #### 闸② 的最低验收（Codex 独立复核 bridge `6fdb8ab0` 后给出，原样记在此供接手者起步）

  🔵 **Codex 独立确认了闸② 存在**，并补了一格我没有的证据：settle daemon 的 import 列表里
  只有 `computeSettlePlan / settleMarketLive / deriveResumePlanFromEvidence`，**没有 `cancelMarketLive`**。
  判词：`degenerate payout → 正常 close/propose 抛出 → 无自主 cancel/refund 调用方 → 即使闸③ 修好，盘仍可能滞留`
  = **CONFIRMED / OPEN**。

  🔴 **而他同时点名了两条【不许用】的捷径**（正是最容易被当成"顺手修掉"的两种）：
  ```
  ❌ 让 buildProposeCloseRequestV2() 在 degenerate 时【静默 fall through】进退款
  ❌ 一观察到 degenerate / ABSTAIN 就【自动调】cancelMarketLive()
  理由: closed=2 是【不可逆】的、正常结算的替代路径 —— 触发权必须有明确的政策授权
  ```

  **七条最低验收**（他明说：**本次 review 不授权实现**，这是生产钱路决定）：
  ```
  1. 一个机器可读的【终局退款资格】状态，与"一次瞬时 judge 失败 / 一次 pm.degenerate"区分开
  2. 关于"为什么正常结算永久不可用"的【持久证据】
  3. 明确的宽限/重试策略 + 重启安全的计数器/状态
  4. 单一权威调用路径，带 kill switch 与 canary 上限
  5. 一条用例证明：普通可恢复/临时的 ABSTAIN 或 degenerate【锁不上】 closed=2
  6. 一条用例证明：合格的终局场景【恰好一次】进入退款规划器
  7. 不得绕过既有的 V2 退款地址 / 字节谱系验收闸（即本稿 §4 / §4bis）
  ```
  🔨 第 5 条与第 6 条是一对：**一个防"不该锁的锁了"，一个防"该走的走了两次或没走"** ——
  缺任何一条，这道闸都会在它最要紧的那个方向上没有守卫。
- 零改码。落码需 Bettor 排期 + NWT 红队；真跑到广播需按钱路规矩单独授权。

---

## §6 这稿错过两次，错法是同一个 —— 记这个比记结论有用

```
v0.1  看见 for(i<17)             ⇒ 断定「这是 V1 形状」     （没读 V2 布局）
v0.2  看见 V2 有 refundRoot 字段  ⇒ 断定「语义差」           （没读 V2 合约怎么用它）
```
🔨 **两次都是：从【表面形状】推出【版本不兼容】，而没去读那一版【实际怎么用它】。**
**「V2 有这个字段」与「V2 的这条路径用这个字段」是两回事**，我两次都用前者冒充了后者。

🔵 **两次都是别人读代码把我拦下来的**（v0.1→NWT，v0.2→J2 的 splice 线索），不是我自己发现的。
⇒ 顶层结论（V2 退款走不通 / 闸对 / 缺 V2 版 cancelMarketLive）**自始至终没变**，
**变的一直是"为什么"** —— 而下一个人照着"为什么"去改代码，所以错的理由不是小事。

🔵 **也记一条对的**：J2 起草过一条「relay 侧漏了 V2 兄弟、要新增两个 unlock 函数」，
**在发出前去读合约，自己把它推翻了**（20:56）。**同一个病在发出前被自己拦住 = 便宜的那一半。**

## §7 出处

- splice 实现与覆盖区：`bshard-auto-settler.mjs:699-712`（J2 20:49 发现，我实读复核）
- relay 侧同款边界安全：`kasia-relay/src/lib/p2sh.mjs` `_continuationAddress` / `_PAYOUTSHARD_STATE_LEN=204`（NWT 20:53）
- V2 cancel/refund 语义：`PayoutShardV2.sil:187-281` / `:287-342` + 文件头 :12（J2 20:56 补证）
- 状态布局：`bshard-close-enforce.mjs:162-168`（NWT 独立复核算术）
- 两个 compile 调用点：`bshard-auto-settler.mjs:874` / `computeRefundPlan` 内
- 编译的是另一个合约：`pool-shard-register.mjs:119` `compileSil(PayoutShard.sil, …)`（J2 20:56）
- 先例：`bshard-close-transport.mjs:305-316`（NWT 2026-07-08）
- V2 编译器只产 genesis：`pool-shard-register.mjs:265-276` + `bshard-payout-family-coherence.mjs:165`
- lint 白名单是文件级：J2 20:50
- 波及面：J2 20:13（5 盘 / ~3,509 KAS）
