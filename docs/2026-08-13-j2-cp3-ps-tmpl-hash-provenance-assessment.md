# CP3 provenance 评估：`ps_tmpl_hash` 能不能绑模板身份

> **Status**: CURRENT（评估部分）· 🔨 **§4/§6 的"改法/骨架"部分已被实现取代，见下方状态注记**
> J2 · 2026-08-13 · 应 @Bettor 20:43Z 驱动令（20 分钟内 git 报一条）
> 作用域：**源码实读**（silverc `compile.rs` codegen + `RefundClaim.sil` 调用点 + `pool-refund-builder.mjs`）。**未跑链上实验。**

> 🔨 **状态注记（2026-08-13 21:3xZ · 本文原写"未落码"，那句现在是假的）**
> **已落码并 push**：`156598fc`（`computePoolRootArtifact()` + builder 换权威/单步跨边界认证）
> ＋ `f06beeb9`（换票腿闭合格 + 真 PoolSide 负例 fixture）。
> ⇒ **§4「改法（三步）」与 §6「具体三步」是【提案时的形态】，不是落地形态**——
> 中途经 @J1tn (205) 升级（单步 hash 比，覆盖 suffix）+ (209) framing 修正（禁写"hash 钉切分"），
> 落地形态与它们**不同**。**要看真做了什么，读那两个 commit，别读这两节。**
> 🔵 本文保留提案原文不改，是因为它记录了**判断怎么走到那一步的**（含我被纠正的两处）；
> 但**任何"当前状态"的问题，本文都不是权威** —— 权威是代码 + `docs/iteration/COORD-LEDGER.md`。
> **仍未闭合**：待 @NWT 红队 + Codex 两道 gate；结构性 MISSED=2 仍在，报告不闭格。

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

## §6 对 @Bettor 20:47Z 修法的确认 + 一处必须改的绑腿（设计报审）

**原则我同意**：删掉松散的 `poolTemplatePrefixHex` 串，改绑**已自验的 artifact**。
Codex 抓的那点成立——松散串 + `startsWith` 只证「调用方回传了首字节」，不证它来自被 `ps_tmpl_hash` 认证的模板。

🔴 **但修法里写的绑定对象是错腿，照做会引入 CP1 那个资金锁死族的缺陷**：

> 修法原话：「用 witness 携带的 verified prefix_len(**源自 psArtifact**，已在 :47-49 对 ps_tmpl_hash 自验)」

- `psArtifact` = **PoolSide（票）**模板 —— `bshard-e2e-flow.mjs:37` 用它拼 **ticket** redeem。
- `poolTemplatePrefixHex` 要描述的是 **PoolRoot（池）**模板 —— 同文件 `:114` 用 **`rootArtifact`** 拼 **pool** redeem。

⇒ 这是**两份不同的模板**。拿票腿的 `prefix_len` 去当池腿 redeem 的 `state_start`，
就是**用 A 模板的权威去定 B 模板的 offset**。`:47-49` 那道自验再严，验的也是**票**那份。

~~🔴 **而这个错的最坏形态是它今天可能【不报错】**：若两个长度当前恰好都等于 1……~~

🔨 **上面这句已按实测收窄（2026-08-13 · 我自己的警报缩小，不是别人纠的）**：
两个长度**我当时没实测**就写了"可能都等于 1"的谨慎分支。后来为补负例夹具真编了两份，实测是
**池腿 `start=1`、票腿 `start=0` —— 不相等** ⇒ 绑错腿**会被族断言当场喊出来，不会静默**，
**不属于**「语法合法、资金锁死、全程不报错」那一族。
🔵 **设计结论不变**（仍不该绑错腿），但风险等级要按实测记，别沿用我那句更吓人的措辞。
现已有一格用例把它钉住：两腿 `start` 必须不等——哪天相等了，就真的退回静默那一族。

### 改法（保住修法的意图，换对腿）

**绑 `rootArtifact`，不绑 `psArtifact`。** 但**我先撤回自己上一稿的一句**：

> ~~池腿**已经有**完全同款的机制，不用新造。~~ —— **错**。@KANet-UI 20:49Z 说得对，两腿**不同款**。

