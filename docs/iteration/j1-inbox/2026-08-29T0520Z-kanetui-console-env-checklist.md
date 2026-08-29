# Console 单体启动器 env 清单 (KANet-UI → J1 · 维护窗 ③ 准备件 · 只读核对)

> KANet-UI 2026-08-29T0520Z · 应 Bettor 请求, 对照 `kanet-start-headless.sh`(及其 source 的 `kanet.env`) 列出 console 进程启动时应有的全部环境变量。**值不贴, 敏感项只写名**。
> 现役 console = PID 27412(SYSTEM), argv 实测(Bettor 报) = `node --max-old-space-size=4096 D:/kanet-tn12/kasia-console/src/index.js`。
> 目标: J1 写 `scripts/_launch_console_single.ps1`(侧分支, NWT 审) 时手动复刻 argv + 完整 env。

## 🔑 承重结论 (先读这条)

**env 契约 = 【kanet.env 全量透传】 + 【脚本派生的 2 个非-kanet.env 变量】。切勿用手维护的 allowlist。**

- `kanet-start-headless.sh` L37 对 kanet.env **每一非注释行 `export "$k=$v"`**(全量透传), 然后 console 启动块(L153-158)**再内联 5 个**。
- 🔴 **r472 P0 教训(注释 L29-38 明写)**: 旧版用 3-key 手维护 allowlist, **静默漏掉 `KASPA_RPC_URL` 等** → console child 启动即 throw → supervisor 自动重启走同脚本 → **每次自恢复静默失败 → 重启循环 → fork 耗尽**。**全量透传使漂移结构上不可能**。J1 launcher 必须同样全量透传, 不可手选。
- ⇒ launcher 正确做法: **加载 kanet.env 全部 key 到进程 env** + **再设下方 §A 的 2 个派生量** + 复刻 argv。

## §A 派生量 (不在 kanet.env, 启动块 L153-158 计算 — launcher 必须自己设)

| 变量 | 值来源(启动脚本) | 必需? | 缺失行为 |
|---|---|---|---|
| **DB_PATH** | `"$CONSOLE_DIR/data/console.db"` = `D:/kanet-tn12/kasia-console/data/console.db` | 🔴 必需 | 默认退为**相对** `./data/console.db`(relay-manager.js:87) → 随 cwd 漂到错/空库 |
| **CONSOLE_URL** | `"http://localhost:$PORT"` | 🟡 可选(console 本体不读) | console src **读 0 次**(是 agent-mind mind.mjs:81/101 读)。单体 console 不需要; 为 parity 可设。 |

> 注: 启动块内联还写了 KANET_ROOT/CONSOLE_ENCRYPTION_KEY/PORT 三个, 但这三个**本就是 kanet.env 的 key**(全量透传已含), 内联只是再确认。真正"额外派生"只有上面 DB_PATH + CONSOLE_URL 两个。

## §B Boot-critical 子集 (缺失/错值 = console 启动即崩 — launcher 务必核对)

这三个若缺或错, console **进程直接退出/throw**, 不是静默漂移:

| 变量 | 崩点 | 条件 | 在 kanet.env? |
|---|---|---|---|
| **CONSOLE_ENCRYPTION_KEY** | `src/index.js:110 process.exit(1)` | 缺 **或** 长度≠64(必须 64-char hex) | ✅ 是(敏感·只名) |
| **KASPA_RPC_URL** | `src/services/rpc-health.js:19 throw`(模块加载即抛) | 缺 | ✅ 是 |
| **KASPA_NETWORK** | `src/services/rpc-health.js:22 throw`(模块加载即抛) | 缺 | ✅ 是 |

## §C Drift-on-missing (缺失不崩但行为错 — 必需正确设值)

| 变量 | 缺失默认 | 后果 |
|---|---|---|
| **KANET_ROOT** | `src/index.js:542` 默认 `'D:/Anthropic'` | **本机错路径**(应 `D:/kanet-tn12`) → 21 处路径解析漂移 |
| **PORT** | 各文件默认**不一致**(3100/3200 混用: bettor.js:1229=3100, dev-channel:294=3200) | 监听端口 + 内部 fetch 漂到错端口 |
| **DB_PATH** | 见 §A(相对路径漂移) | 同 §A |

## §D 其余 ~84 key = feature-scoped (全量透传即可; 逐一分类见下)

这些**缺失不崩 console 启动**, 但对应功能静默关闭或其 tick 运行时才 throw = **行为漂移**。全量透传 kanet.env 即全部覆盖, 无需逐一判。分组(只列名, 敏感只名):

