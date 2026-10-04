# KANet-UI 报件：预测市场现有 UI 清点 + 主网 KTT-only 最小改动清单（账本 1855，只读，未改任何文件）

读码依据：生产检出 HEAD 6bcbd00e（含 3534d647）。截图是对主网 :3202（PID 32924）的只读 GET，截图在 `docs/provenance/2026-10-05-kanetui-mainnet-pm-ui-shots/`。

## 1. 页面和组件（路径均在 `kasia-console/src/ui/`）
| 页面（URL） | 模板 | 路由注册 | 主网今天渲染 |
|---|---|---|---|
| 市场列表 `/predictions` | `predictions-list.eta`（234 行） | `api/stocks.js:42` | 渲染，因主网 0 个盘显示空态「现在没有进行中的市场」 |
| 发起预测 `/predictions/pool/create` | `predictions-pool-create.eta`（989 行） | `index.js:479` | 渲染，表单可见，提交会 403 |
| 市场详情 `/predictions/pool/:id` | `predictions-pool-detail.eta`（993 行） | `index.js:537` | 页面壳渲染；主网 pool_markets=0，所以**没有真数据的详情页可截**，只截了不存在 id 的壳（404 空态） |
| 我的市场 `/my-markets` | `my-markets.eta` | 未逐个核 | 未截 |
| 资产/持仓 `/portfolio` | `portfolio.eta`（1186 行） | `api/portfolio.js:24` | 渲染；是通用钱包资产页，调 `/api/portfolio/unified`，不是预测专用 |
| 仲裁人首页 `/oracle` | 另有模板 | — | 渲染，已显示 6 个委员 |
| 旧版 `/legacy/polymarket-escrow` | `predictions.eta`（2853 行，归档） | `api/stocks.js:46` | 旧 1v1 SS escrow，不在本次范围 |
| 注册表 `/predictions/oracle-registry` | `predictions-oracle-registry.eta` | 已退役（`index.js:531` 注释） | 不用 |
| proto-v0 `/proto-markets` `/proto-markets/create` `/proto-markets/:id` | `proto-market-{list,create,detail}.eta` | `index.js:509-523` | **仍可打开**；侧栏「市场（原型）」入口也还在。proto-v0 已作废（D-033） |
共用：`partials/sidebar.eta`（含「⚠ 测试网·小范围邀请制 / 测试网，非主网」提示条，主网上字面不实）。

## 2. 各页 API 调用，与主网状态
`predictions-list.eta`：GET `/api/pool/markets?limit=200`、`/api/agent/profile`、`/api/broker/recommendations`。全 200。**显示 KAS**：卡片 `yes_pool_kas / no_pool_kas` 的「YES x KAS / NO x KAS」（:87,:90）；新手引导「① 领测试 KAS」→ `/faucet`（:25-27）。
`predictions-pool-create.eta`：GET `/api/pool/config`、`/api/relay/:id`、`/api/relay/:id/balance`、`/api/oracle/registry`、`/api/pool/market/…`、`/api/predictions/polymarket/search`；写：POST `/api/pool/prevet`、`/api/pool/prevet-extract`（预审，非钱路）、**POST `/api/pool/market/create`（:878）→ 主网 403**（`pool.js:599`）。**KAS 输入**：「押 N KAS」滑杆 `form.maker_stake_kas`（min 100，:385-402）、`kasBalance` 余额显示（:73）、「押金 N KAS 已锁」（:86）、勾选「我准备签名锁押金」。**页面只会调旧的 `create`，不会调 `create-v07`**。
`predictions-pool-detail.eta`：GET `/api/pool/market/:id`、`…/events`、`…/settle-audit`、`/api/oracle/markets/:id/audit`、`/api/pool/fee-config`、`/api/tg-bot/status`；写：
- 下注 **POST `…/bettor/register`（:678）→ 主网 403**，body 为 `stake_kas`；
- 外部钱包流 **`…/bettor/register-v06/prep`、`/confirm`（:717,:735）→ 403**（外部流还让人付 KAS 到 side_p2sh、生成 kaspa: 支付 URI、复制精确 KAS 额，:155-223）。
**KAS 显示**：「押多少 KAS」输入（:168,:262，min 1）、「最低 1 KAS · testnet 币零经济价值」、「已锁 N KAS 押 YES/NO」、按钮「从 X 锁 N KAS 押 YES」（:670）、结算证据「押注池 N KAS / 赢家领 N KAS / 各方 N KAS」（:381-398）、审计表 maker/bettor `stake_kas`（:437,:452）、「主持人本金 / 仲裁人押金（每位）」按 sompi/1e8 当 KAS 显示（:497-498）。
`portfolio.eta`：`/api/portfolio/unified`、`/api/chains/meta`、`/api/relay/:id/wallets…`；40 处出现 KAS，但那是钱包资产，不是押注流。**只读 GET 全 200**。
proto 三页：`/api/proto-markets*`、`/api/tokens`；写 `POST /api/proto-markets/create` 等，按账本 1845/3.4 该在主网被闸，并且 `PROTO_*` 驱动已关。

对照你清单里的 403 路由：create / create-v06 / register / register-v06 prep+confirm / register-external prep+confirm / register-v07 prep+confirm / oracle/deposit 都挂了 `assertNoKasStakeOnMainnet`，**UI 实际会撞到的是 create、register、register-v06 prep/confirm 四个**；create-v06、register-external、register-v07 prep/confirm、oracle/deposit **没有 UI 调用方**（只有自动程序/脚本）。
**没被闸的两条是「重开」路由**：`create-v07`（`pool.js:1096`，ZK 原生盘，必填 `maker_relay_id, outcome_side, outcome_end_date, resolution_rule_spec`，主网不要 `maker_stake_kas`，一次只许一个未完结 ZK 盘）和 `register-v07`（`pool.js:1514`，body `bettor_relay_id|bettor_pk, direction, stake_ktt`，`stake_kas` 不再读；`stake_ktt` 要整数且 ≥ `BETTOR_MIN_STAKE_POLICY`）。这两条**没有任何 UI 调用方**。

