# NWT 红队 · (c) NO-TX 两处违反修法 + 落链对账器 设计审

> **Status**: FINAL v0.1（2026-09-13 · NWT）
> 审对象：`docs/2026-09-13-j2-no-tx-no-state-two-violations-and-landed-reconciler-design-v0.1.md`（`39249784`）。

## 结论：设计骨架 PASS，但 **I5（子发现）核实后确认是真缺陷，且 J2 自己提出的修法目前堵不住最要命的那条时序窗**——这条必须在 F2 落码前修正设计，不能照抄现稿直接写码。

## Q2（优先判）：I5 双付子发现——我读了实际代码，确认真实存在，且给出比 J2 设计稿更精确的修法

**我读了 `bettor-prediction-settler.js:172-189` 的重试循环原文**：

```js
for (let attempt = 1; attempt <= PAYOUT_MAX_ATTEMPTS; attempt++) {
  try {
    const result = await sendCommandAsync(escrowRelay.id, {type:'transfer', target:winnerAddr, amount}, undefined, 'internal');
    payoutTxId = result?.txId || null;
    if (payoutTxId) break;
    ...
  } catch (err) { ... }
}
```

**攻击/失效场景**：attempt 1 的 `sendCommandAsync` IPC 调用在 relay 侧**已经成功签名并广播**之后，但在把 `{txId}` 传回 settler 之前**超时/异常**（这正是本仓自己的既有记忆记录过的同族问题——`reference-relay-timeout-message-not-dead-can-deliver-late-and-collide`：timeout 不等于没送达，可能迟到并撞车）。settler 侧 `catch(err)` 接住异常，**循环内没有任何"先查上一次是不是已经广播"的步骤**，直接进入 attempt 2，构造**同样的** `{type:'transfer', target:winnerAddr, amount}` 命令再发一次——relay 对此毫无所知这是"重试"，会老老实实签一笔新的、独立的转账。**两笔真实付款，同一个赢家，同一个金额。**

**这不是我猜的边角案例**：本仓的既有记忆条目专门记录过"relay 超时消息不等于死，可能迟到撞更正"这个确切的失效模式，说明这类 IPC 超时窗口在这套系统里是**真实发生过的**类别，不是理论假设。

**J2 设计稿的修法目前堵不住这条**：F2 写"重试前先查 `metadata.payout_tx` / 上一次 submit 的 mempool 状态，有就不重发"——问题是**在当前代码结构下，`metadata.payout_tx` 只在整个 for 循环成功退出之后才写一次**（`metaFinal` 在循环外构造），循环内 attempt 1→2→3 之间**没有任何中间写入**，所以"查 metadata"在 attempt 2 执行的那一刻永远查不到东西，因为 attempt 1 从未写过它——这条检查对"循环内重试"这个具体窗口是**空判据**（vacuous），只对"整个函数被下一个 tick 重新调用"这种更外层的重试有效。

**MUST-FIX（写入 F2 修法，不是我另开新条，是订正现有条）**：循环内每次 attempt ≥ 2 之前，必须查**relay 自己的权威来源**（mempool/最近广播记录），不是查 settler 自己的 DB 元数据——因为在这个具体窗口里，settler 自己的元数据结构性地不可能有这条信息。具体形：调用 `check_utxo_landed(winnerAddr, <上一次if有>, minDepth=0)` 或等价的"该 relay 最近 N 秒内是否已经给这个地址发过这个金额"的 relay 侧查询，**没有 txId 也要能查**（因为正是"没拿到 txId"才是问题所在——如果已经有 txId 了，circuit 本来就会 `break`，不会走到这条检查）。这可能需要 relay 侧补一个新命令（"查我最近是否已经广播过 target=X amount=Y"），或者 settler 侧在**每次 attempt 之前**先落一行"意图记录"（`intent_id` + target + amount，写在 attempt 1 开始**之前**，不是拿到结果之后）,重试时先查这行意图记录对应的 mempool 状态。**两种做法都比"查 metadata.payout_tx"更早、更对**，具体选哪个交给 J2/Bettor，但现稿这句必须换。

**是否单开事故账**：不需要——我查了 `prediction_reputation_log` 的 `paid` 事件计数 = **0**（读:only 直查 console.db），这条路径全库历史上从未真正执行过一次（与设计稿 V5 的"缺陷没显形不是风险低"框架一致）。**这是一个必须在 F2 落码前修正设计、但目前没有造成过真实损失的在场缺陷**——正确处置是把它算进 F2 的验收范围，不是单独立案，但**F2 若不按上面这条重写就落码，等于把一个已知能双付的东西直接放上钱路**，这一点必须写进 F2 的验收判据，不能只满足"查了 metadata 就算做完"。

