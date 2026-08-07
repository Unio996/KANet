> **Status**: DRAFT v0.1 · **ST-05 · Oracle truth / dispute / correction 制度矩阵** · DRI J1(J1tn) × 协调 Bettor × 红队 NWT
> **授权**: `OWNER-DIRECTIVE-20260806-POST-TOCCATA-INSTITUTIONAL-STRESS-TEST` ST-05(`origin/coord/codex-bridge:coordination/codex-bridge/`)。**BATCH-0 = 只做设计 + 现状盘点 + 证据缺口;不实跑 / 不改码 / 不拉取上游。**
> **Gate(directive 原文)**: **「接入 Oracle API」不得被表述为 truth layer 已解决。**
> **验收五级**: `PROTOCOL_CAPABILITY` → `TESTABLE_MACHINERY` → `VERIFIED_PATH` → `USABLE_INFRASTRUCTURE`,**无锚 = `NOT_PROVEN`**。
> **约束**: 本稿只新增本文件。零代码 / 零 DB 写 / 零链上 / 零钱路。断言带 file:line 或命令输出(本会话现读);推断显式标注。
> **证据分级**: `[CONFIRMED·源码实读]` / `[CONFIRMED·DB实读]` / `[强推断]` / `[未验]`。

# ST-05 · Oracle truth / dispute / correction 制度矩阵 (现状盘点 v0.1)

## §0 作用域 + 一句话结论

**作用域**:所有 DB 读数只等于 **`D:/kanet/kanet/kasia-console/data/console.db` 这一份库**、只等于此刻;所有代码读数等于本机检出(`bshard-m3-deploy`)。**别的节点可能不同。**

🔴 **一句话结论:`NOT_PROVEN`,而且失败模式集中在【事后】那一半。**
**事前**这一半做得相当扎实 —— 委员**自己取证**、只认 FINAL、判不了就弃签(`abstain-not-guess`),这是真机制、有真分支。
**事后**这一半几乎是空的:**签错事实没有被强制的经济后果 · 证据被纠正没有生产路径 · 结算已执行没有回退边界。**

🔨 **合起来正是 directive 那条 Gate 要防的形状**:我们**接好了 Oracle API 并且认真处理了"取不到/没终态"**,
但 **truth layer 要回答的是"取到了、签了、然后错了怎么办"** —— 那一半在本仓**主要靠假设,不靠机制**。

---

## §1 六项必覆盖 · 矩阵

| # | Directive 必须覆盖 | 现状 | 级别 |
|---|---|---|---|
| 1 | **委员分裂** | 🟡 分裂 ⇒ 凑不齐阈值 ⇒ 冻结(有机制,非终裁) | `TESTABLE_MACHINERY` |
| 2 | **阈值刚好无法形成** | 🟡 同上,`sigCount<4` ⇒ `freezeAwaitingAuthorization` | `TESTABLE_MACHINERY` |
| 3 | 🔴 **多数签署错误事实** | 🔴 **合约有问责入口,代码无调用点;经济后果无强制** | `PROTOCOL_CAPABILITY` 而已 |
| 4 | 🔴 **证据随后被撤回或纠正** | 🔴 **不是被处理,是被假设掉**(「FINAL 赛果 immutable」) | `NOT_PROVEN` |
| 5 | **现实事实长期歧义** | 🟡 弃签 ⇒ 冻结;**无延期机制**,时间不产生权力 | `TESTABLE_MACHINERY`(但出口见 ST-02 §2.7) |
| 6 | 🔴 **自动结算已执行后的错误恢复边界** | 🔴 **无回退路径 —— 边界就是"没有"** | `NOT_PROVEN` |

---

## §2 事前那一半:做得扎实的部分(先说好的,否则后面像在唱衰)

### 2.1 观察资格 + 证据复核 = `abstain-not-guess`,是真机制 `[CONFIRMED·源码实读]`

**trust 锚 = 委员【自己 fetch】canonical 源,不是 settler 提议的 snapshot** ——
`bshard-close-enforce.mjs:636-640` 逐字:「Trust anchor = **THIS node's own canonical fetch, NOT the settler's proposed snapshot**. The proposed snapshot gives determinism …; each member verifies it == its own canonical fetch before accepting. **Poison snapshot ≠ honest fetch → reject**」。

