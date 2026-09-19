> **Status**: DRAFT — 只写不执行。Bettor 审后报 Owner 开闸（D-023，账本 1499）。D-021 规矩：本页不写密钥值、不写余额、不写地址、不写完整 relay 关联 txid，敏感项放 gitignored `docs-private/`。结算后半程（D-022）未完成前，本页**只做接线准备，不接真实下注流**。

# 主网电报机器人接线 runbook v0.1（复用现有 bot 身份，D-023）

出处：`docs/DECISIONS.md` D-023（Owner 原话「复用现有的！这个应该最快。」）、账本 (1499) 派工。

## 0. 范围与执行门

- 本页覆盖：让现有电报机器人（`tg-bot/`，代码零改动）指向主网 console `:3202`、代表一个真实存在于主网库的 broker relay 身份、清掉 TN12 时代残留会话状态。
- 本页**不覆盖**：结算后半程（封盘/裁决/领奖/提现，D-022 尚未合主线）、真实下注流打开（driver 开关另有独立执行门，见页 A/页 B 先例）。
- 执行门：① 本页 → Bettor 审 → ② Bettor 报 Owner 开闸 → ③ 才按本页步骤执行。任何一步验收不过，停下来按 §7 回滚，不自行往下走。

## 1. 前置检查（只读，不改任何状态）

- [ ] 主网 console `:3202` 健康：`curl http://127.0.0.1:3202/` 有响应（302 也算，进程活着）。
- [ ] proto 路由已注册：`GET http://127.0.0.1:3202/api/proto-markets` 返回 200（不是 404）——确认 `PROTO_RELAY_ID` 健康检查通过、驱动相关代码路径工作正常，间接证明 console 是最新合入代码在跑。
- [ ] 原型驱动关闭：console stdout 应有 `[proto-driver] disabled`；`kanet.mainnet.env` 里**不应存在** `PROTO_DRIVER_ENABLED` 这一行——本页跟原型下注驱动是两件独立的事，不应互相影响，前置只是确认没有交叉污染。
- [ ] tg-bot 当前未在跑：`GET http://127.0.0.1:3202/api/tg-bot/status` 确认 `running:false`（若已在跑且连着旧 TN12 console，先按 §7 的"停"步骤停掉，不要在运行中途改配置）。
- [ ] `kanet.env`（TN12 时代配置）里 `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME`/`BROKER_RELAY_ID` 三项确认存在（只核键存在，不读值，`grep -n "^TELEGRAM_BOT_TOKEN=\|^TELEGRAM_BOT_USERNAME="  kanet.env` 之类，不要把匹配到的行整行贴进任何文档/消息）——这是"复用现有身份"的前提，token 本身待 §3 走 DB 配置路径，不从这里直接抄。

## 2. 主网 broker relay 身份创建与充值

- 经既有 relay 创建路径（`POST /relays/generate-mnemonic` 生成 + `POST /relays` 提交，同 proto-v0-funds relay 创建先例）在主网库新建一个 relay，**名称必须以 `broker` 开头**（例如 `broker-tg-mainnet`）——读源码确认（`kasia-console/src/api/settings.js:142` `GET /api/config/tg-bot-broker` 的候选列表查询是 `WHERE role='broker' OR is_dex_broker=1 OR name LIKE 'broker%'`），不满足这三个条件之一，这个 relay 不会出现在 Settings 页可选列表里。
- 记录新 relay 的 `id`（UUID，可写进本页/账本）；地址与后续余额**不写进本页**，进 `docs-private/`（同种子转账执行页先例）。
- 充值：转入真实 KAS 覆盖后续用户下注/接单产生的链上手续费。**本页不建议具体金额**——这取决于结算后半程真正打开后的实际业务量（未知数），建议先转一个小额起步量（类似原型 v0 proto-v0-funds 种子转账的量级，1-2 KAS），够跑通"连线验证"这一步即可；后续真实下注流打开时的资金规模是另一次独立决定，不在本页预判。转账走既有 `/api/relay/:id/transfer`（`ADMIN_SECRET_FUNDS` 门），跟原型 v0 种子转账同一套机制，金额与来源 relay 记 `docs-private/`。
- 通过 Settings 页（或等价的 `POST /api/config/tg-bot-broker` body `{broker_relay_id}`）把这个新 relay 回填为 tg-bot 代表的 broker——**这一步优先走 UI，不建议用 curl 直接 POST**（同下方 §3 关于 token 的理由：避免 relay id 这类协调数据经手工命令行/脚本留下不必要的痕迹，UI 操作本身就是最终验收动作）。

