# P1「验不成 ≠ 可以退款」不变量落地 — 设计 v0.2

> **Status**: CURRENT · **DESIGN-ONLY,零代码改动,不构成授权边界** — NWT 红队对 v0.1 出 🔴 PUSH-BACK(三项),v0.2 逐条处置,仍待复审
>
> 🔴 **v0.2 头号变更 = 撤回 v0.1 §3.2 的核心判断,方向是【我说小了】**:我当时说"末端对有 bet 的市场付不出去(r402 拦)"。**实查:钱早就付出去了。** `:1149` 与 `:1052` 两条纯超时路径累计已退 **62,698.8 KAS 的 bettor 本金**(39 个市场、848 个 bettor side、其中 841 个已带 `claim_txid`)。原因见 §8:**r402 只守 maker 那条腿,bettor 的钱走的是另一条我当时没找到的独立扫描**。
> 🔴 **v0.2 第二处更正(NWT 对账打中)**:v0.1 §2 报 `:1052` 为 **8** 个,实为 **11** 个 —— 我把计数键在了一个**内嵌运行时变量的字符串**上(`verifying <N>min > grace …`,N 实际有 120/121/123 三种),精确匹配漏掉 3 个。**教训:统计口径不许用含变量的整串做等值匹配。**
>
> — 待 NWT 红队设计审,过了才实现(Bettor 2026-08-04 18:38 派工 `#dkoy25.1`,ledger (139)补5 `d6d4604e`)。
> 归 J2(settler 域)。上游:Codex 第三轮 P2/收口证据第 5 条 · Bettor 16:28 实查立卡(ledger (137))· Owner 铁律「只 settle 绝不 refund」([[project-owner-settle-not-refund-orphan-permanent-loss-precedent]])。

## 0. 一页结论

**要落的不变量(Codex 原话,Bettor 采纳)**:

> 验证不可用 ⇒ 验证者结论 = inconclusive ⇒ 不签名,**且不产生任何自动退款授权**。
> **deadline 到期不得把「缺证据」变成「执行另一条不可逆钱路的许可」。**

**本设计的立场**:不是"禁止一切退款",是**把已经存在的自动退款收窄到【能举证】的那几类**;举不出证据的,从「自动退款」降级为「停下、等另行授权」。

🔴 **而这笔交易的代价必须先说清楚,它是本设计最该被 Owner 看见的一句**:
`:1052` 那条超时退款**当初正是为了解决"钱永久锁死"才加的**(代码自陈:cross-node quorum 永不可达 ⇒ bettor+maker stake 永锁,ZOMBIE 实证)。**收窄它 = 把那批钱重新变回"卡住"状态。** 这正是 Owner 铁律已经做过的取舍(3000 KAS 孤儿:宁可永久损失也不退款),**但它值得在落地前被再确认一次,而不是由我在设计稿里默默替 Owner 选**。⇒ §6 开放项①。

## 1. 三处触发点逐处实读 + 各答 Bettor 的问题

> 问题(Bettor 原话):**「退款这个动作本身,除了"超时了",还有什么独立证据支持它是对的?」**

### 1.1 `:1052` verifying 超 grace 未达 quorum ⇒ refund 终态

- **条件实读**:`ageSinceDeadlineSec > VERIFYING_QUORUM_TIMEOUT_SEC`(env `VERIFYING_QUORUM_TIMEOUT_SEC`,默认 **7200s**)`&& !meta.refund_dispatched_at && !meta.quorum_timeout_refund_at`。
- **独立证据?** —— **没有,一条都没有。** 触发式里**只有时间**。代码注释自陈其存在理由是可用性(「市场永卡 verifying,bettor+maker stake 永锁」),不是"我们判定该退款"。
- **它连"为什么没达 quorum"都不区分**:委员投了反对 / 委员根本没投 / 本机没收到投票 / RPC 坏了 —— 在这个条件式里**读数完全相同**。这正是「无法判定」被当成「判定为该退款」的教科书形态。

### 1.2 `:1149` watchdog-b:`collecting_sigs` 超时且 `sigCount < 4` ⇒ 强制 cancel + maker refund

