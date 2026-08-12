# CP3 provenance 评估：`ps_tmpl_hash` 能不能绑模板身份

> **Status**: CURRENT
> J2 · 2026-08-13 · 应 @Bettor 20:43Z 驱动令（20 分钟内 git 报一条）
> 作用域：**源码实读**（silverc `compile.rs` codegen + `RefundClaim.sil` 调用点 + `pool-refund-builder.mjs`）。**未跑链上实验。**

## 结论（先给答案）

**能绑，而且退款轨的 witness 侧【已经是】CP2 刚给 pool 侧立的那个形状** —— 但**有一条它绑不住的东西，必须显式说出来**，否则下一个人会把它当成比实际更强的保证。

| 问 | 答 |
|---|---|
| `ps_tmpl_hash` 能绑「哪一份模板」？ | ✅ 能。它是 `blake2b(prefix ‖ suffix)`，钉死模板字节内容。 |
| 能顺带钉死 `prefix_len + suffix_len`？ | ✅ 能，但**不是它自己钉的**（见下方 §2，是 P2SH 那道钉的）。 |
| 能钉死**切分点**（= state 窗口的 offset）？ | 🔴 **不能**（见 §3）。这正是 CP2 在 pool 侧踩的同一个坑的镜像。 |
| 现做还是耦合接线？ | **现做**。`buildRefundWitness` 已在做自校验，缺的是**校验对象换一个来源**（§4），改动落在 console 侧一个函数，不动链上、不动 relay。 |

## §1 原语的真实语义（silverc `compile.rs:1874-1892`，非推断）

```
script_size     = template_prefix_len + encoded_state_len(layout) + template_suffix_len
prefix          = input_sigscript[script_base .. script_base + template_prefix_len]
suffix          = input_sigscript[script_base + prefix_len + state_len .. + suffix_len]
actual_template = prefix || suffix
require blake2b(actual_template) == expected_template_hash
```

两件必须讲清的：

- **`state_len` 是布局定死的编译期常量**，*不*由 witness 选 ⇒ **state 窗口的宽度钉死**。
- **`prefix_len` / `suffix_len` 是 witness 传的**（`RefundClaim.sil:54` 就是这么调的）⇒ 它们是**调用方可选的量**。

## §2 `prefix_len + suffix_len` 的和被谁钉住

不是被模板哈希钉的，是被**另一道**钉的：codegen 在比完模板哈希之前，先把
「按 `script_size` 重建出来的脚本」的 P2SH 与**该 input 实际的 `scriptPubKey`** 做 `OpEqual`+`OpVerify`。
⇒ 重建长度必须等于真实 redeem 长度，否则 P2SH 对不上。
⇒ **`prefix_len + suffix_len ≡ 真实redeem长 − state_len`，和被钉死。**

🔵 值得记一笔：**「模板哈希钉住了长度」这句话是错的** —— 钉长度的是 P2SH 那道。
两道闸挨着，很容易把功劳记到后一道身上，然后在没有 P2SH 那道的场合照抄。

## §3 🔴 它绑不住的那一件：切分点

和被钉死，**但怎么切没有被钉死**。把 `prefix_len` 挪 δ、`suffix_len` 反向挪 δ，和不变、P2SH 那道照过，
而 **state 窗口整体平移 δ** ⇒ 原语会把**另一段字节**当作 `bettorPk/direction/stake/shardPoolId` 读出来。

平移之后模板哈希还对不对，取决于 `prefix‖suffix` 这个拼接在平移下**是否恰好不变**——
也就是取决于**模板字节自身有没有那种自相似**。一般模板没有，所以**今天是对的**；
🔴 但它对的方式是**「碰巧对」——依赖被测对象的字节形状，而不是结构上不可能**。
（在册同族：*correct-by-accident-depends-on-the-other-side-not-changing*。）

🔵 **本文不给构造方法**，也不评估可利用性：origin 是公开的，commit 即发布。
需要可利用性分析的话走**最窄通道**单独提，不在这份文档里、不上频道（频道本身是链上明文）。

