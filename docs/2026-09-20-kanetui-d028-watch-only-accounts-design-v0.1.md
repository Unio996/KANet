# D-028 只读账户可见（冷存账号进主网 console 资产页）设计稿 v0.1

> **Status**: CURRENT（设计稿·只写不落码·待 Bettor 转 NWT 审；用户面版面/文案须 Owner 批，见 §8）
> 作者：KANet-UI ｜ 日期：2026-09-20 ｜ 依据：`docs/DECISIONS.md` D-028（Owner 铁令：所有资产必须在主网 console 全部可见）｜ 清单：`docs-private/ASSET-INVENTORY.md`（gitignored）
> **D-021**：本文不含任何金额、地址、"账号名↔地址"对应；冷存两账号一律称"冷存账号 1/2"，具体见私有清单。密钥值我没有读、也不需要（源库 `C:\KANet\…\console.db` 我未打开）。

## 0. 一页结论

| 问 | 结论 |
|---|---|
| ① 直读链上余额的现成路径有吗 | **有**。`api/relay.js:704-726 getKasBalance` 已经是"地址 → 共享 RPC `getBalancesByAddresses`（本机节点）→ 失败退公网 `api.kaspa.org`"，**不需要 relay 子进程**。只缺两件事：入口（现在只认 `relay_nodes.id`）与**同步/失败态的诚实显示**（§4） |
| ② 无钥账户如何保证不进有钥集合 | **不靠"到处加过滤"，靠"根本不进 `relay_nodes`"**：新表 `watch_accounts`，**没有任何密钥列**。逐个消费者审计见 §3——`relay_nodes` 方案要在约 50 处"把它当本地 agent"的查询上逐个防，任何新增消费者默认踩坑；独立表 = 默认不可见（默认拒绝） |
| ③ 写入形式 | **新表 `watch_accounts`**（不选 `relay_nodes` 插无钥行），理由 §3.3 |
| ④ 标注 / 不可花 | 页面独立"冷存（只读）"区块，徽标"冷存 · 只读 · 不可花"，区块内**没有任何发送入口**；后端 `/api/watch-accounts*` **只有 GET** |
| ⑤ 验收 | §6：资产页 20 账户（18 热 + 2 冷）、总额 = 热 + 冷且不重复计、relay 子进程仍 18、autoSplit / broadcaster / 守卫 / startAll 对冷存零调用（变异对照） |

## 1. 现状（只读核，工作树 `origin/bshard-m3-deploy` `30b11216`）

- 资产页 = `/portfolio`（`ui/partials/sidebar.eta:24-27`「资产」）→ 前端调 `/api/portfolio/unified`（`ui/portfolio.eta:1104-1105`）→ `api/portfolio.js:34-35` 只从 `relay_nodes WHERE address IS NOT NULL` 取账户，逐个 `fetch /api/relay/:id/wallets`（`portfolio.js:_aggregateForRelay`）。所以**不在 `relay_nodes` 的地址，资产页天然看不到**——这就是冷存账号"消失"的机制。
- `/api/relay/:id/wallets`（`api/relay.js:729-803`）：`getKasBalance(relayId)` + `agent_wallets` 多链余额。**按 relay id 取地址**，与"有没有钥"无关（`hasMnemonic/hasPrivateKey` 只是回显）。
- 冷存两账号 = 9/14 迁移被冷名单拦在导入之外：主网 `relay_nodes` 无此二行，`agent_wallets` 无对应行（清单 §一）。清单称这两个账号只持 KAS；**本设计以 KAS 为范围**，表里留 `chain` 列给将来扩展，但 v0.1 不做多链余额。

## 2. 设计

### 2.1 数据：新表 `watch_accounts`（迁移号取合入时 `migrate.js` 末尾之后；今天末尾是 v210）

