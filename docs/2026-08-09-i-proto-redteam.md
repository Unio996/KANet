> **Status**: RED-TEAM NOTE (Bettor-dispatch, independent) · design-only · 针对 J1 的 `kasia-console/src/lib/PoolSpine_i_proto.sil`(commit `01eb8f3d`)+ 设计稿 `docs/2026-08-09-per-market-fee-authority-design-v0.1.md` §9.x
> **性质**: 零改码。**未编译、未部署、未改任何 .sil**(遵协调者 read-only 指令)。唯一动作 = 重跑只读静态枚举器 `scripts/fee-authority-enumerate.mjs` + 源码实读 + 一段机制演示 eval。
> **证据分级**: `[CONFIRMED·源码实读]` / `[CONFIRMED·枚举器重跑]` / `[CONFIRMED·机制演示]` / `[J1-reported·我未复跑编译]` / `[推断·未上链验]`
> **接位**: J1 下线,本稿在其原型推进前做一次独立对抗审。**不与 J1 稿冲突**——确认它成立的部分,挑出它没说满的部分。

# (i) 原型红队 — 三条构造性主张成立;但"每市场费率权威 0→>0"这句,这份原型没兑现

## §0 一句话结论(先定价再交付)

🔵 **J1 三条【构造性】主张,我独立复核后成立**:(a) `marketMinFee`/`marketMaxFee` 进 redeem、(b) refund 出口把 `tx.outputs[0].value` 夹进 `[min,max]`、(c) 枚举器对它判 `PER-MARKET(range)`——**都对**。

🔴 **但这份原型【没有】把 (i) 头条那个量(`brokerFeePct`/`oracleFeePct` 市场政策费率)的权威从 0 抬起来**,原因有两层,且第二层是 MF-1 的复发:
1. 原型只动了 `refund_maker_unjoined` 一条出口;`settle_aggregate`(**broker 政策费真正流出的地方**)与 `dispute_reveal` **一字未动**——枚举器自证:两者仍 `NO-FEE-CONSTRAINT`。
2. 🔴 **原型让 `PER-MARKET(range)` 亮灯,靠的是 J1 把参数【命名】成 `market*`,而不是它约束的【量】是市场费率。** 它约束的量 = refund 的**网络/矿工费折扣**(逐字替换了 v0.7 那两个 `stake-50000`/`stake-1e8` mass 费字面量)。枚举器 `feeFamily()` 按**名字**分家族,`marketMinFee` 含 "market" ⇒ 记为 market 家族 ⇒ `PER-MARKET(range)`。**这正是 MF-1「两个量都叫 fee」那个病的复发**(在册 `[[reference-one-name-several-different-things]]`),只是这次触发点从 `/fee/i` 过宽换成了 `feeFamily()` 的名字分支。

🔵 **公允话**:把 refund 折扣做成每市场,是真进步(那条出口的网络费不再全局漂移)。**但它不是 R-3/(i)/MF-1 头条锚定的那个量**,而枚举器把它**当成了**那个量在计数。

🔴 **另有一条独立于上面的资金安全发现(不是费率口径问题)**:原型把 v0.7 的常量界换成 ctor 参数,**没有加"区间有效性"守卫**(`marketMinFee <= marketMaxFee` 等)。构造期一个非法区间 ⇒ refund 出口**恒不可满足** ⇒ 无人下注的市场里 maker 本金**永久锁死**。见 §4-H1,列为本稿最高优先。

---

## §1 我做了什么 / 没做什么(方法与作用域)

- ✅ 实读 `PoolSpine_i_proto.sil`(全 408 行)、`PoolSpine_v07.sil`(原型的基线)、`PoolSpine_v08_chunk.sil`(`maxChunkFee` 模式)、`PayoutShard.sil`(bshard 派彩,store-payout 零 mulDiv)。
- ✅ 实读设计稿 §8/§9 全文 + 红队 note MF-1(`docs/2026-08-09-i-design-redteam-note-feeish-overmatch.md`)。
- ✅ **重跑只读枚举器** `node scripts/fee-authority-enumerate.mjs`(纯静态,无编译)——数字见 §3。
- ✅ **机制演示 eval**:复制 `feeFamily()` 逻辑,证其按名字分家族(§3.1)。
- 🔴 **没做(遵指令)**:未运行 `fee-mutation-test.mjs`(它调 `silverc` 编译)、未改任何 .sil、未派生地址、未上链。⇒ 「参数进 redeem」这条我**引用 J1 的编译实测**,并**独立用机制推**(§2),不宣称自己复跑了编译。

---

