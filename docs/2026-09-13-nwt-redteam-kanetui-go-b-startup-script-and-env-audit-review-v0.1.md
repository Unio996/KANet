# NWT 红队复核 · GO-B 交付（主网 console 启动脚本 + kanet.env 逐项审计）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`scripts/start-console-mainnet.ps1` + `docs/2026-09-13-kanetui-mainnet-kanet-env-audit-v0.1.md`，提交 `63bc07d6`。
> 方法：不只读代码,**用 PowerShell 工具亲自做了一次机制级实测**（验证 `Start-Process` 子进程是否真的继承 `[Environment]::SetEnvironmentVariable(...,'Process')` 设的值,这是全套机制能不能工作的地基);逐条核对审计表声称的"0=关闭"是否与实际源码的 flag 判定逻辑一致(不是读注释信,是读判定表达式本身)。

## 结论：**脚本本身 PASS,四项核对全部通过;审计表有一处真实 bug——`MINING_CONSOLIDATE_ENABLED=0` 不会真的关闭那个 cron,这正是你点名要找的"该关没关的钱路 tick"**——阻塞 GO-C,改一个值即可,不影响其余判断

## 一、脚本机制核实——**地基是稳的**

**`Start-Process` 子进程是否继承 `[Environment]::SetEnvironmentVariable(..., 'Process')` 的值——亲测,不是读代码猜**：用 PowerShell 工具跑了一次最小复现（先 `SetEnvironmentVariable(...,'Process')` 设一个测试变量,再 `Start-Process` 起一个子进程读它),**子进程正确读到了值**。这是整套"独立小型启动方式,不碰 `kanet.env`"机制能不能工作的地基,亲测过比读文档心里有底。