实读 `pool-bshard-market-setup.mjs:50-56`：

```js
const rootCompiled = compileSil(poolRootSilPath, rootCtor, silvercPath);
const rsl = rootCompiled.state_layout;
const rootPrefix = rootRedeem.slice(0, rsl.start), rootSuffix = rootRedeem.slice(rsl.start + rsl.len);
const rootTmplHash = blake2b(rootPrefix ‖ rootSuffix)          // ← JS 本地算的
const rootArtifact = { templatePrefix: rootPrefix, templateSuffix: rootSuffix, templateHashHex: rootTmplHash };
```

- 票腿：`templateHashHex` 由 **silverc 吐出**（`extractTemplateArtifact(...).expectedTemplateHashHex`）。
- 池腿：`templateHashHex` 是 **JS 现算的** `blake2b(自己切出来的两段)`。
  ⇒ 拿它去做「自验」会是**自己跟自己比**，比票腿那道更空。**照抄票腿的形状到池腿是错的。**

🔵 **而实读顺出一个比两边提案都更根的东西 —— 池腿的权威根本不用造，编译器已经吐了**：

**`rootCompiled.state_layout.start`** 就是 silverc 对这份 PoolRoot 给出的 state 起始 offset，
而上面那行 `rootRedeem.slice(0, rsl.start)` 意味着 **`rootPrefix.length ≡ rsl.start` 恒等**。

⇒ CP2 费力从「模板前缀长度」派生出来的那个 `state_start`，**它的上游权威一直在 `state_layout.start`**。
   CP2 的派生**不是错的**（两者恒等），但它比真正的权威**远了一跳**，
   而那一跳正好落在「构造方自觉传对前缀」上 —— 也就是 Codex 抓的那个松散点。

具体三步（修正版）：
1. `buildRefundCommand` 收 **PoolRoot 的编译产物**（`{ script, state_layout }` 或包一层 `computePoolRootArtifact()`，
   与 `computeSpineArtifact()` 同规格），删掉松散的 `poolTemplatePrefixHex`。
   —— 这正是 @KANet-UI ② 说的"给 PoolRoot.sil 写一个 compile-time artifact 函数"，**我同意，且它是必需的不是可选的**。
2. `state_start = state_layout.start`（**编译器权威，零跳**），不再从前缀长度反推。
3. 保留并加强现有绑定：`poolRedeemHex` 必须以 `script.slice(0, start)` 开头 **且** 长度等于 `script.length`
   —— 把「编译器说的那份模板」绑到「这一份会上链的 redeem」上。
   🔵 这一步替代了原来的 `startsWith(松散串)`：**前缀不再是调用方给的，是编译产物给的**。

⚠ **§4 那个跨边界比对（对链上烤死的 `root_tmpl_hash`）仍然要做**，且现在更清楚了：
`root_tmpl_hash` 被烤进 **PoolLeaf ctor**（`:40-41` 注释：seal_to_root 的 foreign-template anchor），
⇒ 那是**另一端**的值，拿它和本次编译产物比才跨得过边界。而**池腿现在这个 JS 自算的 hash 比不出任何东西**。

### 同批测试（否则又是没人观察的接缝）
- 变异「把池腿的产物换成票腿的（`rootCompiled` → `psArtifact`）」⇒ **必须变红**。
  这是本节的核心断言 —— 它正是 20:47Z 修法里那处绑错腿，没有这一格等于没防住它。
- 变异「`state_start` 改回从前缀长度反推」⇒ 应当**抓不到**（两者恒等）。
  🔵 **这一格要预注册为结构性 MISSED**，别当漏网：和 CP2 那两条同源 ——
  **权威与其等价式在数值上不可分**，可分的只有「取值来源」这件事本身。
- 变异「跳过对烤死 `root_tmpl_hash` 的跨边界比对」⇒ 必须变红。
- fail-closed：编译产物缺失 / redeem 与 `script` 不一致 / 长度不符，三格分别抛。

⚠ **未落码**，等 @Bettor 审这版绑腿后再动；照 CP2 的规矩**一批做完**（生产 + 测试 + 变异同批）。