弃签分支是**真分支**,不是文案:
- `:377` `judgeLine` 字段不足 ⇒ `abstain-not-guess: 字段不足/无法判, 弃签`
- `:601` 只认 **FINAL-only** + canonical 归一 + `field_hash`
- `:625-626` 赛果未定 ⇒ **不缓存**、返 null ⇒ caller 弃签
- `:650` 自取拿不到字段 ⇒ `abstain`
- `:373` 自取 ≠ 提议 ⇒ `pass:false`
- `oracle-evidence-extractors.mjs:370` 无 `data_source_canonical` ⇒ `verdict:'no_canonical'`(机器可解析 URL 是硬要求)

🔵 **这一层的设计判据是对的**:默认是**弃签**,不是"尽力猜一个"。它把 stale / partial / withheld 三类都接住了。

### 2.2 委员分裂 / 阈值不成(必覆盖 1、2) `[CONFIRMED·源码实读]`

阈值 = **4-of-5**(`PoolSpine_v06.sil:18` 「≥4 of 5 individual checkSig」,合约体 `:75` 「counter requires ≥4 valid」);
凑不齐 ⇒ `pool-market-settler.js:1402`(`phase2AgeMs > COLLECTING_SIGS_WATCHDOG_MS`,阈值 `:98-99` 默认 30 分钟)
→ `:1407` `sigCount < 4` ⇒ `freezeAwaitingAuthorization`(`:256-287`)。
🔵 **`:1410` 的注释把最该说的说了**:「**签名收不齐【不是】退款授权**」「`sigCount` 是**本机知道的**签名数 —— 跨节点回执没 ingest 时,它与"委员真的没签"读数完全相同」。

> 🔴 **而紧挨着它的一行,会让任何以日志为轴的观察者读到相反的事实** `[CONFIRMED·源码实读]`:
> `:1408` 打印的仍是旧行为 —— `→ force cancel + maker refund (silent stuck)`,**而实际动作是冻结**。
> ⇒ **对 ST-05 这是观测面缺陷,不只是文案**:争议/冻结路径的**唯一人类可读输出在说谎**,
> 任何据日志判"这盘被退款了"的人会判反。(该不一致前置⑥ v0.1 §4.1 已登记,**本稿不修,只记它落在 ST-05 的可观测性一栏**。)

⇒ **分裂/不成阈,有确定的、fail-closed 的落点。这一格成立。**
🔴 **但它是"停下来",不是"最终裁决"** —— directive 问的**最终裁决 / 申诉**在本仓**没有对应机制**:冻结态的唯一出口是运营方手动脚本(详见 `docs/2026-08-07-st02-…-v0.1.md` §2.7,不在本稿重复)。

---

## §3 事后那一半:三个洞

### 3.1 🔴 必覆盖 3 · **多数签署错误事实 —— 有问责入口,无人调用;有 slash 字段,无强制**

**(a) 合约侧有入口** `[CONFIRMED·源码实读]`:`PoolSpine_v06.sil:246-249` `entrypoint function dispute_reveal(...)`,注释写明用途 ——「triggered when a settle outcome is disputed … **dispute mode is about establishing individual accountability for slashing**」;`:62` 用 `committeePkHash` 绑定被揭示的委员集。v0.7 同款(`PoolSpine_v07.sil:51/59/92`)。

**(b) 代码侧无调用点** `[CONFIRMED·源码实读]`:全仓 `grep -rn dispute_reveal --include=*.js --include=*.mjs --include=*.cjs`(**不限目录,排除 node_modules**)⇒ 非 `.sil` 命中**只有两处,都不是调用**:
- `pool-merkle-v06.mjs:132` —— **注释**里提到 "dispute_reveal commitment";
- `scripts/regression-runner.mjs:260` —— 一个**入口点名字清单**(`['settle_aggregate','dispute_reveal',…]`)。

> ⚠ **按 AP 规则 70 精确措辞**:以上成立的是「**被检代码库中没有调用点**」。它**不等于**「该入口从未被击发」——
> 别的节点的代码、手工构造的交易都不在我的仪器范围内。**别把它写成"从未使用过"。**

**(c) 经济后果:字段在,强制不在** `[CONFIRMED·源码实读 + DB实读]`:
- 唯一含 `slashed_amount` 的表 = `oracle_history`(`migrate.js:4201` `slashed_amount REAL DEFAULT 0`)。
- **本机该表 0 行**(现读 `SELECT COUNT(*)`)⇒ 本节点没有任何投票/奖励/罚没历史。
- 🔴 **而更要紧的是它怎么被写**:`bettor.js:2311` 该值取自 **`request.body`** —— **是调用方声明的数字,不是由「票 vs 共识」比对算出来的**。写入点 `:2333-2336` 与 `bettor-prediction-voter.js:355`(`INSERT OR IGNORE`)。

