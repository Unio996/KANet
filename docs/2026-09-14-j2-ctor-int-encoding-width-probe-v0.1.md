> **Status**: CURRENT

# ctor int 字段编码宽度实测（Codex/Bettor 1256/1259 只读实测要求）

**范围**：只回答一个问题——`deriveCommitteeCheckOffsets`（`committee-offset-derive.mjs`）用**占位 ctor**
（poolMerkleRoot/predicateCommit 哨兵 + 其它字段固定占位值）编译 `PayoutShard.sil`/`PayoutShardV2.sil` 派生出的
委员校验哨兵绝对偏移，套到**真实市场**（真实 consolidatedPool/closed/attestedWinner/attestedAtMs 值）编译出的
redeem 字节上，是否会因为 silverc v1.0.0 对 ctor int 用变长（minimal-push）编码而对不上号（真实值的字节宽度
跟占位值的字节宽度不同 ⇒ 该字段之后的所有字节整体平移）。

**不改任何 `.mjs` 文件**——本笔 docs-only，new commit 到 `coord/j2-offset-live-derive` 侧分支（同 ledger 1235 先例）。

## 背景：这个风险不是凭空猜的，本仓已有一处实锤

`kasia-console/src/lib/pool-shard-register.mjs` 的 `computeCloseZkTmplAnchor`（编译 `CloseZkV2.sil`）里，
`dummyAtMs` 的头注原话：

> `dummyAtMs` 必须落在 J2 实测的稳定值域 `[2^40, 2^47)` 内（同 `PayoutShardV2.sil` zk_handoff 的 bounds guard），
> 否则 minimal-push 变长编码会让模板切分点跟真实 market 用的值对不上。

且代码里显式按 6 字节（不是固定 8 字节）解析这个字段：
```js
const atMsBuf6 = Buffer.alloc(6); atMsBuf6.writeUIntLE(dummyAtMs, 0, 6);
const atMsMarkerAndData = Buffer.concat([Buffer.from([6]), atMsBuf6]);
```
——`[6]` 长度前缀 + 6 字节数据，证明**这个 v1.0.0 工具链在 `CloseZkV2.sil` 里确实对某个 int ctor 字段用了
变长（长度前缀 + 最小编码）表示**，不是猜测。Codex/Bettor 据此推断"整线（含 `PayoutShard`/`PayoutShardV2`）
可能同款受影响"是合理的怀疑方向——但 `dummyAtMs` 属于 `CloseZkV2.sil`，不是 `deriveCommitteeCheckOffsets`
实际编译的两个文件（`PayoutShard.sil`/`PayoutShardV2.sil`），是否**同款**必须实测，不能顺着推。

## 方法

用 D-019 pin 二进制（`silverc-v100-3ed9733.exe`，sha256 见 `scripts/silverc-pin.json`）+ 项目自己的
`compileSilV100`/`ctorIntV100`/`ctorBytes32V100`（`pool-bshard-artifacts.mjs`，跟生产同一套编译入口，不是
手搓字节）编译 `PayoutShard.sil`/`PayoutShardV2.sil`，poolMerkleRoot/predicateCommit 位置固定填两个唯一
哨兵（`a5`×32 / `b6`×32），逐个改动**其它 ctor int 字段**的值，比较：
- 编译产物总字节长度（`compiled.script.length`）
- 哨兵在产物里的全部命中位置（`indexOf` 全量扫描，不止第一个）

若任一字段的值变化导致长度或哨兵位置改变 ⇒ 该字段确认变长编码，占位派生对这个字段不安全。

**矩阵值**（Bettor 1256 指定）：`0, 1, 255, 256, 2^31, 2^40, -1, Number.MAX_SAFE_INTEGER`（int64 最大值
`2^63-1` 超出 JS Number 安全整数范围，`compilePayoutShardRedeem` 自身在真实调用链上也用
`ctorIntV100(Number(consolidatedPool))` 做了同款精度收窄——见下方"残留缺口"一节，这是既有、非本次引入的
边界，不在本次实测范围内展开）。bytes32 字段：全零 vs 随机 32 字节。

**测试脚本**：`scratch/_j2_offsetmatrix_probe.mjs`（gitignored，本文档收录完整原始输出于附录）。

## 结果