- **条件实读**:`protocol_status='collecting_sigs' && meta.phase2_dispatched_at && phase2Age > COLLECTING_SIGS_WATCHDOG_MS`(env `COLLECTING_SIGS_WATCHDOG_MIN`,默认 **30min**)`&& sigCount < 4 && !meta.refund_dispatched_at`。`sigCount` 取自本地 `chain_events` 的 `pool_oracle_tx_sig` 计数。
- **独立证据?** —— **没有。** 而且比 `:1052` 更糟一层:**`sigCount` 是【本机知道的签名数】,不是【实际签名数】**。跨节点签名回执没 ingest 到本机 ⇒ 读数与"委员真的没签"**完全相同**(与 J1 盲窗那条同形:丢了与没发生同形)。
- 🔴 **它与 PB-S8-2 直接相接**:本设计要加的签名前检查一旦拒签(无论多正确),市场就落进 `sigCount<4`,30 分钟后就是这一条。**⇒ 越是把签名侧做严,越要先把这条修好**,否则"更安全的拒签"直接换成"更快的自动退款"。
- **硬编码 `4`**:阈值写死,不随 committee 规模/`unanimous` 变化 —— 与 metadata 里 `unanimous` 语义是否一致,本稿未核,列为 §7 红队点。

### 1.3 `:1027` dispute grace 超时 ⇒ refund

- **条件实读**:上游 `decideConsensusV06` 档1 catch-all 返回 `action:'dispute'` ⇒ 首检写 `status='disputed'` + `dispute_started_at`;下一 tick 若 `disputeAge >= DISPUTE_GRACE_MS`(env `DISPUTE_GRACE_MIN`,默认 **10min**)⇒ `dispatchRefund`。
- **独立证据?** —— **半条,且性质与前两处不同,不能混为一谈**:
  - 上游进入 dispute 的前提是**真的收到过投票**(`allDecided` 或过 timeout 的非-4-同向),即**存在一个基于投票的判定**,不是"什么都没发生"。
  - **但 grace 超时本身仍然不带任何新证据** —— 10 分钟之后并没有多出任何支持"该退款"的东西。
- 🔴 **且这条是 Owner 终裁 r518 明文设计的终态**(代码注释:「dispute 写死终态(防 stuck-order)」)。**⇒ 本设计不单方面改它**,只指出「grace 到期」这一段仍是纯时间授权,处置口径归 Owner/Bettor(§6 开放项②)。
- **正面对照就在同一个函数里**:`abstain≥4 ⇒ refund` 的理由是**「≥4 委员【主动】投 ABSTAIN = affirmative-unjudgeable」** —— 那是**有证据的退款**(有人明确说了"判不了"),与"没人说话所以退款"是两回事。**这条是本设计白名单的原型。**

## 2. 实数据:这条通道真的通过,而两处口径要更正(现查 `data/console.db`,只读)

| 触发形态 | 现存痕迹 |
|---|---|
| `:1149` watchdog-b collecting_sigs silent timeout | **28** 个市场 |
| `:1052` verifying 超 grace 未达 quorum | **8** 个市场 |
| `:1027` dispute grace timeout | **9** 个市场 |
| (同族)`committee_unformed(sample_fail=…)` | 3 个 |
| 走到过 `dispatchRefund` 的市场总计 | 1581(其中 **207 个是有 bet 的**) |

🔴 **口径更正①(对我自己 08-03 那句"通道今天就是通的"的精确化)**:通道确实通,**而它比卡上写的三处更宽** —— 现存痕迹里最大的一族是 `v0.6 4-of-5 threshold unmet … past 30/120min timeout`(**约 49 个**)。**但这一族的字符串在当前代码里 grep 零命中** ⇒ 它们是 Owner r518 门C 档1 重写**之前**的旧路径产物。**⇒ 不许把这 49 个算进"现在还敞着的口"**(算进去就是拿历史数据吓唬人);**但也不许当它不存在** —— 它证明这个形状在本仓**反复出现过**。

🔴 **口径更正②(现役第 4 个触发点,卡上没写)**:`decideConsensusV05` Case 3 —— `votes.length <= 1 && pastSilentTimeout ⇒ refund`(理由字面就是 "all 3 oracles silent past 30min timeout")。**这是现役代码,纯超时授权,与三处同族。** ⇒ 本卡范围应为 **4 处**,不是 3 处。

## 3. 🔴 顺带查出两个缺陷(不是本卡要修的目标,但它们就在这三处上)

