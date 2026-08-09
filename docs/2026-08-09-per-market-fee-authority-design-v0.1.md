> **Status**: DRAFT v0.1 · **(i) 每市场费率:编进 redeem + covenant 强制 + 逐入口 + 机械验收** · DRI J1(J1tn) × 协调 Bettor × 红队 NWT/J2
> **来源**: Bettor 派工 `#ko7qla` / `#koahbq`(R-4 定案后立 (i) DoD 四条) · 承 ⑥ precond6 R-3(maker_fee_bps 四源全无权威) · J2 R-4 `#532e3e`
> **性质**: **design-only**。零改码 / 零链上 / 零 DB 写。本稿新增两个只读脚本(已入库)。
> **证据分级**: `[CONFIRMED·源码实读]` / `[CONFIRMED·工具枚举]` / `[强推断]` / `[未验]`

# (i) 每市场费率权威模型 — 设计 v0.1

## §0 一句话

> 🔴🔴 **v0.1 头条数字是错的,已按红队 MUST-FIX(`99f7eb7c`, KANet-UI)更正。原文保留在下方删除线里,不删。**

🔴 **全仓 22 个会动钱的 spine 入口里,能让【该市场承诺的费率】约束住【这笔交易实际花掉的钱】的 —— 一个都没有(0 / 22)。**

~~原文:21 个入口里只有 3 个(全在最老的 v0.5)真正绑定,其余 18 个……~~

🔴 **我错在把两个都叫 "fee" 的量当成了同一个**(在册 `[[reference-one-name-several-different-things]]`):
| | 是什么 | (i) 关心吗 |
|---|---|---|
| **市场费率** | `brokerFeePct` / `oracleFeePct`(基点, maker/oracle 政策费率) | ✅ **就是它** |
| **网络费** | `minerFee` / `maxChunkFee`(付给矿工的链上交易费, 烤进每个 covenant 实例的常量) | ❌ 另一个量 |

我用 `/fee/i` 一把抓所有含 fee 的 ctor 参数, 然后把**任何** `==` require 当作"市场费率绑定花费" ⇒
把 `require(tx.outputs[0].value == makerStakeAmount - minerFee)` 这种**网络费**绑定, 报成了**市场费率权威**。

✅ **红队的修法比"删掉误判"好**: `NETWORK-FEE(eq)` **单列**(共 4 处, v0.5 三条 refund + v0.6 refund) ——
**那些绑定是真实且有效的, 只是回答的是另一个问题。不是抹掉, 是归位。**

🔨 **⇒ 而这把结论推得更硬, 也更黑**: 不是"从 3 个退化到 0",
**是【每市场费率权威从来没有存在过】** —— v0.5 给人的"曾经有过"的印象, 正是我把网络费错认成市场费率造成的。
⇒ **(i) 不是"恢复曾经有过的东西", 是【从零建立一个从未存在的授权模型】。**
**这个措辞差别会改变排期时对工作量的判断, 所以必须写在头条。**

🔵 **而"退化"这个观察本身仍然成立, 只是对象换了** —— 退化的是**网络费**绑定:
v0.5/v0.6 的 refund 用等值 `== stake - minerFee`, v0.7 起换成全局字面量区间。
**退化是有意的**(为修 qlfpv 卡死事故), 所以 (i) 仍然不能简单"退回等值 require"。

---

## §1 作用域先纠一件事:**不是三版本,是七个**

派工写的是 "v0.5/v0.6/v0.7 三版本都过"。**仓库实际有 7 个 spine 合约** `[CONFIRMED·工具枚举]`:

```
PoolSpine.sil (v0.5) · _v06 · _v07 · _v0_7_1 · _v08_agg · _v08_chunk · _v08_shard
```

⇒ **按三版本写的验收会漏掉四个**,其中 `_v0_7_1` 和 `_v08_*` 恰好是费率模型**改动最大**的那几个。
承 `[[feedback_enumerating-tools-must-discover-not-remember]]`:清单要去发现,不许去记住。
📌 **本稿的枚举器不写死版本列表**,它扫 `PoolSpine*.sil`;新增合约自动进账。

