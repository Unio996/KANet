# D-028 只读账户可见（冷存账号进主网 console 资产页）设计稿 v0.2

> **Status**: CURRENT（设计稿·只写不落码·待 Bettor 转 NWT 复审；用户面版面/文案须 Owner 批，见 §8）
> 作者：KANet-UI ｜ 日期：2026-09-20 ｜ 依据：`docs/DECISIONS.md` D-028（Owner 铁令：所有资产必须在主网 console 全部可见）｜ 清单：`docs-private/ASSET-INVENTORY.md`（gitignored）
> 前版：v0.1 `0df8b5ea`；NWT 设计审 `60420ed4`（方向 GREEN，1 MUST + 5 SHOULD）；Bettor 重裁（M-D1 改判、backup 撤销）见 §0.1。
> **D-021**：本文不含任何金额、地址、"账号名↔地址"对应；冷存两账号一律称"冷存账号 1/2"，具体见私有清单。密钥值我没有读、也不需要（源库 `C:\KANet\…\console.db` 我未打开）。

## 0. 一页结论

| 问 | 结论 |
|---|---|
| ① 直读链上余额的现成路径有吗 | **有底层，没有现成读口**。`api/relay.js:704-726 getKasBalance` 用"地址 → 共享 RPC `getBalancesByAddresses`"，不需要 relay 子进程；但它**静默返回 0**（空/未同步 ⇒ 0，不看同步状态）且**无条件回落公网 REST**，所以**不复用它**，另写只读模块（§2.2） |
| ② 无钥账户如何保证不进有钥集合 | **不靠"到处加过滤"，靠"根本不进 `relay_nodes`"**：新表 `watch_accounts`，**没有任何密钥列**。NWT 复核：没有任何现有代码读这张表，也没有通用"遍历所有表"的代码会扫到它；独立表 = 默认不可见（默认拒绝） |
| ③ 写入形式 | **新表 `watch_accounts`**（不选 `relay_nodes` 插无钥行），理由 §3.3 |
| ④ 标注 / 不可花 | 页面独立"冷存（只读）"区块，徽标"冷存 · 只读 · 不可花"，区块内**没有任何发送入口**；后端 `/api/watch-accounts*` **只有 GET** |
| ⑤ 验收 | §6：资产页 20 账户（18 热 + 2 冷）、总额 = 热 + 冷且不重复计、relay 子进程仍 18、autoSplit / broadcaster / 守卫 / startAll 对冷存零调用、读数诚实（含阳性对照与 LOCAL_ONLY 无外发）（变异对照） |

### 0.1 v0.2 相对 v0.1 的变更（对照 NWT `60420ed4` 与 Bettor 重裁）

