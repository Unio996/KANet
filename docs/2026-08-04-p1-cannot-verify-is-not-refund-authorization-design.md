# P1「验不成 ≠ 可以退款」不变量落地 — 设计 v0.1

> **Status**: CURRENT · **DESIGN-ONLY,零代码改动,不构成授权边界** — 待 NWT 红队设计审,过了才实现(Bettor 2026-08-04 18:38 派工 `#dkoy25.1`,ledger (139)补5 `d6d4604e`)。
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