### 3.1 `:1052` 与 `:1149` 各有一次 read-modify-write 覆盖,把自己的审计痕迹擦掉了

**证据(代码 + 数据双向对上)**:
- 两处都先 `meta.<flag> = …` 然后 `UPDATE pool_markets SET metadata=?`;**紧接着**调 `dispatchRefund(market, …)`,而 `dispatchRefund` 内部 `prevMeta = JSON.parse(market.metadata)` 读的是**同一个 JS 对象上那个尚未更新的 metadata 字符串** ⇒ 用旧 meta + refund 字段**整体覆盖**刚写进去的标记。
- **数据逐字印证**:`cancel_reason='collecting_sigs_silent_timeout'` 命中 **0** 行,而 `refund_reason='watchdog-b: collecting_sigs silent timeout'` 命中 **28** 行;`quorum_timeout_refund_at` 命中 **0** 行,而对应 `refund_reason` 命中 **8** 行。**⇒ 写了,然后被覆盖了,28+8 次。**

**已确认的后果 = 审计痕迹丢失**(事后无法从库里区分"这个盘为什么被 cancel/退款")。
**未被证明的后果(不许说满)**:幂等性**没有**因此破 —— `:1052` 的守卫是 `!refund_dispatched_at && !quorum_timeout_refund_at`,前者由覆盖那一次写入并存活 ⇒ 仍挡得住重复触发。**我没有构造出"因此反复重放"的场景,所以不写成那样。** 同族形状见 CLAUDE.md 记的 xzztw read-modify-write 死循环,但**这次不是那个**。

### 3.2 `dispatchRefund` 之后真正付钱的那一步,对有 bet 的市场其实过不去 —— 而这不是"所以没事"

- `handleRefunding`(唯一签名+广播点)开头有 **r402 闸**:`betCount > 0 ⇒ REFUSED`,并把 `status` 退回 `verifying`。而 `dispatchRefund` 建的是 `refund_maker_unjoined`(**maker 单签、0-bet 那条 SS 入口**)。
- ⇒ **对有 bet 的市场,这条链的末端付不出去。** 三处触发点造成的是**状态机翻动**(`verifying → refunding →(r402 拒)→ verifying`),不是"bettor 的钱被自动退走"。
- 🔴 **但这三点必须一起说,否则就是"有利结论"没查够**:
  1. **r402 是 2026-08-03 才上线的**(昨天)。`refund_conflict_at` 现存 **0 行** ⇒ **这道闸在生产里一次都没实弹拦过**,"它会拦住"目前是设计断言不是实测。
  2. **闸只在这一条路上**。`bshard` 市场走的是另一条(`dispatchRefund` 直接 fail-loud 拒绝);`v0.5` 市场 `handleRefunding` 直接 skip;**这些分支的付钱语义本稿未逐条追**。
  3. **状态翻动本身就是伤害**:市场在 `verifying/refunding` 之间来回,而 `:1052` 的计时基准 `ageSinceDeadlineSec` 是**从 deadline 算的绝对时间**,不随状态回退重置 ⇒ 回到 `verifying` 后**下一 tick 立刻再次满足超时条件**。
- ⇒ **结论只能写成**:「末端有一道**未经实弹**的闸,可能挡住有 bet 市场的实际出款;**但授权语义仍然是错的**,而且它已经在状态机上真实生效了 45 次。」**不许写成"所以这个卡不紧急"。**

## 4. 修法:把「无法判定」与「判定为该退款」拆成两个状态

### 4.1 核心:退款必须携带**肯定式证据**,而证据取自白名单(不是黑名单)

> 判据来源:ANTI-PATTERNS 规则 58 —— **安全闸用"排除已知坏值"天生不完备,只放行已知好值才是封闭式防护。**「超时不算证据」这种黑名单写法挡不住下一个新写的超时分支;**白名单能。**

每一次进入退款路径,**必须**带一个 `refund_evidence` 字段,取值只能是下列之一:

| 白名单取值 | 什么证据 | 可核实性 |
|---|---|---|
| `bettors_absent` | 本市场 0 bet | 链上可核(spine UTXO 面值 == maker stake)+ 本地 `pool_bettor_sides` 为空 |
| `committee_affirmative_unjudgeable` | **≥4 委员主动投 ABSTAIN** | `chain_events` 有逐条投票记录(现役 `abstain≥4` 分支即此) |
| `structurally_invalid_market` | commingled spine 等结构性无效 | 单源 `isCommingledSpine` 判据 |
| `owner_authorized` | 另行授权 | 必须带授权引用(谁、何时、依据) |

