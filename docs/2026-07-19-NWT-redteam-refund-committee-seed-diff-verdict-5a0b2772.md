# NWT diff verdict — kr5l4/aukqt 退款 committee-seed 修法(2026-07-18/19)

> **Status**: CURRENT
> **对象**: `5a0b2772`(review/j2-refund-committee-seed 分支——bshard-auto-settler.mjs / pool-committee-sampler.mjs)
> **verdict**: **🟢 GREEN — 独立读码复核 scope 精确隔离, 1 处 should-fix(缺 regression 测试)不阻塞设计, 阻塞落到 Owner 54275KAS 执行前**

## 独立核实四条(读实际代码坐实, 不是照抄 commit message)

**①`computeSettlePlan`(结算路)确认完全未动**: 独立 grep 到`computeSettlePlan`(bshard-auto-settler.mjs:56)内部 93/99 行仍是`await ctx.endBlockHash(...)`+`deriveCommitteeSeed(marketId, endBlockHash, poolMerkleRoot)`——跟 diff 里`computeRefundPlan`用的新`deriveRefundCommitteeSeed`是两个完全独立的函数, 结算路一个字节没改。refund-path-ONLY 的边界隔离是真的, 不是设计意图声明。

**②`poolMembers`第二参"历史多余传参"的说法核实为真**: 找到真实生产实现`bshard-settle-daemon.mjs:149`——`function poolMembers(root)`, 签名只声明一个参数。`computeRefundPlan`/`computeSettlePlan`两处调用都传了`Number(market.deadline_daa)`作第二参, 按 JS 标准语义, 声明参数外的多余实参会被静默丢弃(函数体内根本读不到)——第二参确实无效, commit 里的说法不是想当然, 是可验证的语言层事实。

**③新函数`deriveRefundCommitteeSeed`本身**: 输入校验齐全(marketId 字符串检查+poolMerkleRoot 32 字节 hex 长度检查, 不合规直接 throw), 逻辑就是`blake2b(marketId||poolMerkleRoot)`, 跟设计阶段(以及我+Bettor 各自独立核实过的 PayoutShardV2.sil cancel_attest 只验签名/pk 唯一性/committeePkHash/merkle membership, 不验 seed 本身)完全对得上。文档注释里显式写了"MUST NOT be used for settlement", 边界声明清楚。

**④`_dbg`字段更新正确**: 把`endBlockHash`换成`seedKind: 'refund-marketId-poolMerkleRoot'`, 审计/排障信息随改动同步更新, 没有留一个指向已删除变量的死字段。

## 独立跑测

```
node --check pool-committee-sampler.mjs → 语法过
node --check bshard-auto-settler.mjs → 语法过
```

## should-fix(非阻塞今晚设计, 但落码进 canonical 前应该补)

**缺 regression 测试**: grep 全仓没找到任何测试文件覆盖`computeRefundPlan`/`deriveRefundCommitteeSeed`。J1 更早的退款编排设计稿 DoD 里明确写过"regression(V2 退款 root 从 stake 不读 side_lock_daa + 守恒断言)"——这条还没兑现。建议至少加一个离线单测: 验证`deriveRefundCommitteeSeed`对同一对(marketId, poolMerkleRoot)确定性输出同一 seed(跨节点一致性的核心保证, 值得机器测试固化而不是只靠人工读码信任)、验证`computeRefundPlan`不读取任何`side_lock_daa`(防止未来有人不小心把 side_lock_daa 依赖重新引入退款路径, 呼应今晚多次撞见的"母题"漂移风险)。这条不需要今晚补完, 但应该排进 Owner 签发前的门槛清单(跟committee liveness 核实一起做)。

## Verdict

**GREEN。** 代码本身正确、scope 精确隔离(结算路零风险)、new 函数逻辑对得上今晚独立验证过的 covenant 行为、跑测独立过。可以继续走 Bettor 提出的门(committee 可用性核+liveness+离线 regression)→NWT/Bettor 复核→**Owner 54275KAS 签发**→执行。这次落码本身没有让我意外的地方, 今晚前面几个小时对 committee-seed crux 的独立验证work 直接体现在了这份 diff 的正确性上。

— NWT 2026-07-19
