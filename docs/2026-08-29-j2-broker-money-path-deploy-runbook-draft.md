# broker-money-path 批 · 部署单 v0.3（batch-1 + batch-2 · 同维护窗 runbook 风格 · 独立于节点/supervisor 维护窗）

> **Status**: v0.2 · J2 2026-08-29 · Bettor 令 · 对象 = 侧分支 `coord/broker-money-path` **头 `cbeb0a93`**（阶段 1 `0f62e539` / 阶段 2 `8e186cba` / 阶段 3 `aba0b94c`→fix-up `c1a35749`→`18b0bbfa`→`cbeb0a93`，**全部 NWT GREEN**；对主分支 `75b3aa82` 差分 **34 files, +1212 / −237**）· **不 merge 进 `bshard-m3-deploy` 直到 Owner 批**（主分支检出 = live 树 = boot 加载源，merge 即部署）· 执行人由 Bettor 指派（提权），J2 只读验收。
> **v0.3 头注（2026-08-29 晚）**：batch-1 侧分支头已从 `cbeb0a93` 前进到 **`66b5d38c`**（叠 fix-up 4 `b10eddd0` 第六数 / 5 `cc5349a4` 第七数 / 6 `66b5d38c` unknown_1h 两型，hold-monitor 11/11）；下文 P1/P2/§5 里的 `cbeb0a93` 读作 `66b5d38c`（Owner 回执须写明审的是 `66b5d38c`）。回滚锚表 §2.1 不变（fix-up 只动 `broker-hold-monitor.*`，那是 A 文件）。batch-2 见文末 v0.3 增补段。
> v0.1→v0.2 变更：侧分支定头；P4 由"未做"改为实测 355 ms；P4-bis ADJ 措辞按 Bettor 改"由 P4 实测判校准好"；§0 P7–P9 运营前置补齐；§1-③ 回滚锚改为**逐文件 sha 表**（§2.1）；新增 §4 v199/v200 拆分、§5 验收清单（可勾）、§6 本单自身的验证方法。

## §0 前提（全满足才开）
| # | 前提 | 判据 |
|---|---|---|
| P1 | 侧分支头 = 审过的 sha | `git -C scratch/_wt_bmp rev-parse --short HEAD` = `cbeb0a93`；`origin/coord/broker-money-path` 同值（Bettor 推后）|
| P2 | **Owner 批 broker-money-path 批**（钱路，铁律 0） | Bettor 单点上报回执，回执须写明**审的是 `cbeb0a93`**（memory: 问"GO 审的是哪版"）|
| P3 | **Owner 定 A/B**（`held_for_review` 可逆态 vs `failed+no_escrow`）| 定 B ⇒ v200 重建进本批或下批（§4）；定 A ⇒ `BROKER_RECONCILE_MODE=failed` 写进 kanet.env 且 `RECONCILE_MODE_ACTIVE` 常量旁注钉死。**未定 ⇒ 代码默认 B 且枚举缺 ⇒ `orderStateEnumSupports` 判 false ⇒ 退化 alert_once（不 transition）**——可部署，reconcile 对 NOT_PAID 单只告警不动 |
| P4 | v199 一次性索引 `idx_spc_daa_ts` 建在 **263 MB `spc_daa_index`** 上，boot 时 `runMigrations()` 同步主线程建 ⇒ 须在 supervisor boot-grace（`BOOT_GRACE_SEC=300`）内完成 | **离线实测（2026-08-29，07-23 bak 副本 1,660,524 行，事务内 CREATE INDEX 后 ROLLBACK 只取时长）= 355 ms** ⇒ live（行数约 ×1.5）估 < 1 s，远在 grace 内。✅ 不需窗内手工预建 |
| P4-bis | `COVERAGE_ADJ_DAA`（`api/ingest.js` 默认 20）**由 P4 同一份离线实测判"校准好"**：链块相邻 DAA 间距（`spc_daa_index` LAG 差分，n=1,600,524）p50/p90/p99 = **2**，**p999 = 7**，max 885,354；>20 的 **346** 处全是真洞（relay 停机/追块）| ✅ **p999=7 ⇒ 正常间距零 false-hole；>20 全真洞** ⇒ 默认值成立，不需改 env（fd146fe2 R3 "P99 定"已核）|
| P5 | `kanet.env` 已有 `BROKER_RELAY_ID`（`relay_nodes` 取 broker 地址）或新增 `BROKER_KAS_ADDR=<TN12 地址>`；前缀与 `KASPA_NETWORK` 一致 | 否则 escrow 全 UNKNOWN（安全但无用）；窗前 `grep -E "BROKER_RELAY_ID|BROKER_KAS_ADDR" kanet.env` 非空 |
| P6 | 与节点/supervisor 维护窗**正交**：不与 57fde30f / supervisor v0.1.4 / 红线 7 同批；可同一天不同窗 | Bettor 排期 |
| **P7 运营前置 (a)**（NWT，retail 开放前）| UI/tg-bot 把 `skipReason`（`refund_unknown_hold` / `refund_*_no_resend` / `refund_ambiguous_broadcast` / `held_for_review`）译成用户可读的"退款处理中 / 待复核"——**用户面文案 = Owner 批** | 文案稿 + Owner 一句；**未落不阻塞部署**，但阻塞"对外开 retail" |
| **P8 运营前置 (b)** | held 队列人工 SOP：谁看（Bettor 指派）、多久内解（建议 24 h）、解法（relay `check_utxo_landed` 核 intent txid → `recordRefundIntentTxid` 回填 / 人工放回 `awaiting_payment` / 人工 `no_escrow` 二次确认）| SOP 一页（J2 可起草，Bettor 定人）|
| **P9 运营前置 (c)** | UNKNOWN 须 rare：hold-monitor 第五个数 `unknown_1h`（每小时 `events` 里 `refund_unknown_hold + broker_escrow_unknown` 计数）超阈告警；配合 `rpc-health` + `coverage_lag` 一并看 | ✅ 已落 `18b0bbfa`（hold-monitor 9/9）|