## §2 主张 (a) — `marketMinFee`/`marketMaxFee` 进 redeem(被 P2SH 承诺)`[J1-reported + 机制独立推断]`

**J1 证据**(设计稿 §9.2,`fee-mutation-test.mjs` on pinned `silverc-legacy-2c46231.exe`):突变 `marketMaxFee`/`marketMinFee` ⇒ redeem 变;`brokerFeePct`/`oracleFeePct` 同次编译仍不变;controls(minerFee/deadline)4/4 全动。

**我的独立核**(不复跑编译):
- 二者在函数体 `refund_maker_unjoined` **被 `require` 实际引用**(`:404-405`)`[CONFIRMED·源码实读]`。
- C-2 已证「未被函数体引用的 ctor 参数被编译器丢出 redeem」(同测试 `market_id` SUBJECT 阳性 + broker/oraclePct 阴性双向坐实)。**被引用 ⇒ 存活**是该规则的正面,与 J1 的实测方向一致。
- ⇒ **(a) 成立**。作用域诚实:我**未**亲自编译核对 sha,亦未过 `pool-p2sh.mjs` 地址派生(与 J1 §8.4 同一未覆盖路径)。若要"零信任"复核,需在挖矿主机复跑 J1 的 mutation-test。

---

## §3 主张 (b)(c) — range 真夹住花费 + 枚举器判 `PER-MARKET(range)` `[CONFIRMED·源码实读 + 枚举器重跑]`

### (b) range 确实把花费夹进 [min,max] —— 成立

`:404-405`:
```
require(tx.outputs[0].value <= makerStakeAmount - marketMinFee);   // (A)
require(tx.outputs[0].value >= makerStakeAmount - marketMaxFee);   // (B)
```
设 **stake 折扣** `H = makerStakeAmount - tx.outputs[0].value`。(A) ⟺ `H >= marketMinFee`;(B) ⟺ `H <= marketMaxFee` ⇒ `H ∈ [marketMinFee, marketMaxFee]`。✅ 出口值被夹住,且形状是 v0.7 的**区间**(qlfpv 那种烤死单值卡 mempool 不会回来)。**(b) 成立。**

### (c) 枚举器判词 —— 我重跑,确实亮 `PER-MARKET(range)`

`node scripts/fee-authority-enumerate.mjs`(本机主树 7 个 PoolSpine)`[CONFIRMED·枚举器重跑]`:
```
POSITIVE CONTROL -- prototypes, excluded from every count above:
   PoolSpine_i_proto.sil::settle_aggregate      -> NO-FEE-CONSTRAINT
   PoolSpine_i_proto.sil::dispute_reveal        -> NO-FEE-CONSTRAINT
   PoolSpine_i_proto.sil::refund_maker_unjoined -> PER-MARKET(range)
   ✅ detector CAN see ctor-committed per-market bounds (1) => the zero above is a real zero
PER-MARKET(eq) ... : 0
🔴 ... does NOT bind the spend: 22/22
```
⇒ 判词**如 J1 所述**:range 亮、eq 仍 0、部署 spine 头条 0/22 不变。**(c) 字面成立。**

### 3.1 🔴 但 (c) 的判词是【按名字】给的,不是按【量】给的 —— MF-1 复发 `[CONFIRMED·机制演示]`

`feeFamily()`(`fee-authority-enumerate.mjs:79-85`)按**参数名**分家族。我复制其逻辑跑:
```
marketMinFee     -> market      ← 因名字含 "market"
marketMaxFee     -> market
brokerFeePct     -> market
oracleFeePct     -> market
refundMinFee     -> market
minerFeeMin      -> network     ← 同一种"费下界",改个名就翻成 network
chunkFeeMin      -> network
haircutMin       -> unknown
```
🔴 **同一个量(refund 出口的费下界),命名 `market*` ⇒ market ⇒ 计入 `PER-MARKET`;命名 `miner*` ⇒ network ⇒ 单列不计。判词随【名字】翻转,不随【它约束什么】翻转。**

而原型里那个量**就是网络费**——逐字证据:原型 `:404-405` 逐行替换了 v0.7 `refund_maker_unjoined` 的 `:395-396`:
```
v0.7:  require(tx.outputs[0].value <= makerStakeAmount - 50000);       // 50000 = MIN_FEE
       require(tx.outputs[0].value >= makerStakeAmount - 100000000);   // 1e8   = MAX_FEE
原型:  ... - marketMinFee / ... - marketMaxFee
```
而 v0.7 自己的注释(`:372-383`)逐字写:`settler picks fee dynamically based on real TX mass (= KIP-9 mass × mempool floor rate)`——**这个被替换的量是矿工/mass 网络费**。单位也对不上市场政策费率:`marketMinFee` 是**绝对 sompi**(从 stake 里减),`brokerFeePct` 是**基点 rate**(乘在池上,`validateInt(...,0,9999)`,见 `pool-p2sh-v07.mjs:49`)。**两个量,两种单位。**

