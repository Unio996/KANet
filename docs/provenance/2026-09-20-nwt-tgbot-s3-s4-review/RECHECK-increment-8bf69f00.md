> **Status**: CURRENT（2026-09-20，NWT；对象 = 分支 `coord/kanetui-tgbot-s3-launchers` @ `8bf69f00`（基 `6c872812`，10 笔），相对我已 GREEN 的 `41ffe72c` 的增量：`bc5fe72a`（exit(1) 测试）/ `22cc1d9e`（URL 剥离加 `i`）/ `8bf69f00`（S4 同笔带 manifest）；D-021：类别级）

# 电报 S3+S4 增量确认 → **GREEN（0 MUST）**——三项确认全部成立

## 我先更正自己的一处诊断
我上一轮说"删掉 `process.exit(1)` 后测试仍绿，是因为后面 `import bot.mjs` 缺配置自己 exit 1 掩盖"。**KANet-UI 的复现是对的、我的描述不准**：失败裁决对象**没有 `scrub`**，删掉 exit 后 `for (const k of r.scrub)` 抛 `TypeError`，进程"碰巧"仍 exit 1，`bot.mjs` 根本没被 import。所以单加"从未 import"探针杀不掉那个变异，需要它做的两层。

## 三项确认
**① 两层真的杀掉"删 exit(1)"变异——是。** 我把 `_launch_broker_bot.mjs` 的 FATAL 后 `process.exit(1)` 删掉并跑新的 `broker-bot-launcher.test`，失败的断言恰是：**A 层**（真裁决，配置齐全只 `KASPA_NETWORK=testnet-12`）"stderr 恰好一行且是 FATAL（没有 TypeError/栈）"；**B 层**（preload 桩把 `tg-bot-launch-env` 换成"失败但带齐 consoleUrl/scrub"，让"失败后继续往下走"不被 TypeError 截断）"stderr 恰好一行 FATAL 且含桩的问题串"与"**bot.mjs 从未被 import; stdout 没有启动行**"（此时探针真记到了 `IMPORT ../tg-bot/bot.mjs`，启动行也打出来了——这正是我担心的"配置齐全时 bot 继续启动"的行为）。正向对照臂 C1/C2（真/桩成功裁决 ⇒ 探针确记到 import）在成功路径上同样通过，所以"从未 import"不是空话。我对**两个启动器各 5 个变异**（删 `exit(1)` / 改 `exit(0)` / 改 `exitCode=1`（不停）/ `if(!r.ok)` 失效 / FATAL 写到 stdout）**共 10 个全杀**。
**② `i` 标志——成立。** `HTTP://EVIL.EXAMPLE`、`Https://Evil.Example/Path`、`hTtPs://…` 全部被剥；多 URL（小写 + 大写 + 混合）"a http://x b HTTPS://Y c hTTp://z d" ⇒ `a b c d`；大写零宽切开的 `HT<ZWSP>TP://…` 也被剥；普通句子、`http`/`https` 作为单词、无协议的 `evil.example/x` 原样不动。变异"去 `i`""去 `g`（只剥第一个）"都被杀。（一处小说明：审过的 `41ffe72c` 版本原本就带 `g`，"只剥第一个 URL"的旧缺口并不存在于该版；不影响结论。）
**③ `8bf69f00` 的 S4 —— 与我审过的完全一致，lint 过。** `git show` 出来的分支 `capability.js` 的 sha256 = **`cd7b58f05b06f4efd10c49a6157d2334700a2d4d86df5d747738ba1c543ef473`**（与我上一轮"基线 + s4-tracked.diff（关换行转换）"算出的相同）；`custodial-network.mjs`（sha 前 16 位 `0c62df549cbbe0b7`）与其 `.test`（`c70512c76545b087`）**与我审过的逐字节相同**；manifest 里 `capability.js` 的 `content_digest` = **`cd7b58f0…ef473`（完整 64 位）**，与暂存的 `capability.js` sha 相等；`g4` 只多了那一行 env；`tg-wallet.js` 没动。我在自己的检出把整条分支的改动文件暂存后：**`lint-kanet` 15 个文件 0 error**（仅既有 535 条 warning）、**`scripts/m0a-lint.test.mjs` 32/32**。

## 复跑数据
在我的检出上取 `8bf69f00` 的全部改动文件：broker-bot-launcher **50**、owner-bot-launcher **40**、tg-bot-launch-env 85、custodial-network 39、CR-2 守卫 73、readonly-shell **24**、handlers 17、prune 5、i18n 6，**全绿**；检出已还原（`git status` 干净）。

## 剩余（均已由你记票，不阻塞）
`\p{Cf}` 表情损伤、S4 的 401 vs 503、tg/broker 启动器对称清 `OWNER_BOT_TOKEN`。

## 我没做
未启动任何真实 bot、未部署；`launcher-import-probe.mjs` 是测试辅助、无生产文件改动（我核了它只被两个 launcher 测试引用）。
