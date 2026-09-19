# 主网电报机器人接线 runbook v0.1（D-023 · 只写不执行）

> **Status**: CURRENT
>
> 起草 KANet-UI · 2026-09-19 · 依据 `docs/DECISIONS.md` D-023、账本 1499 / 1500 · **草稿，待 Bettor 审，未执行**。
>
> **执行门（页首必读，不得把"页写好了"读成"可以执行了"）**：
> ① 本页 → Bettor 审 → 报 Owner 开闸；② **§2 起任何一步的执行**（写主网 env、建 broker 身份、充值、清 state、启 bot）都须 Owner 开闸后由 Bettor 指定的执行人做；③ **§0 四个阻断项在其变更请求落地并复验前，§3 之后一步都不得执行**；④ 自动下注与 seeder 保持关闭，打开需 Owner 另批；⑤ 结算后半程（D-022）未完成前，不接真实下注流。
>
> **写作依 D-021**：本页不含任何密钥值、真实账户余额、地址与持有人的对应。凡涉及的值一律写"值来源"，不写值本身。

## 0. 前置发现：四个阻断项（起草时只读核出，决定本 runbook 能不能照 D-023 字面执行）

D-023 把"复用身份"理解为"配几个 env 键 + 起 bot"。只读核代码后，**bot 启动链与用户命令上有 TN12 硬编码**，字面执行会启动一个指向已下线 `:3200` 的进程，或更糟——把主网 console 上的用户操作接到错的网络上。下面每条都给出**自查命令**，任何人一条命令就能推翻或确认，不必信本页。B-1 / B-2 是安全/正确性阻断，B-4 是功能阻断（bot 能起但用户绑不了主网地址）。

### B-1 🔴 bot 启动器 `_launch_tg_bot.mjs` 整体写死 TN12

`tg-bot-manager.js` 起 bot 的方式是 `fork('_launch_tg_bot.mjs')`，并把主网 console 的环境（含 token）注入子进程；但启动器**随后逐项覆盖**：

| 启动器行为 | 后果（主网上启动时） |
|---|---|
| 读 `../kanet.env`（TN12 那份密钥文件）取 token、`CONSOLE_ENCRYPTION_KEY` | 把 TN12 的加密密钥载入主网 bot 进程；用它去解主网库的 `ingest_secret`（不同密钥域）⇒ 预期解不出，`missingConfig` 让 bot 退出。若 TN12 目录已按 D-017 §3 清理，则 `readFileSync` 直接抛错 |
| 写死 `CONSOLE_URL=http://127.0.0.1:3200` | 指向已下线的 TN12 console，全部 API 调用失败 |
| 写死 `KASPA_NETWORK=testnet-12` | bot 的 `CONFIG.network` 为测试网，`/swap` 等文案按测试网渲染 |
| 写死 `BROKER_RELAY_ID` 为 TN12 时代 broker-1 的 UUID | 主网库无此 relay（DB 配置优先，但 env fallback 是错的） |

自查：`Select-String -Path D:\kanet-tn12\kasia-console\_launch_tg_bot.mjs -Pattern 'kanet\.env|3200|testnet-12|BROKER_RELAY_ID'` —— **现状有命中；变更请求落地后应为 0 命中**。同族 `_launch_owner_bot.mjs` 有同样写死（见 §3 OWNER 项）。

**变更请求 CR-1（提请 Bettor 批；本页不执行）**：
- 文件：`kasia-console/_launch_tg_bot.mjs`（bot 启动器，非 `tg-bot/*.mjs`，不属 Owner 用户面清单，路径归 Bettor 批）。
- 逻辑：删除读 `../kanet.env` 与对 `CONSOLE_ENCRYPTION_KEY` / `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` / `BROKER_RELAY_ID` / `CONSOLE_URL` / `KASPA_NETWORK` 的覆盖；改为**继承父进程环境**（fork 时已由 `tg-bot-manager.js:74` 注入 `{...process.env, TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME}`，且 console 启动时 `index.js:161` 已把 `INGEST_SECRET` 写进 `process.env`，无需再解库）。`CONSOLE_URL` 由 `http://127.0.0.1:${PORT}` 推导（console env 里已有 `PORT`）。
- **fail-closed 断言**（防止再次静默回落到默认值）：启动器开头断言 `KASPA_NETWORK === 'mainnet'`、`PORT` 已设、`INGEST_SECRET` 非空，任一不满足 `process.exit(1)` 并打印**缺哪个键名**（不打值）。`tg-bot/config.mjs:8/19` 的 `:3200` 与 `testnet-12` 默认值本身**不动**（属 `tg-bot/*.mjs`，按铁律 0 须 Owner 批；有上面的断言兜底即不会静默落到默认值）。
- 影响面：TN12 已按 D-017 退役，`kanet-start.sh` 的 TN12 bot 路径随之不可用，请 Bettor 确认接受（OQ-4）。
- 验证：见 §7 Stage A（隔离实例演练）。

### B-2 🔴 托管钱包路由写死 `testnet-12`

