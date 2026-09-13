# NWT 红队复核 · ZERO32 守卫两笔（`95e7c909` KanetTokenClaim / `32e480d9` T1 v0.7）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1163：①独立复现两条负向量；②判J2"未能把caret钉在V-T-12新require行"这份证据是否足够，
> 不够则指定一条能钉caret的构造；③两笔是否只含守卫、无业务逻辑掺入。

## 结论：**两笔均GREEN。①两条负向量独立复现一致；②我自己动手构造了"消除展开循环padding"的
新向量去驳斥/证实这条工具局限，结果是：不仅没能钉住caret，反而证明这不是"padding造成的不透明"，
是这个调试器对任何含for循环函数的失败定位能力本身就到不了行号——J2的lockstep+探针证据已经是这套
工具链能给到的证据上限，判定"足够"，不再要求J2补构造；③两笔diff逐行核过，各自只有一行新增
require（+一行/几行注释），无业务逻辑改动。**

## 一、①独立复现两条负向量

**`95e7c909`（KanetTokenClaim V-CLAIM-8）**：独立worktree，字节级重编译与`KanetTokenClaim.compiled.json`
一致；8个既有向量独立跑通8/8 PASS；把V-CLAIM-8的`expect`从`fail`翻成`pass`逼出verbose失败输出，
确认真实失败行精确落在新增那一行：

```
--> 90:13
89 |             //   target_owner 写成全零——后果不是"转移失败", 而是代币变成任何在场检查对全零恒真的攻击者都能花。
90 |             require(target_owner != byte[32](0x0000...0000));
   |             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ verification failed here
```
单帧、干净、caret精确指向新require——不是巧合落在别的检查行。**独立确认。**

**`32e480d9`（T1 v0.7 V-T-12）**：独立worktree，字节级重编译与`KanetTestToken.compiled.json`一致；
ctor末两位`max_ins=3, max_outs=3`独立核对无漂移；15条向量独立跑通（14 PASS + 1既有谐波翻转臂），
跟commit message的"14 passed, 1 failed"完全对应。**独立确认。**

## 二、②caret精度问题的判断——我自己动手验证，不是只读J2的README

**J2的原始处境**：V-T-12的`next_states`只有1个真实条目（`recv_idx=[3]`单元素），但ctor
`max_outs=3`——展开的for循环因此有2个"padding"迭代。J2用交互步进钉不住caret具体落在新require那
一行，改用"V-T-1(PASS)/V-T-12(FAIL)同步数逐点对照，第一段循环轨迹相同、分歧点夹逼到第二段循环"
+独立探针`ZeroHashProbe.sil`证守卫布尔语义本身正确，作为替代证据。

**我的假设（出发点）**：这个不透明区专门是"真实数组长度短于展开边界"造成的padding迭代惹的祸——
如果构造一个`next_states.length == max_outs`（3个真实条目，无padding）的向量，应该能像
KanetTokenClaim（无循环，caret已验证精确命中）一样把caret钉死。

**验证方法**：读透了这个debugger测试harness的参数绑定规则——`args`数组只显式传
`(prev_states, witness, owner_input_idx, recv_idx)`四个位置，**next_states不在显式args里，是
`binding=cov`按`tx.outputs`里跟本合约同covenant_id的输出数量自动收集的**（这条我一开始按"5参数"
理解构造第一版向量时踩了一次`"unsupported arg value for 'int'"`报错，读V-T-1/V-T-11a/V-T-12三条
既有向量的完整JSON逐字段对比后纠正）。据此构造了`tx.outputs`恰好3条同covenant_id输出（两条合法
owner=0x1111…、第三条owner=ZERO32的攻击条目，sum_in=sum_out=100满足守恒），`recv_idx=[2,2,2]`三元素
对齐，**第二段循环真实迭代3次=max_outs=3，零padding**。

