# 委员校验 offset 运行时派生 — 实现方案 v0.2（附录：真实产物归属顺序实测，ledger 1235/1237）

> **Status**: v0.2 — NWT 已判 GREEN（`1ad41bb6`，ledger 1237），四点采纳意见见附录末尾，落码进行中（侧分支
> `coord/j2-offset-live-derive`，基于 `b4afbf90`）。v0.1 正文原文不动，本次只加附录。

## 附录 A（v0.2，ledger 1235）：真实产物验证"前 5/后 5"归属顺序（只读实测，未改任何 `.mjs`）

**方法一（结构性，NWT 1237 裁定为主路径）：dispatch_tag 字节偏移定界**。v1.0.0 编译产物的
`contracts[Name].entries[entryName].dispatch_tag` 是该 entry 的选择器 tag（hex）——实测确认这个 tag 的
字节序列在完整 bytecode 里**精确出现 1 次**，其偏移即该 entry 的 dispatch 分支起点；把全部 entry 的 tag
偏移排序，相邻两个之间的区间就是"这个 entry 的字节范围"。任何字段的 offset 落在哪个区间，即归属哪个
entry——**运行时可验证，不依赖对源码声明顺序的假设**。

**方法二（位置法，v0.1 提过、现在降为备选）**：假设"declaration 顺序 = 编译产物物理布局顺序"，取
`indexOf` 全部命中里最小的 N 个当作"更早声明的那个 entry"。

**实测数据（`PayoutShardV2.sil`，真实 D-019 pin 二进制，sentinel `aa`×32 for poolMerkleRoot / `77`×32
for predicate_commit，占位 ctor，30 参数）**：

```
dispatch_tag 偏移（排序后）：absorb@292 < close_attest@15367 < cancel_attest@18820 < refund_claim@22233 < zk_handoff@27680
poolMerkleRoot 10 处命中（PUSH32 哨兵全部通过）：
  [17089,17385,17681,17977,18273]  ⊂ [close_attest@15367, cancel_attest@18820)  → 归 close_attest
  [20510,20806,21102,21398,21694]  ⊂ [cancel_attest@18820, refund_claim@22233)  → 归 cancel_attest
predicate_commit 4 处命中（PUSH32 哨兵全部通过）：
  [16569,16603]  ⊂ [close_attest@15367, cancel_attest@18820)   → 归 close_attest
  [19990,20024]  ⊂ [cancel_attest@18820, refund_claim@22233)   → 归 cancel_attest
```

**交叉验证（独立第三种方法，不依赖 dispatch_tag 也不依赖单纯"最小 N 个"假设）**：把 `PayoutShardV2.sil`
的 `cancel_attest` entry 整段（源码第 330-444 行）物理删除后用同一 sentinel、同一 ctor 重新编译——

```
原始(含 cancel_attest): 10 处命中 [17089,17385,17681,17977,18273, 20510,20806,21102,21398,21694]
删除 cancel_attest 后:   5 处命中 [17089,17385,17681,17977,18273]  —— 与原始"前 5"逐位节节byte-identical
```

删除**物理上更后面**的 `cancel_attest` 之后，**前 5 个 offset 完全不变**（不是"数值接近"，是 byte-exact
相同）——这是最直接的因果证据：这前 5 个位置的字节，在 `cancel_attest` 存在与否两种情况下**编译产物完全
一致**，说明它们确实不属于 `cancel_attest` 的编译输出，只能属于物理上更靠前的 `close_attest`。**方法一
（dispatch_tag 定界）与方法二（位置排序）与这个独立删除实验**三者结论完全一致。

**`PayoutShard.sil`（V1，25 参数）同一实验，结论一致**：

```
dispatch_tag 偏移：absorb@208 < close_attest@15241 < claim@18603 < cancel_attest@24008 < refund_claim@27370
poolMerkleRoot: [16931,17227,17523,17819,18115] ⊂ [close_attest,claim) → close_attest
                [25698,25994,26290,26586,26882] ⊂ [cancel_attest,refund_claim) → cancel_attest
删除 cancel_attest(源码478-584行)后重编译: 5 处命中，与原始前5 byte-identical，验证通过。
```

