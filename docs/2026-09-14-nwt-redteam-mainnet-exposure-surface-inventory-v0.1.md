> **Status**: CURRENT

# NWT 只读盘点 · 主网console暴露面 v0.1（无鉴权可改状态路由清单）

> Bettor 1288（空档只读任务）：主网console（当前PID 18320）暴露面盘点——监听口、所有会改状态的路由里
> 哪些无`verifyIngestRequest`/admin tier前置（分档：无鉴权可改状态/有鉴权/只读），只列路由名与计数，
> 不碰密钥物、不读进程内存。

## 方法说明（如实交代，不是逐路由手工读完的断言）

对`kasia-console/src/api/*.js`（38个文件）跑了一个静态脚本扫描：定位每个`fastify.<method>(path, ...)`
注册点，取该行到下一个路由注册点之间的窗口文本，检查窗口内是否出现`verifyIngestRequest`/
`checkAdminSecretTier`/`checkKeyExportWindow`三个具名鉴权函数（覆盖既有preHandler-option写法和in-body
第一行调用写法两种既有代码风格，两种在仓库里都真实存在）。**这是脚本静态扫描，不是把603条路由逐条
读过一遍人工判断**——数字准确（脚本可复跑复核），但"无鉴权"这个标签只代表"没找到这三个具名函数"，
不代表"证明了没有任何其它形式的保护"（见下文"次级信号"与"已知局限"两节）。

## 监听口

独立读`src/index.js:524`：`fastify.listen({ port: PORT, host: process.env.HOST || '127.0.0.1' })`——
**默认只监听127.0.0.1**，`HOST`留空即loopback-only；本session此前多次部署后核（D-019/T-KEY-EXPORT/
偏移线重启，PID 14884→18320）均独立确认这台机器当前监听确实只有`127.0.0.1:3202`，`HOST`未被设置过。
**这是理解下面数字的关键威胁模型前提**：这些路由目前的实际可达范围是"能连到这台机器loopback的任何
本机进程"，不是公网直接可达——下面的分档回答的是"HTTP层面这条路由本身有没有做身份/权限校验"，不等于
"这条路由今天真的对公网开放"。

## 总数

| 类别 | 数量 |
|---|---|
| 总路由数 | 603 |
| 非GET（候选状态变更路由） | 287 |
| 　├ 未命中三个具名鉴权函数 | **264** |
| 　└ 命中三个具名鉴权函数之一 | 23 |
| GET（按HTTP语义声明只读） | 316 |
| 　└ 静态启发式命中"写信号"关键词、需人工复核 | 5（人工复核后：4个是脚本窗口误判的假阳性，1个是真实发现，见下） |

**264个"未命中"路由再细分**：251个在扫描窗口内连`ADMIN_IP_ALLOWLIST`/`request.ip`/`apiKey`这类
次级信号字符串都没有；13个窗口内出现了这类次级信号字符串（不是三大鉴权函数，可能是IP allowlist或
apiKey检查，需要人工读代码才能判断是不是真的构成一道闸）。

## 一、无鉴权可改状态路由（264条，按文件分组）

<details><summary>展开完整清单（按文件名分组，方括号内为路由注册行号；括号标注的是次级信号，不是三大鉴权函数命中）</summary>