| 项 | 来源 | v0.2 处理 | 落点 |
|---|---|---|---|
| **M-D1 公网回落** | NWT MUST + Bettor 改判（v0.1 的"保留回落"**作废**） | 新读取模块**遵守 `KASPA_RPC_LOCAL_ONLY`**：为 `1` 时**不做任何 REST 回落**，本机未同步 ⇒ 显示"—"（追块期几小时显示"—"可接受）。另设显式 opt-in `WATCH_PUBLIC_FALLBACK`（只认字面 `1`，主网不写）供 Owner 另批；既有热钱包 `getKasBalance` 的 REST 回落是既有行为，**本设计不动**，记后续票 | §2.2 / §4-2 / A11 |
| S-D1 / 备份 | NWT SHOULD + Bettor 撤销 | **`api/backup.js` 不含新表**（v0.1"必须含"撤销）：它备份的是社交/mind 配置，且 `POST /api/backup/import` 是写路径，加进去 = 给冷存表开 HTTP 写口，与 §2.1/§2.3 矛盾；整库备份（拷 `console.mainnet.db`）本来就含此表 | §4-5 |
| S-D2 读数诚实加固 | NWT SHOULD（Bettor 要求全做） | `ok` 要求：`getWorkingRpc().isLocal===true` 且 `isSynced` 取自**同一客户端**；`isSynced` 在余额读取**前后各读一次**（不用 30 s 缓存）；**同批阳性对照**（并入热地址，对照项 0/缺项 ⇒ 整批 unavailable） | §2.2 / A7 |
| S-D3 总额口径 | NWT SHOULD | headline 写死 = `grandTotalKas + watchKas`，另留 `kasAll`（纯 KAS 口径）；写明热侧静默 0 与冷侧诚实"—"的不对称，记后续票 | §2.3 / §4-6 |
| S-D4 登记脚本 | NWT SHOULD | 地址与名字**不放命令行**：`--from-file <仓库外路径>` 或 stdin；回执只打条数与规范化后前缀/末 6 位；先规范化成 `Address.toString()` 再去重；命中本地地址语义列只警告并列出命中表 | §2.1 / A2 / A10 |
| S-D5 按地址匹配 | NWT SHOULD | `readWatchBalances` 按 `entry.address`（规范化后）匹配，不按下标 | §2.2 / A12 |
| 观察 | NWT | 迁移号与 `docs/DATABASE.md` 同步（验收 A13）；A4 静态检查用 F2-1 共享扫描器（扫描根含 `kasia-console/scripts`） | §6 A4 / A13 |
| 页内注明 | Bettor | 每 relay 800 / 总 1000 上限是 9/14 迁移期的**政策闸（账本 1306/1320 的执行页与冷名单），不在代码里**；本设计只读、不触及 | §3.3 / §7 |

## 1. 现状（只读核，工作树 `origin/bshard-m3-deploy` `30b11216`）

- 资产页 = `/portfolio`（`ui/partials/sidebar.eta:24-27`「资产」）→ 前端调 `/api/portfolio/unified`（`ui/portfolio.eta:1104-1105`）→ `api/portfolio.js:34-35` 只从 `relay_nodes WHERE address IS NOT NULL` 取账户，逐个 `fetch /api/relay/:id/wallets`（`portfolio.js:_aggregateForRelay`）。所以**不在 `relay_nodes` 的地址，资产页天然看不到**——这就是冷存账号"消失"的机制。
- `/api/relay/:id/wallets`（`api/relay.js:729-803`）：`getKasBalance(relayId)` + `agent_wallets` 多链余额。**按 relay id 取地址**，与"有没有钥"无关（`hasMnemonic/hasPrivateKey` 只是回显）。
- 冷存两账号 = 9/14 迁移被冷名单拦在导入之外：主网 `relay_nodes` 无此二行，`agent_wallets` 无对应行（清单 §一）。清单称这两个账号只持 KAS；**本设计以 KAS 为范围**，表里留 `chain` 列给将来扩展，但 v0.2 不做多链余额。
- 主网 `kanet.mainnet.env` 已设 `KASPA_RPC_LOCAL_ONLY=1`（Bettor / NWT 核过键与值）；`services/rpc-health.js:27,~275` 的语义：本机不行 ⇒ `getWorkingRpc()` 返回 `{url:null,isLocal:false}`，**不做 Resolver 发现**。

## 2. 设计

### 2.1 数据：新表 `watch_accounts`（迁移号取合入时 `migrate.js` 末尾之后；今天末尾是 v210）