**四项逐条核对**：
1. `CONSOLE_ENCRYPTION_KEY`——脚本注释写清楚"新生成,禁止从 `kanet.env` 复制",审计文档也确认全程未在任何命令输出/频道里回显明文,只打印了长度做核对。**PASS**。
2. `DB_PATH`——审计表给的是绝对路径 `D:/kanet-tn12/kasia-console/data/console.mainnet.db`,绕开了 `resolve()` 受 cwd 影响这个坑。**PASS**。
3. 日志重定向——脚本 `-RedirectStandardOutput`/`-RedirectStandardError` 分文件写到独立的 `logs\mainnet\` 目录,不跟 TN12 现有日志混。**PASS**。
4. PID 文件——脚本起完把 `$proc.Id` 写进 `logs\mainnet\console-mainnet.pid`,给出了对应的手动停止命令。**PASS**（这条本来是建议不是 MUST,做了更好)。

**脚本里几个额外的好设计,记一句正面**：起前显式核对六个关键变量是否真的注入成功（不是假设注入了就完事)、显式核对 `KASPA_NETWORK` 真的是 `mainnet`(防止把 kanet.mainnet.env 内容写错却没人发现)、`Start-Process` 返回值判空(防止"看起来起了但其实没起"这种静默失败)——这几处都是"不假设、去核实"的写法,跟我这轮一直坚持的方法论一致。

## 二、**审计表的真实 bug：`MINING_CONSOLIDATE_ENABLED=0` 不会关闭挖矿 UTXO 归集 cron**

你点名要查"env 表里有没有该关没关的钱路 tick"——**找到一个,且是这一类里最隐蔽的一种：跟其余五个"关闭类"flag 语义方向相反,审计表按同一套判断套了过去,套错了**。

审计表 §6 把 `MINING_CONSOLIDATE_ENABLED` 跟另外五个 flag(`POOL_SEEDER_ENABLED`/`PREDICTION_AGENT_ENABLED`/`AUTO_BET_TICK_MS`/`ZK_PROVE_WORKER_ENABLED`/`BSHARD_CLOSE_VOTER_V2_ENABLED`/`BSHARD_CLOSE_SUBMIT_V2_ENABLED`)放在同一类"写 `0` 关闭"处理——我逐个去读了这六个 flag 在源码里的**判定表达式本身**(不是读注释,是读实际比较逻辑)：

| flag | 源码判定 | `0` 能关掉吗 |
|---|---|---|
| `AUTO_BET_TICK_MS` | `parseTickMs`: `Number.isFinite(n) && n>=0 ? n : 20000`(`pool-auto-better.js:37-40`) | **能**（显式 0 就是 0,不落回默认) |
| `POOL_SEEDER_ENABLED` | `!== '1'` 则不起(`pool-market-seeder.js:41`) | **能**（默认关,需显式 `'1'` 才开) |
| `PREDICTION_AGENT_ENABLED` | `=== '1'`(`conversations.js:338`) | **能** |
| `ZK_PROVE_WORKER_ENABLED` | 注释"=1才跑,默认OFF"(`index.js:537`) | **能** |
| `BSHARD_CLOSE_VOTER_V2_ENABLED` | `=== '1'`(`bshard-close-voter.js:545`) | **能** |
| `BSHARD_CLOSE_SUBMIT_V2_ENABLED` | `=== '1'`(`bshard-close-voter.js:642`) | **能** |
| **`MINING_CONSOLIDATE_ENABLED`** | `(process.env.X \|\| 'true').trim().toLowerCase() !== 'false'`(`mining-utxo-consolidate.mjs:31`) | **不能**——`"0"` 是非空字符串,JS 里非空字符串是真值,`("0" \|\| 'true')` 短路取 `"0"`,`"0" !== 'false'` 为真 ⇒ **`CONSOLIDATE_ENABLED = true`,cron 照样起** |

**这个 flag 的设计本身没问题**——读了它的头注释,这是 2026-08-10"止血 kill-switch",**故意设计成默认开(不改变既有行为)、只有显式写字符串 `'false'` 才关**,跟其余五个"默认关、显式 `'1'` 才开"的方向正好相反,是这个文件自己的既有约定，不是这次审计造出来的新代码。**审计表的错不是发明了一个 bug,是把六个 flag 按"同一套判断"批量套用,而这一个恰好是唯一一个语义方向相反的,套错了。**

**现在为什么还没炸——一个偶然的、不该依赖的第二重门**：`startMiningConsolidateCron()`(`:110-114`)在起 cron 之前还会检查 `MINING_RELAY_ID` 是否设了,没设直接不起。**审计表 §5 把 `MINING_RELAY_ID` 列在"12 项 relay 身份,全部留空,等以后新建 mainnet relay 身份再回填"里**——这意味着**现在这一刻**,即使 `MINING_CONSOLIDATE_ENABLED=0` 没能真的关掉这个 flag,cron 也不会启动,因为 `MINING_RELAY_ID` 还是空的。**但这只是运气好,不是设计上的安全网**：审计表自己的 §5 明确写了"等对应功能真需要启用、按 §3.1 步骤 6 建好新身份后,再逐个回填"——`MINING_RELAY_ID` 正是那份要被回填的清单里的一项。**回填那一刻,`MINING_CONSOLIDATE_ENABLED=0` 这个写错的值会立刻变成活的**：一个 60 秒一次的 cron 会开始对主网发真实签名交易(`consolidate_utxo` 命令),而操作者当时的意图(审计表自己写的"无挖矿业务,不需要")完全没有变,只是没人记得回头检查这个特例。

**裁决 MUST(阻塞 GO-C)**：把 `kanet.mainnet.env` 里 `MINING_CONSOLIDATE_ENABLED` 的值从 `0` 改成字面字符串 `false`（跟这个文件自己头注释写的用法一致:"Set to 'false' in a given machine's kanet.env to disable"）。**现在改成本几乎是零**（一个值,不涉及代码改动),但如果留着现在这个值,等到 GO-E 回填 `MINING_RELAY_ID` 那一步,没有任何检查会提醒任何人这里其实没关——这正是那种"改文件不改运行中状态,下次触发条件满足时才炸"的坑,跟我在起服务方案 v0.1 那轮抓到的 `kanet.env` 三行问题是同一个类型,只是这次换了个字段。

## 三、其余核实项——**PASS**

- `.gitignore` 加 `kanet.mainnet.env` 那行——`git check-ignore -v kanet.mainnet.env` 亲测 exit 0,确认真的被覆盖,不是"加了但没生效"。
- 端口冲突——亲测 `Get-NetTCPConnection -LocalPort 3201,3202`,3201 确实被占(`100.99.147.101`,一个正在监听的进程),3202 确实空闲,与审计表结论一致。
- `KANET_TESTNET_NO_LIMITS` 明确排除——批准,这条本来就该是主网起步清单里唯一"现值存在但必须不带"的项,单独点名防止将来被误当"忘了抄"补回去,这个做法是对的。
- Admin/Telegram/relay 身份 12 项/外部网关/ws-proxy 全部留白待 Owner/后续步骤定案——审计范围划得对,这些留白的后果("对应功能不可用"而不是"漏配崩溃")在我核对过的几个 flag 上(`POOL_SEEDER`/`PREDICTION_AGENT`)确认属实,是"未配置/不启动"分支不是报错。

## 四、一条建议(非 MUST,供将来编辑 `kanet.mainnet.env` 时参考)

脚本解析 `kanet.mainnet.env` 的正则 `^([^=]+)=(.*)$` **不会剥离行内 `#` 注释**——恰好 `kanet.env` 自己的第 285 行就记着一条真实历史事故("值后面绝不能加行尾注释……KANet-UI 2026-07-25 实测踩过"),这个新脚本继承了同一种脆弱性(不是新引入,是没有比旧脚本更健壮)。**现在的 `kanet.mainnet.env` 内容(按审计表描述)没有这个问题**,但 §5/§3 都明确写了这个文件以后还要被多次手工编辑(回填 12 个 relay id、可能补 admin secret)——每一次编辑都是重蹈这个已经吃过一次亏的坑的机会。**建议**：不阻塞这次 GO-C,但下次碰这个脚本时顺手加一行"剥离 `#` 及其后内容(值本身含 `#` 的情况在这批变量里不存在,不用担心误剥)"，把纪律变成机制。

## 五、给 Bettor 的处置建议

- **脚本本身 GREEN**，四项 MUST 全部核实通过(含一次机制级实测,不是只读代码)。
- **阻塞 GO-C 的一条 MUST**：`kanet.mainnet.env` 的 `MINING_CONSOLIDATE_ENABLED` 改成 `false`(字符串,不是 `0`)——现在改零成本,不改的话会在 GO-E 回填 `MINING_RELAY_ID` 时变成一个没人会注意到的真实钱路 cron 启动。
- 其余项(gitignore/端口/明确排除项/留白范围)全部核实为真,不需要改。
- 一条非阻塞建议：`kanet.mainnet.env` 的解析器不剥离行内 `#` 注释,继承了 `kanet.env` 自己吃过亏的同一个脆弱性,不影响这次,但下次编这个脚本时建议顺手补上。
