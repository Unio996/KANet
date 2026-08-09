> **Status**: CURRENT · **v0.2**(2026-08-10, 承 NWT 红队: §2 漏数第三/第四处, 已补 §2.2b/§3.5/§4⑥)
> **性质**: 设计稿 · **零改码** · Bettor 2026-08-09 20:15 指派（「V2 `cancelMarketLive` 缺口 = J1 域的并行 design 活，**先出设计不动手**，与双边 canary 并行、不 gate 它」）
> **作者**: J1tn · **待审**: NWT 红队 · **待批**: Bettor 排期后才落码
> **波及**: 5 个单边盘 / ~3,509 KAS（J2 20:13 实测，其中 3,500 是 `9ez2u` 一家）。**9jaty 是双边，不走这条路。**

# V2 `cancelMarketLive` —— 单边池退款路对 PayoutShardV2 走不通，怎么修

## §0 一句话

链上入口在、JS 编排在、闸也是对的。**缺的是：退款路径上【四处】计算都还绑在 V1 的状态形状上 —— 闸前两处、闸后两处 —— 而闸前那两处必须【分别独立】改，且四处都不能用"重新编译"来改。**

---

## §1 现状：三件成立，一件不成立

```
✅ 链上入口   PayoutShard.sil entry3 cancel_attest（委员 4-of-5 锁 refundRoot，closed 0→2）+ refund_claim
✅ JS 编排    bshard-auto-settler.mjs:811 cancelMarketLive
              build cancel_attest → driver enforce → 4-of-5 签 → assemble → submit → refund_claim 循环
✅ 驱动侧硬闸  :833  psContAddress !== plan.expectedCancelledAddr ⇒ 不广播
🔴 状态形状   四处绑 V1（见 §2）: 闸【前】两处 ⇒ 算出错地址 ⇒ 撞闸 return;
              闸【后】两处(refund_claim 穿线) ⇒ 没有驱动侧保护, 表现是"cancel 落链、钱退不出去"
```

🔵 **`:833` 那道闸是对的，不许为放行去松它。** 它拦的是一笔会打错 covenant 的钱路交易。本设计的全部目标是**让它比对的两侧都算对**，不是让它别响。

---

## §2 缺口是四处，不是两处 —— 而闸前那两处只修一处会更糟

### 2.1 输入状态（`cancelMarketLive:819-820`）

```js
const state = { consolidated_pool: …, closed: 0, payoutRoot: ZERO32 };
for (let i = 0; i < 17; i++) state['w' + i] = 0;
```

字段集 = `{consolidated_pool, closed, payoutRoot, w0..w16}`。

🔴 **这里我第一次说错过，纠正记在这（NWT 2026-08-09 20:39 独立复核过算术）**：
**那 17 个 w 槽不是 V1 的特征，V2 也有。** 实际布局（`bshard-close-enforce.mjs:162-168`）：

```
        consolidated_pool@1 · closed@10 · payoutRoot@19(33B) · w0..w16@52(17×9=153)
V1      到此为止
V2      + attestedWinner@205 + attestedAtMs@214 + betsRoot@223(33B) + refundRoot@256(33B) → end@289
```

⇒ 上面那个字段集**恰好构造到 offset ~205 为止**，V2 专属的后 4 个字段一个都没有 ⇒ 序列化短约 85 字节。

🔨 **为什么这条纠正值得写进设计稿**：结论（V2 走不通）没变，但**理由错了会把人引到那 17 个槽上去改，而那里没有问题**。

### 2.2 期望地址（`computeRefundPlan`，`bshard-auto-settler.mjs:739` 内）

```js
const cancelledRedeem = compilePayoutShardRedeem({ poolMerkleRoot, predicateCommit,
                                                   consolidatedPool, closed: 2, payoutRoot: refundRootHex });
expectedCancelledAddr = ctx.p2shAddr(cancelledRedeem);
```

🔴 **这是第二处独立的 V1 绑定，而且它算的正是 `:833` 要比对的那一侧**：
- `compilePayoutShardRedeem` = **V1 专属编译器**（`pool-shard-register.mjs:117`）；
- `payoutRoot: refundRootHex` = **V1 的写法：复用 payoutRoot 槽装 refundRoot**（源码注释原话「payoutRoot 槽复用装 refundRoot」）。
  **而 V2 有专属的 `refundRoot@256`** ⇒ 这不只是长度差，是**语义差**：V2 里 refundRoot 有自己的位置，payoutRoot 槽另有其用。

