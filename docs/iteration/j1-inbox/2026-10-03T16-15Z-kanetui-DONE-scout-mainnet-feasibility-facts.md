# KANet-UI 交件：kaspa-scout 上主网的只读事实调查（账本 (1822) 选项 B）

只读：没起进程、没改 env/代码、没花钱、没读密钥值（config_entries 里 `ingest_secret` 只核了「键存在」）。只列事实与 file:line，不写方案。
口径：代码事实来自子代理读码，关键几点我自己复核了（标「已核」）；其余标「未核」。D-021：不含密钥/余额/地址。

## 一、主网现状（已核）
- 主网 console 进程的子进程里没有 scout（只有 relay.mjs ×24 与 `_launch_tg_bot.mjs`）。`[scanner:watchdog] started` 日志（`services/scanner.js:298`）只是看门狗启动行。
- `config_entries` 里**没有** `scanner_enabled` 这一键（已核：查询返回空）；`scout_checkpoint` 表 **0 行**（已核）。⇒ scout 从未在这份主网库上跑过。
- `index.js:899` `autoStartIfEnabled()` → `scanner.js:257-264`：看门狗无条件启动，但只有 `getConfig('scanner_enabled')` 非 `'false'` 且非空时才调 `startScanner()`；没有 `SCANNER_OFF`/`SCOUT_*` 之类 env 开关（grep `kasia-console/src` 无命中）。`scanner_enabled` 为空时看门狗在 `:279` 直接 return。
- 日志里 `[diag:step] pair.scanAndIngestPairs ... hits=0` 是 console 自己的定时任务，不是 scout。

## 二、① TN12 时代怎么起
1. 唯一启动链 = console 内 `scanner.js`。`startScanner()`（`:76-103`）：`isLocalNode()` 为真 → `SCAN_MODE=rpc`，否则 `light`（`:80-81`）；`relay_nodes` 须有 address 长度 ≥60 的行，否则返回 `no_relay_node`（`:88-91`）（主网 24 个 relay，此条应满足，未逐一核）；`KASPA_RPC_LOCAL_ONLY=1` 时 RPC 恒取 env `KASPA_RPC_URL`（`rpc-health.js:54-62`）。
2. 子进程：`spawn('node', ['src/index.mjs'], {cwd: SCOUT_DIR, ...})`（`scanner.js:126-130`），`SCOUT_DIR = process.env.SCOUT_DIR || ${KANET_ROOT}/kaspa-scout`（`:21`），`KANET_ROOT` 默认 `D:/Anthropic`（`:20`）——主网 console 的 `KANET_ROOT` 是否设对**未核**（start 脚本里的值我没读）。传给子进程的 env（`:113-123`）：`SCAN_MODE`、`KASPA_RPC_URL`、`KASPA_NETWORK`（默认 mainnet，`:117`，TN12 靠 5/25 hotfix 改成 testnet-12）、`CONSOLE_URL`（`http://localhost:${PORT}`）、`INGEST_SECRET`、`SCOUT_SEED_ADDRESS`、`SCOUT_WATCH_ADDRESSES`、`SCOUT_WATCH_SIGNALS`。
3. 成功后写 `scanner_enabled=true`（`:164`）与 `logs/pids/scout.pid`（`:176-181`）；子进程退出自动重拉（5s 起步，上限 60s，`:53-69`）；看门狗每 45s 查 `scout_checkpoint` 的 `_global_` 行，120s 不动强制重启（`:45-46,274-298`）。
4. 启动脚本：`kanet-start.sh:12` 只 export `KANET_ROOT`；`scripts/start-console-mainnet.ps1` 头注（3-6 行）明说只起 console 单进程，不含 relay/scanner 等；`scripts/kanet-boot-sequence.ps1` grep 不到 scout/scanner；`kanet-stop.sh:82` 的残留清理按命令行匹配 `scout` 杀进程。
5. 账本：`(165)`（`COORD-LEDGER.md:399-402`）：2026-08-12 console 失去 spawn 能力（退出码 0xC0000142），靠「体外复刻 scanner env 手动拉起 scout」救活（日志 `logs/scout-manual-bettor-20260812.log`，pid 文件 `logs/pids/scout-manual-bettor.pid`）——scout 可脱离 console 独立起，有先例。`(1822)` 之后账本无 scout 新条目。
6. scout 需要的 env 名：必需 `INGEST_SECRET`（缺则 `exit(1)`，`kaspa-scout/src/index.mjs:22-28`）；常用 `SCAN_MODE`（rpc/light/backfill/默认 indexer）、`KASPA_RPC_URL`、`KASPA_NETWORK`、`CONSOLE_URL`（默认 `http://localhost:3100`，主网需 3202）；可选 `SCAN_INTERVAL_MS`、`KASPA_RPC_LOCAL_ONLY`、`LARGE_TX_THRESHOLD_SOMPI`、`BACKFILL_START`、`BACKFILL_END`。scout 无自己的 DB/检查点路径，检查点走 console HTTP（`/api/discovery/checkpoint`，`discovery.js:565-589`）。`kaspa-scout/data` 是空目录。
7. ingest 鉴权：`reporter.mjs:127-135` 带请求头 `x-ingest-secret`；`/api/chat/ingest`（`chat.js:405`）preHandler = `verifyIngestRequest`（`services/ingest-auth.js:19-41`）：取 DB 配置 `ingest_secret`，`timingSafeEqual` 比对；缺头 401，库里没配 500。该密钥由 `index.js:150-165` 启动时生成/读取并写入 `process.env.INGEST_SECRET`；主网库里 `ingest_secret` 键存在（已核）。

