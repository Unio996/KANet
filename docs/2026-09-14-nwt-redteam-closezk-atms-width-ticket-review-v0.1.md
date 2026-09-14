# NWT 判断 · T-CLOSEZK-ATMS-WIDTH票复核（`6244f9a5`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1293：①B的断言位置是否真在编码那步；②边界向量2^40/2^40−1/2^47是否足够；③交叉校验的最小形式。

## 结论：**票本身现状核实（§1）全部逐行独立验证属实，方向（推荐B、A标记需spike）正确。但②的边界向量
按票面写法测的是既有数值范围闸，不是新宽度断言本身——这是个真实的设计缺口，不是吹毛求疵，会导致落码后
"看起来测了新机制、实际只是重跑了旧闸"。①的两处位置里，第一处价值有限。③给出具体的最小交叉校验设计。**

## 一、现状核实（§1）——独立逐行验证，不信票面转述

- 独立`grep`确认`CloseZkV2.sil:20`确实是`int attestedAtMs`（ctor参数），`:121`确实用在
  `require(tx.time >= temporal(attestedAtMs + 21600000))`这个算术表达式里——不是字面量比较。
- 独立读`D:\silverscript\docs\TUTORIAL.md:870`起的"Type Conversion Functions"小节：`int(...)`确认
  **只有**`int(bool value): int`一个重载，`byte[](int, int)`存在但方向反过来（int→byte[]，不是
  byte[]→int）——票面"没查到byte[]→int方向"的表述准确，不是编造。
- 独立`grep`确认`bshard-close-enforce.mjs:553-554`：`_ATTESTED_AT_MS_MIN=1099511627776`(2^40)、
  `_ATTESTED_AT_MS_MAX=140737488355328`(2^47)，`:264-265`确认越界即throw。
- 独立读`closezk-v2-mint.mjs:242-257`（`buildCloseZkV2GenesisFromAttestedState`）：确认`anchor`
  （dummy值产物）与`redeemHex`（真实值经`compileSilV100`完整独立真编译产物）在函数体内**确实零交叉
  比较**，两者作为返回对象的两个独立字段直接返回——票面"目前没有任何代码做过交叉校验"准确。

**§1核实结论：属实，非转述。**

## 二、①B的断言位置——独立追查，发现一处价值不对等

独立读`computeCloseZkTmplAnchor`（`pool-shard-register.mjs:231-290`）完整函数体：**这个函数根本不
接收真实`attestedAtMs`参数**——它内部只用自己硬编码的`dummyAtMs=1783500000000`，从未处理过任何来自
调用方的真实市场数据。票面§2选项B第2点提议的"第一处：`computeCloseZkTmplAnchor`内部紧跟dummyAtMs
那几行之后"，独立评估价值：**这个位置的断言只能重新验证一个源码里硬编码常量的宽度**——而这个常量
本来就已经被紧邻的`atMsBuf6.writeUIntLE(dummyAtMs, 0, 6)`（`:267`）隐式验证过（写不进6字节这行本身
就会throw `RangeError`），且这个常量不随运行时数据变化，只有人改代码时才可能变。**这处断言不是没用，
但价值有限——它测的是"这个常量今天还是6字节"，不是"下一个真实市场的值会不会漂出6字节"，后者才是票
真正想防的风险。**

**第二处（`compileCloseZkV2Redeem`/`buildCloseZkV2GenesisFromAttestedState`拿到真实`attestedAtMs`
之后、真编译之前）才是真正承重的位置**——独立确认`compileCloseZkV2Redeem`（`closezk-v2-mint.mjs:74`）
确实接收真实`attestedAtMs`参数，且在`ctorIntV100(Number(attestedAtMs))`（真实值进ctor数组）**之前**
插入宽度断言，是这条链路上唯一会看到真实、随市场变化的数据的位置——票面把这里列为"两处都要"里的一处，
**判断正确，是真正该加的地方**；第一处降级为"锦上添花，非必需"更准确。

## 三、②边界向量2^40/2^40-1/2^47——独立验算，发现真实缺口

**独立算了一遍这三个数字在6字节无符号编码下的真实位置**：`writeUIntLE(v, 0, 6)`能表示的范围是
`[0, 2^48-1]`（6字节=48位）。票面选的既有数值闸边界`[2^40, 2^47)`**整段严格落在**`[0, 2^48-1]`
**内部**——`2^47`本身只有47位，塞进48位的6字节缓冲区毫无压力，**根本不会触发`RangeError`**。