**结论**：`_PMR_COMMITTEE_CHECK_OFFSETS(_V2)`/`_PREDICATE_COMMIT_REDEEM_OFFSET(_V2)` 现有硬编码常量的
"前 N 个属于 close_attest、后 N 个属于 cancel_attest"这条既有假设——**在当前 v1.0.0 编译产物上成立，三种
独立方法交叉验证一致**。落码时**主路径用 dispatch_tag 定界**（NWT 1237 裁：结构性、每次编译都重新验证，
不会因为未来某次 `.sil` 改动使"声明顺序=物理顺序"这个隐含假设失效而悄悄错判），位置排序法保留作为
（a）自检互证的第二条独立信号，（b）`entries` schema 若未来缺失 `dispatch_tag` 字段时的降级路径。

## 附录 B（v0.2，ledger 1237）：NWT 四点采纳意见（落码执行清单）

1. 五要点照 v0.1 正文方案（缓存/fail-closed/checked-in 参考值 WARN/predicate_commit 哨兵补齐/tripwire 重设计）不变。
2. **"前 5/后 5"归属主路径改为 dispatch_tag 字节范围过滤**（见附录 A 方法一），位置排序法降为备选/互证；
   两法在真实 v1.0.0 产物上结果一致的证据（附录 A）已入档。
3. **K-18 双闸独立性**：`bshard-payout-family-coherence.mjs` 的 `probeStructuralSignature` 与
   `bshard-close-enforce.mjs` 的拒签闸**各自独立调用同一个 `deriveCommitteeCheckOffsets` 本体**，不许一道
   闸拿另一道闸算好的结果对象直接复用；两道闸各自传入**不同的 sentinel 常量**（独立计算，即使结果理论上
   应该相同，这是故意的冗余设计，不是疏漏）。
4. **缓存 key = (编译器 sha256, 源码 sha256)**，首次触发（冷启动/进程首次调用）必须真的走一遍编译+定位+
   验证，不允许任何预置/硬编码的"跳过首次验证"捷径。

**验收标准（落码完成的判据）**：
- `payoutshardv2-offset-tripwire.test.mjs` 从 RED 变 GREEN。
- 源码里不再有任何**用于计算**（不是"作为 checked-in 参考值摆着"）的硬编码绝对偏移数字。
- 负向量至少 3 条：① 两次编译 sentinel 位置不一致（模拟 `.sil`/编译器不稳定）→ 拒绝；② 定位到的拷贝数量
  不足预期（4 或 5）→ 拒绝；③ 二进制 sha256 不符 D-019 锚点 → 拒绝签名，不静默降级使用旧值。
- V1（`@518`/`@1002`）与 V2（`@642`/`@1126...`）**一并**落码，不是只修 V2 留 V1 债。

**分支纪律**：本次落码在 `coord/j2-offset-live-derive`（基于 `b4afbf90`，独立 worktree），与 T4 创世对照
工具（`e9fe9102` 方案，`coord/j2-t4-genesis-compare`，已随 D-019 收尾关闭）**分开分支、分开提交**，不混。
> 产物派生，绑 D-019 pin + 固定 git-tracked 源码路径，绝不从 `signRequest` 传入的产物派生。本稿只出方案，
> 落码前 NWT 再审一遍。范围：`bshard-close-enforce.mjs` 的 `_PREDICATE_COMMIT_REDEEM_OFFSET`/`_V2` +
> `_PMR_COMMITTEE_CHECK_OFFSETS`/`_V2` 四组硬编码常量，V1（`@518`/`@1002`）与 V2（`@642`/`@1126...`）**一并**
> 处理（此前 §2.1 只确认过 V2 漂移，`bshard-consolidated-pool-rederive.test.mjs` 场景 A/B 实测确认 V1
> `predicateCommit@518` 同样漂移，见 `docs/2026-09-14-j2-d019-silverc-v100-migration-inventory-v0.1.md` §2.3①）。