```sql
CREATE TABLE IF NOT EXISTS watch_accounts (
  id          TEXT PRIMARY KEY,                       -- uuid
  name        TEXT NOT NULL,                          -- 保留原名（Bettor 要求）
  chain       TEXT NOT NULL DEFAULT 'kaspa',
  network     TEXT NOT NULL DEFAULT 'mainnet',
  address     TEXT NOT NULL,
  custody     TEXT NOT NULL DEFAULT 'cold_no_key' CHECK (custody = 'cold_no_key'),
  note        TEXT,                                   -- 一句话来历，不含金额
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (chain, network, address)
);
```
- **没有 mnemonic / privkey / hint 任何列**——"不持钥"由 schema 承担，不是约定。`custody` 用 CHECK 钉成唯一取值，将来有人想复用此表存有钥账户会被 schema 拒绝（要改就必须改迁移，会红）。
- 只读的写入路径：**一次性登记脚本** `scripts/watch-account-register.mjs`（默认 dry-run，`--apply` 才写）——不开 HTTP 写接口（少一个可被误调的面）。脚本硬检查：地址通过 `kaspa-wasm` `Address.validate` 且带 `kaspa:` 前缀（network=mainnet）；**不得已存在于 `relay_nodes.address` / `agent_wallets.address` / `watch_accounts`**（防"热 + 冷"重复计入总额）。地址值由执行人（KANet-UI）在执行时从 `docs-private/ASSET-INVENTORY.md` 读入命令行，**不入库、不入 commit**。

### 2.2 读：新模块 `services/watch-balance.js`（只读，无副作用）

- 入口 `readWatchBalances(rows)`：一次 `getBalancesByAddresses`（批量）取余额，走既有 `getWorkingRpc()` → `getSharedRpc()`（共享单例，**不 per-call new RpcClient**，见 wasm 泄漏记录）。
- **诚实的读数状态**（这是本设计里最不能省的一块）——每个账户返回 `{ id, name, address, status, balanceKas, source, readAt }`：
  | status | 含义 | 页面显示 |
  |---|---|---|
  | `ok` | 本机节点 `isSynced===true` 且读到 | 数字 + "来源：本机节点 · 读于 hh:mm" |
  | `ok_public` | 本机节点不可用/未同步，公网 API 读到 | 数字 + "来源：公网 API（本机节点未同步）" |
  | `node_not_synced` / `unavailable` | 两条都读不到 | **"—（无法读取）"，绝不显示 0** |
  - 依据：IBD 期链读会返回**合法的空值**（`getBalancesByAddresses` 不报错但 0/缺项）——把它渲染成 0 等于"冷存账号余额清零"的假警报，正是 D-028 想根除的那类"看不见/看错"。同步态用既有 `isNodeSyncedCached`（`services/preprune-capture-worker.mjs:169`，`ibd-tick-gate` 同款）。
  - 缺省不做"每次双源交叉核对"（成本与地址外发面）；验收时人工用公网 API 对一次（§6 A9）。
- 短 TTL 内存缓存（30 s，进程内，不落库）防页面刷新打爆 RPC；不做落库缓存（落库的旧余额会变成"看起来像真的"的陈数）。

### 2.3 API（只读）

- `GET /api/watch-accounts` → `{ ok, accounts: [{ id, name, address, custody:'cold_no_key', status, balanceKas, source, readAt }], asOf }`。
- `GET /api/watch-accounts/:id` → 单个。
- **没有** POST/PUT/PATCH/DELETE，没有任何 `send/transfer/split/privkey` 路径；watch id 传给 `/api/relay/:id/*` 一律 404（因为不在 `relay_nodes`）。
- `GET /api/portfolio/unified`：在现有 `agents`（热，语义不变）之外**新增**：`watchAccounts`（同上数组）、`totals.watchKas`（只累加 `ok`/`ok_public` 项）、`totals.kasAll = totals.kas + totals.watchKas`、`totals.watchUnreadable`（读不到的冷存数）。**不改** `totals.kas` 的既有含义（仅热钱包），避免下游对账被悄悄改口径。
- **`/api/relay/:id/wallets` 不改**：它按 relay id 服务、并被发送弹窗等有钥流程调用；把无钥行塞进去会污染这条路径的语义（Bettor 提的"对无钥账户直读"由上面两个新读口承担）。

### 2.4 页面（`ui/portfolio.eta`）

