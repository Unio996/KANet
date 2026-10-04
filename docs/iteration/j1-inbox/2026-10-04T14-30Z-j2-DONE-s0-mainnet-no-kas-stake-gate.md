# J2 DONE · S0 主网「不收 KAS」硬闸 + 自动程序开关 + env 脚本（账本 1845，设计 §3.1）

> 分支 `coord/j2-pm-ktt-s0-20261004`（基 `73a21c18`，新分支、新提交，无 amend/rebase）。无部署、无重启、无广播、无改真 env、无写库。
> 范围严格 = Bettor 派工 1–5；S1/S2 未动。

## 0. 结果一览

| 项 | 结果 |
|---|---|
| 1 硬闸 `assertNoKasStakeOnMainnet(routeName)` | 17 条路由第一条语句挂闸（pool 12 + proto 5），主网 403「主网押注与开盘不收 KAS（D-017 §2）」 |
| 2 `WORLDCUP_SCHEDULE_ENABLED` | 默认关；关时打印 `[worldcup-schedule] disabled (WORLDCUP_SCHEDULE_ENABLED!=1)`，不起 timer、不发首个 tick |
| 3 回归测试 | `kasia-console/src/api/mainnet-no-kas-stake-routes.test.mjs`：**ALL PASS，177 条断言**；负向对照（删一条闸）真的红 |
| 4 env 脚本 | `docs-private/owner-env-pm-ktt-s0-20261004.ps1`（gitignored，纯 ASCII，无 CR）；只对 scratch 副本测过，真文件哈希前后一致（见 §4） |
| lint | `node scripts/lint-kanet.mjs` 对 5 个改动文件 ✓ 0 errors |

## 1. 提交的文件

- 新增 `kasia-console/src/lib/mainnet-no-kas-stake-gate.mjs`（闸函数）
- 改 `kasia-console/src/api/pool.js`（+1 import，+12 条闸，纯新增行）
- 改 `kasia-console/src/api/proto.js`（+1 import，+5 条闸，纯新增行）
- 改 `kasia-console/src/services/worldcup-schedule-cron.mjs`（`worldcupScheduleEnabled()` + `start…` 开头 3 行）
- 新增 `kasia-console/src/api/mainnet-no-kas-stake-routes.test.mjs`

## 2. 闸的行为（`lib/mainnet-no-kas-stake-gate.mjs`）

- 网络判断 = 现成单源 `configuredNetwork()`（`kasia-console/src/lib/kaspa-network.mjs` → `shared/lib/kaspa-network.mjs`），没有另写任何网络判断。
- `mainnet` ⇒ 返回 `{http:403, body:{ok:false, error:"主网押注与开盘不收 KAS（D-017 §2）", code:"mainnet_no_kas_stake", route, network}}`；路由 `return reply.code(g.http).send(g.body)`。
- `testnet-12` / `simnet` / `devnet` ⇒ 返回 `null`，路由行为与改前逐字节一致。
- **网络未配 / 不认识 ⇒ fail-closed 403**（`configuredNetwork` 本来就会在这里 throw；把 throw 变成 403，不放行）。这是我加的一条，派工没明说；主网 env 有 `KASPA_NETWORK=mainnet`，不受影响。
- 每个路由名只打一条 `console.warn [mainnet-no-kas-stake] 403 …`（自动程序每 tick 都会撞，不刷屏）。

受闸路由（均为 `fastify.post`，闸是 handler 的第一条语句，先于读 `request.body`/查库/relay/转账）：
`create`、`create-v06`、`create-v07`、`:id/bettor/register-v07`、`…/register-v07/prep`、`…/register-v07/confirm`、`:id/oracle/deposit`、`:id/bettor/register`、`…/register-external/prep`、`…/register-external/confirm`、`…/register-v06/prep`、`…/register-v06/confirm`，以及 `proto-markets/{create, :id/bet, :id/resolve, :id/claim, :id/withdraw}`。

## 3. 测试覆盖（真 Fastify + `app.inject` + 真 migration 临时库；`mock.module` 打桩 `sendCommandAsync` / `transferAndConfirm` 计数）

