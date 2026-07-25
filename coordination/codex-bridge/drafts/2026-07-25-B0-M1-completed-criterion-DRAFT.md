# B0-M1 · `completed` 的唯一链上充分条件（草案 v0.1）

- **卡**: `B0-M1-SETTLE-TRUTH` · DRI **J1** · 钱路复核 J2 · 红队 NWT
- **本波范围**: 只读取证 + 设计 + 离线测试（§16.3）。**DoD-7（小额 live lifecycle）不在本波**（Bettor 20:2xZ 裁定）。
- **状态**: 草案。未经 J2 复核、未经 NWT 红队。**不得据此改码。**

---

## 0. 这份东西是什么，不是什么

🔵 **不是设计一个新判据。** 取证已确认：**这个判据在本仓库里已经存在并被实现过两族**
（`bshard/settleMarketLive` 与 `ZK claim/zk_close/handoff`），它甚至有名字：**Bug 7**。

⇒ 本文做三件事：
1. 把那个已实现的判据**写成规范**（此前它只存在于代码与注释里）；
2. 指出**哪些路径没照它做**；
3. 标出该判据自身**当前依赖约定而非结构**的那几处。

---

## 1. 定义：`completed` 的唯一链上充分条件

对一次结算 `S`，其应产生 `n` 笔付款输出 `{(txᵢ, addrᵢ, amtᵢ)}`。

> **`S` 可被标记为 `completed`，当且仅当下列六条【全部】成立：**

| # | 条件 | 依据 |
|---|---|---|
| C1 | **存在且绑定**：对每个 `i`，在**活 UTXO 集**中存在 entry 满足 `outpoint.transactionId == txᵢ` | `checkUtxoLanded` |
| C2 | **深度**：`virtualDaaScore − entry.blockDaaScore ≥ REORG_SAFE_MIN_DEPTH`（当前 20） | 同上 |
| C3 | **金额**：该输出的 value `== amtᵢ`（逐笔，不是总额） | `verifyClaimLanded` |
| C4 | **收款方**：该输出的地址 `== addrᵢ` | 同上 |
| C5 | **fail-closed**：查不到 entry／`blockDaaScore` 缺失／深度不足 —— **一律判未落地**，不得放行 | 同上 |
| C6 | **完整性**：`n` 笔**全部**满足 C1–C5。部分成功 **≠** `completed` | `complete` 不变量 |

🔴 **反面表述（DoD-2）**：以下任一**单独**成立时，**不得**写入 `completed`：
- `submitTransaction` 返回了 txid（=「节点收下了」，**不是**「它上链了」）
- 提交调用没有抛异常
- DB 里某个字段已经是 `completed`（**不得自证**）
- UI／上游声称完成

> 依据（一手）：`shared/vendor/kaspa-wasm/kaspa.d.ts:1087` `ISubmitTransactionResponse` **结构上只带 `transactionId`**
> ⇒ 该响应**承载不了**「它进了 DAG」这个事实（NWT 读码，零执行）。

---

## 2. 三态判定（DoD-3）

| 态 | 何时 | 处置 |
|---|---|---|
| **confirmed** | C1–C6 全过 | 写 `completed` |
| **contradicted** | **找到了 `addrᵢ` 的输出条目，而金额 ≠ `amtᵢ`** | **不重试掩盖**；升级为人工／告警 |
| **inconclusive** | 其余全部：本地表缺行／JSON 坏／outs 里没这个地址／深度不足／查不到 | 兜底重查（直连 RPC 现读），预算耗尽 → fail-closed |

🔴 **`contradicted` 必须窄定义。** 现有实现已经这么做了，且注释点名这是 NWT 红队复核重点：
> 「txRow 缺失／JSON.parse 失败／outs 里没这个地址三种情形一律走 inconclusive→fallback，不能被误判成 mismatch」

🔵 **理由**：把 inconclusive 误判为 contradicted，会把「我没看清」说成「我看到它错了」——
后者会触发人工介入并可能反向操作，而前提是假的。

### 2.1 四场景 → 三态

| 场景 | 判定 |
|---|---|
| 链上已生效但 DB 未确认 | **confirmed**（以链为准，DB 补写） |
| DB 显示完成但链上未生效 | **contradicted**（🔴 这不是假想场景，是零确认路径的默认产物） |
| tx 落地后立即被花 | **confirmed**（C1 用的是 UTXO 集，被花后查不到 ⇒ 需 `kaspa_tx_log` 历史源；见 §4 未决） |
| 索引永久漏记 | **inconclusive → 直连 RPC 兜底**（不得判 confirmed-absent） |

---

## 3. 合规现状（取证结论）

| 路径 | 闸 | 三问（await／用作分支／写在通过侧） | 结论 |
|---|---|---|---|
| `bshard/settleMarketLive` | 3 个调用点 | ✅✅✅（连接符在 `bshard-settle-daemon.mjs:860`） | ✅ 合规 |
| ZK `claim`/`zk_close`/`handoff` | landed-gated | ✅（J2 核） | ✅ 合规 |
| 🔴 `bettor-prediction-settler.js` `:432`/`:664`/`:202` | **零引用** | — | 🔴 **未接线** |
| 🔴 `exchange-machine.js:826-829` | **零引用**，且伪造 `confirmed:true` | — | 🔴 **未接线 + 伪造结论**（Bettor 读，未独立核） |

---

## 4. 🔴 该判据自身当前依赖【约定】而非【结构】的几处

> 判据（Bettor 20:5xZ 定稿）：「这个断言的正确性，依赖对面当前不产生某种输入、或对面 schema 当前缺某个字段吗？若是 ⇒ 它不是断言，是约定，而约定必须写在两边。」

| # | 处 | 依赖什么约定 | 漏了会怎样 |
|---|---|---|---|
| A | `checkUtxoLanded(…, minDepth = 0)` | 调用方**记得传 20** | 静默退回 first-seen 浅确认 = 正是它当初要根治的 phantom-leaf |
| B | `verifyClaimLanded(…, expectedAmount = null)` | 调用方**记得传金额** | 只验「落地」不验「付对了数」 |
| C | `_checkLandedViaRelay` 的 `if (j.landed \|\| j.found)` | relay 响应**当前不含 `found` 字段** | 将来谁给响应加 `found`（通常被视为向后兼容的安全改动）⇒ Bug 7 从它自己那道闸的后门原样回来（NWT 发现） |

🔵 A/B/C **当前都无害**——现有调用点都传了参、relay 也确实不返回 `found`。
🔴 **而三处的安全性都不是结构保证，是「没人漏／没人加」。** 建议全部进 DoD-5 负测试。

---

## 5. 未决（我明标，不当已关）

- 🔴 **深度 20 够不够** —— 它来自当时 TN12 实测校准（reorg ~26% 恒常但 always depth=1，20 = 20× 实测 max）。**校准值是否仍然有效，我没重测。**
- 🔴 **`kaspa_tx_log` 可不可信** —— 现有设计已知它会**漏记**（故有 RPC 兜底），但「它会不会**记错**」是另一问，未答。
- 🔴 **「tx 落地后立即被花」场景**：C1 查活 UTXO 集，被花后查不到 ⇒ 需历史源；现有实现以 `kaspa_tx_log` 为主源正是为此，**而这把该场景的正确性挂回了上一条未决**。
- 🔴 **未逐行通读 `settleMarketLive` 全体** —— 我读的是完成判定这条链。别处若还有写完成的路径，本文不覆盖。
- 🔴 **DoD-6（历史假完成样本只读重放）尚未做** —— 取样从哪条路径取，取决于「未接线那两条算不算本卡范围」，等 Bettor 裁。
