# NWT 审注 — 部署单 v0.3 (`bb4e98db`) batch-2 段

> NWT · 2026-08-29 · 只读审注（不改部署单本体，J2 按此改）· 对象 = `docs/2026-08-29-j2-broker-money-path-deploy-runbook-draft.md` `## v0.3 增补 · batch-2` 段（batch-2 头 `8473f1ec`，对 `fe6ad45e`）。
> **总评**：结构 SOUND、可批。**1 个承重补项（PENDING 生命周期验收缺）** + 几处期望输出/FAIL 形需补 + 1 个措辞精化。回滚锚 6/6 + env 常量 3/3 我已亲核对上。

## 1. 回滚锚 6/6 — 我亲核 ✓（`git show fe6ad45e:<f> | sha256sum | cut -c1-16`）
| 文件 | 单里 sha[:16] | 我重算 | |
|---|---|---|---|
| `broker-intake-watcher.js` | `e43488dfd86ff39e` | `e43488dfd86ff39e` | ✓ |
| `broker-v2/router.js` | `28bbffb59daebb4a` | `28bbffb59daebb4a` | ✓ |
| `api/conversations.js` | `f422fc0ed96906d0` | `f422fc0ed96906d0` | ✓ |
| `exchange-machine.js` | `d835b53b40baa45f` | `d835b53b40baa45f` | ✓ |
| `broker-bsc-intake-watcher.js` | `7bcedf2a6ccf6faa` | `7bcedf2a6ccf6faa` | ✓ |
| `trade-protocol-filter.js` | `15d853d7796fd0a6` | `15d853d7796fd0a6` | ✓ |
- 🟢 注：`broker-intake-watcher.js` 的锚 `e43488dfd86ff39e` 与 batch-1 §2.1（@`75b3aa82`）**同值** —— 非笔误，该文件在 `fe6ad45e` 与 `75b3aa82` 内容一致（两批各自对各自 base 算，都对）。**但 merge 顺序 batch-1→batch-2 时，batch-1 会先改这个文件** ⇒ **§B2-3 的 merge-前锚复核必须对【batch-2 merge 那一刻的 HEAD】算，不是对原始 `fe6ad45e`**（batch-1 已落 ⇒ HEAD 上此文件已是 batch-1 版）。建议 §B2-3 明写"锚复核基准 = 本批 merge 前的 HEAD；若 batch-1 已 merge，broker-intake-watcher.js 预期为 batch-1 后值，另钉"。**这条不改会导致 §B2-3 在 batch-1→batch-2 顺序下对 1 个文件误报 MISMATCH。**

## 2. env 默认值 vs 代码常量 3/3 — 我亲核 ✓
| env | 单里默认 | 代码 | |
|---|---|---|---|
| `BROKER_WITHDRAW_TIMEOUT_MS` | `120000` | `router.js:191 … \|\| 120_000` | ✓ |
| `BROKER_PEER_LOCK_REJECT_MS` | `180000` | `conversations.js:486 … \|\| 180_000` | ✓ |
| `COVERAGE_ADJ_DAA` | `20`（batch-1）| batch-2 不动 | ✓ n/a |

## 3. 验收项（§B2-4）— 逐条补「期望输出 / FAIL 形」
现有项测法基本对，补齐可判据：
| 项 | 期望输出（PASS）| FAIL 形 |
|---|---|---|
| rejectAfterMs | 第二条 DM 30 s 后出 `peer-lock wait`（非并行）；`REJECT_MS=5000` 时第二条回 `service_busy` 文案 + 日志 `peer-lock REJECT waited=…` | 两条并行处理（无 wait 日志）= 锁没接上；或缩 5000 后仍不拒 = rejectAfterMs 没生效 |
| buy_inflow 首笔 | `broker_workflow_markers` 有 `broker_buy_inflow` 行，`payload.from` == bscscan 入金 tx 的 from；同 tx 再触发不重复（`INSERT OR IGNORE`）| 无行 = sender 没先记；`from` 是 broker 自己地址 = 记错方向 |
| **hedge_gate_error** | `chain_events` + `events` 各一条 `hedge_gate_error`，payload `{offer_id, error:"no such column: meta"}`（我核 `_recordHedgeGateError` payload 真带 `error: e.message`✓）；`chain_events hedge%` 仍 `count=0`；Gate.io 无新单 | 门被**静默**（无 hedge_gate_error 记录）= 窄 catch 没接上；或 `hedge%` >0 = 对冲真跑了（不该，未 Owner 批开）|
| P2 intent 先行 | `broker_fallback_intent.observed_at` < `broker_fallback_claim.observed_at` | claim 先于/无 intent = write-ahead 没生效 |
| P11 借记先行 | `user_ledger` 先 `withdraw_pending:` 再 `withdraw_user_initiated:`；转账期间余额已减 | 余额转账后才减 = 借记在转账之后（P11 复发）|
| reopen 门 | `matched`+`payment_tx` 超时 offer ⇒ `verifying`（非 `open`）、`payment_tx`/`taker` 留、`fund_locks` 仍 `locked`、`events reopen_blocked_settled` 一次/offer；无 `payment_tx` 的照旧 reopen | 变 `open` = 门没接；`payment_tx` 被清 = reopen UPDATE 没被拦 |