## §4 设计骨架（现做，改一个函数）

`buildRefundWitness()` **今天已经在自校验**：
`blake2b(psArtifact.templatePrefix ‖ psArtifact.templateSuffix) == psArtifact.templateHashHex`，
并且 `ticket_prefix_len` / `ticket_suffix_len` **是从 buffer 长度派生的、不是申报的** ——
这正是 CP2 刚在 pool 侧立起来的形状，**ticket 侧本来就是对的**。

🔴 **缺的那一格（措辞已按 @KANet-UI 20:45Z 线索修正——我第一稿写"来自 artifact 自己"，那是错的）**：
`templateHashHex` **不是** artifact 自报的字段，它是 `computePoolSideArtifact()` 里
`extractTemplateArtifact(compileSil(sil, ctor))` 的 `expectedTemplateHashHex` ——
**silverc 编译期从 `.sil`+ctor 算出来的**，确实已是 typed 绑定形态。KANet-UI 这条纠得对。

**而那一格仍在，只是理由要换成准确的那个**：这道自校验的**两边来自同一次编译** ——
左边 `blake2b(prefix‖suffix)` 用的是该次编译吐出的 prefix/suffix，右边是**同一次**编译吐出的 hash。
⇒ 它证明的是「**silverc 这次输出内部自洽**」，**不是**「这次编译 == 链上那份 covenant 里**烤死的** `ps_tmpl_hash`」。
换个 `.sil` 版本或换组 ctor，两边**一起**变，自校验**照过**。
（在册同族：**共享来源的佐证是空的**，哪怕两边的计算逻辑各自独立。）

🔵 且链上这条绑定链**本来就存在**、我原稿漏了：`pool-bshard-artifacts.mjs:146`
把 `spine.templateHashHex` 作为 ctor 参数烤进 PoolSide ⇒ PoolSide **已经**被钉到本 market 的 spine 上。
⇒ 缺的不是「有没有绑定链」，是**构造侧有没有拿链上那一端的值做过一次独立比对**。

方向是 fail-closed 的（对不上就是花的时候被 covenant 拒）⇒ **不是资金风险**，
是**一笔白费的 tx + 一个查起来很远的错**。

**改法（三步，都在 console 侧）**：
1. `buildRefundCommand` 已收 `poolTemplatePrefixHex`；同法**再收一个 `expectedPsTmplHashHex`**，
   来源必须是**该 pool/root redeem 里烤死的那个 ctor 常量**（拼这份 redeem 的人手上就有它，
   同 CP2 的前缀），**不能**是同一次 `compileSil()` 的输出——否则又是两边同源。
2. 比 `psArtifact.templateHashHex === expectedPsTmplHashHex`，不等即 fail-closed 拒。
   判据一句话：**这个比较有没有跨过"编译产物"与"链上烤死值"的边界**。跨了才有信息量。
3. **同批**加：① 该断言的 fail-closed 用例；② 变异打**第 1 步取值那一行**
   （把来源换回 artifact ⇒ 必须变红）。否则又是一道没人观察的接缝。

⚠ **CP2 的作用域注在这里同样成立**：这一步绑的是**模板身份**，**不解 §3 的切分点**。
两件事别混：身份对了，窗口仍可平移。§3 要单独一格（钉 `ticket_prefix_len` 与构造用前缀长度相等），
和 CP2 在 pool 侧做的是**同一个动作**，只是换到 ticket 腿。

## §5 卡点 / 我没做的

- **未跑链上实验**：§3 的平移在 TN12 上会发生什么，我没实测（且现在**也跑不了** ——
  节点 `RPC node is not synced`，KANet-UI 20:45Z 已答本机域穷尽、实旋钮在共识层归 Owner）。
  ⇒ §3 目前是**源码推演级证据**，标签就该按这个记，别当实测。
- **未落码**：本文是评估 + 骨架，**没有动任何生产文件**。落码要 @Bettor 排（且 §4 落在钱路）。
