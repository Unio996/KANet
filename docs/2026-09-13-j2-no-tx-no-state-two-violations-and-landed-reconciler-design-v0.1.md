# (c) NO TX NO STATE CHANGE 两处违反修法 + submit/landed 对账器 · 设计骨架 v0.1（不落码）

> **Status**: DRAFT-FOR-REVIEW v0.1（2026-09-13T11:45Z · J2 · Bettor 派工 SendMessage 11:4xZ「先 (c)，docs 一页，交 NWT 审」）· 出处：Codex 9fff92b0 #5（"A perfect G-1 gate cannot make submit-accepted equivalent to chain-landed… MUST before any value-bearing mainnet wave"）· NWT 清单 v0.1/v0.2 ③ + ④-1 · CLAUDE.md 状态注记 2026-07-29（两处违反坐标）· 🔴 **钱路 ⇒ 实现 Owner 批**；本稿只裁不变量、修法、账本列、向量。
> 行号随 HEAD `aeda63a8`。与代币无关，任何带值波（波 2 起）前 MUST。

## 1. 事实（全部 grep 可核）

| # | 事实 | 出处 |
|---|---|---|
| V1 | `exchange-machine.js` kaspa 支付路径**硬构造"已确认"**：`if (payment_chain === 'kaspa') { … vr = { confirmed: true, confirmations: 1, … } }`，注释写 "submitTransaction = verified"；随后写 `meta.verified_tx / verified_at` 并沿 BUY 路推进。**验证器本身在**：`cross-chain-verify.mjs:169 verifyCrossChainTx` 的 kaspa 分支（`:183-`，`kaspa_tx_log` 优先 + RPC 降级，`:474-492`），这条路从未调它 | `exchange-machine.js:826-829` `trusting txId … (submitTransaction = verified)`；`:831-838` |
| V2 | `bettor-prediction-settler.js`：`sendCommandAsync(escrowRelay.id, { type:'transfer', target: winnerAddr, amount })` 返回 `txId` = relay **mempool submit 即回**（`relay.mjs:504-514`：`sent = { txId }` 后 `ingestTx(... direction:'outbound')`）；拿到 `payoutTxId` 即 `transition(offer.id, 'completed', { metadata: payout_tx })` 并写 `prediction_reputation_log 'paid'`——**无任何落链核实**。三次重试循环只看 `result?.txId` 为空就重发 | `bettor-prediction-settler.js:174-181, 198-205, 216` |
| V3 | **正路已存在**：relay 命令 `check_utxo_landed(address, txid, minDepth)` → `{ landed, depth }`（`relay.mjs:1196-1207` → `p2sh.mjs checkUtxoLanded`），`pool.js:1534/1795/2018`（minDepth=20 reorg-safe）与 `bshard-close-enforce.mjs:394` 都在用 | |
| V4 | **账本没有"落链"这一列**：`tx_records.status` 永远 `'broadcasted'`（DATABASE.md 自述"已知局限"），且**无 target_address 列**；`kaspa_tx_log` 只索引 `watched_addresses` 的收款输出（`to_address / block_hash / block_time`），发出方常为 NULL | `docs/DATABASE.md` §tx_records / §kaspa_tx_log |
| V5 | 本机库两条路痕迹全 0（`payout_tx / verified_tx / payment_tx` 皆无）⇒ 缺陷没显形，不是风险低 | CLAUDE.md 状态注记 07-29 |
| V6 | 既有对账 cron 形可照抄：`broker-state-reconciler.js`（5 min tick、v1 只 detect + alert 不自愈、查 `kaspa_tx_log` 对链上真相） | 文件头注 |

## 2. 不变量（Codex #5 落地形）