## 3. env 键名清单（只写键名，不写值；🔴 比最初设想的少，见下方说明）

**读 `kasia-console/src/services/tg-bot-manager.js` 源码确认**：tg-bot 子进程用 `fork(..., {env: {...process.env, TELEGRAM_BOT_TOKEN: token, TELEGRAM_BOT_USERNAME: username}})` 启动——**继承 console 进程自己的完整环境**，只有 token/username 这两项被显式覆盖（DB 配置优先，env 只是 fallback）。这意味着：

- **`kanet.mainnet.env` 只需要新增一项**：`CONSOLE_URL`（值：主网 console 自己的地址，即 `http://127.0.0.1:3202`——`tg-bot/config.mjs:8` 默认是已下线的 `:3200`，必须显式覆盖，否则 bot 会去连一个不存在的进程）。
- **`TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` 不需要写进 `kanet.mainnet.env`**——改走 §2 提到的同一类 UI 路径：`POST /api/config/tg-bot-token`（`kasia-console/src/api/settings.js:174`，token **加密存 DB**，同 adapter-nodes/ingest_secret 一贯的 crypto.js 模式，GET 从不返回明文，只给掩码提示）。**这比写进 env 文件更安全**——token 全程不落地任何本页/commit/文件，只在 UI 表单提交那一刻经 HTTPS 到服务端，是本页写作时读代码发现的、比最初设想（编辑 env 文件）更优的路径，建议采用。
- **`BROKER_RELAY_ID` 不需要写进 env**——§2 已经通过 `POST /api/config/tg-bot-broker` 把 DB 配置设好了，DB 优先于 env fallback，两边都设是冗余（写了也没坏处，但没必要）。
- **`KASPA_NETWORK` 不需要额外处理**——`kanet.mainnet.env` 已有 `KASPA_NETWORK=mainnet`（账本 1453 核实过存在），tg-bot 子进程继承 console 进程的这个值，`/swap` 命令的网络名文案会正确显示 mainnet，不需要单独设置。
- 🔴 **"本地模型"两个键（`LLAMA_MODEL_PATH`/`LLAMA_SERVER_PATH`）经查证不需要写进 `kanet.mainnet.env`**——`grep -rn` 全仓确认这两个键只被 `kanet-start.sh`/`kanet-start-headless.sh`（TN12 全栈编排脚本）读取，**主网 console 由完全独立的 `scripts/start-console-mainnet.ps1` 起、不经过这两个脚本**，这两个键在主网启动路径上根本不会被读到。若未来需要 broker 的 LLM 对话功能（`broker-llm-agent.js`），那是否要为主网单独起一个 llama-server、怎么起，是一个独立问题，不在本次"接线现有 bot"任务范围内，需要再单开一票，本页不顺手处理。

### 3b. kanet.mainnet.env 注释里其余"待定"项（补充派工，账本原注释第 30-33 行附近，均已核实键名存在于 `kanet.env`）

- **`OWNER_BOT_TOKEN`/`OWNER_CHAT_ID`**——按 Bettor 裁定复用现有值（收件人是 Owner 本人，另开无收益）。
  🔴 **写进 runbook 前必须说清一个技术现实（读 `tg-bot/owner-bot.mjs`+`tg-bot/console-api.mjs` 源码发现，不是猜测）**：owner-bot 有三个方向，**Direction A**（Owner→dev-coord）和 **Direction B**（dev-coord→Owner）两者都硬编码 `channel: 'dev-coord-testnet'`（`postOwnerMessageToDevCoord`/`devCoordMessagesSince`，`console-api.mjs:194-201`）——这个频道随 D-017 已退役，`:3200` 无响应，**这两个方向连上主网 console 后大概率要么直接报错、要么"成功"但永远收不到/发不出任何东西**（没有任何东西还在往这个频道写）。**Direction C**（用户反馈升级通知 Owner，`feedbackEscalatedSince` 打 `/api/feedback/escalated-since/...`，独立的 REST 端点、不依赖频道机制）看起来仍然有效。
  **本页建议**：仍然接线 `OWNER_BOT_TOKEN`/`OWNER_CHAT_ID`（成本低、Direction C 有价值），但 §7 验收**不用"发一条 dev-coord 测试通知"**（那条路已经不通，测出来的是"假阳性能连上"或"假阴性连不上"都没有信息量）——改验 Direction C：手动触发一条测试反馈升级（或直接读 `/api/feedback/escalated-since/...` 确认端点在主网库上能返回，不必真触发一次业务事件），确认这条路能通即可。Direction A/B 是否要修（改指向别的通道，或干脆废弃这两个方向的代码）不在本页范围，建议另开一票问 Bettor/Owner 要不要处理。
