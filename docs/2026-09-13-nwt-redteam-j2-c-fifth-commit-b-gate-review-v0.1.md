# NWT diff 审 · (c) 第 5 笔（Codex 8118732e A+B 收口）——GREEN，(c) 整体完整

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`origin/coord/j2-c-no-tx-landed` 第 5 笔 `1d4b7fd2`（基线 `f55d0bf7`，12 文件 +329/−1）。方法同前：独立 worktree + 独立 `npm install`（零 junction 确认）+ 22 文件里这次改动的 9 个非文档文件 `node --check` + lint 0 errors + **亲跑新增的两个关键测试文件**。

## 结论：**GREEN**，(c) 设计到此完整落地（Codex A/B 两条 MUST 基线均已收口），钱路合入仍等 Owner 批

## (B) escrow_landed_at 硬消费门——核实：单一所有权点、单一写入方、幂等，全部成立

**门的位置**：读了 `exchange-machine.js` 的 `transition()` 函数实际代码——`escrowGateFor()` 挂在 `VALID_TRANSITIONS` 检查**之后**、任何 DB 写入**之前**，拦下时走跟既有"Invalid transition"一样的"记日志+返回原 offer"形——这确实是**唯一**所有权点：任何代码只要调用 `transition()` 就自动过这道门，不需要每个调用方自己记得检查。

**唯一写入方**：`escrow_landed_at`/`escrow_landed_depth` 只在 `escrow-landed-gate.mjs` 自己定义的 `applyIntentLanded()` 里被写，全仓 grep 确认没有第二处直接 UPDATE 这两列；`applyIntentLanded` 只被 `tx-landed-reconciler.mjs`（F3 对账器）调用，即"落链"这个判断始终来自我在上一轮已经核实过的三源验证（`kaspa_tx_log`/收款地址UTXO集/mempool），不是随便哪里一个 `if (txId) { landed=true }` 式的假门。**读了 `applyIntentLanded` 的实际 SQL**：`UPDATE ... WHERE id=? AND ${column}_at IS NULL`——NULL 守卫直接写在 `WHERE` 里，是 SQL 级别的幂等（不是"读一次判断再写"这种有竞态窗口的模式），第二次调用天然 0 行受影响。**PASS**。

**M0a 合规**：`escrow-landed-gate.mjs` 只 `import { sqlite }`，零依赖 relay-manager/RPC，纯规则模块。**PASS**。

## 顺带堵的洞——我核实：这确实是一个独立于本次门禁改动的既有缺陷，不是"为了让新门生效顺手编的说法"

读了 `bettor-prediction-settler.js` 里 `transition(offer.id, 'delivering')` 调用点：**这一行以前就直接调用，调用完不检查返回值直接往下走构造真实转账**。`exchange-machine.js` 的 `transition()` 从设计上就是"拦下时返回原 offer、不抛异常"（跟"Invalid transition"是同一种约定），这意味着**在这个门禁改动落地之前，任何原因导致的 transition 失败（不只是这次新加的 escrow 门，任何未来可能出现的其它拦截条件）都会被静默吞掉，下面照样发钱**——这本来就是一个"调用了一个可能默默失败的函数、却把它当成必然成功"的经典 bug 模式，只是这次因为新加了 escrow 门,才第一次真的会被触发。J2 加的修复（`transition()` 后立刻 `SELECT protocol_status` 重新读一次,不是 delivering 就 `throw`）**用的是我这一整轮审查一直在要求的同一个原则："别信函数返回值/别信自己刚写的东西，回源头重新核一次"**——跟 `completeIfLanded()`（第 4 笔就有）的既有模式完全一致，我核对过两处写法确实统一。**PASS，且认定这确实是一个真实存在过的既有缺陷，J2 的判断准确**。

## (A) 范围收窄 + covenant 场景补测——核实：改得对，测得够

设计文档范围按我上一轮的提醒改成了"relay Generator 构造的真实转账交易"（`serialize-roundtrip.test.mjs` 已覆盖），并**主动追加**了 `covenant-roundtrip.test.mjs` 作超集覆盖（真实带 `CovenantBinding` 续约输出 + P2PK 真签的交易）。**我亲跑了这个新测试文件**：12 条断言全绿，覆盖了 id 往返不变、`CovenantBinding` 与 `scriptSig` 原样保留、改字节后 `finalize()` 能检测出变化、以及重播的六种结果分支（幂等接受 ×2 / 拒绝改字节 / `inputs_spent` / 反序列化失败 / submit 抛错查 mempool 无则拒），加上 harness 翻转臂真的翻红。**这次测试对象是"真实交易结构"（含 covenant 输入/输出），比上一轮单纯的合成对象更接近实际会发生的场景**。往返失败时改成 `intent_replay_unrecoverable` 告警、不重试不重建——是正确的 fail-closed 收尾（对应我上一轮强调的"运行期前提没验证清楚之前不能自动兜底"）。**PASS**。

## 我亲跑的测试（不信自报）

| 文件 | 结果 |
|---|---|
| `kasia-console/src/services/escrow-landed-gate.test.mjs` | ✅ 16 条断言 + harness 翻转臂全绿——真实 `transition()` 调用（不是假函数），"submitted 永不落链⇒下游价值动作全不可达"这条我逐行核对了断言对象（matched/verifying→delivering/delivering→completed 三态各自被拦，退款/取消不受影响，taker 锁独立生效） |
| `kasia-relay/src/lib/covenant-roundtrip.test.mjs` | ✅ 12 条断言 + harness 翻转臂全绿（见上） |
| `node --check` × 9 | 全部 exit 0 |
| lint | 0 errors |

## 给 Bettor 的处置建议

- **(c) 整体 GREEN**：Codex (A)（范围已收窄+covenant 超集已补测）与 (B)（硬消费门单一所有权点+单一写入方+幂等）两条 MUST 基线均已核实收口，上一轮唯一的阻塞项已解除。
- 这一笔没有发现新的问题，两处主动堵洞（settler 的 transition 返回值未检查、A 的 covenant 场景补测）质量都好，不需要再开一轮。
- 合入仍是钱路，等 Owner 批（D-017 §3 既有纪律不变）。
