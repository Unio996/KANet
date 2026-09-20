> **Status**: CURRENT（2026-09-20，NWT；对象 = 本地分支 `coord/kanetui-tgbot-cr12`：CR-1 `7049b3ff` + CR-2 `6d34974f`（基线 `f7f99044`，5 文件 +339/−29）；字节级验收；D-021：类别级）

# 电报 bot 主网守卫 CR-1 / CR-2 —— NWT 字节级验收

## 结论：**GREEN（0 MUST）。** ①–④ 全部核实成立；有几条 SHOULD（含 1 条"同类启动器未覆盖"的范围提示）。
D-031 第一判据：CR-1 只用继承环境 + 一个纯函数，不另造配置读取；CR-2 复用既有 `AUTH` 并只加一个 preHandler，不新增能力——**没有重造**；范围提示里我建议把 CR-1 的同一个纯函数**复用**到同类启动器。

## 做法
把这两个 commit 的 5 个 blob 用 `git archive` 取到我自己的检出（`D:\kanet-nwt-cand`，独立 node_modules，生产检出零触碰）并原样执行；测试之外自己写了独立探针与变异，用完还原。

## 你问的四点
**① CR-1 断言是否真的 fail-closed（不是测试自证）——是。** 我独立喂 `resolveBotLaunchEnv` 50 余个边界值：网络 `MAINNET` / `" mainnet"` / `"mainnet "` / `"mainnet\n"` / `testnet-12` / `simnet` / 空 / 未设 ⇒ 全拒（严格相等）；PORT `03200`/`" 3200"`/`"3200\n"`/`65536`/`0`/`-1`/`3.2e3`/`99999`/空/未设 ⇒ 全拒，`1`、`65535` 才过；`KANET_TESTNET_NO_LIMITS` 只要**出现**（`1`/`0`/空/`false`）就拒；`INGEST_SECRET` 全空白 ⇒ 缺失；`env` 为 `undefined`/`null`/`{}` ⇒ 全拒。**真启动器**在无效环境下 `exit=1` 且**在 import bot 之前**退出（我跑了三种无效环境：无环境 / `testnet-12` / PORT 与陈旧 `CONSOLE_URL` 不一致——都只打印一行 `FATAL` 就退出，没有启动 bot；有效环境我没跑，那会真的拉起 bot）。**不泄密**：拒绝时的输出里我塞了 `INGEST_SECRET` / `TELEGRAM_BOT_TOKEN` / `ADMIN_SECRET_*` / `CONSOLE_ENCRYPTION_KEY` 的值，输出 JSON 中一个都没有。
**② CONSOLE_URL 只打印 origin——确认只收紧、不放宽。** `safeOrigin` 只影响**错误文本**，不参与放行判定；我用 `http://user:PASSWORD123@evil.example:3200/x?token=abc` 与 `not a url with SECRETTEXT` 探针：输出分别是 `http://evil.example:3200` 与 `(unparseable)`，userinfo / 路径 / 查询 / 原文全部不回显。变异"打印完整 URL"被杀。
**③ CR-2 守卫位置——字节级确认在"鉴权后、写/RPC/助记词前"。** `const GUARDED = { preHandler: [...AUTH.preHandler, NETWORK_GUARD] }`：Fastify 的 preHandler 按数组顺序，`AUTH`（`verifyIngestRequest`）在前、守卫在后，而 create / 查询 / send 三个处理函数里的 DB 读写、余额 RPC、助记词生成/解密都在处理函数体内（preHandler 之后）。测试是**真 Fastify + 真鉴权 + 真迁移库**：mainnet / 未设 / simnet 下三路由带正确 secret ⇒ 503、`tg_custodial_wallets` 仍 0 行、响应体不含 `mnemonic`；不带/带错 secret ⇒ 401（不是 503）；正向对照臂 `testnet-12` 下同路由放行且新增 1 行。变异"守卫放到鉴权前"被杀（未鉴权变成 503）。我另核：文件里只有 create / 查询 / send / diagnose 四条路由，前三条已守，`/diagnose` 另有三重门且不动。
**④ harness 不需补一行——确认。** `test-framework/cases/m0c1-gate/tg-wallet-pilot-isolation-regression.mjs` 第 39 行**自己**设 `process.env.KASPA_NETWORK = 'testnet-12'`（且在 import 路由前），并且实际调用 create / send / diagnose；该分支对 `test-framework/` 零改动。比规格少一个文件是对的。