```sql
CREATE TABLE IF NOT EXISTS watch_accounts (
  id          TEXT PRIMARY KEY,                       -- uuid
  name        TEXT NOT NULL,                          -- 保留原名（Bettor 要求）
  chain       TEXT NOT NULL DEFAULT 'kaspa',
  network     TEXT NOT NULL DEFAULT 'mainnet',
  address     TEXT NOT NULL,                          -- 入库前统一成 Address.toString() 规范形式
  custody     TEXT NOT NULL DEFAULT 'cold_no_key' CHECK (custody = 'cold_no_key'),
  note        TEXT,                                   -- 一句话来历，不含金额
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (chain, network, address)
);
```
- **没有 mnemonic / privkey / hint 任何列**——"不持钥"由 schema 承担，不是约定。`custody` 用 CHECK 钉成唯一取值，将来有人想复用此表存有钥账户会被 schema 拒绝（要改就必须改迁移，会红）。
- 迁移与 `docs/DATABASE.md` **同版同步**（新表、用途、写入方=登记脚本、读取方=`watch-balance.js` / portfolio API、陷阱=不进 relay_nodes；CLAUDE.md 铁律）。
- **写入路径 = 一次性登记脚本** `scripts/watch-account-register.mjs`（默认 dry-run，`--apply` 才写；不开 HTTP 写接口）：
  - **输入不走命令行**（S-D4）：`--from-file <仓库外路径>`（或 stdin）读"名字 + 地址"行；执行人事先从 `docs-private/ASSET-INVENTORY.md` 抄成该文件，执行后**由执行人删除**；脚本回执只打**条数**与每条**规范化后的前缀 + 末 6 位**，不回显完整地址、不回显名字（避免进进程表 / PowerShell 历史 / 日志）。
  - **规范化**：`kaspa-wasm` `Address.validate` 通过且 network=mainnet，再统一为 `Address.toString()`（小写、带 `kaspa:` 前缀）。`UNIQUE(chain,network,address)` 是原文唯一，所以**先规范化再比再存**（大小写/前缀变体绕不过）。
  - **拒绝重复**：规范化后**不得**已存在于 `watch_accounts` / `relay_nodes.address` / `agent_wallets.address`（后两张的库内值也逐个规范化后再比；解析失败的行跳过并计数报告）——防"热 + 冷"重复计入总额。
  - **只警告不拒绝**（NWT ⑤）：若该地址出现在带"本地地址"语义的列——`pending_actions.local_address`、`relation_states.local_address`、`tx_records.local_address`、`oracle_pool_membership.relay_address`、`oracle_stake_enrollments.relay_address`、`reputation_summary.address` 等（脚本只查实际存在的表，表缺失跳过）——说明它**曾经是本地 relay 身份**（如 TN12 遗留），脚本**列出命中的表.列与命中数（不打印地址）**，交给人判断，不拦。

### 2.2 读：新模块 `services/watch-balance.js`（只读，无副作用；不复用 `getKasBalance`）

**外发策略（M-D1）**：`KASPA_RPC_LOCAL_ONLY==='1'`（主网现状）⇒ **不发起任何 REST/公网请求**。本机不可用或未同步 ⇒ 状态 `unavailable`，页面显示"—（无法读取）"。opt-in 键 `WATCH_PUBLIC_FALLBACK`：只认字面 `'1'`、**主网 env 不写**、打开须 Owner 另批；打开时才允许 REST 回落，且状态标 `ok_public`、来源写"公网 REST"，冷存地址**不与热钱包地址同批**外发（不把归属关联交给第三方）。默认与 LOCAL_ONLY=1 时该分支不存在。

**`ok` 的判据（S-D2，缺一不 ok）**——一次读取序列：
1. `getWorkingRpc()` 返回 `isLocal===true` 且 `url!=null`；否则 `unavailable`（LOCAL_ONLY 下不再往下走）。
2. 取共享客户端 `getSharedRpc({url, networkId:'mainnet'})`（**不 per-call new RpcClient**，见 wasm 泄漏记录）。
3. **读同步 #1**：在**同一个客户端**上 `getServerInfo()`：`isSynced===true` 且 `networkId` 为 mainnet；**不用 30 s 缓存**（追块后段 `isSynced` 会提前翻 true，缓存窗内可能已翻回）。
4. **一次** `getBalancesByAddresses([...冷存规范化地址, ...热地址阳性对照])`。**阳性对照**：并入一个或多个**已知有余额的热地址**（`/api/portfolio/unified` 本来就在读 18 个热地址；单独调 `/api/watch-accounts` 时读取模块自己从 `relay_nodes` 取热地址，只读）。**对照项读到 `0` 或缺项 ⇒ 整批判 `unavailable`**（NWT 实测：同步节点对"从未使用的地址"返回 `balance===0n` 的条目而不是缺项，**值本身分不出真 0 与 IBD 空值**，只能靠状态判据 + 阳性对照）。
5. **读同步 #2**：余额读取之后**再**读一次 `getServerInfo()`，`isSynced===true` 才 `ok`；前后任一为 false/抛错 ⇒ `unavailable`。
6. **按地址匹配**（S-D5）：结果条目用 `entry.address` 与规范化登记地址匹配，**不依赖顺序/下标**；批里缺某冷存条目 ⇒ 该账户 `unavailable`（不是 0）。