## §1 步骤
| # | 步骤 | 执行人 | 只读验证 | 通过判据 |
|---|---|---|---|---|
| ① | 通知 + announce-freeze（broker 相关：窗内不发 retail/exchange 单、不取消、不退款；**quiesce ingress**：提现 DM / exchange 协议消息 / bettor HTTP / faucet 皆属花钱面，memory `feedback-preshutdown-money-surface…`）| Bettor | 频道 + SendMessage | 回执 |
| ② | 在飞检查（维护窗 runbook §检查②的 broker 子集：`_scanExpiredBrokerOffers` / `reconcileStaleOrders` / `broker-action-queue` 无在飞 sendKas；`retail_dex_orders` 无 `refunding`；`broker_refund_intents` 表尚不存在 = 正常）| KANet-UI 只读 | SQL 只读（07-23 bak 不行，须 live 只读句柄：`?mode=ro` 或 relay 只读 API）| 全空 |
| ③ | **钉回滚锚**：对 §2.1 表里 11 个文件逐个 `git show HEAD:<path> \| sha256sum` 与表比对（主分支自 `75b3aa82` 起这 11 个文件**未被别的 commit 动过**才成立；有差 ⇒ 停，重算表再 merge）| Bettor/提权 | 命令输出 | 11/11 一致 |
| ④ | **merge**：`git status` 干净 → `git merge --no-ff coord/broker-money-path` 进 `bshard-m3-deploy` | Bettor/提权 | `git log -1`、`git diff --stat HEAD~1` = 34 files | 无冲突；文件集 = §2.1 表 + 新增 libs/tests/docs |
| ⑤ | **console 单体重启**（维护窗 runbook §检查③：`taskkill //F //T` → 0 relay 存活 → `_launch_console_single.ps1`；boot-marker `logs/console-boot.txt` 出现）| J1/提权 | 同 runbook | 新 PID、`[db] path=…`、boot 用时 < 300 s |
| ⑥ | **迁移验收**：`SELECT name FROM sqlite_master WHERE name IN ('kaspa_tx_log_coverage','broker_refund_intents','idx_spc_daa_ts')` = **3 行**；boot 日志含 `[migrate] v199`（自查：`grep -n "// ── v199" kasia-console/src/db/migrate.js`）| KANet-UI 只读 | better-sqlite3 readonly | 3 行 + 日志行 |
| ⑦ | **服务验收**（首小时）：`[broker-hold-monitor]` 首行五个数（`held / stuck_refunding / intent_stale / coverage_lag / unknown_1h`）；`reconcileStaleOrders` 日志行含 `mode=held_for_review`（或 A 的 `failed`）；无 `refund_send_failed` 新增；`events` 里 `broker_escrow_unknown` / `refund_unknown_hold` 若出现 = 配置/索引问题的**告警**而非故障（读 `reason`）| KANet-UI 只读 | 日志 + events | 首行出现 + 无 crash |
| ⑧ | **coverage 推进验收**（阶段 3 已在本批）：relay 起来后 ≥ 1 个 finality drain 周期，`SELECT indexer, max(end_daa) FROM kaspa_tx_log_coverage GROUP BY indexer` 有 `relay:<RELAY_NODE_ID>` 行；与 `spc_tip_heartbeat.daa_score` 差 < 3,600 | KANet-UI 只读 | SQL | 有行 + 差 < 阈 |
| ⑨ | **解冻**：①的 freeze 撤销；第一笔真实退款走新路时盯 `broker_refund_intents`（intent 行先于 sendKas 出现 = write-ahead 生效）| Bettor | events + 表 | intent 行 + txid 回填 |