1. 闸函数网络矩阵：mainnet → 403 + 文案逐字相等；testnet-12 / simnet / devnet → null；未设 / 空 / `Mainnet` / `foo` → 403。
2. 主网下 17 条路由 × {空体, 完整体} = 34 次请求：每次断言 **403 + code + route + 文案**、**`transferAndConfirm` 调用 0、`sendCommandAsync` 调用 0**、9 张关键表（`pool_markets`、`pool_bettor_sides`、`market_shards`、`pool_bet_preps`、`proto_markets`、`proto_bets`、`proto_bet_intents`、`proto_settlement_intents`、`events`）行数不变。
3. testnet-12 与 simnet 下同样 17 条路由发空体：全部不返 `mainnet_no_kas_stake`（由原有校验接手，实测多为 400），即「仍过闸」。
4. 结构闸：逐个扫 `pool.js` / `proto.js` 的 `fastify.post(…)` 声明，闸必须是第一条语句且路由名与表一致；**任何未受闸的 POST 路由必须在显式白名单里**，以后新增路由漏闸测试会红。白名单 = `settle`、`oracle/vote`、`bettor-refund-claim`、`prevet-extract`、`prevet`、四条 `/api/admin/pool/*`（admin secret + `ADMIN_*_ENABLED` 双闸，只付结算手续费/出证 gate）、`/api/broker/recommend`（只读判断）。这 10 条是我读码判定「不向开盘人/下注人/委员收 KAS」，请你审这份白名单。
5. `WORLDCUP_SCHEDULE_ENABLED`：未设 / `0` / `true` ⇒ 关（只认字面 `1`）；`1` ⇒ 开；未设时 `startWorldcupScheduleCron()` 打 disabled、不打 starting。
- 负向对照：删掉 `register-v06/confirm` 的闸，测试红 3 条（两条 403 断言 + 结构闸），恢复后全绿。
- 运行：`cd kasia-console && node src/api/mainnet-no-kas-stake-routes.test.mjs`（脚本自己 bootstrap 临时库、带 `--experimental-test-module-mocks` 重启自身）。

## 4. env 脚本与哈希（派工第 4 项）

`D:\kanet-tn12\docs-private\owner-env-pm-ktt-s0-20261004.ps1`，沿用 `owner-env-pm-golive-20261004.ps1` 的写法：`-EnvFile` 参数、先备份（`<EnvFile>.bak-pm-ktt-s0-20261004`，已存在则不覆盖）、已有键替换**最后一处**（加载器 last-wins）否则追加、UTF-8 BOM + LF。四个键：`DEMO_HOUSE_OFF=1`、`PROTO_DRIVER_ENABLED=0`、`PROTO_SETTLEMENT_DRIVER_ENABLED=0`、`WORLDCUP_SCHEDULE_ENABLED=0`。纯 ASCII（0 个 >127 字节、0 个 CR）。

测试只用 `-EnvFile` 指向 scratch 副本（`scratch/_j2_mainnet_m1/envtest/`，测完已删）：
- 真文件 `D:\kanet-tn12\kanet.mainnet.env` SHA256 **测试前** `A7548ED868DEA38ADF7DCF9006E0A55F8BED0C7B50D9F2674AD701EFC4F03935`；**测试后** `A7548ED868DEA38ADF7DCF9006E0A55F8BED0C7B50D9F2674AD701EFC4F03935`（逐字相同，脚本从未对真文件运行）。副本测试前哈希 == 真文件哈希。
- 第一次运行：`appended DEMO_HOUSE_OFF=1`、`replaced PROTO_DRIVER_ENABLED=0`（原第 70 行）、`replaced PROTO_SETTLEMENT_DRIVER_ENABLED=0`（原第 71 行）、`appended WORLDCUP_SCHEDULE_ENABLED=0`。第二次运行幂等（四个全 replaced，备份不覆盖）。
- 结果与原文件逐行比对：94 行 → 96 行，**只有这四个键的行变化/新增**；原文件与结果都是 BOM + LF（无 CR），结果以 LF 结尾。
- 提醒：脚本只改文件，进程要等 console 重启才读到；Owner 跑完脚本不等于已生效。