- **`ADMIN_SECRET*` 系列**——Bettor 裁定：**一律新生成，禁止沿用 TN12 值**（TN12 值在旧 env 里躺了很久，可能进过日志/截图，且主网已有先例：`ADMIN_SECRET_FUNDS` 走的就是新生成）。`kanet.env` 里现有的这一族键名（核过，仅列名不列值）：`ADMIN_SECRET`、`ADMIN_SECRET_ZK_CLOSE_BROADCAST`、`ADMIN_SECRET_STATUS_SIGN`、`ADMIN_SECRET_ZK_STATE_PREP`、`ADMIN_SECRET_READONLY`、`ADMIN_SECRET_PILOT_DIAGNOSE`。本页不逐一判断这六个哪些跟 tg-bot 接线实际相关（大部分是 ZK/系统管理相关端点的钥匙，跟 broker bot 交互本身关系不大）——**若执行时发现某个具体功能因为对应 `ADMIN_SECRET_*` 未设而 503，按需单独生成那一把**（生成命令同 `ADMIN_SECRET_FUNDS` 先例：`openssl rand -hex 32`），不要为了"配齐"而不看需求批量生成一整组不用的钥匙。
- **`PILOT_WALLET_ADDRESSES`**——TN12 地址不适用主网，**本页不回填**，写"主网地址产生后再回填"这句占位，值待定进 `docs-private/`（与本页 tg-bot 接线大概率无直接关系，只是顺手把这个待定项的处置口径记录清楚，避免以后有人直接抄 TN12 值）。

## 4. `tg-bot/_state.json` 备份与清空

- `_state.json` 现存内容为 TN12 时代残留（核过：`sessions`/`linkedAddrs`/`userLangs` 等字段有数据，最后修改早于本次任务），其中的市场 id（如 `ext-pool-v07-...` 这类）在主网库里不存在——不清空的话，老用户一回话触发查询会撞到"市场不存在"报错。
- 步骤：① `cp tg-bot/_state.json docs-private/tgbot-state-backup-<日期>.json`（gitignored，备份不进仓库，只在本机留一份，供万一需要回查旧会话用）；② 清空 `tg-bot/_state.json` 为初始空结构（`{"sessions":{},"pendingPayments":{},"linkedAddrs":{},"userLangs":{},"brokerFeeTs":{}}`，五个顶层键对空结构，字段名读源码现有文件核对，不凭空造字段）。

## 5. 最小集开关（一律保持关闭，打开需 Owner 单独批）

| 开关 | 默认值（本页要求） | 说明 |
|---|---|---|
| `PROTO_DRIVER_ENABLED` | 不设（等同关闭） | 原型下注驱动，跟本页 tg-bot 接线无关，确认不被本页动作带偏 |
| `POOL_SEEDER_ENABLED` | `0` 或不设 | 自动做市/播种，不开 |
| `PREDICTION_AGENT_ENABLED` | `0` 或不设 | 自动下注 agent，不开 |
| `AUTO_BET_TICK_MS` | `0` 或不设 | 自动下注 tick，不开 |
| `BROKER_ENABLED` | `0` 或不设 | 读 `kasia-console/src/index.js:904` 确认：这个开关门控一整块自动化 broker 服务（intake-watcher/buy-handler/fee-emit 等），**跟 tg-bot 交互式对话本身是两回事**——tg-bot 走独立的 `tg-bot-manager.js` fork 机制启停，不受这个开关影响；这里列出是为了明确"接线 tg-bot 不等于打开这一整块自动化"，避免顺手带开。