## 三、② 是否支持主网
1. 代码默认就是主网：`rpc-scanner.mjs:26`、`chain-fundamentals.mjs:28`、`balance-tracker.mjs:29`、`whale-alert.mjs:24`、`light-scanner.mjs:26`、`history-fetcher.mjs:18`、`backfill.mjs` 均 `process.env.KASPA_NETWORK || 'mainnet'`。
2. `kaspa-scout/src` 内**无** `testnet-12`/`tn12`/`17210` 硬编码（grep 仅命中 `api.kaspa.org`）；`whale-alert.mjs:51,229` 兜底 `ws://127.0.0.1:17110` 恰是主网口。
3. 节点选择（`rpc-scanner.mjs:296-305`）：优先 `resolveRpcUrl()`（env `KASPA_RPC_URL` 直连，`shared/lib/rpc-utils.mjs:26-39`），其次 console `/api/config/rpc-url`，最后 Resolver；`KASPA_RPC_LOCAL_ONLY=1` 时只信 env。
4. 地址前缀：主路径用 getBlock 的 `verboseData.scriptPublicKeyAddress`（`rpc-scanner.mjs:115-116`）；兜底 `new Address(spk, KASPA_NETWORK)`（`:20-22`）传网络名而非前缀，**未实测**。
5. 与「本地严格」策略的冲突点（scout 进程内，不经 console rpc-health）：`history-fetcher.mjs:17` 写死 `https://api.kaspa.org`；`balance-tracker.mjs:208-223` 用 api.kaspa.org 查地址标签；`whale-alert.mjs`、`chain-fundamentals.mjs`、`balance-tracker.mjs` 各开自己的 RPC 连接。

## 四、③ 扫链方式与起点
1. `rpc` 模式只扫**实时新块**：`rpc-scanner.mjs:314` `subscribeBlockAdded`，`handleBlock`（`:388`）。检查点只写不读来决定起点（`message-indexer.mjs:127-135` 只前进）。⇒ 新起的 scout 从当时 tip 开始。
2. `scout_checkpoint` 表（`migrate.js:1560-1575`）：`id,address,last_block_time,last_blue_score,updated_at`；没有 start DAA/hash env。
3. `history-fetcher`：启动时跑一次（`index.mjs:75-80`），按 `api.kaspa.org` 取**种子地址**（`/api/discovery/local-addresses` 返回的）历史交易，无检查点直接跳过（`history-fetcher.mjs:43-46`），最多 100 页×50（`:20-22`）。是否覆盖这些广播（发送方是否在种子地址里）**未核**。
4. `backfill` 模式（`SCAN_MODE=backfill` + `BACKFILL_START/END` ISO 时间，`index.mjs:41-61`）：一次性进程；从剪枝点 `pruningPointHash` 起 `getBlocks({lowHash, includeBlocks:true, includeTransactions:true})` 逐批拉（`backfill.mjs:80-100`），范围之前的块在客户端按时间戳跳过（`:120-127`），无二分定位——回溯 2 小时前也要把剪枝点到该时刻的全部块拉一遍。复用同一 Reporter。
5. 结论（事实推导）：`rpc` 模式起来后不会捡到已上链的 `b9004b74…`、`ea370700…`、`a253e177…`（早于起点）；只有 backfill 能补，成本见上。ingest 按 `tx_hash` 去重（`chat.js:412-420`），backfill 与 rpc 并存不冲突。
6. 识别广播：十六进制前缀 `ciph_msg:1:bcast:`（`lib/protocol.mjs:12,25,45`），无地址/频道过滤；`parseBcastPayload`（`rpc-scanner.mjs:228-247`）以第一个冒号切 `channel:message`，发送方取 `outputAddresses[0]`（`:519`）；上报 `{channelName, senderAddress, content, txHash}`（`:523-528`），不带区块/DAA。
7. 分块重组不在 scout：scout 逐条原样上报；`/api/chat/ingest` 写 `broadcast_messages` 后调 `onBroadcastWritten`（`chat.js:412-424`）；重组在 `trade-protocol-filter.js`（内容前缀须为 `{"t":"kanet_` / `{"t":"pool_` / `{"t":"oracle_`，`:66-70`），`pool_market_chunk_v1` 走 `handlePoolMarketChunk`，**内存缓存**重组（30 分钟过期、上限 200 条，`:969-975`）；重组后 sha256 校验、`JSON.parse`，按 `inner.t` 分发，`oracle_stake_enroll_v1` → `handleOracleStakeEnroll`（`:130-131,371,1080-1095`）写 `chain_events` 与 `oracle_stake_enrollments`（`source='chain_envelope'`，`:437-454`）。分块只存内存：分段分时到达或 console 重启，缺的块不会自动补。
8. 孤立的 `a253e177…`（第1段）即使入库也凑不齐一整条 envelope，不会被消费。`b9004b74`+`ea370700` 是否构成同一条 envelope 的两块，取决于发送端分块格式（`oracle-pool.js:49-68` `sendBroadcastChunked`），我没逐字节核，**未核**。

