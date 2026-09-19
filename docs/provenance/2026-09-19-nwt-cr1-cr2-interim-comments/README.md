# CR-1 / CR-2（KANet-UI，6d11e831）设计审 — NWT 中途意见（2026-09-19）

状态：Owner 裁定电报接线暂停（D-024，等 bot 接 proto v0 API 立项），Bettor 令"写到哪停到哪"。**这不是完整 verdict**，只落已有意见，恢复审查时以此为起点。全部是对**尚未落码**的设计的意见，不含未修复漏洞细节。

## 已核实的事实（代码取自 origin/bshard-m3-deploy@6d11e831）

- `tg-bot/*.mjs` 非测试文件**没有任何指向 tg-bot 目录之外的 import**（`git grep` 零命中）⇒ 变更说明里"bot 不 import console 代码"成立，因此从 bot 进程里删掉 `CONSOLE_ENCRYPTION_KEY` / `ADMIN_SECRET*` 对 bot 自身功能**无副作用**（这是我对 scrub 副作用问题的实证答案）。
- `tg-bot/config.mjs` 读的 env 比变更说明列的多：`OWNER_BOT_TOKEN`、`OWNER_CHAT_ID`（`:27/:31`，仅 `owner-bot.mjs` 使用，broker bot 不用）、`TG_TEST_BOT_USERS`（仅影响轮询跳过）、`TG_*_MS`、`BROKER_RELAY_ID`。
- 主网 env 文件 `kanet.mainnet.env` 现有键名：`KASPA_NETWORK`、`PORT` 在；`INGEST_SECRET` 不在（由 `ensureIngestSecret()` 于 console 启动时写入 `process.env` 与 DB，`index.js:147-161`），`TELEGRAM_*` 不在（路径 X 走 DB）。该文件是 **CRLF**（69 行含 `\r`）。
- CR-2 之外仍读 `tg_custodial_wallets` 的入口：`capability.js:195`（custodial_transfer 执行绑定器，feature-flag 默认关）。CR-2 阻止新行产生（唯一 INSERT 在 `tg-wallet.js:75`），所以主网库该表应恒为 0 行——Stage B 验收应加一条 `COUNT(*)=0`。

## 对四个问题的意见

1. **CR-1 断言集**：基本完整，建议补：
   - (g) `NODE_TLS_REJECT_UNAUTHORIZED` 不得为 `0`（bot 持 Telegram token，关 TLS 校验 = 可被中间人拿 token）；(h) `NODE_OPTIONS` 不得含 `--inspect`/`--require`/`-r`/`--import`。
   - 断言 f（`KANET_TESTNET_NO_LIMITS`）要按**存在性**判（`=0`、`=''`、`=false`、大小写变体键都必须失败），不是真值判；变更说明的测试表只有 `=1`。
   - 断言 a/b 要考虑 **CRLF**：`'mainnet\r'`、`'3202\r'`、`'3202 '` 会怎样，需要显式向量；`PORT` 不要用 `Number.isInteger(Number(s))`（接受 `'3.2e3'`、`'0x10'`、`' 3202 '`），用 `/^[1-9][0-9]{0,4}$/` 再判 ≤65535。
   - Windows 上 `process.env` 大小写不敏感，但 `{...process.env}` 展开后是区分大小写的普通对象，纯函数被传入展开副本时会漏掉大小写变体——纯函数内部按大写归一化键再判，并加"传 process.env / 传展开副本"两个向量。
2. **scrub 黑名单 vs 白名单**：**黑名单单独不够**。具体漏洞：D-023 口径②计划把 `OWNER_BOT_TOKEN`/`OWNER_CHAT_ID` 复用进主网 env，broker bot 子进程会继承它——它能以 owner-bot 身份给 Owner 发消息，而 broker bot 处理的是不可信 Telegram 输入。建议：**按名字模式的黑名单**（`/SECRET|TOKEN|PASSWORD|PASSPHRASE|PRIVATE|MNEMONIC|SEED|ENCRYPTION|CREDENTIAL|API_?KEY|KEY_EXPORT/i`，加显式保留集 `{TELEGRAM_BOT_TOKEN, INGEST_SECRET}`），日志只打被删键名；不采用纯白名单（同意 KANet-UI 的 Windows 系统变量风险）。**残余风险**（CR-1 解决不了）：bot 保留的 `INGEST_SECRET` 在 console 里授权面很宽（`verifyIngestRequest` 出现在 trading/escrow/relay/pool 等十多个 api 文件），一旦 bot 被攻破，这一个密钥仍是主要爆炸半径；scrub 只降低"顺手带走"，不是隔离。
3. **测试矩阵**：纯函数部分好。缺口：
   - 哨兵覆盖面——现在只测 `INGEST_SECRET`/`TOKEN` 不进 problems，要扩到**所有会回显的值**：`CONSOLE_URL`（若含 `user:pass@` 会被原样打印）、`KASPA_NETWORK`、`PORT`；建议 `problems` 里 URL 只打 `host:port`、`KASPA_NETWORK` 先按 `/^[a-z0-9-]{1,32}$/` 过滤否则打 `(invalid)`。
   - **scrub 真的删掉了**没有任何测试证明——纯函数只返回名单，启动器进程级测试因走的是必然失败路径永远到不了删除；建议把"应用启动环境"也做成纯函数 `applyLaunchEnv(env)`（对传入对象 mutate：设 CONSOLE_URL、删 scrub 键），单测它。剩下没测到的只有 `import bot; startBot()` 两行，**通过路径不在自动测试里、只靠 runbook B4/B5 取证——可以接受**，前提是 `applyLaunchEnv` 已测、启动器静态断言（无 `kanet.env`/`3200`/`testnet-12`/`BROKER_RELAY_ID` 命中）在、B4/B5 中止条件保留。
4. **CR-2 需要重启 console 才生效**：判据"运行中的 console 已重启加载"不要只靠时间对比；给一个**无副作用的运行时探针**：对一个哨兵 `tg_user_id` 发 `GET /api/tg-wallet/<sentinel>`（带 ingest secret）。守卫未加载时该路由返回 **404（"你还没有钱包"）**，加载后返回 **503（"托管钱包暂不可用"）**——两者可区分且不写库。**不要用 POST /create 探测**：守卫未加载时它会真的生成助记词并写库。另建议守卫做成**插件级 hook**（`fastify.register(async (app)=>{ app.addHook('preHandler', guard); …路由… })`）而不是逐路由挂 `GUARDED`：将来在同文件新增第四条路由若仍写 `AUTH`，会静默绕过守卫；同时加一条**路由枚举测试**（枚举 `/api/tg-wallet` 前缀下已注册路由，除 `diagnose` 外在主网环境下必须全部 503）。

## 未做

CR-1 六条断言逐条的绕过组合实验、CR-2 与 `tg-wallet-pilot-isolation-regression.mjs` 的交互核对、runbook v0.2 §3.4/§7 的逐条核对。恢复审查时再做。
