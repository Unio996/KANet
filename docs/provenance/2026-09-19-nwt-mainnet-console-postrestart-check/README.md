# 主网 console 硬复位后重启 —— NWT 部署后只读核（PID 9024）

2026-09-19 22:2x（本地 UTC+7）= 15:2xZ。背景：主网机器 21:51 硬复位，Bettor 按 Owner GO 起 kaspad（PID 16464）→ console（PID 9024，启动 22:21:24）。本核为**只读**：`Get-CimInstance` / `Get-NetTCPConnection` / 读日志 / 只读打开主网库（`readonly:true`，不取任何密钥列）/ 四条敏感路由各一次空体探针。未发任何花费、未动任何开关。D-021：不含余额与密钥值。

## 结论：GREEN（与 Bettor 读数一致）；另有一条启动期链上花费的观察，需 Owner 知情（§三）

## 一、读数（逐项，原始来源）

| 项 | 读数 | 来源 |
|---|---|---|
| console 进程 | pid 文件 `logs/mainnet/console-mainnet.pid`=9024 = `:3202` 监听属主 = `node …\kasia-console\src\index.js`，创建 22:21:24 | `Get-CimInstance Win32_Process` + `Get-NetTCPConnection` |
| 监听面 | `127.0.0.1:3202` 恰 1 个 Listen；`127.0.0.1:17110`（kaspad）1 个；`:3200` 无监听 | `Get-NetTCPConnection -State Listen` |
| kaspad | PID 16464，sha256 前缀 `8afe6a68`，`--version` = 2.0.1，命令行 `--appdir=D:\kaspa-mainnet-data-v201 --utxoindex --rpclisten-borsh=127.0.0.1:17110 …` | `sha256sum` + `--version` + CIM |
| relay 子进程 | node.exe 共 19 = console 1 + `src/relay.mjs` 18（`ParentProcessId` 全为 9024，创建 22:21:34） | CIM |
| **18 是不是应有数** | **是**。库 `relay_nodes` `network='mainnet'` 恰 18 行：stress-user 01–08、stress-control 01–02（10）、J2、KANet-UI、Trader-A、Qclaude、Trader-M、Bettor、NWT（7）= 17，再加 `proto-v0-funds` = 18；`/api/system/rpc-overview` `total 18 / connected 18 / reconnecting 0 / unreachable 0`。9/14 GO 文件 §3 的 17 是 proto relay 建立（账本 1373）**之前**的数，(1458) 起即 18 | 只读 SQL + HTTP |
| 四条敏感路由 | `GET /relays/1/mnemonic` **503**、`GET /api/relay/1/wallets/1/privkey` **503**（`RELAY_KEY_EXPORT_ENABLED_UNTIL env 未设`）；`POST /api/system/run` **503**、`POST /api/system/download` **503**（`ADMIN_SECRET_SYSTEM_ACTIONS env 未设`）。探针空体、无 header；只留预期的 `[key-export] refuse` 日志 | curl |
| 驱动开关 | `kanet.mainnet.env` 里键名匹配 `PROTO_DRIVER` / `DRIVER` / `SETTLEMENT` = 0（只读键名，未读任何值）；`ZK_PROVE_WORKER_ENABLED=0`（布尔）；日志 `[proto-driver] disabled` 恰 1 行；`[proto-settlement-driver]` 0 行（该代码未合入，符合） | grep 键名 + 日志 |
| 启动日志 | `WARMUP FAIL` 0；`[silverc-pin] PASS` 1（FAIL 0）；`FATAL` 0；`MODULE_NOT_FOUND` 0；`uncaughtException|unhandledRejection|Assertion failed` 0；`DB migrations complete` 1；`[relay-hotwallet-monitor] started` 1；`events.event_type='hotwallet_relay_killed'` = 0 | grep + 只读 SQL |
| stderr | 仅已知 fail-closed 提示（v199 大索引待停机窗、`ZK_PROVE_SERVER_TOKEN` 未设不启动、external-gateway 未配置）+ 我探针触发的两条 `[key-export] refuse` + 一条良性 `oracle-pool-scanner-cron tick fail: pool empty` | `console-mainnet-stderr.log` |
| 业务库状态 | `proto_markets`：1 betting + 2 cancelled；`proto_bets`：1 confirmed + 1 pending；`proto_bet_intents`：1 landed + 1 ambiguous——与账本 (1531) 库读数一致，重启没改它 | 只读 SQL |
| 启动后 broadcast 关键词 | 新 stdout 中 `broadcast\|submitTransaction\|sendKaspa` 仅 1 行：`[broadcaster-utxo] started`（该 cron 的 proto relay 已被排除，且死机前同样存在）；**没有** covenant_broadcast / 结算 / 下注 / 转账类广播 | grep |