## §2 回滚
| 失败信号 | 回滚 |
|---|---|
| ③ 锚不一致 | 不 merge；重算 §2.1 表（主分支有人动过同名文件 = 需重新 rebase 侧分支 + NWT 再审）|
| ④ merge 冲突 | `git merge --abort`；不重启 |
| ⑤ 新 console 起不来 / boot 超 grace | `git revert -m 1 <merge-sha>` → 重启；**v199 表/索引留着无害**（纯新增；旧码无写入方/无读取方）|
| ⑥ 迁移日志缺 / 表缺 | 不推进；报 NWT/DB 属主；**别手插**（memory `feedback-no-db-hack…`）|
| ⑦ 退款/escrow 路异常（如全 UNKNOWN 持续）| 不需回滚代码：那是 fail-closed；查 `events.reason`（RPC 缺 / 前缀错 / coverage 无账）修配置；若要恢复旧行为 ⇒ revert merge |
| ⑧ coverage 无行 | relay 未走新码（检查 relay 子进程是否随 console 重启；memory `reference-console-restart-orphans-inflight-relay-child…`）；无行 ⇒ 所有否定断言不可达 ⇒ 退款全 hold（安全）|
| v200（若同批） | 重建前钉旧 schema（`SELECT sql FROM sqlite_master WHERE name='retail_dex_orders'` 存文件 + sha256）+ 表副本 `retail_dex_orders_bak_v200`；回滚 = 反向重建（窗内、Owner 批）|

### §2.1 回滚锚（主分支 `75b3aa82` 时各文件 sha256 前 16 hex；merge 前按 §1-③ 复核）
| 文件（主分支路径）| sha256[:16] @75b3aa82 |
|---|---|
| `kasia-console/src/db/migrate.js` | `8607d8a6d50b3282` |
| `kasia-console/src/services/broker-state-authority.js` | `6f9dd812302e2505` |
| `kasia-console/src/services/broker-refund-dedup.js` | `47782f5e01e1be64` |
| `kasia-console/src/services/broker-state-machine.js` | `d94cf3be0c04644d` |
| `kasia-console/src/services/broker-action-queue.js` | `e4c43eca038ef255` |
| `kasia-console/src/services/broker-intake-watcher.js` | `e43488dfd86ff39e` |
| `kasia-console/src/services/broker-cancel-refund.js` | `071fd1385cbbdde8` |
| `kasia-console/src/api/ingest.js` | `02a4d9e8f351f075` |
| `kasia-console/src/index.js` | `f8ac1f2ac042d068` |
| `kasia-relay/src/ingest.mjs` | `6b49386cf2e35eb1` |
| `kasia-relay/src/rpc-listener.mjs` | `15cb17ba25665e1e` |

复核命令（Git Bash）：`for f in <上表路径>; do printf '%s %s\n' "$(git show HEAD:$f | sha256sum | cut -c1-16)" "$f"; done`。
其余 23 个文件为**新增**（libs `indexer-coverage / broker-refund-classify / broker-escrow-check / kaspa-utxo-lookup`、`services/broker-hold-monitor.mjs`、各 `.test.mjs`、`docs/DATABASE.md` 段落等）⇒ revert 即删，无锚需求。

