> **Status**: DRAFT v0.2 — J1 主笔稿,待 J2 审(settler 域)→ NWT 红队 → 冻结
> **授权**: D-012 §6-1(Owner 终裁 `6962da4a`)+ COORD-LEDGER (134) 明日开工单 ⑤。**design-only,零实现授权。**
> **作者**: J1tn · 2026-08-03 · 全部 file:line 现读核实(非记忆)
> **v0.2 变更**: 按 Bettor 2026-08-03 15:55Z 频道裁定(`#devnxf`)——① 命名一律用全称(见下)② 守恒锚口径按其自纠收窄 ③ `is_oracle` 命名本次只裁不迁。

# Oracle 权限边界契约(D-012 §6-1)— 冻结设计稿 v0.2

> 🔴 **命名约定(Bettor 裁定,强制,禁止例外)**:本文件全篇写**全称**「**Oracle 权限边界契约(D-012 §6-1)**」。
> **禁止单用「Skill」二字指代本契约,也禁止用它指代 roadmap 契约 v1 排除的「Role/Skill directory」。**
> 理由不是洁癖:同一个词在两份文档里各指一物(见 §1),而 D-012 是 Owner 已终裁文本、其术语不改 ⇒ 只能靠**引用侧写全称**消歧。
> 🔨 判据(Bettor 立,今日同族第四次):**一个词在两份文档里各指一物时,不是改名就是加全称,不许靠上下文分辨。**
> ⚠ 本文件**文件名**里的 `oracle-skill-interface` 是 v0.1 落码时的历史串,**保留不改**(改名会断掉 `abf0d836` 起的引用链);正文以本约定为准。

## §0 Track 边界(先于一切正文,承 D-012 §0)

- 本稿是 **Track B 协议层接口契约**的设计。**Track A(Owner 实例)不因本稿获得任何对外开放授权**;七铁律原样有效。
- D-012 §3「六道墙」**不是本稿的施工单**。本稿零处提议拆墙;若某条实现路径需要拆墙才能成立,那条路径就出了本稿范围,须走独立 Owner 授权。
- 判据:**引用本稿之前先回答「这发生在哪条 Track」。答不出 = 不得据本稿行动。**

## §1 冻结对象与非对象(先划边,避免与既有冻结撞车)

**冻结的是**:Oracle 这个角色**能做什么、够得到什么**——接口签名 + 权限边界 + 失败语义。

