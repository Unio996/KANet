# NWT diff 审 · (c) NO-TX/落链对账 patch（`coord/j2-c-no-tx-landed`，四笔）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`origin/coord/j2-c-no-tx-landed`（`88557a04→06094bdd→b1397b0c→f55d0bf7`，基线 `8a44568a`，24 文件 +1565/−101）。
> **方法（延续上次教训，零 junction）**：独立 worktree + `kasia-console`/`kasia-relay` 各自独立 `npm install`；`check-worktree-junctions.mjs` 确认 0 条跨树链；22 个非文档改动文件逐一 `node --check`；`lint-kanet.mjs` 0 errors；**亲跑全部 5 个测试文件**（不信 J2 自报）；审完 `git worktree remove`（0 链，安全删除）。

## 结论：**GREEN-with-ONE-BLOCKER**——设计与实现质量高、五点审点全部核实通过；**Codex (B) escrow_landed_at 硬消费门确认仍未落地，这是唯一挡 GO 的项**；Codex (A) 待真链验证，标记为落地前 MUST 不是本次阻塞

| 验证项 | 结果 |
|---|---|
| `node --check` × 22 | 全部 exit 0 |
| lint | **0 errors** |
| `submit-intent.test.mjs`（我亲跑） | ✅ 24 断言 + harness 翻转臂 全绿 |
| `exchange-machine-kaspa-gate.test.mjs`（我亲跑） | ✅ 7 断言 + harness 翻转臂 全绿 |
| `prediction-payout-gate.test.mjs`（我亲跑） | ✅ 9 断言 + harness 翻转臂 全绿 |
| `tx-landed-reconciler.test.mjs`（我亲跑） | ✅ 7 断言 + harness 翻转臂 全绿 |
| `serialize-roundtrip.test.mjs`（relay 侧，我亲跑） | ✅ 16 断言 + harness 翻转臂 全绿，**含 Q6 陷阱的正反两态** |
| migrate.js v202 | 独立跑通，`submit_intents` 表 + `tx_records` 四列均正确创建（**发现一个纯观测性小问题，见下**） |

## ① submit_intents 机制——核实正确

`lib/submit-intent.mjs`：幂等键 `INSERT` 在任何 IPC **之前**；relay 两阶段（`prepared{确定性 txid+已签名字节}`→`submitted`）；attempt≥2 只查 relay 侧（mempool/落链/同字节重播）。我亲跑的 24 条断言逐一核对了关键性质：F2-I5-弱注入与 F2-R-弱注入两条**必须为红**的臂真的红了（证明判据确实读的是 intent 表/relay 侧而不是 metadata，不是摆设）；`checkIntentLanded` 拒绝 `minDepth=0`（强制显式传 `REORG_SAFE_MIN_DEPTH`，堵住"忘了传深度"这种低级错误）。**PASS**。

## ② deserializeFromSafeJSON 陷阱——真发现、真修复，顺序对

读了 `kasia-relay/src/lib/transaction.mjs:293-307` 的 `replayPreparedTransactions` 实际代码：`deserializeFromSafeJSON` 之后**立刻** `for (const t of txs) t.finalize()`，**在**跟 `expectedTxId` 比较**之前**——顺序对，不是"先比较再想起来重算"这种表面修复。测试文件里"Q6-陷阱"那条断言专门演示了"不 finalize 断言是空的"这个反例，"Q6: finalize() 从字节重算"那条演示了修复后正确检测出篡改——这是标准的"先证明洞真实存在、再证明补丁真的堵住它"的双证据法，方法论对。**代码里还留了一段诚实的残余风险注释**（"旧笔已落链且收款方在重试窗内又花掉了它、且收款地址不在索引器 watched 集⇒console重建⇒双付"）——这正是下面 Codex (A) 要求的那个"运行期前提未证"的窗口，J2 自己在代码注释层面已经如实标注，不是藏着。**PASS**。

## ③ settler SELECT 从不选 delivering——真发现、真修复

`bettor-prediction-settler.js:29` 引入 `sweepDeliveringPayouts`，每 tick 先扫 `protocol_status='delivering'` 的 offer（`prediction-payout-gate.mjs:69-` 的 `sweepDeliveringPayouts`：`submitted`→核落链才 `completed`，`pending/prepared`→续发，无 intent 的老行→只计数不动）。这条修复本身很值得称赞：**J2 主动发现了自己/前人此前设计里"留 delivering 下次 tick retry"这句注释从未真正生效过**（原 SELECT 语句压根不包含 delivering 状态），没有等我或 Codex 指出来才补——这正是我一直在这轮审查里要求的那种主动性。**PASS**。

## ④ 五处站点改法——核实正确