---

## §2 现状底账(DoD ③ 逐入口)`[CONFIRMED·工具枚举 + 关键格源码实读]`

**复现**:`node scripts/fee-authority-enumerate.mjs`(只读;`--json` 出机器可读)

**判级(按"这个市场对自己的费率有多少权威"排序)**:

| 判级 | 含义 |
|---|---|
| `PER-MARKET(eq)` | ✅ 该市场承诺的费率**等值绑定**实际花费 |
| `PER-MARKET(range)` | 🟡 只对承诺值做 sanity range-check,**从不与实际花费挂钩** |
| `GLOBAL-LITERAL` | 🔴 花费**有**上下界,但界是**全局字面量**,与本市场承诺无关 |
| `NO-FEE-CONSTRAINT` | 🔴 什么都没有 |

**逐版本 refund 路的演进(承重)**:

| 版本 | `refund_maker_unjoined` | 逐字 |
|---|---|---|
| v0.5 | ✅ `PER-MARKET(eq)` | `:151 require(tx.outputs[0].value == makerStakeAmount - minerFee)` |
| v0.6 | ✅ `PER-MARKET(eq)` | `:285` 同形 |
| **v0.7** | 🔴 `GLOBAL-LITERAL` | `:394-395` `<= makerStake-50000` / `>= makerStake-100000000` |
| v0.8(agg/chunk) | 🔴 `GLOBAL-LITERAL` | 同形 |
| v0.7.1 | 🔴 `GLOBAL-LITERAL` | 且 **ctor 里连 `minerFee` 都没有了** |

🔴 **`dispute_reveal` 在【全部】版本上都是 `NO-FEE-CONSTRAINT`** —— 这正是 J2 挂给我的作用域缺口,
现已覆盖:**它不是"可能被别的 require 间接夹住",是那段函数体里根本没有任何 `tx.outputs[i].value` 约束**
(v06 `:249-276` / v07 `:345-380` 全文实读,结尾只有 `inputs>=1` / `outputs>=1`)。
⇒ **`dispute_reveal` 那条花钱路,费用完全不设防**,与 ST-05 §3.1 记的"它是独立花钱入口需单独对抗性审查"是同一件事的两面。

**汇总**:🔴 **22 / 22 个动钱入口, 本市场承诺的费率管不住这笔花费**(v0.1 误报为 18/21, 见头条更正)。
🔵 另有 **4 处 `NETWORK-FEE(eq)`**(`PoolSpine.sil` 三条 refund + `_v06` refund): **真实绑定, 但绑的是 minerFee 网络费, 不是市场费率。**

---

## §3 🔴 最该被看见的一条:**退化是有意的,而理由仍然成立**

不能把 v0.7 读成"有人偷懒删了约束"。源码注释逐字写着 `[CONFIRMED·源码实读]`:

> `// v0.7 红线 8: fee 范围 [MIN_FEE, MAX_FEE] not hardcoded ctor minerFee.`
> `// qlfpv 教训 (2026-06-01): hardcoded minerFee=50000 < real mass-fee 442000 → mempool reject → 100 KAS effectively bricked.`

⇒ **v0.6 那个漂亮的等值 require 是【脆】的**:烤死的费一旦低于真实 mass 费,交易永远进不了 mempool,
**那笔钱就永久卡死** —— 已经真金白银发生过一次。

🔨 **所以 (i) 的真问题不是"等值 vs 区间",是【区间的边界由谁承诺】。**
v0.7 做对了"给费率留浮动空间",做错的是**把浮动边界写成了全局字面量**,
于是每市场费率的权威被顺手丢掉了 —— **一个修 bug 的动作,顺带删掉了一个授权模型,而没人记账。**

---

## §4 (i) 设计:**边界本身每市场化**

**核心一句**:保留区间(治脆),但**把区间的上下界做成 ctor 承诺的每市场值**(治无权威)。

