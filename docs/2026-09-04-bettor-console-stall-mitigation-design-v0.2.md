# console 事件循环停顿 · 修法设计 v0.3.1

> **Status**: CURRENT · v0.3.1 · **NWT GREEN（2026-09-04 14:2xZ·ledger 801）** · Phase 0（M10）可派 · **Phase 1（M8/M2/M-scout/M6）待 Owner 批** · Phase 2 待 M10 出数 · 不作施工依据直至各手段实现稿各自 NWT diff 审
> 作者 Bettor（架构师帽）· 2026-09-04 · 输入 = COORD-LEDGER (794)–(799) + J2 六层 L1–L5（`scratch/_j2_console_stall_sixlayer_L1-3/L4/L5_*.md`）+ NWT 三轮审。v0.1 骨架与结构红队增补见 `scratch/_bettor_console_stall_mitigation_design_v0.1_2026-09-04T14-1xZ.md`。
> 铁律：settle/pool/claim = 钱路、pair-ingestor = broker 用户面 ⇒ **Owner 批**；observe-only 埋点/运维项 = NWT GREEN + Bettor 批；**IBD 期不为本稿主动重启任何进程**，一律随下次自然重启或维护窗生效（D-005 精神）。

## 0. 目标 / 非目标
- 目标：console 主线程单次同步停顿 p99 < 1s；:3200 在 IBD 期不再拒连；**不改任何结算语义与链上行为**。
- 非目标：settle 正确性/时序；kaspad IBD；协议。

## 1. 事实级输入（三方一致）
| # | 事实 | 出处 |
|---|---|---|
| F1 | 停顿 = console 主线程同步段；三次与 `settleDaemonTick` 结束秒对齐（lag = tick − 0.45~0.78s）；tick 内 CPU 仅占墙钟 5–10%（"阻塞在 I/O 等待"是推断 → H1） | (796)(797) |
| F2 | 慢性：08-18~21 日志 4022 tick 中 661 次 >10s、max 181s（IBD 前已有） | (796) |
| F3 | IBD 期 settle/pool tick 零收益（每 tick 扫 → 11 盘全被 pre-gate 挡 → ripe=0）；两 tick 零 IBD 感知 | L4/L5 ⑦ |
| F4 | `selectRipeMarkets` 副本 1.2ms 已走 `idx_pool_markets_status`；建 (protocol_version, deadline_daa) 反慢 13ms | L5 ④ |
| F5 | 盘上真实压力 = console 自己 3.6k–7k reads/s 小随机读（0.1–0.3ms/次，D: idle 4–8%）；写只 0.2MB/s；kaspad 160MB/s 为缓存读 | L5 ①② |
| F6 | `pair-ingestor.mjs:55-62` 30s cron `WHERE id > ? AND content LIKE … ORDER BY id`，`id` = randomUUID 文本（`chat.js:260/357/380/409` 各 INSERT 前；schema `migrate.js:497` `id TEXT PRIMARY KEY`、非 WITHOUT ROWID；`ingest.js:188` 是 pending_actions 的 UUID·勘误）⇒ 游标语义错：高位后字典序更小的新消息永不扫到（**正确性 bug**）（"每 30s 扫到表尾" 以活库游标位置为条件 → H2） | L5 ② (799) |
| F7 | `claim-auto :42-57` chain_events LIKE EXISTS 副本 2,051ms（5 min 级） | L5 ② |
| F8 | 读峰 ≠ catch-up（四 handler 副本 1/36/0/1ms 全走索引·事实）；**但 32 路同秒串行同步 handler ≈ 32×(1+36)ms ≈ 1.2s + 32 个 blocklist GET = 每分钟 :24 一次 ≥1s 主线程阻塞（算术）⇒ 与 §0 p99<1s 直接相撞 ⇒ M6 必做** | L5 ③ NWT |
| F9 | better-sqlite3 默认 `synchronous=NORMAL`（WAL 下 commit 不 fsync）；-wal 112MB = 高水位复用 | L5 ⑤ NWT 认 |
| F10 | settle tick 内 `buildPkMap`/`getCurrentDaaScore` 走 relayPost 打自己 :3200（×10 oracle）= 放大器（首 tick 164s） | L4 ① |
| F11 | `kaspa-scout` 被 scanner watchdog 因 scout_checkpoint 陈旧每 5–8 min 强杀重起（IBD 期结构性误判） | L5 ⑥ |
| F12 | ZK×4 / pair-ingestor / settle SELECT / pool 主选盘 **无 tick-duration 埋点** ⇒ 分账不闭合 | L5 ② NWT |