`kasia-console/src/api/tg-wallet.js:27` `const NETWORK = 'testnet-12'`；`/api/tg-wallet/create` 用它派生地址、`balanceKasForAddress` 用它连 RPC。bot 的 `/wallet` `/balance` `/receive` 都走这里。**在主网 console 上**：用户敲 `/wallet` 会得到一个 `kaspatest:` 地址并被告知助记词，行落进主网库 `tg_custodial_wallets`（`network=testnet-12`）——不丢钱（该地址在主网上无意义），但是**错网络的托管钱包 + 助记词展示**，且余额查询用测试网 id 打主网节点。

自查：`Select-String -Path D:\kanet-tn12\kasia-console\src\api\tg-wallet.js -Pattern "NETWORK = 'testnet-12'"`；主网库现状 `tg_custodial_wallets` 行数（只读计数）= 0，说明尚未有人走过这条路。

`/send`（转账）现状已 fail-closed：`CUSTODIAL_RELAY_ID` 未设 ⇒ 503（`tg-wallet.js:160-161`），本页保持它未设。

**变更请求 CR-2（提请 Bettor 裁定路由与批准层级；本页不执行）**：文件 `kasia-console/src/api/tg-wallet.js`（托管钱包 = 钱路，按铁律 0 可能须 Owner 批）。最小方案：`/create` 与 `/:tg_user_id/send` 入口在 `process.env.KASPA_NETWORK !== NETWORK` 时返回 503 + 明确原因（fail-closed），**不**把 `NETWORK` 改成 env 驱动（那是"主网托管钱包"新功能，涉及助记词托管策略，另议）。**CR-2 落地前不启 bot**，因为 bot 的 `/wallet` 无法在 bot 侧单独屏蔽（那需改 `tg-bot/bot.mjs`，属用户面，须 Owner 批）。

### B-4 🔴（功能阻断）bot 的 `/link` 只接受 `kaspatest:` 地址

`tg-bot/bot.mjs:236` `if (!/^kaspatest:[a-z0-9]+$/.test(addr)) return ctx.reply(t(lang,'link_usage'))`。**主网 `kaspa:` 地址被直接拒绝**；而 console 侧 `POST /api/link/bind` 只校验前缀 `startsWith('kaspa')`（`link.js:24`），不校验网络，所以 `kaspatest:` 地址反而能绑成功。后果：主网用户**无法绑定自己的地址**，而 `/mybets`、结算/手续费通知、`/earnings` 都依赖绑定 ⇒ bot 在主网上"能起、不能用"。

自查：`Select-String -Path D:\kanet-tn12\tg-bot\bot.mjs -Pattern 'kaspatest:'`。

**变更请求 CR-3（用户面 `tg-bot/*.mjs` ⇒ 铁律 0 须 Owner 批；本页不执行）**：改 `bot.mjs:236` 的地址正则为接受主网前缀、拒绝 `kaspatest:`；具体 spec 与文案（`link_usage` 提示）由 Bettor 定后报 Owner。console 侧 `link.js:24` 是否同步收紧为按 `KASPA_NETWORK` 校验，起草人建议一并提（防 `kaspatest:` 行入主网库），由 Bettor 裁。**CR-3 落地前 bot 启起来也无法完成任何用户绑定**——是否仍先起 bot 做"只读演示"由 Bettor 定。

### B-5 🟡 `POST /api/tg-bot/start` 会写 `tg_bot_enabled=1`，此后每次 console 重启自动拉起 bot

`settings.js:194`。含义：第一次成功启动后，bot 与 console 的生命周期绑定；**回滚必须走 `POST /api/tg-bot/stop`（它写 `tg_bot_enabled=0`）**，不能只 kill 进程（supervisor 会拉回，且 Telegram 单 poller 会 409）。已写入 §7 回滚。

## 1. 前置检查（只读，确认起点干净；任一不符即停，不进入 §2）

所有命令为只读。在 `D:\kanet-tn12` 用 PowerShell 跑（不要在 PowerShell 里调 `bash`）。

| # | 检查 | 命令（PowerShell） | 期望 |
|---|---|---|---|
| 1.1 | 生产检出分支 | `git -C D:\kanet-tn12 branch --show-current` | `bshard-m3-deploy`（**禁切分支**；演练走独立 worktree） |
| 1.2 | 主网 console 活 | `Invoke-RestMethod http://127.0.0.1:3202/api/tg-bot/status` | `running=false`、`token_configured=false`、`broker_relay_id` 为空（GET，只读，无密钥回显） |
| 1.3 | 无 bot 进程 | 命令见表下 `C1.3` | 空。**同一 token 只能有一个 poller**：复用 TN12 身份意味着 TN12 侧的 bot 必须已确认不在跑（D-017 §3 执行门），否则 Telegram 409 |
| 1.4 | TN12 console 无监听 | `Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue` | 无输出 |
| 1.5 | 主网库无 bot 配置行 | 对 `console.mainnet.db` **只读**打开，`SELECT key FROM config_entries WHERE key LIKE 'tg_bot%'`（只查键名，不查值） | 无行（起草时实测：库里仅有 `ingest_secret` 一行相关） |
| 1.6 | 主网库无托管钱包 / 无绑定 / 无 onboarding | 同上，对 `tg_custodial_wallets`、`user_notification_prefs`、`broker_onboarding` 各 `SELECT COUNT(*)` | 均 0（起草时实测均 0；§4 只清 `_state.json`，不碰库，故这三张表须本就是空的） |
| 1.7 | 无 pool 市场（bot `/bet` 读它） | `SELECT COUNT(*) FROM pool_markets` | 0（起草时实测 0；proto v0 市场在 `proto_*` 表，bot 未接线，见 §5） |
| 1.8 | 主网 env 无禁项/无 bot 键 | 见 §3.4、§8 的断言块 | 全通过 |
| 1.9 | 迁移版本（重启会带什么） | 命令见表下 `C1.9` | 起草时末块 = v209。**若执行时已 ≥ v210，则 console 重启会在主网库建 `proto_settlement_intents`——须 Bettor 知情**（走路径 X 则无重启，见 §3） |
| 1.10 | **阻断项已闭合** | §0 四条自查命令 | B-1 自查 0 命中；B-2 的 CR-2、B-4 的 CR-3 已合入并复验；否则**停** |
| 1.11 | 备份位存在且被忽略 | `Test-Path D:\kanet-tn12\docs-private`；`git -C D:\kanet-tn12 check-ignore docs-private/x` | True；命中 `.gitignore` |
| 1.12 | 无未知在飞资金动作 | 主网 console 现无客户入口（无 bot、驱动开关全 0）；核 §5 的开关表 | 全关 |

