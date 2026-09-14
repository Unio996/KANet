# NWT 红队复核 · absorb sole-source MUST-FIX(`e0ae924a`/`adc37c0a`) + 现行向量套件(`a8d05729`/`18c5d4c6`/`18c000b0`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1210：Codex 6e1cec04发现——absorb未证明shardInIdx唯一性，双leaf场景另一个被静默销毁。J2落码
> `countStrayNonOwnedTokenInputs`+两条require。按四判据复现：①双leaf caret落点②43+44全过③AB11重量
> ④旧目录注记核。顺带判V-absorb-3停用理由是否成立。

## 结论：**四判据全部独立验证GREEN。双leaf负向量在PayoutShard/PayoutShardV2两文件上均精确caret落在
新增的`countStrayNonOwnedTokenInputs(...)==0`这条require（不是被别的检查先拦），43/43+44/44独立跑通，
AB11常量（state_span/bytecode）字节级零漂移，旧目录状态注记准确区分"真陈旧superseded"与"折叠但仍
有效"。V-absorb-3停用理由成立——"陌生人代币"与"被静默销毁的合法leaf"在covenant能看到的字段层面确实
无法区分，一律拒绝是正确的fail-closed默认，V-SSF-4确认是同场景的正确后继向量。GREEN，可以合入。**

## 一、修法本身——独立读源码确认逻辑

`countStrayNonOwnedTokenInputs(tok_prefix, tok_suffix, excludeIdx)`：同`scanOwnedTokenInputs`同形扫描，
排除`excludeIdx`后，对每个"尾部匹配`tok_suffix`"（P13既有tail-match启发式，本会话已多次审过的机制）的
输入读`TokenState`，统计`owner != self`的个数。`absorb`新增两条require：`shardTk.owner != self`（挡"自己
已持有代币冒充新纳入"的重复入账）+ `countStrayNonOwnedTokenInputs(..., excludeIdx=shardInIdx) == 0`（证明
`shardInIdx`是本笔交易里唯一的非自持同模板代币输入）。两条require组合起来证明"非PS持有的同模板代币输入"
这个集合恰好只有一个成员，且就是`shardInIdx`——跟Codex要的"sole-source"证明形状吻合。`PayoutShardV2.sil`
确认是逐字同构复制（`absorb`历来就是`PayoutShard.sil`的逐字复制，这条修法维持这个既有约定）。

## 二、①双leaf负向量caret——两文件均精确confirm

独立`git worktree add`到`18c000b0`（本次stack的头），用自己的`silverc.exe`/`cli-debugger.exe`（不信
`compiled.json`快照，从`.sil`源码+ctor重新编译）：

- **PayoutShard**：`V-SSF-2_fail_dual_leaf_only_one_named_other_silently_destroyed`flip-expect逼出
  verbose——精确落在**187行**`require(countStrayNonOwnedTokenInputs(tok_prefix, tok_suffix, shardInIdx)
  == 0);`，变量dump里`__inline_12_countStrayNonOwnedTokenInputs = 1`（确认helper真的算出了那个被遗漏的
  第二个leaf，不是凑巧在别处失败）。
- **PayoutShardV2**：同一条向量精确落在**173行**同一条require，`__inline_12_countStrayNonOwnedTokenInputs
  = 1`同样确认。

**这是本次复核的主判据，两文件均精确通过，不是被别的require碰巧先拦住。**

**额外diligence（非Bettor要求的四判据之一，顺手核的）**：也caret了`V-SSF-3_fail_shardInIdx_already_
self_owned_double_credit`（PayoutShard）——精确落在**186行**`require(shardTk.owner !=
OpInputCovenantId(this.activeInputIndex));`，跟V-SSF-2落在187行不同——**确认两条新增require各自独立
承重，不是其中一条实际上什么都没挡、只是被另一条覆盖着看起来在生效**。

## 三、②43/43 + 44/44现行套件——独立跑通

同一个worktree里：`git ls-files`确认n/n MANIFEST.sha256全部校验通过（两个current-suite目录）；独立
`--run-all`跑通：**PayoutShard 43 tests: 43 passed, 0 failed**；**PayoutShardV2 44 tests: 44 passed,
0 failed**——跟两笔commit声称的数字完全一致，不是抽样复现。

## 四、③AB11常量重量——字节级零漂移

