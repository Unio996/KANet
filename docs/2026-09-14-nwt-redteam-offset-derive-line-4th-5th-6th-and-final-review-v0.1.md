# NWT 红队复核 · 偏移线第4/5/6笔（`8e6a630a`/`a55ebdfb`）+ **整线终审**

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1266：审第4/5/6笔（8e6a630a ctimeMs / e3237844 只读实测已在1259/1263审 / a55ebdfb tripwire重写+
> 永久矩阵），并给整线终审——判据：1237四点、1247预热、1256/1263 (A)永久矩阵、ctimeMs、tripwire三件、
> 旧常量计算路径全线零残留、`bshard-consolidated-pool-rederive.test.mjs` 挂起原因。

## 结论：**整条 offset-derive 线（`1cbd6cae`→`808011fa`→`ca8dafdb`→`e3237844`→`8e6a630a`→`a55ebdfb`）
GREEN，Codex 1256 HOLD 从 NWT 侧可以宣布解除——全部判据独立复现通过，不是转述 J2/Bettor 自报。发现一条
不在本线范围内、但同族的残留问题：`pool-shard-settle.mjs` 的 `enforceCommitteeSign` 仍带一个 D-019
迁移前的硬编码 `_PREDICATE_COMMIT_REDEEM_OFFSET=518`（现在真实值是16411，差了近16000字节），但独立确认
该函数**零活跃调用点**（`bshard-close-voter.js` 头注自述它是 Track B daemon 取代的"test driver/probe
only"路径，真实生产签名走的是已迁移的 `bshard-close-enforce.mjs`）——不阻断本线终审，建议另开一张清理票，
理由见§五。**

## 一、独立复现 e3237844（ctor 宽度矩阵）——不信 J2 自报，自己重新编译验证

自建 worktree（`a55ebdfb`），自己写探测脚本（不用 J2 的 gitignored scratch 脚本），独立调用生产同一入口
`compileSilV100`/`ctorIntV100`/`ctorBytes32V100`，对 `PayoutShard.sil`/`PayoutShardV2.sil` 跑同一矩阵
（`0/1/255/256/2^31/2^40/-1/MAX_SAFE_INTEGER`）+ V2 的 `attestedWinner`/`attestedAtMs`：**独立跑出的
baseline 长度/哨兵位置与 J2 文档记录的数字逐字节相同**（V1 len=32779, pmr=[16931,...]; V2 len=29328,
pmr=[17089,...]），全矩阵零漂移，跟 J2 claim 完全一致——这次不是读文档相信，是自己重新跑了一遍编译器。

独立 `grep -c "as byte\[8\]"`：V1=68、V2=54（跟 Bettor 转述的数字一致）；进一步独立定位到具体触发行
（`PayoutShard.sil:200-219` 的 `newStateBytes` 构造，`consolidated_pool`/`closed`/`w0..w16` 全部走
`byte[](8 as byte[1]) + byte[](x as byte[8])` 定宽 cast）——不是泛泛的关键词命中，是找到了 state 区拼装
的具体源码行并确认字段名对应关系。**结论：Bettor 1263 (A) 判定成立，独立验证不是转述。**

## 二、`8e6a630a`（ctimeMs 加固）——独立重放绕过实验，确认修复真实生效

拿自己在 `ca8dafdb` 审查时用过的同一手法（`Set-ItemProperty` 回拨 mtime）重新攻击**修复后**的
`_cachedFileSha256`：这次构造了"内容真变化+事后把mtime也spoof回同一个旧值"的组合动作（比上次单纯spoof
mtime更贴近真实攻击者会做的事——上次只测了"mtime单独被spoof、内容没变"这一半），独立实测结果：**换键前的
(mtimeMs,size)会被这个组合绕过，换键后的(mtimeMs,ctimeMs,size)正确检测到内容变化并重新计算哈希**——
`NOT BYPASSED`。修复方向与我在 `ca8dafdb` 审查里给的建议完全一致，且成本确认为零（同一次 `statSync` 已带
`ctimeMs`）。