每个账户返回 `{ id, name, address, status, balanceKas, source, readAt }`：
| status | 含义 | 页面显示 |
|---|---|---|
| `ok` | 满足上面 1–6 | 数字 + "来源：本机节点 · 读于 hh:mm" |
| `ok_public` | **仅当** `WATCH_PUBLIC_FALLBACK=1` 且 LOCAL_ONLY≠1：REST 读到 | 数字 + "来源：公网 REST（Owner 已批）" |
| `unavailable`（含 `node_not_synced` 等原因码） | 任一环节不满足 | **"—（无法读取）"，绝不显示 0** |
- 依据：IBD 期链读会返回合法的空值——渲染成 0 等于"冷存账号余额清零"的假警报，正是 D-028 想根除的"看不见/看错"。
- 短 TTL 内存缓存（30 s，进程内，不落库）只缓存**已判 ok 的结果对象**，不缓存同步判据；不做落库缓存（落库的旧余额会变成"看起来像真的"的陈数）。

### 2.3 API（只读）

- `GET /api/watch-accounts` → `{ ok, accounts: [{ id, name, address, custody:'cold_no_key', status, reason?, balanceKas, source, readAt }], asOf }`；`GET /api/watch-accounts/:id` → 单个。
- **没有** POST/PUT/PATCH/DELETE，没有任何 `send/transfer/split/privkey` 路径；watch id 传给 `/api/relay/:id/*` 一律 404（因为不在 `relay_nodes`）。
- `GET /api/portfolio/unified`：在现有 `agents`（热，语义不变）之外**新增** `watchAccounts`（同上数组）与：`totals.watchKas`（只累加 `ok`/`ok_public` 项）、`totals.kasAll = totals.kas + totals.watchKas`（**纯 KAS 口径**）、**`totals.grandTotalKasWithWatch = grandTotalKas + totals.watchKas`（页面 headline 用它**——`grandTotalKas` 是 `portfolio.js` 现有的"含 USD 资产折 KAS"口径，避免页面出现两个"总计"）、`totals.watchUnreadable`（读不到的冷存数）。**不改** `totals.kas` / `grandTotalKas` 的既有含义。
- **`/api/relay/:id/wallets` 不改**：它按 relay id 服务、并被发送弹窗等有钥流程调用；把无钥行塞进去会污染这条路径的语义。

### 2.4 页面（`ui/portfolio.eta`）

- 页头 headline = `grandTotalKasWithWatch`，分解显示"= 热钱包 X + 冷存 Y"；读不到的冷存以"（含 N 个冷存账户无法读取，总计不完整）"标出，不静默漏算。
- 在现有账户卡片之后新增独立区块「冷存（只读）」：每个冷存账户一张卡：名称、地址（可复制）、余额/状态、徽标 **"冷存 · 只读 · 不可花"**、来源与读取时间。**该区块不含**发送 / 转账 / 拆分 / 导出私钥等任何按钮或 `sendModal` 引用。
- 线框见 §8；**版面与文案属用户面，须 Owner 批**（铁律 0），本稿只给结构。

## 3. ② 逐消费者审计：为什么不进 `relay_nodes`

方法：`grep` 全部非测试、非迁移的 `relay_nodes` 查询（**271 行 / 63 个文件**，全部过目）**按查询文本**分类；**未逐个读函数体**（下表标"文本判定"）。NWT 复审没有重做这份审计（选 B 后不需要），只核了五个点名消费者读的是 `relay_nodes` / `agent_wallets`，并核了"没有通用遍历所有表的代码会扫到新表"。

