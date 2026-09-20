> **Status**: CURRENT（2026-09-20，NWT；对象 = S3 七笔（分支 `coord/kanetui-tgbot-s3-launchers` @ `41ffe72c`，基 `6c872812`）+ S4（未提交的 `capability.js` 网络守卫 + 新 `lib/custodial-network.mjs` + g4 harness 一行）；字节审；D-021：类别级）

# 电报 S3（启动器同型漏 + 3 SHOULD + 文档）与 S4（托管钱包能力网关纵深）—— NWT 审

## 结论：**S3 GREEN；S4 GREEN（M0a digest 已独立确认，须与 manifest 同笔提交）。0 MUST。** 另有 1 条"补测试（不改码）"与几条 SHOULD。
D-031 第一判据：L1/L2 复用 CR-1 已验的 `resolveBotLaunchEnv`（只加两个可选参数），S4 复用 CR-2 的判据与文案，均未另造。

## 做法
把 S3 分支的 9 个文件与 S4 的 4 个文件取到我自己的检出（`D:\kanet-nwt-cand`，独立 node_modules，生产检出零触碰）原样执行；写独立探针 / 变异 / 真启动器进程测试；用完 `git reset` + `checkout` + `clean` 还原（`git status` 干净）。

## S3
**测试复跑（我的检出）**：tg-bot-launch-env 85 / broker-bot-launcher 41 / owner-bot-launcher 31 / tg-wallet-network-guard 73 / readonly-shell 23 / readonly-handlers 17 / prune 5 / i18n 6，**全绿**。
**L1 `_launch_broker_bot.mjs`（真正堵漏的一笔）——成立。** 回落彻底删除：源码里不再有 `:3200` / `testnet-12` / `configs.js` / `getConfig` / 对 `CONSOLE_URL`·`KASPA_NETWORK` 的 `||`。我用**真启动器进程**在 7 种失败环境下跑：无环境 / 只有 token（旧回落形态）/ `testnet-12` / 缺 `INGEST_SECRET` / 陈旧 `CONSOLE_URL=:3200` 与 `PORT=3202` 不一致 / `CONSOLE_URL` 夹凭据 / 小写键 `kanet_testnet_no_limits` ⇒ **全部 `exit=1`、只打 `FATAL`+键名**；输出里塞了哨兵值（含 URL 凭据）**零泄漏**（凭据 URL 只显示 `http://evil.example:3202` 的 origin）。ingest secret 来自继承环境（console 启动时 `process.env.INGEST_SECRET = <DB 里那份>`，我前面已核），不再开库。
**L2 `_launch_owner_bot.mjs`（复用不退役）——成立。** `OWNER_BOT_TOKEN` 未设或全空白 ⇒ `exit 0` no-op；设了但网络≠mainnet / 缺 ingest ⇒ `exit 1`；只有 broker 的 `TELEGRAM_BOT_TOKEN` 而没有 owner token ⇒ no-op（不会拿 broker token 冒充）；`scrubExtra=['TELEGRAM_BOT_TOKEN']` 让 owner-bot 进程不持有 broker token。
**L0 lib（S1 原漏）——成立。** 我在**真 Windows `process.env`** 上设小写/混合大小写的 `console_encryption_key` / `Admin_Secret_Funds` / `relay_key_export_enabled_until` / `telegram_bot_token`：`resolveBotLaunchEnv` 返回**实际大小写**的键名，`delete process.env[k]` 后全部真的消失，`OWNER_BOT_TOKEN` 保留；`tokenKey` 必须是 `UPPER_SNAKE`（小写、`__proto__` 都拒）。
**SHOULD-1 `cleanText`（含你点名的 reorder）——顺序修对、不误伤普通文本。** 新顺序：先剥显式不可见段 + 整个 `\p{Cf}`，再剥 URL，再把 C0 控制符换成空格。实测 `ht<ZWSP>tp://…`、`htt<U+00AD>p://…`、`h<tag>ttp://…`、`http<U+061C>://…`、`http://ev<U+202E>il…` **全部被完整剥掉**（旧顺序会拼回活链接）；普通句子、日期、数字原样保留；C0 控制符切开的 `ht\x07tp://` 变成 `ht tp://`（空格不会重连成链接）；`hhttps://` 剥后只剩 `h`。变异"回到旧顺序""去掉 `\p{Cf}`"都被杀。**我认为同笔保留合理**（同一函数、有回归测试、语义是"先归一再检测"的一个动作），无需拆开。
**SHOULD-2 `pruneStateForMainnet`——成立。** 只保留整段 `^kaspa:[a-z0-9]+$`：`kaspa:qqabc123` 与 36 位字母数字保留；`kaspa:`（空载荷）/ 大写 / 含空格 / 含 `:` / 含 `-` / `kaspatest:` / 前导空格 / 尾随换行全丢；`wantPrefix` 为 `''` / `null` / `undefined` / `5` / `'kaspa:'` ⇒ **一律不保留**（fail-closed，不拼 RegExp）。
**S2 测试**：CR-2 守卫的严格相等测试已补（`testnet-11`、首尾空格、`testnet-120`、`Testnet-12`、空串⇒503）；**S5 文档**只追加了 §7 排障 + runbook 页首一行指针，正文没动。

