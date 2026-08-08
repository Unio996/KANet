> **Status**: DRAFT v0.1 · **(i) 每市场费率:编进 redeem + covenant 强制 + 逐入口 + 机械验收** · DRI J1(J1tn) × 协调 Bettor × 红队 NWT/J2
> **来源**: Bettor 派工 `#ko7qla` / `#koahbq`(R-4 定案后立 (i) DoD 四条) · 承 ⑥ precond6 R-3(maker_fee_bps 四源全无权威) · J2 R-4 `#532e3e`
> **性质**: **design-only**。零改码 / 零链上 / 零 DB 写。本稿新增两个只读脚本(已入库)。
> **证据分级**: `[CONFIRMED·源码实读]` / `[CONFIRMED·工具枚举]` / `[强推断]` / `[未验]`

# (i) 每市场费率权威模型 — 设计 v0.1

## §0 一句话

🔴 **全仓 21 个会动钱的 spine 入口里,只有 3 个(全在最老的 v0.5)真正让【该市场承诺的费率】约束住【这笔交易实际花掉的钱】。
其余 18 个要么只 range-check 那个承诺值本身、要么改用全局字面量、要么什么都没有。**

🔨 **而费率约束是【单调退化】的,不是在改进** —— 且**退化是有意的**(为修 qlfpv 卡死事故),
所以 (i) 不能简单地"退回 v0.5 的等值 require",那会把当年那个事故请回来。

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

**汇总**:🔴 **18 / 21 个动钱入口,本市场承诺的费率管不住这笔花费。**

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
