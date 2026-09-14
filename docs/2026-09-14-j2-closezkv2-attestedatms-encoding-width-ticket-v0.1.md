> **Status**: DRAFT-FOR-REVIEW v0.1

# T-CLOSEZK-ATMS-WIDTH — `CloseZkV2.sil` `attestedAtMs` 变长编码风险票 v0.1

**范围**：docs-only，不落码（Bettor 1291 派工）。这是本 session 早前
`docs/2026-09-14-j2-ctor-int-encoding-width-probe-v0.1.md` 结尾标记、明确排除在那次范围外的独立风险——
本票专门处理它：现状、结构性修法选项、每个选项的影响、推荐项与验收标准。

## 1. 现状（读源码逐行核实，不是推测）

`computeCloseZkTmplAnchor`（`pool-shard-register.mjs`）：

```js
// dummyAtMs 必须落在 J2 实测的稳定值域 [2^40, 2^47) 内(同 PayoutShardV2.sil zk_handoff 的 bounds guard)，
// 否则 minimal-push 变长编码会让模板切分点跟真实 market 用的值对不上。用一个具体真实量级(非边界值)。
const dummyAtMs = 1783500000000;
...
const atMsBuf6 = Buffer.alloc(6); atMsBuf6.writeUIntLE(dummyAtMs, 0, 6);
const atMsMarkerAndData = Buffer.concat([Buffer.from([6]), atMsBuf6]);
```

`CloseZkV2.sil` 声明 `int attestedAtMs`（ctor 参数，**不是** `PayoutShard.sil`/`PayoutShardV2.sil` 那种
用 `byte[](8 as byte[1]) + byte[](x as byte[8])` 显式定宽序列化的 state 字段——本 session 早前的矩阵实测
（`2026-09-14-j2-ctor-int-encoding-width-probe-v0.1.md`）只覆盖了 `PayoutShard`/`PayoutShardV2` 两个文件，
`CloseZkV2.sil` 从未测过，也**不适用**同一个结论），直接用在 `require(tx.time >= temporal(attestedAtMs +
21600000))`——一个**算术表达式**里，不是纯字面量比较。

`1783500000000` 落在 `[2^40=1099511627776, 2^47=140737488355328)` 区间内，编码需要恰好 6 字节
（这不是巧合——这个区间本身就是"用 minimal-push 编码恰好需要 6 字节"的数值范围，2^40 是 6 字节能表示的
下界，2^47-1 是上界）。**这个假设"成立"完全依赖另一处独立代码**：`readPayoutShardV2AttestedState`
（`bshard-close-enforce.mjs`）对真实 `attestedAtMs` 值做的 `[2^40, 2^47)` bounds guard（超出范围直接
throw）——只要这条 guard 一直生效，任何能通过它的真实 `attestedAtMs` 值就**必然**跟 `dummyAtMs` 同宽
（6 字节）。

**风险的精确形状**：这不是"完全没有防护"，是"防护是两处独立代码的一致性，没有代码直接断言这个一致性
本身"。`computeCloseZkTmplAnchor` 有一个 round-trip 自证（4 段模板 + dummy 值拼回必须 byte-exact 等于
原始编译产物），但这个自证用的是**同一个** dummy 值两端验证，**证明不了**"真实值会跟 dummy 同宽"这件
事——它只能抓"dummy 值自己内部逻辑错了"，抓不到"下一个真实值可能宽度不一样"。

**真实铸造路径进一步核实**（`closezk-v2-mint.mjs:buildCloseZkV2GenesisFromAttestedState`）：真实
`CloseZkV2` redeem **不是**靠"模板 A/B/C/D 拼真实值"这种字节拼接产出的——是 `compileCloseZkV2Redeem`
对 `CloseZkV2.sil` 用真实 `attestedAtMs` 做**完整独立真编译**（同 `compilePayoutShardRedeem` 一样走真
`silverc`）。`anchor.anchorHex`（`computeCloseZkTmplAnchor` 的 dummy 值产物）跟这次真编译产物之间**没有
任何代码做过交叉校验**——两者各自独立算出，谁跟谁一致这件事目前只靠"两处都遵守同一个 `[2^40,2^47)`
约定"来保证，不是被显式验证过的不变量。

## 2. 结构性修法选项