**这意味着**：`2^40-1`跟`2^47`这两个"边界外"向量，在真实调用链路里，会先被**既有的**
`readPayoutShardV2AttestedState`数值范围闸（`bshard-close-enforce.mjs:264-265`）挡下并throw
——**永远轮不到走到新加的宽度断言那一步**。用这三个向量测出来的"通过/拒绝"结果，验证的是"既有数值闸
还在正常工作"（这本身没错，值得保留作回归），**但不能证明新加的宽度断言本身真的会在该拦的时候拦**——
因为在当前的数值闸边界下，新断言永远拦不到任何东西（凡是能通过既有数值闸的值，必然能塞进6字节），
它目前是**结构性的死代码**，只有未来某天有人放宽了`_ATTESTED_AT_MS_MAX`（比如改成`2^50`）却没意识到
宽度含义时，新断言才会真正派上用场。

**这不是吹毛求疵，是真实的测试有效性缺口**：如果落码时只用票面这三个向量，交付出来的测试套件"看起来"
在验证新机制，实际只是把既有数值闸重新跑了一遍，新断言自身的失败路径从未被真正触发过一次——跟本
session其它地方已经踩过的"占位ctor编译验证不了真实值行为""手搓fixture只对一种环境成立"是同一类"看似
测过、实际没测到点上"的坑。

**建议补一条独立测试向量**：不通过完整调用链（那样会先被既有数值闸拦下），改为**直接对宽度断言函数
本身**（若落码时把它抽成一个可独立调用的小函数，比如`assertSixByteEncodable(value, label)`）单独喂
`2^48-1`（应该PASS，6字节能表示的最大值）和`2^48`（应该FAIL，独立断言这条防线自己在阈值处真的会抛）
——这两个向量才是真正在测新机制自己的边界，2^40/2^40-1/2^47三个向量作为"既有数值闸没退化"的回归可以
保留，但不能替代对新断言自身阈值的直接测试。

## 四、③交叉校验的最小形式——给出具体设计

复用本session已经在`payoutshardv2-offset-tripwire.test.mjs`验证过的instance-binding模式（对
`PayoutShard`/`PayoutShardV2`两个文件做过的同一套方法，这次对`CloseZkV2.sil`做一遍）：

1. 用一个**跟`dummyAtMs`不同**的真实量级`attestedAtMs`值（比如`2^41`附近某个具体数字，同session一贯
   "distinct non-zero markers"纪律，不要用跟dummy一样或过分工整的数字）+ 真实的`betsRootBaked`/
   `refundRootBaked`（也要跟dummy的`11...`/`22...`不同），走`compileCloseZkV2Redeem`做一次**完整独立
   真编译**，得到`realRedeemHex`。
2. 用`computeCloseZkTmplAnchor`（dummy路径）算出的`templateA/B/C/D`四段模板，去这份**真实、独立编译
   出的**`realRedeemHex`上做同款`findUnique`字节定位（找真实attestedAtMs的7字节marker+data、真实
   betsRoot/refundRoot各自的32字节），断言：`templateA` == `realRedeemHex`在真实betsRoot之前的那段、
   `templateB`/`templateC`/`templateD`同理——**四段模板必须在这份完全独立、真实值编译出的产物上精确
   切出同样的字节**，不是"dummy自己拼回等于dummy自己"这种同义反复。
3. 这条测试证明的是设计真正依赖的那条不变量："用dummy编译出的模板边界，套到任意真实ctor值编译出的
   产物上仍然定位准确"——跟`payoutshardv2-offset-tripwire.test.mjs`①instance-binding测的是完全同一
   件事，只是换了`CloseZkV2.sil`这个文件、换成了模板拼接而不是委员offset。
4. **这应该是一条permanent回归测试**，不建议做成运行时闸（每次真实mint都多编译一次有性能成本，且
   `computeCloseZkTmplAnchor`本身已经有round-trip自证，两层加起来已经是相当扎实的结构性保证——加这
   条测试是为了在**代码库层面**证明"套用到真实值"这条假设成立，不是在**每次调用时**都重新证明一遍）。

## 五、给Bettor的处置建议

- **票本身GREEN，方向正确（推荐B、A标记spike、不阻塞B落地）**，但落码前请把上述两点纳入验收标准：
  ① `computeCloseZkTmplAnchor`内部那处断言降级为可选（价值有限，不是必需，不要因为"两处都要"而占用
  额外落码/测试成本在低价值的地方）；② 边界向量除2^40/2^40-1/2^47（保留作既有数值闸回归）外，**必须
  加`2^48-1`(PASS)/`2^48`(FAIL)两个向量直接测宽度断言函数自身**，否则新机制的失败路径永远没被验证过。
- ③交叉校验建议按上文§四的instance-binding设计落成一条permanent回归测试，归入本票或作为独立小票均可，
  不建议省略——这正是Codex在委员offset线上偏好、后来被落成`payoutshardv2-offset-tripwire.test.mjs`的
  同一套方法在`CloseZkV2.sil`上的镜像应用。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