```
// 目标形态(示意,非最终 .sil)
require(tx.outputs[0].value <= makerStakeAmount - marketMinFee);   // marketMinFee: ctor 参数
require(tx.outputs[0].value >= makerStakeAmount - marketMaxFee);   // marketMaxFee: ctor 参数
```

🔵 **这不是从零发明 —— v0.8 已经走了一半** `[CONFIRMED·源码实读]`:
`PoolSpine_v08_chunk.sil` 的 ctor 已有 `maxChunkFee`,`:261 require(chunkMinerFee <= maxChunkFee)`,
注释自陈「部署 = V07_MAX_FEE=1e8 单源」。
⇒ **(i) = 把 v0.8 这个模式(上界烤进 ctor)推广到【上下界 + 所有动钱入口】**,而不是新造一套。

🔴 **它同时消掉 J2 抓的"两个 1e8 靠约定相等"**:
链下 `MAX_TX_FEE_SOMPI=1e8`(`kip9-mass.mjs:33`) 与链上 `require(minerFee<1e8)`(`v07:285`) 是两处独立常量,
**谁调高链下那个,链上不会有任何东西发现**。边界一旦变成每市场 ctor 值,
**它就随 P2SH 被承诺**,改了必然换地址 = 静默漂移在结构上不可能。

---

## §5 DoD 四条逐条兑现

| DoD | 本稿如何满足 | 状态 |
|---|---|---|
| ①**编得进** | 费率必须在 **.sil 函数体内被引用**才会进 redeem;验收=变异测试改费率→redeem 必变 | ✅ **已实测**(见 §8) |
| ②**绑得住** | §4 形态:界为 ctor 值 + `require` 直接夹 `tx.outputs[].value` = 约束落在**实际花费**上,非只 check 承诺值 | 设计已定 |
| ③**逐入口** | `scripts/fee-authority-enumerate.mjs` 逐 entrypoint 出判级,**指不出约束行的入口即报** | ✅ **已实现并跑出 18 个洞** |
| ④**验得出** | 枚举器 + 变异测试脚本入库,**不靠人记得**;新增合约自动纳入(不写死版本表) | ✅ 枚举器已入库;变异测试见 §7 |

---

## §6 🔴 工具自身的一条自纠(留着,因为它正是这类工作最容易犯的错)

枚举器**第一版把 v0.7 的 refund 报成了 `NO-FEE-CONSTRAINT`** —— 而它其实有约束,只是用了全局字面量。
若照那版写稿,结论会变成"v0.7 少了个检查"(⇒ 去加个 require 就完事),
**而真实缺陷是"授权模型错了"(⇒ 要改 ctor 与所有入口)**。**两者导出的工作量差一个数量级。**
🔨 ⇒ 判级里 `GLOBAL-LITERAL` 这一档是**必须存在**的:
**"有没有检查"和"这个市场说了算没有"是两个问题,而前者读起来很像后者。**

---

## §7 未决 / 不写成已知

- ✅ **DoD ① 已实测,见 §8** —— 此前三份稿子(本稿 v0.1 初稿 / ST-02 第 4 项 / ⑥ v0.2.1 C-3)都把它写成
  "本机 pin 的 silverc ENOENT ⇒ 跑不了"。**那个阻塞判断是错的**:pin 的编译器**在挖矿主机上一直存在**,
  我只是一直在错的机器上找。🔨 **判据教训:"我这台没有"不等于"我们没有"——说"跑不了"之前要先枚举【所有】机器。**
- **`dispute_reveal` 的花费到底由什么夹住** —— 本稿只证了"该入口内零 `outputs[].value` 约束",
  **没有**核它在实际构造时是否被链下逻辑或别的 require 间接限制。**别替我外推成"任意金额可花"。**
- **v0.8 三件套的部署状态未查**(哪些在飞、哪些只是源码),(i) 的落地顺序取决于此 ⇒ 需 J2/Bettor 给口径。
- **存量盘不可补救那条不变**(⑥ R-3):redeem 建市即烤死,本设计只对**新市场**成立。


---

