> **Status**: CURRENT（草稿 v0.1，2026-09-19，J2；批9 落码前的验收清单，供 Bettor/NWT 审；不是实现）

# 原型 v0 结算批9（驱动接线）验收清单草稿 v0.1

依据：实现计划 v0.8（`docs/2026-09-16-j2-proto-v0-settlement-implementation-plan-v0.1.md` §4/§7/§2.2）、NWT 批3/批4 审、Bettor 2026-09-19 各项裁定。
**本文只列"接线时必须满足什么、怎么证明"，不改任何代码。** D-021 合规：无真实地址/余额/私钥。

## 0. 前提与硬线

- 批9 接线的前提：六个 builder（批3–8）各自**先过 simnet**（D-022 生产字节闸）。当前状态：批3/4/5 已过 simnet（全链六笔 ACCEPT，见 `docs/provenance/2026-09-19-j2-fullchain-simnet/`）；
  **批6 claim_draw 仅离线（16/16，含真验签），未上 simnet**；批7 withdraw、批8 ticket_reclaim 未落码。批9 不得在批6–8 缺 simnet 证据时宣称"六步闭环"。
- 硬线（不因接线而放宽）：不发起任何主网链上花费；不启用任何驱动开关（含 simnet 之外的环境）；主网开闸走 D-022 另开闸、Owner 终端点 GO；合入主线不带运行时效果，
  主网 console 不为此重启。
- 🟡 route A 边界提醒：`pool_value=1000` 恰在 `payout >= 1000`（RootClaim.sil:103）边界上，`999` 会被 `deriveCloseCommitInputs` 拒（否则池子锁死）；任何改动 min_bet/stake 的运营参数变更都要先核这条。

## 1. 开关与启动日志（默认关闭）

| # | 验收项 | 怎么证明 |
|---|---|---|
| 1.1 | 新开关 `PROTO_SETTLEMENT_DRIVER_ENABLED`，**与既有 `PROTO_DRIVER_ENABLED` 独立**；且要求 `PROTO_RELAY_ID` 已配置才真启动（同 `isProtoDriverEnabled` 判据形状） | 单测：环境变量 3×2 组合 6 态，仅"两者皆真"启动 |
| 1.2 | 默认关闭：env 无该行 ⇒ 关闭；`kanet.mainnet.env` **不新增**该行（主网 env 断言：grep 不到） | 测试 + 部署前 grep 命令写进 runbook |
| 1.3 | 启动日志**必须**打印其一：`[proto-settlement-driver] disabled` 或 `[proto-settlement-driver] started (tick …ms, cap …/tick)`（照抄 `startProtoDriver` 的两行日志形状，监控按行 grep） | 单测捕获 console；测试新并行路径**逐字**打既有 canonical 日志形状 |
| 1.4 | 关闭时**不发任何 IPC、不建 prepared 行、不写任何状态**；HTTP 端点在关闭时返回 409 `proto_settlement_driver_disabled`（同下注端点的 `proto_driver_disabled` 语义，共用同一个判据函数，不复制） | 单测：关闭态下 spy `sendCommand` 调用数 = 0 |
| 1.5 | `stopProtoSettlementDriver` 与 `_started` 防重复启动、in-flight 单飞（tick 不重入）、`wrapTick` 观测，照抄既有 driver | 单测 |

## 2. 接线点清单（改哪、不改哪）

**改**：① 新 `src/services/proto-settlement-driver.mjs`（或扩 `proto-driver.mjs`，倾向新文件保持既有下注驱动零改动）；② `src/index.js` 增一处 `startProtoSettlementDriver()`（紧邻既有 `startProtoDriver` 注册，共用 `PROTO_RELAY_ID` 健康断言）；
③ `src/api/proto.js` 的 `resolve` / `claim` 端点接到意图状态机（现为 501 占位）；④ `docs/DATABASE.md`（`proto_settlement_intents` 表条目——批1 已建表，文档补齐）。
**已就位、不重复造**：`proto_settlement_intents`（migrate v210）、`proto-settlement-intent.mjs` 状态机、`/ingest/proto-bet-intent-phase` 的 `settle:` 分支、covenant_broadcast 复用（relay 侧零改动）、`proto-relay-ipc` 漏斗。
**relay 侧不改**（Bettor 裁定⑤）；per-kind fee cap 与校验在 console 侧各路径硬编码（`feeProfile.*.cap`）。

## 3. 每步入口闸（driver 层，builder 之前）

统一原则：**能在构造前拒的一律构造前拒；输入事实取链上（relay UTXO 快照/产出该 UTXO 的交易输出），不取本地推算当真**。