- **I1** `submit accepted ≠ chain landed`。relay 回 `txId` 只证进了本机 mempool（且可能输双花竞争，`relay.mjs:1198` 注释原话）。
- **I2** 代表"付款/派彩完成"的状态推进（`completed` / `verified_*`），**只能由独立的 landed+depth 证据触发**（`check_utxo_landed(minDepth ≥ N)` 或 `kaspa_tx_log` 命中 + 深度）。
- **I3** 失败/未知 = **非终态**：留在 `verifying` / `delivering`，下 tick 重核；**永不乐观写**（同 CLAUDE.md 第零条 bis）。
- **I4** 每笔递交必入账并有落链回写：`tx_records` 加 `target_address / landed_at / landed_depth / landed_checked_at`；对账器只认账本。
- **I5** 重试不得双付：重发前必先核"上一笔是否已在 mempool/已落链"（V2 的重试循环今天没有这一步——列为子发现，见 §7 Q2）。

## 3. 修法

| # | 站点 | 改什么 | 量级 |
|---|---|---|---|
| F1 | `exchange-machine.js:826-829` | 删硬构造分支；kaspa 也走 `verifyCrossChainTx({ chain:'kaspa', txHash: payment_tx, expectedAmount, expectedTo })`（已有实现）；在其结果上加深度门 `vr.confirmations ≥ KASPA_VERIFY_MIN_DEPTH`（env，默认 **20**，与 `pool.js` 同值）；不满足 ⇒ **不写 verified_***，offer 留 `verifying`，交既有 `timeoutVerifying`（30 min → timeout/dispute）兜底。`expectedTo` 对 kaspa 路 = `meta.receive_address || expected_address || offer.maker`（原逻辑保留） | ≈20 行 |
| F2 | `bettor-prediction-settler.js:174-216` | 拆两步：**(i) 递交**：拿到 `txId` 只写 `metadata.payout_tx + settle_outcome_phase:'submitted' + payout_submitted_at`，**不** transition，不写 reputation；**(ii) 核实**（同 tick 末或下 tick）：`check_utxo_landed(winnerAddr, payout_tx, minDepth = KASPA_PAYOUT_MIN_DEPTH(默认 20))` via `escrowRelay` ⇒ `landed` 才 `transition('completed')` + reputation `'paid'`（幂等：已 `completed` 不重做）；未 landed 且 `now − payout_submitted_at > 30 min` ⇒ events `payout_not_landed` + 留 `delivering`（不自动重发，见 I5）。**重试循环改法**：`result?.txId` 为空时先查 `metadata.payout_tx` / 上一次 submit 的 mempool 状态，有就不重发 | ≈60 行 + 幂等 |
| F3 | 新 `services/tx-landed-reconciler.mjs`（5 min cron，形同 `broker-state-reconciler.js`） | 源 = `tx_records WHERE direction='outbound' AND landed_at IS NULL AND created_at < now−10min`。逐笔：① `kaspa_tx_log` 按 `tx_id` 命中 ⇒ `landed_at = block_time, landed_depth = 当前 DAA − 块 DAA`（需 block DAA；kaspa_tx_log 现只有 block_hash/time ⇒ 先用 RPC `getBlock(block_hash)` 取 daaScore，或 ② `check_utxo_landed(target_address, txid, 0)` 拿 depth）。**T+10 min 三源无**（log 无 / landed=false / mempool 无）⇒ events `tx_not_landed`（level warn，payload 带 relay/trace）+ **冻结该 relay**（NWT 1001 ④-1）——v1 只 detect + alert（同 broker-state-reconciler v1 口径），冻结 = G-1 `readonly` 态落地后接（写一个 `relay_money_freeze` 标记表由 G-1 闸读） | 新文件 ≈200 行 |
| F4 | `migrate.js` vNNN（接末尾块，自查命令见 CLAUDE.md）+ `DATABASE.md` | `tx_records` 加 `target_address TEXT / landed_at TEXT / landed_depth INTEGER / landed_checked_at TEXT`；索引 `(direction, landed_at)`；`ingestTx` 16 处调用补传 `target_address`（relay `transfer` 分支已知 `cmd.target`） | 表改 + 16 处补参 |
| F5 | `relay.mjs:504` `ingestTx` | 带 `target_address: cmd.target`；`status` 仍 `'broadcasted'`（不改语义，落链信息只在新列） | 1 行 |

**不做**：不改 relay 的 submit 语义；不把 `check_utxo_landed` 塞进 `transfer` 命令里同步等（会把 relay 卡在 IPC 上 ≥20 块）。