一处文档小瑕疵（不影响正确性，供参考）：`assertSilvercV100Pinned` 上方注释仍写"文件真的被换掉(mtime/size
任一变化)会自动触发重新哈希"，没有同步加 ctimeMs——纯注释滞后，不影响代码行为，不需要单独开票，下次touch
这段代码时顺手改一下即可。

## 三、`a55ebdfb`（第4笔：tripwire 重写 + P4 永久矩阵）——独立重跑两个测试文件，全部PASS

### 3.1 `committee-offset-derive.test.mjs` 的新 P4 段

独立读代码确认覆盖面：V1 `consolidatedPool`×8矩阵值 + `closed`×3 + `w0..w16`随机大整数×1组 + 4个bytes32
字段随机×1组；V2 `consolidatedPool`×8 + `attestedWinner`×3 + `attestedAtMs`×8(含2^40/2^46等 bounds-guard
边界) + `w0..w16`随机×1 + 7个bytes32字段随机×1组——**独立确认这覆盖了 Bettor 1263 明确要求的扩展项
（w0..w16 非零随机 + 随机 bytes32），不是只补了矩阵值那一半**。独立跑 `node committee-offset-derive.test.mjs`：
**P1-P4/N1-N4 全部PASS**（含此前已审过的P1-P3/N1-N4，本次连带重跑确认第4笔没有破坏既有断言）。

### 3.2 `payoutshardv2-offset-tripwire.test.mjs` 整篇重写

独立读代码确认三件事的实现方式：
- **① instance-binding**：用两道闸各自的哨兵（`a1.../c2...`、`d3.../e4...`）派生偏移，套到一份用**完全不同
  的第三组值**（`5a.../6b...`，跟两道闸的哨兵都不同）真实编译出的 redeem 上取字节，断言取出来的字节精确
  等于编译时喂的真实值——**这正是 Codex 1256 偏好的 (B) 方案的核心断言，被做成了永久回归测试**（虽然生产
  派生本身仍走 (A) 占位ctor路线，但每次跑测试都会验证"如果套到独立真实产物上会不会取错"这条 instance-
  binding 性质，不是只信结构计数）。
- **② cross-gate agreement**：`enforceV1`/`k18V1`（不同哨兵）独立各自触发一次真实派生，断言数字偏移相同。
- **③ referenceMismatch 只WARN不throw**：断言字段存在且为boolean。

独立`grep`旧硬编码数字（642/1126/.../518/1002/...）：**全文件仅1处命中，且落在文件头部注释里解释"为什么
重写"（历史对照，不参与任何断言/计算）**——跟 Bettor 转述"grep旧数字1命中，核为注释非计算输入"完全一致，
不是我漏查。独立跑 `node payoutshardv2-offset-tripwire.test.mjs`：**全部PASS**（V1/V2×两道闸×①②③全绿，
输出的偏移数字跟我自己在§一独立算出的16411/16569一致）。

## 四、`bshard-consolidated-pool-rederive.test.mjs` 挂起原因——独立核实，跟本线无关

独立`git log`确认这个文件最后一次改动是 `eafc7e91`（5b笔，D-019 pin迁移的一部分），本条`offset-derive`线
（`1cbd6cae`起）**零处touch过这个文件**（`git diff --stat` 5c21e7b7..a55ebdfb 对该路径为空）。独立读文件
头注确认它的性质：这是 #28 P0（consolidatedPool rederive fail-closed，跟 offset-derive 完全是两张不同的
票）的回归测试，第一步显式连 `ws://127.0.0.1:17210`（本机 kaspad WS）——**独立`netstat`确认本机当前
17210端口未监听**，这就是它在本环境"挂起"（实际是connect超时/hang，不是死循环bug）的直接原因：**这个测试
天然需要一个活的本机testnet节点才能跑完，不是本次offset-derive线引入或掩盖的问题，是这个测试本身一直以来
的既有前提条件（文件自己的注释也承认"POSITIVE Tier2 path需要live-fire real testnet funds测试，不是本文件
职责"）**。不阻断本线终审。