## 5. 派工第 5 项：写代码前找到的现成件（D-031）

- 网络单一源：`configuredNetwork()`（`shared/lib/kaspa-network.mjs`，console 薄包装 `lib/kaspa-network.mjs`）——复用，闸里没有任何自写的网络判断。同一单源在 `pool.js:128/1158/1538` 已被用。
- 闸的返回形态：沿用仓库已有的「纯函数返回拒绝对象、路由 `return reply.code().send()`」写法（`tokens.js` 的 `kttPanelGate`、`proto-relay-guard.mjs` 的 `rejectRelayIdInBody`），没有新造中间件/hook。
- 开关写法：`=== '1'` 才开，同 `ZK_*_TICK_ENABLED`、`PROTO_DRIVER_ENABLED`、`DEMO_HOUSE_OFF`。
- 测试骨架：照抄 `proto-bet-intake-route.test.mjs` 的「bootstrap 临时 migration 库 + 真 Fastify + inject」；env 脚本照抄 `owner-env-pm-golive-20261004.ps1`。
- **查过、没有现成可复用的**：pool.js 里没有任何「路由级启停开关」或「按网络拒绝」的闸（env 只有 `POOL_*` 限额类与 `ADMIN_*_ENABLED`）；`proto-oracle-policy.mjs` 的 `judgedMarketAllowedHere` 按 `network==='mainnet'` 判断但管的是「判定题能否建」，不是 KAS，不能复用。
- 日志里已有 `[bettor-bisect] HouseAgent disabled` 那条开关日志，`worldcup` 的 disabled 日志照这个口径写。

## 6. 要你知道的几件事（不在派工内，我没擅自处理）

1. **还有第三个自动程序在主网跑：`pool-auto-better`（`index.js:760-761`，只有 `DEMO_AUTOBETTER_OFF=1` 才关）**。它也走 `register-v07/prep` + `/confirm`，同属 R5 调用方。S0 的路由闸已把它的 KAS 路径拦成 403（它的 `CONSOLE_BASE` 默认 `http://127.0.0.1:3200`，不是主网 3202，所以多半本来就打不到，但这是「碰巧」）。建议 env 脚本也加 `DEMO_AUTOBETTER_OFF=1`——我没加，等你定（加一行即可，脚本结构不变）。
2. `house-agent` / `worldcup` 用的 `CONSOLE_BASE` 默认也是 3200。同上，路由闸已覆盖，env 关掉是第二道。
3. **proto 写路由全封意味着主网上那个 `resolved` 的 proto 市场（`a59c7b48…`）以及 1 笔 `ambiguous` 的旧下注，也不能再经 `/claim`、`/withdraw` 动**。你的设计 §3.4 是这么写的（「写路由同挂硬闸」），我照做；若 Owner 之后要从 proto 市场取回东西，需要另开一条受控路径，不在 S0。
4. 闸是 console 路由层；relay 直接命令不经过它（设计 §5.4 已记）。
5. `pool.js` 在主网仍会注册这 12 条路由、页面仍调用它们，主网建盘页/盘口页点下去会收到 403（设计 §3.6，用户面另批）。
6. 测试基线：我只跑了本测试 + lint，没有跑全仓测试；改动是纯新增行（pool.js/proto.js 0 删除），影响面限于「主网 + 这 17 条路由」和「worldcup cron 默认关」。**worldcup 默认关是全网络生效的**（测试网/simnet 上不设 `WORLDCUP_SCHEDULE_ENABLED=1` 也不再自动建盘）——按派工要求如此，TN12 已退役，但若有 simnet 彩排依赖它请知悉。

## 7. 没做的事

没有部署、重启、广播、写库、改真 env、改合约。S1（下注不收 KAS）、S2（建盘不建 spine + v221 迁移）、S3、S4、S5 均未开始，等你审完 S0。