🔴 **承重补项（缺）——「PENDING 付款意图生命周期」独立验收**（batch-2 sub-case ii 的核心，§B2-4 现无此项）：
- **测**：一笔 broker/exchange 本地 auto-pay（`_autoPayExchange`/`_autoSettleAsset`）。
- **期望**：`exchange_offers.payment_tx` **先**变 `PENDING:<offer8>:<uuid8>`（reserve，`:2813` 转账前）→ 成功后 CAS 换成真 txHash（`_finalizePaymentIntent`）；**失败/抛** ⇒ 标记**留着** + `events autopay_ambiguous`（`_alertPaymentIntentStuck`，`:2820/2827/2840`）；该 offer 若被 reopen ⇒ reopen-guard 视 PENDING = settled（→ verifying）；`processPaymentSubmit` 收到外部 hash ⇒ 不覆盖 PENDING、返回 `payment_intent_pending`（应用层 + SQL 谓词双层）。
- **FAIL 形**：`payment_tx` 直接从空变真 hash（无 PENDING 中间态）= reserve 没在转账前落 ⇒ **崩溃窗口双付风险回归**；或失败后 PENDING 被清 = fail-open。

## 4. P1–P9 顺序 / batch-1 v199 迁移 vs batch-2 无迁移 依赖
- **无硬迁移依赖**：batch-2 **不加表不加列**（intent/claim/inflow 走 `chain_events` / `broker_workflow_markers` 既有表），**不读** v199 建的 `kaspa_tx_log_coverage` / `broker_refund_intents` / `idx_spc_daa_ts`。⇒ batch-2 对 batch-1 的 v199 **零迁移依赖**，两批 schema 独立、各自可批可回滚（与单里"各自可批"一致 ✓）。
- **软依赖（可见性，非安全）= 顺序 batch-1→batch-2 的真正理由**：batch-2 的 ambiguous 事件（`manual_refund_pending` / `fallback_ambiguous` / `withdraw_ambiguous` / `autopay_ambiguous`）由 **batch-1 hold-monitor 的第六/七数 + unknown_1h**（fix-up 4/5/6）surface。**batch-2 单独部署 = money-safe（fail-closed 状态照写）但盲（无监控看见 ambiguous 态）**。⇒ 顺序对，但请在单里点明性质：**batch-1→batch-2 是"让 batch-2 的 ambiguous 从 T+0 就被看见"，不是 batch-2 功能依赖**；且 §B2-4 的「hold-monitor 首行含 `manual_refund_pending=`/`fallback_ambiguous=`」这条**只有 batch-1 已部署才可验**（那两个数在 batch-1 的 hold-monitor 里）——单里应标此项前置 = batch-1 先落。

## 5. 其余小项
- 🟡 batch-2 段**缺 `§B2-6 验证方法**（batch-1 有 §6"不信本单信命令"）。建议补：6 个 `.test.mjs` 跑法（`tick-guard`/`peer-serial-lock`/`user-ledger-withdraw`/`with-timeout`/`broker-buy-inflow` + `services` 下 `hedge-call`/`reopen-guard`/`payment-intent`/`fallback-intent`/`withdraw`）+ 锚复核命令 + env `grep` 对账命令。
- 🟡 hedge_gate_error 验收精化：只有 **`metadata.hedge_enabled:true` 的 offer 完成**才走到门（retail-proxy/bounty 等默认 off 不触发）——单里"一笔 broker offer 完成后"应改"一笔 **hedge-enabled** offer 完成后"，否则测的人可能拿个 non-hedgeable 单等不到 hedge_gate_error 误判 FAIL。
- 用户面 2 处（TN12 `TX:` 去死链 / `service_busy` 复用）+ operator eta PENDING 死链备注 + DEFECT1b 定级：**与我 batch-2 GREEN verdict（`2e8b7ccf`）一致**，无异议。

## 结论
部署单 v0.3 batch-2 段 = **可批**，改这些后更稳：① §B2-3 锚复核基准写清（batch-1→batch-2 顺序下 broker-intake-watcher.js 预期为 batch-1 后值）；② 补 PENDING 生命周期验收；③ 各验收项补期望/FAIL 形（上表）；④ 点明 batch-1→batch-2 是可见性软依赖 + hold-monitor 验收项的 batch-1 前置；⑤ 补 §B2-6 验证方法 + hedge 验收"hedge-enabled"精化。回滚锚 6/6、env 3/3 我已亲核对上。
