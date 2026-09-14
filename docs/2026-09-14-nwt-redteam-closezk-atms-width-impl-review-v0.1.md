# NWT 红队复核 · T-CLOSEZK-ATMS-WIDTH落码两笔（`78b3bd2f`/`f45efd5f`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1301：①2^48向量确走新断言而非旧闸；②helper抽取后dummy路径字节级不变；③交叉校验用的真实值
> 确与dummy不同、四段边界确从真实产物切出。

## 结论：**两笔均GREEN。三点均独立验证通过，其中②做了一次直接的before/after二进制对照（不是读代码
推断），逐字节相同。**

## 一、①2^48向量确走新断言——独立确认绕过路径

独立读`closezk-v2-mint-atms-width.test.mjs`：测试直接调用`assertSixByteEncodable`本体和
`compileCloseZkV2Redeem`，**不经过**`readPayoutShardV2AttestedState`（既有`[2^40,2^47)`数值闸所在
位置）——独立重跑：`2^48-1`真编译成功（非空redeem hex，len=26766）、`2^48`在**0ms**内throw（远小于
真实silverc子进程调用~350-400ms耗时），错误信息独立确认指名`assertSixByteEncodable`。**独立确认这
条向量真的在测新断言自己的阈值，不是重跑旧闸**——跟我在`4f659405`指出的缺口对应的修法完全对齐。

## 二、②helper抽取后dummy路径字节级不变——直接binary对照，非读代码推断

独立另建两个worktree（真npm install，均confirm 0 cross-tree），一个签出`f45efd5f`（重构后）、一个
签出`78b3bd2f`（重构前，`computeCloseZkTmplAnchor`仍是原地inline的findUnique+切分逻辑），用完全相同
的固定输入（`gateTmplHash='ab'×32`/`tokenTmplHash='c1'×32`/`claimTmplHash='c2'×32`/
`marketSuffixHash='c3'×32`）各自独立调用`computeCloseZkTmplAnchor`，对比输出：

```
anchorHex: 775de2d4d20a9674304d95d6e288d18130d71eb9d4c9ad1ba0c0e8574f90687a  （两边完全相同）
templateA/B/C/D 的十六进制前缀+长度：两边完全相同（734/1157/1007/10199字节）
```

**逐字节相同**——不是读了diff觉得"逻辑等价应该没问题"，是真的在两个独立进程里各自编译+切分了一遍，
拿到完全相同的输出。②确认属实。

## 三、③交叉校验用真实值+四段边界确从真实产物切出——独立重跑+读断言逐条核对

独立重跑`closezk-v2-anchor-crosscheck.test.mjs`：
- 正向：独立确认测试用的`attestedAtMs=2^41+123456789`（跟`dummyAtMs=1783500000000`不同，且落在生产
  真实值域`[2^40,2^47)`内）、`betsRootBaked='d1'×32`/`refundRootBaked='d2'×32`（跟dummy的`11...`/
  `22...`不同）、`attestedWinner=1`/`consolidatedPool=987654321`（跟dummy的`0`/`1`不同）——独立确认
  这是一次真正独立的`compileCloseZkV2Redeem`真编译，不是复用dummy编译产物。四段模板逐字节相等：
  `templateA/B/C/D`（734/1157/1007/10199字节，跟②的dummy长度一致，符合预期——四段长度不该因为state
  区之外的值变化而变化）全部PASS，附带的`anchorHex`交叉验证同样一致。
- 负向：独立确认换了`gateTmplHash`后确实检测出`templateB`不一致（`B equal=false`，其余A/C/D仍
  `true`）——独立确认这条测试不是摆设，真的会在输入不同步时抓到差异；断言写法（"四段不是全部相等"而
  非硬编码具体哪一段）避免了对`.sil`未来微调后差异落在哪一段这种无关细节的过度敏感，判断合理。

**独立确认`_sliceCloseZkTemplateSegments`共享函数被dummy路径与回归测试真实调用同一份实现**（读
`pool-shard-register.mjs`确认`computeCloseZkTmplAnchor`内部已改成调用该导出函数，不是各写一份）。

## 四、其它独立核对

- 既有回归`bshard-close-enforce.psv2-read.test.mjs`独立重跑：全PASS，无回归（含`[2^40,2^47)`数值闸
  自己的既有回归仍然存在，不受本次改动影响）。
- lint四个改动/新增文件（`closezk-v2-mint.mjs`/`closezk-v2-mint-atms-width.test.mjs`/
  `pool-shard-register.mjs`/`closezk-v2-anchor-crosscheck.test.mjs`）：0 errors。
- worktree junction检查：两次独立worktree创建+移除，前后均确认0跨树。

## 五、给Bettor的处置建议

- **两笔均GREEN，可以合并**。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