- 页头总额显示**分解**："总计 = 热钱包 X + 冷存 Y"，读不到的冷存以"（含 N 个冷存账户无法读取，总计不完整）"标出，不静默漏算。
- 在现有账户卡片之后新增独立区块「冷存（只读）」：每个冷存账户一张卡：名称、地址（可复制）、余额/状态、徽标 **"冷存 · 只读 · 不可花"**、来源与读取时间。**该区块不含**发送 / 转账 / 拆分 / 导出私钥等任何按钮或 `sendModal` 引用。
- 线框见 §8；**版面与文案属用户面，须 Owner 批**（铁律 0），本稿只给结构。

## 3. ② 逐消费者审计：为什么不进 `relay_nodes`

方法：`grep` 全部非测试、非迁移的 `relay_nodes` 查询（**271 行 / 63 个文件**，全部过目）**按查询文本**分类；**未逐个读函数体**（下表标"文本判定"）。

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
| 资产页/`/wallets` 零改动直读 | ✅（`getKasBalance` 直接可用） | ❌ 需新读口（§2.3，代价小：复用同一底层调用） |
| 不进有钥集合 | 靠 §3.1/3.2 逐处过滤，**默认允许** | **默认拒绝**：没有任何既有查询会读到它 |
| 影响面 | 约 50 处需审/改；autoTaker/anti-spam/交易遍历语义被污染 | 新增：1 张表 + 1 个读模块 + 2 个 GET + 页面一块；既有 63 个文件**零改动** |
| 与"热钱包上限（每 relay 800 / 总 1000）"的关系 | 冷存金额远超热钱包口径，放进 `relay_nodes` 会撞任何"对 relay 余额求和/设顶"的现有或将来逻辑（**代码里未找到该顶的强制点**，应是政策/账本层约束——未证，待 Bettor 指认出处） | 天然在上限口径之外（不是热钱包） |
| 有钥升级路径 | "改成可花"= 改一行 | "改成可花"= 另做**导入**（正规 relay 创建流程 + Owner 钱路批准）——**恰是应有的摩擦**（D-028 §4 已把它列为 Owner 另批） |
| schema 表达"不持钥" | 否（列在，只是 NULL） | **是**（无钥列 + `CHECK(custody='cold_no_key')`） |
- **取 B**。代价 = 多一个读口；换来"新增消费者不会误伤"这条结构性保证。

## 4. 失败与边界（必须写进实现的行为）
1. **绝不把"读不到/未同步"显示成 0**（§2.2 表）；总额标注"不完整"。
2. 公网 API 回落会把冷存地址发给第三方（既有热钱包读取本来就这样，`relay.js:719`）；**可接受但须知**；如 Owner 不愿，可加 env 关闭回落（此时未同步 ⇒ 显示"无法读取"）。
3. 页面所有金额以链上为准；`ASSET-INVENTORY.md` 里的金额是快照，页面不引用它。
4. 只读账户的名称保留原名（不加前缀）；区分靠徽标与独立区块，不靠改名。
5. 备份：`console.mainnet.db` 整库备份自然含此表；`api/backup.js`（按表导出 `relay_nodes` 等）是否要加 `watch_accounts`——**待定，须核该导出的用途**（本稿未核）。

## 5. 上线与回滚
- 随下一次本来就要做的 console 重启上线（D-028 §3）：迁移建空表（无害）→ 合入代码 → 重启 → KANet-UI 用登记脚本（`--apply`，地址来自私有清单）登记 2 行 → 页面核对。
- 回滚：`DELETE FROM watch_accounts`（或不登记）⇒ 页面不出冷存区块，其余一切不变；代码路径在表空时零效果。表本身可留。
- **不动**：源库 `C:\KANet\…`、任何密钥、`relay_nodes`、驱动开关、D-026/D-027 相关一切、per-relay/total 上限。

## 6. ⑤ 验收判据（每条配可执行检查；变异对照要能抓红）