**结果（比J2遇到的更差，不是更好）**：翻转`expect`逼出verbose输出后，caret落在`1:1`（文件开头
`pragma silverscript`那一行），不是任何`transferPolicy`函数体内的具体行；伴随一个巨大的、含多层
`::: called from pauseGuardOk`/`__covenant_policy_transferPolicy`嵌套帧、多处`<unavailable: negative
stack index>`占位符、且`next_states`字段在多个帧里被误报成跟`prev_states`相同值（60/40而非我构造的
30/30/40）的诊断dump——**跟KanetTokenClaim（单帧、caret精确、变量值全部可读）形成鲜明对照**。

**结论**：我自己动手把"padding"这个变量控制掉之后，caret精度**没有变好，反而彻底跌到最粗粒度**
（连"在哪个函数里"这一级都没能干净报出来，还夹带明显的变量快照错乱）。这推翻了"是padding造成
不透明"这个具体假设——**真正的边界是：这个版本的cli-debugger对任何含`for`循环的函数，失败定位
能力就是到不了源码行级别；KanetTokenClaim.spend()能精确定位，是因为它整个函数体没有循环**，跟
数组长度是否等于展开边界无关。既然我主动尝试构造的"应该更precise"的向量反而更差，说明**不存在
一条能让这个工具在T1 v0.7这类含循环函数上钉住caret的构造**——这不是J2没找对方法，是这版调试器
在这条能力轴上的天花板。

**处置判断**：**J2的"V-T-1/V-T-12同步数逐点对照+独立探针"证据链已经是这套工具链能拿到的证据上限，
判定足够，不再要求补构造**。如实记档：这是`cli-debugger`（silverscript v1.0.0）本身在含循环函数上
的定位能力局限，属于工具局限记录，不是这两笔fix的安全问题——两条负向量本身的通过/失败结果（V-CLAIM-8
`fail`、V-T-12`fail`）都已经用非交互`--run-all`独立确认为真，caret能不能钉到行号不影响"这个守卫
真的挡住了这个攻击"这个结论的可信度。

## 三、③业务逻辑掺入核查——逐行读diff，均为纯守卫新增

**`95e7c909`**（`kasia-console/src/lib/KanetTokenClaim.sil`）：diff只有
```diff
             target_owner = OpOutputCovenantId(dest_idx);
+            // (5行注释)
+            require(target_owner != byte[32](0x0000...0000));
```
路径(ii)原有赋值行未改，前后没有任何其它逻辑变动。`.compiled.json`/`.test.json`/`MANIFEST.sha256`/
`README.md`的改动均是该源码变化的必然连带产物（字节码因新增opcode偏移变化、新增负向量、digest
重算、文档记录），不构成独立审查对象。

**`32e480d9`**（`kasia-console/src/lib/sil-v1/KanetTestToken.sil`及`docs/provenance/...`下的
同源副本）：diff只有
```diff
             require(next_states[j].extension_commitment == byte[32](0x0000...0000));
+            // (5行注释)
+            require(next_states[j].owner != byte[32](0x0000...0000));
             sum_out = sum_out + next_states[j].amount;
             require(recv_idx[j] >= 0);
             require(ownerIsMarketInput(recv_idx[j], next_states[j].owner));
```
新require插入在既有检查链中间、原有五行（`sum_out+=`/`recv_idx>=0`/`ownerIsMarketInput`）位置
和内容都未变。同样，`.compiled.json`/`.test.json`/`MANIFEST.sha256`/`README.md`的改动是必然连带
产物。**两笔均确认：只有一行新增`require`（各配一段解释性注释），无任何其它业务逻辑改动。**

## 四、给Bettor的处置建议

- **两笔GREEN，可以定案**：`95e7c909`/`32e480d9`各自的负向量独立复现一致，diff范围核实干净。
- **caret精度问题裁定为工具局限，不退回补构造**：J2现有证据（lockstep对照+独立探针）已经是
  `cli-debugger`（v1.0.0，含循环函数）这条能力轴的上限，我自己主动构造反例验证过，结果更差不
  是更好。建议记入工具链已知局限清单（供以后含循环函数的负向量复核参考基线，不必每次重新论证）。
- 无新发现的安全问题。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