```powershell
# C1.3  只读：列出 bot 相关 node 进程（期望无输出）
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match '_launch_tg_bot|tg-bot.bot\.mjs|_launch_owner_bot' } |
  Select-Object ProcessId, CreationDate      # 时间戳一律印完整日期，不要只看 HH:mm

# C1.9  只读：迁移末块版本
Select-String -Path D:\kanet-tn12\kasia-console\src\db\migrate.js -Pattern '// ── v\d+' | Select-Object -Last 1
```

**中止条件**：1.2 出现 `running=true`（有人已启过）、1.3 有进程、1.10 未闭合 ⇒ 立即停，回报 Bettor，不重试。

## 2. broker 身份创建与充值

**背景**：bot 代表哪个 broker 由 DB 配置 `tg_bot_broker_relay_id` 决定（`config.mjs:37` 先查 DB，env `BROKER_RELAY_ID` 仅 fallback）；bot 本身 0-key / 0-custody，只用 broker 身份做**标识与市场过滤**（`GET /api/relay/:id`），不经手资金。主网库 `relay_nodes` 中**不存在** TN12 broker-1 那个 UUID（实测）。**但库里已有一行 `role=broker` 的 relay**（名称 `Trader-A`，UUID 前 8 位 `bf73cb1b`，无 adapter、有地址；只读实测）——D-023 §2 写的是"主网须新建"，该行的来历与用途本页**未核**：**是复用它、还是另建，待 Bettor 裁（OQ-3）**。复用则省 2.1–2.3，但须先核它的用途/是否承载资金；另建则走下表。不论哪种，`GET /api/config/tg-bot-broker` 的候选列表会同时列出它（`settings.js:143-145` 的筛选条件是 `role='broker'`）。

| 步骤 | 做法 | 验收读数 |
|---|---|---|
| 2.1 创建 | 主网 console UI `/relays` 新建（`POST /relays`，`network` 缺省即 `mainnet`）。助记词走 `/relays/generate-mnemonic` 生成或由 Owner 提供 | 新行出现；`GET /api/relay/<新UUID>` 返回 `network=mainnet`。**记 UUID 入账本（UUID 可写；地址不写）** |
| 2.2 热钱包准入 | 建行时若带地址，`relay.js:104` 会走 `checkHotwalletAdmission`（主网 env 已有 `RELAY_HOTWALLET_*` 三键）；冷清单命中 = 拒绝 | 未出现 `hotwallet_denied` |
| 2.3 不启进程 | **不分配 adapter、不启 relay 进程**（`assign` 会自动起进程，`relay.js:193`）。bot 不需要该 relay 进程在线 | `relay_nodes` 中该行 adapter 为空 |
| 2.4 角色 | 默认**不改角色**。是否需要 `role=broker`（`POST /api/relay/:id/role`，含 P2PK 与 oracle 互斥守门）——**待 Bettor 核（OQ-3）** | — |
| 2.5 回填 | `POST /api/config/tg-bot-broker {"broker_relay_id":"<UUID>"}`（`settings.js:149`；relay 不存在返回 404） | 返回 `ok:true`；`GET /api/config/tg-bot-broker` 回显同一 UUID |
| 2.6 充值 | **默认不充值**（bot 不经手资金，broker 身份无需余额）。**若 Bettor 裁定需要（OQ-3）**：金额与来源由 Owner 定，须经热钱包准入门；**金额不写入本页**（D-021），执行前后余额只进 `docs-private/` | — |

**助记词 / 私钥纪律**：生成后仅显示在操作者本人屏幕，**不复制进任何文件、聊天、账本、日志、commit**；备份介质与位置由 Owner 定（OQ-3）。本页与执行记录里只出现 relay UUID。

**中止条件**：`POST /relays` 后 `relay_nodes` 未新增、或 2.2 命中冷清单 ⇒ 停，回报，不重试。**回滚**：`POST /relays/:id/delete`（`relay.js:188`）删除该行；若已写 2.5，先把 `tg_bot_broker_relay_id` 清回空（`setConfig` 无删除端点，需 Bettor 指定方式）。

## 3. env 键名清单（只写键名与处置，不写值）

