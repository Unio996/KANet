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
> **Status**: v0.3 · J2 2026-08-29 晚 · Bettor 令 · batch-2 头 **`8473f1ec`**（从 origin `fe6ad45e` 开，**不叠 batch-1**；对 `fe6ad45e` **23 files, +1019 / −55**；`3277183a` 之后叠：DEFECT1b 可见性 `9c80babc`、P7-bis 两处 reopen 门 + explorer (B) `042ffdea`、write-ahead 付款意图 `6554b8d9`、SQL 层兜底 `81282118`、远端 paid 写谓词 `8473f1ec`）· NWT 审中（hedge-call 突变 / explorer 改法最小性 / "其余四入口有上限"复核 / 第七数 vs unknown_1h 两型）· 与 batch-1（头 `66b5d38c`，25 files +1247/−116，含 fix-up 4/5/6）**各自可批可回滚**；同窗部署顺序 batch-1 → batch-2（batch-2 的 ambiguous 事件靠 batch-1 hold-monitor 看见）。
> **v0.5 头注（2026-08-29 · 按 NWT 审注 `507f7e6d` `docs/2026-08-29-nwt-deploy-sheet-v03-review.md` 改，Bettor 派）**：① §B2-4 加 **PENDING 付款意图生命周期**独立验收（承重补项）；② §B2-3 锚复核基准改为**本批 merge 前的 HEAD**（batch-1→batch-2 顺序下 `broker-intake-watcher.js` 已非 `fe6ad45e` 版，照旧对 `fe6ad45e` 算会误报 MISMATCH）并写成命令；③ hedge 验收精化为 **hedge-enabled offer**；④ §B2-6（eta guard）补验证法指向 provenance；⑤ 依赖性质点明：batch-2 对 batch-1 v199 **零硬依赖**（不加表不加列、不读 `kaspa_tx_log_coverage`/`broker_refund_intents`/`idx_spc_daa_ts`），**软依赖 = 可见性**（`autopay_ambiguous`/`withdraw_ambiguous`/`broker_fallback_ambiguous` 由 batch-1 hold-monitor 第六/七数 + unknown_1h surface；batch-2 单独部署 = money-safe 但盲）⇒ 顺序 batch-1→batch-2 是"让 ambiguous 从 T+0 被看见"，不是功能依赖；§B2-4 的 hold-monitor 项标 **前置 = batch-1 已落**；⑥ 各验收项贴期望输出 / FAIL 形；新增 §B2-7 验证方法（batch-2 的"不信本单信命令"）。NWT 已亲核：回滚锚 6/6、env 3/3。