## adapter.js (7)
- POST /adapters [L130]
- POST /adapters/:id/start [L164]
- POST /adapters/:id/stop [L171]
- POST /adapters/:id/restart [L177]
- POST /adapters/:id [L184]
- POST /adapters/:id/delete [L206]
- POST /adapter/config [L217]
## auth.js (2)
- DELETE /api/auth/connection/:id [L108]
- POST /api/auth/retry-refresh/:id [L121]
## backup.js (1)
- POST /api/backup/import [L31]
## bettor.js (34)
- POST /api/bettor/scan [L67]
- POST /api/bettor/scavenger/scan [L83]
- POST /api/bettor/recommendation/:id/accept [L96]
- POST /api/bettor/resolve-now [L241]
- PUT /api/bettor/position-protect/rules/:id [L438]
- DELETE /api/bettor/position-protect/rules/:id [L454]
- POST /api/bettor/variant-recommendation/:id/accept [L535]
- POST /api/bettor/position-protect/rules/:id/ack [L585]
- POST /api/bettor/adjustments/:id/decide [L741]
- POST /api/bettor/evaluate-now [L777]
- POST /api/bettor/snapshot-now [L786]
- POST /api/bettor/positions/close-all [L797]
- POST /api/bettor/blacklist [L853]
- DELETE /api/bettor/blacklist/:market_id [L872]
- POST /api/bettor/event-calendar [L899]
- DELETE /api/bettor/event-calendar/:id [L926]
- POST /api/bettor/live-news-inject [L941]
- DELETE /api/bettor/live-news-inject/:id [L952]
- POST /api/bettor/fossa-stable/tick [L959]
- POST /api/prediction/maker/whitelist/apply [L969]
- POST /api/prediction/maker/whitelist/approve [L986]
- POST /api/prediction/publish [L1003]
- POST /api/prediction/publish-v2 [L1269]
- POST /api/prediction/pending-offer [L1496]
- POST /api/prediction/taker-handshake/:offer_id [L1535]
- POST /api/prediction/taker-stake/:offer_id [L1569]
- POST /api/prediction/retry-path-a/:offer_id [L1705]
- POST /api/prediction/consensual-confirm/:offer_id [L1777]
- POST /api/prediction/refund/:offer_id [L1848]
- POST /api/prediction/accept/:offer_id [L1960]
- POST /api/oracle/announce [L2149]
- POST /api/oracle/:id/vote [L2320]
- POST /api/oracle/dispute/trigger [L2368]
- POST /api/oracle/mapping [L2491]
## broker.js (7)
- POST /api/broker/accounts [L115] (apiKey)
- POST /api/broker/accounts/:id/test [L156]
- DELETE /api/broker/accounts/:id [L176]
- POST /api/broker/:id/order [L210]
- DELETE /api/broker/:id/order/:orderId [L239]
- POST /api/system/download [L301]
- POST /api/system/run [L309]
## budget.js (2)
- POST /api/budget/:relayId [L35]
- DELETE /api/budget/:relayId [L52]
## chain-data.js (2)
- POST /api/chain/watchlist [L207]
- PUT /api/chain/whale-signal/params [L377]
## chat.js (7)
- POST /api/chat/channels [L192]
- DELETE /api/chat/channels/:name [L207]
- POST /api/chat/send [L214]
- POST /api/chat/local [L336]
- POST /api/dashboard/digest/generate [L517]
- POST /api/faucet/request [L596] (ip)
- POST /api/chat/confirm [L720]
## conversations.js (21)
- POST /api/test/reset_peer [L123]
- POST /api/test/seed_pending_accept [L146]
- POST /api/test/force_state_expire [L171]
- POST /api/test/trigger-refund-sweep [L182]
- POST /api/test/inject-send-kas-mock [L194]
- POST /api/test/reset-send-kas-mock [L233]
- POST /api/test/inject-scan-mock [L247]
- POST /api/test/reset-scan-mock [L265]
- POST /api/test/inject-llm-mock [L275]
- POST /api/test/reset-llm-mock [L284]
- POST /api/agent/reply [L309]
- POST /api/agent/consult [L555]
- POST /api/agent/peer-relation/mark-stranger-cooldown [L701]
- POST /api/agent/mind-event [L725]
- POST /api/agent/skill-invoked [L753]
- POST /api/contacts/update [L1104]
- POST /api/contacts/add [L1129]
- POST /api/contacts/block [L1149]
- POST /api/contacts/tags/delete [L1177]
- POST /api/contacts/tags/rename [L1190]
- POST /conversations/:id/reply [L1335]
## defi.js (16)
- POST /api/defi/aave/supply [L47]
- POST /api/defi/aave/withdraw [L68]
- POST /api/defi/aave/borrow [L89]
- POST /api/defi/aave/repay [L121]
- POST /api/defi/aave/analyze [L147]
- POST /api/defi/hyperliquid/analyze [L304]
- POST /api/defi/hyperliquid/order [L430]
- POST /api/defi/hyperliquid/close [L460]
- DELETE /api/defi/hyperliquid/order/:id [L478]
- POST /api/defi/hyperliquid/withdraw [L530]
- POST /api/defi/hyperliquid/deposit [L567]
- POST /api/defi/aevo/save-credentials [L669] (apiKey)
- DELETE /api/defi/aevo/credentials [L712]
- POST /api/defi/aevo/analyze [L750]
- POST /api/defi/aevo/order [L925]
- DELETE /api/defi/aevo/order/:id [L960]
## dev-channel-v1.js (1)
- POST /api/v1/messages [L280]
## discovery.js (8)
- POST /api/discovery/scanner/start [L203]
- POST /api/discovery/scanner/stop [L209]
- POST /api/discovery/card [L221]
- POST /api/discovery/register [L250]
- POST /api/discovery/interaction [L290]
- POST /api/discovery/message-index [L455]
- POST /api/discovery/message-index/:txid/processed [L541]
- POST /api/discovery/checkpoint [L571]
## escrow.js (3)
- POST /api/escrow/create [L59]
- POST /api/escrow/lock [L108]
- POST /api/escrow/execute [L138]
## exchange.js (11)
- POST /api/exchange/publish [L146]
- POST /api/exchange/accept [L367]
- POST /api/exchange/cancel [L576]
- POST /api/exchange/confirm [L616]
- POST /api/exchange/submit-payment [L670]
- POST /api/exchange/dispute [L691]
- POST /api/exchange/resolve [L757]
- PUT /api/exchange/seeder/config [L973]
- POST /api/exchange/seeder/trigger [L996]
- PUT /api/exchange/autotaker-config [L1139]
- PUT /api/exchange/limits [L1187]
## feedback.js (1)
- POST /api/feedback/reply [L98]
## identities.js (9)
- POST /identities/:id [L125]
- POST /identities/:id/trust [L137]
- POST /identities/:id/block [L146]
- POST /identities [L156]
- POST /identities/tags/delete [L176]
- POST /identities/tags/rename [L189]
- POST /api/identity/:id/annotate [L232]
- POST /api/identity/annotate [L242]
- POST /api/identity/u1-register [L273]
## ingest.js (8)
- POST /ingest/message [L13]
- POST /ingest/reply [L18]
- POST /ingest/tx [L23]
- POST /ingest/event [L28]
- POST /ingest/submit-intent [L37]
- POST /ingest/kaspa-tx [L52]
- POST /ingest/spc-daa-block [L94]
- POST /ingest/spc-tip-heartbeat [L130]
## kanet-broker.js (3)
- POST /api/kanet-broker/onboard [L35]
- POST /api/kanet-broker/bots/reconcile [L419]
- POST /api/kanet-broker/bots/stop [L430]
## monitor-dashboard.js (6)
- PUT /api/monitor/rules [L27]
- POST /api/monitor/rules/:id/toggle [L36]
- POST /api/monitor/rules/:id/delete [L41]
- POST /api/monitor/rules/new [L46]
- POST /api/monitor/events/:id/ack [L85]
- POST /api/monitor/events/:id/clear [L91]
## oauth.js (1)
- POST /api/oauth/openai/refresh/:connectionId [L102]
## oracle-pool.js (3)
- POST /api/oracle-pool/enroll [L200]
- POST /api/oracle-pool/withdraw [L303]
- POST /api/oracle-pool/timeout-unlock [L457]
## peer-coord.js (1)
- POST /api/peer/:pair_id/chat [L129]
## pool.js (18)
- POST /api/pool/market/create [L574]
- POST /api/pool/market/create-v06 [L848]
- POST /api/pool/market/create-v07 [L1069]
- POST /api/pool/market/:id/bettor/register-v07 [L1474]
- POST /api/pool/market/:id/bettor/register-v07/prep [L1690]
- POST /api/pool/market/:id/bettor/register-v07/confirm [L1729]
- POST /api/pool/market/:id/oracle/deposit [L2138]
- POST /api/pool/market/:id/bettor/register [L2200]
- POST /api/pool/market/:id/bettor/register-external/prep [L2402]
- POST /api/pool/market/:id/bettor/register-external/confirm [L2448]
- POST /api/pool/market/:id/bettor/register-v06/prep [L2612]
- POST /api/pool/market/:id/bettor/register-v06/confirm [L2649]
- POST /api/pool/market/:id/settle [L3942]
- POST /api/pool/market/:id/oracle/vote [L3967]
- POST /api/pool/market/:id/bettor-refund-claim [L4082]
- POST /api/pool/prevet-extract [L4113]
- POST /api/pool/prevet [L4127]
- POST /api/broker/recommend [L4322]
## relay.js (26)
- POST /relays/:id/delete [L188]
- POST /relays/:id/assign [L193]
- POST /api/relay/:id/restart [L209]
- POST /api/relay/:id/role [L251]
- POST /api/relay/:id/broker-fee [L353]
- POST /api/relay/:id/split-utxos [L515]
- POST /api/relay/:id/transfer [L535]
- POST /api/relay/:id/wallets [L802]
- POST /api/relay/:id/wallets/import [L837]
- PUT /api/relay/:id/wallets/:walletId [L951]
- DELETE /api/relay/:id/wallets/:walletId [L986]
- POST /api/relay/:id/wallets/:walletId/withdraw [L999]
- POST /api/relay/:id/wallets/:walletId/send [L1059]
- POST /api/relay/:id/wallets/:walletId/swap [L1208]
- POST /api/relay/:id/wallets/:walletId/bridge [L1307]
- POST /relays/generate-mnemonic [L1349]
- PUT /api/relay/:id/mind-config [L1392]
- PUT /api/relay/:id/focus [L1427]
- POST /api/relay/:id/goals [L1468]
- PUT /api/relay/:id/goals/:goalId [L1490]
- DELETE /api/relay/:id/goals/:goalId [L1516]
- POST /api/relay/:id/publish-card [L1567]
- POST /api/agent/create-adapter [L1632]
- POST /api/agent/create [L1643]
- POST /api/relay/:id/send-command [L1827]
- POST /relay/config [L1845]
## settings.js (8)
- POST /settings/node [L13]
- POST /settings/node/test [L39]
- POST /settings/node/discover [L75]
- POST /api/system/repair [L129]
- POST /api/config/tg-bot-broker [L149]
- POST /api/config/tg-bot-token [L175]
- POST /api/tg-bot/start [L191]
- POST /api/tg-bot/stop [L198]
## skills.js (13)
- POST /api/skills/:id/invoke [L120]
- POST /api/skills/execute [L126]
- POST /api/skills/register [L232]
- POST /skills/reset-recommended [L344]
- POST /skills/reset-recommended-form [L353]
- POST /skills/apply-trader-template [L362]
- POST /skills/apply-trader-template-form [L370]
- POST /skills [L378]
- POST /skills/:id [L397]
- POST /skills/:id/delete [L439]
- POST /skills/rename-category [L445]
- POST /skills/delete-category [L453]
- POST /skills/upload [L461]
## stocks.js (16)
- POST /api/stocks/watchlist [L60]
- DELETE /api/stocks/watchlist/:id [L88]
- POST /api/predictions/setup [L222] (apiKey)
- POST /api/predictions/deposit-wallet/setup [L257] (apiKey)
- POST /api/predictions/order [L816]
- POST /api/predictions/positions/:asset/close [L870]
- DELETE /api/predictions/order/:orderId [L920]
- POST /api/polymarket/:relay_node_id/approve [L1011]
- POST /api/polymarket/:relay_node_id/migrate-v2 [L1030]
- POST /api/polymarket/:relay_node_id/redeem [L1049]
- POST /api/polymarket/:relay_node_id/exit [L1068]
- POST /api/predictions/market/:conditionId/parse-rules [L1221]
- POST /api/predictions/watch-rules [L1245]
- PATCH /api/predictions/watch-rules/:id [L1267]
- DELETE /api/predictions/watch-rules/:id [L1291]
- POST /api/predictions/watch-rules/tick [L1304]
## tg-wallet.js (2)
- POST /api/tg-wallet/create [L57]
- POST /api/tg-wallet/:tg_user_id/send [L152]
## trading.js (27)
- POST /api/trade/withdraw [L154]
- PUT /api/trade/mode [L234]
- PUT /api/trade/agent-mode [L257]
- POST /api/trade/accounts [L324] (apiKey)
- PUT /api/trade/accounts/:id [L363] (apiKey)
- DELETE /api/trade/accounts/:id [L400]
- POST /api/trade/accounts/:id/default [L417]
- POST /api/trade/accounts/:id/test [L425] (apiKey)
- PUT /api/trade/set-anchor [L917]
- PUT /api/trade/config/:id [L1095]
- PUT /api/trade/triggers [L1118]
- POST /api/trade/trigger/proactive [L1123]
- POST /api/trade/trigger/reflection [L1129]
- POST /api/trade/ask [L1137]
- POST /api/trade/preview-split [L1154]
- POST /api/trade/order [L1243] (apiKey)
- DELETE /api/trade/open-orders [L1346] (apiKey)
- POST /api/trade/execute-split [L1362] (apiKey)
- DELETE /api/trade/order/:orderId [L1529] (apiKey)
- PUT /api/trade/daily-limit [L1628]
- POST /api/trade/baseline [L1772]
- POST /api/trade/baseline/:id/settle [L1885] (apiKey)
- POST /api/trade/approve-execution/:id [L1980]
- POST /api/trade/reject-execution/:id [L2018]
- POST /api/trade/mm-orders/publish [L2079]
- POST /api/trade/mm-orders/:id/action [L2221]
- POST /api/trade/preflight [L2717]