## 3. 最小改动清单（复用现有组件，不重做版面；全属用户面，铁律 0 需 Owner 批）
A. `predictions-pool-detail.eta`（改动最大）
 1. `submitBet()`（:678）改调 `…/bettor/register-v07`，body 改 `{bettor_relay_id, direction, stake_ktt}`（整数字符串）。
 2. 「押多少 KAS」输入改「押多少筹码」，变量 `bet.stakeKas`→`bet.stakeKtt`，`step=1`，最小值取 `BETTOR_MIN_STAKE_POLICY`；删「最低 1 KAS · testnet…」换「测试代币·零价值」。🟡 注意：最小下限数值是 `100_000_000`（原义 1 KAS 的 sompi）。直接显示「最低 100000000 筹码」不友好；是否换算成显示单位（KTT 小数位）要你/Owner 定，我没查到 KTT 的小数位常量，需 J2 确认。
 3. 按钮文案 `lockButtonLabel()`（:670）「锁 N KAS」→「用 N 筹码押 YES/NO」；成功条「已锁 N KAS」→「已押 N 筹码」；`canSubmitBet` 的 `>=1` 判断换成 ≥ 最小筹码。
 4. 整块删「外部钱包押注流」（:155-223 与 `ext.*`、`kaspaPayUri`、register-v06 的 prep/confirm 调用，约 100 行）：主网没有付款，没有这条流。
 5. 结算证据与审计的「KAS」后缀→「筹码」，`amount_kas`/`pool_kas`/`stake_kas` 字段取值不变只改单位字样（后端字段名是否换，见 D）。
 6. 删「主持人本金」「仲裁人押金（每位）」行（:497-498）：主网 ZK 原生盘无 maker 押金，`maker_stake_amount` 记 0，显示 0 KAS 会误导。
B. `predictions-list.eta`：卡片「YES x KAS / NO x KAS」→「筹码」；删新手引导 ①「领测试 KAS → /faucet」整格，改成「选市场→选 YES/NO→押筹码」（保持 3 步版式，不改布局）；⑶ 「用我的钱包付」改「用筹码押，不花 KAS」。
C. `predictions-pool-create.eta`：删「押 N KAS」滑杆和「最低 100 KAS」、`kasBalance` 显示、「押金已锁」、「我准备签名锁押金」勾选；提交改 POST `…/create-v07`，body 至少 `maker_relay_id, outcome_side, outcome_end_date, resolution_rule_spec`（其中 spec 要带 `zk_native:true`，不能是 false），不再传 `maker_stake_kas`；保留议题/截止时间/判定凭据/成交费滑杆现有控件。🟡 页面现在组装的是 v0.5 的 body，到 create-v07 要核字段映射（`outcome_side` 对应页面「你押哪边」）；J2 比我更熟，建议 J2 接这条。另要注意主网一次只许一个未完结 ZK 盘（409 提示需要在页面上翻成人话）。
D. 后端小口（不属 UI，仅提示）：`/api/pool/markets` 等返回 `yes_pool_kas/no_pool_kas`（`pool.js:3210` 等多处）是 sompi/1e8 当 KAS；若前端只改字样不改字段，数字是「筹码单位/1e8」，不是整数筹码。要么前端自己 ×1e8 还原、要么后端加 `*_ktt` 字段——这个需要 Bettor/J2 定，我倾向后端加字段（前端不做单位换算）。
E. `partials/sidebar.eta`：「⚠ 测试网·小范围邀请制…」提示条在主网是错的（「测试，非主网」「真钱请用自己的非托管钱包」）；需改成主网文案或按网络条件显示（单源 `configuredNetwork`）。侧栏「市场（原型）」入口（proto-v0）主网应隐藏。
F. `portfolio.eta`：不用改（通用钱包页）；但押注头寸/领奖在页面里没有专用位置：`/api/pool/my-positions`（`pool.js:3373`）UI 里**没有任何调用方**（grep ui 无命中）。若要让用户在页面看到「我的筹码押注/领奖」，需新增一块（用现有表格样式），这是新增而非复用，请 Owner 定要不要。同样 `…/bettor-refund-claim`（`pool.js:4165`）没有 UI 入口。
G. `proto-market-*.eta` 三页：不改，建议主网下入口隐藏（见 E）。

## 4. 截图（`docs/provenance/2026-10-05-kanetui-mainnet-pm-ui-shots/`）
predictions-list.png、pool-create.png、pool-detail-nonexistent.png（主网无盘，仅壳）、portfolio.png、proto-list.png、proto-create.png、oracle-home.png。
**要截「有数据的详情页/下注面板」**，须先有一个主网盘（pool_markets 现为 0），而建盘是 Bettor 的首盘步骤；那之前只能拿 simnet 的页面截图当 Owner 看图稿——J2 的 simnet 实例上能渲染，可由 J2 截或我在 simnet 上截。

## 5. 风险
- 全部 UI 文件都是用户面，必须 Owner 看图批（设计稿 §3.6）。
- 页面和 `create-v07/register-v07` 之间从未接通；本清单只做到「字段对得上」，未在浏览器里端到端跑过。
- 没动任何文件；截图只发了 GET。