**「超时」不在表内,且不得新增以时间为唯一内容的取值。**

### 4.2 举不出证据时进哪 —— 新终态 `unresolved_needs_authorization`

```
验证不可用 / 票数不够 / 签名收不齐 / grace 到期
  ⇒ protocol_status = 'unresolved_needs_authorization'   ← 新状态, 冻结态
  ⇒ 写明 unresolved_reason + 冻结时刻 + 已知证据缺口
  ⇒ 不建 refund_tx_obj、不改钱路、不广播任何东西
  ⇒ 只有拿到白名单证据(含 owner_authorized)才能离开这个状态
```

- **它不是 `disputed` 的改名**:`disputed` 现在**自带一条通往退款的定时器**;新状态**没有定时器**,时间在这里不产生任何权力。
- **可观测性是硬要求**(否则就是把钱静静锁死):进入/停留在该状态的市场数必须**可计数、有接收者**(同今天已立的"告警必须有接收者"纪律);**长期为 0 与长期很大都要有人看见** —— 长期 0 说明这条路没通(装饰),长期很大说明有系统性验证故障。
- 🔴 **与 PB-S8-2 的排序闸**(Bettor 18:29)在这里闭合:B 的落码前置就是本卡,因为 B 会提高弃权率 ⇒ 更多市场落进"签不齐",而**只有本卡落地后,那些市场落进的是冻结态而不是退款**。

### 4.3 四处触发点各自怎么改(逐处,不含糊)

| 触发点 | 改成 |
|---|---|
| `:1052` quorum 超时 | ⇒ `unresolved_needs_authorization`(不再 `dispatchRefund`) |
| `:1149` collecting_sigs 超时 | ⇒ `unresolved_needs_authorization`;**并且先修 §3.1 的覆盖**,否则冻结原因同样会被擦掉 |
| `:1027` dispute grace 超时 | **不单方面改**(Owner r518 终裁),提请裁定(§6②);若维持,至少把 `refund_evidence` 字段补上并如实填 `timeout_only`,让它在统计里现形 |
| `decideConsensusV05` Case 3 | ⇒ `unresolved_needs_authorization`(与 `:1052` 同理) |

## 5. 测试设计(Codex 收口证据第 5 条 = Bettor 派工第三点)

**要证的命题**:**验证中断 ⇒ 市场不得自动进入退款广播路径。**

- **形态**:handler/服务级,**真 import 真调用**(照卡② `pbs8-signreq-byzantine-handler.test.mjs` 的形状,不是 SQL 重放 —— Codex 打过这一条)。
- **断言的是"零调用"**:mock `dispatchRefund` 与广播 IPC,断言在下列每个场景里**调用次数 = 0**,且市场落在 `unresolved_needs_authorization`:
  1. quorum 永不可达(委员票缺)+ 超 grace
  2. `collecting_sigs` 超时 + `sigCount<4`
  3. RPC 全失败(PB-S8-2 锚点②查不到)导致持续拒签 + 超 grace
  4. 本地 ingest 缺失造成的**假**"签名不足"(签名实际存在但本机不知道)
- 🔴 **必须配阳性对照**(否则是空断言 —— 今天刚被这条判据打过两次):`bettors_absent` 与 `committee_affirmative_unjudgeable` 两个场景里,`dispatchRefund` **调用次数必须 = 1**。证明 mock 够得到它、"零调用"不是因为根本没接上。
- 🔴 **判别式(规则 66 + Bettor 收紧版)**:把新守卫拆掉重跑,**红的必须是这几条用例自己**;红在别处 = 名字在说谎。
- **可跑性**(规则:可执行 ≠ 持续覆盖):文件头写死完整命令;**并如实标注它在不在 runner 扫描面内** —— 本仓 `--domain/--all` 只收 `*.test.mjs`,不在扫描面内的必须明说,引用覆盖率时扣掉。

## 6. 开放项(需要 Bettor/Owner 拍,我不替他们选)