## 二、我探针的副作用（全部记录）
四条路由各一次请求，均 503 拒绝、无写入；触发两条 `[key-export] refuse`（`relay=1`，不含密钥）。对库只 `readonly` 打开、只 SELECT（`relay_nodes` 的 id/name/network 三类非密钥列；`proto_*` 与 `events` 的状态计数）。

## 三、🟡 观察：console **每次启动**都会在主网上花手续费（`autoSplitAll`），与驱动开关无关

**事实**：`src/index.js:870-871` 无条件 `import`+`await autoSplitAll()`，`src/services/utxo-splitter.js:56`；文件头注释（L41）本身写明"autoSplitAll 每次 console 启动都无条件…"。**没有任何 env 开关**能关它（唯一的跳过条件是 `proto-` 前缀 / `PROTO_RELAY_ID`，L46-49）。

**两次启动的实际动作（同 4 个账户、方向相反）**——日志行号是各自 stdout 文件内的行号：

| 账户 | 本次启动 22:21:34（`console-mainnet-stdout.log`） | 上一次启动（`…pre-crash-20260919-2041.log`，该 run 起于 9/16 00:36） |
|---|---|---|
| KANet-UI | 4 → 5 UTXO，fee 0.011626 KAS（L330；`UTXO SPLIT: 4→5` L333） | 5 → 4，fee 0.012332（L329） |
| Trader-A | 6 → 7，fee 0.014686（L343；L344） | 7 → 6，fee 0.015392（L360） |
| Trader-M | 4 → 3，fee 0.010802（L356；L357） | 3 → 4，fee 0.010096（L389） |
| Bettor | 2 → 2，fee 0.008154（L358；L359） | 2 → 2，fee 0.008154（L398） |
| 合计手续费 | ≈ **0.0453 KAS** | ≈ 0.0460 KAS |
| 汇总行 | `4/18 accounts split`（L361） | `4/18 accounts split`（L401） |
| proto-v0-funds | `skip (proto relay — UTXO shape managed by execution page)`（L360） | 同（L400） |

其余 stress-* / J2 / Qclaude / NWT 因余额不足或 UTXO 已够，`skipped`。

**含义**：
1. "重启不会自动发链上交易"**不成立**——每次 console 启动，`autoSplitAll` 会对余额足够的团队账户各广播一笔 split 交易（fee 由这些账户自付）。金额小（每次约 0.045 KAS），但它是**真实主网花费**，任何"重启后零链上花费"的验收判据都要把它算进去。
2. UTXO 数在同几个账户上**来回摆动**（KANet-UI 5→4→5，Trader-A 7→6→7…），说明这个拆分目标与"UTXO 数已达标即跳过"的判据不稳，每次重启都在烧一次费用而没有净收敛——这是一个待查缺陷，不只是"设计如此"。**我没有读 `autoSplitAll` 的判据逻辑**（只读了文件头注释与 proto 跳过分支），成因未定，不下结论。
3. 是否给启动期拆分加开关、或修判据使其收敛，是 Owner / Bettor 的决定（这是钱路，铁律 0）；本核只提供证据。若要开关，最小改动形状是 env 默认关（同 `PROTO_DRIVER_ENABLED` 的默认关风格）+ 启动日志打 `[utxo-splitter] disabled`，改 `index.js:871` 一处；须 NWT 审。

## 四、我没做
- 没读 `autoSplitAll` 的拆分判据（§三-2）；没核每笔 split 的 txid 是否上链（只读日志，未查链）；没做浏览器实测；未探测除四条敏感路由之外的路由。
- 我上一个会话遗留在 `kasia-console/` 下的路径拼错名 untracked json（37 KB，JSON 字符串形态的 prepared tx，无 64 位 hex 密钥物，预期路径不存在）已**移动**（未删除）到我的 scratchpad，`git status` 已无该项。