## §B2-1 文件表（19）
| 类 | 文件 | 说明 |
|---|---|---|
| **M**（6，回滚锚 = `fe6ad45e` 版 sha256[:16]）| `kasia-console/src/services/broker-intake-watcher.js` `e43488dfd86ff39e` | P2 intent write-ahead + Z20/fallback 片段 + tick-guard 接线；§7.1 `refund_candidate_from` |
| | `kasia-console/src/services/broker-v2/router.js` `28bbffb59daebb4a` | P11 借记先行 + 120 s 上限 + ambiguous 告警 |
| | `kasia-console/src/api/conversations.js` `f422fc0ed96906d0` | per-peer 锁接五入口 + rejectAfterMs 拒回 |
| | `kasia-console/src/services/exchange-machine.js` `d835b53b40baa45f` | DEFECT1 `executeHedge` 传参镜像 + 顺手 explorer 链接改 `formatTxReference` |
| | `kasia-console/src/services/broker-bsc-intake-watcher.js` `7bcedf2a6ccf6faa` | §7.1 入金 sender 先记 marker 再 publish |
| | `kasia-console/src/services/trade-protocol-filter.js` `15d853d7796fd0a6` | DEFECT1b 可见性(hedge 门窄 catch) + P7-bis tpf timeout 门 + write-ahead 付款意图两路 + 读方审计注释 |
| **A**（17）| `lib/{broker-fallback-intent,tick-guard,peer-serial-lock,user-ledger-withdraw,with-timeout,broker-buy-inflow}.mjs` + 各 `.test.mjs`（tick-guard/peer-serial-lock/user-ledger-withdraw/with-timeout/broker-buy-inflow）+ `services/` 下 `broker-intake-watcher.fallback-intent` / `broker-v2/router.withdraw` / `exchange-machine.hedge-call` / `exchange-machine.reopen-guard` / `trade-protocol-filter.hedge-gate` / `trade-protocol-filter.payment-intent` 六个 `.test.mjs` | 纯新增，revert 即删 |
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
| 任一 M 文件锚不一致 | 不 merge；重 rebase + NWT 再审 |
| **锚复核基准（v0.5，NWT ①）= 本批 merge 那一刻的 `HEAD`，不是原始 `fe6ad45e`**。§B2-1 的 6 个 sha 是对 `fe6ad45e` 算的；**若 batch-1 已先 merge，`broker-intake-watcher.js` 在 HEAD 上已是 batch-1 版**（batch-1 §2.1 与 §B2-1 的 `e43488dfd86ff39e` 同值不是笔误——两批各对各 base 算，该文件在两 base 内容一致；batch-1 merge 后它就变了），其余 5 个 M 文件 batch-1 不碰 ⇒ 仍应等于 §B2-1 值。命令（merge 前在主树跑）：`for f in services/broker-intake-watcher.js services/broker-v2/router.js api/conversations.js services/exchange-machine.js services/broker-bsc-intake-watcher.js services/trade-protocol-filter.js; do printf '%s ' "$f"; git show HEAD:kasia-console/src/$f \| sha256sum \| cut -c1-16; done` ⇒ 5 个 = §B2-1 值；`broker-intake-watcher.js` 须 = **batch-1 后值**，另钉：`git show 66b5d38c:kasia-console/src/services/broker-intake-watcher.js \| sha256sum \| cut -c1-16`（batch-1 头；若 batch-1 头前进则换头重算）。**batch-2 分支自身 rebase 到该 HEAD 后 merge 无冲突**才算基准成立 | 任一不等 = 有人在 merge 窗外改了 M 文件 ⇒ 不 merge，查谁改的 |
| console 起不来 | `git revert -m 1 <merge-sha>` → 单体重启；14 个 A 文件随 revert 删，无表/列需清 |
| `refund_tick_overrun` 持续（每 tick 都跳）| 不回滚：说明 tick 真的 >5 min，查哪段慢（tick 各段日志）；回滚只会让它回到叠跑 |
| `withdraw_ambiguous` / `broker_fallback_ambiguous` 出现 | 不回滚：fail-closed 生效；人工核链/CEX 按 SOP 解（P8）|
| 拒回「系统繁忙」频发 | 先看 `peer-lock REJECT` 日志的 waited 秒数：若 <180 s 前一条正常慢 ⇒ 调大 `BROKER_PEER_LOCK_REJECT_MS`；若前一条真挂 ⇒ 看它挂在哪个外部调用 |