⇒ 🔴 **合起来**:委员多数签了错误事实 ⇒ 合约里那个专为问责设的入口**没有调用方**;链下那个 slash 字段**是自报的、且本机为空**。
**当前栈里,签错事实没有任何被强制执行的经济后果。**
🔨 **这正撞 Gate**:有 `dispute_reveal` 这个**协议能力**,不等于有一个**争议制度**。两者差的是"谁在什么条件下、按什么程序去调它",而那部分不存在。

### 3.2 🔴 必覆盖 4 · **证据被撤回或纠正 —— 这不是被处理的情形,是被假设掉的情形**

`[CONFIRMED·源码实读]` per-URL FINAL-cache:`bshard-close-enforce.mjs:593-614`,`_FINAL_CACHE_TTL_MS = 6h`。
其**设计前提逐字写在注释里**(`:594`):「**FINAL 赛果是 immutable (赛完数据稳) → 缓存安全**。TTL 只用于 bound bad-cache 影响半径」。
清缓存的函数只有一个,且标着 **`// test-only: … production 无需调`**(`:632-633`)。
**第二份独立缓存**:`bettor-prediction-voter.js:875/903`,`FINAL_EVIDENCE_TTL_MS = 6h`,注释同样写「final game results are immutable」。

⇒ 🔴 **三条结论**:
1. **源在 6 小时内撤回/纠正 ⇒ 委员重取会拿到缓存里那个(已经错了的)值。生产路径上没有任何东西会让它失效** —— 唯一的失效是 TTL 到期,唯一的清除函数明说不给生产用。
2. **「FINAL immutable」是一个被写下来但没有被强制、也没有被监测的假设。** 现实里赛果**会**被改(申诉、改判、计分更正)。**假设写在注释里是好习惯;把假设当机制用不是。**
3. 🟡 **同一个假设被两份独立缓存各实现一次**(`bshard-close-enforce` 与 `bettor-prediction-voter`)—— 本仓自己的**单源纪律**在这里破了。两份 TTL 现在都是 6h,**但没有任何东西保证它们一起改**。

🔵 **公平地说 TTL 的作用**:6h 上界确实把 bad-cache 的影响半径**限住了**,这比无限缓存好得多。
🔴 **但它管不到已经用那份证据签过名的那些盘** —— 那属于 §3.3。

### 3.3 🔴 必覆盖 6 · **结算已执行后的错误恢复边界 = 没有边界,因为没有路径**

`[CONFIRMED·源码实读]` 现读 `pool-market-settler.js` 全部 `protocol_status = '…'` 写入点(**不带过滤,按值点数**):
`cancelled` ×6 · `unresolved_needs_authorization` ×3 · `disputed` ×3 · `refunding` ×1 · `verifying` ×1 · `pending_bettors` ×1 · `collecting_sigs` ×1。
**没有任何一个写入点把市场从已完成/已结算态推回可变态。**

⇒ 🔴 **一旦 payout 交易落链,协议侧与代码侧都没有"撤销 / 重结算 / 补偿"的入口。**
这与铁律 `NO TX NO STATE CHANGE` 是**同一枚硬币的两面**:链上不可逆是我们要的性质,**代价就是错误也不可逆**。
⇒ **ST-05 问的"错误恢复边界"**,诚实答案是:**边界 = 结算广播那一刻。之前全靠事前弃签,之后什么都没有。**

🔵 **不外推**:这**不是缺陷指控** —— 不可逆是设计选择,而且很可能是对的选择。
🔴 **但它把全部重量压在 §2.1 那一层上**,并且意味着 §3.1(签错无后果)与 §3.2(证据可能已被纠正)**这两个洞没有下游兜底**。**三者必须一起读。**

### 3.4 必覆盖 5 · **现实事实长期歧义 —— 无延期机制,而这是对的**

`[CONFIRMED·源码实读]` 搜 `extend / 延期 / postpone` 于 settler ⇒ **无 deadline 延展机制**(唯一命中 `:924` 是无关的 "extend committee sampling to v0.7")。
长期歧义 ⇒ 持续弃签 ⇒ 超时 ⇒ 冻结。且 `authorizeRefundByOwner` 函数头逐字:「**时间在冻结态里不产生任何权力**」。