# 🆕 §8 DoD ① 实测结果 `[CONFIRMED·实测]`

**编译器**: `D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe`(**生产 pin 的那把**,在挖矿主机上)
**复现**: `node scripts/fee-mutation-test.mjs`(只读;`FEE_MUT_LIB` / `SILVERC_LEGACY_PATH` 可覆盖)
**判据**: 直接比 **redeem script**(P2SH = blake2b(redeem) 是确定性函数 ⇒ redeem 变 ⟺ P2SH 变)。

| 合约 | 字段 | 角色 | 结果 |
|---|---|---|---|
| v0.6 (redeem 1946B) | `oracleFeePct` | SUBJECT | 🔴 **UNCHANGED ⇒ 不在 redeem** |
| v0.6 | `brokerFeePct` | SUBJECT | 🔴 **UNCHANGED ⇒ 不在 redeem** |
| v0.6 | `minerFee` / `deadline` | CONTROL | ✅ / ✅ 都变 |
| v0.7 (redeem 2135B) | `oracleFeePct` | SUBJECT | 🔴 **UNCHANGED ⇒ 不在 redeem** |
| v0.7 | `brokerFeePct` | SUBJECT | 🔴 **UNCHANGED ⇒ 不在 redeem** |
| v0.7 | `market_id` | SUBJECT | ✅ **changed ⇒ 确实烤进 redeem** |
| v0.7 | `minerFee` / `deadline` | CONTROL | ✅ / ✅ 都变 |

**baselines 2/2 · controls 4/4 全部移动** ⇒ 未变的 SUBJECT 是**编译器的真实行为**,不是死 harness。

## §8.1 这把 ⑥ v0.2.1 的 C-2 从 `[强推断]` 升为 `[CONFIRMED]`

C-2 断言「未被函数体引用的 ctor 参数会被编译器丢出 redeem」⇒ **v0.6/v0.7 双版本实测成立**。
⇒ **`brokerFeePct` / `oracleFeePct` 不被 P2SH 承诺** ⇒ 对这两个字段,
「该市场承诺了这个费率」这句话**在密码学上是假的** —— 不是"没强制",是**根本没承诺**。
⇒ 与 §2 的 `GLOBAL-LITERAL` / `NO-FEE-CONSTRAINT` 合起来看:
**费率既没被承诺(编不进),也没被强制(入口不 require)。(i) 必须同时补这两半,补一半等于没补。**

## §8.2 🔵 顺带证实一条资金安全修复**是真生效的**

`market_id` 是在册 NWT FINDING-2 里「未用参数被丢弃 ⇒ 资金混同」的那个字段。
v0.7 把它加进 ctor,**实测它确实进了 redeem** ⇒ **那条修复不是纸面的。**
🔨 值得记的是方法:**同一个测试同时给出一个坏消息和一个好消息**,
因为它测的是**机制**(参数存活与否),不是某个预设结论。

## §8.3 阳性对照为什么不可省(本次真的救了场)

第一版 harness 有一个洞:`let controlsOk = true`,**编译全失败时它照样打印"controls OK"** ——
**"全部通过"与"一次都没跑"输出完全相同**。改成计数(`controlsRun` / `controlsMoved`)后,
那次失败运行如实打出 `NO CONTROL EVER RAN -- this run proves NOTHING`。
🔴 **这正是本稿反复在防的形状,而我自己的验收脚本第一版就犯了。**

## §8.4 作用域(不说满)

- 只测了 **v0.6 / v0.7** 两个合约。其余五个(v0.5 / v0_7_1 / v08×3)**未测**。
- 走的是 **silverc + ctor JSON** 这条路,**未**经过 `pool-p2sh.mjs` 的地址派生
  (那步 `await import('kaspa-wasm')` 在挖矿主机解析不到:三个 `node_modules/kaspa-wasm` 都是空壳,
  只有 `shared/vendor` 是真的)。⇒ **编译器与 ctor 序列化与生产同,地址派生代码路径未覆盖。**