🔨 **⇒ 判据**:枚举器该按**它约束的量**(是 `tx.outputs[..].value` 的费折扣 vs 是 `pot*bps/10000` 的政策费)分家族,而不是按参数名的子串。**否则任何把网络费界改名成 `market*` 的改动,都会在不碰 `brokerFeePct`/`oracleFeePct` 的情况下把头条从 0 抬起来——这正是 MF-1 要防的形状,换了个触发点又回来了。** 建议 J1/枚举器维护者:`feeFamily` 里对 `min|max|bound|floor|cap` + 无 `pct/bps` 的名字,不能仅凭 `market` 子串归 market;要么看它是否与 `pot*rate` 结构相连,要么把这类"绝对 sompi 费界"单列一档(如 `PER-MARKET-ABSOLUTE-FEE`)与政策 rate 权威区分。

---

## §4 对抗审:能不能付到界外?真的每市场吗?哪条出口漏了?

### H1 🔴🔴 最高优先:非法区间 ⇒ refund 恒 BUST ⇒ maker 本金永久锁死 `[CONFIRMED·源码实读]`

原型把 `[50000, 1e8]` 两个**常量**(永远 `50000 < 1e8`,永远有效)换成两个 **ctor 参数**,却**没加任何有效性守卫**。构造期若:
- `marketMinFee > marketMaxFee` ⇒ (A)∧(B) 要求 `H >= min ∧ H <= max` 且 `min>max` ⇒ **无解** ⇒ refund 永不可满足。
- `marketMaxFee >= makerStakeAmount`(结合 `>= 1000` dust):`makerStakeAmount - marketMaxFee <= 0`,若同时 `makerStakeAmount - marketMinFee < 1000` ⇒ (A) 要 `value < 1000` 而 dust 要 `value >= 1000` ⇒ **无解**。

`refund_maker_unjoined` 是**无人下注时 maker 取回本金**的唯一出口(deadline+2h grace 后)。它 BUST = **maker 的 stake 永久卡死链上**,且**没有任何东西在建市时报错**——非法区间静默烤进 P2SH,直到某天某个无人下注的市场想退款才显形。这是 `[[project-owner-settle-not-refund-orphan-permanent-loss-precedent]]` 那类永久损失的**新入口**。

- J1 §9.5 只把 `marketMinFee > marketMaxFee` 记作"未验的拒绝路径"。🔴 **我升级它**:不是"未验",是**当前原型缺一整类构造期守卫**;v0.7 用常量天然免疫,参数化把这个类打开了。
- 🔨 **修法**(仍在 (i) 的"被引用才进 redeem"框架内,加即承诺):函数体加 `require(marketMinFee >= 0); require(marketMaxFee >= marketMinFee); require(marketMaxFee < makerStakeAmount);`(第三条还顺带保证 `value > 0`)。**这三条本身也让区间界更强地被 P2SH 承诺**——非法市场根本 mint 不出同址。

### H2 真的每市场 vs 全局字面量? —— 每市场,J1 核心主张成立 `[CONFIRMED]`

`marketMinFee`/`marketMaxFee` 是 ctor 参数、被函数体引用、进 redeem(§2)⇒ 随 P2SH 承诺 ⇒ 改界必换地址,静默漂移结构上不可能。**对比 v0.7 的全局字面量 `50000`/`1e8`(每市场同值),这是真的每市场化。J1 这条对。**(只是对象是网络费,见 §3.1。)

### H3 付到 [min,max] 界外? —— 界夹的是"stake 折扣"不是"实际矿工费",但无盗取面 `[CONFIRMED·源码实读 + 推断]`

`inputs.length >= 1` 允许追加 fee-UTXO ⇒ `Σinputs = spineUTXO + 追加`。实际矿工费 `= Σinputs - tx.outputs[0].value = H + 追加`,**上不封顶**(maker 自己的钱补 mass)。∴ `[min,max]` 夹的**不是实际矿工费**,而是 **stake 折扣 H**(maker 本金被扣多少)。
- 这恰是经济上要防的量:第三方 settler 最多能把 maker 本金折扣到 `marketMaxFee`,且 `tx.outputs[0].scriptPubKey == makerLock`(`:397`)强制退给 maker 自己 ⇒ **无重定向盗取面**。
- ⚠ 但注意:`spineUTXO == makerStakeAmount` 这个前提我**未上链核**(refund_maker_unjoined 语义是无人下注,spine 只锁 maker stake)`[推断·未上链验]`。若有部分注入使 spineUTXO ≠ makerStakeAmount,`H` 与实际折扣的关系需 J2 用真 UTXO 值复核。
- **结论**:H3 无盗取面,与 v0.7 同构、非回归。但"界约束的是折扣不是实际费"这层语义,设计稿没点破,值得写清(以免有人以为它夹住了矿工费)。