### 3.1 已带"有钥"过滤（进了也不会被当有钥）
`services/relay-manager.js:340 startAll`（`mnemonic OR privkey`）、`services/relay-health-monitor.js:80`、`api/relay.js:199`、`api/chat.js:308/446/879`（仅 mnemonic）、`services/utxo-splitter.js:71 autoSplitAll`（仅 mnemonic）。→ 这几处**今天**就不会拉起/拆分无钥行（这也是 Bettor ② 里点名的 `mnemonic_encrypted IS NOT NULL`）。*另记一条既有缺口，不属本设计*：`autoSplitAll` 与 `chat.js` 只认 mnemonic、不认 privkey，privkey-backed relay 在这两处不被覆盖，与 `startAll` 口径不一致。

### 3.2 **没有**有钥过滤、且语义是"这是我们本地的 agent"——无钥行插入 `relay_nodes` 后会被误当本地 agent（文本判定）
| 类 | 位置（文件:行） | 误判后果 |
|---|---|---|
| 按 `address IS NOT NULL` 枚举 agent 做**任务**/展示 | `api/trading.js:276,1781`（交易任务遍历）、`api/conversations.js:827,937`、`api/discovery.js:47`、`api/events.js:145`、`api/chain-data.js:66`、`api/stocks.js:33,47`、`api/portfolio.js:35` | 给无钥行建会话/交易配置/发现任务/展示项；交易遍历会对无钥地址找 `trading_config_json` 并尝试执行 |
| "是不是本地地址"判定（**身份/去重/防骚扰/自接单**） | `services/anti-spam.js:71,106,402`（`isSibling`/本地判定→**绕过防骚扰规则**）、`api/discovery.js:328,392`、`api/exchange.js:1086`、`api/chat.js:291,293,431`、`api/events.js:106-129`、`trade-protocol-filter.js`（`localAddrs`，autoTaker 跳过"自己的单"） | 把冷存地址当"自己人"：改变反骚扰、握手方向标注、自接单跳过等协议行为 |
| 遍历"候选 relay"做**自动钱路** | `services/bettor-refund-claim-auto.mjs:68`（`address IS NOT NULL` 候选，退款认领）、`api/pool.js:488` | 对无钥地址尝试认领/签名 → 必失败，且噪声/误报 |
| 入站消息路由 | `api/ingest.js:217`（本地 relay 地址集） | 冷存地址被当"本地 relay 收件人" |
| 取"第一个/全部 relay"当**身份或付款人** | `services/exchange-machine.js:819-820`（`SELECT id FROM relay_nodes ORDER BY created_at` 作为候选执行 agent 列表）、`services/market-seeder.js:407`（`ORDER BY name LIMIT 1` 取做市身份）、`services/scanner.js:89`（`address` 长度 ≥60 的第一个）、`services/system-repair.js:152` | 无钥行有可能被选为**执行/做市/扫描身份**——顺序依赖（名字/创建时间），不是设计保证 |
| 本地 agent 判定（exchange / 协议过滤） | `services/exchange-machine.js:615,705,936,989,1205`、`services/trade-protocol-filter.js:1972,2023,2198,2219,3108`、`services/mind-manager.js:31,297,441,694,897` | 冷存地址被认作本地 agent：改变收款/交割/接单路由与"自己人"判定 |
| Mind 调度 | `services/mind-manager.js:784`（`address IS NOT NULL`，**无 adapter 联结**）；`:122`、`:1176` 联结 `adapter_nodes`（无 adapter 的无钥行会被挡） | 为无钥行排 proactive / evolution 周期 |
| Mind / adapter 关联（其余） | `agent-health.js:209`、`api/defi.js`（`JOIN adapter_nodes`）、`services/social-budget.js:151` | 可能为无钥行建健康监控/预算 |
- 这些**大多今天被别的守卫间接挡住**，但"被挡住"依赖每处各自的前置条件；**新增任何一个 `relay_nodes` 消费者，默认就会把无钥行卷进来**（默认允许）。
- 结论：无钥行留在 `relay_nodes` = 把"不进有钥集合"押在**约 50 处、且会继续增长**的过滤上。