### 选项 A — `.sil` 内改用定宽 byte[] 表示 `attestedAtMs`

思路：仿照 `PayoutShard.sil`/`PayoutShardV2.sil` 的 state 字段，把 `attestedAtMs` 从 `int`（minimal-push
变长）改成显式定宽的 `byte[N]` ctor 参数——从根本上让宽度不再依赖数值大小。

**已核实的可行性障碍（不是猜测，直接查了 silverscript 官方文档，按仓库 SOP 第 5 条要求）**：
`D:\silverscript\docs\TUTORIAL.md` §"Type Conversion Functions"（第 870 行起，权威参考小节）列出的
`int(...)` 转换**只有一个重载**——`int(bool value): int`（bool→int）。整份文档**没有**任何 `byte[]→int`
方向的转换函数。而 `attestedAtMs` 在 `CloseZkV2.sil` 里被用在 `attestedAtMs + 21600000` 这个**整数加法**
里，再交给 `temporal(...)` 转型——如果把 ctor 参数本身声明成 `byte[N]`，需要先转回 `int` 才能做这个加法，
而**官方文档目前查不到这个方向的转换原语**。

**结论**：选项 A 的可行性**目前未确认**——不是"不能做"，是"没有查到能做的原语，需要额外的 spike（比如
先写一个 5 行的最小 `.sil` 试编译 `int(byte[6] x)` 这种写法，看 silverc 是否实际支持文档没列出的重载，
或者反过来看 `temporal()`/算术运算符是否能直接吃 `byte[N]` 操作数）才能确定。**本票不建议在没有先做这个
spike 的情况下把选项 A 当成落地方案去排期**——按仓库铁律"撞到原语好像没有，必须先去文档/源码验证再决定
绕不绕，禁止凭印象判定限制然后搭链下 fallback"，本票已经做了文档核实这一步，结论是"没查到"，不是"我猜
没有"，但**没查到 ≠ 确认不存在**，真正确认需要一次真实编译实验。

**若选项 A 最终可行**，优点是从 `.sil` 结构层面根治，不依赖任何外部约定（比 `[2^40,2^47)` 这种"两处代码
各自遵守同一个数字"的隐性契约更彻底）。缺点：改 `.sil` 源码结构，影响面比选项 B 大，且需要重新过一遍
`computeCloseZkTmplAnchor`/`compileCloseZkV2Redeem` 的 ctor 组装、`extractTemplateArtifact` 的
prefix/suffix 切分逻辑（`attestedAtMs` 如果从"模板字面量比较值"变成"某种 byte[] 编码"，`findUnique` 定位
+ round-trip 自证这一整套机制可能需要跟着改，不是孤立换一个类型声明那么小的改动）。

### 选项 B — 运行时 bounds guard + 派生校验（不改 `.sil`）

思路：不碰 `.sil`，在 JS 层给"真实 `attestedAtMs` 的编码宽度必须跟 `computeCloseZkTmplAnchor` 用的
`dummyAtMs` 一致"这件事加一条**直接**的断言，而不是继续只靠"两处代码恰好用同一个数值区间"这种间接保证。

具体做法（两处都要，缺一不完整）：
1. **`readPayoutShardV2AttestedState` 的 `[2^40,2^47)` bounds guard 保留不变**（它已经存在且工作正常，
   不是本票要动的东西）。
2. **新增一条独立、直接检查字节宽度而不是数值范围的断言**，放在真正把 `attestedAtMs` 拿去参与模板/anchor
   计算的位置（`computeCloseZkTmplAnchor` 内部，紧跟 `dummyAtMs` 那几行之后；以及 `compileCloseZkV2Redeem`
   /`buildCloseZkV2GenesisFromAttestedState` 拿到真实 `attestedAtMs` 之后、真编译之前）——用跟
   `computeCloseZkTmplAnchor` 内部完全一样的编码逻辑（`Buffer.alloc(6); buf.writeUIntLE(value, 0, 6)` 这
   条路径本身要求 `value` 必须能塞进 6 字节，`writeUIntLE` 对超界值会自己 throw `RangeError`——这本身就是
   一种直接的宽度校验，只是目前只在 dummy 值那条路径上跑过，真实值那条路径没有跑过同款校验）：把这个
   "试着按 6 字节编码"的动作也套在真实值上，编不进去就 throw，不静默截断/环绕。这不是发明新机制，是把
   dummy 值已经隐式享受的这层保护，显式地也套用到真实值身上——两条路径现在各自独立编码，谁跟谁一致靠
   人记得两边数值范围要一样；加了这条以后，真实值自己就会在编码那一步直接暴露"宽度不对"，不需要依赖
   "两处代码有没有保持同步"这个人力假设。