1. 🔴 **收窄 `:1052` = 把"永久卡住"重新变成常态** —— 那正是它当初被加进来解决的问题(cross-node quorum 永不可达)。这与 Owner 铁律一致(宁可卡死不退款,3000 KAS 先例),**但值得在落地前由 Owner 再确认一次**,因为它会产生新的一批锁死资金。
2. **`:1027` 是 Owner r518 终裁的终态**,是否收窄归 Owner。
3. **`unresolved_needs_authorization` 的出口由谁签** —— 人工?Owner?一个独立的授权消息?本稿只规定"必须另行授权",没有规定授权机制本身。
4. **`sigCount < 4` 硬编码阈值**与 `unanimous`/committee 规模的一致性未核。
5. §3.2 的三条(r402 未实弹 / bshard 与 v0.5 分支未逐条追 / 状态翻动后计时不重置)**都是本卡范围内但本稿未做完的实核**。

## 7. 请 NWT 红队的点

1. **白名单四项够不够、有没有一项其实证不了它声称的东西**(尤其 `bettors_absent` 的链上可核性:`spine UTXO 面值 == maker stake` 这个等式我**没有实测过**,是按 §1 推的)。
2. **新状态会不会只是把定时器挪了个地方** —— 请攻:能不能找到一条路径,让市场从 `unresolved_needs_authorization` 在**没有白名单证据**的情况下离开?
3. **§3.1 那两处覆盖**:我判"幂等性没破"是基于 `refund_dispatched_at` 存活;请攻这个判断(有没有 `dispatchRefund` 中途失败、把两个标记都留成空的路径)。
4. **§3.2 的"末端付不出去"是不是被我说小了** —— 特别是 bshard 与 v0.5 两条我明标未追的分支。
5. **规则 66 判别式套在本设计上**:新加的 `refund_evidence` 字段,在决策那一刻真读得到吗?(它由谁写、写在哪、会不会又被 §3.1 那种覆盖擦掉。)

---

## 8. 🔴 v0.2 自我更正:v0.1 §3.2「末端付不出去」是错的 —— 钱早就动了,54,082 KAS

> **这是一条对我自己有利的结论,而它经不起再查一层。记法照 memory `feedback-convenient-conclusion-and-scope-misalignment`:有利结论必须按更高强度查,而我 v0.1 没查够。**

### 8.1 我当时错在哪

v0.1 §3.2 只追了 **maker 那条腿**:`dispatchRefund` → `handleRefunding` →(r402 `betCount>0` ⇒ REFUSED),于是得出"对有 bet 的市场付不出去"。

**漏掉的是 bettor 那条腿**,它是一条**独立扫描**(`pool-market-settler.js:248-268`),条件与 `dispatchRefund`/`handleRefunding` 完全无关:

```sql
JOIN pool_markets pm ON pm.id = pbs.market_id
WHERE ( … OR ( pm.protocol_status IN ('cancelled', 'refunded')
               AND pm.protocol_version IN ('v0.6','v0.7') ) )
  AND pm.deadline <= ?  AND pbs.side_lock_tx IS NOT NULL
  AND pbs.claim_txid IS NULL  AND (pbs.refund_attempted_at IS NULL OR …)
```

⇒ **只要市场的 `protocol_status` 落进 `cancelled`/`refunded`,bettor 的钱就会被自动退**,`r402` 在这条路上**没有任何位置**(r402 只在 `handleRefunding` 里,那是 maker 腿)。
🔴 而代码注释自陈这是**刻意加宽的**:「r1016(NWT r1108 catch):DROPPED the <1e10 pool-size filter … 旧过滤 WRONGLY excluded large (c) quorum-timeout-refunded markets → bettor stake stuck despite maker refund landed(**NWT 4万 locked**)」——**这条路正是为了让"quorum 超时退款"的市场把 bettor 的钱退掉而扩的。**

### 8.2 实测(只读现查,数字即证据)

| 触发点 | 市场数 | 全部落到的 status | bettor side 数 | 已带 `claim_txid` | 本金合计 |
|---|---|---|---|---|---|
| `:1149` watchdog-b collecting_sigs 超时 | 28 | **全部 `refunded`** | 518 | 511 | **15,054.9 KAS** |
| `:1052` verifying 超 grace 未达 quorum | **11**(非 v0.1 写的 8,见头注 + NWT 18:52 独立对账) | **全部 `refunded`** | 330 | **330(全部)** | **47,643.9 KAS** |
| 合计 | **39** | — | **848** | **841** | **62,698.8 KAS** |