## S4
**digest 独立确认（三条路）**：① 基线 `capability.js`（`6c872812`）的 sha256 = manifest 现值 `34a234bc…f4a`（对得上）；② 在**关闭换行转换**的干净副本上应用 `s4-tracked.diff`，sha256 = **`cd7b58f05b06f4efd10c49a6157d2334700a2d4d86df5d747738ba1c543ef473`**；③ 仓库自己的 `lint-kanet`（M0a）对**暂存**的新 `capability.js` 报 `digest 失配: 现 cd7b58f05b06… ≠ manifest 34a234bc9e9f…`——即仓库算出的新值也是 `cd7b58f0…`。（注：我第一次用带 `autocrlf` 的临时仓库应用补丁得到了别的值，是 Windows 换行转换造成的假象，已用 `autocrlf=false` 复算一致。）**同笔提交**：我在自己的检出里把 manifest 该条改成上面的完整值、`git add` 后重跑 lint：**0 error（仅既有 535 条 warning）**；不改 manifest ⇒ 被 M0a 拦下。所以"S4 + manifest 同笔"是对的，也是必须的。
**守卫本身**：`deriveCustodialExecFields` 里网络守卫在**任何 DB 读之前**，行 `network` 检查在**解密之前**；判据严格相等（未设 fail-closed）；`tg-wallet.js` 本笔**未动**；`'testnet-12'` 两处拷贝由测试钉相等（我的变异"常量漂移成 `testnet-11`"被杀）。
**g4 重跑（带依赖的树，隔离库 + 死端口 RPC + 真 fork relay，零真链接触）**：
- ⚠ **先说一个既有问题**：**未改动的 g4 harness 在当前主线上本来就是红的**——`startRelay` 里 `configuredNetwork()` 抛 `KASPA_NETWORK not set or unknown`，harness 在到达 capability 之前就崩了。所以那一行 `process.env.KASPA_NETWORK = 'testnet-12'` **同时修了这个既有破损**，并不只是为 S4 服务。
- (a) 只加该行 + **未改** capability.js：**27 PASS / 0 FAIL**。
- (b) 加该行 + **S4 的 capability.js**：**27 PASS / 0 FAIL**，`LAND①`、`LAND①-精确`、`META` 都过。
- (c) **负向对照**（relay 启动后把 `KASPA_NETWORK` 翻成 `mainnet`）：**17 PASS / 10 FAIL**，`LAND①` 得到 `401` 且 body 正是守卫文案 `托管钱包暂不可用：本模块仅支持 testnet-12，当前 KASPA_NETWORK=mainnet`——证明守卫真在网关请求路径上起作用、env 那一行确有必要。（不能靠"起 relay 时就设别的网络"做对照：relay-manager 的 I4 会因行网络≠env 网络先拒启动。）
**变异**：S4 的 6 个（去网络守卫、去行检查、守卫放到 DB 读之后、`startsWith`、常量漂移、未设放行）**全杀**；S3 的 16 个里 **15 杀 1 活**。

## 补测试（不改码，建议同笔补上，不阻塞合并）
**L1 的 `process.exit(1)` 无变异覆盖。** 我把 `_launch_broker_bot.mjs` 里 FATAL 之后的 `process.exit(1)` 删掉，41 个测试仍全绿：因为失败环境下后面 `import bot.mjs` 会因缺配置自己 `exit 1`，把它掩盖了。这一行正是本笔堵"主网 ingest secret 发往退役端口"的核心，**一旦被误删，在配置齐全的非主网环境里 bot 会继续启动**。请在失败环境用例里加：**stdout 不得出现成功行**（`network=mainnet console=…`），并加一个"配置齐全但 `KASPA_NETWORK=testnet-12`"的用例配 preload 桩断言 **`bot.mjs` 从未被 import**（正向对照臂已经有 preload 机制，复用即可）；同样检查 owner 启动器。

## SHOULD（不阻塞）
1. **URL 剥离不认大写协议**：`HTTP://EVIL.EXAMPLE` 原样保留（`/https?:\/\/\S+/g` 没有 `i` 标志；改动前就如此，非本笔引入）。建议加 `i`。裸域名（无协议）Telegram 也会自动链接，本函数本来只是尽力而为。
2. **`\p{Cf}` 的附带损伤（观感，不涉安全）**：ZWJ 组合表情（👨‍👩‍👧）被拆成三个、英格兰旗这类 tag 序列退化成黑旗 🏴；波斯语 ZWNJ 早在旧版就被剥。若市场题干里有这类文字会显示不准；可接受，知悉即可。
3. **S4 的拒绝是 401**：调用方（未改）把 `derived.ok===false` 一律映射成 `401`，而 CR-2 的同判据返回 `503`。行为都是 fail-closed，只是状态码语义不一；不建议为此去动受控文件的调用方。
4. **对称清理**：`_launch_tg_bot.mjs` / `_launch_broker_bot.mjs` 不持有 `OWNER_BOT_TOKEN`，可对称地把它加入 scrub（主网 env 现在没有该变量，纯防御）。

## 我没做
未启动任何真实 bot、未接 Telegram、未部署；g4 只在我自己的检出里跑（写了那份检出的 `logs/test-runs/` 与 `scratch/`，已还原）。