`exchange-machine.js` 硬构造改 `evaluateKaspaPaymentGate`（收款人/金额 `verifyCrossChainTx` ∧ 深度 `check_utxo_landed(≥REORG_SAFE_MIN_DEPTH)`，我亲跑的 F1 弱注入向量确认深度 19 仍留 `verifying`，证明门真的读 relay 深度不是那个恒为 1 的 `vr.confirmations`）；`bettor-prediction-settler.js` 派彩走 `submitPayoutIntent`/`completeIfLanded`（depth 25 才 `completed`+`paid`恰一行，深度 3 留 `delivering`）；`bettor.js` 三处 escrow 改 `transferWithIntent`（保留原 import 行，M0a 兼容）。**PASS**。

## ⑤ F3 对账器——M0a 合规、只读

`tx-landed-reconciler.mjs:11` 明确注释"不 import relay-manager"，链读走 `getSharedRpc`（`kaspa-rpc-shared.mjs` 单例，跟 (a) 设计的既有模式一致，不新开连接）。**PASS**。

## Codex (A)：同字节重播的运行期前提——仍 OPEN，不是本次阻塞但落地前 MUST

我亲跑的测试证明了"finalize() 重算能检测出字节篡改"这个**逻辑**是对的，但这些测试用的是**假 RPC**/**合成交易**，不是真实 kaspad 对一笔**真实 covenant 交易**做 `serializeToSafeJSON`→`deserializeFromSafeJSON`→`finalize()` 往返后 `id` 是否真的保持不变（Codex 点名的正是这条：covenant 交易比普通转账多了 `CovenantBinding`/state 编码，往返序列化路径有没有踩到什么 kaspa-wasm 特有的坑，单测代码模拟不出来）。**这条我同意 Codex 的判断：不能靠单测通过就认为已经验证，必须在实现阶段用一笔真实的、带 covenant 的链上交易做一次离线往返对照**（J2 自己在 T1 v0.3 的 Q6 里也提过同一类要求，是同一个方法论，只是这次针对的是普通转账 tx 而不是 covenant tx——**这里我要更正一下范围**：(c) 这条重播机制目前只用在 KAS 转账（escrow/payout），不涉及 covenant 交易，所以 Codex "用真实covenant交易验证"这个措辞如果字面理解，验证对象应该改成"一笔真实的、relay 会构造的那种转账交易"，不必特意找 covenant 交易——**除非** T1 落地后 relay 侧也要用同一套 intent 机制去广播代币 `transfer`（那时才需要真的用 covenant 交易验证）。这条不阻塞当前这笔 patch（KAS 转账场景），但要在稿子里把"验证对象是转账 tx 还是 covenant tx"这个范围写清楚，免得实现阶段的人真的去找一笔 covenant tx 做了个跟当前需求无关的验证。

## Codex (B)：escrow_landed_at 硬消费门——**确认仍未落地，本次唯一阻塞项**

我直接 `grep` 了当前分支（`f55d0bf7`）的 `bettor.js`/`migrate.js`，**`escrow_landed_at` 一个字都没有**——三处 escrow 锁仓（`transferWithIntent`）现在虽然用上了 intent 机制防双付，但**推进语义没变**：拿到 `txId` 就写库，taker 接受/匹配/结算这些下游动作**没有任何机制检查这笔 escrow 是否已经落链**。这正是 Codex 判 HOLD 的理由，也是 Bettor 明确要求我"当阻塞项"的那一条——**我核实后确认这条判断是对的，不是过度谨慎**：F2/F2-E 解决的是"双付"，Codex (B) 关心的是完全不同的另一个问题——"资金还没真的到账，业务就已经把它当到账了在往前推进"，这两个问题分别是 I5（重试面）与 NO-TX 第零条 bis（乐观写面）,同一批修复解决了第一个,还没碰第二个。**这条不修完，这笔 patch 不能算完整实现了 (c) 设计文档自己声称的目标**（设计文档 §3 F2-E 那一行也确实写了"§7 Q5"留白,只是 Bettor/Codex 现在把它从"留白讨论项"升级成"落码前必须关"）。

## 一个观测性小问题（非阻塞）

migrate.js 的 v202 迁移块（`submit_intents` 建表 + `tx_records` 加列）**没有 `console.log('[migrate] v202: ...')` 这行announce**——本文件里从 v170 往后几十个版本块全部有这一行（迁移跑到哪、干了什么，方便运维排查),v202 独独没有。我实测确认表和列都**确实正确建了**（不是执行失败,只是没打日志），**不影响功能，但建议补一行**,免得以后有人查 migrate 日志想确认 v202 是否跑过时看不到证据,又要重新去查表结构。

## 给 Bettor 的处置建议

- **GO/NO-GO**：Codex (B) 是真阻塞——J2 补第 5 笔（`escrow_landed_at` 列 + 三处 escrow 下游消费点的硬门禁）落地并让我复核那一笔的 diff 之后，才能给整体 GREEN。
- Codex (A) 不阻塞这笔，但建议在设计文档里把"验证对象是转账 tx 还是 covenant tx"这个范围写清楚（见上）,免得实现阶段验证目标搞错。
- migrate.js v202 补一行 announce log,文字级,不必单独开一轮审。
- 其余五点审点、两个"真发现真修复"（deserializeFromSafeJSON、settler SELECT 漏 delivering）质量都很好,不需要重审。