## 0. 一句话

四组硬编码 offset 常量（V1/V2 各一对 predicate_commit 单点 + poolMerkleRoot 5 点）全部**不再写死数字**，
改成每次委员 daemon 签名请求时（或缓存命中时零成本）**对固定 git-tracked 的 `PayoutShard.sil`/
`PayoutShardV2.sil` 源码用 D-019 pin 编译器现场编一次、用 sentinel-marker + `indexOf` 定位真实字节位置**——
跟 `computeCloseZkTmplAnchor` 定位 `betsRoot`/`refundRoot` 已经用过的 `findUnique` 手法同一套纪律，不是新
发明。预测：这会把"`.sil` 改一处、offset 全部跟着漂移却没人发现"这整类事故连根拔掉——因为 offset 不再是
一个需要"记得手动重量"的人工产物，是每次都现场量出来的。

## 1. 接口设计

```js
// bshard-close-enforce.mjs 新增(替换 4 个硬编码常量的使用点，不改调用方签名)
function deriveCommitteeCheckOffsets(isV2)
  → { predicateCommitOffset: number, poolMerkleRootOffsets: number[] }   // 缓存命中直接返回，否则现场编译+定位
```

- **输入**：只有 `isV2`（bool，既有的 `ctx.resolutionRuleSpec.zk_native` 判据，零改动）——**不接受任何来自
  `signRequest`/调用方的产物或路径**（NWT 定案的硬约束，防止委员被喂一份"经过篡改的编译产物"当作真相）。
- **源码路径**：固定 `join(LIB, 'PayoutShard.sil')` / `join(LIB, 'PayoutShardV2.sil')`——跟
  `compilePayoutShardRedeem`/`compilePayoutShardV2Redeem` 已经在用的**同一个**固定路径常量，不新开一个
  可配置项。
- **编译器**：`compileSilV100`（D-019 pin，`assertSilvercV100Pinned`+`assertSilvercV100GoldenSample` 双重
  校验已经在函数内部做，本次新函数直接复用，不重新发明校验逻辑）。
- **ctor 值**：占位即可（本 session 已反复验证的既有事实：offset/模板结构不依赖 ctor **值**，只依赖 ctor
  **类型序列**——`extractTemplateArtifact`/`computeCloseZkTmplAnchor` 的既有 anchor 编译全部这么做）；
  `predicate_commit`/`poolMerkleRoot` 两个槽位填**互不相同、且与其它全零/占位槽位不冲突的 sentinel 值**
  （同 `computeCloseZkTmplAnchor` 已踩过的坑："distinct non-zero dummy markers"，`z32` 会跟别的全零槽位
  撞见）。

## 2. 缓存（要点①）

`Map<cacheKey, result>`，`cacheKey = sha256(compilerSha256 + sourceSha256)`——`compilerSha256` 来自
`assertSilvercV100Pinned` 已经算过的值（pin 文件本身的 `sha256`，不必重算二进制文件），`sourceSha256` =
`sha256(readFileSync(silPath))`（同 `pool-bshard-artifacts.mjs` `_runSilverc` 现有的 `sourceHash` 计算
方式，复用同一模式）。**不是** `compileSilV100`/`_runSilverc` 已有的磁盘 artifact-cache（那层缓存的是编译
产物 JSON，粒度是"编译"这一步；这里要缓存的是"编译产物 → offset 数组"这一步的**派生结果**，避免委员 daemon
每次签名请求都重新跑一遍 `indexOf` 扫描+一次 JSON 反序列化——虽然量级不大，但委员 daemon 是逐笔下注/结算
都会打的路径，能省则省，况且 ①的字面要求就是"别在热路径每次开子进程"，进程级 in-memory Map 足够，不需要
持久化到磁盘）。**缓存永不主动失效**——如果 `.sil` 源码或编译器换了，`sourceSha256`/`compilerSha256` 自然
跟着变、cacheKey 自然不同，旧缓存条目单纯变成再也不会命中的死数据，不需要显式 invalidate 逻辑。