- 用的是 pin 的 legacy 编译器。**换编译器就是换实验**(该树另有 `silverc-zk-8065184.exe`)。

---

# 🆕 §9 (i).sil 原型:**可构造性已证**,而它同时暴露了一条会改变 (i) 含义的事 `[CONFIRMED·实测]`

## §9.1 原型做了什么(`01eb8f3d` · `kasia-console/src/lib/PoolSpine_i_proto.sil`)

取 v0.7,把 refund 路那两个**全局字面量**换成**ctor 承诺的每市场界**,函数体真的引用它们:

```
v0.7:   require(tx.outputs[0].value <= makerStakeAmount - 50000);
        require(tx.outputs[0].value >= makerStakeAmount - 100000000);
原型:   require(tx.outputs[0].value <= makerStakeAmount - marketMinFee);
        require(tx.outputs[0].value >= makerStakeAmount - marketMaxFee);
```

**形状保留 v0.7 的区间**(qlfpv 那次卡死不会回来)——**变的只是"谁来承诺这个区间"**。

## §9.2 在生产 pin 的编译器上突变实测(`silverc-legacy-2c46231.exe`)

```
marketMaxFee 改动 → redeem 变        ✅ 真的进了 baked-in
marketMinFee 改动 → redeem 变        ✅
brokerFeePct / oracleFeePct → 不变   🔴 同一次编译里, 依然被编译器丢弃
controls (minerFee/deadline) 4/4 全动 ✅ 不是死 harness
```

🔴 **阴性对照与阳性同等重要**:同一次编译中,那两个"声明了但没人引用"的费率参数**仍然缺席**。
⇒ **进 redeem 不是白给的,是靠【被函数体引用】换来的**——这正是 §3 那条退化的机制层解释。

## §9.3 一个我差点当成故障归档的读数

原型 baseline 与 v0.7 **逐字节相同**,看起来绝不可能。原因是我挑的基线值正好等于 v0.7 的字面量
(50000 / 100000000),编译器把 ctor 常量**内联到了字面量原来的位置**。
⇒ **这不是故障,是第三条证据**:committed 值落在字面量占据的同一位置。
🔨 **判据**:一个"太整齐"的读数先问它是不是**实验设计本身造成的**,再判它是故障。

## §9.4 🔴 而阳性对照顶掉了本稿一个隐含前提:**(i) 给的是【区间授权】,不是【绑定】**

跑 enumerator(修复后,`45891f24`)对原型:

```
PoolSpine_v07.sil::refund_maker_unjoined      -> GLOBAL-LITERAL
PoolSpine_i_proto.sil::refund_maker_unjoined  -> PER-MARKET(range)     ← 不是 (eq)
部署 spine 头条仍 0/22(逐 entrypoint 判词零差异)
```

🔴 **DoD ③ 问的是「**这个市场承诺的费率**是否【绑定】这笔花费」——而 `range` 只是【框住】它。**
在 `marketMinFee` 与 `marketMaxFee` 之间,**实际收多少费仍然不由承诺值决定**。

⇒ **(i) 如本原型所构造,把权威从「全局常数」搬到了「本市场承诺的区间」,这是真进步;**
   **但它【没有】把 DoD ③ 那个洞补到 `PER-MARKET(eq)`。**
⇒ 若 DoD ③ 要的是绑定,还需要一条把**承诺费率本身**与 `tx.outputs[..].value` 用 `==` 拴起来的 require,
   **而那会取消 v0.7 有意保留的浮动(qlfpv)** —— **这是个政策选择,不是实现细节,该由 Owner 拍。**

## §9.5 作用域(不说满)

- 原型**只改了 refund 一条路**;其余 entrypoint 未动(仍 `NO-FEE-CONSTRAINT`)。
- **原型没接进任何 builder、没部署、不能用它建市场。** 它回答"造得出来吗",不回答"该不该上线"。
- 未验:多市场同时存在时 P2SH 分叉对既有 outpoint 的影响;`marketMinFee > marketMaxFee` 这类构造期无效区间的拒绝路径。
