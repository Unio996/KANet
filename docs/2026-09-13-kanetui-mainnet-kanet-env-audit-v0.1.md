# kanet.env 逐项审计 → kanet.mainnet.env（2026-09-13 · KANet-UI · GO-B 交付）

> **Status: DRAFT**。权威：Bettor GO-B 派工 + NWT `9ba20fb2` 两项遗漏 MUST（KANET_ROOT 显式绝对路径 / CONSOLE_ENCRYPTION_KEY 新生成禁复用）+ Bettor 补三条（DB_PATH 绝对路径 / 密钥禁复用要写进脚本注释 / stdout+stderr 重定向必须有）。本页是 `kanet.mainnet.env` 的可审计对照表（该文件本身 gitignored，不能靠 git diff 审，靠这页）。**本页只记录判断，不执行任何启动动作。**

## 0. 核心结论先行
- `kanet.env` 现有 **92 个非注释键**。全部过了一遍，分类处置，不是逐行各自独立拍的——**同类同判断**，理由写在每类下面。
- 端口/路径实测（本机 2026-09-13，供审计对照）：**`PORT=3201` 冲突**——现有 TN12 console（PID 6716）已经在 `100.99.147.101:3201`（tailnet 接口）监听，具体原因未查（不是 `KANET_EXTERNAL_GATEWAY_PORT`，那个是 3210，另有其事，本页未深挖），**改用 `3202`**（本机实测空闲，3203/3204 同样空闲留作备选）。这条跟 Bettor GO-B 原文给的 3201 不一致，是本页新查到的，需要 Bettor 确认改用 3202 还是查清 3201 那个监听是什么再决定。

## 1. 网络/RPC/数据库/端口（核心四项，值已定）
| 键 | 值 | 理由 |
|---|---|---|
| `KASPA_NETWORK` | `mainnet` | 按方案 §1.3 |
| `KASPA_RPC_URL` | `ws://127.0.0.1:17110` | J1 执行页起的主网节点 borsh 端口 |
| `KASPA_RPC_LOCAL_ONLY` | `1` | 值不变，语义因 (a) 分支变严格 |
| `DB_PATH` | `D:/kanet-tn12/kasia-console/data/console.mainnet.db`（**绝对路径**） | Bettor 补充要求：`resolve()` 受 cwd 影响，写绝对路径消除这个变量 |
| `PORT` | `3202`（原定 3201 冲突，见 §0） | 见上 |
| `HOST` | `127.0.0.1` | 沿用现值，本地绑定 |
| `KANET_ROOT` | `D:/kanet-tn12`（**绝对路径**，NWT MUST） | NWT 指出十几处代码各自有默认值，缺了会静默用错的默认值而非报错——必须显式写 |

## 2. 加密/密钥（NWT MUST：新生成，禁止复用）
| 键 | 处置 |
|---|---|
| `CONSOLE_ENCRYPTION_KEY` | **本次全新生成 32 字节随机数（64 hex）**，直接写进 `kanet.mainnet.env`，**从未在任何命令输出/频道/ledger 里回显过明文值**——生成命令用 PowerShell `RandomNumberGenerator`，写文件时管道直接消费，终端只打印了"长度=64"做核对，没打印值本身。Owner 备份位置：本文件路径 `D:\kanet-tn12\kanet.mainnet.env`（gitignored，只在本机磁盘），**Owner 如需异地备份这把密钥，请自行另存，本页不代为二次分发**。 |

## 3. 未决定 / 留给 Owner 或 Bettor 定（本次先不写进文件）
| 类别 | 键 | 为什么留白 |
|---|---|---|
| Admin 认证 | `ADMIN_SECRET` / `ADMIN_SECRET_ZK_CLOSE_BROADCAST` / `ADMIN_SECRET_STATUS_SIGN` / `ADMIN_SECRET_ZK_STATE_PREP` / `ADMIN_SECRET_READONLY` / `TEST_HARNESS_TOKEN` / `ADMIN_SECRET_PILOT_DIAGNOSE` / `ADMIN_IP_ALLOWLIST` | 沿用 TN12 同值还是各自新生成，本页没有足够信息独立拍板（不像 `CONSOLE_ENCRYPTION_KEY` 那样有 NWT 明确 MUST）——留白 = 对应 admin 端点在这个实例上暂不可用，不是漏配 |
| Telegram/Owner 通知 | `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` / `OWNER_BOT_TOKEN` / `OWNER_CHAT_ID` | 共用同一个 bot 身份给两个网络实例发通知是否合适，需要 Owner 决定（不是纯技术判断） |
| 主网地址 | `PILOT_WALLET_ADDRESSES` | TN12 地址格式/实际地址在主网上不适用，待主网地址产生后再填，现在留白 |
| 外部网关 | `KANET_EXTERNAL_GATEWAY_HOST` / `KANET_EXTERNAL_GATEWAY_PORT` | 这个新 console 实例是否需要对外暴露网关，属于 §5 GO-D（正式对外服务前）范围，起步阶段不需要，留白 |
| ws-proxy | `KASPA_WS_PROXY_PORT` / `KASPA_WS_PROXY_TARGET_PORT` | 本次 GO-C 只起 console 单进程（不经过 `kanet-start.sh` 全栈编排，见方案 §1.3），ws-proxy 是否需要为主网实例单独起一份是后续问题，本次不写、不启动 |