写入位置有两条路，**是否二选一待 Bettor 裁（OQ-1）**：

- **路径 Y（env）**：写进 `kanet.mainnet.env`（gitignored），需**重启 console** 才生效（`start-console-mainnet.ps1` 在起进程时注入）。与 D-023 字面一致。
- **路径 X（DB 配置）**：token/username 走 `POST /api/config/tg-bot-token`（`settings.js:175`，加密入库，`tg-bot-manager.js:61-62` config 优先于 env）；配合 CR-1（启动器由 `PORT` 推导 `CONSOLE_URL`）则**无需改 env 文件、无需重启 console**。省掉一次重启的全部风险面（孤儿 relay 子进程、共享 RpcClient 在重启后的行为、迁移随重启落地）。起草人倾向 X，但决定权在 Bettor。

### 3.1 键表

| 键 | 作用（谁读） | 处置 | 值来源（不写值） |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | console 起 bot 时注入（`tg-bot-manager.js:61`） | **复用现有**（D-023 §1） | Owner 的现有 token。Y：从 TN12 `kanet.env` 对应行**不回显地**追加到 `kanet.mainnet.env`（§3.2 片段）；X：读入变量后 POST，命令行不出现值 |
| `TELEGRAM_BOT_USERNAME` | 同上；bot 启动时 `getMe` 自校正（`config.mjs:98`） | 复用 | 同上；写错会被 `getMe` 真值覆盖并 LOUD warn |
| `CONSOLE_URL` | bot 进程调 console | Y 且不做 CR-1 的推导时才需要，值 = 主网 console 本机地址；X + CR-1 **不需要** | 非密钥，指向 `:3202` |
| `KASPA_NETWORK` | bot 的 `CONFIG.network` | **已有**（值 `mainnet`）；CR-1 使启动器不再覆盖它 | — |
| `INGEST_SECRET` | bot→console 鉴权（`x-ingest-secret`） | **不写 env 文件**。console 首启时已生成并加密存 DB（`index.js:147-163`），并写入自身 `process.env`，fork 的 bot 继承 | 自动。实测 `logs/mainnet/*.log` 中"INGEST_SECRET generated"命中数 0（自查：`Select-String -Path D:\kanet-tn12\logs\mainnet\*.log -Pattern 'INGEST_SECRET generated' -List`）。是否轮换属 Bettor（OQ-5） |
| `BROKER_RELAY_ID` | env fallback | **不写**（DB 配置优先；写了反而在 DB 空时静默落到陈值） | — |
| `ADMIN_SECRET*` 全系列 | 各 tier 端点 | **一律新生成、禁沿用 TN12 值**（账本 1500）。**默认不新增**：本次 bot 接线无一处用它们（bot 只用 `x-ingest-secret`）；未设 ⇒ 对应端点 503 disabled（`admin-secret-tier.mjs:31-33`，fail-closed），主网默认最小面。`ADMIN_SECRET_FUNDS` 已是新生成（1500）。今后某个 tier 真要用时，按 §3.3 生成并把**键名**追加到本表 | 新生成 |
| `OWNER_BOT_TOKEN` / `OWNER_CHAT_ID` | **owner-bot（独立进程，非 broker bot）** | ⚠ **与账本 1500 口径冲突，见 §3.5，待 Bettor 裁（OQ-2）。裁定前不写** | Owner；`OWNER_CHAT_ID` 是个人 ID，值进 `docs-private/` |
| `PILOT_WALLET_ADDRESSES` | 旧 `/send` 路径的隔离 allowlist（`tg-wallet.js:183`） | **保持未设**；主网地址产生后回填，值进 `docs-private/`。此前 `/send` 已因 `CUSTODIAL_RELAY_ID` 未设而 503，不依赖它 | 主网地址产生后 |
| `CUSTODIAL_RELAY_ID` / `FAUCET_RELAY_ID` | `/send` 出口 / `/faucet` 出口 | **保持未设**：`/send`→503、`/faucet`→"pending config"（`chat.js:659-661`）。这是**有意的关** | — |
| `KANET_TESTNET_NO_LIMITS` | 绕过最小额/软顶守卫（`pool.js:686` 等） | **禁止出现**，见 §8 | — |
| `TG_POLL_MS` `TG_SETTLE_POLL_MS` `TG_PENDING_BET_POLL_MS` `TG_BROKER_REFRESH_MS` `TG_TEST_BOT_USERS` | bot 轮询节奏 / 测试用户排除 | **不写**，用代码默认（`TG_TEST_BOT_USERS` 默认含两个合成 id，无影响） | — |

### 3.2 追加 env 行（路径 Y 用；**不回显值**；执行时才跑）

```powershell
# 从 TN12 kanet.env 取一行追加到主网 env，命令输出只有 True/False，不含值
$src = 'D:\kanet-tn12\kanet.env'; $dst = 'D:\kanet-tn12\kanet.mainnet.env'
$line = (Select-String -Path $src -Pattern '^TELEGRAM_BOT_TOKEN=' | Select-Object -First 1).Line
[bool]$line
[IO.File]::AppendAllText($dst, "`r`n" + $line, (New-Object Text.UTF8Encoding $false))
```

追加后立刻做 §3.4 断言（含"键唯一"：`start-console-mainnet.ps1` 逐行注入，**重复键后者静默覆盖前者**）。改 env 与重启是**两个分开的工具调用**。