### 2.2b 第三、第四处：`refund_claim` 穿线循环（NWT 红队 2026-08-09 20:46 抓，v0.2 补）

🔴 **我 v0.1 只数了两处，漏了闸【之后】那一整段。** 实读 `cancelMarketLive:872-899`：

```js
:872-873  let curState  = { consolidated_pool, closed: 2, payoutRoot: plan.refundRoot };
          for (let i = 0; i < 17; i++) curState['w' + i] = 0;          // ← V1 形状
:874      let curRedeem = compilePayoutShardRedeem({ … closed: 2, payoutRoot: plan.refundRoot });
                                                                       // ← V1 编译器, 第三次
:897-899  const newState = { consolidated_pool: …, closed: 2, payoutRoot: plan.refundRoot };
          for (let i = 0; i < 17; i++) newState['w' + i] = curState['w' + i];
                                                                       // ← 每个 bettor 迭代重建一次
```

⇒ **整条 refund_claim 穿线路径都是 V1 形状**，且 `payoutRoot: plan.refundRoot` 又是 V1 的槽复用写法。

🔴 **它与 §2.1/§2.2 有一个关键差别：它在 `:833` 那道闸【之后】** ⇒ **驱动侧没有任何东西在保护它**。
🔵 失败模式因此不同，说精确（这决定它的定级）：
- §2.1/§2.2 错 ⇒ 撞驱动侧硬闸 ⇒ **不广播**（我们自己拦住）。
- §2.2b 错 ⇒ redeem 与链上 script 对不上 ⇒ **共识层拒**，或 claim 不落链被 `verifyClaimLanded` 拦（`NO-TX-NO-STATE`）。
  ⇒ 仍然 fail-closed，**但拦它的是链和事后校验，不是我们的设计**。
  **后果不是"打错一笔"，是"cancel_attest 落了链、钱却一分退不出去"** —— 盘停在 `closed=2` 而 refund 全卡。

🔨 **判据（记这一条比记这个 bug 值）**：我只查了闸【之前】的路径，因为闸是我关注的对象。
**一道闸把注意力吸到它两侧，而它保护不到的那一段恰恰在它下游。**

🔵 w0..w16 那 17 个 nullifier 槽本身两版本共用（§2.1），**这一段里对 w 的位运算逻辑可原样保留**；
要改的是它周围那些字段。

### 2.3 🔴 为什么必须一起改

`:833` 比的是【build 侧算出的 `psContAddress`】vs【plan 侧算出的 `expectedCancelledAddr`】。

```
只修 2.1   ⇒ build 侧对了、plan 侧还是 V1 ⇒ 仍然不等 ⇒ 闸继续拦（表现不变，浪费一轮）
只修 2.2   ⇒ 同上，反向
两边各改各的 ⇒ 🔴 最坏：两边用【同一个错误假设】各自算，结果相等 ⇒ 闸放行，广播一笔错的钱路交易
```

🔨 **判据：这道闸的保护力来自两侧【独立】算出同一个值。同源的一致不是一致，是共谋。**
⇒ 落码时两处**不得共用一个新写的 helper 去算地址**；只允许共用**读取器**（§3.1），地址各自算。这条要写进验收。

---

## §3 修法：splice，不是 recompile —— 仓里已有先例

### 3.0 先例（这不是我发明的方案，是这个仓已经付过学费的那个）

`bshard-close-transport.mjs:308` 的注释逐字记着 NWT 2026-07-08 抓到的同族事故：

> 第一版这里错调了 `compilePayoutShardRedeem`(V1 专属，silverc 重新走 ctor 编译)——pxvml 是 V2 市场，
> V1 重编译出的 redeem 字节结构跟链上实际 V2 P2SH 对不上，**且 V1 编译器还会把 V2 专属状态字段
> (attestedWinner/attestedAtMs/betsRootBaked/refundRootBaked) 全部按 V1 的 genesis 占位符清零重置，
> 抹掉可能已存在的 attest 状态**