🔵 **这个组合是自洽的**:歧义不会被"等到超时就当某方赢"消化掉。**没有延期机制,恰恰是因为不需要 —— 它已经有一个不产生权力的等待态。**
🔴 **代价仍是那一个**:等待态的出口是人工的(ST-02 §2.7)。**歧义越持久,压在那支脚本上的盘越多。**

---

## §4 对 Gate 的直接回答

> **Gate**:「接入 Oracle API」不得被表述为 truth layer 已解决。

**本稿的答复:在本仓,这条 Gate 目前【守住了】,但守住它的是文档纪律,不是机制。**

| truth layer 要回答的 | 本仓现状 |
|---|---|
| 谁有资格观察 | 🟢 委员自取 + canonical URL 硬要求 |
| 证据怎么复核 | 🟢 own-fetch == proposed,不符即拒 |
| 取不到/没终态怎么办 | 🟢 abstain-not-guess,fail-closed |
| 串谋 / 失联 | 🟡 阈值 4-of-5 + 冻结;**无问责执行** |
| **签错了怎么办** | 🔴 **无强制后果**(§3.1) |
| **证据被改了怎么办** | 🔴 **假设它不会被改**(§3.2) |
| **已经结算了怎么办** | 🔴 **无路径**(§3.3) |
| 申诉 / 最终裁决 | 🔴 **无制度**(冻结不是裁决) |

🔨 **一句话**:**我们有一个很认真的"要不要签"的机制,没有一个"签错了怎么办"的制度。** 前者是 Oracle 接入,后者才是 truth layer。

---

## §5 证据缺口卡

| 卡 | 内容 | 归谁 |
|---|---|---|
| 🔴 `ST05-G1-DISPUTE-REVEAL-NO-CALLER` | 合约问责入口无调用方(作用域:被检代码库)。**要的不是"写个 caller",是"谁在什么条件下按什么程序发起争议"** | Bettor / Owner(制度) |
| 🔴 `ST05-G2-SLASH-NOT-ENFORCED` | `slashed_amount` 由 caller 自报、本机表 0 行、无链上 bond 罚没路径 ⇒ 签错无经济后果 | Bettor / Owner |
| 🔴 `ST05-G3-FINAL-IMMUTABLE-ASSUMED` | 「FINAL 赛果 immutable」是**写下但未强制未监测**的假设;6h 缓存无生产失效路径;**两份独立缓存各实现一次** | J1(单源合并)/ NWT(假设是否成立) |
| 🔴 `ST05-G4-NO-POST-SETTLE-RECOVERY` | 结算后无回退入口。**需要的是明确"这是有意的不可逆"并写进对外口径**,而不是留白 | Bettor / Owner |
| `ST05-G5-APPEAL-ABSENT` | 无申诉/最终裁决制度;冻结是"停下"不是"裁决" | Bettor |
| `ST05-G6-MALICIOUS-SOURCE` | 与 ST-02 `G6` 同一张卡:abstain-not-guess 防"源坏/源没到",**不防"源说谎"**。**别开两张** | NWT |
| 🔴 `ST05-G7-FREEZE-LOG-LIES` | `settler:1408` 日志仍打 `force cancel + maker refund`,实际动作是冻结(`:1407`→`freezeAwaitingAuthorization`)⇒ **争议路径唯一的人类可读输出与事实相反**,据日志判会判反 | J2 / KANet-UI(改文案)· 已在 ⑥ v0.1 §4.1 登记 |

## §6 交审点名

1. **@NWT(红队)· 首攻 §3.2**:我说「FINAL immutable 是假设不是机制」。**若你能举出一个 canonical 源事后改过 FINAL 的真实例子**(赛果改判/计分更正),这一格就从"理论缺口"变成"已实现风险",严重性差一个量级。**这比攻我别的任何一条都值钱。**
2. **@J2(协议复核)**:§3.3 我只点了 `pool-market-settler.js` 一个文件的 `protocol_status` 写入点 —— **别处若有把市场推出终态的写入,我这条就错了**,请复核。
3. **@Bettor**:§5 的 G1/G2/G4 **都不是工程题** —— 争议程序、罚没执行、不可逆的对外口径,三条都要制度裁定。**我不替你拍。**
4. 🔴 **本稿是 BATCH-0 现状盘点,不使 ST-05 从 OPEN 变 CLOSED,不构成任何实现/部署/钱路授权。**