## 3. Fail-closed 语义（要点②）

`deriveCommitteeCheckOffsets` 内部任何一步失败（`compileSilV100` 抛异常——pin 不符/黄金样本不符/`.sil`
解析失败/编译失败；sentinel 在编译产物里找不到、或找到的次数不是预期个数——见下方 §5）都**直接向上抛
异常，不吞不降级**。调用方 `enforceCloseAttest` 已有的"任一步失败 = 拒签"既定纪律（本函数从 W1/W3 落码起
就是这个哲学，见文件头"only PASSes if everything matches"）天然覆盖这条新失败路径，**不需要新写一层
try/catch 把它"优雅降级"成旧硬编码值**——旧硬编码值现在已经证明会漂移，用一个已知可能错的值去"优雅降级"
才是真正的风险，宁可这一签名请求整体拒签、报错信息里带上具体是哪一步失败，让运维介入，不是让委员用一个
不知道对不对的字节位置去验证一笔真实结算签名。

## 4. Checked-in 参考值 + WARN-not-block 比对（要点③）

四个既有常量（`_PREDICATE_COMMIT_REDEEM_OFFSET(_V2)`/`_PMR_COMMITTEE_CHECK_OFFSETS(_V2)`）**保留在源码
里**（不删），改名/加注释标注为"最后一次已知正确的参考值（历史快照，非权威）"。`deriveCommitteeCheckOffsets`
派生出真实值后，与这份参考值比对：**不等 ⇒ `console.warn` 留痕**（格式建议：
`[committee-offset-derive] WARN: derived != checked-in reference (isV2=${isV2}, derived=${...}, reference=${...}) — .sil 已改动, 建议更新 checked-in 参考值`），
**但不拒签、不影响本次派生结果的使用**（派生值本身已经通过了 §5 的结构自证，是本次签名唯一使用的值——
参考值比对纯粹是"提醒人去更新常量、留一份变更审计痕迹"，不是第二道校验闸）。

## 5. `predicate_commit` 结构哨兵补齐（要点④，与 PMR 系列拉平）

现状不对等：`extractOnChainPoolMerkleRoot` 对 `_PMR_COMMITTEE_CHECK_OFFSETS(_V2)` 的每个 offset 都核
`redeem[o-1] === 0x20`（PUSH32 opcode 哨兵）+ 5 份互证全部相等才通过；`predicate_commit` 只在
`_predicateCommitOffset` 单点裸切片 32 字节，**没有 PUSH32 哨兵检查，也没有利用文件头注释里提到的"4 份
inline copy"做互证**（`close_attest`一对 + `cancel_attest`一对，现状代码只读其中一份）。

**补齐方案**：`deriveCommitteeCheckOffsets` 定位 `predicate_commit` 时，用 `indexOf` 在编译产物里搜索
sentinel 值的**全部**出现位置（同 `computeCloseZkTmplAnchor` 的 `findUnique`，但这里刻意**不**要求"精确
出现 1 次"——`predicate_commit` 结构上就该出现多次），对每个候选位置核 `redeem[offset-1] === 0x20`
（排除误命中裸字节巧合形成的假阳性），期望数量 = 4（V1/V2 均如此，按文件头注释）；4 份互证全部相等
（本来就是同一个 ctor 值的多份 inline copy，理应逐位相同）；返回其中第一份（`close_attest` 那一对里
在源码里先出现的那份，同现有 `_predicateCommitOffset` 选取逻辑"entry 内第一次出现"一致，不改变语义，
只是把"人工量出来的位置"换成"每次现场验证过结构、且带 4 份互证的位置"）。