当时采用的修法：**不重新编译，直接在原始 `payout_redeem_hex` 字节上原位 splice**，只写该写的 offset，不碰其余任何字节。

🔴 **`computeRefundPlan` 现在踩的就是这个洞的第二个实例** —— 同一个函数、同一类市场、同一个后果。

### 3.0.1 而 V2 编译器也救不了这一格

`compilePayoutShardV2Redeem`（`pool-shard-register.mjs:265`）的 ctor 尾部是写死的 genesis 占位符：

```js
ctorInt(-1),      // init_attestedWinner: -1=待attest
ctorInt(0),       // init_attestedAtMs: 0=待attest
ctorBytes32(z32), // init_betsRootBaked
ctorBytes32(z32), // init_refundRootBaked
```

⇒ 它**只能产出 genesis 形状**（`bshard-payout-family-coherence.mjs:165` 已明确记着这一条）。
拿它去算「cancelled 态」同样会抹掉链上已有的 attest 字段。**编译这条路两个版本都不通，只能 splice。**

### 3.1 必需件①：一支能在 `closed=0` 读 V2 状态的读取器

现成的 `readPayoutShardV2AttestedState`（`bshard-close-enforce.mjs:196`）在 `closed !== 1` 时**抛异常**（设计如此，它只服务 close_attest 刚落链那个窗口）。
**待退款的盘全是 `verifying` / `closed=0`** ⇒ **目前没有任何一支函数能在 cancel 场景下读出 V2 那 4 个尾字段。**

```
新增（提议）  readPayoutShardV2State(psv2RedeemHex)     // 无 closed 前置条件
返回          { consolidatedPool, closed, payoutRootHex, attestedWinner, attestedAtMs, betsRootHex, refundRootHex }
🔵 与既有那支共用同一组 _PSV2_* offset 常量，不得另抄一份（否则就是 §2.3 那个"共谋"的偏移量版）
🔴 长度不足 ⇒ throw，不返回半份（同既有那支的 fail-closed 惯例）
```

### 3.2 修法②：cancelled 态用 splice 产出

```
输入   ps.payout_redeem_hex（链上活字节，V2，genesis-baked 部分原样保留）
写两处 closed      @ _PSV2_CLOSED_OFF(10)      0 → 2
       refundRoot  @ _PSV2_REFUNDROOT_OFF(256) ZERO32 → plan.refundRoot
不碰   consolidated_pool · payoutRoot · w0..w16 · attestedWinner · attestedAtMs · betsRoot · 及 state 区之外全部字节
```

🔴 **`attestedWinner` / `betsRoot` 绝不填零**：它们是 close 路径的证据字段，**cancel 路径无权改**。
（一个单边盘可能已经 attest 过 winner——"没有赢家侧下注"与"没有 attest 过"是两回事。）

🔵 **偏移量两版本通用的那一格已被实证**：consolidated_pool 在 offset 2，V1/V2 相同，`bshard-close-transport.mjs` 的 absorb splice 正是靠这条跨版本工作的。closed/refundRoot 的 offset 则是 **V2 专属**，必须从 `_PSV2_*` 取，不得沿用 V1 的 `rootOff`。

### 3.3 修法③：`computeRefundPlan` 的 expectedCancelledAddr 同法

同样改成 splice 产出 cancelled redeem 再 p2sh，**但独立于 §3.2 那条路径实现**（§2.3）。
🔵 二者唯一允许共享的是 §3.1 的读取器与 `_PSV2_*` 常量。

### 3.4 分派：谁走 V1、谁走 V2

🔴 **不许靠"名字看着像"或 `protocol_version` 字符串猜。** 仓里已有权威分类器
`classifyPayoutShardFamily`（`bshard-payout-family-coherence.mjs:99`）。
⚠ 但它会起子进程重编译（同文件 :10 注明），不适合高频路径 ⇒ 本路径低频（一盘一次），**可以直接用它**；
若性能不允许，替代判据必须是**从链上 redeem 字节本身推出的**（如长度 ≥ `_PSV2_STATE_END_OFF`），
**不得**用 DB 里的版本字符串——那是"记着的"不是"读出来的"。

### 3.5 修法④：`refund_claim` 穿线循环（v0.2 补，对应 §2.2b）