</details>

## 二、有鉴权状态变更路由（23条）

| 路由 | 文件:行 | 鉴权函数 |
|---|---|---|
| POST /api/admin/dedup-refund | admin-dedup.js:50 | verifyIngestRequest |
| POST /api/admin/reclaim-bshard-maker-bond | admin-dedup.js:97 | verifyIngestRequest |
| POST /api/admin/clear-repeat-offender | admin-dedup.js:119 | verifyIngestRequest |
| POST /api/admin/clear-z20-circuit | admin-dedup.js:142 | verifyIngestRequest |
| POST /api/chain/snapshot | chain-data.js:123 | verifyIngestRequest |
| POST /api/chain/balances | chain-data.js:168 | verifyIngestRequest |
| POST /api/chain/whale-alert | chain-data.js:292 | verifyIngestRequest |
| POST /api/chat/ingest | chat.js:399 | verifyIngestRequest |
| POST /api/admin/coord-status/sign | coord-status.js:14 | checkAdminSecretTier |
| POST /api/admin/visibility/:txid | dev-channel-v1.js:369 | checkAdminSecretTier |
| POST /api/link/bind | link.js:21 | verifyIngestRequest |
| POST /api/link/subscribe | link.js:40 | verifyIngestRequest |
| POST /api/operator/settle-command | operator-settle.js:34 | checkAdminSecretTier |
| POST /api/oracle-pool/seed | oracle-pool.js:102 | verifyIngestRequest |
| POST /api/admin/pool/propose-close-v2 | pool.js:1904 | checkAdminSecretTier |
| POST /api/admin/pool/zk-handoff-v2 | pool.js:1935 | checkAdminSecretTier |
| POST /api/admin/pool/zk-close-v2 | pool.js:1973 | checkAdminSecretTier |
| POST /api/admin/pool/zk-close-gate-debugger | pool.js:2062 | checkAdminSecretTier |
| POST /relays | relay.js:90 | verifyIngestRequest |
| POST /api/relay/import-privkey | relay.js:151 | verifyIngestRequest |
| POST /api/trade/mm-orders | trading.js:2152 | verifyIngestRequest |
| PUT /api/trade/mm-orders/:id | trading.js:2187 | verifyIngestRequest |
| POST /api/trade/mm-quotes | trading.js:2693 | verifyIngestRequest |