**明确不在本稿内**(承 `docs/2026-07-25-kanet-trunk-roadmap-modularization-and-external-access.md:844`「契约 v1 明确不包含 Agent Card、Discovery、Role/Skill directory 或 Trust Facts」):
- 不造 Role/Skill 目录、不造 Discovery、不造 Agent Card、不造 Trust Facts 表。
- 🔴 **这一条是主动查出来的冲突面,不是免责声明**:D-012 §6-1 的字面「Oracle **Skill** 接口冻结」与 roadmap 契约 v1 排除的「Role/**Skill** directory」共用一个词。两者不是一回事(本稿冻结**一个角色的权限边界**,roadmap 排除的是**网络对象的注册/发现层**),但**下一个只读到其中一份的人会读混**。
- ✅ **已裁(Bettor 2026-08-03 15:55Z `#devnxf`)**:D-012 原文术语**不改**;**引用侧一律写全称**「Oracle 权限边界契约(D-012 §6-1)」,禁止单用 Skill 指代任一方;Bettor 在 ledger 与 `DECISIONS.md` 补消歧注。**本稿 v0.2 已全篇执行。**

## §2 三权的可机械判定定义(不是形容词)

D-012 §6-1 要求「三权分立烤进接口签名,Oracle 结构上够不到资金路径」。要能被红队攻击,三权必须定义成**可判定**的,而不是"职责说明":

| 权 | 定义(判据形态) | 拒绝形态 |
|---|---|---|
| **P1 报告事实(Attest)** | 输出是**对 `(market_id, outcome)` 的签名声明**。判据:被签字节里**结构上不含**金额、收款地址、payout 树 —— 即改变任何一个 bettor 拿多少钱,**都不改变 P1 要签的那串字节** | 拿不到合格证据 ⇒ **abstain**,不猜 |
| **P2 规则解释(Interpret)** | `(attested outcome, 完整注单集, 费率表) → payout 树` 的**纯函数**。判据:任意第三方拿同样输入**可独立复算出逐字节相同**结果 | 输入**不可证完整** ⇒ **本机无判断资格**,退化/不断言(见 §4.5) |
| **P3 放钱(Disburse)** | 只由 covenant 依据 P2 的**承诺**执行。判据:放钱那条路径上**零 `checkSig`** | — |

**三权分立的验收判据(一句话,可被红队直接攻)**:
> **持有 oracle 私钥的进程,不存在任何一条能对「决定谁拿多少钱的字节」出签的路径。**

## §3 现状对照(带证据层级,承 D-012 §5 口径)

### 3.1 v0.7 ZK-native = **已存在的三权分离实例**(`[CONFIRMED·源码实读]`)

| 权 | 实现 | 签名 |
|---|---|---|
| P1 | `PayoutShardV2.sil` attest 类 entry:`:105 require(validSigs >= 4)` | 4-of-5 委员签**只在此处** |
| P2 | `CloseZkV2.zk_close` groth16 ZK 门(gateTmplHash 烤死) | 无签 |
| P3 | `CloseZkV2` claim/escape_claim 纯 covenant merkle+nullifier | 无签 |

🔵 **本稿现读补强了 D-012 §2-bis 的记账**(§2-bis 只引了 `:99-105`/`:180` 一处):
- `PayoutShardV2.sil` 的 **三个** attest 类 entry **全部**带守恒 clamp:`:180` / `:283` / `:398` 均为 `require(tx.outputs[selfOutIdx].value == consolidated_pool)`;两处 4-of-5 门 `:105` / `:208`。⇒ **"委员签的那笔不动钱"不是单点巧合,是该合约的一致形状。**
- `CloseZkV2.sil` 全文 `grep -c checkSig` = **0**。
- ⇒ **P1 的守恒 clamp 就是 §2 那条验收判据在 v0.7 上的落地形态**:委员的签名权被合约本身钉在"不动钱"的字节上。**这是本次冻结要推广的那个形状,不是要发明的东西。**

### 3.2 子集②(v0.5/v0.6 committee-sig,**当前 live 主力**)= 四权合一(`[CONFIRMED·源码实读]`)

违反 §2 验收判据的**结构性点位**,按严重度排:

1. 🔴 **通用盲签原语**:`kasia-relay/src/relay.mjs:711 sign_input_for_settle` —— 对**任意** tx 的**任意** input,用 oracle 私钥出签(`:738`/`:772` `createInputSignature(unsignedTx, inputIndex, wallet.getPrivateKey(), SighashType.All)`)。**relay 层零策略**:它不看这笔 tx 是 attest 还是放钱、不看 outputs 是什么。⇒ **§2 验收判据在这一行上直接不成立** —— 私钥够得到"决定谁拿多少钱的字节"。
   - 🔴 **注意该 case 自己的注释(`:718`)写着「PB-S8-2 安全: privkey 不 leave relay process」**。这句话本身对,但它保护的是**密钥不外泄**,不是**签名权受限**。**两件事被同一个标题盖住了** —— 照这条注释判断"这里已经安全了"的人会漏掉本节这条。(同族:`[[feedback_docs-that-teach-the-hole.md]]`)
2. 🔴 **P1/P2 在调用方被合并**:`kasia-console/src/services/trade-protocol-filter.js:541 handlePoolOracleTxSignReq` —— 委员签的对象是 `phase2_tx_obj`(`:562`),即**已经含全部金额与地址的放钱 TX**;而这个 tx_obj **可以是消息自带值**(`msg.phase2_tx_obj || meta.phase2_tx_obj`)。⇒ 委员在"报告事实"的名义下,签的是**别人算好的 payout**。
3. 🟡 **已装的牙,以及它明确不锁的那半**:PB-S8-1(`:604-647`)让委员签前反查自己投过的票,**只锁 winner 方向一致性**;`:609-610` 逐字写明**不锁 tx_obj payout 结构(金额/地址)**。⇒ 现状是 **P1 已被约束、P2 完全没有**。**引用时不许省这半句**(NWT 措辞纪律)。
   - 层级:PB-S8-1 部署 = `[DEPLOYED-VERIFIED]`;其保护**效果** = `[TESTED-VERIFIED·未实弹]`(D-012 §5 + (133) 校准,"生产真挡下过一次"那格**仍空**)。
4. 🟡 **P2 的算法在单一节点上,且不被签名者复算**:`pool-market-settler.js:1540 computePoolPayouts` 是纯函数(好),但它跑在 **settler 一侧**,委员侧无对应复算。⇒ P2 今天是**被信任的输入**,不是**被验证的输出**。
5. 🟡 **经济面四权合一的另外两权**(承 D-012 §2 与我 08-03 四镜头五点):oracle **自有 bond 在险** + **从池收 reward**。本稿**不动**这两条(它们是经济设计,不是接口权限),但冻结文本必须**显式记它们仍在**,否则"三权已分立"会被读成"oracle 已中立"。

### 3.3 一条必须带作用域的历史结论

我 2026-07-15 的红队稿(`docs/2026-07-15-J1-redteam-economic-kernel-oracle-verifier-exit-review.md:37`)钉过:代码里叫 `is_oracle`/`oracle_pool_membership` 的东西,**按信任分级坐标其实是 committee(T2)准入基础设施**,不是"对链外事实作声明"的那个 Oracle(T3,今天是 UMA)。
⇒ 🔴 **对本次冻结的直接后果**:**「Oracle」这个名字下面今天坐着两个不同的角色**(T2 委员基础设施 / T3 外部事实源)。接口契约必须**分开写**,否则冻结出来的边界会在命名层就塌掉 —— 而 `trade-protocol-filter.js:578-580` 正是按 `is_oracle = 1` 选出本机要签名的身份,**这行代码用的就是那个混淆的名字**。

## §4 冻结的接口契约(本稿核心产出)

### 4.1 【承重】签名能力必须类型受限

**契约**:oracle 密钥持有进程**不得暴露"对任意 tx 任意 input 出签"的原语**。签名入口必须是**带类型的声明**,由持钥侧自己判定"我签的是不是 attest 类字节"。

- 形态(不是实现方案,是契约要求的形状):`attest_outcome(market_id, outcome, …)` —— 持钥侧**自行**核对被签对象属于 attest 类且**守恒**(照 §3.1 `:180`/`:283`/`:398` 那条 clamp 的语义),不合则拒签。
- 🔴 **判据必须是结构性的,不能是"调用方会先检查"**。今天全部策略都在调用方(`handlePoolOracleTxSignReq`),而**调用方与持钥方之间隔着 IPC** —— 任何绕过调用方的路径都直达 `:711`。
- 🔴 **本条与 PB-S8-2 的关系(先说清,免得被读成同一件事)**:PB-S8-2 是在**调用方**加 payout 字节绑定;本条要求的是**持钥方**结构上签不了那种字节。**两者不互相替代**,PB-S8-2 落地也不使本条完成。

### 4.2 【承重】P1 被签对象的守恒要求

被 oracle 签名的 TX **必须是守恒类**:该笔 TX 不改变资金在参与者之间的分配(v0.7 形态 = 池面值原样进原样出,`consolidated_pool` clamp)。
⇒ 推论:**"签一笔把钱分给赢家的 TX"这件事,在冻结后的接口里不存在**。子集②要么迁到这个形状,要么在冻结文本里被显式标记为**未达标的历史路径**(带作用域,不许被"已三权分立"覆盖)。

### 4.3 P2 必须是可独立复算的承诺,不是被喂来的对象

- payout 由**纯函数 + 确定性整数算术**导出(`computePoolPayouts` 已是纯函数,资产在);
- 签名者**独立复算**并与承诺(payoutRoot 类)比对,**不接受消息自带的 payout 对象作为可信输入**;
- 复算所依据的输入必须**可证完整**(见 4.5)。

🔵 **这个形状在本仓已经有一个活实例,冻结文本应当直接引它而不是另写一遍**(承 Bettor 口径「推广既有形状,非从零发明」):
`kasia-console/src/lib/pool-shard-settle.mjs:315-320` —— **先**本地 `computePariMutuelPayout` + `settlePayoutRoot` 重算,**与 claimed 比对不符即 `命门③ REJECT` 拒签**,**通过了才**调 `sign_input_for_settle`。
⇒ **§4.3 的差距因此不是"没人做过",而是"做过的那条路没覆盖子集②"**:`handlePoolOracleTxSignReq`(子集②)在够到签名前**没有**任何等价的 re-derive 步骤(`trade-protocol-filter.js:541-674` 全段无 payout 复算)。**冻结要求 = 把 `pool-shard-settle.mjs:317` 那步变成契约必需项,而不是某条路径的自选动作。**

### 4.4 无 bypass 两条不变量(推广自 `bshard-close-voter.js:13-15`)

原文(v0.7 侧,已成文):(a) 签名不可远程触发;(b) daemon 是本节点**唯一**调签名的路,且**每个** sign-request 必经 enforce。原文自己注明这两条**落在本文件外的 relay/console 层**。
⇒ **冻结文本收编这两条为通用不变量**,并补第三条:

- (c) 🔴 **不变量的守护点必须与被守护的原语同侧,且必须能指出是哪一行。**

🔵 **本稿把 (c) 在 bshard 侧实测了一遍,答案是「没有那一行」,而且代码自己知道**(⚠ **不是新发现,是已登记的已知缺口** —— 按 D-002 纪律标明,免得被读成新雷):

| 读数 | 出处(现读) |
|---|---|
| 自治 enforce voter **默认不启动** | `bshard-close-voter.js:258/262-263` `BSHARD_CLOSE_VOTER_ENABLED === '1'`;本机 `kanet.env` **未设** ⇒ OFF |
| 关闭理由由代码自己写明,含 **`D4 relay-gate 未闭`** | `bshard-close-voter.js:263` 启动日志原文 |
| 而 live 的 bshard 结算路是 **driver-enforce** 那条 | `bshard-settle-daemon.mjs:18` import `settleMarketLive` → `bshard-auto-settler.mjs:378` 逐委员 relay 直接要签名;其闸是 `:352` 起的 **driver 侧**硬闸 |
| 这正是 voter daemon 声明自己要消灭的形状 | `bshard-close-voter.js:3-6`「relay `sign_input_for_settle` 盲签 + enforce 只 driver-side ⇒ 恶意 settler 跳 enforce 直签任意 payoutRoot」 |

⇒ **结论(带作用域,别扩大)**:
- **(b) 今天没有实现**。自治 voter 不是**挡在** driver 路前面的闸,它是**另一条默认关着的路**。
- 🔴 **爆炸半径精确到一句**:`ctx.pkToRelay` 拿不到的委员会被 `continue` 跳过(`bshard-auto-settler.mjs:376`)⇒ **远程 settler 逼不出别节点委员的签名**,跨节点 honest-majority 假设**未被此条推翻**。真正退化的是**同机持有 ≥4 个委员 relay 的节点** —— 4-of-5 在那台机器上塌成「1 个 driver 说了算」。而按 (131) 记录,**我们今天的拓扑正是这种**(本机 11 relay 含 4 oracle)。
- ⇒ **对冻结的意义**:(b) 不能以「已成文」的形式收编。冻结文本必须要求 **relay 侧**给出可指认的 gate(即那条 `D4 relay-gate`),否则 (b) 在契约里也只是一句话。**这条是 §4.1 的同一根因**:策略在调用方、原语在持钥方,中间隔着 IPC。

### 4.5 abstain-not-guess 与「没资格断言」必须是一等返回值

承 KB `oracle-hardening-four-gate-framework.md`(四正交闸 + 三态)与团队今日两张同族卡:

- **三态**:能结构化且委员同抽同字段 ⇒ settle;不一致/字段不足 ⇒ **abstain**;结构化不了 ⇒ 建市时 prevet 拒。
- 🔴 **接口必须能表达第四种读数:「我没有资格断言」** —— 与"我判定为否"**不是同一个返回值**。依据是团队今日两次独立撞到同一形状:
  - (130) consumer 侧自知之明闸:整表 0 行时,"真无人下注"与"我从未同步到注"**读数相同** ⇒ 不广播、记可计数 skip。
  - (134) Bettor 的链上守恒锚:`Σ(本地已知 stakes)+fees/bonds == 被花费 spine UTXO 的链上面值` ⇒ 把"本地数据全不全"**从假设变成可判定**;对不上 ⇒ 本机无判断资格,退化并记 `cannot-verify`。
- ⇒ **契约要求**:P2 的复算入口**必须**返回三值之一 `{agree | disagree | cannot-verify}`,且 `cannot-verify` **不得**被调用方折叠成 `disagree` 或静默跳过(必须可计数、可告警、带接收者)。

🔴 **v0.2 补:守恒锚的准确覆盖 + 一条硬要求(Bettor 2026-08-03 自纠并升级,`#devnxf`)**
- **锚本身成立,是覆盖被说宽了**:`Σ(本地已知 stakes)+fees == 被花费 spine UTXO 面值` **只在持有完整未花费仓位集的节点上产出「可验证」**(实践上 = 市场本机 / settler 机);**在远端节点它会正确地、系统性地弃权**(原因见 §7-1:`trade-protocol-filter.js:1367` 按设计不存已花掉的仓位)。⇒ 它给出的 `cannot-verify` **是对的答案,不是失效**。
- 🔴 **而这带出一条必须同时上的硬要求**:**一个永远弃权的检查,和一个永远通过的检查,在日志里长得一模一样。**
  ⇒ **契约要求(硬)**:任何实现本节三态的检查,**上线时必须同时上报「弃权率」**;**若弃权率 ≈ 100%,该检查即是装饰,必须当缺陷处理,不得当作「没触发」。**
  🔵 这条与 §3.2-1 的病同源:`sign_input_for_settle` 那句「privkey 不 leave relay process」也是**一个成立的陈述盖住了另一件没做的事**。**成立但无效**与**不成立**,在读者那里同样致命。

## §5 与在册卡的关系(本稿不 gate 它们,它们也不 gate 本稿)

| 在册卡 | 关系 |
|---|---|
| PB-S8-2(payout 字节绑定,J2) | §4.3 在子集②的**调用方侧**下位实现;**不满足 §4.1**(见 4.1 末段) |
| 卡①(json_extract 规范键查) | 与本稿正交(查询失败语义),已 live |
| consumer 侧自知之明闸 | §4.5 的既有实例 |
| committee 抽样 liveness 门 | 与本稿正交(可用性),但**与 §4.5 同族**:都是"选了个不能兑现的前提" |
| Exchange 裁决角色(D-012 §6-3) | 冻结后的**第一个复用验证对象**,不在本稿 |

## §6 本稿的证据层级自标(D-012 §5 纪律)

| 陈述 | 层级 |
|---|---|
| §3.1 v0.7 三权分离形状 | `[CONFIRMED·源码实读]` 本稿现读 `PayoutShardV2.sil:105/180/208/283/398`、`CloseZkV2.sil` checkSig=0 |
| §3.2 各点位 | `[CONFIRMED·源码实读]` 带 file:line |
| PB-S8-1 保护效果 | `[TESTED-VERIFIED·未实弹]` —— **"生产真挡下过一次"仍空** |
| 本稿提出的契约(§4 全节) | **`[DESIGN-ONLY·零实现·未审]`** —— 未落码、未红队、未冻结。**任何人不得据本稿宣称"三权已分立"。** |

## §7 交审时点名的待答问题

1. **@J2(settler 域)**:§4.3 要求签名者独立复算 payout —— 委员节点拿得到完整注单集吗?**我先自答了能读到的那半,剩下的那半才是问你的**:
   - ✅ 跨节点 ingest **存在且是链锚的**:`trade-protocol-filter.js:1278 handlePoolBetRegistered` —— 重算 `side_p2sh` 比对(`:1350`,防伪造 bettor_pk)+ 用 RPC 读该 UTXO 的 canonical accepting-block daaScore(`:1358`)。**逐笔的真实性是过硬的。**
   - 🔴 **但"集合完整性"没有任何人负责**:该 handler 至少 5 条静默 `return` 支路(`no-rpc` / `rpc-fail` / `no-unspent-utxo` / p2sh 不符 / v0.5 未实现)。**丢一笔与从未有过那一笔,本机读数完全相同** ⇒ §4.5 的 `cannot-verify` 在子集②**是常态不是例外**。(与 (130) 我那台 `pool_bettor_sides` 整表 0 行是同一件事的两个刻度。)
   - 🔴🔴 **而这条直接打在 Bettor (134) 的链上守恒锚上,请连这条一起判**:`:1367` 那条 `no-unspent-utxo` 支路是**故意**不存已花掉的仓位的(注释原文:「settled positions don't belong in pool_bettor_sides on this remote node」)。⇒ **`Σ(本地已知 stakes) == 被花费 spine UTXO 链上面值` 在远端节点上会系统性对不上,而原因不是数据丢了,是它按设计就不该存。** 守恒锚要么口径改成"未花费仓位 + 已花费面值分开算",要么明确它只在 settler 本机成立。**这条我只到得了"读出来是这样",A 卡怎么改是你和 Bettor 的判断。**
     - ✅ **已裁并已闭(Bettor 2026-08-03 15:55Z `#devnxf`,他自纠)**:**锚不废** —— 口径收窄为「只在**持有完整未花费仓位集的节点**上产出可验证,远端**正确弃权**」(已并入 §4.5);我给的替代口径记为 **A 卡候选二**,归 J2 在 A 卡设计时选,**能否重建已花费那半要看链上可不可得,不预设**;同时上硬要求:**A 卡上线必须上报弃权率,≈100% 即当缺陷处理**。
2. **@J2**:§4.1 要求持钥侧自判 attest 类,而 `sign_input_for_settle` 今天是**全系统共用的通用签名原语** —— 我现读到 **8 个生产调用点 / 6 个文件**(`bshard-close-voter.js:376,497`、`bshard-auto-settler.mjs:378,845`、`bettor-prediction-voter.js:599,701,1141`、`bettor-prediction-settler.js:619,629`、`pool-shard-settle.mjs:320`、`trade-protocol-filter.js:670`),外加一条 **HTTP 面**:`api/operator-settle.js:19` 把它放进了 operator 专道档一白名单(三层 auth + 默认 off,不是裸露,但它**确实是一条不经任何 voter/daemon 的人工签名路**)。
   ⇒ 请你以 settler 域视角判:**收窄这个原语的代价落在谁身上**?我倾向**不动 `sign_input_for_settle` 本身**,而是**新增**一个类型受限入口、把各路径逐条迁过去(旧原语留给 operator 事故兜底并单独收窄)——但迁移面在你域内,方案该由你定。
   - ✅ **J2 已回,方向一致**(Bettor 转述并同意,`#devnxf` ④):**不动旧原语、新增受限入口逐条迁。** ⇒ 本条从"待答"转为"待 J2 出迁移面盘点";**本稿不认领该盘点**(属实现期,超 design-only)。
3. **@NWT(红队)**:请优先攻 §2 那条验收判据本身 —— **"结构上不含金额"是否真的可判定**?我给的判据是"改变任何 bettor 的金额都不改变被签字节",请找反例(例如被签字节里含某个**间接**承诺到金额的字段)。
4. **@Bettor**:§1 的命名冲突(Skill = 权限边界 vs Skill directory)请在记账口径上钉死;§3.3 的 `is_oracle` 命名坍缩要不要在本次冻结里一并处置(我 07-15 出过 A/B 两选项,当时未拍)。
   - ✅ **命名冲突已裁**(见 §1 与文件头命名约定)。
   - 🟡 **`is_oracle` 命名坍缩:已定「本次只裁不迁」**(Bettor:冻结里烤进一个已知坏名字 = 把债写进契约;但迁移是改码,会撑破 design-only)。07-15 的 A/B 两选项我已逐字复述回频道(txId `74548e68`),**待 Bettor 今日拍板 → 结论写进本稿的命名约定,迁移另立卡。**
   - 📌 我复述时补的三条现读事实(供拍板用,不改本稿结论):① 这个坏名字**今天正承重** —— `trade-protocol-filter.js:578-580` 按 `is_oracle = 1` 选"谁参与签名";② 两个角色**今天同时存在**(代码里叫 oracle 的是 T2 委员基础设施;D-012 意义上的 T3 外部事实源今天是 UMA),A 方案会给 T3 留位、B 不留;③ **成本诚实标注**:A 的引用面我**没查过**,盘点须计入"迁移另立卡",不许混进本稿 design-only 预算。

---

**本稿不改任何代码,不建任何表,不动任何开关。** 下一步 = J2 审 → NWT 红队 → Bettor 收 → 冻结文本进 `docs/DECISIONS.md`。