### 3.3 生成新密钥（`ADMIN_SECRET_<TIER>`，今后需要时才用；只打印长度）

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$v = ($b | ForEach-Object { $_.ToString('x2') }) -join ''
[IO.File]::AppendAllText('D:\kanet-tn12\kanet.mainnet.env', "`r`nADMIN_SECRET_<TIER>=$v", (New-Object Text.UTF8Encoding $false))
"length=$($v.Length)"   # 64
Remove-Variable v, b
```

### 3.4 env 断言块（写入后、重启前跑；只打印键名与计数）

```powershell
$envf = 'D:\kanet-tn12\kanet.mainnet.env'
# (a) 禁项：期望 0
@(Select-String -Path $envf -Pattern '^\s*KANET_TESTNET_NO_LIMITS\s*=').Count
# (b) 键唯一：期望无输出
Get-Content $envf | ? { $_ -match '^\s*([A-Z0-9_]+)=' } | % { $matches[1] } | Group-Object | ? Count -gt 1 | % Name
# (c) 与 TN12 值零复用（只比哈希，只打印键名）：允许命中 TELEGRAM_BOT_TOKEN（有意复用），其余任一命中 = 中止
function EnvMap($p){ $m=@{}; Get-Content $p | % { if($_ -match '^\s*([A-Z0-9_]+)=(.*)$'){ $m[$matches[1]]=$matches[2] } }; $m }
$sha=[Security.Cryptography.SHA256]::Create(); function H($s){[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)))}
if (Test-Path 'D:\kanet-tn12\kanet.env') {
  $tn=EnvMap 'D:\kanet-tn12\kanet.env'; $mn=EnvMap $envf; $hs=@{}
  $tn.GetEnumerator() | ? { $_.Key -match 'SECRET|KEY|TOKEN|PASS' -and $_.Value } | % { $hs[(H $_.Value)]=1 }
  $mn.GetEnumerator() | ? { $_.Key -match 'SECRET|KEY|TOKEN|PASS' -and $_.Value -and $hs.ContainsKey((H $_.Value)) } | % Key
} else { 'kanet.env 不存在：跳过 (c)，改以生成时证据为准' }
# (d) 启动 console 的那个 shell 不得带入继承变量：期望无输出
Get-ChildItem Env: | ? { $_.Name -match '^(KANET_TESTNET_NO_LIMITS|ADMIN_SECRET|TELEGRAM_BOT|OWNER_BOT|INGEST_SECRET|BROKER_RELAY_ID)' } | % Name
```

（d 项的理由：`start-console-mainnet.ps1` 只**追加**文件里的键，不清理继承环境；从曾用过 TN12 变量的 shell 起主网 console，`KANET_TESTNET_NO_LIMITS` 会随继承进主网进程而文件里查不到。）

### 3.5 ⚠ OWNER_BOT_* 与账本 1500 口径的冲突（提请 Bettor 裁）

1500 定："`OWNER_BOT_TOKEN`/`OWNER_CHAT_ID` 复用现有值，验收加'发一条测试通知确认送达'"。核代码后：
- `tg-bot/owner-bot.mjs` 是 **Owner ⇄ dev-coord 频道的桥**（Direction A：Owner 私聊 → 经 owner-voice relay 发 dev-coord；B：dev-coord → 私聊推送；C：用户反馈工单升级转发）。**它没有"给 Owner 发通知"的通用路径**，所以"发一条测试通知"没有代码可跑。
- dev-coord 频道随 D-017 已退役；A / C 经 console `chat/send` 走 relay **链上广播**，在主网上意味着**真实花费**（仅当有地址被标为 `trust_level=owner` 时才会走到；主网库当前是否有，本页未核）。
- 主网 console **不会**拉起 owner-bot（`tg-bot-manager.js` 只管 broker bot）；`_launch_owner_bot.mjs` 也写死 `kanet.env` / `:3200` / `testnet-12`。

起草人建议：**(a) 本次不写 `OWNER_BOT_*`、不起 owner-bot**（D-023 只批 broker bot 身份复用）；若 Owner 要的是"主网事件通知到 Owner 的电报"，那是**新功能**，另立需求。选 (b)"写键但不起进程"无实际作用；选 (c)"起 owner-bot"须先过 CR-1 同型改造并单独审 A/C 的主网花费面。

## 4. `tg-bot/_state.json` 备份并清空

**它是什么**：`tg-bot/prediction-menu.mjs:15` 的持久化文件，`tg-bot/.gitignore` 已忽略（自查：`git -C D:\kanet-tn12 check-ignore -v tg-bot/_state.json`）。含五个顶层键：`sessions`（未完成会话）、`pendingPayments`、`linkedAddrs`（TG 用户↔绑定地址）、`userLangs`、`brokerFeeTs`（结算/手续费 DM 轮询游标）。**含 Telegram 用户 ID 与其绑定地址 ⇒ 属 D-021 的"地址与持有人对应"，备份只能放 `docs-private/`，不进 `docs/`、不进账本。**

**为什么必须清**（D-023 §3）：`sessions` 里是 TN12 时代未完成会话，指向主网库不存在的市场 id；`linkedAddrs` 是 TN12 地址。不清则老用户回话即撞"市场不存在"。

**前置**：bot 必须**未在跑**（§1.3），否则它下一次 `persist()` 会把内存状态写回；且 **`pendingPayments` 必须为空**——它是"等待链上付款"的监控队列，清掉 = 丢监控。检查：
```powershell
$s = Get-Content D:\kanet-tn12\tg-bot\_state.json -Raw | ConvertFrom-Json
$s.pendingPayments.Count    # 期望 0（起草时实测 0）；非 0 则停，回报 Bettor
```

**执行**（用 `Get-Date` 生成时间戳，不手打）：
```powershell
$ts  = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$src = 'D:\kanet-tn12\tg-bot\_state.json'
$dst = "D:\kanet-tn12\docs-private\tg-bot-state-tn12-final-$ts.json"
Copy-Item $src $dst
(Get-FileHash $src).Hash -eq (Get-FileHash $dst).Hash    # 必须 True，否则停，不清
# 清空：brokerFeeTs = 0 即可——bot.mjs:638 对 0 回落到 (now - 60s)，不会回放历史手续费 DM
$json = '{"sessions":[],"pendingPayments":[],"linkedAddrs":[],"userLangs":[],"brokerFeeTs":0}'
[IO.File]::WriteAllText($src, $json, (New-Object Text.UTF8Encoding $false))
```

**验收读数**：`(Get-Content $src -Raw | ConvertFrom-Json)` 五个键齐全，前四个为空数组，`brokerFeeTs` 为 `0`；备份文件哈希与清空前的原文件一致。备份路径记入账本时**只写文件名，不写内容**。

**副作用（要让 Owner 知道）**：所有用户的 `/link` 绑定与语言偏好一并清空，用户需重新 `/link`；而重新绑定主网地址取决于 **CR-3**（B-4）。

**回滚**：`Copy-Item $dst $src -Force`（bot 未运行时）。

## 5. 最小集开关与"bot 面能力盘点"

### 5.1 主网 env 开关必须保持的状态（起草时逐行实测）

| 键 | 当前值 | 要求 |
|---|---|---|
| `POOL_SEEDER_ENABLED` | `0` | **保持 0**（seeder 关，打开须 Owner 另批） |
| `PREDICTION_AGENT_ENABLED` | `0` | 保持 0 |
| `AUTO_BET_TICK_MS` | `0` | 保持 0（**自动下注关**） |
| `MINING_CONSOLIDATE_ENABLED` | `false` | 保持字面 `false`（该键判 `!== 'false'`，写 `0` 关不掉） |
| `ZK_PROVE_WORKER_ENABLED` | `0` | 保持 0 |
| `BSHARD_CLOSE_VOTER_V2_ENABLED` / `BSHARD_CLOSE_SUBMIT_V2_ENABLED` | `0` / `0` | 保持 0 |
| `PROTO_DRIVER_ENABLED` / `PROTO_SETTLEMENT_DRIVER_ENABLED` | **未设**（`PROTO_RELAY_ID` 已设） | **保持未设**（驱动开关 = 上膛，写前枚举全部读者；本次不碰） |
| `AUTO_BET_RELAYS` | 未设 | 保持未设 |

断言：`Select-String -Path D:\kanet-tn12\kanet.mainnet.env -Pattern '^(POOL_SEEDER_ENABLED|PREDICTION_AGENT_ENABLED|AUTO_BET_TICK_MS|ZK_PROVE_WORKER_ENABLED|BSHARD_CLOSE_(VOTER|SUBMIT)_V2_ENABLED)=(.*)$'` 逐行值应为 `0`；`MINING_CONSOLIDATE_ENABLED=false`；`PROTO_(SETTLEMENT_)?DRIVER_ENABLED` 与 `AUTO_BET_RELAYS` 零命中。

### 5.2 bot 面每个命令在主网 console 上的落点（**起草时代码实核**；未实核的标"待核"）

| bot 命令 | 落到 console | 主网现状 | 结论 |
|---|---|---|---|
| `/start` `/help` `/lang` | 纯文案 | — | 文案见 §6 |
| `/wallet` `/balance` `/receive` | `POST /api/tg-wallet/create`、`GET /api/tg-wallet/:id` | **B-2：写死 testnet-12** | 🔴 CR-2 前不可启 bot |
| `/send` `/confirm` | `POST /api/tg-wallet/:id/send` | `CUSTODIAL_RELAY_ID` 未设 ⇒ 503 | ✅ 有意关 |
| `/faucet` | `POST /api/faucet/request` | `FAUCET_RELAY_ID` 未设 ⇒ pending | ✅ 有意关（文案仍提 testnet KAS，见 §6） |
| `/link` | bot 先正则校验（`bot.mjs:236`，**只收 `kaspatest:`**），再 `POST /api/link/bind`（ingest-secret 鉴权，写 DB `user_notification_prefs`，只校验前缀 `kaspa`） | **B-4：主网地址被拒；`kaspatest:` 地址能绑** | 🔴 CR-3 前用户无法完成绑定 |
| `/bet` `/mybets` `/record` `/champions` `/discover` `/hot` | `GET /api/pool/markets*`、`.../bettor/{prep,confirm}` | `pool_markets` = 0 ⇒ 无可选市场；bot **没有任何 proto v0 API 调用**（D-020 单笔下注走 `api/proto.js`，bot 未接） | ✅ 现状无真实下注流；**这是结构性事实，不是开关**，故"结算后半程未完成前不接真实下注流"无需额外动作，但**不得**在此期间给 bot 加 proto 接线 |
| `/broker` `/earnings` `/broker_apply` | `POST /api/kanet-broker/onboard`（只写 `broker_onboarding` 行，不上链）等 | 写路径无花费；`/broker_apply` 允许用户提交**自己的** bot token | 🟡 用户面，随 §6 一并过目 |
| `/swap` | 纯文案（`messages.mjs:402`） | 文案写"仅主网可用/测试网预览" | 见 §6 |
| `/support` | 回复引导文案；后续反馈处理链（`/api/feedback/*`）**未逐行核** | 升级转发到 Owner 依赖 owner-bot（本次不起，§3.5） | 🟡 待核 |

## 6. 用户侧文案（**交 Owner 过目：本节只列待 Owner 定的清单，不替 Owner 定**）

D-023 §4 已定"首次交互文案必须明示"。以下是**需要 Owner 决定措辞或取舍**的位置（文件 / 键 / 现状要点）。文案文件属用户面（`tg-bot/*.mjs`、`messages.mjs`、`i18n.mjs`），**按铁律 0 必须 Owner 批才能改**，且改动本身走独立变更请求，不在本 runbook 执行范围。

**Owner 须决定的事（不是我来写答案）**
1. 首次交互要向老用户明示的内容与措辞：押注资产是零价值 KCC-20 测试币、与 TN12 时代玩法不同、绑定与会话已重置需重新 `/link`。放在哪里出现（`/start`？首次任意命令？一次性推送？）。
2. `help_disclaimer`（`i18n.mjs` 中英两处 + `messages.mjs:6` 的 `DISCLAIMER` 常量）现写"testnet-only · 不运营主网"——与"接主网 console"字面矛盾，需 Owner 定新的免责表述。
3. 仍写 testnet 的键（中英各一份，行号为起草时）：`start_commands` `start_linked_commands` `bet_autopay_faucet_hint` `help_faucet` `wallet_gen_next` `wallet_view_actions` `link_usage` `faucet_no_link` `faucet_already_claimed` `faucet_ok` `swap_testnet_note` `broker_role_warn` `earnings_testnet_note` `fee_dm_testnet_note` `record_footer` `champions_footer`，中文另有 `wallet_gen_title` `wallet_gen_warn_title` `wallet_send_confirm_warn` `wallet_receive_label`；`messages.mjs:188/255/284/402-407`、`bot.mjs:245/275-277/338` 亦含相关字面。逐条：保留 / 改 / 隐藏对应命令，由 Owner 定。
4. 是否在主网期**隐藏** `/faucet` `/wallet` `/send` 命令入口（B-2 与 §5.2 的"有意关"在用户看来仍是可点命令，点了得到"暂不可用"类回复）。
5. `/broker_apply`（用户提交自己的 bot token）在主网期是否保留。

**Bettor 转 Owner 时的最小信息**：以上 5 条 + B-1/B-2 的一句话后果。

## 7. 验收与回滚

### Stage A — 隔离实例演练（不碰生产 console；CR-1 / CR-2 落地后、开闸前做）

按接位文件第 8 条：**独立 worktree**（`scratch/_kanetui_wt_tgbot`，不在生产检出切分支）+ 独立端口 + 空 DB + 指向不可达 RPC 的临时 console 进程，bot 用**假 token**（演练不联 Telegram 业务）。

| 读数 | 期望 |
|---|---|
| 启动器自查（§0 B-1 命令） | 0 命中 |
| 启动器启动行 | 打印 `console=<隔离端口>`、`network=mainnet`，**不出现 `:3200`、`testnet-12`、`kanet.env`** |
| 隔离实例 `POST /api/tg-wallet/create`（CR-2 后） | 503 + 原因，`tg_custodial_wallets` 仍 0 行 |
| 缺 `INGEST_SECRET` / `KASPA_NETWORK` 非 mainnet 时启动器 | `exit(1)`，输出只含键名 |
| 演练结束 | kill 进程、删 worktree、确认端口释放 |

**中止**：任一读数不符 ⇒ 停，回报 Bettor，不进入 Stage B。

### Stage B — 主网（**须 Owner 开闸；Bettor 指定执行人**）

| 步 | 动作 | 验收读数 |
|---|---|---|
| B0 | §1 全部前置检查通过；日志另存 | 全绿 |
| B1 | §2：建 broker 身份 → 回填 `tg_bot_broker_relay_id` | §2 读数 |
| B2 | §4：备份 → 清空 state | §4 读数 |
| B3 | §3：路径 X 写 token/username（POST，无重启）；**或**路径 Y 追加 env 行 → §3.4 断言 →（**另一个调用**）console 六步重启：①另存日志 ②停旧 PID 并等子进程退出 ③确认端口释放、无残留 ④起新进程 ⑤记 PID ⑥核启动读数 | X：`GET /api/config/tg-bot-token` 只回 `token_configured=true` 与脱敏 hint；Y：§3.4 全过，启动读数含 `KASPA_NETWORK=mainnet PORT=3202` |
| B4 | `POST /api/tg-bot/start`（**非 kill**） | 返回 `ok:true` + pid；`GET /api/tg-bot/status` 为 `running=true`、`broker_relay_id` 为 B1 的 UUID |
| B5 | 读 bot 日志启动行 | `getMe 校验通过 @<username>`；`[tg-bot] @<username> up (broker=<UUID>…`；**无** `no broker configured`、**无** `409 Conflict` |
| B6 | Owner 用自己的账号发 `/start` `/help` | 收到回复；回复内容与 §6 Owner 已定的一致 |
| B7 | Owner `/link` 一个**主网**地址；再试一个 `kaspatest:` 地址（**CR-3 落地后才有意义**） | 主网地址成功、`user_notification_prefs` 新增 1 行；`kaspatest:` 地址被拒、库无新行。CR-3 未落地则 B7 整步不做（此时 `/link` 主网地址必被拒，属已知） |
| B8 | Owner 试 `/wallet` `/faucet` `/send` | 均为"暂不可用"类回复，**且** `tg_custodial_wallets` 仍 0 行、无任何链上交易（读数：主网库该表计数 + 该 relay 无新 tx） |
| B9 | 观察 30 分钟：console 与主网节点 | 无新错误簇；节点同步无异常 |

**验收项本身无副作用核对**：B7 的 `/link` 会写本机 link 文件（用户自己的操作，非探测副作用）；B8 期望"无写入"本身就是读数。

### 中止条件（任一触发 ⇒ 立即停止，不重试，回报 Bettor）

- B4 返回非 `ok`，或 B5 出现 `409 Conflict`（另一 poller 在用同一 token ⇒ 查 TN12 侧残留，**不要**强杀不明进程）。
- B5 出现 `TELEGRAM_BOT_USERNAME 配错`（getMe 自动纠正了，但说明 env 值不可信，先记录再问）。
- B8 出现任何 `tg_custodial_wallets` 新行、或任何链上交易。
- 任一步与 §0 阻断项相关的读数不符。

### 回滚

1. `POST /api/tg-bot/stop`（写 `tg_bot_enabled=0`，supervisor 不再拉起）；**不要**直接 kill。
2. 确认无 bot 进程（§1.3 命令）。
3. `tg-bot/_state.json`：从 §4 备份 `Copy-Item` 回去（**须 bot 未运行**）。
4. Y 路径：从 env 文件删 token/username 行 → `Select-String` 核实已删 → **另一个调用**再重启 console。X 路径：`tg_bot_token` 无删除端点，需 Bettor 指定方式（OQ-1）；`tg_bot_broker_relay_id` 同理。
5. broker 身份：`POST /relays/:id/delete`（若无关联数据）。
6. 记账本：停在哪一步、读数是什么。

## 8. 禁止项：`KANET_TESTNET_NO_LIMITS` 绝不进主网

- **现状**：`kanet.mainnet.env` 中该键**未出现**（起草时按锚定模式核过；文件注释里有该键名的说明行，所以**必须用锚定模式断言**，裸 grep 会被注释误命中）。
- **断言（写入任何 env 之后、每次重启之前必跑）**：
  ```powershell
  @(Select-String -Path D:\kanet-tn12\kanet.mainnet.env -Pattern '^\s*KANET_TESTNET_NO_LIMITS\s*=').Count   # 必须 0
  Get-ChildItem Env: | ? { $_.Name -eq 'KANET_TESTNET_NO_LIMITS' }                                            # 必须无输出（继承环境）
  ```
- **为什么两条**：`start-console-mainnet.ps1` 只往环境里**追加**文件中的键，不清继承变量（§3.4 (d)）；只查文件会漏掉从旧 shell 继承的那一路。
- **它绕过什么**（`pool.js:685-728, 927-946, 1293-1319`）：最小可花费额、最小下注额、软顶与 L4 最坏情况守卫——**恰是主网真钱环境该有的护栏**。
- **中止条件**：任一断言非零/非空 ⇒ 不重启、不启 bot，回报 Bettor。

## 附录 A. 待 Bettor 裁定的开放点（起草人的建议在括号内，决定权在 Bettor）

| 编号 | 问题 |
|---|---|
| OQ-1 | token/username 走路径 X（DB 配置，无需重启）还是 Y（env，需重启）？（建议 X；Y 时须把 §1.9 的迁移随重启问题一并裁。）X 路径下回滚"清除 DB 配置行"的方式由谁指定？ |
| OQ-2 | §3.5：`OWNER_BOT_*` 本次是否写、owner-bot 是否起？（建议都不做；账本 1500 那条"测试通知验收"无代码路径可跑。） |
| OQ-3 | broker 身份：复用库里已有的 `role=broker` 行（`Trader-A`，`bf73cb1b…`）还是另建？另建时是否需要 `role=broker`、是否充值、金额与来源、助记词备份介质？（建议：先核这一行的来历再定；另建则不改角色、不充值。） |
| OQ-4 | CR-1 原地改 `_launch_tg_bot.mjs` 会使 `kanet-start.sh` 的 TN12 bot 路径失效——接受？ |
| OQ-5 | 主网 `ingest_secret`：现有值是否轮换？（`x-ingest-secret` 是 bot→console 唯一鉴权，也保护 `tg-wallet` 三端点。） |
| OQ-6 | CR-2 的批准层级：托管钱包路由属钱路，是否须 Owner 批？ |