### 3.3 写入形式二选一（Bettor ③）

| | A. `relay_nodes` 插无钥行 | **B. 新表 `watch_accounts`（选）** |
|---|---|---|
| 资产页/`/wallets` 零改动直读 | ✅（但读的是会静默返回 0 的 `getKasBalance`） | ❌ 需新读口（§2.3；且新读口才能做诚实读数） |
| 不进有钥集合 | 靠 §3.1/3.2 逐处过滤，**默认允许** | **默认拒绝**：没有任何既有查询会读到它（NWT 复核成立） |
| 影响面 | 约 50 处需审/改；autoTaker/anti-spam/交易遍历语义被污染 | 新增：1 张表 + 1 个读模块 + 2 个 GET + 页面一块 + 登记脚本；既有 63 个文件**零改动** |
| 与"热钱包上限（每 relay 800 / 总 1000）"的关系 | 冷存金额远超热钱包口径，放进 `relay_nodes` 会撞任何"对 relay 余额求和/设顶"的逻辑。**该上限不在代码里**——是 9/14 迁移期的**政策闸**（账本 1306/1320 的执行页与冷名单），本设计只读、不触及；页内写明"政策层非代码层" | 天然在热钱包口径之外 |
| 有钥升级路径 | "改成可花"= 改一行 | "改成可花"= 另做**导入**（正规 relay 创建流程 + Owner 钱路批准）——**恰是应有的摩擦**（D-028 §4 已把它列为 Owner 另批） |
| schema 表达"不持钥" | 否（列在，只是 NULL） | **是**（无钥列 + `CHECK(custody='cold_no_key')`） |
- **取 B**。代价 = 多一个读口；换来"新增消费者不会误伤"这条结构性保证。

## 4. 失败与边界（必须写进实现的行为）
1. **绝不把"读不到/未同步/对照失败"显示成 0**（§2.2 表）；总额标注"不完整"。
2. **外发面**：主网 `KASPA_RPC_LOCAL_ONLY=1` ⇒ 新读取模块**零 REST 外发**（有测试用 fetch 桩钉住，A11）；既有热钱包 `getKasBalance` 的 REST 回落（`relay.js:719`）**不受该模式约束、是既有行为，本设计不动**，记后续票（"热钱包读取遵守 LOCAL_ONLY 并带状态"）。
3. 页面所有金额以链上为准；`ASSET-INVENTORY.md` 里的金额是快照，页面不引用它。
4. 只读账户的名称保留原名（不加前缀）；区分靠徽标与独立区块，不靠改名。
5. **备份**：`api/backup.js` **不含**新表——它备份的是社交/mind 配置（identities、relation_states 分类信任字段、`relay_nodes` 的 mind 字段），且 `POST /api/backup/import` 是写路径，加进去 = 给冷存表开 HTTP 写口，与 §2.1/§2.3 矛盾。整库备份（拷 `console.mainnet.db`）本来就含此表。（若将来要导出，只能"只导出、导入侧显式跳过"并有测试钉住。）
6. **热/冷不对称（既有缺陷，不在本设计范围）**：热钱包侧走会静默返回 0 的 `getKasBalance`，追块期页面会出现"热钱包 = 0（静默）+ 冷存 = —（诚实）"。记后续票：让热钱包读取也带状态。

## 5. 上线与回滚
- 随下一次本来就要做的 console 重启上线（D-028 §3）：迁移建空表（无害）→ 合入代码 → 重启 → KANet-UI 用登记脚本（`--from-file`，`--apply`；地址来自私有清单，执行后删文件）登记 2 行 → 页面核对。
- 回滚：`DELETE FROM watch_accounts`（或不登记）⇒ 页面不出冷存区块，其余一切不变；代码路径在表空时零效果。表本身可留。
- **不动**：源库 `C:\KANet\…`、任何密钥、`relay_nodes`、驱动开关、D-026/D-027 相关一切、热钱包读取路径、per-relay/total 上限（政策层）。