3. 单测：真实值取 `2^40`（边界内，应通过）、`2^40 - 1`（边界外，5 字节，应该在这条新断言处 throw，不是
   在更下游某个更难读的地方报错）、`2^47`（边界外，7 字节，应该 throw）三个向量，加一条"6 字节编码后
   跟 dummy 用的同一套 `atMsMarkerAndData` 构造逻辑产出结构一致(长度都是 7 = 1 字节长度前缀 + 6 字节
   数据)"的 sanity。

**优点**：不改 `.sil`，落地成本低、风险小，直接堵住"两处代码隐性约定"这个真实缺口（NULL 处置/参考值刷新
那几张票也是同一种"把隐性依赖变成显式断言"的思路，跟本 session 已有纪律一致）。**缺点**：仍然是"数值范围
决定宽度"这个模型本身——如果 silverscript 编译器未来对 minimal-push 的编码规则本身发生变化（比如换了个
编译器版本，[2^40,2^47) 不再对应 6 字节），这条断言会**正确地**变红（因为它现在是直接测编码宽度，不是
测数值范围），但需要人去更新这条断言里"6"这个数字——不是自动适配任意编译器版本，是把"编译器规则变了会
被抓到"这件事做实，而不是自动免疫。

## 3. 对已有模板锚点 / 主网现状的影响

**主网当前零市场**（`console.mainnet.db`：`pool_markets=0`，`payout_shards=0`，Bettor 1267/1272 只读
实测确认）——**两个选项现在落地都没有任何迁移/兼容成本**，不需要考虑"已经有市场烤了旧 anchor 怎么办"
这类问题。这是做这类结构性修法（尤其选项 A，若确认可行）成本最低的窗口——跟 D-019 当初"零存量市场，
直接改新 ctor shape 不做兼容分支"是同一个论证结构。

## 4. 推荐

**推荐选项 B，现在就能排期**；**选项 A 标记为需要独立 spike 验证可行性后再评估，不阻塞选项 B 落地**。
理由：
- 选项 B 直接堵住当前唯一已确认存在的缺口（"两处代码隐性依赖同一个数值范围，没有直接断言"），成本低、
  风险小、不改 `.sil`、不影响任何已有产物形状。
- 选项 A 的核心可行性（`byte[]→int` 回转，供 `attestedAtMs + GRACE` 这个算术表达式继续工作）**没有在
  官方文档查到对应原语**——不确认能不能做之前排期落码，本身就是在重犯"没查证就动手，赌得过"的错，跟仓库
  第 5 条铁律的精神相反。若未来做了 spike 确认可行，选项 A 可以作为选项 B 之上的进一步结构性加固（两者
  不互斥——选项 B 落地后即使选项 A 之后也做了，选项 B 的断言依然有意义，是"编译器/`.sil` 结构本身该保证
  这件事，代码断言仍然值得留着当回归哨兵"这条本 session 反复出现的纪律的又一例）。

## 5. 验收标准（供落码时核对，本票不落码）

1. `computeCloseZkTmplAnchor` 内新增的宽度断言：正常 `dummyAtMs`（现有 1783500000000）不受影响，函数
   行为不变（现有 `closezk-v2-mint.e2e.test.mjs` 11/11 应该保持全绿，不因为加了这条断言而变红）。
2. `compileCloseZkV2Redeem`/`buildCloseZkV2GenesisFromAttestedState` 对真实 `attestedAtMs` 新增同款
   宽度断言：三个边界向量（`2^40`/`2^40-1`/`2^47`）行为符合 §2 选项 B 第 3 点描述。
3. 新增断言的报错信息含具体的值和期望宽度（不是笼统"编码错误"），方便直接定位，不用反查代码。
4. lint 0 error；改动文件的既有测试文件全部复跑一遍，确认无回归。