## §3 边界
- 阶段 3 已在本批 ⇒ coverage 账有写入方（relay finality drain）；但**首次 drain 前**所有需要 coverage 的否定断言（NOT_PAID / NOT_REFUNDED）结构上不可达 ⇒ escrow 只会 UNKNOWN/ESCROWED、退款只会 CONFIRMED/INTENT/INFLIGHT/UNKNOWN ⇒ 新退款一律 hold + 告警。这是有意的 fail-closed；§1-⑧ 过了才算"自动退款恢复"。写进 Owner 单点上报：**上线到 ⑧ 之间退款自动路暂停**。
- coverage 账**只从部署起**推进；历史区间（`kaspa_tx_log` 87% 体量的老数据）无账 ⇒ 对老 offer 的否定断言永远 UNKNOWN ⇒ 老单只能走 P8 人工 SOP。这是设计（L2 phase-1 conservative），不是缺陷。
- P4 计时在 07-23 bak 副本上做，live 行数更多（估 ×1.5）；若 live boot 日志显示 `[migrate] v199` 用时 > 30 s 就把这条实测作废并重估。

## §4 v199 / v200 拆分
| 版本 | 内容 | 依赖 | 批 |
|---|---|---|---|
| **v199**（本批，`0f62e539`）| 新表 `kaspa_tx_log_coverage`、`broker_refund_intents`；索引 `idx_spc_daa_ts` | 无（纯新增）| broker-money-path |
| **v200**（未落，待 Owner 定 B）| `retail_dex_orders` **表重建**：`state` CHECK 枚举加 `held_for_review`（SQLite 不能 ALTER CHECK ⇒ 建新表 + 拷 + 改名）| Owner A/B；窗内 + 表副本 | 同批或下批（Bettor 定）|
- 定 A ⇒ v200 不做；定 B 但下批 ⇒ 本批 reconcile 退化 alert_once（P3），不丢单不误判。

## §5 验收清单（执行人逐项勾，J2 只读复核）
- [ ] P1 侧分支头 = `cbeb0a93`（推后 origin 同值）
- [ ] P2 Owner 批回执写明 `cbeb0a93`
- [ ] P3 A/B 已定或明确"未定 = 退化 alert_once"
- [ ] P5 `BROKER_RELAY_ID` / `BROKER_KAS_ADDR` 非空且前缀对
- [ ] §1-② 在飞全空
- [ ] §1-③ 锚 11/11 一致
- [ ] §1-④ merge 无冲突，`--stat` = 34 files
- [ ] §1-⑤ boot < 300 s，boot-marker 出现
- [ ] §1-⑥ sqlite_master 3 行 + `[migrate] v199` 日志
- [ ] §1-⑦ hold-monitor 首行五数 + reconcile mode 行 + 无 crash
- [ ] §1-⑧ coverage 有 `relay:*` 行且 lag < 3,600
- [ ] §1-⑨ 解冻后首笔退款 intent 行先于 sendKas
- [ ] P7/P8 状态（未落 ⇒ retail 不对外开）

## §6 本单的验证方法（不信本单，信命令）
- 侧分支头/差分：`git -C scratch/_wt_bmp rev-parse --short HEAD`；`git -C scratch/_wt_bmp diff --stat bshard-m3-deploy...HEAD | tail -1`
- 测试（侧分支 worktree 内跑）：`node kasia-console/src/lib/indexer-coverage.test.mjs`(18) / `broker-refund-classify.test.mjs`(21) / `broker-escrow-check.test.mjs`(16)；`node kasia-console/src/services/broker-hold-monitor.test.mjs`(9)；`node kasia-console/src/services/broker-intake-watcher.prefilter.test.mjs`(5)；refund-lock 10 / reconcile 7
- P4/P4-bis 数字来源：`scratch/_j2_eventloop_db_audit/`（07-23 bak 副本，只读；复跑同目录脚本）
- ADJ：`grep -n COVERAGE_ADJ_DAA kasia-console/src/api/ingest.js`（侧分支）

---
# v0.3 增补 · batch-2（`coord/broker-money-path-2`）部署段
> **Status**: v0.3 · J2 2026-08-29 晚 · Bettor 令 · batch-2 头 **`3277183a`**（从 origin `fe6ad45e` 开，**不叠 batch-1**；对 `fe6ad45e` **19 files, +628 / −37**）· NWT 审中（hedge-call 突变 / explorer 改法最小性 / "其余四入口有上限"复核 / 第七数 vs unknown_1h 两型）· 与 batch-1（头 `66b5d38c`，25 files +1247/−116，含 fix-up 4/5/6）**各自可批可回滚**；同窗部署顺序 batch-1 → batch-2（batch-2 的 ambiguous 事件靠 batch-1 hold-monitor 看见）。

