# broker-money-path 批 · 部署单草案 v0.1（同维护窗 runbook 风格 · 独立于节点/supervisor 维护窗）

> **Status**: DRAFT v0.1 · J2 2026-08-29 · Bettor 令 · 对象 = 侧分支 `coord/broker-money-path`（阶段 1 `0f62e539` NWT GREEN、阶段 2 `8e186cba` 审中、阶段 3 待落）· **不 merge 进 `bshard-m3-deploy` 直到 Owner 批**（主分支检出 = live 树，merge 即部署）· 执行人由 Bettor 指派（提权），J2 只读验收。

## §0 前提（全满足才开）
| # | 前提 | 判据 |
|---|---|---|
| P1 | 侧分支各阶段 NWT GREEN（真码）+ Bettor 汇总 | `origin/coord/broker-money-path` 头 = 审过的 sha |
| P2 | **Owner 批 broker-money-path 批**（钱路） | Bettor 单点上报回执 |
| P3 | **Owner 定 A/B**（`held_for_review` 可逆态 vs `failed+no_escrow`）| 定 B ⇒ v200 重建进本批或下批；定 A ⇒ `BROKER_RECONCILE_MODE=failed` 写进 kanet.env，且 `RECONCILE_MODE_ACTIVE` 常量旁注钉死。**未定 ⇒ 默认 B 且枚举缺 ⇒ 退化 alert_once（不 transition）**——可部署，但 reconcile 对 NOT_PAID 单只告警不动 |
| P4 | v199 一次性索引 `idx_spc_daa_ts` 建在 **263 MB `spc_daa_index`** 上 ⇒ boot 时 `runMigrations()` 会多花秒级（同步，主线程）⇒ **必须在 supervisor boot-grace（300 s）内完成**；离线在 07-23 bak 副本上先计时（`CREATE INDEX` 秒数）填这里：`___ s` | 计时 < 60 s ⇒ 安全；> 120 s ⇒ 改为窗内手工先建索引（`CREATE INDEX IF NOT EXISTS` 幂等，migrate 再跑为 no-op） |
| P5 | `kanet.env` 已有 `BROKER_RELAY_ID`（`relay_nodes` 取 broker 地址）或新增 `BROKER_KAS_ADDR=<TN12 地址>`；前缀与 `KASPA_NETWORK` 一致 | 否则 escrow 全 UNKNOWN（安全但无用）|
| P6 | 与节点/supervisor 维护窗**正交**：不与 57fde30f/supervisor v0.1.4/红线 7 同批；可同一天不同窗 | Bettor 排期 |
| **P7 运营前置 (a)**（NWT 2026-08-29，retail 开放前）| UI/tg-bot 把 `skipReason`（`refund_unknown_hold` / `refund_*_no_resend` / `refund_ambiguous_broadcast` / `held_for_review`）译成用户可读的"退款处理中 / 待复核"——**用户面文案 = Owner 批** | 文案稿 + Owner 一句 |
| **P8 运营前置 (b)** | held 队列的人工 SOP：谁看（Bettor 指派）、多久内解（建议 24 h）、解法（relay `check_utxo_landed` 核 intent txid → 回填 / 人工放回 `awaiting_payment` / 人工 `no_escrow` 二次确认）| SOP 一页 |
| **P9 运营前置 (c)** | UNKNOWN 须 rare：hold-monitor 第五个数 = 每小时 `events(refund_unknown_hold + broker_escrow_unknown)` 计数，超阈告警；RPC 健康（`rpc-health`）+ coverage-lag 一并看 | 阶段 3 fix-up 2 落 |