| # | 验收 | 检查 |
|---|---|---|
| A1 | 资产页显示 **20 个账户**（18 热 + 2 冷） | `GET /api/portfolio/unified`：`agents.length===18`（实测当日热数）且 `watchAccounts.length===2`；页面截图/DOM 计数 |
| A2 | 总额 = 热 + 冷，**不重复计** | `totals.kasAll === totals.kas + totals.watchKas`；登记脚本拒绝已存在于 `relay_nodes`/`agent_wallets` 的地址（夹具：先插同址热行 ⇒ 脚本退出非 0） |
| A3 | relay 子进程数仍 **18** | 夹具：3 有钥 + 2 冷存行，`startAll()` 的 spawn 桩恰被调 3 次；**活体**：重启后进程表 relay 子进程数 = 18（执行人现场数，写进回执） |
| A4 | autoSplit / broadcaster / 守卫 / startAll 对冷存**零调用** | 夹具 + 桩：`splitUtxos`、`sendCommand`、broadcaster 维护、守卫清单读取，冷存行的 id/address 从不出现在任何调用参数里；**静态**：`watch_accounts` 标识符只允许出现在白名单文件（迁移、`watch-balance.js`、`api/watch-accounts.js`、`portfolio.js`、登记脚本、测试），其余任何文件出现 ⇒ 红 |
| A5 | 后端**无写/发路径** | 路由扫描：`/api/watch-accounts*` 只有 GET；对 watch id 调 `/api/relay/:id/transfer`、`/wallets/*/send`、`/split-utxos` ⇒ 404 |
| A6 | 页面**无发送入口** | 静态：冷存区块模板片段不含 `sendModal`/`/transfer`/`/send`/`split`/`privkey`；含徽标文本"冷存 · 只读 · 不可花" |
| A7 | 读数诚实 | 桩：本机节点 `isSynced=false` 且公网失败 ⇒ 响应 `status='node_not_synced'|'unavailable'`、`balanceKas===null`，**页面不渲染 0**；`getBalancesByAddresses` 返回空项 + 未同步 ⇒ 同上 |
| A8 | schema 不持钥 | 单测：`PRAGMA table_info(watch_accounts)` 无 mnemonic/privkey/hint 类列；`INSERT … custody='hot'` 被 CHECK 拒 |
| A9 | 数对 | 上线后人工对一次：页面两个冷存余额 vs 公网 API 同地址（回执写差值，不写金额入库文件——金额只进私有清单/频道口头） |
| **变异（每条须被抓红）** | ① `startAll` 查询改成并入 `watch_accounts`；② `autoSplitAll` 遍历并入；③ `/api/watch-accounts` 加一个 POST；④ 未同步时把 `null` 改成 `0`；⑤ 冷存区块加一个发送按钮；⑥ 登记脚本去掉"已存在于 relay_nodes"检查；⑦ `totals.kasAll` 重复累加冷存 | 每个变异对应上表至少一条测试转红 |

## 7. 未证 / 我不知道的
- §3.2 全部行**只按查询文本归类**，没读函数体（"约 50 处"是文本命中数，不是逐个确认的缺陷数；其中不少今天被别的前置条件挡住）；这对结论（选 B）方向无影响，但若 NWT 想核"选 A 会不会真出事"，需要逐个读体。
- 每 relay 800 / 总 1000 上限的**强制点在哪**：我在 `kasia-console/src`、`kasia-relay/src` 里按数字+关键词 grep 没找到代码强制；可能在政策/账本层，或我的检索词漏了——请 Bettor 指认出处。
- 公网 API 回落是否保留（§4-2）是 Owner/Bettor 的取舍。
- `api/backup.js` 是否需含新表（§4-5）。
- 未在真实主网 console 上跑任何东西；`getBalancesByAddresses` 对"未同步但 RPC 通"时的返回形状，取自既有记忆（IBD 期返回合法空值），本稿没有重新实测。

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
迁移 + 读模块 + 2 个 GET + portfolio 汇总 + 页面一块 + 登记脚本 + 测试与变异：一个批次；先 NWT 审本设计 → Owner 批用户面 → 实现 → NWT 审 diff → 合入 → 随重启上线 → 登记 2 行 → A1–A9 现场核。