## 2. 仍是假设（v0.2 不据此施工，由 M10 判别）
- H1 "settle tick 10–47s = 阻塞在 I/O 等待：活库冷缓存同步读 26MB metadata + 后台 5k IOPS 争用·递减 = 热身"（数字自洽、未证；零 CPU 的替代解释含 H4）。判别：M10 打出 `selectRipeMarkets().all()` 毫秒数（10s 落在它里 = 坐实）+ D: 物理读/逻辑读比值随时间下降（判"递减=热身"）。
- H2 "30s 读脉冲 = pair-ingestor"（前提：活库游标停在低位/无命中）。判别：M10 打 since_id。
- H3 每 30s **244/186MB 交替出站脉冲**（不落盘 ⇒ 套接字/管道；8MB/s + 同秒 2.4s CPU + 0.4–0.5GB 读；与 :26–:35 非 settle 尖峰同相）归属未定。判别：fastify onSend observe 钩子记 >1MB 响应 / `IO Other Bytes`；onSend 只盖 HTTP 响应，管道侧 `relay-manager.js:255/322` 为命令形小包可排除，**scout 子进程 stdio 未盖 ⇒ 若 onSend 无 >1MB 响应，剩 scout/relay stdio**。
- H4 Defender 实时扫描（RealTimeProtection=True；排除项待 Owner 提权读）。

## 3. 手段
| 编号 | 手段 | 改动面 | 审批档 | 生效 |
|---|---|---|---|---|
| **M10** | observe-only `[diag:step]` 埋点：ZK×4、pair-ingestor（+since_id）、settle `selectRipeMarkets().all()`、pool-settler 主选盘 SQL；fastify onSend >1MB 响应记录（**仓内首个全局响应路钩子**：try/catch 全包、只读 payload 长度、流式 payload 跳过） | 日志行 + 一个全局钩子；零**预期**行为变化 | NWT GREEN → Bettor | 下次自然重启（**先于 Phase 1 至少一个 ≥1h 出数窗**） |
| **M8** | pair-ingestor 游标改 `WHERE rowid > ? ORDER BY rowid`（表非 WITHOUT ROWID；无 schema 变更）；`_lastIngestId` 是否持久化由实现稿定（默认不持久化：重启首扫全表，INSERT OR IGNORE 幂等=只是成本） | 一处 SQL + 游标变量 | **Owner**（broker/用户面：修正确性 bug） | 下次自然重启 |
| **M9** | claim-auto chain_events LIKE EXISTS 改索引可命中形（实现稿在副本 cp 件上 EXPLAIN + 计时） | 一处 SQL（±索引） | **Owner**（refund claim 钱路） | 维护窗 |
| **M2** | IBD 期 tick 短路：settle-daemon / pool-settler 顶部每 tick 调 **`isNodeSyncedCached`（`preprune-capture-worker.mjs:138`·三态 `{synced,isSynced,reason}`·TTL 30s = "新鲜"定义·NWT 收回"不复用"）**，**分支只看 `gate.isSynced === false` ⇒ 跳**（不用 `synced !== true`，那会把 rpc-fail 折进去）；超时/失败/unknown ⇒ 照常扫（**门 = 从既有行为切出"已确认 IBD"的例外；确认不到 ⇒ 回到既有行为**）；打一行 `skip: node not synced`；位置在 tick 顶部 ⇒ **同时跳过 :959 `zkCloseTick`**（IBD 期同样正确）；成本 2 RPC/min | 两 tick 各一处前置 | **Owner**（钱路模块） | **M10 出数窗之后的**下次自然重启 |
| **M-scout** | scanner watchdog（`scanner.js:270-292`）读 checkpoint 前调同一 `isNodeSyncedCached`（TTL 30s < 45s 巡检）：**同一条规则的第二次应用——只在 `gate.isSynced === false` 才抑制判死；unknown/超时/rpc-fail ⇒ 既有行为（照判）**（否则 console 共享 RpcClient 中毒而节点正常时 scout 真假活、watchdog 永久失效 = 门打开它要治的缺口）。事实更正（NWT 实读 `last_block_time=2026-09-01T23:32Z`·`updated_at` 2s 前）：**scout 每代都跑通 history-fetch 并进入 rpc-scanner 索引 IBD 块，然后被当假活杀掉** = "每 2m15s 杀一次正在干活的 scout"，非"从未进入实时订阅"；60s 节流一行 `[scanner:watchdog] skip: node not synced` | watchdog 判据一处 | NWT GREEN → Bettor（运维·KANet-UI 出稿·观测页 `docs/2026-09-04-kanetui-scanner-watchdog-ibd-observation-and-synced-gate-candidate.md`） | 下次自然重启 |
| **M6** | relay catch-up 确定性错相（序号 × 60/32 s 固定偏移；最坏延迟不变）——**必做**（F8 算术：不做则每分钟固定 ≥1s 阻塞，p99<1s 不可达） | relay 一常量→函数 | NWT → Bettor | Phase 1/2 随 relay 重启 |
| **M0** | settle tick 自环（relayPost 打自己 :3200）改进程内调用 —— **记债**，本轮不做 | — | — | — |
| **M5** | Defender 路径排除（data/、logs/、kaspad 数据目录；**不排除 node.exe 进程**）—— 待 H4 | 运维·提权 | Owner 一句 / J1 角色 B | 即时 |
| 作废 | M1 索引（F4）· M3 (e)(f) fsync/checkpoint（F9）· M4 减 commit（F5 写不落盘）· M7 主线程外移（记长期债） | | | |