## §1 步骤
| # | 步骤 | 执行人 | 只读验证 | 通过判据 |
|---|---|---|---|---|
| ① | 通知 + announce-freeze（broker 相关：窗内不发 retail/exchange 单、不取消、不退款） | Bettor | 频道 + SendMessage | 回执 |
| ② | 在飞检查（同维护窗 runbook §检查②的 broker 子集：`_scanExpiredBrokerOffers`/`reconcileStaleOrders`/`broker-action-queue` 无在飞 sendKas；`retail_dex_orders` 无 `refunding`） | KANet-UI 只读 | SQL 只读 | 全空 |
| ③ | **merge**：`git merge --no-ff coord/broker-money-path` 进 `bshard-m3-deploy`（先 `git status` 干净、`sha256sum kasia-console/src/db/migrate.js` 记旧值作回滚锚） | Bettor/提权 | `git log -1`、`git diff --stat HEAD~1` = 侧分支文件集 | 无冲突 |
| ④ | **console 单体重启**（沿维护窗 runbook §检查③：`taskkill //F //T` → 0 relay 存活 → `_launch_console_single.ps1`） | J1/提权 | 同 runbook | 新 PID、`[db] path=…` |
| ⑤ | **迁移验收**：`PRAGMA user_version`（若 migrate 写 user_version；否则 `SELECT name FROM sqlite_master WHERE name IN ('kaspa_tx_log_coverage','broker_refund_intents','idx_spc_daa_ts')` = 3 行）；boot 日志 `[migrate] v199: … 建表/建索引完成` | KANet-UI 只读 | better-sqlite3 readonly | 3 行 + 日志行 |
| ⑥ | **服务验收**（首小时）：`[broker-hold-monitor]` 首行（四个数：held / stuck-refunding / intent-stale / coverage-lag）；`reconcileStaleOrders` 日志行含 `mode=held_for_review`（或 A）；无 `refund_send_failed` 新增；`events` 里 `broker_escrow_unknown`/`refund_unknown_hold` 若出现 = 配置/索引问题的**告警**而非故障（读 reason） | KANet-UI 只读 | 日志 + events | 首行出现 + 无 crash |
| ⑦ | coverage-lag：`SELECT max(end_daa) FROM kaspa_tx_log_coverage` 与 `spc_tip_heartbeat.daa_score` 差 < 3,600（阶段 3 relay 推进落地后才有行；未落地前本项 N/A 并写明） | KANet-UI 只读 | SQL | 差 < 阈或 N/A 注明 |

## §2 回滚
| 失败信号 | 回滚 |
|---|---|
| ③ merge 冲突 | `git merge --abort`；不重启 |
| ④ 新 console 起不来 / boot 超 grace | `git revert -m 1 <merge-sha>` → 重启；**v199 表/索引留着无害**（纯新增、无写入方在旧码里）|
| ⑤ 迁移日志缺 / 表缺 | 不推进；报 NWT/DB 属主；别手插 |
| ⑥ 退款/escrow 路异常（如全 UNKNOWN 持续） | 不需回滚代码：那是 fail-closed；查 `events.reason`（RPC 缺/前缀错/coverage 无账）修配置；若要恢复旧行为 ⇒ revert merge |
| v200（若同批） | 重建前 `sha256sum` 钉旧 schema（`SELECT sql FROM sqlite_master WHERE name='retail_dex_orders'`）+ 表副本 `retail_dex_orders_bak_v200`；回滚 = 反向重建（窗内、Owner 批）|

## §3 边界
- 阶段 3 未落前 coverage 账无写入方 ⇒ 所有需要 coverage 的否定断言（NOT_PAID / NOT_REFUNDED）**结构上不可达** ⇒ escrow 只会 UNKNOWN/ESCROWED、退款只会 CONFIRMED/INTENT/INFLIGHT/UNKNOWN ⇒ **新退款一律 hold + 告警**。这是有意的 fail-closed（NWT 原则），但要写进 Owner 单点上报：**阶段 1+2 上线 = 退款自动路暂停，直到阶段 3（coverage 推进）落地**；若 Owner 要求先恢复自动退款，唯一合法解是阶段 3 同批。
- P4 索引计时未做（离线副本）。
