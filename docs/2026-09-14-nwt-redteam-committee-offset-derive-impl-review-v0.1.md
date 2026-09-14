# NWT 红队复核 · committee-offset-derive.mjs基础设施实现(`1cbd6cae`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1243：新模块尚未接入调用点，独立可验证。审点：①`_REFERENCE_OFFSETS`确只作WARN比对；
> ②`_analyzeCompiledBuffer`对哨兵数量异常(0/多于1/落在entry外)是否全部fail-closed；③缓存key是否
> 还需含v100Path；④负向量②是否真调用了钉住的v1.0.0二进制；⑤1237④"两闸独立调用不共享结果"是否被
> 缓存key含sentinel的设计满足。

## 结论：**五点全部独立验证GREEN。①独立读代码确认`_REFERENCE_OFFSETS`只在`referenceMismatch`布尔
比对+WARN文案里出现，返回值的`predicateCommitOffset`/`poolMerkleRootOffsets`在读取`ref`之前已经算
完，不受它影响。②逐一核对`_analyzeCompiledBuffer`的每一处数量检查（10/4/dispatch_tag恰1次/落在
close_attest或cancel_attest之外/5+5/2+2/两法互证）——0、多于1、落在entry外三类异常全部落在"数量!==
期望值"或"找不到匹配区间"这两种通用检查里被throw捕获，没有任何分支漏判。③判断：sha256已经是"这个
二进制到底是什么"这个事实的完整摘要，两个不同路径指向字节相同的二进制理应共享缓存（也理应得到相同
派生结果），不含v100Path是对的，不是遗漏。④独立读+独立跑了N2负向量，确认它走`compileSilV100`（内部
必经`assertSilvercV100Pinned`+`assertSilvercV100GoldenSample`两道D-019校验），不是走任何legacy
compiler路径。⑤缓存key含sentinel这个设计独立确认成立，且已经用"不同sentinel触发真实独立重编译
（405ms>50ms门槛）"这条量化证据实测验证，不是只停留在设计意图层面。12/12测试独立复现全部PASS。**

## 一、①`_REFERENCE_OFFSETS`仅WARN比对——独立读代码确认

`grep`确认`_REFERENCE_OFFSETS`在文件里只出现两处：声明处 + `deriveCommitteeCheckOffsets`函数体内的
`const ref = isV2 ? ... : ...`这一行——**这一行在`_analyzeCompiledBuffer`调用之后才执行**（独立读了
函数体的执行顺序：先`compileSilV100`编译，再`_analyzeCompiledBuffer`算出真实`predicateCommitOffset`/
`poolMerkleRootOffsets`，然后才读`ref`做比对生成`referenceMismatch`布尔值，最后拼进`result`对象返回并
写入缓存）——**`ref`只影响`result.referenceMismatch`这一个字段+console.warn的文案内容，不影响
`result.predicateCommitOffset`/`result.poolMerkleRootOffsets`这两个真正被消费方使用的值**。独立确认
`_analyzeCompiledBuffer`函数体内（这是真正做结构校验、算出最终offset的地方）**不引用`_REFERENCE_
OFFSETS`一次**。

## 二、②哨兵数量异常全fail-closed——逐一核对每种情况

| 异常情况 | 代码位置 | 处理方式 |
|---|---|---|
| poolMerkleRoot哨兵命中数≠10（含0、含>10） | `pmrHits.length !== 10` | throw |
| predicate_commit哨兵命中数≠4（含0、含>4） | `pcHits.length !== 4` | throw |
| 某entry的dispatch_tag命中数≠1（含0、含>1） | `hits.length !== 1` | throw（`_deriveEntryRanges`内） |
| offset落在全部entry区间之外 | `_entryOf`找不到匹配区间 | throw |
| offset落在非close_attest/cancel_attest的entry里 | 逐一核对`name`归属 | throw |
| close_attest/cancel_attest分组数量不是5+5或2+2 | 显式核对 | throw |
| 位置排序法跟dispatch_tag法结果不一致 | JSON字符串比对 | throw |