```
:874 curRedeem      不再 compilePayoutShardRedeem，改用【cancel_attest 实际落链的那份 redeem 字节】
                    —— 它此刻已经存在（§3.2 splice 的产物），直接用，不重算
:872 curState       字段集补齐 V2 尾 4 字段，取值来自 §3.1 读取器读【落链那份】
:897 newState       每轮沿用同源；refundRoot 写 refundRoot@256，payoutRoot@19 保留链上值
```
🔵 **这里有个白拿的简化**：cancel_attest 刚落链，它的 redeem 我们**手上就有**（§3.2 刚 splice 出来、且 `verifyClosedLanded` 已核过它落在 `expectedCancelledAddr`）。
⇒ **穿线的起点不需要"再算一次"，只需要"接着用"**。少一次重算 = 少一个可以算错的地方。
🔴 而每轮 `newState` 仍要重建（因为 consolidated_pool 递减 + w 位要更新）—— **那是真需要，不能省。**

---

## §4 验收（不是"补丁看着对"）

```
① 阴性对照（承重）  对一个 V2 盘跑 plan：expectedCancelledAddr 必须 ≠ 用 V1 编译器算出的那个
                    —— 若相等，说明分派没生效，改动等于没做
② 正向             build 侧 psContAddress == plan 侧 expectedCancelledAddr（两侧独立算，§2.3）
③ 保真             splice 前后逐字节 diff：只有 closed 与 refundRoot 两段变，其余 0 字节变化
                    🔴 特别断言 attestedWinner/attestedAtMs/betsRoot 三段【逐字节未动】
④ 缺陷重注入       (a) 把 refundRoot 写进 payoutRoot 槽（V1 写法）⇒ ② 必须红
                    (b) 用 compilePayoutShardV2Redeem 重编译代替 splice ⇒ ③ 必须红（尾字段被清零）
                    (c) 让两侧共用同一个算地址的 helper ⇒ ① 仍绿但 ② 恒绿 = 保护消失，需另有断言点名它
⑤ V1 不回归        既有 V1 盘走 cancelMarketLive 的行为逐字不变
⑥ 端到端（v0.2 补，对应 §2.2b）
   cancel_attest 落链后，【第一笔 refund_claim 必须真落链】才算这条路通。
   🔴 只验到"cancel 落链"是不够的 —— §2.2b 那段在闸之后，它错的表现恰恰是
      "cancel 成功了、钱一分退不出去"。**闸绿 ≠ 钱走了。**
   🔵 断言点：curRedeem 必须 === cancel_attest 实际落链的那份字节（§3.5），
      不是"重算出来一份相等的" —— 相等可以是巧合，同源才是保证。
```

🔴 **④(c) 是本设计最容易被"优化"掉的那一格**：把两处算地址的代码合并成一个 helper 看起来是消除重复，
实际是把 §2.3 的独立性删掉。**验收必须有一条断言点名"两侧不得同源"**，否则下一个重构的人会顺手删掉保护。

---

## §5 明确不在本稿范围

- **不动 `:833` 那道闸**（它是对的）。
- **不动 V1 路径**。
- **不执行**：本稿零改码。落码需 Bettor 排期 + NWT 红队；真跑到广播需按钱路规矩单独授权。
- **不解决**「谁来触发退款」：现状是 caller/daemon 必须先确认"真·永久无解"（`bshard-auto-settler.mjs:729`），
  本稿只让**触发之后那条路能走通**，不改触发条件。

---

## §6 出处

- 状态布局：`bshard-close-enforce.mjs:162-168`（NWT 2026-08-09 20:39 独立复核算术）
- V1 绑定两处：`bshard-auto-settler.mjs:819-820` / `computeRefundPlan` 内 `compilePayoutShardRedeem`
- splice 先例与 V1 编译器清零后果：`bshard-close-transport.mjs:305-316`（NWT 2026-07-08 红队）
- V2 编译器只产 genesis 形状：`pool-shard-register.mjs:265-276` + `bshard-payout-family-coherence.mjs:165`
- 波及面：J2 2026-08-09 20:13 频道实测（5 盘 / ~3,509 KAS）
- 读取器 fail-closed 惯例：`bshard-close-enforce.mjs:196-215`