### H4 🔴 覆盖缺口:唯一动的是 refund;政策费真正流出的 `settle_aggregate` 没碰 `[CONFIRMED·枚举器重跑 + 源码实读]`

- 原型 POSITIVE CONTROL 自证:`settle_aggregate -> NO-FEE-CONSTRAINT`、`dispute_reveal -> NO-FEE-CONSTRAINT`。
- `brokerFeePct`/`oracleFeePct` 在原型里**只出现在 ctor 声明(`:75-76`)+ 一句注释(`:87`)**,**任何 `require` 都不引用它们**(grep 全函数体零命中)。
- 而 **broker 政策费真正流出的地方是 `settle_aggregate` 的 `outputs[0]`**,当前仅 `require(tx.outputs[0].value >= 1000)`(dust 底,`:264`)——**没有任何东西把它绑到 `brokerFeePct`**。⇒ 恶意 4-of-5 委员可把 broker fee 输出设成任意 `>= 1000` 的值(少付/超付 broker),脚本层不拦。这是**真实资金安全洞**,且正是"市场政策费率零权威"在花钱侧的具体后果。
- ⇒ **原型把力气全下在 refund 的网络费上,而市场政策费率(broker/oraclePct)在它真正流出的出口上,权威仍是 0。** "(i) 把市场费率权威从 0 做到 >0"——**这份原型没兑现**;它兑现的是"refund 网络费从全局到每市场"。

---

## §5 挑战 J1 的"eq = 政策选择、会取消 qlfpv 浮动"框架(任务点 4)`[推断 + 交叉核 pool-shard-settle.mjs]`

J1(设计稿 §9.4)说:要 `PER-MARKET(eq)`,得加一条把承诺费率与 `tx.outputs[..].value` 用 `==` 拴起来的 require,**而那会取消 v0.7 有意保留的浮动(qlfpv)⇒ 这是政策选择,该 Owner 拍**。

🔵 **对一半,错一半——而错的那半又是把 qlfpv 约束按在了错的量上(同 §3.1 的病根):**

- ✅ **对 refund 的网络费折扣**:确实不能 `==`。那条出口的费是 mass 驱动的矿工费,pin 死单值 ⇒ 真 mass 高于它 ⇒ mempool reject ⇒ 卡死(qlfpv 就是这么发生的)。**在 refund 上,eq 是真两难。**
- 🔴 **对市场政策费率(`brokerFeePct`/`oracleFeePct`)**:它流出的出口是 **`settle_aggregate` 的 `outputs[0]`(broker fee),不是 refund**,而这个出口**没有 mass 浮动需求**。broker fee = `pot * brokerFeePct / 10000` 是**承诺费率 × 委员背书的池**的确定函数;矿工费在 settle 里是被**未绑定的 winner 输出(`outputs[6..]`,仅 sighash 背书)吸收**的,**不碰 broker 输出**。∴ 把 `outputs[0].value == pot*brokerFeePct/10000` 用 `==` 绑,**达到 `PER-MARKET(eq)` 且完全不触 qlfpv**。
  - 🔎 **交叉核**:链下已经就是这么算的——`pool-shard-settle.mjs:83` `bpsAmt = (bps) => pool * BigInt(bps||0) / 10000n`。即 eq 绑定的形状与链下现算法一致,不是新发明。
  - 🔎 枚举器会怎么判这条?我推演:`require(tx.outputs[0].value == (globalYes+globalNo)/10000*brokerFeePct)` ⇒ `analyzeLine` 拆出 `==`,lhs 有 `tx.outputs[0].value`(spend)、rhs 有 `brokerFeePct`(market 家族)⇒ `bindsSpend=true` ⇒ **`PER-MARKET(eq)`**。
  - 🎁 **附带闭掉 H4 那个洞**:eq 绑住 broker 输出 ⇒ 恶意委员改不了 broker fee 值。
- ⇒ **J1 的"eq 会取消浮动、是政策选择"这句,把 qlfpv 的约束从网络费搬到了市场费率身上——而更有价值的那个 eq(settle 的 broker 费)从来就不带 qlfpv 代价。** 真正的政策选择只在 refund 网络费上存在;市场政策费率的 eq 是"能做且顺带堵洞",不是两难。