## §B2-4 验收（执行人勾，J2 只读复核）· v0.5 每项带「期望输出（PASS）/ FAIL 形」（NWT ③⑥）
| # | 项 | 测法 | 期望输出（PASS）| FAIL 形 |
|---|---|---|---|---|
| 1 | 锚 + 文件数 | §B2-3 基准命令 | **6/6** 按 §B2-3 基准相等；`git diff --stat HEAD~1` = **23 files（6 M + 17 A）** | 任一不等 / 文件数 ≠ 23 |
| 2 | boot | 起 console 看日志 | 无 `SyntaxError`/import 错；`[broker-intake] watcher started`；首个 5 min tick 无 `guarded tick err` | 起不来 ⇒ §B2-3 revert |
| 3 | **rejectAfterMs 可观测** | 同 peer 两条 DM（第一条走 LLM 慢路）；再临时 `BROKER_PEER_LOCK_REJECT_MS=5000` 重做；恢复默认 | 第二条**排队**：`peer-lock wait` 日志 30 s 后出现（非并行）；缩 5000 后第二条回「⏳ 系统繁忙，请稍后再试。」+ 日志 `peer-lock REJECT waited=…` | 两条并行处理（无 wait 日志）= 锁没接上；缩 5000 仍不拒 = rejectAfterMs 没生效 |
| 4 | **buy_inflow 首笔** | 一笔真实 BUY 入金 | `SELECT * FROM broker_workflow_markers WHERE event_type='broker_buy_inflow'` 有行，`payload.from` == bscscan 入金 tx 的 from；同 tx 再触发不重复（`INSERT OR IGNORE`）| 无行 = sender 没先记；`from` = broker 自己地址 = 记错方向 |
| 5 | **hedge：`hedge_gate_error` 可见 / 仍零 CEX** | 一笔 **hedge-enabled** offer 完成（`metadata.hedge_enabled:true` 的才走到门：broker-intake `:357/:442`、broker-v3 `router.js:178` 写方；retail-proxy/bounty 等默认 off **不触发**——拿 non-hedgeable 单等 = 误判 FAIL）| `chain_events` + `events` 各一条 `hedge_gate_error`，payload `{offer_id, error:"no such column: meta"}`（`_recordHedgeGateError` 真带 `error: e.message`，NWT 核✓）；`SELECT count(*) FROM chain_events WHERE event_type LIKE 'hedge%'` 仍 = 0；Gate.io 无新单。真开对冲 = Owner 独立批，不在本单 | 门**静默**（无 `hedge_gate_error`）= 窄 catch 没接上；`hedge%` > 0 = 对冲真跑了（未 Owner 批开，不该）|
| 6 | P2 intent 先行 | 首个 T2.5c 触发 | `chain_events`：`broker_fallback_intent.observed_at` **<** `broker_fallback_claim.observed_at` | claim 先于/无 intent = write-ahead 没生效 |
| 7 | P11 借记先行 | 一笔真实提币 | `user_ledger` 先 `withdraw_pending:` 行再变 `withdraw_user_initiated:…`；转账期间余额已减 | 余额转账后才减 = 借记在转账之后（P11 复发）|
| 8 | hold-monitor 可见性 · 🔴 **前置 = batch-1 已落**（那两个数在 batch-1 的 `broker-hold-monitor.mjs:19-21,40-41`；batch-1 未落本项**不可验**，不算 FAIL）| 读 hold-monitor 首行 | 含 `manual_refund_pending=` `fallback_ambiguous=`；`unknown_1h` 计入 `broker_fallback_ambiguous`/`withdraw_ambiguous`（fix-up 6）| batch-1 已落而首行缺 = batch-1 fix-up 4/5/6 没进；batch-1 未落 = 跳过并标"盲窗"|
| 9 | **P7-bis reopen 门** | 造/等一笔 `matched` 超时且 `payment_tx` 非空的 offer；再一笔无 `payment_tx` 的对照 | 状态变 `verifying`（非 `open`）、`payment_tx`/`taker` 留、`fund_locks` 仍 `locked`、`events reopen_blocked_settled` **每 offer 一次**（`exchange-machine.js:699-700` 去重）；无 `payment_tx` 的照旧 reopen；对端 `timeout_v1` 同门（`chain_events exchange_timeout` 带 `reopen_blocked:true`）| 变 `open` = 门没接；`payment_tx` 被清 = reopen UPDATE 没被拦 |
| 10 | 🔴 **PENDING 付款意图生命周期（v0.5 承重补项，NWT ①；sub-case ii 核心）** | 一笔本地 auto-pay（`_autoPayExchange` `trade-protocol-filter.js:2813` reserve → `:2839` finalize；`_autoSettleAsset` `:2961`→`:2995` 同型）；每步 `SELECT payment_tx FROM exchange_offers WHERE id=?` 抓 | **(a)** 转账**前** `payment_tx` = `PENDING:<offer8>:<uuid8>`（`_reservePaymentIntent` `:2201`，CAS `WHERE payment_tx IS NULL`）；**(b)** 成功 ⇒ CAS 换成真 txHash（`_finalizePaymentIntent` `:2206`）；**(c)** 失败/抛/结果不明 ⇒ 标记**留着** + `events autopay_ambiguous`（`_alertPaymentIntentStuck` `:2210`；调用点 `:2820/:2827/:2840/:2975`）；**(d)** 该 offer 若超时 reopen ⇒ 项 9 的门视 PENDING = settled → `verifying`；**(e)** 期间外部 `paid_v1` 带 hash 进 `processPaymentSubmit` ⇒ 不覆盖 PENDING，返回 `{ error: 'payment_intent_pending' }`（应用层 `exchange-machine.js:795` + SQL 谓词 `:826` 双层）；**(f)** operator 面 `exchange.eta` 对 PENDING 不建链接（§B2-6，随其分支合并才生效） | `payment_tx` 直接从空变真 hash（无 PENDING 中间态）= reserve 没在转账前落 ⇒ **崩溃窗口双付风险回归**；失败后 PENDING 被清 = fail-open；`paid_v1` 覆盖了 PENDING = 双层谓词失守 |
- 项 3/4/6/7/10 各需真实触发一次（不造假数据、不手插 DB）；抓不到触发就标"未验·等首例"，不勾。