打开以上任一项都是**独立于本页的决定**，需要另外报 Owner 批准，本页执行完成后这些开关状态应与执行前一致（不新增、不误改）。

## 6. 用户侧文案（交 Owner 过目，本页不代为定稿）

首次交互（`/start` 或等价入口）必须明确告知：**这是零价值测试币的市场，不是真钱**——参考措辞方向（具体文案由 Owner 定稿，本页只给方向不替 Owner 写死）：
> 「你好！这里的下注用的是 KTT 测试代币，免费无限铸造、没有真实价值，不是真钱交易。」

理由（账本 1499 原话）：老用户对这个 bot 的既有预期是真钱交易场景，"复用现有身份"省下的是申请新身份这一步，**不代表用户侧的认知落差被自动解决**——文案缺失会导致老用户误把测试币当真钱，这是本页明确要求前置解决的问题，不能留到上线后再补。

## 7. 验收读数与回滚

### 验收（§1-§6 全部执行完之后）

- [ ] `kanet.mainnet.env` 只新增了 `CONSOLE_URL` 一行（`grep -c "^CONSOLE_URL="` = 1），其余原有内容不变。
- [ ] `POST /api/tg-bot/start` 成功启动，`GET /api/tg-bot/status` 显示 `running:true`。
- [ ] Bot 自己给一个测试账号发 `/start`，收到的欢迎文案含 §6 的测试币声明。
- [ ] `GET /api/config/tg-bot-broker` 返回的 `broker_relay_id` 是 §2 新建的那个 relay id，且该 relay 出现在返回的 `brokers` 候选列表里（证明 name 前缀/role 设对了）。
- [ ] 用测试账号走一遍最基础的只读查询流程（如查看当前市场列表），确认 bot 真的在跟 `:3202` 通信、不是仍连着已下线的 `:3200`（可以从行为上判断：`:3200` 已下线，若配置没生效，这一步会直接超时/报错，而不是"连到旧数据"）。
- [ ] `_state.json` 确认已清空为初始结构，备份文件在 `docs-private/` 下存在。
- [ ] `kasia-console/data/console.mainnet.db` 里对应新建的 relay 一行核对存在（id/name，同 §2）。
- [ ] 上述所有开关（§5 表格）状态与执行前一致，没有被顺手打开。
- [ ] **`grep -c "^KANET_TESTNET_NO_LIMITS" kanet.mainnet.env` = 0**（§8 禁止项的断言，每次改完 env 都要跑一遍，不能只在写 runbook 时嘴上说不会带）。
- [ ] （若接了 owner-bot）Direction C 确认能通：`GET /api/feedback/escalated-since/1970-01-01?limit=1`（或近期时间戳）在主网 console 上返回 200，不是 404/500。

### 回滚

1. `POST /api/tg-bot/stop`（走既有 lifecycle 接口，不要直接 kill 进程——同既有"bot 重启坑"纪律，直接 kill 会被 supervisor respawn、Telegram 单 poller 撞 409）。
2. 从 `kanet.mainnet.env` 删除本页新增的 `CONSOLE_URL` 一行，`grep` 核实确实删掉了。
3. 若 §2/§3 的 DB 配置（token/broker relay id）已设置且需要撤销，同样走对应的 `POST /api/config/tg-bot-token`/`tg-bot-broker` 接口清空，不建议直接手改 DB。
4. `_state.json` 若已清空但需要恢复，从 §4 的备份文件覆盖回去。
5. 记录回滚原因，报 Bettor，不在没有诊断结论前重试。

## 8. 禁止项

🔴 **`KANET_TESTNET_NO_LIMITS` 绝不写进 `kanet.mainnet.env`**——核过 `kanet.env` 里这一项当前值为启用状态，字面意思是"关闭测试网限额保护"，这是 TN12 测试网环境专属的便利开关，主网真钱/真手续费环境绝不能带这个开关，D-017/D-021 一贯纪律，本页专门重申一次防止"复用现有配置"时被整段复制带过来。