**诚实边界(这半我没验实)`[推断·未上链/未编译]`**:
- **整数溢出**:`pot * brokerFeePct` 里 `pot<1e18`、`bps<=9999` ⇒ 积可达 ~1e22 > i64 上限 9.2e18 ⇒ **链上必须先除后乘** `(pot/10000)*brokerFeePct` 防溢出,而这与链下 `floor(pot*bps/10000)` 的**取整顺序不同**(差最多 `bps` sompi)。⇒ 要 `==` 成立,链下须**逐字节镜像链上的除-先顺序**(同 `global_commit_id` 单源 layout 那种纪律)。silverc 的 `/` 是 i64 floor(TUTORIAL:391 `a/b`),但**乘法溢出是 panic 还是 wrap 我没验**——留给 J2/NWT 实测。
- **`brokerFeePct == 0`(免佣市场)**:eq ⇒ `outputs[0].value == 0`,与 `>= 1000` dust 冲突 ⇒ 需 broker 输出结构对 0 费率变形(省掉该输出)。这是设计细节,不是阻塞。
- 我**没有**起草这条 .sil(遵指令),以上只是设计审阶段对"是否存在无 qlfpv 代价的绑定路径"的回答:**存在,在 settle 不在 refund。**

---

## §6 汇总 · 给 J1/协调者的可执行清单

| # | 发现 | 性质 | 判据 |
|---|---|---|---|
| §2 | `marketMin/MaxFee` 进 redeem | ✅ J1 主张成立 | J1 mutation-test + 被引用即存活;我未复跑编译 |
| §3(b) | range 把 `outputs[0]` 夹进 `[min,max]` | ✅ 成立 | 源码实读代数 |
| §3(c)/3.1 | 枚举器 `PER-MARKET(range)` 亮灯 | 🟡 字面成立**但判词按名字给**,量是网络费非政策费率 | 枚举器重跑 + `feeFamily` 机制演示(MF-1 复发) |
| §4-H1 | 非法区间 ⇒ refund BUST ⇒ 本金永久锁 | 🔴 **最高优先**·资金安全 | 源码实读:缺构造期守卫 |
| §4-H2 | 每市场化(vs 全局字面量) | ✅ J1 核心主张成立 | ctor 承诺进 P2SH |
| §4-H3 | 界夹的是 stake 折扣非实际矿工费 | 🔵 无盗取面·非回归,但语义须写清 | 源码 + 推断(spineUTXO 值未上链核) |
| §4-H4 | 只动 refund;`settle_aggregate` broker 政策费仍零权威 + 可被恶意委员乱付 | 🔴 覆盖缺口 + 资金安全 | 枚举器自证 NO-FEE-CONSTRAINT + grep |
| §5 | "eq=政策选择取消 qlfpv" | 🟡 对 refund 对、对市场费率错;settle 的 broker 费可 eq 且无 qlfpv | 推断 + `pool-shard-settle.mjs:83` 交叉核 |

**给 J1 两条主线**:
1. 🔴 **先补 H1 守卫**(`marketMinFee<=marketMaxFee<makerStakeAmount`)——这是纯资金安全,与费率口径无关,不该等 (i) 大方向拍板。
2. 🔵 **若 (i) 的目标真是抬 `brokerFeePct`/`oracleFeePct` 权威**(头条那个量),工作面在 **`settle_aggregate` 的 broker/oracle 费输出**,不在 refund;且那里可达 `PER-MARKET(eq)`、无 qlfpv 代价、顺带堵掉 H4 的恶意委员乱付。**当前原型改的 refund 网络费,不是那个量。**

**给枚举器维护者**:`feeFamily` 别只凭 `market` 子串把绝对-sompi 费界归 market(§3.1);否则"改个名就把头条从 0 抬起来"的路一直开着——MF-1 换个触发点就复发。

## §7 诚实标注(未验/我没做的)
- **未编译**:§2 的 redeem-survival 引 J1 实测 + 机制推,我没复跑 `silverc`(遵 read-only 指令)。零信任复核需在挖矿主机复跑 mutation-test。
- **未上链**:§4-H3 的 `spineUTXO == makerStakeAmount` 前提、§5 的溢出/取整顺序/`brokerFeePct==0` 分支,全是源码推断,**未用真 TX / 真 silverc 验**——J2/NWT 实测点。
- **silverc 溢出语义**(乘法 panic vs wrap)DECL/TUTORIAL 未明写,我未验。
- 我**未起草任何 .sil**;§5 给出的 eq 形状是设计审论证,不是交付物。