## §B2-5 🔴 用户面变更清单（**2 处**，随批报 Owner）+ operator 面备注 + DEFECT1b
1. `exchange-machine.js` `dm_kas_delivered` DM（NWT 取 **(B)**，batch-2 头已改）：内联 `buildExplorerUrl`；**mainnet 两行原样不变**（`TX: <txid>` + `查看: <url>`）；**TN12 只剩 `TX: <txid>`**（去掉死链 `查看: https://explorer.kaspa.org/txs/<txid>`）。不碰 `formatTxReference`（免 `broker-state-authority.js:43` 连坐）⇒ **用户面 delta 只剩 TN12 一处**。触发原因：`R-EXPLORER-URL-BYPASS` 规则挡 commit（既有硬编码，无 allow 标记）。
2. `conversations.js` 拒回：**逐字复用** `tg-bot/i18n.mjs:428 service_busy`「⏳ 系统繁忙，请稍后再试。」——零新造文案；只在 rejectAfterMs 触发时出现。
- **operator 面备注（不进 Owner 待批清单；NWT/Bettor 8/29 降级）**：`kasia-console/src/ui/exchange.eta` 是 console 运营面板（KANet-UI 用），不是用户 DM。batch-2 起转账失败/结果不明的 offer 会在 `:1353` 显示裸 `PENDING:<offer8>:<uuid8>`，`:533-537` 与 `:1357-1362 getExplorerUrl` 会据它拼出 `…/PENDING:…` 死链（404，不花钱不误状态）。可选修一行：前缀判 `startsWith('PENDING:')` 时显示三元/不建链接；随后续小批，不阻塞本批。
- **DEFECT1b（新，NWT 定级）**：`_executeHedge` 门 `SELECT meta FROM exchange_offers`（`trade-protocol-filter.js:2191-2193`）读不存在的列 ⇒ 抛 ⇒ 三处调用全吞 ⇒ **hedge 从未在 live 跑过**（bak `chain_events hedge%` = 0 条印证）。DEFECT1 修传参**不改变**这一点（安全）。要真开对冲 = 改读 `metadata` + 因写方全置 `hedge_enabled:true` 而等于对所有 broker offer 开 CEX 对冲 ⇒ Owner 级决定，独立批。

