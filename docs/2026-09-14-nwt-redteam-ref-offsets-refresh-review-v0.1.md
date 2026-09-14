# NWT 红队复核 · T-REF-OFFSETS-REFRESH（`5d545c28`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1290：审参考值仍只作WARN比对、无任何行为变化、数值与我`8144f071`独立测得一致。

## 结论：**GREEN。独立重跑四个测试文件全PASS，`referenceMismatch`正确变为`false`；独立diff确认
`deriveCommitteeCheckOffsets`函数体零改动，只改了`_REFERENCE_OFFSETS`数据常量+注释；新值
16411/[16931,...]/16569/[17089,...]跟我自己此前两次独立编译测出的值逐字节一致（`09ed3772`T4
工具审查、`8144f071`整线终审）——第三次独立交叉验证收敛到同一数字。**

## 一、独立重跑四个测试文件

另建独立worktree（真`npm install`，非symlink，junction检查前后均0跨树）跑：
- `committee-offset-derive.test.mjs`：**ALL PASS**，P1断言`referenceMismatch===false`通过。
- `payoutshardv2-offset-tripwire.test.mjs`：**ALL PASS**，cross-gate agreement输出里
  `referenceMismatch:false`（V1/V2两族均如此）。
- `bshard-payout-family-coherence.test.mjs`：**all checks passed**。
- `bshard-payout-coherence-perf.test.mjs`：**all checks passed**，零spawn证据（0.13-0.15ms/call
  远低于安全边际0.41ms）未受影响。

## 二、独立diff确认改动范围

`git diff`确认`committee-offset-derive.mjs`只有两处变化：注释更新+`_REFERENCE_OFFSETS`常量数值
（`518/[1002,...]`→`16411/[16931,...]`，`642/[1126,...]`→`16569/[17089,...]`）——`deriveCommitteeCheckOffsets`/
`_analyzeCompiledBuffer`等计算函数体逐字未动。`committee-offset-derive.test.mjs`只有P1一处断言从
`===true`翻转为`===false`，符合"flip-expect"预期（参考值刚刷新，新鲜派生应该与其一致而非不一致）。

## 三、数值交叉验证——第三次独立收敛

新参考值`predicateCommitOffset=16411(V1)/16569(V2)`、`poolMerkleRootOffsets=[16931,17227,17523,
17819,18115](V1)/[17089,17385,17681,17977,18273](V2)`——跟我自己此前**两次完全独立**的编译验证
结果（T4工具审查`09ed3772`用自己另写的探测脚本编译PayoutShard/PayoutShardV2；整线终审`8144f071`
的独立编译+tripwire重跑）逐字节完全一致。这次是WARN-not-block机制本身第三次独立收敛到同一数字
（我的两次编译动作 + 生产console两次真实启动的运行时派生），不是转述同一个来源。

## 四、语义确认——WARN-only不变

独立读代码确认：改动范围内没有任何`throw`/`return`/`process.exit`相关的新增或删除，`referenceMismatch`
字段仍然只是一个可观察的boolean，唯一消费方仍是`console.warn`（留痕不拒签）——刷新参考值本身不改变
"WARN不阻断"这条既有语义，只是让当前这套已知合法的.sil下WARN不再是永远触发的噪音。

## 五、给Bettor的处置建议

- **GREEN，可以合并**。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
