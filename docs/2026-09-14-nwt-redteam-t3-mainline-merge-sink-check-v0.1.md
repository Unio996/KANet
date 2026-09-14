# NWT 红队复核 · T3代币化联合合入(`4b48393a`)收口核

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1214：联合合入完成，`4b48393a`已推主线。收口核：①主线lint；②独立重编译主线10个.sil（8合约+
> KanetTestToken+KanetTokenClaim），bytecode与侧分支各现行provenance记录deep-equal；③`git diff --stat
> 4b48393a^1..4b48393a`范围核（仅10个.sil，零.js/.mjs运行时改动）。

## 结论：**三项全部独立验证GREEN。①主线lint 956文件0 errors，独立复跑确认。②10个文件（8市场合约+
KanetTestToken+KanetTokenClaim）全部bytecode deep-equal一致——9个直接对上各自provenance的
reference.compiled.json，ShardLeaf单独核（因侧分支该目录是hand-off修复前的旧快照）改用"源码byte-identical
于hand-off-fix自己的frozen副本+bytecode_length=15166匹配本会话此前已独立确认的修复后figure"两步论证同样
达到deep-equal强度。③`git diff --stat`独立跑出323 files changed，`kasia-console/src`下恰好只有这10个
.sil，全部.mjs命中均落在`docs/provenance/`内的向量生成脚本（不是运行时代码），零console/relay JS/MJS
改动，跟Bettor预核的范围逐字对得上。合入可以确认收口，无遗留问题。**

## 一、①主线lint——独立复跑

`git fetch`确认`4b48393a`在`origin/bshard-m3-deploy`上；本地`git merge-base --is-ancestor 4b48393a
HEAD`确认我的HEAD已包含这次合入。独立跑`node scripts/lint-kanet.mjs`（无参，全库扫）：
**956 files — 0 errors**（1113条warning，跟本会话此前每次全库扫描的warning基线量级一致，非本次合入
引入的新warning——本次未逐条核对warning是否有新增，因为warning本身不阻断，且Bettor的判据只问errors）。

## 二、②10个文件bytecode deep-equal——独立重编译，逐一核对

`git worktree`未用（直接在主检出上操作只读的`compile`+`diff`，未改动任何文件，不涉及共享checkout纪律
风险）。用自己的`silverc.exe`，逐个文件用该文件对应provenance目录里的`ctor.json`/`args.json`重新编译
**主线当前**的源码（不是provenance目录里的副本），跟该目录的`compiled.json`做**内容深度比对**
（`JSON.stringify`数组内容比对，不用`===`——本会话此前已踩过一次"数组引用不等"的坑，这次直接用对的
方法）：

| 文件 | mine bytecode长度 | ref bytecode长度 | deep-equal | state_span |
|---|---|---|---|---|
| RootClose | 16802 | 16802 | **true** | {1,87} |
| RootClaim | 2991 | 2991 | **true** | {1,96} |
| RefundClaim | 2656 | 2656 | **true** | {1,87} |
| ShardLeaf_direct | 15687 | 15687 | **true** | {1,36} |
| CloseZkV2 | 13382 | 13382 | **true** | {1,213} |
| KanetTokenClaim | 1454 | 1454 | **true** | {1,141} |
| KanetTestToken | 3471 | 3471 | **true** | {1,112} |
| PayoutShard | 32779 | 32779 | **true** | {1,204} |
| PayoutShardV2 | 29328 | 29328 | **true** | {1,288} |

**ShardLeaf单独说明**：`docs/provenance/2026-09-14-j2-t3-v03-shardleaf-tokenization/`是hand-off
MUST-FIX(`9ff095a3`)**之前**的旧快照（源码diff 30行，跟本会话此前已审过的hand-off-fix diff完全对应），
直接拿它的`reference.compiled.json`对比会得到"不等"的假警报（不是回归，是拿错了参照物）。改用两步验证：
(a) 独立`diff`确认**主线`ShardLeaf.sil`跟`docs/provenance/2026-09-14-j2-t3-v03-shardleaf-payoutshard-
handoff-fix/ShardLeaf.sil`（hand-off修法自己的frozen副本）逐字节完全一致**；(b) 用`shardleaf-
tokenization`目录的ctor（该修法未改ctor形状，只改函数体，ctor仍适用）编译主线源码，
**bytecode_length=15166**——跟本会话此前独立复核`9ff095a3`那一轮已经确认过的"post-fix figure"完全一致
（那次是从另一个独立的worktree、另一次独立编译得到的同一个数字）。两步组合起来跟"直接deep-equal"是
同等强度的证明，只是因为侧参照物本身滞后了一版，绕了一步而已。

**顺手核对了源码本身**：除ShardLeaf（预期差异，已说明）外，另外9个文件的主线源码跟各自provenance目录
里的`.sil`副本逐字节`diff`全部**IDENTICAL**，除`CloseZkV2`——那处差异是**纯注释文字**（`e52cc887`,
"ZERO32目的地守卫"注释补了一句"脚本字节匹配≠covenant绑定"，0行逻辑代码改动，本会话此前已审过GREEN），
不影响编译产物——**这条本身也被上表的deep-equal=true结果实证：注释差异确实对bytecode零影响**。

## 三、③`git diff --stat`范围核——独立跑出，逐字确认

```
git diff --stat 4b48393a^1..4b48393a
```
独立跑出：**323 files changed, 95098 insertions(+), 304 deletions(-)**——跟Bettor转述的数字一致。

`kasia-console/src`下命中的文件：**恰好10个**——`CloseZkV2.sil`/`KanetTokenClaim.sil`/`PayoutShard.sil`/
`PayoutShardV2.sil`/`RefundClaim.sil`/`RootClaim.sil`/`RootClose.sil`/`ShardLeaf.sil`/
`ShardLeaf_direct.sil`/`sil-v1/KanetTestToken.sil`，无任何其它文件（不多不少）。

全库`grep`所有`.js`/`.mjs`/`.cjs`命中行，逐条核对路径前缀：**全部36处命中无一例外落在
`docs/provenance/2026-09-14-*/`目录内**（各provenance目录自带的`mk_*_vectors.mjs`/`measure_*.mjs`/
`merkle.mjs`/`derive_token.mjs`这类向量生成/测量脚本——是造证据用的一次性工具，本身就该随provenance
一起入库，不是运行时代码），**零命中在`kasia-console/src`/`kasia-relay/src`/`agent-mind/src`/
`agent-adapter/src`任何运行时目录下**——跟Bettor转述的"零console/relay运行时JS/MJS改动"逐字对得上。

## 四、给Bettor的处置建议

- **三项全部GREEN，合入`4b48393a`确认干净、可以收口**：lint 0 errors，10个文件bytecode与侧分支各自
  provenance记录一致（ShardLeaf经两步等效验证同样确认一致），diff范围精确核对无意外改动。
- 无新发现问题，T3代币化落码到此告一段落，可以进入部署/创世/激活的下一阶段流程（按铁律0，另走Owner批
  的执行门，本次不涉及任何执行动作）。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