## §B2-6 附录 · operator 面 `exchange.eta` PENDING 前缀 guard（设计段·**不动码**·Bettor 8/29 令"下批候选只做设计"）
**事实**：batch-2 起 `payment_tx` 列可能短暂持有意图标记 `'PENDING:<offer8>:<uuid8>'`（写方 `trade-protocol-filter.js:2200 PAYMENT_INTENT_PREFIX = 'PENDING:'`，CAS `WHERE payment_tx IS NULL`；finalize 用真 txid 覆盖；失败/不明 = 标记留驻 fail-closed）。`exchange.eta` 三处读它而不辨：`:1351-1355 getPaymentTx` 原样返回 ⇒ `:533-537` 建 `<a href=explorerTxUrl(...PENDING:…)>` 死链 + Copy 复制标记；`:1357-1362 getExplorerUrl` 同源同病。`:1394` 只读 `verification_meta.payment_tx`（标记不写 meta）⇒ 不改。
**设计（≤10 行，镜像本文件既有 `startsWith('pending_')` 习语 `:510/:515/:524`，零新文案）**：
1. `:1351` 前加一行判据 `isPendingPaymentMarker(v) { return typeof v === 'string' && v.startsWith('PENDING:'); }`（大小写精确 = 与写方常量一致）。
2. `:1353-1354`：`const v = o.payment_tx || meta.payment_tx || null; return this.isPendingPaymentMarker(v) ? null : v;`（一处改 ⇒ `:533` 行自动隐藏、`:1357` 自动回 `'#'`、Copy 无物可复制）。
3. `:533` 行旁加一同形行：`x-show="isPendingPaymentMarker(selectedOffer?.payment_tx)"`，沿用既有标签 `Payment`，`x-text` 直接显示标记裸串（`font-mono`），**无 `<a>` 无 Copy**——operator 看得见"付款在飞/不明"，点不到死链。
**向量（把 `getPaymentTx`/`getExplorerUrl`/判据三函数抠到 `scratch/` node 脚本跑 V1–V7；`:533` 行为浏览器手核一次，截图入 `docs/provenance/`）**：
| # | 输入 | 期望 |
|---|---|---|
| V1 | `payment_tx='PENDING:ab12cd34:9f8e7d6c'` | `getPaymentTx`⇒`null`；`:533` 隐藏；pending 行显示裸串；`getExplorerUrl`⇒`'#'` |
| V2 | `payment_tx='0x' + 64 hex`, `taker_chain='bnb'` | 与改前逐字相同：链接 = `KANet.explorerTxUrl('bnb', tx)`，Copy 复制 tx |
| V3 | `payment_tx=null`, `verification_meta='{"payment_tx":"0x…"}'` | 与改前相同（走 meta） |
| V4 | `payment_tx=null`, meta 含 `PENDING:` 串（写方不会写，防御） | `getPaymentTx`⇒`null`；两行皆隐藏（可接受：标记只经列 CAS 写入） |
| V5 | `payment_tx='pending:x'`（小写）/ `'PENDING'`（无冒号）/ `' PENDING:x'` | **不是**标记 ⇒ 按 txid 处理（与写方精确前缀一致；不做宽松匹配） |
| V6 | finalize 后 `payment_tx` 由标记变真 txid | = V2（pending 行消失、链接出现） |
| V7 | `selectedOffer` 为 `undefined`/`{}` | `getPaymentTx({})`⇒`null`，两行皆隐藏，不抛 |
**范围/闸**：operator 面（NWT/Bettor 8/29 降级：不进 Owner 用户面待批清单，但仍走 报备→GO→侧分支→NWT 审→合）；不改任何服务端；不改 `:1394`；不新增文案；与 batch-2 `8473f1ec` 无 merge 冲突（改动全在 `.eta`）。
**验证法（v0.5 补，NWT ⑤/Bettor ④）**：已落码 = 分支 `coord/j2-eta-pending-guard` 头 `ea916e19`（+12/−2，**不合并**，随 chains-explorer `7f307bf3` 等 Owner 一句）；证据 `docs/provenance/2026-08-29-eta-pending-guard/`（主线 `469a10e9`）：`node docs/provenance/2026-08-29-eta-pending-guard/vectors.mjs <eta 路径>` ⇒ `8 PASS / 0 FAIL`（V1–V7 + V8 钉 `:1394` meta 路不动）；headless Edge 离线 DOM 三例 `dom-assert.txt`（V1 链接行 `display:none` 无 href / pending 行可见裸串 0 按钮；V2 `href=https://bscscan.com/tx/…` + Copy 逐字不变；V7 全隐）；截图 `dom-check-V1-V2-V7.png` sha256[:16] `b868d7d88d85ff9c`。判据：截图证可见性，**链接必须读 dump-DOM 的 `href`**（README §2 记 harness 首版尾逗号致 href 无信息）。