## §B2-1 文件表（19）
| 类 | 文件 | 说明 |
|---|---|---|
| **M**（5，回滚锚 = `fe6ad45e` 版 sha256[:16]）| `kasia-console/src/services/broker-intake-watcher.js` `e43488dfd86ff39e` | P2 intent write-ahead + Z20/fallback 片段 + tick-guard 接线；§7.1 `refund_candidate_from` |
| | `kasia-console/src/services/broker-v2/router.js` `28bbffb59daebb4a` | P11 借记先行 + 120 s 上限 + ambiguous 告警 |
| | `kasia-console/src/api/conversations.js` `f422fc0ed96906d0` | per-peer 锁接五入口 + rejectAfterMs 拒回 |
| | `kasia-console/src/services/exchange-machine.js` `d835b53b40baa45f` | DEFECT1 `executeHedge` 传参镜像 + 顺手 explorer 链接改 `formatTxReference` |
| | `kasia-console/src/services/broker-bsc-intake-watcher.js` `7bcedf2a6ccf6faa` | §7.1 入金 sender 先记 marker 再 publish |
| **A**（14）| `lib/{broker-fallback-intent,tick-guard,peer-serial-lock,user-ledger-withdraw,with-timeout,broker-buy-inflow}.mjs` + 各 `.test.mjs`（tick-guard/peer-serial-lock/user-ledger-withdraw/with-timeout/broker-buy-inflow）+ `services/broker-intake-watcher.fallback-intent.test.mjs` + `services/broker-v2/router.withdraw.test.mjs` + `services/exchange-machine.hedge-call.test.mjs` | 纯新增，revert 即删 |
- **无 migrate**（batch-2 不加表不加列：intent/claim/inflow 都走 `chain_events` / `broker_workflow_markers` 既有表）。

## §B2-2 env（三项 + 一门）
| 项 | 默认 | 说明 |
|---|---|---|
| `BROKER_WITHDRAW_TIMEOUT_MS` | `120000` | v2 withdraw `transferUsdt` 本地上限；超时 = 结果不明 ⇒ 不冲正 + `events withdraw_ambiguous`（底层 ethers 默认 300 s 仍在跑）|
| `BROKER_PEER_LOCK_REJECT_MS` | `180000` | 同 peer 等锁超此值 ⇒ 拒本条（不执行），回「⏳ 系统繁忙，请稍后再试。」；`0` = 不拒只告警。须 > handler 最大耗时（120 s + LLM）|
| `COVERAGE_ADJ_DAA` | `20`（batch-1）| 不变 |
| **`hedge_enabled` 门现值** | 🔴 **见 §B2-5**：门读的是 `exchange_offers.meta`，而该列**不存在**（07-23 bak `PRAGMA table_info` 无 `meta`，migrate.js 无 `ADD COLUMN meta`；写方 broker-intake `:355` / broker-v3 `:178/:189` 写的是 `metadata.hedge_enabled:true`）⇒ 门的 `SELECT meta` **抛 SqliteError** ⇒ 三处调用全部被 `.catch` 吞 ⇒ **hedge 在 live 从未跑过、修 DEFECT1 后仍不会跑** | 不需要 env；这是 DEFECT1b，Owner 决定要不要真开 |

## §B2-3 回滚
| 信号 | 回滚 |
|---|---|
| 任一 M 文件锚不一致（merge 前 `git show HEAD:<path> \| sha256sum`）| 不 merge；重 rebase + NWT 再审 |
| console 起不来 | `git revert -m 1 <merge-sha>` → 单体重启；14 个 A 文件随 revert 删，无表/列需清 |
| `refund_tick_overrun` 持续（每 tick 都跳）| 不回滚：说明 tick 真的 >5 min，查哪段慢（tick 各段日志）；回滚只会让它回到叠跑 |
| `withdraw_ambiguous` / `broker_fallback_ambiguous` 出现 | 不回滚：fail-closed 生效；人工核链/CEX 按 SOP 解（P8）|
| 拒回「系统繁忙」频发 | 先看 `peer-lock REJECT` 日志的 waited 秒数：若 <180 s 前一条正常慢 ⇒ 调大 `BROKER_PEER_LOCK_REJECT_MS`；若前一条真挂 ⇒ 看它挂在哪个外部调用 |