**⚠ 未验证、留给落码阶段确认的一点（如实标注，不假装已经证实）**：`poolMerkleRoot` 的 5+5=10 份 inline
copy 里，"前 5 份属于 `close_attest`、后 5 份属于 `cancel_attest`"这个顺序假设，来自现有硬编码常量的相对
位置（`_PMR_COMMITTEE_CHECK_OFFSETS` 数值都小于 `cancel_attest` 那组），大概率是"两个 entry 在源码里的
声明顺序 = 编译产物里两段 dispatch 分支的物理先后顺序"这个 silverc codegen 的稳定特性，但本稿**没有额外
独立证据**证明这个顺序在 v1.0.0 codegen 下依然成立（只是从既有硬编码数字的相对大小反推出来的假设）——
落码时必须先用真实编译产物验证一遍"前 5 份 offset 是否确实落在 `close_attest` 分支体内、后 5 份是否落在
`cancel_attest` 分支体内"（例如用现有 `entries` schema 里的 `dispatch_tag` 反查各分支在完整字节流里的
起止范围，如果 v1.0.0 产物不直接给字节范围，退而求其次用"两个 dispatch_tag 各自在 bytecode 里的字节偏移
`indexOf`"间接定位），不能延续"数值小的就是 close_attest"这个未经验证的假设直接照搬。

## 6. Tripwire 测试重设计（要点⑤）

`payoutshardv2-offset-tripwire.test.mjs` 现状：编一次真实 redeem，断言硬编码常量数字与真实编译产物里的
`indexOf` 结果**逐一相等**——这套测试的前提是"存在一份稳定不变的正确数字"，而这正是被证伪的假设。

**改法**：测试不再断言任何具体数字，改成断言 `deriveCommitteeCheckOffsets` 的**派生结果自洽**：
- `poolMerkleRoot` 5 个派生 offset 全部满足 PUSH32 哨兵 + 5 份互证相等。
- `predicate_commit` 派生 offset 满足 PUSH32 哨兵 + 4 份互证相等。
- 用两份**故意不同**的 ctor sentinel 值重新编译+派生两次，断言派生出的**offset 位置**相同（值不同不影响
  位置——结构不依赖 ctor 值这条既有事实的直接验证）。
- 保留一条"如果 checked-in 参考值与派生结果不等，测试打印 WARN 但不 FAIL"的观测性断言（呼应 §4，给
  人看"现在参考值是不是该更新了"，不是回归门）。

## 7. 没核到的（如实记录）

- §5 末尾提到的"前 5/后 5 份 inline copy 归属哪个 entry"这个顺序假设，本稿未独立验证，落码阶段必须先证。
- V1 `predicate_commit`(`@518`)/`poolMerkleRoot`(`@1002`) 目前只在 `bshard-consolidated-pool-rederive.
  test.mjs` 场景 A/B 里间接撞见漂移（真实 v100 编译产物导致 `probeStructuralSignature` 步骤(b) FAIL），
  没有像 V2 那样做过 `indexOf` 精确定位新数值——落码时两个家族(V1/V2)平行处理，此前 V2 的具体新数值
  （`predicateCommit` 落在 `[16569,16603,19990,20024]`，`poolMerkleRoot` 落在
  `[17089,17385,17681,17977,18273]`，见迁移盘点文档 §2.1）可以直接复用做参考值更新，V1 对应数值本稿未测。
- `bshard-payout-family-coherence.mjs` 的 `probeStructuralSignature`（`V1_PREDICATE_COMMIT_OFF=518`/
  `V1_POOL_MERKLE_ROOT_OFF=1002`/`V2_PREDICATE_COMMIT_OFF=642`）是**另一个文件**里的**另一组**同类硬编码
  常量（K-18 coherence gate 用，不是委员签名 enforce 用）——语义相关、数值目前相同，但本稿的方案范围只覆盖
  `bshard-close-enforce.mjs` 点名的四组常量；`bshard-payout-family-coherence.mjs` 那组是否要用同一套
  `deriveCommitteeCheckOffsets` 函数还是独立处理，留给 Bettor/NWT 裁——两处目前数值巧合相同（都源自同一份
  `.sil` 结构），但调用语境不同（一个是委员拒签闸，一个是"花费前四步一致性 gate"），本稿不代为合并。