## §B2-7 本段的验证方法（不信本单，信命令；v0.5 补，NWT ⑤）
```
# 1) 分支头与规模（对 fe6ad45e）
git -C scratch/_wt_bmp2 log --format=%h -1                       # 8473f1ec
git -C scratch/_wt_bmp2 diff --stat fe6ad45e HEAD | tail -1      # 23 files changed, 1019 insertions(+), 55 deletions(-)
# 2) 11 个 .test.mjs（5 lib + 6 services）——在分支树里逐个跑，每个末行须 "N PASS / 0 FAIL"
cd scratch/_wt_bmp2/kasia-console && for t in src/lib/{tick-guard,peer-serial-lock,user-ledger-withdraw,with-timeout,broker-buy-inflow}.test.mjs \
  src/services/broker-intake-watcher.fallback-intent.test.mjs src/services/broker-v2/router.withdraw.test.mjs \
  src/services/exchange-machine.hedge-call.test.mjs src/services/exchange-machine.reopen-guard.test.mjs \
  src/services/trade-protocol-filter.hedge-gate.test.mjs src/services/trade-protocol-filter.payment-intent.test.mjs; do printf '%s: ' "$t"; node "$t" 2>&1 | tail -1; done
# 3) 回滚锚（基准见 §B2-3：merge 前 HEAD；batch-1 已落时 broker-intake-watcher.js 另钉 batch-1 后值）
for f in services/broker-intake-watcher.js services/broker-v2/router.js api/conversations.js services/exchange-machine.js services/broker-bsc-intake-watcher.js services/trade-protocol-filter.js; do printf '%s ' "$f"; git show HEAD:kasia-console/src/$f | sha256sum | cut -c1-16; done
# 4) env 默认值 vs 代码常量
grep -n "BROKER_WITHDRAW_TIMEOUT_MS" scratch/_wt_bmp2/kasia-console/src/services/broker-v2/router.js      # :191 … || 120_000
grep -n "BROKER_PEER_LOCK_REJECT_MS" scratch/_wt_bmp2/kasia-console/src/api/conversations.js               # :486 … || 180_000
# 5) 事件名对账（验收表引用的字符串全部真实存在于分支代码）
grep -rhoE "'(autopay_ambiguous|broker_fallback_ambiguous|withdraw_ambiguous|hedge_gate_error|broker_fallback_intent|broker_fallback_claim|broker_buy_inflow|reopen_blocked_settled|payment_intent_pending)'" scratch/_wt_bmp2/kasia-console/src | sort | uniq -c
# 6) 无 migrate（batch-2 对 v199 零硬依赖）
git -C scratch/_wt_bmp2 diff --name-only fe6ad45e HEAD | grep -c "db/migrate.js"                          # 0
```
（2026-08-29 J2 实跑：1) `8473f1ec` / 23 files +1019 −55；5) 九个事件名全部命中；6) = 0。2)/3)/4) 由执行人在 merge 窗重跑。）