## 五、意外发现（不在本线范围内，独立追查，建议另开票）：`pool-shard-settle.mjs` 的死硬编码 offset

在核对"旧常量计算路径全线零残留"这条判据时，`grep -rn "_PREDICATE_COMMIT_REDEEM_OFFSET"`发现除了
`bshard-close-enforce.mjs`(注释里的历史对照,已确认非计算)之外，**`pool-shard-settle.mjs:269` 还有一个
真实的、仍在参与计算的同名常量**：`const _PREDICATE_COMMIT_REDEEM_OFFSET = 518;`，第285行真的用它去
`.slice(518, 550)` 从 redeem hex 里抠 `predicate_commit`，喂给 `enforceCommitteeSign` 命门①的 hash-bind
校验。这个 518 是 D-019 tokenization**之前**（注释自称"provenance-pinned 873e799e"）的旧值——我在§一独立
测出当前 V1 真实 `predicateCommitOffset` 是 **16411**，跟 518 差了近16000字节，如果这条路径真的在生产被
调用，`onChainPredicateCommit` 会读出完全不相关的字节，`predHash !== onChainPredicateCommit` 恒真，委员
会对着任何真实市场恒定拒签（fail-closed 表现，不是被绕过的表现，但这是"该函数从未被正确执行过"的信号，
不是"安全"的信号）。

**独立追查是否真的活跃**：`grep -rn "enforceCommitteeSign"` 全仓零个非注释调用点；`bshard-close-voter.js`
文件头自己的注释明确说明这条函数是 Track B daemon（本线已迁移完成、真实生产使用的
`bshard-close-enforce.mjs::enforceCloseAttest`）**取代之前**的旧路径，原话"盲签 + enforceCommitteeSign
只 test driver/probe 调"——独立确认这不是我猜的免责声明，是设计者自己在做 Track B 迁移时就已经点名这条
函数的性质。**结论：这是一处真实存在、但确认零活跃调用点的死代码残留硬编码 offset，不构成本线的生产风险，
但建议另开一张清理票（删除该函数，或至少把常量改成调 `deriveCommitteeCheckOffsets`/加一条"仅供历史参考,
禁止在新代码里调用"的显眼警告），理由：它是"硬编码 offset 会静默过期"这条本线核心风险的活体标本，留着不清
理，未来某次"顺手复用现有函数"式的重构很容易把它错误地接回真实路径。**

## 六、整线终审——逐条判据独立核对

| 判据来源 | 结果 |
|---|---|
| NWT 1237 四点(dispatch_tag主路径/K-18独立性/缓存key含双sha256/负向量≥3条) | 独立跑通 N1-N4，✅ |
| NWT 1247 启动预热4键+失败路径无静默 | `ca8dafdb`审时已独立验证，本次未变更，✅ |
| Codex/Bettor 1256+1263 (A)永久矩阵(含w0..w16随机+bytes32随机) | 独立重跑P4全部PASS，✅ |
| ctimeMs 加固 | 独立重放攻击确认修复生效，✅ |
| tripwire三件(instance-binding/cross-gate agreement/WARN-not-block) | 独立重跑全部PASS，✅ |
| 旧常量计算路径全线零残留 | `bshard-close-enforce.mjs`/`bshard-payout-family-coherence.mjs`确认零残留；
  发现`pool-shard-settle.mjs`一处死代码残留(§五)，确认零活跃调用，不阻断 |
| `bshard-consolidated-pool-rederive.test.mjs`挂起原因 | 确认是需要本机活kaspad的既有前提，跟本线无关 |

## 七、给Bettor的处置建议

- **整线GREEN，Codex 1256 HOLD 可以从NWT侧宣布解除，可以合主线**。
- 建议另开一张小票清理 `pool-shard-settle.mjs::enforceCommitteeSign` 的死硬编码 offset（§五），不阻塞
  本次合并——它零活跃调用点，不是生产风险，是"以后可能被误接回"的卫生问题。
- `assertSilvercV100Pinned` 头注一句 ctimeMs 滞后的小文档瑕疵，不需要单独票，下次touch顺手改。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