## 6. ⑤ 验收判据（每条配可执行检查；变异对照要能抓红）

| # | 验收 | 检查 |
|---|---|---|
| A1 | 资产页显示 **20 个账户**（18 热 + 2 冷） | `GET /api/portfolio/unified`：`agents.length===18`（实测当日热数）且 `watchAccounts.length===2`；页面截图/DOM 计数 |
| A2 | 总额 = 热 + 冷，**不重复计** | `totals.kasAll === totals.kas + totals.watchKas`；`grandTotalKasWithWatch === grandTotalKas + watchKas`；登记脚本拒绝已存在于 `relay_nodes`/`agent_wallets`/`watch_accounts` 的地址——**含大小写/前缀变体**（夹具：先插同址热行的大写变体 ⇒ 脚本退出非 0） |
| A3 | relay 子进程数仍 **18** | 夹具：3 有钥 + 2 冷存行，`startAll()` 的 spawn 桩恰被调 3 次；**活体**：重启后进程表 relay 子进程数 = 18（执行人现场数，写进回执） |
| A4 | autoSplit / broadcaster / 守卫 / startAll 对冷存**零调用** | 夹具 + 桩：`splitUtxos`、`sendCommand`、broadcaster 维护、守卫清单读取，冷存行的 id/address 从不出现在任何调用参数里；**静态**：`watch_accounts` 标识符只允许出现在白名单文件（迁移、`watch-balance.js`、`api/watch-accounts.js`、`portfolio.js`、登记脚本、测试），其余任何文件出现 ⇒ 红——**用 F2-1 共享扫描器**（NWT 指路 `kasia-console/test-fixtures/source-scan/`；**30b11216 检出里还没有它，实现批次依赖其合入**；不写第三套），**扫描根含 `kasia-console/scripts`** |
| A5 | 后端**无写/发路径** | 路由扫描：`/api/watch-accounts*` 只有 GET；对 watch id 调 `/api/relay/:id/transfer`、`/wallets/*/send`、`/split-utxos` ⇒ 404；`api/backup.js` 不含 `watch_accounts` |
| A6 | 页面**无发送入口** | 静态：冷存区块模板片段不含 `sendModal`/`/transfer`/`/send`/`split`/`privkey`；含徽标文本"冷存 · 只读 · 不可花" |
| A7 | 读数诚实 | 桩：① `isSynced=false` ⇒ `unavailable`；② **同步 #1 真 / #2 假**（读取期间掉队）⇒ `unavailable`；③ **阳性对照项返回 0 或缺项（其余条目形状正常，含冷存 0n）⇒ 整批 `unavailable`、冷存不渲染 0**；④ 缺某冷存条目 ⇒ 该账户 `unavailable`；⑤ `getWorkingRpc().isLocal===false` ⇒ `unavailable`；⑥ 页面对 `unavailable` 渲染"—" |
| A8 | schema 不持钥 | 单测：`PRAGMA table_info(watch_accounts)` 无 mnemonic/privkey/hint 类列；`INSERT … custody='hot'` 被 CHECK 拒 |
| A9 | 数对 | 上线后人工对一次：页面两个冷存余额 vs 独立来源同地址（Bettor 用本机节点 CLI/只读查询；回执写差值，不写金额入库文件——金额只进私有清单/频道口头） |
| A10 | 登记脚本卫生 | 脚本不接受地址/名字命令行参数（传了 ⇒ 退出非 0）；`--from-file`/stdin 读；回执只含条数与规范化前缀/末 6 位（测试断言回执不含完整地址、不含名字）；命中"本地地址语义列"时列出表.列与命中数、退出码 0 且不写入被拒 |
| A11 | **LOCAL_ONLY 无外发** | `KASPA_RPC_LOCAL_ONLY=1` 且本机不可用：读取模块对 `fetch`/`https` 的调用次数 = 0（桩计数）；`WATCH_PUBLIC_FALLBACK` 取 `'true'`/`'1 '`/`'01'` 都不启用（只认字面 `'1'`）；打开时冷存地址与热地址**不同批** |
| A12 | 按地址匹配 | 桩：批结果**乱序返回**、或缺一个冷存条目 ⇒ 匹配仍正确/该条 `unavailable`，不串号 |
| A13 | 迁移 + 文档 | 迁移号接 `migrate.js` 末尾；`docs/DATABASE.md` 已含 `watch_accounts` 一节（lint/评审核对） |
| **变异（每条须被抓红）** | ① `startAll` 查询改成并入 `watch_accounts`；② `autoSplitAll` 遍历并入；③ `/api/watch-accounts` 加一个 POST；④ 不可用时把 `null` 改成 `0`；⑤ 冷存区块加一个发送按钮；⑥ 登记脚本去掉"已存在于 relay_nodes"检查 / 去掉规范化；⑦ `totals.kasAll` 重复累加冷存；⑧ 去掉 LOCAL_ONLY 判断（REST 被调用）；⑨ 去掉阳性对照；⑩ `isSynced` 只读一次或改用缓存；⑪ 按下标而非地址匹配；⑫ `backup.js` 并入新表 | 每个变异对应上表至少一条测试转红 |