## 验证数据
- CR-1 测试 59/59、CR-2 测试 31/31，在我的检出上**全绿**（复跑）。
- 我自己写的 22 个变异（CR-1 ×14、CR-2 ×8）：**19 杀、3 活**，树已还原、无还原不符。3 个活的都是**测试缺口而非代码缺陷**（见 S2）。
- 主网环境事实（只读、只看变量名与非密钥值）：`kanet.mainnet.env` 里 `PORT=3202`、`HOST=127.0.0.1`、`KASPA_NETWORK=mainnet`，含 `ADMIN_SECRET_FUNDS`、`CONSOLE_ENCRYPTION_KEY`（都在 scrub 名单内）、**无** `KANET_TESTNET_NO_LIMITS`。也就是说旧启动器写死的 `:3200` 对主网 console（3202）本来就是错的，CR-1 的派生 URL 会得到 `http://127.0.0.1:3202`。启动顺序也对：`ensureIngestSecret()`（index.js:571）先于 `startTgBotIfConfigured()`（:638），`process.env.INGEST_SECRET` 就是 `verifyIngestRequest` 校验用的那份 DB 配置值。
- 主网 `tg_custodial_wallets` 行数 = 0（只读），CR-2 之后主网也建不出新行。

## SHOULD（不阻塞）
**S1 scrub 在 Windows 上大小写敏感。** 我在真 `process.env` 上定义小写 `console_encryption_key`：`resolveBotLaunchEnv` 返回的 scrub 清单为 `[]`（`Object.keys` 给的是实际大小写，`includes` 严格比较），于是该密钥不会被从 bot 进程删掉；同一处对 `KANET_TESTNET_NO_LIMITS` 反而是大小写不敏感的（`hasOwnProperty` 走 Win32 环境）——两处不对称。主网 env 文件里名字都是大写，实际不会触发；但 scrub 是"0-key 进程"的防线，建议匹配时统一 `toUpperCase()`（一行）并补一条测试。
**S2 测试缺口（变异存活）：** ① 网络比较改成 `startsWith('main')` 存活——请补 `mainnet-2` / `mainnetx` 必拒；② CR-2 守卫改成 `startsWith('testnet')` 存活——请补 `testnet-11` / `TESTNET-12` / `testnet-12 ` 必 503（别的测试网也不该放行托管钱包）；③ "拒绝文本回显 `INGEST_SECRET` 值"存活，但该分支只在值为空/全空白时触发，属等价变异。
**S3 范围提示（同类启动器未覆盖，D-031 请复用）：** `_launch_broker_bot.mjs`（由 `index.js` 的 `startBrokerBotManager()` 在启动时按 `broker_onboarding` 有 token 的行逐个 fork）仍是 `CONSOLE_URL || 'http://127.0.0.1:3200'`、`KASPA_NETWORK || 'testnet-12'`：主网 console 环境里没有 `CONSOLE_URL`，一旦有 broker 入驻，它会把主网的 ingest secret 发给 `:3200`（陈旧/退役的 TN12 端口）。**主网现在 `broker_onboarding` 0 行，所以目前不触发**，是潜伏的同类问题。`_launch_owner_bot.mjs` 则读 `../kanet.env`（TN12 文件）并写死 TN12，与本次修掉的旧 `_launch_tg_bot.mjs` 同型。建议把 CR-1 的 `resolveBotLaunchEnv` 直接复用到这两个启动器（或明确退役），另出一笔。
**S4 纵深防御：** `api/capability.js` 的 `deriveCustodialExecFields` 也会按地址取 `tg_custodial_wallets` 的助记词做 JIT 解密签名（功能开关默认关、主网 0 行，现不可利用）；CR-2 只守了 tg-wallet 三路由，建议同样对网络≠testnet-12 拒绝，避免将来主网出现托管行时这条路径成为旁路。
**S5 文档提示：** `index.js` 在 `PORT` 未设时默认 3100，而新启动器要求 `PORT` 必须在继承环境里（否则 `PORT 缺失或非法` 拒启）——主网 env 已设 3202 所以没事，但排障文档里写一句"console 用默认端口时 bot 会拒启，需显式设 PORT"。

## 我没做
未启动真实 bot（有效环境下启动器会拉起 bot，超出验收范围）；未部署。