用与`current-suite`目录里`reference.ctor.json`完全相同的ctor独立重新编译两个文件，深度比较（数组内容
逐元素比对，不是`===`引用比较——第一次尝试直接`===`比较得到`false`，排查后发现是JS数组引用不等而非内容
不等，改用`JSON.stringify`深度比对确认真正的内容相等，这个方法论坑本身记在这里供以后同类核对参考）：
`PayoutShard.sil`：`bytecode_length=32779`，字节数组deep-equal=true，`state_span={offset:1,len:204}`；
`PayoutShardV2.sil`：`bytecode_length=29328`，deep-equal=true，`state_span={offset:1,len:288}`——跟修法
前的既有记录（本会话此前已确认过的{1,204}/{1,288}）完全一致，**零漂移**。

## 五、④旧目录状态注记——独立读取，准确区分两类

读了全部8份相关README（PayoutShard 4份 + PayoutShardV2 4份）的状态注记原文：**真陈旧/superseded**类
（`payoutshard-absorb-ab11-and-batest`23→25参数、`drawdown-mustfix`裸P2PK签名已变、`payoutshardv2-
absorb-batest-ab11`28→30参数、`payoutshardv2-zkhandoff-tokenization`28→30参数——四份均明确写"不适用
重跑（历史陈旧，非本次回归）"+指向current-suite）跟**折叠但仍有效**类（`payoutshard-claim-family-
tokenization`/`payoutshard-absorb-sole-source-fix`/`payoutshardv2-refundclaim-tokenization`/
`payoutshardv2-absorb-sole-source-fix`——四份均明确写"不是历史陈旧……两处不冲突"）**区分清楚、措辞
准确，没有把两类混着写成一句笼统的"已处理"**。

## 六、V-absorb-3停用理由——独立判断，成立

**判断（不是照抄commit message的结论，自己推了一遍）**：修复前的`V-absorb-3`测的场景是"一笔无关陌生人
的同模板代币恰好在场，不应该被计入，absorb应该照常通过"。修复后这个场景**结构性地**变成必拒——问题是：
这个改动是不是"矫枉过正"，误伤了原本无害的场景？

**独立推理**：`countStrayNonOwnedTokenInputs`能看到的字段只有——同模板（tail-match对`token_tmpl_hash`）、
`owner != self`、下标`!= shardInIdx`。一个"真的无关的陌生人的合法代币"跟一个"本该被`shardInIdx`说明却
被遗漏的合法ShardLeaf"，在这三个字段上**完全同构、无法区分**——covenant拿不到任何链下语义信息（谁的
意图是什么、这笔代币本来是要去哪）来分辨这两种情况。**在两个场景结构上不可分辨的前提下，一律拒绝是唯一
安全的选择**：如果选择"一律放行"，就是回到修复前的漏洞（真放行了"被遗漏的合法leaf"这个场景，代币被
销毁）；如果试图"选择性放行"，需要一个能分辨两者的信号，而这个信号在当前架构下不存在（加一个witness
供的"我保证这是无关的"标记，只是把决定权交还给可能作恶/出错的调用方，等于没有加保护）。**这跟本会话
建立的ZERO_HASH审查纪律里"两种情况结构上不可分辨时必须都拒绝"是同一类推理**（Codex四类规则(d)条、
`predicate_commit`的`blake2b(x)!=x`同源设计哲学）——不是这次临时发明的新原则，是这个代码库一贯的
fail-closed默认。

**代价评估**：这条"一律拒绝"确实会拒绝一个原本无害的场景（陌生人代币恰好在同一笔tx里）——但这是一个
**可控的活性成本**，不是安全妥协：真实交易由console侧代码组装，只要组装absorb调用时不顺手把无关的
市场代币塞进同一笔tx的输入列表，这个场景现实中不会被真实触发，是tx构造层面能规避的约束，不是end user
面对的限制。

**V-SSF-4继承确认（独立核对，不只信README的转述）**：读了旧`V-absorb-3`的`args`（`[0,3,3,50,...]`）跟
新`V-SSF-4`的`args`（`[0,2,2,50,...]`）——下标数字因ctor/tx形状变化而不同，但结构完全同形
（`selfOutIdx=0, shardInIdx=X, [无关代币下标]=X, shard_amount=50`），确认V-SSF-4确实是同一个场景的
正确后继版本（只是期望值从`pass`改成`fail`），不是凑巧同名但内容不同的替代品。

**判断：V-absorb-3停用理由成立，reject-always是正确的fail-closed默认，不是回归。**

## 七、给Bettor的处置建议

- **四判据全部GREEN，可以合入主线**：双leaf caret精确、43+44独立跑通、AB11零漂移、旧目录注记准确。
- V-absorb-3停用理由经独立推理确认成立，不是矫枉过正——两个场景在covenant可见字段层面结构上不可分辨，
  一律拒绝是唯一安全选择，代价（可控的tx构造层活性约束）合理。
- 本次未发现新的安全问题，GREEN后可以按你说的请Codex解HOLD。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