注：两条密钥导出路由（`relay.js`的`GET /relays/:id/mnemonic`/`GET /api/relay/:id/wallets/:walletId/privkey`）
用的是`checkKeyExportWindow`（本次T-KEY-EXPORT线已审GREEN），因为是GET方法不在本次"非GET"统计范围内，
单独提一句：这两条是HTTP GET但语义上是敏感读取（不是本文档定义的"改状态"），已有独立鉴权覆盖。

## 三、GET路由写信号人工复核结果（5条命中静态启发式，人工读代码后）

| 路由 | 结果 |
|---|---|
| GET /api/audit/prediction-trace-summary | 假阳性——纯`SELECT`统计查询，脚本窗口误判 |
| GET /api/bettor/variant-recommendations | 假阳性——纯`SELECT`查询 |
| GET /api/system/check-process | 假阳性——脚本窗口把该路由之后一段独立的启动期`setTimeout`自动重连逻辑（写操作）误算进这条GET路由的窗口，那段代码不在这个handler内部 |
| GET /skills | 假阳性——纯`SELECT`+页面渲染 |
| **GET /ingest/pending-handshakes** | **真实发现**：这条GET路由通过querystring参数（`claim`/`create_and_claim`）执行真实状态变更——`claimPendingAction(claim)`（认领一个pending action）、以及"原子创建+认领"分支会真的`INSERT`一行`pending_action`并锁定它。**这是一个通过GET请求的querystring触发真实写操作的路由，且未命中三大鉴权函数**——GET承载写副作用本身是一个反模式（GET语义上应该是安全/幂等的，浏览器预取、代理缓存、日志记录都可能意外重放GET请求），值得单独记一笔供后续设计参考，不在本次盘点范围内展开修复方案。 |

## 四、已知局限（如实交代）

- 本次只检测三个具名鉴权函数，未穷举所有可能的保护机制——13条命中`apiKey`/`request.ip`次级信号的
  路由需要人工读代码才能确定是否构成真实的闸（本次未展开，只标记）。
- 窗口式扫描（当前路由到下一个路由注册行之间）在文件尾部/路由间夹杂大段非路由代码（如`broker.js`
  的启动期`setTimeout`）时会产生误判，已通过人工spot-check修正5条GET候选，但未对264条POST/PUT/
  DELETE候选做同等窗口污染检查——理论上存在个别路由的窗口意外把下一条路由的鉴权检查算进来（误判为
  "有鉴权"）或把无关代码误判进来的可能，数字有±个位数误差空间，不是逐条人工验证过的精确值。
- 本次未检查这264条路由各自实际能造成的资金/数据损失量级——这是一个"谁没有前置鉴权"的清单，不是
  "哪些危险"的排序，后续若要处置需要按业务影响分优先级（例如`relay.js`的`transfer`/`wallets/:walletId/
  send`等资金相关路由 vs `skills.js`的技能CRUD类路由，风险量级显然不同）。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