⇒ **「验不成 ⇒ 自动退款」不是一个理论缺口,是一条已经搬走了 6.27 万 KAS bettor 本金的生产通道**,而支持这些退款的全部证据就是**两个计时器**(30 分钟 / 120 分钟)。

### 8.3 对设计的三处实质影响(不只是改个措辞)

1. **紧急度上调**:v0.1 结尾我写"不许据此说这卡不紧急";现在更准确的说法是——**这卡是已发生损害的收口,不是预防性加固**。
2. 🔴 **`:1149` 的改法必须更严**:它在调 `dispatchRefund` **之前**就写了 `protocol_status='cancelled'`。**光把 `dispatchRefund` 换成"设新状态"不够** —— 只要中途经过 `cancelled`,bettor 扫描就已经把这些市场收编了。**⇒ `:1149` 的新路径不得写 `cancelled`,必须直接进 `unresolved_needs_authorization`,一步到位、无中间态。**
3. **`bettors_absent` 白名单项的含义要收紧**:它证的是"没有 bettor 需要退",**不是**"可以退 bettor 的钱"。这两句在 8.1 那条扫描面前是不同的命题。

### 8.4 方法论记档(自罚一条)

**我查了被调方(`handleRefunding`),没查"还有谁也会因为这个状态动钱"。** 这与我今天自己抓到的 MUST-FIX-0 是**同一个形状的镜像**:那次是"守卫读不到值",这次是"我读不到另一条读同一个状态的路"。
⇒ **判据:改/评估一个【状态字段】的语义时,必须枚举【所有以该字段为条件动钱的查询】,不能只追自己手里那条调用链。** `grep "protocol_status IN"` 是这次本该第一步就做的动作(NWT 为了另一个问题做了它,我因此才发现)。

---

## 9. v0.2 对 NWT PUSH-BACK 三项的逐条处置

### 9.1 NWT ①:`:1027` 保留 `dispatchRefund` ⇒ 一个 flag 永久卡在"已尝试"而操作从未完成 —— **采纳**

**复核成立(我自读一遍,读数与他一致)**:`buildMakerRefundPreimage` 内 `market.maker_relay_id.startsWith('cross-node:') ⇒ return { ok:false, error:'cross-node maker (skip)' }`;而 `dispatchRefund` 的 `if (!preimage.ok) return …` **排在 `newMeta` 写入之前**。
⇒ 时序:调用方先把自己的时间戳 flag 写进 DB → `dispatchRefund` 在 preimage 处早退 → **flag 留在库里,退款从未发生** → 调用方守卫下次 tick 恒 false ⇒ **该市场永远不再被这条路径尝试**。
**且 NWT 的定性对**:cross-node maker **不是边角情况,是多节点部署的常态**。

**处置**:
- `:1052`/`:1149`/`Case 3` 按 §4.3 改为直接设状态、不再调 `dispatchRefund` ⇒ 这三处的该坑随之消失。
- 🔴 **`:1027` 维持 Owner r518 终裁不改结构**,但**落码时必须补收尾**(具体收尾动作见下方更正)。**不作为改动 Owner 终裁语义。**

**🔴 但 `:1027` 的失败形态与 `:1052`/`:1149` 不是同一种,这一点要改正(我上一句"清掉自己刚写的 flag"套在 `:1027` 上是错的)**:
- `:1052`/`:1149` **调用前先写一个自己的时间戳 flag** ⇒ preimage 失败时 flag 存活 ⇒ **永久静默卡死**(NWT ① 描述的那种)。
- `:1027` **调用前不写任何自己的 flag**(`dispute_started_at` 是上一 tick 写的、且是进入条件不是完成标记)⇒ preimage 失败时守卫 `!meta.refund_dispatched_at` **下次 tick 仍为真** ⇒ **不是卡死,是每 tick 无限重试**。
- **⇒ `:1027` 该补的收尾不是"清 flag",是"失败要有出口"**:连续 N 次 preimage 失败(尤其 `cross-node maker (skip)` 这种**结构性、重试一万次也不会变**的原因)必须转 `unresolved_needs_authorization` 并告警,而不是永远重试。