## 4. 明确排除（主网不该带的"测试网便利"）
| 键 | 处置 | 理由 |
|---|---|---|
| `KANET_TESTNET_NO_LIMITS` | **不带**（不写进文件） | 字面意思是关掉各种限额检查，专为测试网设计；主网真钱环境绝不能带这个，这是本次审计里唯一一条"现值存在但明确必须排除"的项，单独点名防止将来被误当"忘了抄"补回去 |

## 5. Relay 身份类（全部留空，等 §3.1 步骤 6 各自新建后回填）
`FAUCET_RELAY_ID` / `POOL_SEEDER_MAKER_RELAY` / `GATEWAY_RELAY_ID` / `BROKER_PREDICTION_BROKER_RELAY_ID` / `BROKER_RELAY_ID` / `AUTO_BET_RELAYS` / `SETTLE_DAEMON_FEE_RELAY_ID` / `MINING_RELAY_ID` / `BOT_AUTOFUND_SOURCE_RELAY_ID` / `BROADCASTER_RELAY_IDS` / `BSHARD_SETTLER_RELAY_ID` / `CUSTODIAL_RELAY_ID`（12 项）

这些值在 `kanet.env` 里全部是 TN12 relay_nodes 表里的 UUID——新库是空的，这些 UUID 在新库里查不到对应行，写了也是死值。等对应功能真需要在主网上启用、按起服务方案 §3.1 步骤 6 建好新 mainnet relay 身份后，再逐个把对应键回填成新 UUID。**现在留空的直接后果**：这些功能在新实例上不启用（各服务读不到配置的 relay id，通常走"未配置/不启动"分支，不是报错崩溃——具体行为待起来后核实，本页只给判断不代为验证）。

## 6. 保守起步：显式关闭自动交易/做市类服务
| 键 | 值 | 理由 |
|---|---|---|
| `POOL_SEEDER_ENABLED` | `0` | 首次主网起步不需要自动做市 |
| `PREDICTION_AGENT_ENABLED` | `0` | 同上，不需要自动下注 agent |
| `AUTO_BET_TICK_MS` | `0` | 同上 |
| `MINING_CONSOLIDATE_ENABLED` | `0` | 无挖矿业务（这是只读 console 实例） |
| `ZK_PROVE_WORKER_ENABLED` | `0` | ZK 证明生成是重负载，起步阶段不需要 |
| `BSHARD_CLOSE_VOTER_V2_ENABLED` / `BSHARD_CLOSE_SUBMIT_V2_ENABLED` | `0` | 同理，没有 mainnet bshard 市场，不需要这两个 tick |

其余业务参数类（`POOL_DEADLINE_*`/`DAILY_SEND_LIMIT`/各类 `*_TICK_SEC`/`DEMO_*_OFF` 等约 40 项）判断为**网络无关的行为配置**，本次不改，留给需要真正启用对应功能时再逐项核（多数本身默认就是保守值或"关闭"状态，不因为换网络而需要重新评估）。

## 7. 零成本预验（GO-B 第 4 条，均只读，未改动任何东西）
| 项 | 结果 |
|---|---|
| `kanet.mainnet.env` 文件语法 | 已写入，`=` 分隔，无解析问题（PowerShell heredoc 写入，格式与 `kanet.env` 一致） |
| 端口 3201（Bettor 原定值） | **占用**（PID 6716，TN12 console 自己，tailnet 接口 `100.99.147.101`，具体用途未查清） |
| 端口 3202/3203/3204 | 全部空闲（已改用 3202，见 §0） |
| `D:\kanet-tn12\kasia-console\data\console.mainnet.db` | 起前确认不存在（`Test-Path` = False），无误覆盖风险 |
| `kanet.mainnet.env` 是否 gitignore 覆盖 | **起初没有覆盖**（`git check-ignore` 退出码 1）——已在 `.gitignore` 加一行 `kanet.mainnet.env`，加完复核退出码 0，现已覆盖 |