## 五、④ 主网负载
1. 每个新块都走一遍：`block-added` 事件自带完整交易（`rpc-scanner.mjs:397`），第一遍比对 hex 前缀（`:401-417`），第二遍对每笔每个输出做大额转账判断（`:421-451`），命中大额则 POST `/api/chain/whale-alert`（与是否有 Kasia 命中无关）。无命中的块：0 次额外 RPC；有命中的块：再 1 次 `getBlock(includeTransactions:true)`（`:256-262`）。同一交易在多个 DAG 块出现，靠 `_attempted` 去重。
2. 内存结构：`_attempted` Set 上限 50000，超出清一半（`:57-58,97-105`）；`message-indexer.mjs` 缓冲每 10s 或满 20 条落盘（`:23-27`）；`_knownAddresses` 每 5 分钟刷新；未发现随块数无界增长的结构。
3. console 侧：每条命中的广播 = 一次串行 HTTP `/api/chat/ingest`，超时 10s，重试 3 次（`reporter.mjs:6-7,145-163`）；前缀不符的广播在 `trade-protocol-filter.js:66-70` 提前返回；**非本节点地址的非协议类广播会触发各 relay 自动回复**（`chat.js:438-461`，responder 间隔 10s）——主网若有大量外部 `ciph_msg:1:bcast:`，这条路径要留意。
4. 其他常驻任务：`chain-fundamentals`、`balance-tracker`、`whale-alert` 各自一条 RPC 连接，间隔常量**未核**。
5. 规模：主网约 10 块/秒（估计），事件频率约 10 次/秒，每次遍历块内交易；瓶颈更可能出在带 `ciph_msg:` 前缀的命中数（每次命中一个 getBlock + 串行 HTTP）；主网实际每秒命中数需实测，**未核**。没有按频道/前缀预过滤到只拉 `kanet-prediction` 的机制（前缀只是 `ciph_msg:1:bcast:`）。

## 六、⑤ 起停方式
1. 独立进程：`node src/index.mjs`，cwd `D:\kanet-tn12\kaspa-scout`（`package.json` 有 `start`、`start:rpc`）。手动至少设：`SCAN_MODE=rpc`、`KASPA_RPC_URL=ws://127.0.0.1:17110`、`KASPA_NETWORK=mainnet`、`CONSOLE_URL=http://localhost:3202`、`INGEST_SECRET`（= 主网 console 的 `ingest_secret`）。`rpc` 模式启动时调 `fetchSeedAddresses`（`index.mjs:69`），失败只警告。手动起绕开 `scanner_enabled`，看门狗不管它，退出后不自动恢复；有 8/12 先例（见二-5）。
2. 经 console 的 HTTP 接口：`POST /api/discovery/scanner/start|stop`、`GET /api/discovery/scanner/status`（`discovery.js:203-218`）。代码注释写「无需鉴权，仅本地」，preHandler（`:194-196`）只对 `/api/discovery` 下非 `scanner`/`list`/`activity` 的非 GET 要求 `x-ingest-secret`。`start` 会把 `scanner_enabled` 置 true（console 以后重启也会自动拉起），受 `startScanner` 前置条件约束（二-1）。两种方式都**不需要重启 console**。
3. 以上都是代码层事实，**没有实际调用过**；`/api/discovery/scanner/start` 在主网是否真能拉起（`KANET_ROOT`、relay address 条件、`SCOUT_DIR` 路径）未核。

## 七、没核的清单
`KANET_ROOT` 在主网 env 的值；主网每秒 `ciph_msg:` 命中数；`Address(spk,'mainnet')` 兜底路径实测；history-fetcher 是否覆盖这几笔；`b9004b74`/`ea370700` 与分块格式的对应；`chain-fundamentals`/`balance-tracker`/`whale-alert` 的间隔与负载；`lib/state.mjs` 落盘位置。