## 4. 顺序
1. **Phase 0（本周·无审批争议）**：M10 埋点 + 备份实验规矩（先 cp）+ KANet-UI 日志归档（已推 e666060f）。随下次自然重启生效；供 H1/H2/H3 判别。
2. **Phase 1（Owner 一次批·但部署必须在 M10 至少一个 ≥1h 出数窗之后**，哪怕多等一次重启——否则 M2 在 IBD 期跳过 SELECT ⇒ M10 永远量不到它 ⇒ H1 不可判）：M8（正确性 bug）、M2（IBD 绷带·含负向量）、M-scout、M6。
3. **Phase 2（M10 出数后·维护窗）**：M9；H3 归属处置；M6 可选；M5 视 H4。
4. 债：M0、M7。

## 5. 验收（每条各自·两段不重叠窗：IBD 期一窗 + READY 后一窗）
- 指标：`settleDaemonTick ms` p50/p99、`eventloop-lag ≥5s` 次/小时、:3200 拒连次/小时、D: reads/s。
- M8 负向量：构造 UUID 字典序小于游标的新消息 ⇒ 必被扫到（现码必丢）；重启后首扫结果与前一致。**假设声明**：`broadcast_messages` 仓内无任何 DELETE（NWT grep = 0）⇒ rowid 单调成立；将来加 DELETE 须改 `created_at+id` 游标。
- M2 负向量：RPC 超时/rpc-fail（`isSynced` 非 false）⇒ 照常扫；unknown ⇒ 照常扫；synced=true ⇒ 照常扫；TTL 语义：30s 内命中即新鲜、超 TTL 由 reader 自身重读；**非空洞**：fresh false ⇒ 跳 **且** `sqlite.prepare` 未被调用（突变：反转跳过条件必红）。
- M-scout 负向量：注入 not-synced ⇒ stop/start 未调用；突变去门必红；RPC 失败 ⇒ 照判（现行为）。
- M10：零预期行为变化（diff 只增日志行 + 一个受保护钩子）；负向量：钩子内 throw ⇒ 响应不变；每条 step 行可 grep。
- 掉电/幂等审：本稿 **不动持久性**（M3 作废）⇒ 原 "(b) 类 *_txid 写者幂等清单" 与本稿无因果、不阻塞（NWT 同意）；**但它是既有隐患（NORMAL 掉电本就丢尾事务）⇒ 单独立项归 J2**（列表 → NWT 审幂等 → Owner 拍），不随本稿消失。

## 6. 未闭合（进 ledger 待办）
H3 出站脉冲归属；H4 Defender；F11 scout watchdog 观测页（KANet-UI）；07-23 备份降级为"逻辑等价"（(799)）。