## Q1：minDepth 单一源

同意 J2 的倾向——**引用 `REORG_SAFE_MIN_DEPTH`（`pool-shard-register.mjs`）单一源，不要在 (c) 里另写一个 `KASPA_VERIFY_MIN_DEPTH`/`KASPA_PAYOUT_MIN_DEPTH` 独立常量**（设计稿 F1/F2 目前各自起了新 env 名，即使数值都是 20，两个独立命名本身就是"同一个不变量两处声明"的漂移面——以后有人改一处忘了改另一处，两条深度门就不一致了）。**MUST**：F1/F2 都改成直接 import/引用 `pool-shard-register.mjs` 现有的 `REORG_SAFE_MIN_DEPTH`，不新增常量名。

## Q3：F3 depth 来源

同意"给 `kaspa_tx_log` 加 `block_daa` 列"（一次写、免每次 RPC），比每次对账都发 `getBlock` RPC 请求更省、更符合本仓既有的"relay block-added 时就有数据，别事后去问节点要它本来就知道的东西"的一贯风格（同 `kaspa_tx_log` 本身的设计动机）。**不阻塞**：这条即使先用 RPC 降级实现也不影响 F3 v1（detect+alert）的正确性，只是效率差一点，可以后补列再切换，不必卡在这条上。

## Q4：冻结机制

同意"等 G-1 `readonly` 态定了再接"——现在不单独发明一张 `relay_money_freeze` 表再之后又要跟 G-1 的态合并，是重复建设。F3 v1 先只做 detect+alert，冻结动作留白，这个顺序是对的。

## 其余骨架核实（无新增问题）

- F1（`exchange-machine.js` 改调 `verifyCrossChainTx`）：**我直接读了 `cross-chain-verify.mjs:189` 与 `_verifyKaspa`（:471-）的源码，确认 §8 自陈的担心是真的且已被坐实**——kaspa 分支调用点写的是 `_verifyKaspa({ txHash, expectedAmount, expectedTo, required: 1 })`，**`required` 硬编码 1**；函数内部无论走"本机索引器命中"还是"RPC UTXO 兜底"，返回值一律 `confirmations: 1, required: 1`——**没有任何一行代码计算真实的块深度**，"confirmed"目前的含义只是"这笔 tx 至少被看见过一次"，跟"落链多深、有没有被 reorg 退掉"完全无关。**这不是"可能恒1"，是"确定恒1，且是调用方主动传进去的硬编码 `required:1`，不是函数自己算错"**。⇒ **MUST-FIX（比设计稿原描述更重）**：F1 不能只在 `exchange-machine.js` 那一侧加一个 `vr.confirmations >= KASPA_VERIFY_MIN_DEPTH` 判断——因为 `vr.confirmations` 这个字段目前的值域就是常量 1，加了判断也只是"1 >= 20 恒假"或者被迫把阈值也设成 1（等于没加）。**真正要改的是 `_verifyKaspa` 函数本身**：本机索引器命中的分支需要额外查一次当前 DAA（或复用 F3 打算给 `kaspa_tx_log` 加的 `block_daa` 列）算出真实深度、把它放进 `confirmations` 返回值；RPC 兜底分支同理改用 `checkUtxoLanded`/等价的深度查询。这条 MUST-FIX 应该并入 F1 的工程量估算（现稿"≈20行"明显低估，因为它假设的是"调用方加个判断"，实际是"被调用的验证函数本身要重写"）。
- F4（`tx_records` 加落链列）：合理，索引 `(direction, landed_at)` 覆盖对账器的查询模式。
- 向量表覆盖了正/反/弱注入/幂等/I5，方法论完整（除了 F2-I5 那一条向量本身需要跟着上面的 MUST-FIX 一起改写断言，现在写的"第二次不重发"断言在当前设计下测不出问题，因为它测的是"metadata 里已经有 payout_tx"这个前提本身就不会在这个窗口成立）。

## 给 Bettor 的处置建议

- F2 落码前必须先把 I5 的检查机制从"查 settler 自己的 metadata"换成"查 relay 侧权威来源/意图记录"，这是本审唯一的 MUST-FIX。
- Q1 的单一源引用是第二个 MUST（小改，两处改成 import 现有常量）。
- Q3/Q4 按 J2 倾向走，不阻塞。
- F1 落码前必须先查清 `verifyCrossChainTx` 的 `confirmations` 计算方式，确认深度门不是摆设。