**七类检查逐一独立读了对应代码行，全部走`throw new Error(...)`，没有任何一处用`console.warn`+继续
执行、或用默认值兜底跳过——"0次/多于1次/落在entry外"这三类Bettor点名的具体情形分别被表格第1/2行
（数量!==期望值同时覆盖0和过多两个方向）、第3/4行（dispatch_tag同一检查覆盖0/多次，entry外由
`_entryOf`覆盖）精确捕获，不存在漏判的分支。**

## 三、③缓存key不含v100Path——独立判断，无需补充

缓存key=`sha256(pin.sha256 + sourceSha256 + pmrSentinel + pcSentinel + isV2)`。独立推理：`pin.sha256`
在`assertSilvercV100Pinned(resolvedV100Path)`成功返回时，**根据这个函数自己的校验逻辑**（读文件实测
sha256、跟pin期望值比对、不等就throw、成功才return），此刻`pin.sha256`**必然等于**这个`v100Path`指向
的文件此刻的真实sha256——**这意味着"路径"这个信息已经通过"该路径下文件的sha256"完全携带进了key，
额外加v100Path字面值只会让"两个指向字节完全相同的二进制的不同路径"被错误地判定成"不同的东西"，制造
不必要的cache miss，不会带来任何额外的安全性**（因为cache命中的前提本来就是"同一个已经通过D-019 pin
校验的二进制+同一份源码+同一对sentinel"，跟这个二进制这一刻具体挂在哪个路径下无关）。**结论：sha256
本身已经充分，不含v100Path是对的设计，不是需要补的遗漏。**

## 四、④负向量②确认真走v1.0.0钉住的二进制——独立读代码+独立跑

独立读了N2负向量：`compileSilV100(mutatedPath, _ctorV2(PMR_S, PC_S), 'PayoutShardV2')`——**没有传
`v100Path`参数**，走的是`compileSilV100`自己的默认解析（`process.env.SILVERC_V100_PATH || 
DEFAULT_SILVERC_V100_PATH`），而`compileSilV100`函数体本身（本session此前a500d192那轮已审过、这次
独立重新确认没有被本commit改动一行）**在编译前必经**`assertSilvercV100Pinned`+
`assertSilvercV100GoldenSample`两道D-019双重校验——这意味着N2这条负向量走的必然是通过D-019 pin校验
的v1.0.0二进制，不可能是旧编译器（旧编译器连sha256校验那一步就会被拒，走不到真正编译这一步）。独立
`git worktree`+`npm install`后直接跑了完整测试文件：**12/12 PASS**，N2的具体断言（"结构性哨兵命中9次"）
独立复现一致。

## 五、⑤两闸独立性——缓存key含sentinel的设计已用量化实测证明，不只是设计意图

独立跑了P3测试并读了输出：**同参数第二次调用=5ms（远低于50ms门槛，确认缓存命中零子进程）；换一个
从未用过的随机sentinel=405ms（远高于50ms门槛，确认触发了真实的、独立的重新编译）**——这条不是靠读
代码"应该会这样"推断出来的，是真实计时数据证明"传不同sentinel=真实独立走一遍完整编译+校验流程，不会
命中另一个sentinel已经算好的缓存条目"。**这正是我`1ad41bb6`那次判断"算法可以共享,不共享'信任对方
已算过结果'这层耦合"的字面落地——只要`bshard-close-enforce.mjs`跟`bshard-payout-family-coherence.mjs`
两个未来的调用点确实各自传不同的sentinel常量（这是它们各自commit要落实的事，本commit的模块层职责是
"提供这个能力+让缓存key正确区分sentinel"，已经做到），两闸就真的是独立验证，不是互相信任。**

## 六、给Bettor的处置建议

- **五点全部GREEN，本笔（基础设施本体+测试）可以确认**。
- 下两笔（`bshard-close-enforce.mjs`拒签闸、`bshard-payout-family-coherence.mjs` K-18 gate）接入时，
  我会重点核实"两闸确实各自使用了不同的、专属的sentinel常量"这条——本笔只提供了"缓存key会正确区分
  sentinel"这个能力，真正的独立性要看接入代码是否真的传了两个不同的值。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