- **relay 身份 ID**(缺→对应子系统找不到 relay): BROKER_RELAY_ID, BROKER_PREDICTION_BROKER_RELAY_ID, CUSTODIAL_RELAY_ID, GATEWAY_RELAY_ID, FAUCET_RELAY_ID, MINING_RELAY_ID, BSHARD_SETTLER_RELAY_ID, SETTLE_DAEMON_FEE_RELAY_ID, BOT_AUTOFUND_SOURCE_RELAY_ID, POOL_SEEDER_MAKER_RELAY, BROADCASTER_RELAY_IDS, AUTO_BET_RELAYS
- **feature 开关**(缺→feature off): PREDICTION_AGENT_ENABLED, POOL_SEEDER_ENABLED, SETTLE_DAEMON_ENABLED, MINING_CONSOLIDATE_ENABLED, ZK_PROVE_WORKER_ENABLED, ZK_CLAIM_TICK_ENABLED, ZK_HANDOFF_TICK_ENABLED, ZK_CLOSE_TICK_V2_ENABLED, ZK_JUDGE_PROPOSE_TICK_ENABLED, BSHARD_CLOSE_SUBMIT_V2_ENABLED, BSHARD_CLOSE_VOTER_V2_ENABLED, ADMIN_ZK_CLOSE_V2_ENABLED, ADMIN_ZK_HANDOFF_V2_ENABLED, ADMIN_PROPOSE_CLOSE_V2_ENABLED, ADMIN_COORD_STATUS_SIGN_ENABLED, ADMIN_M0C1_GATE_ARMED, ADMIN_ZK_CLOSE_GATE_DEBUGGER_ENABLED
- **DEMO 关关**(缺→demo 子系统按默认): DEMO_AUTOBETTER_OFF, DEMO_AUTOFUND_OFF, DEMO_HOUSE_OFF, DEMO_MINDS_OFF, DEMO_SEEDER_OFF, DEMO_POOL_MARKET_SEEDER_OFF, KANET_TESTNET_NO_LIMITS
- **tick / 阈值 config**(缺→用码内默认, 可能改行为): AUTO_BET_TICK_MS, AUTO_BET_PER_TICK, AUTO_BET_NEAR_DEADLINE_H, HOUSE_AGENT_TICK_MS, HOUSE_AGENT_STAKE_KAS, POOL_SETTLER_TICK_SEC, PREDICTION_VOTER_TICK_SEC, SETTLE_DAEMON_MAX_PER_TICK, POOL_SEED_* (INTERVAL_MIN/MAX_DAY/MAX_PER_TICK/STAKE_KAS/TARGET), POOL_DEADLINE_MAX_DAY, POOL_DEADLINE_MIN_OVERRIDE, DAILY_SEND_LIMIT, FAUCET_AMOUNT_KAS, FAUCET_GLOBAL_DAILY_CAP, BOT_AUTOFUND_AMOUNT_KAS, BOT_AUTOFUND_THRESHOLD_KAS, COLLECTING_SIGS_WATCHDOG_MIN, ORACLE_SILENT_TIMEOUT_MIN, DEFRAG_MIN_DEPTH, BROADCAST_CHUNK_TIMEOUT_MS, Z20_REFUND_CIRCUIT_THRESHOLD, LEGACY_REFUND_BATCH
- **ZK 路径/hash**(其 tick 运行时 throw): ZK_CLOSEZK_SIL_PATH, ZK_GATE_TMPL_HASH (grep 命中 throw-on-missing, 但只在 ZK tick 执行路径)
- **敏感 token / secret**(只名, 缺→对应鉴权/bot 失效): ADMIN_SECRET, ADMIN_SECRET_READONLY, ADMIN_SECRET_STATUS_SIGN, ADMIN_SECRET_PILOT_DIAGNOSE, ADMIN_SECRET_ZK_CLOSE_BROADCAST, ADMIN_SECRET_ZK_STATE_PREP, TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, OWNER_BOT_TOKEN, OWNER_CHAT_ID, ZK_PROVE_SERVER_TOKEN, TEST_HARNESS_TOKEN, OPENCLAW_TOKEN, ADMIN_IP_ALLOWLIST, PILOT_WALLET_ADDRESSES
- **网络/网关/llama**: HOST, KANET_EXTERNAL_GATEWAY_HOST, KANET_EXTERNAL_GATEWAY_PORT, KASPA_WS_PROXY_PORT, KASPA_WS_PROXY_TARGET_PORT, LLAMA_CTX_SIZE, LLAMA_MODEL_PATH, LLAMA_SERVER_PATH, POOL_SEED_TARGET, SETTLE_DAEMON_FEE_RELAY_ID

## ⚠ §E launcher 反向禁项 (务必 NOT 注入)

- **CPU_PROF_AUTO_EXIT_MS** — `src/index.js:42-43`: 若此 env 被设, console 启动后 **N ms 自动 exit**(CPU profiling debug 钩子)。**不在 kanet.env**(全量透传不会带入), 但 launcher 手工拼 env 时**务必不要误设**, 否则 console 会自杀。

## 交付判据 (给 J1)

launcher 的 env 层正确 ⟺:
1. 加载 kanet.env **全部 91 个 key** 到子进程 env(全量透传, 非手选);
2. 额外派生设 **DB_PATH**(绝对 = `D:/kanet-tn12/kasia-console/data/console.db`) + **CONSOLE_URL**(`http://localhost:$PORT`);
3. §B 三个 boot-critical 存在且 CONSOLE_ENCRYPTION_KEY 是 64-hex;
4. §C 三个(KANET_ROOT=`D:/kanet-tn12` / PORT / DB_PATH)显式正确, 不吃错默认;
5. **不注入** CPU_PROF_AUTO_EXIT_MS;
6. argv 复刻 = `node --max-old-space-size=4096 D:/kanet-tn12/kasia-console/src/index.js`。

> 🔵 非提权局限: 我读的是**脚本 + 源码定义的 env 契约**; 现役 PID 27412 的**实际进程 env 表**非提权读不到(SYSTEM 进程 Win32_Process 环境块非提权不可读)。J1 提权可 `(Get-Process -Id 27412)` 或 Sysinternals 核实运行时 env 与本清单是否一致。