| 步骤 | 入口闸 |
|---|---|
| seal（market_seal） | 依赖：所有下注 `confirmed` 且 count == seal_count；held 存在（N2）；leaf/held 链上面值 == 20,000,000（N-1，`assertLeafStateMatchesChain` + held 同类）；fee cap = 52,000,000 |
| resolve（close_commit） | ① **pmt 闸**：`checkCloseCommitTiming({rpc, deadlineMs})`，`canSubmit` 才提交，读不到 pmt 一律不放行（`proto-close-commit-gate.mjs`）；② **B4-4**：`assertCloseCommitArgsFromDb`（胜方/`payoutRoot` 由 DB 派生，Σpayouts==pool_value，胜方恰 1 条，payout≥1000，库内 `payout_root` 不得分裂）；③ 链上 RootClose spk 传入 `rootCloseUtxoScriptPublicKeyHex`（B4-5，取自 seal 交易的真实输出）；④ 与 seal **背靠背**（MUST-2）：seal 的 `prepared_tx_json` 落库后才构造；⑤ builder 的 300s 墙钟守卫保留为第二层 |
| convert_to_claim | 依赖 close_commit `landed`；`rootCloseUtxoScriptPublicKeyHex`（B4-5，取自 close_commit 交易输出0）；held 代币 outpoint 取 seal 输出1；⚠ `feeProfile.convert_to_claim.cap` 暂借 1.0 KAS，**接线前必须替换为 NWT 按节点实测 requiredFee 推的专属值** |
| claim_draw | ① **Codex MUST-PROVE**：签名前 `assertTicketSigningKey`（由 proto_bets + 链上 ticket spk 推导并证明应签公钥，与私钥公钥逐字节相等，不等在 IPC 与签名之前 fail-closed）；② full 分支闸（payout==pool_value，否则**中止不构造**，partial 另一支）；③ RootClaim/ticket/held 三个输入的链上面值 == 常量（N-1 同族，driver 层断言）；④ 链上 RootClaim spk 传入（取自 convert_to_claim 交易输出0）；⑤ 赢票方向 == winningSide、现算 leaf == payoutRoot（builder 已 fail-closed，driver 再核一次不冲突） |
| withdraw / ticket_reclaim | 批7/8 落码后补；ticket_reclaim 的 fee 计算陷阱（计划 §2.6）与同一个 `assertTicketSigningKey` |

## 4. NO TX NO STATE / 意图状态机（不许乐观写）

- 广播成功 ≠ 状态推进：只有 relay `check_utxo_landed` 为真才把意图推进 `landed`；`prepared_tx_json` 在广播前落库（seal→close_commit 依赖它）。
- **NotFinalized**（节点 finality 拒）归"可重试、无状态变更"，**不得**进 `ambiguous`；`ambiguous` 只留给"广播结果不明"（超时/进程死）。需要单测：注入 NotFinalized 拒绝 ⇒ 意图状态不变、下一 tick 重试。
- 同一意图重复 tick 幂等（不重复广播）；依赖未 `landed` 的下一步不启动。
- 每笔上链交易入库：地址+txid 双锚点（CLAUDE.md 核心原则）；relay 关联 txid 不写进公开文档（D-021）。

## 5. SLA / 报警

- 基于 **pmt**（不用墙钟，B4-2 根治）：`evaluateCloseCommitTiming().sla`：`≥ deadline+1h` ⇒ `warn`（触发 `alertSettlementIntent` 事件），`≥ deadline+2h` ⇒ `refund_flip_open`（`RootClose.refund_flip` 无需签名，任何人可把 `closed 0→2`，且此后 close_commit 再也进不来）。
- 报警事件清单（沿用 `alertSettlementIntent`）：close_commit 超 1h 未提交；意图 `ambiguous`；`signing_key_mismatch`；`close_commit_args_not_from_db`；pmt 读取失败连续 N 次。
- `committeeMode='single_operator_5x_same_key'` **必须**进意图记录/响应（B4-6），不得把 close_commit 成功读成 4-of-5 门限安全。

## 6. 验收测试清单（批9 落码时逐条要有）

1. 开关 6 态 + 启动日志两种形状 + 关闭态零 IPC（§1）。
2. 每步入口闸的正反向量（§3），**反向必须真红**（变异对照：拆掉该闸测试变红）。
3. 意图状态机：NotFinalized 重试无状态变更；ambiguous 不自动重发；依赖顺序；幂等（§4）。
4. **端到端集成验证（计划 §6 第7条）**：driver 开关在**隔离 simnet console**（不是主网 console）上开启，走一次完整 genesis→…→claim_draw（→ withdraw / reclaim 视批7/8 进度），
   每步记录：交易 version、编码器 commit、节点 sha256+`--version`、断言信号 vs 节点值（不等即停）、区块记录节点原始字段；证据入 `docs/provenance/<日期>-…`。
5. 合入前全套 proto 测试 + lint 0；迁移编号接主线末块；`kanet.mainnet.env` 不含新开关行。
6. 夹具真实性：所有 UTXO mock 的面值必须能追溯到一笔真实链上交易（ANTI-PATTERNS 候选：夹具与生产路径不一致族）。

## 7. 已知未决 / 需裁定

- `convert_to_claim` 专属 fee cap（等 NWT 推数）；`withdraw`/`ticket_reclaim` 的 cap 同理。
- `committee_mode` 在意图表里放哪一列（`proto_settlement_intents` 现无该列；加列要走迁移，或放 `meta`/响应体）——需 Bettor 裁定。
- N-1 真修（builder 用链上真实面值算 leftover）并入 D-018 重评估，另开票；本清单只要求入口拦截。
- partial 分支（payout<pool_value）与 RootClaim 的 `payout>=1000` 修复归另一支，不在批9。
- 主网开闸：D-022 另开闸；本清单**不**授权任何主网动作。