### `PayoutShard.sil`（V1）
- baseline（consolidatedPool=0, closed=0）：`len=32779`，`pmr=[16931,17227,17523,17819,18115,25698,25994,26290,26586,26882]`，`pc=[16411,16445,25178,25212]`
- **consolidatedPool ∈ {0,1,255,256,2^31,2^40,-1,MAX_SAFE_INTEGER}：`len` 与 `pmr`/`pc` 全部 8 组逐字节相同，零漂移。**
- **closed ∈ {0,1,-1}：同上，零漂移。**

### `PayoutShardV2.sil`
- baseline（consolidatedPool=0, attestedWinner=-1, attestedAtMs=0）：`len=29328`，`pmr=[17089,17385,17681,17977,18273,20510,20806,21102,21398,21694]`，`pc=[16569,16603,19990,20024]`
- **consolidatedPool ∈ 同上矩阵：零漂移。**
- **attestedWinner ∈ {-1,0,1}：零漂移。**
- **attestedAtMs ∈ {0,1,255,256,2^31,2^40,2^40+12345,2^46}（覆盖生产实际 bounds-guard 值域 `[2^40,2^47)` 的边界与内部点）：零漂移。**

### bytes32 字段（全零 vs 随机）
- `len` 与哨兵位置逐字节相同——32 字节数据 push 天然跟内容无关，只跟长度有关（预期内，列作 sanity check）。

完整命令输出见附录（本文档末尾）。

## 为什么零漂移——源码级证据，不是巧合

`PayoutShard.sil`/`PayoutShardV2.sil` 的 state 区拼装逻辑（`newStateBytes` 构造，两文件同款）对**每一个**
int 字段都显式写：

```
byte[](8 as byte[1]) + byte[](consolidated_pool as byte[8])
byte[](8 as byte[1]) + byte[](closed as byte[8])
...（w0..w16 同款）
byte[](8 as byte[1]) + byte[](attestedWinner as byte[8])   // 仅 V2
byte[](8 as byte[1]) + byte[](attestedAtMs as byte[8])     // 仅 V2
```

`as byte[8]` 是**源码作者显式指定的定宽转换**——不管左边 int 值多大/多小/是否负数，产出恰好 8 字节（配一个
恒为 `8` 的 1 字节长度前缀）。这是 state 区为了支持"genesis 编译一次、真实 splice 任意市场真实值"这个用法
特意做的设计（跟 decodeV1State 用固定 offset `buf.readBigInt64LE(2)`/`buf.readBigInt64LE(11)` 读
consolidatedPool/closed 这件事本身就已经隐含"这两个字段必须定宽"这个前提一致——本次实测把这个隐含前提坐实
成了显式源码证据 + 跨全矩阵值的编译产物实测）。

`CloseZkV2.sil` 的 `dummyAtMs`（`computeCloseZkTmplAnchor` 编译的字段）**没有**用这个 `as byte[8]` 定宽写法
——它是作为一个**模板字面量比较值**直接烤进比对逻辑（同 `gateTmplHash`/`token_tmpl_hash` 那一类"ctor-only
字面量"，不是 state splice 槽位），因此走的是编译器对 int 字面量的默认变长（minimal-push）编码。这解释了
"同一个工具链，两个不同文件表现不同"——不是巧合，是两种不同的源码写法（显式定宽 cast vs 默认变长字面量）
在同一个编译器下各自的正常行为。

## 结论

**对 `deriveCommitteeCheckOffsets` 实际编译的这两个文件（`PayoutShard.sil`/`PayoutShardV2.sil`）而言，
Codex/Bettor 1256 担心的"占位 ctor 派生偏移套到真实 ctor 的 redeem 上会因变长编码整体平移"这条风险
——本次矩阵实测（覆盖两个文件全部会在占位值与真实值之间产生差异的 int 字段：V1 的
consolidatedPool/closed，V2 额外的 attestedWinner/attestedAtMs；w0..w16 每个真实调用点都固定传 0，占位
派生跟真实调用永远一致，不需要矩阵测）——零漂移，且有源码级`as byte[8]`显式定宽转换直接解释原因，不是"测
了几个值恰好没撞上"的偶然。**