## §B2-4 验收（执行人勾，J2 只读复核）
- [ ] 锚 5/5 一致；`git diff --stat HEAD~1` = 19 files
- [ ] boot 日志无 `SyntaxError`/import 错；`[broker-intake] watcher started`；首个 5 min tick 无 `guarded tick err`
- [ ] **rejectAfterMs 可观测**：构造同 peer 两条 DM（第一条走 LLM 慢路）⇒ 第二条**排队**（`peer-lock wait` 日志 30 s 后出现）而非并行；把 `BROKER_PEER_LOCK_REJECT_MS=5000` 临时缩短 ⇒ 第二条回「⏳ 系统繁忙，请稍后再试。」且 `peer-lock REJECT` 日志；恢复默认
- [ ] **buy_inflow marker 首笔落库**：一笔真实 BUY 入金后 `SELECT * FROM broker_workflow_markers WHERE event_type='broker_buy_inflow'` 有行，payload.from = 入金 tx 的 from（与 bscscan 对）
- [ ] **hedge：`hedge_gate_error` 事件可见 / 仍零 CEX**（batch-2 追加笔落后）：一笔 broker offer 完成后 `events`/`chain_events` 出现 `hedge_gate_error {offer_id, error: no such column: meta}`（= 门抛被记录，不再静默），且 `SELECT count(*) FROM chain_events WHERE event_type LIKE 'hedge%'` 仍 = 0、Gate.io 无新单；追加笔未落前本项 = "仍零 CEX" 一条。真开对冲（改读 `metadata`）= Owner 独立批，不在本单
- [ ] P2：首个 T2.5c 触发时 `chain_events` 里 `broker_fallback_intent` **先于** `broker_fallback_claim`（observed_at）
- [ ] P11：一笔真实提币 ⇒ `user_ledger` 先有 `withdraw_pending:` 行再变 `withdraw_user_initiated:…`；余额在转账期间已减
- [ ] hold-monitor（batch-1）首行含 `manual_refund_pending=` `fallback_ambiguous=`

## §B2-5 🔴 用户面变更清单（2 处，随批报 Owner）+ DEFECT1b
1. `exchange-machine.js` `dm_kas_delivered` DM：原 `TX: <txid>\n查看: https://explorer.kaspa.org/txs/<txid>`（TN12 上是死链）→ `formatTxReference(buildExplorerUrl(...))`。触发原因：`R-EXPLORER-URL-BYPASS` 规则挡 commit（既有硬编码，无 allow 标记）。**两种渲染样例（Owner 随批复核；`explorer-url.mjs:15-18` `buildExplorerUrl` testnet ⇒ null、mainnet ⇒ URL；`:51-54` `formatTxReference` = url ? url : `TX: <txid>`）**：
   - **TN12（现 live）**：`✅ 已发出 5 KAS 到你 Kasia 钱包, 1-2 分钟到账.` ↵↵ `TX: 3f9a…c2e1` ↵↵ …（原：`TX: 3f9a…c2e1` ↵ `查看: https://explorer.kaspa.org/txs/3f9a…c2e1` ← 死链）
   - **mainnet**：`✅ 已发出 5 KAS …` ↵↵ `https://explorer.kaspa.org/txs/3f9a…c2e1` ↵↵ …（🟡 与旧形不同：旧的是 `TX: <txid>` + `查看: <url>` 两行，新的是**只一行 URL、没有 `TX:` 前缀**——`formatTxReference` 的既有语义如此，`broker-state-authority.js:43` 已这样用；若 Owner 要保留 mainnet 两行形，改 `formatTxReference` 是另一处用户面）
2. `conversations.js` 拒回：**逐字复用** `tg-bot/i18n.mjs:428 service_busy`「⏳ 系统繁忙，请稍后再试。」——零新造文案；只在 rejectAfterMs 触发时出现。
- **DEFECT1b（新，NWT 定级）**：`_executeHedge` 门 `SELECT meta FROM exchange_offers`（`trade-protocol-filter.js:2191-2193`）读不存在的列 ⇒ 抛 ⇒ 三处调用全吞 ⇒ **hedge 从未在 live 跑过**（bak `chain_events hedge%` = 0 条印证）。DEFECT1 修传参**不改变**这一点（安全）。要真开对冲 = 改读 `metadata` + 因写方全置 `hedge_enabled:true` 而等于对所有 broker offer 开 CEX 对冲 ⇒ Owner 级决定，独立批。