**🔴 现存实例(我现查,只读)——这一条不是 latent,是已经跑了 55 天的活事故**:
- 库里**当前有 4 个市场卡在 `protocol_status='disputed'`**,`dispute_started_at` = **2026-06-10 / 06-12**(距今约 **55 天**),`refund_dispatched_at` **全为空**,且**四个全是 `maker_relay_id LIKE 'cross-node:%'`**。
- ⇒ 它们每一个 settler tick 都在走 `:1027 → dispatchRefund → buildMakerRefundPreimage → cross-node maker (skip) → ok:false`,**已经这样重试了约两个月**,没有任何东西升级或告警(`logThrottled` 把日志也压下去了)。
- 📌 **与 Bettor/NWT 那条"0 现存事故"的关系(不冲突,是两种形态)**:NWT 18:52 查的是**"flag 设了但从未完成"**那一种,`:1052`/`:1149` 确实 **0**(11/11 与 28/28 全部完成),**他的结论我引用、不重复查**。**而 `:1027` 这 4 个是另一种形态(无 flag ⇒ 无限重试),没有被那次检查覆盖到。** ⇒ **「latent 未来风险」这个定性对 `:1052`/`:1149` 成立,对 `:1027` 不成立。**
- **量级口径**:活跃市场(`verifying/collecting_sigs/refunding/disputed`)共 116 个,其中 cross-node maker **仅 4 个** —— 即 NWT 说的"cross-node 是常态"在**部署拓扑**意义上成立,但在**本机当前活跃盘**里只占 3.4%;**而这 4 个 100% 卡住了**。两个数都要报,只报一个都会误导。

### 9.2 NWT ②:新状态**没有任何现存查询看得见** —— **采纳,升为落码硬前置**

**复核成立**:主 settler tick `:355` 选 `('verifying','collecting_sigs','refunding','disputed')`;两个 watchdog `:1096`/`:1174` 选 `('verifying','collecting_sigs')`;bettor 退款扫描 `:260` 选 `('cancelled','refunded')`。**`unresolved_needs_authorization` 不在其中任何一个集合里。**

🔴 **NWT 那句定性必须原样抄进来**:「"新状态没有定时器"这个不变量现在**确实成立,但成立的原因不是设计对,是没人在看它**」——这正是在册的**"永远弃权与永远通过在日志里同形"**族。**一个没人查询的状态,它的所有安全性质都是空的。**

**⇒ 三条落码硬前置(不齐不许落码,写进 §9.4 清单)**:
1. **计数查询 + 告警接收者**:数这个状态里有多少市场、锁着多少钱,接给告警。**长期为 0 与长期暴涨都必须有人看见**(长期 0 ⇒ 这条路根本没通 = 装饰)。
2. **`owner_authorized` 出口路径**:谁调、写哪个字段、写完之后状态机怎么继续 —— 目前**纯 prose,零接口**。
3. **显式声明它不在哪些集合里**:在改动处写死注释,说明它被**刻意**排除在 `:355`/`:1096`/`:1174`/`:260` 之外,以及**这是设计意图不是遗漏**(尤其 `:260` —— 被排除正是它不触发 bettor 自动退款的原因,见 §8)。

### 9.3 NWT ③:`bettors_absent` 的链上等式**今天不存在对应代码** —— **采纳**

他 grep 确认:现役 0-bet 判定用的是 `getBettorSumSompi`/`betCount`(**读本地 `pool_bettor_sides` 聚合**),**没有任何地方做过"spine UTXO 面值 == maker stake"这个链上等式**。
⇒ v0.1 §1 那条链上可核性是我**推的**,不是现成的。**落码前必须先把它写出来并实测**,否则 `bettors_absent` 这一项的"可核实"是空头承诺 —— 而它一旦落空,白名单里最常用的那一项就退化成"信本地聚合",正是 r402 那类假阳性面。

### 9.4 落码前置清单(v0.2 收口,与 §5 测试并列)

1. §9.2 三条(计数查询 / `owner_authorized` 出口 / 排除集合显式注释)
2. §9.3 的链上等式实现 + 实测
3. §8.3② 的 `:1149` 一步到位、**不得经过 `cancelled`**
4. §9.1 的 `:1027` preimage 失败清 flag 收尾
5. §5 的测试(含阳性对照与判别式)
6. NWT + 我共同待办:**bshard / v0.5 两条末端分支逐条追完**(双方都明标未做,不算已核)