## 7. 未证 / 我不知道的
- §3.2 全部行**只按查询文本归类**，没读函数体（"约 50 处"是文本命中数，不是逐个确认的缺陷数；其中不少今天被别的前置条件挡住）；这对结论（选 B）方向无影响；NWT 复审也认为选 B 后不需要逐个读体。
- **未同步节点的返回形状我没有实测**（NWT 也没有：节点现在同步、不该让它掉队）；"IBD 期返回合法空值、`isSynced` 会在 nearly-synced 窗内提前翻 true"沿用既有记录。所以本设计的诚实度**靠状态判据 + 阳性对照，不靠对某个未同步形状的假设**——这正是加阳性对照的原因。
- 每 relay 800 / 总 1000 上限：Bettor 指认为**政策闸**（账本 1306/1320），不在代码里；我在源码中按数字 + 关键词 grep 不到，与这个说法一致，但我没有去读账本原条文，本稿只转述。
- F2-1 共享扫描器的确切接口与合入状态：**未在 `30b11216` 检出里核到**（`kasia-console/test-fixtures/` 下没有 `source-scan/`）；A4 静态检查须等它合入后实现。
- 阳性对照选哪个热地址、热地址全为 0 时的退化（整批 `unavailable`，偏保守）是实现层细节，实现批次需再定；主网热侧当前合计非 0。
- 未在真实主网 console 上跑任何东西。

## 8. 线框（结构示意，非最终文案；用户面须 Owner 批）
```
资产总计 = 热钱包 <X> KAS + 冷存 <Y> KAS        （冷存有 N 个无法读取时：总计不完整）
──────────────────────────────────────────────
[热钱包账户卡片 × 18]                    （现有，不变）
──────────────────────────────────────────────
冷存（只读）
┌────────────────────────────────────────────┐
│ <名称>            [冷存 · 只读 · 不可花]      │
│ <地址>  [复制]                               │
│ 余额  <数字> KAS   或   —（无法读取）          │
│ 来源：本机节点 · 读于 hh:mm                    │
└────────────────────────────────────────────┘（× 2；无任何操作按钮）
```

## 9. 工作量与顺序（供 Bettor 排期）
迁移 + `DATABASE.md` + 读模块 + 2 个 GET + portfolio 汇总 + 页面一块 + 登记脚本 + 测试与变异：一个批次；先 NWT 复审本设计 → Owner 批用户面 → 实现（依赖 F2-1 扫描器合入）→ NWT 审 diff → 合入 → 随重启上线 → 登记 2 行 → A1–A13 现场核。