## 4. 向量（每条一正一反 + 弱注入；离线 = 临时 DB + 假 `sendCommandAsync` / 假 `verifyCrossChainTx`）

| # | 设置 | 期望 |
|---|---|---|
| F1-正 | kaspa 支付 `payment_tx` 在 `kaspa_tx_log` 且 confirmations ≥ 20 | `verified_tx` 写入、推进 |
| F1-反 | log 无 + RPC 未知 | **不写** verified_*，offer 仍 `verifying`；30 min 后走 timeoutVerifying |
| F1-弱注入 | 同正向量，confirmations = 19 | 仍 `verifying`（证明门读的是深度） |
| F2-正 | transfer 回 txId；`check_utxo_landed` ⇒ `{landed:true, depth:25}` | `completed` 恰一次；reputation `'paid'` 恰一行 |
| F2-反 | `landed:false` | 留 `delivering`，`settle_outcome_phase='submitted'`，无 reputation 行 |
| F2-幂等 | 同 offer 再跑一 tick | 不再 transfer、不再 transition |
| F2-I5 | 第一次 sendCommand 抛超时但实际已广播（假 relay 记一次）| 第二次不重发（先查 payout_tx / mempool） |
| F3-正 | `tx_records` 一行 outbound 无 landed，`kaspa_tx_log` 有 | `landed_at/depth` 回写 |
| F3-反 | 三源无、age > 10 min | events `tx_not_landed` 一行（限频）；v1 不改 tx_records 状态 |
| F3-弱注入 | age 9 min | 不告警 |

## 5. 与 G-1 / (a) / 波次的关系

- G-1（节点可信闸）管**递交前**：节点同步、同网、本机；(c) 管**递交后**：落链核实。两者互补，缺一都不是 NO-TX。
- (a) strict local-only 保证 `check_utxo_landed` 与递交是**同一个节点**在答（否则"落链"也可能是别的节点的视图）。
- 波次：F1/F2/F4/F5 = 任何带值波（波 2）前 MUST；F3 v1（detect+alert）同批；F3 冻结 = G-1 readonly 态之后。

## 6. 工程量（估）

F1 ≈20 行 · F2 ≈60 行 + 幂等 + 3 向量 · F3 ≈200 行新文件 + cron 注册 · F4 迁移 + DATABASE.md + 16 处 `ingestTx` 补参 · F5 1 行。测试沿 `rpc-health-datacheck.test.mjs` 形（临时库 + 注入）。**全部钱路 ⇒ Owner 批**；建议一笔（F1+F2+F4+F5）+ 一笔（F3），F3 可后。

## 7. 请 NWT 判

1. **Q1 minDepth**：20（与 `pool.js` 一致）还是按 `REORG_SAFE_MIN_DEPTH`（`pool-shard-register.mjs`）单一源？我倾向引用后者。
2. **Q2 I5 双付**：settler 重试循环"超时即重发"是不是独立的既有缺陷（第一次实际已广播但 IPC 超时 ⇒ 第二次再付一次）——本稿只列，是否单开账请判。
3. **Q3 F3 的 depth 来源**：`kaspa_tx_log` 缺块 DAA，用 RPC `getBlock` 补还是给 kaspa_tx_log 加 `block_daa` 列（relay block-added 时就有）？我倾向加列（一次写，免每次 RPC）。
4. **Q4 冻结机制**：`relay_money_freeze` 标记表 vs 复用 G-1 `readonly` 态——等 G-1 设计定。

## 8. 没核到的

- `verifyCrossChainTx` kaspa 分支返回的 `confirmations` 是怎么算的（`:474-492` 只看到 `kaspa_tx_log` 命中；深度可能恒 1）——F1 的深度门可能要改成直接 `check_utxo_landed`。
- `timeoutVerifying` 对 kaspa 路是否会把"未落链"误判成 dispute（30 min 内正常落链，应无；未读那段）。
- settler 重试循环是否已有 mempool 查重（只看到 `result?.txId` 判空）。