按 Bettor 1256 原话的二选一判据（"可变长 ⇒ (B)；定宽 ⇒ (A)"），**这两个文件的证据指向 (A)**：不需要为
`PayoutShard`/`PayoutShardV2` 把派生改成"以被检市场真实 ctor 元组编译"（(B) 方案），维持现有"固定占位 ctor
派生一次、缓存复用"设计即可安全套用到任意真实市场——但仍应把本次矩阵值（尤其编码边界点 255/256/2^31/2^40）
补进 `committee-offset-derive.test.mjs` 的变异向量（Bettor 1256 (A) 分支的既定要求："变异向量进派生测试与
tripwire 为必需"），把"这两个字段确实定宽"这件事从"这次手工测过一遍"变成"每次跑测试都会验一遍"。

**`CloseZkV2.sil`（`computeCloseZkTmplAnchor`）不在本次范围内，但那份 `dummyAtMs` 头注证明的变长编码风险对
那个文件是真实的**——它当前靠"人工把 dummyAtMs 钉死在稳定值域"规避，不是结构性修复；是否也要给它补一层
instance-binding 校验，是另一张票，本文档不展开，只标记出来避免"这一票关完，那边那个已知风险被忘掉"。

## 残留缺口（超出本次范围，一并标注）

`compilePayoutShardRedeem`/`compilePayoutShardV2Redeem` 在传给 `ctorIntV100` 之前先做了 `Number(consolidatedPool)`
——这本身把 `consolidatedPool` 收窄到 JS Number 安全整数范围（`2^53-1`），比本次矩阵测的
`Number.MAX_SAFE_INTEGER` 再往上一直到真实 int64 上限（`2^63-1`）这段区间，在当前生产代码里**根本传不进去**
（会在 `Number()` 转换时丢精度，不是本次实测新发现的问题，是既有、跟本票无关的边界，值得另开一张票核实
"KCC-20 测试币的实际最大铸造量会不会撞上这条 Number 精度线"，不阻塞本票结论）。

## 附录：原始输出

见 `scratch/_j2_offsetmatrix_probe.mjs` 运行结果（此处摘录关键行，完整日志可复跑该脚本重新生成——
D-019 pin 二进制在本机固定路径，任何人复跑得到的偏移应逐字节相同）：

```
=== PayoutShard(V1): vary consolidatedPool, closed=0 fixed ===
baseline(0): {"len":32779,"pmr":[16931,17227,17523,17819,18115,25698,25994,26290,26586,26882],"pc":[16411,16445,25178,25212]}
consolidatedPool=0/1/255/256/2147483648/1099511627776/-1/9007199254740991: 全部 len=32779(Δ0)，pmr/pc 逐字节相同

=== PayoutShard(V1): vary closed, consolidatedPool=0 fixed ===
closed=0/1/-1: 全部 len=32779(Δ0)，pmr/pc 逐字节相同

=== PayoutShardV2: vary consolidatedPool, attestedWinner=-1, attestedAtMs=0 fixed ===
baseline(0,-1,0): {"len":29328,"pmr":[17089,17385,17681,17977,18273,20510,20806,21102,21398,21694],"pc":[16569,16603,19990,20024]}
consolidatedPool=0/1/255/256/2147483648/1099511627776/-1/9007199254740991: 全部 len=29328(Δ0)，pmr/pc 逐字节相同

=== PayoutShardV2: vary attestedWinner, consolidatedPool=0/attestedAtMs=0 fixed ===
attestedWinner=-1/0/1: 全部 len=29328(Δ0)，pmr/pc 逐字节相同

=== PayoutShardV2: vary attestedAtMs, consolidatedPool=0/attestedWinner=1 fixed ===
baseline(0,1,0): {"len":29328,"pmr":[17089,17385,17681,17977,18273,20510,20806,21102,21398,21694],"pc":[16569,16603,19990,20024]}
attestedAtMs=0/1/255/256/2147483648/1099511627776/1099511640121/70368744177664: 全部 len=29328(Δ0)，pmr/pc 逐字节相同

=== bytes32 fields: all-zero vs random ===
all-zero bytes32: len=32779 pmr=[16931,17227,17523,17819,18115,25698,25994,26290,26586,26882]
random bytes32:   len=32779 pmr=[16931,17227,17523,17819,18115,25698,25994,26290,26586,26882]
```
